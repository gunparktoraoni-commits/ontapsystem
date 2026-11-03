import { NextRequest, NextResponse } from "next/server";
import { withSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { listSuperAdminUserBizcards } from "@/server/lib/superadmin/user-bizcards";

function parsePositiveInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export const GET = withSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId } = context;

  const rateCheck = checkRateLimit("superadmin-user-bizcards", req.headers.get("x-forwarded-for") ?? "unknown");
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SUPERADMIN_BIZCARDS_RATE_LIMITED",
          tag: "[SUPERADMIN_BIZCARDS]",
          message: "Too many user bizcard requests. Please slow down.",
        },
      },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } },
    );
  }

  const searchParams = req.nextUrl.searchParams;
  const status = (searchParams.get("status") ?? "all").trim().toLowerCase();
  if (status !== "all" && status !== "active" && status !== "restricted") {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SUPERADMIN_BIZCARDS_INVALID_STATUS",
          tag: "[SUPERADMIN_BIZCARDS]",
          message: "Invalid status filter.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const data = await listSuperAdminUserBizcards({
      page: parsePositiveInt(searchParams.get("page"), 1, 1, 100000),
      limit: parsePositiveInt(searchParams.get("limit"), 20, 1, 100),
      search: searchParams.get("search")?.trim() || undefined,
      status,
    });

    return NextResponse.json({
      success: true,
      data,
      meta: {
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[SUPERADMIN_BIZCARDS] Failed to fetch user bizcards", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SUPERADMIN_BIZCARDS_FETCH_FAILED",
          tag: "[SUPERADMIN_BIZCARDS]",
          message: "Failed to fetch user bizcards.",
        },
      },
      { status: 500 },
    );
  }
}, { errorMode: "superadmin" });
