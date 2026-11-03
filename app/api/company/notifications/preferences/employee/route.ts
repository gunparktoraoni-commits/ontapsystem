import { NextRequest } from "next/server";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, getUserAgent, resolveRequestSession } from "@/server/lib/auth";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { actorUserIdFromSession, ensureCompanyRole,
  logCompanyAudit,
  resolveCompanyActorContext, } from "@/server/lib/company";
import {
  CompanyNotificationErrorCode,
  createCompanyNotificationError,
} from "@/lib/errors/company-notification-errors";
import { CompanyNotificationService } from "@/lib/services/company-notification.service";

function parseUpdateBody(input: unknown, requestId: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw createCompanyNotificationError(
      CompanyNotificationErrorCode.INVALID_PAYLOAD,
      "Body must be a JSON object.",
      400,
      requestId
    );
  }

  return input as Record<string, unknown>;
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rateLimit = checkRateLimit("company-notification-employee-preferences", ip);
    if (!rateLimit.allowed) {
      throw createCompanyNotificationError(
        CompanyNotificationErrorCode.RATE_LIMIT_EXCEEDED,
        "Too many requests. Please try again later.",
        429,
        requestId,
        { retryAfterSeconds: Math.ceil(rateLimit.retryAfterMs / 1000) }
      );
    }

    const auth = await resolveRequestSession(request, { tryRefresh: true });
    if (!auth.session) {
      throw createCompanyNotificationError(
        CompanyNotificationErrorCode.AUTHENTICATION_REQUIRED,
        "Authentication required.",
        401,
        requestId
      );
    }

    const context = await resolveCompanyActorContext({
      userId: actorUserIdFromSession(auth),
      requestId,
    });
    ensureCompanyRole(context, ["admin", "manager", "employee"], requestId);

    const service = new CompanyNotificationService(requestId);
    const [preferenceData, policyData] = await Promise.all([
      service.getEmployeeNotificationPreferences(context.userId),
      service.getCompanyNotificationPolicy(context.companyId),
    ]);

    return jsonSuccess(
      {
        company_id: context.companyId.toString(),
        user_id: context.userId.toString(),
        policy: policyData.policy,
        preferences: preferenceData,
      },
      {
        requestId,
        responseTime: Date.now() - startedAt,
      }
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/company/notifications/preferences/employee GET] Unexpected error", {
      requestId,
      error,
    });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}

export async function PUT(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  try {
    const rateLimit = checkRateLimit("company-notification-employee-preferences", ip);
    if (!rateLimit.allowed) {
      throw createCompanyNotificationError(
        CompanyNotificationErrorCode.RATE_LIMIT_EXCEEDED,
        "Too many requests. Please try again later.",
        429,
        requestId,
        { retryAfterSeconds: Math.ceil(rateLimit.retryAfterMs / 1000) }
      );
    }

    const auth = await resolveRequestSession(request, { tryRefresh: true });
    if (!auth.session) {
      throw createCompanyNotificationError(
        CompanyNotificationErrorCode.AUTHENTICATION_REQUIRED,
        "Authentication required.",
        401,
        requestId
      );
    }

    const context = await resolveCompanyActorContext({
      userId: actorUserIdFromSession(auth),
      requestId,
    });
    ensureCompanyRole(context, ["admin", "manager", "employee"], requestId);

    let body: Record<string, unknown>;
    try {
      body = parseUpdateBody(await request.json(), requestId);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw createCompanyNotificationError(
        CompanyNotificationErrorCode.INVALID_PAYLOAD,
        "Invalid JSON body.",
        400,
        requestId
      );
    }

    const service = new CompanyNotificationService(requestId);
    const updateResult = await service.updateEmployeeNotificationPreferences(context.userId, body);

    await logCompanyAudit({
      companyId: context.companyId,
      userId: context.userId,
      action: "company.notifications.preferences.updated",
      requestId,
      ipAddress: ip,
      userAgent,
      details: {
        updated_fields: updateResult.updated_fields,
      },
    });

    return jsonSuccess(
      {
        success: true,
        company_id: context.companyId.toString(),
        user_id: context.userId.toString(),
        updated_fields: updateResult.updated_fields,
      },
      {
        requestId,
        responseTime: Date.now() - startedAt,
      }
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/company/notifications/preferences/employee PUT] Unexpected error", {
      requestId,
      error,
    });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
