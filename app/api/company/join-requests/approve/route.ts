import crypto from "crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, getUserAgent, resolveRequestSession } from "@/server/lib/auth";
import { validateCompanyJoinRequestReviewInput } from "@/server/lib/validators";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { actorUserIdFromSession, ensureCompanyPermission,
  ensureCompanyRole,
  logCompanyAudit,
  resolveCompanyActorContext,
  syncMemberBizcardsToCompany, } from "@/server/lib/company";
import { CompanyAdminErrorCode, createCompanyAdminError } from "@/lib/errors/company-admin-errors";

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  try {
    const auth = await resolveRequestSession(request, { tryRefresh: true });
    if (!auth.session) {
      throw createCompanyAdminError(
        CompanyAdminErrorCode.PERMISSION_DENIED,
        "Authentication required.",
        401,
        requestId,
      );
    }

    const context = await resolveCompanyActorContext({
      userId: actorUserIdFromSession(auth),
      requestId,
    });
    ensureCompanyRole(context, ["admin", "manager"], requestId);
    ensureCompanyPermission(context, "manage_employees", requestId);

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      throw createCompanyAdminError(
        CompanyAdminErrorCode.PERMISSION_DENIED,
        "Invalid JSON body.",
        400,
        requestId,
      );
    }

    const validation = validateCompanyJoinRequestReviewInput(body);
    if (!validation.valid) {
      throw createCompanyAdminError(
        CompanyAdminErrorCode.PERMISSION_DENIED,
        validation.errors[0] ?? "Validation failed.",
        400,
        requestId,
        { errors: validation.errors },
      );
    }

    const { request_id: requestIdRaw, action, rejection_reason: rejectionReason } = validation.data;
    const rateKey =
      action === "approve" ? "companyadmin-join-request-accept" : "companyadmin-join-request-decline";
    const rateLimit = checkRateLimit(rateKey, ip);
    if (!rateLimit.allowed) {
      throw createCompanyAdminError(
        CompanyAdminErrorCode.RATE_LIMIT_EXCEEDED,
        "Too many requests. Please try again later.",
        429,
        requestId,
        { retryAfterSeconds: Math.ceil(rateLimit.retryAfterMs / 1000) },
      );
    }

    const joinRequest = await prisma.companyJoinRequest.findFirst({
      where: {
        request_id: BigInt(requestIdRaw),
        company_id: context.companyId,
      },
      include: {
        user: {
          select: {
            user_id: true,
            email: true,
            first_name: true,
            last_name: true,
            company_id: true,
          },
        },
        company: {
          select: {
            company_id: true,
            name: true,
            max_employees: true,
            current_employees: true,
          },
        },
      },
    });

    if (!joinRequest) {
      throw createCompanyAdminError(
        CompanyAdminErrorCode.JOIN_REQUEST_NOT_FOUND,
        "Join request not found.",
        404,
        requestId,
      );
    }

    if (joinRequest.status !== "pending") {
      throw createCompanyAdminError(
        CompanyAdminErrorCode.JOIN_REQUEST_ALREADY_PROCESSED,
        "This join request has already been processed.",
        409,
        requestId,
      );
    }

    if (action === "reject") {
      await prisma.companyJoinRequest.update({
        where: { request_id: joinRequest.request_id },
        data: {
          status: "declined",
          reviewed_at: new Date(),
          reviewed_by: context.userId,
          rejection_reason: rejectionReason ?? null,
        },
      });

      await prisma.userNotification.create({
        data: {
          id: randomId("notif"),
          user_id: joinRequest.user_id,
          trigger_user_id: context.userId,
          event_type: "system_update",
          priority: "medium",
          title: "Company join request declined",
          message: `Your request to join ${joinRequest.company.name} was declined.`,
          metadata: JSON.stringify({
            company_id: joinRequest.company_id.toString(),
            request_id: joinRequest.request_id.toString(),
          }),
        },
      });

      await logCompanyAudit({
        companyId: context.companyId,
        userId: context.userId,
        action: "COMPANY_JOIN_REQUEST_DECLINED",
        requestId,
        ipAddress: ip,
        userAgent,
        details: {
          request_id: joinRequest.request_id.toString(),
          requester_user_id: joinRequest.user_id.toString(),
          rejection_reason: rejectionReason ?? null,
        },
      });

      return jsonSuccess(
        {
          request_id: joinRequest.request_id.toString(),
          status: "declined",
          message: "Join request declined.",
        },
        { requestId, responseTime: Date.now() - startedAt },
      );
    }

    const requester = joinRequest.user;
    if (requester.company_id && requester.company_id !== joinRequest.company_id) {
      throw createCompanyAdminError(
        CompanyAdminErrorCode.PERMISSION_DENIED,
        "User already belongs to another company.",
        409,
        requestId,
      );
    }

    const maxEmployees = joinRequest.company.max_employees ?? 0;
    if (maxEmployees > 0 && joinRequest.company.current_employees >= maxEmployees) {
      throw createCompanyAdminError(
        CompanyAdminErrorCode.PERMISSION_DENIED,
        "Company has reached its employee limit.",
        403,
        requestId,
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.companyJoinRequest.update({
        where: { request_id: joinRequest.request_id },
        data: {
          status: "accepted",
          reviewed_at: new Date(),
          reviewed_by: context.userId,
          rejection_reason: null,
        },
      });

      const existingEmployee = await tx.companyEmployee.findFirst({
        where: {
          company_id: joinRequest.company_id,
          user_id: joinRequest.user_id,
        },
        select: { employee_id: true },
      });

      if (!existingEmployee) {
        await tx.companyEmployee.create({
          data: {
            company_id: joinRequest.company_id,
            user_id: joinRequest.user_id,
            role: "employee",
            permissions: JSON.stringify({
              manage_employees: false,
              view_analytics: false,
              edit_company: false,
              manage_inquiries: false,
            }),
          },
        });

        await tx.company.update({
          where: { company_id: joinRequest.company_id },
          data: { current_employees: { increment: 1 } },
        });
      }

      await tx.user.update({
        where: { user_id: joinRequest.user_id },
        data: { company_id: joinRequest.company_id },
      });

      await syncMemberBizcardsToCompany(tx, joinRequest.user_id, joinRequest.company_id);
    });

    await prisma.userNotification.create({
      data: {
        id: randomId("notif"),
        user_id: joinRequest.user_id,
        trigger_user_id: context.userId,
        event_type: "system_update",
        priority: "medium",
        title: "Company join request approved",
        message: `You have been approved to join ${joinRequest.company.name}.`,
        metadata: JSON.stringify({
          company_id: joinRequest.company_id.toString(),
          request_id: joinRequest.request_id.toString(),
        }),
        action_url: "/admin/dashboard",
        action_text: "Open dashboard",
      },
    });

    await logCompanyAudit({
      companyId: context.companyId,
      userId: context.userId,
      action: "COMPANY_JOIN_REQUEST_APPROVED",
      requestId,
      ipAddress: ip,
      userAgent,
      details: {
        request_id: joinRequest.request_id.toString(),
        requester_user_id: joinRequest.user_id.toString(),
        requester_email: requester.email,
      },
    });

    return jsonSuccess(
      {
        request_id: joinRequest.request_id.toString(),
        status: "accepted",
        message: "Join request approved.",
      },
      { requestId, responseTime: Date.now() - startedAt },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[COMPANY_API] JOIN_REQUEST_APPROVE_FAILED", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
