// app/api/public/[alias]/route.ts
 
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";
import { getCached, CACHE_TTL, generateCacheKey } from "@/lib/cache";
import { getPublicProfileOptimized } from "@/lib/db/queries";
import { optimizeResponse } from "@/lib/serializer";
import { withPerformanceTracking } from "@/middleware/performance";
import { GalleryMediaService } from "@/lib/services/gallery-media.service";
import { QRCodeService } from "@/lib/services/qr-code.service";
import { buildVCardPublicUrl, generateQRCodeDataUrl } from "@/server/lib/qr";
import { SubscriptionAccessService } from "@/lib/services/subscription-access.service";
import {
  buildBizcardVcfFileContent,
  type BizcardQrVcfRecord,
} from "@/lib/bizcard/qr-vcf-assets";
import { decimalToCoordinate, geocodeAddressParts, geocodeAddressQuery } from "@/server/lib/geocoding";
import { isValidSerialId } from "@/lib/bizcard/serial-id-format";
import { toContactLinkLabelMode } from "@/app/types";
import { getSchemaCompat } from "@/lib/db/schemaCompat";

function normalizePortfolioSlug(raw: string): string {
  return raw.trim().replace(/^\/+/, "").toLowerCase();
}

async function resolvePublicBizcardForDownload(alias: string) {
  const normalizedAlias = normalizePortfolioSlug(alias);
  const userAliasMatch = await prisma.user.findFirst({
    where: { custom_uri: normalizedAlias, is_active: true },
    select: { user_id: true },
  });

  const candidate = userAliasMatch
    ? await prisma.bizcard.findFirst({
        where: {
          user_id: userAliasMatch.user_id,
          is_blank: false,
          deactivated_flag: false,
        },
        orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
        select: {
          bizcard_id: true,
          bizcard_name: true,
          first_name: true,
          last_name: true,
          middle_name: true,
          email: true,
          contact_number: true,
          url_alias: true,
          alt_email: true,
          alt_contact_number: true,
          telephone_number: true,
          alt_telephone_number: true,
          occupation: true,
          professional_title: true,
          profile_img: true,
          show_email: true,
          user: { select: { profile_url: true, custom_uri: true, is_active: true } },
          company: { select: { name: true } },
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
          socials: {
            where: { is_visible: true },
            select: { platform: true, url: true },
            orderBy: { display_order: "asc" },
          },
        },
      })
    : null;

  if (candidate) return candidate;

  return prisma.bizcard.findFirst({
    where: {
      OR: [
        { url_alias: normalizedAlias, is_blank: false, deactivated_flag: false },
        {
          is_blank: false,
          deactivated_flag: false,
          user: { custom_uri: normalizedAlias, is_active: true },
        },
      ],
    },
    orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
    select: {
      bizcard_id: true,
      bizcard_name: true,
      first_name: true,
      last_name: true,
      middle_name: true,
      email: true,
      contact_number: true,
      url_alias: true,
      alt_email: true,
      alt_contact_number: true,
      telephone_number: true,
      alt_telephone_number: true,
      occupation: true,
      professional_title: true,
      profile_img: true,
      show_email: true,
      user: { select: { profile_url: true, custom_uri: true, is_active: true } },
      company: { select: { name: true } },
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
      socials: {
        where: { is_visible: true },
        select: { platform: true, url: true },
        orderBy: { display_order: "asc" },
      },
    },
  });
}

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

type BizcardQrAssets = {
  qr_code_url: string | null;
  portfolio_qr_code_url: string | null;
};

async function fetchBizcardQrAssets(bizcardId: bigint): Promise<BizcardQrAssets | null> {
  try {
    return await prisma.bizcard.findUnique({
      where: { bizcard_id: bizcardId },
      select: {
        qr_code_url: true,
        portfolio_qr_code_url: true,
      },
    });
  } catch (error) {
    console.error("[public/[alias]] QR asset lookup failed:", error);
    return null;
  }
}

/**
 * Get or generate QR code for a bizcard using existing QRCodeService
 */
async function getOrGenerateQRCodeForBizcard(
  bizcardId: bigint,
  urlAlias: string
): Promise<string | null> {
  try {
    // First check if bizcard already has QR code
    const existingBizcard = await prisma.bizcard.findUnique({
      where: { bizcard_id: bizcardId },
      select: { qr_code_url: true, url_alias: true },
    });
    
    if (existingBizcard?.qr_code_url && existingBizcard.qr_code_url.trim() !== "") {
      return existingBizcard.qr_code_url;
    }
    
    // Use QRCodeService to generate offline vCard QR code
    const requestId = `public_${bizcardId}_${Date.now()}`;
    const qrService = new QRCodeService(requestId);
    const qrData = await qrService.generateOfflineVCardQRCode(bizcardId);

    return qrData.qr_code_url;
  } catch (error) {
    console.error(`[QR] Failed to generate QR code for bizcard ${bizcardId}:`, error);
    return null;
  }
}

/**
 * Generate full vCard download content on demand (never from Cloudinary).
 */
async function generateVCardDownload(
  bizcard: BizcardQrVcfRecord,
  portfolioUrl: string,
): Promise<string> {
  return buildBizcardVcfFileContent(bizcard, portfolioUrl);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ alias: string }> }
) {
  return withPerformanceTracking(request, async () => {
    const ip = getClientIp(request);

    try {
      const rl = checkRateLimit("public-profile", ip);
      if (!rl.allowed) {
        return NextResponse.json(
          { success: false, error: "Too many requests. Please try again later." },
          {
            status: 429,
            headers: {
              "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)),
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }

      const { alias: rawAlias } = await params;
      const alias = normalizePortfolioSlug(rawAlias);
      const serialCandidate = rawAlias.trim().toUpperCase();

      // On-demand VCF download — never serve a stored Cloudinary .vcf file.
      if (request.nextUrl.searchParams.get("download") === "vcard") {
        const card = await resolvePublicBizcardForDownload(alias);

        if (!card) {
          return NextResponse.json({ error: "Profile not found." }, { status: 404 });
        }

        const resolvedAlias = card.url_alias || card.user?.custom_uri || alias;
        const portfolioUrl =
          buildVCardPublicUrl(resolvedAlias) ||
          `${process.env.NEXT_PUBLIC_APP_URL || "https://ontap.portal.ph"}/${resolvedAlias}`;
        const { show_email: cardShowEmail, ...cardFields } = card;
        const record: BizcardQrVcfRecord = {
          ...cardFields,
          ...(cardShowEmail === false ? { email: "", alt_email: null } : {}),
          url_alias: resolvedAlias,
          user_profile_img: card.user?.profile_url ?? null,
        };
        const vcardContent = await generateVCardDownload(record, portfolioUrl);
        const fileName = `${resolvedAlias.replace(/[^a-z0-9]/gi, "_")}.vcf`;

        return new NextResponse(vcardContent, {
          status: 200,
          headers: {
            "Content-Type": "text/vcard; charset=utf-8",
            "Content-Disposition": `attachment; filename="${fileName}"`,
            "Cache-Control": "private, no-store, max-age=0, must-revalidate",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // First, try to find bizcard by url_alias
      let accessProbe = await prisma.bizcard.findFirst({
        where: {
          url_alias: alias,
          is_blank: false,
          deactivated_flag: false,
        },
        select: {
          bizcard_id: true,
          url_alias: true,
          user: {
            select: {
              is_active: true,
              is_restricted: true,
              restricted_until: true,
              role: true,
            },
          },
        },
      });

      // If not found, try by user custom_uri
      if (!accessProbe) {
        accessProbe = await prisma.bizcard.findFirst({
          where: {
            is_blank: false,
            deactivated_flag: false,
            user: {
              custom_uri: alias,
            },
          },
          orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
          select: {
            bizcard_id: true,
            url_alias: true,
            user: {
              select: {
                is_active: true,
                is_restricted: true,
                restricted_until: true,
                role: true,
              },
            },
          },
        });
      }

      if (!accessProbe && isValidSerialId(serialCandidate)) {
        accessProbe = await prisma.bizcard.findFirst({
          where: {
            serial_id: serialCandidate,
            is_blank: false,
            deactivated_flag: false,
          },
          select: {
            bizcard_id: true,
            url_alias: true,
            user: {
              select: {
                is_active: true,
                is_restricted: true,
                restricted_until: true,
                role: true,
              },
            },
          },
        });
      }

      // Unlinked bizcard (user_id NULL) — resolve owner by email
      if (accessProbe && !accessProbe.user) {
        const card = await prisma.bizcard.findUnique({
          where: { bizcard_id: accessProbe.bizcard_id },
          select: { email: true },
        });
        if (card?.email) {
          const owner = await prisma.user.findFirst({
            where: { email: card.email.trim(), is_active: true },
            select: {
              is_active: true,
              is_restricted: true,
              restricted_until: true,
              role: true,
            },
          });
          if (owner) {
            accessProbe = { ...accessProbe, user: owner };
          }
        }
      }

      // Check if profile exists and is accessible
      if (!accessProbe || !accessProbe.user || !accessProbe.user.is_active) {
        return NextResponse.json(
          { success: false, error: "Profile not found." },
          {
            status: 404,
            headers: { "Access-Control-Allow-Origin": "*" },
          }
        );
      }

      // Check if account is restricted
      if (accessProbe.user.is_restricted) {
        const restrictedUntil = accessProbe.user.restricted_until;
        const stillRestricted = restrictedUntil ? restrictedUntil.getTime() > Date.now() : true;

        if (stillRestricted) {
          return NextResponse.json(
            {
              success: false,
              error: {
                code: "ACCOUNT_RESTRICTED",
                message: "This profile is temporarily unavailable due to account restrictions.",
                restricted_until: restrictedUntil,
              },
            },
            {
              status: 403,
              headers: { "Access-Control-Allow-Origin": "*" },
            }
          );
        }
      }

      const visibility = await new SubscriptionAccessService(`public:${accessProbe.bizcard_id.toString()}`).isPortfolioVisible(accessProbe.bizcard_id);
      if (!visibility.visible) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code:
                visibility.accessStatus.reason === "trial_expired"
                  ? "TRIAL_EXPIRED"
                  : visibility.accessStatus.reason === "subscription_expired"
                    ? "SUBSCRIPTION_EXPIRED"
                    : "PORTFOLIO_UNAVAILABLE",
              message: visibility.message ?? "This profile is currently unavailable.",
              redirect_url: "/products",
            },
          },
          {
            status: 403,
            headers: { "Access-Control-Allow-Origin": "*" },
          }
        );
      }

      const resolvedAlias = (accessProbe.url_alias ?? alias).toLowerCase();
      const cacheKey = generateCacheKey("public", "profile", resolvedAlias);
      const ownerRole = String(
        (accessProbe.user as { role?: string | null }).role ?? "",
      )
        .trim()
        .toLowerCase();
      const ownerHasPermanentPremium =
        ownerRole === "super_admin" || ownerRole === "dev";

      const { data, cached } = await getCached(
        cacheKey,
        async () => {
          const galleryService = new GalleryMediaService();
          const resolved = await getPublicProfileOptimized(resolvedAlias);

          if (!resolved) return null;

          const { bizcard, services, socialLinks, products, blogs, addresses, media } = resolved;
          const primaryAddress = addresses[0] ?? null;

          let addressLatitude = decimalToCoordinate(primaryAddress?.latitude);
          let addressLongitude = decimalToCoordinate(primaryAddress?.longitude);
          const mapLink =
            (typeof primaryAddress?.map_link === "string" && primaryAddress.map_link.trim()) ||
            (typeof primaryAddress?.plus_code === "string" && primaryAddress.plus_code.trim()) ||
            "";

          if ((addressLatitude === null || addressLongitude === null) && mapLink) {
            const fromMapLink = await geocodeAddressQuery(mapLink);
            if (fromMapLink) {
              addressLatitude = fromMapLink.latitude;
              addressLongitude = fromMapLink.longitude;
            }
          }

          if ((addressLatitude === null || addressLongitude === null) && primaryAddress) {
            const geocoded = await geocodeAddressParts({
              area: primaryAddress.area ?? null,
              brgy: primaryAddress.brgy ?? null,
              city: primaryAddress.city ?? null,
              region: primaryAddress.region ?? null,
              zipcode: primaryAddress.zipcode ?? null,
            });
            if (geocoded) {
              addressLatitude = geocoded.latitude;
              addressLongitude = geocoded.longitude;
            }
          }
          
          const effectiveTier = ownerHasPermanentPremium
            ? "premium"
            : bizcard.subscription_tier;
          const isBasicTier = effectiveTier !== "standard" && effectiveTier !== "premium";
          const isPremiumTier = effectiveTier === "premium";
          const publicGallery = !isBasicTier ? await galleryService.getPublicGallery(resolvedAlias) : null;

          // Build portfolio URL - use url_alias only (serial_id not available in this object)
          const portfolioIdentifier = bizcard.url_alias || `user/${bizcard.user_id}`;
          const portfolioUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://ontap.portal.ph"}/${portfolioIdentifier}`;
          
          // Get or generate QR code using existing service
          let qrCode: string | null = null;
          let portfolioQrCode: string | null = null;
          // On-demand VCF download endpoint (not a stored Cloudinary file).
          const vcfFileUrl = `/api/public/${encodeURIComponent(resolvedAlias)}?download=vcard`;
          
          const fullBizcard = await fetchBizcardQrAssets(bizcard.bizcard_id);
          
          if (fullBizcard?.qr_code_url && fullBizcard.qr_code_url.trim() !== "") {
            qrCode = fullBizcard.qr_code_url;
          }
          if (fullBizcard?.portfolio_qr_code_url && fullBizcard.portfolio_qr_code_url.trim() !== "") {
            portfolioQrCode = fullBizcard.portfolio_qr_code_url;
          }

                  const tempPortfolioUrl = buildVCardPublicUrl(resolvedAlias);
          if (tempPortfolioUrl) {
            qrCode = generateQRCodeDataUrl(tempPortfolioUrl);
          }

          if (!qrCode && fullBizcard?.qr_code_url && fullBizcard.qr_code_url.trim() !== "") {
            qrCode = fullBizcard.qr_code_url;
          }

          if (!qrCode) {
            // Generate QR code asynchronously (non-blocking for response)
            // Fire and forget - don't await
            getOrGenerateQRCodeForBizcard(bizcard.bizcard_id, resolvedAlias).then(generatedQr => {
              if (generatedQr) {
                console.debug(`[QR] Generated QR code for bizcard ${bizcard.bizcard_id}`);
              }
            }).catch(err => {
              console.error(`[QR] Background QR generation failed for bizcard ${bizcard.bizcard_id}:`, err);
            });
          }

          const mediaItems = media.map((item: any) => ({
            id: item.media_id,
            url: item.secure_url,
            alt_text: item.alt_text,
            caption: item.caption,
            tags: item.tags,
            width: item.width,
            height: item.height,
            duration_sec: item.duration_sec,
            sort_order: item.sort_order,
            featured: item.is_featured,
            media_type: item.media_type,
          }));

          const galleryItems = !isBasicTier
            ? publicGallery
              ? publicGallery.gallery.map((item: any) => ({
                  id: item.id,
                  url: item.url,
                  title: item.title ?? null,
                  alt_text: item.alt_text,
                  caption: item.description,
                  tags: null,
                  width: item.width,
                  height: item.height,
                  duration_sec: null,
                  sort_order: item.sort_order,
                  featured: item.featured,
                  media_type: "image",
                  mime_type: item.mime_type ?? "image/jpeg",
                }))
              : mediaItems.filter((item: any) => item.media_type !== "video")
            : [];

          const videoItems = !isBasicTier
            ? publicGallery
              ? publicGallery.videos.map((item: any) => ({
                  id: item.id,
                  url: item.url,
                  title: item.title ?? null,
                  alt_text: item.alt_text,
                  caption: item.description,
                  tags: null,
                  width: item.width,
                  height: item.height,
                  duration_sec: item.duration_sec ?? null,
                  sort_order: item.sort_order,
                  featured: item.featured,
                  media_type: "video",
                  mime_type: item.mime_type ?? "video/mp4",
                }))
              : mediaItems.filter((item: any) => item.media_type === "video")
            : [];

          const payload = {
            success: true,
            data: {
              bizcard_id: bizcard.bizcard_id,
              name: `${bizcard.first_name} ${bizcard.last_name}`.trim(),
              first_name: bizcard.first_name,
              last_name: bizcard.last_name,
              middle_name: bizcard.middle_name ?? null,
              bizcard_name: bizcard.bizcard_name ?? null,
              professional_title: bizcard.professional_title,
              occupation: bizcard.occupation,
              company: bizcard.company?.name ?? null,
              email: bizcard.show_email === false ? null : bizcard.email,
              phone: bizcard.contact_number,
              alt_email: bizcard.show_email === false ? null : bizcard.alt_email,
              alt_phone: bizcard.alt_contact_number,
              telephone: (bizcard as { telephone_number?: string | null }).telephone_number,
              alt_telephone: (bizcard as { alt_telephone_number?: string | null }).alt_telephone_number,
              address: {
                area: primaryAddress?.area ?? null,
                baranggay: primaryAddress?.brgy ?? null,
                city: primaryAddress?.city ?? null,
                region: primaryAddress?.region ?? null,
                zip: primaryAddress?.zipcode ?? null,
                map_link: primaryAddress?.map_link ?? primaryAddress?.plus_code ?? null,
                plus_code: primaryAddress?.plus_code ?? null,
                landmark: (primaryAddress as { landmark?: string | null } | null | undefined)?.landmark ?? null,
                latitude: addressLatitude,
                longitude: addressLongitude,
              },
              // User is authoritative for images. Prefer User; no stale Bizcard cover fallback.
              profile_image: bizcard.user?.profile_url ?? bizcard.profile_img ?? null,
              cover_image: bizcard.user?.cover_url ?? null,
              cover_img_position: bizcard.cover_img_position,
              show_cover_photo: bizcard.show_cover_photo !== false,
              show_inquiry_card: bizcard.show_inquiry_card !== false,
              show_associate_count: bizcard.show_associate_count === true,
              show_mutual_associates: bizcard.show_mutual_associates === true,
              show_email: bizcard.show_email !== false,
              contact_link_label: toContactLinkLabelMode(bizcard.contact_link_label),
              bio: bizcard.bio,
              description: bizcard.description,
              languages: bizcard.languages ? bizcard.languages.split(",").map((v: string) => v.trim()).filter(Boolean) : [],
              theme: bizcard.bizcard_theme,
              style: bizcard.bizcard_style,
              subscription_tier: effectiveTier,
              portfolio_url: portfolioUrl,
              qr_code: qrCode,
              portfolio_qr_code: portfolioQrCode,
              vcf_file_url: vcfFileUrl,
              gallery_available: !isBasicTier,
              inquiry_enabled: isPremiumTier,
              services: services.map((s: any) => ({
                id: s.service_id,
                name: s.name,
                description: s.description,
                tagline: s.tagline ?? null,
                price: s.price,
                featured_image: s.featured_image,
                media: (s.serviceMedia ?? []).map((m: any) => ({
                  id: String(m.id),
                  url: m.file_url,
                  mimeType: m.mime_type,
                  fileName: m.file_name,
                })),
              })),
              social_links: socialLinks,
              gallery: galleryItems,
              videos: videoItems,
              products: products.map((p: any) => ({
                id: p.product_id,
                name: p.name,
                price: p.price,
                image: p.image ?? null,
              })),
              blogs: blogs.map((b: any) => ({
                id: b.blog_id,
                title: b.title,
                excerpt: b.content.length > 140 ? `${b.content.slice(0, 140)}...` : b.content,
                published_at: b.created_at,
              })),
            },
          };

          return optimizeResponse(payload);
        },
        CACHE_TTL.PUBLIC_PROFILE
      );

      if (!data) {
        return NextResponse.json(
          { success: false, error: "Profile not found." },
          {
            status: 404,
            headers: { "Access-Control-Allow-Origin": "*" },
          }
        );
      }

      const response = NextResponse.json(serialize(data), {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "private, no-store, no-cache, must-revalidate",
        },
      });

      response.headers.set("X-Cache", cached ? "HIT" : "MISS");
      return response;
    } catch (error) {
      console.error("[public/[alias] GET] Unexpected error:", error);
      return NextResponse.json(
        { success: false, error: "An unexpected error occurred." },
        {
          status: 500,
          headers: { "Access-Control-Allow-Origin": "*" },
        }
      );
    }
  });
}

/**
 * POST endpoint for QR code operations
 * - regenerate: Force regenerate QR code
 * - download_vcard: Download vCard file
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ alias: string }> }
) {
  const ip = getClientIp(request);
  
  try {
    const rl = checkRateLimit("public-profile", ip);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }
    
    const { alias } = await params;
    const body = await request.json();
    const action = body.action;
    
    // Find the bizcard using the same resolver as the public profile page so
    // valid custom_uri-based profiles do not 404 on contact download.
    const bizcard = await resolvePublicBizcardForDownload(alias);
    
    if (!bizcard) {
      return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    }
    
    // Use url_alias for portfolio identifier (serial_id not needed)
    const portfolioIdentifier = bizcard.url_alias || `user/${bizcard.bizcard_id}`;
    const portfolioUrl =
      buildVCardPublicUrl(bizcard.url_alias || portfolioIdentifier) ||
      `${process.env.NEXT_PUBLIC_APP_URL || "https://ontap.portal.ph"}/${portfolioIdentifier}`;
    
    // Handle regenerate QR action
    if (action === "regenerate_qr") {
      const requestId = `regenerate_${bizcard.bizcard_id}_${Date.now()}`;
      const qrService = new QRCodeService(requestId);
      
      try {
        const qrData = await qrService.regenerateQRCode(bizcard.bizcard_id, bizcard.url_alias || portfolioIdentifier);
        
        return NextResponse.json({
          success: true,
          data: {
            qr_code: qrData.qr_code_url,
            generated_at: qrData.generated_at,
          },
        });
      } catch (error) {
        console.error("[QR] Regeneration failed:", error);
        return NextResponse.json(
          { error: "Failed to regenerate QR code." },
          { status: 500 }
        );
      }
    }
    
    // Handle download vCard action — generate fresh VCF on demand
    if (action === "download_vcard") {
      const { show_email: bizcardShowEmail, ...bizcardFields } = bizcard;
      const record: BizcardQrVcfRecord = {
        ...bizcardFields,
        ...(bizcardShowEmail === false ? { email: "", alt_email: null } : {}),
        url_alias: bizcard.url_alias || portfolioIdentifier,
        user_profile_img: bizcard.user?.profile_url ?? null,
      };
      const vcardContent = await generateVCardDownload(record, portfolioUrl);
      const fileName = `${portfolioIdentifier.replace(/[^a-z0-9]/gi, "_")}.vcf`;
      
      return new NextResponse(vcardContent, {
        status: 200,
        headers: {
          "Content-Type": "text/vcard; charset=utf-8",
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Cache-Control": "private, max-age=0, must-revalidate",
        },
      });
    }
    
    return NextResponse.json({ error: "Invalid action. Use 'regenerate_qr' or 'download_vcard'." }, { status: 400 });
  } catch (error) {
    console.error("[public/[alias] POST] Unexpected error:", error);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}