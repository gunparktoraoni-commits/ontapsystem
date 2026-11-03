import type { PortfolioData, VCardFormData } from '../types';
import { htmlToPlainText, normalizeDisplayText } from './plainText';
import { sanitizePortfolioRichHtml, isRichTextEmpty } from './richText';
import { hasPortfolioLocation } from './portfolioMaps';

export { hasPortfolioLocation } from './portfolioMaps';

export function cleanPortfolioValue(value: string | null | undefined): string {
  const normalized = normalizeDisplayText(value);
  if (!normalized) return '';
  const lower = normalized.toLowerCase();
  if (lower === 'n/a' || lower === 'na' || lower === 'none') return '';
  return normalized;
}

/** About / bio / description: always plain text (no HTML tags). */
export function cleanAboutText(value: string | null | undefined): string {
  const plain = htmlToPlainText(value);
  if (!plain) return '';
  const lower = plain.toLowerCase();
  if (lower === 'n/a' || lower === 'na' || lower === 'none') return '';
  return plain;
}

/**
 * About / bio / services details rendered as rich text: preserves a safe subset
 * of formatting (bold/italic/underline) plus spaces and line breaks. Returns a
 * sanitized HTML string (render with the <RichText> component).
 */
export function cleanAboutRichHtml(value: string | null | undefined): string {
  if (isRichTextEmpty(value)) return '';
  return sanitizePortfolioRichHtml(value);
}

/**
 * Private R2 S3 endpoint URLs cannot be loaded in <img>/<video>/next/image.
 * Rewrite them to the same-origin proxy: GET /api/media/file/[...key]
 */
export function toServableMediaSrc(src: string): string {
  if (!src) return src;
  if (src.startsWith('data:') || src.startsWith('blob:')) {
    return src;
  }

  // Absolute or relative media-proxy URLs → always use same-origin relative path
  // so localhost/dev can load via the local /api/media/file proxy.
  if (src.includes('/api/media/file/')) {
    try {
      const u = new URL(src, 'http://local.invalid');
      const idx = u.pathname.indexOf('/api/media/file/');
      if (idx >= 0) {
        return `${u.pathname.slice(idx)}${u.search}`;
      }
    } catch {
      const idx = src.indexOf('/api/media/file/');
      if (idx >= 0) return src.slice(idx);
    }
    return src;
  }

  if (src.startsWith('/')) {
    return src;
  }

  try {
    const u = new URL(src);
    if (!u.hostname.includes('r2.cloudflarestorage.com')) {
      return src;
    }

    let path = u.pathname.replace(/^\//, '');
    if (!path) return src;

    // Virtual-hosted: {bucket}.{account}.r2.cloudflarestorage.com/{key}
    // Path-style: {account}.r2.cloudflarestorage.com/{bucket}/{key}
    const hostLabels = u.hostname.split('.');
    const isVirtualHosted =
      hostLabels.length >= 5 && hostLabels[1] !== 'r2';

    if (!isVirtualHosted) {
      const slash = path.indexOf('/');
      if (slash > 0) {
        path = path.slice(slash + 1);
      }
    }

    if (!path) return src;
    return `/api/media/file/${path
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')}`;
  } catch {
    return src;
  }
}

export function hasPortfolioValue(value: string | null | undefined): boolean {
  return Boolean(cleanPortfolioValue(value));
}

const PLACEHOLDER_PHONES = new Set([
  'n/a',
  'na',
  'none',
  'null',
  'undefined',
  '-',
  '--',
  '0',
  '00',
]);

function nationalPhoneDigits(digits: string): string {
  if (digits.startsWith('63') && digits.length >= 11) return digits.slice(2);
  if (digits.startsWith('0') && digits.length >= 8) return digits.slice(1);
  return digits;
}

/** PH mobile national numbers start with 9 (e.g. 917…). */
export function isLikelyMobilePhoneDigits(digits: string): boolean {
  const national = nationalPhoneDigits(digits);
  return national.startsWith('9');
}

/**
 * Portfolio contact display: digits only.
 * Mobile → normalize to up to 12 digits (prefer 63XXXXXXXXXX).
 * Telephone/landline → 7–12 digits, no forced country code.
 * Returns '' when N/A or too short to show.
 */
export function toPortfolioPhoneDigits(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (PLACEHOLDER_PHONES.has(raw.toLowerCase())) return '';

  const cleaned = cleanPortfolioValue(raw);
  if (!cleaned) return '';
  if (PLACEHOLDER_PHONES.has(cleaned.toLowerCase())) return '';

  let digits = cleaned.replace(/\D/g, '');
  if (!digits) return '';

  const national = nationalPhoneDigits(digits);

  if (isLikelyMobilePhoneDigits(digits)) {
    // Need a full 10-digit national mobile number.
    if (national.length < 10) return '';
    const mobileNational = national.slice(0, 10);
    // Prefer 12-digit PH international form for portfolio display.
    digits = `63${mobileNational}`.slice(0, 12);
    return digits;
  }

  // Telephone / landline: allow shorter local numbers.
  if (digits.length < 7) return '';
  if (digits.length > 12) digits = digits.slice(0, 12);
  return digits;
}

/** tel: / vCard href from portfolio phone digits. */
export function toPortfolioTelHref(value: string | null | undefined): string {
  const digits = toPortfolioPhoneDigits(value);
  if (!digits) return '';
  if (digits.startsWith('63') && digits.length >= 11) return `+${digits}`;
  return digits;
}

const EMPTY_PORTFOLIO_DATA: PortfolioData = {
  bizCard: {
    urlAlias: '',
    bizCardName: '',
    description: '',
    occupation: '',
    profileImage: null,
    coverImage: null,
    coverType: null,
    coverFileName: null,
    coverImagePosition: 'center center',
  },
  vcard: {
    firstName: '',
    middleName: '',
    lastName: '',
    professionalTitle: '',
    postNominalLetters: '',
    suffix: '',
    about: '',
    contactNumber: '',
    secondaryNumber: '',
    telephoneNumber: '',
    altTelephoneNumber: '',
    email: '',
    alternativeEmail: '',
    languages: '',
    addressArea: '',
    addressHouseNo: '',
    addressBrgy: '',
    addressCity: '',
    addressRegion: '',
    addressZipcode: '',
    addressMapLink: '',
    addressLandmark: '',
    addressLatitude: null,
    addressLongitude: null,
    socialLinks: [],
  },
  services: [],
  selectedTheme: '',
  gallery: [],
  videos: [],
};

function sanitizePortfolioData(data: PortfolioData): PortfolioData {
  const coverHidden = data.showCoverPhoto === false;
  const emailHidden = data.showEmail === false;
  return {
    ...data,
    bizCard: {
      ...data.bizCard,
      bizCardName: cleanPortfolioValue(data.bizCard.bizCardName),
      companyName: cleanPortfolioValue(data.bizCard.companyName),
      description: cleanAboutRichHtml(data.bizCard.description),
      occupation: cleanPortfolioValue(data.bizCard.occupation),
      // Themes read coverImage directly; clear it when the preference is off
      // so every template honors More Preferences without per-theme checks.
      coverImage: coverHidden ? null : data.bizCard.coverImage,
      coverType: coverHidden ? null : data.bizCard.coverType,
    },
    vcard: {
      ...data.vcard,
      firstName: cleanPortfolioValue(data.vcard.firstName),
      middleName: cleanPortfolioValue(data.vcard.middleName),
      lastName: cleanPortfolioValue(data.vcard.lastName),
      professionalTitle: cleanPortfolioValue(data.vcard.professionalTitle),
      postNominalLetters: cleanPortfolioValue(data.vcard.postNominalLetters),
      about: cleanAboutRichHtml(data.vcard.about),
      contactNumber: toPortfolioPhoneDigits(data.vcard.contactNumber),
      secondaryNumber: toPortfolioPhoneDigits(data.vcard.secondaryNumber),
      telephoneNumber: toPortfolioPhoneDigits(data.vcard.telephoneNumber),
      altTelephoneNumber: toPortfolioPhoneDigits(data.vcard.altTelephoneNumber),
      // Themes read email fields directly; clear them when the preference is off.
      email: emailHidden ? '' : data.vcard.email,
      alternativeEmail: emailHidden ? '' : data.vcard.alternativeEmail,
      languages: cleanPortfolioValue(data.vcard.languages),
    },
    services: (data.services ?? []).map((s) => ({
      ...s,
      title: cleanPortfolioValue(s.title),
      tagline: cleanPortfolioValue(s.tagline),
      description: cleanAboutRichHtml(s.description),
    })),
  };
}

export function resolvePortfolioData(data?: PortfolioData): PortfolioData {
  if (data) return sanitizePortfolioData(data);
  return {
    ...EMPTY_PORTFOLIO_DATA,
    bizCard: { ...EMPTY_PORTFOLIO_DATA.bizCard },
    vcard: { ...EMPTY_PORTFOLIO_DATA.vcard, socialLinks: [] },
    services: [],
    gallery: [],
    videos: [],
  };
}

export function hasContactInfo(vcard: VCardFormData): boolean {
  return Boolean(
    hasPortfolioValue(vcard.email) ||
      hasPortfolioValue(vcard.alternativeEmail) ||
      Boolean(toPortfolioPhoneDigits(vcard.contactNumber)) ||
      Boolean(toPortfolioPhoneDigits(vcard.secondaryNumber)) ||
      Boolean(toPortfolioPhoneDigits(vcard.telephoneNumber)) ||
      Boolean(toPortfolioPhoneDigits(vcard.altTelephoneNumber))
  );
}

export function hasAboutText(d: PortfolioData): boolean {
  return !isRichTextEmpty(d.vcard.about) || !isRichTextEmpty(d.bizCard.description);
}

export { htmlToPlainText, normalizeDisplayText } from './plainText';

/**
 * True when the portfolio has a map link or valid lat/lng — enough to show the Location card.
 * City/street text alone is not enough (the shared Location card is map-driven).
 */
export function hasMappableLocation(vcard: VCardFormData): boolean {
  return hasPortfolioLocation(vcard);
}

export type PortfolioCardVisibility = {
  about: boolean;
  contact: boolean;
  socials: boolean;
  services: boolean;
  gallery: boolean;
  videos: boolean;
  location: boolean;
  inquiry: boolean;
};

/**
 * Single source of truth for which portfolio sections have enough data to render.
 * Themes must gate Location with `visibility.location` / `hasPortfolioLocation`,
 * never with `addressCity` alone — otherwise map-link-only profiles hide the map.
 */
export function resolvePortfolioCardVisibility(
  data: PortfolioData,
  options?: { mini?: boolean },
): PortfolioCardVisibility {
  const mini = options?.mini ?? false;
  const socialLinks = (data.vcard.socialLinks ?? []).filter(
    (link) => hasPortfolioValue(link.platform) && hasPortfolioValue(link.url),
  );
  const services = (data.services ?? []).filter((service) => hasPortfolioValue(service.title));
  const galleryEnabled = mini || data.galleryAvailable !== false;
  const gallery = galleryEnabled
    ? (data.gallery ?? []).filter(
        (item) =>
          hasPortfolioValue(item.url) || hasPortfolioValue(item.imageDataUrl ?? ''),
      )
    : [];
  const videos = galleryEnabled
    ? (data.videos ?? []).filter((item) => hasPortfolioValue(item.videoDataUrl ?? ''))
    : [];
  const inquiry =
    mini || (data.inquiryEnabled === true && data.showInquiryCard !== false);

  return {
    about: hasAboutText(data),
    contact: hasContactInfo(data.vcard),
    socials: socialLinks.length > 0,
    services: services.length > 0,
    gallery: gallery.length > 0,
    videos: videos.length > 0,
    location: hasPortfolioLocation(data.vcard),
    inquiry,
  };
}

export function getProfileImageOrNull(d: PortfolioData): string | null {
  const url = cleanPortfolioValue(d.bizCard.profileImage);
  if (!url || url === '/images/no-image.png') return null;
  return toServableMediaSrc(url);
}

export function getCoverImageOrNull(d: PortfolioData): string | null {
  if (d.showCoverPhoto === false) return null;
  const url = cleanPortfolioValue(d.bizCard.coverImage);
  if (!url) return null;
  return toServableMediaSrc(url);
}

/**
 * Infer cover MIME from a stored URL / data URI.
 * coverType is not persisted in DB — themes rely on this for video vs image.
 */
export function inferCoverTypeFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const raw = String(url).trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  if (lower.startsWith('data:')) {
    const mime = lower.slice(5).split(';')[0]?.trim();
    return mime || null;
  }

  const path = lower.split('?')[0].split('#')[0];
  if (path.endsWith('.pdf')) return 'application/pdf';
  if (path.endsWith('.mp4') || path.endsWith('.m4v')) return 'video/mp4';
  if (path.endsWith('.webm')) return 'video/webm';
  if (path.endsWith('.mov')) return 'video/quicktime';
  if (path.endsWith('.gif')) return 'image/gif';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';

  // Proxy / CDN keys may embed the extension mid-path.
  if (path.includes('.mp4') || path.includes('.m4v')) return 'video/mp4';
  if (path.includes('.webm')) return 'video/webm';
  if (path.includes('.mov')) return 'video/quicktime';
  if (path.includes('.gif')) return 'image/gif';
  if (path.includes('.pdf')) return 'application/pdf';

  return 'image/*';
}

/** True when the cover should render as a <video> element. */
export function isCoverVideo(
  url: string | null | undefined,
  coverType?: string | null,
): boolean {
  const mime = String(coverType ?? '').toLowerCase().split(';')[0].trim();
  if (mime.startsWith('video/')) return true;
  const inferred = inferCoverTypeFromUrl(url);
  return Boolean(inferred?.startsWith('video/'));
}

/** Rewrite private R2 media URLs on portfolio payload for browser display. */
export function withServablePortfolioMedia(data: PortfolioData): PortfolioData {
  const profileImage = data.bizCard.profileImage
    ? toServableMediaSrc(data.bizCard.profileImage)
    : null;
  const coverImage = data.bizCard.coverImage
    ? toServableMediaSrc(data.bizCard.coverImage)
    : null;

  return {
    ...data,
    bizCard: {
      ...data.bizCard,
      profileImage,
      coverImage,
      coverType:
        data.bizCard.coverType || inferCoverTypeFromUrl(coverImage ?? data.bizCard.coverImage),
    },
    services: Array.isArray(data.services)
      ? data.services.map((service) => ({
          ...service,
          featured_image: service.featured_image
            ? toServableMediaSrc(service.featured_image)
            : service.featured_image,
          media: Array.isArray(service.media)
            ? service.media.map((item) => ({
                ...item,
                url: item.url ? toServableMediaSrc(item.url) : item.url,
              }))
            : service.media,
        }))
      : data.services,
    gallery: Array.isArray(data.gallery)
      ? data.gallery.map((item) => ({
          ...item,
          url: item.url ? toServableMediaSrc(item.url) : item.url,
          imageDataUrl: item.imageDataUrl
            ? toServableMediaSrc(item.imageDataUrl)
            : item.imageDataUrl,
        }))
      : data.gallery,
    videos: Array.isArray(data.videos)
      ? data.videos.map((video) => ({
          ...video,
          fileName: video.fileName ? toServableMediaSrc(video.fileName) : video.fileName,
          videoDataUrl: video.videoDataUrl
            ? toServableMediaSrc(video.videoDataUrl)
            : video.videoDataUrl,
        }))
      : data.videos,
  };
}
