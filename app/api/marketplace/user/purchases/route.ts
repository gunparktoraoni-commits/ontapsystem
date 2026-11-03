// GET /api/marketplace/user/purchases
// Auth required — paginated list of user's purchase logs.
// Rate limit: 60/min per IP.
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

function parsePositiveInt(raw: string | null, fallback: number, max?: number): number {
  const n = raw ? Number(raw) : fallback;
  const result = Number.isInteger(n) && n > 0 ? n : fallback;
  return max !== undefined ? Math.min(result, max) : result;
}

const ALLOWED_ITEM_TYPES = new Set(["merchandise", "template", "subscription_plan"]);

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);

  const rateCheck = checkRateLimit("marketplace-purchases-list", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const { session } = auth;

  try {
    const userId = BigInt(session.userId);
    const q = request.nextUrl.searchParams;
    const page = parsePositiveInt(q.get("page"), 1);
    const limit = parsePositiveInt(q.get("limit"), 20, 50);
    const skip = (page - 1) * limit;
    const rawType = q.get("item_type") ?? "";
    const itemTypeFilter = ALLOWED_ITEM_TYPES.has(rawType) ? rawType : null;

    const where = {
      user_id: userId,
      ...(itemTypeFilter ? { purchase_type: itemTypeFilter } : {}),
    };

    const [logs, total] = await Promise.all([
      prisma.purchaseLog.findMany({
        where,
        orderBy: { purchased_at: "desc" },
        skip,
        take: limit,
      }),
      prisma.purchaseLog.count({ where }),
    ]);

    // For templates, check if still downloadable
    const templatePurchaseIds = logs
      .filter((l) => l.purchase_type === "template")
      .map((l) => l.item_id);

    let ownedTemplateIds = new Set<string>();
    if (templatePurchaseIds.length > 0) {
      const tp = await prisma.templatePurchase.findMany({
        where: { user_id: userId, template_id: { in: templatePurchaseIds } },
        select: { template_id: true },
      });
      ownedTemplateIds = new Set(tp.map((t) => t.template_id.toString()));
    }

    return NextResponse.json(serialize({
      success: true,
      data: {
        purchases: logs.map((l) => ({
          id: l.id.toString(),
          itemType: l.purchase_type,
          itemId: l.item_id.toString(),
          itemName: l.item_name,
          quantity: 1,
          amountPaid: Number(l.amount),
          orderId: l.order_id?.toString() ?? null,
          promoId: null,
          createdAt: l.purchased_at,
          actions: {
            canDownload:
              l.purchase_type === "template" && ownedTemplateIds.has(l.item_id.toString())
                ? `/api/marketplace/templates/download/${l.item_id}`
                : null,
          },
        })),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    }));
  } catch (err) {
    console.error("[marketplace/user/purchases GET]", err);
    return NextResponse.json({ success: false, error: "An unexpected error occurred." }, { status: 500 });
  }
}
