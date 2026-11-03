// GET /api/marketplace/products
// Public endpoint — lists active merchandise with filtering, search, pagination.
// Rate limit: 120/min per IP.
// Cache: 5-minute in-memory cache on the product list + filter counts.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { Prisma } from "@prisma/client";
import { resolveMerchandiseBasePrice } from "@/lib/pricing/product-pricing.service";
import { sortMerchandiseByCatalogOrder } from "@/lib/merchandise-catalog-order";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

// ── 5-minute in-memory cache ────────────────────────────────────────────────
interface CacheEntry<T> { data: T; expiresAt: number }
const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry || Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.data;
}
function setCached<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// ── Query helpers ────────────────────────────────────────────────────────────
const ALLOWED_CATEGORIES = new Set([
  "business_card", "dog_tag", "id_card", "keychain",
  "lanyard", "badge", "sticker", "custom",
]);

const SORT_MAP: Record<string, { field: string; order: "asc" | "desc" }> = {
  catalog: { field: "catalog", order: "asc" },
  newest:  { field: "created_at",     order: "desc" },
  oldest:  { field: "created_at",     order: "asc"  },
  price_asc:  { field: "price", order: "asc"  },
  price_desc: { field: "price", order: "desc" },
  popular:    { field: "id",    order: "desc" },
  name:   { field: "name",  order: "asc"  },
};

function parsePositiveInt(raw: string | null, fallback: number, max?: number): number {
  const n = raw ? Number(raw) : fallback;
  const result = Number.isInteger(n) && n > 0 ? n : fallback;
  return max !== undefined ? Math.min(result, max) : result;
}

function parsePositiveFloat(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);

  const rateCheck = checkRateLimit("marketplace-products-list", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  try {
    const q = request.nextUrl.searchParams;
    const rawCategory = q.get("category") ?? "all";
    const category = rawCategory !== "all" && ALLOWED_CATEGORIES.has(rawCategory) ? rawCategory : null;
    const page = parsePositiveInt(q.get("page"), 1);
    const limit = parsePositiveInt(q.get("limit"), 20, 50);
    const skip = (page - 1) * limit;

    const rawSort = q.get("sort_by") ?? "catalog";
    const sortDir = (q.get("sort_dir") ?? "") === "asc" ? "asc" : null;
    let sortKey = SORT_MAP[rawSort] ? rawSort : "catalog";
    // Allow overriding direction via sort_dir param
    if (sortDir && (rawSort === "price_asc" || rawSort === "price_desc")) {
      sortKey = sortDir === "asc" ? "price_asc" : "price_desc";
    } else if (sortDir && rawSort !== "catalog") {
      sortKey = sortDir === "asc" ? "oldest" : "newest";
    }
    const sort = SORT_MAP[sortKey];
    const useCatalogOrder = sortKey === "catalog";

    const minPrice = parsePositiveFloat(q.get("min_price"));
    const maxPrice = parsePositiveFloat(q.get("max_price"));
    // stock availability filter removed — inventory no longer tracked by stock_quantity
    const inStockOnly = false;
    const search = (q.get("search") ?? "").trim().substring(0, 100);

    // Build cache key from stable params
    const cacheKey = `products:${category}:${page}:${limit}:${sortKey}:${minPrice}:${maxPrice}:${inStockOnly}:${search}`;
    const cached = getCached<unknown>(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const where: Prisma.MerchandiseWhereInput = {
      is_active: true,
      ...(category ? { category } : {}),
      ...(minPrice !== null || maxPrice !== null ? {
        price: {
          ...(minPrice !== null ? { gte: minPrice } : {}),
          ...(maxPrice !== null ? { lte: maxPrice } : {}),
        }
      } : {}),
      // stock_quantity filter removed
      ...(search ? {
        OR: [
          { name: { contains: search } },
          { description: { contains: search } },
        ]
      } : {}),
    };

    const orderBy: Prisma.MerchandiseOrderByWithRelationInput =
      sort.field === "price"
        ? { price: sort.order }
        : sort.field === "name"
        ? { name: sort.order as "asc" | "desc" }
        : sort.field === "created_at"
        ? { created_at: sort.order }
        : { name: "asc" };

    const [rawProducts, total, categoryCounts, priceAgg] = await Promise.all([
      useCatalogOrder
        ? prisma.merchandise.findMany({ where, orderBy: { name: "asc" } })
        : prisma.merchandise.findMany({ where, orderBy, skip, take: limit }),
      prisma.merchandise.count({ where }),
      // Filter counts — always uses is_active + search/price to stay relevant
      prisma.merchandise.groupBy({
        by: ["category"],
        where: {
          is_active: true,
          // stock_quantity filter removed
          ...(search ? {
            OR: [
              { name: { contains: search } },
              { description: { contains: search } },
            ]
          } : {}),
        },
        _count: { category: true },
      }),
      // Price range across all active products
      prisma.merchandise.aggregate({
        where: { is_active: true },
        _min: { price: true },
        _max: { price: true },
      }),
    ]);

    const products = useCatalogOrder
      ? sortMerchandiseByCatalogOrder(rawProducts).slice(skip, skip + limit)
      : rawProducts;

    const response = {
      success: true,
      data: {
        products: products.map((p) => ({
          id: p.id.toString(),
          name: p.name,
          description: p.description,
          price: resolveMerchandiseBasePrice(p),
          listPrice: Number(p.price),
          customPrice: p.custom_price,
          customPriceValue:
            p.custom_price_value !== null ? Number(p.custom_price_value) : null,
          imgUrl: p.img_url,
          category: p.category,
          metadata: p.metadata,
          createdAt: p.created_at,
        })),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
        filters: {
          categories: categoryCounts.map((c) => ({
            name: c.category,
            count: c._count.category,
          })),
          priceRange: {
            min: Number(priceAgg._min.price ?? 0),
            max: Number(priceAgg._max.price ?? 0),
          },
        },
      },
    };

    setCached(cacheKey, serialize(response), 5 * 60 * 1000);
    return NextResponse.json(serialize(response));
  } catch (err) {
    console.error("[marketplace/products GET]", err);
    return NextResponse.json({ success: false, error: "An unexpected error occurred." }, { status: 500 });
  }
}
