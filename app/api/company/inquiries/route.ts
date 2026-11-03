import { NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { actorUserIdFromSession, ensureCompanyRole, resolveCompanyActorContext } from "@/server/lib/company";
import { CompanyErrorCode, createCompanyError } from "@/lib/errors/company-errors";

function parsePositiveInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rl = checkRateLimit("company-inquiries", ip);
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
    ensureCompanyRole(context, ["admin", "manager", "employee"], requestId);

    const url = new URL(request.url);
    const page = parsePositiveInt(url.searchParams.get("page"), 1, 1, 10000);
    const limit = parsePositiveInt(url.searchParams.get("limit"), 20, 1, 100);
    const status = (url.searchParams.get("status") ?? "all").toLowerCase();

    const skip = (page - 1) * limit;

    const where: any = {
      status: { not: "deleted" },
      owner: {
        companyEmployeeRecords: {
            some: {
              company_id: context.companyId,
              is_active: true,
            },
          },
      },
      ...(status !== "all" ? { status } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.inquiry.findMany({
        where,
        include: {
          sender: {
            select: {
              first_name: true,
              last_name: true,
              email: true,
            },
          },
          owner: {
            select: {
              user_id: true,
              first_name: true,
              last_name: true,
              email: true,
            },
          },
          bizcard: {
            select: {
              bizcard_name: true,
              serial_id: true,
            },
          },
        },
        orderBy: { created_at: "desc" },
        skip,
        take: limit,
      }),
      prisma.inquiry.count({ where }),
    ]);

    return jsonSuccess(
      {
        inquiries: items.map((item) => ({
          inquiry_id: item.inquiry_id.toString(),
          sender: {
            user_id: item.sender_user_id ? item.sender_user_id.toString() : null,
            name:
              item.sender
                ? `${item.sender.first_name} ${item.sender.last_name}`.trim()
                : (item.visitor_name ?? "Unknown Sender"),
            email: item.sender?.email ?? item.visitor_email ?? null,
            phone: item.visitor_phone ?? null,
          },
          recipient: {
            user_id: item.owner.user_id.toString(),
            name: `${item.owner.first_name} ${item.owner.last_name}`.trim(),
            email: item.owner.email,
          },
          subject: item.subject,
          message: item.message,
          status: item.status,
          bizcard_name: item.bizcard?.bizcard_name ?? null,
          bizcard_serial_id: item.bizcard?.serial_id ?? null,
          created_at: item.created_at,
          updated_at: item.updated_at,
        })),
        pagination: {
          page,
          limit,
          total,
          pages: Math.max(1, Math.ceil(total / limit)),
        },
      },
      { requestId, responseTime: Date.now() - startedAt }
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/company/inquiries GET] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
