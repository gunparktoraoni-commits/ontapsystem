import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

async function requireSuperAdmin(request: NextRequest) {
  const result = await resolveRequestSession(request);
  if (!result.session) {
    return { ok: false as const, response: NextResponse.json({ error: "Authentication required." }, { status: 401 }) };
  }
  if (result.session.role !== "super_admin") {
    return { ok: false as const, response: NextResponse.json({ error: "Forbidden." }, { status: 403 }) };
  }
  return { ok: true as const, session: result.session };
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("superadmin-dashboard", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  const auth = await requireSuperAdmin(request);
  if (!auth.ok) return auth.response;

  try {
    const now = new Date();
    const [totalUsers, activeSubscriptions, totalOrders, totalRevenue] = await Promise.all([
      prisma.user.count({ where: { role: "user" } }),
      prisma.bizcardSubscription.count({
        where: {
          status: "active",
          expires_at: { gt: now },
        },
      }),
      prisma.shopOrder.count({ where: { status: "completed" } }),
      prisma.shopOrder.aggregate({
        where: { status: "completed" },
        _sum: { total_amount: true },
      }),
    ]);

    const subsByPlan = await prisma.bizcardSubscription.groupBy({
      by: ["plan_id"],
      where: { status: "active", expires_at: { gt: now } },
      _count: { id: true },
    });
    const planIds = subsByPlan.map(s => s.plan_id);
    const plans = planIds.length ? await prisma.subscriptionPlan.findMany({
      where: { id: { in: planIds } },
      select: { id: true, name: true },
    }) : [];
    const planMap = new Map(plans.map(p => [p.id.toString(), p]));

    return NextResponse.json(serialize({
      success: true,
      data: {
        total_users: totalUsers,
        active_subscriptions: activeSubscriptions,
        total_orders: totalOrders,
        total_revenue: totalRevenue._sum.total_amount || 0,
        subscription_by_plan: subsByPlan.map(s => ({
          planId: s.plan_id.toString(),
          planName: planMap.get(s.plan_id.toString())?.name || "Unknown",
          count: s._count.id,
        })),
      },
    }));
  } catch (err) {
    console.error("[superadmin/dashboard GET]", err);
    return NextResponse.json({ success: false, error: "An unexpected error occurred." }, { status: 500 });
  }
}