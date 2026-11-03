import { NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, getUserAgent, resolveRequestSession } from "@/server/lib/auth";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { actorUserIdFromSession, countCoAdmins,
  DEFAULT_CO_ADMIN_PERMISSIONS,
  ensurePrimaryAdmin,
  logCompanyAudit,
  MAX_CO_ADMINS,
  resolveCompanyActorContext,
  sanitizeCoAdminPermissions,
  syncMemberBizcardsToCompany, } from "@/server/lib/company";
import { notifyCompanyAdmins, notifySingleUser } from "@/server/lib/company-notifications";
import { CompanyErrorCode, createCompanyError } from "@/lib/errors/company-errors";

type TransferInput = {
  target_employee_id: string;
  reason?: string;
};

function validateTransferInput(input: unknown, requestId: string): TransferInput {
  if (!input || typeof input !== "object") {
    throw createCompanyError(CompanyErrorCode.ADMIN_TRANSFER_FAILED, "Body must be a JSON object.", 400, requestId);
  }

  const payload = input as Record<string, unknown>;
  const targetEmployeeId =
    typeof payload.target_employee_id === "string" ? payload.target_employee_id.trim() : "";

  if (!/^\d+$/.test(targetEmployeeId)) {
    throw createCompanyError(
      CompanyErrorCode.INVALID_EMPLOYEE_DATA,
      "target_employee_id must be a numeric employee id.",
      400,
      requestId,
    );
  }

  const reason = typeof payload.reason === "string" ? payload.reason.trim().slice(0, 500) : undefined;
  return { target_employee_id: targetEmployeeId, reason };
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  try {
    const rl = checkRateLimit("company-admin-transfer", ip);
    if (!rl.allowed) {
      throw createCompanyError(
        CompanyErrorCode.RATE_LIMIT_EXCEEDED,
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
    ensurePrimaryAdmin(context, requestId);

    const body = validateTransferInput(await request.json(), requestId);
    const targetEmployeeId = BigInt(body.target_employee_id);

    const company = await prisma.company.findUnique({
      where: { company_id: context.companyId },
      select: {
        company_id: true,
        name: true,
        admin_id: true,
        created_by: true,
      },
    });

    if (!company) {
      throw createCompanyError(CompanyErrorCode.COMPANY_NOT_FOUND, "Company not found.", 404, requestId);
    }

    const outgoingAdminId = company.admin_id ?? company.created_by;
    if (!outgoingAdminId) {
      throw createCompanyError(
        CompanyErrorCode.ADMIN_TRANSFER_FAILED,
        "Company primary administrator could not be resolved.",
        409,
        requestId,
      );
    }

    const targetEmployee = await prisma.companyEmployee.findFirst({
      where: {
        employee_id: targetEmployeeId,
        company_id: context.companyId,
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
          },
        },
      },
    });

    if (!targetEmployee) {
      throw createCompanyError(CompanyErrorCode.EMPLOYEE_NOT_FOUND, "Target employee not found.", 404, requestId);
    }

    if (!targetEmployee.is_active) {
      throw createCompanyError(
        CompanyErrorCode.EMPLOYEE_RESTRICTED,
        "Cannot transfer ownership to a restricted employee.",
        409,
        requestId,
      );
    }

    if (targetEmployee.user_id === context.userId) {
      throw createCompanyError(
        CompanyErrorCode.ADMIN_TRANSFER_FAILED,
        "You cannot transfer ownership to yourself.",
        403,
        requestId,
      );
    }

    const coAdminCountBeforeTransfer = await countCoAdmins(context.companyId, outgoingAdminId);
    const outgoingBecomesCoAdmin = coAdminCountBeforeTransfer < MAX_CO_ADMINS;

    const result = await prisma.$transaction(async (tx) => {
      await tx.company.update({
        where: { company_id: context.companyId },
        data: { admin_id: targetEmployee.user_id },
      });

      await tx.companyEmployee.update({
        where: { employee_id: targetEmployee.employee_id },
        data: {
          role: "admin",
          permissions: null,
        },
      });

      const outgoingMember = await tx.companyEmployee.findFirst({
        where: {
          company_id: context.companyId,
          user_id: outgoingAdminId,
        },
        select: { employee_id: true },
      });

      if (outgoingMember) {
        await tx.companyEmployee.update({
          where: { employee_id: outgoingMember.employee_id },
          data: outgoingBecomesCoAdmin
            ? {
                role: "admin",
                permissions: JSON.stringify(sanitizeCoAdminPermissions(DEFAULT_CO_ADMIN_PERMISSIONS)),
              }
            : {
                role: "employee",
                permissions: null,
              },
        });
      }

      await syncMemberBizcardsToCompany(tx, targetEmployee.user_id, context.companyId);
      await syncMemberBizcardsToCompany(tx, outgoingAdminId, context.companyId);

      return {
        new_admin_user_id: targetEmployee.user_id.toString(),
        outgoing_admin_user_id: outgoingAdminId.toString(),
        outgoing_new_role: outgoingBecomesCoAdmin ? "admin" : "employee",
        outgoing_is_co_admin: outgoingBecomesCoAdmin,
      };
    });

    await logCompanyAudit({
      companyId: context.companyId,
      userId: context.userId,
      action: "company.admin.transferred",
      requestId,
      ipAddress: ip,
      userAgent,
      details: {
        ...result,
        target_employee_id: targetEmployee.employee_id.toString(),
        reason: body.reason ?? null,
      },
    });

    const targetName = `${targetEmployee.user.first_name} ${targetEmployee.user.last_name}`.trim();

    await notifySingleUser(targetEmployee.user_id, {
      title: "You are now the primary company administrator",
      message: `Ownership of ${company.name} has been transferred to you.`,
      metadata: {
        company_id: context.companyId.toString(),
        previous_admin_user_id: outgoingAdminId.toString(),
      },
      actionUrl: "/admin/company",
      actionText: "Open company dashboard",
      priority: "high",
    });

    await notifySingleUser(outgoingAdminId, {
      title: outgoingBecomesCoAdmin ? "You are now a co-admin" : "Primary admin role transferred",
      message: outgoingBecomesCoAdmin
        ? `You transferred primary admin ownership to ${targetName} and were assigned as co-admin.`
        : `You transferred primary admin ownership to ${targetName}. Your role is now employee because the co-admin limit was reached.`,
      metadata: {
        company_id: context.companyId.toString(),
        new_admin_user_id: targetEmployee.user_id.toString(),
        new_role: result.outgoing_new_role,
      },
      actionUrl: "/admin/company",
      actionText: "View company",
    });

    await notifyCompanyAdmins(context.companyId, "co_admin_changes_enabled", {
      title: "Company ownership transferred",
      message: `Primary administrator ownership was transferred to ${targetName}.`,
      metadata: {
        company_id: context.companyId.toString(),
        new_admin_user_id: targetEmployee.user_id.toString(),
        previous_admin_user_id: outgoingAdminId.toString(),
      },
      actionUrl: "/admin/company",
      actionText: "View company",
    });

    return jsonSuccess(
      {
        success: true,
        company_id: context.companyId.toString(),
        ...result,
        target_employee_id: targetEmployee.employee_id.toString(),
        target_name: targetName,
      },
      { requestId, responseTime: Date.now() - startedAt },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/company/admin/transfer POST] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
