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
import { randomId } from "@/server/lib/notifications";
import { prisma } from "@/server/lib/prisma";
import { logCompanyAudit } from "@/server/lib/company";

type NameChangeApproveInput = {
  request_id: number;
  action: "approve" | "reject";
  rejection_reason: string | null;
};

function validateInput(input: unknown, requestId: string): NameChangeApproveInput {
  if (!input || typeof input !== "object") {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "Body must be a JSON object.",
      400,
      requestId
    );
  }

  const payload = input as Record<string, unknown>;
  const requestIdRaw = Number(payload.request_id);
  if (!Number.isInteger(requestIdRaw) || requestIdRaw <= 0) {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "request_id must be a positive integer.",
      400,
      requestId
    );
  }

  const actionRaw = typeof payload.action === "string" ? payload.action.toLowerCase() : "";
  if (actionRaw !== "approve" && actionRaw !== "reject") {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "action must be approve or reject.",
      400,
      requestId
    );
  }

  const rejectionReason = typeof payload.rejection_reason === "string" ? payload.rejection_reason.trim() : "";
  if (actionRaw === "reject" && !rejectionReason) {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "rejection_reason is required when action is reject.",
      400,
      requestId
    );
  }

  return {
    request_id: requestIdRaw,
    action: actionRaw,
    rejection_reason: rejectionReason || null,
  };
}

export const POST = withCompanySuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user, originalUser, effectiveUser, impersonation } = context;

  try {
    const rateLimit = checkSuperadminCompanyRateLimit(req, "NAME_CHANGE_APPROVE", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many name change decision requests. Please try again later.",
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

    let body: NameChangeApproveInput;
    try {
      body = validateInput(await req.json(), requestId);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw createSuperAdminError(
          SuperAdminErrorCode.INVALID_FILTER,
          "Invalid JSON body.",
          400,
          requestId
        );
      }
      throw error;
    }

    const reviewerId = originalUser.userId;
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    const requestRow = await prisma.companyNameChangeRequest.findUnique({
      where: { request_id: BigInt(body.request_id) },
      include: {
        company: {
          select: {
            company_id: true,
            name: true,
          },
        },
        requester: {
          select: {
            user_id: true,
          },
        },
      },
    });

    if (!requestRow) {
      throw createSuperAdminError(
        SuperAdminErrorCode.IMPERSONATION_TARGET_NOT_FOUND,
        "Name change request not found.",
        404,
        requestId,
        { request_id: body.request_id }
      );
    }

    if (requestRow.status !== "pending") {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_FILTER,
        "This name change request has already been processed.",
        409,
        requestId,
        { status: requestRow.status }
      );
    }

    if (body.action === "approve") {
      const existingName = await prisma.company.findFirst({
        where: {
          name: requestRow.requested_name,
          company_id: { not: requestRow.company.company_id },
        },
        select: { company_id: true },
      });

      if (existingName) {
        throw createSuperAdminError(
          SuperAdminErrorCode.INVALID_FILTER,
          "Requested company name is already in use.",
          409,
          requestId
        );
      }

      await prisma.$transaction(async (tx) => {
        await tx.company.update({
          where: { company_id: requestRow.company.company_id },
          data: {
            name: requestRow.requested_name,
            last_name_change_request: new Date(),
            pending_name_change: null,
          },
        });

        await tx.companyNameChangeRequest.update({
          where: { request_id: requestRow.request_id },
          data: {
            status: "approved",
            reviewed_at: new Date(),
            reviewed_by: reviewerId,
            rejection_reason: null,
          },
        });

        await tx.userNotification.create({
          data: {
            id: randomId("notif"),
            user_id: requestRow.requester.user_id,
            trigger_user_id: reviewerId,
            event_type: "system_update",
            priority: "high",
            title: "Company name change approved",
            message: `Your company name change request was approved. New name: ${requestRow.requested_name}`,
            metadata: JSON.stringify({
              requestId: requestRow.request_id.toString(),
              companyId: requestRow.company.company_id.toString(),
              oldName: requestRow.company.name,
              newName: requestRow.requested_name,
              action: "approved",
            }),
          },
        });
      });

      await logCompanyAudit({
        companyId: requestRow.company.company_id,
        userId: reviewerId,
        action: "company.name_change.approved",
        requestId,
        ipAddress: ip,
        userAgent,
        details: {
          requestId: requestRow.request_id.toString(),
          oldName: requestRow.company.name,
          newName: requestRow.requested_name,
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
          request_id: requestRow.request_id.toString(),
          status: "approved",
          old_name: requestRow.company.name,
          new_name: requestRow.requested_name,
        },
        meta: {
          requestId,
          responseTime: Date.now() - startedAt,
          timestamp: new Date().toISOString(),
        },
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.companyNameChangeRequest.update({
        where: { request_id: requestRow.request_id },
        data: {
          status: "rejected",
          reviewed_at: new Date(),
          reviewed_by: reviewerId,
          rejection_reason: body.rejection_reason,
        },
      });

      await tx.company.update({
        where: { company_id: requestRow.company.company_id },
        data: {
          pending_name_change: null,
        },
      });

      await tx.userNotification.create({
        data: {
          id: randomId("notif"),
          user_id: requestRow.requester.user_id,
          trigger_user_id: reviewerId,
          event_type: "system_update",
          priority: "high",
          title: "Company name change rejected",
          message: "Your company name change request has been rejected.",
          metadata: JSON.stringify({
            requestId: requestRow.request_id.toString(),
            companyId: requestRow.company.company_id.toString(),
            requestedName: requestRow.requested_name,
            action: "rejected",
            rejectionReason: body.rejection_reason,
          }),
        },
      });
    });

    await logCompanyAudit({
      companyId: requestRow.company.company_id,
      userId: reviewerId,
      action: "company.name_change.rejected",
      requestId,
      ipAddress: ip,
      userAgent,
      details: {
        requestId: requestRow.request_id.toString(),
        oldName: requestRow.company.name,
        requestedName: requestRow.requested_name,
        rejectionReason: body.rejection_reason,
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
        request_id: requestRow.request_id.toString(),
        status: "rejected",
        requested_name: requestRow.requested_name,
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
      "Failed to process company name change request"
    );
  }
});
