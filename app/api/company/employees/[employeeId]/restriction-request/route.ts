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

function toEmployeeId(value: string, requestId: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw createCompanyError(CompanyErrorCode.INVALID_EMPLOYEE_DATA, "Invalid employee id.", 400, requestId);
  }
  return BigInt(value);
}

function validateMessage(input: unknown, requestId: string): string {
  if (!input || typeof input !== "object") {
    throw createCompanyError(CompanyErrorCode.INVALID_EMPLOYEE_DATA, "Body must be a JSON object.", 400, requestId);
  }
  const payload = input as Record<string, unknown>;
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  if (!message) {
    throw createCompanyError(CompanyErrorCode.INVALID_EMPLOYEE_DATA, "message is required.", 400, requestId);
  }
  if (message.length > 2000) {
    throw createCompanyError(CompanyErrorCode.INVALID_EMPLOYEE_DATA, "message must be at most 2000 characters.", 400, requestId);
  }
  return message;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rl = checkRateLimit("company-employee-restriction-request", ip);
    if (!rl.allowed) {
      throw createCompanyError(
        CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
        "Too many requests. Please try again later.",
        429,
        requestId,
        { retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000) },
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

    const message = validateMessage(await request.json(), requestId);
    const { employeeId } = await params;
    const parsedEmployeeId = toEmployeeId(employeeId, requestId);

    const employee = await prisma.companyEmployee.findFirst({
      where: {
        employee_id: parsedEmployeeId,
        company_id: context.companyId,
      },
      include: {
        user: {
          select: {
            user_id: true,
            first_name: true,
            last_name: true,
            email: true,
          },
        },
        company: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!employee) {
      throw createCompanyError(CompanyErrorCode.EMPLOYEE_NOT_FOUND, "Employee not found.", 404, requestId);
    }

    if (employee.user_id === context.userId) {
      throw createCompanyError(
        CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
        "You cannot submit a restriction request for yourself.",
        403,
        requestId,
      );
    }

    const employeeName = `${employee.user.first_name} ${employee.user.last_name}`.trim();
    const companyName = employee.company.name;
    const subject = `Account Restriction Request — ${employeeName} (${companyName})`;

    await logCompanyAudit({
      companyId: context.companyId,
      userId: context.userId,
      action: "employee.restriction.requested",
      requestId,
      details: {
        employeeId: employee.employee_id.toString(),
        employeeUserId: employee.user_id.toString(),
        employeeName,
        employeeEmail: employee.user.email,
        subject,
        message,
      },
    });

    await prisma.userNotification.create({
      data: {
        id: randomId("notif"),
        user_id: employee.user_id,
        event_type: "system_update",
        priority: "high",
        title: "Account restriction review requested",
        message: "Your company administrator has submitted an account restriction review request.",
        metadata: JSON.stringify({
          companyId: context.companyId.toString(),
          subject,
          requestId: requestId,
        }),
      },
    });

    return jsonSuccess(
      {
        success: true,
        request_id: requestId,
        subject,
        message: "Restriction request submitted successfully.",
      },
      { requestId, responseTime: Date.now() - startedAt },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/company/employees/[employeeId]/restriction-request POST] Unexpected error", {
      requestId,
      error,
    });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
