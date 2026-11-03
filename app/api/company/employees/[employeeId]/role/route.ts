import { NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { actorUserIdFromSession, countCoAdmins,
  ensureCompanyPermission,
  ensureCompanyRole,
  isCoAdminMember,
  logCompanyAudit,
  MAX_CO_ADMINS,
  resolveCompanyActorContext,
  sanitizeCoAdminPermissions,
  syncMemberBizcardsToCompany, } from "@/server/lib/company";
import { notifyCompanyAdmins } from "@/server/lib/company-notifications";
import { randomId } from "@/server/lib/notifications";
import { CompanyErrorCode, createCompanyError } from "@/lib/errors/company-errors";

type UpdateRoleInput = {
  role: string;
  reason?: string;
  permissions?: Record<string, boolean>;
};

const SYSTEM_ROLES = new Set(["admin", "manager", "employee", "viewer"]);
const MAX_ROLE_LENGTH = 20;
const CUSTOM_ROLE_PATTERN = /^[a-z0-9]+(?:[ _-][a-z0-9]+)*$/i;

function toEmployeeId(value: string, requestId: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw createCompanyError(CompanyErrorCode.INVALID_EMPLOYEE_DATA, "Invalid employee id.", 400, requestId);
  }
  return BigInt(value);
}

function normalizeRoleValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isValidEmployeeRole(value: string): boolean {
  const role = normalizeRoleValue(value);
  if (!role || role.length > MAX_ROLE_LENGTH) return false;
  if (SYSTEM_ROLES.has(role)) return true;
  return CUSTOM_ROLE_PATTERN.test(role);
}

function validateUpdateRoleInput(input: unknown, requestId: string): UpdateRoleInput {
  if (!input || typeof input !== "object") {
    throw createCompanyError(CompanyErrorCode.INVALID_EMPLOYEE_DATA, "Body must be a JSON object.", 400, requestId);
  }

  const payload = input as Record<string, unknown>;
  const role = typeof payload.role === "string" ? normalizeRoleValue(payload.role) : "";

  if (!isValidEmployeeRole(role)) {
    throw createCompanyError(
      CompanyErrorCode.INVALID_EMPLOYEE_DATA,
      "role must be admin, manager, employee, viewer, or a custom role (letters, numbers, spaces, hyphens; max 20 characters).",
      400,
      requestId
    );
  }

  const reason = typeof payload.reason === "string" ? payload.reason.trim() : undefined;
  if (reason && reason.length > 500) {
    throw createCompanyError(CompanyErrorCode.INVALID_EMPLOYEE_DATA, "reason must be at most 500 characters.", 400, requestId);
  }

  const permissions =
    payload.permissions && typeof payload.permissions === "object" && !Array.isArray(payload.permissions)
      ? (payload.permissions as Record<string, boolean>)
      : undefined;

  return { role, reason, permissions };
}

function isCoAdminRole(role: string, userId: bigint, primaryAdminId: bigint | null): boolean {
  return isCoAdminMember(role, userId, primaryAdminId);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ employeeId: string }> }) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rl = checkRateLimit("company-employee-role-update", ip);
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

    const body = validateUpdateRoleInput(await request.json(), requestId);
    const { employeeId } = await params;
    const parsedEmployeeId = toEmployeeId(employeeId, requestId);

    const company = await prisma.company.findUnique({
      where: { company_id: context.companyId },
      select: { admin_id: true, created_by: true },
    });
    if (!company) {
      throw createCompanyError(CompanyErrorCode.COMPANY_NOT_FOUND, "Company not found.", 404, requestId);
    }

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
      throw createCompanyError(CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION, "You cannot change your own role.", 403, requestId);
    }

    if (!employee.is_active) {
      throw createCompanyError(CompanyErrorCode.EMPLOYEE_RESTRICTED, "Cannot change role of a restricted employee.", 409, requestId);
    }

    const targetIsPrimary =
      company.admin_id === employee.user_id ||
      (company.admin_id == null && company.created_by === employee.user_id);
    const targetIsCoAdmin = isCoAdminRole(employee.role, employee.user_id, company.admin_id);
    const promotingToCoAdmin = body.role === "admin" && employee.role !== "admin";
    const demotingCoAdmin = employee.role === "admin" && body.role !== "admin";

    if (targetIsPrimary && body.role !== "admin") {
      throw createCompanyError(
        CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
        "The primary company admin cannot be demoted.",
        403,
        requestId,
      );
    }

    if ((promotingToCoAdmin || demotingCoAdmin || targetIsCoAdmin) && !context.isPrimaryAdmin) {
      throw createCompanyError(
        CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
        "Only the primary company admin can assign or demote co-admins.",
        403,
        requestId,
      );
    }

    if (promotingToCoAdmin) {
      const coAdminCount = await countCoAdmins(context.companyId, company.admin_id ?? company.created_by);
      if (coAdminCount >= MAX_CO_ADMINS) {
        throw createCompanyError(
          CompanyErrorCode.CO_ADMIN_LIMIT_REACHED,
          `Co-admin limit reached. A company can have at most ${MAX_CO_ADMINS} co-admins.`,
          403,
          requestId,
          { limit: MAX_CO_ADMINS, current: coAdminCount },
        );
      }
    }

    if (targetIsCoAdmin && body.role === "admin" && body.permissions && !context.isPrimaryAdmin) {
      throw createCompanyError(
        CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
        "Only the primary company admin can change co-admin permissions.",
        403,
        requestId,
      );
    }

    const coAdminPermissions =
      body.role === "admin" && !targetIsPrimary
        ? JSON.stringify(sanitizeCoAdminPermissions(body.permissions))
        : body.role === "admin" && targetIsPrimary
          ? null
          : null;

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.companyEmployee.update({
        where: { employee_id: employee.employee_id },
        data: {
          role: body.role,
          ...(body.role === "admin" && !targetIsPrimary
            ? { permissions: coAdminPermissions }
            : body.role !== "admin"
              ? { permissions: null }
              : {}),
        },
        select: {
          employee_id: true,
          user_id: true,
          role: true,
          permissions: true,
        },
      });

      await syncMemberBizcardsToCompany(tx, row.user_id, context.companyId);
      return row;
    });

    await notifyCompanyAdmins(
      context.companyId,
      promotingToCoAdmin || demotingCoAdmin ? "co_admin_changes_enabled" : "employee_management_enabled",
      {
        title: promotingToCoAdmin
          ? "Co-admin assigned"
          : demotingCoAdmin
            ? "Co-admin demoted"
            : "Employee role updated",
        message: `A company member role was changed from ${employee.role} to ${updated.role}.`,
        metadata: {
          companyId: context.companyId.toString(),
          employeeUserId: updated.user_id.toString(),
          oldRole: employee.role,
          newRole: updated.role,
        },
        actionUrl: "/admin/company",
        actionText: "View team",
      },
    );

    await prisma.userNotification.create({
      data: {
        id: randomId("notif"),
        user_id: updated.user_id,
        event_type: "system_update",
        priority: "medium",
        title: "Your company role was updated",
        message: `Your role has been changed from ${employee.role} to ${updated.role}.`,
        metadata: JSON.stringify({
          companyId: context.companyId.toString(),
          oldRole: employee.role,
          newRole: updated.role,
          reason: body.reason ?? null,
        }),
      },
    });

    await logCompanyAudit({
      companyId: context.companyId,
      userId: context.userId,
      action: "employee.role.updated",
      requestId,
      details: {
        employeeUserId: updated.user_id.toString(),
        oldRole: employee.role,
        newRole: updated.role,
        reason: body.reason ?? null,
        permissions: updated.permissions,
      },
    });

    let parsedPermissions: Record<string, boolean> | null = null;
    if (updated.permissions) {
      try {
        parsedPermissions = JSON.parse(updated.permissions) as Record<string, boolean>;
      } catch {
        parsedPermissions = null;
      }
    }

    return jsonSuccess(
      {
        success: true,
        employee: {
          employee_id: updated.employee_id.toString(),
          user_id: updated.user_id.toString(),
          role: updated.role,
          is_co_admin: isCoAdminRole(updated.role, updated.user_id, company.admin_id),
          permissions: parsedPermissions,
        },
      },
      { requestId, responseTime: Date.now() - startedAt }
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/company/employees/[employeeId]/role PUT] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
