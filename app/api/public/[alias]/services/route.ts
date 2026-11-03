import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp } from "@/server/lib/auth";
import { CACHE_TTL, generateCacheKey, getCached } from "@/lib/cache";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

function formatPriceDisplay(price: number | null, currency: string | null, negotiable: boolean): string {
  if (negotiable || price === null) return "Contact for pricing";
  const code = currency ?? "USD";
  try {
    return `Starting at ${new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(price)}`;
  } catch {
    return `Starting at ${price.toFixed(2)} ${code}`;
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ alias: string }> }) {
  const ip = getClientIp(request);

  try {
    const rateCheck = checkRateLimit("public-services", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)),
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    const { alias } = await params;
    const cacheKey = generateCacheKey("public", "services", alias.toLowerCase());

    const { data, cached } = await getCached(
      cacheKey,
      async () => {
        let bizcard = await prisma.bizcard.findFirst({
          where: { url_alias: alias },
          select: {
            bizcard_id: true,
            user_id: true,
            url_alias: true,
            bizcard_name: true,
            first_name: true,
            last_name: true,
            deactivated_flag: true,
            user: {
              select: {
                user_id: true,
                is_active: true,
              },
            },
          },
        });

        if (!bizcard) {
          bizcard = await prisma.bizcard.findFirst({
            where: {
              deactivated_flag: false,
              user: {
                custom_uri: alias,
              },
            },
            orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
            select: {
              bizcard_id: true,
              user_id: true,
              url_alias: true,
              bizcard_name: true,
              first_name: true,
              last_name: true,
              deactivated_flag: true,
              user: {
                select: {
                  user_id: true,
                  is_active: true,
                },
              },
            },
          });
        }

        if (!bizcard || !bizcard.user || bizcard.deactivated_flag || !bizcard.user.is_active) {
          return null;
        }

        const resolvedAlias = bizcard.url_alias ?? alias;

        const services = await prisma.service.findMany({
          where: {
            OR: [{ bizcard_id: bizcard.bizcard_id }, { user_id: bizcard.user.user_id }],
            is_visible: true,
            status: "active",
          },
          orderBy: [{ featured: "desc" }, { display_order: "asc" }, { created_at: "desc" }],
          select: {
            service_id: true,
            name: true,
            description: true,
            tagline: true,
            price: true,
            currency_code: true,
            is_price_negotiable: true,
            featured: true,
            featured_image: true,
            updated_at: true,
            serviceMedia: {
              orderBy: { display_order: "asc" },
              take: 5,
              select: {
                id: true,
                file_url: true,
                mime_type: true,
                file_name: true,
              },
            },
          },
        });

        const fallbackServiceMedia =
          services.length === 1
            ? await prisma.media.findMany({
                where: {
                  user_id: bizcard.user.user_id,
                  deleted_at: null,
                  is_active: true,
                  related_type: { in: ["service_gallery", "service", "vcard/services"] },
                  related_id: { in: [bizcard.bizcard_id, bizcard.user.user_id] },
                },
                orderBy: [{ display_order: "asc" }, { created_at: "asc" }],
                select: {
                  media_id: true,
                  file_url: true,
                  mime_type: true,
                  file_name: true,
                },
                take: 5,
              })
            : [];

        const mappedServices = services.map((svc) => ({
          id: svc.service_id,
          name: svc.name,
          description: svc.description,
          tagline: svc.tagline,
          price: svc.price,
          currency: svc.currency_code,
          price_display: formatPriceDisplay(
            svc.price !== null ? Number(svc.price) : null,
            svc.currency_code,
            svc.is_price_negotiable
          ),
          is_price_negotiable: svc.is_price_negotiable,
          featured: svc.featured,
          featured_image:
            (typeof svc.featured_image === "string" && svc.featured_image.startsWith("http"))
              ? svc.featured_image
              : (svc.serviceMedia?.[0]?.file_url ??
                  fallbackServiceMedia[0]?.file_url ??
                  svc.featured_image),
          media: (
            (svc.serviceMedia ?? []).length > 0
              ? (svc.serviceMedia ?? []).map((m) => ({
                  id: String(m.id),
                  url: m.file_url,
                  mimeType: m.mime_type,
                  fileName: m.file_name,
                }))
              : (services.length === 1
                  ? fallbackServiceMedia.map((m) => ({
                      id: String(m.media_id),
                      url: m.file_url,
                      mimeType: m.mime_type,
                      fileName: m.file_name,
                    }))
                  : [])
          ),
        }));

        const lastUpdated = services
          .map((svc) => svc.updated_at)
          .filter((v): v is Date => Boolean(v))
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

        return {
          success: true,
          data: {
            alias: resolvedAlias,
            username: resolvedAlias,
            display_name: bizcard.bizcard_name ?? `${bizcard.first_name} ${bizcard.last_name}`.trim(),
            services: mappedServices,
            meta: {
              total_services: mappedServices.length,
              last_updated: lastUpdated,
            },
          },
        };
      },
      CACHE_TTL.PUBLIC_SERVICES
    );

    if (!data) {
      return NextResponse.json(
        { success: false, error: "Portfolio not found." },
        { status: 404, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    const response = NextResponse.json(serialize(data), {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "private, no-store, no-cache, must-revalidate",
      },
    });

    response.headers.set("X-Cache", cached ? "HIT" : "MISS");
    return response;
  } catch (err) {
    console.error("[public/[alias]/services GET] Unhandled error:", err);
    return NextResponse.json(
      { success: false, error: "An unexpected error occurred." },
      { status: 500, headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }
}
