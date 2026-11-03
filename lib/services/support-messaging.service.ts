import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";
import {
  SupportMessagingErrorCode,
  createSupportMessagingError,
} from "@/lib/errors/support-messaging-errors";
import { createNotificationFromEvent } from "@/server/lib/notifications";
import { toJsonString } from "@/server/lib/json-field";
import { isUserCurrentlyOnline } from "@/server/lib/user-presence";

const MAX_MESSAGE_LENGTH = 4000;
const MAX_ATTACHMENTS = 5;
const DEFAULT_PAGE_SIZE = 50;

export type SupportActorRole = "user" | "staff" | "dev" | "super_admin";
export type EscalationTarget = "dev" | "super_admin";

export interface SupportActor {
  userId: bigint;
  role: SupportActorRole;
}

export interface SupportAttachmentInput {
  mediaUrl: string;
  mimeType: string;
  mediaKind: "image" | "video";
  fileName?: string;
  fileSize?: number;
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "").trim();
}

function previewText(body: string | null | undefined): string {
  const clean = (body ?? "").replace(/\s+/g, " ").trim();
  return clean.length > 200 ? `${clean.slice(0, 197)}...` : clean;
}

function displayName(user: {
  first_name: string;
  last_name: string;
  email: string;
}): string {
  const name = `${user.first_name} ${user.last_name}`.trim();
  return name || user.email;
}

function computeClientOnline(client: {
  is_online: boolean;
  last_active: Date | null;
}): boolean {
  return isUserCurrentlyOnline({
    is_online: client.is_online,
    last_active: client.last_active,
  });
}

type SerializedSupportClient = {
  id: string;
  name: string;
  email: string;
  profileUrl: string | null;
  phone: string | null;
  jobPosition: string | null;
  companyName: string | null;
  isOnline: boolean;
  lastActive: string | null;
};

function serializeClient(client: {
  user_id: bigint;
  first_name: string;
  last_name: string;
  email: string;
  profile_url: string | null;
  contact: string | null;
  job_position: string | null;
  is_online: boolean;
  last_active: Date | null;
  company: { name: string } | null;
}): SerializedSupportClient {
  return {
    id: client.user_id.toString(),
    name: displayName(client),
    email: client.email,
    profileUrl: client.profile_url,
    phone: client.contact,
    jobPosition: client.job_position,
    companyName: client.company?.name ?? null,
    isOnline: computeClientOnline(client),
    lastActive: client.last_active?.toISOString() ?? null,
  };
}

async function findAssignedMarketingStaffId(clientUserId: bigint): Promise<bigint | null> {
  const assignment = await prisma.staffClientAssignment.findFirst({
    where: {
      client_user_id: clientUserId,
      is_active: true,
      staff: {
        role: "staff",
        staff_designation: "Marketing",
        is_active: true,
        staffProfile: { is_active: true },
      },
    },
    orderBy: [{ is_primary: "desc" }, { assigned_at: "desc" }],
    select: { staff_id: true },
  });
  return assignment?.staff_id ?? null;
}

async function isMarketingStaff(userId: bigint): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { user_id: userId },
    select: {
      role: true,
      staff_designation: true,
      staffProfile: { select: { is_active: true } },
    },
  });
  return Boolean(
    user?.role === "staff"
    && user.staff_designation === "Marketing"
    && user.staffProfile?.is_active !== false,
  );
}

async function isActiveStaffPortalUser(userId: bigint): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { user_id: userId },
    select: {
      role: true,
      is_active: true,
      staffProfile: { select: { is_active: true } },
    },
  });
  return Boolean(
    user?.role === "staff"
    && user.is_active
    && user.staffProfile?.is_active !== false,
  );
}

function isCloudinaryUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes("res.cloudinary.com");
  } catch {
    return false;
  }
}

async function validateAttachments(
  actorUserId: bigint,
  attachments: SupportAttachmentInput[],
): Promise<void> {
  if (attachments.length > MAX_ATTACHMENTS) {
    throw createSupportMessagingError(
      SupportMessagingErrorCode.TOO_MANY_ATTACHMENTS,
      `Maximum ${MAX_ATTACHMENTS} attachments per message.`,
      400,
    );
  }
  for (const att of attachments) {
    if (!isCloudinaryUrl(att.mediaUrl)) {
      throw createSupportMessagingError(
        SupportMessagingErrorCode.INVALID_ATTACHMENT,
        "Attachment URL is not allowed.",
        400,
      );
    }
    const owned = await prisma.media.findFirst({
      where: {
        user_id: actorUserId,
        related_type: "support_attachment",
        file_url: att.mediaUrl,
      },
      select: { media_id: true },
    });
    if (!owned) {
      throw createSupportMessagingError(
        SupportMessagingErrorCode.INVALID_ATTACHMENT,
        "Attachment was not uploaded for support messaging.",
        400,
      );
    }
  }
}

async function notifyRoleUsers(
  roles: string[],
  eventType: "support_message_received" | "support_escalated" | "support_resolved",
  metadata: Record<string, unknown>,
  triggerUserId?: bigint | null,
): Promise<void> {
  const users = await prisma.user.findMany({
    where: { role: { in: roles }, is_active: true },
    select: { user_id: true },
  });
  await Promise.all(
    users.map((u) =>
      createNotificationFromEvent({
        targetUserId: u.user_id,
        triggerUserId: triggerUserId ?? null,
        eventType: eventType as never,
        priority: eventType === "support_escalated" ? "high" : "medium",
        metadata,
      }).catch(() => undefined),
    ),
  );
}

function serializeConversation(conv: {
  conversation_id: bigint;
  client_user_id: bigint;
  staff_id: bigint | null;
  status: string;
  escalation_level: string;
  escalated_at: Date | null;
  resolved_at: Date | null;
  resolution_note: string | null;
  last_message_at: Date | null;
  last_message_preview: string | null;
  created_at: Date;
  client: {
    user_id: bigint;
    first_name: string;
    last_name: string;
    email: string;
    profile_url: string | null;
    contact: string | null;
    job_position: string | null;
    is_online: boolean;
    last_active: Date | null;
    company: { name: string } | null;
  };
  staff: {
    user_id: bigint;
    first_name: string;
    last_name: string;
    email: string;
    profile_url: string | null;
    job_position: string | null;
    staff_designation: string | null;
    staffProfile: { is_active: boolean } | null;
  } | null;
}) {
  return {
    id: conv.conversation_id.toString(),
    clientUserId: conv.client_user_id.toString(),
    staffId: conv.staff_id?.toString() ?? null,
    status: conv.status,
    escalationLevel: conv.escalation_level,
    escalatedAt: conv.escalated_at?.toISOString() ?? null,
    resolvedAt: conv.resolved_at?.toISOString() ?? null,
    resolutionNote: conv.resolution_note,
    lastMessageAt: conv.last_message_at?.toISOString() ?? null,
    lastMessagePreview: conv.last_message_preview,
    createdAt: conv.created_at.toISOString(),
    client: serializeClient(conv.client),
    staff: conv.staff
      ? {
          id: conv.staff.user_id.toString(),
          name: displayName(conv.staff),
          email: conv.staff.email,
          profileUrl: conv.staff.profile_url,
          position: conv.staff.job_position || conv.staff.staff_designation,
          isActive: conv.staff.staffProfile?.is_active ?? true,
        }
      : null,
    isPooled: conv.staff_id === null,
  };
}

function serializeMessage(msg: {
  message_id: bigint;
  conversation_id: bigint;
  sender_user_id: bigint;
  sender_role: string;
  body: string | null;
  message_type: string;
  escalation_target: string | null;
  created_at: Date;
  sender: { first_name: string; last_name: string; email: string };
  attachments: Array<{
    attachment_id: bigint;
    media_url: string;
    mime_type: string;
    media_kind: string;
    file_name: string | null;
    file_size: bigint | null;
  }>;
}) {
  return {
    id: msg.message_id.toString(),
    conversationId: msg.conversation_id.toString(),
    senderUserId: msg.sender_user_id.toString(),
    senderRole: msg.sender_role,
    body: msg.body,
    messageType: msg.message_type,
    escalationTarget: msg.escalation_target,
    createdAt: msg.created_at.toISOString(),
    senderName: displayName(msg.sender),
    attachments: msg.attachments.map((a) => ({
      id: a.attachment_id.toString(),
      mediaUrl: a.media_url,
      mimeType: a.mime_type,
      mediaKind: a.media_kind,
      fileName: a.file_name,
      fileSize: a.file_size?.toString() ?? null,
    })),
  };
}

const conversationInclude = {
  client: {
    select: {
      user_id: true,
      first_name: true,
      last_name: true,
      email: true,
      profile_url: true,
      contact: true,
      job_position: true,
      is_online: true,
      last_active: true,
      company: { select: { name: true } },
    },
  },
  staff: {
    select: {
      user_id: true,
      first_name: true,
      last_name: true,
      email: true,
      profile_url: true,
      job_position: true,
      staff_designation: true,
      staffProfile: { select: { is_active: true } },
    },
  },
} as const;

/** Exclude orphaned rows where support_conversations.client_user_id has no matching User. */
const withExistingSupportClient: Prisma.SupportConversationWhereInput = {
  client: {
    is: {
      user_id: { gt: BigInt(0) },
    },
  },
};

function buildStaffConversationWhere(
  staffUserId: bigint,
  clientIds: bigint[],
): Prisma.SupportConversationWhereInput {
  const assignedClientScope =
    clientIds.length > 0 ? [{ client_user_id: { in: clientIds } } as const] : [];

  return {
    AND: [
      {
        OR: [{ staff_id: null }, { staff_id: staffUserId }, ...assignedClientScope],
      },
      { status: { not: "closed" } },
      withExistingSupportClient,
    ],
  };
}

export class SupportMessagingService {
  async findConversationForClient(clientUserId: bigint) {
    const existing = await prisma.supportConversation.findUnique({
      where: { client_user_id: clientUserId },
      include: conversationInclude,
    });
    return existing ? serializeConversation(existing) : null;
  }

  async getOrCreateConversationForClient(clientUserId: bigint) {
    const existing = await prisma.supportConversation.findUnique({
      where: { client_user_id: clientUserId },
      include: conversationInclude,
    });
    if (existing) return serializeConversation(existing);

    const assignedStaffId = await findAssignedMarketingStaffId(clientUserId);
    const created = await prisma.supportConversation.create({
      data: {
        client_user_id: clientUserId,
        staff_id: assignedStaffId,
        status: "open",
        escalation_level: "none",
      },
      include: conversationInclude,
    });
    return serializeConversation(created);
  }

  async synchronizeClientAssignment(
    clientUserId: bigint,
    staffUserId: bigint | null,
    actorUserId: bigint,
  ): Promise<void> {
    const conversation = await prisma.supportConversation.findUnique({
      where: { client_user_id: clientUserId },
      select: { conversation_id: true, staff_id: true },
    });
    if (!conversation || conversation.staff_id === staffUserId) return;

    const staff = staffUserId
      ? await prisma.user.findUnique({
          where: { user_id: staffUserId },
          select: { first_name: true, last_name: true, email: true },
        })
      : null;
    const notice = staff
      ? `${displayName(staff)} is now assigned to your customer support conversation.`
      : "Your assigned support staff was removed. Customer Support will assist you.";
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.supportConversation.update({
        where: { conversation_id: conversation.conversation_id },
        data: {
          staff_id: staffUserId,
          claimed_by_staff_id: staffUserId,
          claimed_at: staffUserId ? now : null,
          last_message_at: now,
          last_message_preview: notice,
        },
      });
      await tx.supportMessage.create({
        data: {
          conversation_id: conversation.conversation_id,
          sender_user_id: actorUserId,
          sender_role: "system",
          body: notice,
          message_type: "assignment_notice",
        },
      });
    });
  }

  async assertCanAccessConversation(conversationId: bigint, actor: SupportActor) {
    const conv = await prisma.supportConversation.findFirst({
      where: {
        conversation_id: conversationId,
        ...withExistingSupportClient,
      },
      include: conversationInclude,
    });
    if (!conv) {
      throw createSupportMessagingError(
        SupportMessagingErrorCode.CONVERSATION_NOT_FOUND,
        "Conversation not found.",
        404,
      );
    }

    if (actor.role === "user") {
      if (conv.client_user_id !== actor.userId) {
        throw createSupportMessagingError(
          SupportMessagingErrorCode.FORBIDDEN,
          "You cannot access this conversation.",
          403,
        );
      }
      return conv;
    }

    if (actor.role === "staff") {
      const staffAccess = await isActiveStaffPortalUser(actor.userId);
      if (!staffAccess) {
        throw createSupportMessagingError(
          SupportMessagingErrorCode.FORBIDDEN,
          "Staff access required.",
          403,
        );
      }
      const canAccess =
        conv.staff_id === null
        || conv.staff_id === actor.userId
        || conv.claimed_by_staff_id === actor.userId;
      if (!canAccess) {
        const assigned = await prisma.staffClientAssignment.findFirst({
          where: {
            staff_id: actor.userId,
            client_user_id: conv.client_user_id,
            is_active: true,
          },
        });
        if (!assigned) {
          throw createSupportMessagingError(
            SupportMessagingErrorCode.FORBIDDEN,
            "You are not assigned to this client.",
            403,
          );
        }
      }
      return conv;
    }

    if (actor.role === "dev") {
      if (conv.escalation_level !== "dev" || conv.status === "resolved") {
        throw createSupportMessagingError(
          SupportMessagingErrorCode.FORBIDDEN,
          "This conversation is not escalated to dev.",
          403,
        );
      }
      return conv;
    }

    if (actor.role === "super_admin") {
      if (
        !["dev", "super_admin"].includes(conv.escalation_level)
        || conv.status === "resolved"
      ) {
        throw createSupportMessagingError(
          SupportMessagingErrorCode.FORBIDDEN,
          "This conversation is not escalated.",
          403,
        );
      }
      return conv;
    }

    throw createSupportMessagingError(
      SupportMessagingErrorCode.FORBIDDEN,
      "Access denied.",
      403,
    );
  }

  async listStaffConversations(staffUserId: bigint) {
    const staffAccess = await isActiveStaffPortalUser(staffUserId);
    if (!staffAccess) {
      throw createSupportMessagingError(
        SupportMessagingErrorCode.FORBIDDEN,
        "Staff access required.",
        403,
      );
    }

    const assignedClientIds = await prisma.staffClientAssignment.findMany({
      where: { staff_id: staffUserId, is_active: true },
      select: { client_user_id: true },
    });
    const clientIds = assignedClientIds.map((a) => a.client_user_id);

    const conversations = await prisma.supportConversation.findMany({
      where: buildStaffConversationWhere(staffUserId, clientIds),
      include: conversationInclude,
      orderBy: { last_message_at: "desc" },
    });

    const unreadMap = await this.getUnreadCountsForUser(staffUserId, conversations.map((c) => c.conversation_id));

    return conversations.map((conv) => ({
      ...serializeConversation(conv),
      unreadCount: unreadMap.get(conv.conversation_id.toString()) ?? 0,
    }));
  }

  async getStaffConversation(conversationId: bigint, staffUserId: bigint) {
    const conv = await this.assertCanAccessConversation(conversationId, {
      userId: staffUserId,
      role: "staff",
    });
    const unreadMap = await this.getUnreadCountsForUser(staffUserId, [conv.conversation_id]);
    return {
      ...serializeConversation(conv),
      unreadCount: unreadMap.get(conv.conversation_id.toString()) ?? 0,
    };
  }

  async listEscalatedConversations(actor: SupportActor) {
    const where: Prisma.SupportConversationWhereInput = {
      status: { in: ["escalated_dev", "escalated_super_admin", "open"] },
      escalation_level: { not: "none" },
      resolved_at: null,
    };
    if (actor.role === "dev") {
      where.escalation_level = "dev";
    } else if (actor.role === "super_admin") {
      where.escalation_level = { in: ["dev", "super_admin"] };
    } else {
      throw createSupportMessagingError(
        SupportMessagingErrorCode.FORBIDDEN,
        "Escalation inbox access denied.",
        403,
      );
    }

    const conversations = await prisma.supportConversation.findMany({
      where: {
        AND: [where, withExistingSupportClient],
      },
      include: conversationInclude,
      orderBy: { escalated_at: "desc" },
    });

    const unreadMap = await this.getUnreadCountsForUser(
      actor.userId,
      conversations.map((c) => c.conversation_id),
    );

    return conversations.map((conv) => ({
      ...serializeConversation(conv),
      unreadCount: unreadMap.get(conv.conversation_id.toString()) ?? 0,
    }));
  }

  async listMessages(
    conversationId: bigint,
    actor: SupportActor,
    options: { before?: bigint; limit?: number; q?: string } = {},
  ) {
    await this.assertCanAccessConversation(conversationId, actor);
    const limit = Math.min(options.limit ?? DEFAULT_PAGE_SIZE, 100);
    const where: Prisma.SupportMessageWhereInput = { conversation_id: conversationId };
    if (options.before) {
      where.message_id = { lt: options.before };
    }
    if (options.q?.trim()) {
      where.body = { contains: options.q.trim() };
    }

    const messages = await prisma.supportMessage.findMany({
      where,
      include: {
        sender: { select: { first_name: true, last_name: true, email: true } },
        attachments: true,
      },
      orderBy: { created_at: "desc" },
      take: limit,
    });

    await this.markConversationRead(conversationId, actor.userId, messages[0]?.message_id ?? null);

    return messages.reverse().map(serializeMessage);
  }

  async sendMessage(
    conversationId: bigint,
    actor: SupportActor,
    input: { body?: string; attachments?: SupportAttachmentInput[] },
  ) {
    const conv = await this.assertCanAccessConversation(conversationId, actor);
    if (actor.role === "staff" && conv.escalation_level !== "none") {
      throw createSupportMessagingError(
        SupportMessagingErrorCode.FORBIDDEN,
        "This conversation has been escalated and is no longer available for staff replies.",
        403,
      );
    }
    if (conv.status === "resolved" || conv.status === "closed") {
      throw createSupportMessagingError(
        SupportMessagingErrorCode.CONVERSATION_CLOSED,
        "This conversation is closed.",
        400,
      );
    }

    const body = stripHtml(input.body ?? "");
    const attachments = input.attachments ?? [];
    if (!body && attachments.length === 0) {
      throw createSupportMessagingError(
        SupportMessagingErrorCode.INVALID_PAYLOAD,
        "Message body or attachment is required.",
        400,
      );
    }
    if (body.length > MAX_MESSAGE_LENGTH) {
      throw createSupportMessagingError(
        SupportMessagingErrorCode.MESSAGE_TOO_LONG,
        `Message must be at most ${MAX_MESSAGE_LENGTH} characters.`,
        400,
      );
    }
    await validateAttachments(actor.userId, attachments);

    const now = new Date();
    const message = await prisma.$transaction(async (tx) => {
      let staffId = conv.staff_id;
      let claimedBy = conv.claimed_by_staff_id;
      let claimedAt = conv.claimed_at;

      if (actor.role === "staff" && conv.staff_id === null) {
        staffId = actor.userId;
        claimedBy = actor.userId;
        claimedAt = now;
        const claimingStaff = await tx.user.findUnique({
          where: { user_id: actor.userId },
          select: { first_name: true, last_name: true, email: true },
        });
        if (claimingStaff) {
          await tx.supportMessage.create({
            data: {
              conversation_id: conversationId,
              sender_user_id: actor.userId,
              sender_role: "system",
              body: `${displayName(claimingStaff)} is now assigned to your customer support conversation.`,
              message_type: "assignment_notice",
            },
          });
        }
      }

      const created = await tx.supportMessage.create({
        data: {
          conversation_id: conversationId,
          sender_user_id: actor.userId,
          sender_role: actor.role,
          body: body || null,
          message_type: "text",
          attachments: {
            create: attachments.map((a) => ({
              media_url: a.mediaUrl,
              mime_type: a.mimeType,
              media_kind: a.mediaKind,
              file_name: a.fileName ?? null,
              file_size: a.fileSize ? BigInt(a.fileSize) : null,
            })),
          },
        },
        include: {
          sender: { select: { first_name: true, last_name: true, email: true } },
          attachments: true,
        },
      });

      await tx.supportConversation.update({
        where: { conversation_id: conversationId },
        data: {
          staff_id: staffId,
          claimed_by_staff_id: claimedBy,
          claimed_at: claimedAt,
          last_message_at: now,
          last_message_preview: previewText(body || `[${attachments[0]?.mediaKind ?? "attachment"}]`),
          updated_at: now,
        },
      });

      await tx.supportParticipantReadState.upsert({
        where: {
          conversation_id_user_id: {
            conversation_id: conversationId,
            user_id: actor.userId,
          },
        },
        create: {
          conversation_id: conversationId,
          user_id: actor.userId,
          last_read_at: now,
          last_read_message_id: created.message_id,
        },
        update: {
          last_read_at: now,
          last_read_message_id: created.message_id,
        },
      });

      return created;
    });

    const targets: bigint[] = [];
    if (actor.role === "user") {
      if (conv.escalation_level !== "none") {
        const roles =
          conv.escalation_level === "dev"
            ? ["dev"]
            : conv.escalation_level === "super_admin"
              ? ["super_admin"]
              : ["dev", "super_admin"];
        await notifyRoleUsers(
          roles,
          "support_message_received",
          {
            conversationId: conversationId.toString(),
            messageId: message.message_id.toString(),
          },
          actor.userId,
        );
      } else if (conv.staff_id) {
        targets.push(conv.staff_id);
      } else {
        const staffUsers = await prisma.user.findMany({
          where: { role: "staff", staff_designation: "Marketing", is_active: true },
          select: { user_id: true },
        });
        targets.push(...staffUsers.map((s) => s.user_id));
      }
    } else {
      targets.push(conv.client_user_id);
    }

    if (targets.length > 0) {
      await Promise.all(
        targets.map((targetUserId) =>
          createNotificationFromEvent({
            targetUserId,
            triggerUserId: actor.userId,
            eventType: "support_message_received" as never,
            priority: "high",
            metadata: {
              conversationId: conversationId.toString(),
              messageId: message.message_id.toString(),
            },
          }).catch(() => undefined),
        ),
      );
    }

    return serializeMessage(message);
  }

  async escalateConversation(
    conversationId: bigint,
    staffUserId: bigint,
    target: EscalationTarget,
  ) {
    const conv = await this.assertCanAccessConversation(conversationId, {
      userId: staffUserId,
      role: "staff",
    });
    if (conv.status === "resolved" || conv.escalation_level !== "none") {
      throw createSupportMessagingError(
        SupportMessagingErrorCode.ESCALATION_NOT_ALLOWED,
        "Conversation cannot be escalated.",
        400,
      );
    }

    const now = new Date();
    const status = target === "dev" ? "escalated_dev" : "escalated_super_admin";
    const systemBody =
      target === "dev"
        ? "This conversation was escalated to the Development team."
        : "This conversation was escalated to Super Admin.";

    await prisma.$transaction(async (tx) => {
      await tx.supportConversation.update({
        where: { conversation_id: conversationId },
        data: {
          status,
          escalation_level: target,
          escalated_at: now,
          escalated_by_staff_id: staffUserId,
          last_message_at: now,
          last_message_preview: systemBody,
        },
      });
      await tx.supportMessage.create({
        data: {
          conversation_id: conversationId,
          sender_user_id: staffUserId,
          sender_role: "system",
          body: systemBody,
          message_type: "escalation_notice",
          escalation_target: target,
        },
      });
      await tx.staffMarketingActivity.create({
        data: {
          staff_id: staffUserId,
          client_id: conv.client_user_id,
          action_type: "support_escalated",
          description: `Escalated support conversation to ${target}`,
          metadata: toJsonString({ conversationId: conversationId.toString(), target }),
        },
      });
    });

    await createNotificationFromEvent({
      targetUserId: conv.client_user_id,
      triggerUserId: staffUserId,
      eventType: "support_escalated" as never,
      priority: "high",
      metadata: { conversationId: conversationId.toString(), target },
    }).catch(() => undefined);

    await notifyRoleUsers(
      target === "dev" ? ["dev"] : ["super_admin"],
      "support_escalated",
      { conversationId: conversationId.toString(), target },
      staffUserId,
    );

    const updated = await prisma.supportConversation.findUnique({
      where: { conversation_id: conversationId },
      include: conversationInclude,
    });
    return updated ? serializeConversation(updated) : null;
  }

  /**
   * Escalate a client support conversation to Dev for a custom theme request.
   * Safe to call from the marketplace theme-request pipeline (no staff actor).
   */
  async escalateCustomThemeRequestToDev(
    conversationId: bigint,
    clientUserId: bigint,
    referenceNumber: string,
  ) {
    const conv = await prisma.supportConversation.findUnique({
      where: { conversation_id: conversationId },
    });
    if (!conv || conv.client_user_id !== clientUserId) {
      return null;
    }

    const now = new Date();
    const systemBody = `Custom theme request ${referenceNumber} was paid and escalated to the Development team for design follow-up.`;

    // Do not downgrade an existing super_admin escalation.
    const keepSuperAdmin = conv.escalation_level === "super_admin";
    const status = keepSuperAdmin
      ? "escalated_super_admin"
      : "escalated_dev";
    const escalationLevel = keepSuperAdmin ? "super_admin" : "dev";

    await prisma.$transaction(async (tx) => {
      await tx.supportConversation.update({
        where: { conversation_id: conversationId },
        data: {
          status,
          escalation_level: escalationLevel,
          escalated_at: conv.escalated_at ?? now,
          last_message_at: now,
          last_message_preview: systemBody,
          resolved_at: null,
          resolution_note: null,
        },
      });
      await tx.supportMessage.create({
        data: {
          conversation_id: conversationId,
          sender_user_id: clientUserId,
          sender_role: "system",
          body: systemBody,
          message_type: "escalation_notice",
          escalation_target: escalationLevel,
        },
      });
    });

    await createNotificationFromEvent({
      targetUserId: clientUserId,
      triggerUserId: null,
      eventType: "support_escalated" as never,
      priority: "high",
      metadata: {
        conversationId: conversationId.toString(),
        target: escalationLevel,
        referenceNumber,
        source: "custom_theme_request",
      },
    }).catch(() => undefined);

    await notifyRoleUsers(
      keepSuperAdmin ? ["super_admin", "dev"] : ["dev"],
      "support_escalated",
      {
        conversationId: conversationId.toString(),
        target: escalationLevel,
        referenceNumber,
        source: "custom_theme_request",
      },
      clientUserId,
    );

    const updated = await prisma.supportConversation.findUnique({
      where: { conversation_id: conversationId },
      include: conversationInclude,
    });
    return updated ? serializeConversation(updated) : null;
  }

  async assignConversationToStaff(conversationId: bigint, staffUserId: bigint) {
    const conv = await prisma.supportConversation.findUnique({
      where: { conversation_id: conversationId },
      select: {
        conversation_id: true,
        client_user_id: true,
        staff_id: true,
        client: { select: { user_id: true } },
      },
    });

    if (!conv) {
      throw createSupportMessagingError(
        SupportMessagingErrorCode.CONVERSATION_NOT_FOUND,
        "Conversation not found.",
        404,
      );
    }

    if (!conv.client) {
      throw createSupportMessagingError(
        SupportMessagingErrorCode.CONVERSATION_NOT_FOUND,
        "Conversation client data is missing.",
        404,
      );
    }

    if (conv.staff_id !== null) {
      throw createSupportMessagingError(
        SupportMessagingErrorCode.FORBIDDEN,
        "This conversation is already assigned.",
        403,
      );
    }

    const now = new Date();
    const assignedStaff = await prisma.user.findUnique({
      where: { user_id: staffUserId },
      select: { first_name: true, last_name: true, email: true },
    });
    await prisma.$transaction(async (tx) => {
      await tx.supportConversation.update({
        where: { conversation_id: conversationId },
        data: {
          staff_id: staffUserId,
          claimed_by_staff_id: staffUserId,
          claimed_at: now,
        },
      });

      await tx.staffClientAssignment.upsert({
        where: {
          staff_id_client_user_id: {
            staff_id: staffUserId,
            client_user_id: conv.client_user_id,
          },
        },
        update: {
          is_active: true,
          assigned_at: now,
        },
        create: {
          staff_id: staffUserId,
          client_user_id: conv.client_user_id,
          is_active: true,
          is_primary: true,
          assigned_at: now,
        },
      });
      if (assignedStaff) {
        const notice = `${displayName(assignedStaff)} is now assigned to your customer support conversation.`;
        await tx.supportMessage.create({
          data: {
            conversation_id: conversationId,
            sender_user_id: staffUserId,
            sender_role: "system",
            body: notice,
            message_type: "assignment_notice",
          },
        });
        await tx.supportConversation.update({
          where: { conversation_id: conversationId },
          data: { last_message_at: now, last_message_preview: notice },
        });
      }
    });

    const updated = await prisma.supportConversation.findUnique({
      where: { conversation_id: conversationId },
      include: conversationInclude,
    });
    return updated ? serializeConversation(updated) : null;
  }

  async resolveConversation(
    conversationId: bigint,
    resolver: SupportActor,
    note?: string,
  ) {
    if (resolver.role !== "dev" && resolver.role !== "super_admin") {
      throw createSupportMessagingError(
        SupportMessagingErrorCode.RESOLUTION_NOT_ALLOWED,
        "Only dev or super admin can resolve escalations.",
        403,
      );
    }

    const conv = await this.assertCanAccessConversation(conversationId, resolver);
    if (conv.escalation_level === "none" || conv.status === "resolved") {
      throw createSupportMessagingError(
        SupportMessagingErrorCode.RESOLUTION_NOT_ALLOWED,
        "Conversation cannot be resolved.",
        400,
      );
    }

    const now = new Date();
    const resolutionNote = stripHtml(note ?? "") || null;
    const systemBody = resolutionNote
      ? `This issue has been marked as fixed. Note: ${resolutionNote}`
      : "This issue has been marked as fixed.";

    await prisma.$transaction(async (tx) => {
      await tx.supportConversation.update({
        where: { conversation_id: conversationId },
        data: {
          status: "resolved",
          resolved_at: now,
          resolved_by_user_id: resolver.userId,
          resolution_note: resolutionNote,
          last_message_at: now,
          last_message_preview: systemBody,
        },
      });
      await tx.supportMessage.create({
        data: {
          conversation_id: conversationId,
          sender_user_id: resolver.userId,
          sender_role: resolver.role,
          body: systemBody,
          message_type: "resolution_notice",
        },
      });
    });

    const notifyTargets = [conv.client_user_id];
    if (conv.staff_id) notifyTargets.push(conv.staff_id);
    await Promise.all(
      notifyTargets.map((targetUserId) =>
        createNotificationFromEvent({
          targetUserId,
          triggerUserId: resolver.userId,
          eventType: "support_resolved" as never,
          priority: "medium",
          metadata: { conversationId: conversationId.toString() },
        }).catch(() => undefined),
      ),
    );

    const updated = await prisma.supportConversation.findUnique({
      where: { conversation_id: conversationId },
      include: conversationInclude,
    });
    return updated ? serializeConversation(updated) : null;
  }

  async getUnreadCountForActor(actor: SupportActor): Promise<number> {
    if (actor.role === "user") {
      const conv = await prisma.supportConversation.findUnique({
        where: { client_user_id: actor.userId },
      });
      if (!conv) return 0;
      return this.countUnreadForConversation(conv.conversation_id, actor.userId);
    }
    if (actor.role === "staff") {
      const convs = await this.listStaffConversations(actor.userId);
      return convs.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0);
    }
    const escalated = await this.listEscalatedConversations(actor);
    return escalated.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0);
  }

  private async getUnreadCountsForUser(userId: bigint, conversationIds: bigint[]) {
    const map = new Map<string, number>();
    await Promise.all(
      conversationIds.map(async (id) => {
        const count = await this.countUnreadForConversation(id, userId);
        map.set(id.toString(), count);
      }),
    );
    return map;
  }

  private async countUnreadForConversation(conversationId: bigint, userId: bigint) {
    const readState = await prisma.supportParticipantReadState.findUnique({
      where: {
        conversation_id_user_id: { conversation_id: conversationId, user_id: userId },
      },
    });
    const where: Prisma.SupportMessageWhereInput = {
      conversation_id: conversationId,
      sender_user_id: { not: userId },
    };
    if (readState?.last_read_message_id) {
      where.message_id = { gt: readState.last_read_message_id };
    }
    return prisma.supportMessage.count({ where });
  }

  private async markConversationRead(
    conversationId: bigint,
    userId: bigint,
    lastMessageId: bigint | null,
  ) {
    if (!lastMessageId) return;
    await prisma.supportParticipantReadState.upsert({
      where: {
        conversation_id_user_id: { conversation_id: conversationId, user_id: userId },
      },
      create: {
        conversation_id: conversationId,
        user_id: userId,
        last_read_message_id: lastMessageId,
      },
      update: {
        last_read_at: new Date(),
        last_read_message_id: lastMessageId,
      },
    });
  }
}
