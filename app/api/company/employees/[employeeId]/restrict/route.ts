import { NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { actorUserIdFromSession, ensureCompanyPermission,
  ensureCompanyRole,
  logCompanyAudit,
  resolveCompanyActorContext, } from "@/server/lib/company";
import { randomId } from "@/server/lib/notifications";
import { CompanyErrorCode, createCompanyError } from "@/lib/errors/company-errors";

type RestrictInput = {
  action: "restrict" | "unrestrict";
  reason?: string;
};

function toEmployeeId(value: string, requestId: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw createCompanyError(CompanyErrorCode.INVALID_EMPLOYEE_DATA, "Invalid employee id.", 400, requestId);
  }
  return BigInt(value);
}

function validateRestrictInput(input: unknown, requestId: string): RestrictInput {
  if (!input || typeof input !== "object") {
    throw createCompanyError(CompanyErrorCode.INVALID_EMPLOYEE_DATA, "Body must be a JSON object.", 400, requestId);
  }

  const payload = input as Record<string, unknown>;
  const action = typeof payload.action === "string" ? payload.action.toLowerCase() : "";
  if (action !== "restrict" && action !== "unrestrict") {
    throw createCompanyError(CompanyErrorCode.INVALID_EMPLOYEE_DATA, "action must be restrict or unrestrict.", 400, requestId);
  }

  const reason = typeof payload.reason === "string" ? payload.reason.trim() : undefined;
  if (reason && reason.length > 500) {
    throw createCompanyError(CompanyErrorCode.INVALID_EMPLOYEE_DATA, "reason must be at most 500 characters.", 400, requestId);
  }

  return { action: action as RestrictInput["action"], reason };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ employeeId: string }> }) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rl = checkRateLimit("company-employee-restrict", ip);
    if (!rl.allowed) {
      throw createCompanyError(
        CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
        "Too many requests. Please try again later.",
        429,
        requestId,
        { retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000) }
      );
    }

    const auth = await resolveRequestSession(request, { tryRefresh: true });
    if (!auth.session) {
      throw createCompanyError(CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION, "Authentication required.", 401, requestId);
    }

    const context = await resolveCompanyActorContext({
      userId: actorUserIdFromSession(auth),
      requestId,
    });
    ensureCompanyRole(context, ["admin", "manager"], requestId);
    ensureCompanyPermission(context, "manage_employees", requestId);

    const input = validateRestrictInput(await request.json(), requestId);
    const { employeeId } = await params;
    const parsedEmployeeId = toEmployeeId(employeeId, requestId);

    const employee = await prisma.companyEmployee.findFirst({
      where: {
        employee_id: parsedEmployeeId,
        company_id: context.companyId,
      },
      select: {
        employee_id: true,
        user_id: true,
        role: true,
        is_active: true,
      },
    });

    if (!employee) {
      throw createCompanyError(CompanyErrorCode.EMPLOYEE_NOT_FOUND, "Employee not found.", 404, requestId);
    }

    if (employee.user_id === context.userId) {
      throw createCompanyError(CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION, "You cannot change your own access state.", 403, requestId);
    }

    if (input.action === "restrict" && !employee.is_active) {
      throw createCompanyError(CompanyErrorCode.EMPLOYEE_RESTRICTED, "Employee is already restricted.", 409, requestId);
    }

    if (input.action === "unrestrict" && employee.is_active) {
      throw createCompanyError(CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION, "Employee is already active.", 409, requestId);
    }

    const updated = await prisma.companyEmployee.update({
      where: { employee_id: employee.employee_id },
      data:
        input.action === "restrict"
          ? {
              is_active: false,
              restricted_at: new Date(),
              restricted_reason: input.reason ?? "Restricted by company admin/manager",
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
        event_type: "system_update",
        priority: "medium",
        title: input.action === "restrict" ? "Your company access was restricted" : "Your company access was restored",
        message:
          input.action === "restrict"
            ? "Your access to your company workspace has been restricted."
            : "Your access to your company workspace has been restored.",
        metadata: JSON.stringify({
          companyId: context.companyId.toString(),
          action: input.action,
          reason: input.reason ?? null,
        }),
      },
    });

    await logCompanyAudit({
      companyId: context.companyId,
      userId: context.userId,
      action: input.action === "restrict" ? "employee.restricted" : "employee.unrestricted",
      requestId,
      details: {
        employeeUserId: updated.user_id.toString(),
        reason: input.reason ?? null,
      },
    });

    return jsonSuccess(
      {
        success: true,
        employee: {
          employee_id: updated.employee_id.toString(),
          user_id: updated.user_id.toString(),
          is_active: updated.is_active,
          restricted_at: updated.restricted_at,
          restricted_reason: updated.restricted_reason,
        },
      },
      { requestId, responseTime: Date.now() - startedAt }
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/company/employees/[employeeId]/restrict POST] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
