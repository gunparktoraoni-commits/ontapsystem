/**
 * Normalizes vCard setup/profile API payloads so user-entered values
 * match server validation (http(s) URLs, API platform slugs, phone format).
 * Keep aliases in sync with server/lib/validators.ts SOCIAL_PLATFORM_ALIASES.
 */

import { dedupeSocialLinksByUrl } from '@/lib/social-links';

const SOCIAL_PLATFORM_API: Record<string, string> = {
  linkedin: 'linkedin',
  facebook: 'facebook',
  fb: 'facebook',
  instagram: 'instagram',
  ig: 'instagram',
  instagram_page: 'instagram',
  youtube: 'youtube',
  yt: 'youtube',
  twitter: 'twitter',
  'x / twitter': 'twitter',
  x: 'twitter',
  tiktok: 'tiktok',
  website: 'website',
  web: 'website',
  site: 'website',
  github: 'github',
  gh: 'github',
  gitlab: 'gitlab',
  behance: 'behance',
  dribbble: 'dribbble',
  medium: 'medium',
  substack: 'substack',
  notion: 'notion',
  calendly: 'calendly',
  wellfound: 'wellfound',
  angellist: 'wellfound',
  angel: 'wellfound',
  'google scholar': 'googlescholar',
  googlescholar: 'googlescholar',
  google_scholar: 'googlescholar',
  scholar: 'googlescholar',
  researchgate: 'researchgate',
  orcid: 'orcid',
  slack: 'slack',
  whatsapp: 'whatsapp',
  telegram: 'telegram',
  viber: 'viber',
  discord: 'discord',
  threads: 'threads',
  bluesky: 'bluesky',
  bsky: 'bluesky',
  snapchat: 'snapchat',
  pinterest: 'pinterest',
  reddit: 'reddit',
  twitch: 'twitch',
  spotify: 'spotify',
  other: 'other',
  // Legacy theme / migrated contact-style platforms → other
  email: 'other',
  phone: 'other',
};

export function normalizeHttpUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '#') return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/\//, '')}`;
}

export function normalizeContactNumber(value: string): string {
  const stripped = value.replace(/\s+/g, '');
  if (!stripped) return '';
  if (stripped.startsWith('+')) return stripped;
  return `+63${stripped}`;
}

/**
 * Map UI / legacy platform labels to API allow-list slugs.
 * Unknown values coerce to `"other"` (migration-tolerant; matches server).
 */
export function mapSocialPlatformForApi(platform: string): string {
  const key = platform.trim().toLowerCase();
  if (!key) return 'other';
  return SOCIAL_PLATFORM_API[key] ?? SOCIAL_PLATFORM_API[key.replace(/\s+/g, '')] ?? 'other';
}

export function serializeSocialLinksForApi(
  links: { platform: string; url: string }[]
): { platform: string; url: string; displayOrder: number; isVisible: boolean }[] {
  const unique = dedupeSocialLinksByUrl(
    links.filter((link) => link.url.trim()),
    (link) => link.url,
  );
  return unique.map((link, index) => ({
    platform: mapSocialPlatformForApi(link.platform),
    url: normalizeHttpUrl(link.url.trim()),
    displayOrder: index,
    isVisible: true,
  }));
}
