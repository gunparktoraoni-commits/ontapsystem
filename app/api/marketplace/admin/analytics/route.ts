// GET /api/marketplace/admin/analytics
// Admin-only endpoint — aggregate revenue, orders, subscriptions, promotions metrics.
// Supports date range filtering via ?from=ISO&to=ISO.
// Rate limit: 30/min per IP (expensive aggregates).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

async function requireSession(request: NextRequest) {
  const result = await resolveRequestSession(request);
  if (!result.session) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Authentication required.", requiresAuth: true },
        { status: 401 }
      ),
    };
  }
  return { ok: true as const, session: result.session };
}

function isAdminRole(role: string): boolean {
  return role === "admin" || role === "company_admin";
}

function parseDateParam(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);

  const rateCheck = checkRateLimit("marketplace-admin-analytics", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const { session } = auth;

  if (!isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden. Admin access required." }, { status: 403 });
  }

  try {
    const q = request.nextUrl.searchParams;
    const fromDate = parseDateParam(q.get("from")) ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // default: last 30 days
    const toDate = parseDateParam(q.get("to")) ?? new Date();

    // Clamp range to max 1-year window
    const maxRangeMs = 366 * 24 * 60 * 60 * 1000;
    const effectiveTo = toDate > fromDate ? toDate : new Date();
    const effectiveFrom = effectiveTo.getTime() - fromDate.getTime() > maxRangeMs
      ? new Date(effectiveTo.getTime() - maxRangeMs)
      : fromDate;

    const dateWhere = { gte: effectiveFrom, lte: effectiveTo };

    // Use bizcardSubscription instead of userSubscription
    const [
      orderAgg,
      ordersByStatus,
      topProducts,
      topTemplates,
      activeSubs,
      subsByPlan,
      newSubsInRange,
      topPromos,
      uniqueBuyers,
    ] = await Promise.all([
      prisma.shopOrder.aggregate({
        where: { placed_at: dateWhere, status: { not: "cancelled" } },
        _sum: { total_amount: true },
        _count: { id: true },
        _avg: { total_amount: true },
      }),
      prisma.shopOrder.groupBy({
        by: ["status"],
        where: { placed_at: dateWhere },
        _count: { id: true },
      }),
      prisma.purchaseLog.groupBy({
        by: ["item_id", "item_name"],
        where: {
          purchase_type: "merchandise",
          purchased_at: dateWhere,
        },
        _sum: { amount: true },
        _count: { id: true },
        orderBy: { _sum: { amount: "desc" } },
        take: 5,
      }),
      prisma.templatePurchase.groupBy({
        by: ["template_id"],
        where: { purchased_at: dateWhere },
        _count: { template_id: true },
        orderBy: { _count: { template_id: "desc" } },
        take: 5,
      }),
      // Replace userSubscription with bizcardSubscription
      prisma.bizcardSubscription.count({ where: { status: "active" } }),
      prisma.bizcardSubscription.groupBy({
        by: ["plan_id"],
        where: { status: "active" },
        _count: { id: true },
      }),
      // Use started_at as creation time (or created_at if available)
      prisma.bizcardSubscription.count({
        where: {
          started_at: dateWhere,
          status: "active",
        },
      }),
      prisma.shopOrder.groupBy({
        by: ["promo_id"],
        where: { promo_id: { not: null }, placed_at: dateWhere },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 5,
      }),
      prisma.purchaseLog.findMany({
        where: { purchased_at: dateWhere },
        select: { user_id: true },
        distinct: ["user_id"],
      }),
    ]);

    // Fetch plan names for subscription breakdown
    const planIds = subsByPlan.map((s) => s.plan_id).filter(Boolean) as bigint[];
    const plans = planIds.length > 0
      ? await prisma.subscriptionPlan.findMany({
          where: { id: { in: planIds } },
          select: { id: true, name: true },
        })
      : [];
    const planMap = new Map(plans.map((p) => [p.id.toString(), p]));

    // Fetch promo codes for breakdown
    const promoIds = topPromos.map((p) => p.promo_id).filter(Boolean) as bigint[];
    const promos = promoIds.length > 0
      ? await prisma.promotion.findMany({
          where: { id: { in: promoIds } },
          select: { id: true, code: true, promo_name: true },
        })
      : [];
    const promoMap = new Map(promos.map((p) => [p.id.toString(), p]));

    return NextResponse.json(serialize({
      success: true,
      data: {
        dateRange: { from: effectiveFrom, to: effectiveTo },

        revenue: {
          totalRevenue: Number(orderAgg._sum.total_amount ?? 0),
          totalOrders: orderAgg._count.id,
          averageOrderValue: Number(orderAgg._avg.total_amount ?? 0),
          ordersByStatus: ordersByStatus.map((o) => ({ status: o.status, count: o._count.id })),
        },

        products: {
          topByRevenue: topProducts.map((p) => ({
            itemId: p.item_id.toString(),
            name: p.item_name,
            revenue: Number(p._sum.amount ?? 0),
            orders: p._count.id,
          })),
        },

        templates: {
          topByDownloads: topTemplates.map((t) => ({
            templateId: t.template_id.toString(),
            downloads: t._count.template_id,
          })),
        },

        subscriptions: {
          activeCount: activeSubs,
          newInRange: newSubsInRange,
          byPlan: subsByPlan.map((s) => {
            const plan = planMap.get(s.plan_id.toString());
            return {
              planId: s.plan_id.toString(),
              planName: plan?.name ?? "Unknown",
              tier: null,
              count: s._count.id,
            };
          }),
        },

        promotions: {
          topUsed: topPromos.map((p) => {
            const promo = promoMap.get(p.promo_id?.toString() ?? "");
            return {
              promoId: p.promo_id?.toString() ?? null,
              code: promo?.code ?? "Unknown",
              name: promo?.promo_name ?? null,
              uses: p._count.id,
            };
          }),
        },

        customers: {
          uniqueBuyersInRange: uniqueBuyers.length,
        },
      },
    }));
  } catch (err) {
    console.error("[marketplace/admin/analytics GET]", err);
    return NextResponse.json({ success: false, error: "An unexpected error occurred." }, { status: 500 });
  }
}