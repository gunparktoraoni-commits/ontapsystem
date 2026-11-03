"use client";

import React, { useEffect, useState } from "react";
import { use } from "react";
import Link from "next/link";
import BizCardPreview from "../components/BizCardPreview";
import { trackPortfolioView } from "../themes/shared";
import { normalizePortfolioThemeId } from "../themes/ThemeLoader";
import type { GalleryItem, PortfolioData } from "../types";
import { toContactLinkLabelMode } from "../types";
import { fetchPhysicalCardScan } from "@/lib/bizcard/scan-session";
import { isLikelyPhysicalSerialSlug } from "@/lib/bizcard/serial-id-format";
import { htmlToPlainText, normalizeDisplayText } from "../lib/plainText";
import { sanitizePortfolioRichHtml, isRichTextEmpty } from "../lib/richText";
import {
  toPortfolioPhoneDigits,
  withServablePortfolioMedia,
  inferCoverTypeFromUrl,
} from "../lib/portfolioDisplay";
import {
  hardResetPortfolioAliasCache,
} from "../lib/portfolioBrowserCache";
import { FullPageLoader } from "../components/Loader";
const API = "";
const USER_SYNC_EVENT = "ontap:user-sync";
const PORTFOLIO_BROADCAST_CHANNEL = "ontap-portfolio-sync";
const ENABLE_THEME_STREAM = true;
const POLL_INTERVAL_MS = 10000;
const SERVICE_COOLDOWN_FALLBACK_MS = 30000;
const EVENT_REFRESH_DEBOUNCE_MS = 2500;
const VISITOR_ID_STORAGE_KEY = "ontap_visitor_id";
const VISITOR_TRACK_PREFIX = "ontap_visitor_track";
const VISITOR_TRACK_COOLDOWN_MS = 1000 * 60 * 30;
const SERIAL_TO_ALIAS_PREFIX = "serial_to_alias_";
const LEGACY_QR_PORTFOLIO_PREFIX = "qr_portfolio_";
const DISTRIBUTED_CARDS_KEY = "distributed_cards";
/** Mirrors USERNAME_REGEX in lib/vcard/queries.ts (server-only module). */
const DETAILS_USERNAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

function toPortfolioRedirectUrl(pathOrUrl: string): string {
  const raw = pathOrUrl.trim();
  if (!raw || typeof window === "undefined") return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return `${window.location.origin}${raw}`;
  return `${window.location.origin}/${raw.replace(/^\/+/, "")}`;
}

function normalizePathname(url: string): string {
  if (!url || typeof window === "undefined") return "";
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.pathname.replace(/\/+$/, "").toUpperCase();
  } catch {
    return "";
  }
}

function isSelfSerialTarget(serial: string, candidateUrl: string): boolean {
  const serialPath = `/${serial.toUpperCase()}`;
  return normalizePathname(candidateUrl) === serialPath;
}

function readDistributedPortfolioForSerial(serial: string): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(DISTRIBUTED_CARDS_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return "";
    const match = parsed.find((item) => {
      if (!item || typeof item !== "object") return false;
      const row = item as Record<string, unknown>;
      const rowSerial = String(row.serialId ?? "")
        .trim()
        .toUpperCase();
      return rowSerial === serial;
    }) as Record<string, unknown> | undefined;

    if (!match) return "";
    return String(match.portfolioUrl ?? "").trim();
  } catch {
    return "";
  }
}

function resolveCandidateRedirect(serial: string, value: string): string {
  const next = toPortfolioRedirectUrl(value);
  if (!next) return "";
  if (isSelfSerialTarget(serial, next)) return "";
  return next;
}

function resolveSerialRedirectFromStorage(alias: string): string {
  if (typeof window === "undefined") return "";
  const serial = alias.trim().toUpperCase();
  if (!isLikelyPhysicalSerialSlug(alias)) return "";

  const direct =
    localStorage.getItem(`${SERIAL_TO_ALIAS_PREFIX}${serial}`)?.trim() ?? "";
  const directResolved = resolveCandidateRedirect(serial, direct);
  if (directResolved) return directResolved;

  // Backward compatibility with previously stored QR mapping keys.
  const legacy =
    localStorage.getItem(`${LEGACY_QR_PORTFOLIO_PREFIX}${serial}`)?.trim() ??
    "";
  const legacyResolved = resolveCandidateRedirect(serial, legacy);
  if (legacyResolved) {
    try {
      localStorage.setItem(
        `${SERIAL_TO_ALIAS_PREFIX}${serial}`,
        legacyResolved,
      );
    } catch {
      // Ignore persistence failures; redirect can still proceed.
    }
    return legacyResolved;
  }

  // Fallback for distributed account cache rows created during claim/setup.
  const distributed = readDistributedPortfolioForSerial(serial);
  const distributedResolved = resolveCandidateRedirect(serial, distributed);
  if (distributedResolved) {
    try {
      localStorage.setItem(
        `${SERIAL_TO_ALIAS_PREFIX}${serial}`,
        distributedResolved,
      );
    } catch {
      // Ignore persistence failures; redirect can still proceed.
    }
    return distributedResolved;
  }

  return "";
}

function isSerialLikeAlias(alias: string): boolean {
  return isLikelyPhysicalSerialSlug(alias);
}

function normalizeThemeToken(value: unknown): string {
  return normalizePortfolioThemeId(value);
}

function toThemeSlug(themeId: string | number | null | undefined): string {
  return normalizePortfolioThemeId(themeId);
}
function generateVisitorId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `visitor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function getOrCreateVisitorId(): string {
  if (typeof window === "undefined") return "";
  const existing = localStorage.getItem(VISITOR_ID_STORAGE_KEY)?.trim() ?? "";
  if (existing) return existing;
  const next = generateVisitorId();
  localStorage.setItem(VISITOR_ID_STORAGE_KEY, next);
  return next;
}

function hasActiveAuthSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const authRaw = localStorage.getItem("authUser");
    if (!authRaw) return false;
    const parsed = JSON.parse(authRaw) as Record<string, unknown>;
    return Object.keys(parsed).length > 0;
  } catch {
    return false;
  }
}

interface PortfolioPageProps {
  params: Promise<{ alias: string }>;
  /** Server already resolved this serial to render in place (skip client scan). */
  serialInPlace?: boolean;
  /** Optional canonical alias when the server soft-resolved without redirect. */
  canonicalAlias?: string;
}

type ApiProfile = Record<string, unknown>;

function toStr(...values: unknown[]): string {
  for (const value of values) {
    const s = String(value ?? "").trim();
    if (s) return s;
  }
  return "";
}

function toPlainAbout(...values: unknown[]): string {
  for (const value of values) {
    const s = htmlToPlainText(String(value ?? ""));
    if (s) return s;
  }
  return "";
}

/**
 * About / bio / services details: keep a safe subset of rich formatting
 * (bold/italic/underline + spaces + line breaks) instead of flattening to
 * plain text, so the portfolio renders exactly how the user arranged it.
 */
function toRichAbout(...values: unknown[]): string {
  for (const value of values) {
    if (!isRichTextEmpty(value as string)) {
      return sanitizePortfolioRichHtml(value as string);
    }
  }
  return "";
}

function toDisplayText(...values: unknown[]): string {
  for (const value of values) {
    const s = normalizeDisplayText(String(value ?? ""));
    if (s) return s;
  }
  return "";
}

function toCoordinate(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const num = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function pickUrl(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value !== "object") return "";
  const obj = value as Record<string, unknown>;
  return toStr(
    obj.url,
    obj.secure_url,
    obj.file_url,
    obj.media_url,
    obj.image_url,
    obj.public_url,
  );
}

function toServiceId(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseRetryAfterMs(
  response: Response,
  fallbackMs = SERVICE_COOLDOWN_FALLBACK_MS,
): number {
  const raw = response.headers.get("Retry-After");
  const seconds = Number(raw ?? "");
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(120000, Math.floor(seconds * 1000));
  }
  return fallbackMs;
}

function pickServiceImage(s: Record<string, unknown>): string | null {
  /* Check for explicit featured image first (Section 42) */
  const explicitFeatured = toStr(
    pickUrl(s.featuredImage),
    pickUrl(s.featured_image),
    pickUrl(s.featuredImageUrl),
    pickUrl(s.featured_image_url),
    pickUrl(s.icon),
    pickUrl(s.icon_url),
  );

  if (explicitFeatured) return explicitFeatured;
  /* Check media arrays */
  const mediaCandidates: unknown[] = [
    s.media,
    s.serviceMedia,
    s.service_media,
    s.images,
  ];

  for (const candidate of mediaCandidates) {
    if (!Array.isArray(candidate) || candidate.length === 0) continue;
    /* Backend appends new uploads, so prefer the last item as the most recent image */
    const item = candidate[candidate.length - 1] as Record<string, unknown>;

    const urlFromMedia =
      (item?.url as string | undefined) ??
      (item?.media_url as string | undefined) ??
      (item?.image_url as string | undefined) ??
      (item?.secure_url as string | undefined);

    if (urlFromMedia) return urlFromMedia;
  }

  return (
    toStr(
      pickUrl(s.image),
      pickUrl(s.image_url),
      pickUrl(s.service_image),
      pickUrl(s.service_image_url),
    ) || null
  );
}

function normalizeLocalPhone(value: unknown): string {
  return toPortfolioPhoneDigits(String(value ?? ""));
}

// Robust contact field aliasing — maps all known API variant names to canonical fields
function aliasContactField(
  obj: Record<string, unknown>,
  ...variants: string[]
): string {
  for (const key of variants) {
    const val = obj[key];
    const str = toStr(val);
    if (str) return str;
  }
  return "";
}

function mapGalleryRecord(
  raw: Record<string, unknown>,
  index: number,
): GalleryItem | null {
  const url = String(
    raw.url ?? raw.file_url ?? raw.secure_url ?? raw.thumbnail ?? "",
  ).trim();
  if (!url.startsWith("http")) return null;
  return {
    id: Number(raw.id ?? raw.media_id ?? index + 1),
    url,
    title: String(raw.title ?? raw.file_name ?? "").trim(),
    description: String(raw.description ?? raw.caption ?? "").trim(),
    altText: String(raw.alt_text ?? "").trim() || null,
    fileName: String(raw.file_name ?? "").trim() || null,
    imageDataUrl: null,
    mimeType: String(raw.mime_type ?? "").trim() || null,
  };
}

function extractGalleryFromUnknown(raw: unknown): GalleryItem[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[])
    .map((m, index) => mapGalleryRecord(m, index))
    .filter((item): item is GalleryItem => Boolean(item));
}

function extractVideoUrlFromUnknown(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const v = raw as Record<string, unknown>;
  return toStr(v.url, v.file_url, v.media_url, v.secure_url, v.video_url);
}

function extractVideosFromUnknown(
  raw: unknown,
): NonNullable<PortfolioData["videos"]> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v: Record<string, unknown>, i: number) => ({
      id: Number(v.id ?? i + 1),
      title: String(v.title ?? ""),
      description: String(v.description ?? v.caption ?? ""),
      fileName: extractVideoUrlFromUnknown(v),
      fileSize: 0,
      mimeType:
        String(v.mime_type ?? v.mimeType ?? "").trim() ||
        (String(v.media_type ?? "").toLowerCase() === "video"
          ? "video/mp4"
          : null),
      videoDataUrl: null,
    }))
    .filter((v) => {
      const src = String(v.fileName ?? "").trim();
      return src.startsWith("http") || src.startsWith("/");
    });
}

function mapServicesCollection(data: Record<string, unknown>): {
  services: PortfolioData["services"];
  gallery: GalleryItem[];
  videos: PortfolioData["videos"];
} {
  const servicesRaw = Array.isArray(data.services) ? data.services : [];
  const galleryRaw = Array.isArray(data.gallery) ? data.gallery : [];
  const videosRaw = Array.isArray(data.videos) ? data.videos : [];
  const services = servicesRaw
    .map(
      (s, i) =>
        mapProfileToPortfolio({ services: [s] }, "").services[0] ?? {
          id: i + 1,
          title: "",
          tagline: "",
          description: "",
          featured_image: null,
          videoUrl: "",
          videoFile: null,
        },
    )
    .filter((s) =>
      Boolean(s.title || s.description || s.videoUrl || s.featured_image),
    );
  const gallery = galleryRaw
    .map((g: Record<string, unknown>, index: number) =>
      mapGalleryRecord(g, index),
    )
    .filter((item): item is GalleryItem => Boolean(item));
  const videos = videosRaw
    .map((v: Record<string, unknown>, i: number) => ({
      id: Number(v.id ?? i + 1),
      title: String(v.title ?? ""),
      description: String(v.description ?? ""),
      fileName: extractVideoUrlFromUnknown(v),
      fileSize: 0,
      mimeType:
        String(v.mime_type ?? v.mimeType ?? "").trim() ||
        (String(v.media_type ?? "").toLowerCase() === "video"
          ? "video/mp4"
          : null),
      videoDataUrl: null,
    }))
    .filter((v) => {
      const src = String(v.fileName ?? "").trim();
      return src.startsWith("http") || src.startsWith("/");
    });
  return { services, gallery, videos };
}

function mergeServiceImages(
  base: PortfolioData["services"],
  cached: PortfolioData["services"],
): PortfolioData["services"] {
  if (!Array.isArray(base) || base.length === 0) return cached;
  if (!Array.isArray(cached) || cached.length === 0) return base;
  return base.map((svc, idx) => {
    const byId = cached.find((c) => c.id === svc.id);
    const bySignature = cached.find(
      (c) =>
        c.title.trim().toLowerCase() === svc.title.trim().toLowerCase() &&
        c.description.trim().toLowerCase() ===
          svc.description.trim().toLowerCase() &&
        c.videoUrl.trim().toLowerCase() === svc.videoUrl.trim().toLowerCase(),
    );
    const byIndex = cached[idx];
    const fallback = byId ?? bySignature ?? byIndex;
    if (!fallback) return svc;

    const baseMedia = Array.isArray(svc.media) ? svc.media : [];
    const fallbackMedia = Array.isArray(fallback.media) ? fallback.media : [];
    const media =
      fallbackMedia.length > baseMedia.length ? fallbackMedia : baseMedia;

    const featured =
      svc.featured_image && svc.featured_image.startsWith("http")
        ? svc.featured_image
        : fallback.featured_image && fallback.featured_image.startsWith("http")
          ? fallback.featured_image
          : svc.featured_image ?? fallback.featured_image ?? null;

    return {
      ...svc,
      featured_image: featured,
      media,
    };
  });
}
function mergeCardImages(
  base: PortfolioData,
  fallback: PortfolioData | null,
): PortfolioData {
  if (!fallback) return base;
  const profileImage =
    base.bizCard.profileImage || fallback.bizCard.profileImage || null;
  const coverImage =
    base.bizCard.coverImage || fallback.bizCard.coverImage || null;
  return {
    ...base,
    bizCard: {
      ...base.bizCard,
      profileImage,
      coverImage,
      coverType: base.bizCard.coverType || inferCoverTypeFromUrl(coverImage),
    },
  };
}
function pickNonEmpty(preferred: string, fallback: string): string {
  const p = preferred.trim();
  if (p) return p;
  return fallback.trim();
}
function guardedVCardMerge(
  base: PortfolioData["vcard"],
  fallback: PortfolioData["vcard"] | null,
  options?: { preferApiIdentity?: boolean },
): PortfolioData["vcard"] {
  if (!fallback) return base;
  const preferApiIdentity = options?.preferApiIdentity === true;
  const pickIdentity = (apiValue: string, cacheValue: string): string =>
    preferApiIdentity ? apiValue : pickNonEmpty(apiValue, cacheValue);
  return {
    firstName: pickIdentity(base.firstName, fallback.firstName),
    middleName: pickIdentity(base.middleName, fallback.middleName),
    lastName: pickIdentity(base.lastName, fallback.lastName),
    professionalTitle: pickIdentity(
      base.professionalTitle,
      fallback.professionalTitle,
    ),
    postNominalLetters: pickNonEmpty(
      base.postNominalLetters,
      fallback.postNominalLetters,
    ),
    suffix: pickNonEmpty(base.suffix, fallback.suffix) || "N/A",
    about: pickIdentity(base.about, fallback.about),
    contactNumber: pickNonEmpty(base.contactNumber, fallback.contactNumber),
    secondaryNumber: pickNonEmpty(
      base.secondaryNumber,
      fallback.secondaryNumber,
    ),
    telephoneNumber: pickNonEmpty(
      base.telephoneNumber,
      fallback.telephoneNumber,
    ),
    altTelephoneNumber: pickNonEmpty(
      base.altTelephoneNumber,
      fallback.altTelephoneNumber,
    ),
    email: pickNonEmpty(base.email, fallback.email),
    alternativeEmail: pickNonEmpty(
      base.alternativeEmail,
      fallback.alternativeEmail,
    ),
    languages: pickNonEmpty(base.languages, fallback.languages),
    addressArea: pickNonEmpty(base.addressArea, fallback.addressArea),
    addressHouseNo: pickNonEmpty(base.addressHouseNo, fallback.addressHouseNo),
    addressBrgy: pickNonEmpty(base.addressBrgy, fallback.addressBrgy),
    addressCity: pickNonEmpty(base.addressCity, fallback.addressCity),
    addressRegion: pickNonEmpty(base.addressRegion, fallback.addressRegion),
    addressZipcode: pickNonEmpty(base.addressZipcode, fallback.addressZipcode),
    addressMapLink: pickNonEmpty(base.addressMapLink, fallback.addressMapLink),
    addressLandmark: pickNonEmpty(base.addressLandmark, fallback.addressLandmark),
    addressLatitude: base.addressLatitude ?? fallback.addressLatitude ?? null,
    addressLongitude:
      base.addressLongitude ?? fallback.addressLongitude ?? null,
    socialLinks:
      base.socialLinks.length > 0 ? base.socialLinks : fallback.socialLinks,
  };
}
function mergePortfolioFields(
  base: PortfolioData,
  fallback: PortfolioData | null,
  options?: { preferFallbackTheme?: boolean; preferApiIdentity?: boolean },
): PortfolioData {
  if (!fallback) return base;
  const baseTheme = normalizeThemeToken(base.selectedTheme);
  const fallbackTheme = normalizeThemeToken(fallback.selectedTheme);
  const selectedTheme = options?.preferFallbackTheme
    ? fallbackTheme || baseTheme || "elegant-dark"
    : baseTheme || fallbackTheme || "elegant-dark";
  const preferApiIdentity = options?.preferApiIdentity === true;
  const pickIdentity = (apiValue: string, cacheValue: string): string =>
    preferApiIdentity ? apiValue : pickNonEmpty(apiValue, cacheValue);
  const merged: PortfolioData = {
    ...base,
    bizCard: {
      ...base.bizCard,
      urlAlias: pickNonEmpty(base.bizCard.urlAlias, fallback.bizCard.urlAlias),
      bizCardName: pickIdentity(
        base.bizCard.bizCardName,
        fallback.bizCard.bizCardName,
      ),
      companyName: pickNonEmpty(
        base.bizCard.companyName ?? "",
        fallback.bizCard.companyName ?? "",
      ),
      description: pickIdentity(
        base.bizCard.description,
        fallback.bizCard.description,
      ),
      occupation: pickIdentity(
        base.bizCard.occupation,
        fallback.bizCard.occupation,
      ),
      profileImage:
        base.bizCard.profileImage || fallback.bizCard.profileImage || null,
      coverImage:
        base.bizCard.coverImage || fallback.bizCard.coverImage || null,
      coverType: base.bizCard.coverType || fallback.bizCard.coverType,
      coverFileName:
        base.bizCard.coverFileName || fallback.bizCard.coverFileName || null,
    },
    vcard: guardedVCardMerge(base.vcard, fallback.vcard, {
      preferApiIdentity,
    }),
    services:
      base.services.length > 0 && fallback.services.length > 0
        ? mergeServiceImages(base.services, fallback.services)
        : base.services.length > 0
          ? base.services
          : fallback.services,
    gallery:
      base.galleryAvailable === false
        ? []
        : Array.isArray(base.gallery) && base.gallery.length > 0
          ? base.gallery
          : Array.isArray(fallback.gallery)
            ? fallback.gallery
            : [],
    videos:
      base.galleryAvailable === false
        ? []
        : Array.isArray(base.videos) && base.videos.length > 0
          ? base.videos
          : Array.isArray(fallback.videos)
            ? fallback.videos
            : [],
    selectedTheme,
    galleryAvailable: base.galleryAvailable ?? fallback.galleryAvailable,
    inquiryEnabled: base.inquiryEnabled ?? fallback.inquiryEnabled,
    showCoverPhoto: base.showCoverPhoto ?? fallback.showCoverPhoto,
    showInquiryCard: base.showInquiryCard ?? fallback.showInquiryCard,
    showAssociateCount: base.showAssociateCount ?? fallback.showAssociateCount,
    showMutualAssociates: base.showMutualAssociates ?? fallback.showMutualAssociates,
    showEmail: base.showEmail ?? fallback.showEmail,
    contactLinkLabel: base.contactLinkLabel ?? fallback.contactLinkLabel,
    subscriptionTier:
      base.subscriptionTier ?? fallback.subscriptionTier ?? null,
  };

  return applySubscriptionMediaPolicy(merged);
}

function normalizeContactFields(p: ApiProfile): {
  email: string;
  alternativeEmail: string;
  contactNumber: string;
  secondaryNumber: string;
  telephoneNumber: string;
  altTelephoneNumber: string;
} {
  return {
    email: aliasContactField(
      p,
      "email",
      "email_address",
      "userEmail",
      "user_email",
    ),
    alternativeEmail: aliasContactField(
      p,
      "alt_email",
      "alternativeEmail",
      "alternative_email",
      "altEmail",
    ),
    contactNumber: normalizeLocalPhone(
      aliasContactField(
        p,
        "phone",
        "phone_number",
        "phoneNumber",
        "contact",
        "contactNumber",
        "mobile",
        "mobile_number",
      ),
    ),
    secondaryNumber: normalizeLocalPhone(
      aliasContactField(
        p,
        "alt_phone",
        "alt_contact",
        "alternativeNumber",
        "alternative_number",
        "secondaryNumber",
        "secondary_phone",
      ),
    ),
    telephoneNumber: normalizeLocalPhone(
      aliasContactField(
        p,
        "telephone",
        "telephone_number",
        "telephoneNumber",
        "landline",
      ),
    ),
    altTelephoneNumber: normalizeLocalPhone(
      aliasContactField(
        p,
        "alt_telephone",
        "alt_telephone_number",
        "altTelephoneNumber",
        "alt_landline",
      ),
    ),
  };
}

function parseSubscriptionFlags(p: ApiProfile): {
  galleryAvailable?: boolean;
  inquiryEnabled?: boolean;
  subscriptionTier?: string | null;
} {
  const tierRaw = p.subscription_tier ?? p.subscriptionTier;
  const subscriptionTier =
    typeof tierRaw === "string" && tierRaw.trim() ? tierRaw.trim() : null;

  let galleryAvailable: boolean | undefined;
  if (typeof p.gallery_available === "boolean") {
    galleryAvailable = p.gallery_available;
  } else if (typeof p.galleryAvailable === "boolean") {
    galleryAvailable = p.galleryAvailable;
  }

  let inquiryEnabled: boolean | undefined;
  if (typeof p.inquiry_enabled === "boolean") {
    inquiryEnabled = p.inquiry_enabled;
  } else if (typeof p.inquiryEnabled === "boolean") {
    inquiryEnabled = p.inquiryEnabled;
  }

  return { galleryAvailable, inquiryEnabled, subscriptionTier };
}

function applySubscriptionMediaPolicy(data: PortfolioData): PortfolioData {
  if (data.galleryAvailable === false) {
    return { ...data, gallery: [], videos: [] };
  }
  return data;
}

function normalizePublicAliasData(data: PortfolioData): PortfolioData {
  return applySubscriptionMediaPolicy(data);
}

function mapProfileToPortfolio(p: ApiProfile, alias: string): PortfolioData {
  const addresses = Array.isArray(p.addresses)
    ? (p.addresses as Record<string, unknown>[])
    : [];
  const nestedAddress =
    p.address && typeof p.address === "object"
      ? (p.address as Record<string, unknown>)
      : {};
  const firstAddress = addresses[0] ?? {};
  const socialsRaw = p.socials ?? p.social_links;
  const socials = Array.isArray(socialsRaw)
    ? (socialsRaw as Record<string, unknown>[])
    : [];
  const services = Array.isArray(p.services)
    ? (p.services as Record<string, unknown>[])
    : [];
  const addressArea = toStr(
    firstAddress.area,
    nestedAddress.area,
    firstAddress.address,
    p.address,
    p.address_area,
    p.street,
  );
  const addressBrgy = toStr(
    firstAddress.brgy,
    nestedAddress.baranggay,
    nestedAddress.brgy,
    p.barangay,
    p.address_brgy,
  );
  const addressCity = toStr(
    firstAddress.city,
    nestedAddress.city,
    p.city,
    p.address_city,
  );
  const addressRegion = toStr(
    firstAddress.region,
    nestedAddress.region,
    p.region,
    p.address_region,
  );
  const addressZipcode = toStr(
    firstAddress.zipcode,
    nestedAddress.zip,
    nestedAddress.zipcode,
    p.zipcode,
    p.zip_code,
    p.address_zipcode,
  );
  const addressMapLink = toStr(
    firstAddress.map_link,
    nestedAddress.map_link,
    firstAddress.plus_code,
    nestedAddress.plus_code,
  );
  const addressLandmark = toStr(
    firstAddress.landmark,
    nestedAddress.landmark,
    p.landmark,
  );
  const addressLatitude = toCoordinate(
    firstAddress.latitude,
    nestedAddress.latitude,
  );
  const addressLongitude = toCoordinate(
    firstAddress.longitude,
    nestedAddress.longitude,
  );
  // Apply comprehensive contact field normalization
  const contactNormalized = normalizeContactFields(p);
  const profileImage =
    toStr(
      pickUrl(p.profile_url),
      pickUrl(p.profile_image),
      pickUrl(p.profile_photo),
      pickUrl(p.avatar),
      pickUrl(p.avatar_url),
      pickUrl(p.photo_url),
      pickUrl(p.image_url),
      pickUrl(p.design_profile_image),
    ) || null;

  const coverImage =
    toStr(
      pickUrl(p.cover_url),
      pickUrl(p.background_image),
      pickUrl(p.cover_image),
      pickUrl(p.background_url),
      pickUrl(p.banner_image),
      pickUrl(p.banner_url),
      pickUrl(p.design_cover_image),
    ) || null;

  const selectedTheme =
    normalizeThemeToken(p.theme_path) ||
    normalizeThemeToken(p.themePath) ||
    normalizeThemeToken(p.bizcard_theme) ||
    normalizeThemeToken(p.theme) ||
    toThemeSlug((p.theme_id as string | number | null | undefined) ?? "");

  // Defensive: public API may only expose composed `name` when first/last are absent.
  let firstName = toDisplayText(p.first_name);
  let lastName = toDisplayText(p.last_name);
  const middleName = toDisplayText(p.middle_name);
  if (!firstName && !lastName) {
    const composedName = toDisplayText(p.name);
    if (composedName) {
      const parts = composedName.split(/\s+/).filter(Boolean);
      if (parts.length === 1) {
        firstName = parts[0];
      } else if (parts.length > 1) {
        firstName = parts[0];
        lastName = parts.slice(1).join(" ");
      }
    }
  }

  return {
    bizCard: {
      urlAlias: String(p.custom_uri ?? alias),
      bizCardName: toDisplayText(
        p.vcard_name,
        p.bizcard_name,
        `${firstName} ${lastName}`.trim(),
        p.name,
      ),
      companyName: toDisplayText(p.company, p.company_name),
      description: toRichAbout(p.vcard_description, p.description),
      occupation: toDisplayText(p.job_position, p.prof_title, p.professional_title, p.occupation),
      profileImage,
      coverImage,
      coverType: inferCoverTypeFromUrl(coverImage),
      coverFileName: null,
      coverImagePosition:
        toStr(p.cover_img_position, "center center") || "center center",
    },
    vcard: {
      firstName,
      middleName,
      lastName,
      professionalTitle: toDisplayText(
        p.prof_title,
        p.professional_title,
        p.job_position,
        p.occupation,
      ),
      postNominalLetters: toDisplayText(p.post_nominal),
      suffix: String(p.suffix ?? "N/A"),
      about: toRichAbout(p.about, p.bio),
      contactNumber: contactNormalized.contactNumber,
      secondaryNumber: contactNormalized.secondaryNumber,
      telephoneNumber: contactNormalized.telephoneNumber,
      altTelephoneNumber: contactNormalized.altTelephoneNumber,
      email: contactNormalized.email,
      alternativeEmail: contactNormalized.alternativeEmail,
      languages: toDisplayText(p.languages, p.default_language),
      addressArea,
      addressHouseNo: "",
      addressBrgy,
      addressCity,
      addressRegion,
      addressZipcode,
      addressMapLink,
      addressLandmark,
      addressLatitude,
      addressLongitude,
      socialLinks: socials.map((s, i) => ({
        id: i + 1,
        platform: toStr(s.platform, s.platform_name, s.name),
        url: toStr(s.url, s.platform_url, s.link),
      })),
    },
    services: services.map((s, i) => {
      const mediaBuckets = [s.media, s.serviceMedia, s.service_media];
      let media: NonNullable<PortfolioData["services"][number]["media"]> = [];
      for (const bucket of mediaBuckets) {
        if (!Array.isArray(bucket) || bucket.length === 0) continue;
        media = bucket
          .map((item, index) => {
            const row =
              item && typeof item === "object"
                ? (item as Record<string, unknown>)
                : {};
            const url = toStr(
              pickUrl(row.url),
              pickUrl(row.file_url),
              pickUrl(row.secure_url),
              pickUrl(row.media_url),
            );
            if (!url) return null;
            return {
              id: String(row.id ?? row.media_id ?? `${i + 1}-${index + 1}`),
              url,
              mimeType: toStr(row.mimeType, row.mime_type) || null,
              fileName: toStr(row.fileName, row.file_name) || null,
            };
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item));
        if (media.length > 0) break;
      }

      let featuredImage = pickServiceImage({ ...s, media });
      if (!featuredImage && media.length > 0) {
        const firstImage = media.find(
          (m) => !String(m.mimeType ?? "").toLowerCase().startsWith("video/"),
        );
        featuredImage = firstImage?.url ?? media[0]?.url ?? null;
      }

      return {
        id: toServiceId(s.service_id ?? s.id, i + 1),
        title: toDisplayText(s.name, s.title),
        tagline: toDisplayText(s.tagline),
        description: toRichAbout(s.description),
        featured_image: featuredImage,
        videoUrl: String(s.service_url ?? s.serviceUrl ?? ""),
        videoFile: null,
        media,
      };
    }),
    /* Keep gallery strictly from explicit gallery fields to avoid service media bleed-through. */
    gallery: extractGalleryFromUnknown(
      p.gallery ?? p.galleryMedia ?? p.portfolio_media,
    ),
    videos: extractVideosFromUnknown(
      p.videos ?? p.gallery_videos ?? p.portfolio_videos,
    ),
    selectedTheme,
    ...(typeof (p.show_cover_photo ?? p.showCoverPhoto) === "boolean"
      ? { showCoverPhoto: (p.show_cover_photo ?? p.showCoverPhoto) !== false }
      : {}),
    ...(typeof (p.show_inquiry_card ?? p.showInquiryCard) === "boolean"
      ? { showInquiryCard: (p.show_inquiry_card ?? p.showInquiryCard) !== false }
      : {}),
    ...(typeof (p.show_associate_count ?? p.showAssociateCount) === "boolean"
      ? { showAssociateCount: (p.show_associate_count ?? p.showAssociateCount) === true }
      : {}),
    ...(typeof (p.show_mutual_associates ?? p.showMutualAssociates) === "boolean"
      ? { showMutualAssociates: (p.show_mutual_associates ?? p.showMutualAssociates) === true }
      : {}),
    ...(typeof (p.show_email ?? p.showEmail) === "boolean"
      ? { showEmail: (p.show_email ?? p.showEmail) !== false }
      : {}),
    ...(p.contact_link_label !== undefined || p.contactLinkLabel !== undefined
      ? {
          contactLinkLabel: toContactLinkLabelMode(
            p.contact_link_label ?? p.contactLinkLabel,
          ),
        }
      : {}),
    ...parseSubscriptionFlags(p),
  };
}

type EndpointProfileResult = {
  data: PortfolioData | null;
  /**
   * False for account-only portfolios (no set-up bizcard yet). Their bizcard-scoped
   * resources — canonical profile, gallery, theme stream — don't exist, so requesting
   * them only produces 404/403 noise on every poll.
   */
  hasBizcard: boolean;
};

function hasBizcardId(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

async function fetchByEndpoints(alias: string): Promise<EndpointProfileResult> {
  const safeAlias = encodeURIComponent(alias);
  const bust = Date.now();

  const tryGetJson = async (
    url: string,
  ): Promise<{
    ok: boolean;
    unauthorized: boolean;
    notFound: boolean;
    data: Record<string, unknown> | null;
  }> => {
    try {
      const r = await fetch(url, { method: "GET", cache: "no-store" });
      if (r.status === 401 || r.status === 403)
        return { ok: false, unauthorized: true, notFound: false, data: null };
      if (!r.ok)
        return { ok: false, unauthorized: false, notFound: r.status === 404, data: null };
      const d = (await r.json()) as Record<string, unknown>;
      return { ok: true, unauthorized: false, notFound: false, data: d };
    } catch {
      return { ok: false, unauthorized: false, notFound: false, data: null };
    }
  };

  // Prefer modular public details endpoint when available.
  const details = await tryGetJson(
    `${API}/api/vcard/details?username=${safeAlias}&_t=${bust}`,
  );
  if (details.ok && details.data) {
    const detailsData = (details.data.data ?? {}) as Record<string, unknown>;

    let socials: Record<string, unknown>[] = [];
    const socialRes = await tryGetJson(
      `${API}/api/vcard/social?username=${safeAlias}&_t=${bust}`,
    );
    if (socialRes.ok && socialRes.data) {
      const socialData = (socialRes.data.data ?? {}) as Record<string, unknown>;
      socials = Array.isArray(socialData.social_links)
        ? (socialData.social_links as Record<string, unknown>[])
        : Array.isArray(socialData.socials)
          ? (socialData.socials as Record<string, unknown>[])
          : [];
    }

    let themePath = "";
    let themeId: string | number | null = null;
    let designCoverImage = "";
    let designProfileImage = "";
    const designRes = await tryGetJson(
      `${API}/api/vcard/design?username=${safeAlias}&_t=${bust}`,
    );
    if (designRes.ok && designRes.data) {
      const designData = (designRes.data.data ?? {}) as Record<string, unknown>;
      const currentTheme = (designData.current_theme ?? {}) as Record<
        string,
        unknown
      >;
      const customizations = (designData.customizations ?? {}) as Record<
        string,
        unknown
      >;
      themePath = toStr(
        currentTheme.path,
        currentTheme.theme_path,
        currentTheme.themePath,
        designData.theme_path,
      );
      themeId = (currentTheme.id as string | number | null | undefined) ?? null;
      designCoverImage = toStr(
        pickUrl(customizations.background_image),
        pickUrl(customizations.cover_image),
        pickUrl(designData.background_image),
        pickUrl(designData.cover_image),
        pickUrl(designData.banner_image),
      );
      designProfileImage = toStr(
        pickUrl(customizations.profile_image),
        pickUrl(customizations.avatar),
        pickUrl(designData.profile_image),
        pickUrl(designData.profile_url),
      );
    }
    const normalizedProfile: ApiProfile = {
      ...detailsData,
      socials,
      theme_path: themePath,
      theme_id: themeId,
      design_cover_image: designCoverImage,
      design_profile_image: designProfileImage,
    };

    let mapped = mapProfileToPortfolio(normalizedProfile, alias);

    if (!hasBizcardId(detailsData.bizcard_id)) {
      return {
        data: normalizePublicAliasData({ ...mapped, galleryAvailable: false }),
        hasBizcard: false,
      };
    }

    // Merge public canonical endpoint to fill any fields hidden/missing in modular fragments.
    // Use guarded merge to preserve contact and gallery/video arrays.
    try {
      const canonicalRes = await fetch(
        `${API}/api/public/${safeAlias}?_t=${bust}`,
        { method: "GET", cache: "no-store" },
      );
      if (canonicalRes.ok) {
        const canonicalPayload = (await canonicalRes.json()) as Record<
          string,
          unknown
        >;
        const canonicalProfile = (canonicalPayload.profile ??
          canonicalPayload.data ??
          canonicalPayload.vcard ??
          canonicalPayload) as ApiProfile;
        const canonicalMapped = mapProfileToPortfolio(canonicalProfile, alias);
        // Guard merge to prevent sparse overwrites of contact/gallery/videos
        mapped = mergeCardImages(mapped, canonicalMapped);
        mapped = mergePortfolioFields(mapped, canonicalMapped, {
          preferFallbackTheme: true,
        });
      }
    } catch {
      // keep modular-only payload
    }

    return { data: normalizePublicAliasData(mapped), hasBizcard: true };
  }

  // For aliases the details endpoint accepts, its 404 is conclusive: the canonical endpoint
  // resolves the same records, so asking it again would only add another 404.
  if (details.notFound && DETAILS_USERNAME_PATTERN.test(alias.trim().toLowerCase())) {
    return { data: null, hasBizcard: false };
  }

  try {
    const r = await fetch(`${API}/api/public/${safeAlias}?_t=${bust}`, {
      method: "GET",
      cache: "no-store",
    });
    if (!r.ok) return { data: null, hasBizcard: false };
    const d = (await r.json()) as Record<string, unknown>;
    const p = (d.profile ?? d.data ?? d.vcard ?? d) as ApiProfile;
    /* Accept canonical custom_uri even when request used serial_id. */
    return {
      data: normalizePublicAliasData(mapProfileToPortfolio(p, alias)),
      hasBizcard: true,
    };
  } catch {
    return { data: null, hasBizcard: false };
  }
}

async function fetchServiceCollectionsInternal(
  alias: string,
  options: { skipPublic: boolean },
): Promise<{
  services: PortfolioData["services"];
  rateLimited: boolean;
  cooldownMs: number;
  skippedPublic: boolean;
}> {
  let publicServices: PortfolioData["services"] = [];
  let rateLimited = false;
  let cooldownMs = 0;
  const skippedPublic = options.skipPublic;

  if (!skippedPublic) {
    try {
      const r = await fetch(
        `${API}/api/public/${encodeURIComponent(alias)}/services?_t=${Date.now()}`,
        {
          cache: "no-store",
        },
      );
      if (r.status === 429) {
        rateLimited = true;
        cooldownMs = Math.max(cooldownMs, parseRetryAfterMs(r));
      }
      if (r.ok) {
        const payload = await r.json();
        const data = (payload?.data ?? {}) as Record<string, unknown>;
        const rawServices = Array.isArray(data.services) ? data.services : [];
        publicServices = rawServices.map(
          (s: Record<string, unknown>, i: number) => {
            const mediaRaw = Array.isArray(s.media) ? s.media : [];
            const media = (mediaRaw as Record<string, unknown>[])
              .map((m, mi) => {
                const url = toStr(pickUrl(m.url), pickUrl(m.file_url));
                if (!url.startsWith("http")) return null;
                return {
                  id: String(m.id ?? `${i + 1}-${mi + 1}`),
                  url,
                  mimeType: (toStr(m.mimeType, m.mime_type) || null) as string | null,
                  fileName: (toStr(m.fileName, m.file_name) || null) as string | null,
                };
              })
              .filter(Boolean) as Array<{
              id: string;
              url: string;
              mimeType: string | null;
              fileName: string | null;
            }>;
            return {
              id: toServiceId(s.id, i + 1),
              title: String(s.name ?? s.title ?? ""),
              tagline: String(s.tagline ?? ""),
              description: String(s.description ?? ""),
              featured_image: pickServiceImage({ ...s, media }),
              videoUrl: String(s.service_url ?? s.serviceUrl ?? ""),
              videoFile: null,
              media,
            };
          },
        );
      }
    } catch {
      // continue with modular fallback
    }
  }

  try {
    const r = await fetch(
      `${API}/api/vcard/services?username=${encodeURIComponent(alias)}&type=all&_t=${Date.now()}`,
      {
        cache: "no-store",
      },
    );
    if (r.status === 429) {
      rateLimited = true;
      cooldownMs = Math.max(cooldownMs, parseRetryAfterMs(r));
    }
    if (!r.ok)
      return {
        services: publicServices,
        rateLimited,
        cooldownMs,
        skippedPublic,
      };
    const payload = await r.json();
    const data = (payload?.data ?? {}) as Record<string, unknown>;
    const modular = mapServicesCollection(data);

    const mergedServices =
      modular.services.length > 0
        ? mergeServiceImages(modular.services, publicServices)
        : publicServices;

    return {
      services: mergedServices,
      rateLimited,
      cooldownMs,
      skippedPublic,
    };
  } catch {
    return { services: publicServices, rateLimited, cooldownMs, skippedPublic };
  }
}

async function fetchPublicGalleryCollections(alias: string): Promise<{
  gallery: GalleryItem[];
  videos: NonNullable<PortfolioData["videos"]>;
}> {
  try {
    const r = await fetch(
      `${API}/api/public/${encodeURIComponent(alias)}/gallery?_t=${Date.now()}`,
      {
        method: "GET",
        cache: "no-store",
      },
    );
    if (!r.ok) return { gallery: [], videos: [] };

    const payload = (await r.json()) as Record<string, unknown>;
    const data = (payload.data ?? payload) as Record<string, unknown>;
    const galleryRaw = Array.isArray(data.gallery) ? data.gallery : [];
    const videosRaw = Array.isArray(data.videos) ? data.videos : [];
    // Some API responses return all media under a single `media` key.
    // Split mixed media into gallery (images) and videos by MIME type.
    const mediaRaw = Array.isArray(data.media) ? data.media : [];
    const mediaGallery: Record<string, unknown>[] = [];
    const mediaVideos: Record<string, unknown>[] = [];
    for (const m of mediaRaw) {
      const rec = m as Record<string, unknown>;
      const mime = String(rec.mime_type ?? rec.file_type ?? "").toLowerCase();
      const url = String(
        rec.url ?? rec.file_url ?? rec.secure_url ?? "",
      ).toLowerCase();
      const isVideo =
        mime.startsWith("video/") ||
        url.endsWith(".mp4") ||
        url.endsWith(".mov") ||
        url.endsWith(".webm") ||
        url.includes(".mp4?") ||
        url.includes(".mov?") ||
        url.includes(".webm?");
      if (isVideo) mediaVideos.push(rec);
      else mediaGallery.push(rec);
    }

    const combinedGalleryRaw =
      galleryRaw.length > 0 ? galleryRaw : mediaGallery;
    const combinedVideosRaw = videosRaw.length > 0 ? videosRaw : mediaVideos;

    const gallery = (combinedGalleryRaw as Record<string, unknown>[])
      .map((g, index) => mapGalleryRecord(g, index))
      .filter((item): item is GalleryItem => Boolean(item));

    const videos = (combinedVideosRaw as Record<string, unknown>[])
      .map((v, i) => ({
        id: Number(v.id ?? i + 1),
        title: String(v.title ?? ""),
        description: String(v.description ?? v.caption ?? ""),
        fileName: extractVideoUrlFromUnknown(v),
        fileSize: 0,
        mimeType:
          String(v.mime_type ?? v.mimeType ?? "").trim() ||
          (String(v.media_type ?? "").toLowerCase() === "video"
            ? "video/mp4"
            : null),
        videoDataUrl: null,
      }))
      .filter((v) => {
        const src = String(v.fileName ?? "").trim();
        return src.startsWith("http") || src.startsWith("/");
      });

    // Sparse results fall back to the canonical payload's gallery, which fetchByEndpoints
    // already merged into the profile — no need to request it a second time.
    return { gallery, videos };
  } catch {
    return { gallery: [], videos: [] };
  }
}

// sadasd sad  sadas sad asd asd as dasd asd sad as
export default function AliasPageClient({
  params,
  serialInPlace = false,
  canonicalAlias,
}: PortfolioPageProps) {
  const { alias } = use(params);
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [serialLookupDone, setSerialLookupDone] = useState(serialInPlace);
  const [serialRouteMissing, setSerialRouteMissing] = useState(false);
  const [scanRouting, setScanRouting] = useState(false);
  const [resolvedAlias, setResolvedAlias] = useState<string>(
    canonicalAlias?.trim() || "",
  );
  const effectiveAlias = resolvedAlias || alias;

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Server already resolved this serial for in-place render — skip scan/localStorage.
    if (serialInPlace) {
      setResolvedAlias(canonicalAlias?.trim() || "");
      setSerialRouteMissing(false);
      setScanRouting(false);
      setSerialLookupDone(true);
      return;
    }

    // Claimed serials must hard-redirect to the portfolio URL so the address bar
    // shows /{alias}, not /{SERIAL}. Soft-resolving alias in-place left the serial
    // visible in the URL after a successful claim.
    const redirectTarget = resolveSerialRedirectFromStorage(alias);
    if (redirectTarget) {
      window.location.replace(redirectTarget);
      return;
    }

    if (!isSerialLikeAlias(alias)) {
      setResolvedAlias("");
      setSerialRouteMissing(false);
      setSerialLookupDone(true);
      return;
    }

    let cancelled = false;
    setScanRouting(true);

    async function resolveSerialScan() {
      try {
        const result = await fetchPhysicalCardScan(alias.trim().toUpperCase());
        if (cancelled) return;

        if (!result.ok) {
          // Not a physical serial — fall through to URL alias portfolio load.
          setResolvedAlias("");
          setSerialRouteMissing(false);
          setLoading(true);
          setSerialLookupDone(true);
          return;
        }

        const data = result.data;

        if (data.status === "not_found") {
          setResolvedAlias("");
          setSerialRouteMissing(false);
          setLoading(true);
          setSerialLookupDone(true);
          return;
        }

        if (data.nextAction === "show_portfolio") {
          const serial = alias.trim().toUpperCase();
          const rawTarget =
            data.redirectUrl || (data.customUri ? `/${data.customUri}` : "");
          // Guard against self-redirect loops when url_alias equals the serial.
          const safeTarget = resolveCandidateRedirect(serial, rawTarget);
          if (safeTarget) {
            window.location.replace(safeTarget);
            return;
          }
          // No distinct alias — render portfolio in place at /{SERIAL}.
          setSerialRouteMissing(false);
          setResolvedAlias("");
          setLoading(true);
          return;
        }

        if (data.status === "blank") {
          const scanTutorialUrl = `/?scan=${encodeURIComponent(alias.trim().toUpperCase())}`;
          window.location.replace(scanTutorialUrl);
          return;
        }

        if (data.redirectUrl) {
          window.location.replace(toPortfolioRedirectUrl(data.redirectUrl));
          return;
        }

        setSerialRouteMissing(false);
        setResolvedAlias("");
        setLoading(true);
      } catch {
        if (!cancelled) {
          setResolvedAlias("");
          setSerialRouteMissing(false);
          setLoading(true);
        }
      } finally {
        if (!cancelled) {
          setScanRouting(false);
          setSerialLookupDone(true);
        }
      }
    }

    void resolveSerialScan();
    return () => {
      cancelled = true;
    };
  }, [alias, serialInPlace, canonicalAlias]);

  const handleManualRefresh = React.useCallback(() => {
    if (typeof window === "undefined") return;
    setRefreshing(true);
    window.dispatchEvent(new CustomEvent(USER_SYNC_EVENT));
    window.setTimeout(() => setRefreshing(false), 1500);
  }, []);

  useEffect(() => {
    if (!serialLookupDone || serialRouteMissing) return;
    if (typeof window === "undefined") return;
    trackPortfolioView(effectiveAlias);
  }, [effectiveAlias, serialLookupDone, serialRouteMissing]);

  useEffect(() => {
    if (!serialLookupDone || serialRouteMissing) return;

    if (typeof window === "undefined") return;
    if (!effectiveAlias.trim()) return;
    if (hasActiveAuthSession()) return;

    const visitorId = getOrCreateVisitorId();
    if (!visitorId) return;

    const trackKey = `${VISITOR_TRACK_PREFIX}:${effectiveAlias.trim().toLowerCase()}`;
    const lastTracked = Number(sessionStorage.getItem(trackKey) ?? "0");
    if (
      Number.isFinite(lastTracked) &&
      Date.now() - lastTracked < VISITOR_TRACK_COOLDOWN_MS
    ) {
      return;
    }

    sessionStorage.setItem(trackKey, String(Date.now()));

    void fetch("/api/track/visitor-location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visitorId,
        alias: effectiveAlias,
        pagePath: window.location.pathname,
      }),
    }).catch(() => {
      // Non-blocking analytics — never interrupt the visitor experience.
    });
  }, [effectiveAlias, serialLookupDone, serialRouteMissing]);

  useEffect(() => {
    if (!serialLookupDone || serialRouteMissing) return;

    let alive = true;
    let interval: number | null = null;
    let inFlight = false;
    let servicesCooldownUntil = 0;
    let lastEventRefreshAt = 0;
    let profileHasBizcard = false;

    /** Resolves to whether the alias resolved to a portfolio. */
    const load = async (silent = false): Promise<boolean> => {
      if (inFlight) return true;
      inFlight = true;
      if (!silent) setLoading(true);
      try {
        const profile = await fetchByEndpoints(effectiveAlias);
        let next: PortfolioData | null = profile.data;
        profileHasBizcard = profile.hasBizcard;
        if (!next) {
          if (alive) setData(null);
          return false;
        }
        const now = Date.now();
        const skipPublic = now < servicesCooldownUntil;
        const collections = await fetchServiceCollectionsInternal(
          effectiveAlias,
          { skipPublic },
        );
        // Only tiers with a gallery expose the endpoint; anything else answers 403.
        const publicGallery =
          next.galleryAvailable === true
            ? await fetchPublicGalleryCollections(effectiveAlias)
            : { gallery: [], videos: [] };
        if (collections.rateLimited) {
          servicesCooldownUntil =
            now +
            Math.max(collections.cooldownMs, SERVICE_COOLDOWN_FALLBACK_MS);
        }

        if (next && collections) {
          const mergedServices =
            collections.services.length > 0
              ? mergeServiceImages(collections.services, next.services)
              : next.services;
          // Protect gallery/videos: prefer what we already have over sparse updates
          const nextGallery =
            Array.isArray(publicGallery.gallery) &&
            publicGallery.gallery.length > 0
              ? publicGallery.gallery
              : Array.isArray(next.gallery)
                ? next.gallery
                : [];
          const nextVideos =
            Array.isArray(publicGallery.videos) &&
            publicGallery.videos.length > 0
              ? publicGallery.videos
              : Array.isArray(next.videos)
                ? next.videos
                : [];

          next = {
            ...next,
            services: mergedServices,
            gallery: next.galleryAvailable === false ? [] : nextGallery,
            videos: next.galleryAvailable === false ? [] : nextVideos,
          };
        }

        if (next) {
          next = applySubscriptionMediaPolicy(next);
        }
        if (!alive) return true;
        // Server/API payload only — never paint from device localStorage.
        setData(next ? withServablePortfolioMedia(next) : next);
        connectThemeStream();
        return true;
      } finally {
        if (alive) setLoading(false);
        inFlight = false;
      }
    };
    let themeSource: EventSource | null = null;
    const handleThemeEvent = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as Record<string, unknown>;
        const payloadData = (payload.data ??
          payload.theme ??
          payload) as Record<string, unknown>;
        if (!payloadData || typeof payloadData !== "object") return;
        localStorage.setItem("portfolio_refresh_ts", String(Date.now()));
        window.dispatchEvent(new Event(USER_SYNC_EVENT));
      } catch {
        // ignore malformed stream payloads
      }
    };
    let themeStreamFailed = false;
    function connectThemeStream() {
      // The stream only serves published bizcard themes; account-only portfolios get a 404.
      if (
        !ENABLE_THEME_STREAM ||
        typeof window === "undefined" ||
        !alive ||
        !profileHasBizcard ||
        themeStreamFailed ||
        themeSource
      )
        return;
      const streamUrl = `${API}/api/vcard/design/stream?username=${encodeURIComponent(effectiveAlias)}`;
      themeSource = new EventSource(streamUrl);
      themeSource.addEventListener("theme", handleThemeEvent);
      themeSource.onerror = () => {
        themeStreamFailed = true;
        themeSource?.close();
        themeSource = null;
      };
    }

    // Purge stale device snapshot for this portfolio so display cannot fall back to it.
    hardResetPortfolioAliasCache(effectiveAlias);

    void load(false).then((found) => {
      if (!alive || !found) return;
      interval = window.setInterval(() => {
        void load(true);
      }, POLL_INTERVAL_MS);
    });
    const refreshFromEvent = () => {
      const now = Date.now();
      if (now - lastEventRefreshAt < EVENT_REFRESH_DEBOUNCE_MS) return;
      lastEventRefreshAt = now;
      // Always refetch from the API — never apply localStorage theme/content overlays.
      hardResetPortfolioAliasCache(effectiveAlias);
      void load(true);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        const recent = localStorage.getItem("portfolio_refresh_ts");
        if (recent) {
          const last = Number(recent);
          if (Number.isFinite(last) && last > lastEventRefreshAt) {
            refreshFromEvent();
          }
        }
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === "portfolio_refresh_ts" ||
        (typeof e.key === "string" && e.key.startsWith("portfolio_"))
      ) {
        void refreshFromEvent();
      }
    };
    window.addEventListener("focus", refreshFromEvent);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener(USER_SYNC_EVENT, refreshFromEvent);
    window.addEventListener("storage", onStorage);

    // BroadcastChannel: instant cross-tab/window updates from the dashboard.
    let broadcast: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== "undefined") {
        broadcast = new BroadcastChannel(PORTFOLIO_BROADCAST_CHANNEL);
        broadcast.onmessage = (event: MessageEvent) => {
          const payload = event.data as { alias?: string } | null;
          if (!payload || typeof payload !== "object") return;
          // If a payload alias is provided, ignore unrelated portfolios; otherwise refresh.
          if (
            payload.alias &&
            String(payload.alias).trim().toLowerCase() !==
              effectiveAlias.trim().toLowerCase()
          )
            return;
          refreshFromEvent();
        };
      }
    } catch {
      // BroadcastChannel unsupported; storage event remains as the fallback.
    }

    return () => {
      alive = false;
      if (interval) window.clearInterval(interval);
      if (themeSource) {
        themeSource.removeEventListener("theme", handleThemeEvent);
        themeSource.close();
      }
      window.removeEventListener("focus", refreshFromEvent);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener(USER_SYNC_EVENT, refreshFromEvent);
      window.removeEventListener("storage", onStorage);
      if (broadcast) {
        try {
          broadcast.close();
        } catch {
          /* ignore */
        }
      }
    };
  }, [effectiveAlias, serialLookupDone, serialRouteMissing]);

  if (!serialLookupDone || scanRouting) {
    return <FullPageLoader size="xl" text="Loading portfolio..." />;
  }

  if (serialRouteMissing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#141832]">
        <div className="text-center px-6">
          <div className="text-6xl font-black text-white/10 mb-4">404</div>
          <h1 className="text-2xl font-bold text-white mb-2">
            Portfolio Not Found
          </h1>
          <p className="text-white/50 text-sm mb-6">
            No portfolio exists for{" "}
            <span className="font-mono text-primary-light">/{alias}</span>
          </p>
          <Link
            href="/"
            className="inline-block px-6 py-3 rounded-xl text-white text-sm font-semibold"
            style={{ backgroundColor: "#2A4792" }}
          >
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return <FullPageLoader size="xl" text="Loading portfolio..." />;
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#141832]">
        <div className="text-center px-6">
          <div className="text-6xl font-black text-white/10 mb-4">404</div>
          <h1 className="text-2xl font-bold text-white mb-2">
            Portfolio Not Found
          </h1>
          <p className="text-white/50 text-sm mb-6">
            No portfolio exists for{" "}
            <span className="font-mono text-primary-light">/{alias}</span>
          </p>
          <Link
            href="/"
            className="inline-block px-6 py-3 rounded-xl text-white text-sm font-semibold"
            style={{ backgroundColor: "#2A4792" }}
          >
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <BizCardPreview
      themeId={data.selectedTheme}
      data={data}
      mini={false}
      showFAB={true}
    />
  );
}
