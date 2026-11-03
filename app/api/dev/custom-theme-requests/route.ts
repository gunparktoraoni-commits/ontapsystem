import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  CUSTOM_THEME_DEV_VISIBLE_STATUSES,
  CUSTOM_THEME_PAYMENT_PENDING_STATUSES,
  customThemeRequestUserInclude,
  isCustomThemeDevVisibleStatus,
  isCustomThemeRequestStatus,
  serializeCustomThemeRequest,
} from "@/server/lib/custom-theme-request";

async function requireDevSession(request: NextRequest) {
  const result = await resolveRequestSession(request, { tryRefresh: true });
  if (!result.session) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: "Authentication required." },
        { status: 401 },
      ),
    };
  }
  const role = String(result.session.role ?? "").trim().toLowerCase();
  if (!["dev", "super_admin", "superadmin"].includes(role)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: "Insufficient permissions." },
        { status: 403 },
      ),
    };
  }
  return { ok: true as const, session: result.session };
}

/**
 * GET /api/dev/custom-theme-requests
 * List custom theme / paid template design requests for the developer portal.
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rate = checkRateLimit("dev-custom-theme-requests-list", ip);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many requests." },
      { status: 429 },
    );
  }

  const auth = await requireDevSession(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const q = url.searchParams.get("q")?.trim() || "";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const pageSize = Math.min(
    50,
    Math.max(1, Number(url.searchParams.get("pageSize") || 20)),
  );
  const skip = (page - 1) * pageSize;

  const where: Prisma.CustomThemeRequestWhereInput = {
    // Pay-first: unpaid drafts never appear in the developer queue.
    status: { in: [...CUSTOM_THEME_DEV_VISIBLE_STATUSES] },
  };
  if (status && isCustomThemeRequestStatus(status)) {
    if (isCustomThemeDevVisibleStatus(status)) {
      where.status = status;
    } else if (
      (CUSTOM_THEME_PAYMENT_PENDING_STATUSES as readonly string[]).includes(
        status,
      )
    ) {
      // Explicit unpaid filter is blocked — keep empty queue rather than leak drafts.
      where.status = { in: [] };
    }
  }
  if (q) {
    where.OR = [
      { reference_number: { contains: q } },
      { project_name: { contains: q } },
      { industry: { contains: q } },
      { more_details: { contains: q } },
      { user: { email: { contains: q } } },
      { user: { first_name: { contains: q } } },
      { user: { last_name: { contains: q } } },
    ];
  }

  const paidWhere: Prisma.CustomThemeRequestWhereInput = {
    status: { in: [...CUSTOM_THEME_DEV_VISIBLE_STATUSES] },
  };

  const [rows, total, pendingCount, reviewingCount] = await Promise.all([
    prisma.customThemeRequest.findMany({
      where,
      include: customThemeRequestUserInclude,
      orderBy: { created_at: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.customThemeRequest.count({ where }),
    prisma.customThemeRequest.count({
      where: { ...paidWhere, status: "pending" },
    }),
    prisma.customThemeRequest.count({
      where: { ...paidWhere, status: "reviewing" },
    }),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      requests: rows.map(serializeCustomThemeRequest),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
      counts: {
        pending: pendingCount,
        reviewing: reviewingCount,
        total,
      },
    },
  });
}
