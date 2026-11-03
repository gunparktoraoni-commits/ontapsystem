import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { actorUserIdFromSession, ensureCompanyRole, resolveCompanyActorContext } from "@/server/lib/company";
import {
  CompanyNotificationErrorCode,
  createCompanyNotificationError,
} from "@/lib/errors/company-notification-errors";

function parsePositiveInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseStatus(value: string | null): string | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized || normalized === "all") return null;

  const allowed = new Set(["queued", "processing", "sent", "failed", "cancelled"]);
  return allowed.has(normalized) ? normalized : null;
}

function parseUserId(value: string | null): bigint | null {
  if (!value || !/^\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rateLimit = checkRateLimit("company-notification-logs", ip);
    if (!rateLimit.allowed) {
      throw createCompanyNotificationError(
        CompanyNotificationErrorCode.RATE_LIMIT_EXCEEDED,
        "Too many requests. Please try again later.",
        429,
        requestId,
        { retryAfterSeconds: Math.ceil(rateLimit.retryAfterMs / 1000) }
      );
    }

    const auth = await resolveRequestSession(request, { tryRefresh: true });
    if (!auth.session) {
      throw createCompanyNotificationError(
        CompanyNotificationErrorCode.AUTHENTICATION_REQUIRED,
        "Authentication required.",
        401,
        requestId
      );
    }

    const context = await resolveCompanyActorContext({
      userId: actorUserIdFromSession(auth),
      requestId,
    });
    ensureCompanyRole(context, ["admin", "manager"], requestId);

    const url = new URL(request.url);
    const page = parsePositiveInt(url.searchParams.get("page"), 1, 1, 10_000);
    const limit = parsePositiveInt(url.searchParams.get("limit"), 25, 1, 100);
    const status = parseStatus(url.searchParams.get("status"));
    const emailType = (url.searchParams.get("email_type") ?? "").trim().toLowerCase();
    const userFilter = parseUserId(url.searchParams.get("user_id"));

    const employeeRows = await prisma.companyEmployee.findMany({
      where: {
        company_id: context.companyId,
      },
      select: {
        user_id: true,
      },
    });

    const companyUserIds = employeeRows.map((row) => row.user_id);
    if (companyUserIds.length === 0) {
      return jsonSuccess(
        {
          logs: [],
          summary: {},
          pagination: {
            page,
            limit,
            total: 0,
            pages: 1,
          },
        },
        {
          requestId,
          responseTime: Date.now() - startedAt,
        }
      );
    }

    const where: Prisma.NotificationEmailQueueWhereInput = {
      user_id: { in: companyUserIds },
      ...(status ? { status } : {}),
      ...(emailType ? { email_type: emailType } : {}),
      ...(userFilter ? { user_id: userFilter } : {}),
    };

    const skip = (page - 1) * limit;

    const [rows, total, groupedByStatus] = await Promise.all([
      prisma.notificationEmailQueue.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: limit,
        include: {
          user: {
            select: {
              user_id: true,
              first_name: true,
              last_name: true,
              email: true,
            },
          },
          notification: {
            select: {
              id: true,
              event_type: true,
              title: true,
            },
          },
        },
      }),
      prisma.notificationEmailQueue.count({ where }),
      prisma.notificationEmailQueue.groupBy({
        by: ["status"],
        where,
        _count: { _all: true },
      }),
    ]);

    const summary: Record<string, number> = {};
    for (const group of groupedByStatus) {
      summary[group.status] = group._count._all;
    }

    return jsonSuccess(
      {
        logs: rows.map((row) => ({
          id: row.id,
          user_id: row.user_id.toString(),
          user: {
            user_id: row.user.user_id.toString(),
            name: `${row.user.first_name} ${row.user.last_name}`.trim(),
            email: row.user.email,
          },
          notification: row.notification
            ? {
                id: row.notification.id,
                event_type: row.notification.event_type,
                title: row.notification.title,
              }
            : null,
          email_type: row.email_type,
          subject: row.subject,
          template_name: row.template_name,
          recipient_email: row.recipient_email,
          recipient_name: row.recipient_name,
          status: row.status,
          priority: row.priority,
          attempts: row.attempts,
          max_attempts: row.max_attempts,
          last_attempt: row.last_attempt,
          sent_at: row.sent_at,
          error_message: row.error_message,
          created_at: row.created_at,
          updated_at: row.updated_at,
        })),
        summary,
        pagination: {
          page,
          limit,
          total,
          pages: Math.max(1, Math.ceil(total / limit)),
        },
      },
      {
        requestId,
        responseTime: Date.now() - startedAt,
      }
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/company/notifications/logs GET] Unexpected error", {
      requestId,
      error,
    });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
