import { prisma } from "@/server/lib/prisma";
import {
  ConnectionMessagingErrorCode,
  createConnectionMessagingError,
} from "@/lib/errors/connection-messaging-errors";
import {
  decryptStoredMessageBody,
  encryptMessage,
} from "@/lib/messaging-encryption";
import {
  formatTimeAgo,
  isBlockedEitherDirection,
} from "@/server/lib/connections";
import { isUserCurrentlyOnline } from "@/server/lib/user-presence";
import { createNotificationFromEvent } from "@/server/lib/notifications";
import { isOwnR2Url } from "@/server/lib/r2-storage";
import { getPrimaryAdminUserId } from "@/server/lib/company-themes";
import { isCoAdminMember } from "@/server/lib/company";

const MAX_MESSAGE_LENGTH = 4000;
const MAX_ATTACHMENTS = 5;
const DEFAULT_PAGE_SIZE = 50;

const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/jpg"]);
const ALLOWED_VIDEO_MIME = new Set(["video/mp4", "video/webm"]);

export interface DirectAttachmentInput {
  mediaUrl: string;
  mimeType: string;
  mediaKind: "image" | "video";
  fileName?: string;
  fileSize?: number;
}

export interface AssociateCardSnapshot {
  version: "associate_card_v1";
  userId: string;
  name: string;
  role: string;
  position: string | null;
  profileUrl: string | null;
  coverUrl: string | null;
  portfolioUrl: string;
}

type DirectMessageMetadata = {
  associateCard?: AssociateCardSnapshot;
};

/** Canonical ordered pair so each user pair has exactly one conversation row. */
export function orderedUserPair(a: bigint, b: bigint): { low: bigint; high: bigint } {
  return a < b ? { low: a, high: b } : { low: b, high: a };
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "").trim();
}

function previewText(body: string | null | undefined, attachments: DirectAttachmentInput[]): string {
  const clean = (body ?? "").replace(/\s+/g, " ").trim();
  if (clean) return clean.length > 200 ? `${clean.slice(0, 197)}...` : clean;
  if (attachments.length > 0) {
    const kind = attachments[0].mediaKind;
    return kind === "video" ? "[Video]" : "[Image]";
  }
  return "";
}

export function parseDirectMessageMetadata(
  raw: string | null | undefined,
): DirectMessageMetadata | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DirectMessageMetadata;
    const card = parsed?.associateCard;
    if (
      card?.version !== "associate_card_v1"
      || typeof card.userId !== "string"
      || !/^\d{1,20}$/.test(card.userId)
      || typeof card.name !== "string"
      || !card.name.trim()
      || typeof card.role !== "string"
      || (card.position !== null && typeof card.position !== "string")
      || (card.profileUrl !== null && typeof card.profileUrl !== "string")
      || (card.coverUrl !== null && typeof card.coverUrl !== "string")
      || typeof card.portfolioUrl !== "string"
      || !/^(?:\/|https:\/\/)/i.test(card.portfolioUrl)
    ) return null;
    return { associateCard: card };
  } catch {
    return null;
  }
}

function displayName(user: { first_name: string; last_name: string; email: string }): string {
  const name = `${user.first_name} ${user.last_name}`.trim();
  return name || user.email;
}

function isOnlineFromActivity(lastActive: Date | null, userIsOnline?: boolean): boolean {
  return isUserCurrentlyOnline({
    is_online: userIsOnline,
    last_active: lastActive,
  });
}

function resolveMessageType(body: string, attachments: DirectAttachmentInput[]): string {
  if (attachments.length === 0) return "text";
  const hasImage = attachments.some((a) => a.mediaKind === "image");
  const hasVideo = attachments.some((a) => a.mediaKind === "video");
  if (body && (hasImage || hasVideo)) return "mixed";
  if (hasImage && hasVideo) return "mixed";
  if (hasVideo) return "video";
  return "image";
}

function isAllowedAttachmentUrl(url: string): boolean {
  if (isOwnR2Url(url)) return true;
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes("res.cloudinary.com");
  } catch {
    return false;
  }
}

async function validateAttachments(
  actorUserId: bigint,
  attachments: DirectAttachmentInput[],
): Promise<void> {
  if (attachments.length > MAX_ATTACHMENTS) {
    throw createConnectionMessagingError(
      ConnectionMessagingErrorCode.TOO_MANY_ATTACHMENTS,
      `Maximum ${MAX_ATTACHMENTS} attachments per message.`,
      400,
    );
  }
  for (const att of attachments) {
    const mime = att.mimeType.toLowerCase();
    const kindOk =
      (att.mediaKind === "image" && ALLOWED_IMAGE_MIME.has(mime))
      || (att.mediaKind === "video" && ALLOWED_VIDEO_MIME.has(mime));
    if (!kindOk) {
      throw createConnectionMessagingError(
        ConnectionMessagingErrorCode.INVALID_ATTACHMENT,
        "Only JPEG, PNG, GIF images and MP4/WebM videos are allowed.",
        400,
      );
    }
    if (!isAllowedAttachmentUrl(att.mediaUrl)) {
      throw createConnectionMessagingError(
        ConnectionMessagingErrorCode.INVALID_ATTACHMENT,
        "Attachment URL is not allowed.",
        400,
      );
    }
    const owned = await prisma.media.findFirst({
      where: {
        user_id: actorUserId,
        related_type: { in: ["messaging", "messaging_attachment"] },
        file_url: att.mediaUrl,
      },
      select: { media_id: true },
    });
    if (!owned) {
      throw createConnectionMessagingError(
        ConnectionMessagingErrorCode.INVALID_ATTACHMENT,
        "Attachment was not uploaded for messaging.",
        400,
      );
    }
  }
}

function serializeAttachment(att: {
  attachment_id: bigint;
  media_url: string;
  mime_type: string;
  media_kind: string;
  file_name: string | null;
  file_size: bigint | null;
}) {
  return {
    id: att.attachment_id.toString(),
    mediaUrl: att.media_url,
    mimeType: att.mime_type,
    mediaKind: att.media_kind === "video" ? "video" as const : "image" as const,
    fileName: att.file_name,
    fileSize: att.file_size?.toString() ?? null,
  };
}

function serializeMessage(
  msg: {
    message_id: bigint;
    conversation_id: bigint;
    sender_user_id: bigint;
    body: string | null;
    message_type: string;
    metadata: string | null;
    unsent_at?: Date | null;
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
  },
  options: {
    viewerId: bigint;
    peerLastReadMessageId?: bigint | null;
  },
) {
  const unsent = Boolean(msg.unsent_at);
  const seen =
    !unsent
    && msg.sender_user_id === options.viewerId
    && options.peerLastReadMessageId != null
    && options.peerLastReadMessageId >= msg.message_id;

  return {
    id: msg.message_id.toString(),
    conversationId: msg.conversation_id.toString(),
    senderUserId: msg.sender_user_id.toString(),
    body: unsent ? null : decryptStoredMessageBody(msg.body),
    messageType: unsent ? "unsent" : msg.message_type,
    metadata: unsent ? null : parseDirectMessageMetadata(msg.metadata),
    createdAt: msg.created_at.toISOString(),
    senderName: displayName(msg.sender),
    attachments: unsent ? [] : msg.attachments.map(serializeAttachment),
    unsent,
    seen,
  };
}

function resolveLastMessagePreview(storedPreview: string | null | undefined): string {
  const trimmed = storedPreview?.trim();
  if (!trimmed) return "No messages yet";
  return decryptStoredMessageBody(trimmed) ?? "No messages yet";
}

export class ConnectionMessagingService {
  private async resolveActiveCompanyId(userId: bigint): Promise<bigint | null> {
    const user = await prisma.user.findUnique({
      where: { user_id: userId },
      select: { company_id: true },
    });
    if (user?.company_id) return user.company_id;

    const employment = await prisma.companyEmployee.findFirst({
      where: { user_id: userId, is_active: true },
      select: { company_id: true },
    });
    return employment?.company_id ?? null;
  }

  /**
   * Company messaging (no Associates connection required):
   * - Primary / co-admins may message all company members (employees + co-admins).
   * - Employees may message the main admin and co-admins.
   * Employee ↔ employee stays blocked unless they are Associates.
   */
  private async canMessageCompanyPeer(
    viewerId: bigint,
    peerId: bigint,
  ): Promise<boolean> {
    const viewerCompanyId = await this.resolveActiveCompanyId(viewerId);
    if (!viewerCompanyId) return false;

    const peerCompanyId = await this.resolveActiveCompanyId(peerId);
    if (!peerCompanyId || peerCompanyId !== viewerCompanyId) return false;

    const { primaryAdminId, coAdminIds } = await this.getCompanyAdminIds(viewerCompanyId);
    if (!primaryAdminId && coAdminIds.length === 0) return false;

    const viewerIsPrimary = primaryAdminId !== null && primaryAdminId === viewerId;
    const peerIsPrimary = primaryAdminId !== null && primaryAdminId === peerId;
    const viewerIsCoAdmin = coAdminIds.some((id) => id === viewerId);
    const peerIsCoAdmin = coAdminIds.some((id) => id === peerId);

    // Admin tier (primary or co-admin) on either side unlocks company DM.
    return viewerIsPrimary || peerIsPrimary || viewerIsCoAdmin || peerIsCoAdmin;
  }

  private async getCompanyAdminIds(companyId: bigint): Promise<{
    primaryAdminId: bigint | null;
    coAdminIds: bigint[];
  }> {
    const primaryAdminId = await getPrimaryAdminUserId(companyId);
    const adminMembers = await prisma.companyEmployee.findMany({
      where: {
        company_id: companyId,
        is_active: true,
        role: "admin",
      },
      select: { user_id: true, role: true },
    });

    const coAdminIds = adminMembers
      .filter((row) => isCoAdminMember(row.role, row.user_id, primaryAdminId))
      .map((row) => row.user_id);

    return { primaryAdminId, coAdminIds };
  }

  /** Peers the viewer may open via company membership (excluding self). */
  private async listEligibleCompanyPeerIds(viewerId: bigint): Promise<bigint[]> {
    const companyId = await this.resolveActiveCompanyId(viewerId);
    if (!companyId) return [];

    const { primaryAdminId, coAdminIds } = await this.getCompanyAdminIds(companyId);
    const members = await prisma.companyEmployee.findMany({
      where: { company_id: companyId, is_active: true },
      select: { user_id: true },
    });

    const memberIds = new Set<bigint>(members.map((m) => m.user_id));
    if (primaryAdminId) memberIds.add(primaryAdminId);

    const viewerIsPrimary = primaryAdminId !== null && primaryAdminId === viewerId;
    const viewerIsCoAdmin = coAdminIds.some((id) => id === viewerId);

    if (viewerIsPrimary || viewerIsCoAdmin) {
      return [...memberIds].filter((id) => id !== viewerId);
    }

    // Employees: main admin + co-admins only.
    const adminTier = new Set<bigint>(coAdminIds);
    if (primaryAdminId) adminTier.add(primaryAdminId);
    return [...adminTier].filter((id) => id !== viewerId);
  }

  async assertCanMessage(viewerId: bigint, peerId: bigint): Promise<void> {
    if (viewerId === peerId) {
      throw createConnectionMessagingError(
        ConnectionMessagingErrorCode.INVALID_PAYLOAD,
        "Cannot message yourself.",
        400,
      );
    }
    if (await isBlockedEitherDirection(viewerId, peerId)) {
      throw createConnectionMessagingError(
        ConnectionMessagingErrorCode.BLOCKED,
        "Messaging is not available with this user.",
        403,
      );
    }
    const connection = await prisma.connection.findFirst({
      where: {
        status: "accepted",
        OR: [
          { requester_user_id: viewerId, recipient_user_id: peerId },
          { requester_user_id: peerId, recipient_user_id: viewerId },
        ],
      },
      select: { connect_id: true },
    });
    if (connection) return;

    if (await this.canMessageCompanyPeer(viewerId, peerId)) return;

    // Portfolio inquiry senders with accounts can be messaged by the recipient.
    if (await this.canMessageInquiryPeer(viewerId, peerId)) return;

    throw createConnectionMessagingError(
      ConnectionMessagingErrorCode.NOT_CONNECTED,
      "You can only message accepted connections.",
      403,
    );
  }

  /** True when either user previously sent a portfolio inquiry to the other. */
  private async canMessageInquiryPeer(viewerId: bigint, peerId: bigint): Promise<boolean> {
    const inquiry = await prisma.inquiry.findFirst({
      where: {
        OR: [
          { user_id: viewerId, sender_user_id: peerId },
          { user_id: peerId, sender_user_id: viewerId },
        ],
      },
      select: { inquiry_id: true },
    });
    return Boolean(inquiry);
  }

  async getOrCreateConversation(userA: bigint, userB: bigint) {
    await this.assertCanMessage(userA, userB);
    const { low, high } = orderedUserPair(userA, userB);
    const existing = await prisma.directConversation.findUnique({
      where: { user_low_id_user_high_id: { user_low_id: low, user_high_id: high } },
    });
    if (existing) return existing;
    return prisma.directConversation.create({
      data: { user_low_id: low, user_high_id: high },
    });
  }

  private peerIdFromConversation(
    conv: { user_low_id: bigint; user_high_id: bigint },
    viewerId: bigint,
  ): bigint {
    return conv.user_low_id === viewerId ? conv.user_high_id : conv.user_low_id;
  }

  async listConversationsForUser(viewerId: bigint) {
    const edges = await prisma.connection.findMany({
      where: {
        status: "accepted",
        OR: [{ requester_user_id: viewerId }, { recipient_user_id: viewerId }],
      },
      select: {
        requester_user_id: true,
        recipient_user_id: true,
      },
    });

    const peerIdSet = new Set<bigint>(
      edges.map((e) =>
        e.requester_user_id === viewerId ? e.recipient_user_id : e.requester_user_id,
      ),
    );

    // Include existing company threads even without an Associates link.
    const existingCompanyThreads = await prisma.directConversation.findMany({
      where: {
        OR: [{ user_low_id: viewerId }, { user_high_id: viewerId }],
      },
      select: { user_low_id: true, user_high_id: true },
    });
    for (const conv of existingCompanyThreads) {
      const peerId =
        conv.user_low_id === viewerId ? conv.user_high_id : conv.user_low_id;
      if (peerIdSet.has(peerId)) continue;
      if (await this.canMessageCompanyPeer(viewerId, peerId)) {
        peerIdSet.add(peerId);
      }
    }

    // Surface eligible company peers (admins ↔ employees/co-admins) even with no prior thread.
    for (const companyPeerId of await this.listEligibleCompanyPeerIds(viewerId)) {
      peerIdSet.add(companyPeerId);
    }

    const peerIds = [...peerIdSet];
    if (peerIds.length === 0) return [];

    const conversations = await prisma.directConversation.findMany({
      where: {
        OR: [
          { user_low_id: viewerId, user_high_id: { in: peerIds } },
          { user_high_id: viewerId, user_low_id: { in: peerIds } },
        ],
      },
    });
    const convByPeer = new Map<string, (typeof conversations)[number]>();
    for (const conv of conversations) {
      const peerId = this.peerIdFromConversation(conv, viewerId);
      convByPeer.set(peerId.toString(), conv);
    }

    const peers = await prisma.user.findMany({
      where: { user_id: { in: peerIds } },
      select: {
        user_id: true,
        first_name: true,
        last_name: true,
        email: true,
        profile_url: true,
        job_position: true,
        is_online: true,
        company: { select: { name: true } },
        userActivity: { select: { last_active: true } },
      },
    });

    const unreadMap = await this.getUnreadCountsForUser(
      viewerId,
      conversations.map((c) => c.conversation_id),
    );

    const rows = peers.map((peer) => {
      const conv = convByPeer.get(peer.user_id.toString()) ?? null;
      const lastActive = peer.userActivity?.last_active ?? null;
      const online = isOnlineFromActivity(lastActive, peer.is_online);
      return {
        conversationId: conv?.conversation_id.toString() ?? null,
        peerUserId: peer.user_id.toString(),
        peer: {
          id: peer.user_id.toString(),
          name: displayName(peer),
          email: peer.email,
          profileUrl: peer.profile_url,
          jobPosition: peer.job_position,
          companyName: peer.company?.name ?? null,
          isOnline: online,
          lastActive: lastActive?.toISOString() ?? null,
          lastActiveLabel: online
            ? "Active"
            : lastActive
              ? `Last active ${formatTimeAgo(lastActive)}`
              : "Last active unknown",
        },
        lastMessageAt: conv?.last_message_at?.toISOString() ?? null,
        lastMessagePreview: resolveLastMessagePreview(conv?.last_message_preview),
        unreadCount: conv ? (unreadMap.get(conv.conversation_id.toString()) ?? 0) : 0,
        hasMessages: Boolean(conv?.last_message_at),
      };
    });

    rows.sort((a, b) => {
      const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      if (bt !== at) return bt - at;
      return a.peer.name.localeCompare(b.peer.name);
    });

    return rows;
  }

  async getConversationWithPeer(viewerId: bigint, peerId: bigint) {
    const conv = await this.getOrCreateConversation(viewerId, peerId);
    const peer = await prisma.user.findUnique({
      where: { user_id: peerId },
      select: {
        user_id: true,
        first_name: true,
        last_name: true,
        email: true,
        profile_url: true,
        job_position: true,
        is_online: true,
        company: { select: { name: true } },
        userActivity: { select: { last_active: true } },
      },
    });
    if (!peer) {
      throw createConnectionMessagingError(
        ConnectionMessagingErrorCode.CONVERSATION_NOT_FOUND,
        "Peer user not found.",
        404,
      );
    }
    const lastActive = peer.userActivity?.last_active ?? null;
    const online = isOnlineFromActivity(lastActive, peer.is_online);
    const unreadMap = await this.getUnreadCountsForUser(viewerId, [conv.conversation_id]);
    return {
      conversationId: conv.conversation_id.toString(),
      peerUserId: peerId.toString(),
      peer: {
        id: peer.user_id.toString(),
        name: displayName(peer),
        email: peer.email,
        profileUrl: peer.profile_url,
        jobPosition: peer.job_position,
        companyName: peer.company?.name ?? null,
        isOnline: online,
        lastActive: lastActive?.toISOString() ?? null,
        lastActiveLabel: online
          ? "Active"
          : lastActive
            ? `Last active ${formatTimeAgo(lastActive)}`
            : "Last active unknown",
      },
      lastMessageAt: conv.last_message_at?.toISOString() ?? null,
      lastMessagePreview: resolveLastMessagePreview(conv.last_message_preview),
      unreadCount: unreadMap.get(conv.conversation_id.toString()) ?? 0,
      hasMessages: Boolean(conv.last_message_at),
    };
  }

  async listMessages(
    viewerId: bigint,
    peerId: bigint,
    options: { before?: bigint; limit?: number } = {},
  ) {
    const conv = await this.getOrCreateConversation(viewerId, peerId);
    const limit = Math.min(options.limit ?? DEFAULT_PAGE_SIZE, 100);
    const where: {
      conversation_id: bigint;
      message_id?: { lt: bigint };
      hides: { none: { user_id: bigint } };
    } = {
      conversation_id: conv.conversation_id,
      hides: { none: { user_id: viewerId } },
    };
    if (options.before) {
      where.message_id = { lt: options.before };
    }

    const [messages, peerRead] = await Promise.all([
      prisma.directMessage.findMany({
        where,
        include: {
          sender: { select: { first_name: true, last_name: true, email: true } },
          attachments: true,
        },
        orderBy: { created_at: "desc" },
        take: limit,
      }),
      prisma.directParticipantReadState.findUnique({
        where: {
          conversation_id_user_id: {
            conversation_id: conv.conversation_id,
            user_id: peerId,
          },
        },
        select: { last_read_message_id: true },
      }),
    ]);

    await this.markConversationRead(conv.conversation_id, viewerId, messages[0]?.message_id ?? null);

    const peerLastReadMessageId = peerRead?.last_read_message_id ?? null;
    return {
      conversationId: conv.conversation_id.toString(),
      messages: messages.reverse().map((msg) =>
        serializeMessage(msg, { viewerId, peerLastReadMessageId }),
      ),
    };
  }

  async sendMessage(
    viewerId: bigint,
    peerId: bigint,
    input: {
      body?: string;
      attachments?: DirectAttachmentInput[];
      sharedAssociateUserId?: bigint;
    },
  ) {
    const conv = await this.getOrCreateConversation(viewerId, peerId);
    const body = stripHtml(input.body ?? "");
    const attachments = input.attachments ?? [];
    const associateCard = input.sharedAssociateUserId
      ? await this.buildAssociateCardSnapshot(viewerId, peerId, input.sharedAssociateUserId)
      : null;
    if (!body && attachments.length === 0 && !associateCard) {
      throw createConnectionMessagingError(
        ConnectionMessagingErrorCode.INVALID_PAYLOAD,
        "Message body or attachment is required.",
        400,
      );
    }
    if (body.length > MAX_MESSAGE_LENGTH) {
      throw createConnectionMessagingError(
        ConnectionMessagingErrorCode.MESSAGE_TOO_LONG,
        `Message must be at most ${MAX_MESSAGE_LENGTH} characters.`,
        400,
      );
    }
    await validateAttachments(viewerId, attachments);

    const now = new Date();
    const messageType = associateCard ? "associate_card" : resolveMessageType(body, attachments);
    const preview = associateCard
      ? `${body ? `${body} · ` : ""}Shared ${associateCard.name}`
      : previewText(body, attachments);
    const encryptedBody = body ? encryptMessage(body) : null;
    const encryptedPreview = preview ? encryptMessage(preview) : "";
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.directMessage.create({
        data: {
          conversation_id: conv.conversation_id,
          sender_user_id: viewerId,
          body: encryptedBody,
          message_type: messageType,
          metadata: associateCard ? JSON.stringify({ associateCard }) : null,
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

      await tx.directConversation.update({
        where: { conversation_id: conv.conversation_id },
        data: {
          last_message_at: now,
          last_message_preview: encryptedPreview,
          updated_at: now,
        },
      });

      await tx.directParticipantReadState.upsert({
        where: {
          conversation_id_user_id: {
            conversation_id: conv.conversation_id,
            user_id: viewerId,
          },
        },
        create: {
          conversation_id: conv.conversation_id,
          user_id: viewerId,
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

    void createNotificationFromEvent({
      targetUserId: peerId,
      triggerUserId: viewerId,
      eventType: "direct_message_received",
      priority: "high",
      metadata: {
        conversation_id: conv.conversation_id.toString(),
        message_id: message.message_id.toString(),
        peer_user_id: viewerId.toString(),
      },
      needsEmail: false,
    }).catch((error) => {
      console.error("[CONN_MSG_API] notification dispatch failed:", error);
    });

    return serializeMessage(message, {
      viewerId,
      peerLastReadMessageId: null,
    });
  }

  private async buildAssociateCardSnapshot(
    viewerId: bigint,
    activePeerId: bigint,
    associateId: bigint,
  ): Promise<AssociateCardSnapshot> {
    if (associateId === viewerId || associateId === activePeerId) {
      throw createConnectionMessagingError(
        ConnectionMessagingErrorCode.INVALID_PAYLOAD,
        "Choose another associate to share.",
        400,
      );
    }
    await this.assertCanMessage(viewerId, associateId);
    const associate = await prisma.user.findUnique({
      where: { user_id: associateId },
      select: {
        user_id: true,
        first_name: true,
        last_name: true,
        email: true,
        role: true,
        job_position: true,
        staff_designation: true,
        profile_url: true,
        cover_url: true,
        custom_uri: true,
        bizcards: {
          where: { deactivated_flag: false, is_blank: false },
          orderBy: { updated_at: "desc" },
          take: 1,
          select: {
            url_alias: true,
            portfolio_url: true,
            profile_img: true,
            cover_img: true,
            professional_title: true,
          },
        },
      },
    });
    if (!associate) {
      throw createConnectionMessagingError(
        ConnectionMessagingErrorCode.INVALID_PAYLOAD,
        "Associate was not found.",
        404,
      );
    }
    const card = associate.bizcards[0];
    const alias = card?.url_alias || associate.custom_uri;
    const portfolioUrl = card?.portfolio_url || (alias ? `/${encodeURIComponent(alias)}` : "/user/associate");
    return {
      version: "associate_card_v1",
      userId: associate.user_id.toString(),
      name: displayName(associate),
      role: associate.role || "user",
      position:
        card?.professional_title ||
        associate.job_position ||
        associate.staff_designation ||
        null,
      profileUrl: card?.profile_img || associate.profile_url,
      coverUrl: card?.cover_img || associate.cover_url,
      portfolioUrl,
    };
  }

  /**
   * Unsend for everyone: clears content, marks unsent_at, removes attachments.
   * Only the original sender may unsend.
   */
  async unsendMessage(viewerId: bigint, peerId: bigint, messageId: bigint) {
    const conv = await this.getOrCreateConversation(viewerId, peerId);
    const existing = await prisma.directMessage.findFirst({
      where: {
        message_id: messageId,
        conversation_id: conv.conversation_id,
      },
      select: {
        message_id: true,
        sender_user_id: true,
        unsent_at: true,
      },
    });
    if (!existing) {
      throw createConnectionMessagingError(
        ConnectionMessagingErrorCode.MESSAGE_NOT_FOUND,
        "Message not found.",
        404,
      );
    }
    if (existing.sender_user_id !== viewerId) {
      throw createConnectionMessagingError(
        ConnectionMessagingErrorCode.FORBIDDEN,
        "Only the sender can unsend a message.",
        403,
      );
    }
    if (existing.unsent_at) {
      const already = await prisma.directMessage.findFirst({
        where: { message_id: messageId },
        include: {
          sender: { select: { first_name: true, last_name: true, email: true } },
          attachments: true,
        },
      });
      if (!already) {
        throw createConnectionMessagingError(
          ConnectionMessagingErrorCode.MESSAGE_NOT_FOUND,
          "Message not found.",
          404,
        );
      }
      return serializeMessage(already, { viewerId, peerLastReadMessageId: null });
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      await tx.directMessageAttachment.deleteMany({ where: { message_id: messageId } });
      const msg = await tx.directMessage.update({
        where: { message_id: messageId },
        data: {
          body: null,
          message_type: "unsent",
          unsent_at: now,
        },
        include: {
          sender: { select: { first_name: true, last_name: true, email: true } },
          attachments: true,
        },
      });

      // Refresh conversation preview from latest non-hidden, non-empty content
      const latest = await tx.directMessage.findFirst({
        where: {
          conversation_id: conv.conversation_id,
          unsent_at: null,
        },
        orderBy: { created_at: "desc" },
        include: { attachments: true },
      });
      if (!latest) {
        await tx.directConversation.update({
          where: { conversation_id: conv.conversation_id },
          data: {
            last_message_preview: encryptMessage("Message unsent"),
            updated_at: now,
          },
        });
      } else {
        const plainBody = decryptStoredMessageBody(latest.body) ?? "";
        const preview = previewText(
          plainBody,
          latest.attachments.map((a) => ({
            mediaUrl: a.media_url,
            mimeType: a.mime_type,
            mediaKind: a.media_kind === "video" ? ("video" as const) : ("image" as const),
          })),
        );
        await tx.directConversation.update({
          where: { conversation_id: conv.conversation_id },
          data: {
            last_message_preview: preview ? encryptMessage(preview) : encryptMessage("Message unsent"),
            updated_at: now,
          },
        });
      }

      return msg;
    });

    return serializeMessage(updated, { viewerId, peerLastReadMessageId: null });
  }

  /**
   * Delete for me: hides the message for the current user only.
   */
  async hideMessageForMe(viewerId: bigint, peerId: bigint, messageId: bigint) {
    const conv = await this.getOrCreateConversation(viewerId, peerId);
    const existing = await prisma.directMessage.findFirst({
      where: {
        message_id: messageId,
        conversation_id: conv.conversation_id,
      },
      select: { message_id: true },
    });
    if (!existing) {
      throw createConnectionMessagingError(
        ConnectionMessagingErrorCode.MESSAGE_NOT_FOUND,
        "Message not found.",
        404,
      );
    }

    await prisma.directMessageHide.upsert({
      where: {
        message_id_user_id: {
          message_id: messageId,
          user_id: viewerId,
        },
      },
      create: {
        message_id: messageId,
        user_id: viewerId,
      },
      update: {},
    });

    return { hidden: true, messageId: messageId.toString() };
  }

  async getUnreadCountForUser(viewerId: bigint): Promise<number> {
    const conversations = await prisma.directConversation.findMany({
      where: {
        OR: [{ user_low_id: viewerId }, { user_high_id: viewerId }],
        last_message_at: { not: null },
      },
      select: { conversation_id: true },
    });
    if (conversations.length === 0) return 0;
    const map = await this.getUnreadCountsForUser(
      viewerId,
      conversations.map((c) => c.conversation_id),
    );
    let total = 0;
    for (const count of map.values()) total += count;
    return total;
  }

  async getPresenceForPeers(viewerId: bigint, peerIds: bigint[]) {
    const connectedAllowed = new Set(
      (await prisma.connection.findMany({
        where: {
          status: "accepted",
          OR: [
            { requester_user_id: viewerId, recipient_user_id: { in: peerIds } },
            { recipient_user_id: viewerId, requester_user_id: { in: peerIds } },
          ],
        },
        select: { requester_user_id: true, recipient_user_id: true },
      })).map((e) =>
        (e.requester_user_id === viewerId ? e.recipient_user_id : e.requester_user_id).toString(),
      ),
    );

    const filtered: bigint[] = [];
    for (const id of peerIds) {
      if (connectedAllowed.has(id.toString())) {
        filtered.push(id);
        continue;
      }
      if (await this.canMessageCompanyPeer(viewerId, id)) {
        filtered.push(id);
      }
    }
    if (filtered.length === 0) return [];

    const peers = await prisma.user.findMany({
      where: { user_id: { in: filtered } },
      select: {
        user_id: true,
        is_online: true,
        userActivity: { select: { last_active: true } },
      },
    });

    return peers.map((peer) => {
      const lastActive = peer.userActivity?.last_active ?? null;
      const online = isOnlineFromActivity(lastActive, peer.is_online);
      return {
        userId: peer.user_id.toString(),
        isOnline: online,
        lastActive: lastActive?.toISOString() ?? null,
        lastActiveLabel: online
          ? "Active"
          : lastActive
            ? `Last active ${formatTimeAgo(lastActive)}`
            : "Last active unknown",
      };
    });
  }

  private async markConversationRead(
    conversationId: bigint,
    userId: bigint,
    lastMessageId: bigint | null,
  ): Promise<void> {
    const now = new Date();
    await prisma.directParticipantReadState.upsert({
      where: {
        conversation_id_user_id: { conversation_id: conversationId, user_id: userId },
      },
      create: {
        conversation_id: conversationId,
        user_id: userId,
        last_read_at: now,
        last_read_message_id: lastMessageId,
      },
      update: {
        last_read_at: now,
        last_read_message_id: lastMessageId ?? undefined,
      },
    });
  }

  private async getUnreadCountsForUser(
    userId: bigint,
    conversationIds: bigint[],
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (conversationIds.length === 0) return result;

    const readStates = await prisma.directParticipantReadState.findMany({
      where: { user_id: userId, conversation_id: { in: conversationIds } },
      select: { conversation_id: true, last_read_at: true },
    });
    const readAtByConv = new Map(
      readStates.map((r) => [r.conversation_id.toString(), r.last_read_at]),
    );

    for (const conversationId of conversationIds) {
      const key = conversationId.toString();
      const lastReadAt = readAtByConv.get(key);
      const count = await prisma.directMessage.count({
        where: {
          conversation_id: conversationId,
          sender_user_id: { not: userId },
          unsent_at: null,
          hides: { none: { user_id: userId } },
          ...(lastReadAt ? { created_at: { gt: lastReadAt } } : {}),
        },
      });
      result.set(key, count);
    }
    return result;
  }
}
