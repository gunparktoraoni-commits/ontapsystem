import crypto from "crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import {
  actorUserIdFromSession,
  ensureCompanyPermission,
  ensureCompanyRole,
  resolveCompanyActorContext,
  syncMemberBizcardsToCompany,
} from "@/server/lib/company";
import { CompanyAdminErrorCode, createCompanyAdminError } from "@/lib/errors/company-admin-errors";
import {
  createInvitation,
  isValidInviteRole,
  normalizeInviteRole,
  sendInvitationEmail,
} from "@/lib/services/company-employee-invite.service";

const DEFAULT_PERMISSIONS = JSON.stringify({
  manage_employees: false,
  view_analytics: false,
  edit_company: false,
  manage_inquiries: false,
});

type InvitePayload = {
  invites: Array<{ serial_id?: string; email?: string; role?: string }>;
};

type InviteResult = {
  serial_id?: string;
  email?: string;
  status: string;
  message: string;
};

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function validateInput(input: unknown, requestId: string): InvitePayload {
  if (!input || typeof input !== "object") {
    throw createCompanyAdminError(CompanyAdminErrorCode.INVALID_REQUEST, "Request body must be an object.", 400, requestId);
  }

  const payload = input as Record<string, unknown>;
  if (!Array.isArray(payload.invites)) {
    throw createCompanyAdminError(CompanyAdminErrorCode.INVALID_REQUEST, "invites must be an array.", 400, requestId);
  }

  const invites = payload.invites.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw createCompanyAdminError(CompanyAdminErrorCode.INVALID_REQUEST, `Invite item at index ${index} must be an object.`, 400, requestId);
    }

    const invite = item as Record<string, unknown>;
    const serialId = typeof invite.serial_id === "string" ? invite.serial_id.trim() : undefined;
    const email = typeof invite.email === "string" ? normalizeEmail(invite.email) : undefined;
    const rawRole = typeof invite.role === "string" ? invite.role.trim() : undefined;
    if (rawRole && !isValidInviteRole(rawRole)) {
      throw createCompanyAdminError(
        CompanyAdminErrorCode.INVALID_REQUEST,
        `Invalid role at index ${index}. Use admin, manager, employee, viewer, or a custom role (letters, numbers, spaces, hyphens; max 20 characters).`,
        400,
        requestId
      );
    }
    const role = rawRole ? normalizeInviteRole(rawRole) : undefined;

    if (!serialId && !email) {
      throw createCompanyAdminError(
        CompanyAdminErrorCode.INVALID_REQUEST,
        `Invite item at index ${index} must include serial_id or email.`,
        400,
        requestId
      );
    }

    if (serialId && serialId.length === 0) {
      throw createCompanyAdminError(CompanyAdminErrorCode.INVALID_REQUEST, "serial_id cannot be empty.", 400, requestId);
    }

    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw createCompanyAdminError(
        CompanyAdminErrorCode.INVALID_REQUEST,
        `Invalid email at index ${index}.`,
        400,
        requestId
      );
    }

    return { serial_id: serialId, email, role };
  });

  if (invites.length === 0) {
    throw createCompanyAdminError(CompanyAdminErrorCode.INVALID_REQUEST, "At least one invite is required.", 400, requestId);
  }

  if (invites.length > 50) {
    throw createCompanyAdminError(CompanyAdminErrorCode.INVALID_REQUEST, "Invite batch must not exceed 50 items.", 400, requestId);
  }

  return { invites };
}

async function createPendingJoinRequest(userId: bigint, companyId: bigint) {
  const existing = await prisma.companyJoinRequest.findFirst({
    where: {
      company_id: companyId,
      user_id: userId,
      status: "pending",
    },
    select: { request_id: true },
  });

  if (existing) {
    return {
      status: "pending",
      message: "A pending join request already exists for this user.",
    };
  }

  await prisma.companyJoinRequest.create({
    data: {
      company_id: companyId,
      user_id: userId,
      status: "pending",
    },
  });

  return {
    status: "pending",
    message: "An invite has been created for this user.",
  };
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rateLimit = checkRateLimit("companyadmin-invite-employees", ip);
    if (!rateLimit.allowed) {
      throw createCompanyAdminError(
        CompanyAdminErrorCode.RATE_LIMIT_EXCEEDED,
        "Too many requests. Please try again later.",
        429,
        requestId,
        { retryAfterSeconds: Math.ceil(rateLimit.retryAfterMs / 1000) }
      );
    }

    const auth = await resolveRequestSession(request, { tryRefresh: true });
    if (!auth.session) {
      throw createCompanyAdminError(CompanyAdminErrorCode.PERMISSION_DENIED, "Authentication required.", 401, requestId);
    }

    const actorUserId = actorUserIdFromSession(auth);
    const context = await resolveCompanyActorContext({ userId: actorUserId, requestId });
    ensureCompanyRole(context, ["admin", "manager"], requestId);
    ensureCompanyPermission(context, "manage_employees", requestId);

    const body = validateInput(await request.json(), requestId);
    const company = await prisma.company.findUnique({
      where: { company_id: context.companyId },
      select: {
        company_id: true,
        name: true,
        company_theme: true,
        approval_required: true,
        max_employees: true,
        current_employees: true,
      },
    });

    if (!company) {
      throw createCompanyAdminError(CompanyAdminErrorCode.NOT_FOUND, "Company not found.", 404, requestId);
    }

    const inviter = await prisma.user.findUnique({
      where: { user_id: actorUserId },
      select: { first_name: true, last_name: true },
    });
    const inviterName =
      `${inviter?.first_name ?? ""} ${inviter?.last_name ?? ""}`.trim() ||
      "Your company admin";

    const results: InviteResult[] = [];

    for (const inviteItem of body.invites) {
      if (inviteItem.serial_id) {
        const serialId = inviteItem.serial_id;
        const card = await prisma.bizcard.findUnique({
          where: { serial_id: serialId },
          select: {
            bizcard_id: true,
            user_id: true,
            company_id: true,
            is_blank: true,
            claimed_by_user_id: true,
          },
        });

        if (!card) {
          results.push({ serial_id: serialId, status: "invalid", message: "Serial id not found." });
          continue;
        }

        if (card.company_id === company.company_id) {
          results.push({ serial_id: serialId, status: "already_connected", message: "This card is already connected to your company." });
          continue;
        }

        if (card.is_blank && !card.company_id) {
          await prisma.bizcard.update({
            where: { bizcard_id: card.bizcard_id },
            data: {
              company_id: company.company_id,
              bizcard_theme: company.company_theme,
            },
          });
          results.push({ serial_id: serialId, status: "connected", message: "Blank card was connected to the company." });
          continue;
        }

        const ownerUserId = card.claimed_by_user_id ?? card.user_id;
        if (!ownerUserId) {
          results.push({ serial_id: serialId, status: "invalid", message: "Card is not claimable by a user." });
          continue;
        }

        const owner = await prisma.user.findUnique({
          where: { user_id: ownerUserId },
          select: { user_id: true, email: true, first_name: true, last_name: true, company_id: true },
        });

        if (!owner) {
          results.push({ serial_id: serialId, status: "invalid", message: "Associated user not found." });
          continue;
        }

        if (owner.company_id === company.company_id) {
          results.push({ serial_id: serialId, status: "already_connected", message: "User is already a member of this company." });
          continue;
        }

        if (owner.company_id) {
          results.push({ serial_id: serialId, status: "invalid", message: "User already belongs to another company." });
          continue;
        }

        if (company.approval_required) {
          const pending = await createPendingJoinRequest(owner.user_id, company.company_id);
          results.push({ serial_id: serialId, status: pending.status, message: pending.message });
          continue;
        }

        const currentEmployees = company.current_employees ?? 0;
        const maxEmployees = company.max_employees ?? 0;
        if (maxEmployees > 0 && currentEmployees >= maxEmployees) {
          results.push({ serial_id: serialId, status: "failed", message: "Company employee limit reached." });
          continue;
        }

        await prisma.$transaction(async (tx) => {
          await tx.companyEmployee.create({
            data: {
              company_id: company.company_id,
              user_id: owner.user_id,
              role: "employee",
              permissions: DEFAULT_PERMISSIONS,
            },
          });

          await tx.user.update({
            where: { user_id: owner.user_id },
            data: { company_id: company.company_id },
          });

          await tx.company.update({
            where: { company_id: company.company_id },
            data: { current_employees: { increment: 1 } },
          });

          await syncMemberBizcardsToCompany(tx, owner.user_id, company.company_id);
        });

        await prisma.userNotification.create({
          data: {
            id: randomId("notif"),
            user_id: owner.user_id,
            event_type: "system_update",
            priority: "medium",
            title: "You were invited to join a company",
            message: "A company admin has invited you to join their company.",
            metadata: JSON.stringify({
              companyId: company.company_id.toString(),
              serialId,
            }),
          },
        });

        results.push({ serial_id: serialId, status: "connected", message: "User invite accepted and membership created." });
        continue;
      }

      if (inviteItem.email) {
        const email = inviteItem.email;
        const created = await createInvitation({
          companyId: company.company_id,
          email,
          role: inviteItem.role,
          invitedBy: actorUserId,
          request,
        });

        if (!created.ok) {
          const statusMap = {
            already_connected: "already_connected",
            already_invited: "already_invited",
            invalid: "invalid",
            failed: "failed",
          } as const;
          results.push({
            email,
            status: statusMap[created.reason],
            message: created.message,
          });
          continue;
        }

        if (created.emailAlreadySent) {
          results.push({
            email,
            status: "pending",
            message: "Invitation resent successfully.",
          });
          continue;
        }

        const emailResult = await sendInvitationEmail({
          email: created.email,
          companyName: company.name,
          inviterName,
          plainToken: created.plainToken,
          expiresAt: created.expiresAt,
          request,
        });

        if (created.userId) {
          await prisma.userNotification.create({
            data: {
              id: randomId("notif"),
              user_id: BigInt(created.userId),
              trigger_user_id: actorUserId,
              event_type: "system_update",
              priority: "medium",
              title: "You were invited to join a company",
              message: `${inviterName} invited you to join ${company.name}.`,
              metadata: JSON.stringify({
                companyId: company.company_id.toString(),
                invitationId: created.invitationId,
              }),
              action_url: emailResult.acceptUrl ?? "/company/accept-invite",
              action_text: "Accept invitation",
            },
          });
        }

        if (!emailResult.emailSent) {
          results.push({
            email,
            status: "email_failed",
            message:
              emailResult.reason ??
              "Invitation created but the email could not be delivered.",
          });
          continue;
        }

        results.push({
          email,
          status: "pending",
          message: "Invitation sent successfully.",
        });
      }
    }

    return jsonSuccess(
      { invites: results },
      { requestId, responseTime: Date.now() - startedAt }
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/company/employees/invite POST] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
