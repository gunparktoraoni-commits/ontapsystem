import { NextRequest, NextResponse } from "next/server";
import { withCompanySuperAdmin } from "@/lib/auth/superadmin-middleware";
import {
  SuperAdminErrorCode,
  createSuperAdminError,
  toSuperAdminErrorResponse,
} from "@/lib/errors/superadmin-errors";
import { toSuperAdminErrorNextResponse } from "@/lib/errors/superadmin-http";
import { checkSuperadminCompanyRateLimit } from "@/lib/rate-limit/superadmin-company-limits";
import { getClientIp, getUserAgent } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";
import { validateCompanyApproveInput } from "@/server/lib/validators";
import { randomId } from "@/server/lib/notifications";
import { generateSecurityCode, logCompanyAudit } from "@/server/lib/company";
import { processDeferredCompanyInvites } from "@/lib/services/company-employee-invite.service";

export const POST = withCompanySuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user, originalUser, effectiveUser, impersonation } = context;

  try {
    const rateLimit = checkSuperadminCompanyRateLimit(req, "APPROVE", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many company review requests. Please try again later.",
          requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt
        ),
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfter ?? 1),
          },
        }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_FILTER,
        "Invalid JSON body.",
        400,
        requestId
      );
    }

    const validation = validateCompanyApproveInput(body);
    if (!validation.valid) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_FILTER,
        validation.errors[0] ?? "Validation failed.",
        400,
        requestId,
        { errors: validation.errors }
      );
    }

    const payload = validation.data;

    const company = await prisma.company.findUnique({
      where: { company_id: BigInt(payload.request_id) },
      select: {
        company_id: true,
        name: true,
        status: true,
        created_by: true,
        settings: true,
      },
    });

    if (!company) {
      throw createSuperAdminError(
        SuperAdminErrorCode.IMPERSONATION_TARGET_NOT_FOUND,
        "Company request not found.",
        404,
        requestId,
        { request_id: payload.request_id }
      );
    }

    if (company.status !== "pending") {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_FILTER,
        "This company request has already been processed.",
        409,
        requestId,
        { status: company.status }
      );
    }

    if (!company.created_by) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_FILTER,
        "Company request does not have a valid requester.",
        409,
        requestId
      );
    }

    const creatorId = company.created_by;
    const approverId = originalUser.userId;
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    if (payload.action === "approve") {
      const newCode = generateSecurityCode(8);

      await prisma.$transaction(async (tx) => {
        await tx.company.update({
          where: { company_id: company.company_id },
          data: {
            status: "active",
            approved_at: new Date(),
            approved_by: approverId,
            admin_id: company.created_by,
            security_code: newCode,
            security_key: newCode,
            rejection_reason: null,
            current_employees: 1,
          },
        });

        await tx.user.update({
          where: { user_id: creatorId },
          data: {
            company_id: company.company_id,
            role: "company_admin",
          },
        });

        await tx.companyEmployee.upsert({
          where: {
            company_id_user_id: {
              company_id: company.company_id,
              user_id: creatorId,
            },
          },
          update: {
            role: "admin",
            permissions: JSON.stringify({
              manage_employees: true,
              view_analytics: true,
              edit_company: true,
              manage_inquiries: true,
            }),
            is_active: true,
            restricted_at: null,
            restricted_reason: null,
          },
          create: {
            company_id: company.company_id,
            user_id: creatorId,
            role: "admin",
            permissions: JSON.stringify({
              manage_employees: true,
              view_analytics: true,
              edit_company: true,
              manage_inquiries: true,
            }),
          },
        });

        await tx.userNotification.create({
          data: {
            id: randomId("notif"),
            user_id: creatorId,
            trigger_user_id: approverId,
            event_type: "system_update",
            priority: "high",
            title: "Company approved",
            message: "Your company application has been approved.",
            metadata: JSON.stringify({
              company_id: company.company_id.toString(),
              action: "approved",
              security_code: newCode,
            }),
            action_url: "/admin/company",
            action_text: "Open company",
          },
        });
      });

      let pendingInviteEmails: string[] = [];
      if (company.settings) {
        try {
          const parsed = JSON.parse(company.settings) as {
            pending_invite_emails?: unknown;
          };
          if (Array.isArray(parsed.pending_invite_emails)) {
            pendingInviteEmails = parsed.pending_invite_emails.filter(
              (entry): entry is string => typeof entry === "string",
            );
          }
        } catch {
          pendingInviteEmails = [];
        }
      }

      if (pendingInviteEmails.length > 0) {
        await processDeferredCompanyInvites({
          companyId: company.company_id,
          invitedBy: creatorId,
          emails: pendingInviteEmails,
          request: req,
        });

        try {
          const parsed = company.settings ? JSON.parse(company.settings) : {};
          const nextSettings = {
            ...(typeof parsed === "object" && parsed ? parsed : {}),
            pending_invite_emails: [],
          };
          await prisma.company.update({
            where: { company_id: company.company_id },
            data: { settings: JSON.stringify(nextSettings) },
          });
        } catch {
          // Non-fatal if settings cleanup fails after invites are sent.
        }
      }

      await logCompanyAudit({
        companyId: company.company_id,
        userId: approverId,
        action: "COMPANY_APPROVED",
        requestId,
        ipAddress: ip,
        userAgent,
        details: {
          company_name: company.name,
          admin_user_id: creatorId.toString(),
          actor_context: {
            original_user_id: originalUser.userId.toString(),
            effective_user_id: effectiveUser.userId.toString(),
            impersonation_token_id: impersonation?.tokenId ?? null,
          },
        },
      });

      return NextResponse.json({
        success: true,
        data: {
          company_id: company.company_id.toString(),
          company_name: company.name,
          admin_user_id: creatorId.toString(),
          message: "Company approved successfully. The user has been notified and now has admin role.",
          security_code: newCode,
        },
        meta: {
          requestId,
          responseTime: Date.now() - startedAt,
          timestamp: new Date().toISOString(),
        },
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.company.update({
        where: { company_id: company.company_id },
        data: {
          status: "rejected",
          approved_by: approverId,
          rejection_reason: payload.rejection_reason,
        },
      });

      await tx.userNotification.create({
        data: {
          id: randomId("notif"),
          user_id: creatorId,
          trigger_user_id: approverId,
          event_type: "system_update",
          priority: "high",
          title: "Company application rejected",
          message: "Your company application has been rejected.",
          metadata: JSON.stringify({
            company_id: company.company_id.toString(),
            action: "rejected",
            rejection_reason: payload.rejection_reason,
          }),
          action_url: "/user/dashboard",
          action_text: "View details",
        },
      });
    });

    await logCompanyAudit({
      companyId: company.company_id,
      userId: approverId,
      action: "COMPANY_REJECTED",
      requestId,
      ipAddress: ip,
      userAgent,
      details: {
        company_name: company.name,
        rejection_reason: payload.rejection_reason,
        actor_context: {
          original_user_id: originalUser.userId.toString(),
          effective_user_id: effectiveUser.userId.toString(),
          impersonation_token_id: impersonation?.tokenId ?? null,
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        request_id: company.company_id.toString(),
        status: "rejected",
        message: "Company application rejected. The user has been notified.",
      },
      meta: {
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return toSuperAdminErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to process company request"
    );
  }
});
