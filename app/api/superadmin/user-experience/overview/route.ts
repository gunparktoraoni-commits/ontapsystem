import { NextRequest, NextResponse } from "next/server";
import { withSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp } from "@/server/lib/auth";
import { getOverviewMetrics } from "@/lib/services/superadmin-user-experience.service";

export const GET = withSuperAdmin(async (req: NextRequest, context) => {
  const { requestId } = context;
  const ip = getClientIp(req);
  const rateCheck = checkRateLimit("superadmin-user-experience", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests.",
        },
      },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
      },
    );
  }

  try {
    const data = await getOverviewMetrics();
    return NextResponse.json({ success: true, data, meta: { requestId } });
  } catch (error) {
    console.error("[SUPERADMIN_USER_EXPERIENCE_OVERVIEW]", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "OVERVIEW_FETCH_FAILED",
          message: "Failed to load user experience overview.",
        },
      },
      { status: 500 },
    );
  }
}, { errorMode: "superadmin" });
