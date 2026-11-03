// components/DashboardContent.tsx

"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import QRCode from "qrcode";
import { ModalPortal } from "./ModalPortal";
import { SectionLoader } from "./Loader";
import { getTheme } from "./BizCardPreview";
import { showToast } from "./Toast";
import { toServableMediaSrc } from "../lib/portfolioDisplay";
import { normalizePortfolioThemeId } from "../themes/ThemeLoader";
import {
  Eye,
  Users,
  Mail,
  BookmarkCheck,
  ExternalLink,
  Scan,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Sparkles,
} from "lucide-react";
import { InlineLoader } from "./Loader";
import { getFrontendApiBaseUrl } from "./apiBase";
import { PortalNoticeSurface } from "./PortalNoticeSurface";
import OntapProgressCard from "./OntapProgressCard";
import { detectPortalFromPath } from "../config/portalNavigation";
import JoinCompanyModal from "./JoinCompanyModal";
import ProfileViewsModal from "./ProfileViewsModal";
import { buildImpersonationHeaders } from "@/app/lib/superadminImpersonationHandoff";
import { format } from "date-fns";
import { BizCardInfoActions } from "./digital-card/BizCardInfoActions";
import {
  DigitalBizCardModal,
  sharePortfolioUrl,
} from "./digital-card/DigitalBizCardModal";
import { buildDigitalBizCardData } from "./digital-card/digitalBizCard.utils";
import { toDigitalBizCardTheme } from "./digital-card/digitalBizCard.theme";

const USER_SYNC_EVENT = "ontap:user-sync";
const PORTFOLIO_BROADCAST_CHANNEL = "ontap-portfolio-sync";
const API_BASE_URL = getFrontendApiBaseUrl();

function getPortfolioHref(
  raw: string | null | undefined,
  alias: string,
): string {
  const safeAlias = alias.trim().replace(/^\/+/, "");
  if (raw && /^https?:\/\//i.test(raw)) return raw;
  if (raw && raw.startsWith("/")) return raw;
  if (raw) return `/${raw.replace(/^\/+/, "")}`;
  if (safeAlias) return `/${safeAlias}`;
  return "#";
}

function readAuthUserName(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem("authUser");
    if (!raw) return "";
    const u = JSON.parse(raw) as Record<string, unknown>;
    const first = String(u.firstName ?? u.first_name ?? "").trim();
    const last = String(u.lastName ?? u.last_name ?? "").trim();
    const fullFallback = String(
      u.fullName ?? u.full_name ?? u.name ?? "",
    ).trim();
    return [first, last].filter(Boolean).join(" ").trim() || fullFallback;
  } catch {
    return "";
  }
}

interface DashboardService {
  title: string;
  tagline: string;
  description: string;
  imageUrl: string;
}

function pickServiceImageUrl(raw: Record<string, unknown>): string {
  const direct = String(
    raw.featured_image ??
    raw.featuredImage ??
    raw.featured_image_url ??
    raw.featuredImageUrl ??
    raw.icon ??
    "",
  ).trim();
  if (direct.startsWith("http") || direct.startsWith("data:")) return direct;

  const mediaBuckets = [
    raw.serviceMedia,
    raw.service_media,
    raw.gallery,
    raw.media,
  ];
  for (const bucket of mediaBuckets) {
    if (!Array.isArray(bucket)) continue;
    for (const item of bucket) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const url = String(
        record.file_url ?? record.url ?? record.thumbnail ?? "",
      ).trim();
      if (url.startsWith("http") || url.startsWith("data:")) return url;
    }
  }
  return "";
}

function mapRawToDashboardService(
  raw: unknown,
  index: number,
): DashboardService | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const title = String(record.name ?? record.title ?? "").trim();
  const tagline = String(record.tagline ?? "").trim();
  const description = String(record.description ?? "").trim();
  const imageUrl = pickServiceImageUrl(record);
  if (!title && !description && !imageUrl) return null;
  return {
    title: title || `Service ${index + 1}`,
    tagline,
    description,
    imageUrl,
  };
}

function readCachedServices(alias: string): DashboardService[] {
  if (typeof window === "undefined") return [];
  const safeAlias = alias.trim();
  if (!safeAlias) return [];

  try {
    const snapshotRaw = localStorage.getItem(`portfolio_${safeAlias}`);
    if (!snapshotRaw) return [];
    const snapshot = JSON.parse(snapshotRaw) as { services?: unknown[] };
    if (!Array.isArray(snapshot.services)) return [];
    return snapshot.services
      .map((service, index) => mapRawToDashboardService(service, index))
      .filter((service): service is DashboardService => Boolean(service));
  } catch {
    return [];
  }
}

function mergeDashboardService(
  existing: DashboardService,
  incoming: DashboardService,
): DashboardService {
  const imageUrl =
    existing.imageUrl.startsWith("http") ||
      existing.imageUrl.startsWith("data:")
      ? existing.imageUrl
      : incoming.imageUrl || existing.imageUrl;
  return {
    title: existing.title || incoming.title,
    tagline: existing.tagline || incoming.tagline,
    description: existing.description || incoming.description,
    imageUrl,
  };
}

function resolveBizCardServices(
  profile: VCardProfile | null,
  alias: string,
): DashboardService[] {
  const byKey = new Map<string, DashboardService>();
  const addService = (service: DashboardService) => {
    const key = service.title.trim().toLowerCase();
    if (!key) return;
    const existing = byKey.get(key);
    byKey.set(
      key,
      existing ? mergeDashboardService(existing, service) : service,
    );
  };

  for (const raw of profile?.services ?? []) {
    const mapped = mapRawToDashboardService(raw, byKey.size);
    if (mapped) addService(mapped);
  }

  for (const cached of readCachedServices(alias)) {
    addService(cached);
  }

  return Array.from(byKey.values());
}
async function downloadImage(
  sourceUrl: string,
  fileName: string,
): Promise<boolean> {
  try {
    const response = await fetch(sourceUrl);
    if (!response.ok) return false;
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
    return true;
  } catch {
    return false;
  }
}

const CSRF_COOKIE_NAME = "csrf-token";

function readStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return (
    window.localStorage.getItem("auth_token") ||
    window.sessionStorage.getItem("auth_token") ||
    window.localStorage.getItem("superadmin_token") ||
    window.sessionStorage.getItem("superadmin_token") ||
    null
  );
}

function buildAuthHeaders(): HeadersInit {
  const token = readStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function readCsrfCookie(): string {
  if (typeof document === "undefined") return "";
  const target = `${CSRF_COOKIE_NAME}=`;
  const match = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(target));
  return match ? decodeURIComponent(match.slice(target.length)) : "";
}

async function ensureCsrfToken(): Promise<string> {
  const fromCookie = readCsrfCookie();
  if (fromCookie) return fromCookie;
  try {
    const response = await fetch(`${API_BASE_URL}/api/csrf-token`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return readCsrfCookie();
    const payload = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const fromBody =
      (typeof payload?.csrfToken === "string" && payload.csrfToken) ||
      (typeof payload?.csrf_token === "string" && payload.csrf_token) ||
      (typeof payload?.token === "string" && payload.token) ||
      "";
    return (
      (typeof fromBody === "string" ? fromBody.trim() : "") || readCsrfCookie()
    );
  } catch {
    return readCsrfCookie();
  }
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const obj = payload as {
    error?: { message?: string } | string;
    message?: string;
  };
  if (typeof obj.error === "string") return obj.error;
  if (obj.error?.message) return obj.error.message;
  return obj.message ?? fallback;
}

const COMPANY_LOGO_ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg"]);

function isAllowedCompanyLogoFile(file: File): boolean {
  const mimeType = file.type.toLowerCase();
  if (COMPANY_LOGO_ALLOWED_MIME_TYPES.has(mimeType)) return true;
  const fileName = file.name.toLowerCase();
  return (
    fileName.endsWith(".png") ||
    fileName.endsWith(".jpg") ||
    fileName.endsWith(".jpeg")
  );
}

async function uploadCompanyLogoFile(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("context", "portfolio");

  const csrfToken = await ensureCsrfToken();
  const headers = new Headers(buildAuthHeaders());
  if (csrfToken) headers.set("X-CSRF-Token", csrfToken);

  const response = await fetch(`${API_BASE_URL}/api/media/upload`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers,
    body: formData,
  });

  const payload = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!response.ok) {
    throw new Error(
      extractErrorMessage(payload, "Failed to upload company logo."),
    );
  }

  const uploadedUrl =
    typeof payload?.url === "string" ? payload.url.trim() : "";
  if (!uploadedUrl) {
    throw new Error("Upload completed but no logo URL was returned.");
  }

  return uploadedUrl;
}

function readPortfolioTheme(urlAlias: string): string | null {
  if (!urlAlias || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`portfolio_${urlAlias.trim()}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { selectedTheme?: unknown };
    const theme =
      typeof parsed.selectedTheme === "string"
        ? parsed.selectedTheme.trim()
        : "";
    return theme || null;
  } catch {
    return null;
  }
}

function resolveDashboardThemeId(
  urlAlias: string,
  profile: Pick<VCardProfile, "theme_id" | "theme_path"> | null,
): string {
  const fromCache = urlAlias ? readPortfolioTheme(urlAlias) : null;
  if (fromCache) {
    const normalized = normalizePortfolioThemeId(fromCache);
    if (normalized) return normalized;
  }
  const fromPath = normalizePortfolioThemeId(profile?.theme_path);
  if (fromPath) return fromPath;
  const fromLegacyId = normalizePortfolioThemeId(profile?.theme_id);
  if (fromLegacyId) return fromLegacyId;
  return "elegant-dark";
}

function buildScannablePortfolioUrl(
  alias: string,
  portfolioUrl?: string | null,
): string | null {
  const cleanAlias = alias.trim().replace(/^\/+/, "");
  const trimmedPortfolio = portfolioUrl?.trim();
  if (trimmedPortfolio && /^https?:\/\//i.test(trimmedPortfolio)) {
    return trimmedPortfolio;
  }
  if (typeof window !== "undefined" && window.location?.origin && cleanAlias) {
    return `${window.location.origin}/${cleanAlias}`;
  }
  if (cleanAlias) return `https://ontap.ph/${cleanAlias}`;
  return null;
}

/* ── API response types ── */
interface VCardProfile {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  custom_uri: string | null;
  vcard_name: string | null;
  vcard_description: string | null;
  vcard_published: boolean;
  prof_title: string | null;
  post_nominal: string | null;
  suffix: string | null;
  job_position: string | null;
  about: string | null;
  contact: string | null;
  alt_contact: string | null;
  alt_email: string | null;
  profile_url: string | null;
  cover_url: string | null;
  theme_id: string | null;
  theme_path?: string | null;
  registration_type: string | null;
  socials: { platform: string; url: string; is_visible: boolean }[];
  services: Record<string, unknown>[];
  addresses: {
    area?: string | null;
    brgy?: string | null;
    city?: string | null;
    region?: string | null;
    zipcode?: string | null;
  }[];
  vcardSetup: { is_published: boolean; setup_completed: boolean } | null;
}

interface DashboardOwnedBizcard {
  bizcard_id: string;
  serial_id: string | null;
  bizcard_name: string | null;
  url_alias: string | null;
  first_name: string | null;
  last_name: string | null;
  professional_title: string | null;
  profile_img: string | null;
  cover_img: string | null;
  bizcard_theme: string | null;
  qr_code_url: string | null;
}

interface DashboardMetrics {
  metrics: {
    totalViews: number;
    totalConnections: number;
    totalInquiries: number;
    unreadInquiries: number;
    totalContactSaves: number;
    metricsPeriod?: string;
  };
  recentInquiries: {
    inquiryId: string;
    visitorName: string;
    subject: string;
    createdAt: string;
  }[];
  qrCode: string | null;
  portfolioUrl: string | null;
  hasCompany: boolean;
}

interface CompanyProfile {
  company_id: string;
  company_name: string;
  status: string;
  subscription_tier?: string | null;
  my_role?: string | null;
  my_permissions?: string[];
  joined_at?: string | null;
}

interface CompanyRequestResponse {
  success?: boolean;
  data?: {
    company_id?: string;
    company_name?: string;
    status?: string;
    message?: string;
  };
  error?: { message?: string } | string;
  message?: string;
}

type CompanyFormErrors = Partial<{
  companyName: string;
  companyEmail: string;
  companyPhone: string;
  companyAddress: string;
  companyIndustry: string;
  companyDescription: string;
  companyLogoUrl: string;
}>;

const COMPANY_CREATION_TIERS = new Set(["standard", "premium", "enterprise"]);

interface CompletionData {
  percentage: number;
  completed: number;
  total: number;
  fields: {
    profilePhoto: boolean;
    coverPhoto: boolean;
    profTitle: boolean;
    about: boolean;
    jobPosition: boolean;
    email: boolean;
    phone: boolean;
    address: boolean;
    firstName: boolean;
    lastName: boolean;
    socials: boolean;
    services: boolean;
    products: boolean;
  };
}

function ProgressRing({ pct, accent }: { pct: number; accent: string }) {
  const sz = 88,
    sw = 8,
    r = (sz - sw * 2) / 2,
    c = r * 2 * Math.PI;
  return (
    <svg width={sz} height={sz} style={{ transform: "rotate(-90deg)" }}>
      <circle
        cx={sz / 2}
        cy={sz / 2}
        r={r}
        fill="none"
        stroke="#e5e7eb"
        strokeWidth={sw}
      />
      <circle
        cx={sz / 2}
        cy={sz / 2}
        r={r}
        fill="none"
        stroke={accent}
        strokeWidth={sw}
        strokeDasharray={c}
        strokeDashoffset={c - (pct / 100) * c}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.7s ease" }}
      />
    </svg>
  );
}

/* Map the API completion fields to human-readable labels (profTitle excluded — field retired from UI) */
const FIELD_LABELS: { key: keyof CompletionData["fields"]; label: string }[] = [
  { key: "firstName", label: "First Name" },
  { key: "lastName", label: "Last Name" },
  { key: "profilePhoto", label: "Profile Photo" },
  { key: "coverPhoto", label: "Cover Photo" },
  { key: "jobPosition", label: "Job Position" },
  { key: "about", label: "About / Bio" },
  { key: "email", label: "Email Address" },
  { key: "phone", label: "Phone Number" },
  { key: "address", label: "Address" },
  { key: "socials", label: "Social Links" },
  { key: "services", label: "Services" },
];

const FIELD_EDITOR_TABS: Record<keyof CompletionData["fields"], string> = {
  firstName: "vcard",
  lastName: "vcard",
  profilePhoto: "vcard",
  coverPhoto: "vcard",
  profTitle: "vcard",
  jobPosition: "vcard",
  about: "vcard",
  email: "vcard",
  phone: "vcard",
  address: "vcard",
  socials: "social",
  services: "services",
  products: "services",
};

function hasFilledText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** Build completion from a single BizCard's real-time fields (not user-level profile). */
function buildCompletionFromBizcard(
  card: Record<string, unknown> | null | undefined,
): CompletionData | null {
  if (!card || typeof card !== "object") return null;

  const socialList = Array.isArray(card.social_links)
    ? card.social_links
    : Array.isArray(card.socials)
      ? card.socials
      : [];
  const serviceList = Array.isArray(card.services) ? card.services : [];
  const productList = Array.isArray(card.products) ? card.products : [];

  const hasSocials = socialList.some((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    if (row.is_visible === false || row.isVisible === false) return false;
    return hasFilledText(row.url) || hasFilledText(row.platform);
  });

  const hasServices = serviceList.some((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    if (row.is_visible === false || row.isVisible === false) {
      return hasFilledText(row.name);
    }
    return hasFilledText(row.name) || hasFilledText(row.title);
  });

  const hasAddress =
    hasFilledText(card.address_link) ||
    hasFilledText(card.area) ||
    hasFilledText(card.baranggay) ||
    hasFilledText(card.brgy) ||
    hasFilledText(card.city) ||
    hasFilledText(card.region) ||
    hasFilledText(card.zip_code) ||
    hasFilledText(card.zipcode) ||
    (Array.isArray(card.addresses) && card.addresses.length > 0);

  const jobOrTitle =
    hasFilledText(card.professional_title) ||
    hasFilledText(card.occupation) ||
    hasFilledText(card.job_position);

  const fields: CompletionData["fields"] = {
    firstName: hasFilledText(card.first_name),
    lastName: hasFilledText(card.last_name),
    profilePhoto:
      hasFilledText(card.profile_img) || hasFilledText(card.profile_url),
    coverPhoto: hasFilledText(card.cover_img) || hasFilledText(card.cover_url),
    profTitle: jobOrTitle,
    about:
      hasFilledText(card.bio) ||
      hasFilledText(card.about) ||
      hasFilledText(card.description),
    jobPosition: jobOrTitle,
    email: hasFilledText(card.email),
    phone: hasFilledText(card.contact_number) || hasFilledText(card.contact),
    address: hasAddress,
    socials: hasSocials,
    services: hasServices,
    products: productList.length > 0,
  };

  const completed = FIELD_LABELS.filter((f) => fields[f.key]).length;
  const total = FIELD_LABELS.length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return { percentage, completed, total, fields };
}

type DashboardActivityItem = {
  id: string;
  activityType: string;
  referenceId: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
};

function formatActivityMessage(item: DashboardActivityItem): string {
  const meta = item.meta ?? {};
  const target = String(
    meta.targetName ?? meta.fromName ?? meta.senderName ?? "",
  ).trim();
  const field = String(meta.field ?? "").trim();
  const location = String(meta.location ?? "").trim();
  const isVisitorLead = String(meta.source ?? "").trim() === "visitor_lead";
  switch (item.activityType) {
    case "PROFILE_EDIT":
      return field ? `Edited ${field}` : "Edited BizCard info";
    case "VIEWED_PORTFOLIO":
      return target ? `Viewed ${target} portfolio` : "Viewed a portfolio";
    case "CONNECTION_SENT":
      return target ? `Sent associate connect to ${target}` : "Sent an associate request";
    case "CONNECTION_ACCEPTED":
      return target ? `Connected with ${target}` : "Accepted an associate request";
    case "NEW_CONNECTION":
      return target ? `Received associate request from ${target}` : "New associate request";
    case "NEW_INQUIRY":
      if (isVisitorLead) {
        return target ? `New lead from ${target}` : "New portfolio lead received";
      }
      return target ? `New inquiry from ${target}` : "New inquiry received";
    case "INQUIRY_SENT":
      return target ? `Sent an inquiry to ${target}` : "Sent an inquiry";
    case "CONTACT_SAVED":
      return "Someone saved your contact";
    case "PROFILE_VIEW":
      return location ? `Portfolio viewed from ${location}` : "Someone viewed your portfolio";
    case "NEW_SCAN":
      return location ? `Card scanned in ${location}` : "BizCard was scanned";
    default:
      return item.activityType.replaceAll("_", " ").toLowerCase();
  }
}

function formatActivityTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function computeAdjustedCompletion(
  completion: CompletionData | null,
  services: DashboardService[] = [],
): {
  pct: number;
  pending: typeof FIELD_LABELS;
  mergedFields: CompletionData["fields"] | null;
} {
  const hasServices = services.length > 0;
  const mergedFields = completion?.fields
    ? {
      ...completion.fields,
      services: completion.fields.services || hasServices,
    }
    : null;

  if (!mergedFields) {
    return { pct: 0, pending: FIELD_LABELS, mergedFields: null };
  }

  const completed = FIELD_LABELS.filter((f) => mergedFields[f.key]).length;
  const total = FIELD_LABELS.length;
  const pct = Math.round((completed / total) * 100);
  const pending = FIELD_LABELS.filter((f) => !mergedFields[f.key]);
  return { pct, pending, mergedFields };
}

const formatJoinDate = (isoDate: string | null | undefined): string | null => {
  if (!isoDate) return null;
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

interface CompanyInviteUser {
  id: string;
  name: string;
  email: string;
}

const DEFAULT_COMPANY_USERS: CompanyInviteUser[] = [];

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isValidPhone(value: string): boolean {
  const cleaned = value.replace(/[^\d+]/g, "").trim();
  return cleaned.length >= 7;
}

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local
    .split(/[._-]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length) {
    return email;
  }

  return parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function initialsFromName(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);

  if (!parts.length) return "--";

  const first = parts[0]?.[0] ?? "";
  const second =
    parts.length > 1 ? (parts[1]?.[0] ?? "") : (parts[0]?.[1] ?? "");
  return `${first}${second}`.toUpperCase();
}

export default function DashboardContent() {
  const router = useRouter();
  const pathname = usePathname();
  const portalPrefix = pathname.startsWith("/admin")
    ? "/admin"
    : "/user";
  const bizcardListHref = `${portalPrefix}/bizcard-list`;
  const bizcardEditorHref = `${portalPrefix}/bizcard`;
  const associateHref = `${portalPrefix}/associate`;
  const inquiryHref = portalPrefix === "/admin" ? "/admin/inquiry-page" : `${portalPrefix}/inquiry`;
  const leadsHref = `${portalPrefix}/leads`;
  const contactSavesHref = `${portalPrefix}/contact-saves`;
  const editorFieldHref = (key: keyof CompletionData["fields"]) =>
    `${bizcardEditorHref}?tab=${FIELD_EDITOR_TABS[key]}&focus=${key}`;
  const activityHref = (item: DashboardActivityItem): string | null => {
    const meta = item.meta ?? {};
    const alias = String(meta.alias ?? "").trim();
    const fieldKey = String(meta.fieldKey ?? "") as keyof CompletionData["fields"];
    switch (item.activityType) {
      case "NEW_INQUIRY":
        if (String(meta.source ?? "").trim() === "visitor_lead") {
          return leadsHref;
        }
        return item.referenceId
          ? `${inquiryHref}?id=${encodeURIComponent(item.referenceId)}`
          : inquiryHref;
      case "INQUIRY_SENT":
        return inquiryHref;
      case "NEW_CONNECTION":
      case "CONNECTION_SENT":
      case "CONNECTION_ACCEPTED":
        return associateHref;
      case "CONTACT_SAVED":
        return contactSavesHref;
      case "VIEWED_PORTFOLIO":
        return alias ? `/${encodeURIComponent(alias)}` : null;
      case "PROFILE_EDIT":
        return fieldKey && FIELD_EDITOR_TABS[fieldKey]
          ? editorFieldHref(fieldKey)
          : bizcardEditorHref;
      default:
        return null;
    }
  };
  const emarketSubscriptionHref = `${portalPrefix}/emarket?tab=subscription`;
  const [profile, setProfile] = useState<VCardProfile | null>(null);
  const [dashboard, setDashboard] = useState<DashboardMetrics | null>(null);
  const [metricsPeriod, setMetricsPeriod] = useState(() => format(new Date(), "yyyy-MM"));
  const [recentActivity, setRecentActivity] = useState<DashboardActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [completion, setCompletion] = useState<CompletionData | null>(null);
  const [completionByBizcardId, setCompletionByBizcardId] = useState<
    Record<string, CompletionData>
  >({});
  const completionByBizcardIdRef = useRef(completionByBizcardId);
  completionByBizcardIdRef.current = completionByBizcardId;
  const selectedBizcardIdRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [authName, setAuthName] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [downloadingQr, setDownloadingQr] = useState(false);
  const [isSetupCompanyOpen, setIsSetupCompanyOpen] = useState(false);
  const [isJoinCompanyOpen, setIsJoinCompanyOpen] = useState(false);
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(
    null,
  );
  const [companyFormErrors, setCompanyFormErrors] = useState<CompanyFormErrors>(
    {},
  );
  const [companySubmitting, setCompanySubmitting] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyIndustry, setCompanyIndustry] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [companyDescription, setCompanyDescription] = useState("");
  const [companyLogoUrl, setCompanyLogoUrl] = useState("");
  const [canCreateCompany, setCanCreateCompany] = useState(false);
  const [currentSubscriptionTier, setCurrentSubscriptionTier] = useState<
    string | null
  >(null);
  const [isSubscriptionLoading, setIsSubscriptionLoading] = useState(true);
  const [subscriptionError, setSubscriptionError] = useState("");
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
  const [isProfileViewsModalOpen, setIsProfileViewsModalOpen] = useState(false);
  const upgradeModalGoToMarketButtonRef = useRef<HTMLButtonElement | null>(

    null,

  );

  const [inviteDraft, setInviteDraft] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [companyUsers, setCompanyUsers] = useState<CompanyInviteUser[]>(
    DEFAULT_COMPANY_USERS,
  );
  const [activeThemeId, setActiveThemeId] = useState("elegant-dark");
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [bizCardDetailsView, setBizCardDetailsView] = useState<
    "card" | "checklist"
  >("checklist");
  const [digitalCardModalOpen, setDigitalCardModalOpen] = useState(false);
  const [ownedBizcards, setOwnedBizcards] = useState<DashboardOwnedBizcard[]>([]);
  const [selectedBizcardIndex, setSelectedBizcardIndex] = useState(0);
  const [cardSwitchKey, setCardSwitchKey] = useState(0);

  const parseCompanyProfile = (payload: unknown): CompanyProfile | null => {
    if (!payload || typeof payload !== "object") return null;
    const root = payload as Record<string, unknown>;
    const data =
      root.data && typeof root.data === "object"
        ? (root.data as Record<string, unknown>)
        : root;
    const id = String(data.company_id ?? data.companyId ?? "").trim();
    if (!id) return null;
    return {
      company_id: id,
      company_name: String(data.company_name ?? data.companyName ?? "").trim(),
      status: String(data.status ?? "").trim() || "pending",
      subscription_tier: (data.subscription_tier ??
        data.subscriptionTier ??
        null) as string | null,
      my_role: (data.my_role ?? data.myRole ?? null) as string | null,
      my_permissions: Array.isArray(data.my_permissions)
        ? (data.my_permissions as string[])
        : [],
      joined_at: (data.joined_at ?? data.joinedAt ?? null) as string | null,
    };
  };

  const parseSubscriptionPayload = (
    payload: unknown,
  ): { tier: string; canCreateCompany: boolean } => {
    if (!payload || typeof payload !== "object") {
      return { tier: "basic", canCreateCompany: false };
    }
    const root = payload as Record<string, unknown>;
    const data =
      root.data && typeof root.data === "object"
        ? (root.data as Record<string, unknown>)
        : root;
    const features =
      data.features && typeof data.features === "object"
        ? (data.features as Record<string, unknown>)
        : {};
    const tier = parseSubscriptionTier(payload);
    const canCreate =
      features.can_create_company === true ||
      features.canCreateCompany === true;
    return { tier, canCreateCompany: canCreate };
  };

  const isCompanyCreationEligible = (
    tier: string | null,
    eligibleFlag: boolean,
  ): boolean => {
    if (eligibleFlag) return true;
    if (!tier) return false;
    return COMPANY_CREATION_TIERS.has(tier.toLowerCase());
  };

  const parseSubscriptionTier = (payload: unknown): string => {
    if (!payload || typeof payload !== "object") return "basic";
    const root = payload as Record<string, unknown>;
    const data =
      root.data && typeof root.data === "object"
        ? (root.data as Record<string, unknown>)
        : root;
    const tier = String(
      data.tier ?? data.subscriptionTier ?? data.subscription_tier ?? "basic",
    ).toLowerCase();
    const accessReason = String(
      data.access_reason ?? data.accessReason ?? "",
    ).toLowerCase();
    const isTrial = Boolean(data.is_trial ?? data.isTrial);
    if (tier === "none" && (isTrial || accessReason === "free_trial")) {
      return "free_trial";
    }
    return tier;
  };

  const fetchUserSubscriptionTier = async (
    authHeaders: HeadersInit,
  ): Promise<void> => {
    setIsSubscriptionLoading(true);
    setSubscriptionError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/user/subscription`, {
        method: "GET",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
          ...buildImpersonationHeaders(),
        },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message = extractErrorMessage(
          payload,
          "Unable to verify subscription. Please try again.",
        );
        setSubscriptionError(message);
        setCurrentSubscriptionTier(null);
        setCanCreateCompany(false);
        console.error("[DASHBOARD] SUBSCRIPTION_CHECK_FAILED", {
          status: response.status,
          message,
          payload,
        });
        return;
      }
      const payload = await response.json().catch(() => null);
      const { tier, canCreateCompany: eligible } =
        parseSubscriptionPayload(payload);
      setCurrentSubscriptionTier(tier);
      setCanCreateCompany(eligible);
    } catch (error) {
      setSubscriptionError("Unable to verify subscription. Please try again.");
      setCurrentSubscriptionTier(null);
      setCanCreateCompany(false);
      console.error("[DASHBOARD] SUBSCRIPTION_CHECK_FAILED", error);
    } finally {
      setIsSubscriptionLoading(false);
    }
  };
  const fetchCompanyProfile = async (): Promise<void> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/company/my-company`, {
        method: "GET",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...buildAuthHeaders(),
          ...buildImpersonationHeaders(),
        },
      });
      if (!response.ok) {
        if (response.status === 404 || response.status === 403) {
          setCompanyProfile(null);
          return;
        }
        return;
      }
      const payload = await response.json();
      const root = payload as Record<string, unknown>;
      const data =
        root.data && typeof root.data === "object"
          ? (root.data as Record<string, unknown>)
          : root;
      if (data.has_company === false) {
        setCompanyProfile(null);
        return;
      }
      const parsed = parseCompanyProfile(payload);
      if (parsed) setCompanyProfile(parsed);
      else setCompanyProfile(null);
    } catch { }
  };
  const refreshDashboardMetrics = useCallback(async (): Promise<void> => {
    try {
      const authHeaders = buildAuthHeaders();
      const dashRes = await fetch(`${API_BASE_URL}/api/dashboard`, {
        credentials: "include",
        headers: { ...authHeaders, ...buildImpersonationHeaders() },
      }).then((r) => (r.ok ? r.json() : null));
      if (dashRes) {
        setDashboard(dashRes);
        const period = dashRes?.metrics?.metricsPeriod;
        if (typeof period === "string" && period.trim()) {
          setMetricsPeriod(period);
        }
      }
    } catch {
    }
  }, []);

  const refreshRecentActivity = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setActivityLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/dashboard/activity?page=1&limit=20`, {
        credentials: "include",
        headers: { ...buildAuthHeaders(), ...buildImpersonationHeaders() },
      });
      if (!res.ok) return;
      const payload = (await res.json()) as { items?: DashboardActivityItem[] };
      setRecentActivity(Array.isArray(payload.items) ? payload.items : []);
    } catch {
      // Keep the last known feed on transient failures.
    } finally {
      setActivityLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshRecentActivity();
    const timer = window.setInterval(() => {
      void refreshRecentActivity({ silent: true });
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [refreshRecentActivity]);

  const refreshProfileData = useCallback(async (): Promise<void> => {
    try {
      const authHeaders = buildAuthHeaders();
      const vcardRes = await fetch(`${API_BASE_URL}/api/vcard/profile`, {
        credentials: "include",
        headers: { ...authHeaders, ...buildImpersonationHeaders() },
        cache: "no-store",
      }).then((r) => (r.ok ? r.json() : null));

      if (!vcardRes?.profile) return;
      let profileData = vcardRes.profile as VCardProfile;
      const userId = String(profileData.user_id ?? "").trim();
      const profileAlias = String(profileData.custom_uri ?? "").trim();
      const scopedQuery = userId
        ? `userId=${encodeURIComponent(userId)}&type=services`
        : profileAlias
          ? `username=${encodeURIComponent(profileAlias)}&type=services`
          : "";
      if (scopedQuery) {
        const svcRes = await fetch(
          `${API_BASE_URL}/api/vcard/services?${scopedQuery}`,
          {
            credentials: "include",
            headers: { ...authHeaders, ...buildImpersonationHeaders() },
            cache: "no-store",
          },
        ).then((r) => (r.ok ? r.json() : null));
        const svcList = svcRes?.data?.services;
        if (Array.isArray(svcList) && svcList.length > 0) {
          profileData = { ...profileData, services: svcList };
        }
      }

      setProfile(profileData);
    } catch {
      // Keep existing profile visible on transient failures.
    }
  }, []);

  const refreshOwnedBizcards = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/user/bizcards?page=1&limit=20&sortBy=created_at&sortDir=desc`,
        {
          credentials: "include",
          cache: "no-store",
          headers: { ...buildAuthHeaders(), ...buildImpersonationHeaders() },
        },
      );
      if (!res.ok) return;
      const payload = (await res.json()) as {
        data?: { bizcards?: Record<string, unknown>[] };
        bizcards?: Record<string, unknown>[];
      };
      const rows = Array.isArray(payload?.data?.bizcards)
        ? payload.data!.bizcards!
        : Array.isArray(payload?.bizcards)
          ? payload.bizcards!
          : [];

      const mapped: DashboardOwnedBizcard[] = rows.map((card) => ({
        bizcard_id: String(card.bizcard_id ?? card.id ?? "").trim(),
        serial_id: String(card.serial_id ?? "").trim() || null,
        bizcard_name: String(card.bizcard_name ?? "").trim() || null,
        url_alias: String(card.url_alias ?? "").trim() || null,
        first_name: String(card.first_name ?? "").trim() || null,
        last_name: String(card.last_name ?? "").trim() || null,
        professional_title:
          String(card.professional_title ?? card.job_position ?? "").trim() ||
          null,
        profile_img: String(card.profile_img ?? "").trim() || null,
        cover_img: String(card.cover_img ?? "").trim() || null,
        bizcard_theme: String(card.bizcard_theme ?? "").trim() || null,
        qr_code_url: String(card.qr_code_url ?? "").trim() || null,
      })).filter((card) => Boolean(card.bizcard_id));

      setOwnedBizcards(mapped);
      setSelectedBizcardIndex((prev) => {
        if (mapped.length === 0) return 0;
        return Math.min(prev, mapped.length - 1);
      });
    } catch {
      // Keep last known list on transient failures.
    }
  }, []);

  const refreshCompletion = useCallback(async (): Promise<void> => {
    try {
      const authHeaders = buildAuthHeaders();
      const impersonationHeaders = buildImpersonationHeaders();
      const bizcardId = selectedBizcardIdRef.current;

      // Prefer per-BizCard completion so the Info panel tracks the active card.
      if (bizcardId) {
        const detailRes = await fetch(
          `${API_BASE_URL}/api/user/bizcards/${encodeURIComponent(bizcardId)}`,
          {
            credentials: "include",
            headers: { ...authHeaders, ...impersonationHeaders },
            cache: "no-store",
          },
        ).then((r) => (r.ok ? r.json() : null));
        const card =
          detailRes?.data?.bizcard && typeof detailRes.data.bizcard === "object"
            ? (detailRes.data.bizcard as Record<string, unknown>)
            : null;
        const next = buildCompletionFromBizcard(card);
        if (next && selectedBizcardIdRef.current === bizcardId) {
          setCompletionByBizcardId((prev) => ({ ...prev, [bizcardId]: next }));
          setCompletion(next);
          return;
        }
      }

      const compRes = await fetch(
        `${API_BASE_URL}/api/dashboard/vcard-completion`,
        {
          credentials: "include",
          headers: { ...authHeaders, ...impersonationHeaders },
          cache: "no-store",
        },
      ).then((r) => (r.ok ? r.json() : null));
      if (compRes) setCompletion(compRes);
    } catch {
      // Keep existing completion visible on transient failures.
    } finally {
      await refreshProfileData();
    }
  }, [refreshProfileData]);

  useEffect(() => {
    const loadDashboard = async () => {
      setAuthName(readAuthUserName());
      setLoading(true);
      try {
        const authHeaders = buildAuthHeaders();
        const impersonationHeaders = buildImpersonationHeaders();
        const [dashRes, compRes] = await Promise.all([
          fetch(`${API_BASE_URL}/api/dashboard`, {
            credentials: "include",
            headers: { ...authHeaders, ...impersonationHeaders },
          }).then((r) => (r.ok ? r.json() : null)),
          fetch(`${API_BASE_URL}/api/dashboard/vcard-completion`, {
            credentials: "include",
            headers: { ...authHeaders, ...impersonationHeaders },
            cache: "no-store",
          }).then((r) => (r.ok ? r.json() : null)),
        ]);

        if (dashRes) {
          setDashboard(dashRes);
          const period = dashRes?.metrics?.metricsPeriod;
          if (typeof period === "string" && period.trim()) {
            setMetricsPeriod(period);
          }
        }
        if (compRes) setCompletion(compRes);
        await Promise.all([refreshProfileData(), refreshOwnedBizcards()]);

        await fetchUserSubscriptionTier(authHeaders);
        await fetchCompanyProfile();
      } catch {
      } finally {
        setLoading(false);
      }
    };

    const handleMetricsRefresh = () => {
      void refreshDashboardMetrics();
      void refreshCompletion();
      void refreshOwnedBizcards();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshDashboardMetrics();
        void refreshCompletion();
        void refreshOwnedBizcards();
      }
    };

    const handleUserSync = () => {
      void refreshCompletion();
      void refreshOwnedBizcards();
      void loadDashboard();
    };

    const handleStorage = (event: StorageEvent) => {
      const key = event.key ?? "";
      if (
        key === "frontend_new_bizcard_refresh" ||
        key === "portfolio_refresh_ts" ||
        key === "latestPortfolioAlias" ||
        key.startsWith("portfolio_")
      ) {
        void refreshOwnedBizcards();
        void refreshCompletion();
      }
    };

    loadDashboard();
    window.addEventListener(USER_SYNC_EVENT, handleUserSync);
    window.addEventListener("focus", handleMetricsRefresh);
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener(USER_SYNC_EVENT, handleUserSync);
      window.removeEventListener("focus", handleMetricsRefresh);
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshDashboardMetrics, refreshCompletion, refreshProfileData, refreshOwnedBizcards]);

  useEffect(() => {
    const checkMonthRollover = () => {
      const currentPeriod = format(new Date(), "yyyy-MM");
      if (currentPeriod !== metricsPeriod) {
        void refreshDashboardMetrics();
      }
    };

    const intervalId = window.setInterval(checkMonthRollover, 60_000);
    window.addEventListener("focus", checkMonthRollover);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") checkMonthRollover();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", checkMonthRollover);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [metricsPeriod, refreshDashboardMetrics]);

  useEffect(() => {
    if (!pathname?.includes("/dashboard")) return;
    void refreshCompletion();
  }, [pathname, refreshCompletion]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(PORTFOLIO_BROADCAST_CHANNEL);
    channel.onmessage = () => {
      void refreshCompletion();
    };
    return () => channel.close();
  }, [refreshCompletion]);

  const selectedBizcard =
    ownedBizcards.length > 0
      ? ownedBizcards[
          Math.min(selectedBizcardIndex, ownedBizcards.length - 1)
        ] ?? null
      : null;
  const hasMultipleBizcards = ownedBizcards.length > 1;
  const selectedBizcardId = selectedBizcard?.bizcard_id ?? null;
  selectedBizcardIdRef.current = selectedBizcardId;

  const selectedBizcardIndexRef = useRef(selectedBizcardIndex);
  selectedBizcardIndexRef.current = selectedBizcardIndex;

  const selectBizcardIndex = useCallback(
    (nextIndex: number) => {
      if (ownedBizcards.length === 0) return;
      const bounded =
        ((nextIndex % ownedBizcards.length) + ownedBizcards.length) %
        ownedBizcards.length;
      if (bounded === selectedBizcardIndexRef.current) return;

      const nextCard = ownedBizcards[bounded];
      if (nextCard?.bizcard_id) {
        const cached = completionByBizcardIdRef.current[nextCard.bizcard_id];
        if (cached) {
          setCompletion(cached);
        } else {
          const optimistic = buildCompletionFromBizcard(
            nextCard as unknown as Record<string, unknown>,
          );
          if (optimistic) setCompletion(optimistic);
        }
      }

      setSelectedBizcardIndex(bounded);
      setCardSwitchKey((k) => k + 1);
    },
    [ownedBizcards],
  );

  // Keep Bizcard Info %/checklist in sync with the actively shown BizCard.
  useEffect(() => {
    if (!selectedBizcardId) return;

    const activeCard =
      ownedBizcards.find((card) => card.bizcard_id === selectedBizcardId) ??
      null;
    const cached = completionByBizcardId[selectedBizcardId];
    if (cached) {
      setCompletion(cached);
    } else if (activeCard) {
      // Never inherit the previous card's percentage while the detail fetch runs.
      const optimistic = buildCompletionFromBizcard(
        activeCard as unknown as Record<string, unknown>,
      );
      if (optimistic) setCompletion(optimistic);
    }

    const controller = new AbortController();
    let cancelled = false;

    const loadActiveBizcardCompletion = async () => {
      try {
        const detailRes = await fetch(
          `${API_BASE_URL}/api/user/bizcards/${encodeURIComponent(selectedBizcardId)}`,
          {
            credentials: "include",
            headers: { ...buildAuthHeaders(), ...buildImpersonationHeaders() },
            cache: "no-store",
            signal: controller.signal,
          },
        ).then((r) => (r.ok ? r.json() : null));

        if (cancelled) return;

        const card =
          detailRes?.data?.bizcard && typeof detailRes.data.bizcard === "object"
            ? (detailRes.data.bizcard as Record<string, unknown>)
            : activeCard
              ? (activeCard as unknown as Record<string, unknown>)
              : null;

        const next = buildCompletionFromBizcard(card);
        if (!next) return;

        setCompletionByBizcardId((prev) => ({
          ...prev,
          [selectedBizcardId]: next,
        }));
        if (selectedBizcardIdRef.current === selectedBizcardId) {
          setCompletion(next);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        if (cancelled || !activeCard) return;
        const fallback = buildCompletionFromBizcard(
          activeCard as unknown as Record<string, unknown>,
        );
        if (fallback && selectedBizcardIdRef.current === selectedBizcardId) {
          setCompletion(fallback);
        }
      }
    };

    void loadActiveBizcardCompletion();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // Sync only when the active BizCard changes; focus/visibility refresh
    // paths call refreshCompletion separately for real-time updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBizcardId]);

  // Auto-advance Digital Card carousel only (smooth slide via cardSwitchKey remount)
  useEffect(() => {
    if (!hasMultipleBizcards) return;
    const intervalId = window.setInterval(() => {
      selectBizcardIndex(selectedBizcardIndexRef.current + 1);
    }, 4500);
    return () => window.clearInterval(intervalId);
  }, [hasMultipleBizcards, selectBizcardIndex]);

  const alias =
    selectedBizcard?.url_alias?.trim() ||
    profile?.custom_uri?.trim() ||
    "";
  const refreshActiveTheme = useCallback(() => {
    const themeFromCard = selectedBizcard?.bizcard_theme
      ? normalizePortfolioThemeId(selectedBizcard.bizcard_theme)
      : null;
    if (themeFromCard) {
      setActiveThemeId(themeFromCard);
      return;
    }
    setActiveThemeId(resolveDashboardThemeId(alias, profile));
  }, [alias, profile, selectedBizcard?.bizcard_theme]);

  useEffect(() => {
    refreshActiveTheme();
  }, [refreshActiveTheme]);

  useEffect(() => {
    const handleThemeSync = () => refreshActiveTheme();
    window.addEventListener(USER_SYNC_EVENT, handleThemeSync);
    window.addEventListener("focus", handleThemeSync);
    return () => {
      window.removeEventListener(USER_SYNC_EVENT, handleThemeSync);
      window.removeEventListener("focus", handleThemeSync);
    };
  }, [refreshActiveTheme]);

  const activeTheme = useMemo(() => getTheme(activeThemeId), [activeThemeId]);
  const digitalCardTheme = useMemo(
    () => toDigitalBizCardTheme(activeTheme),
    [activeTheme],
  );
  const displayName = selectedBizcard
    ? [selectedBizcard.first_name, selectedBizcard.last_name]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      selectedBizcard.bizcard_name ||
      authName ||
      "Your Name"
    : profile
      ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") ||
        profile.vcard_name ||
        authName ||
        "Your Name"
      : authName || "Your Name";
  const initials =
    displayName
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?";
  const role =
    selectedBizcard?.professional_title ||
    profile?.job_position ||
    "Digital Business";
  const selectedProfileImage =
    selectedBizcard?.profile_img || profile?.profile_url || null;
  const selectedBizcardLabel =
    selectedBizcard?.bizcard_name ||
    (hasMultipleBizcards
      ? `BizCard ${selectedBizcardIndex + 1}`
      : profile?.vcard_name) ||
    null;
  const activeBizcardEditorHref = selectedBizcard?.bizcard_id
    ? `${portalPrefix}/bizcard/${encodeURIComponent(selectedBizcard.bizcard_id)}`
    : bizcardEditorHref;
  const resolvedServices = useMemo(
    () => resolveBizCardServices(profile, alias),
    [profile, alias],
  );
  // When a BizCard is selected, trust that card's completion fields only —
  // do not OR in profile/cache services from another card.
  const { pct, pending, mergedFields } = useMemo(
    () =>
      computeAdjustedCompletion(
        completion,
        selectedBizcardId ? [] : resolvedServices,
      ),
    [completion, resolvedServices, selectedBizcardId],
  );
  const isProfileComplete = pct === 100;
  const showCompletedIdCard =
    isProfileComplete && bizCardDetailsView === "card" && !loading;
  const portfolioHref = getPortfolioHref(dashboard?.portfolioUrl, alias);
  const hasPortfolio = portfolioHref !== "#";
  const publicAliasHref = alias.trim().replace(/^\/+/, "")
    ? `/${alias.trim().replace(/^\/+/, "")}`
    : "#";
  const companyStatus = (companyProfile?.status ?? "").toLowerCase();
  const isCompanyPending = companyStatus === "pending";
  const isCompanyRejected = companyStatus === "rejected";
  const hasActiveCompany = companyStatus === "active";
  const portfolioCopyUrl =
    (alias
      ? `${typeof window !== "undefined" ? window.location.origin : ""}/${alias}`
      : "") ||
    dashboard?.portfolioUrl?.trim() ||
    "";
  const digitalCardData = useMemo(
    () =>
      buildDigitalBizCardData({
        firstName: selectedBizcard?.first_name ?? profile?.first_name,
        lastName: selectedBizcard?.last_name ?? profile?.last_name,
        displayName: selectedBizcard?.bizcard_name ?? profile?.vcard_name,
        jobTitle: selectedBizcard?.professional_title ?? profile?.job_position,
        phone: profile?.contact,
        email: profile?.email,
        profileImageUrl: selectedProfileImage
          ? toServableMediaSrc(selectedProfileImage)
          : "",
        alias,
        portfolioUrl: portfolioCopyUrl,
        socials: profile?.socials ?? [],
      }),
    [alias, portfolioCopyUrl, profile, selectedBizcard, selectedProfileImage],
  );
  const scannablePortfolioUrl = useMemo(
    () => buildScannablePortfolioUrl(alias, dashboard?.portfolioUrl),
    [alias, dashboard?.portfolioUrl],
  );

  useEffect(() => {
    let cancelled = false;

    const generateQrCode = async () => {
      if (!scannablePortfolioUrl) {
        if (!cancelled) setQrCodeDataUrl(null);
        return;
      }

      try {
        const dataUrl = await QRCode.toDataURL(scannablePortfolioUrl, {
          errorCorrectionLevel: "H",
          type: "image/png",
          margin: 1,
          width: 220,
        });
        if (!cancelled) setQrCodeDataUrl(dataUrl);
      } catch {
        if (!cancelled) setQrCodeDataUrl(dashboard?.qrCode ?? null);
      }
    };

    void generateQrCode();
    return () => {
      cancelled = true;
    };
  }, [scannablePortfolioUrl, dashboard?.qrCode]);

  const handleCopyPortfolioUrl = async () => {
    if (!portfolioCopyUrl) return;
    try {
      await navigator.clipboard.writeText(portfolioCopyUrl);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    window.setTimeout(() => setCopyState("idle"), 1600);
  };
  const handleSharePortfolio = async () => {
    if (!portfolioCopyUrl) {
      showToast("Add your portfolio link before sharing.", "error");
      return;
    }
    const shared = await sharePortfolioUrl(portfolioCopyUrl, displayName);
    if (shared) {
      showToast(
        typeof navigator !== "undefined" && typeof navigator.share === "function"
          ? "Portfolio shared."
          : "Portfolio link copied.",
        "success",
      );
    }
  };
  const handleOpenDigitalCardModal = () => {
    if (!digitalCardData) {
      showToast("Complete your portfolio link to download your digital card.", "error");
      return;
    }
    setDigitalCardModalOpen(true);
  };
  const handleDownloadQr = async () => {
    const qrCode = qrCodeDataUrl ?? dashboard?.qrCode;
    if (!qrCode) return;
    setDownloadingQr(true);
    const success = await downloadImage(
      qrCode,
      `${alias || "ontap"}-qr-code.svg`,
    );
    setDownloadingQr(false);
    if (!success) {
      window.open(qrCode, "_blank", "noopener,noreferrer");
    }
  };
  useEffect(() => {
    if (isProfileComplete) {
      setBizCardDetailsView("card");
    }
  }, [isProfileComplete]);
  const stats = [
    {
      label: "Profile Views",
      value: dashboard ? dashboard.metrics.totalViews.toLocaleString() : "—",
      icon: Eye,
      color: "#2A4792",
      clickable: true as const,
    },
    {
      label: "Associates",
      value: dashboard ? String(dashboard.metrics.totalConnections) : "—",
      icon: Users,
      color: "#3B569F",
      clickable: true as const,
      href: associateHref,
    },
    {
      label: "Inquiries",
      value: dashboard ? String(dashboard.metrics.totalInquiries) : "—",
      icon: Mail,
      color: "#4785B8",
      clickable: true as const,
      href: inquiryHref,
    },
    {
      label: "Contact Saves",
      value: dashboard ? String(dashboard.metrics.totalContactSaves) : "—",
      icon: BookmarkCheck,
      color: "#2A4792",
      clickable: true as const,
      href: contactSavesHref,
    },
  ];
  const inquiries = dashboard?.recentInquiries ?? [];
  const handleAddInvitees = () => {
    const entries = inviteDraft
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    if (!entries.length) {
      setInviteError("Enter at least one email to invite.");
      return;
    }
    const invalid = entries.find((entry) => !isValidEmail(entry));
    if (invalid) {
      setInviteError(`Invalid email: ${invalid}`);
      return;
    }
    const existingEmails = new Set(
      companyUsers.map((user) => user.email.toLowerCase()),
    );
    const uniqueEntries = entries.filter((entry) => !existingEmails.has(entry));
    if (!uniqueEntries.length) {
      setInviteError("All entered emails are already in the list.");
      return;
    }
    const nextUsers = uniqueEntries.map((email) => ({
      id: `invite-${Date.now()}-${email}`,
      name: nameFromEmail(email),
      email,
    }));
    setCompanyUsers((previous) => [...previous, ...nextUsers]);
    setInviteDraft("");
    setInviteError("");
  };

  const handleOpenSetupCompany = async () => {
    if (isSubscriptionLoading) return;

    if (!isCompanyCreationEligible(currentSubscriptionTier, canCreateCompany)) {
      setIsUpgradeModalOpen(true);
      return;
    }

    setIsSetupCompanyOpen(true);
  };

  const handleOpenJoinCompany = () => {
    if (
      isSubscriptionLoading ||
      isCompanyPending ||
      companySubmitting ||
      hasActiveCompany
    ) {
      return;
    }
    setIsJoinCompanyOpen(true);
  };

  const handleJoinCompanySuccess = async (message: string) => {
    showToast(message, "success");
    await fetchCompanyProfile();
  };

  useEffect(() => {
    if (!isUpgradeModalOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsUpgradeModalOpen(false);
      }
    };

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    window.requestAnimationFrame(() => {
      upgradeModalGoToMarketButtonRef.current?.focus();
    });

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isUpgradeModalOpen]);

  const closeSetupCompanyModal = () => {
    setIsSetupCompanyOpen(false);
    setInviteError("");
    setCompanyFormErrors({});
  };

  const handleCompanyLogoUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setCompanyFormErrors((previous) => ({
      ...previous,
      companyLogoUrl: undefined,
    }));

    if (!isAllowedCompanyLogoFile(file)) {
      setCompanyLogoUrl("");
      setCompanyFormErrors((previous) => ({
        ...previous,
        companyLogoUrl: "Only PNG and JPG/JPEG files are allowed.",
      }));
      event.target.value = "";
      return;
    }

    try {
      const uploadedUrl = await uploadCompanyLogoFile(file);
      setCompanyLogoUrl(uploadedUrl);
    } catch (error) {
      setCompanyLogoUrl("");
      setCompanyFormErrors((previous) => ({
        ...previous,
        companyLogoUrl:
          error instanceof Error
            ? error.message
            : "Failed to upload company logo.",
      }));
    } finally {
      event.target.value = "";
    }
  };

  const handleCompleteSetupCompany = async () => {
    const nextErrors: CompanyFormErrors = {};
    if (!companyName.trim())
      nextErrors.companyName = "Company name is required.";
    if (!companyEmail.trim() || !isValidEmail(companyEmail))
      nextErrors.companyEmail = "Enter a valid company email.";
    if (!companyPhone.trim() || !isValidPhone(companyPhone))
      nextErrors.companyPhone = "Enter a valid phone number.";
    if (!companyIndustry.trim())
      nextErrors.companyIndustry = "Industry is required.";
    if (!companyAddress.trim())
      nextErrors.companyAddress = "Company address is required.";
    if (companyDescription.trim().length > 2000)
      nextErrors.companyDescription = "Description is too long.";

    if (Object.keys(nextErrors).length > 0) {
      setCompanyFormErrors(nextErrors);
      return;
    }

    
    setCompanySubmitting(true);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(buildAuthHeaders() as Record<string, string>),
      };
      const csrfToken = await ensureCsrfToken();
      if (csrfToken) headers["X-CSRF-Token"] = csrfToken;

      const requestBody = {
        company_name: companyName.trim(),
        description: companyDescription.trim() || undefined,
        logo_url: companyLogoUrl.trim() || undefined,
        company_email: companyEmail.trim(),
        company_phone: companyPhone.trim(),
        company_address: companyAddress.trim(),
        industry: companyIndustry.trim(),
        ...(companyUsers.length > 0
          ? { invite_emails: companyUsers.map((user) => user.email) }
          : {}),
      };

      // Log request body for debugging (remove in production)
      console.log("[DASHBOARD] Company create request:", requestBody);

      const response = await fetch(`${API_BASE_URL}/api/company/create`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify(requestBody),
      });
      
      const payload = (await response
        .json()
        .catch(() => ({}))) as CompanyRequestResponse;
      if (!response.ok) {
        throw new Error(
          extractErrorMessage(payload, "Failed to submit company request."),
        );
      }
      


      const parsed = parseCompanyProfile(payload);

      if (parsed) {
        setCompanyProfile(parsed);
      }
      showToast(
        payload.data?.message ||
        "Company request submitted. Awaiting approval.",
        "success"
      );
      setCompanyName("");
      setCompanyEmail("");
      setCompanyPhone("");
      setCompanyIndustry("");
      setCompanyAddress("");
      setCompanyDescription("");
      setCompanyLogoUrl("");
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          "superadmin_pending_requests_refresh",
          String(Date.now()),
        );
      }

      setCompanyUsers([]);
      closeSetupCompanyModal();
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Failed to submit company request.",
        "error"
      );
    } finally {
      setCompanySubmitting(false);
    }

  };


  return (
    <div className={`h-full overflow-y-auto scrollbar-thin bg-[#F4F7FC] py-4 sm:py-6 ${portalPrefix === "/user" ? "px-0 sm:px-6 lg:px-8" : "px-4 sm:px-6 lg:px-8"}`}>
      {loading &&
        <div className="absolute inset-0 z-[9999] flex items-center justify-center bg-[#f8fafc]">
          <SectionLoader text="Loading dashboard..." />
        </div>
      }
      <div className="space-y-5 sm:space-y-6 animate-fade-in-up">
        {isCompanyPending && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-sm">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <span className="font-semibold">
                Company setup request pending approval.
              </span>
              <span className="text-xs text-amber-700">
                You will be notified once the Super Admin approves it.
              </span>
            </div>
          </div>
        )}
        {isCompanyRejected && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 shadow-sm">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <span className="font-semibold">
                Company setup request was rejected.
              </span>
              <span className="text-xs text-rose-700">
                Update your details and resubmit when ready.
              </span>
            </div>
          </div>
        )}
        <PortalNoticeSurface
          portal={detectPortalFromPath(pathname) === "admin" ? "admin" : "user"}
          placement="dashboard"
        />
        <PortalNoticeSurface
          portal={detectPortalFromPath(pathname) === "admin" ? "admin" : "user"}
          placement="global_banner"
        />
        <div className="w-full flex flex-col sm:flex-row sm:items-center gap-4 px-1 mb-2">
          <div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
              Welcome back,{" "}
              <span className="bg-gradient-to-r from-[#2A4792] to-[#4785B8] bg-clip-text text-transparent">
                {displayName}
              </span>
            </h2>
            {hasActiveCompany && companyProfile ? (
              <p className="mt-1.5 text-sm font-medium text-gray-500">
                Member of{" "}
                <span className="font-semibold text-[#2A4792]">
                  {companyProfile.company_name}
                </span>
                {companyProfile.joined_at ? (
                  <> since {formatJoinDate(companyProfile.joined_at)}</>
                ) : null}
              </p>
            ) : null}
          </div>
          <div className="flex gap-3 ml-auto items-center">
            <button
              type="button"
              onClick={handleOpenSetupCompany}
              disabled={
                isCompanyPending || companySubmitting || isSubscriptionLoading
              }
              className={`${hasActiveCompany ? "hidden" : ""} ml-0 lg:ml-auto self-start sm:self-auto px-6 py-2.5 rounded-xl text-sm font-bold shadow-sm transition-all duration-300 active:scale-95 ${isCompanyPending || companySubmitting || isSubscriptionLoading
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200"
                  : "bg-white border border-gray-200 text-[#2A4792] hover:bg-[#F8FAFC] hover:border-[#4785B8] hover:shadow-md"
                }`}
            >
              {isSubscriptionLoading ? (
                <span className="inline-flex items-center gap-2">
                  <InlineLoader />
                  Checking subscription
                </span>
              ) : isCompanyPending ? (
                "Request Pending"
              ) : (
                "Set up Company"
              )}
            </button>
            <button
              type="button"
              onClick={handleOpenJoinCompany}
              disabled={
                isCompanyPending ||
                companySubmitting ||
                isSubscriptionLoading ||
                hasActiveCompany
              }
              className={`self-start sm:self-auto px-6 py-2.5 rounded-xl text-sm font-bold shadow-sm transition-all duration-300 active:scale-95 ${isCompanyPending ||
                  companySubmitting ||
                  isSubscriptionLoading ||
                  hasActiveCompany
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200"
                  : "bg-primary border border-gray-200 text-white hover:bg-primary-light hover:border-primary hover:shadow-md"
                }`}
            >
              {hasActiveCompany ? "In a Company" : "Join Company"}
            </button>
          </div>
        </div>
        {subscriptionError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 shadow-sm">
            <p className="font-semibold">Unable to verify your subscription.</p>
            <p className="text-xs text-rose-700">
              Please refresh the page or try again later.
            </p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
          {stats.map((s) => {
            const isClickable = s.clickable === true;
            const cardClassName =
              "group bg-white border border-gray-100 rounded-3xl p-3 sm:p-6 shadow-sm hover:shadow-xl hover:shadow-[#4785B8]/5 hover:-translate-y-1 transition-all duration-300" +
              (isClickable
                ? " cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A4792]/40"
                : "");

            if (isClickable && "href" in s && s.href) {
              return (
                <Link
                  key={s.label}
                  href={s.href}
                  className={`${cardClassName} text-left w-full block`}
                  aria-label={`Open ${s.label}`}
                >
                  <div className="mb-3 flex items-center justify-between gap-2 sm:mb-4">
                    <span className="min-w-0 text-xs sm:text-sm font-bold text-gray-500 group-hover:text-[#2A4792] transition-colors underline-offset-2 group-hover:underline">
                      {s.label}
                    </span>
                    <div
                      className="h-9 w-9 shrink-0 rounded-xl flex items-center justify-center transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3 sm:h-10 sm:w-10"
                      style={{ backgroundColor: s.color + "14" }}
                    >
                      <s.icon className="h-5 w-5" style={{ color: s.color }} />
                    </div>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <p className="text-3xl sm:text-4xl font-black text-gray-900 tracking-tight group-hover:text-[#2A4792] transition-colors">
                      {s.value}
                    </p>
                  </div>
                
                </Link>
              );
            }

            if (isClickable) {
              return (
                <button
                  key={s.label}
                  type="button"
                  className={`${cardClassName} text-left w-full`}
                  onClick={() => setIsProfileViewsModalOpen(true)}
                  aria-label="Who viewed your profile"
                >
                  <div className="mb-3 flex items-center justify-between gap-2 sm:mb-4">
                    <span className="min-w-0 text-xs sm:text-sm font-bold text-gray-500 group-hover:text-[#2A4792] transition-colors underline-offset-2 group-hover:underline">
                      {s.label}
                    </span>
                    <div
                      className="h-9 w-9 shrink-0 rounded-xl flex items-center justify-center transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3 sm:h-10 sm:w-10"
                      style={{ backgroundColor: s.color + "14" }}
                    >
                      <s.icon className="h-5 w-5" style={{ color: s.color }} />
                    </div>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <p className="text-3xl sm:text-4xl font-black text-gray-900 tracking-tight group-hover:text-[#2A4792] transition-colors">
                      {s.value}
                    </p>
                  </div>
                  <p className="text-xs font-semibold text-gray-400 mt-1.5">
                    This month
                  </p>
                </button>
              );
            }

            return (
              <div key={s.label} className={cardClassName}>
                <div className="mb-3 flex items-center justify-between gap-2 sm:mb-4">
                  <span className="min-w-0 text-xs sm:text-sm font-bold text-gray-500 group-hover:text-gray-800 transition-colors">
                    {s.label}
                  </span>
                  <div
                    className="h-9 w-9 shrink-0 rounded-xl flex items-center justify-center transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3 sm:h-10 sm:w-10"
                    style={{ backgroundColor: s.color + "14" }}
                  >
                    <s.icon className="h-5 w-5" style={{ color: s.color }} />
                  </div>
                </div>
                <div className="flex items-baseline gap-2">
                  <p className="text-3xl sm:text-4xl font-black text-gray-900 tracking-tight">
                    {s.value}
                  </p>
                </div>
                <p className="text-xs font-semibold text-gray-400 mt-1.5">
                  This month
                </p>
              </div>
            );
          })}
        </div>
        {portalPrefix === "/user" && <OntapProgressCard />}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6">
          <div
            className="relative overflow-hidden rounded-3xl shadow-xl hover:shadow-2xl transition-shadow duration-500 group"
            style={{
              background: activeTheme.gradient,
              boxShadow: `0 24px 48px -12px ${activeTheme.accentSoft}, 0 8px 24px -8px rgba(15,23,42,0.35)`,
              minHeight: "360px",
            }}
          >
            <style>{`
              @keyframes digitalCardSlideIn {
                from { opacity: 0; transform: translateX(32px); }
                to { opacity: 1; transform: translateX(0); }
              }
            `}</style>
            <div
              className="absolute inset-0 pointer-events-none opacity-70"
              style={{ background: activeTheme.pattern }}
            />
            {[240, 360, 480].map((sz, i) => (
              <div
                key={i}
                className="absolute rounded-full pointer-events-none transition-transform duration-700 group-hover:scale-105"
                style={{
                  width: sz,
                  height: sz,
                  border: `1.5px solid ${activeTheme.accentSoft}`,
                  top: `${-(10 + i * 15)}%`,
                  right: `${-(5 + i * 10)}%`,
                }}
              />
            ))}
            <div
              className="absolute inset-0 pointer-events-none opacity-[0.35]"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 15% 85%, rgba(255,255,255,0.12) 0%, transparent 45%), radial-gradient(circle at 85% 15%, rgba(255,255,255,0.08) 0%, transparent 40%)",
              }}
            />

            <div
              key={cardSwitchKey}
              className="relative z-10 p-5 sm:p-8 flex flex-col h-full"
              style={{
                minHeight: "360px",
                animation: hasMultipleBizcards
                  ? "digitalCardSlideIn 0.55s ease-out"
                  : undefined,
              }}
            >
              <div className="flex items-center gap-4 mb-7">
                <div
                  className="h-[4.5rem] w-[4.5rem] rounded-full border-2 overflow-hidden flex items-center justify-center text-sm font-bold shrink-0 shadow-lg"
                  style={{
                    borderColor: activeTheme.accentSoft,
                    backgroundColor: activeTheme.accentSoft,
                    color: activeTheme.text,
                    boxShadow: `0 8px 24px ${activeTheme.accentSoft}`,
                  }}
                >
                  {selectedProfileImage ? (
                    <img
                      src={toServableMediaSrc(selectedProfileImage)}
                      width={64}
                      height={64}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                      alt=""
                      draggable={false}
                      decoding="async"
                    />
                  ) : (
                    initials
                  )}
                </div>
                <div className="min-w-0">
                  <p
                    className="font-extrabold text-base sm:text-lg leading-tight truncate tracking-tight"
                    style={{ color: activeTheme.text }}
                  >
                    {displayName}
                  </p>
                  <p
                    className="font-medium text-sm truncate mt-0.5"
                    style={{ color: activeTheme.textMuted }}
                  >
                    {role}
                  </p>
                  {selectedBizcardLabel &&
                    selectedBizcardLabel !== displayName && (
                      <p
                        className="font-medium text-[11px] truncate mt-1"
                        style={{ color: activeTheme.textMuted, opacity: 0.75 }}
                      >
                        {selectedBizcardLabel}
                      </p>
                    )}
                </div>
              </div>
              <div className="flex-1 flex items-center justify-center my-1">
                <div
                  className="rounded-2xl p-4 sm:p-5 shadow-2xl transform transition-all duration-500 hover:scale-[1.03] hover:-translate-y-0.5"
                  style={{
                    backgroundColor: "#ffffff",
                    boxShadow: `0 16px 40px rgba(15,23,42,0.18), 0 0 0 3px ${activeTheme.accentSoft}`,
                  }}
                >
                  {qrCodeDataUrl ? (
                    <img
                      src={qrCodeDataUrl}
                      alt={`QR code for ${alias || "portfolio"}`}
                      width={128}
                      height={128}
                      className="h-[7.5rem] w-[7.5rem] sm:h-32 sm:w-32 object-contain"
                      draggable={false}
                      decoding="async"
                    />
                  ) : selectedBizcard?.qr_code_url ? (
                    <img
                      src={selectedBizcard.qr_code_url}
                      alt="QR Code"
                      width={128}
                      height={128}
                      className="h-[7.5rem] w-[7.5rem] sm:h-32 sm:w-32 object-contain"
                      draggable={false}
                      decoding="async"
                    />
                  ) : dashboard?.qrCode ? (
                    <img
                      src={dashboard.qrCode}
                      alt="QR Code"
                      width={128}
                      height={128}
                      className="h-[7.5rem] w-[7.5rem] sm:h-32 sm:w-32 object-contain"
                      draggable={false}
                      decoding="async"
                    />
                  ) : (
                    <div className="h-[7.5rem] w-[7.5rem] sm:h-32 sm:w-32 flex items-center justify-center">
                      <InlineLoader />
                    </div>
                  )}
                </div>
              </div>
              {hasMultipleBizcards ? (
                <div className="mt-4 flex items-center justify-center gap-1.5">
                  {ownedBizcards.map((card, idx) => (
                    <button
                      key={card.bizcard_id}
                      type="button"
                      onClick={() => selectBizcardIndex(idx)}
                      className={`h-1.5 rounded-full transition-all duration-300 ${
                        idx === selectedBizcardIndex ? "w-5" : "w-1.5 opacity-50"
                      }`}
                      style={{ backgroundColor: activeTheme.text }}
                      aria-label={`Show BizCard ${idx + 1}`}
                    />
                  ))}
                </div>
              ) : null}
              <div className="mt-7">
               
                <div className="flex gap-3">
                  <Link
                    href={publicAliasHref}
                    className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold transition-all hover:brightness-110 active:scale-[0.98] border backdrop-blur-sm"
                    style={{
                      color: activeTheme.text,
                      backgroundColor: activeTheme.glass,
                      borderColor: activeTheme.accentSoft,
                    }}
                  >
                    View Card <ExternalLink className="h-4 w-4 opacity-80" />
                  </Link>
                  <Link
                    href={activeBizcardEditorHref}
                    className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold text-white transition-all hover:brightness-110 active:scale-[0.98] shadow-lg"
                    style={{
                      backgroundColor: activeTheme.accent,
                      boxShadow: `0 10px 24px ${activeTheme.accentSoft}`,
                    }}
                  >
                    Edit Card
                  </Link>
                </div>
              </div>
            </div>
          </div>
          
          <div className="bg-white border border-gray-100 rounded-3xl shadow-sm hover:shadow-md flex flex-col overflow-hidden min-h-0 transition-shadow duration-300">
            <div className="px-4 py-4 border-b border-gray-50 sm:px-6 sm:pt-6 sm:pb-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-extrabold text-gray-900 tracking-tight">
                      Bizcard Info
                    </h3>
                    {hasMultipleBizcards ? (
                      <span className="rounded-full bg-[#F0F5F9] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#2A4792]">
                        {selectedBizcardIndex + 1} of {ownedBizcards.length}
                      </span>
                    ) : null}
                  </div>
                  {selectedBizcardLabel ? (
                    <p className="mt-1 text-sm font-semibold text-gray-700 truncate">
                      {selectedBizcardLabel}
                    </p>
                  ) : null}
                  {loading ? (
                    <p className="text-sm text-gray-400 mt-1.5 flex items-center gap-2 font-medium">
                      <InlineLoader /> Loading
                      progress…
                    </p>
                  ) : (
                    <p className="text-sm text-gray-500 mt-1.5 font-medium">
                      {pct === 100 ? (
                        "Everything's in place"
                      ) : (
                        <>
                          <span className="text-[#2A4792] font-bold">
                            {pending.length}
                          </span>{" "}
                          field{pending.length !== 1 ? "s" : ""} still needed
                        </>
                      )}
                    </p>
                  )}
                  {pct < 100 && (
                    <div className="mt-3 h-2 bg-gray-100 rounded-full w-full max-w-[200px] overflow-hidden shadow-inner">
                      <div
                        className="h-full rounded-full transition-all duration-1000 ease-out"
                        style={{
                          width: `${pct}%`,
                          background: "linear-gradient(90deg,#2A4792,#4785B8)",
                        }}
                      />
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  {hasMultipleBizcards ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => selectBizcardIndex(selectedBizcardIndex - 1)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                        aria-label="Previous BizCard info"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => selectBizcardIndex(selectedBizcardIndex + 1)}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-bold text-[#2A4792] hover:bg-[#F0F5F9]"
                        aria-label="Next BizCard info"
                      >
                        Next
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : null}
                  <div className="relative shrink-0 bg-[#F8FAFC] rounded-full p-1.5 shadow-inner">
                    <ProgressRing pct={pct} accent="#2A4792" />
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-black text-[#2A4792] leading-none tracking-tighter">
                        {pct}
                      </span>
                      <span className="text-[10px] font-bold text-[#4785B8] -mt-0.5">
                        %
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          
            <div
              key={`info-${cardSwitchKey}`}
              className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-thin px-4 py-4 animate-fade-in-up ${showCompletedIdCard
                  ? "flex items-center justify-center min-h-[220px] sm:min-h-[260px]"
                  : "max-h-[280px]"
                }`}
            >
              {showCompletedIdCard ? (
                <div className="animate-fade-in-up w-full max-w-sm mx-auto text-center px-2 py-6">
                  <div
                    className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl"
                    style={{
                      background:
                        "linear-gradient(135deg,#2A4792 0%,#4785B8 100%)",
                      boxShadow: "0 12px 28px -10px rgba(42,71,146,0.45)",
                    }}
                  >
                    <Sparkles className="h-7 w-7 text-white" aria-hidden />
                  </div>
                  <p className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Profile complete
                  </p>
                  <h4 className="mt-4 text-xl sm:text-2xl font-extrabold text-gray-900 tracking-tight leading-snug">
                    You are now ready to showcase your portfolio.
                  </h4>
                  <p className="mt-3 text-sm text-gray-500 font-medium leading-relaxed">
                    Share your QR or portfolio link and make a lasting first impression.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {FIELD_LABELS.map(({ key, label }) => {
                    const done = mergedFields ? mergedFields[key] : false;
                    const servicePreview =
                      key === "services" ? resolvedServices.slice(0, 2) : [];
                    return (
                      <Link
                        key={key}
                        href={`${activeBizcardEditorHref}?tab=${FIELD_EDITOR_TABS[key]}&focus=${key}`}
                        className={`group flex items-center justify-between gap-2 px-3 py-3 rounded-2xl transition-all duration-200 sm:px-4 ${done ? "bg-emerald-50/50 border border-transparent hover:bg-emerald-50 hover:border-emerald-100/50" : "bg-[#F8FAFC] border border-gray-100 hover:border-[#4785B8]/30 hover:bg-[#F0F5F9]"}`}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                          {done ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                          ) : (
                            <div className="h-4 w-4 rounded-full border-[1.5px] border-gray-300 shrink-0 group-hover:border-[#4785B8] transition-colors" />
                          )}
                          <div className="min-w-0">
                            <span
                              className={`text-sm font-semibold transition-colors ${done ? "text-gray-500" : "text-gray-800 group-hover:text-[#2A4792]"}`}
                            >
                              {label}
                            </span>
                            {servicePreview.length > 0 && (
                              <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                                {servicePreview.map((service, index) => (
                                  <div
                                    key={`${service.title}-${index}`}
                                    className="flex items-center gap-1.5 min-w-0"
                                  >
                                    {service.imageUrl ? (
                                      <img
                                        src={service.imageUrl}
                                        alt=""
                                        width={24}
                                        height={24}
                                        className="h-6 w-6 rounded-md object-cover border border-gray-100 shrink-0"
                                        draggable={false}
                                        decoding="async"
                                        loading="lazy"
                                      />
                                    ) : (
                                      <div className="h-6 w-6 rounded-md bg-[#4785B8]/10 shrink-0" />
                                    )}
                                    <span className="text-[11px] font-medium text-gray-500 truncate max-w-[88px]">
                                      {service.title}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        <span
                          className={`shrink-0 whitespace-nowrap text-[10px] uppercase tracking-wider font-extrabold px-2 py-1 rounded-full transition-colors sm:px-2.5 ${done
                              ? "text-emerald-600 bg-emerald-100/80"
                              : "text-gray-400 bg-gray-100 group-hover:text-[#4785B8] group-hover:bg-[#4785B8]/10"
                            }`}
                        >
                          {done ? "Done" : "Needed"}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="p-3 border-t border-gray-50 bg-gray-50/30 sm:p-5">
              <BizCardInfoActions
                onDownloadDigitalCard={handleOpenDigitalCardModal}
                onShare={() => {
                  void handleSharePortfolio();
                }}
                onChecklist={() => setBizCardDetailsView("checklist")}
                downloadDisabled={!digitalCardData}
                shareDisabled={!portfolioCopyUrl}
                checklistActive={bizCardDetailsView === "checklist"}
              />
            </div>
          </div>
        </div>
        {/* ── Recent Inquiries + Activity ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6">
          <div className="bg-white border border-gray-100 rounded-3xl p-4 shadow-sm hover:shadow-md transition-shadow duration-300 flex flex-col sm:p-6">
            <h3 className="text-lg font-extrabold text-gray-900 mb-5 flex items-center gap-2.5 tracking-tight">
              <div className="h-8 w-8 rounded-lg bg-[#4785B8]/10 flex items-center justify-center">
                <Mail className="h-4 w-4 text-[#4785B8]" />
              </div>
              Recent Inquiries
            </h3>
            <div
              className="flex-1 space-y-2 overflow-y-auto scrollbar-thin pr-1"
              style={{ maxHeight: "250px" }}
            >
              {loading ? (
                <div className="flex items-center justify-center py-10 h-full">
                  <InlineLoader />
                </div>
              ) : inquiries.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 h-full text-center">
                  <div className="h-12 w-12 rounded-full bg-gray-50 flex items-center justify-center mb-3">
                    <Mail className="h-5 w-5 text-gray-300" />
                  </div>
                  <p className="text-sm font-semibold text-gray-500">
                    No inquiries yet
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    When visitors contact you, they'll appear here.
                  </p>
                </div>
              ) : (
                inquiries.map((inq) => (
                  <Link
                    key={inq.inquiryId}
                    href={`${inquiryHref}?id=${encodeURIComponent(inq.inquiryId)}`}
                    className="group flex items-start gap-4 p-3.5 rounded-2xl hover:bg-[#F8FAFC] border border-transparent hover:border-gray-100 transition-all duration-200 cursor-pointer"
                  >
                    <div className="h-10 w-10 rounded-full bg-gradient-to-br from-[#2A4792]/10 to-[#4785B8]/10 flex items-center justify-center shrink-0 border border-[#4785B8]/10 group-hover:scale-105 transition-transform">
                      <span className="text-sm font-extrabold text-[#2A4792]">
                        {inq.visitorName?.[0] ?? "?"}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p className="text-sm font-bold text-gray-900 truncate group-hover:text-[#2A4792] transition-colors">
                        {inq.visitorName}
                      </p>
                      <p className="text-xs font-medium text-gray-500 mt-0.5 truncate">
                        {inq.subject}
                      </p>
                    </div>
                    <span className="text-[10px] font-bold tracking-wide text-gray-400 bg-white border border-gray-100 shadow-sm px-2.5 py-1 rounded-full shrink-0 group-hover:border-gray-200 group-hover:text-gray-500 transition-colors">
                      {new Date(inq.createdAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </Link>
                ))
              )}
            </div>
          </div>
          <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm hover:shadow-md transition-shadow duration-300 flex flex-col">
            <h3 className="text-lg font-extrabold text-gray-900 mb-5 flex items-center gap-2.5 tracking-tight">
              <div className="h-8 w-8 rounded-lg bg-[#2A4792]/10 flex items-center justify-center">
                <BookmarkCheck className="h-4 w-4 text-[#2A4792]" />
              </div>
              Recent Activity
            </h3>
            <div
              className="flex-1 space-y-2 overflow-y-auto scrollbar-thin pr-1"
              style={{ maxHeight: "250px" }}
            >
              {activityLoading && recentActivity.length === 0 ? (
                <div className="flex items-center justify-center py-10 h-full">
                  <InlineLoader />
                </div>
              ) : recentActivity.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 h-full text-center">
                  <div className="h-12 w-12 rounded-full bg-gray-50 flex items-center justify-center mb-3">
                    <BookmarkCheck className="h-5 w-5 text-gray-300" />
                  </div>
                  <p className="text-sm font-semibold text-gray-500">
                    No recent activity
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Your latest actions will be listed here.
                  </p>
                </div>
              ) : (
                recentActivity.map((item) => {
                  const href = activityHref(item);
                  const opensViews = item.activityType === "PROFILE_VIEW" || item.activityType === "NEW_SCAN";
                  const className =
                    "group flex items-start gap-3 p-3.5 rounded-2xl border border-transparent hover:bg-[#F8FAFC] hover:border-gray-100 transition-all duration-200 w-full text-left";
                  const body = (
                    <>
                      <div className="h-10 w-10 rounded-full bg-[#2A4792]/10 flex items-center justify-center shrink-0">
                        <BookmarkCheck className="h-4 w-4 text-[#2A4792]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-gray-900 group-hover:text-[#2A4792]">
                          {formatActivityMessage(item)}
                        </p>
                        <p className="text-[11px] font-semibold text-gray-400 mt-0.5">
                          {formatActivityTime(item.createdAt)}
                        </p>
                      </div>
                    </>
                  );
                  if (href) {
                    return (
                      <Link key={item.id} href={href} className={className}>
                        {body}
                      </Link>
                    );
                  }
                  if (opensViews) {
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={className}
                        onClick={() => setIsProfileViewsModalOpen(true)}
                      >
                        {body}
                      </button>
                    );
                  }
                  return (
                    <div key={item.id} className={className}>
                      {body}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
      {isSetupCompanyOpen && (
        <ModalPortal isOpen={isSetupCompanyOpen} onClose={closeSetupCompanyModal}>
          <div className="flex w-full max-w-5xl max-h-[min(92vh,880px)] flex-col overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-2xl shadow-black/20 animate-fade-in-up">
            <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-6 py-5 sm:px-8">
              <h3 className="text-2xl font-extrabold text-gray-900 tracking-tight">
                Setup Company
              </h3>
              <button
                type="button"
                onClick={closeSetupCompanyModal}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gray-50 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
                aria-label="Close setup company modal"
              >
                <span className="text-2xl leading-none">×</span>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="grid grid-cols-1 md:grid-cols-2">
              <div className="space-y-5 border-b border-gray-100 px-6 py-6 sm:px-8 md:border-b-0 md:border-r bg-gray-50/30">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-gray-700">
                    Company name
                  </label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(event) => {
                      setCompanyName(event.target.value);
                      setCompanyFormErrors((prev) => ({
                        ...prev,
                        companyName: undefined,
                      }));
                    }}
                    placeholder="e.g. Acme Corporation"
                    className={`h-11 w-full rounded-lg border px-3 text-sm text-gray-700 outline-none transition-colors focus:border-primary ${companyFormErrors.companyName
                        ? "border-rose-300"
                        : "border-gray-200"
                      }`}
                  />
                  {companyFormErrors.companyName && (
                    <p className="text-xs font-semibold text-rose-600">
                      {companyFormErrors.companyName}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-gray-700">
                    Company email
                  </label>
                  <input
                    type="email"
                    value={companyEmail}
                    onChange={(event) => {
                      setCompanyEmail(event.target.value);
                      setCompanyFormErrors((prev) => ({
                        ...prev,
                        companyEmail: undefined,
                      }));
                    }}
                    placeholder="hello@acme.com"
                    className={`h-11 w-full rounded-lg border px-3 text-sm text-gray-700 outline-none transition-colors focus:border-primary ${companyFormErrors.companyEmail
                        ? "border-rose-300"
                        : "border-gray-200"
                      }`}
                  />
                  {companyFormErrors.companyEmail && (
                    <p className="text-xs font-semibold text-rose-600">
                      {companyFormErrors.companyEmail}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-gray-700">
                    Company phone
                  </label>
                  <input
                    type="tel"
                    value={companyPhone}
                    onChange={(event) => {
                      setCompanyPhone(event.target.value);
                      setCompanyFormErrors((prev) => ({
                        ...prev,
                        companyPhone: undefined,
                      }));
                    }}
                    placeholder="+1 555 123 4567"
                    className={`h-11 w-full rounded-lg border px-3 text-sm text-gray-700 outline-none transition-colors focus:border-primary ${companyFormErrors.companyPhone
                        ? "border-rose-300"
                        : "border-gray-200"
                      }`}
                  />
                  {companyFormErrors.companyPhone && (
                    <p className="text-xs font-semibold text-rose-600">
                      {companyFormErrors.companyPhone}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-gray-700">
                    Industry
                  </label>
                  <input
                    type="text"
                    value={companyIndustry}
                    onChange={(event) => {
                      setCompanyIndustry(event.target.value);
                      setCompanyFormErrors((prev) => ({
                        ...prev,
                        companyIndustry: undefined,
                      }));
                    }}
                    placeholder="e.g. SaaS, Real Estate, Retail"
                    className={`h-11 w-full rounded-lg border px-3 text-sm text-gray-700 outline-none transition-colors focus:border-primary ${companyFormErrors.companyIndustry
                        ? "border-rose-300"
                        : "border-gray-200"
                      }`}
                  />
                  {companyFormErrors.companyIndustry && (
                    <p className="text-xs font-semibold text-rose-600">
                      {companyFormErrors.companyIndustry}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-gray-700">
                    Company address
                  </label>
                  <textarea
                    value={companyAddress}
                    onChange={(event) => {
                      setCompanyAddress(event.target.value);
                      setCompanyFormErrors((prev) => ({
                        ...prev,
                        companyAddress: undefined,
                      }));
                    }}
                    placeholder="123 Business Way, Suite 100"
                    rows={3}
                    className={`w-full rounded-lg border px-3 py-2.5 text-sm text-gray-700 outline-none transition-colors focus:border-primary ${companyFormErrors.companyAddress
                        ? "border-rose-300"
                        : "border-gray-200"
                      }`}
                  />
                  {companyFormErrors.companyAddress && (
                    <p className="text-xs font-semibold text-rose-600">
                      {companyFormErrors.companyAddress}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-gray-700">
                    Describe your company
                  </label>
                  <textarea
                    value={companyDescription}
                    onChange={(event) => {
                      setCompanyDescription(event.target.value);
                      setCompanyFormErrors((prev) => ({
                        ...prev,
                        companyDescription: undefined,
                      }));
                    }}
                    placeholder="Briefly tell us what your business does..."
                    rows={5}
                    className={`w-full rounded-lg border px-3 py-2.5 text-sm text-gray-700 outline-none transition-colors focus:border-primary ${companyFormErrors.companyDescription
                        ? "border-rose-300"
                        : "border-gray-200"
                      }`}
                  />
                  {companyFormErrors.companyDescription && (
                    <p className="text-xs font-semibold text-rose-600">
                      {companyFormErrors.companyDescription}
                    </p>
                  )}
                </div>
              </div>
              <div className="space-y-5 px-6 py-6 sm:px-8">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-gray-700">
                    Company logo (optional)
                  </label>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                    onChange={handleCompanyLogoUpload}
                    className={`block h-11 w-full cursor-pointer rounded-lg border px-3 py-2 text-sm text-gray-700 outline-none transition-colors file:mr-4 file:rounded-md file:border-0 file:bg-[#f4f7fb] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-gray-700 hover:file:bg-[#e9eef7] focus:border-primary ${companyFormErrors.companyLogoUrl
                        ? "border-rose-300"
                        : "border-gray-200"
                      }`}
                  />
                  {companyFormErrors.companyLogoUrl && (
                    <p className="text-xs font-semibold text-rose-600">
                      {companyFormErrors.companyLogoUrl}
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <label className="text-sm font-semibold text-gray-700">
                    Invite employees (optional)
                  </label>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-sm font-semibold text-[#2DA3E6] hover:underline"
                  >
                    <Scan className="h-3.5 w-3.5" />
                    Scan card
                  </button>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative flex-1">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={inviteDraft}
                      onChange={(event) => {
                        setInviteDraft(event.target.value);
                        if (inviteError) setInviteError("");
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          handleAddInvitees();
                        }
                      }}
                      placeholder="Enter their email address"
                      className="h-11 w-full rounded-lg border border-gray-200 pl-10 pr-3 text-sm text-gray-700 outline-none transition-colors focus:border-primary"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleAddInvitees}
                    className="inline-flex h-11 items-center justify-center gap-1 rounded-lg bg-[#2DA3E6] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1f94d8]"
                  >
                    <span className="text-base leading-none">+</span>
                    Add
                  </button>
                </div>
                {inviteError && (
                  <p className="text-xs font-semibold text-red-600">
                    {inviteError}
                  </p>
                )}
                <div className="space-y-2">
                  <p className="text-sm font-bold tracking-wide text-gray-600">
                    LIST OF USERS ({companyUsers.length})
                  </p>
                  <div className="space-y-2">
                    {companyUsers.map((user) => (
                      <div
                        key={user.id}
                        className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2.5"
                      >
                        <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e9f2ff] text-xs font-bold text-primary">
                          {initialsFromName(user.name)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-lg font-semibold leading-tight text-gray-800">
                            {user.name}
                          </p>
                          <p className="truncate text-sm text-gray-500">
                            {user.email}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            </div>
            <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-gray-100 bg-gray-50/50 px-6 py-5 sm:flex-row sm:items-center sm:justify-end sm:px-8">
              <button
                type="button"
                onClick={closeSetupCompanyModal}
                className="h-11 rounded-xl border border-gray-200 bg-white px-6 text-sm font-bold text-gray-700 shadow-sm transition-all hover:bg-gray-50 active:scale-95"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCompleteSetupCompany}
                disabled={companySubmitting}
                className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl px-6 text-sm font-bold text-white shadow-md transition-all hover:shadow-lg active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 ${companySubmitting
                    ? "bg-gray-400"
                    : "bg-[#2A4792] hover:bg-[#1a3375]"
                  }`}
              >
                {companySubmitting ? (
                  <>
                    <InlineLoader className="text-white" />
                    Submitting...
                  </>
                ) : (
                  "Setup Company"
                )}
              </button>
            </div>
          </div>
        </ModalPortal>
      )}
      <ModalPortal isOpen={isUpgradeModalOpen} onClose={() => setIsUpgradeModalOpen(false)}>
        <div
          className="w-full max-w-md rounded-3xl border border-gray-100 bg-white shadow-2xl shadow-black/20 p-6 px-3 py-6 sm:px-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="upgrade-required-title"
          aria-describedby="upgrade-required-description"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3
                id="upgrade-required-title"
                className="text-xl font-extrabold text-gray-900"
              >
                Subscription Upgrade Required
              </h3>
              <p
                id="upgrade-required-description"
                className="mt-3 text-sm leading-6 text-gray-600"
              >
                You need a Standard or Premium subscription to create a
                company. Upgrade now to unlock this feature.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsUpgradeModalOpen(false)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-gray-50 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
              aria-label="Close upgrade required modal"
            >
              <span className="text-2xl leading-none">×</span>
            </button>
          </div>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => router.push(emarketSubscriptionHref)}
              ref={upgradeModalGoToMarketButtonRef}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-[#2A4792] px-5 text-sm font-bold text-white transition-colors hover:bg-[#1a3375]"
            >
              Go to e-market
            </button>
            <button
              type="button"
              onClick={() => setIsUpgradeModalOpen(false)}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-gray-200 bg-white px-5 text-sm font-bold text-gray-700 transition-colors hover:bg-gray-50"
            >
              Go back
            </button>
          </div>
        </div>
      </ModalPortal>
      <JoinCompanyModal
        open={isJoinCompanyOpen}
        onClose={() => setIsJoinCompanyOpen(false)}
        onSuccess={handleJoinCompanySuccess}
        apiBase={API_BASE_URL}
      />
      <ProfileViewsModal
        isOpen={isProfileViewsModalOpen}
        onClose={() => setIsProfileViewsModalOpen(false)}
      />
      <DigitalBizCardModal
        isOpen={digitalCardModalOpen}
        onClose={() => setDigitalCardModalOpen(false)}
        data={digitalCardData}
        theme={digitalCardTheme}
      />
    </div>
  );
}
