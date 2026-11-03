// ──────────────────────────────────────────────────────────────
// POST /api/cards/link-employee — Assign a Company BizCard to an Employee
// ──────────────────────────────────────────────────────────────
// Called by a company admin to link a specific BizCard (already claimed
// by their company via POST /api/cards/assign) to a specific employee
// user account (Option 2 — Employee Registration final step).
//
// Typical workflow:
//   1. Admin scans multiple BizCards on the physical cards page
//   2. Admin submits the batch → POST /api/cards/assign  (claims cards)
//   3. Admin opens employee management → picks a card + employee
//   4. Admin submits → POST /api/cards/link-employee  (this endpoint)
//
// Security layers:
//   1. Middleware auth guard (session_token cookie required)
//   2. Full session DB validation (revocation, deactivation)
//   3. Role enforcement — only "company_admin" may call this endpoint
//   4. Company scope enforcement — admin can only assign cards that
//      belong to THEIR OWN company (IDOR prevention)
//   5. Target user scope enforcement — target user must belong to
//      the same company as the admin
//   6. IP rate limiting: 30/15 min — one-at-a-time operation
//   7. Input validation + sanitization
//   8. Duplicate prevention — rejects cards already linked to other users;
//      idempotent if card is already linked to the same employee (EmployeeCard
//      or Bizcard.serial_id). Additional physical cards are supported: a new
//      empty BizCard is created/claimed without copying existing BizCard data.
//   9. Atomic transaction — EmployeeCard activation + BizCard link/create
//  10. Audit logging for every outcome
//
// Response (200 OK):
//   {
//     message:      string
//     cardId:       number
//     serialId:     string
//     userId:       number
//     portfolioUrl: string | null
//     qrCode:       string | null   (base64 SVG; use as <img src>)
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
import { validateCardLinkEmployeeInput } from "@/server/lib/validators";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { generateQRCodeDataUrl, buildVCardPublicUrl } from "@/server/lib/qr";
import {
  ensureCompanyRole,
  resolveCompanyActorContext,
} from "@/server/lib/company";
import { AppError } from "@/lib/errors/types";
import { generateUniqueUrlAlias } from "@/lib/bizcard/url-generator";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);

  try {
    // ── Rate Limiting ──────────────────────────────
    const rateCheck = checkRateLimit("card-link-employee", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    // ── Session Validation ─────────────────────────
    const auth = await resolveRequestSession(request, { tryRefresh: true });
    if (!auth.session) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    let companyId: bigint;
    let actorUserId: number;

    try {
      const context = await resolveCompanyActorContext({
        userId: BigInt(resolveEffectiveUserId(auth)),
        requestId: "cards-link-employee",
      });
      ensureCompanyRole(context, ["admin"], "cards-link-employee");
      companyId = context.companyId;
      actorUserId = Number(context.userId);
    } catch (error) {
      if (error instanceof AppError) {
        return NextResponse.json({ error: error.message }, { status: error.statusCode });
      }
      return NextResponse.json(
        { error: "Forbidden. Only company admins can assign employee cards." },
        { status: 403 }
      );
    }

    // ── Parse & Validate Input ─────────────────────
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const validation = validateCardLinkEmployeeInput(body);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.errors[0] }, { status: 400 });
    }

    const { serialId, userId: targetUserId } = validation.data;
    const targetUserIdBig = BigInt(targetUserId);

    // ── Fetch Card + Target User Together ─────────
    // Parallel DB reads to avoid two sequential round-trips.
    const [card, targetUser, existingBizcardForSerial] = await Promise.all([
      prisma.employeeCard.findUnique({
        where: { serial_id: serialId },
        select: {
          card_id:           true,
          company_id:        true,
          assigned_user_id:  true,
          activation_status: true,
        },
      }),
      prisma.user.findUnique({
        where: { user_id: targetUserIdBig },
        select: {
          user_id:      true,
          company_id:   true,
          custom_uri:   true,
          first_name:   true,
          last_name:    true,
          email:        true,
          contact:      true,
          employeeCard: { select: { card_id: true, serial_id: true } },
        },
      }),
      prisma.bizcard.findFirst({
        where: { serial_id: serialId, deactivated_flag: false },
        select: {
          bizcard_id: true,
          user_id: true,
          is_blank: true,
          serial_id: true,
          qr_code_url: true,
          qr_code_generated_at: true,
          subscription_tier: true,
          portfolio_url: true,
          url_alias: true,
        },
      }),
    ]);

    // ── Card Existence & Ownership Check ──────────
    if (!card) {
      return NextResponse.json(
        { error: "Card not found. Make sure it has been registered to your company first." },
        { status: 404 }
      );
    }

    // Card must belong to THIS company — prevents IDOR across companies
    if (card.company_id === null || card.company_id !== companyId) {
      await logAuditEvent("CARD_LINK_EMPLOYEE_WRONG_COMPANY", actorUserId, ip, ua, { serialId });
      return NextResponse.json(
        { error: "This card does not belong to your company." },
        { status: 403 }
      );
    }

    // ── Target User Validation ─────────────────────
    if (!targetUser) {
      return NextResponse.json({ error: "Target employee account not found." }, { status: 404 });
    }

    // Target user must belong to the same company — prevents cross-company linkage
    if (targetUser.company_id === null || targetUser.company_id !== companyId) {
      await logAuditEvent("CARD_LINK_EMPLOYEE_USER_NOT_IN_COMPANY", actorUserId, ip, ua, { serialId, targetUserId });
      return NextResponse.json(
        { error: "This employee does not belong to your company." },
        { status: 403 }
      );
    }

    // ── Idempotency / Conflict Checks ──────────────
    // EmployeeCard.assigned_user_id is unique (one primary inventory link per user).
    // Additional physical cards are owned via Bizcard.serial_id → user_id.
    const alreadyOwnedByTargetBizcard =
      existingBizcardForSerial?.user_id !== null &&
      existingBizcardForSerial?.user_id !== undefined &&
      existingBizcardForSerial.user_id === targetUserIdBig;

    if (card.assigned_user_id !== null && card.assigned_user_id === targetUserIdBig) {
      const portfolioUrl = targetUser.custom_uri
        ? buildVCardPublicUrl(targetUser.custom_uri)
        : null;
      return NextResponse.json(
        {
          message:  "Card is already assigned to this employee.",
          cardId:   Number(card.card_id),
          serialId,
          userId:   targetUserId,
          portfolioUrl,
          qrCode:   null,
        },
        { status: 200 }
      );
    }

    if (alreadyOwnedByTargetBizcard) {
      const portfolioUrl = targetUser.custom_uri
        ? buildVCardPublicUrl(targetUser.custom_uri)
        : null;
      return NextResponse.json(
        {
          message:  "Card is already linked to this employee's BizCard.",
          cardId:   Number(card.card_id),
          serialId,
          userId:   targetUserId,
          portfolioUrl,
          qrCode:   null,
        },
        { status: 200 }
      );
    }

    if (card.assigned_user_id !== null && card.assigned_user_id !== targetUserIdBig) {
      await logAuditEvent("CARD_LINK_EMPLOYEE_ALREADY_TAKEN", actorUserId, ip, ua, { serialId });
      return NextResponse.json(
        { error: "This card is already assigned to another employee." },
        { status: 409 }
      );
    }

    if (
      existingBizcardForSerial?.user_id != null &&
      existingBizcardForSerial.user_id !== targetUserIdBig
    ) {
      await logAuditEvent("CARD_LINK_EMPLOYEE_SERIAL_OWNED", actorUserId, ip, ua, { serialId });
      return NextResponse.json(
        { error: "This card serial is already linked to another account." },
        { status: 409 }
      );
    }

    // ── Atomic Transaction ─────────────────────────
    // Mirrors Superadmin QR → create-separate / merge:
    //   • First physical link onto a null-serial placeholder: stamp / merge blank
    //   • Additional cards: create/claim a NEW empty BizCard (never copy existing)
    // EmployeeCard.assigned_user_id stays unique — only set when the employee has
    // no primary inventory card yet; further cards live on Bizcard.serial_id.
    const now = new Date();
    const firstName = (targetUser.first_name ?? "").trim() || "Employee";
    const lastName = (targetUser.last_name ?? "").trim() || "Card";
    const displayName = `${firstName} ${lastName}`.trim();
    const email = (targetUser.email ?? "").trim() || `employee_${targetUserId}@ontap.local`;
    const contactNumber = (targetUser.contact ?? "").trim();

    const needsNewAlias =
      !existingBizcardForSerial?.url_alias ||
      Boolean(existingBizcardForSerial?.is_blank && existingBizcardForSerial.user_id == null);

    const newUrlAlias = needsNewAlias
      ? await generateUniqueUrlAlias({
          requestedAlias: null,
          firstName,
          lastName,
          userId: targetUserIdBig,
        })
      : null;

    const updatedCard = await prisma.$transaction(async (tx) => {
      const primaryEmployeeCard = targetUser.employeeCard;
      const canSetAssignedUser =
        !primaryEmployeeCard || primaryEmployeeCard.serial_id === serialId;

      const linked = await tx.employeeCard.update({
        where: { serial_id: serialId },
        data: {
          ...(canSetAssignedUser ? { assigned_user_id: targetUserIdBig } : {}),
          activation_status: "active",
          activated_at:      now,
          updated_at:        now,
        },
      });

      const blankPhysical = await tx.bizcard.findFirst({
        where: {
          serial_id: serialId,
          deactivated_flag: false,
          user_id: null,
          is_blank: true,
        },
        select: {
          bizcard_id: true,
          serial_id: true,
          qr_code_url: true,
          qr_code_generated_at: true,
          subscription_tier: true,
          portfolio_url: true,
          url_alias: true,
        },
      });

      const alreadyOwned = await tx.bizcard.findFirst({
        where: {
          user_id: targetUserIdBig,
          deactivated_flag: false,
          serial_id: serialId,
        },
        select: { bizcard_id: true },
      });

      if (alreadyOwned) {
        return linked;
      }

      const userCards = await tx.bizcard.findMany({
        where: { user_id: targetUserIdBig, deactivated_flag: false },
        select: { bizcard_id: true, serial_id: true, url_alias: true, company_id: true },
        orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
      });
      const cardsWithSerial = userCards.filter((c) => c.serial_id != null);
      const nullSerialCard = userCards.find((c) => c.serial_id == null) ?? null;
      const isFirstPhysicalLink = cardsWithSerial.length === 0;

      const blankTier =
        typeof blankPhysical?.subscription_tier === "string"
          ? blankPhysical.subscription_tier.trim().toLowerCase()
          : "";
      const hasTier =
        blankTier === "basic" || blankTier === "standard" || blankTier === "premium";
      const subscriptionExpiresAt = hasTier
        ? (() => {
            const expiry = new Date(now);
            expiry.setFullYear(expiry.getFullYear() + 1);
            return expiry;
          })()
        : null;

      let planId: bigint | null = null;
      if (hasTier) {
        const plan = await tx.subscriptionPlan.findUnique({
          where: { tier_code: blankTier },
          select: { id: true },
        });
        planId = plan?.id ?? null;
      }

      const tierData = hasTier
        ? {
            subscription_tier: blankTier,
            subscription_status: "active",
            subscription_started_at: now,
            subscription_expires_at: subscriptionExpiresAt,
          }
        : {};

      // First physical link onto the employee's only placeholder (null serial):
      // merge blank → placeholder (or stamp serial). Existing card data is kept
      // because this is activation of that card, not an additional card.
      if (isFirstPhysicalLink && nullSerialCard) {
        if (blankPhysical) {
          await tx.bizcardMergeHistory.create({
            data: {
              blank_bizcard_id: blankPhysical.bizcard_id,
              blank_serial_id: blankPhysical.serial_id ?? serialId,
              virtual_bizcard_id: nullSerialCard.bizcard_id,
              user_id: targetUserIdBig,
              merged_at: now,
            },
          });

          await tx.bizcard.delete({ where: { bizcard_id: blankPhysical.bizcard_id } });

          const alias =
            typeof nullSerialCard.url_alias === "string"
              ? nullSerialCard.url_alias.trim()
              : "";
          const aliasPortfolioUrl = alias
            ? buildVCardPublicUrl(alias) ?? `/${encodeURIComponent(alias)}`
            : null;

          await tx.bizcard.update({
            where: { bizcard_id: nullSerialCard.bizcard_id },
            data: {
              serial_id: serialId,
              is_merged: true,
              merged_at: now,
              bizcard_type: "physical",
              company_id: nullSerialCard.company_id ?? companyId,
              updated_at: now,
              ...(blankPhysical.qr_code_url
                ? { qr_code_url: blankPhysical.qr_code_url }
                : {}),
              ...(blankPhysical.qr_code_generated_at
                ? { qr_code_generated_at: blankPhysical.qr_code_generated_at }
                : {}),
              portfolio_url:
                aliasPortfolioUrl ?? blankPhysical.portfolio_url ?? null,
              ...tierData,
            },
          });

          if (hasTier && planId && subscriptionExpiresAt) {
            await tx.bizcardSubscription.upsert({
              where: { bizcard_id: nullSerialCard.bizcard_id },
              create: {
                bizcard_id: nullSerialCard.bizcard_id,
                plan_id: planId,
                status: "active",
                billing_cycle: "yearly",
                started_at: now,
                expires_at: subscriptionExpiresAt,
                auto_renew: true,
              },
              update: {
                plan_id: planId,
                status: "active",
                billing_cycle: "yearly",
                started_at: now,
                expires_at: subscriptionExpiresAt,
                auto_renew: true,
              },
            });
          }
        } else {
          await tx.bizcard.update({
            where: { bizcard_id: nullSerialCard.bizcard_id },
            data: {
              serial_id: serialId,
              is_merged: true,
              merged_at: now,
              bizcard_type: "physical",
              company_id: nullSerialCard.company_id ?? companyId,
              updated_at: now,
            },
          });
        }

        return linked;
      }

      // Additional physical card (or no placeholder): new empty BizCard.
      // Never copy fields from the employee's existing BizCard(s).
      if (blankPhysical) {
        const alias = newUrlAlias ?? (await generateUniqueUrlAlias({
          requestedAlias: null,
          firstName,
          lastName,
          userId: targetUserIdBig,
        }));
        const aliasPortfolioUrl =
          buildVCardPublicUrl(alias) ?? `/${encodeURIComponent(alias)}`;

        await tx.bizcard.update({
          where: { bizcard_id: blankPhysical.bizcard_id },
          data: {
            user_id: targetUserIdBig,
            company_id: companyId,
            is_blank: false,
            is_merged: true,
            merged_at: now,
            claimed_at: now,
            claimed_by_user_id: targetUserIdBig,
            bizcard_type: "physical",
            bizcard_name: displayName,
            first_name: firstName,
            last_name: lastName,
            email,
            contact_number: contactNumber,
            city: "",
            url_alias: alias,
            portfolio_url: aliasPortfolioUrl,
            // Keep blank empty of profile content — user fills afterward.
            bio: null,
            description: null,
            occupation: null,
            professional_title: null,
            post_nominal: null,
            suffix: null,
            middle_name: null,
            profile_img: null,
            cover_img: null,
            alt_email: null,
            alt_contact_number: null,
            languages: null,
            updated_at: now,
            ...tierData,
          },
        });

        if (hasTier && planId && subscriptionExpiresAt) {
          await tx.bizcardSubscription.upsert({
            where: { bizcard_id: blankPhysical.bizcard_id },
            create: {
              bizcard_id: blankPhysical.bizcard_id,
              plan_id: planId,
              status: "active",
              billing_cycle: "yearly",
              started_at: now,
              expires_at: subscriptionExpiresAt,
              auto_renew: true,
            },
            update: {
              plan_id: planId,
              status: "active",
              billing_cycle: "yearly",
              started_at: now,
              expires_at: subscriptionExpiresAt,
              auto_renew: true,
            },
          });
        }
      } else {
        const alias = newUrlAlias ?? (await generateUniqueUrlAlias({
          requestedAlias: null,
          firstName,
          lastName,
          userId: targetUserIdBig,
        }));

        await tx.bizcard.create({
          data: {
            user_id: targetUserIdBig,
            company_id: companyId,
            serial_id: serialId,
            bizcard_name: displayName,
            first_name: firstName,
            last_name: lastName,
            email,
            contact_number: contactNumber,
            city: "",
            url_alias: alias,
            bizcard_type: "physical",
            is_merged: true,
            merged_at: now,
            is_blank: false,
            deactivated_flag: false,
            created_at: now,
            updated_at: now,
            last_url_alias_changed_at: now,
          },
        });
      }

      return linked;
    }, { timeout: 15000 });

    // ── Generate QR Code ───────────────────────────
    // Non-fatal — card is linked even if QR generation fails.
    let qrCode: string | null = null;
    let portfolioUrl: string | null = null;

    if (targetUser.custom_uri) {
      portfolioUrl = buildVCardPublicUrl(targetUser.custom_uri);
      if (portfolioUrl) {
        qrCode = generateQRCodeDataUrl(portfolioUrl);

        if (qrCode) {
          try {
            await prisma.vCardSetup.update({
              where: { user_id: targetUserIdBig },
              data:  { qr_code: qrCode, qr_generated_at: new Date() },
            });
          } catch {
            // Non-fatal — dashboard can regenerate via /api/vcard/setup
          }
        }
      }
    }

    // ── Audit Log ──────────────────────────────────
    await logAuditEvent("CARD_LINK_EMPLOYEE_SUCCESS", actorUserId, ip, ua, {
      serialId,
      cardId:       Number(updatedCard.card_id),
      targetUserId,
      companyId:    Number(companyId),
    });

    return NextResponse.json(
      {
        message:      "Card successfully assigned to employee.",
        cardId:       Number(updatedCard.card_id),
        serialId:     updatedCard.serial_id,
        userId:       targetUserId,
        portfolioUrl,
        qrCode,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[cards/link-employee] Error:", error);
    await logAuditEvent("CARD_LINK_EMPLOYEE_ERROR", undefined, ip, ua, {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    const prismaCode =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : null;

    if (prismaCode === "P2002") {
      return NextResponse.json(
        {
          error:
            "This card serial is already linked to another BizCard. Unlink or merge first.",
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
