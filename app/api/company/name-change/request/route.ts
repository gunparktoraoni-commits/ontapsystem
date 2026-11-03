import { NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, getUserAgent, resolveRequestSession } from "@/server/lib/auth";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { actorUserIdFromSession, ensureCompanyPermission,
  ensureCompanyRole,
  ensurePrimaryAdmin,
  logCompanyAudit,
  resolveCompanyActorContext, } from "@/server/lib/company";
import { CompanyErrorCode, createCompanyError } from "@/lib/errors/company-errors";

const NAME_COOLDOWN_DAYS = 90;

type NameChangeRequestInput = {
  requested_name: string;
  reason: string | null;
};

function validateInput(input: unknown, requestId: string): NameChangeRequestInput {
  if (!input || typeof input !== "object") {
    throw createCompanyError(CompanyErrorCode.COMPANY_NOT_FOUND, "Body must be a JSON object.", 400, requestId);
  }

  const payload = input as Record<string, unknown>;
  const requestedName = typeof payload.requested_name === "string" ? payload.requested_name.trim() : "";
  if (!requestedName) {
    throw createCompanyError(CompanyErrorCode.COMPANY_NOT_FOUND, "requested_name is required.", 400, requestId);
  }
  if (requestedName.length > 255) {
    throw createCompanyError(CompanyErrorCode.COMPANY_NOT_FOUND, "requested_name must be at most 255 characters.", 400, requestId);
  }

  const reasonRaw = typeof payload.reason === "string" ? payload.reason.trim() : "";
  if (reasonRaw.length > 1000) {
    throw createCompanyError(CompanyErrorCode.COMPANY_NOT_FOUND, "reason must be at most 1000 characters.", 400, requestId);
  }

  return {
    requested_name: requestedName,
    reason: reasonRaw || null,
  };
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  try {
    const rl = checkRateLimit("company-name-change-request", ip);
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
    ensurePrimaryAdmin(context, requestId);

    const body = validateInput(await request.json(), requestId);

    const company = await prisma.company.findUnique({
      where: { company_id: context.companyId },
      select: {
        company_id: true,
        name: true,
        last_name_change_request: true,
      },
    });

    if (!company) {
      throw createCompanyError(CompanyErrorCode.COMPANY_NOT_FOUND, "Company not found.", 404, requestId);
    }

    if (company.name === body.requested_name) {
      throw createCompanyError(CompanyErrorCode.COMPANY_ALREADY_EXISTS, "Requested name matches current company name.", 409, requestId);
    }

    const existingName = await prisma.company.findFirst({
      where: {
        name: body.requested_name,
        company_id: { not: context.companyId },
      },
      select: { company_id: true },
    });

    if (existingName) {
      throw createCompanyError(CompanyErrorCode.COMPANY_ALREADY_EXISTS, "Requested company name is already in use.", 409, requestId);
    }

    const pending = await prisma.companyNameChangeRequest.findFirst({
      where: {
        company_id: context.companyId,
        status: "pending",
      },
      select: { request_id: true },
    });

    if (pending) {
      throw createCompanyError(CompanyErrorCode.COMPANY_NAME_CHANGE_PENDING, "A name change request is already pending.", 409, requestId);
    }

    if (company.last_name_change_request) {
      const elapsedMs = Date.now() - company.last_name_change_request.getTime();
      const cooldownMs = NAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
      if (elapsedMs < cooldownMs) {
        const remainingDays = Math.ceil((cooldownMs - elapsedMs) / (24 * 60 * 60 * 1000));
        throw createCompanyError(
          CompanyErrorCode.COMPANY_NAME_CHANGE_COOLDOWN,
          "Name change cooldown is still active.",
          409,
          requestId,
          { remainingDays }
        );
      }
    }

    const created = await prisma.companyNameChangeRequest.create({
      data: {
        company_id: context.companyId,
        requested_name: body.requested_name,
        requested_by: context.userId,
        status: "pending",
      },
      select: {
        request_id: true,
        requested_name: true,
        requested_at: true,
      },
    });

    await prisma.company.update({
      where: { company_id: context.companyId },
      data: {
        pending_name_change: body.requested_name,
      },
    });

    await logCompanyAudit({
      companyId: context.companyId,
      userId: context.userId,
      action: "company.name_change.requested",
      requestId,
      ipAddress: ip,
      userAgent,
      details: {
        requestId: created.request_id.toString(),
        oldName: company.name,
        newName: created.requested_name,
        reason: body.reason,
      },
    });

    return jsonSuccess(
      {
        request_id: created.request_id.toString(),
        status: "pending",
        requested_name: created.requested_name,
        requested_at: created.requested_at,
      },
      { requestId, responseTime: Date.now() - startedAt }
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/company/name-change/request POST] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
