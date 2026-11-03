import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";
import { GalleryMediaService } from "@/lib/services/gallery-media.service";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, value) => (typeof value === "bigint" ? value.toString() : value)));

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ alias: string }> }
): Promise<NextResponse> {
  const ip = getClientIp(request);

  try {
    const rate = checkRateLimit("public-gallery", ip);
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)),
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    const { alias } = await params;

    const bizcard = await prisma.bizcard.findFirst({
      where: {
        url_alias: alias,
        is_blank: false,
        deactivated_flag: false,
        user: { is_active: true },
      },
      select: {
        subscription_tier: true,
      },
    });

    if (!bizcard) {
      return NextResponse.json(
        { success: false, error: "Portfolio not found." },
        { status: 404, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    const tier = bizcard.subscription_tier;
    const isBasicTier = tier !== "standard" && tier !== "premium";

    if (isBasicTier) {
      return NextResponse.json(
        { success: false, error: "Gallery is not available for this portfolio tier." },
        { status: 403, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    const service = new GalleryMediaService();
    const gallery = await service.getPublicGallery(alias);

    if (!gallery) {
      return NextResponse.json(
        { success: false, error: "Portfolio not found." },
        { status: 404, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    return NextResponse.json(
      serialize({
        success: true,
        data: {
          alias: gallery.alias,
          username: gallery.alias,
          bizcard_id: gallery.bizcardId,
          gallery: gallery.gallery,
          videos: gallery.videos,
          total_gallery_items: gallery.gallery.length,
          total_videos: gallery.videos.length,
        },
      }),
      {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "private, no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error) {
    console.error("[public/[alias]/gallery GET] Unexpected error:", error);
    return NextResponse.json(
      { success: false, error: "An unexpected error occurred." },
      { status: 500, headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }
}
