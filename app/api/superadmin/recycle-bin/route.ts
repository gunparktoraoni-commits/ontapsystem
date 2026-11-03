import { NextRequest, NextResponse } from "next/server";
import { withSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { listRecycleBinUserBizcards } from "@/server/lib/superadmin/user-bizcards";

function parsePositiveInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export const GET = withSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId } = context;

  const rateCheck = checkRateLimit(
    "superadmin-recycle-bin",
    req.headers.get("x-forwarded-for") ?? "unknown",
  );
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SUPERADMIN_RECYCLE_BIN_RATE_LIMITED",
          tag: "[SUPERADMIN_RECYCLE_BIN]",
          message: "Too many Recycle Bin requests. Please slow down.",
        },
      },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } },
    );
  }

  try {
    const searchParams = req.nextUrl.searchParams;
    const data = await listRecycleBinUserBizcards({
      page: parsePositiveInt(searchParams.get("page"), 1, 1, 100000),
      limit: parsePositiveInt(searchParams.get("limit"), 20, 1, 100),
      search: searchParams.get("search")?.trim() || undefined,
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
    console.error("[SUPERADMIN_RECYCLE_BIN] Failed to fetch recycle bin", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SUPERADMIN_RECYCLE_BIN_FETCH_FAILED",
          tag: "[SUPERADMIN_RECYCLE_BIN]",
          message: "Failed to fetch Recycle Bin entries.",
        },
      },
      { status: 500 },
    );
  }
}, { errorMode: "superadmin" });
