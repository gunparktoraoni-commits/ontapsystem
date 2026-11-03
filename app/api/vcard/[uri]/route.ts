import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { prismaAnalytics } from "@/server/lib/prisma-analytics";
import { getClientIp, getUserAgent, logAuditEvent } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { buildVCardPublicUrl, generateQRCodeDataUrl } from "@/server/lib/qr";
import { DEFAULT_THEME_PATH } from "@/server/lib/themes";
import { toContactLinkLabelMode } from "@/app/types";

const CUSTOM_URI_REGEX = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const SERIAL_ID_REGEX = /^[A-Za-z0-9_-]{4,64}$/;

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

async function findPublicBizcardByAlias(alias: string) {
  return prisma.bizcard.findFirst({
    where: {
      url_alias: alias,
      deactivated_flag: false,
      user: {
        is: {
          is_active: true,
        },
      },
    },
    select: {
      bizcard_id: true,
      first_name: true,
      last_name: true,
      middle_name: true,
      url_alias: true,
      bizcard_name: true,
      description: true,
      professional_title: true,
      post_nominal: true,
      suffix: true,
      occupation: true,
      bio: true,
      contact_number: true,
      alt_contact_number: true,
      alt_email: true,
      email: true,
      profile_img: true,
      cover_img: true,
      bizcard_theme: true,
      show_cover_photo: true,
      show_inquiry_card: true,
      show_associate_count: true,
      show_mutual_associates: true,
      show_email: true,
      contact_link_label: true,
      area: true,
      baranggay: true,
      city: true,
      region: true,
      zip_code: true,
      portfolio_url: true,
      qr_code_url: true,
      user: {
        select: {
          user_id: true,
          registration_type: true,
        },
      },



      
      socials: {
        where: { is_visible: true },
        orderBy: { display_order: "asc" },
        select: {
          socials_id: true,
          platform: true,
          url: true,
          display_order: true,
        },
      },
      services: {
        where: { is_visible: true, status: "active" },
        orderBy: { display_order: "asc" },
        select: {
          service_id: true,
          name: true,
          description: true,
          service_url: true,
          featured_image: true,
          display_order: true,
          serviceMedia: {
            orderBy: { display_order: "asc" },
            select: {
              id: true,
              file_url: true,
              mime_type: true,
              display_order: true,
            },
          },
        },
      },
    },
  });
}

type VcardProfileRecord = NonNullable<Awaited<ReturnType<typeof findPublicBizcardByAlias>>>;
type VcardProfileWithUser = Omit<VcardProfileRecord, "user"> & {
  user: NonNullable<VcardProfileRecord["user"]>;
};

function mapBizcardProfile(bizcard: VcardProfileWithUser) {
  return {
    user_id: bizcard.user.user_id,
    bizcard_id: bizcard.bizcard_id,
    first_name: bizcard.first_name,
    last_name: bizcard.last_name,
    middle_name: bizcard.middle_name,
    custom_uri: bizcard.url_alias,
    vcard_name: bizcard.bizcard_name,
    vcard_description: bizcard.description,
    prof_title: bizcard.professional_title,
    post_nominal: bizcard.post_nominal,
    suffix: bizcard.suffix,
    job_position: bizcard.occupation,
    about: bizcard.bio,
    contact: bizcard.contact_number,
    alt_contact: bizcard.alt_contact_number,
    alt_email: bizcard.show_email === false ? null : bizcard.alt_email,
    email: bizcard.show_email === false ? null : bizcard.email,
    profile_url: bizcard.profile_img,
    cover_url: bizcard.cover_img,
    show_cover_photo: bizcard.show_cover_photo !== false,
    show_inquiry_card: bizcard.show_inquiry_card !== false,
    show_associate_count: bizcard.show_associate_count === true,
    show_mutual_associates: bizcard.show_mutual_associates === true,
    show_email: bizcard.show_email !== false,
    contact_link_label: toContactLinkLabelMode(bizcard.contact_link_label),
    registration_type: bizcard.user.registration_type,
    theme_path: bizcard.bizcard_theme ?? DEFAULT_THEME_PATH,
    socials: bizcard.socials,
    services: bizcard.services.map((svc) => ({
      service_id: svc.service_id,
      name: svc.name,
      description: svc.description,
      service_url: svc.service_url,
      featured_image: svc.featured_image,
      display_order: svc.display_order,
      serviceMedia: svc.serviceMedia,
    })),
    addresses: [
      {
        area: bizcard.area,
        brgy: bizcard.baranggay,
        city: bizcard.city,
        region: bizcard.region,
        zipcode: bizcard.zip_code ? bizcard.zip_code.toString() : null,
        plus_code: null,
      },
    ],
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uri: string }> }
) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);

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

    const { uri } = await params;
    if (!uri || (!CUSTOM_URI_REGEX.test(uri) && !SERIAL_ID_REGEX.test(uri))) {
      return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    }

    let resolvedBy: "serial_id" | "url_alias" = "url_alias";
    let bizcard: VcardProfileRecord | null = null;

    if (SERIAL_ID_REGEX.test(uri)) {
      const card = await prisma.employeeCard.findUnique({
        where: { serial_id: uri },
        select: {
          assigned_user_id: true,
          activation_status: true,
        },
      });

      if (card?.assigned_user_id && card.activation_status !== "inactive" && card.activation_status !== "revoked") {
        bizcard = await prisma.bizcard.findFirst({
          where: {
            user_id: card.assigned_user_id,
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
            first_name: true,
            last_name: true,
            middle_name: true,
            url_alias: true,
            bizcard_name: true,
            description: true,
            professional_title: true,
            post_nominal: true,
            suffix: true,
            occupation: true,
            bio: true,
            contact_number: true,
            alt_contact_number: true,
            alt_email: true,
            email: true,
            profile_img: true,
            cover_img: true,
            bizcard_theme: true,
            show_cover_photo: true,
            show_inquiry_card: true,
            show_associate_count: true,
            show_mutual_associates: true,
            show_email: true,
            contact_link_label: true,
            area: true,
            baranggay: true,
            city: true,
            region: true,
            zip_code: true,
            portfolio_url: true,
            qr_code_url: true,
            user: {
              select: {
                user_id: true,
                registration_type: true,
              },
            },
            socials: {
              where: { is_visible: true },
              orderBy: { display_order: "asc" },
              select: {
                socials_id: true,
                platform: true,
                url: true,
                display_order: true,
              },
            },
            services: {
              where: { is_visible: true, status: "active" },
              orderBy: { display_order: "asc" },
              select: {
                service_id: true,
                name: true,
                description: true,
                service_url: true,
                featured_image: true,
                display_order: true,
                serviceMedia: {
                  orderBy: { display_order: "asc" },
                  select: {
                    id: true,
                    file_url: true,
                    mime_type: true,
                    display_order: true,
                  },
                },
              },
            },
          },
        });

        if (bizcard?.url_alias && bizcard.url_alias !== uri) {
          const canonical = buildVCardPublicUrl(bizcard.url_alias);
          if (canonical) return NextResponse.redirect(canonical, 308);
        }

        resolvedBy = "serial_id";
      }
    }

    if (!bizcard) {
      bizcard = await findPublicBizcardByAlias(uri);
      resolvedBy = "url_alias";
    }

    if (!bizcard?.user) {
      return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    }

    const profile = mapBizcardProfile(bizcard as VcardProfileWithUser);
    const portfolioUrl = bizcard.portfolio_url ?? (bizcard.url_alias ? buildVCardPublicUrl(bizcard.url_alias) : null);
    let qrCode: string | null = null;
    if (portfolioUrl) {
      qrCode = generateQRCodeDataUrl(portfolioUrl);
    }
    if (!qrCode && bizcard.qr_code_url) {
      qrCode = bizcard.qr_code_url;
    }

    prismaAnalytics.analytics
      .create({
        data: {
          user_id: bizcard.user.user_id,
          source: "vcard_view",
        },
      })
      .catch(() => {
        // Best-effort analytics.
      });

    await logAuditEvent("vcard_public_view", undefined, ip, ua, {
      uri,
      resolvedBy,
    });

    return NextResponse.json(
      {
        profile: serialize(profile),
        portfolioUrl,
        qrCode,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[vcard/[uri] GET] Unexpected error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred. Please try again." },
      { status: 500 }
    );
  }
}
