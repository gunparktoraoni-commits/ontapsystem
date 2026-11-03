'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import RegisterUser from '../../components/RegisterUser';
import VerifyEmailUser from '../../components/VerifyEmailUser';

import EmailVerified from '../../components/EmailVerified';
import SetupBizCard from '../../components/SetupBizCard';
import VCardDetails from '../../components/VCardDetails';
import ServicesProducts from '../../components/ServicesProducts';
import CompletedSetup from '../../components/CompletedSetup';
import UpsellPhysicalCard from '../../components/UpsellPhysicalCard';
import PasskeyPrompt from '../../components/PasskeyPrompt';
import type { BizCardFormData, VCardFormData, GalleryItem, ServiceItem, VideoItem, PortfolioData } from '../../types';
import ChooseTheme from '../../components/ChooseTheme';
import { dataUrlToBlob } from '../../components/BizCardShared';
import { getFrontendApiBaseUrl } from '../../components/apiBase';
import { FrontendSubscriptionError, formatTaggedError } from '../../components/frontendErrorCodes';
import { persistThemePath } from '../../lib/bizcardThemeSync';
import { markPortfolioNeedsServerRefresh } from '../../lib/portfolioBrowserCache';
import { buildAddressApiPayload } from '../../lib/addressPayload';
import {
  normalizeContactNumber,
  normalizeHttpUrl,
  serializeSocialLinksForApi,
} from '../../lib/vcardApiPayload';
import { normalizeTelephoneForApi } from '../../lib/contactDetails';
import {
  loadSetupSession,
  updateSessionStep,
  updateSessionStepData,
  markEmailVerified,
  clearSetupSession,
  updateSessionBizcardSerial,
} from '../../lib/sessionStorage';
import { extractClaimSerial, persistClaimSerial, sanitizeInternalRedirectPath } from '@/lib/bizcard/claim-urls';
import { markSupportPopupPending } from '../../components/support/SupportPopUp';
import {
  PHYSICAL_CARD_HELP_PENDING_PREFIX,
  physicalCardHelpStorageKey,
} from '@/lib/bizcard/physical-card-help';

const USER_SYNC_EVENT = 'ontap:user-sync';
const DISTRIBUTED_CARDS_SYNC_EVENT = 'ontap:distributed-cards-sync';
const CSRF_COOKIE_NAME = 'csrf-token';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SERVICES_DRAFT_KEY = 'signup_services_draft';
const ASSIGNED_BIZCARD_SERIAL_KEY = 'assignedBizcardSerial';
const POST_SIGNUP_REDIRECT_KEY = 'post_signup_redirect';
const QR_CLAIMED_PREFIX = 'qr_claimed_';
const QR_PORTFOLIO_PREFIX = 'qr_portfolio_';
const SERIAL_TO_ALIAS_PREFIX = 'serial_to_alias_';
const DISTRIBUTED_CARDS_KEY = 'distributed_cards';

function buildScopedServicesDraftKey(scopeKey?: string): string {
  const normalized = String(scopeKey ?? '').trim().toLowerCase();
  if (!normalized) {
    return `${SERVICES_DRAFT_KEY}:anonymous`;
  }
  return `${SERVICES_DRAFT_KEY}:${encodeURIComponent(normalized)}`;
}

function dispatchUserSync() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(USER_SYNC_EVENT));
}

function dispatchDistributedCardsSync() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DISTRIBUTED_CARDS_SYNC_EVENT));
}

function normalizeSerialId(serialId: string): string {
  return serialId.trim().toUpperCase();
}
function normalizePathname(value: string): string {
  if (typeof window === 'undefined') return '';
  const raw = value.trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw, window.location.origin);
    return parsed.pathname.replace(/\/+$/, '').toUpperCase();
  } catch {
    return '';
  }
}


function isSerialSelfMapping(serialId: string, portfolioUrl: string): boolean {
  const serial = normalizeSerialId(serialId);
  if (!serial) return false;
  return normalizePathname(portfolioUrl) === `/${serial}`;
}
type DistributedCardCacheEntry = {
  serialId: string;
  portfolioUrl: string;
  claimedByName: string;
  claimedByEmail: string;
  qrCodeUrl: string;
  claimedAt: string;
  source: 'local' | 'backend';
  addons: string[];
};
function getLocalStorageText(key: string): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
function readDistributedCardCache(): DistributedCardCacheEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(DISTRIBUTED_CARDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const row = item as Record<string, unknown>;
        const serialId = normalizeSerialId(String(row.serialId ?? ''));
        const portfolioUrl = String(row.portfolioUrl ?? '').trim();
        if (!serialId || !portfolioUrl) return null;
        return {
          serialId,
          portfolioUrl,
          claimedByName: String(row.claimedByName ?? row.ownerName ?? '').trim(),
          claimedByEmail: String(row.claimedByEmail ?? row.ownerEmail ?? '').trim(),
          qrCodeUrl: String(row.qrCodeUrl ?? '').trim(),
          claimedAt: String(row.claimedAt ?? '').trim(),
          source: row.source === 'backend' ? 'backend' : 'local',
          addons: Array.isArray(row.addons) ? row.addons.map((addon) => String(addon).trim()).filter(Boolean) : [],
        } as DistributedCardCacheEntry;
      })
      .filter((item): item is DistributedCardCacheEntry => Boolean(item));
  } catch {
    return [];
  }
}
function writeDistributedCardCache(nextCard: DistributedCardCacheEntry) {
  if (typeof window === 'undefined') return;
  try {
    const current = readDistributedCardCache();
    const merged = [
      ...current.filter((item) => item.serialId !== nextCard.serialId),
      nextCard,
    ].sort((left, right) => right.claimedAt.localeCompare(left.claimedAt));
    window.localStorage.setItem(DISTRIBUTED_CARDS_KEY, JSON.stringify(merged));
    dispatchDistributedCardsSync();
  } catch {
    // Ignore local cache failures; backend sync is best-effort.
  }
}
function markQrClaimed(serialId: string, portfolioUrl: string, payload: Partial<DistributedCardCacheEntry>) {
  if (typeof window === 'undefined') return;
  const cleanSerial = normalizeSerialId(serialId);
  const cleanPortfolio = portfolioUrl.trim();
  if (!cleanSerial || !cleanPortfolio) return;
  const shouldStoreSerialMapping = !isSerialSelfMapping(cleanSerial, cleanPortfolio);
  try {
    window.localStorage.setItem(`${QR_CLAIMED_PREFIX}${cleanSerial}`, 'true');
    window.localStorage.setItem(`${QR_PORTFOLIO_PREFIX}${cleanSerial}`, cleanPortfolio);
    if (shouldStoreSerialMapping) {
      window.localStorage.setItem(`${SERIAL_TO_ALIAS_PREFIX}${cleanSerial}`, cleanPortfolio);
    }
    window.localStorage.setItem(ASSIGNED_BIZCARD_SERIAL_KEY, cleanSerial);
  } catch {
    // Ignore storage failures; the server claim still proceeds.
  }

  writeDistributedCardCache({
    serialId: cleanSerial,
    portfolioUrl: cleanPortfolio,
    claimedByName: payload.claimedByName?.trim() || 'Unknown',
    claimedByEmail: payload.claimedByEmail?.trim() || '',
    qrCodeUrl: payload.qrCodeUrl?.trim() || buildQrImageUrl(cleanPortfolio),
    claimedAt: payload.claimedAt?.trim() || new Date().toISOString(),
    source: payload.source ?? 'local',
    addons: Array.isArray(payload.addons) ? payload.addons : ['Standard'],
  });
}

function resolveClaimedPortfolioUrl(serialId: string): string {
  const cleanSerial = normalizeSerialId(serialId);
  if (!cleanSerial || typeof window === 'undefined') return '';

  const serialMap = getLocalStorageText(`${SERIAL_TO_ALIAS_PREFIX}${cleanSerial}`);
  if (serialMap && !isSerialSelfMapping(cleanSerial, serialMap)) return serialMap;

  const direct = getLocalStorageText(`${QR_PORTFOLIO_PREFIX}${cleanSerial}`);
  if (direct && !isSerialSelfMapping(cleanSerial, direct)) return direct;

  const distributedCard = readDistributedCardCache().find((item) => item.serialId === cleanSerial);
  const distributedUrl = distributedCard?.portfolioUrl?.trim() ?? '';
  if (distributedUrl && !isSerialSelfMapping(cleanSerial, distributedUrl)) {
    return distributedUrl;
  }
  return '';
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
    localStorage.setItem('authUser', JSON.stringify({
      ...u,
      firstName: first,
      lastName: last,
      fullName: full,
    }));
  } catch {
    // ignore localStorage errors; continue flow
  }
  dispatchUserSync();
}
const API = getFrontendApiBaseUrl();

function buildPortfolioUrlFromAlias(alias: string): string {
  const cleanAlias = alias.trim().replace(/^\/+/, '');
  if (!cleanAlias) return '';

  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/${cleanAlias}`;
  }

  return `${typeof window !== 'undefined' ? window.location.origin.replace(/\/+$/, '') : ''}/${cleanAlias}`;
}

function buildQrImageUrl(portfolioUrl: string): string {
  const target = portfolioUrl.trim();
  if (!target) return '';
  return `https://api.qrserver.com/v1/create-qr-code/?size=280x280&ecc=H&data=${encodeURIComponent(target)}`;
}

type Step =
  | 'register'
  | 'verify'
  | 'verified'
  | 'bizcard'
  | 'vcard'
  | 'services'
  | 'theme'
  | 'completed'
  | 'upsell'
  | 'passkey'
  | 'completed';

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

async function authFetchWithCsrf(url: string, init: RequestInit = {}): Promise<Response> {
  const method = String(init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers ?? undefined);

  if (MUTATING_METHODS.has(method)) {
    const csrfToken = await ensureCsrfToken();
    if (csrfToken) {
      headers.set('X-CSRF-Token', csrfToken);
    }
  }

  return fetch(url, {
    ...init,
    method,
    credentials: 'include',
    headers,
  });
}

async function trackRegisteredSetupLocation(userId: number | null | undefined, alias?: string): Promise<void> {
  if (!userId || Number.isNaN(Number(userId))) return;
  try {
    await fetch('/api/track/user-location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: String(userId),
        alias: alias?.trim() || undefined,
        source: 'setup_completed',
      }),
    });
  } catch {
    // Tracking should never block setup completion flow.
  }
}
export default function SignUpPage() {
  const [step, setStep] = useState<Step>('register');
  const router = useRouter();
  const totalSteps = 5;
  // userId and email captured after successful registration (needed for OTP verification)
  const [pendingUserId, setPendingUserId] = useState<number | null>(null);
  const [pendingEmail, setPendingEmail] = useState('');
  const [emailDeliveryMeta, setEmailDeliveryMeta] = useState<{
    emailSent?: boolean;
    emailError?: string;
    devOtp?: string;
  }>({});
  // Collected data from each step
  const [bizCardData, setBizCardData] = useState<BizCardFormData | null>(null);
  const [vcardData, setVcardData] = useState<VCardFormData | null>(null);
  const [servicesData, setServicesData] = useState<ServiceItem[]>([]);
  const [galleryData, setGalleryData] = useState<GalleryItem[]>([]);
  const [videosData, setVideosData] = useState<VideoItem[]>([]);
  const [selectedTheme, setSelectedTheme] = useState<string>('elegant-dark');
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState('');
  const [offlineQrCode, setOfflineQrCode] = useState('');
  const [redirectingClaimedCard, setRedirectingClaimedCard] = useState(false);
  // Captured from /user/signup?ref=SERIAL when scanning a SuperAdmin BizCard QR.
  // The serial is persisted through setup and finalized after a successful setup save.
  // SuperAdmin "Distributed Cards" picks up the claim from backend polling and the
  // local distributed_cards cache for same-browser, immediate updates.
  const [assignedBizcardSerial, setAssignedBizcardSerial] = useState<string>('');
  const [assignedSubscriptionTier, setAssignedSubscriptionTier] = useState<string>('basic');
  const [claimError, setClaimError] = useState<string>('');
  const [inviteCode, setInviteCode] = useState<string>('');
  const [postSignupRedirect, setPostSignupRedirect] = useState<string | null>(null);

  const resolvePostSignupDestination = (fallback = '/user/dashboard') => {
    const fromState = sanitizeInternalRedirectPath(postSignupRedirect);
    if (fromState) return fromState;
    if (typeof window === 'undefined') return fallback;
    try {
      const stored = sanitizeInternalRedirectPath(
        window.sessionStorage.getItem(POST_SIGNUP_REDIRECT_KEY),
      );
      if (stored) return stored;
    } catch {
      // ignore storage failures
    }
    return fallback;
  };

  const navigateAfterSignup = (fallback = '/user/dashboard') => {
    const destination = resolvePostSignupDestination(fallback);
    try {
      window.sessionStorage.removeItem(POST_SIGNUP_REDIRECT_KEY);
    } catch {
      // ignore
    }
    router.push(destination);
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      const raw =
        extractClaimSerial(params.get('ref') ?? params.get('serial') ?? '') ??
        extractClaimSerial(window.sessionStorage.getItem(ASSIGNED_BIZCARD_SERIAL_KEY)) ??
        extractClaimSerial(window.localStorage.getItem(ASSIGNED_BIZCARD_SERIAL_KEY));
      if (raw) {
        setAssignedBizcardSerial(raw);
        persistClaimSerial(raw);
      }
      // Growth missions invite — distinct from BizCard ?ref= serial claim
      const invite = (params.get('invite') ?? '').trim();
      if (invite) {
        setInviteCode(invite);
        try {
          window.localStorage.setItem('affiliate_referral_code', invite);
        } catch {
          // ignore
        }
      }

      const redirect = sanitizeInternalRedirectPath(params.get('redirect'));
      if (redirect) {
        setPostSignupRedirect(redirect);
        try {
          window.sessionStorage.setItem(POST_SIGNUP_REDIRECT_KEY, redirect);
        } catch {
          // ignore
        }
      } else {
        try {
          const stored = sanitizeInternalRedirectPath(
            window.sessionStorage.getItem(POST_SIGNUP_REDIRECT_KEY),
          );
          if (stored) setPostSignupRedirect(stored);
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore URL parse failures
    }
  }, []);

  // Resolve the blank BizCard subscription tier so ChooseTheme unlocks Premium/Standard themes.
  useEffect(() => {
    if (!assignedBizcardSerial) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetchWithCsrf(`${API}/api/bizcard/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serialId: assignedBizcardSerial }),
        });
        const payload = await res.json().catch(() => null) as {
          data?: { subscriptionTier?: string | null };
        } | null;
        const tier = String(payload?.data?.subscriptionTier ?? '').trim().toLowerCase();
        if (!cancelled && (tier === 'basic' || tier === 'standard' || tier === 'premium')) {
          setAssignedSubscriptionTier(tier);
        }
      } catch {
        // Keep default basic if claim lookup fails; merge still activates tier later.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assignedBizcardSerial]);

  useEffect(() => {
    if (typeof window === 'undefined' || !assignedBizcardSerial) return;
    const portfolioUrl = resolveClaimedPortfolioUrl(assignedBizcardSerial);
    const claimed =
      getLocalStorageText(`${QR_CLAIMED_PREFIX}${assignedBizcardSerial}`) === 'true' ||
      Boolean(portfolioUrl);
    if (claimed && portfolioUrl) {
      setRedirectingClaimedCard(true);
      window.location.replace(portfolioUrl);
    }
  }, [assignedBizcardSerial]);

  /**
   * Session Restoration Hook
   * 
   * On component mount, check for incomplete setup sessions in localStorage.
   * If found, restore all collected data and jump to the appropriate step.
   * This ensures users can continue setup after page refresh.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const session = loadSetupSession();
    if (!session || session.isComplete) return;
    
    console.log('[Signup] Restoring incomplete session:', session.email);
    
    // Restore all collected data from previous steps
    if (session.stepData?.bizCard) {
      setBizCardData(session.stepData.bizCard);
    }
    if (session.stepData?.vcard) {
      setVcardData(session.stepData.vcard);
    }
    if (session.stepData?.services) {
      setServicesData(session.stepData.services);
    }
    if (session.stepData?.gallery) {
      setGalleryData(session.stepData.gallery);
    }
    if (session.stepData?.videos) {
      setVideosData(session.stepData.videos);
    }
    if (session.stepData?.selectedTheme) {
      setSelectedTheme(session.stepData.selectedTheme);
    }
    
    // Restore pending user info
    setPendingUserId(session.userId || null);
    setPendingEmail(session.email);
    
    // Restore assigned serial if present
    if (session.assignedBizcardSerial) {
      setAssignedBizcardSerial(session.assignedBizcardSerial);
    }
    
    // If email was already verified in the session, skip to verified
    // Otherwise, go to the saved step (which might be 'verify' or beyond)
    const targetStep = session.emailVerified ? 'verified' : session.currentStep;
    setStep(targetStep);
    
    console.log('[Signup] Session restored - email verified:', session.emailVerified, '- step:', targetStep);
  }, []); // Run only once on mount

  /**
   * Persist current step to session whenever it changes
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    updateSessionStep(step);
  }, [step]);

  /**
   * Persist BizCard data to session whenever it changes
   */
  useEffect(() => {
    if (typeof window === 'undefined' || !bizCardData) return;
    updateSessionStepData('bizCard', bizCardData);
  }, [bizCardData]);

  /**
   * Persist VCard data to session whenever it changes
   */
  useEffect(() => {
    if (typeof window === 'undefined' || !vcardData) return;
    updateSessionStepData('vcard', vcardData);
  }, [vcardData]);

  /**
   * Persist Services data to session whenever it changes
   */
  useEffect(() => {
    if (typeof window === 'undefined' || !servicesData) return;
    updateSessionStepData('services', servicesData);
  }, [servicesData]);

  /**
   * Persist Gallery data to session whenever it changes
   */
  useEffect(() => {
    if (typeof window === 'undefined' || !galleryData) return;
    updateSessionStepData('gallery', galleryData);
  }, [galleryData]);

  /**
   * Persist Videos data to session whenever it changes
   */
  useEffect(() => {
    if (typeof window === 'undefined' || !videosData) return;
    updateSessionStepData('videos', videosData);
  }, [videosData]);

  /**
   * Persist assigned bizcard serial to session whenever it changes
   */
  useEffect(() => {
    if (typeof window === 'undefined' || !assignedBizcardSerial) return;
    updateSessionBizcardSerial(assignedBizcardSerial);
  }, [assignedBizcardSerial]);

  // Best-effort: link the scanned physical BizCard onto the virtual card created during setup.
  // Must call POST /api/bizcard/merge (claim is decision-only and does not write serial_id).
  // Failures are logged but never block signup completion.
  const mergeAssignedBizcard = async (serial: string, virtualCardId: string) => {
    const cleanSerial = serial.trim().toUpperCase();
    const cleanVirtualId = virtualCardId.trim();
    if (!cleanSerial || !cleanVirtualId) return false;

    const mergeBody = { serialId: cleanSerial, virtualCardId: cleanVirtualId };

    const tryMerge = async (url: string): Promise<boolean> => {
      const res = await authFetchWithCsrf(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mergeBody),
      });
      const payload = await res.json().catch(() => null) as { success?: boolean } | null;
      return Boolean(res.ok && payload?.success);
    };

    try {
      if (await tryMerge(`${API}/api/bizcard/merge`)) {
        console.log('[signup] bizcard merge succeeded for serial:', cleanSerial);
        return true;
      }

      // Fall back to same-origin Next.js route if the external API base lacks the endpoint.
      if (API && (await tryMerge('/api/bizcard/merge'))) {
        console.log('[signup] bizcard merge succeeded via local fallback for serial:', cleanSerial);
        return true;
      }

      setClaimError(`Could not auto-link bizcard ${cleanSerial}. SuperAdmin can re-link from "Available Cards".`);
      console.warn('[signup] bizcard merge failed', {
        serial: cleanSerial,
        virtualCardId: cleanVirtualId,
      });
      return false;
    } catch (err) {
      setClaimError(`Could not auto-link bizcard ${cleanSerial}.`);
      console.warn('[signup] bizcard merge error', err);
      return false;
    }
  };
  const servicesDraftScope = pendingUserId ? String(pendingUserId) : pendingEmail.trim().toLowerCase();
  const uploadMedia = async (
    dataUri: string,
    context: 'profile' | 'cover' | 'service' | 'portfolio',
    serviceId?: string,
  ): Promise<string | null> => {
    try {
      const blob = dataUrlToBlob(dataUri);
      const mime = blob.type || 'application/octet-stream';
      let ext = 'bin';
      if (mime.includes('png')) ext = 'png';
      else if (mime.includes('jpeg') || mime.includes('jpg')) ext = 'jpg';
      else if (mime.includes('pdf')) ext = 'pdf';
      const fd = new FormData();
      fd.append('file', new File([blob], `${context}.${ext}`, { type: mime }));
      fd.append('context', context);
      if (serviceId) fd.append('service_id', serviceId);
      const r = await authFetchWithCsrf(`${API}/api/media/upload`, {
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
  const getStepNumber = () => {
    switch (step) {
      case 'bizcard': return 1;
      case 'vcard': return 2;
      case 'services': return 3;
      case 'theme': return 4;
      case 'passkey': return 4;
      case 'completed': return 4;
      case 'upsell': return 5;
      default: return 1;
    }
  };

  // Build the full portfolio data object
  const buildPortfolioData = (theme: string): PortfolioData => ({
    bizCard: bizCardData ?? {
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
    vcard: vcardData
      ? {
          ...vcardData,
          socialLinks: Array.isArray(vcardData.socialLinks) ? vcardData.socialLinks : [],
        }
      : {
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
      addressArea: '', addressHouseNo: '', addressBrgy: '',
      addressCity: '', addressRegion: '', addressZipcode: '', addressMapLink: '', addressLandmark: '',
      addressLatitude: null, addressLongitude: null,
      socialLinks: [],
    },
    services: Array.isArray(servicesData) ? servicesData : [],
    gallery: Array.isArray(galleryData) ? galleryData : [],
    videos: Array.isArray(videosData) ? videosData : [],
    selectedTheme: theme,
  });

  const handleRealtimeThemeSelect = async (theme: string) => {
    setSelectedTheme(theme);
    const alias = bizCardData?.urlAlias?.trim();
    if (alias) {
      try {
        markPortfolioNeedsServerRefresh();
        dispatchUserSync();
      } catch {
        // ignore local cache write failures
      }
    }

    const saved = await persistThemePath(theme, API);
    if (!saved) {
      const tagged = formatTaggedError(
        FrontendSubscriptionError.THEME_APPLY_FAILED,
        'Theme preview update failed during setup. Continuing with local preview.'
      );
      console.error(tagged);
    }
  };

  const uploadGalleryMediaItem = async (
    bizcardId: string,
    item: GalleryItem
  ): Promise<GalleryItem | null> => {
    const previewSource = item.imageDataUrl || item.url;
    if (!previewSource?.startsWith('data:')) {
      return item.url.startsWith('http') ? item : null;
    }

    try {
      const blob = dataUrlToBlob(previewSource);
      const mime = blob.type || item.mimeType || 'image/jpeg';
      const fileName = item.fileName || `gallery-${Date.now()}.jpg`;
      const fd = new FormData();
      fd.append('file', new File([blob], fileName, { type: mime }));
      fd.append('title', item.title.trim());
      fd.append('description', item.description.trim());
      fd.append('alt_text', (item.altText ?? item.title).trim());
      fd.append('category', 'gallery');

      const res = await authFetchWithCsrf(`${API}/api/bizcard/${encodeURIComponent(bizcardId)}/gallery`, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) return null;
      const payload = await res.json();
      const created = (payload.data ?? payload) as Record<string, unknown>;
      const createdUrl = String(created.url ?? created.file_url ?? created.secure_url ?? '').trim();
      if (!createdUrl) return null;
      return {
        ...item,
        id: Number(created.id ?? item.id),
        url: createdUrl,
        imageDataUrl: null,
      };
    } catch {
      return null;
    }
  };

  const uploadStandaloneVideoItem = async (
    bizcardId: string,
    item: VideoItem
  ): Promise<VideoItem | null> => {
    if (!item.videoDataUrl?.startsWith('data:')) {
      return item.fileName.startsWith('http') ? item : null;
    }

    try {
      const blob = dataUrlToBlob(item.videoDataUrl);
      const mime = blob.type || item.mimeType || 'video/mp4';
      const fileName = item.fileName || `video-${Date.now()}.mp4`;
      const fd = new FormData();
      fd.append('file', new File([blob], fileName, { type: mime }));
      fd.append('title', item.title.trim());
      fd.append('description', item.description.trim());
      fd.append('category', 'video');

      const res = await authFetchWithCsrf(`${API}/api/bizcard/${encodeURIComponent(bizcardId)}/gallery`, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) return null;
      const payload = await res.json();
      const created = (payload.data ?? payload) as Record<string, unknown>;
      const createdUrl = String(created.url ?? created.file_url ?? created.secure_url ?? '').trim();
      if (!createdUrl) return null;
      return {
        ...item,
        id: Number(created.id ?? item.id),
        fileName: createdUrl,
        videoDataUrl: null,
      };
    } catch {
      return null;
    }
  };

  const handleFinish = async (serialFromCompletedSetup?: string) => {
    if (finishing) return;
    setFinishing(true);
    setFinishError('');
    const data = buildPortfolioData(selectedTheme);
    // Filter services: require title, description, image
    const validServices = data.services.filter(s =>
      s.title.trim() && s.description.trim() && s.featured_image
    );
    // Replace data.services with validServices
    data.services = validServices;
    const services = Array.isArray(data.services) ? data.services : [];
    const socialLinks = Array.isArray(data.vcard?.socialLinks) ? data.vcard.socialLinks : [];
    const qrSerial = normalizeSerialId(serialFromCompletedSetup ?? assignedBizcardSerial);
    try {
      let profileUrl: string | null = data.bizCard.profileImage?.startsWith('http') ? data.bizCard.profileImage : null;
      let coverUrl: string | null = data.bizCard.coverImage?.startsWith('http') ? data.bizCard.coverImage : null;

      if (data.bizCard.profileImage?.startsWith('data:')) {
        const uploaded = await uploadMedia(data.bizCard.profileImage, 'profile');
        if (uploaded) profileUrl = uploaded;
      }
      if (data.bizCard.coverImage?.startsWith('data:')) {
        const uploaded = await uploadMedia(data.bizCard.coverImage, 'cover');
        if (uploaded) coverUrl = uploaded;
      }

      const preparedServices = await Promise.all(
        services
          .filter((s) => s.title.trim())
          .map(async (s, i) => {
            let featuredImage: string | undefined;

            if (s.featured_image?.startsWith('http')) {
              featuredImage = s.featured_image;
            }

            return {
              name: s.title.trim(),
              tagline: s.tagline.trim() || undefined,
              description: (s.description || s.title).trim(),
              serviceUrl: s.videoUrl.trim() ? normalizeHttpUrl(s.videoUrl.trim()) : undefined,
              featured_image: featuredImage,
              displayOrder: i,
              isVisible: true,
            };
          })
      );
      const preparedServiceImageByOrder = new Map<number, string>();
      preparedServices.forEach((service, index) => {
        if (service.featured_image && service.featured_image.startsWith('http')) {
          preparedServiceImageByOrder.set(index, service.featured_image);
        }
      });
      const body: Record<string, unknown> = {
        customUri: data.bizCard.urlAlias.trim() || undefined,
        vcardName: data.bizCard.bizCardName.trim() || undefined,
        vcardDescription: data.bizCard.description.trim() || undefined,
        firstName: data.vcard.firstName.trim() || undefined,
        lastName: data.vcard.lastName.trim() || undefined,
        middleName: data.vcard.middleName.trim() || undefined,
        profTitle: data.vcard.professionalTitle.trim() || undefined,
        postNominal: data.vcard.postNominalLetters.trim() || undefined,
        suffix: data.vcard.suffix && data.vcard.suffix !== 'N/A' ? data.vcard.suffix : undefined,
        jobPosition: data.bizCard.occupation.trim() || undefined,
        about: data.vcard.about.trim() || undefined,
        contact: data.vcard.contactNumber.trim()
          ? normalizeContactNumber(data.vcard.contactNumber.trim())
          : undefined,
        altContact: data.vcard.secondaryNumber.trim()
          ? normalizeContactNumber(data.vcard.secondaryNumber.trim())
          : undefined,
        telephone: data.vcard.telephoneNumber.trim()
          ? normalizeTelephoneForApi(data.vcard.telephoneNumber.trim())
          : undefined,
        altTelephone: data.vcard.altTelephoneNumber.trim()
          ? normalizeTelephoneForApi(data.vcard.altTelephoneNumber.trim())
          : undefined,
        email: data.vcard.email.trim() || undefined,
        altEmail: data.vcard.alternativeEmail.trim() || undefined,
        ...(data.vcard.languages.trim() ? { languages: data.vcard.languages.trim() } : {}),
        ...(profileUrl && { profileUrl }),
        ...(coverUrl && { coverUrl }),
        ...(data.bizCard.coverImagePosition && { coverImagePosition: data.bizCard.coverImagePosition }),
        publishNow: true,
        socials: serializeSocialLinksForApi(socialLinks),
        services: preparedServices,
        ...(buildAddressApiPayload(data.vcard) ? { address: buildAddressApiPayload(data.vcard) } : {}),
      };
      if (body.address && typeof body.address === 'object') {
        body.address = Object.fromEntries(
          Object.entries(body.address as Record<string, unknown>).filter(([, v]) => v !== undefined)
        );
        if (Object.keys(body.address as object).length === 0) delete body.address;
      }
      const res = await authFetchWithCsrf(`${API}/api/vcard/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let payload: Record<string, unknown> = {};
      try { payload = JSON.parse(text); } catch { /* non-json */ }
      const fallbackPayloadProfile = (payload.profile ?? {}) as Record<string, unknown>;
      const payloadUserId = Number(fallbackPayloadProfile.user_id ?? fallbackPayloadProfile.userId ?? 0);
      const trackedUserId = pendingUserId ?? (Number.isFinite(payloadUserId) && payloadUserId > 0 ? payloadUserId : null);

      if (!res.ok) {
        const msg = String(
          (payload.details as string[] | undefined)?.join(', ') ||
          payload.error ||
          payload.message ||
          `Setup failed (${res.status})`
        );
        setFinishError(msg);
        return;
      }

      const apiQrCode = typeof payload.qrCode === 'string' ? payload.qrCode.trim() : '';
      if (apiQrCode) {
        setOfflineQrCode(apiQrCode);
      }
      const savedServices = (
        (payload as { profile?: { services?: { service_id?: string; display_order?: number }[] } }).profile?.services ?? []
      );
      const mediaUploads = services
        .map((svc, i) => ({ svc, i }))
        .filter(({ svc }) => Boolean(svc.featured_image?.startsWith('data:')))
        .map(async ({ svc, i }) => {
          const match = savedServices.find((ss) => Number(ss.display_order) === i);
          if (!match?.service_id || !svc.featured_image) return;
          await uploadMedia(svc.featured_image, 'service', match.service_id);
        });
      await Promise.allSettled(mediaUploads);
      // Ensure modular design stream subscribers get immediate theme updates.
      const themeSaved = await persistThemePath(data.selectedTheme, API).catch((error) => {
        const tagged = formatTaggedError(
          FrontendSubscriptionError.THEME_APPLY_FAILED,
          'Theme update failed after setup completion. Setup data was saved.'
        );
        console.error(tagged, error);
        return false;
      });
      if (themeSaved && data.bizCard.urlAlias) {
        try {
          markPortfolioNeedsServerRefresh();
        } catch {
          // ignore local cache parse/write errors
        }
        dispatchUserSync();
      }

      let resolvedBizcardId = String(
        (payload.profile as Record<string, unknown> | undefined)?.bizcard_id
        ?? (payload.profile as Record<string, unknown> | undefined)?.bizcardId
        ?? ''
      ).trim();
      if (!resolvedBizcardId) {
        try {
          const profileRes = await authFetchWithCsrf(`${API}/api/vcard/profile`, { cache: 'no-store' });
          if (profileRes.ok) {
            const profilePayload = await profileRes.json();
            const profile = (profilePayload.profile ?? {}) as Record<string, unknown>;
            resolvedBizcardId = String(profile.bizcard_id ?? profile.bizcardId ?? '').trim();
          }
        } catch {
          // continue with local-only reflection if lookup fails
        }
      }

      const resolvedGallery = resolvedBizcardId
        ? await Promise.all(data.gallery?.map((item) => uploadGalleryMediaItem(resolvedBizcardId, item)) ?? [])
        : (data.gallery ?? []);
      const normalizedGallery = resolvedGallery.filter(Boolean) as GalleryItem[];

      const resolvedVideos = resolvedBizcardId
        ? await Promise.all(data.videos?.map((item) => uploadStandaloneVideoItem(resolvedBizcardId, item)) ?? [])
        : (data.videos ?? []);
      const normalizedVideos = resolvedVideos.filter(Boolean) as VideoItem[];

      // Signal open portfolio tabs to refetch from the API (no device content cache).
      if (data.bizCard.urlAlias) {
        try {
          localStorage.setItem('latestPortfolioAlias', data.bizCard.urlAlias);
          markPortfolioNeedsServerRefresh();
        } catch {
          // Ignore local cache write failures; backend setup already succeeded.
        }
      }

      if (qrSerial && completionPortfolioUrl) {
        const mergeSucceeded = resolvedBizcardId
          ? await mergeAssignedBizcard(qrSerial, resolvedBizcardId)
          : false;
        if (!resolvedBizcardId) {
          setClaimError(`Could not auto-link bizcard ${qrSerial}. Missing virtual card id after setup.`);
          console.warn('[signup] bizcard merge skipped — no resolvedBizcardId', { serial: qrSerial });
        }
        const claimedByName = [data.vcard.firstName, data.vcard.lastName].filter(Boolean).join(' ').trim() || pendingEmail;
        const claimedByEmail = pendingEmail || data.vcard.email.trim();
        const resolvedQrCodeUrl =
          apiQrCode ||
          offlineQrCode.trim() ||
          buildQrImageUrl(completionPortfolioUrl);
        markQrClaimed(qrSerial, completionPortfolioUrl, {
          serialId: qrSerial,
          portfolioUrl: completionPortfolioUrl,
          claimedByName,
          claimedByEmail,
          qrCodeUrl: resolvedQrCodeUrl,
          claimedAt: new Date().toISOString(),
          source: mergeSucceeded ? 'backend' : 'local',
          addons: [
            `Theme: ${data.selectedTheme}`,
            `Services: ${services.length}`,
          ],
        });
      }

      try {
        localStorage.removeItem(buildScopedServicesDraftKey(servicesDraftScope));
      } catch {
        // Ignore local storage failures.
      }

      // Update local auth identity with latest typed name so header updates immediately.
      let authObj: Record<string, unknown> = {};
      try {
        const authRaw = localStorage.getItem('authUser');
        authObj = authRaw ? JSON.parse(authRaw) : {};
      } catch {
        authObj = {};
      }
      writeAuthUser({
        ...authObj,
        firstName: data.vcard.firstName,
        lastName: data.vcard.lastName,
      });

      await trackRegisteredSetupLocation(trackedUserId, data.bizCard.urlAlias);

      dispatchUserSync();
      
      // Clear the incomplete setup session since account creation succeeded
      clearSetupSession();
      markSupportPopupPending();
      const helpAccountKey = trackedUserId ? String(trackedUserId) : pendingEmail.trim();
      if (helpAccountKey) {
        try {
          localStorage.setItem(
            physicalCardHelpStorageKey(
              PHYSICAL_CARD_HELP_PENDING_PREFIX,
              helpAccountKey,
            ),
            "1",
          );
        } catch (error) {
          console.error("Unable to queue the physical BizCard tutorial:", error);
        }
      }

      // Show the physical BizCard upsell step before navigating to dashboard
      setStep('upsell');
    } catch (err) {
      const msg = err instanceof Error && err.message
        ? `Unable to complete setup right now. ${err.message}`
        : 'Unable to complete setup right now. Please try again.';
      setFinishError(msg);
    } finally {
      setFinishing(false);
    }
  };



  const portfolioData = (step === 'completed' || step === 'theme' || step === 'passkey')
    ? buildPortfolioData(selectedTheme)
    : undefined;
  const completionAlias = portfolioData?.bizCard.urlAlias?.trim() ?? '';
  const completionPortfolioUrl = completionAlias
    ? buildPortfolioUrlFromAlias(completionAlias)
    : '';
  const completionQrCode =
    offlineQrCode.trim() ||
    (completionPortfolioUrl ? buildQrImageUrl(completionPortfolioUrl) : '');

  if (redirectingClaimedCard) {
    return (
      <main className="min-h-screen w-full flex items-center justify-center bg-gray-50 px-4 py-8">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
          Redirecting to your portfolio...
        </div>
      </main>
    );
  }

  /* Create Account: same auth shell as LoginUser — only form content differs. */
  if (step === 'register') {
    return (
      <main className="min-h-screen w-full flex flex-col items-center justify-center bg-[#ECEEF5] px-4 py-10 md:h-screen md:overflow-hidden">
        <div className="w-full max-w-4xl flex flex-col md:flex-row rounded-2xl overflow-hidden shadow-2xl border border-gray-200/60 md:min-h-[600px] md:max-h-[calc(100vh-8rem)]">
          <div
            className="hidden md:flex md:w-[42%] relative overflow-hidden flex-col md:shrink-0"
            style={{
              background:
                'linear-gradient(145deg, #0c1847 0%, #162666 30%, #1e2f82 60%, #2A4792 85%, #3a5fa8 100%)',
            }}
          >
            <div
              className="animate-blob absolute -top-16 -right-12 w-80 h-80 rounded-full pointer-events-none"
              style={{
                background: 'radial-gradient(circle, rgba(71,133,184,0.45) 0%, transparent 70%)',
              }}
            />
            <div
              className="animate-blob-d3 absolute bottom-28 -left-10 w-72 h-72 rounded-full pointer-events-none"
              style={{
                background: 'radial-gradient(circle, rgba(42,71,146,0.55) 0%, transparent 70%)',
              }}
            />
            <div
              className="animate-blob-d6 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-105 h-105 rounded-full pointer-events-none"
              style={{
                background: 'radial-gradient(circle, rgba(20,40,110,0.35) 0%, transparent 65%)',
              }}
            />
            <Image
              src="/ontapsignup.jpg"
              alt="OnTap product showcase"
              fill
              priority
              unoptimized
              sizes="(max-width: 768px) 0px, 42vw"
              className="animate-phone-glow object-cover object-center select-none pointer-events-none"
              style={{ zIndex: 8 }}
              draggable={false}
            />
            <div
              className="absolute bottom-0 left-0 right-0 h-48 pointer-events-none"
              style={{
                background:
                  'linear-gradient(to top, rgba(10,22,70,0.88) 0%, rgba(10,22,70,0.45) 45%, transparent 100%)',
                zIndex: 9,
              }}
            />
            <div
              className="absolute bottom-5 left-5 right-5 animate-login-copy-in pointer-events-none"
              style={{ zIndex: 28 }}
            >
              <p className="text-white text-xl font-semibold tracking-tight drop-shadow-sm">
                Tap. Connect. Grow.
              </p>
              <p className="text-white/75 text-sm mt-1">Your digital identity, one tap away.</p>
            </div>
          </div>

          <div
            className="flex-1 min-h-0 md:overflow-y-auto md:overscroll-contain"
            style={{
              backgroundImage: [
                'radial-gradient(circle at top left, rgba(71,133,184,0.18) 0%, transparent 34%)',
                'radial-gradient(circle at 85% 18%, rgba(42,71,146,0.12) 0%, transparent 26%)',
                'radial-gradient(circle at bottom right, rgba(71,133,184,0.10) 0%, transparent 30%)',
                'linear-gradient(180deg, #f7f9fe 0%, #eef2fa 38%, #f8faff 100%)',
              ].join(', '),
            }}
          >
            <div className="flex min-h-full items-center justify-center px-6 py-8 sm:px-10 sm:py-10">
              <div className="w-full max-w-sm">
                {assignedBizcardSerial && (
                  <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-700 text-center">
                    You&apos;re claiming BizCard{' '}
                    <span className="font-semibold tracking-wider">{assignedBizcardSerial}</span>.
                    It will be linked to your account after signup.
                  </div>
                )}
                <RegisterUser
                  serialId={assignedBizcardSerial}
                  inviteCode={inviteCode}
                  redirectPath={postSignupRedirect}
                  onNext={(userId, email, meta) => {
                    setPendingUserId(userId);
                    setPendingEmail(email);
                    setEmailDeliveryMeta(meta ?? {});
                    setStep('verify');
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        <p className="mt-7 text-xs text-gray-400 tracking-wide shrink-0">
          All Rights Reserved &copy; 2026{' '}
          <span className="text-primary font-semibold">Ontap Creatives</span>
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen w-full flex items-center justify-center bg-gray-50 px-4 py-8">
      <div className="w-full max-w-md">
        {step === 'verify' && (
          <>
            {claimError && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                {claimError}
              </div>
            )}
            <VerifyEmailUser
              userId={pendingUserId ?? undefined}
              email={pendingEmail}
              emailSent={emailDeliveryMeta.emailSent}
              emailError={emailDeliveryMeta.emailError}
              devOtp={emailDeliveryMeta.devOtp}
              onVerified={(verifiedUserId?: number) => {
                // Update the pending userId now that the real User row exists
                if (verifiedUserId && verifiedUserId > 0) {
                  setPendingUserId(verifiedUserId);
                  // Persist the real userId to the local session
                  import('../../lib/sessionStorage').then(({ updateSessionUserId }) => {
                    updateSessionUserId(verifiedUserId);
                  }).catch(() => {});
                }
                markEmailVerified();
                setStep('verified');
              }}
            />
          </>
        )}

        {step === 'verified' && (
          <EmailVerified
            onContinueBizCard={() => {
              updateSessionStep('bizcard');
              setStep('bizcard');
            }}
            onSkip={() => {
              markSupportPopupPending();
              navigateAfterSignup('/user/dashboard');
            }}
          />
        )}

        {step === 'bizcard' && (
          <SetupBizCard
            initialData={bizCardData ?? undefined}
            onContinue={(data) => {
              setBizCardData(data);
              setStep('vcard');
            }}
            onBack={() => setStep('verified')}
            currentStep={getStepNumber()}
            totalSteps={totalSteps}
          />
        )}

        {step === 'vcard' && (
          <VCardDetails
            initialData={vcardData ?? undefined}
            onContinue={(data) => {
              setVcardData(data);
              setStep('services');
            }}
            onBack={() => setStep('bizcard')}
            currentStep={getStepNumber()}
            totalSteps={totalSteps}
          />
        )}

        {step === 'services' && (
          <ServicesProducts
            initialServices={servicesData}
            initialGallery={galleryData}
            initialVideos={videosData}
            draftScopeKey={servicesDraftScope}
            onRealtimeSave={(nextServices) => {
              setServicesData(Array.isArray(nextServices) ? nextServices : []);
            }}
            onRealtimeGallery={(nextGallery) => {
              setGalleryData(Array.isArray(nextGallery) ? nextGallery : []);
            }}
            onRealtimeVideos={(nextVideos) => {
              setVideosData(Array.isArray(nextVideos) ? nextVideos : []);
            }}
            onContinue={(nextServices) => {
              setServicesData(Array.isArray(nextServices) ? nextServices : []);
              setStep('theme');
            }}
            onBack={() => setStep('vcard')}
            currentStep={getStepNumber()}
            totalSteps={totalSteps}
          />
        )}

        {step === 'theme' && (
          <ChooseTheme
            initialTheme={selectedTheme}
            subscriptionTier={assignedSubscriptionTier || 'basic'}
            previewData={portfolioData}
            onContinue={(theme) => {
              setSelectedTheme(theme);
              setStep('passkey');
            }}
            onBack={() => setStep('services')}
            currentStep={getStepNumber()}
            totalSteps={totalSteps}
          />
        )}

        {step === 'passkey' && (
          <PasskeyPrompt
            inline
            onComplete={() => {
              // Persist this user's email for auto-prompt on the next login
              if (pendingEmail) {
                try {
                  localStorage.setItem('lastPasskeyUser', pendingEmail.trim().toLowerCase());
                } catch {
                  // ignore storage errors
                }
              }
              setStep('completed');
            }}
            onSkip={() => setStep('completed')}
          />
        )}

        {step === 'completed' && (
          <CompletedSetup
            onFinish={handleFinish}
            onBack={() => setStep('theme')}
            currentStep={getStepNumber()}
            totalSteps={totalSteps}
            portfolioData={portfolioData}
            portfolioUrl={completionPortfolioUrl}
            qrCode={completionQrCode}
            finishing={finishing}
            finishError={finishError}
            bizcardSerialId={assignedBizcardSerial}
          />
        )}

        {step === 'upsell' && (
          <UpsellPhysicalCard
            currentStep={getStepNumber()}
            totalSteps={totalSteps}
            onGetCard={() => navigateAfterSignup('/user/emarket?tab=purchase')}
            onSkip={() => {
              markSupportPopupPending();
              navigateAfterSignup('/user/dashboard');
            }}
          />
        )}
      </div>
    </main>
  );
}
