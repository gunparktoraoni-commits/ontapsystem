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
import {
  countCoAdmins,
  isCoAdminMember,
  logCompanyAudit,
  MAX_CO_ADMINS,
  sanitizeCoAdminPermissions,
  syncMemberBizcardsToCompany,
} from "@/server/lib/company";

type RouteContext = SuperAdminCompanyContext & {
  params: Promise<{ companyId: string; employeeId: string }>;
};

type UpdateRoleInput = {
  role: "admin" | "manager" | "employee" | "viewer";
  reason?: string;
  permissions?: Record<string, boolean>;
};

function parseBigIntId(raw: string, field: string, requestId: string): bigint {
  if (!/^\d+$/.test(raw)) {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      `Invalid ${field} path parameter.`,
      400,
      requestId,
      { [field]: raw },
    );
  }

  return BigInt(raw);
}

function validateInput(input: unknown, requestId: string): UpdateRoleInput {
  if (!input || typeof input !== "object") {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "Body must be a JSON object.",
      400,
      requestId,
    );
  }

  const payload = input as Record<string, unknown>;
  const allowedRoles = new Set(["admin", "manager", "employee", "viewer"]);
  const role = typeof payload.role === "string" ? payload.role.toLowerCase() : "";

  if (!allowedRoles.has(role)) {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "role must be one of: admin, manager, employee, viewer.",
      400,
      requestId,
    );
  }

  const reason = typeof payload.reason === "string" ? payload.reason.trim() : undefined;
  if (reason && reason.length > 500) {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "reason must be at most 500 characters.",
      400,
      requestId,
    );
  }

  const permissions =
    payload.permissions && typeof payload.permissions === "object" && !Array.isArray(payload.permissions)
      ? (payload.permissions as Record<string, boolean>)
      : undefined;

  return { role: role as UpdateRoleInput["role"], reason, permissions };
}

function parseStoredPermissions(raw: string | null): Record<string, boolean> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, boolean>;
  } catch {
    return null;
  }
}

export const PUT = withCompanySuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, originalUser, effectiveUser, impersonation } = context;

  try {
    const rateLimit = checkSuperadminCompanyRateLimit(req, "EMPLOYEE_ROLE_UPDATE", String(originalUser.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many employee role update requests. Please try again later.",
          requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt,
        ),
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfter ?? 1),
          },
        },
      );
    }

    const { companyId, employeeId } = await context.params;
    const parsedCompanyId = parseBigIntId(companyId, "companyId", requestId);
    const parsedEmployeeId = parseBigIntId(employeeId, "employeeId", requestId);

    let input: UpdateRoleInput;
    try {
      input = validateInput(await req.json(), requestId);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw createSuperAdminError(
          SuperAdminErrorCode.INVALID_FILTER,
          "Invalid JSON body.",
          400,
          requestId,
        );
      }
      throw error;
    }

    const [company, employee] = await Promise.all([
      prisma.company.findUnique({
        where: { company_id: parsedCompanyId },
        select: { company_id: true, name: true, admin_id: true, created_by: true },
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
          permissions: true,
        },
      }),
    ]);

    if (!company) {
      throw createSuperAdminError(
        SuperAdminErrorCode.IMPERSONATION_TARGET_NOT_FOUND,
        "Company not found.",
        404,
        requestId,
        { companyId },
      );
    }

    if (!employee) {
      throw createSuperAdminError(
        SuperAdminErrorCode.IMPERSONATION_TARGET_NOT_FOUND,
        "Employee not found.",
        404,
        requestId,
        { employeeId, companyId },
      );
    }

    if (!employee.is_active) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_FILTER,
        "Cannot change role of a restricted employee.",
        409,
        requestId,
      );
    }

    const primaryAdminId = company.admin_id ?? company.created_by ?? null;
    const targetIsPrimary =
      (company.admin_id != null && company.admin_id === employee.user_id) ||
      (company.admin_id == null && company.created_by === employee.user_id);
    const promotingToCoAdmin = input.role === "admin" && !targetIsPrimary && employee.role !== "admin";
    const demotingCoAdmin = employee.role === "admin" && input.role !== "admin" && !targetIsPrimary;
    const updatingCoAdminPermissions =
      input.role === "admin" && !targetIsPrimary && Boolean(input.permissions);

    if (targetIsPrimary && input.role !== "admin") {
      throw createSuperAdminError(
        SuperAdminErrorCode.IMPERSONATION_NOT_ALLOWED,
        "Cannot demote the primary company administrator. Transfer primary ownership first.",
        409,
        requestId,
      );
    }

    if (promotingToCoAdmin) {
      const coAdminCount = await countCoAdmins(company.company_id, primaryAdminId);
      if (coAdminCount >= MAX_CO_ADMINS) {
        throw createSuperAdminError(
          SuperAdminErrorCode.INVALID_FILTER,
          `Co-admin limit reached. A company can have at most ${MAX_CO_ADMINS} co-admins.`,
          409,
          requestId,
          { limit: MAX_CO_ADMINS, current: coAdminCount },
        );
      }
    }

    const coAdminPermissions =
      input.role === "admin" && !targetIsPrimary
        ? JSON.stringify(sanitizeCoAdminPermissions(input.permissions))
        : null;

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.companyEmployee.update({
        where: { employee_id: employee.employee_id },
        data: {
          role: input.role,
          ...(input.role === "admin" && !targetIsPrimary
            ? { permissions: coAdminPermissions }
            : input.role !== "admin"
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

      if (input.role === "admin") {
        await tx.user.update({
          where: { user_id: row.user_id },
          data: { company_id: company.company_id },
        });
      }

      await syncMemberBizcardsToCompany(tx, row.user_id, company.company_id);
      return row;
    });

    const actionLabel = promotingToCoAdmin
      ? "assigned as co-admin"
      : demotingCoAdmin
        ? "removed as co-admin"
        : updatingCoAdminPermissions
          ? "permissions updated"
          : "role updated";

    await prisma.userNotification.create({
      data: {
        id: randomId("notif"),
        user_id: updated.user_id,
        trigger_user_id: originalUser.userId,
        event_type: "system_update",
        priority: "medium",
        title: "Your company role was updated",
        message: `A superadmin ${actionLabel} for you in ${company.name}.`,
        metadata: JSON.stringify({
          companyId: company.company_id.toString(),
          oldRole: employee.role,
          newRole: updated.role,
          reason: input.reason ?? null,
          permissions: parseStoredPermissions(updated.permissions),
        }),
      },
    });

    await logCompanyAudit({
      companyId: company.company_id,
      userId: originalUser.userId,
      action: promotingToCoAdmin
        ? "superadmin.company.co_admin.assigned"
        : demotingCoAdmin
          ? "superadmin.company.co_admin.removed"
          : updatingCoAdminPermissions
            ? "superadmin.company.co_admin.permissions.updated"
            : "superadmin.company.employee.role.updated",
      requestId,
      ipAddress: getClientIp(req),
      userAgent: getUserAgent(req),
      details: {
        employee_user_id: updated.user_id.toString(),
        old_role: employee.role,
        new_role: updated.role,
        reason: input.reason ?? null,
        permissions: parseStoredPermissions(updated.permissions),
        actor_context: {
          original_user_id: originalUser.userId.toString(),
          effective_user_id: effectiveUser.userId.toString(),
          impersonation_token_id: impersonation?.tokenId ?? null,
        },
      },
    });

    const primaryAfter = company.admin_id ?? company.created_by ?? null;

    return NextResponse.json({
      success: true,
      data: {
        company_id: company.company_id.toString(),
        company_name: company.name,
        employee: {
          employee_id: updated.employee_id.toString(),
          user_id: updated.user_id.toString(),
          role: updated.role,
          is_primary_admin: targetIsPrimary,
          is_co_admin: isCoAdminMember(updated.role, updated.user_id, primaryAfter),
          permissions: parseStoredPermissions(updated.permissions),
        },
        co_admin_limit: MAX_CO_ADMINS,
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
      "Failed to update company employee role",
    );
  }
});
