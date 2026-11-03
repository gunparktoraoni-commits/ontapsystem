import { NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { validateCompanySearchParams } from "@/server/lib/validators";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { CompanyErrorCode, createCompanyError } from "@/lib/errors/company-errors";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rl = checkRateLimit("company-search", ip);
    if (!rl.allowed) {
      throw createCompanyError(
        CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
        "Too many search requests. Please try again later.",
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

    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    const validation = validateCompanySearchParams(params);
    if (!validation.valid) {
      throw createCompanyError(
        CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
        validation.errors[0] ?? "Invalid search parameters.",
        400,
        requestId,
        { errors: validation.errors },
      );
    }

    const { q, limit } = validation.data;

    const companies = await prisma.company.findMany({
      where: {
        status: "active",
        name: { contains: q },
      },
      select: {
        company_id: true,
        name: true,
        is_public: true,
        logo_url: true,
        description: true,
      },
      orderBy: { name: "asc" },
      take: limit,
    });

    return jsonSuccess(
      {
        companies: companies.map((company) => ({
          company_id: company.company_id.toString(),
          name: company.name,
          is_public: company.is_public,
          logo_url: company.logo_url,
          description: company.description,
        })),
      },
      { requestId, responseTime: Date.now() - startedAt },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[COMPANY_API] COMPANY_SEARCH_FAILED", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
