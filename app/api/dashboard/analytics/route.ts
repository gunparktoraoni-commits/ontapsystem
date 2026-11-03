import { NextRequest, NextResponse } from "next/server";
import { format } from "date-fns";
import { prisma } from "@/server/lib/prisma";
import { prismaAnalytics } from "@/server/lib/prisma-analytics";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, validateToken } from "@/server/lib/auth";
import { buildVCardPublicUrl } from "@/server/lib/qr";
import { resolveBizcardDashboardDateRange } from "@/lib/services/bizcard-dashboard.service";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

function isPoolTimeoutError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2024"
  );
}

async function safeAnalyticsCount(run: () => Promise<number>, label: string): Promise<number> {
  try {
    return await run();
  } catch (err) {
    if (isPoolTimeoutError(err)) {
      console.warn(`[dashboard/analytics] ${label} fallback to 0 due to analytics pool timeout (P2024).`);
      return 0;
    }
    throw err;
  }
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);

  try {
    const rateCheck = checkRateLimit("dashboard-analytics", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    const rawToken = request.cookies.get("session_token")?.value;
    if (!rawToken) {
      return NextResponse.json({ error: "Authentication required.", requiresAuth: true }, { status: 401 });
    }

    const session = await validateToken(rawToken);
    if (!session) {
      return NextResponse.json({ error: "Session expired. Please log in again.", requiresAuth: true }, { status: 401 });
    }

    const userId = BigInt(session.userId);
    const monthRange = resolveBizcardDashboardDateRange("this_month");
    const monthStart = monthRange.start;
    const monthEnd = monthRange.end;
    const metricsPeriod = format(monthStart, "yyyy-MM");

    const [profileViews, associates, inquiries, contactSaves, owner] = await Promise.all([
      safeAnalyticsCount(
        () =>
          prismaAnalytics.portfolioView.count({
            where: {
              portfolio_owner_id: userId,
              created_at: { gte: monthStart, lte: monthEnd },
            },
          }),
        "portfolioView.count"
      ),
      prisma.connection.count({
        where: {
          status: "accepted",
          OR: [{ requester_user_id: userId }, { recipient_user_id: userId }],
          created_at: { gte: monthStart, lte: monthEnd },
        },
      }),
      prisma.inquiry.count({
        where: {
          user_id: userId,
          created_at: { gte: monthStart, lte: monthEnd },
        },
      }),
      safeAnalyticsCount(
        () =>
          prismaAnalytics.contactSave.count({
            where: {
              portfolio_owner_id: userId,
              created_at: { gte: monthStart, lte: monthEnd },
            },
          }),
        "contactSave.count"
      ),
      prisma.user.findUnique({
        where: { user_id: userId },
        select: { custom_uri: true },
      }),
    ]);

    const publicPortfolioUrl = owner?.custom_uri
      ? buildVCardPublicUrl(owner.custom_uri)
      : null;

    return NextResponse.json(
      serialize({
        profileViews,
        associates,
        inquiries,
        contactSaves,
        metricsPeriod,
        publicPortfolioUrl,
      }),
      { status: 200 }
    );
  } catch (err) {
    console.error("[dashboard/analytics] Unhandled error:", err);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
