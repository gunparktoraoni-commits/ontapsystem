/**
 * Shared social platform catalog for the BizCard editor and related UI.
 * Keep slug values in sync with server/lib/validators.ts ALLOWED_PLATFORMS.
 */

import type { IconType } from "react-icons";
import {
  FaLinkedin,
  FaFacebookF,
  FaInstagram,
  FaYoutube,
  FaXTwitter,
  FaTiktok,
  FaGlobe,
  FaGithub,
  FaGitlab,
  FaBehance,
  FaDribbble,
  FaMedium,
  FaWhatsapp,
  FaTelegram,
  FaSnapchat,
  FaPinterestP,
  FaDiscord,
  FaRedditAlien,
  FaTwitch,
  FaSpotify,
  FaViber,
  FaThreads,
  FaResearchgate,
  FaOrcid,
  FaSlack,
  FaLink,
} from "react-icons/fa6";
import { SiCalendly, SiGooglescholar, SiSubstack, SiWellfound, SiNotion, SiBluesky } from "react-icons/si";

export type SocialPlatformCategory =
  | "professional"
  | "social"
  | "messaging"
  | "other";

export type SocialPlatformDef = {
  /** API / DB slug (lowercase). */
  slug: string;
  /** Display label shown in the editor. */
  key: string;
  color: string;
  placeholder: string;
  category: SocialPlatformCategory;
  Icon: IconType;
};

export const SOCIAL_PLATFORM_CATALOG: SocialPlatformDef[] = [
  // Professional
  {
    slug: "linkedin",
    key: "LinkedIn",
    color: "#0A66C2",
    placeholder: "https://linkedin.com/in/yourprofile",
    category: "professional",
    Icon: FaLinkedin,
  },
  {
    slug: "github",
    key: "GitHub",
    color: "#24292F",
    placeholder: "https://github.com/yourhandle",
    category: "professional",
    Icon: FaGithub,
  },
  {
    slug: "gitlab",
    key: "GitLab",
    color: "#FC6D26",
    placeholder: "https://gitlab.com/yourhandle",
    category: "professional",
    Icon: FaGitlab,
  },
  {
    slug: "behance",
    key: "Behance",
    color: "#1769FF",
    placeholder: "https://behance.net/yourprofile",
    category: "professional",
    Icon: FaBehance,
  },
  {
    slug: "dribbble",
    key: "Dribbble",
    color: "#EA4C89",
    placeholder: "https://dribbble.com/yourprofile",
    category: "professional",
    Icon: FaDribbble,
  },
  {
    slug: "medium",
    key: "Medium",
    color: "#00AB6C",
    placeholder: "https://medium.com/@yourhandle",
    category: "professional",
    Icon: FaMedium,
  },
  {
    slug: "substack",
    key: "Substack",
    color: "#FF6719",
    placeholder: "https://yourname.substack.com",
    category: "professional",
    Icon: SiSubstack,
  },
  {
    slug: "notion",
    key: "Notion",
    color: "#000000",
    placeholder: "https://notion.so/yourpage",
    category: "professional",
    Icon: SiNotion,
  },
  {
    slug: "calendly",
    key: "Calendly",
    color: "#006BFF",
    placeholder: "https://calendly.com/yourname",
    category: "professional",
    Icon: SiCalendly,
  },
  {
    slug: "wellfound",
    key: "Wellfound",
    color: "#000000",
    placeholder: "https://wellfound.com/u/yourprofile",
    category: "professional",
    Icon: SiWellfound,
  },
  {
    slug: "googlescholar",
    key: "Google Scholar",
    color: "#4285F4",
    placeholder: "https://scholar.google.com/citations?user=…",
    category: "professional",
    Icon: SiGooglescholar,
  },
  {
    slug: "researchgate",
    key: "ResearchGate",
    color: "#00CCBB",
    placeholder: "https://researchgate.net/profile/Your-Name",
    category: "professional",
    Icon: FaResearchgate,
  },
  {
    slug: "orcid",
    key: "ORCID",
    color: "#A6CE39",
    placeholder: "https://orcid.org/0000-0000-0000-0000",
    category: "professional",
    Icon: FaOrcid,
  },
  {
    slug: "slack",
    key: "Slack",
    color: "#4A154B",
    placeholder: "https://yourworkspace.slack.com",
    category: "professional",
    Icon: FaSlack,
  },

  // Social
  {
    slug: "facebook",
    key: "Facebook",
    color: "#1877F2",
    placeholder: "https://facebook.com/yourprofile",
    category: "social",
    Icon: FaFacebookF,
  },
  {
    slug: "instagram",
    key: "Instagram",
    color: "#E4405F",
    placeholder: "https://instagram.com/yourhandle",
    category: "social",
    Icon: FaInstagram,
  },
  {
    slug: "twitter",
    key: "X / Twitter",
    color: "#111111",
    placeholder: "https://x.com/yourhandle",
    category: "social",
    Icon: FaXTwitter,
  },
  {
    slug: "youtube",
    key: "YouTube",
    color: "#FF0000",
    placeholder: "https://youtube.com/@yourchannel",
    category: "social",
    Icon: FaYoutube,
  },
  {
    slug: "tiktok",
    key: "TikTok",
    color: "#111111",
    placeholder: "https://tiktok.com/@yourhandle",
    category: "social",
    Icon: FaTiktok,
  },
  {
    slug: "threads",
    key: "Threads",
    color: "#000000",
    placeholder: "https://threads.net/@yourhandle",
    category: "social",
    Icon: FaThreads,
  },
  {
    slug: "bluesky",
    key: "Bluesky",
    color: "#1185FE",
    placeholder: "https://bsky.app/profile/yourhandle.bsky.social",
    category: "social",
    Icon: SiBluesky,
  },
  {
    slug: "pinterest",
    key: "Pinterest",
    color: "#E60023",
    placeholder: "https://pinterest.com/yourprofile",
    category: "social",
    Icon: FaPinterestP,
  },
  {
    slug: "snapchat",
    key: "Snapchat",
    color: "#FFFC00",
    placeholder: "https://snapchat.com/add/yourhandle",
    category: "social",
    Icon: FaSnapchat,
  },
  {
    slug: "reddit",
    key: "Reddit",
    color: "#FF4500",
    placeholder: "https://reddit.com/user/yourhandle",
    category: "social",
    Icon: FaRedditAlien,
  },
  {
    slug: "twitch",
    key: "Twitch",
    color: "#9146FF",
    placeholder: "https://twitch.tv/yourhandle",
    category: "social",
    Icon: FaTwitch,
  },
  {
    slug: "spotify",
    key: "Spotify",
    color: "#1DB954",
    placeholder: "https://open.spotify.com/user/yourid",
    category: "social",
    Icon: FaSpotify,
  },

  // Messaging
  {
    slug: "whatsapp",
    key: "WhatsApp",
    color: "#25D366",
    placeholder: "https://wa.me/639171234567",
    category: "messaging",
    Icon: FaWhatsapp,
  },
  {
    slug: "telegram",
    key: "Telegram",
    color: "#26A5E4",
    placeholder: "https://t.me/yourhandle",
    category: "messaging",
    Icon: FaTelegram,
  },
  {
    slug: "viber",
    key: "Viber",
    color: "#7360F2",
    placeholder: "https://viber.com/yourhandle",
    category: "messaging",
    Icon: FaViber,
  },
  {
    slug: "discord",
    key: "Discord",
    color: "#5865F2",
    placeholder: "https://discord.gg/yourinvite",
    category: "messaging",
    Icon: FaDiscord,
  },

  // Other
  {
    slug: "website",
    key: "Website",
    color: "#6366F1",
    placeholder: "https://yourwebsite.com",
    category: "other",
    Icon: FaGlobe,
  },
  {
    slug: "other",
    key: "Other",
    color: "#64748B",
    placeholder: "https://example.com/yourprofile",
    category: "other",
    Icon: FaLink,
  },
];

/** Back-compat shape used by SocialTab / VCardDetails. */
export const SOCIAL_PLATFORMS = SOCIAL_PLATFORM_CATALOG.map(
  ({ key, Icon, color, slug, placeholder, category }) => ({
    key,
    Icon,
    color,
    slug,
    placeholder,
    category,
  }),
);

export const SOCIAL_PLATFORM_CATEGORY_LABELS: Record<SocialPlatformCategory, string> = {
  professional: "Professional",
  social: "Social",
  messaging: "Messaging",
  other: "Other",
};

export function normalizeSocialPlatformKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s/_]+/g, "");
}

const PLATFORM_LOOKUP = new Map<string, SocialPlatformDef>();
for (const platform of SOCIAL_PLATFORM_CATALOG) {
  PLATFORM_LOOKUP.set(platform.slug, platform);
  PLATFORM_LOOKUP.set(normalizeSocialPlatformKey(platform.key), platform);
  PLATFORM_LOOKUP.set(platform.key.toLowerCase(), platform);
}

/** Extra aliases → catalog slug. */
const PLATFORM_ALIASES: Record<string, string> = {
  x: "twitter",
  tw: "twitter",
  fb: "facebook",
  ig: "instagram",
  instagram_page: "instagram",
  yt: "youtube",
  gh: "github",
  web: "website",
  site: "website",
  angel: "wellfound",
  angellist: "wellfound",
  "angel list": "wellfound",
  scholar: "googlescholar",
  "google scholar": "googlescholar",
  google_scholar: "googlescholar",
};

export function resolveSocialPlatformDef(
  platform: string | null | undefined,
): SocialPlatformDef {
  const raw = String(platform ?? "").trim();
  if (!raw) return SOCIAL_PLATFORM_CATALOG[SOCIAL_PLATFORM_CATALOG.length - 1];

  const lower = raw.toLowerCase();
  const compact = normalizeSocialPlatformKey(raw);
  const aliasSlug = PLATFORM_ALIASES[lower] ?? PLATFORM_ALIASES[compact];
  if (aliasSlug) {
    return PLATFORM_LOOKUP.get(aliasSlug) ?? SOCIAL_PLATFORM_CATALOG[SOCIAL_PLATFORM_CATALOG.length - 1];
  }

  return (
    PLATFORM_LOOKUP.get(lower) ??
    PLATFORM_LOOKUP.get(compact) ??
    SOCIAL_PLATFORM_CATALOG[SOCIAL_PLATFORM_CATALOG.length - 1]
  );
}

export function socialPlatformDisplayLabel(platform: string): string {
  return resolveSocialPlatformDef(platform).key;
}

/**
 * Host / path patterns used to auto-detect a platform from a pasted URL.
 * More specific entries (e.g. scholar.google.com) are checked before broader ones.
 */
const PLATFORM_URL_HINTS: Array<{ slug: string; match: (host: string, href: string) => boolean }> = [
  { slug: "linkedin", match: (h, href) => h.includes("linkedin.com") || h === "lnkd.in" || href.includes("linkedin") },
  { slug: "facebook", match: (h, href) => h.includes("facebook.com") || h === "fb.com" || h.endsWith(".fb.com") || h === "fb.watch" || href.includes("facebook") },
  { slug: "instagram", match: (h) => h.includes("instagram.com") },
  { slug: "youtube", match: (h, href) => h.includes("youtube.com") || h === "youtu.be" || href.includes("youtube") || href.includes("youtu.be") },
  { slug: "twitter", match: (h, href) => h === "x.com" || h.includes("twitter.com") || h === "t.co" || href.includes("x.com") || href.includes("twitter.com") },
  { slug: "tiktok", match: (h, href) => h.includes("tiktok.com") || href.includes("tiktok") },
  { slug: "threads", match: (h) => h.includes("threads.net") },
  { slug: "bluesky", match: (h) => h.includes("bsky.app") || h.includes("bsky.social") },
  { slug: "github", match: (h) => h === "github.com" || h.endsWith(".github.io") },
  { slug: "gitlab", match: (h) => h.includes("gitlab.com") },
  { slug: "behance", match: (h) => h.includes("behance.net") },
  { slug: "dribbble", match: (h) => h.includes("dribbble.com") },
  { slug: "medium", match: (h) => h.includes("medium.com") },
  { slug: "substack", match: (h) => h.includes("substack.com") },
  { slug: "notion", match: (h) => h.includes("notion.so") || h.includes("notion.site") },
  { slug: "calendly", match: (h) => h.includes("calendly.com") },
  { slug: "wellfound", match: (h) => h.includes("wellfound.com") || h.includes("angel.co") },
  { slug: "googlescholar", match: (h) => h.includes("scholar.google.") },
  { slug: "researchgate", match: (h) => h.includes("researchgate.net") },
  { slug: "orcid", match: (h) => h.includes("orcid.org") },
  { slug: "slack", match: (h, href) => h.includes("slack.com") || href.startsWith("slack://") },
  { slug: "whatsapp", match: (h, href) => h.includes("wa.me") || h.includes("whatsapp.com") || h.includes("api.whatsapp.com") || href.startsWith("whatsapp://") },
  { slug: "telegram", match: (h, href) => h === "t.me" || h.includes("telegram.me") || h.includes("telegram.org") || href.startsWith("tg://") },
  { slug: "viber", match: (h, href) => h.includes("viber.com") || href.startsWith("viber://") },
  { slug: "discord", match: (h, href) => h.includes("discord.com") || h.includes("discord.gg") || href.startsWith("discord://") },
  { slug: "pinterest", match: (h, href) => h.includes("pinterest.com") || h.includes("pin.it") || href.includes("pinterest") },
  { slug: "snapchat", match: (h) => h.includes("snapchat.com") },
  { slug: "reddit", match: (h) => h.includes("reddit.com") || h === "redd.it" },
  { slug: "twitch", match: (h) => h.includes("twitch.tv") },
  { slug: "spotify", match: (h, href) => h.includes("spotify.com") || h.includes("open.spotify.com") || href.startsWith("spotify:") },
];

function unwrapNestedUrlCandidate(value: string): string {
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
}

/**
 * Infer the social platform from a typed/pasted URL.
 * Falls back to Website for unrecognized http(s) hosts, or Other when empty/invalid.
 */
export function detectSocialPlatformFromUrl(rawUrl: string): SocialPlatformDef {
  const trimmed = unwrapNestedUrlCandidate(String(rawUrl ?? "").trim());
  if (!trimmed) {
    return resolveSocialPlatformDef("other");
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("mailto:") || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return resolveSocialPlatformDef("other");
  }
  if (lower.startsWith("tel:")) {
    return resolveSocialPlatformDef("other");
  }

  let host = "";
  let href = trimmed.toLowerCase();
  try {
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(normalized);
    host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    href = parsed.href.toLowerCase();
  } catch {
    // Bare text — try hostname-like extraction
    host = trimmed
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split(/[/?#]/)[0]
      ?.toLowerCase() ?? "";
  }

  if (!host) {
    return resolveSocialPlatformDef("other");
  }

  for (const hint of PLATFORM_URL_HINTS) {
    if (hint.match(host, href)) {
      return resolveSocialPlatformDef(hint.slug);
    }
  }

  // Recognized as a URL-ish host but not a known network → Website
  if (host.includes(".")) {
    return resolveSocialPlatformDef("website");
  }

  return resolveSocialPlatformDef("other");
}

/**
 * Determine a platform definition for display/icon purposes.
 * URL wins over the stored platform column whenever it identifies a known network.
 */
export function resolveSocialPlatformDefFromLink(
  platform: string | null | undefined,
  rawUrl: string | null | undefined,
): SocialPlatformDef {
  const detected = detectSocialPlatformFromUrl(String(rawUrl ?? ""));
  if (detected.slug !== "other" && detected.slug !== "website") {
    return detected;
  }

  const fallback = resolveSocialPlatformDef(platform);
  if (detected.slug === "website" && fallback.slug === "other") {
    return detected;
  }

  return fallback;
}

export function getUnusedSocialPlatforms(
  usedPlatforms: string[],
): SocialPlatformDef[] {
  const used = new Set(
    usedPlatforms.map((p) => resolveSocialPlatformDef(p).slug),
  );
  return SOCIAL_PLATFORM_CATALOG.filter((platform) => {
    if (platform.slug === "other") return true;
    return !used.has(platform.slug);
  });
}
