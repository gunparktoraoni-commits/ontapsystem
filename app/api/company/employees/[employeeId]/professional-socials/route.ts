import { NextRequest } from "next/server";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { CompanyErrorCode, createCompanyError } from "@/lib/errors/company-errors";
import { getClientIp } from "@/server/lib/auth";
import {
  fetchEmployeeSocials,
  parseEmployeeIdParam,
  replaceEmployeeSocials,
  requireManageEmployeesAuth,
  resolveCompanyEmployeeTarget,
} from "@/server/lib/company-employee-profile";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rl = checkRateLimit("company-employee-professional-socials", ip);
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

    const socials = await fetchEmployeeSocials(employee.user_id);

    return jsonSuccess(
      {
        employee_id: employee.employee_id.toString(),
        user_id: employee.user_id.toString(),
        socials,
      },
      { requestId: authCtx.requestId, responseTime: Date.now() - authCtx.startedAt },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }
    console.error("[api/company/employees/professional-socials GET] Unexpected error", {
      requestId,
      error,
    });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rl = checkRateLimit("company-employee-professional-socials-update", ip);
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

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw createCompanyError(
        CompanyErrorCode.INVALID_EMPLOYEE_DATA,
        "Invalid JSON body.",
        400,
        authCtx.requestId,
      );
    }

    const socialsRaw = body.socials;
    if (!Array.isArray(socialsRaw)) {
      throw createCompanyError(
        CompanyErrorCode.INVALID_EMPLOYEE_DATA,
        "socials must be an array.",
        422,
        authCtx.requestId,
      );
    }

    const result = await replaceEmployeeSocials({
      userId: employee.user_id,
      employeeId: employee.employee_id,
      companyId: authCtx.context.companyId,
      actorUserId: authCtx.context.userId,
      socials: socialsRaw,
      requestId: authCtx.requestId,
      ip: authCtx.ip,
    });

    const socials = await fetchEmployeeSocials(employee.user_id);

    return jsonSuccess(
      {
        success: true,
        count: result.count,
        platforms: result.platforms,
        employee_id: employee.employee_id.toString(),
        user_id: employee.user_id.toString(),
        socials,
      },
      { requestId: authCtx.requestId, responseTime: Date.now() - authCtx.startedAt },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }
    console.error("[api/company/employees/professional-socials PUT] Unexpected error", {
      requestId,
      error,
    });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
