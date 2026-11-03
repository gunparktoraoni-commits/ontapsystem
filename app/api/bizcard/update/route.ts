import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, resolveEffectiveUserId, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { normalizeUrlAlias } from "@/lib/bizcard/generator";
import { validateBizcardInput } from "@/lib/bizcard/validator";
import { cacheDelPrefix } from "@/lib/vcard/cache";
import { invalidateCache, generateCacheKey } from "@/lib/cache";
import { isKnownPortfolioThemeSlug, normalizeThemePath } from "@/server/lib/themes";
import { assertUserCanChangeOwnBizcardTheme } from "@/server/lib/company";
import { getRequestId } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { normalizeDisplayText } from "@/app/lib/plainText";
import { sanitizePortfolioRichHtml, isRichTextEmpty } from "@/app/lib/richText";

const prismaAny = prisma as any;

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function toNullablePersonText(value: unknown): string | null {
  const raw = toNullableString(value);
  if (!raw) return null;
  const normalized = normalizeDisplayText(raw);
  return normalized.length ? normalized : null;
}

function toNullableAboutText(value: unknown): string | null {
  const raw = toNullableString(value);
  if (!raw) return null;
  // Preserve a safe subset of rich formatting (bold/italic/underline + breaks).
  if (isRichTextEmpty(raw)) return null;
  const clean = sanitizePortfolioRichHtml(raw);
  return clean.length ? clean : null;
}

function toNullableBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return BigInt(value);
  if (typeof value !== "string" || !/^\d{1,20}$/.test(value)) return null;
  return BigInt(value);
}

function isThemeOnlyUpdate(body: Record<string, unknown>): boolean {
  const allowedKeys = new Set(["bizcard_theme", "bizcardTheme", "bizcard_id", "bizcardId"]);
  const payloadKeys = Object.keys(body).filter((key) => body[key] !== undefined);
  if (payloadKeys.length === 0) return false;
  if (!payloadKeys.every((key) => allowedKeys.has(key))) return false;
  return body.bizcard_theme !== undefined || body.bizcardTheme !== undefined;
}

async function invalidateThemeCachesForUser(userId: bigint): Promise<void> {
  const [user, bizcard] = await Promise.all([
    prisma.user.findUnique({
      where: { user_id: userId },
      select: { custom_uri: true, serial_id: true },
    }),
    prismaAny.bizcard.findFirst({
      where: { user_id: userId, deactivated_flag: false },
      orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
      select: { url_alias: true },
    }),
  ]);

  const publicAliases = new Set<string>();
  for (const raw of [user?.custom_uri, user?.serial_id, bizcard?.url_alias]) {
    const normalized = String(raw ?? "").trim().toLowerCase();
    if (normalized) publicAliases.add(normalized);
  }

  const publicKey = (
    user?.custom_uri ??
    bizcard?.url_alias ??
    user?.serial_id ??
    `user-${userId.toString()}`
  ).toLowerCase();

  cacheDelPrefix(`vcard:themes:owner:${userId.toString()}`);
  cacheDelPrefix("vcard:themes:public");
  cacheDelPrefix(`vcard:preview:${publicKey}:`);
  cacheDelPrefix(`vcard:design:${publicKey}`);

  await Promise.all(
    [...publicAliases].map((alias) =>
      invalidateCache(generateCacheKey("public", "profile", alias)),
    ),
  );
}

export async function PUT(request: NextRequest) {
  const ip = getClientIp(request);

  try {
    const rateCheck = checkRateLimit("bizcard-update", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many update attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
      );
    }

    const resolved = await resolveRequestSession(request);
    if (!resolved.session) {
      return NextResponse.json({ error: "Authentication required.", requiresAuth: true }, { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    // Use effective user so superadmin impersonation updates the target user's bizcard.
    const userId = BigInt(resolveEffectiveUserId(resolved));
    const requestedBizcardId = toNullableBigInt(body.bizcard_id ?? body.bizcardId);

    if (isThemeOnlyUpdate(body)) {
      const rawTheme = body.bizcard_theme ?? body.bizcardTheme;
      const themePath = normalizeThemePath(String(rawTheme ?? ""));
      if (!themePath || !isKnownPortfolioThemeSlug(themePath)) {
        return NextResponse.json(
          { error: "Invalid bizcard_theme. Theme slug is not recognized." },
          { status: 422 }
        );
      }

      const themeTarget = await prismaAny.bizcard.findFirst({
        where: {
          user_id: userId,
          ...(requestedBizcardId ? { bizcard_id: requestedBizcardId } : {}),
        },
        orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
        select: {
          bizcard_id: true,
          url_alias: true,
          bizcard_theme: true,
        },
      });

      if (!themeTarget) {
        return NextResponse.json({ error: "Bizcard not found." }, { status: 404 });
      }

      const catalogTheme = await prismaAny.theme.findFirst({
        where: { theme_path: themePath },
        select: { id: true, price: true, category: true },
      });
      const catalogPrice = Number(catalogTheme?.price ?? 0);
      const isPaidCustomizeTemplate =
        Boolean(catalogTheme) &&
        catalogPrice > 0 &&
        String(catalogTheme?.category ?? "").toLowerCase() === "customize-templates";
      if (isPaidCustomizeTemplate && catalogTheme) {
        const purchase = await prismaAny.templatePurchase.findUnique({
          where: {
            user_id_template_id: {
              user_id: userId,
              template_id: catalogTheme.id,
            },
          },
          select: { id: true },
        });
        if (!purchase) {
          return NextResponse.json(
            {
              error: "Purchase required to apply this paid template.",
              code: "TEMPLATE_PURCHASE_REQUIRED",
            },
            { status: 403 }
          );
        }
      }

      // Super Admin impersonation has full authority to set themes even when
      // the target user's theme is normally company-managed.
      const isImpersonating = Boolean(resolved.impersonation);
      if (!isImpersonating) {
        try {
          await assertUserCanChangeOwnBizcardTheme(userId, getRequestId(request.headers));
        } catch (error) {
          if (error instanceof AppError) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
          }
          throw error;
        }
      }

      if (themeTarget.bizcard_theme === themePath) {
        return NextResponse.json(
          serialize({
            success: true,
            data: {
              bizcard_id: themeTarget.bizcard_id,
              url_alias: themeTarget.url_alias,
              bizcard_theme: themePath,
            },
          }),
          { status: 200 }
        );
      }

      const updatedThemeOnly = await prismaAny.bizcard.update({
        where: { bizcard_id: themeTarget.bizcard_id },
        data: {
          bizcard_theme: themePath,
          updated_at: new Date(),
        },
        select: {
          bizcard_id: true,
          user_id: true,
          url_alias: true,
          bizcard_theme: true,
          updated_at: true,
        },
      });

      await invalidateThemeCachesForUser(userId);

      return NextResponse.json(serialize({ success: true, data: updatedThemeOnly }), { status: 200 });
    }

    const existing = await prismaAny.bizcard.findFirst({
      where: {
        user_id: userId,
        ...(requestedBizcardId ? { bizcard_id: requestedBizcardId } : {}),
      },
      orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
      select: {
        bizcard_id: true,
        user_id: true,
        bizcard_name: true,
        serial_id: true,
        url_alias: true,
        description: true,
        first_name: true,
        middle_name: true,
        last_name: true,
        occupation: true,
        professional_title: true,
        post_nominal: true,
        suffix: true,
        area: true,
        baranggay: true,
        city: true,
        zip_code: true,
        region: true,
        address_link: true,
        company_id: true,
        bio: true,
        email: true,
        contact_number: true,
        alt_email: true,
        alt_contact_number: true,
        languages: true,
        profile_img: true,
        cover_img: true,
        bizcard_theme: true,
        bizcard_type: true,
        deactivated_flag: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Bizcard not found." }, { status: 404 });
    }

    const normalizedAliasInput = toNullableString(body.url_alias);
    const nextAlias = normalizedAliasInput ? normalizeUrlAlias(normalizedAliasInput) : existing.url_alias;

    const merged = {
      ...existing,
      bizcard_name: toNullablePersonText(body.bizcard_name) ?? existing.bizcard_name,
      serial_id: toNullableString(body.serial_id) ?? existing.serial_id,
      url_alias: nextAlias,
      description: toNullableAboutText(body.description) ?? existing.description,
      first_name: toNullablePersonText(body.first_name) ?? existing.first_name,
      middle_name: toNullablePersonText(body.middle_name) ?? existing.middle_name,
      last_name: toNullablePersonText(body.last_name) ?? existing.last_name,
      occupation: toNullablePersonText(body.occupation) ?? existing.occupation,
      professional_title: toNullablePersonText(body.professional_title) ?? existing.professional_title,
      post_nominal: toNullablePersonText(body.post_nominal) ?? existing.post_nominal,
      suffix: toNullablePersonText(body.suffix) ?? existing.suffix,
      area: toNullablePersonText(body.area) ?? existing.area,
      baranggay: toNullablePersonText(body.baranggay) ?? existing.baranggay,
      city: toNullablePersonText(body.city) ?? existing.city,
      region: toNullablePersonText(body.region) ?? existing.region,
      address_link: toNullableString(body.address_link) ?? existing.address_link,
      bio: toNullableAboutText(body.bio) ?? existing.bio,
      email: toNullableString(body.email) ?? existing.email,
      contact_number: toNullableString(body.contact_number) ?? existing.contact_number,
      alt_email: toNullableString(body.alt_email) ?? existing.alt_email,
      alt_contact_number: toNullableString(body.alt_contact_number) ?? existing.alt_contact_number,
      languages: toNullablePersonText(body.languages) ?? existing.languages,
      profile_img: toNullableString(body.profile_img) ?? existing.profile_img,
      cover_img: toNullableString(body.cover_img) ?? existing.cover_img,
      bizcard_theme: toNullableString(body.bizcard_theme) ?? existing.bizcard_theme,
      bizcard_type: body.bizcard_type === "physical" ? "physical" : body.bizcard_type === "virtual" ? "virtual" : existing.bizcard_type,
      deactivated_flag: typeof body.deactivated_flag === "boolean" ? body.deactivated_flag : existing.deactivated_flag,
    };

    const validationErrors = validateBizcardInput(merged as Record<string, unknown>);
    if (validationErrors.length) {
      return NextResponse.json(
        { error: "Validation failed.", details: validationErrors },
        { status: 422 }
      );
    }

    if (merged.bizcard_theme !== existing.bizcard_theme) {
      const isImpersonating = Boolean(resolved.impersonation);
      if (!isImpersonating) {
        try {
          await assertUserCanChangeOwnBizcardTheme(userId, getRequestId(request.headers));
        } catch (error) {
          if (error instanceof AppError) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
          }
          throw error;
        }
      }
    }

    const [aliasConflict, serialConflict] = await Promise.all([
      merged.url_alias
        ? prismaAny.bizcard.findFirst({
            where: {
              url_alias: merged.url_alias,
              bizcard_id: { not: existing.bizcard_id },
            },
            select: { bizcard_id: true },
          })
        : Promise.resolve(null),
      merged.serial_id
        ? prismaAny.bizcard.findFirst({
            where: {
              serial_id: merged.serial_id,
              bizcard_id: { not: existing.bizcard_id },
            },
            select: { bizcard_id: true },
          })
        : Promise.resolve(null),
    ]);

    if (aliasConflict) {
      return NextResponse.json({ error: "url_alias is already in use." }, { status: 409 });
    }

    if (serialConflict) {
      return NextResponse.json({ error: "serial_id is already in use." }, { status: 409 });
    }

    const updated = await prismaAny.bizcard.update({
      where: { bizcard_id: existing.bizcard_id },
      data: {
        bizcard_name: merged.bizcard_name,
        serial_id: merged.serial_id,
        url_alias: merged.url_alias,
        description: merged.description,
        first_name: merged.first_name,
        middle_name: merged.middle_name,
        last_name: merged.last_name,
        occupation: merged.occupation,
        professional_title: merged.professional_title,
        post_nominal: merged.post_nominal,
        suffix: merged.suffix,
        area: merged.area,
        baranggay: merged.baranggay,
        city: merged.city,
        region: merged.region,
        address_link: merged.address_link,
        bio: merged.bio,
        email: merged.email,
        contact_number: merged.contact_number,
        alt_email: merged.alt_email,
        alt_contact_number: merged.alt_contact_number,
        languages: merged.languages,
        profile_img: merged.profile_img,
        cover_img: merged.cover_img,
        bizcard_theme: merged.bizcard_theme,
        bizcard_type: merged.bizcard_type,
        deactivated_flag: merged.deactivated_flag,
        updated_at: new Date(),
      },
      select: {
        bizcard_id: true,
        user_id: true,
        bizcard_name: true,
        serial_id: true,
        url_alias: true,
        email: true,
        contact_number: true,
        bizcard_type: true,
        deactivated_flag: true,
        created_at: true,
        updated_at: true,
      },
    });

    await invalidateThemeCachesForUser(userId);

    return NextResponse.json(serialize({ success: true, data: updated }), { status: 200 });
  } catch (error) {
    console.error("[bizcard/update PUT] Unhandled error:", error);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}