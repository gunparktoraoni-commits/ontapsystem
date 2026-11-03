import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { withPerformanceTracking } from "@/middleware/performance";
import { cacheWrap } from "@/lib/vcard/cache";
import { parseThemeCssVariables } from "@/lib/vcard/theme-validator";
import {
  getOptionalSessionUserId,
  resolveProfileByUsernameOrId,
  serializeBigInts,
  toNullableString,
} from "@/lib/vcard/queries";
import { buildThemeVisibilityOrFilters } from "@/lib/services/theme-visibility.service";
import {
  HITACHI_THEME_SLUG,
  isHitachiCompanyId,
  resolveHitachiCompanyIds,
} from "@/lib/constants/hitachi-companies";
import type { ResolvedVcardProfile } from "@/lib/vcard/queries";

const themeSelect = {
  id: true,
  theme_name: true,
  theme_path: true,
  preview_image: true,
  css_variables: true,
  tag: true,
  price: true,
} as const;

async function resolveOwnerCompanyId(profile: ResolvedVcardProfile): Promise<bigint | null> {
  if (profile.bizcard_id) {
    const bizcard = await prisma.bizcard.findUnique({
      where: { bizcard_id: profile.bizcard_id },
      select: { company_id: true },
    });
    if (bizcard?.company_id) return bizcard.company_id;
  }

  const user = await prisma.user.findUnique({
    where: { user_id: profile.user_id },
    select: { company_id: true },
  });
  if (user?.company_id) return user.company_id;

  const employment = await prisma.companyEmployee.findFirst({
    where: { user_id: profile.user_id, is_active: true },
    select: { company_id: true },
  });
  if (employment?.company_id) return employment.company_id;

  const administeredCompany = await prisma.company.findFirst({
    where: { admin_id: profile.user_id },
    select: { company_id: true },
  });
  return administeredCompany?.company_id ?? null;
}

function mapThemeSummary(theme: {
  id: bigint;
  theme_name: string;
  preview_image: string | null;
  tag: string;
  price: Prisma.Decimal;
  theme_path: string;
}, selectedPath: string | null, ownedThemeIds: Set<string>) {
  const price = Number(theme.price ?? 0);
  const isPremium = theme.tag !== "free" || price > 0;

  return {
    id: theme.id,
    name: theme.theme_name,
    preview_image: theme.preview_image,
    is_premium: isPremium,
    price,
    is_selected: selectedPath === theme.theme_path,
    is_owned: ownedThemeIds.has(theme.id.toString()),
  };
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

    const ownerCompanyId = await resolveOwnerCompanyId(profile);
    await resolveHitachiCompanyIds(prisma);

    const visibilityFilters = buildThemeVisibilityOrFilters({
      userId: isOwner ? profile.user_id : null,
      companyId: ownerCompanyId,
      includePublic: true,
    });

    const themesCacheKey = `vcard:themes:${isOwner ? `owner:${profile.user_id.toString()}:${ownerCompanyId?.toString() ?? "none"}` : `public:${ownerCompanyId?.toString() ?? "none"}`}`;

    const ownedThemeIds = new Set<string>();
    const purchasedThemeIds: bigint[] = [];
    if (isOwner) {
      const purchases = await prisma.templatePurchase.findMany({
        where: { user_id: profile.user_id },
        select: { template_id: true },
      });
      for (const purchase of purchases) {
        ownedThemeIds.add(purchase.template_id.toString());
        purchasedThemeIds.push(purchase.template_id);
      }
    }

    const fetchedVisibleThemes = await (isOwner
      ? prisma.theme.findMany({
          where: {
            is_active: true,
            OR: [
              ...visibilityFilters,
              ...(purchasedThemeIds.length ? [{ id: { in: purchasedThemeIds } }] : []),
            ],
          },
          orderBy: [{ tag: "asc" }, { theme_name: "asc" }],
          select: themeSelect,
        })
      : cacheWrap(themesCacheKey, 3600, async () =>
          prisma.theme.findMany({
            where: {
              OR: visibilityFilters,
              is_active: true,
            },
            orderBy: [{ tag: "asc" }, { theme_name: "asc" }],
            select: themeSelect,
          })
        ));

    const allVisibleThemes = fetchedVisibleThemes.filter(
      (theme) =>
        theme.theme_path !== HITACHI_THEME_SLUG || isHitachiCompanyId(ownerCompanyId),
    );
    const selectedThemePath = profile.theme_path?.trim() || null;
    const currentTheme =
      allVisibleThemes.find((theme) => theme.theme_path === selectedThemePath)
      ?? allVisibleThemes[0]
      ?? null;

    const orderedVisibleThemes = currentTheme
      ? [
          currentTheme,
          ...allVisibleThemes.filter((theme) => theme.id !== currentTheme.id),
        ]
      : allVisibleThemes;
    const availableThemes = orderedVisibleThemes.map((theme) =>
      mapThemeSummary(theme, currentTheme?.theme_path ?? null, ownedThemeIds)
    );

    const payload = {
      success: true,
      data: {
        current_theme: currentTheme
          ? {
              id: currentTheme.id,
              name: currentTheme.theme_name,
              theme_path: currentTheme.theme_path,
              path: currentTheme.theme_path,
              slug: currentTheme.theme_path,
              preview_image: currentTheme.preview_image,
              is_premium: currentTheme.tag !== "free" || Number(currentTheme.price) > 0,
              price: Number(currentTheme.price),
              css_variables: parseThemeCssVariables(currentTheme.css_variables),
              fonts: [] as string[],
              layout: "standard",
            }
          : null,
        available_themes: availableThemes,
        customizations: {
          accent_color: null,
          background_image: profile.cover_url,
          profile_image: profile.profile_url,
          cover_image: profile.cover_url,
          logo_position: "top",
          show_qr_code: true,
        },
      },
    };

    const headers: HeadersInit = {
      "Cache-Control": "private, no-store, no-cache, must-revalidate",
    };

      return NextResponse.json(serializeBigInts(payload), { status: 200, headers });
    } catch (error) {
      console.error("[vcard/design GET] Unexpected error:", error);
      return NextResponse.json(
        { success: false, error: "An unexpected error occurred. Please try again." },
        { status: 500 }
      );
    }
  });
}
