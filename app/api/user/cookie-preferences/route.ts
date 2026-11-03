import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/server/lib/prisma";
import { getClientIp, validateToken } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  CookieSessionError,
  CookieSessionErrorCode,
  createInvalidCategoryError,
  createRateLimitError,
} from "@/lib/errors/cookie-session-errors";
import { parseJsonObject, toJsonString } from "@/server/lib/json-field";

const CONSENT_DURATION_DAYS = 30;
const GUEST_SESSION_COOKIE = "ontap_cookie_pref_session";
const DEFAULT_COOKIE_CATEGORIES = [
  { slug: "essential", is_essential: true },
  { slug: "preferences", is_essential: false },
  { slug: "analytics", is_essential: false },
  { slug: "marketing", is_essential: false },
  { slug: "system_health", is_essential: false },
];

const PreferencesSchema = z.object({
  preferences: z.record(z.string(), z.boolean()),
  consent_version: z.string().optional(),
});

function shouldUsePartitionedCookies(): boolean {
  const value = process.env.COOKIE_PARTITIONED?.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return process.env.NODE_ENV === "production";
}

function buildGuestCookieOptions(maxAgeSeconds: number) {
  const options: {
    httpOnly: true;
    secure: boolean;
    sameSite: "none";
    path: string;
    maxAge: number;
    partitioned?: boolean;
  } = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "none",
    path: "/",
    maxAge: maxAgeSeconds,
  };

  if (shouldUsePartitionedCookies()) {
    options.partitioned = true;
  }

  return options;
}

function generateGuestSessionId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function getValidCategorySlugs(): Promise<{
  categories: { slug: string; is_essential: boolean }[];
  slugs: Set<string>;
  essentialSlug: string | null;
}> {
  const categories = await prisma.cookieCategory
    .findMany({
      select: { slug: true, is_essential: true },
    })
    .catch(() => [] as { slug: string; is_essential: boolean }[]);

  if (!categories.length) {
    return {
      categories: DEFAULT_COOKIE_CATEGORIES,
      slugs: new Set(DEFAULT_COOKIE_CATEGORIES.map((category) => category.slug)),
      essentialSlug: "essential",
    };
  }

  const slugs = new Set(categories.map((c) => c.slug));
  const essential = categories.find((c) => c.is_essential)?.slug ?? (slugs.has("essential") ? "essential" : null);
  return { categories, slugs, essentialSlug: essential };
}

function normalizePrefsByCategory(input: Record<string, boolean>, essentialSlug: string | null) {
  const prefs = { ...input };
  if (essentialSlug) prefs[essentialSlug] = true;
  return prefs;
}

function computeBooleanCompatFlags(prefsByCategory: Record<string, boolean>) {
  return {
    preferences_enabled: prefsByCategory.preferences ?? false,
    analytics_enabled: prefsByCategory.analytics ?? false,
  };
}

// GET /api/user/cookie-preferences (auth optional)
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const startedAt = Date.now();
  const requestId = crypto.randomUUID?.() ?? `req_${Date.now()}`;

  try {
    const rateCheck = checkRateLimit("cookie-preferences-get", ip);
    if (!rateCheck.allowed) {
      const error = createRateLimitError("cookie-preferences-get", Math.ceil(rateCheck.retryAfterMs / 1000));
      return NextResponse.json(error.toJSON(), {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)),
          "X-RateLimit-Reset": String(Date.now() + rateCheck.retryAfterMs),
        },
      });
    }

    const cookieStore = await cookies();
    const accessToken = cookieStore.get("session_token")?.value;

    const { categories, essentialSlug } = await getValidCategorySlugs();

    if (accessToken) {
      const session = await validateToken(accessToken);
      if (session) {
        const userPrefs = await prisma.userCookiePreferences.findUnique({
          where: { user_id: BigInt(session.userId) },
        });

        if (userPrefs && userPrefs.expires_at <= new Date()) {
          await prisma.userCookiePreferences
            .delete({ where: { user_id: BigInt(session.userId) } })
            .catch(() => {});
        }

        const record = userPrefs && userPrefs.expires_at > new Date() ? userPrefs : null;
        const prefsByCategory = parseJsonObject<Record<string, boolean>>(record?.preferences_by_category) || {};

        return NextResponse.json({
          success: true,
          data: {
            supported_categories: categories.map((category) => ({
              slug: category.slug,
              is_essential: category.is_essential,
            })),
            preferences: {
              ...(essentialSlug ? { [essentialSlug]: true } : { essential: true }),
              ...prefsByCategory,
            },
            consent_given: Boolean(record),
            consent_version: record?.consent_version ?? "1.0",
            expires_at: record?.expires_at?.toISOString() ?? null,
            days_remaining: record
              ? Math.ceil((record.expires_at.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
              : null,
          },
          meta: {
            requestId,
            responseTime: Date.now() - startedAt,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }

    // Guest flow (httpOnly cookie on backend domain)
    const existingGuestId = cookieStore.get(GUEST_SESSION_COOKIE)?.value ?? null;
    const guestId = existingGuestId || generateGuestSessionId();

    const anonPrefs = await prisma.anonymousCookiePreferences
      .findUnique({ where: { session_id: guestId } })
      .catch(() => null);

    const isExpired = anonPrefs?.expires_at ? anonPrefs.expires_at <= new Date() : true;
    if (anonPrefs && isExpired) {
      await prisma.anonymousCookiePreferences
        .delete({ where: { session_id: guestId } })
        .catch(() => {});
    }

    const record = anonPrefs && !isExpired ? anonPrefs : null;
    const prefsByCategory = parseJsonObject<Record<string, boolean>>(record?.preferences_by_category) || {};

    const res = NextResponse.json({
      success: true,
      data: {
        supported_categories: categories.map((category) => ({
          slug: category.slug,
          is_essential: category.is_essential,
        })),
        preferences: {
          ...(essentialSlug ? { [essentialSlug]: true } : { essential: true }),
          ...prefsByCategory,
        },
        consent_given: Boolean(record),
        consent_version: record?.consent_version ?? "1.0",
        expires_at: record?.expires_at?.toISOString() ?? null,
        days_remaining: record
          ? Math.ceil((record.expires_at.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          : null,
      },
      meta: {
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    });

    if (!existingGuestId) {
      res.cookies.set(GUEST_SESSION_COOKIE, guestId, buildGuestCookieOptions(CONSENT_DURATION_DAYS * 24 * 60 * 60));
    }

    return res;
  } catch (error) {
    const cookieError = new CookieSessionError(
      CookieSessionErrorCode.PREFERENCE_NOT_FOUND,
      "Failed to retrieve cookie preferences",
      500,
      { error: error instanceof Error ? error.message : "Unknown error" },
      ["fetch-failed"]
    );
    return NextResponse.json(cookieError.toJSON(), { status: cookieError.getStatusCode() });
  }
}

// PUT /api/user/cookie-preferences (auth optional)
export async function PUT(request: NextRequest) {
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || undefined;
  const startedAt = Date.now();
  const requestId = crypto.randomUUID?.() ?? `req_${Date.now()}`;

  try {
    const rateCheck = checkRateLimit("cookie-preferences-set", ip);
    if (!rateCheck.allowed) {
      const error = createRateLimitError("cookie-preferences-set", Math.ceil(rateCheck.retryAfterMs / 1000));
      return NextResponse.json(error.toJSON(), {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
      });
    }

    const body = await request.json();
    const validation = PreferencesSchema.safeParse(body);
    if (!validation.success) {
      const error = new CookieSessionError(
        CookieSessionErrorCode.INVALID_PREFERENCE_DATA,
        "Invalid preferences data",
        400,
        { details: validation.error.issues },
        ["validation-failed"]
      );
      return NextResponse.json(error.toJSON(), { status: 400 });
    }

    const { preferences, consent_version } = validation.data;

    const { slugs: validSlugs, essentialSlug } = await getValidCategorySlugs();
    for (const slug of Object.keys(preferences)) {
      if (!validSlugs.has(slug)) {
        const error = createInvalidCategoryError(slug);
        return NextResponse.json(error.toJSON(), { status: error.getStatusCode() });
      }
    }

    const prefsByCategory = normalizePrefsByCategory(preferences, essentialSlug);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CONSENT_DURATION_DAYS * 24 * 60 * 60 * 1000);

    const cookieStore = await cookies();
    const accessToken = cookieStore.get("session_token")?.value;

    if (accessToken) {
      const session = await validateToken(accessToken);
      if (session) {
        // Optional migration: merge existing anonymous record into user record, then delete it.
        const guestId = cookieStore.get(GUEST_SESSION_COOKIE)?.value ?? null;
        const anonymousPrefs = guestId
          ? await prisma.anonymousCookiePreferences.findUnique({ where: { session_id: guestId } }).catch(() => null)
          : null;

        const anonymousMap = parseJsonObject<Record<string, boolean>>(anonymousPrefs?.preferences_by_category) || {};
        const merged: Record<string, boolean> = { ...anonymousMap };
        for (const [slug, value] of Object.entries(prefsByCategory)) {
          merged[slug] = Boolean(merged[slug]) || Boolean(value);
        }
        const mergedFinal = normalizePrefsByCategory(merged, essentialSlug);

        const compat = computeBooleanCompatFlags(mergedFinal);

        await prisma.userCookiePreferences.upsert({
          where: { user_id: BigInt(session.userId) },
          update: {
            ...compat,
            preferences_by_category: toJsonString(mergedFinal),
            consent_version: consent_version || "1.0",
            consented_at: now,
            expires_at: expiresAt,
            ip_address: ip?.slice(0, 45),
            user_agent: userAgent?.slice(0, 512),
            updated_at: now,
          },
          create: {
            user_id: BigInt(session.userId),
            ...compat,
            preferences_by_category: toJsonString(mergedFinal),
            consent_version: consent_version || "1.0",
            consented_at: now,
            expires_at: expiresAt,
            ip_address: ip?.slice(0, 45),
            user_agent: userAgent?.slice(0, 512),
          },
        });

        if (anonymousPrefs && guestId) {
          await prisma.anonymousCookiePreferences.delete({ where: { session_id: guestId } }).catch(() => {});
        }

        return NextResponse.json({
          success: true,
          message: "Cookie preferences saved successfully",
          data: {
            preferences: {
              ...(essentialSlug ? { [essentialSlug]: true } : { essential: true }),
              ...mergedFinal,
            },
            expires_at: expiresAt.toISOString(),
            expires_in_days: CONSENT_DURATION_DAYS,
          },
          meta: {
            requestId,
            responseTime: Date.now() - startedAt,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }

    // Guest upsert keyed by httpOnly guest cookie
    const existingGuestId = cookieStore.get(GUEST_SESSION_COOKIE)?.value ?? null;
    const guestId = existingGuestId || generateGuestSessionId();
    const compat = computeBooleanCompatFlags(prefsByCategory);

    await prisma.anonymousCookiePreferences.upsert({
      where: { session_id: guestId },
      update: {
        ...compat,
        preferences_by_category: toJsonString(prefsByCategory),
        consent_version: consent_version || "1.0",
        consented_at: now,
        expires_at: expiresAt,
        ip_address: ip?.slice(0, 45),
        user_agent: userAgent?.slice(0, 512),
        updated_at: now,
      },
      create: {
        session_id: guestId,
        ...compat,
        preferences_by_category: toJsonString(prefsByCategory),
        consent_version: consent_version || "1.0",
        consented_at: now,
        expires_at: expiresAt,
        ip_address: ip?.slice(0, 45),
        user_agent: userAgent?.slice(0, 512),
      },
    });

    const res = NextResponse.json({
      success: true,
      message: "Cookie preferences saved successfully",
      data: {
        preferences: {
          ...(essentialSlug ? { [essentialSlug]: true } : { essential: true }),
          ...prefsByCategory,
        },
        expires_at: expiresAt.toISOString(),
        expires_in_days: CONSENT_DURATION_DAYS,
      },
      meta: {
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    });

    if (!existingGuestId) {
      res.cookies.set(GUEST_SESSION_COOKIE, guestId, buildGuestCookieOptions(CONSENT_DURATION_DAYS * 24 * 60 * 60));
    }

    return res;
  } catch (error) {
    const cookieError = new CookieSessionError(
      CookieSessionErrorCode.PREFERENCE_SAVE_FAILED,
      "Failed to save cookie preferences",
      500,
      { error: error instanceof Error ? error.message : "Unknown error" },
      ["save-failed"]
    );
    return NextResponse.json(cookieError.toJSON(), { status: cookieError.getStatusCode() });
  }
}

