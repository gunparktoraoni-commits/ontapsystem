import { prisma } from "@/server/lib/prisma";
import { isValidSerialId } from "@/lib/bizcard/serial-id-format";
import { pickNonBlank, pickNonBlankOrNull } from "@/lib/vcard/queries";
import { getSchemaCompat } from "@/lib/db/schemaCompat";
import { dedupeSocialLinksByUrl } from "@/lib/social-links";

function normalizePortfolioSlug(raw: string): string {
  return raw.trim().replace(/^\/+/, "").toLowerCase();
}

export async function getUserBizcardsOptimized(
  userId: bigint,
  options: {
    page: number;
    limit: number;
    sortBy?: "created_at" | "updated_at" | "bizcard_name";
    sortDir?: "asc" | "desc";
    status?: "all" | "active" | "deactivated";
  }
) {
  const { page, limit, sortBy = "created_at", sortDir = "desc", status = "all" } = options;
  const skip = (page - 1) * limit;

  const where = {
    user_id: userId,
    // Filter out placeholder bizcards (system-generated but not claimed)
    AND: [
      {
        is_blank: false,
      },
      {
        OR: [
          { claimed_by_user_id: { not: null } },
          { generated_by_user_id: null },
        ],
      },
    ],
    ...(status === "active" ? { deactivated_flag: false } : {}),
    ...(status === "deactivated" ? { deactivated_flag: true } : {}),
  };

  const [bizcards, total] = await Promise.all([
    prisma.bizcard.findMany({
      where,
      select: {
        bizcard_id: true,
        user_id: true,
        bizcard_name: true,
        serial_id: true,
        url_alias: true,
        qr_code_url: true,
        first_name: true,
        last_name: true,
        professional_title: true,
        profile_img: true,
        cover_img: true,
        bizcard_type: true,
        bizcard_style: true,
        subscription_tier: true,
        deactivated_flag: true,
        created_at: true,
        updated_at: true,
        last_url_alias_changed_at: true,
        generated_by_user_id: true,
        claimed_by_user_id: true,
        is_blank: true,
      },
      orderBy: { [sortBy]: sortDir },
      skip,
      take: limit,
    }),
    prisma.bizcard.count({ where }),
  ]);

  return { bizcards, total };
}

export async function getPublicProfileOptimized(alias: string) {
  const normalizedAlias = normalizePortfolioSlug(alias);
  const serialCandidate = alias.trim().toUpperCase();
  const compat = await getSchemaCompat();
  const publicUserSelect = {
    user_id: true,
    first_name: true,
    last_name: true,
    middle_name: true,
    prof_title: true,
    job_position: true,
    about: true,
    profile_url: true,
    cover_url: true,
  } as const;
  const select = {
    bizcard_id: true,
    serial_id: true,
    subscription_tier: true,
    bizcard_style: true,
    url_alias: true,
    first_name: true,
    last_name: true,
    middle_name: true,
    professional_title: true,
    occupation: true,
    email: true,
    contact_number: true,
    alt_email: true,
    alt_contact_number: true,
    ...(compat.bizcardTelephone
      ? { telephone_number: true, alt_telephone_number: true }
      : {}),
    area: true,
    baranggay: true,
    city: true,
    region: true,
    zip_code: true,
    address_link: true,
    profile_img: true,
    cover_img: true,
    cover_img_position: true,
    bio: true,
    description: true,
    languages: true,
    bizcard_theme: true,
    bizcard_name: true,
    show_cover_photo: true,
    show_inquiry_card: true,
    show_associate_count: true,
    show_mutual_associates: true,
    show_email: true,
    contact_link_label: true,
    user_id: true,
    company: {
      select: {
        company_id: true,
        name: true,
      },
    },
    user: {
      select: publicUserSelect,
    },
  };

  // Dynamic select (optional columns) — keep type loose.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let bizcard: any = null;

  // Prefer the User who owns this custom_uri over a conflicting Bizcard.url_alias
  // held by a different account (migration / stolen-alias cases like bambam).
  const canonicalOwner = await prisma.user.findFirst({
    where: {
      custom_uri: normalizedAlias,
      is_active: true,
    },
    select: { user_id: true },
  });

  if (canonicalOwner) {
    bizcard = await prisma.bizcard.findFirst({
      where: {
        user_id: canonicalOwner.user_id,
        is_blank: false,
        deactivated_flag: false,
      },
      orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
      select,
    });

    if (!bizcard) {
      // Ensure the canonical owner has a card, reclaiming a stolen alias if needed.
      const { syncUserProfileToBizcard } = await import("@/lib/bizcard/sync");
      await syncUserProfileToBizcard(canonicalOwner.user_id);
      bizcard = await prisma.bizcard.findFirst({
        where: {
          user_id: canonicalOwner.user_id,
          is_blank: false,
          deactivated_flag: false,
        },
        orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
        select,
      });
    }
  }

  if (!bizcard) {
    bizcard = await prisma.bizcard.findFirst({
      where: {
        url_alias: normalizedAlias,
        is_blank: false,
        deactivated_flag: false,
        user: {
          is_active: true,
        },
      },
      select,
    });
  }

  if (!bizcard) {
    bizcard = await prisma.bizcard.findFirst({
      where: {
        is_blank: false,
        deactivated_flag: false,
        user: {
          custom_uri: normalizedAlias,
          is_active: true,
        },
      },
      orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
      select,
    });
  }

  if (!bizcard && isValidSerialId(serialCandidate)) {
    bizcard = await prisma.bizcard.findFirst({
      where: {
        serial_id: serialCandidate,
        is_blank: false,
        deactivated_flag: false,
        user: {
          is_active: true,
        },
      },
      orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
      select,
    });
  }

  // Unlinked virtual cards (user_id NULL in dump) — resolve owner by bizcard email
  if (!bizcard) {
    const unlinked = await prisma.bizcard.findFirst({
      where: {
        url_alias: normalizedAlias,
        is_blank: false,
        deactivated_flag: false,
        user_id: null,
      },
      select,
    });
    if (unlinked?.email) {
      const owner = await prisma.user.findFirst({
        where: { email: unlinked.email.trim(), is_active: true },
        select: publicUserSelect,
      });
      if (owner) {
        bizcard = {
          ...unlinked,
          user_id: owner.user_id,
          user: owner,
        };
      }
    }
  }

  if (!bizcard || !bizcard.user || !bizcard.user_id) return null;

  const owner = bizcard.user;

  // Migration-tolerant: empty Bizcard name/title fields fall back to User.
  const coalescedFirst = pickNonBlank(bizcard.first_name, owner.first_name);
  const coalescedLast = pickNonBlank(bizcard.last_name, owner.last_name);
  bizcard = {
    ...bizcard,
    first_name: coalescedFirst,
    last_name: coalescedLast,
    middle_name: pickNonBlankOrNull(bizcard.middle_name, owner.middle_name),
    professional_title: pickNonBlankOrNull(
      bizcard.professional_title,
      owner.prof_title,
    ),
    occupation: pickNonBlankOrNull(bizcard.occupation, owner.job_position),
    bio: pickNonBlankOrNull(bizcard.bio, owner.about),
    description: pickNonBlankOrNull(bizcard.description, owner.about),
    bizcard_name: pickNonBlank(
      bizcard.bizcard_name,
      `${coalescedFirst} ${coalescedLast}`.trim(),
    ),
    // User is authoritative for images. Never revive a stale Bizcard cover when
    // the owner has no cover_url (dashboard CSS gradient is the correct empty state).
    profile_img: pickNonBlankOrNull(owner.profile_url, bizcard.profile_img),
    cover_img: pickNonBlankOrNull(owner.cover_url, null),
    user: owner,
  };

  const parseMetadata = (metadata: string | null | undefined): Record<string, unknown> => {
    if (!metadata) return {};
    try {
      const parsed: unknown = JSON.parse(metadata);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  };

  const [services, socialLinks, products, blogs, addresses, mediaRows] = await Promise.all([
    prisma.service.findMany({
      where: {
        OR: [{ bizcard_id: bizcard.bizcard_id }, { user_id: owner.user_id }],
        is_visible: true,
        status: "active",
      },
      orderBy: [{ featured: "desc" }, { display_order: "asc" }, { created_at: "desc" }],
      select: {
        service_id: true,
        name: true,
        description: true,
        tagline: true,
        price: true,
        featured_image: true,
        serviceMedia: {
          orderBy: { display_order: "asc" },
          take: 5,
          select: {
            id: true,
            file_url: true,
            mime_type: true,
            file_name: true,
            display_order: true,
          },
        },
      },
      take: 20,
    }),
    prisma.social.findMany({
      where: {
        OR: [{ bizcard_id: bizcard.bizcard_id }, { user_id: owner.user_id }],
        is_visible: true,
        deleted_at: null,
      },
      orderBy: [{ display_order: "asc" }, { created_at: "asc" }],
      select: {
        platform: true,
        url: true,
      },
      take: 20,
    }),
    prisma.product.findMany({
      where: {
        OR: [{ bizcard_id: bizcard.bizcard_id }, { user_id: owner.user_id }],
      },
      orderBy: { created_at: "desc" },
      select: {
        product_id: true,
        name: true,
        price: true,
      },
      take: 20,
    }),
    prisma.blog.findMany({
      where: {
        OR: [{ bizcard_id: bizcard.bizcard_id }, { user_id: owner.user_id }],
      },
      orderBy: { created_at: "desc" },
      select: {
        blog_id: true,
        title: true,
        content: true,
        created_at: true,
      },
      take: 5,
    }),
    prisma.address.findMany({
      where: {
        OR: [{ bizcard_id: bizcard.bizcard_id }, { user_id: owner.user_id }],
      },
      orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
      select: {
        area: true,
        brgy: true,
        city: true,
        region: true,
        zipcode: true,
        map_link: true,
        plus_code: true,
        ...(compat.addressLandmark ? { landmark: true } : {}),
        latitude: true,
        longitude: true,
      },
      take: 1,
    }),
    prisma.media.findMany({
      where: {
        user_id: owner.user_id,
        related_type: "gallery",
        related_id: bizcard.bizcard_id,
        deleted_at: null,
        is_active: true,
      },
      orderBy: [{ display_order: "asc" }, { created_at: "asc" }],
      select: {
        media_id: true,
        media_type: true,
        file_url: true,
        metadata: true,
        width: true,
        height: true,
        display_order: true,
        is_featured: true,
      },
      take: 200,
    }),
  ]);

  const media = mediaRows.map((row) => {
    const metadata = parseMetadata(row.metadata);
    const duration = metadata.duration_sec;

    return {
      media_id: row.media_id,
      media_type: row.media_type ?? (typeof metadata.media_type === "string" ? metadata.media_type : null),
      secure_url: row.file_url,
      alt_text: typeof metadata.alt_text === "string" ? metadata.alt_text : null,
      caption:
        typeof metadata.caption === "string"
          ? metadata.caption
          : typeof metadata.description === "string"
            ? metadata.description
            : null,
      tags: Array.isArray(metadata.tags) ? metadata.tags : [],
      width: row.width,
      height: row.height,
      duration_sec: typeof duration === "number" ? duration : null,
      sort_order: row.display_order ?? 0,
      is_featured: row.is_featured ?? false,
    };
  });

  const serviceIds = services.map((s) => s.service_id);
  const serviceGalleryRows =
    serviceIds.length > 0
      ? await prisma.media.findMany({
          where: {
            user_id: owner.user_id,
            deleted_at: null,
            is_active: true,
            related_type: { in: ["service_gallery", "service", "vcard/services"] },
            related_id: { in: serviceIds },
          },
          orderBy: [{ display_order: "asc" }, { created_at: "asc" }],
          select: {
            media_id: true,
            related_id: true,
            file_url: true,
            mime_type: true,
            file_name: true,
            display_order: true,
          },
          take: 100,
        })
      : [];
  const singleServiceFallbackRows =
    services.length === 1
      ? await prisma.media.findMany({
          where: {
            user_id: owner.user_id,
            deleted_at: null,
            is_active: true,
            related_type: { in: ["service_gallery", "service", "vcard/services"] },
            related_id: { in: [bizcard.bizcard_id, owner.user_id] },
          },
          orderBy: [{ display_order: "asc" }, { created_at: "asc" }],
          select: {
            media_id: true,
            related_id: true,
            file_url: true,
            mime_type: true,
            file_name: true,
            display_order: true,
          },
          take: 10,
        })
      : [];

  const enrichedServices = services.map((svc) => {
    const fromTable = (svc.serviceMedia ?? []).map((m) => ({
      id: m.id,
      file_url: m.file_url,
      mime_type: m.mime_type,
      file_name: m.file_name,
      display_order: m.display_order,
    }));
    const seen = new Set(fromTable.map((m) => m.file_url));
    const fromMedia = serviceGalleryRows
      .filter((m) => m.related_id === svc.service_id && m.file_url?.startsWith("http") && !seen.has(m.file_url))
      .slice(0, Math.max(0, 5 - fromTable.length))
      .map((m) => ({
        id: m.media_id,
        file_url: m.file_url,
        mime_type: m.mime_type,
        file_name: m.file_name,
        display_order: m.display_order ?? 0,
      }));
    const fallbackMedia =
      fromTable.length === 0 && fromMedia.length === 0 && services.length === 1
        ? singleServiceFallbackRows
            .filter((m) => m.file_url?.startsWith("http") && !seen.has(m.file_url))
            .slice(0, 5)
            .map((m) => ({
              id: m.media_id,
              file_url: m.file_url,
              mime_type: m.mime_type,
              file_name: m.file_name,
              display_order: m.display_order ?? 0,
            }))
        : [];
    const mergedMedia = [...fromTable, ...fromMedia, ...fallbackMedia].slice(0, 5);
    const featured =
      svc.featured_image && svc.featured_image.startsWith("http")
        ? svc.featured_image
        : mergedMedia[0]?.file_url ?? svc.featured_image;

    return {
      ...svc,
      featured_image: featured,
      serviceMedia: mergedMedia,
    };
  });

  const productIds = products.map((p) => p.product_id);
  const productMediaRows =
    productIds.length > 0
      ? await prisma.media.findMany({
          where: {
            user_id: owner.user_id,
            deleted_at: null,
            is_active: true,
            related_type: "product",
            related_id: { in: productIds },
          },
          orderBy: [{ display_order: "asc" }, { created_at: "asc" }],
          select: { related_id: true, file_url: true },
          take: 100,
        })
      : [];
  const productImageById = new Map<string, string>();
  for (const row of productMediaRows) {
    if (!row.related_id || !row.file_url?.startsWith("http")) continue;
    const key = String(row.related_id);
    if (!productImageById.has(key)) productImageById.set(key, row.file_url);
  }
  const enrichedProducts = products.map((p) => ({
    ...p,
    image: productImageById.get(String(p.product_id)) ?? null,
  }));

  const uniqueSocialLinks = dedupeSocialLinksByUrl(socialLinks, (s) => s.url);

  return {
    bizcard,
    services: enrichedServices,
    socialLinks: uniqueSocialLinks,
    products: enrichedProducts,
    blogs,
    addresses,
    media,
  };
}
