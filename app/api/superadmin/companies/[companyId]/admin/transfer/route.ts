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
  DEFAULT_CO_ADMIN_PERMISSIONS,
  logCompanyAudit,
  MAX_CO_ADMINS,
  sanitizeCoAdminPermissions,
  syncMemberBizcardsToCompany,
} from "@/server/lib/company";

type RouteContext = SuperAdminCompanyContext & {
  params: Promise<{ companyId: string }>;
};

type TransferInput = {
  target_employee_id: string;
  reason?: string;
  keep_outgoing_as_co_admin?: boolean;
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

function validateInput(input: unknown, requestId: string): TransferInput {
  if (!input || typeof input !== "object") {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "Body must be a JSON object.",
      400,
      requestId,
    );
  }

  const payload = input as Record<string, unknown>;
  const targetEmployeeId =
    typeof payload.target_employee_id === "string" ? payload.target_employee_id.trim() : "";

  if (!/^\d+$/.test(targetEmployeeId)) {
    throw createSuperAdminError(
      SuperAdminErrorCode.INVALID_FILTER,
      "target_employee_id must be a numeric employee id.",
      400,
      requestId,
    );
  }

  const reason = typeof payload.reason === "string" ? payload.reason.trim().slice(0, 500) : undefined;
  const keepOutgoingAsCoAdmin =
    typeof payload.keep_outgoing_as_co_admin === "boolean"
      ? payload.keep_outgoing_as_co_admin
      : true;

  return {
    target_employee_id: targetEmployeeId,
    reason,
    keep_outgoing_as_co_admin: keepOutgoingAsCoAdmin,
  };
}

export const POST = withCompanySuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, originalUser, effectiveUser, impersonation } = context;

  try {
    const rateLimit = checkSuperadminCompanyRateLimit(req, "ADMIN_TRANSFER", String(originalUser.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many admin transfer requests. Please try again later.",
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

    const { companyId } = await context.params;
    const parsedCompanyId = parseBigIntId(companyId, "companyId", requestId);

    let input: TransferInput;
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

    const company = await prisma.company.findUnique({
      where: { company_id: parsedCompanyId },
      select: {
        company_id: true,
        name: true,
        admin_id: true,
        created_by: true,
        status: true,
      },
    });

    if (!company) {
      throw createSuperAdminError(
        SuperAdminErrorCode.IMPERSONATION_TARGET_NOT_FOUND,
        "Company not found.",
        404,
        requestId,
        { companyId },
      );
    }

    const targetEmployee = await prisma.companyEmployee.findFirst({
      where: {
        employee_id: BigInt(input.target_employee_id),
        company_id: company.company_id,
      },
      select: {
        employee_id: true,
        user_id: true,
        role: true,
        is_active: true,
        user: {
          select: {
            first_name: true,
            last_name: true,
            email: true,
          },
        },
      },
    });

    if (!targetEmployee) {
      throw createSuperAdminError(
        SuperAdminErrorCode.IMPERSONATION_TARGET_NOT_FOUND,
        "Target employee not found in this company.",
        404,
        requestId,
        { employeeId: input.target_employee_id, companyId },
      );
    }

    if (!targetEmployee.is_active) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_FILTER,
        "Cannot assign a restricted employee as primary administrator.",
        409,
        requestId,
      );
    }

    const outgoingAdminId = company.admin_id ?? company.created_by ?? null;

    if (outgoingAdminId && outgoingAdminId === targetEmployee.user_id) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_FILTER,
        "Selected employee is already the primary administrator.",
        409,
        requestId,
      );
    }

    const coAdminCountBefore = await countCoAdmins(company.company_id, outgoingAdminId);
    const outgoingBecomesCoAdmin =
      Boolean(outgoingAdminId) &&
      Boolean(input.keep_outgoing_as_co_admin) &&
      coAdminCountBefore < MAX_CO_ADMINS;

    const result = await prisma.$transaction(async (tx) => {
      await tx.company.update({
        where: { company_id: company.company_id },
        data: { admin_id: targetEmployee.user_id },
      });

      await tx.user.update({
        where: { user_id: targetEmployee.user_id },
        data: { company_id: company.company_id },
      });

      await tx.companyEmployee.update({
        where: { employee_id: targetEmployee.employee_id },
        data: {
          role: "admin",
          permissions: null,
        },
      });

      let outgoingNewRole: string | null = null;
      let outgoingIsCoAdmin = false;

      if (outgoingAdminId) {
        const outgoingMember = await tx.companyEmployee.findFirst({
          where: {
            company_id: company.company_id,
            user_id: outgoingAdminId,
          },
          select: { employee_id: true },
        });

        if (outgoingMember) {
          outgoingIsCoAdmin = outgoingBecomesCoAdmin;
          outgoingNewRole = outgoingBecomesCoAdmin ? "admin" : "employee";
          await tx.companyEmployee.update({
            where: { employee_id: outgoingMember.employee_id },
            data: outgoingBecomesCoAdmin
              ? {
                  role: "admin",
                  permissions: JSON.stringify(
                    sanitizeCoAdminPermissions(DEFAULT_CO_ADMIN_PERMISSIONS),
                  ),
                }
              : {
                  role: "employee",
                  permissions: null,
                },
          });
        }
      }

      await syncMemberBizcardsToCompany(tx, targetEmployee.user_id, company.company_id);
      if (outgoingAdminId) {
        await syncMemberBizcardsToCompany(tx, outgoingAdminId, company.company_id);
      }

      return {
        new_admin_user_id: targetEmployee.user_id.toString(),
        outgoing_admin_user_id: outgoingAdminId?.toString() ?? null,
        outgoing_new_role: outgoingNewRole,
        outgoing_is_co_admin: outgoingIsCoAdmin,
      };
    });

    const targetName =
      `${targetEmployee.user.first_name} ${targetEmployee.user.last_name}`.trim() ||
      targetEmployee.user.email;

    await prisma.userNotification.create({
      data: {
        id: randomId("notif"),
        user_id: targetEmployee.user_id,
        trigger_user_id: originalUser.userId,
        event_type: "system_update",
        priority: "high",
        title: "You are now the primary company administrator",
        message: `A superadmin assigned you as the primary administrator of ${company.name}.`,
        metadata: JSON.stringify({
          companyId: company.company_id.toString(),
          previous_admin_user_id: result.outgoing_admin_user_id,
          reason: input.reason ?? null,
        }),
      },
    });

    if (outgoingAdminId) {
      await prisma.userNotification.create({
        data: {
          id: randomId("notif"),
          user_id: outgoingAdminId,
          trigger_user_id: originalUser.userId,
          event_type: "system_update",
          priority: "medium",
          title: result.outgoing_is_co_admin
            ? "Primary admin role reassigned"
            : "Primary admin role transferred",
          message: result.outgoing_is_co_admin
            ? `A superadmin set ${targetName} as primary administrator of ${company.name}. You are now a co-admin.`
            : `A superadmin set ${targetName} as primary administrator of ${company.name}. Your role is now employee.`,
          metadata: JSON.stringify({
            companyId: company.company_id.toString(),
            new_admin_user_id: result.new_admin_user_id,
            new_role: result.outgoing_new_role,
            reason: input.reason ?? null,
          }),
        },
      });
    }

    await logCompanyAudit({
      companyId: company.company_id,
      userId: originalUser.userId,
      action: "superadmin.company.admin.transferred",
      requestId,
      ipAddress: getClientIp(req),
      userAgent: getUserAgent(req),
      details: {
        ...result,
        target_employee_id: targetEmployee.employee_id.toString(),
        target_name: targetName,
        reason: input.reason ?? null,
        keep_outgoing_as_co_admin: Boolean(input.keep_outgoing_as_co_admin),
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
        target_employee_id: targetEmployee.employee_id.toString(),
        target_name: targetName,
        ...result,
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
      "Failed to transfer company primary administrator",
    );
  }
});
