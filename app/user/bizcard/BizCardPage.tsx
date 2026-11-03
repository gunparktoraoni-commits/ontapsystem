'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Save, Check, Eye, X } from 'lucide-react';
import { SectionLoader, InlineLoader } from '../../components/Loader';
import type {
  BizCardFormData,
  GalleryItem,
  SocialLink,
  VCardFormData,
  ServiceItem,
  VideoItem,
  PortfolioData,
  ContactLinkLabelMode,
} from '../../types';
import { toContactLinkLabelMode } from '../../types';
import VcardTab    from '../../components/BizCardVcardTab';
import DesignTab   from '../../components/BizCardDesignTab';
import ServicesTab from '../../components/BizCardServicesTab';
import SocialTab   from '../../components/BizCardSocialTab';
import MorePreferencesTab from '../../components/BizCardMorePreferencesTab';
import { dataUrlToBlob } from '../../components/BizCardShared';
import { getFrontendApiBaseUrl } from '../../components/apiBase';
import { applyThemeSelectionWithFallback } from '../../components/themeApi';
import { FrontendSubscriptionError, formatTaggedError } from '../../components/frontendErrorCodes';
import { normalizePortfolioThemeId } from '../../themes/ThemeLoader';
import { persistThemePath, publishPortfolioSnapshotUpdate } from '../../lib/bizcardThemeSync';
import { recordLastAccessedBizcard, resolveBizcardDisplayName } from '../../lib/lastAccessedBizcard';
import { inferCoverTypeFromUrl } from '../../lib/portfolioDisplay';
import { validateContactFieldValues } from '../../components/ContactDetailsEditor';
import {
  resolveSocialPlatformDefFromLink,
} from '../../lib/socialPlatforms';
import {
  fetchUserBizcardTiers,
  hasStandardOrHigherBizcard,
} from '../../lib/bizcardTierAccess';
import { buildAddressApiPayload } from '../../lib/addressPayload';
import {
  normalizeTelephoneForApi,
} from '../../lib/contactDetails';
import {
  normalizeContactNumber,
  normalizeHttpUrl,
  serializeSocialLinksForApi,
} from '../../lib/vcardApiPayload';
import { clearBizcardCache } from '../../lib/bizcardCache';
import { extractClaimSerial, persistClaimSerial } from '@/lib/bizcard/claim-urls';
import { withImpersonationHeaders } from '../../lib/superadminImpersonationHandoff';
import { withCompanyActingHeaders } from '../../lib/companyEmployeeActingHandoff';
import {
  computeProfileDelta,
  mergeWithDefaults,
  hasMeaningfulChanges,
  type BizcardSnapshot,
} from '../../lib/bizcardDiff';
import { ModalPortal } from '../../components/ModalPortal';
import PortfolioPreviewFrame from '../../components/PortfolioPreviewFrame';
import BizCardPreview, { getTheme } from '../../components/BizCardPreview';
import { ThemePreviewPortalHost } from '../../themes/components/PortfolioThemeContext';
import { showToast } from '../../components/Toast';
import { sanitizeUrlAlias } from '@/lib/bizcard/url-alias-utils';
import { dedupeSocialLinksByUrl } from '@/lib/social-links';

const API = getFrontendApiBaseUrl();
const USER_SYNC_EVENT = 'ontap:user-sync';
const CSRF_COOKIE_NAME = 'csrf-token';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type UrlAliasEditable = {
  allowed: boolean;
  daysRemaining: number;
  changeAvailableAt: string;
};

function parseUrlAliasEditable(raw: unknown): UrlAliasEditable | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  return {
    allowed: Boolean(o.allowed ?? o.editable),
    daysRemaining: Number(o.daysRemaining ?? 0),
    changeAvailableAt: String(o.changeAvailableAt ?? ''),
  };
}

function dispatchUserSync() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(USER_SYNC_EVENT));
}

function writeAuthUser(userLike: unknown) {
  if (typeof window === 'undefined') return;
  try {
    const u = userLike && typeof userLike === 'object'
      ? (userLike as Record<string, unknown>)
      : {};
    const first = String(u.firstName ?? u.first_name ?? '').trim();
    const last = String(u.lastName ?? u.last_name ?? '').trim();
    const fullFallback = String(u.fullName ?? u.full_name ?? u.name ?? '').trim();
    const full = [first, last].filter(Boolean).join(' ').trim() || fullFallback;
    const rawId = u.id ?? u.userId ?? u.user_id;
    const id =
      rawId === null || rawId === undefined || rawId === ''
        ? undefined
        : String(rawId);

    localStorage.setItem('authUser', JSON.stringify({
      ...u,
      ...(id ? { id, userId: id, user_id: id } : {}),
      firstName: first,
      lastName: last,
      fullName: full,
    }));
  } catch {
    // ignore localStorage errors
  }
  dispatchUserSync();
}

function pickServiceImage(s: Record<string, unknown>): string | null {
  const pickUrl = (value: unknown): string => {
    if (!value) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value !== 'object') return '';
    const obj = value as Record<string, unknown>;
    return String(obj.url ?? obj.secure_url ?? obj.file_url ?? obj.media_url ?? obj.image_url ?? '').trim();
  };

  const explicitFeatured =
    pickUrl(s.featuredImage) ||
    pickUrl(s.featured_image) ||
    pickUrl(s.featuredImageUrl) ||
    pickUrl(s.featured_image_url) ||
    pickUrl(s.icon) ||
    pickUrl(s.icon_url);

  if (explicitFeatured) return explicitFeatured;

  const mediaCandidates: unknown[] = [
    s.media,
    s.serviceMedia,
    s.service_media,
    s.images,
  ];

  for (const candidate of mediaCandidates) {
    if (!Array.isArray(candidate) || candidate.length === 0) continue;
    const item = candidate[candidate.length - 1] as Record<string, unknown>;
    const urlFromMedia =
      (item?.url as string | undefined) ??
      (item?.media_url as string | undefined) ??
      (item?.image_url as string | undefined) ??
      (item?.secure_url as string | undefined);
    if (urlFromMedia) return urlFromMedia;
  }

  return (
    pickUrl(s.image) ||
    pickUrl(s.image_url) ||
    pickUrl(s.service_image) ||
    pickUrl(s.service_image_url) ||
    null
  );
}

function mapServiceMediaFromApi(s: Record<string, unknown>): NonNullable<ServiceItem['media']> {
  const buckets = [s.media, s.serviceMedia, s.service_media, s.gallery];
  for (const bucket of buckets) {
    if (!Array.isArray(bucket) || bucket.length === 0) continue;
    return bucket
      .map((item, index) => {
        const row = (item && typeof item === 'object')
          ? (item as Record<string, unknown>)
          : {};
        const url = String(row.url ?? row.file_url ?? row.secure_url ?? row.media_url ?? '').trim();
        if (!url) return null;
        return {
          id: String(row.id ?? row.media_id ?? index + 1),
          url,
          mimeType: String(row.mimeType ?? row.mime_type ?? '').trim() || null,
          fileName: String(row.fileName ?? row.file_name ?? '').trim() || null,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }
  return [];
}

function mapApiServiceToUi(s: Record<string, unknown>, i: number): ServiceItem {
  const idVal = Number(s.service_id ?? s.id ?? i + 1);
  const id = Number.isFinite(idVal) && idVal > 0 ? idVal : i + 1;
  const media = mapServiceMediaFromApi(s);
  let featuredImage = pickServiceImage(s);
  if (!featuredImage && media.length > 0) {
    const firstImage = media.find(
      (m) => !String(m.mimeType ?? '').toLowerCase().startsWith('video/'),
    );
    featuredImage = firstImage?.url ?? media[0]?.url ?? null;
  }
  return {
    id,
    title: String(s.name ?? s.title ?? '').trim(),
    tagline: String(s.tagline ?? '').trim(),
    description: String(s.description ?? '').trim(),
    featured_image: featuredImage,
    videoUrl: String(s.service_url ?? s.serviceUrl ?? s.url ?? '').trim(),
    videoFile: null,
    media,
  };
}

function extractGalleryUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item) return '';
      if (typeof item === 'string') return item.trim();
      if (typeof item !== 'object') return '';
      const obj = item as Record<string, unknown>;
      return String(obj.url ?? obj.secure_url ?? obj.file_url ?? obj.media_url ?? obj.image_url ?? '').trim();
    })
    .filter((url) => url.startsWith('http'));
}

function mapGalleryItem(raw: Record<string, unknown>, index: number): GalleryItem | null {
  const url = String(raw.url ?? raw.secure_url ?? raw.file_url ?? raw.media_url ?? raw.image_url ?? '').trim();
  if (!url.startsWith('http')) return null;
  return {
    id: Number(raw.id ?? raw.media_id ?? index + 1),
    url,
    title: String(raw.title ?? raw.file_name ?? '').trim(),
    description: String(raw.description ?? raw.caption ?? '').trim(),
    altText: String(raw.alt_text ?? raw.altText ?? '').trim() || null,
    fileName: String(raw.file_name ?? '').trim() || null,
    imageDataUrl: null,
    mimeType: String(raw.mime_type ?? raw.file_type ?? '').trim() || null,
  };
}

function isPortfolioVideoMedia(raw: {
  url?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  type?: string | null;
}): boolean {
  const mime = String(raw.mimeType ?? '').toLowerCase();
  if (mime.startsWith('video/')) return true;
  const type = String(raw.type ?? '').toLowerCase();
  if (type === 'video') return true;
  if (mime.startsWith('image/')) return false;
  if (type === 'image') return false;
  const url = String(raw.url ?? raw.fileName ?? '').toLowerCase();
  if (!url) return false;
  return (
    url.endsWith('.mp4') ||
    url.endsWith('.mov') ||
    url.endsWith('.webm') ||
    url.includes('.mp4?') ||
    url.includes('.mov?') ||
    url.includes('.webm?')
  );
}

function mapOwnerMediaToVideos(
  ownerMedia: Record<string, unknown>[],
): VideoItem[] {
  const rows: VideoItem[] = [];
  ownerMedia.forEach((m, i) => {
    const fileName = extractVideoUrl(m);
    const mimeType = String(m.mime_type ?? m.file_type ?? '').trim() || null;
    const type = String(m.type ?? '').trim() || null;
    if (
      !fileName.startsWith('http') ||
      !isPortfolioVideoMedia({ url: fileName, fileName, mimeType, type })
    ) {
      return;
    }
    rows.push({
      id: Number(m.id ?? m.media_id ?? i + 1),
      title: String(m.title ?? '').trim(),
      description: String(m.description ?? '').trim(),
      fileName,
      fileSize: 0,
      mimeType,
      videoDataUrl: null,
    });
  });
  return rows;
}

function extractVideoUrl(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const v = raw as Record<string, unknown>;
  return String(v.url ?? v.file_url ?? v.media_url ?? v.secure_url ?? v.video_url ?? '').trim();
}
function mergeServiceImages(base: ServiceItem[], fallback: ServiceItem[]): ServiceItem[] {
  if (!Array.isArray(base) || base.length === 0) return fallback;
  if (!Array.isArray(fallback) || fallback.length === 0) return base;

  return base.map((svc, idx) => {
    const byId = fallback.find((f) => f.id === svc.id);
    const byTitle = fallback.find((f) => f.title.trim().toLowerCase() === svc.title.trim().toLowerCase());
    const byIndex = fallback[idx];
    const match = byId ?? byTitle ?? byIndex;

    if (!match) return svc;
    const baseMedia = Array.isArray(svc.media) ? svc.media : [];
    const matchMedia = Array.isArray(match.media) ? match.media : [];
    const media = matchMedia.length > baseMedia.length ? matchMedia : baseMedia;

    if (svc.featured_image && (svc.featured_image.startsWith('http') || svc.featured_image.includes('/api/media/file/'))) {
      return {
        ...svc,
        media,
      };
    }
    if (match.featured_image && (match.featured_image.startsWith('http') || match.featured_image.includes('/api/media/file/'))) {
      return {
        ...svc,
        featured_image: match.featured_image,
        media,
      };
    }
    return {
      ...svc,
      media,
    };
  });
}
/* Map API social rows → editor SocialLink with catalog display keys + icons */
function mapApiSocialToUi(s: Record<string, unknown>, index: number): SocialLink {
  const url = String(s.url ?? '').trim();
  const rawPlatform = String(s.platform ?? '').trim();
  const platform = resolveSocialPlatformDefFromLink(rawPlatform, url).key;

  const rawId = s.id ?? s.socials_id;
  const numericId =
    typeof rawId === 'number'
      ? rawId
      : typeof rawId === 'string' && /^\d+$/.test(rawId)
        ? Number(rawId)
        : index + 1;

  return {
    id: numericId,
    platform,
    url,
  };
}

function mapApiSocialsToUi(raw: Record<string, unknown>[]): SocialLink[] {
  return dedupeSocialLinksByUrl(
    raw
      .filter((s) => String(s.url ?? '').trim() || String(s.platform ?? '').trim())
      .map((s, i) => mapApiSocialToUi(s, i)),
    (s) => s.url,
  );
}

/* theme_id string -> slug used internally */
const THEME_ID_MAP: Record<string, string> = {
  '1': 'elegant-dark',
  '2': 'ocean-gradient',
  '3': 'royal-purple',
};
const THEME_SLUG_MAP: Record<string, number> = {
  'elegant-dark': 1,
  'ocean-gradient': 2,
  'royal-purple': 3,
};

type Tab = 'vcard' | 'design' | 'services' | 'social' | 'more-preferences';
const TABS: { id: Tab; label: string }[] = [
  { id: 'vcard',    label: 'Details' },
  { id: 'services', label: 'Services'      },
  { id: 'social',   label: 'Socials'  },
  { id: 'design',   label: 'Templates'   },
  { id: 'more-preferences', label: 'More Preferences' },
];



/* -- Default empty states -- */
const EMPTY_BIZCARD: BizCardFormData = {
  urlAlias: '', bizCardName: '', description: '', occupation: '',
  profileImage: null, coverImage: null, coverType: null, coverFileName: null,
  coverImagePosition: 'center center',
};

const EMPTY_VCARD: VCardFormData = {
  firstName: '', middleName: '', lastName: '', professionalTitle: '',
  postNominalLetters: '', suffix: 'N/A', about: '',
  contactNumber: '', secondaryNumber: '', telephoneNumber: '', altTelephoneNumber: '', email: '', alternativeEmail: '',
  languages: '',
  addressArea: '', addressHouseNo: '', addressBrgy: '',
  addressCity: '', addressRegion: '', addressZipcode: '', addressMapLink: '', addressLandmark: '',
  addressLatitude: null, addressLongitude: null,
  socialLinks: [],
};

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie ? document.cookie.split('; ') : [];
  for (const cookie of cookies) {
    const [rawKey, ...rest] = cookie.split('=');
    const key = decodeURIComponent(rawKey || '').trim();
    if (key !== name) continue;
    return decodeURIComponent(rest.join('=') || '').trim() || null;
  }
  return null;
}

async function ensureCsrfToken(): Promise<string | null> {
  const fromCookie = readCookie(CSRF_COOKIE_NAME);
  if (fromCookie) return fromCookie;

  try {
    const response = await fetch(`${API}/api/csrf-token`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });

    if (!response.ok) {
      return readCookie(CSRF_COOKIE_NAME);
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const token =
      (typeof payload.csrfToken === 'string' && payload.csrfToken) ||
      (typeof payload.csrf_token === 'string' && payload.csrf_token) ||
      (typeof payload.token === 'string' && payload.token) ||
      ((payload.data && typeof payload.data === 'object' && typeof (payload.data as Record<string, unknown>).csrfToken === 'string')
        ? String((payload.data as Record<string, unknown>).csrfToken)
        : null);

    return token?.trim() || readCookie(CSRF_COOKIE_NAME);
  } catch {
    return readCookie(CSRF_COOKIE_NAME);
  }
}

export type BizCardPageProps = {
  /** When set (e.g. Company Admin Edit Employee), overrides `?bizcardId=` from the URL. */
  bizcardId?: string;
  /** Compact chrome for embedding inside another modal/panel. */
  embedded?: boolean;
};

/** Editor used by route pages and embedded (e.g. Edit Employee modal). */
export function BizCardPage({
  bizcardId: bizcardIdProp,
  embedded = false,
}: BizCardPageProps) {
  void embedded;
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedBizcardId =
    (bizcardIdProp?.trim() || searchParams.get('bizcardId')?.trim()) ?? '';
  /** Serial of a scanned/merged blank physical card to attach once this BizCard is saved. */
  const claimSerial = requestedBizcardId ? '' : (extractClaimSerial(searchParams.get('serial')) ?? '');
  const requestedTab = searchParams.get('tab')?.trim() as Tab | null;
  const [tab, setTab]               = useState<Tab>(
    requestedTab && TABS.some((item) => item.id === requestedTab) ? requestedTab : 'vcard'
  );

  useEffect(() => {
    if (requestedTab && TABS.some((item) => item.id === requestedTab) && requestedTab !== tab) {
      setTab(requestedTab);
    }
  }, [requestedTab, tab]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [saved, setSaved]           = useState(false);
  const [addressMapLinkError, setAddressMapLinkError] = useState<string | null>(null);
  const [setupCompleted, setSetupCompleted] = useState(false);
  /**
   * True when a user who already has a BizCard claims a blank card: the form starts empty and
   * saving creates a separate BizCard instead of updating the existing profile.
   */
  const [creatingClaimCard, setCreatingClaimCard] = useState(false);
  const [urlAliasEditable, setUrlAliasEditable] = useState<UrlAliasEditable | null>(null);
  const [bizcardId, setBizcardId] = useState('');
  const [bizCard, setBizCard]     = useState<BizCardFormData>(EMPTY_BIZCARD);
  const [vcard, setVcard]         = useState<VCardFormData>(EMPTY_VCARD);
  const [services, setServices]   = useState<ServiceItem[]>([]);
  const [selectedTheme, setTheme] = useState('elegant-dark');
  const [gallery, setGallery]     = useState<GalleryItem[]>([]);
  const [videos, setVideos]       = useState<VideoItem[]>([]);
  const [subscriptionTier, setSubscriptionTier] = useState('basic');
  const [canUploadGallery, setCanUploadGallery] = useState(false);
  const [showGallery, setShowGallery] = useState(true);
  const [isDevUser, setIsDevUser] = useState(false);
  const [showCoverPhoto, setShowCoverPhoto] = useState(true);
  const [showInquiryCard, setShowInquiryCard] = useState(true);
  const [showAssociateCount, setShowAssociateCount] = useState(false);
  const [showMutualAssociates, setShowMutualAssociates] = useState(false);
  const [showEmail, setShowEmail] = useState(true);
  const [contactLinkLabel, setContactLinkLabel] = useState<ContactLinkLabelMode>('link');
  const [livePreviewOpen, setLivePreviewOpen] = useState(false);
  const initialGalleryRef = useRef<GalleryItem[]>([]);
  const initialVideosRef = useRef<VideoItem[]>([]);
  const initialUrlAliasRef = useRef('');
  const originalSnapshotRef = useRef<BizcardSnapshot | null>(null);
  const buildPortfolioSnapshot = (overrideServices?: ServiceItem[]) => ({
    bizCard,
    vcard,
    services: overrideServices ?? services,
    selectedTheme,
    gallery,
    videos,
    showCoverPhoto,
    showInquiryCard,
    showAssociateCount,
    showMutualAssociates,
    showEmail,
    contactLinkLabel,
  });

  /** Live, unsaved editor state → portfolio payload for ThemeLoader preview. */
  const livePortfolioData = useMemo<PortfolioData>(
    () => ({
      bizCard,
      vcard,
      services,
      selectedTheme,
      gallery,
      videos,
      galleryAvailable: showGallery,
      inquiryEnabled: true,
      showCoverPhoto,
      showInquiryCard,
      showAssociateCount,
      showMutualAssociates,
      showEmail,
      contactLinkLabel,
      subscriptionTier,
    }),
    [
      bizCard,
      vcard,
      services,
      selectedTheme,
      gallery,
      videos,
      showGallery,
      showCoverPhoto,
      showInquiryCard,
      showAssociateCount,
      showMutualAssociates,
      showEmail,
      contactLinkLabel,
      subscriptionTier,
    ],
  );

  const livePreviewTheme = useMemo(
    () => getTheme(selectedTheme),
    [selectedTheme],
  );

  /** Mobile-only modal; desktop uses the docked side panel. */
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767px)');
    const sync = () => setIsNarrowViewport(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!(livePreviewOpen && isNarrowViewport)) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [livePreviewOpen, isNarrowViewport]);
  const publishThemeSelection = (themeId: string) => {
    const normalizedAlias = bizCard.urlAlias.trim();
    if (!normalizedAlias) return;
    publishPortfolioSnapshotUpdate({
      urlAlias: normalizedAlias,
      updater: (existing) => ({ ...existing, selectedTheme: themeId }),
    });
  };
  const applyThemeSelection = async (themeId: string) => {
    setTheme(themeId);
    publishThemeSelection(themeId);

    try {
      const saved = await persistThemePath(themeId, API);
      if (saved) return;

      const numeric = THEME_SLUG_MAP[themeId];
      if (numeric) {
        await applyThemeSelectionWithFallback({
          apiBase: API,
          themeId: numeric,
          previewOnly: false,
          fetcher: (url, init) => authFetch(String(url), init),
        });
      } else {
        console.warn('Theme slug persistence failed for:', themeId);
      }
    } catch (error) {
      const tagged = formatTaggedError(
        FrontendSubscriptionError.THEME_APPLY_FAILED,
        'Theme preview update failed. The selected theme will be retried on save.'
      );
      console.error(tagged, error);
    }
  };  
  const authFetch = async (url: string, init: RequestInit = {}, canRetry = true): Promise<Response> => {
    const method = String(init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers ?? undefined);
    if (MUTATING_METHODS.has(method)) {
      const csrfToken = await ensureCsrfToken();
      if (csrfToken) {
        headers.set('X-CSRF-Token', csrfToken);
      }
    }
    const mergedInit: RequestInit = {
      credentials: 'include',
      cache: 'no-store',
      ...init,
      method,
      headers: withCompanyActingHeaders(withImpersonationHeaders(headers)),
    };
    const res = await fetch(url, mergedInit);

    if (canRetry) {
      // Always attempt refresh on 401 (unauthenticated)
      if (res.status === 401) {
        const refreshHeaders = new Headers();
        const refreshCsrf = await ensureCsrfToken();
        if (refreshCsrf) refreshHeaders.set('X-CSRF-Token', refreshCsrf);
        const refreshRes = await fetch(`${API}/api/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: withCompanyActingHeaders(withImpersonationHeaders(refreshHeaders)),
        });
        if (refreshRes.ok) {
          return fetch(url, mergedInit);
        }
      }

      // For 403, only attempt a refresh+retry when the backend explicitly
      // indicates a CSRF problem. Avoid retrying on all 403s (CORS/forbidden)
      // which would be wasteful and misleading.
      if (res.status === 403) {
        try {
          const body = await res.clone().json();
          const code = String((body?.code ?? body?.error_code ?? '')).toUpperCase();
          if (code === 'CSRF_TOKEN_INVALID') {
            const refreshHeaders = new Headers();
            const refreshCsrf = await ensureCsrfToken();
            if (refreshCsrf) refreshHeaders.set('X-CSRF-Token', refreshCsrf);
            const refreshRes = await fetch(`${API}/api/auth/refresh`, {
              method: 'POST',
              credentials: 'include',
              cache: 'no-store',
              headers: withCompanyActingHeaders(withImpersonationHeaders(refreshHeaders)),
            });
            if (refreshRes.ok) {
              return fetch(url, mergedInit);
            }
          }
        } catch {
          // ignore non-JSON responses — do not retry
        }
      }
    }

    return res;
  };
  /* -- Load profile from API on mount -- */
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [sessionResult, subscriptionResult] = await Promise.allSettled([
          authFetch(`${API}/api/auth/session`),
          authFetch(`${API}/api/user/subscription`),
        ]);

        let nextIsDevUser = false;
        let nextSubscriptionTier = 'basic';
        let nextCanUploadGallery = false;
        let sessionUserId = '';

        if (sessionResult.status === 'fulfilled' && sessionResult.value.ok) {
          const sessionPayload = await sessionResult.value.json().catch(() => null) as Record<string, unknown> | null;
          const user = sessionPayload?.user as Record<string, unknown> | undefined;
          nextIsDevUser =
            String(user?.role ?? '').toLowerCase() === 'dev' ||
            String(user?.role ?? '').toLowerCase() === 'super_admin';
          sessionUserId = String(user?.userId ?? user?.user_id ?? user?.id ?? '').trim();
        }

        if (subscriptionResult.status === 'fulfilled' && subscriptionResult.value.ok) {
          const subscriptionPayload = await subscriptionResult.value.json().catch(() => null) as Record<string, unknown> | null;
          const subscriptionData = (subscriptionPayload?.data ?? subscriptionPayload) as Record<string, unknown> | null;
          const accessReason = String(subscriptionData?.access_reason ?? '').toLowerCase();
          const isTrial = Boolean(subscriptionData?.is_trial);
          const tierRaw = String(subscriptionData?.tier ?? 'basic').toLowerCase();
          nextSubscriptionTier =
            tierRaw === 'none' && (isTrial || accessReason === 'free_trial')
              ? 'free_trial'
              : tierRaw;
          const features = subscriptionData?.features as Record<string, unknown> | undefined;
          nextCanUploadGallery = nextIsDevUser || Boolean(features?.can_upload_gallery ?? features?.canUploadGallery);
        }

        if (alive) {
          setIsDevUser(nextIsDevUser);
          setSubscriptionTier(nextSubscriptionTier);
          setCanUploadGallery(nextCanUploadGallery);
        }

        const tierCards = await fetchUserBizcardTiers(API);
        if (alive) {
          setShowGallery(nextIsDevUser || hasStandardOrHigherBizcard(tierCards));
        }

        if (requestedBizcardId) {
          const bizRes = await authFetch(`${API}/api/user/bizcards/${encodeURIComponent(requestedBizcardId)}`);
          if (bizRes.ok) {
            const bizPayload = await bizRes.json().catch(() => null) as Record<string, unknown> | null;
            const card = (bizPayload?.data as Record<string, unknown> | undefined)?.bizcard as Record<string, unknown> | undefined
              ?? (bizPayload?.bizcard as Record<string, unknown> | undefined);
            if (card && alive) {
              const alias = String(card.url_alias ?? '').trim();
              const resolvedId = String(card.bizcard_id ?? requestedBizcardId).trim();
              recordLastAccessedBizcard({
                bizcard_id: resolvedId,
                serial_id: String(card.serial_id ?? ''),
                bizcard_name: resolveBizcardDisplayName(card),
                bizcard_theme: String(card.bizcard_theme ?? 'elegant-dark'),
                created_at: card.created_at ? String(card.created_at) : undefined,
              });

              let endpointGallery: GalleryItem[] = [];
              let endpointVideos: VideoItem[] = [];
              try {
                const galleryRes = await authFetch(`${API}/api/bizcard/${encodeURIComponent(resolvedId)}/gallery`);
                if (galleryRes.ok) {
                  const galleryPayload = await galleryRes.json();
                  const galleryData = (galleryPayload?.data ?? galleryPayload) as Record<string, unknown>;
                  const ownerMedia = Array.isArray(galleryData.media)
                    ? galleryData.media
                    : Array.isArray(galleryData.gallery)
                      ? galleryData.gallery
                      : [];
                  endpointGallery = ownerMedia
                    .map((item: Record<string, unknown>, index: number) => mapGalleryItem(item, index))
                    .filter((item): item is GalleryItem => Boolean(item))
                    .filter((item) => !isPortfolioVideoMedia({
                      url: item.url,
                      fileName: item.fileName,
                      mimeType: item.mimeType,
                    }));
                  endpointVideos = mapOwnerMediaToVideos(
                    ownerMedia as Record<string, unknown>[],
                  );
                }
              } catch {
                // gallery optional
              }

              const apiServices = Array.isArray(card.services) ? (card.services as Record<string, unknown>[]) : [];
              let mappedServices = apiServices.map((s, i) => mapApiServiceToUi(s, i));

              try {
                const scopedParams: string[] = ['type=all'];
                if (sessionUserId) {
                  scopedParams.unshift(`userId=${encodeURIComponent(sessionUserId)}`);
                } else if (alias) {
                  scopedParams.unshift(`username=${encodeURIComponent(alias)}`);
                }

                if (sessionUserId || alias) {
                  const modularRes = await authFetch(`${API}/api/vcard/services?${scopedParams.join('&')}`);
                  if (modularRes.ok) {
                    const modularPayload = await modularRes.json();
                    const modularData = (modularPayload?.data ?? {}) as Record<string, unknown>;
                    const modularServicesRaw = Array.isArray(modularData.services) ? modularData.services : [];
                    const modularServices = modularServicesRaw
                      .map((s: Record<string, unknown>, i: number) => mapApiServiceToUi(s, i))
                      .filter((s: ServiceItem) => Boolean(s.title || s.description || s.videoUrl || s.featured_image));

                    if (modularServices.length > 0) {
                      mappedServices = mappedServices.length > 0
                        ? mergeServiceImages(modularServices, mappedServices)
                        : modularServices;
                    }
                  }
                }
              } catch {
                // keep bizcard-detail services if modular fetch fails
              }

              const rawSocials = Array.isArray(card.social_links)
                ? (card.social_links as Record<string, unknown>[])
                : [];

              setSetupCompleted(true);
              setUrlAliasEditable(parseUrlAliasEditable(card.url_alias_editable));
              setBizcardId(resolvedId);
              initialUrlAliasRef.current = alias;
              setBizCard({
                urlAlias: alias,
                bizCardName: String(card.bizcard_name ?? ''),
                description: String(card.description ?? ''),
                occupation: String(card.occupation ?? card.professional_title ?? ''),
                profileImage: (card.profile_img as string | null) ?? null,
                coverImage: (card.cover_img as string | null) ?? null,
                coverImagePosition: 'center center',
                coverType: inferCoverTypeFromUrl((card.cover_img as string | null) ?? null),
                coverFileName: null,
              });
              setVcard({
                firstName: String(card.first_name ?? ''),
                middleName: String(card.middle_name ?? ''),
                lastName: String(card.last_name ?? ''),
                professionalTitle: String(card.professional_title ?? ''),
                postNominalLetters: String(card.post_nominal ?? ''),
                suffix: String(card.suffix ?? 'N/A'),
                about: String(card.bio ?? ''),
                contactNumber: String(card.contact_number ?? '').replace(/^\+63/, ''),
                secondaryNumber: String(card.alt_contact_number ?? '').replace(/^\+63/, ''),
                telephoneNumber: String(card.telephone_number ?? ''),
                altTelephoneNumber: String(card.alt_telephone_number ?? ''),
                email: String(card.email ?? ''),
                alternativeEmail: String(card.alt_email ?? ''),
                languages: Array.isArray(card.languages) ? (card.languages as string[]).join(', ') : String(card.languages ?? ''),
                addressArea: String(card.area ?? ''),
                addressHouseNo: '',
                addressBrgy: String(card.baranggay ?? ''),
                addressCity: String(card.city ?? ''),
                addressRegion: String(card.region ?? ''),
                addressZipcode: String(card.zip_code ?? ''),
                addressMapLink: String(card.address_link ?? ''),
                addressLandmark: '',
                addressLatitude: null,
                addressLongitude: null,
                socialLinks: mapApiSocialsToUi(rawSocials),
              });
              setServices(mappedServices);
              setGallery(endpointGallery);
              setVideos(endpointVideos);
              initialGalleryRef.current = endpointGallery;
              initialVideosRef.current = endpointVideos;
              // Load display toggle settings
              setShowCoverPhoto(Boolean(card.show_cover_photo ?? true));
              setShowInquiryCard(Boolean(card.show_inquiry_card ?? true));
              setShowAssociateCount(card.show_associate_count === true);
              setShowMutualAssociates(card.show_mutual_associates === true);
              setShowEmail(card.show_email !== false);
              setContactLinkLabel(toContactLinkLabelMode(card.contact_link_label));
              setTheme(normalizePortfolioThemeId(card.bizcard_theme) || 'elegant-dark');
              setLoading(false);
              return;
            }
          }
        }

        const profileRes = await authFetch(`${API}/api/vcard/profile`);
        const profilePayload = profileRes.ok ? await profileRes.json() : null;
        const p = profilePayload?.profile as Record<string, unknown> | undefined;
        if (!p) {
          if (!alive) return;
          setServices([]);
          setGallery([]);
          setVideos([]);
          setLoading(false);
          return;
        }
        const addresses = Array.isArray(p.addresses) ? (p.addresses as Record<string, unknown>[]) : [];
        const fallbackAddress = (p.address && typeof p.address === 'object')
          ? (p.address as Record<string, unknown>)
          : {};
        const addr = addresses[0] ?? fallbackAddress;
        const apiServices = Array.isArray(p.services) ? (p.services as Record<string, unknown>[]) : [];
        const normalizedProfileServices = apiServices
          .filter((s) => {
            const visible = s.is_visible !== false && s.isVisible !== false;
            if (!visible) return false;
            const name = String(s.name ?? '').trim();
            const description = String(s.description ?? '').trim();
            const serviceUrl = String(s.service_url ?? s.serviceUrl ?? '').trim();
            const hasImage = Boolean(pickServiceImage(s));
            return Boolean(name || description || serviceUrl || hasImage);
          })
          .map((s, i) => mapApiServiceToUi(s, i));
        const hasCoreProfileData = Boolean(
          p.custom_uri ||
          p.vcard_name ||
          p.vcard_description ||
          p.first_name ||
          p.last_name ||
          p.job_position ||
          p.about ||
          p.profile_url ||
          p.cover_url ||
          p.contact ||
          p.email ||
          (Array.isArray(p.socials) && p.socials.length > 0)
        );
        const completed = Boolean((p.vcardSetup as { setup_completed?: boolean } | undefined)?.setup_completed || p.vcard_published || hasCoreProfileData);
        if (claimSerial && completed) {
          if (!alive) return;
          setCreatingClaimCard(true);
          setLoading(false);
          return;
        }
        const userId = String(p.user_id ?? '').trim();
        const alias = String(p.custom_uri ?? '').trim();
        
        // Load display toggle settings
        setShowCoverPhoto(Boolean(p.show_cover_photo ?? true));
        setShowInquiryCard(Boolean(p.show_inquiry_card ?? true));
        setShowAssociateCount(p.show_associate_count === true);
        setShowMutualAssociates(p.show_mutual_associates === true);
        setShowEmail(p.show_email !== false);
        setContactLinkLabel(toContactLinkLabelMode(p.contact_link_label));
        let endpointServices: ServiceItem[] = [...normalizedProfileServices];
        let endpointGallery: GalleryItem[] = [];
        let endpointVideos: VideoItem[] = [];

        try {
          const ownerBizcardId = String(p.bizcard_id ?? p.bizcardId ?? '').trim();
          if (ownerBizcardId) {
            const ownerGalleryRes = await authFetch(`${API}/api/bizcard/${encodeURIComponent(ownerBizcardId)}/gallery`);
            if (ownerGalleryRes.ok) {
            const ownerGalleryPayload = await ownerGalleryRes.json();
            const ownerGalleryData = (ownerGalleryPayload?.data ?? ownerGalleryPayload) as Record<string, unknown>;
            const ownerMedia = Array.isArray(ownerGalleryData.media)
              ? ownerGalleryData.media
              : Array.isArray(ownerGalleryData.gallery)
                ? ownerGalleryData.gallery
                : [];

            endpointGallery = ownerMedia
              .map((item: Record<string, unknown>, index: number) => mapGalleryItem(item, index))
              .filter((item): item is GalleryItem => Boolean(item))
              .filter((item) => !isPortfolioVideoMedia({
                url: item.url,
                fileName: item.fileName,
                mimeType: item.mimeType,
              }));
            endpointVideos = mapOwnerMediaToVideos(
              ownerMedia as Record<string, unknown>[],
            );
            }
          }
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error ?? '');
          if (/ssl|protocol|https|mixed content/i.test(text)) {
            const tagged = formatTaggedError(
              FrontendSubscriptionError.GALLERY_SSL_ERROR,
              'Gallery request failed due to protocol mismatch. Verify API base URL and HTTPS settings.'
            );
            console.error(tagged, error);
          }
          // Keep local snapshot fallback below if owner gallery read fails.
        }

        try {
          const scopedParams: string[] = ['type=all'];
          if (userId) {
            scopedParams.unshift(`userId=${encodeURIComponent(userId)}`);
          } else if (alias) {
            scopedParams.unshift(`username=${encodeURIComponent(alias)}`);
          }

          if (userId || alias) {
            const modularRes = await authFetch(`${API}/api/vcard/services?${scopedParams.join('&')}`);
            if (modularRes.ok) {
              const modularPayload = await modularRes.json();
              const modularData = (modularPayload?.data ?? {}) as Record<string, unknown>;

              const modularServicesRaw = Array.isArray(modularData.services) ? modularData.services : [];
              const modularServices = modularServicesRaw
                .map((s: Record<string, unknown>, i: number) => mapApiServiceToUi(s, i))
                .filter((s: ServiceItem) => Boolean(s.title || s.description || s.videoUrl || s.featured_image));

              if (modularServices.length > 0) {
                endpointServices = endpointServices.length > 0
                  ? mergeServiceImages(modularServices, endpointServices)
                  : modularServices;
              }

              // Do not hydrate Gallery/Videos from /api/vcard/services —
              // that endpoint no longer projects service media as portfolio gallery.
            }
          }
        } catch {
          // keep existing profile-derived data
        }

        if (endpointVideos.length === 0 && endpointServices.length > 0) {
          endpointVideos = endpointServices
            .filter((svc) => svc.videoUrl.trim().startsWith('http'))
            .map((svc, index) => ({
              id: svc.id || index + 1,
              title: svc.title || `Video ${index + 1}`,
              description: svc.description || svc.tagline || '',
              fileName: svc.videoUrl,
              fileSize: 0,
              mimeType: null,
              videoDataUrl: null,
            }));
        }

        if (!alive) return;

        setSetupCompleted(completed);
        setUrlAliasEditable(parseUrlAliasEditable(p.url_alias_editable));
        setBizcardId(String(p.bizcard_id ?? p.bizcardId ?? '').trim());
        initialUrlAliasRef.current = alias;
        setBizCard({
          urlAlias: alias,
          bizCardName: String(p.vcard_name ?? ''),
          description: String(p.vcard_description ?? ''),
          occupation: String(p.job_position ?? ''),
          profileImage: (p.profile_url as string | null) ?? null,
          coverImage: (p.cover_url as string | null) ?? null,
          coverImagePosition: String(p.cover_img_position ?? 'center center'),
          coverType: inferCoverTypeFromUrl((p.cover_url as string | null) ?? null),
          coverFileName: null,
        });

        const rawSocials = Array.isArray(p.socials)
          ? (p.socials as Record<string, unknown>[])
          : Array.isArray(p.social_links)
            ? (p.social_links as Record<string, unknown>[])
            : [];

        setVcard({
          firstName: String(p.first_name ?? ''),
          middleName: String(p.middle_name ?? ''),
          lastName: String(p.last_name ?? ''),
          professionalTitle: '',
          postNominalLetters: String(p.post_nominal ?? ''),
          suffix: String(p.suffix ?? 'N/A'),
          about: String(p.about ?? ''),
          contactNumber: String(p.contact ?? '').replace(/^\+63/, ''),
          secondaryNumber: String(p.alt_contact ?? '').replace(/^\+63/, ''),
          telephoneNumber: String(p.telephone ?? ''),
          altTelephoneNumber: String(p.alt_telephone ?? ''),
          email: String(p.email ?? ''),
          alternativeEmail: String(p.alt_email ?? ''),
          languages: String(p.languages ?? ''),
          addressArea: String(addr.area ?? ''),
          addressHouseNo: '',
          addressBrgy: String(addr.brgy ?? ''),
          addressCity: String(addr.city ?? ''),
          addressRegion: String(addr.region ?? ''),
          addressZipcode: String(addr.zipcode ?? ''),
          addressMapLink: String(addr.map_link ?? addr.plus_code ?? ''),
          addressLandmark: String(addr.landmark ?? ''),
          addressLatitude: addr.latitude != null ? Number(addr.latitude) : null,
          addressLongitude: addr.longitude != null ? Number(addr.longitude) : null,
          socialLinks: mapApiSocialsToUi(rawSocials),
        });

        setServices((endpointServices.length > 0 ? endpointServices : (completed ? normalizedProfileServices : [])));
        setGallery(endpointGallery);
        setVideos(endpointVideos);
        initialGalleryRef.current = endpointGallery;
        initialVideosRef.current = endpointVideos;
        const themeFromPath = normalizePortfolioThemeId(p.theme_path ?? p.themePath);
        const themeFromId = THEME_ID_MAP[String(p.theme_id ?? '1')] ?? 'elegant-dark';
        const resolvedTheme = themeFromPath || themeFromId;
        setTheme(resolvedTheme);

        // Gallery comes from the API only — never hydrate from device gallery_* blobs.

        setLoading(false);
      } catch {
        if (!alive) return;
        setServices([]);
        setGallery([]);
        setVideos([]);
        setLoading(false);
      }
    };

    void load();
    return () => {
      alive = false;
    };
  }, [requestedBizcardId, claimSerial]);

  useEffect(() => {
    if (claimSerial) persistClaimSerial(claimSerial);
  }, [claimSerial]);

  /* -- Keep original snapshot for delta saves (no device portfolio content cache) -- */
  useEffect(() => {
    if (loading) return;

    const cacheIdentifier = bizcardId || bizCard.urlAlias.trim();
    if (!cacheIdentifier) return;

    const snapshot: BizcardSnapshot = {
      bizCard,
      vcard,
      services,
      selectedTheme,
      gallery,
      videos,
      showCoverPhoto,
      showInquiryCard,
      showAssociateCount,
      showMutualAssociates,
      showEmail,
      contactLinkLabel,
    };

    if (!originalSnapshotRef.current) {
      originalSnapshotRef.current = { ...snapshot };
    }
  }, [
    loading,
    bizcardId,
    bizCard,
    vcard,
    services,
    selectedTheme,
    gallery,
    videos,
    showCoverPhoto,
    showInquiryCard,
    showAssociateCount,
    showMutualAssociates,
    showEmail,
    contactLinkLabel,
  ]);

  /* -- Upload a base64 data URI to the media API, return the CDN URL -- */
  const uploadMedia = async (
    dataUri: string,
    context: 'profile' | 'cover' | 'service' | 'portfolio',
    serviceId?: string,
  ): Promise<string | null> => {
    try {
      const blob = dataUrlToBlob(dataUri);
      const mime = blob.type.toLowerCase();
      const ext =
        mime.includes('png') ? 'png'
          : mime.includes('webp') ? 'webp'
            : mime.includes('gif') ? 'gif'
              : mime.includes('mp4') ? 'mp4'
                : mime.includes('quicktime') ? 'mov'
                  : mime.includes('webm') ? 'webm'
                    : 'jpg';
      const fd   = new FormData();
      fd.append('file', new File([blob], `${context}.${ext}`, { type: blob.type }));
      fd.append('context', context);
      if (serviceId) fd.append('service_id', serviceId);
      const r = await authFetch(`${API}/api/media/upload`, {
        method: 'POST',
        body: fd,
      });
      if (!r.ok) return null;
      const d = await r.json();
      return (d.url as string) ?? null;
    } catch {
      return null;
    }
  };

  const fetchSavedServices = async (): Promise<{ service_id?: string; display_order?: number; displayOrder?: number; id?: string | number }[]> => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const profileRes = await authFetch(`${API}/api/vcard/profile`);
        if (!profileRes.ok) continue;
        const profilePayload = await profileRes.json();
        const list = profilePayload?.profile?.services;
        if (Array.isArray(list) && list.length > 0) return list;

        const profile = (profilePayload?.profile ?? {}) as Record<string, unknown>;
        const userId = String(profile.user_id ?? '').trim();
        const alias = String(profile.custom_uri ?? '').trim();

        if (userId || alias) {
          const query = userId
            ? `userId=${encodeURIComponent(userId)}&type=services`
            : `username=${encodeURIComponent(alias)}&type=services`;

          const scopedRes = await authFetch(`${API}/api/vcard/services?${query}`);
          if (scopedRes.ok) {
            const scopedPayload = await scopedRes.json();
            const scopedData = (scopedPayload?.data ?? {}) as Record<string, unknown>;
            const scopedServices = Array.isArray(scopedData.services) ? scopedData.services : [];
            if (scopedServices.length > 0) {
              return scopedServices.map((s: Record<string, unknown>, i: number) => ({
                service_id: String(s.service_id ?? s.id ?? '').trim(),
                display_order: Number(s.display_order ?? s.displayOrder ?? i),
              }));
            }
          }
        }
      } catch {
        // retry
      }
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    return [];
  };

  const serializeSocialLinks = useCallback((links: SocialLink[]) => (
    serializeSocialLinksForApi(links)
  ), []);

  const persistSocialLinks = useCallback(async (links: SocialLink[]) => {
    if (!setupCompleted) return;

    const body = {
      socials: serializeSocialLinks(links),
      publishNow: true,
    };

    try {
      const res = await authFetch(`${API}/api/vcard/profile`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) return;

      const normalizedAlias = bizCard.urlAlias.trim();
      if (normalizedAlias) {
        try {
          localStorage.setItem('portfolio_refresh_ts', String(Date.now()));
        } catch {
          // ignore local cache write failures
        }
      }
      dispatchUserSync();
    } catch (error) {
      console.error('[BizCardPage] Failed to persist social links:', error);
    }
  }, [setupCompleted, bizCard.urlAlias, serializeSocialLinks]);

  /* -- Attach the scanned blank physical card to a saved virtual BizCard -- */
  const linkClaimSerial = async (virtualCardId: string): Promise<boolean> => {
    const failureMessage = 'BizCard saved, but linking the physical card failed. Try merging from your BizCard list.';
    try {
      const res = await authFetch(`${API}/api/bizcard/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialId: claimSerial, virtualCardId }),
      });
      const payload = await res.json().catch(() => null) as
        { success?: boolean; error?: { message?: string } } | null;
      if (res.ok && payload?.success) return true;
      showToast(payload?.error?.message || failureMessage, 'error');
    } catch {
      showToast(failureMessage, 'error');
    }
    return false;
  };

  /* -- Create a separate BizCard for a claimed blank card (user already has one) -- */
  const createClaimedBizcard = async () => {
    const missing = [
      !bizCard.bizCardName.trim() && 'BizCard Name',
      !vcard.firstName.trim() && 'First Name',
      !vcard.lastName.trim() && 'Last Name',
      !(vcard.contactNumber.trim() || vcard.telephoneNumber.trim()) && 'Mobile or Telephone',
    ].filter(Boolean);
    if (missing.length > 0) {
      showToast(`Please complete: ${missing.join(', ')}.`, 'error');
      setSaving(false);
      return;
    }

    try {
      const res = await authFetch(`${API}/api/user/bizcards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bizcard_name: bizCard.bizCardName.trim(),
          url_alias: bizCard.urlAlias.trim() ? sanitizeUrlAlias(bizCard.urlAlias) : null,
          description: bizCard.description.trim() || null,
          first_name: vcard.firstName.trim(),
          middle_name: vcard.middleName.trim() || null,
          last_name: vcard.lastName.trim(),
          professional_title: vcard.professionalTitle.trim() || null,
          email: vcard.email.trim(),
          contact_number: vcard.contactNumber.trim() ? normalizeContactNumber(vcard.contactNumber) : '',
          alt_contact_number: vcard.secondaryNumber.trim() ? normalizeContactNumber(vcard.secondaryNumber) : null,
          telephone_number: vcard.telephoneNumber.trim() ? normalizeTelephoneForApi(vcard.telephoneNumber) : null,
          alt_telephone_number: vcard.altTelephoneNumber.trim() ? normalizeTelephoneForApi(vcard.altTelephoneNumber) : null,
          alt_email: vcard.alternativeEmail.trim() || null,
          city: vcard.addressCity,
          bizcard_type: 'virtual',
          copy_from: null,
        }),
      });
      const payload = await res.json().catch(() => null) as Record<string, unknown> | null;
      if (!res.ok || payload?.success !== true) {
        const message = typeof payload?.error === 'string'
          ? payload.error
          : typeof payload?.message === 'string'
            ? payload.message
            : 'Unable to create BizCard. Please check your entries and try again.';
        showToast(message, 'error');
        return;
      }

      const created = (payload.data ?? null) as Record<string, unknown> | null;
      const createdBizcardId = String(created?.bizcard_id ?? '').trim();
      const createdAlias = String(created?.url_alias ?? bizCard.urlAlias).trim();

      if (createdBizcardId) {
        await linkClaimSerial(createdBizcardId);
        const theme = normalizePortfolioThemeId(selectedTheme);
        if (theme) {
          await authFetch(`${API}/api/bizcard/update`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bizcard_id: createdBizcardId, bizcard_theme: theme }),
          }).catch(() => {
            // Non-blocking: the BizCard itself was created.
          });
        }
      }

      try {
        if (createdAlias) {
          localStorage.setItem('latestPortfolioAlias', createdAlias);
          localStorage.setItem('portfolio_refresh_ts', String(Date.now()));
        }
        localStorage.setItem('frontend_new_bizcard_refresh', String(Date.now()));
        localStorage.setItem('frontend_new_bizcard_toast', 'BizCard created successfully.');
      } catch {
        // ignore local storage failures
      }
      dispatchUserSync();
      setSaved(true);
      router.push('/user/bizcard-list');
    } catch {
      showToast('Network error. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  /* -- Save to API -- */
  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setAddressMapLinkError(null);

    const hasAddressInput =
      vcard.addressMapLink.trim() ||
      vcard.addressArea.trim() ||
      vcard.addressBrgy.trim() ||
      vcard.addressZipcode.trim() ||
      vcard.addressHouseNo.trim() ||
      vcard.addressLandmark.trim() ||
      vcard.addressLatitude != null ||
      vcard.addressLongitude != null;

    if (hasAddressInput && !vcard.addressMapLink.trim()) {
      setAddressMapLinkError('Google Maps link is required when adding location details.');
      showToast('Google Maps link is required when adding location details.', 'error');
      setSaving(false);
      return;
    }

    const contactError = validateContactFieldValues(
      {
        email: vcard.email,
        alternativeEmail: vcard.alternativeEmail,
        contactNumber: vcard.contactNumber,
        secondaryNumber: vcard.secondaryNumber,
        telephoneNumber: vcard.telephoneNumber,
        altTelephoneNumber: vcard.altTelephoneNumber,
      },
      { requireEmail: true },
    );
    if (contactError) {
      showToast(contactError, 'error');
      setSaving(false);
      return;
    }

    if (creatingClaimCard) {
      await createClaimedBizcard();
      return;
    }

    // Build current snapshot for delta calculation
    const currentSnapshot: BizcardSnapshot = {
      bizCard,
      vcard,
      services,
      selectedTheme,
      gallery,
      videos,
      showCoverPhoto,
      showInquiryCard,
      showAssociateCount,
      showMutualAssociates,
      showEmail,
      contactLinkLabel,
    };

    // If no original snapshot yet, use current as original (first save)
    if (!originalSnapshotRef.current) {
      originalSnapshotRef.current = { ...currentSnapshot };
    }

    // Calculate delta (changed fields only)
    const trimmedAlias = bizCard.urlAlias.trim();
    const aliasChanged = trimmedAlias !== initialUrlAliasRef.current;
    const delta = computeProfileDelta(
      originalSnapshotRef.current,
      currentSnapshot,
      aliasChanged,
      urlAliasEditable?.allowed ?? null
    );

    // For now, we'll use mergeWithDefaults to ensure backward compatibility
    // In the future, we could send just the delta for optimal bandwidth usage
    const sendDeltaOnly = false; // Set to true when backend supports delta payloads

    const endpoint = setupCompleted
      ? `${API}/api/vcard/profile`
      : `${API}/api/vcard/setup`;
    const method = setupCompleted ? 'PUT' : 'POST';

    /* -- Upload images that are still base64 data URIs before sending the profile save -- */
    let profileUrl: string | null = bizCard.profileImage?.startsWith('http') ? bizCard.profileImage : null;
    let coverUrl:   string | null = bizCard.coverImage?.startsWith('http')   ? bizCard.coverImage   : null;

    if (bizCard.profileImage?.startsWith('data:')) {
      const uploaded = await uploadMedia(bizCard.profileImage, 'profile');
      if (!uploaded) {
        showToast('Profile image upload failed. Please try again.', 'error');
        setSaving(false);
        return;
      }
      profileUrl = uploaded;
      setBizCard(p => ({ ...p, profileImage: uploaded }));
    }

    if (bizCard.coverImage?.startsWith('data:')) {
      const uploaded = await uploadMedia(bizCard.coverImage, 'cover');
      if (!uploaded) {
        showToast('Cover image upload failed. Please try again.', 'error');
        setSaving(false);
        return;
      }
      coverUrl = uploaded;
      setBizCard(p => ({ ...p, coverImage: uploaded }));
    }

    const toAbsoluteMediaUrl = (url: string): string => {
      const trimmed = url.trim();
      if (!trimmed) return '';
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) {
        return trimmed;
      }
      if (trimmed.startsWith('/')) {
        if (typeof window !== 'undefined' && window.location?.origin) {
          return `${window.location.origin}${trimmed}`;
        }
      }
      return trimmed;
    };

    const servicesForPayload = await Promise.all(
      services
        .filter((s) => s.title.trim())
        .map(async (s, i) => {
          const media = (s.media ?? [])
            .map((m, mediaIndex) => {
              const absoluteUrl = toAbsoluteMediaUrl(String(m.url ?? ''));
              if (!absoluteUrl || absoluteUrl.startsWith('data:')) return null;
              return {
                url: absoluteUrl,
                mimeType: String(m.mimeType ?? 'image/jpeg').trim() || 'image/jpeg',
                fileName: m.fileName ? String(m.fileName) : null,
                displayOrder: mediaIndex,
                bytes: null as number | null,
              };
            })
            .filter((m): m is NonNullable<typeof m> => Boolean(m));

          let featuredImage: string | undefined;
          const rawFeatured = String(s.featured_image ?? '').trim();
          if (rawFeatured && !rawFeatured.startsWith('data:')) {
            const absoluteFeatured = toAbsoluteMediaUrl(rawFeatured);
            if (absoluteFeatured.startsWith('http')) {
              featuredImage = absoluteFeatured;
            }
          }
          if (!featuredImage) {
            const firstImage = media.find(
              (m) => !String(m.mimeType).toLowerCase().startsWith('video/'),
            );
            featuredImage = firstImage?.url ?? media[0]?.url;
          }

          return {
            name: s.title.trim(),
            tagline: s.tagline.trim() || undefined,
            description: (s.description || s.title).trim(),
            serviceUrl: s.videoUrl.trim() ? normalizeHttpUrl(s.videoUrl.trim()) : undefined,
            featured_image: featuredImage,
            displayOrder: i,
            isVisible: true,
            media,
          };
        })
    );

    // Build the final payload - using delta merged with defaults for backward compatibility
    let body: Record<string, unknown>;
    if (sendDeltaOnly && hasMeaningfulChanges(delta)) {
      // If backend supports delta payloads, send only changed fields
      body = delta;
    } else {
      // Otherwise, send full merged payload for compatibility
      body = mergeWithDefaults(delta, currentSnapshot);
    }

    // Update image URLs from uploads
    if (profileUrl) body.profileUrl = profileUrl;
    if (coverUrl) body.coverUrl = coverUrl;

    // Merge in the pre-serialized services and socials (they handle their own formatting)
    body.services = servicesForPayload;
    body.socials = serializeSocialLinks(vcard.socialLinks);
    body.showCoverPhoto = showCoverPhoto;
    body.showInquiryCard = showInquiryCard;
    body.showAssociateCount = showAssociateCount;
    body.showMutualAssociates = showMutualAssociates;
    body.showEmail = showEmail;
    body.show_cover_photo = showCoverPhoto;
    body.show_inquiry_card = showInquiryCard;
    body.show_associate_count = showAssociateCount;
    body.show_mutual_associates = showMutualAssociates;
    body.show_email = showEmail;
    body.contactLinkLabel = contactLinkLabel;
    body.publishNow = true;

    if (typeof body.customUri === 'string') {
      body.customUri = sanitizeUrlAlias(body.customUri);
    } else if (bizCard.urlAlias.trim()) {
      body.customUri = sanitizeUrlAlias(bizCard.urlAlias);
    }

    // Add address if present
    const addressPayload = buildAddressApiPayload(vcard);
    if (addressPayload) {
      body.address = Object.fromEntries(
        Object.entries(addressPayload as Record<string, unknown>).filter(([, v]) => v !== undefined)
      );
    } else {
      delete body.address;
    }

    // Normalize phone / telephone for server digit rules (avoid formatted-string 422s).
    if (typeof body.contact === 'string' && body.contact.trim()) {
      body.contact = normalizeContactNumber(body.contact);
    }
    if (typeof body.altContact === 'string' && body.altContact.trim()) {
      body.altContact = normalizeContactNumber(body.altContact);
    }
    if (typeof body.telephone === 'string' && body.telephone.trim()) {
      body.telephone = normalizeTelephoneForApi(body.telephone);
    }
    if (typeof body.altTelephone === 'string' && body.altTelephone.trim()) {
      body.altTelephone = normalizeTelephoneForApi(body.altTelephone);
    }

    try {
      const res  = await authFetch(endpoint, {
        method, credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let data: {
        message?: string;
        error?: string;
        code?: string;
        daysRemaining?: number;
        details?: string[];
        profile?: {
          services?: { service_id?: string; display_order?: number }[];
          url_alias_editable?: unknown;
          custom_uri?: string;
        };
      } = {};
      try { data = JSON.parse(text); } catch { /* non-JSON */ }
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          const code = String(data.code ?? '').toUpperCase();
          if (code === 'URL_ALIAS_LOCKED') {
            showToast(
              data.daysRemaining
                ? `URL alias is locked. You can change it again in ${data.daysRemaining} days.`
                : 'URL alias is locked and cannot be changed yet.',
              'error',
            );
            return;
          }
          showToast('Your session expired. Please sign in again, then retry saving.', 'error');
          return;
        }
        const msg = data.details?.join(', ') ?? data.error ?? `Error ${res.status}`;
        showToast(msg, 'error');
      } else {
        setSetupCompleted(true);

        // Theme is persisted separately via the Design tab — do not re-apply here
        // because legacy themeId mapping would reset non-legacy palette selections.
        publishThemeSelection(selectedTheme);

        /* -- Upload service images that are base64, matched to saved service_id by display_order -- */
        let savedSvcs: { service_id?: string; display_order?: number; displayOrder?: number; id?: string | number }[] =
          Array.isArray(data.profile?.services) ? data.profile.services : [];
        if (savedSvcs.length === 0) {
          savedSvcs = await fetchSavedServices();
        }

        const uploadedServiceUrls = new Map<number, string>();
        const uploads = services
          .map((svc, i) => ({ svc, i }))
          .filter(({ svc }) => svc.featured_image?.startsWith('data:'))
          .map(async ({ svc, i }) => {
            const match = savedSvcs.find(ss => Number(ss.display_order ?? ss.displayOrder) === i);
            const serviceId = String(match?.service_id ?? match?.id ?? '').trim();
            if (!serviceId) return;
            const url = await uploadMedia(svc.featured_image!, 'service', serviceId);
            if (!url) return;

            uploadedServiceUrls.set(svc.id, url);

            // Persist the featured image URL on the service row so public services
            // endpoints render it in Services (not only in service gallery media).
            await authFetch(`${API}/api/bizcard/services/${encodeURIComponent(serviceId)}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ featuredImageUrl: url }),
            }).catch(() => {
              // Non-blocking; service media already uploaded.
            });
          });
        await Promise.allSettled(uploads);

        const servicesWithUploadedMedia = services.map((s) => (
          uploadedServiceUrls.has(s.id)
            ? { ...s, featured_image: uploadedServiceUrls.get(s.id) ?? s.featured_image }
            : s
        ));

        if (uploadedServiceUrls.size > 0) {
          setServices(servicesWithUploadedMedia);
        }

        const resolvedBizcardId = bizcardId || String((data.profile as Record<string, unknown> | undefined)?.bizcard_id ?? '').trim();
        if (resolvedBizcardId) {
          setBizcardId(resolvedBizcardId);
        }
        if (claimSerial && resolvedBizcardId && (await linkClaimSerial(resolvedBizcardId))) {
          showToast(`Physical card ${claimSerial} is now linked to this BizCard.`, 'success');
          router.replace(window.location.pathname);
        }
        const galleryEndpointBase = resolvedBizcardId ? `/api/bizcard/${encodeURIComponent(resolvedBizcardId)}/gallery` : '';

        const persistedGallery = await Promise.all(
          gallery.map(async (item) => {
            if (!item.imageDataUrl?.startsWith('data:') || !galleryEndpointBase) {
              return item.url.startsWith('http') ? { ...item, imageDataUrl: null } : item;
            }
            try {
              const blob = dataUrlToBlob(item.imageDataUrl);
              const fd = new FormData();
              fd.append('file', new File([blob], item.fileName || `gallery-${item.id}.jpg`, { type: blob.type || item.mimeType || 'image/jpeg' }));
              fd.append('title', item.title);
              fd.append('description', item.description);
              fd.append('alt_text', item.altText ?? item.title);
              fd.append('category', 'gallery');
              const uploadRes = await authFetch(galleryEndpointBase, { method: 'POST', body: fd });
              if (!uploadRes.ok) return item;
              const uploadPayload = await uploadRes.json();
              const created = (uploadPayload.data ?? uploadPayload) as Record<string, unknown>;
              return {
                ...item,
                id: Number(created.id ?? item.id),
                url: String(created.url ?? created.file_url ?? created.secure_url ?? '').trim() || item.url,
                imageDataUrl: null,
              };
            } catch {
              return item;
            }
          })
        );

        const persistedVideos = await Promise.all(
          videos.map(async (video) => {
            if (video.videoDataUrl?.startsWith('data:') && galleryEndpointBase) {
              try {
                const blob = dataUrlToBlob(video.videoDataUrl);
                const fd = new FormData();
                fd.append('file', new File([blob], video.fileName || `video-${video.id}.mp4`, { type: blob.type || video.mimeType || 'video/mp4' }));
                fd.append('title', video.title);
                fd.append('description', video.description);
                fd.append('category', 'video');
                const uploadRes = await authFetch(galleryEndpointBase, { method: 'POST', body: fd });
                if (!uploadRes.ok) return video;
                const uploadPayload = await uploadRes.json();
                const created = (uploadPayload.data ?? uploadPayload) as Record<string, unknown>;
                return {
                  ...video,
                  id: Number(created.id ?? video.id),
                  fileName: String(created.url ?? created.file_url ?? created.secure_url ?? '').trim() || video.fileName,
                  videoDataUrl: null,
                };
              } catch {
                return video;
              }
            }
            return video;
          })
        );
        setGallery(persistedGallery);
        setVideos(persistedVideos);
        // Keep alias/local preview in sync for immediate updates.
        const normalizedAlias = bizCard.urlAlias.trim();
        initialUrlAliasRef.current = normalizedAlias;
        const refreshedEditable = parseUrlAliasEditable(data.profile?.url_alias_editable);
        if (refreshedEditable) {
          setUrlAliasEditable(refreshedEditable);
        } else if (aliasChanged) {
          setUrlAliasEditable({ allowed: false, daysRemaining: 90, changeAvailableAt: '' });
        }
        if (normalizedAlias) {
          const snapshot = buildPortfolioSnapshot(servicesWithUploadedMedia) as Record<string, unknown>;
          snapshot.gallery = persistedGallery;
          snapshot.videos = persistedVideos;
          publishPortfolioSnapshotUpdate({
            urlAlias: normalizedAlias,
            updater: () => snapshot,
          });
          try {
            localStorage.setItem('latestPortfolioAlias', normalizedAlias);
          } catch {
            // ignore local cache write failures
          }
        }
        // Keep identity in sync if user edited profile names/photo, then notify listeners.
        try {
          const authRaw = localStorage.getItem('authUser');
          const authObj = authRaw ? JSON.parse(authRaw) : {};
          const syncedProfileImage = profileUrl ?? bizCard.profileImage ?? null;
          writeAuthUser({
            ...authObj,
            firstName: vcard.firstName,
            lastName: vcard.lastName,
            ...(syncedProfileImage
              ? {
                  profileUrl: syncedProfileImage,
                  profile_url: syncedProfileImage,
                  profile_image: syncedProfileImage,
                }
              : {}),
          });
        } catch {
          dispatchUserSync();
        }

        dispatchUserSync();

        // Mark success only after post-save tasks complete to avoid
        // green button + "Saving..." mixed state.
        setSaved(true);
        showToast('BizCard saved successfully.', 'success');
        setTimeout(() => setSaved(false), 2500);

        // Invalidate cache after successful save - next load will fetch fresh data
        const cacheIdentifier = bizcardId || bizCard.urlAlias.trim();
        if (cacheIdentifier) {
          clearBizcardCache(cacheIdentifier);
          console.debug('[BizCardPage] Cache invalidated after successful save for:', cacheIdentifier);
        }

        // Update original snapshot to current for next delta calculation,
        // using uploaded HTTP URLs instead of pre-upload data: URIs.
        originalSnapshotRef.current = {
          ...currentSnapshot,
          bizCard: {
            ...currentSnapshot.bizCard,
            profileImage: profileUrl ?? currentSnapshot.bizCard.profileImage,
            coverImage: coverUrl ?? currentSnapshot.bizCard.coverImage,
          },
        };
      }
    } catch {
      showToast('Network error. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <SectionLoader text="Loading BizCard editor..." minHeightClass="min-h-[50vh]" />;
  }

  const livePreviewButtonClass = `inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border shadow-sm transition-all active:scale-[0.98] ${
    livePreviewOpen
      ? 'border-primary bg-primary/10 text-primary'
      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300'
  }`;

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in-up">
      {/* Tabs sub-header */}
      <div className="shrink-0 bg-white border-b border-gray-200">
        {claimSerial ? (
          <div className="border-b border-blue-100 bg-blue-50 px-4 py-2.5 text-xs text-blue-800 sm:px-6 lg:px-8">
            {creatingClaimCard
              ? <>Setting up a new BizCard for physical card <strong>{claimSerial}</strong>. It&apos;s linked automatically when you save.</>
              : <>Physical card <strong>{claimSerial}</strong> is linked to this BizCard automatically when you save.</>}
          </div>
        ) : null}

        {/* Mobile: Save button row — shown only on small screens, above tabs */}
        <div className="flex sm:hidden flex-col gap-2 px-4 pt-3 pb-2">
          <div className="flex items-stretch gap-3">
            <button
              type="button"
              onClick={() => setLivePreviewOpen((open) => !open)}
              className={`${livePreviewButtonClass} flex-1 justify-center`}
              aria-pressed={livePreviewOpen}
            >
              <Eye className="h-4 w-4 shrink-0" />
              Live Preview
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className={`flex flex-1 items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-sm transition-all active:scale-[0.98] disabled:opacity-60 ${
                saved ? 'bg-emerald-500' : 'bg-primary hover:bg-primary-hover'
              }`}
            >
              {saving ? (
                <><InlineLoader /> Saving...</>
              ) : saved ? (
                <><Check className="h-4 w-4 shrink-0" /> Saved!</>
              ) : !setupCompleted ? (
                <><Save className="h-4 w-4 shrink-0" /> Set-up BizCard</>
              ) : (
                <><Save className="h-4 w-4 shrink-0" /> Save Changes</>
              )}
            </button>
          </div>
        </div>

        {/* Tab row — on desktop: tabs + save button side by side; on mobile: tabs only */}
        <div className="flex items-center justify-between gap-4 px-4 sm:px-6 lg:px-8 pt-3 sm:pt-3">
          <div className="flex overflow-x-auto flex-1 min-w-0" style={{ scrollbarWidth: 'none' }}>
            {TABS.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`px-3 sm:px-4 lg:px-5 py-3.5 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${
                  tab === t.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Desktop: Live Preview + Save — hidden on mobile (shown above instead) */}
          <div className="hidden sm:flex shrink-0 items-center gap-2 py-2">
            <button
              type="button"
              onClick={() => setLivePreviewOpen((open) => !open)}
              className={`${livePreviewButtonClass} px-5`}
              aria-pressed={livePreviewOpen}
            >
              <Eye className="h-4 w-4" />
              Live Preview
            </button>
            <div className="flex flex-col items-end">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white shadow-sm transition-all active:scale-[0.98] disabled:opacity-60 ${
                  saved ? 'bg-emerald-500' : 'bg-primary hover:bg-primary-hover'
                }`}
              >
                {saving ? (
                  <><InlineLoader /> Saving...</>
                ) : saved ? (
                  <><Check className="h-4 w-4" /> Saved!</>
                ) : !setupCompleted ? (
                  <><Save className="h-4 w-4" /> Set-up BizCard</>
                ) : (
                  <><Save className="h-4 w-4" /> Save Changes</>
                )}
              </button>
            </div>
          </div>
        </div>

      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto scrollbar-thin bg-[#F4F7FC] px-4 sm:px-6 lg:px-8 py-6">

          {tab === 'vcard' && (
            <VcardTab
              bizCard={bizCard} setBizCard={setBizCard}
              vcard={vcard}     setVcard={setVcard}
              setupCompleted={setupCompleted}
              urlAliasEditable={urlAliasEditable ?? undefined}
              mapLinkError={addressMapLinkError}
            />
          )}
          {tab === 'design' && (
            <DesignTab
              bizCard={bizCard} setBizCard={setBizCard}
              vcard={vcard}
              services={services}
              gallery={gallery}
              videos={videos}
              selectedTheme={selectedTheme}
              setSelectedTheme={setTheme}
              onThemeSelect={(themeId) => {
                // The new card doesn't exist yet; its theme is applied when it's created.
                if (creatingClaimCard) setTheme(themeId);
                else void applyThemeSelection(themeId);
              }}
              subscriptionTier={subscriptionTier}
              isDevUser={isDevUser}
            />
          )}
          {tab === 'services' && (
            <ServicesTab
              services={services} setServices={setServices}
              gallery={gallery}   setGallery={setGallery}
              videos={videos}     setVideos={setVideos}
              canUploadGallery={creatingClaimCard ? false : canUploadGallery}
              isDevUser={isDevUser}
              showGallery={showGallery}
              bizcardId={bizcardId}
              syncWithServer={!creatingClaimCard}
            />
          )}
          {tab === 'social' && (
            <SocialTab
              vcard={vcard}
              setVcard={setVcard}
              onPersistSocialLinks={persistSocialLinks}
              setupCompleted={setupCompleted}
            />
          )}
          {tab === 'more-preferences' && (
            <MorePreferencesTab
              showCoverPhoto={showCoverPhoto}
              setShowCoverPhoto={setShowCoverPhoto}
              showInquiryCard={showInquiryCard}
              setShowInquiryCard={setShowInquiryCard}
              showAssociateCount={showAssociateCount}
              setShowAssociateCount={setShowAssociateCount}
              showMutualAssociates={showMutualAssociates}
              setShowMutualAssociates={setShowMutualAssociates}
              showEmail={showEmail}
              setShowEmail={setShowEmail}
            />
          )}
        </div>

        {/* Desktop / tablet: docked live preview — stays open while editing */}
        {livePreviewOpen ? (
          <aside className="hidden md:flex w-[min(100%,380px)] shrink-0 flex-col border-l border-gray-200 bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: livePreviewTheme.gradient }}
                >
                  <Eye className="h-4 w-4 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">Live Preview</p>
                  <p className="truncate text-xs text-slate-500">{livePreviewTheme.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLivePreviewOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 transition-colors hover:bg-slate-200"
                aria-label="Close live preview"
              >
                <X className="h-4 w-4 text-slate-500" />
              </button>
            </div>
            <div className="flex flex-1 items-start justify-center overflow-y-auto bg-linear-to-b from-slate-100 to-slate-50 p-4">
              <div className="w-full max-w-[320px]">
                <div
                  className="relative rounded-[28px] p-2 shadow-xl"
                  style={{ background: livePreviewTheme.accent }}
                >
                  <div className="absolute top-2 left-1/2 z-10 h-1.5 w-16 -translate-x-1/2 rounded-full bg-slate-900" />
                  <PortfolioPreviewFrame
                    data={livePortfolioData}
                    themeId={selectedTheme}
                    height="calc(100vh - 220px)"
                    scale={0.72}
                    className="rounded-[22px] border-0 bg-slate-900 shadow-none"
                    scrollClassName="bg-slate-900"
                    isMobile
                  />
                </div>
                <p className="mt-3 text-center text-[11px] text-slate-500">
                  Updates instantly from unsaved edits
                </p>
              </div>
            </div>
          </aside>
        ) : null}
      </div>

      {/* Mobile: true fullscreen portfolio preview (1:1 mobile look) */}
      <ModalPortal
        isOpen={livePreviewOpen && isNarrowViewport}
        onClose={() => setLivePreviewOpen(false)}
      >
        <div
          className="fixed inset-0 z-100 flex h-dvh w-screen flex-col bg-white"
          role="dialog"
          aria-modal="true"
          aria-label="Live portfolio preview"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 bg-linear-to-b from-black/55 via-black/20 to-transparent px-3 pb-10 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <div className="pointer-events-none min-w-0 rounded-full bg-black/35 px-3 py-1.5 backdrop-blur-md">
              <p className="truncate text-[11px] font-semibold tracking-wide text-white">
                Live Preview · {livePreviewTheme.name}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setLivePreviewOpen(false)}
              className="pointer-events-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/50 text-white shadow-lg backdrop-blur-md transition-colors hover:bg-black/70"
              aria-label="Close live preview"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <ThemePreviewPortalHost className="min-h-0 flex-1 flex flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain bg-white">
              <BizCardPreview
                themeId={selectedTheme}
                data={livePortfolioData}
                mini={false}
                showFAB={false}
                isMobile
                isThemePreview
              />
            </div>
          </ThemePreviewPortalHost>
        </div>
      </ModalPortal>
    </div>
  );
}


