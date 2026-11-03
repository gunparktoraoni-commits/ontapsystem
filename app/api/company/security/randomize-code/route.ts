import { NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, getUserAgent, resolveRequestSession } from "@/server/lib/auth";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { actorUserIdFromSession, ensureCompanyPermission,
  ensureCompanyRole,
  generateSecurityCode,
  logCompanyAudit,
  resolveCompanyActorContext, } from "@/server/lib/company";
import { CompanyErrorCode, createCompanyError } from "@/lib/errors/company-errors";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  try {
    const rl = checkRateLimit("company-security-randomize", ip);
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
    ensureCompanyPermission(context, "edit_company", requestId);

    const newCode = generateSecurityCode(8);

    await prisma.company.update({
      where: { company_id: context.companyId },
      data: {
        security_code: newCode,
        security_key: newCode,
      },
    });

    await logCompanyAudit({
      companyId: context.companyId,
      userId: context.userId,
      action: "company.security_code.randomized",
      requestId,
      ipAddress: ip,
      userAgent,
    });

    return jsonSuccess(
      {
        success: true,
        security_code: newCode,
      },
      { requestId, responseTime: Date.now() - startedAt }
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/company/security/randomize-code POST] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
