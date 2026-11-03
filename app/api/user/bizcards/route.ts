import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, resolveEffectiveUserId, getClientIp, getUserAgent, logAuditEvent } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  canChangeUrlAlias,
} from "@/lib/bizcard/url-alias-utils";
import { ensureSuperadminBizcardsPremium } from "@/lib/services/superadmin-premium.service";
import { isSuperAdminRole, PERMANENT_PREMIUM_EXPIRES_AT } from "@/lib/auth/privileged-premium";

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------
function serialize(obj: unknown): unknown {
  return JSON.parse(
    JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v))
  );
}

function buildLimitExceededResponse(params: {
  tier: string;
  maxAllowed: number;
  currentCount: number;
}) {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: "BIZCARD_LIMIT_EXCEEDED",
        message: "You have reached the maximum number of bizcards allowed for your subscription tier.",
        current_tier: params.tier,
        max_allowed: params.maxAllowed,
        current_count: params.currentCount,
        upgrade_required: true,
        upgrade_url: "/settings/subscription/upgrade",
      },
    },
    { status: 403 }
  );
}

// ----------------------------------------------------------------------
// GET /api/user/bizcards
// ----------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);

  // Rate limit: 60 requests per minute
  const rateCheck = checkRateLimit("user-bizcards-list", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many requests. Please slow down." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
      }
    );
  }

  // Authenticate
  const resolved = await resolveRequestSession(request);
  if (!resolved.session) {
    return NextResponse.json(
      { success: false, error: "Authentication required." },
      { status: 401 }
    );
  }
  // Use resolveEffectiveUserId so superadmin impersonation returns the target
  // user's bizcards instead of the superadmin's own.
  const userId = BigInt(resolveEffectiveUserId(resolved));

  try {
    await ensureSuperadminBizcardsPremium(userId).catch(() => undefined);

    // Parse query parameters (pagination, sorting, filtering)
    const searchParams = request.nextUrl.searchParams;
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit")) || 10));
    const sortBy = (searchParams.get("sortBy") || "created_at") as "created_at" | "updated_at" | "bizcard_name";
    const sortDir = (searchParams.get("sortDir") || "desc") as "asc" | "desc";
    const status = searchParams.get("status") || undefined; // "active" | "inactive" | all

    // Build where clause
    const where: any = {
      user_id: userId,
      deactivated_flag: false,
    };
    if (status === "active") where.deactivated_flag = false;
    else if (status === "inactive") where.deactivated_flag = true;

    // Fetch bizcards with pagination
    const [bizcards, total] = await Promise.all([
      prisma.bizcard.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          bizcard_id: true,
          serial_id: true,
          bizcard_name: true,
          url_alias: true,
          first_name: true,
          last_name: true,
          professional_title: true,
          profile_img: true,
          cover_img: true,
          bizcard_type: true,
          bizcard_style: true,
          bizcard_theme: true,
          subscription_tier: true,
          subscription_status: true,
          subscription_expires_at: true,
          qr_code_url: true,
          deactivated_flag: true,
          is_blank: true,
          last_url_alias_changed_at: true,
          created_at: true,
          updated_at: true,
        },
      }),
      prisma.bizcard.count({ where }),
    ]);

    // Map to the expected response shape
    const data = {
      bizcards: bizcards.map((card) => ({
        bizcard_id: card.bizcard_id,
        serial_id: card.serial_id,
        bizcard_name: card.bizcard_name,
        url_alias: card.url_alias,
        first_name: card.first_name,
        last_name: card.last_name,
        professional_title: card.professional_title,
        profile_img: card.profile_img,
        cover_img: card.cover_img,
        bizcard_type: card.bizcard_type,
        bizcard_style: card.bizcard_style,
        bizcard_theme: card.bizcard_theme,
        subscription_tier: card.subscription_tier,
        subscription_status: card.subscription_status,
        subscription_expires_at: card.subscription_expires_at,
        qr_code_url: card.qr_code_url,
        is_active: !card.deactivated_flag,
        created_at: card.created_at,
        updated_at: card.updated_at,
        preview_url: card.url_alias ? `/preview/${card.url_alias}` : null,
        services_count: 0,
        social_links_count: 0,
        views_count: 0,
        contacts_saved: 0,
        url_alias_editable: (() => {
          const eligibility = canChangeUrlAlias(card);
          return {
            editable: eligibility.allowed,
            daysRemaining: eligibility.daysRemaining,
            changeAvailableAt: eligibility.changeAvailableAt.toISOString(),
            reason: eligibility.allowed
              ? null
              : `URL alias can be changed again in ${eligibility.daysRemaining} days.`,
          };
        })(),
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        has_next: page < Math.ceil(total / limit),
        has_previous: page > 1,
      },
      subscription_info: {
        current_tier: "basic",
        max_bizcards_allowed: 10,
        current_bizcards: bizcards.length,
        is_limit_reached: false,
        upgrade_required: false,
        upgrade_url: "/settings/subscription",
      },
    };

    return NextResponse.json(serialize({ success: true, data }));
  } catch (error) {
    console.error("[user/bizcards GET] Error:", error);
    return NextResponse.json(
      { success: false, error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}

// ----------------------------------------------------------------------
// POST /api/user/bizcards
// ----------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);

  // Rate limit: 10 per minute for creation
  const rateCheck = checkRateLimit("user-bizcards-create", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many requests. Please slow down." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
      }
    );
  }

  const resolved = await resolveRequestSession(request);
  if (!resolved.session) {
    return NextResponse.json(
      { success: false, error: "Authentication required." },
      { status: 401 }
    );
  }
  const userId = BigInt(resolved.session.userId);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }

  // Basic validation — city is optional (location UI is map-link based; schema defaults city to "").
  // Contact accepts mobile (contact_number) OR telephone_number, matching Create New BizCard UI.
  const bizcard_name = typeof body.bizcard_name === "string" ? body.bizcard_name.trim() : "";
  const first_name = typeof body.first_name === "string" ? body.first_name.trim() : "";
  const last_name = typeof body.last_name === "string" ? body.last_name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const contactRaw =
    typeof body.contact_number === "string" ? body.contact_number.trim() : "";
  const telephoneRaw =
    typeof body.telephone_number === "string" ? body.telephone_number.trim() : "";
  const contact_number = contactRaw || telephoneRaw;
  const city =
    typeof body.city === "string" ? body.city.trim() : "";
  const bizcard_type = body.bizcard_type;

  if (!bizcard_name || !first_name || !last_name || !email || !contact_number || !bizcard_type) {
    return NextResponse.json(
      { success: false, error: "Missing required fields." },
      { status: 422 }
    );
  }

  // Validate and normalize bizcard_type
  type BizcardType = "virtual" | "physical";
  const ALLOWED_BIZCARD_TYPES: BizcardType[] = ["virtual", "physical"];
  const rawType = String(bizcard_type).toLowerCase().trim();
  const normalizedType: BizcardType = ALLOWED_BIZCARD_TYPES.includes(rawType as BizcardType)
    ? (rawType as BizcardType)
    : "virtual"; // fallback to virtual if invalid

  try {
    // Virtual cards must keep serial_id null so additional physical QR scans can
    // merge onto a newly created empty card (findVirtualCardsForMerge / claim flow).
    // Do not invent a BC- serial and do not copy fields from any existing BizCard.
    const urlAlias = `${first_name}-${last_name}-${Date.now()}`.toLowerCase().replace(/\s+/g, "-");

    const owner = await prisma.user.findUnique({
      where: { user_id: userId },
      select: { role: true, company_id: true },
    });
    const grantPermanentPremium = isSuperAdminRole(owner?.role);

    // Prefer user.company_id; fall back to active CompanyEmployee membership so
    // company Admin "Cards" counts (filtered by company_id) update for new cards.
    let companyId = owner?.company_id ?? null;
    if (!companyId) {
      const membership = await prisma.companyEmployee.findFirst({
        where: { user_id: userId, is_active: true },
        select: { company_id: true },
        orderBy: { joined_at: "desc" },
      });
      companyId = membership?.company_id ?? null;
    }

    const created = await prisma.bizcard.create({
      data: {
        user_id: userId,
        bizcard_name,
        first_name,
        last_name,
        email,
        contact_number,
        ...(telephoneRaw ? { telephone_number: telephoneRaw } : {}),
        city,
        bizcard_type: normalizedType,
        // Virtual → null serial (physical serial assigned later via merge).
        // Physical with an explicit serial is not used by Create New BizCard.
        serial_id: normalizedType === "virtual" ? null : undefined,
        url_alias: urlAlias,
        is_blank: false,
        deactivated_flag: false,
        ...(companyId ? { company_id: companyId } : {}),
        created_at: new Date(),
        updated_at: new Date(),
        last_url_alias_changed_at: new Date(),
        ...(grantPermanentPremium
          ? {
              subscription_tier: "premium",
              subscription_status: "active",
              subscription_started_at: new Date(),
              subscription_expires_at: PERMANENT_PREMIUM_EXPIRES_AT,
            }
          : {}),
      },
    });

    if (grantPermanentPremium) {
      await ensureSuperadminBizcardsPremium(userId).catch(() => undefined);
    }

    await logAuditEvent("bizcard_create", Number(userId), ip, ua, {
      bizcardId: created.bizcard_id.toString(),
      urlAlias,
    });

    return NextResponse.json(
      serialize({
        success: true,
        message: "Bizcard created successfully",
        data: {
          bizcard_id: created.bizcard_id,
          bizcard_name: created.bizcard_name,
          url_alias: created.url_alias,
          created_at: created.created_at,
          preview_url: `/${created.url_alias}`,
        },
      }),
      { status: 201 }
    );
  } catch (error) {
    console.error("[user/bizcards POST] Error:", error);
    return NextResponse.json(
      { success: false, error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}