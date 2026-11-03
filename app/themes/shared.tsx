'use client';

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { QrCode, Play,
  ChevronLeft, ChevronRight,  Download, Share2, X, Maximize2,
  PhoneCall,
  ZapIcon, UserRoundPlus,
} from 'lucide-react';
import { PDFGalleryItem } from './components/PDFGalleryItem';
import { apiFetch } from '@/lib/apiFetch';
import type { ContactLinkLabelMode, PortfolioData } from '../types';
import { toContactLinkLabelMode } from '../types';
import {
  resolvePortfolioData,
  toPortfolioTelHref,
  toPortfolioPhoneDigits,
  toServableMediaSrc,
  isCoverVideo,
  inferCoverTypeFromUrl,
} from '../lib/portfolioDisplay';
import { PortfolioAddressSection } from '../components/PortfolioAddressCard';
import {
  useQRCardDownload,
  QRCardExportSurface,
  QRCardDownloadButton,
  toQRCardStyle,
} from './QRCardDownload';
import { FaLinkedin, FaXTwitter, FaYoutube, FaFacebookF, FaInstagram, FaTiktok, FaGlobe, FaPhone, FaGithub, FaGitlab, FaBehance, FaDribbble, FaMedium, FaWhatsapp, FaTelegram, FaSnapchat, FaPinterestP, FaDiscord, FaRedditAlien, FaTwitch, FaSpotify, FaViber, FaThreads, FaResearchgate, FaOrcid, FaSlack, FaLink } from 'react-icons/fa6';
import { IoMailOpenOutline } from 'react-icons/io5';
import { SiCalendly, SiGooglescholar, SiSubstack, SiWellfound, SiNotion, SiBluesky } from 'react-icons/si';
import { showToast } from '../components/Toast';
import { RichText } from '../components/RichText';
import { InlineLoader } from '@/app/components/Loader';
import CspStyle from '@/app/components/CspStyle';
import { resolveSocialPlatformDefFromLink } from '../lib/socialPlatforms';
import { dedupeSocialLinksByUrl } from '@/lib/social-links';
import PortfolioConnectModal, {
  useDelayedPortfolioConnectPrompt,
} from './components/PortfolioConnectModal';
import PortfolioPromptDockButton from './components/PortfolioPromptDock';
import { useIsThemePreview, useThemePreviewPortal, usePortfolioTheme } from './components/PortfolioThemeContext';

/** Scope class + CSS so headings/paragraphs/spans wrap long words in all themes. */
export const THEME_TEXT_WRAP_CLASS = 'ontap-theme-text-wrap';
export const THEME_TEXT_WRAP_CSS = `
.${THEME_TEXT_WRAP_CLASS} :is(h1, h2, h3, h4, h5, h6, p, span) {
  max-width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
  word-wrap: break-word;
  word-break: break-word;
  text-wrap: wrap;
}
.${THEME_TEXT_WRAP_CLASS} :is(img, picture, video) {
  -webkit-user-drag: none;
  user-drag: none;
  user-select: none;
}
`;

/** Injects text-wrap styles and scopes descendants without affecting layout. */
export function ThemeTextWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className={THEME_TEXT_WRAP_CLASS} style={{ display: 'contents' }}>
      <CspStyle dangerouslySetInnerHTML={{ __html: THEME_TEXT_WRAP_CSS }} />
      {children}
    </div>
  );
}

export interface ThemeDef {
  id: string;
  name: string;
  bg: string;
  cardBg: string;
  glass: string;
  text: string;
  textMuted: string;
  accent: string;
  accentSoft: string;
  gradient: string;
  headerGradient: string;
  pattern: string;
}

export interface PortfolioViewProps { 
  data?: PortfolioData;
  mini?: boolean;
  showFAB?: boolean;
  isMobile?: boolean;
}

/** Whether gallery/video sections may render on live alias pages. */
export function isGalleryEnabled(d: PortfolioData, mini = false): boolean {
  if (mini) return true;
  return d.galleryAvailable !== false;
}

/** Whether inquiry sections may render on live alias pages. */
export function isInquiryEnabled(d: PortfolioData, mini = false): boolean {
  if (mini) return true;
  return d.inquiryEnabled === true && d.showInquiryCard !== false;
}

type PortfolioCoverMediaProps = {
  src: string;
  coverType?: string | null;
  className?: string;
  style?: React.CSSProperties;
  objectPosition?: string;
  alt?: string;
  onError?: () => void;
};

/**
 * Renders portfolio cover as <video> (autoplay/loop/muted) or <img> (incl. animated GIF).
 * Use instead of CSS backgroundImage when video covers must play.
 *
 * Both video and image covers use object-fit:cover so media fills the entire
 * theme cover box (edge-to-edge), matching classic CSS background-size:cover.
 */
export function PortfolioCoverMedia({
  src,
  coverType,
  className = '',
  style,
  objectPosition,
  alt = 'Cover',
  onError,
}: PortfolioCoverMediaProps) {
  const [failed, setFailed] = useState(false);
  const position = objectPosition ?? 'center center';
  const mediaSrc = toServableMediaSrc(src);

  if (!mediaSrc || failed) return null;

  const handleError = () => {
    setFailed(true);
    onError?.();
  };

  const mediaStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectPosition: position,
    ...style,
    // Always fill the cover box; caller height/width (e.g. heroH) still apply via ...style above.
    objectFit: 'cover',
  };

  if (isCoverVideo(mediaSrc, coverType)) {
    return (
      <video
        src={mediaSrc}
        className={className}
        style={mediaStyle}
        muted
        autoPlay
        loop
        playsInline
        onError={handleError}
      />
    );
  }

  return (
    <img
      src={mediaSrc}
      alt={alt}
      className={className}
      style={mediaStyle}
      onError={handleError}
      draggable={false}
      decoding="async"
    />
  );
}

/* ─────────────────────────────────────────────
   SAMPLE DATA (used for theme previews)
───────────────────────────────────────────── */
export const SAMPLE_DATA: PortfolioData = {
  bizCard: {
    urlAlias: 'sample',
    bizCardName: 'Burnbox Printing',
    description: 'Professional printing services for all your branding needs',
    occupation: 'Printing Specialist',
    profileImage: null,
    coverImage: null,
    coverType: null,
    coverFileName: null,
  },
  
  vcard: {
    firstName: 'Bam',
    middleName: '',
    lastName: 'Bam',
    professionalTitle: '',
    postNominalLetters: '',
    suffix: '',
    about: 'Burnbox Printing specializes in signage fabrication, wall murals, decal stickers, vehicle wraps, and marketing collaterals. We offer offset printing, UV printing, and corporate giveaways to meet all your branding needs.',
    contactNumber: '917 700 8364',
    secondaryNumber: '',
    telephoneNumber: '',
    altTelephoneNumber: '',
    email: 'burnboxprinting@gmail.com',
    alternativeEmail: '',
    addressArea: 'Robinsons Place Las Piñas',
    addressHouseNo: '',
    addressBrgy: '',
    addressCity: 'Las Piñas City',
    addressRegion: 'Metro Manila',
    addressZipcode: '1747',
    addressMapLink: '',
    addressLandmark: '',
    languages: '',
    socialLinks: [
      { id: 1, platform: 'LinkedIn', url: '#' },
      { id: 2, platform: 'Facebook', url: '#' },
      { id: 3, platform: 'Instagram', url: '#' },
      { id: 4, platform: 'YouTube', url: '#' },
    ],
  },
  services: [
    {
      id: 1,
      title: 'Signages',
      tagline: 'Make your brand visible',
      description: 'Store signages are visual displays used in retail establishments to attract customers, convey information, and promote products or services.',
      featured_image:null,
      videoUrl: '',
      videoFile: null,
    },
    {
       
      id: 2,
      title: 'Wall Mural',
      tagline: 'Transform your space',
      description: 'A wall mural is a large-scale artwork painted directly on a wall or ceiling, transforming an ordinary space into immersive art.',
      featured_image: null,
      videoUrl: '',
      videoFile: null,
    },
  ],
  selectedTheme: 'elegant-dark',
};

/* 

   UTILITIES

*/
export function getDisplayName(d: PortfolioData): string {
  const v = d.vcard;
  const isBlankLike = (value: string | null | undefined): boolean => {
    const normalized = String(value ?? '').trim().toLowerCase();
    return !normalized || normalized === 'n/a' || normalized === 'na' || normalized === 'none';
  };
  const name = [v.firstName, v.middleName, v.lastName]
    .filter(Boolean)
    .join(' ');
  if (!isBlankLike(name)) return name.trim();
  if (!isBlankLike(d.bizCard.bizCardName)) return d.bizCard.bizCardName.trim();
  return 'Portfolio';
}

function cleanDisplayValue(value: string | null | undefined): string {
  // Guard: reject non-string primitives and objects (e.g. [object Object]).
  if (value !== null && value !== undefined && typeof value !== 'string') return '';
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  const lower = normalized.toLowerCase();
  if (lower === 'n/a' || lower === 'na' || lower === 'none') return '';
  // Reject serialized object artifacts from upstream mapping.
  if (lower === '[object object]') return '';
  return normalized;
}

function getProfessionalTitle(d: PortfolioData): string {
  return cleanDisplayValue(d.vcard.professionalTitle) || cleanDisplayValue(d.bizCard.occupation);
}

export function buildAddressText(v: PortfolioData['vcard']): string {
  return [
    cleanDisplayValue(v.addressHouseNo),
    cleanDisplayValue(v.addressArea),
    cleanDisplayValue(v.addressBrgy),
    cleanDisplayValue(v.addressCity),
    cleanDisplayValue(v.addressRegion),
    cleanDisplayValue(v.addressZipcode),
  ]
    .filter(Boolean)
    .join(', ');
}

function toHttpUrlIfPossible(rawValue: string): string {
  const value = cleanDisplayValue(rawValue);
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(value)) return `https://${value}`;
  return '';
}


// Replace this placeholder with your real Google Maps Embed API key.
const GOOGLE_MAPS_EMBED_API_KEY = 'YOUR_API_KEY';

export function toMapsHref(rawLink: string, fallbackAddress: string): string {
  const mapValue = cleanDisplayValue(rawLink);
  if (mapValue) {
    const directUrl = toHttpUrlIfPossible(mapValue);
    if (directUrl) return directUrl;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapValue)}`;
  }
  if (!fallbackAddress) return '#';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fallbackAddress)}`;
}

export function isGoogleMapsUrl(rawLink: string): boolean {
  const directUrl = toHttpUrlIfPossible(rawLink);
  if (!directUrl) return false;

  try {
    const parsed = new URL(directUrl);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    if (host === 'maps.app.goo.gl') return true;
    if (host === 'goo.gl' && path.startsWith('/maps')) return true;
    if (host.startsWith('maps.google.')) return true;
    if (host.endsWith('google.com') && path.includes('/maps')) return true;
    if (host.endsWith('google.com') && (parsed.searchParams.has('q') || parsed.searchParams.has('query') || parsed.searchParams.has('destination'))) return true;

    return false;
  } catch {
    return false;
  }
}

export function extractGoogleMapsQuery(rawLink: string): string {
  const mapValue = cleanDisplayValue(rawLink);
  if (!mapValue) return '';

  const directUrl = toHttpUrlIfPossible(mapValue);
  if (!directUrl) return mapValue;

  try {
    const parsed = new URL(directUrl);

    const queryValue =
      parsed.searchParams.get('q')?.trim() ||
      parsed.searchParams.get('query')?.trim() ||
      parsed.searchParams.get('destination')?.trim() ||
      parsed.searchParams.get('ll')?.trim() ||
      parsed.searchParams.get('daddr')?.trim() ||
      '';

    if (queryValue) return queryValue;

    const segments = parsed.pathname.split('/').filter(Boolean);

    const placeIndex = segments.findIndex((segment) => segment.toLowerCase() === 'place');
    if (placeIndex >= 0 && segments[placeIndex + 1]) {
      return decodeURIComponent(segments[placeIndex + 1]).replace(/\+/g, ' ').trim();
    }

    const searchIndex = segments.findIndex((segment) => segment.toLowerCase() === 'search');
    if (searchIndex >= 0 && segments[searchIndex + 1]) {
      return decodeURIComponent(segments[searchIndex + 1]).replace(/\+/g, ' ').trim();
    }

    const coordinateMatch = parsed.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (coordinateMatch) {
      return `${coordinateMatch[1]},${coordinateMatch[2]}`;
    }

    return directUrl;
  } catch {
    return mapValue;
  }
}

export function toEmbedMapsSrc(rawLink: string): string {
  const mapQuery = extractGoogleMapsQuery(rawLink);
  if (!mapQuery) return '';

  const hasRealEmbedApiKey = Boolean(
    cleanDisplayValue(GOOGLE_MAPS_EMBED_API_KEY)
    && GOOGLE_MAPS_EMBED_API_KEY !== 'YOUR_API_KEY'
  );

  if (hasRealEmbedApiKey) {
    return `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(GOOGLE_MAPS_EMBED_API_KEY)}&q=${encodeURIComponent(mapQuery)}`;
  }

  // API-keyless fallback for development/local preview.
  return `https://maps.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed`;
}

function toIntlNumber(raw: string): string {
  return toPortfolioTelHref(raw);
}

export function getInitials(d: PortfolioData): string {
  const v = d.vcard;
  if (v.firstName || v.lastName) {
    return ((v.firstName?.[0] ?? '') + (v.lastName?.[0] ?? '')).toUpperCase();
  }
  return d.bizCard.bizCardName?.slice(0, 2).toUpperCase() ?? 'BB';
}

export function getSocialBg(platform: string): string {
  const p = platform.toLowerCase();
  if (p === 'linkedin') return 'rgba(10,102,194,0.18)';
  if (p === 'facebook') return 'rgba(24,119,242,0.18)';
  if (p === 'instagram') return 'rgba(228,64,95,0.18)';
  if (p === 'youtube') return 'rgba(255,0,0,0.18)';
  if (p === 'twitter' || p === 'x') return 'rgba(29,161,242,0.18)';
  if (p === 'tiktok') return 'rgba(105,201,208,0.18)';
  if (p === 'email') return 'rgba(234,88,12,0.18)';
  if (p === 'phone') return 'rgba(22,163,74,0.18)';
  if (p === 'telephone') return 'rgba(37,99,235,0.18)';
  return 'rgba(255,255,255,0.12)';
}

/** Strips protocol/`www.`/trailing slash so a URL reads as a display label. */
export function formatContactLinkLabel(platform: string, url: string): string {
  const p = String(platform ?? '').trim().toLowerCase();
  const raw = String(url ?? '').trim();
  if (!raw) return '';

  if (p === 'email' || raw.toLowerCase().startsWith('mailto:')) {
    return raw.replace(/^mailto:/i, '').trim();
  }
  if (p === 'phone' || p === 'telephone' || raw.toLowerCase().startsWith('tel:')) {
    return raw.replace(/^tel:/i, '').trim();
  }

  try {
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(normalized);
    const host = parsed.hostname.replace(/^www\./i, '');
    const path = parsed.pathname.replace(/\/+$/, '');
    const query = parsed.search || '';
    const display = `${host}${path === '/' ? '' : path}${query}`;
    return display || raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  } catch {
    return raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  }
}

const CONTACT_PLATFORM_LABELS: Record<string, string> = {
  email: 'Email',
  phone: 'Phone',
  telephone: 'Telephone',
  mobile: 'Mobile',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  instagram: 'Instagram',
  youtube: 'YouTube',
  twitter: 'X / Twitter',
  x: 'X',
  tiktok: 'TikTok',
  website: 'Website',
  github: 'GitHub',
  gitlab: 'GitLab',
  behance: 'Behance',
  dribbble: 'Dribbble',
  medium: 'Medium',
  substack: 'Substack',
  notion: 'Notion',
  calendly: 'Calendly',
  wellfound: 'Wellfound',
  googlescholar: 'Google Scholar',
  researchgate: 'ResearchGate',
  orcid: 'ORCID',
  slack: 'Slack',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  snapchat: 'Snapchat',
  pinterest: 'Pinterest',
  viber: 'Viber',
  discord: 'Discord',
  threads: 'Threads',
  bluesky: 'Bluesky',
  reddit: 'Reddit',
  twitch: 'Twitch',
  spotify: 'Spotify',
  other: 'Other',
};

/** Human-readable network name for a platform key, e.g. `tiktok` -> `TikTok`. */
export function formatContactPlatformLabel(platform: string): string {
  const raw = String(platform ?? '').trim();
  if (!raw) return '';
  const known = CONTACT_PLATFORM_LABELS[raw.toLowerCase()];
  if (known) return known;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** The owner's chosen label style for contact/social links on this portfolio. */
export function resolveContactLinkLabelMode(d: PortfolioData): ContactLinkLabelMode {
  return toContactLinkLabelMode(d.contactLinkLabel);
}

export type ContactLink = {
  platform: string;
  url: string;
  /** Visible text, resolved from the portfolio's label preference. */
  label: string;
  /** Network name, e.g. `Facebook`. */
  platformLabel: string;
  /** Cleaned URL / address, e.g. `www.facebook.com/myaccount`. */
  linkLabel: string;
  /** Contact details show icon+value; socials are icon-only. */
  kind: 'contact' | 'social';
};

export function isContactDetailPlatform(platform: string): boolean {
  return platform === 'email' || platform === 'phone' || platform === 'telephone';
}

/**
 * Label shown beside the icon. Social links return null (icon-only).
 * Contact details always show the raw value (email / phone digits).
 */
export function getContactLinkVisibleLabel(link: ContactLink): string | null {
  if (link.kind === 'social' || !isContactDetailPlatform(link.platform)) return null;
  return (link.linkLabel || link.label || '').trim() || null;
}

/** Accessible name for icon-only socials and labeled contact rows. */
export function getContactLinkAriaLabel(link: ContactLink): string {
  if (link.kind === 'contact' || isContactDetailPlatform(link.platform)) {
    return link.linkLabel || link.label || link.platformLabel;
  }
  return link.platformLabel || link.linkLabel || link.platform;
}

function makeContactLink(
  platform: string,
  url: string,
  linkLabel: string,
  mode: ContactLinkLabelMode,
  kind: 'contact' | 'social',
): ContactLink {
  const platformLabel = formatContactPlatformLabel(platform);
  // Contact details always show the actual email/phone; socials keep preference
  // for aria/title but are rendered icon-only in themes.
  const label =
    kind === 'contact'
      ? linkLabel || platformLabel
      : (mode === 'platform' ? platformLabel : linkLabel) || linkLabel || platformLabel;
  return {
    platform,
    url,
    label,
    platformLabel,
    linkLabel,
    kind,
  };
}

/**
 * Builds the contact link array rendered by every theme. Social links come
 * first so themes that map the array in order show icons above email/phone.
 * Email and phone from the vcard become synthetic entries with
 * `platform: 'email'` / `'phone'` so SocialIcon and getSocialBg treat them
 * like real social links.
 */
export function buildContactLinks(d: PortfolioData): ContactLink[] {
  const v = d.vcard;
  const mode = resolveContactLinkLabelMode(d);
  const links: ContactLink[] = [];

  // Social links first (above email / phone in connect UIs).
  // Dedupe by normalized URL so portfolio never shows the same link twice.
  const uniqueSocials = dedupeSocialLinksByUrl(
    v.socialLinks.filter((sl) => Boolean(sl.url?.trim())),
    (sl) => sl.url,
  );
  for (const sl of uniqueSocials) {
    const url = sl.url.trim();
    const resolvedPlatform = resolveSocialPlatformDefFromLink(sl.platform, url);
    links.push(
      makeContactLink(
        resolvedPlatform.slug,
        url,
        formatContactLinkLabel(resolvedPlatform.slug, url),
        mode,
        'social',
      ),
    );
  }

  if (v.email?.trim()) {
    links.push(makeContactLink('email', `mailto:${v.email.trim()}`, v.email.trim(), mode, 'contact'));
  }
  if (v.alternativeEmail?.trim()) {
    links.push(
      makeContactLink('email', `mailto:${v.alternativeEmail.trim()}`, v.alternativeEmail.trim(), mode, 'contact'),
    );
  }
  if (v.contactNumber?.trim()) {
    const digits = toPortfolioPhoneDigits(v.contactNumber);
    if (digits) {
      const intl = toIntlNumber(digits);
      links.push(makeContactLink('phone', `tel:${intl}`, intl, mode, 'contact'));
    }
  }
  if (v.secondaryNumber?.trim()) {
    const digits = toPortfolioPhoneDigits(v.secondaryNumber);
    if (digits) {
      const intl = toIntlNumber(digits);
      links.push(makeContactLink('phone', `tel:${intl}`, intl, mode, 'contact'));
    }
  }
  if (v.telephoneNumber?.trim()) {
    const digits = toPortfolioPhoneDigits(v.telephoneNumber);
    if (digits) {
      const href = toPortfolioTelHref(digits);
      links.push(makeContactLink('telephone', `tel:${href}`, href, mode, 'contact'));
    }
  }
  if (v.altTelephoneNumber?.trim()) {
    const digits = toPortfolioPhoneDigits(v.altTelephoneNumber);
    if (digits) {
      const href = toPortfolioTelHref(digits);
      links.push(makeContactLink('telephone', `tel:${href}`, href, mode, 'contact'));
    }
  }

  return links;
}

/** Renders contact value text only — social links stay icon-only. */
export function ContactLinkLabel({
  link,
  className,
  style,
}: {
  link: ContactLink;
  className?: string;
  style?: React.CSSProperties;
}) {
  const text = getContactLinkVisibleLabel(link);
  if (!text) return null;
  return (
    <span className={className} style={style}>
      {text}
    </span>
  );
}

const ONTAP_SESSION_ID_KEY = 'ontap_session_id';
const VIEW_TRACK_PREFIX = 'ontap_portfolio_view';
const SAVE_TRACK_PREFIX = 'ontap_contact_save';
const VIEW_DEDUP_MS = 30 * 60 * 1000;
const SAVE_DEDUP_MS = 24 * 60 * 60 * 1000;

function isWithinClientDedupWindow(storageKey: string, windowMs: number): boolean {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return false;
    const trackedAt = Number(raw);
    return Number.isFinite(trackedAt) && Date.now() - trackedAt < windowMs;
  } catch {
    return false;
  }
}

function markClientDedup(storageKey: string): void {
  try {
    sessionStorage.setItem(storageKey, String(Date.now()));
  } catch {
    // Non-blocking — server-side dedup remains the source of truth.
  }
}

function getOrCreateOntapSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    let sessionId = localStorage.getItem(ONTAP_SESSION_ID_KEY)?.trim() ?? '';
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      localStorage.setItem(ONTAP_SESSION_ID_KEY, sessionId);
    }
    return sessionId;
  } catch {
    return null;
  }
}

function buildPortfolioAnalyticsPayload() {
  if (typeof window === 'undefined') {
    return {
      sessionId: null as string | null,
      deviceType: null as string | null,
      browser: null as string | null,
      os: null as string | null,
      referrer: null as string | null,
    };
  }

  const ua = navigator.userAgent;
  let browser: string | null = null;
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';

  let os: string | null = null;
  if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Mac OS/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  return {
    sessionId: getOrCreateOntapSessionId(),
    deviceType: /Mobi|Android/i.test(ua) ? 'mobile' : 'desktop',
    browser,
    os,
    referrer: document.referrer ? document.referrer.slice(0, 512) : null,
  };
}

const RESERVED_PUBLIC_PATH_SEGMENTS = new Set([
  'frontend',
  'superadmin',
  'super-login',
  'api',
  'payment',
  'register',
]);

function normalizePortfolioUri(urlAlias: string): string {
  return urlAlias.trim().replace(/^\/+/, '').toLowerCase();
}

function getActivePortfolioUri(explicitAlias?: string | null): string {
  if (typeof window !== 'undefined') {
    const segment = window.location.pathname.split('/').filter(Boolean)[0] ?? '';
    const fromPath = normalizePortfolioUri(segment);
    if (fromPath && !RESERVED_PUBLIC_PATH_SEGMENTS.has(fromPath)) {
      return fromPath;
    }
  }
  return normalizePortfolioUri(explicitAlias ?? '');
}

function resolvePortfolioUriFromContext(urlAlias?: string | null): string {
  return getActivePortfolioUri(urlAlias);
}

/** Fire-and-forget profile view tracking for public portfolio pages. */
export function trackPortfolioView(urlAlias?: string): void {
  const uri = getActivePortfolioUri(urlAlias);
  if (!uri || typeof window === 'undefined') return;

  const dedupKey = `${VIEW_TRACK_PREFIX}:${uri}`;
  if (isWithinClientDedupWindow(dedupKey, VIEW_DEDUP_MS)) return;
  markClientDedup(dedupKey);

  void fetch(`/api/portfolio/${encodeURIComponent(uri)}/view`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildPortfolioAnalyticsPayload()),
  }).catch(() => {
    // Non-blocking analytics — never interrupt the visitor experience.
  });
}

/** Fire-and-forget contact save tracking when a visitor saves/downloads contact info. */
export function recordContactSave(
  urlAlias?: string,
  saveType: 'vcf' | 'phone' = 'vcf',
): void {
  const uri = getActivePortfolioUri(urlAlias);
  if (!uri || typeof window === 'undefined') return;

  const dedupKey = `${SAVE_TRACK_PREFIX}:${uri}`;
  if (isWithinClientDedupWindow(dedupKey, SAVE_DEDUP_MS)) return;
  markClientDedup(dedupKey);

  void fetch(`/api/portfolio/${encodeURIComponent(uri)}/save-contact`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...buildPortfolioAnalyticsPayload(),
      saveType,
    }),
  }).catch(() => {
    // Non-blocking analytics — never interrupt the visitor experience.
  });
}

export type PortfolioInquiryPayload = {
  name: string;
  email: string;
  message: string;
  subject?: string;
  phone?: string;
  sessionId?: string;
};

export type PortfolioInquiryResult =
  | { ok: true; inquiryId: string; message: string; linkedAccount?: boolean }
  | { ok: false; error: string; errors?: string[] };

function validatePortfolioInquiryClient(payload: PortfolioInquiryPayload): string | null {
  const name = payload.name.trim();
  if (!name) return 'Name is required.';
  if (name.length > 255) return 'Name must not exceed 255 characters.';

  const email = payload.email.trim();
  if (!email) return 'Email is required.';
  if (email.length > 191) return 'Email must not exceed 191 characters.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'A valid email address is required.';

  const message = payload.message.trim();
  if (!message) return 'Message is required.';
  if (message.length < 10) return 'Message must be at least 10 characters.';
  if (message.length > 5000) return 'Message must not exceed 5000 characters.';

  if (payload.subject && payload.subject.trim().length > 255) {
    return 'Subject must not exceed 255 characters.';
  }
  if (payload.phone && payload.phone.trim().length > 50) {
    return 'Phone must not exceed 50 characters.';
  }

  return null;
}

/** Submit a portfolio inquiry to the owner. Session cookie links sender_user_id when logged in. */
export async function submitPortfolioInquiry(
  urlAlias: string | undefined,
  payload: PortfolioInquiryPayload,
): Promise<PortfolioInquiryResult> {
  const uri = getActivePortfolioUri(urlAlias);
  if (!uri) {
    return { ok: false, error: 'Portfolio not found.' };
  }

  const clientError = validatePortfolioInquiryClient(payload);
  if (clientError) {
    return { ok: false, error: clientError, errors: [clientError] };
  }

  try {
    const response = await fetch(`/api/portfolio/${encodeURIComponent(uri)}/inquire`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: payload.name.trim(),
        email: payload.email.trim(),
        message: payload.message.trim(),
        subject: payload.subject?.trim() || undefined,
        phone: payload.phone?.trim() || undefined,
        sessionId: payload.sessionId ?? buildPortfolioAnalyticsPayload().sessionId ?? undefined,
      }),
    });

    const data = await response.json().catch(() => ({} as Record<string, unknown>));

    if (response.status === 201) {
      return {
        ok: true,
        inquiryId: String(data.inquiryId ?? ''),
        message: String(data.message ?? 'Your inquiry has been sent. The portfolio owner will reach out to you.'),
        linkedAccount: data.linkedAccount === true,
      };
    }

    const errors = Array.isArray(data.errors)
      ? data.errors.filter((e: string): e is string => typeof e === 'string')
      : undefined;
    const error = typeof data.error === 'string'
      ? data.error
      : 'Failed to send inquiry. Please try again.';

    return { ok: false, error, errors };
  } catch {
    return { ok: false, error: 'Network error. Please check your connection and try again.' };
  }
}

const EMPTY_INQUIRY_FORM = {
  name: '',
  email: '',
  phone: '',
  subject: '',
  message: '',
};

export function usePortfolioInquiryForm(options: { urlAlias?: string; mini?: boolean }) {
  const { urlAlias, mini = false } = options;
  const [fields, setFields] = useState(EMPTY_INQUIRY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const setField = useCallback((key: keyof typeof EMPTY_INQUIRY_FORM, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
    setFieldError(null);
  }, []);

  const resetForm = useCallback(() => {
    setFields(EMPTY_INQUIRY_FORM);
    setFieldError(null);
  }, []);

  const handleSubmit = useCallback(async (event?: React.FormEvent) => {
    event?.preventDefault();

    if (mini) {
      showToast({ message: 'Inquiry preview only — submit is disabled in editor preview.', type: 'info' });
      return;
    }

    const clientError = validatePortfolioInquiryClient(fields);
    if (clientError) {
      setFieldError(clientError);
      showToast({ message: clientError, type: 'error' });
      return;
    }

    setIsSubmitting(true);
    setFieldError(null);

    try {
      const result = await submitPortfolioInquiry(urlAlias, fields);
      if (result.ok) {
        showToast({
          message: result.message || 'Your inquiry has been sent successfully!',
          type: 'success',
        });
        resetForm();
      } else {
        const message = result.errors?.[0] ?? result.error;
        setFieldError(message);
        showToast({ message, type: 'error' });
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [fields, mini, resetForm, urlAlias]);

  return {
    fields,
    setField,
    handleSubmit,
    isSubmitting,
    fieldError,
    resetForm,
  };
}

export function downloadVCard(d: PortfolioData): void {
  const portfolioUri = resolvePortfolioUriFromContext(d.bizCard.urlAlias);
  if (portfolioUri) recordContactSave(portfolioUri, 'vcf');
  if (portfolioUri && typeof window !== 'undefined') {
    window.location.assign(`/api/public/${encodeURIComponent(portfolioUri)}?download=vcard`);
    return;
  }

  const v = d.showEmail === false
    ? { ...d.vcard, email: '', alternativeEmail: '' }
    : d.vcard;
  const name = getDisplayName(d);
  const phone = v.contactNumber ? toIntlNumber(v.contactNumber) : '';
  const addressText = buildAddressText(v);
  const profileImageUrl = (() => {
    const raw = typeof d.bizCard.profileImage === 'string' ? d.bizCard.profileImage.trim() : '';
    if (!raw) return null;
    const servable = toServableMediaSrc(raw);
    if (servable.startsWith('http')) return servable;
    if (servable.startsWith('/') && typeof window !== 'undefined') {
      return `${window.location.origin}${servable}`;
    }
    return raw.startsWith('http') ? raw : null;
  })();
  function escapeVcf(val: string): string {
    return val.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,');
  }
  const role = getProfessionalTitle(d);
  const socialLines: string[] = [];
  const seenSocialUrls = new Set<string>();
  let socialItem = 1;
  for (const link of v.socialLinks ?? []) {
    const url = String(link.url ?? '').trim();
    if (!url) continue;
    const key = url.toLowerCase();
    if (seenSocialUrls.has(key)) continue;
    seenSocialUrls.add(key);
    const platform = String(link.platform ?? 'Social').trim() || 'Social';
    const type = platform.replace(/[^a-zA-Z0-9_-]+/g, '') || 'Social';
    socialLines.push(`X-SOCIALPROFILE;TYPE=${type}:${escapeVcf(url)}`);
    socialLines.push(`item${socialItem}.URL:${escapeVcf(url)}`);
    socialLines.push(`item${socialItem}.X-ABLabel:${escapeVcf(platform)}`);
    socialItem += 1;
  }
  const vcf = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${escapeVcf(name)}`,
    `N:${escapeVcf(v.lastName ?? '')};${escapeVcf(v.firstName ?? '')};${escapeVcf(v.middleName ?? '')};;`,
    d.bizCard.bizCardName ? `ORG:${escapeVcf(d.bizCard.bizCardName)}` : '',
    role ? `TITLE:${escapeVcf(role)}` : '',
    v.email ? `EMAIL;TYPE=INTERNET:${v.email}` : '',
    phone ? `TEL;TYPE=CELL:${phone}` : '',
    v.alternativeEmail ? `EMAIL;TYPE=INTERNET,ALT:${v.alternativeEmail}` : '',
    v.secondaryNumber ? `TEL;TYPE=CELL:${toIntlNumber(v.secondaryNumber)}` : '',
    v.telephoneNumber ? `TEL;TYPE=WORK,VOICE:${toIntlNumber(v.telephoneNumber)}` : '',
    v.altTelephoneNumber ? `TEL;TYPE=WORK,VOICE:${toIntlNumber(v.altTelephoneNumber)}` : '',
    addressText ? `ADR;TYPE=WORK:;;${escapeVcf(addressText)};;;;` : '',
    profileImageUrl ? `PHOTO;VALUE=URI:${profileImageUrl}` : '',
    ...socialLines,
    'END:VCARD',
  ].filter(Boolean).join('\r\n');
  const blob = new Blob([`${vcf}\r\n`], { type: 'text/vcard;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${v.firstName || d.bizCard.urlAlias || 'contact'}.vcf`;
  a.click();
  URL.revokeObjectURL(url);
}

export type PortfolioViewerSession = {
  checked: boolean;
  isAuthenticated: boolean;
  userId: number | null;
  customUri: string | null;
};

export function usePortfolioViewerSession(): PortfolioViewerSession {
  // Initialize with client-side auth state from localStorage for immediate availability
  // This prevents Connect button flashing in/out while waiting for session API check
  const getInitialSession = useCallback((): PortfolioViewerSession => {
    if (typeof window === 'undefined') {
      return {
        checked: false,
        isAuthenticated: false,
        userId: null,
        customUri: null,
      };
    }
    try {
      const authRaw = localStorage.getItem('authUser');
      if (authRaw) {
        const auth = JSON.parse(authRaw) as Record<string, unknown>;
        // Check if auth object has meaningful data
        const userId = auth.userId || auth.user_id;
        const customUri = auth.customUri || auth.custom_uri;
        
        if (userId || customUri) {
          return {
            checked: true,
            isAuthenticated: true,
            userId: Number(userId) || null,
            customUri: customUri
              ? normalizePortfolioUri(String(customUri))
              : null,
          };
        }
      }
    } catch (err) {
      // fall through to not authenticated
      console.debug('[PortfolioViewerSession] Failed to parse authUser:', err);
    }
    return {
      checked: true,
      isAuthenticated: false,
      userId: null,
      customUri: null,
    };
  }, []);

  const [session, setSession] = useState<PortfolioViewerSession>(getInitialSession());

  const checkSession = useCallback(async () => {
    if (typeof window === 'undefined') return;
    try {
      const res = await apiFetch('/api/auth/session', { 
        cache: 'no-store',
        credentials: 'include' 
      });
      
      // Handle both 200 and 403 - 403 may occur due to infrastructure/WAF rules
      // but we should still check if user is authenticated locally
      if (res.status === 403) {
        // On 403, trust the localStorage auth state we already set initially
        // This ensures Connect button remains visible even if API is blocked
        console.debug('[PortfolioViewerSession] Session check returned 403, trusting localStorage state');
        setSession((prev) => ({ ...prev, checked: true }));
        return;
      }
      
      if (!res.ok) {
        // Other error statuses - try to maintain localStorage state but mark as checked
        console.debug('[PortfolioViewerSession] Session check failed with status', res.status);
        setSession((prev) => ({ ...prev, checked: true }));
        return;
      }
      
      const data = await res.json() as {
        authenticated?: boolean;
        user?: { userId?: number; customUri?: string | null };
      };
      if (data?.authenticated && data?.user) {
        setSession({
          checked: true,
          isAuthenticated: true,
          userId: Number(data.user.userId) || null,
          customUri: data.user.customUri
            ? normalizePortfolioUri(data.user.customUri)
            : null,
        });
      } else {
        setSession({
          checked: true,
          isAuthenticated: false,
          userId: null,
          customUri: null,
        });
      }
    } catch (err) {
      // Network error or other issue - maintain localStorage state
      console.debug('[PortfolioViewerSession] Session check error:', err);
      setSession((prev) => ({ ...prev, checked: true }));
    }
  }, []);

  useEffect(() => {
    void checkSession();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'authUser') void checkSession();
    };
    const onUserSync = () => { void checkSession(); };
    const onFocus = () => { void checkSession(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('ontap:user-sync', onUserSync);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('ontap:user-sync', onUserSync);
      window.removeEventListener('focus', onFocus);
    };
  }, [checkSession]);

  return session;
}

export function isViewingOwnPortfolioUrl(
  urlAlias: string,
  customUri: string | null,
): boolean {
  const pageAlias = normalizePortfolioUri(urlAlias);
  // Make sure both values are normalized for comparison
  const userUri = customUri ? normalizePortfolioUri(customUri) : null;
  if (!pageAlias || !userUri) return false;
  return pageAlias === userUri;
}

export type AssociateRequestResult =
  | { ok: true }
  | { ok: false; code: 'unauthorized' | 'conflict' | 'self' | 'rate_limit' | 'error'; message: string };

export async function sendPortfolioAssociateRequest(
  urlAlias: string,
): Promise<AssociateRequestResult> {
  const uri = normalizePortfolioUri(urlAlias);
  if (!uri) {
    return { ok: false, code: 'error', message: 'Invalid portfolio.' };
  }
  try {
    const res = await apiFetch(`/api/portfolio/${encodeURIComponent(uri)}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relationshipType: 'associate' }),
    });
    const data = await res.json().catch(() => ({})) as { error?: string };
    if (res.status === 201) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('ontap:connections-changed'));
      }
      return { ok: true };
    }
    if (res.status === 401) {
      return {
        ok: false,
        code: 'unauthorized',
        message: data?.error ?? 'Please log in to associate.',
      };
    }
    if (res.status === 409) {
      return {
        ok: false,
        code: 'conflict',
        message: data?.error ?? 'A connection request already exists.',
      };
    }
    if (res.status === 422) {
      return {
        ok: false,
        code: 'self',
        message: data?.error ?? 'You cannot associate with yourself.',
      };
    }
    if (res.status === 429) {
      return {
        ok: false,
        code: 'rate_limit',
        message: data?.error ?? 'Too many requests. Please try again later.',
      };
    }
    return {
      ok: false,
      code: 'error',
      message: data?.error ?? 'Failed to send associate request.',
    };
  } catch {
    return {
      ok: false,
      code: 'error',
      message: 'Failed to send associate request.',
    };
  }
}

export type PortfolioConnectStatus =
  | 'self'
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'blocked'
  | 'none'
  | 'unknown';

/**
 * Server-authoritative lookup of the relationship between the current viewer
 * and a portfolio owner. Used to decide whether the "Associate request" modal
 * should be suppressed (self-view, or an already pending/accepted/blocked request).
 */
export async function fetchPortfolioConnectStatus(
  urlAlias: string,
): Promise<PortfolioConnectStatus> {
  const uri = normalizePortfolioUri(urlAlias);
  if (!uri) return 'unknown';
  try {
    const res = await apiFetch(`/api/portfolio/${encodeURIComponent(uri)}/connection-status`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'include',
    });
    if (!res.ok) return 'unknown';
    const data = (await res.json().catch(() => ({}))) as { status?: string };
    const status = data?.status;
    if (
      status === 'self' ||
      status === 'pending' ||
      status === 'accepted' ||
      status === 'declined' ||
      status === 'blocked' ||
      status === 'none'
    ) {
      return status;
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** An existing request (or self-view) that should keep the connect modal hidden. */
export function isSuppressingConnectStatus(status: PortfolioConnectStatus): boolean {
  return (
    status === 'self' ||
    status === 'pending' ||
    status === 'accepted' ||
    status === 'blocked'
  );
}

/**
 * Resolves the viewer↔owner relationship status on load. When `enabled` is false
 * (guest visitor or self-view already handled by the caller) it resolves
 * immediately as 'none' so guest sign-in prompts are not blocked.
 */
export function usePortfolioConnectStatus({
  urlAlias,
  enabled,
}: {
  urlAlias: string;
  enabled: boolean;
}): { resolved: boolean; status: PortfolioConnectStatus } {
  const [state, setState] = useState<{ resolved: boolean; status: PortfolioConnectStatus }>({
    resolved: !enabled,
    status: 'none',
  });

  useEffect(() => {
    if (!enabled) {
      setState({ resolved: true, status: 'none' });
      return;
    }
    let cancelled = false;
    setState({ resolved: false, status: 'unknown' });
    void fetchPortfolioConnectStatus(urlAlias).then((status) => {
      if (!cancelled) setState({ resolved: true, status });
    });
    return () => {
      cancelled = true;
    };
  }, [urlAlias, enabled]);

  return state;
}

export type PortfolioAssociateButtonProps = {
  urlAlias: string;
  className?: string;
  iconClassName?: string;
  disabledClassName?: string;
  icon?: React.ReactNode;
  label?: string;
  iconOnly?: boolean;
  style?: React.CSSProperties;
};

export function PortfolioAssociateButton({
  urlAlias,
  className = '',
  iconClassName = '',
  disabledClassName = '',
  icon,
  label = 'Associate',
  iconOnly = false,
  style,
}: PortfolioAssociateButtonProps) {
  const { checked, isAuthenticated, customUri } = usePortfolioViewerSession();
  const isThemePreview = useIsThemePreview();
  const chrome = usePortfolioTheme();
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [showConnectDock, setShowConnectDock] = useState(false);
  const isOwnPortfolio = isViewingOwnPortfolioUrl(urlAlias, customUri);

  // Server-authoritative relationship check: hides the modal on self-view or when
  // a request is already pending/accepted/blocked (even across separate visits).
  const { resolved: statusResolved, status: connectStatus } = usePortfolioConnectStatus({
    urlAlias,
    enabled: checked && isAuthenticated && !isOwnPortfolio,
  });
  const isSelfView = connectStatus === 'self';
  const hasActiveRequest = isSuppressingConnectStatus(connectStatus);
  const alreadyHandled = sent || hasActiveRequest;
  const canAutoPrompt =
    !isThemePreview &&
    checked &&
    statusResolved &&
    !isOwnPortfolio &&
    !isSelfView &&
    !alreadyHandled &&
    isAuthenticated;

  useDelayedPortfolioConnectPrompt({
    enabled: canAutoPrompt && !modalOpen && !showConnectDock,
    onOpen: () => setModalOpen(true),
    onMobilePrompt: () => setShowConnectDock(true),
  });

  if (isOwnPortfolio || isSelfView) return null;

  const handleClick = async () => {
    if (loading || alreadyHandled || !checked || !isAuthenticated || !statusResolved) return;
    setLoading(true);
    const result = await sendPortfolioAssociateRequest(urlAlias);
    setLoading(false);
    if (result.ok) {
      setSent(true);
      setModalOpen(false);
      setShowConnectDock(false);
      showToast('Associate request sent successfully.', 'success');
      return;
    }
    if (result.code === 'conflict') {
      setSent(true);
      setModalOpen(false);
      setShowConnectDock(false);
      showToast(result.message, 'info');
      return;
    }
    showToast(result.message, 'error');
  };

  const displayLabel = connectStatus === 'accepted'
    ? 'Connected'
    : alreadyHandled
      ? 'Request Sent'
      : label;
  const isDisabled = !checked || !statusResolved || loading || alreadyHandled;
  const combinedClassName = [className, isDisabled && disabledClassName]
    .filter(Boolean)
    .join(' ');

  return (
    <>
    <button
      type="button"
      onClick={() => {
        if (isThemePreview) return;
        setModalOpen(true);
      }}
      disabled={isDisabled}
      className={combinedClassName || undefined}
      style={style}
      aria-busy={loading}
      aria-label={iconOnly ? displayLabel : undefined}
    >
      {loading ? (
        <InlineLoader />
      ) : (
        icon ?? <UserRoundPlus className={iconClassName || 'h-4 w-4'} />
      )}
      {!iconOnly && displayLabel}
    </button>
    {!isThemePreview && showConnectDock && !modalOpen && canAutoPrompt ? (
      <PortfolioPromptDockButton
        label="Connect?"
        themeId={chrome?.themeId}
        onClick={() => {
          setModalOpen(true);
        }}
        onDismiss={() => setShowConnectDock(false)}
      />
    ) : null}
    {!isThemePreview && (
    <PortfolioConnectModal
      open={modalOpen}
      isAuthenticated={isAuthenticated}
      loading={loading}
      onClose={() => {
        if (!loading) setModalOpen(false);
      }}
      onConfirm={() => { void handleClick(); }}
    />
    )}
    </>
  );
}

/* ─────────────────────────────────────────────
   SUB-COMPONENTS
───────────────────────────────────────────── */

/** Consistent social/contact icon glyph size across portfolio themes. */
export const PORTFOLIO_SOCIAL_ICON_SIZE = 20;
/** Mini/preview card social/contact icon glyph size. */
export const PORTFOLIO_SOCIAL_ICON_SIZE_MINI = 16;

export function SocialIcon({ platform, size = PORTFOLIO_SOCIAL_ICON_SIZE }: { platform: string; size?: number }) {
  const p = platform.toLowerCase().replace(/[\s/_]+/g, '');
  if (p === 'linkedin') return <FaLinkedin size={size} style={{ color: '#0A66C2' }} />;
  if (p === 'facebook') return <FaFacebookF size={size} style={{ color: '#1877F2' }} />;
  if (p === 'instagram') return <FaInstagram size={size} style={{ color: '#E4405F' }} />;
  if (p === 'youtube') return <FaYoutube size={size} style={{ color: '#FF0000' }} />;
  if (p === 'twitter' || p === 'x' || p === 'xtwitter') return <FaXTwitter size={size} style={{ color: '#111111' }} />;
  if (p === 'tiktok') return <FaTiktok size={size} style={{ color: '#69C9D0' }} />;
  if (p === 'github') return <FaGithub size={size} style={{ color: '#24292F' }} />;
  if (p === 'gitlab') return <FaGitlab size={size} style={{ color: '#FC6D26' }} />;
  if (p === 'behance') return <FaBehance size={size} style={{ color: '#1769FF' }} />;
  if (p === 'dribbble') return <FaDribbble size={size} style={{ color: '#EA4C89' }} />;
  if (p === 'medium') return <FaMedium size={size} style={{ color: '#00AB6C' }} />;
  if (p === 'substack') return <SiSubstack size={size} style={{ color: '#FF6719' }} />;
  if (p === 'notion') return <SiNotion size={size} style={{ color: '#000000' }} />;
  if (p === 'calendly') return <SiCalendly size={size} style={{ color: '#006BFF' }} />;
  if (p === 'wellfound' || p === 'angellist') return <SiWellfound size={size} style={{ color: '#000000' }} />;
  if (p === 'googlescholar' || p === 'scholar') return <SiGooglescholar size={size} style={{ color: '#4285F4' }} />;
  if (p === 'researchgate') return <FaResearchgate size={size} style={{ color: '#00CCBB' }} />;
  if (p === 'orcid') return <FaOrcid size={size} style={{ color: '#A6CE39' }} />;
  if (p === 'slack') return <FaSlack size={size} style={{ color: '#4A154B' }} />;
  if (p === 'whatsapp') return <FaWhatsapp size={size} style={{ color: '#25D366' }} />;
  if (p === 'telegram') return <FaTelegram size={size} style={{ color: '#26A5E4' }} />;
  if (p === 'viber') return <FaViber size={size} style={{ color: '#7360F2' }} />;
  if (p === 'discord') return <FaDiscord size={size} style={{ color: '#5865F2' }} />;
  if (p === 'threads') return <FaThreads size={size} style={{ color: '#000000' }} />;
  if (p === 'bluesky' || p === 'bsky') return <SiBluesky size={size} style={{ color: '#1185FE' }} />;
  if (p === 'snapchat') return <FaSnapchat size={size} style={{ color: '#FFFC00' }} />;
  if (p === 'pinterest') return <FaPinterestP size={size} style={{ color: '#E60023' }} />;
  if (p === 'reddit') return <FaRedditAlien size={size} style={{ color: '#FF4500' }} />;
  if (p === 'twitch') return <FaTwitch size={size} style={{ color: '#9146FF' }} />;
  if (p === 'spotify') return <FaSpotify size={size} style={{ color: '#1DB954' }} />;
  if (p === 'email') return <IoMailOpenOutline size={size} style={{ color: '#EA580C' }} />;
  if (p === 'phone') return <FaPhone size={size} style={{ color: '#16A34A' }} />;
  if (p === 'telephone') return <PhoneCall size={size} style={{ color: '#2563EB' }} />;
  if (p === 'website') return <FaGlobe size={size} style={{ color: '#6366F1' }} />;
  if (p === 'other') return <FaLink size={size} style={{ color: '#64748B' }} />;
  return <FaGlobe size={size} style={{ color: '#888' }} />;
}

export type GalleryItem = { src: string; title?: string; description?: string };
export type PDFItem = { id: number; src: string; title?: string; description?: string };
export type VideoGalleryItem = { id: number; src: string; title: string; description: string };
export type ServiceMediaItem = { type: 'image' | 'video'; src: string; title?: string; description?: string };

function isPlayablePortfolioVideoSrc(url: string): boolean {
  const src = String(url ?? '').trim();
  if (!src) return false;
  if (toVideoEmbedUrl(src)) return false;
  return (
    isDirectVideoFileUrl(src) ||
    src.startsWith('/api/media/file/') ||
    (src.startsWith('/') && !src.startsWith('//'))
  );
}

function isDirectVideoFileUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.startsWith('data:video/') ||
    lower.includes('/video/upload/') ||
    // Same-origin R2 proxy paths often keep the original extension.
    (lower.includes('/api/media/file/') &&
      (lower.includes('.mp4') ||
        lower.includes('.mov') ||
        lower.includes('.webm') ||
        lower.includes('.m4v'))) ||
    lower.endsWith('.mp4') ||
    lower.endsWith('.mov') ||
    lower.endsWith('.webm') ||
    lower.endsWith('.m4v') ||
    lower.includes('.mp4?') ||
    lower.includes('.mov?') ||
    lower.includes('.webm?') ||
    lower.includes('.m4v?')
  );
}

function isVideoMimeOrUrl(mimeType: unknown, url: string): boolean {
  const mime = String(mimeType ?? '').toLowerCase();
  if (mime.startsWith('video/')) return true;
  return isDirectVideoFileUrl(url);
}

function isPdfMimeOrUrl(mimeType: unknown, url: string): boolean {
  const mime = String(mimeType ?? '').toLowerCase();
  if (mime === 'application/pdf') return true;
  const urlLower = String(url ?? '').toLowerCase();
  return urlLower.endsWith('.pdf') || urlLower.includes('.pdf?');
}

function toVideoEmbedUrl(rawUrl: string): string {
  const source = String(rawUrl).trim();
  if (!source) return '';

  try {
    const parsed = new URL(source);
    const host = parsed.hostname.toLowerCase();

    if (host.includes('youtube.com')) {
      const id = parsed.searchParams.get('v')?.trim();
      if (id) return `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
      if (parsed.pathname.includes('/embed/')) return source;
    }

    if (host.includes('youtu.be')) {
      const id = parsed.pathname.replace('/', '').trim();
      if (id) return `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
    }

    if (host.includes('vimeo.com')) {
      const id = parsed.pathname.split('/').filter(Boolean)[0] ?? '';
      if (id) return `https://player.vimeo.com/video/${encodeURIComponent(id)}`;
    }

    if (source.includes('/embed/')) return source;

    return '';
  } catch {
    return '';
  }
}

export function buildGalleryItems(d: PortfolioData): GalleryItem[] {
  const items: GalleryItem[] = [];
  for (const item of d.gallery ?? []) {
    if (!item) continue;
    const raw = String(item.url ?? '').trim() || String(item.imageDataUrl ?? '').trim();
    if (!raw) continue;
    const src = toServableMediaSrc(raw);
    // Skip video items — they belong in the Videos section, not the gallery carousel
    if (isVideoMimeOrUrl(item.mimeType, src)) continue;
    // Skip PDF items — they belong in the PDF section
    if (isPdfMimeOrUrl(item.mimeType, src)) continue;
    items.push({
      src,
      title: String(item.title ?? '').trim() || undefined,
      description: String(item.description ?? '').trim() || undefined,
    });
  }
  return items;
}

export function buildPdfItems(d: PortfolioData): PDFItem[] {
  const items: PDFItem[] = [];
  let index = 0;
  for (const item of d.gallery ?? []) {
    if (!item) continue;
    const src = String(item.url ?? '').trim() || String(item.imageDataUrl ?? '').trim();
    if (!src) continue;
    // Only include PDF items
    if (!isPdfMimeOrUrl(item.mimeType, src)) continue;
    items.push({
      id: Number(item.id ?? index + 1),
      src,
      title: String(item.title ?? '').trim() || undefined,
      description: String(item.description ?? '').trim() || undefined,
    });
    index++;
  }
  return items;
}

export function buildVideoItems(d: PortfolioData): VideoGalleryItem[] {
  const directVideos = (d.videos ?? [])
    .map((video, index) => {
      const fileName = String(video.fileName ?? '').trim();
      const dataUrl = String(video.videoDataUrl ?? '').trim();
      const raw =
        fileName ||
        (dataUrl.startsWith('data:') || dataUrl.startsWith('http') || dataUrl.startsWith('/')
          ? dataUrl
          : '');
      if (!raw) return null;
      const src = toServableMediaSrc(raw);
      if (!src) return null;
      // Portfolio `videos` entries are already classified as videos — keep
      // relative media-proxy URLs (`/api/media/file/...`) and http(s) sources.
      if (
        !(
          src.startsWith('http') ||
          src.startsWith('/') ||
          src.startsWith('data:video/') ||
          src.startsWith('blob:')
        )
      ) {
        return null;
      }
      return {
        id: Number(video.id ?? index + 1),
        src,
        title: String(video.title ?? '').trim() || `Video ${index + 1}`,
        description: String(video.description ?? '').trim(),
      };
    })
    .filter((video): video is VideoGalleryItem => video !== null);

  const serviceVideos = (d.services ?? [])
    .filter((service) => Boolean(service.videoUrl?.trim()))
    .map((service, index) => ({
      id: Number(service.id ?? directVideos.length + index + 1),
      src: toServableMediaSrc(String(service.videoUrl).trim()),
      title: String(service.title ?? '').trim() || `Video ${directVideos.length + index + 1}`,
      description: String(service.description ?? service.tagline ?? '').trim(),
    }))
    .filter((video) => Boolean(video.src));

  const galleryVideos = (d.gallery ?? [])
    .filter((item) => {
      if (!item) return false;
      const raw = String(item.url ?? '').trim();
      return isVideoMimeOrUrl(item.mimeType, raw) && raw.length > 0;
    })
    .map((item, index) => ({
      id: Number(item.id ?? directVideos.length + serviceVideos.length + index + 1),
      src: toServableMediaSrc(String(item.url ?? '').trim()),
      title: String(item.title ?? '').trim() || `Video ${directVideos.length + serviceVideos.length + index + 1}`,
      description: String(item.description ?? '').trim(),
    }))
    .filter((video) => Boolean(video.src));

  const merged = [...directVideos, ...serviceVideos, ...galleryVideos];
  const seen = new Set<string>();

  return merged.filter((video) => {
    const key = video.src.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isImageLikeUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.startsWith('data:image/') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.endsWith('.webp') || lower.endsWith('.gif') || lower.endsWith('.avif') || lower.includes('.jpg?') || lower.includes('.jpeg?') || lower.includes('.png?') || lower.includes('.webp?') || lower.includes('.gif?') || lower.includes('.avif?');
}

export function buildServiceMediaItems(service: { featured_image?: string | null; videoUrl?: string; videoFile?: string | null }, fallbackMedia: Array<{ url?: string | null; mimeType?: string | null; title?: string | null; description?: string | null }> = []): ServiceMediaItem[] {
  const videos: ServiceMediaItem[] = [];
  const images: ServiceMediaItem[] = [];
  const seen = new Set<string>();

  const pushUnique = (bucket: ServiceMediaItem[], item: ServiceMediaItem) => {
    const key = `${item.type}:${item.src}`.toLowerCase();
    if (!item.src || seen.has(key)) return;
    seen.add(key);
    bucket.push(item);
  };

  const addVideo = (src: string, title?: string, description?: string) => {
    if (!src) return;
    pushUnique(videos, { type: 'video', src: toServableMediaSrc(src), title, description });
  };

  const addImage = (src: string, title?: string, description?: string) => {
    if (!src) return;
    pushUnique(images, { type: 'image', src: toServableMediaSrc(src), title, description });
  };

  const isUsableVideoSource = (src: string) =>
    Boolean(src) && (isVideoMimeOrUrl('', src) || Boolean(toVideoEmbedUrl(src)));

  const videoFile = String(service.videoFile ?? '').trim();
  if (isUsableVideoSource(videoFile)) addVideo(videoFile, 'Video', '');

  const videoUrl = String(service.videoUrl ?? '').trim();
  if (isUsableVideoSource(videoUrl)) addVideo(videoUrl, 'Video', '');

  for (const media of fallbackMedia) {
    const src = String(media.url ?? '').trim();
    if (!src) continue;
    const type =
      isVideoMimeOrUrl(media.mimeType, src) || Boolean(toVideoEmbedUrl(src))
        ? 'video'
        : 'image';
    if (type === 'video') {
      addVideo(src, String(media.title ?? '').trim() || undefined, String(media.description ?? '').trim() || undefined);
    } else {
      addImage(src, String(media.title ?? '').trim() || undefined, String(media.description ?? '').trim() || undefined);
    }
  }

  const featured = String(service.featured_image ?? '').trim();
  if (featured) {
    const featuredType =
      isVideoMimeOrUrl('', featured) || Boolean(toVideoEmbedUrl(featured))
        ? 'video'
        : 'image';
    if (featuredType === 'video') addVideo(featured);
    else addImage(featured);
  }

  return [...videos, ...images].slice(0, 12);
}

function renderServiceMediaFrame(item: ServiceMediaItem, { controls = true, fill = false }: { controls?: boolean; fill?: boolean } = {}) {
  if (item.type !== 'video') {
    return (
      <img
        src={item.src}
        alt={item.title || 'Service media'}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        className={
          fill
            ? 'h-full w-full object-contain object-center'
            : 'portfolio-lightbox-media'
        }
      />
    );
  }

  const embed = toVideoEmbedUrl(item.src);
  if (embed) {
    return (
      <iframe
        src={embed}
        title={item.title || 'Service video'}
        className="h-full w-full border-0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    );
  }

  if (isDirectVideoFileUrl(item.src) || item.src.startsWith('data:video/')) {
    return (
      <video
        src={item.src}
        controls={controls}
        playsInline
        preload="metadata"
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        className="h-full w-full object-contain object-center bg-black"
      />
    );
  }

  return (
    <a
      href={item.src}
      target="_blank"
      rel="noopener noreferrer"
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      className="flex h-full w-full items-center justify-center bg-black/80 px-4 text-center text-sm font-semibold text-white underline"
    >
      Open video
    </a>
  );
}

const LIGHTBOX_MIN_ZOOM = 1;
const LIGHTBOX_MAX_ZOOM = 4;
const LIGHTBOX_SWIPE_THRESHOLD_PX = 40;

function getTouchDistance(touches: React.TouchList | TouchList) {
  if (touches.length < 2) return 0;
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function isHorizontalSwipe(dx: number, dy: number) {
  return Math.abs(dx) >= LIGHTBOX_SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy) * 1.2;
}

function usePortfolioLightboxZoom(onSwipe?: (direction: 1 | -1) => void) {
  const [stageNode, setStageNode] = useState<HTMLDivElement | null>(null);
  const stageRef = useCallback((node: HTMLDivElement | null) => {
    setStageNode(node);
  }, []);
  const transformRef = useRef({ scale: 1, x: 0, y: 0 });
  const pinchRef = useRef<{ distance: number; scale: number } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const swipeRef = useRef<{ startX: number; startY: number } | null>(null);
  /** Set when a swipe navigates so the overlay click-to-close does not fire immediately after. */
  const suppressClickRef = useRef(false);
  const onSwipeRef = useRef(onSwipe);
  onSwipeRef.current = onSwipe;
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });

  const applyTransform = useCallback((next: { scale: number; x: number; y: number }) => {
    const scale = Math.min(LIGHTBOX_MAX_ZOOM, Math.max(LIGHTBOX_MIN_ZOOM, next.scale));
    const settled =
      scale <= LIGHTBOX_MIN_ZOOM
        ? { scale: LIGHTBOX_MIN_ZOOM, x: 0, y: 0 }
        : { scale, x: next.x, y: next.y };
    transformRef.current = settled;
    setTransform(settled);
  }, []);

  const resetZoom = useCallback(() => {
    applyTransform({ scale: LIGHTBOX_MIN_ZOOM, x: 0, y: 0 });
    pinchRef.current = null;
    panRef.current = null;
    swipeRef.current = null;
  }, [applyTransform]);

  const commitSwipe = useCallback((dx: number, dy: number) => {
    if (
      !onSwipeRef.current ||
      transformRef.current.scale > LIGHTBOX_MIN_ZOOM ||
      !isHorizontalSwipe(dx, dy)
    ) {
      return false;
    }
    // Swipe left → next, swipe right → previous
    onSwipeRef.current(dx < 0 ? 1 : -1);
    suppressClickRef.current = true;
    return true;
  }, []);

  useEffect(() => {
    // Callback ref drives this effect so listeners attach only after the stage is in the DOM
    // (lightbox waits on `mounted` / theme-preview portal readiness).
    const stage = stageNode;
    if (!stage) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const current = transformRef.current;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      applyTransform({
        scale: current.scale * factor,
        x: current.x,
        y: current.y,
      });
    };

    const beginSinglePointer = (clientX: number, clientY: number) => {
      pinchRef.current = null;
      if (transformRef.current.scale > LIGHTBOX_MIN_ZOOM) {
        swipeRef.current = null;
        panRef.current = {
          startX: clientX,
          startY: clientY,
          originX: transformRef.current.x,
          originY: transformRef.current.y,
        };
        return;
      }
      panRef.current = null;
      if (onSwipeRef.current) {
        swipeRef.current = { startX: clientX, startY: clientY };
      }
    };

    const moveSinglePointer = (clientX: number, clientY: number, preventDefault: () => void) => {
      if (panRef.current && transformRef.current.scale > LIGHTBOX_MIN_ZOOM) {
        preventDefault();
        const pan = panRef.current;
        applyTransform({
          scale: transformRef.current.scale,
          x: pan.originX + (clientX - pan.startX),
          y: pan.originY + (clientY - pan.startY),
        });
        return;
      }

      if (
        swipeRef.current &&
        transformRef.current.scale <= LIGHTBOX_MIN_ZOOM &&
        onSwipeRef.current
      ) {
        const dx = clientX - swipeRef.current.startX;
        const dy = clientY - swipeRef.current.startY;
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
          preventDefault();
        }
      }
    };

    const endSinglePointer = (clientX: number, clientY: number) => {
      if (swipeRef.current && transformRef.current.scale <= LIGHTBOX_MIN_ZOOM) {
        commitSwipe(clientX - swipeRef.current.startX, clientY - swipeRef.current.startY);
      }
      swipeRef.current = null;
      if (transformRef.current.scale <= LIGHTBOX_MIN_ZOOM) {
        resetZoom();
        return;
      }
      pinchRef.current = null;
      panRef.current = null;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        panRef.current = null;
        swipeRef.current = null;
        pinchRef.current = {
          distance: getTouchDistance(e.touches),
          scale: transformRef.current.scale,
        };
        return;
      }

      if (e.touches.length !== 1) return;
      beginSinglePointer(e.touches[0].clientX, e.touches[0].clientY);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchRef.current) {
        e.preventDefault();
        const distance = getTouchDistance(e.touches);
        if (distance <= 0 || pinchRef.current.distance <= 0) return;
        applyTransform({
          scale: pinchRef.current.scale * (distance / pinchRef.current.distance),
          x: transformRef.current.x,
          y: transformRef.current.y,
        });
        return;
      }

      if (e.touches.length !== 1) return;
      moveSinglePointer(e.touches[0].clientX, e.touches[0].clientY, () => e.preventDefault());
    };

    const onTouchEnd = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      if (touch) {
        endSinglePointer(touch.clientX, touch.clientY);
        return;
      }
      swipeRef.current = null;
      panRef.current = null;
      pinchRef.current = null;
    };

    // Mouse/pen drag in theme previews & desktop — touch uses the handlers above to avoid double-fire.
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      beginSinglePointer(e.clientX, e.clientY);
      stage.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (!swipeRef.current && !panRef.current) return;
      moveSinglePointer(e.clientX, e.clientY, () => e.preventDefault());
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (!swipeRef.current && !panRef.current) return;
      endSinglePointer(e.clientX, e.clientY);
      if (stage.hasPointerCapture(e.pointerId)) {
        stage.releasePointerCapture(e.pointerId);
      }
    };

    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('touchstart', onTouchStart, { passive: true });
    stage.addEventListener('touchmove', onTouchMove, { passive: false });
    stage.addEventListener('touchend', onTouchEnd, { passive: true });
    stage.addEventListener('touchcancel', onTouchEnd, { passive: true });
    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerup', onPointerUp);
    stage.addEventListener('pointercancel', onPointerUp);

    return () => {
      stage.removeEventListener('wheel', onWheel);
      stage.removeEventListener('touchstart', onTouchStart);
      stage.removeEventListener('touchmove', onTouchMove);
      stage.removeEventListener('touchend', onTouchEnd);
      stage.removeEventListener('touchcancel', onTouchEnd);
      stage.removeEventListener('pointerdown', onPointerDown);
      stage.removeEventListener('pointermove', onPointerMove);
      stage.removeEventListener('pointerup', onPointerUp);
      stage.removeEventListener('pointercancel', onPointerUp);
    };
  }, [applyTransform, commitSwipe, resetZoom, stageNode]);

  const onDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      if (transformRef.current.scale > LIGHTBOX_MIN_ZOOM) {
        resetZoom();
        return;
      }
      applyTransform({ scale: 2, x: 0, y: 0 });
    },
    [applyTransform, resetZoom],
  );

  const consumeSwipeClick = useCallback(() => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }, []);

  return {
    stageRef,
    transform,
    resetZoom,
    onDoubleClick,
    consumeSwipeClick,
  };
}

/**
 * Shared gallery/services lightbox.
 * Portaled to document.body so theme transforms/overflow cannot trap `position:fixed`.
 * In theme preview mounts, portals into ThemePreviewPortalHost so the overlay stays
 * within the live preview frame (phone mockup / editor preview).
 */
function PortfolioMediaLightbox({
  label,
  zIndex = 10100,
  onClose,
  onSwipe,
  mediaKey,
  children,
}: {
  label: string;
  zIndex?: number;
  onClose: () => void;
  /** When provided and more than one media item exists, horizontal swipe changes the item. */
  onSwipe?: (direction: 1 | -1) => void;
  /** Changes when the shown media changes so zoom resets between swipes. */
  mediaKey?: string | number;
  children: React.ReactNode;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);
  const isThemePreview = useIsThemePreview();
  const previewPortal = useThemePreviewPortal();
  const contained = Boolean(isThemePreview && previewPortal);
  const {
    stageRef,
    transform,
    resetZoom,
    onDoubleClick,
    consumeSwipeClick,
  } = usePortfolioLightboxZoom(onSwipe);
  const onSwipeRef = useRef(onSwipe);
  onSwipeRef.current = onSwipe;
  const handleClose = useCallback(() => {
    resetZoom();
    onClose();
  }, [onClose, resetZoom]);
  const handleCloseRef = useRef(handleClose);
  handleCloseRef.current = handleClose;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    resetZoom();
  }, [mediaKey, resetZoom]);

  useLayoutEffect(() => {
    if (!mounted) return;

    const overlay = overlayRef.current;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCloseRef.current();
        return;
      }
      if (!onSwipeRef.current) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onSwipeRef.current(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        onSwipeRef.current(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    closeRef.current?.focus();

    if (contained && previewPortal) {
      const syncViewport = () => {
        if (!overlay) return;
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.setProperty('--lightbox-w', `${previewPortal.clientWidth}px`);
        overlay.style.setProperty('--lightbox-h', `${previewPortal.clientHeight}px`);
      };
      syncViewport();
      const resizeObserver = new ResizeObserver(syncViewport);
      resizeObserver.observe(previewPortal);
      window.addEventListener('resize', syncViewport);

      return () => {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('resize', syncViewport);
        resizeObserver.disconnect();
      };
    }

    const body = document.body;
    const html = document.documentElement;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const previous = {
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyWidth: body.style.width,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      htmlOverflow: html.style.overflow,
    };

    // iOS Safari ignores overflow:hidden on body unless it is also position:fixed.
    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';

    const syncViewport = () => {
      if (!overlay) return;
      const vv = window.visualViewport;
      const width = vv?.width ?? window.innerWidth;
      const height = vv?.height ?? window.innerHeight;
      overlay.style.top = `${vv?.offsetTop ?? 0}px`;
      overlay.style.left = `${vv?.offsetLeft ?? 0}px`;
      overlay.style.width = `${width}px`;
      overlay.style.height = `${height}px`;
      overlay.style.setProperty('--lightbox-w', `${width}px`);
      overlay.style.setProperty('--lightbox-h', `${height}px`);
    };
    syncViewport();
    window.visualViewport?.addEventListener('resize', syncViewport);
    window.visualViewport?.addEventListener('scroll', syncViewport);
    window.addEventListener('resize', syncViewport);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', syncViewport);
      window.visualViewport?.removeEventListener('resize', syncViewport);
      window.visualViewport?.removeEventListener('scroll', syncViewport);
      body.style.overflow = previous.bodyOverflow;
      body.style.position = previous.bodyPosition;
      body.style.top = previous.bodyTop;
      body.style.width = previous.bodyWidth;
      body.style.left = previous.bodyLeft;
      body.style.right = previous.bodyRight;
      html.style.overflow = previous.htmlOverflow;
      window.scrollTo(0, scrollY);
    };
  }, [mounted, contained, previewPortal]);

  const closeBtnClass =
    'portfolio-lightbox-close inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-white/25 bg-black/70 px-3 py-2 text-sm font-semibold text-white shadow-lg backdrop-blur-md transition-all duration-200 hover:scale-105 hover:border-white/50 hover:bg-white hover:text-black active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80';

  const navBtnClass =
    'absolute top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-black/70 text-white shadow-lg backdrop-blur-md transition-all duration-200 hover:scale-105 hover:border-white/50 hover:bg-white hover:text-black active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80';

  if (!mounted || typeof document === 'undefined') return null;
  if (contained && !previewPortal) return null;

  const portalTarget = contained && previewPortal ? previewPortal : document.body;

  return createPortal(
    <div
      ref={overlayRef}
      className={`portfolio-media-lightbox${contained ? ' portfolio-media-lightbox--contained' : ''}`}
      style={{ zIndex }}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={() => {
        if (consumeSwipeClick()) return;
        handleClose();
      }}
    >
      <CspStyle
        dangerouslySetInnerHTML={{
          __html: `
.portfolio-media-lightbox {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: rgba(0,0,0,0.95);
  overscroll-behavior: none;
  isolation: isolate;
  touch-action: none;
}
.portfolio-media-lightbox--contained {
  position: absolute;
  inset: 0;
}
.portfolio-lightbox-close {
  position: absolute;
  top: max(0.75rem, env(safe-area-inset-top, 0px));
  right: max(0.75rem, env(safe-area-inset-right, 0px));
  z-index: 30;
}
.portfolio-media-lightbox-stage {
  position: relative;
  z-index: 0;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  overscroll-behavior: contain;
  touch-action: none;
  cursor: grab;
}
.portfolio-media-lightbox-stage:active {
  cursor: grabbing;
}
.portfolio-media-lightbox-sizer {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-height: 100%;
  min-width: 100%;
  padding: 4.25rem max(1rem, env(safe-area-inset-right, 0px)) max(1.5rem, env(safe-area-inset-bottom, 0px)) max(1rem, env(safe-area-inset-left, 0px));
}
.portfolio-media-lightbox-frame {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  max-width: 100%;
  animation: portfolioScaleIn 0.22s ease both;
}
.portfolio-media-lightbox-zoom {
  display: flex;
  align-items: center;
  justify-content: center;
  transform-origin: center center;
  will-change: transform;
  touch-action: none;
}
.portfolio-lightbox-media {
  display: block;
  width: auto;
  height: auto;
  max-width: min(100%, calc(var(--lightbox-w, 100vw) - 2.5rem));
  max-height: calc(var(--lightbox-h, 100dvh) - 8.5rem);
  object-fit: contain;
  object-position: center;
  border-radius: 0.75rem;
  flex-shrink: 0;
  touch-action: none;
  user-select: none;
  -webkit-user-drag: none;
}
`,
        }}
      />
      <button
        ref={closeRef}
        type="button"
        aria-label="Close image viewer"
        className={closeBtnClass}
        onClick={(e) => {
          e.stopPropagation();
          handleClose();
        }}
      >
        <X className="h-4 w-4" />
        <span>Close</span>
      </button>
      {onSwipe && (
        <>
          <button
            type="button"
            aria-label="Previous image"
            className={`${navBtnClass} left-2`}
            onClick={(e) => {
              e.stopPropagation();
              onSwipe(-1);
            }}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Next image"
            className={`${navBtnClass} right-2`}
            onClick={(e) => {
              e.stopPropagation();
              onSwipe(1);
            }}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}
      <div
        ref={stageRef}
        className="portfolio-media-lightbox-stage"
      >
        <div className="portfolio-media-lightbox-sizer">
          <div
            key={mediaKey}
            className="portfolio-media-lightbox-frame"
            onClick={(e) => {
              consumeSwipeClick();
              e.stopPropagation();
            }}
            onDoubleClick={onDoubleClick}
          >
            <div
              className="portfolio-media-lightbox-zoom"
              style={{
                transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
              }}
            >
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>,
    portalTarget,
  );
}

/** Fullscreen overlay that stays inside ThemePreviewPortalHost during live preview. */
function ThemePreviewContainedOverlay({
  isOpen,
  onClose,
  zIndex = 220,
  className = '',
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  zIndex?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const isThemePreview = useIsThemePreview();
  const previewPortal = useThemePreviewPortal();
  const contained = Boolean(isThemePreview && previewPortal);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen || !mounted || typeof document === 'undefined') return null;
  if (contained && !previewPortal) return null;

  const portalTarget = contained && previewPortal ? previewPortal : document.body;
  const positionClass = contained ? 'absolute inset-0' : 'fixed inset-0';

  return createPortal(
    <div
      className={`${positionClass} flex items-center justify-center bg-black/95 p-4 ${className}`.trim()}
      style={{ zIndex }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      {children}
    </div>,
    portalTarget,
  );
}

/** Hide native scrollbar while keeping overflow scroll/swipe (see globals.css .scrollbar-none). */
export const HIDDEN_SCROLLBAR_CLASS = 'scrollbar-none';

/**
 * Mobile services strip: horizontal swipe through all cards, scrollbar hidden.
 * Desktop keeps the theme's existing layout via desktopClassName.
 */
export function ServicesScrollContainer({
  isMobile,
  mini = false,
  desktopClassName,
  children,
  itemClassName = '',
}: {
  isMobile?: boolean;
  mini?: boolean;
  desktopClassName: string;
  children: React.ReactNode;
  /** Extra classes applied to each mobile item wrapper */
  itemClassName?: string;
}) {
  const useMobileScroll = Boolean(isMobile) && !mini;
  if (!useMobileScroll) {
    return <div className={desktopClassName}>{children}</div>;
  }

  return (
    <div
      className={`flex w-full gap-4 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1 scroll-smooth touch-pan-x ${HIDDEN_SCROLLBAR_CLASS}`}
      style={{ WebkitOverflowScrolling: 'touch', overscrollBehaviorX: 'contain' }}
    >
      {React.Children.map(children, (child) => {
        if (child == null || child === false) return null;
        return (
          <div
            className={`shrink-0 snap-start w-[min(78vw,280px)] max-w-full ${itemClassName}`.trim()}
          >
            {child}
          </div>
        );
      })}
    </div>
  );
}

export function ServiceMediaCarousel({ items, accent, glass, textMuted, mini, variant: _variant }: { items: ServiceMediaItem[]; accent: string; glass: string; textMuted: string; mini: boolean; variant?: string }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);

  const itemCount = items.length;
  const safeIndex = itemCount > 0 ? ((activeIndex % itemCount) + itemCount) % itemCount : 0;
  const current = itemCount > 0 ? (items[safeIndex] ?? items[0]) : null;
  const canNavigate = itemCount > 1;
  const lightboxIndex = lightbox !== null && itemCount > 0 ? ((lightbox % itemCount) + itemCount) % itemCount : null;
  const frameAspect = mini ? 'aspect-video' : 'aspect-4/3';
  const canOpenLightbox = Boolean(!mini && current && current.type === 'image');
  const lightboxImageIndices = items
    .map((item, index) => (item.type === 'image' ? index : -1))
    .filter((index) => index >= 0);
  const canSwipeLightbox = lightboxImageIndices.length > 1;

  const goTo = (index: number) => {
    if (itemCount <= 0) return;
    setActiveIndex((index + itemCount) % itemCount);
  };
  const closeLightbox = useCallback(() => setLightbox(null), []);
  const swipeLightbox = useCallback(
    (direction: 1 | -1) => {
      setLightbox((currentIndex) => {
        if (currentIndex === null) return currentIndex;
        const imageIndices = items
          .map((item, index) => (item.type === 'image' ? index : -1))
          .filter((index) => index >= 0);
        if (imageIndices.length <= 1) return currentIndex;
        const position = imageIndices.indexOf(currentIndex);
        if (position < 0) return currentIndex;
        const nextPosition = (position + direction + imageIndices.length) % imageIndices.length;
        return imageIndices[nextPosition] ?? currentIndex;
      });
    },
    [items],
  );
  const next = () => {
    if (itemCount <= 0) return;
    setActiveIndex((currentIndex) => (currentIndex + 1) % itemCount);
  };
  const prev = () => {
    if (itemCount <= 0) return;
    setActiveIndex((currentIndex) => (currentIndex - 1 + itemCount) % itemCount);
  };

  if (!itemCount || !current) return null;

  return (
    <div className="space-y-2 sm:space-y-3 w-full min-w-0">
      <div
        className={`relative w-full overflow-hidden rounded-2xl border border-white/10 ${frameAspect} ${canOpenLightbox ? 'cursor-zoom-in' : ''}`}
        style={{ backgroundColor: glass }}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        onClick={() => {
          if (canOpenLightbox) setLightbox(safeIndex);
        }}
        role={canOpenLightbox ? 'button' : undefined}
        tabIndex={canOpenLightbox ? 0 : undefined}
        onKeyDown={
          canOpenLightbox
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setLightbox(safeIndex);
                }
              }
            : undefined
        }
        aria-label={canOpenLightbox ? 'View full image' : undefined}
      >
        {renderServiceMediaFrame(current, { controls: !mini, fill: true })}
        {canNavigate && (
          <>
            <button
              type="button"
              aria-label="Previous media"
              onClick={(e) => {
                e.stopPropagation();
                prev();
              }}
              className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/55 p-2 text-white shadow-lg backdrop-blur-sm hover:bg-black/70"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Next media"
              onClick={(e) => {
                e.stopPropagation();
                next();
              }}
              className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/55 p-2 text-white shadow-lg backdrop-blur-sm hover:bg-black/70"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <div className="absolute bottom-2 left-0 right-0 z-10 flex justify-center gap-1.5 px-2">
              {items.map((item, index) => (
                <button
                  key={`${item.src}-dot-${index}`}
                  type="button"
                  aria-label={`Show media ${index + 1}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    goTo(index);
                  }}
                  className={`h-1.5 rounded-full transition-all ${safeIndex === index ? 'w-4' : 'w-1.5'}`}
                  style={{ backgroundColor: safeIndex === index ? accent : 'rgba(255,255,255,0.45)' }}
                />
              ))}
            </div>
          </>
        )}
      </div>
      {!mini && (
        <div className="flex items-center justify-between gap-2 px-0.5">
          {canNavigate ? (
            <p className="text-[11px] font-medium tabular-nums" style={{ color: textMuted }}>
              {safeIndex + 1} / {items.length}
            </p>
          ) : (
            <span />
          )}
          {canOpenLightbox && (
            <button
              type="button"
              onClick={() => setLightbox(safeIndex)}
              className="text-[11px] font-semibold shrink-0"
              style={{ color: accent }}
            >
              View full
            </button>
          )}
        </div>
      )}
      {!mini && lightboxIndex !== null && (
        <PortfolioMediaLightbox
          label="Service image viewer"
          mediaKey={lightboxIndex}
          onClose={closeLightbox}
          onSwipe={canSwipeLightbox ? swipeLightbox : undefined}
        >
          {renderServiceMediaFrame(items[lightboxIndex], { controls: true, fill: false })}
        </PortfolioMediaLightbox>
      )}
    </div>
  );
}

export function useAnimateOnScroll(mini: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(mini);

  useEffect(() => {
    if (mini) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.06, rootMargin: '0px 0px -40px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [mini]);

  return { ref, visible };
}

export function AnimatedSection({
  children,
  delay = 0,
  className = '',
  mini,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  mini: boolean;
}) {
  const { ref, visible } = useAnimateOnScroll(mini);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(28px)',
        transition: mini
          ? 'none'
          : `opacity 0.65s ease ${delay}ms, transform 0.65s ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

interface GalleryCarouselProps {
  items: GalleryItem[];
  accent: string;
  glass: string;
  textMuted: string;
  mini: boolean;
  variant?: string;
}

/**
 * Featured Gallery lightbox with first-class swipe / drag navigation.
 * Separate from PortfolioMediaLightbox so gallery paging is not blocked by zoom listeners.
 * Used by all themes that render GalleryCarousel (including ocean-gradient v1/v2/v3).
 */
function GallerySwipeLightbox({
  items,
  index,
  onNavigate,
  onClose,
  zIndex = 10100,
}: {
  items: GalleryItem[];
  index: number;
  onNavigate: (direction: 1 | -1) => void;
  onClose: () => void;
  zIndex?: number;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);
  const isThemePreview = useIsThemePreview();
  const previewPortal = useThemePreviewPortal();
  const contained = Boolean(isThemePreview && previewPortal);

  const itemCount = items.length;
  const safeIndex = itemCount > 0 ? ((index % itemCount) + itemCount) % itemCount : 0;
  const canNavigate = itemCount > 1;
  const current = itemCount > 0 ? items[safeIndex] : null;

  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
    locked: boolean | null;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const [dragX, setDragX] = useState(0);
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const canNavigateRef = useRef(canNavigate);
  canNavigateRef.current = canNavigate;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setDragX(0);
    dragRef.current = null;
  }, [safeIndex]);

  useLayoutEffect(() => {
    if (!mounted) return;

    const overlay = overlayRef.current;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (!canNavigateRef.current) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onNavigateRef.current(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        onNavigateRef.current(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    closeRef.current?.focus();

    if (contained && previewPortal) {
      const syncViewport = () => {
        if (!overlay) return;
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.setProperty('--lightbox-w', `${previewPortal.clientWidth}px`);
        overlay.style.setProperty('--lightbox-h', `${previewPortal.clientHeight}px`);
      };
      syncViewport();
      const resizeObserver = new ResizeObserver(syncViewport);
      resizeObserver.observe(previewPortal);
      window.addEventListener('resize', syncViewport);
      return () => {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('resize', syncViewport);
        resizeObserver.disconnect();
      };
    }

    const body = document.body;
    const html = document.documentElement;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const previous = {
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyWidth: body.style.width,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      htmlOverflow: html.style.overflow,
    };
    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';

    const syncViewport = () => {
      if (!overlay) return;
      const vv = window.visualViewport;
      const width = vv?.width ?? window.innerWidth;
      const height = vv?.height ?? window.innerHeight;
      overlay.style.top = `${vv?.offsetTop ?? 0}px`;
      overlay.style.left = `${vv?.offsetLeft ?? 0}px`;
      overlay.style.width = `${width}px`;
      overlay.style.height = `${height}px`;
      overlay.style.setProperty('--lightbox-w', `${width}px`);
      overlay.style.setProperty('--lightbox-h', `${height}px`);
    };
    syncViewport();
    window.visualViewport?.addEventListener('resize', syncViewport);
    window.visualViewport?.addEventListener('scroll', syncViewport);
    window.addEventListener('resize', syncViewport);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', syncViewport);
      window.visualViewport?.removeEventListener('resize', syncViewport);
      window.visualViewport?.removeEventListener('scroll', syncViewport);
      body.style.overflow = previous.bodyOverflow;
      body.style.position = previous.bodyPosition;
      body.style.top = previous.bodyTop;
      body.style.width = previous.bodyWidth;
      body.style.left = previous.bodyLeft;
      body.style.right = previous.bodyRight;
      html.style.overflow = previous.htmlOverflow;
      window.scrollTo(0, scrollY);
    };
  }, [mounted, contained, previewPortal]);

  const go = useCallback(
    (direction: 1 | -1) => {
      if (!canNavigate) return;
      onNavigate(direction);
    },
    [canNavigate, onNavigate],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canNavigate || e.button !== 0) return;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      active: true,
      locked: null,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Some browsers reject capture on certain pointer types; swipe still works via bubbling.
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag?.active || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (drag.locked === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      drag.locked = Math.abs(dx) >= Math.abs(dy);
    }
    if (drag.locked !== true) return;
    e.preventDefault();
    setDragX(dx);
  };

  const finishPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag?.active || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const wasHorizontal = drag.locked === true;
    dragRef.current = null;
    setDragX(0);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }
    if (
      wasHorizontal &&
      Math.abs(dx) >= LIGHTBOX_SWIPE_THRESHOLD_PX &&
      Math.abs(dx) > Math.abs(dy) * 1.1
    ) {
      suppressClickRef.current = true;
      go(dx < 0 ? 1 : -1);
    }
  };

  if (!mounted || typeof document === 'undefined' || !current) return null;
  if (contained && !previewPortal) return null;

  const portalTarget = contained && previewPortal ? previewPortal : document.body;

  return createPortal(
    <div
      ref={overlayRef}
      className={`portfolio-media-lightbox${contained ? ' portfolio-media-lightbox--contained' : ''}`}
      style={{ zIndex }}
      role="dialog"
      aria-modal="true"
      aria-label="Gallery image viewer"
      onClick={() => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        onClose();
      }}
    >
      <CspStyle
        dangerouslySetInnerHTML={{
          __html: `
.portfolio-media-lightbox {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: rgba(0,0,0,0.95);
  overscroll-behavior: none;
  isolation: isolate;
  touch-action: none;
}
.portfolio-media-lightbox--contained {
  position: absolute;
  inset: 0;
}
.portfolio-lightbox-close {
  position: absolute;
  top: max(0.75rem, env(safe-area-inset-top, 0px));
  right: max(0.75rem, env(safe-area-inset-right, 0px));
  z-index: 40;
}
.gallery-swipe-stage {
  position: relative;
  z-index: 0;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  overscroll-behavior: contain;
  touch-action: none;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
}
.gallery-swipe-stage:active { cursor: grabbing; }
.gallery-swipe-sizer {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-height: 100%;
  min-width: 100%;
  padding: 4.25rem max(1rem, env(safe-area-inset-right, 0px)) max(3.5rem, env(safe-area-inset-bottom, 0px)) max(1rem, env(safe-area-inset-left, 0px));
}
.gallery-swipe-media {
  display: block;
  width: auto;
  height: auto;
  max-width: min(100%, calc(var(--lightbox-w, 100vw) - 2.5rem));
  max-height: calc(var(--lightbox-h, 100dvh) - 9rem);
  object-fit: contain;
  object-position: center;
  border-radius: 0.75rem;
  flex-shrink: 0;
  pointer-events: none;
  -webkit-user-drag: none;
  user-select: none;
}
.gallery-swipe-counter {
  position: absolute;
  left: 50%;
  bottom: max(1rem, env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  z-index: 30;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.25);
  background: rgba(0,0,0,0.7);
  padding: 0.35rem 0.85rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: #fff;
  backdrop-filter: blur(8px);
  pointer-events: none;
}
`,
        }}
      />
      <button
        ref={closeRef}
        type="button"
        aria-label="Close image viewer"
        className="portfolio-lightbox-close inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-white/25 bg-black/70 px-3 py-2 text-sm font-semibold text-white shadow-lg backdrop-blur-md transition-all duration-200 hover:scale-105 hover:border-white/50 hover:bg-white hover:text-black active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <X className="h-4 w-4" />
        <span>Close</span>
      </button>
      {canNavigate && (
        <div className="gallery-swipe-counter" aria-live="polite">
          {safeIndex + 1} / {itemCount}
        </div>
      )}
      <div
        className="gallery-swipe-stage"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
      >
        <div className="gallery-swipe-sizer">
          <img
            key={`${safeIndex}-${current.src}`}
            src={current.src}
            alt={current.title || 'Gallery image'}
            draggable={false}
            className="gallery-swipe-media"
            style={{
              transform: `translate3d(${dragX}px, 0, 0)`,
              transition: dragX === 0 ? 'transform 0.18s ease' : 'none',
              opacity: Math.max(0.45, 1 - Math.abs(dragX) / 420),
            }}
          />
        </div>
      </div>
    </div>,
    portalTarget,
  );
}

export function GalleryCarousel({ items, accent, glass, textMuted, mini, variant }: GalleryCarouselProps) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const closeLightbox = useCallback(() => setLightbox(null), []);
  const navigateLightbox = useCallback(
    (direction: 1 | -1) => {
      setLightbox((currentIndex) => {
        if (currentIndex === null || items.length <= 1) return currentIndex;
        return (currentIndex + direction + items.length) % items.length;
      });
    },
    [items.length],
  );

  const scrollBy = useCallback((direction: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const amount = Math.max(180, el.clientWidth * 0.8);
    el.scrollBy({ left: direction * amount, behavior: 'smooth' });
  }, []);

  // Per-theme card sizing/shape for distinct poster identity
  const cardWidth = mini
    ? '92px'
    : variant === 'ocean-gradient'
      ? 'min(72vw, 240px)'
      : variant === 'royal-purple'
        ? 'min(60vw, 200px)'
        : 'min(70vw, 220px)';
  const cardAspect = variant === 'royal-purple'
    ? 'aspect-3/4' // portrait magazine style
    : variant === 'ocean-gradient'
      ? 'aspect-4/3'
      : 'aspect-square';
  const cardRadius = variant === 'ocean-gradient' ? 'rounded-3xl' : variant === 'royal-purple' ? 'rounded-2xl' : 'rounded-2xl';

  if (items.length === 0) {
    return (
      <div className={`grid ${mini ? 'grid-cols-3 gap-1.5' : 'grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4'}`}>
        <div
          className={`${mini ? 'aspect-square' : 'aspect-4/3'} rounded-xl border border-white/10`}
          style={{ background: glass }}
        />
        <div
          className={`${mini ? 'aspect-square' : 'aspect-4/3'} rounded-xl border border-white/10 flex flex-col items-center justify-center`}
          style={{ background: `linear-gradient(135deg,${accent}55,${accent}18)`, color: textMuted }}
        >
          <Maximize2 className={`${mini ? 'h-3.5 w-3.5' : 'h-5 w-5'} opacity-70`} />
        </div>
      </div>
    );
  }

  const useSlider = items.length >= 3;
  const lightboxNode =
    lightbox !== null && !mini ? (
      <GallerySwipeLightbox
        items={items}
        index={lightbox}
        onNavigate={navigateLightbox}
        onClose={closeLightbox}
      />
    ) : null;

  if (!useSlider) {
    return (
      <div className="relative">
        <div className={`grid ${mini ? 'grid-cols-2 gap-1.5' : items.length === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'} ${mini ? '' : 'gap-3 sm:gap-4'}`}>
          {items.map((item, index) => (
            <button
              key={`${item.src}-${index}`}
              type="button"
              onClick={() => !mini && setLightbox(index)}
              className={`group relative overflow-hidden ${cardRadius} border border-white/10 text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl ${mini ? '' : 'cursor-zoom-in'}`}
              style={{ backgroundColor: glass }}
              aria-label={mini ? undefined : 'View full image'}
            >
              <div className={`${mini ? 'aspect-square' : cardAspect} overflow-hidden`}>
                <img
                  src={item.src}
                  alt={item.title || 'Gallery'}
                  className="h-full w-full object-contain object-center transition-transform duration-500 group-hover:scale-[1.08]"
                  draggable={false}
                />
              </div>
              {!mini && (
                <>
                  <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/90 via-black/40 to-transparent" />
                  {(item.title || item.description) && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3 text-white">
                      {item.title && <p className="text-sm font-bold leading-tight drop-shadow-md">{item.title}</p>}
                      {item.description && (
                        <p className="text-[11px] mt-0.5 text-white/90 line-clamp-2 drop-shadow">{item.description}</p>
                      )}
                    </div>
                  )}
                  <span className="pointer-events-none absolute right-2.5 top-2.5 rounded-lg bg-black/55 p-1.5 text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <Maximize2 className="h-3.5 w-3.5" />
                  </span>
                </>
              )}
            </button>
          ))}
        </div>
        {lightboxNode}
      </div>
    );
  }

  return (
    <div className="space-y-3 relative">
      <div
        ref={scrollerRef}
        className={`flex ${mini ? 'gap-1.5' : 'gap-3 sm:gap-4'} overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1 scroll-smooth ${HIDDEN_SCROLLBAR_CLASS}`}
      >
        {items.map((item, index) => (
          <button
            key={`${item.src}-${index}`}
            type="button"
            onClick={() => !mini && setLightbox(index)}
            className={`group relative overflow-hidden ${cardRadius} border border-white/10 text-left shrink-0 snap-start transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl ${mini ? '' : 'cursor-zoom-in'}`}
            style={{ backgroundColor: glass, width: cardWidth }}
            aria-label={mini ? undefined : 'View full image'}
          >
            <div className={`${mini ? 'aspect-square' : cardAspect} overflow-hidden`}>
              <img
                src={item.src}
                alt={item.title || 'Gallery'}
                className="h-full w-full object-contain object-center transition-transform duration-500 group-hover:scale-[1.08]"
                draggable={false}
              />
            </div>
            {!mini && (
              <>
                <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/90 via-black/40 to-transparent" />
                {(item.title || item.description) && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3 text-white">
                    {item.title && <p className="text-sm font-bold leading-tight drop-shadow-md">{item.title}</p>}
                    {item.description && (
                      <p className="text-[11px] mt-0.5 text-white/90 line-clamp-2 drop-shadow">{item.description}</p>
                    )}
                  </div>
                )}
                <span className="pointer-events-none absolute right-2.5 top-2.5 rounded-lg bg-black/55 p-1.5 text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                  <Maximize2 className="h-3.5 w-3.5" />
                </span>
              </>
            )}
          </button>
        ))}
      </div>
      {!mini && items.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous"
            onClick={() => scrollBy(-1)}
            className="hidden sm:flex absolute -left-2 top-1/2 -translate-y-1/2 h-9 w-9 items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors shadow-lg"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Next"
            onClick={() => scrollBy(1)}
            className="hidden sm:flex absolute -right-2 top-1/2 -translate-y-1/2 h-9 w-9 items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors shadow-lg"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}
      {lightboxNode}
    </div>
  );
}

interface VideoGridProps {
  items: VideoGalleryItem[];
  accent: string;
  glass: string;
  textMuted: string;
  mini: boolean;
}





export function VideoGrid({ items, accent, glass, textMuted, mini }: VideoGridProps) {
  if (items.length === 0) return null;
  return (
    <div className={`grid ${mini ? 'grid-cols-1 gap-2' : 'grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4'}`}>
      {items.map((item, index) => {
        const nativeVideo = isPlayablePortfolioVideoSrc(item.src);
        const embedVideo = nativeVideo ? '' : toVideoEmbedUrl(item.src);

        return (
          <div
            key={`${item.id}-${item.src}`}
            className="overflow-hidden rounded-2xl border border-white/10"
            style={{ backgroundColor: glass }}
          >
            <div className="aspect-video w-full bg-black">
              {nativeVideo ? (
                <video
                  src={item.src}
                  controls
                  preload="metadata"
                  className="h-full w-full object-cover"
                />
              ) : embedVideo ? (
                <iframe
                  src={embedVideo}
                  title={item.title || `Video ${index + 1}`}
                  className="h-full w-full"
                  allow="autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              ) : (
                <a
                  href={item.src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-full w-full items-center justify-center gap-2 text-sm font-semibold"
                  style={{ color: accent }}
                >
                  <Play className="h-4 w-4" /> Open Video
                </a>
              )}
            </div>
            <div
              className={`${mini ? 'px-2 py-1.5' : 'px-3.5 py-3'}`}
              style={{
                background: `linear-gradient(180deg, ${glass} 0%, color-mix(in srgb, ${glass} 82%, ${accent} 18%) 100%)`,
              }}
            >
              <p className={`${mini ? 'text-[8px]' : 'text-sm'} font-semibold leading-snug`}>{item.title || `Video ${index + 1}`}</p>
              {!mini && item.description && (
                <p className="mt-1 text-xs leading-relaxed" style={{ color: textMuted }}>
                  {item.description}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────
   PDF CAROUSEL (horizontal scroll + click modal)
───────────────────────────────────────────── */
interface PDFCarouselProps {
  items: PDFItem[];
  accent: string;
  glass: string;
  textMuted?: string;
  mini?: boolean;
  variant?: string;
}

export function PDFCarousel({ items, accent, glass, textMuted = '#999999', mini = false, variant = 'default' }: PDFCarouselProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  const scrollBy = useCallback((direction: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const amount = Math.max(180, el.clientWidth * 0.8);
    el.scrollBy({ left: direction * amount, behavior: 'smooth' });
  }, []);

  if (items.length === 0) return null;

  // Per-theme card sizing/shape
  const cardWidth = mini
    ? '92px'
    : variant === 'ocean-gradient'
      ? 'min(72vw, 240px)'
      : variant === 'royal-purple'
        ? 'min(60vw, 200px)'
        : 'min(70vw, 220px)';

  const cardRadius = variant === 'ocean-gradient' ? 'rounded-3xl' : variant === 'royal-purple' ? 'rounded-2xl' : 'rounded-2xl';

  const useSlider = items.length >= 3;

  // Grid layout for fewer than 3 items
  if (!useSlider) {
    return (
      <div className="relative">
        <div className={`grid ${mini ? 'grid-cols-2 gap-1.5' : items.length === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'} ${mini ? '' : 'gap-3 sm:gap-4'}`}>
          {items.map((item) => (
            <PDFGalleryItem
              key={`pdf-${item.id}`}
              id={item.id}
              url={item.src}
              title={item.title}
              description={item.description}
              cardRadius={cardRadius}
              glass={glass}
              textMuted={textMuted}
              accent={accent}
              mini={mini}
              variant={variant}
            />
          ))}
        </div>
      </div>
    );
  }

  // Slider layout for 3+ items
  return (
    <div className="relative">
      <div
        ref={scrollerRef}
        className={`flex ${mini ? 'gap-1.5' : 'gap-3 sm:gap-4'} overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1 scroll-smooth ${HIDDEN_SCROLLBAR_CLASS}`}
      >
        {items.map((item) => (
          <div key={`pdf-${item.id}`} style={{ width: cardWidth }} className="shrink-0 snap-start">
            <PDFGalleryItem
              id={item.id}
              url={item.src}
              title={item.title}
              description={item.description}
              cardRadius={cardRadius}
              glass={glass}
              textMuted={textMuted}
              accent={accent}
              mini={mini}
              variant={variant}
            />
          </div>
        ))}
      </div>
      {items.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous PDF"
            onClick={() => scrollBy(-1)}
            className="hidden sm:flex absolute -left-2 top-1/2 -translate-y-1/2 h-9 w-9 items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors shadow-lg"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Next PDF"
            onClick={() => scrollBy(1)}
            className="hidden sm:flex absolute -right-2 top-1/2 -translate-y-1/2 h-9 w-9 items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors shadow-lg"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   VIDEO CAROUSEL (horizontal scroll + click modal)
───────────────────────────────────────────── */
interface VideoCarouselProps {
  items: VideoGalleryItem[];
  accent: string;
  glass: string;
  textMuted: string;
  mini: boolean;
  variant?: string;
}

export function VideoCarousel({ items, accent, glass, textMuted, mini, variant }: VideoCarouselProps) {
  const [active, setActive] = useState<number | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const scrollBy = useCallback((direction: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const amount = Math.max(220, el.clientWidth * 0.85);
    el.scrollBy({ left: direction * amount, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (active === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActive(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active]);

  if (items.length === 0) return null;
  if (mini) {
    return <VideoGrid items={items} accent={accent} glass={glass} textMuted={textMuted} mini={mini} />;
  }

  const cardWidth = variant === 'royal-purple' ? 'min(80vw, 300px)' : 'min(85vw, 320px)';
  const cardRadius = variant === 'ocean-gradient' ? 'rounded-3xl' : 'rounded-2xl';
  const activeItem = active !== null ? items[active] : null;
  const activeEmbed = activeItem ? toVideoEmbedUrl(activeItem.src) : '';
  const activeNative = activeItem
    ? !activeEmbed &&
      (isDirectVideoFileUrl(activeItem.src) ||
        activeItem.src.startsWith('/api/media/file/') ||
        activeItem.src.startsWith('/'))
    : false;

  return (
    <div className="relative">
      <div
        ref={scrollerRef}
        className="flex gap-3 sm:gap-4 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1 scroll-smooth scrollbar-none"
      >
        {items.map((item, index) => (
          <button
            key={`${item.id}-${item.src}`}
            type="button"
            onClick={() => setActive(index)}
            className={`group relative overflow-hidden ${cardRadius} border border-white/10 text-left shrink-0 snap-start transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl`}
            style={{ backgroundColor: glass, width: cardWidth }}
          >
            <div className="aspect-video w-full bg-black overflow-hidden relative">
              {isPlayablePortfolioVideoSrc(item.src) ? (
                <video
                  src={item.src}
                  preload="metadata"
                  muted
                  playsInline
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
                />
              ) : (
                <div className="h-full w-full" style={{ background: `linear-gradient(135deg, ${accent}55, ${accent}15)` }} />
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/25 group-hover:bg-black/15 transition-colors">
                <span
                  className="h-12 w-12 rounded-full flex items-center justify-center shadow-xl backdrop-blur-sm transition-transform duration-300 group-hover:scale-110"
                  style={{ backgroundColor: 'rgba(255,255,255,0.85)' }}
                >
                  <Play className="h-5 w-5 ml-0.5" style={{ color: '#111' }} />
                </span>
              </div>
            </div>
            <div
              className="px-3.5 py-3 relative"
              style={{
                background: `linear-gradient(180deg, ${glass} 0%, color-mix(in srgb, ${glass} 82%, ${accent} 18%) 100%)`,
              }}
            >
              <p className="text-sm font-semibold leading-snug">{item.title || `Video ${index + 1}`}</p>
              {item.description && (
                <p className="mt-1 text-xs leading-relaxed line-clamp-2" style={{ color: textMuted }}>
                  {item.description}
                </p>
              )}
            </div>
          </button>
        ))}
      </div>
      {items.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous video"
            onClick={() => scrollBy(-1)}
            className="hidden sm:flex absolute -left-2 top-1/2 -translate-y-1/2 h-9 w-9 items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors shadow-lg"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Next video"
            onClick={() => scrollBy(1)}
            className="hidden sm:flex absolute -right-2 top-1/2 -translate-y-1/2 h-9 w-9 items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors shadow-lg"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}

      {activeItem && (
        <ThemePreviewContainedOverlay
          isOpen={Boolean(activeItem)}
          onClose={() => setActive(null)}
          zIndex={220}
        >
          <button
            className="absolute top-4 right-4 bg-white/20 rounded-full p-2.5 hover:bg-white/30 transition-colors"
            onClick={() => setActive(null)}
            aria-label="Close video"
          >
            <X className="h-5 w-5 text-white" />
          </button>
          <div className="max-w-4xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="aspect-video w-full bg-black rounded-2xl overflow-hidden">
              {activeNative ? (
                <video src={activeItem.src} controls autoPlay className="h-full w-full" />
              ) : activeEmbed ? (
                <iframe
                  src={activeEmbed}
                  title={activeItem.title}
                  className="h-full w-full"
                  allow="autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              ) : (
                <a
                  href={activeItem.src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-full w-full items-center justify-center gap-2 text-sm font-semibold"
                  style={{ color: accent }}
                >
                  <Play className="h-4 w-4" /> Open Video
                </a>
              )}
            </div>
            <p className="mt-3 text-center text-sm font-semibold text-white">{activeItem.title}</p>
            {activeItem.description && (
              <p className="mt-1 text-center text-xs" style={{ color: textMuted }}>{activeItem.description}</p>
            )}
          </div>
        </ThemePreviewContainedOverlay>
      )}
    </div>
  );
}

/** Parse #rgb / #rrggbb into channels; null if invalid. */
function parseAccentHex(hex: string): { r: number; g: number; b: number } | null {
  const raw = hex.trim().replace('#', '');
  const full =
    raw.length === 3
      ? raw.split('').map((ch) => `${ch}${ch}`).join('')
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

/** Black or white icon/label color for readable contrast on an accent fill. */
function contrastOnAccentFill(hex: string): '#0a0a0a' | '#ffffff' {
  const rgb = parseAccentHex(hex);
  if (!rgb) return '#ffffff';
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luminance > 0.55 ? '#0a0a0a' : '#ffffff';
}

/** Mix accent toward white (amount > 0) or black (amount < 0) for related FAB shades. */
function shadeAccent(hex: string, amount: number): string {
  const rgb = parseAccentHex(hex);
  if (!rgb) return hex;
  const target = amount > 0 ? 255 : 0;
  const t = Math.min(1, Math.abs(amount));
  const mix = (c: number) => Math.round(c + (target - c) * t);
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(mix(rgb.r))}${toHex(mix(rgb.g))}${toHex(mix(rgb.b))}`;
}

export function FloatingContactWidget({ data, accent, qrUrl }: { data: PortfolioData; accent: string; qrUrl?: string }) {
  const [open, setOpen] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [copied, setCopied] = useState(false);
  const [associateLoading, setAssociateLoading] = useState(false);
  const [associateSent, setAssociateSent] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { checked, isAuthenticated, customUri } = usePortfolioViewerSession();
  const portfolioAlias = data.bizCard.urlAlias ?? '';
  const isOwnPortfolio = isViewingOwnPortfolioUrl(portfolioAlias, customUri);
  const { resolved: statusResolved, status: connectStatus } = usePortfolioConnectStatus({
    urlAlias: portfolioAlias,
    enabled: checked && isAuthenticated && !isOwnPortfolio,
  });
  const associateAlreadyHandled =
    associateSent || isSuppressingConnectStatus(connectStatus);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);
  const displayName = getDisplayName(data);
  const showAssociate =
    checked &&
    isAuthenticated &&
    Boolean(portfolioAlias) &&
    !isOwnPortfolio &&
    connectStatus !== 'self';

  // Theme-derived FAB action colors (variants of accent) with readable icon contrast
  const fabQrBg = accent;
  const fabSaveBg = shadeAccent(accent, 0.22);
  const fabShareBg = shadeAccent(accent, -0.14);
  const fabAssociateBg = shadeAccent(accent, 0.36);
  const fabQrFg = contrastOnAccentFill(fabQrBg);
  const fabSaveFg = contrastOnAccentFill(fabSaveBg);
  const fabShareFg = contrastOnAccentFill(fabShareBg);
  const fabAssociateFg = contrastOnAccentFill(fabAssociateBg);

  const handleAssociate = async () => {
    if (associateLoading || associateAlreadyHandled || !portfolioAlias || !statusResolved) return;
    setAssociateLoading(true);
    const result = await sendPortfolioAssociateRequest(portfolioAlias);
    setAssociateLoading(false);
    if (result.ok) {
      setAssociateSent(true);
      showToast('Associate request sent successfully.', 'success');
      setOpen(false);
      return;
    }
    if (result.code === 'conflict') {
      setAssociateSent(true);
      showToast(result.message, 'info');
      setOpen(false);
      return;
    }
    showToast(result.message, 'error');
  };

  const handleShare = async () => {
    const url = typeof window !== 'undefined' ? `${window.location.origin}/${data.bizCard.urlAlias}` : '';
    try {
      if (navigator.share) {
        await navigator.share({ title: displayName, url });
      } else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2200);
      }
    } catch { /* cancelled */ }
    setOpen(false);
  };

  const actions = [
    {
      icon: <QrCode className="h-5 w-5" style={{ color: fabQrFg }} />,
      label: 'Download QR',
      bg: fabQrBg,
      onClick: () => { setShowQR(true); setOpen(false); },
    },
    {
      icon: <Download className="h-5 w-5" style={{ color: fabSaveFg }} />,
      label: 'Save Contact',
      bg: fabSaveBg,
      onClick: () => { downloadVCard(data); setOpen(false); },
    },
    {
      icon: <Share2 className="h-5 w-5" style={{ color: fabShareFg }} />,
      label: copied ? 'Copied!' : 'Share',
      bg: fabShareBg,
      onClick: handleShare,
    },
    ...(showAssociate
      ? [{
          icon: associateLoading
            ? <InlineLoader />
            : <UserRoundPlus className="h-5 w-5" style={{ color: fabAssociateFg }} />,
          label: connectStatus === 'accepted'
            ? 'Connected'
            : associateAlreadyHandled
              ? 'Request Sent'
              : 'Associate',
          bg: fabAssociateBg,
          onClick: associateAlreadyHandled || !statusResolved
            ? () => undefined
            : () => { void handleAssociate(); },
        }]
      : []),
  ];

  if (!mounted || typeof document === 'undefined') return null;

  return createPortal(
    <>
      {showQR && (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
          style={{ zIndex: 10050 }}
          onClick={() => setShowQR(false)}
        >
          <div
            className="bg-white rounded-3xl p-8 max-w-xs w-full text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            style={{ animation: 'portfolioScaleIn 0.3s ease both' }}
          >
            <h3 className="text-lg font-bold text-gray-900 mb-0.5">{displayName}</h3>
            <p className="text-sm text-gray-500 mb-5">{data.bizCard.bizCardName}</p>
            <div className="flex justify-center mb-4">
              <div className="bg-gray-50 rounded-2xl p-4">
                {qrUrl ? <img src={qrUrl} alt="QR Code" style={{ width: 130, height: 130, display: 'block' }} /> : <QrCode style={{ width: 130, height: 130, color: '#111' }} /> }
              </div>
            </div>
            <p className="text-xs text-gray-400 font-mono mb-5">ontap.ph/{data.bizCard.urlAlias}</p>
            <div className="flex gap-2">
              <button
                onClick={() => downloadVCard(data)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5"
                style={{ backgroundColor: accent, color: contrastOnAccentFill(accent) }}
              >
                <Download className="h-4 w-4" /> Save
              </button>
              <button
                onClick={() => setShowQR(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      <div
        className="fixed bottom-6 right-6 flex flex-col items-end gap-3"
        style={{ zIndex: 10000 }}
      >
        {actions.map((action, i) => (
          <div
            key={i}
            className="flex items-center gap-2"
            style={{
              opacity: open ? 1 : 0,
              transform: open ? 'translateY(0) scale(1)' : 'translateY(14px) scale(0.8)',
              transition: `opacity 0.25s ease ${open ? i * 55 : (actions.length - 1 - i) * 45}ms, transform 0.25s ease ${open ? i * 55 : (actions.length - 1 - i) * 45}ms`,
              pointerEvents: open ? 'auto' : 'none',
            }}
          >
            <span className="bg-white text-gray-800 text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg whitespace-nowrap">
              {action.label}
            </span>
            <button
              onClick={action.onClick}
              className="h-11 w-11 rounded-full flex items-center justify-center shadow-xl active:scale-95 transition-transform"
              style={{ backgroundColor: action.bg }}
            >
              {action.icon}
            </button>
          </div>
        ))}
        <div className="relative">
          {!open && (
            <>
              <div className="absolute inset-0 rounded-full animate-fab-pulse" style={{ backgroundColor: accent }} />
              <div className="absolute inset-0 rounded-full animate-fab-pulse" style={{ backgroundColor: accent, animationDelay: '0.8s' }} />
            </>
          )}
          <button
            onClick={() => setOpen((o) => !o)}
            className="relative h-14 w-14 rounded-full flex items-center justify-center shadow-2xl active:scale-95"
            style={{
              backgroundColor: accent,
              color: contrastOnAccentFill(accent),
              transform: open ? 'rotate(45deg)' : 'rotate(0deg)',
              transition: 'transform 0.3s cubic-bezier(0.34,1.56,0.64,1)',
            }}
          >
            {open ? <X className="h-6 w-6" /> : <PhoneCall className="h-6 w-6" />}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

export const sectionClass = 'rounded-2xl backdrop-blur-md border border-white/10';
export interface BasePortfolioProps extends PortfolioViewProps {
  themeDef: ThemeDef;
}
export function BasePortfolio({ themeDef: t, data, mini = false, showFAB = false }: BasePortfolioProps) {
  const d = resolvePortfolioData(data);
  const variant = t.id;
  const displayName = getDisplayName(d);
  const professionalTitle = getProfessionalTitle(d);
  const bizcardLabel = cleanDisplayValue(d.bizCard.bizCardName);
  const showBizcardLabel = Boolean(
    bizcardLabel && bizcardLabel.toLowerCase() !== displayName.trim().toLowerCase()
  );
  const initials = getInitials(d);
  const galleryItems = buildGalleryItems(d);
  const videoItems = buildVideoItems(d);

  const normaliseUrl = (raw: string): string => raw.trim().toLowerCase().split('?')[0];
  const galleryVideoUrlSet = new Set<string>([
    ...galleryItems.map((g) => normaliseUrl(g.src)),
    ...videoItems.map((v) => normaliseUrl(v.src)),
  ].filter(Boolean));
  const sanitisedServices = (d.services ?? []).map((service) => {
    const featured = String(service.featured_image ?? '').trim();
    if (!featured) return service;
    if (galleryVideoUrlSet.has(normaliseUrl(featured))) {
      return { ...service, featured_image: null };
    }
    return service;
  });
  const shareUrl = (typeof window !== 'undefined' && window.location?.origin && d.bizCard.urlAlias)
    ? `${window.location.origin}/${String(d.bizCard.urlAlias).trim().replace(/^\/+/, '')}`
    : '';
  const qrImageUrl = shareUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=280x280&ecc=H&data=${encodeURIComponent(shareUrl)}`
    : '';
  const { cardRef, qrDataUrl, download: downloadQRCard, isDownloading } = useQRCardDownload(d, shareUrl);
  const qrCardStyle = toQRCardStyle({
    cardBg: t.cardBg,
    text: t.text,
    textMuted: t.textMuted,
    accent: t.accent,
    gradient: t.gradient,
    headerGrad: t.headerGradient,
  });
  const p = mini ? 'p-3' : 'p-5 sm:p-6';
  const heroHeight = mini ? '84px' : 'clamp(190px, 28vw, 260px)';
  const avatarSize = mini ? '0px' : 'clamp(110px, 14vw, 156px)';

  return (
    <div
      className={`${THEME_TEXT_WRAP_CLASS} w-full relative`}
      style={{ background: t.bg, color: t.text, fontFamily: 'inherit', minHeight: mini ? 'auto' : '100vh' }}
    >
      <CspStyle dangerouslySetInnerHTML={{ __html: THEME_TEXT_WRAP_CSS }} />
      {/* BG pattern */}
      <div
        className="absolute inset-0 pointer-events-none overflow-hidden"
        style={{ backgroundImage: t.pattern, opacity: 0.7, zIndex: 0 }}
      />

      {/* Geometric accent circles */}
      {!mini && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 0 }}>
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full opacity-5"
              style={{
                width: `${160 + i * 90}px`,
                height: `${160 + i * 90}px`,
                border: `2px solid ${t.accent}`,
                top: `${(i * 19 + 5) % 85}%`,
                left: `${(i * 25 + 8) % 88}%`,
                transform: `rotate(${i * 33}deg)`,
              }}
            />
          ))}
        </div>
      )}
      <div className="relative" style={{ zIndex: 1 }}>
        {/* ══ COVER HERO ══ */}
        <div className="relative">
          {d.showCoverPhoto !== false && d.bizCard.coverImage && isCoverVideo(d.bizCard.coverImage, d.bizCard.coverType) ? (
            <div className="relative w-full overflow-hidden" style={{ height: heroHeight }}>
              <video
                src={toServableMediaSrc(d.bizCard.coverImage)}
                className="absolute inset-0 h-full w-full object-cover"
                style={{ objectPosition: d.bizCard.coverImagePosition ?? 'center' }}
                muted
                autoPlay
                loop
                playsInline
              />
            </div>
          ) : d.showCoverPhoto !== false && d.bizCard.coverImage && (d.bizCard.coverType?.startsWith('image/') || !d.bizCard.coverType || inferCoverTypeFromUrl(d.bizCard.coverImage)?.startsWith('image/')) ? (
            <img
              src={toServableMediaSrc(d.bizCard.coverImage)}
              alt="Cover"
              width={1200}
              height={640}
              className="w-full object-cover"
              style={{ height: heroHeight, objectPosition: d.bizCard.coverImagePosition ?? 'center' }}
              draggable={false}
              decoding="async"
              fetchPriority="high"
            />
          ) : (
            <div style={{ height: heroHeight, background: t.headerGradient }} />
          )}
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom,transparent 25%,rgba(0,0,0,0.5) 100%)' }} />
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-3">
            <div className="flex items-center gap-2">
              <div
                className={`${mini ? 'h-6 w-6 text-[9px]' : 'h-9 w-9 text-xs'} rounded-lg flex items-center justify-center font-bold`}
                style={{ backgroundColor: t.accentSoft, color: t.accent }}
              >
                OT
              </div>
              {!mini && (
                <span className="text-white font-bold text-sm tracking-wider" style={{ opacity: 0.85 }}>
                  OnTap
                </span>
              )}
            </div>
            {d.bizCard.coverType === 'application/pdf' && !mini && (
              <span className="text-xs font-semibold px-2 py-1 rounded-full" style={{ backgroundColor: t.accentSoft, color: t.accent }}>
                PDF Cover
              </span>
            )}
          </div>

          {!mini && (
            <div className="absolute inset-x-0 bottom-0 translate-y-1/2 flex justify-center pointer-events-none z-20">
              <div
                className="rounded-full border-4 overflow-hidden flex items-center justify-center text-2xl font-bold shadow-2xl"
                style={{ borderColor: t.accent, background: t.cardBg, width: avatarSize, height: avatarSize }}
              >
                {d.bizCard.profileImage ? (
                  <img
                    src={toServableMediaSrc(d.bizCard.profileImage)}
                    alt="Profile"
                    width={160}
                    height={160}
                    className="w-full h-full object-cover object-center"
                    draggable={false}
                    decoding="async"
                    fetchPriority="high"
                  />
                ) : (
                  <span style={{ color: t.accent }}>{initials}</span>
                )}
              </div>
            </div>
          )}
        </div>

        {!mini && <div style={{ height: 'clamp(84px, 10vw, 124px)' }} />}

        {/* ══ CONTENT ══ */}
        <div
          className={`${mini ? 'px-3' : 'px-4 sm:px-6'} space-y-4 pb-24`}
          style={{ maxWidth: mini ? undefined : '640px', margin: mini ? undefined : '0 auto' }}
        >

          {/* Profile Card */}
          <AnimatedSection delay={0} mini={mini}>
            <div className={`${sectionClass} ${p}`} style={{ backgroundColor: t.cardBg }}>
              {mini ? (
                <div className="flex items-center gap-2.5">
                  <div
                    className="h-9 w-9 rounded-full border-2 overflow-hidden flex items-center justify-center text-xs font-bold shrink-0"
                    style={{ borderColor: t.accent, background: t.glass }}
                  >
                    {d.bizCard.profileImage ? (
                      <img
                        src={toServableMediaSrc(d.bizCard.profileImage)}
                        alt=""
                        width={36}
                        height={36}
                        className="w-full h-full object-cover object-center"
                        draggable={false}
                        decoding="async"
                      />
                    ) : (
                      <span style={{ color: t.accent }}>{initials}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold truncate">{displayName}</p>
                    <p className="text-[8px] truncate mt-0.5" style={{ color: t.textMuted }}>
                      {[showBizcardLabel ? bizcardLabel : '', professionalTitle].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </div>
              ) : variant === 'royal-purple' ? (
                /* royal-purple: magazine-style left-aligned profile */
                <div className="text-left">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.3em] mb-2" style={{ color: t.accent }}>
                    Portfolio
                  </p>
                  <h1 className="text-2xl sm:text-3xl font-extrabold leading-tight tracking-tight">
                    {displayName}
                  </h1>
                  {showBizcardLabel && (
                    <p className="text-sm font-semibold mt-1" style={{ color: t.accent }}>{bizcardLabel}</p>
                  )}
                  {professionalTitle && (
                    <p className="text-xs mt-1 italic" style={{ color: t.textMuted }}>{professionalTitle}boss</p>
                  )}
                  {(d.vcard.about || d.bizCard.description) && (
                    <>
                      <div className="my-4 h-0.5 w-12 rounded-full" style={{ backgroundColor: t.accent }} />
                      <p className="text-sm leading-relaxed" style={{ color: t.textMuted }}>
                        <RichText html={d.vcard.about || d.bizCard.description} />
                      </p>
                    </>
                  )}
                  <div className="flex justify-center gap-2 mt-5">
                    <button
                      onClick={() => downloadVCard(d)}
                      className="flex items-center gap-1.5 text-xs font-semibold px-5 py-2.5 rounded-full transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg"
                      style={{ backgroundColor: t.accent, color: '#ffffff', boxShadow: `0 8px 22px -8px ${t.accent}` }}
                    >
                      <Download className="h-3.5 w-3.5" /> Save Contact
                    </button>
                    <button
                      onClick={async () => {
                        if (typeof window === 'undefined') return;
                        const url = `${window.location.origin}/${d.bizCard.urlAlias}`;
                        if (navigator.share) await navigator.share({ title: displayName, url }).catch(() => {});
                        else await navigator.clipboard.writeText(url).catch(() => {});
                      }}
                      className="flex items-center gap-1.5 text-xs font-semibold px-5 py-2.5 rounded-full transition-all duration-300 hover:-translate-y-0.5"
                      style={{ border: `1.5px solid ${t.accent}`, color: t.accent, backgroundColor: 'transparent' }}
                    >
                      <Share2 className="h-3.5 w-3.5" /> Share
                    </button>
                  </div>
                </div>
              ) : variant === 'ocean-gradient' ? (
                /* ocean-gradient: centered with gradient ring */
                <div className="text-center">
                  <h1
                    className="text-2xl sm:text-3xl font-extrabold leading-tight"
                    style={{
                      backgroundImage: `linear-gradient(135deg, ${t.accent}, #ffffff)`,
                      WebkitBackgroundClip: 'text',
                      backgroundClip: 'text',
                      color: 'transparent',
                    }}
                  >
                    {displayName}
                  </h1>
                  {showBizcardLabel && (
                    <p className="text-sm font-semibold mt-1" style={{ color: t.accent }}>{bizcardLabel}</p>
                  )}
                  {professionalTitle && (
                    <span
                      className="inline-block mt-2 text-[11px] font-semibold uppercase tracking-widest px-3 py-1 rounded-full"
                      style={{ backgroundColor: t.accentSoft, color: t.accent }}
                    >
                      {professionalTitle}
                    </span>
                  )}
                  {(d.vcard.about || d.bizCard.description) && (
                    <p className="text-sm leading-relaxed mt-4" style={{ color: t.textMuted }}>
                      <RichText html={d.vcard.about || d.bizCard.description} />
                    </p>
                  )}
                  <div className="flex gap-2 justify-center mt-5">
                    <button
                      onClick={() => downloadVCard(d)}
                      className="flex items-center gap-1.5 text-xs font-semibold px-5 py-2.5 rounded-full text-white transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl"
                      style={{ background: `linear-gradient(135deg, ${t.accent}, ${t.accent}cc)` }}
                    >
                      <Download className="h-3.5 w-3.5" /> Save Contact
                    </button>
                    <button
                      onClick={async () => {
                        if (typeof window === 'undefined') return;
                        const url = `${window.location.origin}/${d.bizCard.urlAlias}`;
                        if (navigator.share) await navigator.share({ title: displayName, url }).catch(() => {});
                        else await navigator.clipboard.writeText(url).catch(() => {});
                      }}
                      className="flex items-center gap-1.5 text-xs font-semibold px-5 py-2.5 rounded-full transition-all duration-300 hover:-translate-y-0.5"
                      style={{ border: `1.5px solid ${t.accent}`, color: t.accent, backgroundColor: 'transparent' }}
                    >
                      <Share2 className="h-3.5 w-3.5" /> Share
                    </button>
                  </div>
                </div>
              ) : (
       
                <div className="text-center">
                  <h1 className="text-2xl sm:text-[28px] font-extrabold leading-tight tracking-tight">{displayName}</h1>
                  {showBizcardLabel && (
                    <p className="text-sm font-semibold mt-1" style={{ color: t.accent }}>{bizcardLabel}</p>
                  )}
                  {professionalTitle && (
                    <p className="text-sm font-semibold mt-1.5" style={{ color: t.textMuted }}>{professionalTitle}</p>
                  )}
                  {!mini && (
                    <div className="flex items-center justify-center gap-2 mt-3 flex-wrap">
                      <button
                        onClick={() => downloadVCard(d)}
                        className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-4 py-1.5 rounded-full text-white transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg"
                        style={{ backgroundColor: t.accent, boxShadow: `0 8px 24px -10px ${t.accent}` }}
                      >
                        Connect Now
                      </button>
                    </div>
                  )}
                  {(d.vcard.about || d.bizCard.description) && (
                    <div className="mt-5 text-left rounded-2xl p-4 border border-white/10" style={{ backgroundColor: t.glass }}>
                      <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: t.textMuted }}>
                        About Me
                      </p>
                      <p className="text-sm leading-relaxed" style={{ color: t.textMuted }}>
                        <RichText html={d.vcard.about || d.bizCard.description} />
                      </p>
                    </div>
                  )}
                  <div className="flex gap-2 justify-center mt-5">
                    <button
                      onClick={() => downloadVCard(d)}
                      className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-full transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
                      style={{ backgroundColor: t.accentSoft, color: t.accent }}
                    >
                      <Download className="h-3.5 w-3.5" /> Save Contact
                    </button>
                    <button
                      onClick={async () => {
                        if (typeof window === 'undefined') return;
                        const url = `${window.location.origin}/${d.bizCard.urlAlias}`;
                        if (navigator.share) await navigator.share({ title: displayName, url }).catch(() => {});
                        else await navigator.clipboard.writeText(url).catch(() => {});
                      }}
                      className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-full transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
                      style={{ backgroundColor: t.accentSoft, color: t.accent }}
                    >
                      <Share2 className="h-3.5 w-3.5" /> Share
                    </button>
                  </div>
                </div>
              )}
            </div>
          </AnimatedSection>
          {/* Social Links + Contact — merged section */}
          {buildContactLinks(d).length > 0 && (
            <AnimatedSection delay={80} mini={mini}>
              <div className={`${sectionClass} ${p}`} style={{ backgroundColor: t.cardBg }}>
                {!mini && (
                  <p className="text-[10px] font-semibold uppercase tracking-widest mb-4 text-center" style={{ color: t.textMuted }}>
                    Connect with me
                  </p>
                )}
                {mini ? (
                  <div className="flex flex-wrap justify-center gap-2">
                    {buildContactLinks(d).map((link, i) => (
                      <a
                        key={i}
                        href={link.url}
                        target={link.platform === 'email' || link.platform === 'phone' || link.platform === 'telephone' ? '_self' : '_blank'}
                        rel="noopener noreferrer"
                        title={getContactLinkAriaLabel(link)}
                        aria-label={getContactLinkAriaLabel(link)}
                        className={`inline-flex max-w-full items-center ${link.kind === 'contact' ? 'gap-1.5 px-2.5' : 'justify-center px-2'} h-8 rounded-2xl text-[10px] font-medium`}
                        style={{ backgroundColor: getSocialBg(link.platform), color: t.text }}
                      >
                        <SocialIcon platform={link.platform} size={PORTFOLIO_SOCIAL_ICON_SIZE_MINI} />
                        <ContactLinkLabel link={link} className="truncate min-w-0" />
                      </a>
                    ))}
                  </div>
                ) : variant === 'royal-purple' ? (
                  /* Royal Purple — social icons above, contact stacked full-width */
                  <div className="flex w-full flex-col gap-2">
                    {buildContactLinks(d).some((link) => link.kind === 'social') ? (
                      <div className="flex flex-wrap justify-center gap-2">
                        {buildContactLinks(d).filter((link) => link.kind === 'social').map((link, i) => (
                          <a
                            key={`social-${i}`}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={getContactLinkAriaLabel(link)}
                            aria-label={getContactLinkAriaLabel(link)}
                            className="group inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full p-0 transition-all duration-300 hover:-translate-y-0.5"
                            style={{
                              backgroundColor: t.glass,
                              border: `1px solid ${t.accent}33`,
                              boxShadow: `0 6px 18px -10px ${t.accent}`,
                            }}
                          >
                            <SocialIcon platform={link.platform} size={PORTFOLIO_SOCIAL_ICON_SIZE} />
                          </a>
                        ))}
                      </div>
                    ) : null}
                    {buildContactLinks(d).filter((link) => link.kind === 'contact').map((link, i) => (
                      <a
                        key={`contact-${i}`}
                        href={link.url}
                        target="_self"
                        rel="noopener noreferrer"
                        title={getContactLinkAriaLabel(link)}
                        aria-label={getContactLinkAriaLabel(link)}
                        className="group inline-flex w-full min-w-0 items-center gap-2 rounded-full px-4 py-2 transition-all duration-300 hover:-translate-y-0.5"
                        style={{
                          backgroundColor: t.glass,
                          border: `1px solid ${t.accent}33`,
                          boxShadow: `0 6px 18px -10px ${t.accent}`,
                        }}
                      >
                        <span className="shrink-0 inline-flex">
                          <SocialIcon platform={link.platform} size={PORTFOLIO_SOCIAL_ICON_SIZE} />
                        </span>
                        <ContactLinkLabel link={link} className="text-[11px] font-semibold truncate min-w-0" style={{ color: t.text }} />
                      </a>
                    ))}
                  </div>
                ) : variant === 'ocean-gradient' ? (
                  /* Ocean Gradient — contact icon+value, social icons only */
                  <div className="flex flex-wrap justify-center gap-2">
                    {buildContactLinks(d).map((link, i) => (
                      <a
                        key={i}
                        href={link.url}
                        target={link.platform === 'email' || link.platform === 'phone' || link.platform === 'telephone' ? '_self' : '_blank'}
                        rel="noopener noreferrer"
                        title={getContactLinkAriaLabel(link)}
                        aria-label={getContactLinkAriaLabel(link)}
                        className={`group inline-flex max-w-full items-center rounded-full transition-all duration-300 hover:-translate-y-1 hover:shadow-xl relative overflow-hidden ${link.kind === 'contact' ? 'gap-2 px-4 py-2.5' : 'justify-center p-2.5'}`}
                        style={{
                          border: `1.5px solid ${t.accent}`,
                          backgroundColor: 'transparent',
                        }}
                      >
                        <span
                          className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                          style={{ background: `radial-gradient(circle at 50% 120%, ${t.accent}55, transparent 70%)` }}
                        />
                        <span className="relative shrink-0">
                          <SocialIcon platform={link.platform} size={PORTFOLIO_SOCIAL_ICON_SIZE} />
                        </span>
                        <ContactLinkLabel link={link} className="relative text-[11px] font-medium truncate min-w-0" style={{ color: t.text }} />
                      </a>
                    ))}
                  </div>
                ) : (
                  /* Elegant Dark — social icons above, contact stacked full-width */
                  <div className="flex w-full flex-col gap-2">
                    {buildContactLinks(d).some((link) => link.kind === 'social') ? (
                      <div className="flex flex-wrap justify-center gap-2">
                        {buildContactLinks(d).filter((link) => link.kind === 'social').map((link, i) => (
                          <a
                            key={`social-${i}`}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={getContactLinkAriaLabel(link)}
                            aria-label={getContactLinkAriaLabel(link)}
                            className="group inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full p-0 transition-all duration-300 hover:-translate-y-1"
                            style={{
                              background: 'rgba(255,255,255,0.06)',
                              border: '1px solid rgba(255,255,255,0.10)',
                              backdropFilter: 'blur(8px)',
                              color: t.text,
                            }}
                            onMouseEnter={(e) => {
                              (e.currentTarget as HTMLAnchorElement).style.boxShadow = `0 8px 22px -6px ${t.accent}, 0 0 0 1px ${t.accent}55 inset`;
                            }}
                            onMouseLeave={(e) => {
                              (e.currentTarget as HTMLAnchorElement).style.boxShadow = '';
                            }}
                          >
                            <SocialIcon platform={link.platform} size={PORTFOLIO_SOCIAL_ICON_SIZE} />
                          </a>
                        ))}
                      </div>
                    ) : null}
                    {buildContactLinks(d).filter((link) => link.kind === 'contact').map((link, i) => (
                      <a
                        key={`contact-${i}`}
                        href={link.url}
                        target="_self"
                        rel="noopener noreferrer"
                        title={getContactLinkAriaLabel(link)}
                        aria-label={getContactLinkAriaLabel(link)}
                        className="group inline-flex w-full min-w-0 items-center gap-2.5 rounded-full px-4 py-2.5 transition-all duration-300 hover:-translate-y-1"
                        style={{
                          background: 'rgba(255,255,255,0.06)',
                          border: '1px solid rgba(255,255,255,0.10)',
                          backdropFilter: 'blur(8px)',
                          color: t.text,
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLAnchorElement).style.boxShadow = `0 8px 22px -6px ${t.accent}, 0 0 0 1px ${t.accent}55 inset`;
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLAnchorElement).style.boxShadow = '';
                        }}
                      >
                        <span className="shrink-0 inline-flex">
                          <SocialIcon platform={link.platform} size={PORTFOLIO_SOCIAL_ICON_SIZE} />
                        </span>
                        <ContactLinkLabel link={link} className="text-[12px] font-medium truncate min-w-0" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </AnimatedSection>
          )}

          <AnimatedSection delay={220} mini={mini}>
            <PortfolioAddressSection
              vcard={d.vcard}
              mini={mini}
              theme={{
                cardBg: t.cardBg,
                glass: t.glass,
                text: t.text,
                textMuted: t.textMuted,
                accent: t.accent,
              }}
            />
          </AnimatedSection>
          {/* Services — distinct poster-style layout per theme. Strict data isolation maintained. */}
          {sanitisedServices.some((s) => s.title) && (
            <AnimatedSection delay={280} mini={mini}>
              <div className={`${sectionClass} ${p}`} style={{ backgroundColor: t.cardBg }}>
                {mini ? (
                  <>
                    <h3 className="text-[10px] font-bold mb-4">Our Services</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {sanitisedServices.filter((s) => s.title).map((service, i) => {
                        const serviceMediaItems = buildServiceMediaItems(service, ((service as { media?: Array<{ url?: string | null; mimeType?: string | null; title?: string | null; description?: string | null }> }).media ?? []));
                        return (
                          <div
                            key={i}
                            className="rounded-xl overflow-hidden border border-white/10"
                            style={{ backgroundColor: t.glass }}
                          >
                            <div className="w-full min-h-[72px] overflow-hidden">
                              {serviceMediaItems.length > 0 ? (
                                <ServiceMediaCarousel items={serviceMediaItems} accent={t.accent} glass={t.glass} textMuted={t.textMuted} mini={true} variant={variant} />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center" style={{ background: `linear-gradient(135deg,${t.accent}35,${t.accent}12)` }}>
                                  <span className="text-4xl font-bold opacity-15 uppercase" style={{ color: t.accent }}>
                                    {service.title?.[0] ?? '?'}
                                  </span>
                                </div>
                              )}
                            </div>
                            <div className="p-1.5">
                              <p className="text-[8px] font-bold leading-tight">{service.title}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : variant === 'ocean-gradient' ? (
                  <>
                    <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-center" style={{ color: t.textMuted }}>
                      Our Services
                    </p>
                    <p className="text-sm text-center mt-1 mb-5" style={{ color: t.textMuted }}>
                      Specialized solutions for modern brands
                    </p>
                    <div className={`flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1 scroll-smooth ${HIDDEN_SCROLLBAR_CLASS}`}>
                      {sanitisedServices.filter((s) => s.title).map((service, i) => {
                        const serviceMediaItems = buildServiceMediaItems(service, ((service as { media?: Array<{ url?: string | null; mimeType?: string | null; title?: string | null; description?: string | null }> }).media ?? []));
                        return (
                          <div
                            key={i}
                            className="group shrink-0 snap-start rounded-3xl p-[1.5px] transition-transform duration-300 hover:-translate-y-1"
                            style={{ width: 'min(80vw, 280px)', background: `linear-gradient(135deg, ${t.accent}, ${t.accent}33, ${t.accent})` }}
                          >
                            <div className="rounded-3xl overflow-hidden h-full flex flex-col items-center text-center" style={{ backgroundColor: t.cardBg }}>
                              <div className="w-full min-h-[120px] overflow-hidden">
                                {serviceMediaItems.length > 0 ? (
                                  <ServiceMediaCarousel items={serviceMediaItems} accent={t.accent} glass={t.glass} textMuted={t.textMuted} mini={false} variant={variant} />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center" style={{ background: `linear-gradient(135deg,${t.accent}55,${t.accent}15)` }}>
                                    <span className="text-5xl font-bold opacity-25 uppercase" style={{ color: t.accent }}>
                                      {service.title?.[0] ?? '?'}
                                    </span>
                                  </div>
                                )}
                              </div>
                              <div className="p-5 flex-1 flex flex-col items-center">
                                <div className="h-10 w-10 -mt-10 mb-3 rounded-full flex items-center justify-center text-white shadow-lg" style={{ background: `linear-gradient(135deg, ${t.accent}, ${t.accent}cc)` }}>
                                  <ZapIcon className="h-4 w-4" />
                                </div>
                                <p className="text-base font-bold leading-tight">{service.title}</p>
                                {service.tagline && <p className="text-xs mt-1 font-medium" style={{ color: t.accent }}>{service.tagline}</p>}
                                {service.description && <p className="text-xs leading-relaxed mt-2" style={{ color: t.textMuted }}><RichText html={service.description} /></p>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : variant === 'royal-purple' ? (
                  <>
                    <p className="text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: t.textMuted }}>
                      Our Services
                    </p>
                    <div className="flex items-center gap-3 mt-1 mb-5">
                      <div className="h-0.5 w-10 rounded-full" style={{ backgroundColor: t.accent }} />
                      <p className="text-sm italic" style={{ color: t.textMuted }}>
                        A curated practice for distinctive brands
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-6 gap-4">
                      {sanitisedServices.filter((s) => s.title).map((service, i) => {
                        const serviceMediaItems = buildServiceMediaItems(service, ((service as { media?: Array<{ url?: string | null; mimeType?: string | null; title?: string | null; description?: string | null }> }).media ?? []));
                        const isFeature = i % 3 === 0;
                        return (
                          <div
                            key={i}
                            className={`group relative rounded-2xl overflow-hidden border border-white/10 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl ${isFeature ? 'sm:col-span-6' : 'sm:col-span-3'}`}
                            style={{ backgroundColor: t.glass }}
                          >
                            <div className={`w-full overflow-hidden min-h-[120px] ${isFeature ? 'aspect-21/9' : 'aspect-4/3'}`}>
                              {serviceMediaItems.length > 0 ? (
                                <ServiceMediaCarousel items={serviceMediaItems} accent={t.accent} glass={t.glass} textMuted={t.textMuted} mini={false} variant={variant} />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center" style={{ background: `linear-gradient(135deg,${t.accent}45,${t.accent}10)` }}>
                                  <span className="text-5xl font-bold opacity-20 uppercase" style={{ color: t.accent }}>
                                    {service.title?.[0] ?? '?'}
                                  </span>
                                </div>
                              )}
                            </div>
                            <div className="absolute inset-x-0 bottom-0 p-4 bg-linear-to-t from-black/80 to-transparent">
                              {service.tagline && <p className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: t.accent }}>{service.tagline}</p>}
                              <p className={`${isFeature ? 'text-lg' : 'text-sm'} font-extrabold text-white drop-shadow leading-tight`}>{service.title}</p>
                              {isFeature && service.description && <p className="mt-1.5 text-xs text-white/85 line-clamp-2"><RichText html={service.description} /></p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-[25px] font-bold uppercase tracking-[0.3em] text-center" style={{ color: t.textMuted }}>
                      Our Services
                    </p>
                    <p className="text-sm text-center mt-1 mb-5" style={{ color: t.textMuted }}>
                      Specialized solutions for modern brands
                    </p>
                    <div className={`flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1 scroll-smooth ${HIDDEN_SCROLLBAR_CLASS}`}>
                      {sanitisedServices.filter((s) => s.title).map((service, i) => {
                        const serviceMediaItems = buildServiceMediaItems(service, ((service as { media?: Array<{ url?: string | null; mimeType?: string | null; title?: string | null; description?: string | null }> }).media ?? []));
                        return (
                          <div
                            key={i}
                            className="group shrink-0 snap-start rounded-2xl overflow-hidden border border-white/10 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl flex flex-col"
                            style={{ backgroundColor: t.glass, width: 'min(78vw, 280px)' }}
                          >
                            <div className="relative w-full min-h-[120px] overflow-hidden">
                              {serviceMediaItems.length > 0 ? (
                                <ServiceMediaCarousel items={serviceMediaItems} accent={t.accent} glass={t.glass} textMuted={t.textMuted} mini={false} variant={variant} />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center" style={{ background: `linear-gradient(135deg,${t.accent}45,${t.accent}10)` }}>
                                  <span className="text-5xl font-bold opacity-20 uppercase" style={{ color: t.accent }}>
                                    {service.title?.[0] ?? '?'}
                                  </span>
                                </div>
                              )}
                              <div className="absolute inset-x-0 bottom-0 p-3 bg-linear-to-t from-black/85 to-transparent">
                                <p className="text-xs font-bold uppercase tracking-widest text-white">{service.title}</p>
                              </div>
                            </div>
                            <div className="p-4 flex-1 flex flex-col text-left">
                              {service.tagline && <p className="text-[11px] font-semibold mb-1" style={{ color: t.accent }}>{service.tagline}</p>}
                              {service.description && <p className="text-sm leading-relaxed line-clamp-3" style={{ color: t.textMuted }}><RichText html={service.description} /></p>}
                              <div className="mt-3 flex justify-end">
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-3.5 py-1.5 rounded-full transition-all duration-300 group-hover:-translate-y-0.5 group-hover:shadow-md" style={{ backgroundColor: 'rgba(255,255,255,0.92)', color: '#111' }}>
                                  View Details
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </AnimatedSection>
          )}
          {/* Gallery — only shown when there is at least one item */}
          {isGalleryEnabled(d, mini) && galleryItems.length > 0 && (
            <AnimatedSection delay={340} mini={mini}>
              <div className={`${sectionClass} ${p}`} style={{ backgroundColor: t.cardBg }}>
                <h3 className={`${mini ? 'text-[10px]' : 'text-base sm:text-lg'} font-bold mb-4 ${mini ? '' : 'text-center'}`}>
                  Gallery
                </h3>
                <GalleryCarousel items={galleryItems} accent={t.accent} glass={t.glass} textMuted={t.textMuted} mini={mini} variant={variant} />
              </div>
            </AnimatedSection>
          )}
          {/* Videos */}
          {isGalleryEnabled(d, mini) && videoItems.length > 0 && (
            <AnimatedSection delay={400} mini={mini}>
              <div className={`${sectionClass} ${p}`} style={{ backgroundColor: t.cardBg }}>
                <h3 className={`${mini ? 'text-[10px]' : 'text-base sm:text-lg'} font-bold mb-4 ${mini ? '' : 'text-center'}`}>
                  Videos
                </h3>
                <VideoCarousel
                  items={videoItems}
                  accent={t.accent}
                  glass={t.glass}
                  textMuted={t.textMuted}
                  mini={mini}
                  variant={variant}
                />
              </div>
            </AnimatedSection>
          )}

          {/* QR / Share card */}
          {!mini && (
            <AnimatedSection delay={460} mini={false}>
              <div
                data-portfolio-section="qr"
                className={`${sectionClass} ${p} flex flex-col items-center`}
                style={{ backgroundColor: t.cardBg }}
              >
                <h3 className="text-base sm:text-lg font-bold mb-1">Share My Card</h3>
                <p className="text-xs mb-5" style={{ color: t.textMuted }}>Scan to visit this portfolio</p>
                <div className="bg-white rounded-2xl p-4 shadow-xl mb-3">
                  {qrImageUrl ? (
                    <img
                      src={qrImageUrl}
                      alt={shareUrl ? `QR code for ${shareUrl}` : 'Portfolio QR code'}
                      className="h-32 w-32"
                    />
                  ) : (
                    <QrCode className="h-32 w-32 text-gray-800" />
                  )}
                </div>
                <p className="text-xs font-mono mb-5 text-center break-all" style={{ color: t.textMuted }}>
                  {shareUrl || `ontap.ph/${d.bizCard.urlAlias}`}
                </p>
                <div className="flex flex-col gap-3 w-full">
                  <QRCardDownloadButton
                    onClick={() => { void downloadQRCard(); }}
                    isDownloading={isDownloading}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold"
                    style={{ backgroundColor: t.accentSoft, color: t.accent }}
                  />
                  <div className="flex gap-3 w-full">
                    <button
                      onClick={() => downloadVCard(d)}
                      className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold"
                      style={{ backgroundColor: t.accentSoft, color: t.accent }}
                    >
                      <Download className="h-4 w-4" /> Save Contact
                    </button>
                    <button
                      onClick={async () => {
                        if (typeof window === 'undefined') return;
                        const url = shareUrl || `${window.location.origin}/${d.bizCard.urlAlias}`;
                        if (navigator.share) await navigator.share({ title: displayName, url }).catch(() => {});
                        else await navigator.clipboard.writeText(url).catch(() => {});
                      }}
                      className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold"
                      style={{ backgroundColor: t.accentSoft, color: t.accent }}
                    >
                      <Share2 className="h-4 w-4" /> Share
                    </button>
                  </div>
                </div>
              </div>
            </AnimatedSection>
          )}

          {/* Footer */}
          {!mini && (
            <div className="py-6 text-center" style={{ color: t.textMuted }}>
              <p className="text-xs">Powered by <span className="font-bold" style={{ color: t.accent }}>OnTap Creatives</span></p>
            </div>
          )}
        </div>
      </div>

      {showFAB && !mini && <FloatingContactWidget data={d} accent={t.accent} qrUrl={qrImageUrl} />}
      {!mini && (
        <QRCardExportSurface
          ref={cardRef}
          data={d}
          style={qrCardStyle}
          shareUrl={shareUrl}
          qrDataUrl={qrDataUrl}
        />
      )}
    </div>
  );
}

export { PortfolioAddressSection } from '../components/PortfolioAddressCard';
export type { PortfolioAddressSectionProps, PortfolioAddressThemeTokens } from '../components/PortfolioAddressCard';
export {
  cleanAboutText,
  cleanPortfolioValue,
  getCoverImageOrNull,
  getProfileImageOrNull,
  hasAboutText,
  hasContactInfo,
  hasMappableLocation,
  hasPortfolioLocation,
  hasPortfolioValue,
  htmlToPlainText,
  inferCoverTypeFromUrl,
  isCoverVideo,
  isLikelyMobilePhoneDigits,
  resolvePortfolioCardVisibility,
  resolvePortfolioData,
  toPortfolioPhoneDigits,
  toPortfolioTelHref,
  toServableMediaSrc,
  withServablePortfolioMedia,
} from '../lib/portfolioDisplay';
export type { PortfolioCardVisibility } from '../lib/portfolioDisplay';
export { showToast } from '../components/Toast';




