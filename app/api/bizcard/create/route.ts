import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { mapUserToBizcardCreateData } from "@/lib/bizcard/mapper";
import {
  generateBizcardSerialId,
  generateUrlAlias,
  normalizeUrlAlias,
} from "@/lib/bizcard/generator";
import { validateBizcardInput } from "@/lib/bizcard/validator";
import { enqueueQRGeneration, initializeQRQueue } from "@/lib/services/qr-code.queue";
import { QRCodeService } from "@/lib/services/qr-code.service";
import { buildVCardPublicUrl } from "@/server/lib/qr";
import { subscriptionService } from "@/lib/services/subscription.service";
import {
  createLimitReachedError,
  createExpiredError,
} from "@/lib/errors/subscription-errors";
import { generateRequestId } from "@/lib/utils/request-utils";
import { isSuperAdminRole, PERMANENT_PREMIUM_EXPIRES_AT } from "@/lib/auth/privileged-premium";
import { ensureSuperadminBizcardsPremium } from "@/lib/services/superadmin-premium.service";
import { getSchemaCompat, omitMissingColumns } from "@/lib/db/schemaCompat";

const prismaAny = prisma as any;

// Initialize QR queue once on server startup
let qrQueueInitialized = false;
function ensureQRQueueInitialized() {
  if (!qrQueueInitialized) {
    initializeQRQueue();
    qrQueueInitialized = true;
    console.debug("[bizcard/create] QR queue initialized");
  }
}

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  // Initialize QR queue if not already done
  ensureQRQueueInitialized();

  try {
    const rateCheck = checkRateLimit("bizcard-create", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many create attempts. Please try again later." },
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

    const userId = BigInt(resolved.session.userId);
    const compat = await getSchemaCompat();
    const user = await prisma.user.findUnique({
      where: { user_id: userId },
      select: {
        user_id: true,
        role: true,
        serial_id: true,
        custom_uri: true,
        first_name: true,
        middle_name: true,
        last_name: true,
        job_position: true,
        prof_title: true,
        post_nominal: true,
        suffix: true,
        about: true,
        email: true,
        contact: true,
        alt_email: true,
        alt_contact: true,
        ...(compat.userTelephone ? { telephone: true, alt_telephone: true } : {}),
        profile_url: true,
        cover_url: true,
        company_id: true,
        is_active: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    // Check subscription status and limits
    const isExpired = await subscriptionService.isSubscriptionExpired(userId);
    if (isExpired) {
      const error = createExpiredError();
      return NextResponse.json(
        {
          ...error,
          meta: { requestId: generateRequestId(), timestamp: new Date().toISOString() },
        },
        { status: 403 }
      );
    }

    // Determine card type and check limits
    const cardType = body.bizcard_type === "physical" ? "physical" : "virtual";
    const limitCheck =
      cardType === "virtual"
        ? await subscriptionService.canCreateVirtualCard(userId)
        : await subscriptionService.canCreatePhysicalCard(userId);

    if (!limitCheck.allowed) {
      const error = createLimitReachedError(
        `${cardType} cards`,
        limitCheck.current,
        limitCheck.max
      );
      return NextResponse.json(
        {
          ...error,
          meta: { requestId: generateRequestId(), timestamp: new Date().toISOString() },
        },
        { status: 403 }
      );
    }

    const defaults = mapUserToBizcardCreateData(user);

    const firstName = toNullableString(body.first_name) ?? defaults.first_name;
    const lastName = toNullableString(body.last_name) ?? defaults.last_name;
    const aliasInput = toNullableString(body.url_alias);
    const serialInput = toNullableString(body.serial_id);
    const requestedStyle = typeof body.bizcard_style === "string" ? body.bizcard_style.trim().toLowerCase() : "";
    const allowedStyles = new Set(["polyvinyl", "wood", "carbon_fiber"]);
    const bizcardStyle = allowedStyles.has(requestedStyle) ? requestedStyle as "polyvinyl" | "wood" | "carbon_fiber" : "polyvinyl";

    const payload = {
      ...defaults,
      ...body,
      user_id: user.user_id,
      first_name: firstName,
      last_name: lastName,
      middle_name: toNullableString(body.middle_name) ?? defaults.middle_name,
      bizcard_name: toNullableString(body.bizcard_name) ?? defaults.bizcard_name,
      url_alias: aliasInput
        ? normalizeUrlAlias(aliasInput)
        : toNullableString(defaults.url_alias) ?? generateUrlAlias(firstName, lastName, user.user_id),
      serial_id:
        cardType === "physical"
          ? serialInput ?? generateBizcardSerialId()
          : serialInput ?? null,
      description: toNullableString(body.description) ?? defaults.description,
      occupation: toNullableString(body.occupation) ?? defaults.occupation,
      professional_title: toNullableString(body.professional_title) ?? defaults.professional_title,
      post_nominal: toNullableString(body.post_nominal) ?? defaults.post_nominal,
      suffix: toNullableString(body.suffix) ?? defaults.suffix,
      area: toNullableString(body.area),
      baranggay: toNullableString(body.baranggay),
      city: toNullableString(body.city) ?? defaults.city,
      region: toNullableString(body.region),
      address_link: toNullableString(body.address_link),
      bio: toNullableString(body.bio) ?? defaults.bio,
      email: toNullableString(body.email) ?? defaults.email,
      contact_number: toNullableString(body.contact_number) ?? defaults.contact_number,
      alt_email: toNullableString(body.alt_email) ?? defaults.alt_email,
      alt_contact_number: toNullableString(body.alt_contact_number) ?? defaults.alt_contact_number,
      languages: toNullableString(body.languages),
      profile_img: toNullableString(body.profile_img) ?? defaults.profile_img,
      cover_img: toNullableString(body.cover_img) ?? defaults.cover_img,
      bizcard_theme: toNullableString(body.bizcard_theme) ?? defaults.bizcard_theme,
      bizcard_type: cardType,
      bizcard_style: bizcardStyle,
      deactivated_flag:
        typeof body.deactivated_flag === "boolean" ? body.deactivated_flag : defaults.deactivated_flag,
      ...(isSuperAdminRole(user.role)
        ? {
            subscription_tier: "premium",
            subscription_status: "active",
            subscription_started_at: new Date(),
            subscription_expires_at: PERMANENT_PREMIUM_EXPIRES_AT,
          }
        : {}),
    };

    const validationErrors = validateBizcardInput(payload);
    if (validationErrors.length) {
      return NextResponse.json(
        { error: "Validation failed.", details: validationErrors },
        { status: 422 }
      );
    }

    const [aliasConflict, serialConflict] = await Promise.all([
      payload.url_alias
        ? prismaAny.bizcard.findFirst({ where: { url_alias: payload.url_alias }, select: { bizcard_id: true } })
        : Promise.resolve(null),
      payload.serial_id
        ? prismaAny.bizcard.findFirst({ where: { serial_id: payload.serial_id }, select: { bizcard_id: true } })
        : Promise.resolve(null),
    ]);

    if (aliasConflict) {
      return NextResponse.json(
        { error: "url_alias is already in use." },
        { status: 409 }
      );
    }

    if (serialConflict) {
      return NextResponse.json(
        { error: "serial_id is already in use." },
        { status: 409 }
      );
    }

    const created = await prismaAny.bizcard.create({
      data: omitMissingColumns(payload as Record<string, unknown>, compat, "bizcard"),
      select: {
        bizcard_id: true,
        user_id: true,
        bizcard_name: true,
        serial_id: true,
        url_alias: true,
        email: true,
        contact_number: true,
        bizcard_type: true,
        bizcard_style: true,
        deactivated_flag: true,
        qr_code_url: true,
        qr_code_generated_at: true,
        portfolio_url: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (isSuperAdminRole(user.role)) {
      await ensureSuperadminBizcardsPremium(user.user_id).catch((err) => {
        console.error("[bizcard/create] Failed to sync superadmin premium:", err);
      });
    }

    // ── Offline QR Code Generation ──────────────────────────
    try {
      if (created.url_alias) {
        const portfolioUrl = buildVCardPublicUrl(created.url_alias);
        if (portfolioUrl) {
          await prismaAny.bizcard.update({
            where: { bizcard_id: created.bizcard_id },
            data: { portfolio_url: portfolioUrl },
          });
          created.portfolio_url = portfolioUrl;
        }

        const qrService = new QRCodeService(`bizcard_create_${created.bizcard_id}`);
        const qrData = await qrService.generateOfflineVCardQRCode(created.bizcard_id);
        created.qr_code_url = qrData.qr_code_url;
        created.qr_code_generated_at = qrData.generated_at;
      }
    } catch (qrErr) {
      // Non-fatal: fall back to async queue if sync generation fails
      console.warn("[bizcard/create POST] Sync offline QR generation failed, enqueueing:", qrErr);
      try {
        if (created.url_alias) {
          enqueueQRGeneration(created.bizcard_id);
        }
      } catch (enqueueErr) {
        console.warn("[bizcard/create POST] QR generation enqueue failed:", enqueueErr);
      }
    }

    return NextResponse.json(serialize({ success: true, data: created }), { status: 201 });
  } catch (error) {
    console.error("[bizcard/create POST] Unhandled error:", error);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}