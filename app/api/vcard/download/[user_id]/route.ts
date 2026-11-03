import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { prismaAnalytics } from "@/server/lib/prisma-analytics";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, validateToken } from "@/server/lib/auth";
import { buildVCardPublicUrl } from "@/server/lib/qr";
import { buildBizcardVcfFileContent, type BizcardQrVcfRecord } from "@/lib/bizcard/qr-vcf-assets";
import { resolveThemeSlug } from "@/server/lib/themes";
import { createNotificationFromEvent } from "@/server/lib/notifications";
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;
const SESSION_ID_REGEX = /^[a-zA-Z0-9-]{8,128}$/;
function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/(^-|-$)/g, "") || "contact";
}


export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ user_id: string }> }
) {
  const ip = getClientIp(request);
  try {
    const rateCheck = checkRateLimit("vcard-download-user", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    const { user_id } = await params;
    if (!/^\d{1,20}$/.test(user_id)) {
      return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    }

    
    const ownerId = BigInt(user_id);
    const bizcard = await prisma.bizcard.findFirst({
      where: {
        user_id: ownerId,
        deactivated_flag: false,
        user: {
          is: {
            is_active: true,
          },
        },
      },
      
      orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
      select: {
        bizcard_id: true,
        bizcard_name: true,
        first_name: true,
        last_name: true,
        middle_name: true,
        url_alias: true,
        occupation: true,
        professional_title: true,
        contact_number: true,
        alt_contact_number: true,
        email: true,
        alt_email: true,
        profile_img: true,
        bizcard_theme: true,
        company: { select: { name: true } },
        user: { select: { profile_url: true } },
        socials: {
          where: { is_visible: true },
          select: { platform: true, url: true },
          orderBy: { display_order: "asc" },
        },
        addresses: {
          select: {
            area: true,
            brgy: true,
            city: true,
            region: true,
            zipcode: true,
          },
          take: 1,
        },
      },
    });
    if (!bizcard) {
      return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    }
    // Resolve theme slug for consistency with profile payload conventions.
    await resolveThemeSlug(bizcard.bizcard_theme);

    const rawSessionId = request.nextUrl.searchParams.get("sessionId")?.trim() || null;
    const visitorSessionId =
      rawSessionId && SESSION_ID_REGEX.test(rawSessionId) ? rawSessionId : null;
    let visitorUserId: bigint | null = null;
    try {
      const rawToken = request.cookies.get("session_token")?.value;
      if (rawToken) {
        const session = await validateToken(rawToken);
        if (session) visitorUserId = BigInt(session.userId);
      }
    } catch {
      // Optional auth only.
    }


    const dedupWindow = new Date(Date.now() - DEDUP_WINDOW_MS);
    const existing = visitorUserId
      ? await prismaAnalytics.contactSave.findFirst({
          where: {
            portfolio_owner_id: ownerId,
            visitor_user_id: visitorUserId,
            created_at: { gte: dedupWindow },
          },
          select: { id: true },
        })

      : visitorSessionId
      ? await prismaAnalytics.contactSave.findFirst({
          where: {
            portfolio_owner_id: ownerId,
            anonymous_session_id: visitorSessionId,
            created_at: { gte: dedupWindow },
          },
          select: { id: true },
        })
      : null;

    if (!existing) {
      try {
        await prismaAnalytics.contactSave.create({
          data: {
            portfolio_owner_id: ownerId,
            bizcard_id: bizcard.bizcard_id,
            visitor_user_id: visitorUserId,
            anonymous_session_id: visitorSessionId,
            save_type: "vcf",
          },
        });
      } catch {
        await prismaAnalytics.contactSave.create({
          data: {
            portfolio_owner_id: ownerId,
            visitor_user_id: visitorUserId,
            anonymous_session_id: visitorSessionId,
            save_type: "vcf",
          },
        });
      }

      if (visitorUserId && visitorUserId !== ownerId) {
        void createNotificationFromEvent({
          targetUserId: ownerId,
          triggerUserId: visitorUserId,
          eventType: "contact_download",
          priority: "high",
          metadata: {
            save_type: "vcf",
            bizcard_id: bizcard.bizcard_id.toString(),
          },
          needsEmail: true,
          emailPriority: "batch",
        }).catch((error) => {
          console.error("[vcard/download] notification dispatch failed:", error);
        });
      }
    }

    const fullName =
      bizcard.bizcard_name ||
      `${[bizcard.first_name, bizcard.middle_name, bizcard.last_name].filter(Boolean).join(" ")}`.trim();
    const portfolioUrl = bizcard.url_alias ? buildVCardPublicUrl(bizcard.url_alias) : null;
    const vcfRecord: BizcardQrVcfRecord = {
      bizcard_id: BigInt(0),
      url_alias: bizcard.url_alias ?? `user-${user_id}`,
      bizcard_name: bizcard.bizcard_name,
      first_name: bizcard.first_name,
      last_name: bizcard.last_name,
      middle_name: bizcard.middle_name,
      email: bizcard.email,
      alt_email: bizcard.alt_email,
      contact_number: bizcard.contact_number,
      alt_contact_number: bizcard.alt_contact_number,
      occupation: bizcard.occupation,
      professional_title: bizcard.professional_title,
      profile_img: bizcard.profile_img,
      user_profile_img: bizcard.user?.profile_url ?? null,
      company: bizcard.company,
      addresses: bizcard.addresses,
      socials: bizcard.socials,
    };
    const vcf = await buildBizcardVcfFileContent(vcfRecord, portfolioUrl ?? "");

    const baseName = sanitizeFileName(bizcard.url_alias ?? fullName ?? `user-${user_id}`);

    return new NextResponse(vcf, {
      status: 200,
      headers: {
        "Content-Type": "text/vcard; charset=utf-8",
        "Content-Disposition": `attachment; filename="${baseName}.vcf"`,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch (err) {
    console.error("[vcard/download/[user_id]] Unhandled error:", err);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
