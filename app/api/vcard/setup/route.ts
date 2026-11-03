// ──────────────────────────────────────────────────────────────
// POST /api/vcard/setup — Initial vCard Profile Setup
// ──────────────────────────────────────────────────────────────
// Allows an authenticated user to configure their public vCard page
// in a single transactional request.
//
// What this endpoint does in one atomic DB transaction:
//   1. Updates User profile fields (name, bio, contact, media URLs, theme)
//   2. Replaces all Social links for the user (delete-then-insert)
//   3. Replaces all Services for the user   (delete-then-insert)
//   4. Upserts the user's Address record
//   5. Upserts the VCardSetup control record (marks setup_completed)
// After the first successful setup_completed transition, superadmins with
// new_registration enabled receive a sa_new_user_registration notification
// (non-blocking; email verification does not trigger this).
//
// Security layers:
//   1. Middleware auth guard (session_token cookie required)
//   2. Full session DB validation (revocation, deactivation checks)
//   3. IP rate limiting — 10/15 min (setup is infrequent)
//   4. Input validation + sanitization for all fields
//   5. custom_uri uniqueness checked before transaction (fast-fail)
//   6. All writes scoped to session.userId — users can only edit their own data
//   7. Audit log on every outcome
//
// File uploads:
//   Vercel serverless cannot store binary files. The frontend must upload
//   media files directly to a CDN (Cloudinary / S3) and pass the resulting
//   URL in `profileUrl` / `coverUrl`. This endpoint validates the URL format
//   and stores the URL only.
//
// Request body: see VCardSetupInput in validators.ts
//
// Response (200 OK):
//   {
//     message:  string
//     profile:  { user fields + socials + services + address + vcardSetup }
//   }
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import {
  resolveRequestSession,
  resolveEffectiveUserId,
  logAuditEvent,
  getClientIp,
  getUserAgent,
} from "@/server/lib/auth";
import { syncUserProfileToBizcard } from "@/lib/bizcard/sync";
import { getSchemaCompat, omitMissingColumns } from "@/lib/db/schemaCompat";
import { QRCodeService } from "@/lib/services/qr-code.service";
import { validateVCardSetupInput } from "@/server/lib/validators";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { buildVCardPublicUrl } from "@/server/lib/qr";
import { validateThemePathForWrite } from "@/server/lib/themes";
import { isSystemPlaceholderAlias } from "@/lib/bizcard/url-alias-utils";
import { generateUniqueUrlAlias } from "@/lib/bizcard/url-generator";
import { notifySuperadminsNewUserRegistration } from "@/lib/services/superadmin-notifications.service";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);

  try {
    // ── Rate Limiting ──────────────────────────────
    const rateCheck = checkRateLimit("vcard-setup", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many setup requests. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    // ── Session Validation ─────────────────────────
    const resolved = await resolveRequestSession(request);
    const session = resolved.session;
    if (!session) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    // ── Parse & Validate Input ─────────────────────
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const validation = validateVCardSetupInput(body);
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
      socials: socialsRaw,
      services: servicesRaw,
      address,
      languages,
      showCoverPhoto,
      showInquiryCard,
      showAssociateCount,
      showMutualAssociates,
      showEmail,
      contactLinkLabel,
    } = validation.data;
    const socials = socialsRaw ?? [];
    const services = servicesRaw ?? [];

    // Use effective user so superadmin impersonation sets up the target user's vCard.
    const userId = BigInt(resolveEffectiveUserId(resolved));

    // ── custom_uri Uniqueness Pre-check ────────────
    // Fast-fail before the transaction to return a friendly error.
    // A race condition is theoretically possible but in practice rare;
    // the transaction-level unique constraint is the final guard.
    if (customUri) {
      const existing = await prisma.user.findFirst({
        where: {
          custom_uri: customUri,
          user_id: { not: userId },
        },
        select: { user_id: true },
      });
      if (existing) {
        return NextResponse.json(
          { error: "That custom URI is already taken. Please choose a different one." },
          { status: 409 }
        );
      }
    }

    // ── Resolve Theme Path ─────────────────────────
    // Theme assets live in app/themes; DB stores only the slug/path.
    let resolvedThemePath: string | null = null;
    if (themePath !== null && themePath !== undefined) {
      resolvedThemePath = await validateThemePathForWrite(themePath);
      if (!resolvedThemePath) {
        return NextResponse.json(
          { error: "Invalid themePath. Theme directory not found in frontend themes." },
          { status: 422 }
        );
      }
    }

    // ── Pre-fetch read-only state (parallel, outside any transaction) ─
    const [existingAddress, existingVCardSetup, existingBizcard, existingUser] = await Promise.all([
      prisma.address.findFirst({ where: { user_id: userId }, select: { address_id: true } }),
      prisma.vCardSetup.findUnique({ where: { user_id: userId }, select: { setup_completed: true } }),
      prisma.bizcard.findFirst({
        where: { user_id: userId },
        orderBy: { updated_at: "desc" },
        select: { bizcard_id: true, url_alias: true, is_blank: true },
      }),
      prisma.user.findUnique({
        where: { user_id: userId },
        select: { email: true, first_name: true, last_name: true, registration_type: true },
      }),
    ]);

    if (!existingUser) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const now = new Date();

    // Registration can succeed without a placeholder bizcard (non-fatal create).
    // Ensure one exists before profile fields are written.
    if (!existingBizcard) {
      const placeholderUrlAlias = await generateUniqueUrlAlias({
        requestedAlias: customUri ?? `user_${userId.toString()}`,
        firstName: firstName ?? existingUser.first_name,
        lastName: lastName ?? existingUser.last_name,
        userId,
      });
      await prisma.bizcard.create({
        data: {
          user_id: userId,
          bizcard_name: vcardName ?? `${existingUser.first_name} ${existingUser.last_name}`.trim(),
          url_alias: placeholderUrlAlias,
          first_name: firstName ?? existingUser.first_name,
          last_name: lastName ?? existingUser.last_name,
          email: existingUser.email,
          contact_number: contact ?? "",
          city: "",
          bizcard_type: "virtual",
          is_merged: false,
          is_blank: true,
          generated_by_user_id: userId,
          generated_at: now,
        },
      });
    }

    // ── Execute Writes (No Interactive Transaction) ──────────────
    // WHY no transaction: Vercel → Hostinger MySQL latency (~20–80 ms/hop)
    // causes interactive transactions to reliably time out when they
    // contain 7+ sequential round trips (P2028). vCard setup is idempotent
    // — a partial save is visible only to the owner and is immediately
    // overwritten on retry, so strict atomicity is not required here.
    //
    // Strategy:
    //   • user.update + social rebuild + service rebuild → Promise.all
    //   • address upsert + vcardSetup upsert → sequential after the above
    // Each .then() chains its dependent write on the same connection slot.
    const aliasChanging =
      customUri !== null &&
      customUri !== undefined &&
      customUri !== (existingBizcard?.url_alias ?? null);
    const shouldStampAliasChange =
      aliasChanging &&
      customUri !== null &&
      !isSystemPlaceholderAlias(customUri);

    const targetBizcard = await prisma.bizcard.findFirst({
      where: { user_id: userId },
      orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
      select: { bizcard_id: true },
    });
    const targetBizcardId = targetBizcard?.bizcard_id ?? null;
    const compat = await getSchemaCompat();

    const [userUpdate] = await Promise.all([
      // 1. Update User profile fields
      prisma.user.update({
        where: { user_id: userId },
        data: omitMissingColumns(
          {
            ...(customUri        !== null && { custom_uri:        customUri        }),
            ...(firstName        !== null && { first_name:        firstName        }),
            ...(lastName         !== null && { last_name:         lastName         }),
            ...(middleName       !== null && { middle_name:       middleName       }),
            ...(profTitle        !== null && { prof_title:        profTitle        }),
            ...(postNominal      !== null && { post_nominal:      postNominal      }),
            ...(suffix           !== null && { suffix:            suffix           }),
            ...(jobPosition      !== null && { job_position:      jobPosition      }),
            ...(about            !== null && { about:             about            }),
            ...(contact          !== null && { contact:           contact || null  }),
            ...(altContact       !== null && { alt_contact:       altContact || null }),
            ...(telephone        !== null && { telephone:         telephone || null }),
            ...(altTelephone     !== null && { alt_telephone:     altTelephone || null }),
            ...(altEmail         !== null && { alt_email:         altEmail || null }),
            ...(profileUrl       !== null && { profile_url:       profileUrl       }),
            ...(coverUrl         !== null && { cover_url:         coverUrl         }),
            updated_at: now,
          },
          compat,
          "user"
        ),
        select: {
          user_id: true, first_name: true, last_name: true, middle_name: true,
          email: true, custom_uri: true, prof_title: true, post_nominal: true, suffix: true,
          job_position: true, about: true, contact: true, alt_contact: true,
          ...(compat.userTelephone ? { telephone: true, alt_telephone: true } : {}),
          alt_email: true, profile_url: true, cover_url: true,
          registration_type: true,
        },
      }),
      prisma.bizcard.updateMany({
        where: { user_id: userId },
        data: omitMissingColumns(
          {
            ...(customUri        !== null && { url_alias:          customUri        }),
            ...(vcardName        !== null && { bizcard_name:       vcardName        }),
            ...(vcardDescription !== null && { description:        vcardDescription }),
            ...(firstName        !== null && { first_name:         firstName        }),
            ...(lastName         !== null && { last_name:          lastName         }),
            ...(middleName       !== null && { middle_name:        middleName       }),
            ...(profTitle        !== null && { professional_title: profTitle        }),
            ...(postNominal      !== null && { post_nominal:       postNominal      }),
            ...(suffix           !== null && { suffix:             suffix           }),
            ...(jobPosition      !== null && { occupation:         jobPosition      }),
            ...(about            !== null && { bio:                about            }),
            ...(languages        !== null && { languages:          languages        }),
            ...(contact          !== null && { contact_number:     contact || ""    }),
            ...(altContact       !== null && { alt_contact_number: altContact || null }),
            ...(telephone        !== null && { telephone_number:   telephone || null }),
            ...(altTelephone     !== null && { alt_telephone_number: altTelephone || null }),
            ...(contactEmail     !== null && contactEmail !== "" && { email: contactEmail }),
            ...(altEmail         !== null && { alt_email:          altEmail || null }),
            ...(profileUrl       !== null && { profile_img:        profileUrl       }),
            ...(coverUrl         !== null && { cover_img:          coverUrl         }),
            ...(coverImagePosition !== null && { cover_img_position: coverImagePosition }),
            ...(resolvedThemePath !== null && { bizcard_theme: resolvedThemePath }),
            ...(showCoverPhoto !== undefined && { show_cover_photo: showCoverPhoto }),
            ...(showInquiryCard !== undefined && { show_inquiry_card: showInquiryCard }),
            ...(showAssociateCount !== undefined && { show_associate_count: showAssociateCount }),
            ...(showMutualAssociates !== undefined && { show_mutual_associates: showMutualAssociates }),
            ...(showEmail !== undefined && { show_email: showEmail }),
            ...(contactLinkLabel !== undefined && { contact_link_label: contactLinkLabel }),
            is_blank: false,
            claimed_by_user_id: userId,
            claimed_at: now,
            ...(shouldStampAliasChange ? { last_url_alias_changed_at: now } : {}),
            deactivated_flag: !publishNow,
            updated_at: now,
          },
          compat,
          "bizcard"
        ),
      }),
      // 2. Rebuild social links: soft-delete existing, then insert current set
      prisma.social
        .updateMany({
          where: { user_id: userId, deleted_at: null },
          data: { deleted_at: now, updated_at: now },
        })
        .then(() =>
          socials.length > 0
            ? prisma.social.createMany({
                data: socials.map((s) => ({
                  user_id: userId,
                  ...(targetBizcardId !== null && { bizcard_id: targetBizcardId }),
                  platform: s.platform,
                  url: s.url,
                  display_order: s.displayOrder,
                  is_visible: s.isVisible,
                })),
              })
            : Promise.resolve(null)
        ),
      // 3. Rebuild services and service gallery media
      prisma.service.deleteMany({ where: { user_id: userId } })
        .then(() =>
          prisma.media.deleteMany({
            where: {
              user_id: userId,
              related_type: "service_gallery",
            },
          })
        )
        .then(() =>
          services.length > 0
            ? Promise.all(
                services.map((svc) =>
                  prisma.service.create({
                    data: {
                      user_id: userId,
                      ...(targetBizcardId !== null && { bizcard_id: targetBizcardId }),
                      name: svc.name,
                      description: svc.description,
                      tagline: svc.tagline,
                      service_url: svc.serviceUrl,
                      featured_image: svc.featured_image,
                      display_order: svc.displayOrder,
                      is_visible: svc.isVisible,
                    },
                  }).then((createdService) =>
                    svc.media.length > 0
                      ? prisma.media.createMany({
                          data: svc.media.map((media, index) => ({
                            user_id: userId,
                            related_type: "service_gallery",
                            related_id: createdService.service_id,
                            file_name: media.fileName ?? `${svc.name}-media-${index + 1}`,
                            file_url: media.url,
                            mime_type: media.mimeType,
                            size: media.bytes !== null ? BigInt(media.bytes) : null,
                            storage_provider: "cloudinary",
                            metadata: JSON.stringify({
                              display_order: media.displayOrder,
                              source: "vcard_setup",
                            }),
                          })),
                        })
                      : Promise.resolve(null)
                  )
                )
              )
            : Promise.resolve(null)
        ),
    ]);

    // 4. Upsert Address
    let upsertedAddress = null;
    if (address) {
      if (existingAddress) {
        upsertedAddress = await prisma.address.update({
          where: { address_id: existingAddress.address_id },
          data: omitMissingColumns(
            {
              area: address.area, brgy: address.brgy, city: address.city,
              region: address.region, zipcode: address.zipcode,
              plus_code: address.plusCode, map_link: address.mapLink ?? null,
              landmark: address.landmark ?? null,
              latitude: address.latitude, longitude: address.longitude,
              updated_at: now,
            },
            compat,
            "address"
          ),
        });
      } else {
        upsertedAddress = await prisma.address.create({
          data: omitMissingColumns(
            {
              user_id: userId, area: address.area, brgy: address.brgy,
              city: address.city, region: address.region, zipcode: address.zipcode,
              plus_code: address.plusCode, map_link: address.mapLink ?? null,
              landmark: address.landmark ?? null,
              latitude: address.latitude, longitude: address.longitude,
            },
            compat,
            "address"
          ),
        });
      }
    }

    // 5. Upsert VCardSetup control record
    const vcardSetup = await prisma.vCardSetup.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId, is_published: publishNow,
        setup_completed: true, setup_completed_at: now,
      },
      update: {
        is_published: publishNow,
        ...(!existingVCardSetup?.setup_completed && {
          setup_completed: true, setup_completed_at: now,
        }),
        updated_at: now,
      },
    });

    const result = { user: userUpdate, address: upsertedAddress, vcardSetup };

    const bizcardId = await syncUserProfileToBizcard(userId).catch(async (syncErr) => {
      console.error("[vcard/setup] syncUserProfileToBizcard failed:", syncErr);
      const fallback = await prisma.bizcard.findFirst({
        where: { user_id: userId },
        orderBy: { updated_at: "desc" },
        select: { bizcard_id: true },
      });
      return fallback?.bizcard_id ?? null;
    });

    // ── Offline QR Code Generation ──────────────────────────
    // Generate after sync so bizcard row exists with latest profile fields.
    // Encodes vCard (VCF) content, uploads to Cloudinary, persists to bizcard.qr_code_url.
    let qrCode: string | null = null;
    let portfolioUrl: string | null = null;

    const uriForQr = customUri ?? result.user.custom_uri;
    if (uriForQr) {
      portfolioUrl = buildVCardPublicUrl(uriForQr);
    }

    if (bizcardId && portfolioUrl) {
      try {
        const qrService = new QRCodeService(`vcard_setup_${userId}`);
        const qrData = await qrService.generateOfflineVCardQRCode(bizcardId);
        qrCode = qrData.qr_code_url;

        // Keep VCardSetup.qr_code in sync for endpoints that read user-level QR
        try {
          await prisma.vCardSetup.update({
            where: { user_id: userId },
            data: { qr_code: qrCode, qr_generated_at: qrData.generated_at },
          });
        } catch (qrSaveErr) {
          console.error("[vcard/setup] Failed to persist QR code to VCardSetup:", qrSaveErr);
        }
      } catch (qrErr) {
        console.error("[vcard/setup] Offline QR generation failed:", qrErr);
      }
    }

    // ── Audit Log ──────────────────────────────────
    await logAuditEvent(
      "vcard_setup",
      session.userId,
      ip,
      ua,
      {
        customUri:   customUri ?? undefined,
        publishNow,
        socialsCount: socials.length,
        servicesCount: services.length,
        effective_user_id: Number(userId),
        ...(resolved.impersonation
          ? {
              impersonation_token_id: resolved.impersonation.tokenId,
              impersonation_target_user_id: resolved.impersonation.targetUserId,
            }
          : {}),
      }
    );

    // Superadmin "New User" alerts fire on first setup completion, not email verification.
    if (!existingVCardSetup?.setup_completed) {
      void notifySuperadminsNewUserRegistration({
        newUserId: Number(userId),
        firstName: result.user.first_name,
        lastName: result.user.last_name,
        email: result.user.email ?? existingUser.email,
        registrationType:
          result.user.registration_type ?? existingUser.registration_type ?? "individual",
      });
    }

    // ── Serialize & Respond ────────────────────────
    // BigInt → string conversion for JSON safety
    const serialize = (obj: object): unknown =>
      JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

    // Response shape:
    //   message      — human-readable confirmation
    //   profile      — saved user/address/vcardSetup fields
    //   portfolioUrl — the canonical public page URL for this vCard
    //   qrCode       — base64 SVG data URL; use as <img src={qrCode} />
    //                  null if no custom_uri set or APP_URL not configured
    //
    // Frontend display example:
    //   if (data.qrCode) {
    //     return <img src={data.qrCode} alt="Your vCard QR code" width={240} />;
    //   }
    return NextResponse.json(
      {
        message: "vCard profile saved successfully.",
        profile: serialize({
          ...result.user,
          address:    result.address,
          vcardSetup: result.vcardSetup,
          // Exposed so QR signup can call POST /api/bizcard/merge with virtualCardId.
          bizcard_id: bizcardId,
        }),
        portfolioUrl,
        qrCode,
      },
      { status: 200 }
    );
  } catch (error) {
    // Prisma unique constraint violation on custom_uri (race condition)
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

    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes("chk_serial_id_rules")) {
      return NextResponse.json(
        {
          error:
            "serial_id validation failed. Virtual cards that are not merged cannot keep a serial_id.",
        },
        { status: 409 }
      );
    }

    console.error("[vcard/setup] Unexpected error:", error);
    await logAuditEvent("vcard_setup_error", undefined, ip, ua, {
      error: String(error),
    });
    const debugMessage =
      process.env.NODE_ENV !== "production" && error instanceof Error
        ? error.message
        : undefined;
    return NextResponse.json(
      {
        error: "An unexpected error occurred. Please try again.",
        ...(debugMessage ? { debug: debugMessage } : {}),
      },
      { status: 500 }
    );
  }
}
