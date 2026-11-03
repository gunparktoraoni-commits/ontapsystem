import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { withPerformanceTracking } from "@/middleware/performance";
import {
  getOptionalSessionUserId,
  getSocialMetaForLink,
  resolveProfileByUsernameOrId,
  serializeBigInts,
  toIsoOrNull,
  toNullableString,
} from "@/lib/vcard/queries";
import { linkUserSocialsToSoleBizcard } from "@/lib/bizcard/link-sole-bizcard-socials";
import { dedupeSocialLinksByUrl } from "@/lib/social-links";

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
    const includeInactive = q.get("include_inactive") === "true";

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

    if (isOwner) {
      await linkUserSocialsToSoleBizcard(profile.user_id);
    }

    // Owners see all of their socials. Public viewers see card-linked + orphans
    // (same OR shape as public profile queries).
    const socialScopeWhere = isOwner
      ? { user_id: profile.user_id }
      : profile.bizcard_id
        ? {
            OR: [
              { bizcard_id: profile.bizcard_id },
              { bizcard_id: null, user_id: profile.user_id },
            ],
          }
        : { user_id: profile.user_id };

    const links = await prisma.social.findMany({
      where: {
        ...socialScopeWhere,
        deleted_at: null,
        ...(isOwner
          ? includeInactive
            ? {}
            : { is_visible: true }
          : { is_visible: true }),
      },
      orderBy: [{ display_order: "asc" }, { created_at: "asc" }],
      select: {
        socials_id: true,
        platform: true,
        url: true,
        display_order: true,
        is_visible: true,
        updated_at: true,
      },
    });

    const socialLinks = dedupeSocialLinksByUrl(links, (item) => item.url).map(
      (item) => {
        const meta = getSocialMetaForLink(item.url, item.platform);
        return {
          id: item.socials_id,
          platform: item.platform,
          url: item.url,
          icon: meta.icon,
          display_name: meta.displayName,
          order: item.display_order,
          is_active: item.is_visible,
        };
      },
    );

    const totalActive = socialLinks.filter((item) => item.is_active).length;
    const maxUpdated = links
      .map((item) => item.updated_at)
      .filter((v): v is Date => Boolean(v))
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    const headers: HeadersInit = {
      "Cache-Control": "private, no-store, no-cache, must-revalidate",
    };

      return NextResponse.json(
        serializeBigInts({
          success: true,
          data: {
            social_links: socialLinks,
            total_active: totalActive,
            last_updated: toIsoOrNull(maxUpdated),
          },
        }),
        { status: 200, headers }
      );
    } catch (error) {
      console.error("[vcard/social GET] Unexpected error:", error);
      return NextResponse.json(
        { success: false, error: "An unexpected error occurred. Please try again." },
        { status: 500 }
      );
    }
  });
}
