// GET /api/marketplace/templates
// Optional-auth endpoint — lists templates (Theme model + marketplace fields).
// If authenticated, decorates each template with is_owned flag.
// Filters: tag (free/paid/premium), category, search, price range, owned_only.
// Rate limit: 120/min per IP.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { validateToken, resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { Prisma } from "@prisma/client";
import { resolveCompanyThemePolicyForUser } from "@/server/lib/company";
import { resolveHitachiCompanyIds } from "@/lib/constants/hitachi-companies";
import { buildThemeVisibilityOrFilters } from "@/lib/services/theme-visibility.service";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

const VALID_TAGS = new Set(["free", "paid", "premium"]);

function parsePositiveInt(raw: string | null, fallback: number, max?: number): number {
  const n = raw ? Number(raw) : fallback;
  const result = Number.isInteger(n) && n > 0 ? n : fallback;
  return max !== undefined ? Math.min(result, max) : result;
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);

  const rateCheck = checkRateLimit("marketplace-templates-list", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  try {
    // Optional auth — Bearer token or cookie/session
    let userId: bigint | null = null;
    const authHeader = request.headers.get("authorization");
    const rawToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (rawToken) {
      const payload = await validateToken(rawToken);
      if (payload?.userId) userId = BigInt(payload.userId);
    }
    if (!userId) {
      const sessionResult = await resolveRequestSession(request);
      if (sessionResult.session?.userId) userId = BigInt(sessionResult.session.userId);
    }
    let companyId: bigint | null = null;
    if (userId) {
      await resolveHitachiCompanyIds(prisma);
      const policy = await resolveCompanyThemePolicyForUser(userId);
      companyId = policy.companyId ? BigInt(policy.companyId) : null;
    }
    const visibilityFilters = buildThemeVisibilityOrFilters({ userId, companyId });

    const q = request.nextUrl.searchParams;
    const page = parsePositiveInt(q.get("page"), 1);
    const limit = parsePositiveInt(q.get("limit"), 20, 50);
    const skip = (page - 1) * limit;

    const rawTag = q.get("tag") ?? "";
    const tag = VALID_TAGS.has(rawTag) ? rawTag : null;
    const category = (q.get("category") ?? "").trim().substring(0, 100) || null;
    const search = (q.get("search") ?? "").trim().substring(0, 100);
    const rawMin = q.get("min_price");
    const rawMax = q.get("max_price");
    const minPrice = rawMin ? Math.max(0, parseFloat(rawMin)) : null;
    const maxPrice = rawMax ? Math.max(0, parseFloat(rawMax)) : null;
    const ownedOnly = q.get("owned_only") === "true" && userId !== null;

    // Build where clause
    const marketplaceFilter: Prisma.ThemeWhereInput = {
      NOT: { tag: undefined },
      ...(tag ? { tag } : {}),
      ...(category ? { category } : {}),
      ...(search
        ? {
            OR: [
              { theme_name: { contains: search } },
              { category: { contains: search } },
            ],
          }
        : {}),
      ...(minPrice !== null || maxPrice !== null
        ? {
            price: {
              ...(minPrice !== null ? { gte: new Prisma.Decimal(minPrice) } : {}),
              ...(maxPrice !== null ? { lte: new Prisma.Decimal(maxPrice) } : {}),
            },
          }
        : {}),
      ...(ownedOnly && userId !== null
        ? { templatePurchases: { some: { user_id: userId } } }
        : {}),
    };
    const where: Prisma.ThemeWhereInput = {
      AND: [{ OR: visibilityFilters }, marketplaceFilter],
    };

    const [templates, total, tagCounts, priceAgg] = await Promise.all([
      prisma.theme.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          theme_name: true,
          theme_path: true,
          tag: true,
          price: true,
          preview_images: true,
          category: true,
          download_count: true,
          created_at: true,
        },
      }),
      prisma.theme.count({ where }),
      prisma.theme.groupBy({
        by: ["tag"],
        where: {
          AND: [
            { OR: visibilityFilters },
            { NOT: { tag: undefined }, ...(category ? { category } : {}) },
          ],
        },
        _count: { tag: true },
      }),
      prisma.theme.aggregate({
        where: { AND: [{ OR: visibilityFilters }, { NOT: { tag: undefined } }] },
        _min: { price: true },
        _max: { price: true },
      }),
    ]);

    // Ownership lookup for authenticated users
    let ownedIds = new Set<string>();
    if (userId && templates.length > 0) {
      const templateIds = templates.map((t) => t.id);
      const purchases = await prisma.templatePurchase.findMany({
        where: { user_id: userId, template_id: { in: templateIds } },
        select: { template_id: true },
      });
      ownedIds = new Set(purchases.map((p) => p.template_id.toString()));
    }

    const response = {
      success: true,
      data: {
        templates: templates.map((t) => {
          const idStr = t.id.toString();
          return {
            id: idStr,
            name: t.theme_name,
            themePath: t.theme_path,
            tag: t.tag,
            price: Number(t.price),
            previewImages: t.preview_images,
            category: t.category,
            downloadCount: t.download_count,
            isFree: t.tag === "free" || Number(t.price) === 0,
            isOwned: ownedIds.has(idStr),
            canDownload: t.tag === "free" || ownedIds.has(idStr),
            createdAt: t.created_at,
          };
        }),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
        filters: {
          tags: tagCounts.map((c) => ({ name: c.tag, count: c._count.tag })),
          priceRange: {
            min: Number(priceAgg._min.price ?? 0),
            max: Number(priceAgg._max.price ?? 0),
          },
        },
      },
    };

    return NextResponse.json(serialize(response));
  } catch (err) {
    console.error("[marketplace/templates GET]", err);
    return NextResponse.json({ success: false, error: "An unexpected error occurred." }, { status: 500 });
  }
}
