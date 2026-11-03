import { NextRequest } from "next/server";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import {
  actorUserIdFromSession,
  ensureCompanyPermission,
  ensureCompanyRole,
  resolveCompanyActorContext,
} from "@/server/lib/company";
import { CompanyAdminErrorCode, createCompanyAdminError } from "@/lib/errors/company-admin-errors";
import { isValidInviteRole } from "@/lib/services/company-employee-invite.service";
import { provisionCompanyEmployee } from "@/lib/services/company-employee-provision.service";

type ProvisionBody = {
  email: string;
  password: string;
  role?: string;
  firstName?: string;
  lastName?: string;
};

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function validateBody(input: unknown, requestId: string): ProvisionBody {
  if (!input || typeof input !== "object") {
    throw createCompanyAdminError(
      CompanyAdminErrorCode.INVALID_REQUEST,
      "Request body must be an object.",
      400,
      requestId,
    );
  }

  const payload = input as Record<string, unknown>;
  const email =
    typeof payload.email === "string" ? normalizeEmail(payload.email) : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  const rawRole = typeof payload.role === "string" ? payload.role.trim() : undefined;
  const firstName =
    typeof payload.firstName === "string" ? payload.firstName.trim() : undefined;
  const lastName =
    typeof payload.lastName === "string" ? payload.lastName.trim() : undefined;

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw createCompanyAdminError(
      CompanyAdminErrorCode.INVALID_REQUEST,
      "A valid email is required.",
      400,
      requestId,
    );
  }

  if (!password) {
    throw createCompanyAdminError(
      CompanyAdminErrorCode.INVALID_REQUEST,
      "Password is required.",
      400,
      requestId,
    );
  }

  if (rawRole && !isValidInviteRole(rawRole)) {
    throw createCompanyAdminError(
      CompanyAdminErrorCode.INVALID_REQUEST,
      "Invalid role. Use admin, manager, employee, viewer, or a custom role (letters, numbers, spaces, hyphens; max 20 characters).",
      400,
      requestId,
    );
  }

  return {
    email,
    password,
    role: rawRole,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
  };
}

function mapProvisionFailureToAdminError(
  reason: string,
  message: string,
  statusCode: number,
  requestId: string,
): AppError {
  switch (reason) {
    case "already_connected":
      return createCompanyAdminError(
        CompanyAdminErrorCode.EMPLOYEE_ALREADY_MEMBER,
        message,
        statusCode,
        requestId,
      );
    case "limit_reached":
      return createCompanyAdminError(
        CompanyAdminErrorCode.COMPANY_LIMIT_REACHED,
        message,
        statusCode,
        requestId,
      );
    case "existing_user":
    case "other_company":
    case "pending_registration":
    case "invalid_email":
    case "invalid_password":
    case "invalid_role":
      return createCompanyAdminError(
        CompanyAdminErrorCode.INVALID_REQUEST,
        message,
        statusCode,
        requestId,
        { reason },
      );
    case "company_not_found":
      return createCompanyAdminError(
        CompanyAdminErrorCode.NOT_FOUND,
        message,
        statusCode,
        requestId,
      );
    default:
      return createCompanyAdminError(
        CompanyAdminErrorCode.INVITE_FAILED,
        message,
        statusCode,
        requestId,
        { reason },
      );
  }
}

/**
 * POST /api/company/employees/provision
 * Company admin creates an employee account immediately (email + password + role).
 * Invitation flow remains at POST /api/company/employees/invite.
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rateLimit = checkRateLimit("companyadmin-provision-employee", ip);
    if (!rateLimit.allowed) {
      throw createCompanyAdminError(
        CompanyAdminErrorCode.RATE_LIMIT_EXCEEDED,
        "Too many requests. Please try again later.",
        429,
        requestId,
        { retryAfterSeconds: Math.ceil(rateLimit.retryAfterMs / 1000) },
      );
    }

    const auth = await resolveRequestSession(request, { tryRefresh: true });
    if (!auth.session) {
      throw createCompanyAdminError(
        CompanyAdminErrorCode.PERMISSION_DENIED,
        "Authentication required.",
        401,
        requestId,
      );
    }

    const actorUserId = actorUserIdFromSession(auth);
    const context = await resolveCompanyActorContext({ userId: actorUserId, requestId });
    ensureCompanyRole(context, ["admin", "manager"], requestId);
    ensureCompanyPermission(context, "manage_employees", requestId);

    const body = validateBody(await request.json(), requestId);

    const result = await provisionCompanyEmployee({
      companyId: context.companyId,
      actorUserId,
      email: body.email,
      password: body.password,
      role: body.role,
      firstName: body.firstName,
      lastName: body.lastName,
      requestId,
      ipAddress: ip,
    });

    if (!result.ok) {
      throw mapProvisionFailureToAdminError(
        result.reason,
        result.message,
        result.statusCode,
        requestId,
      );
    }

    return jsonSuccess(
      {
        employee: {
          employee_id: result.employee_id,
          user_id: result.user_id,
          name: result.name,
          email: result.email,
          role: result.role,
          status: result.status,
          profile_image: result.profile_image,
          membership_status: "active",
          is_active: true,
        },
      },
      { requestId, responseTime: Date.now() - startedAt },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }
    console.error("[api/company/employees/provision POST] Unexpected error", {
      requestId,
      error,
    });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
