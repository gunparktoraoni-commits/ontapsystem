import { NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveEffectiveUserId, resolveRequestSession } from "@/server/lib/auth";

export const USERNAME_REGEX = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
export const SECTION_TYPES = new Set(["all", "services", "gallery", "videos"]);

export const SOCIAL_PLATFORM_META: Record<string, { icon: string; displayName: string }> = {
  linkedin: { icon: "linkedin", displayName: "LinkedIn" },
  twitter: { icon: "twitter", displayName: "X (Twitter)" },
  x: { icon: "twitter", displayName: "X (Twitter)" },
  github: { icon: "github", displayName: "GitHub" },
  instagram: { icon: "instagram", displayName: "Instagram" },
  facebook: { icon: "facebook", displayName: "Facebook" },
  tiktok: { icon: "tiktok", displayName: "TikTok" },
  youtube: { icon: "youtube", displayName: "YouTube" },
  website: { icon: "globe", displayName: "Website" },
  telegram: { icon: "telegram", displayName: "Telegram" },
  whatsapp: { icon: "whatsapp", displayName: "WhatsApp" },
  pinterest: { icon: "pinterest", displayName: "Pinterest" },
  snapchat: { icon: "snapchat", displayName: "Snapchat" },
  other: { icon: "link", displayName: "Other" },
};

export const serializeBigInts = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

export type ResolvedVcardProfile = {
  source: "bizcard" | "user";
  bizcard_id: bigint | null;
  user_id: bigint;
  custom_uri: string | null;
  serial_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  contact: string | null;
  alt_contact: string | null;
  alt_email: string | null;
  prof_title: string | null;
  post_nominal: string | null;
  suffix: string | null;
  job_position: string | null;
  about: string | null;
  vcard_name: string | null;
  vcard_description: string | null;
  registration_type: string;
  vcard_published: boolean;
  is_active: boolean;
  theme_path: string | null;
  profile_url: string | null;
  cover_url: string | null;
  updated_at: Date | null;
};

export function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

/** Prefer non-blank primary; fall back when null/undefined/whitespace-only (migration-tolerant). */
export function pickNonBlank(
  primary: string | null | undefined,
  fallback: string | null | undefined,
): string {
  const p = toNullableString(primary);
  if (p !== null) return p;
  return toNullableString(fallback) ?? "";
}

export function pickNonBlankOrNull(
  primary: string | null | undefined,
  fallback: string | null | undefined,
): string | null {
  const p = toNullableString(primary);
  if (p !== null) return p;
  return toNullableString(fallback);
}

export function toIsoOrNull(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString();
}

export function getSocialMeta(platform: string): { icon: string; displayName: string } {
  const key = platform.trim().toLowerCase();
  return SOCIAL_PLATFORM_META[key] ?? { icon: key || "link", displayName: platform || "Other" };
}

function detectSocialPlatformKeyFromUrl(rawUrl: string): string {
  const unwrapNestedUrlCandidate = (value: string): string => {
    let current = value.trim();
    for (let i = 0; i < 3; i += 1) {
      let next = current;
      try {
        next = decodeURIComponent(next);
      } catch {
        // keep current
      }

      const match = next.match(/(?:^|[?&])(url|u|target|dest|destination|redirect|redirect_url|redirect_uri|link)=([^&]+)/i);
      if (!match) return next;
      current = match[2] ?? next;
    }
    return current;
  };

  const trimmed = unwrapNestedUrlCandidate(String(rawUrl ?? "").trim());
  if (!trimmed) return "other";

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("mailto:") || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return "other";
  if (lower.startsWith("tel:")) return "other";

  let host = "";
  let href = trimmed.toLowerCase();
  try {
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(normalized);
    host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    href = parsed.href.toLowerCase();
  } catch {
    host = trimmed
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split(/[/?#]/)[0]
      ?.toLowerCase() ?? "";
  }

  if (!host) return "other";
  if (host.includes("linkedin.com") || host === "lnkd.in" || href.includes("linkedin")) return "linkedin";
  if (host.includes("facebook.com") || host === "fb.com" || host.endsWith(".fb.com") || host === "fb.watch" || href.includes("facebook")) return "facebook";
  if (host.includes("instagram.com")) return "instagram";
  if (host.includes("youtube.com") || host === "youtu.be" || href.includes("youtube") || href.includes("youtu.be")) return "youtube";
  if (host === "x.com" || host.includes("twitter.com") || host === "t.co" || href.includes("x.com") || href.includes("twitter.com")) return "twitter";
  if (host.includes("tiktok.com") || href.includes("tiktok")) return "tiktok";
  if (host.includes("github.com") || host.endsWith(".github.io")) return "github";
  if (host.includes("gitlab.com")) return "gitlab";
  if (host.includes("behance.net")) return "behance";
  if (host.includes("dribbble.com")) return "dribbble";
  if (host.includes("medium.com")) return "medium";
  if (host.includes("substack.com")) return "substack";
  if (host.includes("notion.so") || host.includes("notion.site")) return "notion";
  if (host.includes("calendly.com")) return "calendly";
  if (host.includes("wellfound.com") || host.includes("angel.co")) return "wellfound";
  if (host.includes("scholar.google.")) return "googlescholar";
  if (host.includes("researchgate.net")) return "researchgate";
  if (host.includes("orcid.org")) return "orcid";
  if (host.includes("slack.com") || href.startsWith("slack://")) return "slack";
  if (host.includes("wa.me") || host.includes("whatsapp.com") || host.includes("api.whatsapp.com") || href.startsWith("whatsapp://")) return "whatsapp";
  if (host === "t.me" || host.includes("telegram.me") || host.includes("telegram.org") || href.startsWith("tg://")) return "telegram";
  if (host.includes("viber.com") || href.startsWith("viber://")) return "viber";
  if (host.includes("discord.com") || host.includes("discord.gg") || href.startsWith("discord://")) return "discord";
  if (host.includes("threads.net")) return "threads";
  if (host.includes("bsky.app") || host.includes("bsky.social")) return "bluesky";
  if (host.includes("snapchat.com")) return "snapchat";
  if (host.includes("pinterest.com") || host.includes("pin.it") || href.includes("pinterest")) return "pinterest";
  if (host.includes("reddit.com") || host === "redd.it") return "reddit";
  if (host.includes("twitch.tv")) return "twitch";
  if (host.includes("spotify.com") || host.includes("open.spotify.com") || href.startsWith("spotify:")) return "spotify";
  if (host.includes(".")) return "website";
  return "other";
}

export function getSocialMetaForLink(
  url: string,
  fallbackPlatform: string,
): { icon: string; displayName: string } {
  const detected = detectSocialPlatformKeyFromUrl(url);
  if (detected !== "other" && detected !== "website") {
    return getSocialMeta(detected);
  }
  if (detected === "website" && !String(fallbackPlatform ?? "").trim()) {
    return getSocialMeta("website");
  }
  return getSocialMeta(fallbackPlatform || detected);
}

export async function getOptionalSessionUserId(request: NextRequest): Promise<bigint | null> {
  const resolved = await resolveRequestSession(request, { tryRefresh: true });
  if (!resolved.session) return null;
  // During superadmin impersonation, treat the target user as the session owner
  // so owner-scoped vCard reads (services/design/social/details) succeed.
  try {
    return BigInt(resolveEffectiveUserId(resolved));
  } catch {
    return BigInt(resolved.session.userId);
  }
}

export async function resolveUserByUsernameOrId(input: {
  username?: string | null;
  userId?: string | null;
}) {
  if (input.userId && /^\d{1,20}$/.test(input.userId)) {
    return prisma.user.findUnique({
      where: { user_id: BigInt(input.userId) },
      select: {
        user_id: true,
        custom_uri: true,
        serial_id: true,
        first_name: true,
        last_name: true,
        email: true,
        contact: true,
        alt_contact: true,
        alt_email: true,
        prof_title: true,
        post_nominal: true,
        suffix: true,
        job_position: true,
        about: true,
        registration_type: true,
        is_active: true,
        profile_url: true,
        cover_url: true,
        updated_at: true,
      },
    });
  }

  const username = toNullableString(input.username)?.toLowerCase();
  if (!username || !USERNAME_REGEX.test(username)) return null;

  return prisma.user.findFirst({
    where: {
      OR: [{ custom_uri: username }, { serial_id: username }],
    },
    select: {
      user_id: true,
      custom_uri: true,
      serial_id: true,
      first_name: true,
      last_name: true,
      email: true,
      contact: true,
      alt_contact: true,
      alt_email: true,
      prof_title: true,
      post_nominal: true,
      suffix: true,
      job_position: true,
      about: true,
      registration_type: true,
      is_active: true,
      profile_url: true,
      cover_url: true,
      updated_at: true,
    },
  });
}

type ResolvedBizcardUser = {
  user_id: bigint;
  serial_id: string | null;
  registration_type: string;
  is_active: boolean;
  first_name: string;
  last_name: string;
  middle_name: string | null;
  prof_title: string | null;
  job_position: string | null;
  about: string | null;
  profile_url: string | null;
  cover_url: string | null;
};

const resolvedBizcardUserSelect = {
  user_id: true,
  serial_id: true,
  registration_type: true,
  is_active: true,
  first_name: true,
  last_name: true,
  middle_name: true,
  prof_title: true,
  job_position: true,
  about: true,
  profile_url: true,
  cover_url: true,
} as const;

/** When bizcard.user_id is NULL, match User by bizcard email (common for unlinked virtual cards). */
async function attachUserToBizcardByEmail<
  T extends { email: string; user: ResolvedBizcardUser | null },
>(bizcard: T): Promise<T> {
  if (bizcard.user) return bizcard;
  const owner = await prisma.user.findFirst({
    where: { email: bizcard.email.trim(), is_active: true },
    select: resolvedBizcardUserSelect,
  });
  if (!owner) return bizcard;
  return { ...bizcard, user: owner };
}

function mapBizcardToResolvedProfile(bizcard: {
  bizcard_id: bigint;
  user_id: bigint | null;
  url_alias: string | null;
  serial_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  contact_number: string;
  alt_contact_number: string | null;
  alt_email: string | null;
  professional_title: string | null;
  post_nominal: string | null;
  suffix: string | null;
  occupation: string | null;
  bio: string | null;
  bizcard_name: string;
  description: string | null;
  deactivated_flag: boolean;
  bizcard_theme: string | null;
  profile_img: string | null;
  cover_img: string | null;
  updated_at: Date | null;
  user: ResolvedBizcardUser | null;
}): ResolvedVcardProfile | null {
  if (!bizcard.user) return null;

  const firstName = pickNonBlank(bizcard.first_name, bizcard.user.first_name);
  const lastName = pickNonBlank(bizcard.last_name, bizcard.user.last_name);
  const composedName = `${firstName} ${lastName}`.trim();

  return {
    source: "bizcard",
    bizcard_id: bizcard.bizcard_id,
    user_id: bizcard.user.user_id,
    custom_uri: bizcard.url_alias,
    serial_id: bizcard.serial_id ?? bizcard.user.serial_id,
    first_name: firstName,
    last_name: lastName,
    email: bizcard.email,
    contact: bizcard.contact_number,
    alt_contact: bizcard.alt_contact_number,
    alt_email: bizcard.alt_email,
    prof_title: pickNonBlankOrNull(bizcard.professional_title, bizcard.user.prof_title),
    post_nominal: bizcard.post_nominal,
    suffix: bizcard.suffix,
    job_position: pickNonBlankOrNull(bizcard.occupation, bizcard.user.job_position),
    about: pickNonBlankOrNull(bizcard.bio, bizcard.user.about),
    vcard_name: pickNonBlankOrNull(bizcard.bizcard_name, composedName || null),
    vcard_description: pickNonBlankOrNull(bizcard.description, bizcard.user.about),
    registration_type: bizcard.user.registration_type,
    // Bizcard publication is card-scoped in multi-bizcard flows.
    vcard_published: !bizcard.deactivated_flag,
    is_active: bizcard.user.is_active && !bizcard.deactivated_flag,
    theme_path: bizcard.bizcard_theme,
    // User is authoritative for images. Prefer User; for cover do not fall back to
    // stale Bizcard URLs when the user has no cover (matches dashboard empty state).
    profile_url: pickNonBlankOrNull(bizcard.user.profile_url, bizcard.profile_img),
    cover_url: pickNonBlankOrNull(bizcard.user.cover_url, null),
    updated_at: bizcard.updated_at,
  };
}

export async function resolveProfileByUsernameOrId(input: {
  username?: string | null;
  userId?: string | null;
}): Promise<ResolvedVcardProfile | null> {
  if (input.userId && /^\d{1,20}$/.test(input.userId)) {
    const bizcard = await prisma.bizcard.findFirst({
      where: { user_id: BigInt(input.userId), is_blank: false },
      orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
      select: {
        bizcard_id: true,
        user_id: true,
        url_alias: true,
        serial_id: true,
        first_name: true,
        last_name: true,
        email: true,
        contact_number: true,
        alt_contact_number: true,
        alt_email: true,
        professional_title: true,
        post_nominal: true,
        suffix: true,
        occupation: true,
        bio: true,
        bizcard_name: true,
        description: true,
        deactivated_flag: true,
        bizcard_theme: true,
        profile_img: true,
        cover_img: true,
        updated_at: true,
        user: {
          select: resolvedBizcardUserSelect,
        },
      },
    });

    const resolvedFromBizcard = bizcard ? mapBizcardToResolvedProfile(await attachUserToBizcardByEmail(bizcard)) : null;
    if (resolvedFromBizcard) return resolvedFromBizcard;

    const user = await resolveUserByUsernameOrId(input);
    if (!user) return null;
    return {
      source: "user",
      bizcard_id: null,
      user_id: user.user_id,
      custom_uri: user.custom_uri,
      serial_id: user.serial_id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      contact: user.contact,
      alt_contact: user.alt_contact,
      alt_email: user.alt_email,
      prof_title: user.prof_title,
      post_nominal: user.post_nominal,
      suffix: user.suffix,
      job_position: user.job_position,
      about: user.about,
      vcard_name: `${user.first_name} ${user.last_name}`.trim(),
      vcard_description: user.about,
      registration_type: user.registration_type,
      vcard_published: user.is_active,
      is_active: user.is_active,
      theme_path: null,
      profile_url: user.profile_url,
      cover_url: user.cover_url,
      updated_at: user.updated_at,
    };
  }

  const username = toNullableString(input.username)?.toLowerCase();
  if (!username || !USERNAME_REGEX.test(username)) return null;

  const bizcardSelect = {
    bizcard_id: true,
    user_id: true,
    url_alias: true,
    serial_id: true,
    first_name: true,
    last_name: true,
    email: true,
    contact_number: true,
    alt_contact_number: true,
    alt_email: true,
    professional_title: true,
    post_nominal: true,
    suffix: true,
    occupation: true,
    bio: true,
    bizcard_name: true,
    description: true,
    deactivated_flag: true,
    bizcard_theme: true,
    profile_img: true,
    cover_img: true,
    updated_at: true,
    user: {
      select: resolvedBizcardUserSelect,
    },
  } as const;

  // Prefer User.custom_uri owner when a different account's Bizcard stole the same alias.
  const canonicalOwner = await resolveUserByUsernameOrId({ username });

  if (canonicalOwner && String(canonicalOwner.custom_uri ?? "").toLowerCase() === username) {
    let ownedCard = await prisma.bizcard.findFirst({
      where: {
        user_id: canonicalOwner.user_id,
        is_blank: false,
      },
      orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
      select: bizcardSelect,
    });
    if (!ownedCard) {
      const { syncUserProfileToBizcard } = await import("@/lib/bizcard/sync");
      await syncUserProfileToBizcard(canonicalOwner.user_id);
      ownedCard = await prisma.bizcard.findFirst({
        where: {
          user_id: canonicalOwner.user_id,
          is_blank: false,
        },
        orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
        select: bizcardSelect,
      });
    }
    if (ownedCard) {
      const withUser = await attachUserToBizcardByEmail(ownedCard);
      const resolvedFromBizcard = mapBizcardToResolvedProfile(withUser);
      if (resolvedFromBizcard) return resolvedFromBizcard;
    }
    // Fall through to user-only profile if still no card.
    return {
      source: "user",
      bizcard_id: null,
      user_id: canonicalOwner.user_id,
      custom_uri: canonicalOwner.custom_uri,
      serial_id: canonicalOwner.serial_id,
      first_name: canonicalOwner.first_name,
      last_name: canonicalOwner.last_name,
      email: canonicalOwner.email,
      contact: canonicalOwner.contact,
      alt_contact: canonicalOwner.alt_contact,
      alt_email: canonicalOwner.alt_email,
      prof_title: canonicalOwner.prof_title,
      post_nominal: canonicalOwner.post_nominal,
      suffix: canonicalOwner.suffix,
      job_position: canonicalOwner.job_position,
      about: canonicalOwner.about,
      vcard_name: `${canonicalOwner.first_name} ${canonicalOwner.last_name}`.trim(),
      vcard_description: canonicalOwner.about,
      registration_type: canonicalOwner.registration_type,
      vcard_published: canonicalOwner.is_active,
      is_active: canonicalOwner.is_active,
      theme_path: null,
      profile_url: canonicalOwner.profile_url,
      cover_url: canonicalOwner.cover_url,
      updated_at: canonicalOwner.updated_at,
    };
  }

  let bizcard = await prisma.bizcard.findFirst({
    where: {
      is_blank: false,
      OR: [{ url_alias: username }, { serial_id: username }],
    },
    orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
    select: bizcardSelect,
  });

  if (!bizcard) {
    bizcard = await prisma.bizcard.findFirst({
      where: {
        is_blank: false,
        deactivated_flag: false,
        user: {
          custom_uri: username,
          is_active: true,
        },
      },
      orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
      select: bizcardSelect,
    });
  }

  if (bizcard) {
    const withUser = await attachUserToBizcardByEmail(bizcard);
    const resolvedFromBizcard = mapBizcardToResolvedProfile(withUser);
    if (resolvedFromBizcard) return resolvedFromBizcard;
  }

  const user = await resolveUserByUsernameOrId(input);
  if (!user) return null;
  return {
    source: "user",
    bizcard_id: null,
    user_id: user.user_id,
    custom_uri: user.custom_uri,
    serial_id: user.serial_id,
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
    contact: user.contact,
    alt_contact: user.alt_contact,
    alt_email: user.alt_email,
    prof_title: user.prof_title,
    post_nominal: user.post_nominal,
    suffix: user.suffix,
    job_position: user.job_position,
    about: user.about,
    vcard_name: `${user.first_name} ${user.last_name}`.trim(),
    vcard_description: user.about,
    registration_type: user.registration_type,
    vcard_published: user.is_active,
    is_active: user.is_active,
    theme_path: null,
    profile_url: user.profile_url,
    cover_url: user.cover_url,
    updated_at: user.updated_at,
  };
}

export function ensureSectionType(value: string | null): "all" | "services" | "gallery" | "videos" {
  const normalized = (value ?? "all").toLowerCase();
  if (!SECTION_TYPES.has(normalized)) return "all";
  return normalized as "all" | "services" | "gallery" | "videos";
}
