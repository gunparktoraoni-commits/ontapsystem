import { NextRequest, NextResponse } from "next/server";
import { withCompanySuperAdmin, type SuperAdminCompanyContext } from "@/lib/auth/superadmin-middleware";
import {
  SuperAdminErrorCode,
  createSuperAdminError,
  toSuperAdminErrorResponse,
} from "@/lib/errors/superadmin-errors";
import { toSuperAdminErrorNextResponse } from "@/lib/errors/superadmin-http";
import { checkSuperadminCompanyRateLimit } from "@/lib/rate-limit/superadmin-company-limits";
import { randomId } from "@/server/lib/notifications";
import { prisma } from "@/server/lib/prisma";
import { getClientIp, getUserAgent } from "@/server/lib/auth";
import { logCompanyAudit } from "@/server/lib/company";

type RouteContext = SuperAdminCompanyContext & {
  params: Promise<{ companyId: string; employeeId: string }>;
};

type RestrictInput = {
  action: "restrict" | "unrestrict";
  reason?: string;
};

function parseBigIntId(raw: string, field: string, requestId: string): bigint {
  if (!/^\d+$/.test(raw)) {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      `Invalid ${field} path parameter.`,
      400,
      requestId,
      { [field]: raw }
    );
  }

  return BigInt(raw);
}

function validateInput(input: unknown, requestId: string): RestrictInput {
  if (!input || typeof input !== "object") {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "Body must be a JSON object.",
      400,
      requestId
    );
  }

  const payload = input as Record<string, unknown>;
  const action = typeof payload.action === "string" ? payload.action.toLowerCase() : "";
  if (action !== "restrict" && action !== "unrestrict") {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "action must be restrict or unrestrict.",
      400,
      requestId
    );
  }

  const reason = typeof payload.reason === "string" ? payload.reason.trim() : undefined;
  if (reason && reason.length > 500) {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "reason must be at most 500 characters.",
      400,
      requestId
    );
  }

  return { action: action as RestrictInput["action"], reason };
}

export const POST = withCompanySuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, originalUser, effectiveUser, impersonation } = context;

  try {
    const rateLimit = checkSuperadminCompanyRateLimit(req, "EMPLOYEE_RESTRICT", String(originalUser.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many employee access update requests. Please try again later.",
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

    const { companyId, employeeId } = await context.params;
    const parsedCompanyId = parseBigIntId(companyId, "companyId", requestId);
    const parsedEmployeeId = parseBigIntId(employeeId, "employeeId", requestId);

    let input: RestrictInput;
    try {
      input = validateInput(await req.json(), requestId);
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

    const [company, employee] = await Promise.all([
      prisma.company.findUnique({
        where: { company_id: parsedCompanyId },
        select: { company_id: true, name: true, admin_id: true },
      }),
      prisma.companyEmployee.findFirst({
        where: {
          employee_id: parsedEmployeeId,
          company_id: parsedCompanyId,
        },
        select: {
          employee_id: true,
          user_id: true,
          role: true,
          is_active: true,
          restricted_at: true,
          restricted_reason: true,
        },
      }),
    ]);

    if (!company) {
      throw createSuperAdminError(
        SuperAdminErrorCode.IMPERSONATION_TARGET_NOT_FOUND,
        "Company not found.",
        404,
        requestId,
        { companyId }
      );
    }

    if (!employee) {
      throw createSuperAdminError(
        SuperAdminErrorCode.IMPERSONATION_TARGET_NOT_FOUND,
        "Employee not found.",
        404,
        requestId,
        { employeeId, companyId }
      );
    }

    if (company.admin_id && company.admin_id === employee.user_id) {
      throw createSuperAdminError(
        SuperAdminErrorCode.IMPERSONATION_NOT_ALLOWED,
        "Restricting the current company admin is not allowed.",
        409,
        requestId
      );
    }

    if (input.action === "restrict" && !employee.is_active) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_FILTER,
        "Employee is already restricted.",
        409,
        requestId
      );
    }

    if (input.action === "unrestrict" && employee.is_active) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_FILTER,
        "Employee is already active.",
        409,
        requestId
      );
    }

    const updated = await prisma.companyEmployee.update({
      where: { employee_id: employee.employee_id },
      data:
        input.action === "restrict"
          ? {
              is_active: false,
              restricted_at: new Date(),
              restricted_reason: input.reason ?? "Restricted by superadmin",
            }
          : {
              is_active: true,
              restricted_at: null,
              restricted_reason: null,
            },
      select: {
        employee_id: true,
        user_id: true,
        is_active: true,
        restricted_at: true,
        restricted_reason: true,
      },
    });

    await prisma.userNotification.create({
      data: {
        id: randomId("notif"),
        user_id: updated.user_id,
        trigger_user_id: originalUser.userId,
        event_type: "system_update",
        priority: "high",
        title:
          input.action === "restrict"
            ? "Your company access was restricted"
            : "Your company access was restored",
        message:
          input.action === "restrict"
            ? "Your access to your company workspace has been restricted by a superadmin."
            : "Your access to your company workspace has been restored by a superadmin.",
        metadata: JSON.stringify({
          companyId: company.company_id.toString(),
          action: input.action,
          reason: input.reason ?? null,
        }),
      },
    });

    await logCompanyAudit({
      companyId: company.company_id,
      userId: originalUser.userId,
      action:
        input.action === "restrict"
          ? "superadmin.company.employee.restricted"
          : "superadmin.company.employee.unrestricted",
      requestId,
      ipAddress: getClientIp(req),
      userAgent: getUserAgent(req),
      details: {
        employee_user_id: updated.user_id.toString(),
        reason: input.reason ?? null,
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
        employee: {
          employee_id: updated.employee_id.toString(),
          user_id: updated.user_id.toString(),
          is_active: updated.is_active,
          restricted_at: updated.restricted_at,
          restricted_reason: updated.restricted_reason,
        },
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
      "Failed to update company employee access"
    );
  }
});
