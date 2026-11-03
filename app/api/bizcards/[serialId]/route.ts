// ──────────────────────────────────────────────────────────────
// GET /api/bizcards/[serialId] — BizCard Detail View
// ──────────────────────────────────────────────────────────────
// Returns complete information about a specific BizCard and its
// linked vCard profile, including scan statistics.
//
// Authentication: Required (session_token cookie).
//
// Authorization:
//   Only the following identities may read this detail view:
//     1. The assigned user (the card is linked to their profile)
//     2. A company_admin of the company that owns the card
//
// Response shape:
// {
//   card: {
//     cardId:           string
//     serialId:         string
//     cardType:         "individual" | "employee"
//     activationStatus: string
//     activatedAt:      string | null
//     createdAt:        string
//     company: { companyId, name } | null
//   },
//   vcard: {
//     userId:      string
//     firstName:   string
//     lastName:    string
//     middleName:  string | null
//     profTitle:   string | null
//     postNominal: string | null
//     vcardName:   string | null
//     vcardDescription: string | null
//     jobPosition: string | null
//     about:       string | null
//     email:       string
//     contact:     string | null
//     altContact:  string | null
//     altEmail:    string | null
//     customUri:   string | null
//     profileUrl:  string | null
//     coverUrl:    string | null
//     isPublished: boolean
//     socials:     Array<{ platform, url, isVisible }>
//     services:    Array<{ name, description, serviceUrl, isVisible }>
//     products:    Array<{ name, description, productUrl, isVisible }>
//     addresses:   Array<{ label, street, city, province, zip, country }>
//   } | null,
//   qrCode:       string | null,
//   portfolioUrl: string | null,
//   scanStats: {
//     totalScans:   number
//     recentScans:  Array<{ scannedAt, deviceType, browser, os }>
//   }
// }
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { validateToken, getClientIp, logAuditEvent } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { buildVCardPublicUrl, generateQRCodeDataUrl } from "@/server/lib/qr";
import { validateBizCardUpdateInput } from "@/server/lib/validators";

const SERIAL_ID_REGEX = /^[A-Za-z0-9_-]{4,64}$/;

// How many recent scan rows to return in the stats block
const RECENT_SCANS_LIMIT = 10;

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serialId: string }> }
) {
  const ip = getClientIp(request);

  try {
    // ── Rate Limiting ──────────────────────────────
    const rateCheck = checkRateLimit("bizcards-detail", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    // ── Authentication ─────────────────────────────
    const rawToken = request.cookies.get("session_token")?.value;
    if (!rawToken) {
      return NextResponse.json(
        { error: "Authentication required.", requiresAuth: true },
        { status: 401 }
      );
    }
    const session = await validateToken(rawToken);
    if (!session) {
      return NextResponse.json(
        { error: "Session expired. Please log in again.", requiresAuth: true },
        { status: 401 }
      );
    }

    // ── Validate serialId param ────────────────────
    const { serialId } = await params;
    if (!serialId || !SERIAL_ID_REGEX.test(serialId)) {
      return NextResponse.json({ error: "Card not found." }, { status: 404 });
    }

    // ── Fetch the card with full relations ─────────
    // Single query covering: card → company, card → user (+ their vCard data),
    // vCardSetup (QR code), scan count, and the 10 most recent scan rows.
    const card = await prisma.employeeCard.findUnique({
      where: { serial_id: serialId },
      select: {
        card_id:           true,
        serial_id:         true,
        card_type:         true,
        company_id:        true,
        assigned_user_id:  true,
        activation_status: true,
        activated_at:      true,
        created_at:        true,
        updated_at:        true,
        company: {
          select: {
            company_id: true,
            name:       true,
          },
        },
        user: {
          select: {
            user_id:          true,
            first_name:       true,
            last_name:        true,
            middle_name:      true,
            prof_title:       true,
            post_nominal:     true,
            job_position:     true,
            about:            true,
            email:            true,
            contact:          true,
            alt_contact:      true,
            alt_email:        true,
            custom_uri:       true,
            profile_url:      true,
            cover_url:        true,
            company_id:       true,
            role:             true,
            // Profile content
            socials: {
              where:   { is_visible: true },
              orderBy: { display_order: "asc" },
              select:  { platform: true, url: true, is_visible: true },
            },
            services: {
              orderBy: { display_order: "asc" },
              select:  { name: true, description: true, service_url: true, is_visible: true },
            },
            products: {
              select:  { name: true, description: true, product_url: true, price: true, currency_code: true },
            },
            addresses: {
              select: {
                area:      true,
                brgy:      true,
                city:      true,
                region:    true,
                zipcode:   true,
                plus_code: true,
              },
            },
            vcardSetup: {
              select: { qr_code: true, is_published: true },
            },
          },
        },
        // Scan analytics
        _count: {
          select: { scans: true },
        },
        scans: {
          orderBy: { scanned_at: "desc" },
          take:    RECENT_SCANS_LIMIT,
          select: {
            scanned_at:  true,
            device_type: true,
            browser:     true,
            os:          true,
          },
        },
      },
    });

    // ── Not Found ──────────────────────────────────
    if (!card) {
      return NextResponse.json({ error: "Card not found." }, { status: 404 });
    }

    // ── Authorization check ────────────────────────
    // The requesting user must be one of:
    //   1. The card's assigned user
    //   2. A company_admin for the card's company
    const requesterId   = BigInt(session.userId);
    const isAssignedUser = card.assigned_user_id != null && card.assigned_user_id === requesterId;

    let isCompanyAdmin = false;
    if (!isAssignedUser && card.company_id != null) {
      // Fetch caller's role + company_id only when needed (no extra join on hot path)
      const caller = await prisma.user.findUnique({
        where:  { user_id: requesterId },
        select: { role: true, company_id: true },
      });
      isCompanyAdmin =
        caller?.role === "company_admin" &&
        caller.company_id != null &&
        caller.company_id === card.company_id;
    }

    if (!isAssignedUser && !isCompanyAdmin) {
      // Return 404 instead of 403 to avoid leaking card existence to unauthorised callers
      return NextResponse.json({ error: "Card not found." }, { status: 404 });
    }

    const bizcard = card.assigned_user_id
      ? await prisma.bizcard.findFirst({
          where: { user_id: card.assigned_user_id },
          orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
          select: {
            url_alias: true,
            first_name: true,
            last_name: true,
            middle_name: true,
            professional_title: true,
            post_nominal: true,
            bizcard_name: true,
            description: true,
            occupation: true,
            bio: true,
            email: true,
            contact_number: true,
            alt_contact_number: true,
            alt_email: true,
            profile_img: true,
            cover_img: true,
            deactivated_flag: true,
          },
        })
      : null;

    // ── Build response ─────────────────────────────
    const customUri    = bizcard?.url_alias ?? card.user?.custom_uri ?? null;
    const portfolioUrl = customUri ? buildVCardPublicUrl(customUri) : null;
    const qrCode       = card.user?.vcardSetup?.qr_code ?? null;

    const vcardData = card.user
      ? {
          userId:           card.user.user_id,
          firstName:        bizcard?.first_name ?? card.user.first_name,
          lastName:         bizcard?.last_name ?? card.user.last_name,
          middleName:       bizcard?.middle_name ?? card.user.middle_name,
          profTitle:        bizcard?.professional_title ?? card.user.prof_title,
          postNominal:      bizcard?.post_nominal ?? card.user.post_nominal,
          vcardName:        bizcard?.bizcard_name ?? `${card.user.first_name} ${card.user.last_name}`.trim(),
          vcardDescription: bizcard?.description ?? card.user.about,
          jobPosition:      bizcard?.occupation ?? card.user.job_position,
          about:            bizcard?.bio ?? card.user.about,
          email:            bizcard?.email ?? card.user.email,
          contact:          bizcard?.contact_number ?? card.user.contact,
          altContact:       bizcard?.alt_contact_number ?? card.user.alt_contact,
          altEmail:         bizcard?.alt_email ?? card.user.alt_email,
          customUri,
          profileUrl:       bizcard?.profile_img ?? card.user.profile_url,
          coverUrl:         bizcard?.cover_img ?? card.user.cover_url,
          isPublished:      bizcard ? !bizcard.deactivated_flag : (card.user.vcardSetup?.is_published ?? false),
          socials:  card.user.socials.map((s) => ({
            platform:  s.platform,
            url:       s.url,
            isVisible: s.is_visible,
          })),
          services: card.user.services.map((s) => ({
            name:        s.name,
            description: s.description,
            serviceUrl:  s.service_url,
            isVisible:   s.is_visible,
          })),
          products: card.user.products.map((p) => ({
            name:          p.name,
            description:   p.description,
            productUrl:    p.product_url,
            price:         p.price,
            currencyCode:  p.currency_code,
          })),
          addresses: card.user.addresses.map((a) => ({
            area:     a.area,
            brgy:     a.brgy,
            city:     a.city,
            region:   a.region,
            zipcode:  a.zipcode,
            plusCode: a.plus_code,
          })),
        }
      : null;

    return NextResponse.json(
      serialize({
        card: {
          cardId:           card.card_id,
          serialId:         card.serial_id,
          cardType:         card.card_type,
          activationStatus: card.activation_status,
          activatedAt:      card.activated_at,
          createdAt:        card.created_at,
          company:          card.company
            ? { companyId: card.company.company_id, name: card.company.name }
            : null,
        },
        vcard:        vcardData,
        qrCode,
        portfolioUrl,
        scanStats: {
          totalScans:  card._count.scans,
          recentScans: card.scans.map((s) => ({
            scannedAt:  s.scanned_at,
            deviceType: s.device_type,
            browser:    s.browser,
            os:         s.os,
          })),
        },
      }),
      { status: 200 }
    );
  } catch (err) {
    console.error("[bizcards/[serialId]] GET Unhandled error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}

// ──────────────────────────────────────────────────────────────
// PUT /api/bizcards/[serialId] — BizCard Edit
// ──────────────────────────────────────────────────────────────
// Updates the vCard profile data and/or activation status for a
// specific BizCard.
//
// Authentication: Required.
//
// Authorization (same as GET):
//   1. Assigned user — can set activationStatus to "active" or "inactive" only
//   2. Company admin of the card's owning company — can also set "revoked"
//
// Editable fields:
//   customUri, vcardName, profTitle, jobPosition, about,
//   contact, altContact, altEmail, activationStatus
//
// Serial ID (the physical NFC encoded value) is NEVER editable.
//
// URI change flow:
//   If customUri is being changed the handler will:
//     1. Verify uniqueness against User.custom_uri
//     2. Regenerate the QR code
//     3. Upsert VCardSetup.qr_code in the same transaction
//
// Response:
// {
//   message:      string,
//   card: {
//     cardId, serialId, activationStatus,
//     portfolioUrl, qrCode
//   }
// }
// ──────────────────────────────────────────────────────────────

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ serialId: string }> }
) {
  const ip = getClientIp(request);
  const ua = request.headers.get("user-agent") ?? "";

  try {
    // ── Rate Limiting ──────────────────────────────
    const rateCheck = checkRateLimit("bizcards-update", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    // ── Authentication ─────────────────────────────
    const rawToken = request.cookies.get("session_token")?.value;
    if (!rawToken) {
      return NextResponse.json(
        { error: "Authentication required.", requiresAuth: true },
        { status: 401 }
      );
    }
    const session = await validateToken(rawToken);
    if (!session) {
      return NextResponse.json(
        { error: "Session expired. Please log in again.", requiresAuth: true },
        { status: 401 }
      );
    }

    // ── Validate serialId param ────────────────────
    const { serialId } = await params;
    if (!serialId || !SERIAL_ID_REGEX.test(serialId)) {
      return NextResponse.json({ error: "Card not found." }, { status: 404 });
    }

    // ── Parse + validate body ──────────────────────
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const { valid, errors, data } = validateBizCardUpdateInput(body);
    if (!valid) {
      return NextResponse.json({ error: "Validation failed.", details: errors }, { status: 422 });
    }

    // ── Fetch card (minimal — just what auth check needs) ──
    const card = await prisma.employeeCard.findUnique({
      where:  { serial_id: serialId },
      select: {
        card_id:           true,
        serial_id:         true,
        company_id:        true,
        assigned_user_id:  true,
        activation_status: true,
        user: {
          select: {
            user_id:    true,
            custom_uri: true,
            role:       true,
            company_id: true,
            vcardSetup: {
              select: { id: true, qr_code: true },
            },
          },
        },
      },
    });

    if (!card) {
      return NextResponse.json({ error: "Card not found." }, { status: 404 });
    }

    // ── Authorization ──────────────────────────────
    const requesterId   = BigInt(session.userId);
    const isAssignedUser = card.assigned_user_id != null && card.assigned_user_id === requesterId;

    let isCompanyAdmin = false;
    if (!isAssignedUser && card.company_id != null) {
      const caller = await prisma.user.findUnique({
        where:  { user_id: requesterId },
        select: { role: true, company_id: true },
      });
      isCompanyAdmin =
        caller?.role === "company_admin" &&
        caller.company_id != null &&
        caller.company_id === card.company_id;
    }

    if (!isAssignedUser && !isCompanyAdmin) {
      return NextResponse.json({ error: "Card not found." }, { status: 404 });
    }

    // ── "revoked" guard — only company_admin can revoke ──
    if (data.activationStatus === "revoked" && !isCompanyAdmin) {
      return NextResponse.json(
        { error: "Only a company administrator can revoke a card." },
        { status: 403 }
      );
    }

    // ── URI uniqueness check (before transaction) ──
    const currentUri = card.user?.custom_uri ?? null;
    const newUri     = data.customUri ?? null;
    const uriChanging = newUri !== null && newUri !== currentUri;

    if (uriChanging) {
      // Ensure no other user already holds the requested URI
      const uriOwner = await prisma.user.findFirst({
        where: {
          custom_uri: newUri,
          NOT: { user_id: requesterId },
        },
        select: { user_id: true },
      });
      if (uriOwner) {
        return NextResponse.json(
          { error: "That portfolio URL is already taken. Please choose another." },
          { status: 409 }
        );
      }
    }

    // ── Pre-generate QR outside the transaction (CPU work) ──
    let newQrCode: string | null = null;
    if (uriChanging && newUri) {
      const publicUrl = buildVCardPublicUrl(newUri);
      if (publicUrl) {
        newQrCode = generateQRCodeDataUrl(publicUrl);
      }
    }

    // ── Build per-model update payloads ───────────
    // User-level vCard fields
    const userUpdateData: Record<string, unknown> = {};
    const bizcardUpdateData: Record<string, unknown> = {};
    if (data.customUri   !== null && uriChanging) userUpdateData.custom_uri       = data.customUri;
    if (data.profTitle   !== null)                 userUpdateData.prof_title       = data.profTitle;
    if (data.jobPosition !== null)                 userUpdateData.job_position     = data.jobPosition;
    if (data.about       !== null)                 userUpdateData.about            = data.about;
    if (data.contact     !== null)                 userUpdateData.contact          = data.contact;
    if (data.altContact  !== null)                 userUpdateData.alt_contact      = data.altContact;
    if (data.altEmail    !== null)                 userUpdateData.alt_email        = data.altEmail;

    if (data.customUri   !== null && uriChanging) bizcardUpdateData.url_alias          = data.customUri;
    if (data.vcardName   !== null)                 bizcardUpdateData.bizcard_name       = data.vcardName;
    if (data.profTitle   !== null)                 bizcardUpdateData.professional_title = data.profTitle;
    if (data.jobPosition !== null)                 bizcardUpdateData.occupation         = data.jobPosition;
    if (data.about       !== null)                 bizcardUpdateData.bio                = data.about;
    if (data.contact     !== null)                 bizcardUpdateData.contact_number     = data.contact;
    if (data.altContact  !== null)                 bizcardUpdateData.alt_contact_number = data.altContact;
    if (data.altEmail    !== null)                 bizcardUpdateData.alt_email          = data.altEmail;

    const cardNeedsUpdate = data.activationStatus !== null;
    const userNeedsUpdate = Object.keys(userUpdateData).length > 0;
    const bizcardNeedsUpdate = Object.keys(bizcardUpdateData).length > 0;
    const vcardSetupNeedsUpdate = uriChanging && newQrCode !== null;

    if (!userNeedsUpdate && !bizcardNeedsUpdate && !cardNeedsUpdate && !vcardSetupNeedsUpdate) {
      return NextResponse.json({ error: "No changes provided." }, { status: 400 });
    }

    // ── Atomic transaction ─────────────────────────
    // The card's assigned_user_id tells us which User row to update.
    // If no user is assigned yet, we skip user/vCard updates but still allow status changes.
    const assignedUserId = card.assigned_user_id;

    const [updatedCard, updatedUser] = await prisma.$transaction(async (tx) => {
      // 1. Update vCard fields on User
      let txUser = null;
      if (userNeedsUpdate && assignedUserId) {
        txUser = await tx.user.update({
          where:  { user_id: assignedUserId },
          data:   userUpdateData,
          select: { user_id: true, custom_uri: true },
        });
      }

      if (bizcardNeedsUpdate && assignedUserId) {
        await tx.bizcard.updateMany({
          where: { user_id: assignedUserId },
          data: bizcardUpdateData,
        });
      }

      // 2. Upsert VCardSetup QR code if URI changed
      if (vcardSetupNeedsUpdate && assignedUserId && newQrCode) {
        await tx.vCardSetup.upsert({
          where:  { user_id: assignedUserId },
          create: {
            user_id:          assignedUserId,
            qr_code:          newQrCode,
            qr_generated_at:  new Date(),
            is_published:     false,
          },
          update: {
            qr_code:         newQrCode,
            qr_generated_at: new Date(),
          },
        });
      }

      // 3. Update EmployeeCard activation status
      let txCard = null;
      if (cardNeedsUpdate) {
        txCard = await tx.employeeCard.update({
          where:  { serial_id: serialId },
          data:   { activation_status: data.activationStatus! },
          select: { card_id: true, serial_id: true, activation_status: true },
        });
      } else {
        txCard = await tx.employeeCard.findUnique({
          where:  { serial_id: serialId },
          select: { card_id: true, serial_id: true, activation_status: true },
        });
      }

      return [txCard, txUser] as const;
    }, { timeout: 15000 });

    // ── Audit log ──────────────────────────────────
    const changes: Record<string, unknown> = {};
    if (data.activationStatus !== null) changes.activationStatus = data.activationStatus;
    if (uriChanging)                    changes.customUri        = newUri;
    if (Object.keys(userUpdateData).filter(k => k !== "custom_uri").length > 0) {
      changes.fields = Object.keys(userUpdateData).filter(k => k !== "custom_uri");
    }

    await logAuditEvent(
      "BIZCARD_UPDATED",
      session.userId,
      ip,
      ua,
      { serialId, ...changes }
    );

    // ── Response ───────────────────────────────────
    const finalUri         = uriChanging ? newUri : currentUri;
    const finalPortfolioUrl = finalUri ? buildVCardPublicUrl(finalUri) : null;
    const finalQrCode      = vcardSetupNeedsUpdate ? newQrCode : (card.user?.vcardSetup?.qr_code ?? null);

    return NextResponse.json(
      serialize({
        message: "BizCard updated successfully.",
        card: {
          cardId:           updatedCard?.card_id,
          serialId:         updatedCard?.serial_id ?? serialId,
          activationStatus: updatedCard?.activation_status,
          portfolioUrl:     finalPortfolioUrl,
          qrCode:           finalQrCode,
        },
      }),
      { status: 200 }
    );
  } catch (err) {
    console.error("[bizcards/[serialId]] PUT Unhandled error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
