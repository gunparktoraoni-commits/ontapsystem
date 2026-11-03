import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getRequestId, jsonAppError, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { CompanyErrorCode, createCompanyError } from "@/lib/errors/company-errors";
import { getClientIp } from "@/server/lib/auth";
import {
  parseEmployeeIdParam,
  requireManageEmployeesAuth,
  resolveCompanyEmployeeTarget,
} from "@/server/lib/company-employee-profile";
import {
  attachCompanyActingCookie,
  clearCompanyActingCookie,
  createCompanyActingToken,
} from "@/server/lib/company-employee-acting-context";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rl = checkRateLimit("company-employee-acting-context", ip);
    if (!rl.allowed) {
      throw createCompanyError(
        CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
        "Too many requests. Please try again later.",
        429,
        requestId,
        { retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000) },
      );
    }

    const authCtx = await requireManageEmployeesAuth(request);
    const { employeeId } = await params;
    const parsedEmployeeId = parseEmployeeIdParam(employeeId, authCtx.requestId);
    const employee = await resolveCompanyEmployeeTarget({
      employeeId: parsedEmployeeId,
      companyId: authCtx.context.companyId,
      requestId: authCtx.requestId,
    });

    const { rawToken, expiresAt } = createCompanyActingToken({
      actorUserId: Number(authCtx.context.userId),
      companyId: authCtx.context.companyId,
      employeeId: employee.employee_id,
      employeeUserId: Number(employee.user_id),
    });

    const response = NextResponse.json(
      {
        success: true,
        data: {
          token: rawToken,
          expires_at: expiresAt.toISOString(),
          employee_id: employee.employee_id.toString(),
          user_id: employee.user_id.toString(),
        },
        requestId: authCtx.requestId,
        responseTime: Date.now() - authCtx.startedAt,
      },
      { status: 200 },
    );
    attachCompanyActingCookie(response, rawToken, expiresAt);
    return response;
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }
    console.error("[api/company/employees/acting-context POST] Unexpected error", {
      requestId,
      error,
    });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rl = checkRateLimit("company-employee-acting-context", ip);
    if (!rl.allowed) {
      throw createCompanyError(
        CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
        "Too many requests. Please try again later.",
        429,
        requestId,
        { retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000) },
      );
    }

    // Auth still required so only company managers can clear; employeeId is validated lightly.
    const authCtx = await requireManageEmployeesAuth(request);
    const { employeeId } = await params;
    parseEmployeeIdParam(employeeId, authCtx.requestId);

    const response = NextResponse.json(
      {
        success: true,
        data: { cleared: true },
        requestId: authCtx.requestId,
        responseTime: Date.now() - authCtx.startedAt,
      },
      { status: 200 },
    );
    clearCompanyActingCookie(response);
    return response;
  } catch (error) {
    if (error instanceof AppError) {
      const errResponse = jsonAppError(error, Date.now() - startedAt);
      // Still clear cookies on auth failure paths when possible (best-effort).
      if (error.statusCode === 401 || error.statusCode === 403) {
        clearCompanyActingCookie(errResponse);
      }
      return errResponse;
    }
    console.error("[api/company/employees/acting-context DELETE] Unexpected error", {
      requestId,
      error,
    });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
