import crypto from "crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, getUserAgent, resolveRequestSession } from "@/server/lib/auth";
import { validateCompanyJoinInput } from "@/server/lib/validators";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { CompanyErrorCode, createCompanyError } from "@/lib/errors/company-errors";
import { actorUserIdFromSession, logCompanyAudit, syncMemberBizcardsToCompany } from "@/server/lib/company";
import { notifyCompanyAdmins } from "@/server/lib/company-notifications";

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  try {
    const rl = checkRateLimit("company-join", ip);
    if (!rl.allowed) {
      throw createCompanyError(
        CompanyErrorCode.COMPANY_JOIN_DISABLED,
        "Too many join attempts. Please try again later.",
        429,
        requestId,
        { retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000) },
      );
    }

    const auth = await resolveRequestSession(request, { tryRefresh: true });
    if (!auth.session) {
      throw createCompanyError(
        CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
        "Authentication required.",
        401,
        requestId,
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      throw createCompanyError(
        CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
        "Invalid JSON body.",
        400,
        requestId,
      );
    }

    const validation = validateCompanyJoinInput(body);
    if (!validation.valid) {
      throw createCompanyError(
        CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
        validation.errors[0] ?? "Validation failed.",
        400,
        requestId,
        { errors: validation.errors },
      );
    }

    const payload = validation.data;
    const userId = actorUserIdFromSession(auth);

    const companySelect = {
      company_id: true,
      name: true,
      is_public: true,
      approval_required: true,
      security_code: true,
      max_employees: true,
      current_employees: true,
      admin_id: true,
    } as const;

    const [user, company] = await Promise.all([
      prisma.user.findUnique({
        where: { user_id: userId },
        select: { user_id: true, company_id: true, first_name: true, last_name: true, email: true },
      }),
      payload.company_id
        ? prisma.company.findFirst({
            where: { company_id: BigInt(payload.company_id), status: "active" },
            select: companySelect,
          })
        : prisma.company.findFirst({
            where: { name: payload.company_name ?? "", status: "active" },
            select: companySelect,
          }),
    ]);

    if (!user) {
      throw createCompanyError(
        CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
        "User not found.",
        404,
        requestId,
      );
    }

    if (user.company_id) {
      if (company && user.company_id === company.company_id) {
        throw createCompanyError(
          CompanyErrorCode.EMPLOYEE_ALREADY_IN_COMPANY,
          "You are already in this company.",
          409,
          requestId,
        );
      }
      throw createCompanyError(
        CompanyErrorCode.EMPLOYEE_IN_ANOTHER_COMPANY,
        "You already belong to another company.",
        409,
        requestId,
      );
    }

    if (!company) {
      throw createCompanyError(
        CompanyErrorCode.COMPANY_NOT_FOUND,
        "Company not found.",
        404,
        requestId,
      );
    }

    const securityCode = payload.security_code?.trim() ?? "";

    if (!company.is_public) {
      if (!securityCode) {
        throw createCompanyError(
          CompanyErrorCode.COMPANY_JOIN_DISABLED,
          "Security code is required to join this private company.",
          403,
          requestId,
        );
      }

      if (!company.security_code || company.security_code !== securityCode) {
        throw createCompanyError(
          CompanyErrorCode.INVALID_SECURITY_CODE,
          "Invalid security code.",
          401,
          requestId,
        );
      }
    } else if (securityCode) {
      if (!company.security_code || company.security_code !== securityCode) {
        throw createCompanyError(
          CompanyErrorCode.INVALID_SECURITY_CODE,
          "Invalid security code.",
          401,
          requestId,
        );
      }
    }

    const maxEmployees = company.max_employees ?? 0;
    if (maxEmployees > 0 && company.current_employees >= maxEmployees) {
      throw createCompanyError(
        CompanyErrorCode.EMPLOYEE_LIMIT_REACHED,
        "Company has reached its employee limit.",
        403,
        requestId,
        { maxEmployees, currentEmployees: company.current_employees },
      );
    }

    if (company.approval_required) {
      const existing = await prisma.companyJoinRequest.findFirst({
        where: { company_id: company.company_id, user_id: userId, status: "pending" },
        select: { request_id: true },
      });

      if (existing) {
        throw createCompanyError(
          CompanyErrorCode.JOIN_REQUEST_PENDING,
          "You already have a pending join request.",
          409,
          requestId,
          { requestId: existing.request_id.toString() },
        );
      }

      const joinRequest = await prisma.companyJoinRequest.create({
        data: {
          company_id: company.company_id,
          user_id: userId,
          status: "pending",
        },
        select: { request_id: true, company_id: true, status: true },
      });

      await notifyCompanyAdmins(company.company_id, "join_request_enabled", {
        triggerUserId: userId,
        title: "New company join request",
        message: `${user.first_name} ${user.last_name}`.trim() + " requested to join your company.",
        metadata: {
          company_id: company.company_id.toString(),
          request_id: joinRequest.request_id.toString(),
          requester_user_id: userId.toString(),
        },
        actionUrl: "/admin/company",
        actionText: "Review request",
      });

      await logCompanyAudit({
        companyId: company.company_id,
        userId,
        action: "COMPANY_JOIN_REQUESTED",
        requestId,
        ipAddress: ip,
        userAgent,
        details: {
          request_id: joinRequest.request_id.toString(),
          requester_email: user.email,
        },
      });

      return jsonSuccess(
        {
          request_id: joinRequest.request_id.toString(),
          company_id: joinRequest.company_id.toString(),
          status: joinRequest.status,
          message:
            "Your request to join has been sent. The company admin will review and approve your membership.",
        },
        { requestId, responseTime: Date.now() - startedAt },
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.companyEmployee.create({
        data: {
          company_id: company.company_id,
          user_id: userId,
          role: "employee",
          permissions: JSON.stringify({
            manage_employees: false,
            view_analytics: false,
            edit_company: false,
            manage_inquiries: false,
          }),
        },
      });

      await tx.user.update({
        where: { user_id: userId },
        data: { company_id: company.company_id },
      });

      await tx.company.update({
        where: { company_id: company.company_id },
        data: { current_employees: { increment: 1 } },
      });

      await syncMemberBizcardsToCompany(tx, userId, company.company_id);
    });

    await logCompanyAudit({
      companyId: company.company_id,
      userId,
      action: "COMPANY_JOINED",
      requestId,
      ipAddress: ip,
      userAgent,
      details: {
        user_email: user.email,
      },
    });

    return jsonSuccess(
      {
        company_id: company.company_id.toString(),
        message: "You have successfully joined the company.",
        employee_id: `${company.company_id.toString()}:${userId.toString()}`,
      },
      { requestId, responseTime: Date.now() - startedAt },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/company/join POST] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
