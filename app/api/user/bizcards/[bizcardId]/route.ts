import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { getClientIp, getUserAgent, logAuditEvent } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getUserBizcardLimits } from "@/lib/bizcard/limits";
import { validateBizcardUpdateInput } from "@/lib/bizcard/validation";
import { generateUniqueUrlAlias } from "@/lib/bizcard/url-generator";
import { canChangeUrlAlias, serializeUrlAliasEligibility } from "@/lib/bizcard/url-alias-utils";
import { withPerformanceTracking } from "@/middleware/performance";
import { buildVCardPublicUrl } from "@/server/lib/qr";
import { QRCodeService } from "@/lib/services/qr-code.service";
import { requireSession, serialize } from "../_helpers";
import {
  findUserSocialsForEditor,
  linkUserSocialsToSoleBizcard,
} from "@/lib/bizcard/link-sole-bizcard-socials";
import { dedupeSocialLinksByUrl } from "@/lib/social-links";
import {
  buildBizcardInquiryWhere,
  countBizcardContactSaves,
  countBizcardPortfolioViews,
  isSoleActiveBizcardForOwner,
} from "@/server/lib/analytics";

function parseBizcardId(value: string): bigint | null {
  try {
    const parsed = BigInt(value);
    if (parsed <= BigInt(0)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function getOwnedBizcard(userId: bigint, bizcardId: bigint) {
  // Services still use the relation include. Orphans (bizcard_id null) are NOT
  // reachable through Bizcard.services — those stay on the modular services API.
  // Socials are loaded separately via findUserSocialsForEditor (user-owned).
  const childScope = {
    OR: [
      { bizcard_id: bizcardId },
      { bizcard_id: null, user_id: userId },
    ],
  };

  return prisma.bizcard.findFirst({
    where: { bizcard_id: bizcardId, user_id: userId },
    include: {
      user: {
        select: {
          profile_url: true,
          cover_url: true,
        },
      },
      company: {
        select: {
          company_id: true,
          name: true,
        },
      },
      services: {
        where: childScope,
        orderBy: { display_order: "asc" },
        select: {
          service_id: true,
          name: true,
          description: true,
          tagline: true,
          service_url: true,
          featured_image: true,
          display_order: true,
          is_visible: true,
          status: true,
        },
      },
    },
  });
}

// Helper to safely count analytics, falling back to 0 on error
async function safeAnalyticsCount(promise: Promise<number>): Promise<number> {
  try {
    return await promise;
  } catch (error) {
    console.warn("[bizcard-detail] Analytics query failed, using 0:", error);
    return 0;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bizcardId: string }> }
) {
  return withPerformanceTracking(request, async () => {
    const ip = getClientIp(request);
    const rateCheck = checkRateLimit("user-bizcards-detail", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many requests. Please slow down." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
      );
    }

    const auth = await requireSession(request);
    if (!auth.ok) return auth.response;

    const rawParams = await params;
    const bizcardId = parseBizcardId(rawParams.bizcardId);
    if (!bizcardId) {
      return NextResponse.json(
        { success: false, error: { code: "BIZCARD_NOT_FOUND", message: "Bizcard not found." } },
        { status: 404 }
      );
    }

    try {
      const bizcard = await getOwnedBizcard(auth.userId, bizcardId);
      if (!bizcard) {
        return NextResponse.json(
          { success: false, error: { code: "BIZCARD_NOT_FOUND", message: "Bizcard not found." } },
          { status: 404 }
        );
      }

      // Single-card users: attach orphan / mis-linked Social rows to this card.
      await linkUserSocialsToSoleBizcard(auth.userId);

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const ownerId = auth.userId;
      const sole = await isSoleActiveBizcardForOwner(ownerId, bizcard.bizcard_id);
      const inquiryWhere = buildBizcardInquiryWhere(ownerId, bizcard.bizcard_id, sole);
      const weekRange = { gte: sevenDaysAgo, lte: new Date() };

      const [
        viewsCount,
        contactsSaved,
        viewsLast7Days,
        contactsSavedLast7Days,
        totalInquiries,
        unreadInquiries,
        limits,
        userSocials,
      ] = await Promise.all([
        safeAnalyticsCount(countBizcardPortfolioViews(ownerId, bizcard.bizcard_id)),
        safeAnalyticsCount(countBizcardContactSaves(ownerId, bizcard.bizcard_id)),
        safeAnalyticsCount(countBizcardPortfolioViews(ownerId, bizcard.bizcard_id, weekRange)),
        safeAnalyticsCount(countBizcardContactSaves(ownerId, bizcard.bizcard_id, weekRange)),
        prisma.inquiry.count({ where: inquiryWhere }),
        prisma.inquiry.count({
          where: { ...inquiryWhere, status: { in: ["new", "unread"] } },
        }),
        getUserBizcardLimits(auth.userId),
        findUserSocialsForEditor(auth.userId),
      ]);

      const tier = limits.tier;
      const canPermanentDelete = tier === "premium" || tier === "enterprise";
      const urlAliasEligibility = canChangeUrlAlias(bizcard);

      let qrCodeUrl = bizcard.qr_code_url ?? null;
      if (!qrCodeUrl && bizcard.url_alias) {
        try {
          const qrService = new QRCodeService(`bizcard_detail_${Date.now()}`);
          const generated = await qrService.getOrGenerateQRCode(
            bizcard.bizcard_id,
            bizcard.url_alias
          );
          qrCodeUrl = generated.qr_code_url;
        } catch (qrError) {
          console.error("[user/bizcards/[bizcardId]] QR generation failed:", qrError);
        }
      }

      const portfolioUrl = bizcard.url_alias ? buildVCardPublicUrl(bizcard.url_alias) : null;

      return NextResponse.json(
        serialize({
          success: true,
          data: {
            bizcard: {
              bizcard_id: bizcard.bizcard_id,
              bizcard_name: bizcard.bizcard_name,
              serial_id: bizcard.serial_id,
              url_alias: bizcard.url_alias,
              url_alias_editable: serializeUrlAliasEligibility(urlAliasEligibility),
              description: bizcard.description,
              first_name: bizcard.first_name,
              middle_name: bizcard.middle_name,
              last_name: bizcard.last_name,
              occupation: bizcard.occupation,
              professional_title: bizcard.professional_title,
              post_nominal: bizcard.post_nominal,
              suffix: bizcard.suffix,
              area: bizcard.area,
              baranggay: bizcard.baranggay,
              city: bizcard.city,
              zip_code: bizcard.zip_code,
              region: bizcard.region,
              address_link: bizcard.address_link,
              company: bizcard.company
                ? {
                    company_id: bizcard.company.company_id,
                    name: bizcard.company.name,
                  }
                : null,
              bio: bizcard.bio,
              email: bizcard.email,
              contact_number: bizcard.contact_number,
              alt_email: bizcard.alt_email,
              alt_contact_number: bizcard.alt_contact_number,
              languages: bizcard.languages ? bizcard.languages.split(",").map((item) => item.trim()).filter(Boolean) : [],
              // Match the public portfolio: User images are authoritative.
              profile_img: bizcard.user?.profile_url ?? bizcard.profile_img ?? null,
              cover_img: bizcard.user?.cover_url ?? null,
              bizcard_theme: bizcard.bizcard_theme,
              show_cover_photo: bizcard.show_cover_photo !== false,
              show_inquiry_card: bizcard.show_inquiry_card !== false,
              show_associate_count: bizcard.show_associate_count === true,
              show_mutual_associates: bizcard.show_mutual_associates === true,
              show_email: bizcard.show_email !== false,
              contact_link_label: bizcard.contact_link_label,
              bizcard_type: bizcard.bizcard_type,
              is_merged: bizcard.is_merged,
              is_active: !bizcard.deactivated_flag,
              stats: {
                views_count: viewsCount,
                contacts_saved: contactsSaved,
                profile_views_last_7_days: viewsLast7Days,
                contacts_saved_last_7_days: contactsSavedLast7Days,
                total_inquiries: totalInquiries,
                unread_inquiries: unreadInquiries,
              },
              social_links: dedupeSocialLinksByUrl(userSocials, (item) => item.url).map(
                (item) => ({
                  id: item.socials_id,
                  platform: item.platform,
                  url: item.url,
                  is_visible: item.is_visible,
                  display_order: item.display_order,
                }),
              ),
              services: bizcard.services.map((item) => ({
                id: item.service_id,
                name: item.name,
                description: item.description,
                tagline: item.tagline,
                price: null,
                service_url: item.service_url,
                featured_image: item.featured_image,
                display_order: item.display_order,
                is_visible: item.is_visible,
                status: item.status,
              })),
              created_at: bizcard.created_at,
              updated_at: bizcard.updated_at,
              preview_url: bizcard.url_alias ? `/preview/${bizcard.url_alias}` : null,
              portfolio_url: portfolioUrl,
              edit_url: `/dashboard/bizcard/${bizcard.bizcard_id.toString()}/edit`,
              qr_code_url: qrCodeUrl,
            },
            permissions: {
              can_edit: true,
              can_delete: true,
              can_share: true,
              can_duplicate: true,
              can_permanent_delete: canPermanentDelete,
            },
          },
        })
      );
    } catch (error) {
      console.error("[user/bizcards/[bizcardId] GET]", error);
      return NextResponse.json(
        { success: false, error: "An unexpected error occurred." },
        { status: 500 }
      );
    }
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ bizcardId: string }> }
) {
  return withPerformanceTracking(request, async () => {
    const ip = getClientIp(request);
    const ua = getUserAgent(request);
    const rateCheck = checkRateLimit("user-bizcards-update", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many requests. Please slow down." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
      );
    }

    const auth = await requireSession(request);
    if (!auth.ok) return auth.response;

    const rawParams = await params;
    const bizcardId = parseBizcardId(rawParams.bizcardId);
    if (!bizcardId) {
      return NextResponse.json(
        { success: false, error: { code: "BIZCARD_NOT_FOUND", message: "Bizcard not found." } },
        { status: 404 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
    }

    const validation = validateBizcardUpdateInput(body);
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: validation.errors[0] ?? "Validation failed." },
        { status: 422 }
      );
    }

  try {
    const existing = await prisma.bizcard.findFirst({
      where: { bizcard_id: bizcardId, user_id: auth.userId },
      select: {
        bizcard_id: true,
        first_name: true,
        last_name: true,
        url_alias: true,
        created_at: true,
        last_url_alias_changed_at: true,
      },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: { code: "BIZCARD_NOT_FOUND", message: "Bizcard not found." } },
        { status: 404 }
      );
    }

    const updateData = { ...validation.data } as Record<string, unknown>;
    const updatedFields: string[] = [];
    let urlAliasChanged = false;

    if (validation.data.url_alias !== undefined) {
      // Check if URL alias is being changed
      const isChanging = validation.data.url_alias !== existing.url_alias;
      if (isChanging) {
        // Check if user can change URL alias (90-day rule)
        const eligibility = canChangeUrlAlias(existing);
        if (!eligibility.allowed) {
          return NextResponse.json(
            {
              success: false,
              error: {
                code: "URL_ALIAS_LOCKED",
                message: `URL alias can be changed again in ${eligibility.daysRemaining} days (available ${eligibility.changeAvailableAt.toISOString()})`,
                daysRemaining: eligibility.daysRemaining,
                changeAvailableAt: eligibility.changeAvailableAt.toISOString(),
              },
            },
            { status: 403 }
          );
        }
        urlAliasChanged = true;
      }

      updateData.url_alias = await generateUniqueUrlAlias({
        requestedAlias: validation.data.url_alias ?? null,
        firstName: String(validation.data.first_name ?? existing.first_name),
        lastName: String(validation.data.last_name ?? existing.last_name),
        userId: auth.userId,
        excludeBizcardId: existing.bizcard_id,
      });
    }

    for (const [key, value] of Object.entries(updateData)) {
      if (value !== undefined) updatedFields.push(key);
    }

    if (updatedFields.length === 0) {
      return NextResponse.json(
        { success: false, error: "No valid fields to update." },
        { status: 400 }
      );
    }

    const updated = await prisma.bizcard.update({
      where: { bizcard_id: existing.bizcard_id },
      data: {
        ...updateData,
        ...(updateData.zip_code !== undefined
          ? { zip_code: updateData.zip_code === null ? null : BigInt(Number(updateData.zip_code)) }
          : {}),
        updated_at: new Date(),
        ...(urlAliasChanged ? { last_url_alias_changed_at: new Date() } : {}),
      },
      select: {
        bizcard_id: true,
        updated_at: true,
        last_url_alias_changed_at: true,
      },
    });

    await logAuditEvent("bizcard_update", Number(auth.userId), ip, ua, {
      bizcardId: existing.bizcard_id.toString(),
      updatedFields,
      urlAliasChanged,
    });

    return NextResponse.json(
      serialize({
        success: true,
        message: "Bizcard updated successfully",
        data: {
          bizcard_id: updated.bizcard_id,
          updated_fields: updatedFields,
          updated_at: updated.updated_at,
        },
      })
    );
    } catch (error) {
      console.error("[user/bizcards/[bizcardId] PUT]", error);
      return NextResponse.json(
        { success: false, error: "An unexpected error occurred." },
        { status: 500 }
      );
    }
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ bizcardId: string }> }
) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);
  const rateCheck = checkRateLimit("user-bizcards-delete", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const rawParams = await params;
  const bizcardId = parseBizcardId(rawParams.bizcardId);
  if (!bizcardId) {
    return NextResponse.json(
      { success: false, error: { code: "BIZCARD_NOT_FOUND", message: "Bizcard not found." } },
      { status: 404 }
    );
  }

  const permanent = request.nextUrl.searchParams.get("permanent") === "true";

  try {
    const [limits, bizcard] = await Promise.all([
      getUserBizcardLimits(auth.userId),
      prisma.bizcard.findFirst({
        where: { bizcard_id: bizcardId, user_id: auth.userId },
        select: {
          bizcard_id: true,
          bizcard_name: true,
        },
      }),
    ]);

    if (!bizcard) {
      return NextResponse.json(
        { success: false, error: { code: "BIZCARD_NOT_FOUND", message: "Bizcard not found." } },
        { status: 404 }
      );
    }

    const isPremium = limits.tier === "premium" || limits.tier === "enterprise";
    if (permanent && !isPremium) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "BIZCARD_ACCESS_DENIED",
            message: "Permanent deletion is available on premium plans only.",
            upgrade_required: true,
            upgrade_url: "/settings/subscription/upgrade",
          },
        },
        { status: 403 }
      );
    }

    if (permanent) {
      await prisma.$transaction(async (tx) => {
        await tx.social.updateMany({
          where: { user_id: auth.userId, bizcard_id: bizcard.bizcard_id, deleted_at: null },
          data: { deleted_at: new Date(), updated_at: new Date() },
        });
        await tx.service.deleteMany({ where: { user_id: auth.userId, bizcard_id: bizcard.bizcard_id } });
        await tx.address.updateMany({
          where: { user_id: auth.userId, bizcard_id: bizcard.bizcard_id },
          data: { bizcard_id: null },
        });
        await tx.bizcard.delete({ where: { bizcard_id: bizcard.bizcard_id } });
      });

      await logAuditEvent("bizcard_delete_permanent", Number(auth.userId), ip, ua, {
        bizcardId: bizcard.bizcard_id.toString(),
      });

      return NextResponse.json({
        success: true,
        message: "Bizcard permanently deleted",
        data: {
          bizcard_id: bizcard.bizcard_id.toString(),
          deleted_at: new Date().toISOString(),
        },
      });
    }

    await prisma.bizcard.update({
      where: { bizcard_id: bizcard.bizcard_id },
      data: { deactivated_flag: true, updated_at: new Date() },
    });

    await logAuditEvent("bizcard_deactivate", Number(auth.userId), ip, ua, {
      bizcardId: bizcard.bizcard_id.toString(),
    });

    return NextResponse.json({
      success: true,
      message: "Bizcard deactivated successfully",
      data: {
        bizcard_id: bizcard.bizcard_id.toString(),
        bizcard_name: bizcard.bizcard_name,
        status: "deactivated",
        reactivate_available: true,
        reactivate_url: `/api/user/bizcards/${bizcard.bizcard_id.toString()}/reactivate`,
      },
    });
  } catch (error) {
    console.error("[user/bizcards/[bizcardId] DELETE]", error);
    return NextResponse.json(
      { success: false, error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
