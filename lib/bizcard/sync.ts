import { prisma } from "@/server/lib/prisma";
import { generateBizcardSerialId, generateUrlAlias } from "@/lib/bizcard/generator";
import type { Prisma } from "@prisma/client";
import { getSchemaCompat, omitMissingColumns } from "@/lib/db/schemaCompat";

export async function syncUserProfileToBizcard(userId: bigint): Promise<bigint | null> {
  const compat = await getSchemaCompat();
  const [user, address] = await Promise.all([
    prisma.user.findUnique({
      where: { user_id: userId },
      select: {
        user_id: true,
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
    }),
    prisma.address.findFirst({
      where: { user_id: userId },
      select: {
        area: true,
        brgy: true,
        city: true,
        region: true,
        zipcode: true,
        map_link: true,
      },
    }),
  ]);

  if (!user) return null;

  const urlAlias = user.custom_uri ?? generateUrlAlias(user.first_name, user.last_name, user.user_id);
  const parsedZip = address?.zipcode && /^\d+$/.test(address.zipcode) ? BigInt(address.zipcode) : null;

  // Prefer the same non-blank card as GET /api/vcard/profile so sync does not
  // target a blank placeholder and collide with another card's unique url_alias.
  const bizcardSelect = {
    bizcard_id: true,
    bizcard_type: true,
    is_merged: true,
    serial_id: true,
    bizcard_theme: true,
    bizcard_name: true,
    description: true,
    languages: true,
    url_alias: true,
  } as const;

  let existing = await prisma.bizcard.findFirst({
    where: { user_id: user.user_id, is_blank: false },
    orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
    select: bizcardSelect,
  });
  if (!existing) {
    existing = await prisma.bizcard.findFirst({
      where: { user_id: user.user_id },
      orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
      select: bizcardSelect,
    });
  }

  // Reclaim a stolen url_alias held by another user who does not own this custom_uri.
  // Example: Bizcard.url_alias=bambam on User 616 while User 2 has custom_uri=bambam.
  if (!existing && urlAlias) {
    const conflict = await prisma.bizcard.findFirst({
      where: {
        url_alias: urlAlias,
        NOT: { user_id: user.user_id },
      },
      select: {
        bizcard_id: true,
        user_id: true,
        bizcard_type: true,
        is_merged: true,
        serial_id: true,
        bizcard_theme: true,
        bizcard_name: true,
        description: true,
        languages: true,
        url_alias: true,
      },
    });
    if (conflict?.user_id) {
      const conflictOwner = await prisma.user.findUnique({
        where: { user_id: conflict.user_id },
        select: { custom_uri: true },
      });
      const conflictOwnsAlias =
        String(conflictOwner?.custom_uri ?? "").trim().toLowerCase() ===
        String(urlAlias).trim().toLowerCase();
      if (!conflictOwnsAlias) {
        existing = {
          bizcard_id: conflict.bizcard_id,
          bizcard_type: conflict.bizcard_type,
          is_merged: conflict.is_merged,
          serial_id: conflict.serial_id,
          bizcard_theme: conflict.bizcard_theme,
          bizcard_name: conflict.bizcard_name,
          description: conflict.description,
          languages: conflict.languages,
          url_alias: conflict.url_alias,
        };
      }
    }
  }

  const shouldHaveSerial = existing
    ? existing.bizcard_type === "physical" || existing.is_merged === true
    : false;

  const serialId = shouldHaveSerial
    ? existing?.serial_id ?? generateBizcardSerialId()
    : null;

  const fallbackName = `${user.first_name} ${user.last_name}`.trim();
  // On update, preserve an existing url_alias. Profile PUT already writes a new
  // alias when the client intentionally changes customUri; re-writing here on
  // every save can unique-conflict with another of the user's bizcards.
  const existingAlias = existing?.url_alias?.trim() || null;

  const userTelephone = (user as { telephone?: string | null; alt_telephone?: string | null })
    .telephone;
  const userAltTelephone = (user as { telephone?: string | null; alt_telephone?: string | null })
    .alt_telephone;

  const sharedFields = omitMissingColumns(
    {
      user_id: user.user_id,
      bizcard_name: existing?.bizcard_name?.trim() ? existing.bizcard_name : fallbackName,
      serial_id: serialId,
      description: existing?.description?.trim() ? existing.description : user.about,
      first_name: user.first_name,
      middle_name: user.middle_name,
      last_name: user.last_name,
      occupation: user.job_position,
      professional_title: user.prof_title,
      post_nominal: user.post_nominal,
      suffix: user.suffix,
      area: address?.area ?? null,
      baranggay: address?.brgy ?? null,
      city: address?.city ?? "",
      zip_code: parsedZip,
      region: address?.region ?? null,
      address_link: address?.map_link ?? null,
      company_id: user.company_id,
      bio: user.about,
      email: user.email,
      contact_number: user.contact ?? "",
      alt_email: user.alt_email,
      alt_contact_number: user.alt_contact,
      telephone_number: userTelephone ?? null,
      alt_telephone_number: userAltTelephone ?? null,
      profile_img: user.profile_url,
      cover_img: user.cover_url,
      bizcard_theme: existing?.bizcard_theme ?? null,
      deactivated_flag: !user.is_active,
      ...(existing?.languages ? { languages: existing.languages } : {}),
      updated_at: new Date(),
    },
    compat,
    "bizcard"
  );

  const updateData: Prisma.BizcardUncheckedUpdateInput = {
    ...sharedFields,
    // Only fill url_alias when the existing card has none yet.
    ...(!existingAlias ? { url_alias: urlAlias } : {}),
  };

  const bizcard = existing
    ? await prisma.bizcard.update({
        where: { bizcard_id: existing.bizcard_id },
        data: updateData,
        select: { bizcard_id: true },
      })
    : await prisma.bizcard.create({
        data: {
          ...sharedFields,
          url_alias: urlAlias,
          created_at: user.created_at,
          bizcard_type: "virtual",
          is_merged: false,
          linked_account: null,
          merged_at: null,
        },
        select: { bizcard_id: true },
      });

  await Promise.all([
    prisma.social.updateMany({
      where: { user_id: user.user_id, deleted_at: null },
      data: { bizcard_id: bizcard.bizcard_id },
    }),
    prisma.service.updateMany({ where: { user_id: user.user_id }, data: { bizcard_id: bizcard.bizcard_id } }),
    prisma.product.updateMany({ where: { user_id: user.user_id }, data: { bizcard_id: bizcard.bizcard_id } }),
    prisma.blog.updateMany({ where: { user_id: user.user_id }, data: { bizcard_id: bizcard.bizcard_id } }),
    prisma.address.updateMany({ where: { user_id: user.user_id }, data: { bizcard_id: bizcard.bizcard_id } }),
  ]);

  return bizcard.bizcard_id as bigint;
}
