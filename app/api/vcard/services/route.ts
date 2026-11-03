import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { withPerformanceTracking } from "@/middleware/performance";
import {
  ensureSectionType,
  getOptionalSessionUserId,
  resolveProfileByUsernameOrId,
  serializeBigInts,
  toIsoOrNull,
  toNullableString,
} from "@/lib/vcard/queries";

function asNumber(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return Number(value);
}

function formatPriceDisplay(price: number | null, currency: string | null, negotiable: boolean): string {
  if (negotiable || price === null) return "Contact for pricing";
  const code = currency ?? "USD";

  try {
    return `Starting at ${new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(price)}`;
  } catch {
    return `Starting at ${price.toFixed(2)} ${code}`;
  }
}

export async function GET(request: NextRequest) {
  return withPerformanceTracking(request, async () => {
    const ip = getClientIp(request);
    const rl = checkRateLimit("vcard-view", ip);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many requests. Please slow down." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
      );
    }

    const q = request.nextUrl.searchParams;
    const username = toNullableString(q.get("username"));
    const userId = toNullableString(q.get("userId"));
    const sectionType = ensureSectionType(toNullableString(q.get("type")));

    if (!username && !userId) {
      return NextResponse.json(
        { success: false, error: "username or userId is required." },
        { status: 400 }
      );
    }

    try {
    const sessionUserId = await getOptionalSessionUserId(request);

    if (userId && !sessionUserId) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    if (userId && sessionUserId && sessionUserId !== BigInt(userId)) {
      return NextResponse.json({ success: false, error: "Forbidden." }, { status: 403 });
    }

    const profile = await resolveProfileByUsernameOrId({ username, userId });
    if (!profile) {
      return NextResponse.json({ success: false, error: "Profile not found." }, { status: 404 });
    }

    const isOwner = Boolean(sessionUserId && sessionUserId === profile.user_id);
    if (!isOwner && (!profile.vcard_published || !profile.is_active)) {
      return NextResponse.json({ success: false, error: "Profile is private." }, { status: 403 });
    }

    const serviceScopeWhere = profile.bizcard_id
      ? { bizcard_id: profile.bizcard_id }
      : { user_id: profile.user_id };

    const services = await prisma.service.findMany({
      where: {
        ...serviceScopeWhere,
        ...(isOwner ? {} : { is_visible: true, status: "active" }),
      },
      orderBy: [{ featured: "desc" }, { display_order: "asc" }, { created_at: "asc" }],
      select: {
        service_id: true,
        name: true,
        description: true,
        tagline: true,
        price: true,
        currency_code: true,
        is_price_negotiable: true,
        featured: true,
        display_order: true,
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
            display_order: true,
          },
        },
      },
    });

    const servicesPayload = services.map((service) => {
      const media = (service.serviceMedia ?? []).map((m) => ({
        id: String(m.id),
        url: m.file_url,
        mimeType: m.mime_type,
        fileName: m.file_name,
        display_order: m.display_order,
      }));
      const featuredFromMedia = media.find(
        (m) => !String(m.mimeType ?? "").toLowerCase().startsWith("video/"),
      )?.url;
      const featuredImage =
        (typeof service.featured_image === "string" &&
          service.featured_image.startsWith("http")
          ? service.featured_image
          : null) ??
        featuredFromMedia ??
        service.featured_image;

      return {
        id: service.service_id,
        name: service.name,
        description: service.description,
        tagline: service.tagline,
        price: asNumber(service.price),
        currency: service.currency_code,
        price_display: formatPriceDisplay(asNumber(service.price), service.currency_code, service.is_price_negotiable),
        is_price_negotiable: service.is_price_negotiable,
        featured: service.featured,
        icon: featuredImage,
        featured_image: featuredImage,
        media,
        order: service.display_order,
      };
    });

    // Portfolio gallery/videos must come from dedicated gallery endpoints
    // (`/api/bizcard/{id}/gallery`, `/api/public/[alias]/gallery`).
    // Never project service media into top-level gallery — that caused
    // service images to bleed into the editor Gallery section.
    const gallery: never[] = [];
    const videos: never[] = [];

    const maxUpdated = services
      .map((service) => service.updated_at)
      .filter((v): v is Date => Boolean(v))
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    const responseData = {
      services: sectionType === "gallery" || sectionType === "videos" ? [] : servicesPayload.map((service) => ({
        id: service.id,
        name: service.name,
        description: service.description,
        tagline: service.tagline,
        price: service.price,
        currency: service.currency,
        price_display: service.price_display,
        is_price_negotiable: service.is_price_negotiable,
        featured: service.featured,
        icon: service.icon,
        featured_image: service.featured_image,
        media: service.media,
        order: service.order,
      })),
      gallery,
      videos,
      last_updated: toIsoOrNull(maxUpdated),
    };

    const headers: HeadersInit = {
      "Cache-Control": "private, no-store, no-cache, must-revalidate",
    };

      return NextResponse.json(serializeBigInts({ success: true, data: responseData }), {
        status: 200,
        headers,
      });
    } catch (error) {
      console.error("[vcard/services GET] Unexpected error:", error);
      return NextResponse.json(
        { success: false, error: "An unexpected error occurred. Please try again." },
        { status: 500 }
      );
    }
  });
}
