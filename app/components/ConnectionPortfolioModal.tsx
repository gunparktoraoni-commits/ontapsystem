'use client';

import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, UserMinus, Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/apiFetch';
import BizCardPreview from './BizCardPreview';
import { showToast } from './Toast';
import { showConfirmDialog } from './ConfirmDialog';
import type {
  GalleryItem,
  PortfolioData,
  ServiceItem,
  SocialLink,
  VideoItem,
} from '../types';
import { toContactLinkLabelMode } from '../types';
import {
  inferCoverTypeFromUrl,
  withServablePortfolioMedia,
} from '../lib/portfolioDisplay';
import { normalizePortfolioThemeId } from '../themes/ThemeLoader';

type ConnectionPortfolioModalProps = {
  open: boolean;
  alias: string | null;
  connectionId: string | null;
  onClose: () => void;
  onUnconnectSuccess: (connectionId: string) => void;
};

type PublicProfilePayload = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toStr(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function toCoordinate(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function mapPublicPayloadToPortfolio(
  payload: PublicProfilePayload,
  alias: string,
): PortfolioData {
  const address = asRecord(payload.address) ?? {};
  const socialsRaw = payload.social_links ?? payload.socials;
  const socials = Array.isArray(socialsRaw) ? socialsRaw : [];
  const servicesRaw = Array.isArray(payload.services) ? payload.services : [];
  const galleryRaw = Array.isArray(payload.gallery) ? payload.gallery : [];
  const videosRaw = Array.isArray(payload.videos) ? payload.videos : [];

  const composedName = toStr(payload.name);
  let firstName = toStr(payload.first_name);
  let lastName = toStr(payload.last_name);
  if (!firstName && !lastName && composedName) {
    const parts = composedName.split(/\s+/);
    firstName = parts[0] ?? '';
    lastName = parts.slice(1).join(' ');
  }

  const profileImage =
    toStr(payload.profile_image, payload.profile_url, payload.profile_photo) || null;
  const coverImage =
    toStr(payload.cover_image, payload.cover_url, payload.background_image) || null;

  const selectedTheme =
    normalizePortfolioThemeId(
      payload.theme ??
        payload.theme_path ??
        payload.bizcard_theme ??
        payload.themePath,
    ) || 'elegant-dark';

  const socialLinks: SocialLink[] = [];
  socials.forEach((item, index) => {
    const row = asRecord(item);
    if (!row) return;
    const platform = toStr(row.platform, row.name, row.label);
    const url = toStr(row.url, row.link, row.href);
    if (!platform || !url) return;
    socialLinks.push({
      id: Number(row.id ?? row.socials_id ?? index + 1) || index + 1,
      platform,
      url,
    });
  });

  const services: ServiceItem[] = [];
  servicesRaw.forEach((item, index) => {
    const row = asRecord(item);
    if (!row) return;
    const mediaRaw = Array.isArray(row.media) ? row.media : [];
    const media: NonNullable<ServiceItem['media']> = [];
    mediaRaw.forEach((mediaItem, mediaIndex) => {
      const mediaRow = asRecord(mediaItem);
      if (!mediaRow) return;
      const url = toStr(mediaRow.url, mediaRow.file_url);
      if (!url) return;
      media.push({
        id: toStr(mediaRow.id, String(mediaIndex + 1)) || String(mediaIndex + 1),
        url,
        mimeType: toStr(mediaRow.mimeType, mediaRow.mime_type) || null,
        fileName: toStr(mediaRow.fileName, mediaRow.file_name) || null,
      });
    });

    services.push({
      id: Number(row.id ?? row.service_id ?? index + 1) || index + 1,
      title: toStr(row.name, row.title) || 'Service',
      tagline: toStr(row.tagline),
      description: toStr(row.description),
      featured_image: toStr(row.featured_image) || null,
      videoUrl: '',
      videoFile: null,
      media,
    });
  });

  const gallery: GalleryItem[] = [];
  galleryRaw.forEach((item, index) => {
    const row = asRecord(item);
    if (!row) return;
    const url = toStr(row.url, row.file_url, row.src);
    if (!url) return;
    gallery.push({
      id: Number(row.id ?? index + 1) || index + 1,
      url,
      title: toStr(row.title, row.name),
      description: toStr(row.description),
      altText: toStr(row.altText, row.alt_text) || null,
      fileName: toStr(row.fileName, row.file_name) || null,
      mimeType: toStr(row.mimeType, row.mime_type) || null,
    });
  });

  const videos: VideoItem[] = [];
  videosRaw.forEach((item, index) => {
    const row = asRecord(item);
    if (!row) return;
    const videoDataUrl = toStr(row.url, row.file_url, row.src) || null;
    if (!videoDataUrl) return;
    videos.push({
      id: Number(row.id ?? index + 1) || index + 1,
      title: toStr(row.title, row.name),
      description: toStr(row.description),
      fileName: toStr(row.fileName, row.file_name) || 'video',
      fileSize: Number(row.fileSize ?? row.file_size ?? 0) || 0,
      videoDataUrl,
      mimeType: toStr(row.mimeType, row.mime_type) || null,
    });
  });

  const languagesValue = payload.languages;
  const languages = Array.isArray(languagesValue)
    ? languagesValue.map((entry) => toStr(entry)).filter(Boolean).join(', ')
    : toStr(languagesValue);

  const galleryAvailable =
    typeof payload.gallery_available === 'boolean'
      ? payload.gallery_available
      : typeof payload.galleryAvailable === 'boolean'
        ? payload.galleryAvailable
        : undefined;

  const inquiryEnabled =
    typeof payload.inquiry_enabled === 'boolean'
      ? payload.inquiry_enabled
      : typeof payload.inquiryEnabled === 'boolean'
        ? payload.inquiryEnabled
        : undefined;

  const portfolio: PortfolioData = {
    bizCard: {
      urlAlias: toStr(payload.url_alias, payload.custom_uri, alias) || alias,
      bizCardName:
        toStr(payload.bizcard_name, payload.vcard_name, composedName) ||
        `${firstName} ${lastName}`.trim() ||
        alias,
      companyName: toStr(payload.company) || undefined,
      description: toStr(payload.description, payload.bio),
      occupation: toStr(payload.occupation, payload.professional_title, payload.job_position),
      profileImage,
      coverImage,
      coverType: inferCoverTypeFromUrl(coverImage),
      coverFileName: null,
      coverImagePosition: toStr(payload.cover_img_position) || undefined,
    },
    vcard: {
      firstName,
      middleName: toStr(payload.middle_name),
      lastName,
      professionalTitle: toStr(payload.professional_title, payload.prof_title),
      postNominalLetters: toStr(payload.post_nominal, payload.postNominalLetters),
      suffix: toStr(payload.suffix) || 'N/A',
      about: toStr(payload.bio, payload.about, payload.description),
      contactNumber: toStr(payload.phone, payload.contact_number, payload.contact),
      secondaryNumber: toStr(payload.alt_phone, payload.alt_contact_number, payload.alt_contact),
      telephoneNumber: toStr(payload.telephone, payload.telephone_number),
      altTelephoneNumber: toStr(payload.alt_telephone, payload.alt_telephone_number),
      email: toStr(payload.email),
      alternativeEmail: toStr(payload.alt_email, payload.alternative_email),
      languages,
      addressArea: toStr(address.area, payload.area),
      addressHouseNo: '',
      addressBrgy: toStr(address.baranggay, address.brgy, payload.barangay),
      addressCity: toStr(address.city, payload.city),
      addressRegion: toStr(address.region, payload.region),
      addressZipcode: toStr(address.zip, address.zipcode, payload.zip_code),
      addressMapLink: toStr(address.map_link, address.plus_code),
      addressLandmark: toStr(address.landmark),
      addressLatitude: toCoordinate(address.latitude),
      addressLongitude: toCoordinate(address.longitude),
      socialLinks,
    },
    services,
    selectedTheme,
    gallery: galleryAvailable === false ? [] : gallery,
    videos: galleryAvailable === false ? [] : videos,
    galleryAvailable,
    inquiryEnabled,
    showCoverPhoto:
      typeof payload.show_cover_photo === 'boolean'
        ? payload.show_cover_photo
        : typeof payload.showCoverPhoto === 'boolean'
          ? payload.showCoverPhoto
          : undefined,
    showInquiryCard:
      typeof payload.show_inquiry_card === 'boolean'
        ? payload.show_inquiry_card
        : typeof payload.showInquiryCard === 'boolean'
          ? payload.showInquiryCard
          : undefined,
    showEmail:
      typeof payload.show_email === 'boolean'
        ? payload.show_email
        : typeof payload.showEmail === 'boolean'
          ? payload.showEmail
          : undefined,
    contactLinkLabel: toContactLinkLabelMode(
      payload.contact_link_label ?? payload.contactLinkLabel,
    ),
    subscriptionTier: toStr(payload.subscription_tier, payload.subscriptionTier) || null,
  };

  return withServablePortfolioMedia(portfolio);
}

export default function ConnectionPortfolioModal({
  open,
  alias,
  connectionId,
  onClose,
  onUnconnectSuccess,
}: ConnectionPortfolioModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unconnecting, setUnconnecting] = useState(false);

  useEffect(() => {
    if (!open || !alias) {
      setLoading(true);
      setPortfolioData(null);
      setError(null);
      return;
    }

    let cancelled = false;

    const fetchPortfolioData = async () => {
      setLoading(true);
      setError(null);
      setPortfolioData(null);

      try {
        const response = await apiFetch(
          `/api/public/${encodeURIComponent(alias)}?_t=${Date.now()}`,
        );
        const data = (await response.json()) as Record<string, unknown>;

        if (!response.ok || data.success === false) {
          throw new Error(
            typeof data.error === 'string' ? data.error : 'Failed to load portfolio',
          );
        }

        const profile =
          asRecord(data.data) ??
          asRecord(data.profile) ??
          asRecord(data.vcard) ??
          data;

        if (!profile || typeof profile !== 'object') {
          throw new Error('Portfolio not available');
        }

        if (!cancelled) {
          setPortfolioData(mapPublicPayloadToPortfolio(profile as PublicProfilePayload, alias));
        }
      } catch (err) {
        console.error('Failed to fetch portfolio:', err);
        if (!cancelled) {
          setError(
            err instanceof Error && err.message
              ? err.message
              : 'Failed to load portfolio. Please try again.',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchPortfolioData();

    return () => {
      cancelled = true;
    };
  }, [open, alias]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !unconnecting) {
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    requestAnimationFrame(() => dialogRef.current?.focus());

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, unconnecting, onClose]);

  const handleUnconnect = async () => {
    if (!connectionId || unconnecting) return;

    const confirmed = await showConfirmDialog({
      title: "Remove this connection?",
      message:
        "This person will be removed from your connections. You can send a new connection request later if you change your mind.",
      confirmLabel: "Remove connection",
      variant: "danger",
    });

    if (!confirmed) return;

    setUnconnecting(true);

    try {
      const response = await apiFetch('/api/connections/remove', {
        method: 'DELETE',
        body: JSON.stringify({
          connection_id: connectionId,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        showToast('Connection removed successfully.', 'success');
        window.dispatchEvent(new CustomEvent('ontap:connections-changed'));
        onClose();
        onUnconnectSuccess(connectionId);
      } else {
        showToast(
          typeof data.error === 'string' ? data.error : 'Failed to remove connection.',
          'error',
        );
      }
    } catch (err) {
      console.error('Failed to remove connection:', err);
      showToast('Failed to remove connection. Please try again.', 'error');
    } finally {
      setUnconnecting(false);
    }
  };

  if (!open) return null;

  const title =
    loading
      ? 'Loading Portfolio...'
      : portfolioData?.bizCard?.bizCardName || (alias ? `@${alias}` : 'User Portfolio');

  return createPortal(
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !unconnecting) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="portfolio-modal-title"
        tabIndex={-1}
        className="relative flex w-full max-w-6xl max-h-[90vh] flex-col rounded-2xl border border-white/20 bg-white shadow-2xl outline-none overflow-hidden"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
          <h2 id="portfolio-modal-title" className="text-xl font-bold text-gray-900">
            {title}
          </h2>
          <div className="flex items-center gap-2">
            {connectionId ? (
              <button
                type="button"
                onClick={() => void handleUnconnect()}
                disabled={unconnecting}
                className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-wait disabled:opacity-60"
                aria-label="Remove connection"
              >
                {unconnecting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Removing...
                  </>
                ) : (
                  <>
                    <UserMinus className="h-4 w-4" />
                    Unconnect
                  </>
                )}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              disabled={unconnecting}
              aria-label="Close modal"
              className="rounded-full p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <Loader2 className="mx-auto h-12 w-12 animate-spin text-blue-600" />
                <p className="mt-4 text-sm text-gray-600">Loading portfolio...</p>
              </div>
            </div>
          )}

          {error && !loading && (
            <div className="flex items-center justify-center py-20">
              <div className="text-center px-6">
                <p className="text-base font-semibold text-red-600">{error}</p>
                <p className="mt-2 text-sm text-gray-500">
                  You can still remove this connection using Unconnect.
                </p>
              </div>
            </div>
          )}

          {portfolioData && !loading && !error && (
            <div className="bg-gray-50">
              <BizCardPreview data={portfolioData} mini={false} showFAB={false} />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
