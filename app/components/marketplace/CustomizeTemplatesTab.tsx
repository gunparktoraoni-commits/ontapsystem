'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, CreditCard, Eye, Sparkles, X } from 'lucide-react';
import { THEME_FAMILIES, getTheme, type ThemeFamilyDef } from '../BizCardPreview';
import PortfolioPreviewFrame, { ScaledThemePreview } from '../PortfolioPreviewFrame';
import { ModalPortal } from '../ModalPortal';
import { SectionLoader, InlineLoader } from '../Loader';
import { getFrontendApiBaseUrl } from '../apiBase';
import { showToast } from '../Toast';
import RequestCustomThemeModal from './RequestCustomThemeModal';
import {
  persistThemePath,
  publishBizcardThemeToCache,
} from '../../lib/bizcardThemeSync';
import { inferCoverTypeFromUrl } from '../../lib/portfolioDisplay';
import { resolveSocialPlatformDefFromLink } from '../../lib/socialPlatforms';
import type {
  GalleryItem,
  PortfolioData,
  ServiceItem,
  SocialLink,
  VideoItem,
} from '../../types';

const API = getFrontendApiBaseUrl();
const CSRF_COOKIE_NAME = 'csrf-token';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type PaidCatalogEntry = {
  catalogId: string | null;
  isOwned: boolean;
  price: number;
};

const DEFAULT_PAID_THEME_PRICE = 99;

function matchCatalogTemplate(
  templates: Array<Record<string, unknown>>,
  themeId: string,
  familyName: string,
): Record<string, unknown> | undefined {
  const needle = themeId.trim().toLowerCase();
  const nameNeedle = familyName.trim().toLowerCase().replace(/\s+/g, '');
  return templates.find((template) => {
    const path = String(template.themePath ?? template.theme_path ?? '').trim().toLowerCase();
    const name = String(template.name ?? '').trim().toLowerCase().replace(/\s+/g, '');
    return path === needle || name === nameNeedle || name === needle;
  });
}

const TIER_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  basic: { label: 'Basic', bg: '#e0f2fe', text: '#0369a1' },
  standard: { label: 'Standard', bg: '#f0fdf4', text: '#15803d' },
  premium: { label: 'Premium', bg: '#fdf4ff', text: '#7e22ce' },
  enterprise: { label: 'Exclusive', bg: '#fff7ed', text: '#c2410c' },
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
    if (!response.ok) return readCookie(CSRF_COOKIE_NAME);
    const payload = (await response.json()) as Record<string, unknown>;
    const data =
      payload.data && typeof payload.data === 'object'
        ? (payload.data as Record<string, unknown>)
        : null;
    const token =
      (typeof payload.csrfToken === 'string' && payload.csrfToken) ||
      (typeof payload.csrf_token === 'string' && payload.csrf_token) ||
      (typeof payload.token === 'string' && payload.token) ||
      (data && typeof data.csrfToken === 'string' && data.csrfToken) ||
      null;
    return token?.trim() || readCookie(CSRF_COOKIE_NAME);
  } catch {
    return readCookie(CSRF_COOKIE_NAME);
  }
}

async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = String(init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers ?? undefined);
  if (MUTATING_METHODS.has(method)) {
    const csrfToken = await ensureCsrfToken();
    if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
  }
  return fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    ...init,
    method,
    headers,
  });
}

function pickServiceImage(s: Record<string, unknown>): string | null {
  const candidates = [
    s.featured_image,
    s.featuredImage,
    s.image,
    s.image_url,
    s.imageUrl,
    s.thumbnail,
    s.thumbnail_url,
  ];
  for (const value of candidates) {
    const url = String(value ?? '').trim();
    if (url.startsWith('http') || url.startsWith('/')) return url;
  }
  return null;
}

function mapApiServiceToUi(s: Record<string, unknown>, i: number): ServiceItem {
  const idVal = Number(s.service_id ?? s.id ?? i + 1);
  return {
    id: Number.isFinite(idVal) && idVal > 0 ? idVal : i + 1,
    title: String(s.name ?? s.title ?? '').trim(),
    tagline: String(s.tagline ?? '').trim(),
    description: String(s.description ?? '').trim(),
    featured_image: pickServiceImage(s),
    videoUrl: String(s.service_url ?? s.serviceUrl ?? s.url ?? '').trim(),
    videoFile: null,
  };
}

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
  return { id: numericId, platform, url };
}

function mapGalleryItem(raw: Record<string, unknown>, index: number): GalleryItem | null {
  const url = String(
    raw.url ?? raw.secure_url ?? raw.file_url ?? raw.media_url ?? raw.image_url ?? '',
  ).trim();
  if (!url.startsWith('http') && !url.startsWith('/')) return null;
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

function isVideoMedia(item: GalleryItem): boolean {
  const mime = String(item.mimeType ?? '').toLowerCase();
  if (mime.startsWith('video/')) return true;
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(item.url);
}

async function loadUserPortfolio(): Promise<PortfolioData | null> {
  const profileRes = await authFetch(`${API}/api/vcard/profile`);
  if (!profileRes.ok) return null;
  const profilePayload = await profileRes.json().catch(() => null);
  const p = (profilePayload?.profile ?? null) as Record<string, unknown> | null;
  if (!p) return null;

  const addresses = Array.isArray(p.addresses) ? (p.addresses as Record<string, unknown>[]) : [];
  const fallbackAddress =
    p.address && typeof p.address === 'object' ? (p.address as Record<string, unknown>) : {};
  const addr = addresses[0] ?? fallbackAddress;
  const alias = String(p.custom_uri ?? '').trim();
  const ownerBizcardId = String(p.bizcard_id ?? p.bizcardId ?? '').trim();

  const apiServices = Array.isArray(p.services) ? (p.services as Record<string, unknown>[]) : [];
  let services = apiServices
    .filter((s) => s.is_visible !== false && s.isVisible !== false)
    .map((s, i) => mapApiServiceToUi(s, i))
    .filter((s) => Boolean(s.title || s.description || s.videoUrl || s.featured_image));

  try {
    const userId = String(p.user_id ?? '').trim();
    const scopedParams: string[] = ['type=all'];
    if (userId) scopedParams.unshift(`userId=${encodeURIComponent(userId)}`);
    else if (alias) scopedParams.unshift(`username=${encodeURIComponent(alias)}`);
    if (userId || alias) {
      const modularRes = await authFetch(`${API}/api/vcard/services?${scopedParams.join('&')}`);
      if (modularRes.ok) {
        const modularPayload = await modularRes.json();
        const modularData = (modularPayload?.data ?? {}) as Record<string, unknown>;
        const modularServicesRaw = Array.isArray(modularData.services) ? modularData.services : [];
        const modularServices = modularServicesRaw
          .map((s: Record<string, unknown>, i: number) => mapApiServiceToUi(s, i))
          .filter((s: ServiceItem) => Boolean(s.title || s.description || s.videoUrl || s.featured_image));
        if (modularServices.length > 0) services = modularServices;
      }
    }
  } catch {
    // keep profile services
  }

  let gallery: GalleryItem[] = [];
  let videos: VideoItem[] = [];
  if (ownerBizcardId) {
    try {
      const galleryRes = await authFetch(
        `${API}/api/bizcard/${encodeURIComponent(ownerBizcardId)}/gallery`,
      );
      if (galleryRes.ok) {
        const galleryPayload = await galleryRes.json();
        const galleryData = (galleryPayload?.data ?? galleryPayload) as Record<string, unknown>;
        const ownerMedia = Array.isArray(galleryData.media)
          ? galleryData.media
          : Array.isArray(galleryData.gallery)
            ? galleryData.gallery
            : [];
        const mapped = ownerMedia
          .map((item: Record<string, unknown>, index: number) => mapGalleryItem(item, index))
          .filter((item): item is GalleryItem => Boolean(item));
        gallery = mapped.filter((item) => !isVideoMedia(item));
        videos = mapped
          .filter((item) => isVideoMedia(item))
          .map((item, index) => ({
            id: item.id || index + 1,
            title: item.title || `Video ${index + 1}`,
            description: item.description || '',
            fileName: item.url,
            fileSize: 0,
            mimeType: item.mimeType,
            videoDataUrl: null,
          }));
      }
    } catch {
      // gallery optional
    }
  }

  if (videos.length === 0) {
    videos = services
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

  const rawSocials = Array.isArray(p.socials)
    ? (p.socials as Record<string, unknown>[])
    : Array.isArray(p.social_links)
      ? (p.social_links as Record<string, unknown>[])
      : [];

  const coverUrl = (p.cover_url as string | null) ?? null;

  return {
    bizCard: {
      urlAlias: alias,
      bizCardName: String(p.vcard_name ?? ''),
      companyName: String(p.company_name ?? ''),
      description: String(p.vcard_description ?? ''),
      occupation: String(p.job_position ?? p.occupation ?? ''),
      profileImage: (p.profile_url as string | null) ?? null,
      coverImage: coverUrl,
      coverImagePosition: String(p.cover_img_position ?? 'center center'),
      coverType: inferCoverTypeFromUrl(coverUrl),
      coverFileName: null,
    },
    vcard: {
      firstName: String(p.first_name ?? ''),
      middleName: String(p.middle_name ?? ''),
      lastName: String(p.last_name ?? ''),
      professionalTitle: String(p.prof_title ?? p.job_position ?? p.occupation ?? ''),
      postNominalLetters: String(p.post_nominal ?? ''),
      suffix: String(p.suffix ?? ''),
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
      socialLinks: rawSocials
        .filter((s) => String(s.url ?? '').trim() || String(s.platform ?? '').trim())
        .map((s, i) => mapApiSocialToUi(s, i)),
    },
    services,
    selectedTheme: String(p.theme_path ?? p.themePath ?? p.selected_theme ?? 'bubble-gem').trim() || 'bubble-gem',
    gallery,
    videos,
    galleryAvailable: Boolean(p.show_gallery ?? true),
    inquiryEnabled: Boolean(p.show_inquiry_card ?? true),
    showCoverPhoto: Boolean(p.show_cover_photo ?? true),
    showInquiryCard: Boolean(p.show_inquiry_card ?? true),
    showAssociateCount: p.show_associate_count === true,
    showMutualAssociates: p.show_mutual_associates === true,
    showEmail: p.show_email !== false,
  };
}

export default function CustomizeTemplatesTab() {
  const paidFamilies = useMemo(
    () => THEME_FAMILIES.filter((entry) => entry.id.startsWith('paidthemes/')),
    [],
  );
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);
  const [previewModal, setPreviewModal] = useState<string | null>(null);
  const [catalogByThemeId, setCatalogByThemeId] = useState<Record<string, PaidCatalogEntry>>({});
  const [busy, setBusy] = useState(false);
  const [requestThemeOpen, setRequestThemeOpen] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [portfolio, templatesRes, purchasesRes] = await Promise.all([
        loadUserPortfolio(),
        // Paid themes may be tagged category=premium or customize-templates depending on seed/env.
        authFetch(`${API}/api/marketplace/templates?limit=50`),
        authFetch(`${API}/api/marketplace/user/purchases?item_type=template&limit=100`),
      ]);

      setPortfolioData(portfolio);

      const templatesPayload = templatesRes.ok ? await templatesRes.json().catch(() => null) : null;
      const templates = Array.isArray(templatesPayload?.data?.templates)
        ? (templatesPayload.data.templates as Array<Record<string, unknown>>)
        : [];

      const purchasesPayload = purchasesRes.ok ? await purchasesRes.json().catch(() => null) : null;
      const purchases = Array.isArray(purchasesPayload?.data?.purchases)
        ? (purchasesPayload.data.purchases as Array<Record<string, unknown>>)
        : [];

      const nextCatalog: Record<string, PaidCatalogEntry> = {};
      for (const family of THEME_FAMILIES.filter((entry) => entry.id.startsWith('paidthemes/'))) {
        for (const themeId of family.themeIds) {
          const match = matchCatalogTemplate(templates, themeId, family.name);
          const catalogId = match?.id ? String(match.id) : null;
          const ownedFromFlag = match?.isOwned === true;
          const ownedFromPurchases =
            !!catalogId &&
            purchases.some(
              (purchase) => String(purchase.itemId ?? purchase.item_id ?? '') === catalogId,
            );
          nextCatalog[themeId] = {
            catalogId,
            isOwned: ownedFromFlag || ownedFromPurchases,
            price:
              match?.price != null && Number.isFinite(Number(match.price))
                ? Number(match.price)
                : DEFAULT_PAID_THEME_PRICE,
          };
        }
      }
      setCatalogByThemeId(nextCatalog);
    } catch {
      setPortfolioData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewModal(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!previewModal) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [previewModal]);

  const previewTheme = previewModal ? getTheme(previewModal) : null;
  const previewFamily =
    paidFamilies.find((family) => family.themeIds.includes(previewModal ?? '')) ?? null;
  const previewCatalog = previewModal ? catalogByThemeId[previewModal] : undefined;
  const isOwned = previewCatalog?.isOwned === true;
  const catalogTemplateId = previewCatalog?.catalogId ?? null;

  const portfolioForPreview = useMemo<PortfolioData | null>(() => {
    if (!portfolioData) return null;
    return {
      ...portfolioData,
      selectedTheme:
        selectedTheme ||
        previewModal ||
        paidFamilies[0]?.defaultThemeId ||
        'bubble-gem',
    };
  }, [portfolioData, selectedTheme, previewModal, paidFamilies]);

  const notifyCartUpdated = () => {
    try {
      window.localStorage.setItem('ontap_cart_updated_at', String(Date.now()));
      window.dispatchEvent(new Event('ontap_cart_updated'));
      window.dispatchEvent(new Event('cart:refresh'));
    } catch {
      // ignore storage/event failures
    }
  };

  const removeThemeCartItem = async (cartItemId: string) => {
    const id = cartItemId.trim();
    if (!id) return;
    try {
      await authFetch(`${API}/api/marketplace/cart/remove/${id}`, {
        method: 'DELETE',
      });
    } catch {
      // best-effort cleanup so abandoned theme buys do not linger in cart
    } finally {
      notifyCartUpdated();
    }
  };

  const handleBuyTheme = async () => {
    if (!catalogTemplateId || !previewTheme) {
      showToast('Template catalog entry is not available yet.', 'error');
      return;
    }
    setBusy(true);
    let cartItemId = '';
    let proceeded = false;
    try {
      // Temporary cart line for marketplace checkout only — not kept unless payment proceeds.
      const addResponse = await authFetch(`${API}/api/marketplace/cart/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemType: 'template',
          itemId: catalogTemplateId,
          quantity: 1,
        }),
      });
      const addPayload = await addResponse.json().catch(() => null);
      if (!addResponse.ok || !addPayload?.success) {
        throw new Error(
          typeof addPayload?.error === 'string'
            ? addPayload.error
            : 'Unable to start theme purchase.',
        );
      }

      cartItemId = String(addPayload?.data?.cartItem?.id ?? '').trim();
      if (!cartItemId) {
        throw new Error('Cart item was created but no id was returned.');
      }

      const checkoutResponse = await authFetch(`${API}/api/marketplace/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedItemIds: [cartItemId],
          shipping_method: 'Pick Up at Store',
          shipping_address: null,
          notes: `Paid theme purchase: ${previewTheme.name}`,
        }),
      });
      const checkoutPayload = await checkoutResponse.json().catch(() => null);
      if (!checkoutResponse.ok || !checkoutPayload?.success) {
        const message =
          typeof checkoutPayload?.error === 'string'
            ? checkoutPayload.error
            : typeof checkoutPayload?.error?.message === 'string'
              ? checkoutPayload.error.message
              : 'Unable to create payment invoice.';
        throw new Error(message);
      }

      const orderObj = checkoutPayload?.data?.order ?? checkoutPayload?.data ?? null;
      const invoiceUrl =
        (typeof orderObj?.invoiceUrl === 'string' && orderObj.invoiceUrl) ||
        (typeof orderObj?.invoice_url === 'string' && orderObj.invoice_url) ||
        (typeof checkoutPayload?.data?.invoiceUrl === 'string' &&
          checkoutPayload.data.invoiceUrl) ||
        '';

      if (orderObj?.requiresPayment === false) {
        proceeded = true;
        notifyCartUpdated();
        showToast('Theme purchase confirmed. No payment required.', 'success');
        setPreviewModal(null);
        await reload();
        return;
      }

      if (!invoiceUrl) {
        throw new Error('Invoice created but no payment URL was returned.');
      }

      proceeded = true;
      notifyCartUpdated();
      showToast('Redirecting to Xendit payment…', 'success');
      setPreviewModal(null);
      window.location.href = invoiceUrl;
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Unable to start theme purchase.',
        'error',
      );
    } finally {
      if (cartItemId && !proceeded) {
        await removeThemeCartItem(cartItemId);
      }
      setBusy(false);
    }
  };

  const handleApply = async () => {
    if (!previewModal || !portfolioForPreview || !previewTheme) return;
    if (!isOwned) {
      showToast(`Purchase ${previewTheme.name} before applying it to your portfolio.`, 'error');
      return;
    }

    setBusy(true);
    try {
      const ok = await persistThemePath(previewModal);
      if (!ok) throw new Error('Unable to apply this template.');
      if (portfolioForPreview.bizCard.urlAlias) {
        publishBizcardThemeToCache({
          urlAlias: portfolioForPreview.bizCard.urlAlias,
          themeId: previewModal,
        });
      }
      setSelectedTheme(previewModal);
      setPreviewModal(null);
      showToast(`${previewTheme.name} is now your active portfolio theme.`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to apply this template.', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (paidFamilies.length === 0) {
    return (
      <div className="rounded-2xl border border-[#d4dbec] bg-white p-6 shadow-sm sm:p-8 flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <p className="text-sm text-[#7c88ab]">Paid template is not available yet.</p>
        <button
          type="button"
          onClick={() => setRequestThemeOpen(true)}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1e3a8a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d2f75]"
        >
          <Sparkles className="h-4 w-4" />
          Request Custom Theme
        </button>
        <RequestCustomThemeModal
          open={requestThemeOpen}
          onClose={() => setRequestThemeOpen(false)}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-[#d4dbec] bg-white p-6 shadow-sm sm:p-8">
        <SectionLoader text="Loading your portfolio preview..." />
      </div>
    );
  }

  if (!portfolioForPreview) {
    return (
      <div className="rounded-2xl border border-[#d4dbec] bg-white p-6 shadow-sm sm:p-8 flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <p className="text-sm text-[#7c88ab]">Unable to load your BizCard data for preview.</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => void reload()}
            className="rounded-lg border border-[#d4dbec] bg-white px-4 py-2 text-xs font-semibold text-[#2A4792] transition hover:bg-[#f2f5ff]"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={() => setRequestThemeOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1e3a8a] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#1d2f75]"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Request Custom Theme
          </button>
        </div>
        <RequestCustomThemeModal
          open={requestThemeOpen}
          onClose={() => setRequestThemeOpen(false)}
        />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#d4dbec] bg-white p-6 shadow-sm sm:p-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <p className="text-sm text-[#7c88ab] max-w-xl text-center sm:text-left">
          Preview paid Premium templates with your BizCard data. Purchase before
          applying — or request a fully custom theme for ₱200.
        </p>
        <button
          type="button"
          onClick={() => setRequestThemeOpen(true)}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1e3a8a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d2f75]"
        >
          <Sparkles className="h-4 w-4" />
          Request Custom Theme · ₱200
        </button>
      </div>

      <div className="mx-auto grid w-full max-w-5xl grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5">
        {paidFamilies.map((family) => {
          const themeId = family.defaultThemeId;
          return (
            <PaidTemplateCard
              key={family.id}
              family={family}
              selectedTheme={selectedTheme}
              previewData={portfolioForPreview}
              isOwned={catalogByThemeId[themeId]?.isOwned === true}
              price={catalogByThemeId[themeId]?.price ?? DEFAULT_PAID_THEME_PRICE}
              onSelectTheme={(id) => {
                setSelectedTheme(id);
                setPreviewModal(id);
              }}
            />
          );
        })}
      </div>

      <RequestCustomThemeModal
        open={requestThemeOpen}
        onClose={() => setRequestThemeOpen(false)}
      />

      {previewModal && previewTheme && previewFamily ? (
        <ModalPortal isOpen onClose={() => setPreviewModal(null)}>
          <div
            className="relative w-[min(100vw-2rem,42rem)] max-h-[90vh] overflow-hidden rounded-3xl bg-white shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label={`${previewTheme.name} preview`}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-linear-to-r from-slate-50 to-slate-100/50">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: previewTheme.gradient }}
                >
                  <Eye className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-slate-900 truncate">{previewTheme.name}</h3>
                  <p className="text-xs text-slate-500 truncate">
                    {previewFamily.name} · your BizCard data
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewModal(null)}
                className="h-9 w-9 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors shrink-0"
                aria-label="Close preview"
              >
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>

            <div className="overflow-y-auto max-h-[calc(90vh-9.5rem)] bg-linear-to-b from-slate-100 to-slate-50 px-5 py-6">
              <div className="relative w-full max-w-md mx-auto">
                <div className="relative rounded-[32px] bg-gray-500 p-2.5 shadow-2xl">
                  <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-20 h-1.5 bg-slate-900 rounded-full z-10" />
                  <PortfolioPreviewFrame
                    data={portfolioForPreview}
                    themeId={previewModal}
                    height={620}
                    scale={0.65}
                    className="rounded-[26px] border-0 shadow-none bg-slate-900"
                    scrollClassName="bg-slate-900"
                    isMobile
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 px-5 py-4 border-t border-slate-100 bg-white">
              <button
                type="button"
                onClick={() => setPreviewModal(null)}
                className="flex-1 border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold py-3 rounded-xl transition-colors text-sm cursor-pointer"
              >
                Cancel
              </button>
              {isOwned ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleApply()}
                  className="flex-1 bg-[#1e3a8a] hover:bg-[#1d2f75] disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors text-sm cursor-pointer inline-flex items-center justify-center gap-2"
                >
                  {busy ? <InlineLoader /> : <Check className="h-4 w-4" />}
                  {busy ? 'Applying...' : 'Apply Theme'}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleBuyTheme()}
                  className="flex-1 bg-[#1e3a8a] hover:bg-[#1d2f75] disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors text-sm cursor-pointer inline-flex items-center justify-center gap-2"
                >
                  {busy ? <InlineLoader /> : <CreditCard className="h-4 w-4" />}
                  {busy
                    ? 'Processing...'
                    : `Buy Theme · ₱${(
                        previewCatalog?.price ?? DEFAULT_PAID_THEME_PRICE
                      ).toLocaleString('en-PH')}`}
                </button>
              )}
            </div>
          </div>
        </ModalPortal>
      ) : null}
    </div>
  );
}

function PaidTemplateCard({
  family,
  selectedTheme,
  previewData,
  isOwned,
  price,
  onSelectTheme,
}: {
  family: ThemeFamilyDef;
  selectedTheme: string | null;
  previewData: PortfolioData;
  isOwned: boolean;
  price: number;
  onSelectTheme: (themeId: string) => void;
}) {
  const activeThemeId = family.defaultThemeId;
  const activeTheme = getTheme(activeThemeId);
  const isFamilySelected = Boolean(
    selectedTheme && family.themeIds.includes(selectedTheme),
  );
  const badge = TIER_BADGE[family.tier] ?? TIER_BADGE.basic;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelectTheme(activeThemeId)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onSelectTheme(activeThemeId);
      }}
      className={`group relative rounded-3xl overflow-hidden border transition-all duration-300 cursor-pointer text-left ${
        isFamilySelected
          ? 'border-[#1e3a8a] ring-2 ring-blue-200/70 scale-[1.01] shadow-[0_18px_36px_rgba(30,58,138,0.16)]'
          : 'border-slate-200 hover:border-slate-300 hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(15,23,42,0.12)]'
      }`}
    >
      <div className="h-3 w-full" style={{ background: activeTheme.gradient }} />

      <div className="p-4 sm:p-5 bg-white">
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <h3 className={`text-lg font-bold ${isFamilySelected ? 'text-[#1e3a8a]' : 'text-slate-900'}`}>
            {family.name}
          </h3>
          <span
            className="inline-flex items-center rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide whitespace-nowrap"
            style={{ backgroundColor: badge.bg, color: badge.text }}
          >
            {badge.label}
          </span>
        </div>

        <p className="mb-3 text-sm font-semibold text-[#1e3a8a]">
          ₱{price.toLocaleString('en-PH')}
          {isOwned ? (
            <span className="ml-2 text-xs font-medium text-emerald-600">Owned</span>
          ) : null}
        </p>

        <ScaledThemePreview
          data={previewData}
          themeId={activeThemeId}
          className="h-64 sm:h-72 bg-slate-100/80"
        />
      </div>

      {isFamilySelected ? (
        <div className="absolute top-4 right-4 rounded-full bg-[#1e3a8a] text-white text-[10px] font-bold px-2.5 py-1 shadow-md inline-flex items-center gap-1">
          <Check className="h-3 w-3" /> Selected
        </div>
      ) : null}
    </div>
  );
}
