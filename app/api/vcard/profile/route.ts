// ──────────────────────────────────────────────────────────────
// GET/PUT /api/vcard/profile — Own vCard Profile Management
// ──────────────────────────────────────────────────────────────
// DEPRECATION NOTICE:
//   This monolithic endpoint is maintained for backward compatibility.
//   Prefer modular endpoints:
//     GET /api/vcard/details
//     GET /api/vcard/design
//     GET /api/vcard/services
//     GET /api/vcard/social
//     PUT /api/vcard/design/theme
//
// GET /api/vcard/profile
//   Returns the authenticated user's full vCard data (draft or live).
//   Intended for the dashboard / edit view — returns ALL fields
//   (including hidden socials/services) that the public endpoint omits.
//
// PUT /api/vcard/profile
//   Partial update — only fields present in the request body are changed.
//   Socials and services arrays, when provided, replace the existing set
//   atomically (delete-all + re-insert) within a single transaction.
//   Omitting `socials` or `services` entirely leaves them untouched.
//
// Security layers:
//   1. Middleware auth guard (session_token cookie required)
//   2. Full session DB validation (revocation, deactivation checks)
//   3. IP rate limiting:  120/min (GET) | 30/min (PUT)
//   4. Input validation + sanitization for PUT payload
//   5. All reads/writes scoped to session.userId
//   6. Audit log for PUT operations
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { linkUserSocialsToSoleBizcard } from "@/lib/bizcard/link-sole-bizcard-socials";
import { dedupeSocialLinksByUrl } from "@/lib/social-links";
import {
  resolveRequestSession,
  resolveEffectiveUserId,
  logAuditEvent,
  getClientIp,
  getUserAgent,
} from "@/server/lib/auth";
import { syncUserProfileToBizcard } from "@/lib/bizcard/sync";
import {
  canChangeUrlAlias,
  ensureAliasLockStarted,
  serializeUrlAliasEligibility,
} from "@/lib/bizcard/url-alias-utils";
import { validateVCardUpdateInput } from "@/server/lib/validators";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getSchemaCompat, omitMissingColumns } from "@/lib/db/schemaCompat";
import { logActivity } from "@/server/lib/activity";
import { validateThemePathForWrite } from "@/server/lib/themes";
import { assertUserCanChangeOwnBizcardTheme } from "@/server/lib/company";
import { getRequestId } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { cacheDelPrefix, cacheDel } from "@/lib/vcard/cache";
import { invalidateCache, generateCacheKey } from "@/lib/cache";
import { pickNonBlank, pickNonBlankOrNull } from "@/lib/vcard/queries";
import { toContactLinkLabelMode } from "@/app/types";
import { QRCodeService } from "@/lib/services/qr-code.service";
import { enqueueQRGeneration } from "@/lib/services/qr-code.queue";

// ── Shared serializer ──────────────────────────────────────────
// JSON.stringify cannot handle BigInt natively.
const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

async function invalidateThemeCachesForUser(userId: bigint): Promise<void> {
  const [user, bizcard] = await Promise.all([
    prisma.user.findUnique({
      where: { user_id: userId },
      select: { custom_uri: true, serial_id: true },
    }),
    prisma.bizcard.findFirst({
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

async function safeProfileQuery<T>(label: string, promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    console.warn(
      `[vcard/profile] ${label} query failed:`,
      error instanceof Error ? error.message : String(error)
    );
    return fallback;
  }
}

// ── Shared profile query ───────────────────────────────────────
// Fetches everything the dashboard needs for a given userId.
async function fetchOwnProfile(userId: bigint) {
  const compat = await getSchemaCompat();
  const user = await prisma.user.findUnique({
    where: { user_id: userId },
    select: {
      user_id: true,
      first_name: true,
      last_name: true,
      middle_name: true,
      email: true,
      custom_uri: true,
      prof_title: true,
      post_nominal: true,
      suffix: true,
      job_position: true,
      about: true,
      contact: true,
      alt_contact: true,
      ...(compat.userTelephone ? { telephone: true, alt_telephone: true } : {}),
      alt_email: true,
      profile_url: true,
      cover_url: true,
      registration_type: true,
    },
  });

  if (!user) return null;

  // Single-card accounts: keep Social.bizcard_id attached to that card.
  await linkUserSocialsToSoleBizcard(userId);

  const [bizcard, socials, services, address, vcardSetup] = await Promise.all([
    safeProfileQuery(
      "bizcard",
      prisma.bizcard.findFirst({
        where: { user_id: userId, is_blank: false },
        orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
        select: {
          bizcard_id: true,
          url_alias: true,
          first_name: true,
          last_name: true,
          middle_name: true,
          email: true,
          bizcard_name: true,
          description: true,
          deactivated_flag: true,
          professional_title: true,
          post_nominal: true,
          suffix: true,
          occupation: true,
          bio: true,
          contact_number: true,
          alt_contact_number: true,
          ...(compat.bizcardTelephone
            ? { telephone_number: true, alt_telephone_number: true }
            : {}),
          alt_email: true,
          profile_img: true,
          cover_img: true,
          cover_img_position: true,
          bizcard_theme: true,
          last_url_alias_changed_at: true,
          created_at: true,
          is_blank: true,
          generated_by_user_id: true,
          claimed_by_user_id: true,
          languages: true,
          show_cover_photo: true,
          show_inquiry_card: true,
          show_associate_count: true,
          show_mutual_associates: true,
          show_email: true,
          contact_link_label: true,
        },
      }),
      null
    ),
    safeProfileQuery(
      "socials",
      prisma.social.findMany({
        where: { user_id: userId, deleted_at: null },
        select: {
          socials_id: true,
          platform: true,
          url: true,
          display_order: true,
          is_visible: true,
        },
        orderBy: { display_order: "asc" },
      }),
      []
    ),
    safeProfileQuery(
      "services",
      prisma.service.findMany({
        where: { user_id: userId },
        select: {
          service_id: true,
          name: true,
          description: true,
          tagline: true,
          service_url: true,
          featured_image: true,
          display_order: true,
          is_visible: true,
        },
        orderBy: { display_order: "asc" },
      }),
      []
    ),
    safeProfileQuery(
      "address",
      prisma.address.findFirst({
        where: { user_id: userId },
        orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
        select: {
          address_id: true,
          area: true,
          brgy: true,
          city: true,
          region: true,
          zipcode: true,
          plus_code: true,
          map_link: true,
          ...(compat.addressLandmark ? { landmark: true } : {}),
          latitude: true,
          longitude: true,
        },
      }),
      null
    ),
    safeProfileQuery(
      "vcardSetup",
      prisma.vCardSetup.findUnique({
        where: { user_id: userId },
        select: {
          id: true,
          is_published: true,
          setup_completed: true,
          setup_completed_at: true,
        },
      }),
      null
    ),
  ]);

  const serviceIds = services.map((svc) => svc.service_id);
  const [galleryRows, serviceMediaRows] =
    serviceIds.length > 0
      ? await Promise.all([
          safeProfileQuery(
            "serviceGallery",
            prisma.media.findMany({
              where: {
                user_id: userId,
                related_type: "service_gallery",
                related_id: { in: serviceIds },
              },
              select: {
                media_id: true,
                related_id: true,
                file_url: true,
                file_name: true,
                mime_type: true,
                metadata: true,
                created_at: true,
              },
              orderBy: { created_at: "asc" },
            }),
            []
          ),
          safeProfileQuery(
            "serviceMediaTable",
            prisma.serviceMedia.findMany({
              where: { service_id: { in: serviceIds } },
              select: {
                id: true,
                service_id: true,
                file_url: true,
                file_name: true,
                mime_type: true,
                display_order: true,
                created_at: true,
              },
              orderBy: [{ display_order: "asc" }, { created_at: "asc" }],
            }),
            []
          ),
        ])
      : [[], []];

  const galleryByService = new Map<string, Array<{
    id: bigint;
    file_url: string;
    file_name: string;
    mime_type: string | null;
    display_order: number;
    created_at: Date;
  }>>();

  for (const row of serviceMediaRows) {
    const key = row.service_id.toString();
    const items = galleryByService.get(key) ?? [];
    items.push({
      id: row.id,
      file_url: row.file_url,
      file_name: row.file_name,
      mime_type: row.mime_type,
      display_order: row.display_order,
      created_at: row.created_at,
    });
    galleryByService.set(key, items);
  }

  for (const row of galleryRows) {
    if (row.related_id === null) continue;
    const key = row.related_id.toString();
    const items = galleryByService.get(key) ?? [];
    let displayOrder = items.length;
    try {
      const meta = row.metadata ? JSON.parse(row.metadata) as { display_order?: unknown } : null;
      const n = Number(meta?.display_order);
      if (Number.isInteger(n) && n >= 0) displayOrder = n;
    } catch {
      // keep fallback order
    }
    items.push({
      id: row.media_id,
      file_url: row.file_url,
      file_name: row.file_name,
      mime_type: row.mime_type,
      display_order: displayOrder,
      created_at: row.created_at,
    });
    galleryByService.set(key, items);
  }

  return {
    user_id: user.user_id,
    bizcard_id: bizcard?.bizcard_id ?? null,
    first_name: pickNonBlank(bizcard?.first_name, user.first_name),
    last_name: pickNonBlank(bizcard?.last_name, user.last_name),
    middle_name: pickNonBlankOrNull(bizcard?.middle_name, user.middle_name),
    email: pickNonBlank(bizcard?.email, user.email),
    custom_uri: pickNonBlankOrNull(bizcard?.url_alias, user.custom_uri),
    url_alias_editable: serializeUrlAliasEligibility(canChangeUrlAlias(bizcard)),
    vcard_name: pickNonBlank(
      bizcard?.bizcard_name,
      `${user.first_name} ${user.last_name}`.trim(),
    ),
    vcard_description: pickNonBlankOrNull(bizcard?.description, user.about),
    vcard_published: bizcard ? !bizcard.deactivated_flag : true,
    prof_title: pickNonBlankOrNull(bizcard?.professional_title, user.prof_title),
    post_nominal: pickNonBlankOrNull(bizcard?.post_nominal, user.post_nominal),
    suffix: pickNonBlankOrNull(bizcard?.suffix, user.suffix),
    job_position: pickNonBlankOrNull(bizcard?.occupation, user.job_position),
    about: pickNonBlankOrNull(bizcard?.bio, user.about),
    languages: bizcard?.languages ?? null,
    contact: pickNonBlankOrNull(bizcard?.contact_number, user.contact),
    alt_contact: pickNonBlankOrNull(bizcard?.alt_contact_number, user.alt_contact),
    telephone: pickNonBlankOrNull(
      (bizcard as { telephone_number?: string | null } | null)?.telephone_number,
      (user as { telephone?: string | null }).telephone
    ),
    alt_telephone: pickNonBlankOrNull(
      (bizcard as { alt_telephone_number?: string | null } | null)?.alt_telephone_number,
      (user as { alt_telephone?: string | null }).alt_telephone
    ),
    alt_email: pickNonBlankOrNull(bizcard?.alt_email, user.alt_email),
    // User is authoritative for images. Prefer User; for cover do not fall back to
    // stale Bizcard URLs when the user has no cover (matches dashboard empty state).
    profile_url: pickNonBlankOrNull(user.profile_url, bizcard?.profile_img),
    cover_url: pickNonBlankOrNull(user.cover_url, null),
    cover_img_position: bizcard?.cover_img_position ?? 'center center',
    theme_path: bizcard?.bizcard_theme ?? null,
    registration_type: user.registration_type,
    show_cover_photo: bizcard?.show_cover_photo ?? true,
    show_inquiry_card: bizcard?.show_inquiry_card ?? true,
    show_associate_count: bizcard?.show_associate_count ?? false,
    show_mutual_associates: bizcard?.show_mutual_associates ?? false,
    show_email: bizcard?.show_email ?? true,
    contact_link_label: toContactLinkLabelMode(bizcard?.contact_link_label),
    socials: dedupeSocialLinksByUrl(
      Array.isArray(socials) ? socials : [],
      (s: { url: string }) => s.url,
    ),
    addresses: address ? [address] : [],
    vcardSetup,
    services: services.map((svc) => {
      const media = (galleryByService.get(svc.service_id.toString()) ?? [])
        .sort((a, b) => a.display_order - b.display_order || a.created_at.getTime() - b.created_at.getTime())
        .map((m) => ({
          id: m.id,
          file_url: m.file_url,
          file_name: m.file_name,
          mime_type: m.mime_type,
          display_order: m.display_order,
        }));

      return {
        ...svc,
        serviceMedia: media,
      };
    }),
  };
}

// ── GET ────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);

  try {
    const rateCheck = checkRateLimit("vcard-view", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    const resolved = await resolveRequestSession(request);
    const session = resolved.session;
    if (!session) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    // Use resolveEffectiveUserId so that when a superadmin is impersonating
    // a user, the profile returned is that of the impersonated user, not the
    // superadmin's own profile.
    const userId = BigInt(resolveEffectiveUserId(resolved));

    // Self-heal migrated users whose alias lock was missed before the login/reauth fix.
    // This keeps the dashboard and impersonation view aligned with the stored lock state
    // even when the user is already authenticated and does not pass through login again.
    try {
      await ensureAliasLockStarted(userId);
    } catch (aliasLockError) {
      console.error("[vcard/profile GET] Failed to ensure alias lock:", aliasLockError);
    }

    const profile = await fetchOwnProfile(userId);

    if (!profile) {
      return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    }

    return NextResponse.json(
      { profile: serialize(profile) },
      {
        status: 200,
        headers: {
          Deprecation: "true",
          Sunset: "Wed, 31 Dec 2026 23:59:59 GMT",
        },
      }
    );
  } catch (error) {
    console.error("[vcard/profile GET] Unexpected error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred. Please try again." },
      { status: 500 }
    );
  }
}

// ── PUT ────────────────────────────────────────────────────────

export async function PUT(request: NextRequest) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);

  try {
    const rateCheck = checkRateLimit("vcard-update", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many update requests. Please slow down." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    const resolved = await resolveRequestSession(request);
    const session = resolved.session;
    if (!session) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    // Use effective user so superadmin impersonation writes the target user's data.
    const userId = BigInt(resolveEffectiveUserId(resolved));
    const isImpersonating = Boolean(resolved.impersonation);

    // Strip unchanged customUri before format validation so legacy/invalid
    // stored aliases do not block unrelated profile/design saves.
    // Prefer non-blank bizcard (same as GET) so blank placeholders don't force a "change".
    if (body.customUri !== undefined && body.customUri !== null) {
      const rawSubmitted =
        typeof body.customUri === "string" ? body.customUri.trim().toLowerCase() : "";
      if (rawSubmitted) {
        const [existingUser, existingBizcardForAlias] = await Promise.all([
          prisma.user.findUnique({
            where: { user_id: userId },
            select: { custom_uri: true },
          }),
          prisma.bizcard.findFirst({
            where: { user_id: userId, is_blank: false },
            orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
            select: { url_alias: true },
          }),
        ]);
        const storedBizAlias = (existingBizcardForAlias?.url_alias ?? "")
          .trim()
          .toLowerCase();
        const storedUserAlias = (existingUser?.custom_uri ?? "")
          .trim()
          .toLowerCase();
        if (
          (storedBizAlias && rawSubmitted === storedBizAlias) ||
          (storedUserAlias && rawSubmitted === storedUserAlias)
        ) {
          delete body.customUri;
        }
      }
    }

    const validation = validateVCardUpdateInput(body);
    if (!validation.valid) {
      return NextResponse.json(
        { error: "Validation failed.", details: validation.errors },
        { status: 422 }
      );
    }

    const {
      customUri,
      vcardName,
      vcardDescription,
      firstName,
      lastName,
      middleName,
      profTitle,
      postNominal,
      suffix,
      jobPosition,
      about,
      contact,
      altContact,
      telephone,
      altTelephone,
      email: contactEmail,
      altEmail,
      profileUrl,
      coverUrl,
      coverImagePosition,
      themePath,
      publishNow,
      socials,
      services,
      address,
      languages,
      showCoverPhoto,
      showInquiryCard,
      showAssociateCount,
      showMutualAssociates,
      showEmail,
      contactLinkLabel,
    } = validation.data;

    // ── custom_uri eligibility + uniqueness ────────
    // Only apply / uniqueness-check when the submitted alias actually differs
    // from the user's stored User.custom_uri or primary (non-blank) Bizcard.url_alias.
    let urlAliasChanged = false;
    let customUriToApply: string | null = null;
    if (customUri !== undefined && customUri !== null) {
      const [existingUserForAlias, existingBizcard] = await Promise.all([
        prisma.user.findUnique({
          where: { user_id: userId },
          select: { custom_uri: true },
        }),
        prisma.bizcard.findFirst({
          where: { user_id: userId, is_blank: false },
          orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
          select: {
            url_alias: true,
            last_url_alias_changed_at: true,
            created_at: true,
            is_blank: true,
            generated_by_user_id: true,
            claimed_by_user_id: true,
          },
        }),
      ]);

      const submittedAlias = customUri.trim().toLowerCase();
      const storedBizAlias = (existingBizcard?.url_alias ?? "").trim().toLowerCase();
      const storedUserAlias = (existingUserForAlias?.custom_uri ?? "")
        .trim()
        .toLowerCase();
      const aliasUnchanged =
        (storedBizAlias.length > 0 && submittedAlias === storedBizAlias) ||
        (storedUserAlias.length > 0 && submittedAlias === storedUserAlias);

      if (!aliasUnchanged) {
        // Super Admin impersonation has full authority to change the alias;
        // normal users remain subject to the 90-day lock.
        if (existingBizcard && !isImpersonating) {
          const eligibility = canChangeUrlAlias(existingBizcard);
          if (!eligibility.allowed) {
            return NextResponse.json(
              {
                error: `URL alias can be changed again in ${eligibility.daysRemaining} days.`,
                code: "URL_ALIAS_LOCKED",
                daysRemaining: eligibility.daysRemaining,
                changeAvailableAt: eligibility.changeAvailableAt.toISOString(),
              },
              { status: 403 }
            );
          }
        }

        const [userConflict, bizcardConflict] = await Promise.all([
          prisma.user.findFirst({
            where: { custom_uri: customUri, user_id: { not: userId } },
            select: { user_id: true },
          }),
          prisma.bizcard.findFirst({
            where: {
              url_alias: customUri,
              OR: [{ user_id: { not: userId } }, { user_id: null }],
            },
            select: { bizcard_id: true },
          }),
        ]);
        if (userConflict || bizcardConflict) {
          return NextResponse.json(
            { error: "That custom URI is already taken. Please choose a different one." },
            { status: 409 }
          );
        }

        urlAliasChanged = true;
        customUriToApply = customUri;
      }
    }

    // ── Resolve Theme Path ─────────────────────────
    let resolvedThemePath: string | undefined;
    if (themePath !== null && themePath !== undefined) {
      const validatedTheme = await validateThemePathForWrite(themePath);
      if (!validatedTheme) {
        return NextResponse.json(
          { error: "Invalid themePath. Theme directory not found in frontend themes." },
          { status: 422 }
        );
      }
      resolvedThemePath = validatedTheme;

      // Paid customize-templates require an explicit TemplatePurchase.
      const catalogTheme = await prisma.theme.findFirst({
        where: { theme_path: validatedTheme },
        select: { id: true, price: true, category: true, tag: true },
      });
      const catalogPrice = Number(catalogTheme?.price ?? 0);
      const isPaidCustomizeTemplate =
        Boolean(catalogTheme) &&
        catalogPrice > 0 &&
        String(catalogTheme?.category ?? "").toLowerCase() === "customize-templates";
      if (isPaidCustomizeTemplate && catalogTheme) {
        const purchase = await prisma.templatePurchase.findUnique({
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

    // ── Address pre-check (outside tx to avoid P2028 round-trip) ──
    // Determine whether an address row already exists before opening the
    // transaction so the tx body doesn't need an extra findFirst query.
    let existingAddressId: bigint | null = null;
    if (address !== undefined && address !== null) {
      const existingAddr = await prisma.address.findFirst({
        where: { user_id: userId },
        select: { address_id: true },
      });
      existingAddressId = existingAddr?.address_id ?? null;
    }

    // ── Transaction ────────────────────────────────
    // Prefer non-blank card (same as GET) so alias/socials attach to the real portfolio.
    let targetBizcard = await prisma.bizcard.findFirst({
      where: { user_id: userId, is_blank: false },
      orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
      select: { bizcard_id: true },
    });
    if (!targetBizcard) {
      targetBizcard = await prisma.bizcard.findFirst({
        where: { user_id: userId },
        orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
        select: { bizcard_id: true },
      });
    }
    const targetBizcardId = targetBizcard?.bizcard_id ?? null;

    // Profile fields + socials/address first (includes profile_url), then services.
    // Services rewrite can be many sequential queries against a remote Hostinger DB;
    // keep a generous timeout so profile-pic saves are not aborted mid-transaction (P2028).
    const PROFILE_TX_TIMEOUT_MS = 60_000;
    const compat = await getSchemaCompat();

    await prisma.$transaction(async (tx) => {
      const userFields: Record<string, unknown> = { updated_at: new Date() };
      if (customUriToApply !== null) userFields["custom_uri"] = customUriToApply;
      if (firstName       !== null && firstName       !== undefined) userFields["first_name"]        = firstName;
      if (lastName        !== null && lastName        !== undefined) userFields["last_name"]         = lastName;
      if (middleName      !== null && middleName      !== undefined) userFields["middle_name"]       = middleName;
      if (profTitle       !== null && profTitle       !== undefined) userFields["prof_title"]        = profTitle;
      if (postNominal     !== null && postNominal     !== undefined) userFields["post_nominal"]      = postNominal;
      if (suffix          !== null && suffix          !== undefined) userFields["suffix"]            = suffix;
      if (jobPosition     !== null && jobPosition     !== undefined) userFields["job_position"]      = jobPosition;
      if (about           !== null && about           !== undefined) userFields["about"]             = about;
      if (contact         !== null && contact         !== undefined) userFields["contact"]           = contact || null;
      if (altContact      !== null && altContact      !== undefined) userFields["alt_contact"]       = altContact || null;
      if (telephone       !== null && telephone       !== undefined) userFields["telephone"]         = telephone || null;
      if (altTelephone    !== null && altTelephone    !== undefined) userFields["alt_telephone"]     = altTelephone || null;
      if (altEmail        !== null && altEmail        !== undefined) userFields["alt_email"]         = altEmail || null;
      if (profileUrl       !== null && profileUrl       !== undefined) userFields["profile_url"]      = profileUrl;
      if (coverUrl         !== null && coverUrl         !== undefined) userFields["cover_url"]        = coverUrl;

      await tx.user.update({
        where: { user_id: userId },
        data: omitMissingColumns(userFields, compat, "user"),
      });

      // Do not put url_alias in updateMany — unique constraint would fail if the
      // user has more than one bizcard. Apply alias only on the target card.
      const bizcardFields: Record<string, unknown> = { updated_at: new Date() };
      if (vcardName         !== null && vcardName         !== undefined) bizcardFields["bizcard_name"] = vcardName;
      if (vcardDescription  !== null && vcardDescription  !== undefined) bizcardFields["description"] = vcardDescription;
      if (firstName         !== null && firstName         !== undefined) bizcardFields["first_name"] = firstName;
      if (lastName          !== null && lastName          !== undefined) bizcardFields["last_name"] = lastName;
      if (middleName        !== null && middleName        !== undefined) bizcardFields["middle_name"] = middleName;
      if (profTitle         !== null && profTitle         !== undefined) bizcardFields["professional_title"] = profTitle;
      if (postNominal       !== null && postNominal       !== undefined) bizcardFields["post_nominal"] = postNominal;
      if (suffix            !== null && suffix            !== undefined) bizcardFields["suffix"] = suffix;
      if (jobPosition       !== null && jobPosition       !== undefined) bizcardFields["occupation"] = jobPosition;
      if (about             !== null && about             !== undefined) bizcardFields["bio"] = about;
      if (languages         !== null && languages         !== undefined) bizcardFields["languages"] = languages;
      if (contact           !== null && contact           !== undefined) bizcardFields["contact_number"] = contact || "";
      if (altContact        !== null && altContact        !== undefined) bizcardFields["alt_contact_number"] = altContact || null;
      if (telephone         !== null && telephone         !== undefined) bizcardFields["telephone_number"] = telephone || null;
      if (altTelephone      !== null && altTelephone      !== undefined) bizcardFields["alt_telephone_number"] = altTelephone || null;
      if (contactEmail      !== null && contactEmail !== undefined && contactEmail !== "") bizcardFields["email"] = contactEmail;
      if (altEmail          !== null && altEmail          !== undefined) bizcardFields["alt_email"] = altEmail || null;
      if (profileUrl        !== null && profileUrl        !== undefined) bizcardFields["profile_img"] = profileUrl;
      if (coverUrl          !== null && coverUrl          !== undefined) bizcardFields["cover_img"] = coverUrl;
      if (coverImagePosition !== null && coverImagePosition !== undefined) bizcardFields["cover_img_position"] = coverImagePosition;
      if (resolvedThemePath !== undefined) bizcardFields["bizcard_theme"] = resolvedThemePath;
      if (publishNow        !== undefined) bizcardFields["deactivated_flag"] = !publishNow;
      if (showCoverPhoto    !== undefined) bizcardFields["show_cover_photo"] = showCoverPhoto;
      if (showInquiryCard   !== undefined) bizcardFields["show_inquiry_card"] = showInquiryCard;
      if (showAssociateCount !== undefined) bizcardFields["show_associate_count"] = showAssociateCount;
      if (showMutualAssociates !== undefined) bizcardFields["show_mutual_associates"] = showMutualAssociates;
      if (showEmail         !== undefined) bizcardFields["show_email"] = showEmail;
      if (contactLinkLabel  !== undefined) bizcardFields["contact_link_label"] = contactLinkLabel;

      await tx.bizcard.updateMany({
        where: { user_id: userId },
        data: omitMissingColumns(bizcardFields, compat, "bizcard"),
      });

      if (customUriToApply !== null && targetBizcardId !== null) {
        await tx.bizcard.update({
          where: { bizcard_id: targetBizcardId },
          data: {
            url_alias: customUriToApply,
            ...(urlAliasChanged ? { last_url_alias_changed_at: new Date() } : {}),
            updated_at: new Date(),
          },
        });
      }
      // 2. Socials — only replace when the array was included in the request
      if (socials !== undefined) {
        await tx.social.updateMany({
          where: { user_id: userId, deleted_at: null },
          data: { deleted_at: new Date(), updated_at: new Date() },
        });
        if (socials.length > 0) {
          await tx.social.createMany({
            data: socials.map((s) => ({
              user_id:       userId,
              ...(targetBizcardId !== null && { bizcard_id: targetBizcardId }),
              platform:      s.platform,
              url:           s.url,
              display_order: s.displayOrder,
              is_visible:    s.isVisible,
            })),
          });
        }
      }

      // 3. Address — only update if provided; use pre-fetched existingAddressId
      if (address !== undefined && address !== null) {
        if (existingAddressId !== null) {
          await tx.address.update({
            where: { address_id: existingAddressId },
            data: omitMissingColumns(
              {
                area:       address.area,
                brgy:       address.brgy,
                city:       address.city,
                region:     address.region,
                zipcode:    address.zipcode,
                plus_code:  address.plusCode,
                map_link:   address.mapLink ?? null,
                landmark:   address.landmark ?? null,
                latitude:   address.latitude,
                longitude:  address.longitude,
                updated_at: new Date(),
              },
              compat,
              "address"
            ),
          });
        } else {
          await tx.address.create({
            data: omitMissingColumns(
              {
                user_id:   userId,
                area:      address.area,
                brgy:      address.brgy,
                city:      address.city,
                region:    address.region,
                zipcode:   address.zipcode,
                plus_code: address.plusCode,
                map_link:  address.mapLink ?? null,
                landmark:  address.landmark ?? null,
                latitude:  address.latitude,
                longitude: address.longitude,
              },
              compat,
              "address"
            ),
          });
        }
      }

      // 4. Keep VCardSetup publish flag in sync (before heavy services rewrite)
      if (publishNow !== undefined) {
        await tx.vCardSetup.upsert({
          where: { user_id: userId },
          create: {
            user_id:      userId,
            is_published: publishNow,
          },
          update: {
            is_published: publishNow,
            updated_at:   new Date(),
          },
        });
      }

      // 5. Services — only replace if array was included in the request
      if (services !== undefined) {
        await tx.service.deleteMany({ where: { user_id: userId } });
        await tx.media.deleteMany({
          where: {
            user_id: userId,
            related_type: "service_gallery",
          },
        });

        if (services.length > 0) {
          await Promise.all(
            services.map((svc) =>
              tx.service.create({
                data: {
                  user_id:       userId,
                  ...(targetBizcardId !== null && { bizcard_id: targetBizcardId }),
                  name:          svc.name,
                  description:   svc.description,
                  tagline:       svc.tagline,
                  service_url:   svc.serviceUrl,
                  featured_image: svc.featured_image,
                  display_order: svc.displayOrder,
                  is_visible:    svc.isVisible,
                },
              }).then(async (createdService) => {
                if (svc.media.length === 0) {
                  return { count: 0 };
                }

                await tx.serviceMedia.createMany({
                  data: svc.media.map((media, index) => ({
                    user_id: userId,
                    service_id: createdService.service_id,
                    file_name: media.fileName ?? `${svc.name}-media-${index + 1}`,
                    file_url: media.url,
                    mime_type: media.mimeType,
                    size: media.bytes !== null ? BigInt(media.bytes) : null,
                    storage_provider: "r2",
                    display_order: media.displayOrder ?? index,
                  })),
                });

                return tx.media.createMany({
                  data: svc.media.map((media, index) => ({
                    user_id: userId,
                    related_type: "service_gallery",
                    related_id: createdService.service_id,
                    file_name: media.fileName ?? `${svc.name}-media-${index + 1}`,
                    file_url: media.url,
                    mime_type: media.mimeType,
                    size: media.bytes !== null ? BigInt(media.bytes) : null,
                    storage_provider: "r2",
                    metadata: JSON.stringify({
                      display_order: media.displayOrder,
                      source: "vcard_profile_update",
                    }),
                  })),
                });
              })
            )
          );
        }
      }
    }, { timeout: PROFILE_TX_TIMEOUT_MS });

    // Keep bizcard as the canonical presentation record.
    await syncUserProfileToBizcard(userId);

    // Always clear public portfolio cache so name/profile updates are visible cross-device.
    await invalidateThemeCachesForUser(userId);

    // When socials change, refresh offline VCard QR + VCF so scanned contacts stay current.
    if (socials !== undefined && targetBizcardId !== null) {
      cacheDel(`qr:bizcard:${targetBizcardId.toString()}`);
      void (async () => {
        try {
          await new QRCodeService(
            `profile_socials_${Date.now()}`,
          ).regenerateAllBizcardAssets(targetBizcardId);
        } catch (error) {
          console.error(
            "[vcard/profile PUT] QR/VCF regen after socials failed, enqueueing fallback:",
            error,
          );
          enqueueQRGeneration(targetBizcardId);
        }
      })();
    }

    // ── Audit ──────────────────────────────────────
    const editLabels: Array<{ key: string; label: string; present: boolean }> = [
      { key: "firstName", label: "First Name", present: firstName !== undefined && firstName !== null },
      { key: "lastName", label: "Last Name", present: lastName !== undefined && lastName !== null },
      { key: "jobPosition", label: "Job Position", present: jobPosition !== undefined && jobPosition !== null },
      { key: "about", label: "About / Bio", present: about !== undefined && about !== null },
      { key: "contact", label: "Phone Number", present: contact !== undefined && contact !== null },
      { key: "altContact", label: "Alternate Phone", present: altContact !== undefined && altContact !== null },
      { key: "altEmail", label: "Alternate Email", present: altEmail !== undefined && altEmail !== null },
      { key: "profileUrl", label: "Profile Photo", present: profileUrl !== undefined && profileUrl !== null },
      { key: "coverUrl", label: "Cover Photo", present: coverUrl !== undefined && coverUrl !== null },
      { key: "address", label: "Address", present: address !== undefined && address !== null },
      { key: "socials", label: "Social Links", present: socials !== undefined },
      { key: "services", label: "Services", present: services !== undefined },
      { key: "customUri", label: "Portfolio URL", present: Boolean(customUri) },
      { key: "showCoverPhoto", label: "Cover Photo display", present: showCoverPhoto !== undefined },
      { key: "showInquiryCard", label: "Inquiry Card display", present: showInquiryCard !== undefined },
      { key: "showAssociateCount", label: "Associate Count display", present: showAssociateCount !== undefined },
      { key: "showMutualAssociates", label: "Mutual Associates display", present: showMutualAssociates !== undefined },
      { key: "showEmail", label: "Email display", present: showEmail !== undefined },
    ];
    for (const field of editLabels.filter((item) => item.present).slice(0, 6)) {
      void logActivity(Number(userId), "PROFILE_EDIT", targetBizcardId, {
        field: field.label,
        fieldKey: field.key,
      });
    }

    await logAuditEvent("vcard_profile_update", session.userId, ip, ua, {
      fieldsUpdated: Object.keys(body),
      effective_user_id: Number(userId),
      ...(resolved.impersonation
        ? {
            impersonation_token_id: resolved.impersonation.tokenId,
            impersonation_target_user_id: resolved.impersonation.targetUserId,
          }
        : {}),
    });

    // ── Return updated profile ─────────────────────
    const updated = await fetchOwnProfile(userId);
    return NextResponse.json(
      {
        message: "Profile updated successfully.",
        profile: serialize(updated),
      },
      {
        status: 200,
        headers: {
          Deprecation: "true",
          Sunset: "Wed, 31 Dec 2026 23:59:59 GMT",
        },
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      return NextResponse.json(
        { error: "That custom URI is already taken. Please choose a different one." },
        { status: 409 }
      );
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "P2028"
    ) {
      return NextResponse.json(
        {
          error:
            "Saving took too long due to a slow database connection. Please try again in a moment.",
        },
        { status: 503 }
      );
    }

    if (errorMessage.includes("chk_serial_id_rules")) {
      return NextResponse.json(
        {
          error:
            "serial_id validation failed. Virtual cards that are not merged cannot keep a serial_id.",
        },
        { status: 409 }
      );
    }

    console.error("[vcard/profile PUT] Unexpected error:", error);
    await logAuditEvent("vcard_profile_update_error", undefined, ip, ua, {
      error: String(error),
    });
    return NextResponse.json(
      { error: "An unexpected error occurred. Please try again." },
      { status: 500 }
    );
  }
}
