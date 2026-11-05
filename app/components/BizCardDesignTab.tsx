"use client";

/**
 * BizCardDesignTab.tsx
 * ────────────────────
 * Card Design tab for the template family picker.
 * One card is shown per template family, and each card exposes
 * palette buttons for the color themes inside that family.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, Eye, Lock, MessageCircle, Palette, X } from "lucide-react";
import type {
  BizCardFormData,
  VCardFormData,
  ServiceItem,
  GalleryItem,
  VideoItem,
  PortfolioData,
} from "../types";
import PortfolioPreviewFrame from "./PortfolioPreviewFrame";
import {ModalPortal} from "./ModalPortal";
import {
  THEME_FAMILIES,
  getTheme,
  type ThemeFamilyDef,
} from "./BizCardPreview";
import { normalizePortfolioThemeId } from "../themes/ThemeLoader";
import { getFrontendApiBaseUrl } from "./apiBase";
import { buildImpersonationHeaders } from "@/app/lib/superadminImpersonationHandoff";
import { buildCompanyActingHeaders } from "@/app/lib/companyEmployeeActingHandoff";
import {
  publishBizcardThemeToCache,
  persistThemePath,
} from "../lib/bizcardThemeSync";
import { showConfirmDialog } from "./ConfirmDialog";
import { HITACHI_THEME_FAMILY_ID } from "@/lib/constants/hitachi-companies";
import { prioritizeSelectedThemeFamily, prioritizeSelectedThemeIds } from "@/lib/constants/theme-families";
import { InlineLoader, SectionLoader } from "./Loader";
import { showToast } from "./Toast";
import { companyAdminApiRequest } from "@/app/admin/lib/companyAdminApi";
import ConnectionMessengerPanel from "./messaging/ConnectionMessengerPanel";

const API = getFrontendApiBaseUrl();
const THEME_REQUEST_DRAFT =
  "Hi, I'd like to request a theme change for our company bizcards.";
const CSRF_COOKIE_NAME = "csrf-token";

async function fetchOwnedPaidThemePaths(): Promise<Set<string>> {
  try {
    const response = await fetch(
      `${API}/api/marketplace/templates?owned_only=true&category=customize-templates&limit=50`,
      { credentials: "include", cache: "no-store", headers: { ...buildImpersonationHeaders(), ...buildCompanyActingHeaders() } },
    );
    if (!response.ok) return new Set();
    const payload = await response.json().catch(() => null);
    const templates = Array.isArray(payload?.data?.templates)
      ? (payload.data.templates as Array<Record<string, unknown>>)
      : [];
    return new Set(
      templates
        .map((template) => String(template.themePath ?? template.theme_path ?? "").trim())
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const cookies = document.cookie ? document.cookie.split("; ") : [];
  for (const cookie of cookies) {
    const [rawKey, ...rest] = cookie.split("=");
    const key = decodeURIComponent(rawKey || "").trim();
    if (key !== name) continue;
    return decodeURIComponent(rest.join("=") || "").trim() || null;
  }
  return null;
}

async function ensureCsrfToken(): Promise<string | null> {
  const fromCookie = readCookie(CSRF_COOKIE_NAME);
  if (fromCookie) return fromCookie;

  try {
    const response = await fetch(`${API}/api/csrf-token`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return readCookie(CSRF_COOKIE_NAME);
    const payload = (await response.json()) as Record<string, unknown>;
    const data =
      payload.data && typeof payload.data === "object"
        ? (payload.data as Record<string, unknown>)
        : null;
    const token =
      (typeof payload.csrfToken === "string" && payload.csrfToken) ||
      (typeof payload.csrf_token === "string" && payload.csrf_token) ||
      (typeof payload.token === "string" && payload.token) ||
      (data && typeof data.csrfToken === "string" ? data.csrfToken : null);
    return token?.trim() || readCookie(CSRF_COOKIE_NAME);
  } catch {
    return readCookie(CSRF_COOKIE_NAME);
  }
}


function publishThemeToLocalCache(urlAlias: string, themeId: string): void {
  publishBizcardThemeToCache({ urlAlias, themeId });
}

async function fetchCompanyThemePolicy(): Promise<{
  managedByCompany: boolean;
  companyTheme: string | null;
  isHitachiCompany: boolean;
  isHitachiCompanyAdmin: boolean;
  canChangeCompanyTheme: boolean;
  isPrimaryAdmin: boolean;
  primaryAdminUserId: string | null;
  primaryAdminName: string | null;
  primaryAdminAvatarUrl: string | null;
}> {
  const empty = {
    managedByCompany: false,
    companyTheme: null,
    isHitachiCompany: false,
    isHitachiCompanyAdmin: false,
    canChangeCompanyTheme: false,
    isPrimaryAdmin: false,
    primaryAdminUserId: null,
    primaryAdminName: null,
    primaryAdminAvatarUrl: null,
  };
  try {
    const response = await fetch(`${API}/api/user/company-theme-policy`, {
      credentials: "include",
      cache: "no-store",
      headers: { ...buildImpersonationHeaders(), ...buildCompanyActingHeaders() },
    });
    if (!response.ok) return empty;
    const payload = await response.json();
    const data = (payload?.data ?? payload) as Record<string, unknown>;
    return {
      managedByCompany: data.managed_by_company === true,
      companyTheme:
        typeof data.company_theme === "string" ? data.company_theme : null,
      isHitachiCompany: data.is_hitachi_company === true,
      isHitachiCompanyAdmin: data.is_hitachi_company_admin === true,
      canChangeCompanyTheme: data.can_change_company_theme === true,
      isPrimaryAdmin: data.is_primary_admin === true,
      primaryAdminUserId:
        typeof data.primary_admin_user_id === "string"
          ? data.primary_admin_user_id
          : null,
      primaryAdminName:
        typeof data.primary_admin_name === "string"
          ? data.primary_admin_name
          : null,
      primaryAdminAvatarUrl:
        typeof data.primary_admin_avatar_url === "string"
          ? data.primary_admin_avatar_url
          : null,
    };
  } catch {
    return empty;
  }
}



export interface DesignTabProps {
  bizCard: BizCardFormData;
  setBizCard: React.Dispatch<React.SetStateAction<BizCardFormData>>;
  vcard: VCardFormData;
  services: ServiceItem[];
  gallery: GalleryItem[];
  videos: VideoItem[];
  selectedTheme: string;
  setSelectedTheme: React.Dispatch<React.SetStateAction<string>>;
  onThemeSelect?: (themeId: string) => void;
  subscriptionTier?: string;
  isDevUser?: boolean;
}

// Use tier ordering from THEME_FAMILIES definition
const TIER_ORDER: Record<string, number> = {
  basic: 0,
  standard: 1,
  premium: 2,
  enterprise: 3,
};

/** All families accessible to a basic subscriber (tier === 'basic') */
const BASIC_ACCESSIBLE_TIERS = new Set(["basic"]);
/** All families accessible to standard+ subscribers */
const STANDARD_ACCESSIBLE_TIERS = new Set(["basic", "standard"]);
/** All families accessible to premium+ subscribers */
const PREMIUM_ACCESSIBLE_TIERS = new Set(["basic", "standard", "premium"]);

type SubscriptionTier = "basic" | "standard" | "premium";

function normalizeSubscriptionTier(value: unknown): SubscriptionTier {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (raw === "premium") return "premium";
  if (raw === "standard") return "standard";
  return "basic";
}

export default function DesignTab({
  bizCard,
  setBizCard: _setBizCard,
  vcard,
  services,
  gallery,
  videos,
  selectedTheme,
  setSelectedTheme,
  onThemeSelect,
  subscriptionTier,
  isDevUser = false,
}: DesignTabProps) {
  const [previewModal, setPreviewModal] = useState<string | null>(null);
  const [companyThemeManaged, setCompanyThemeManaged] = useState(false);
  const [companyTheme, setCompanyTheme] = useState<string | null>(null);
  const [canChangeCompanyTheme, setCanChangeCompanyTheme] = useState(false);
  const [primaryAdminUserId, setPrimaryAdminUserId] = useState<string | null>(null);
  const [primaryAdminName, setPrimaryAdminName] = useState<string | null>(null);
  const [isHitachiCompany, setIsHitachiCompany] = useState(false);
  const [ownedPaidThemePaths, setOwnedPaidThemePaths] = useState<Set<string>>(new Set());
  const [themeDataReady, setThemeDataReady] = useState(false);
  const [savingCompanyTheme, setSavingCompanyTheme] = useState(false);
  const [messagingOpen, setMessagingOpen] = useState(false);
  const [messagingBusy, setMessagingBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchCompanyThemePolicy().then((policy) => {
        if (cancelled) return;
        setCompanyThemeManaged(policy.managedByCompany);
        setCompanyTheme(policy.companyTheme);
        setCanChangeCompanyTheme(policy.canChangeCompanyTheme);
        setPrimaryAdminUserId(policy.primaryAdminUserId);
        setPrimaryAdminName(policy.primaryAdminName);
        setIsHitachiCompany(policy.isHitachiCompany);
        if (policy.managedByCompany && policy.companyTheme) {
          const normalized = normalizePortfolioThemeId(policy.companyTheme) || policy.companyTheme;
          setSelectedTheme(normalized);
          if (bizCard.urlAlias) {
            publishBizcardThemeToCache({
              urlAlias: bizCard.urlAlias,
              themeId: normalized,
            });
          }
        }
      }),
      fetchOwnedPaidThemePaths().then((owned) => {
        if (!cancelled) setOwnedPaidThemePaths(owned);
      }),
    ]).finally(() => {
      if (!cancelled) setThemeDataReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [bizCard.urlAlias, setSelectedTheme]);

  // Employees / non-primary members: read-only. Primary admin: can edit company theme.
  const themeSelectionLocked = companyThemeManaged && !canChangeCompanyTheme;
  const showAdminHelper = companyThemeManaged && canChangeCompanyTheme;
  const showEmployeeNotice = themeSelectionLocked;

  const effectiveSubscriptionTier = useMemo(
    () => normalizeSubscriptionTier(subscriptionTier),
    [subscriptionTier],
  );

  const visibleFamilies = useMemo(() => {
    const accessibleTiers = isDevUser
      ? null // null means all tiers
      : effectiveSubscriptionTier === "premium"
        ? PREMIUM_ACCESSIBLE_TIERS
        : effectiveSubscriptionTier === "standard"
          ? STANDARD_ACCESSIBLE_TIERS
          : BASIC_ACCESSIBLE_TIERS;

    const tierFiltered = THEME_FAMILIES.filter((family) => {
      if (family.id === HITACHI_THEME_FAMILY_ID) return false; // handled separately
      if (family.id.startsWith("paidthemes/")) {
        // Purchased E-Market templates unlock here after payment.
        return family.themeIds.some((themeId) => ownedPaidThemePaths.has(themeId));
      }
      if (accessibleTiers === null) return true;
      return accessibleTiers.has(family.tier);
    });

    // Sort by tier order so basic → standard → premium always
    const sorted = [...tierFiltered].sort(
      (a, b) => (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99),
    );

    if (!isHitachiCompany) return prioritizeSelectedThemeFamily(sorted, selectedTheme);

    const hitachiFamily = THEME_FAMILIES.find((f) => f.id === HITACHI_THEME_FAMILY_ID);
    if (!hitachiFamily) return prioritizeSelectedThemeFamily(sorted, selectedTheme);
    return prioritizeSelectedThemeFamily([...sorted, hitachiFamily], selectedTheme);
  }, [effectiveSubscriptionTier, isDevUser, isHitachiCompany, ownedPaidThemePaths, selectedTheme]);

  const showUpgradeBanner =
    !isDevUser &&
    THEME_FAMILIES.filter((f) => f.tier !== "enterprise" && !f.id.startsWith("paidthemes/")).length >
      visibleFamilies.filter((f) => f.tier !== "enterprise").length;

  const portfolioData = useMemo<PortfolioData>(
    () => ({
      bizCard,
      vcard,
      services,
      selectedTheme,
      gallery,
      videos,
    }),
    [bizCard, vcard, services, selectedTheme, gallery, videos],
  );

  const saveCompanyTheme = useCallback(async (themeId: string) => {
    setSavingCompanyTheme(true);
    try {
      await companyAdminApiRequest("/api/company/theme", {
        method: "PUT",
        body: JSON.stringify({ company_theme: themeId }),
      });
      setCompanyTheme(themeId);
      showToast(
        "Company theme updated. Changes apply to the entire company.",
        "success",
      );
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Failed to save company theme.",
        "error",
      );
      throw error;
    } finally {
      setSavingCompanyTheme(false);
    }
  }, []);

  const handleThemeSelect = useCallback(
    async (themeId: string) => {
      if (themeSelectionLocked || savingCompanyTheme) return;

      const normalizedTheme = normalizePortfolioThemeId(themeId);
      if (!normalizedTheme) return;

      const current =
        normalizePortfolioThemeId(selectedTheme) || selectedTheme.trim();
      if (normalizedTheme !== current) {
        const themeName = getTheme(normalizedTheme)?.name ?? normalizedTheme;
        const confirmed = await showConfirmDialog({
          title: canChangeCompanyTheme
            ? "Apply company theme"
            : "Apply theme",
          message: canChangeCompanyTheme
            ? `Apply "${themeName}" as the company theme? This updates the theme for the entire company.`
            : `Apply "${themeName}" to your bizcard portfolio?`,
          confirmLabel: canChangeCompanyTheme
            ? "Apply company theme"
            : "Apply theme",
          cancelLabel: "Cancel",
          variant: canChangeCompanyTheme ? "warning" : "primary",
        });
        if (!confirmed) return;
      }

      setSelectedTheme(normalizedTheme);
      publishThemeToLocalCache(bizCard.urlAlias, normalizedTheme);

      if (canChangeCompanyTheme) {
        try {
          await saveCompanyTheme(normalizedTheme);
        } catch {
          setSelectedTheme(selectedTheme);
          if (bizCard.urlAlias && current) {
            publishThemeToLocalCache(bizCard.urlAlias, current);
          }
        }
        return;
      }

      onThemeSelect?.(normalizedTheme);
      void persistThemePath(normalizedTheme).catch((error) => {
        console.error(
          "[BizCardDesignTab] Failed to persist theme selection:",
          error,
        );
      });
    },
    [
      bizCard.urlAlias,
      canChangeCompanyTheme,
      onThemeSelect,
      saveCompanyTheme,
      savingCompanyTheme,
      selectedTheme,
      setSelectedTheme,
      themeSelectionLocked,
    ],
  );

  const handleCardClick = useCallback(
    (themeId: string) => {
      if (themeSelectionLocked || savingCompanyTheme) return;
      setPreviewModal(themeId);
    },
    [savingCompanyTheme, themeSelectionLocked],
  );

  const handleProceed = useCallback(() => {
    if (previewModal) {
      void handleThemeSelect(previewModal);
    }
    setPreviewModal(null);
  }, [previewModal, handleThemeSelect]);

  const openAdminMessage = useCallback(() => {
    if (!primaryAdminUserId) {
      showToast("No Company Admin available.", "error");
      return;
    }
    setMessagingBusy(true);
    setMessagingOpen(true);
    // Brief busy state so the CTA shows loading feedback while the panel mounts.
    window.setTimeout(() => setMessagingBusy(false), 400);
  }, [primaryAdminUserId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreviewModal(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const previewTheme = previewModal ? getTheme(previewModal) : null;
  const normalizedSelectedTheme = useMemo(
    () => normalizePortfolioThemeId(selectedTheme) || selectedTheme,
    [selectedTheme],
  );

  if (!themeDataReady) {
    return <SectionLoader text="Loading theme options..." />;
  }

  return (
    <div className="space-y-5">
      <div className="bg-linear-to-br from-slate-50 to-blue-50/50 rounded-2xl border border-slate-100 p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-xl bg-linear-to-br from-primary to-blue-600 flex items-center justify-center shadow-lg shadow-primary/20">
            <Palette className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-slate-900 mb-1">
              Portfolio Theme
            </h2>
            <p className="text-sm text-slate-500">
              Choose one template card, then select a palette swatch inside it.
            </p>
          </div>
        </div>
      </div>

      {showUpgradeBanner ? (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Upgrade your plan to unlock additional design theme families. Basic
          users can access top-level themes and the basic families shown below.
        </div>
      ) : null}

      {showAdminHelper ? (
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          Changes will apply to the entire company.
          {companyTheme ? (
            <>
              {" "}
              Current company template:{" "}
              <span className="font-semibold">{companyTheme}</span>.
            </>
          ) : null}
          {savingCompanyTheme ? (
            <span className="ml-2 inline-flex items-center gap-1.5 font-medium">
              <InlineLoader /> Saving…
            </span>
          ) : null}
        </div>
      ) : null}

      {showEmployeeNotice ? (
        <div className="rounded-3xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                You don’t have permission to change company themes. Only the
                Company Admin can update themes.
                {companyTheme ? (
                  <>
                    {" "}
                    Current company template:{" "}
                    <span className="font-semibold">{companyTheme}</span>.
                  </>
                ) : null}
              </p>
            </div>
            {primaryAdminUserId ? (
              <button
                type="button"
                onClick={openAdminMessage}
                disabled={messagingBusy}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#1e3a8a] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1d2f75] disabled:opacity-60"
              >
                {messagingBusy ? <InlineLoader /> : <MessageCircle className="h-4 w-4" />}
                Message Company Admin
              </button>
            ) : (
              <p className="shrink-0 text-sm font-medium text-blue-800/80">
                No Company Admin available.
              </p>
            )}
          </div>
        </div>
      ) : null}

      <div
        className={`grid grid-cols-1 xl:grid-cols-3 gap-4${themeSelectionLocked ? " opacity-60 select-none" : ""}`}
      >
        {visibleFamilies.map((family) => (
          <ThemeFamilyCard
            key={family.id}
            family={family}
            selectedTheme={normalizedSelectedTheme}
            onSelectTheme={(id) => {
              void handleThemeSelect(id);
            }}
            onPreviewTheme={handleCardClick}
            portfolioData={portfolioData}
            themeSelectionLocked={themeSelectionLocked}
          />
        ))}
      </div>

      {previewModal && previewTheme && (
        <ModalPortal isOpen={previewModal !== null} onClose={() => setPreviewModal(null)}>
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 max-h-[100vh]"
            onClick={() => setPreviewModal(null)}
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <div
              className="relative w-full max-h-90% max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-85 duration-200"
              onClick={(event) => event.stopPropagation()}
            >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-linear-to-r from-slate-50 to-slate-100/50">
              <div className="flex items-center gap-3">
                <div
                  className="h-10 w-10 rounded-xl flex items-center justify-center"
                  style={{ background: previewTheme.gradient }}
                >
                  <Eye className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {previewTheme.name}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {getFamilyForTheme(previewModal)?.name ?? ""}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewModal(null)}
                className="h-9 w-9 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
              >
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>
            <div className="relative flex items-center justify-center p-6 pb-0 bg-linear-to-b from-slate-100 to-slate-50">
              <div className="relative w-full max-w-md mx-auto">
                <div className="relative rounded-t-[32px] bg-gray-500 p-2.5 shadow-2xl">
                  <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-20 h-1.5 bg-slate-900 rounded-full z-10" />
                  <PortfolioPreviewFrame
                    data={portfolioData}
                    themeId={previewModal}
                    height={480}
                    scale={0.65}
                    className="rounded-[26px] border-0 shadow-none bg-slate-900"
                    scrollClassName="bg-slate-900"
                    isMobile
                  />
                </div>

                <div
                  className="absolute inset-0 rounded-[32px] pointer-events-none"
                  style={{
                    background:
                      "linear-gradient(135deg, rgba(255,255,255,0.2) 0%, transparent 50%)",
                  }}
                />
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
              <button
                type="button"
                onClick={handleProceed}
                disabled={themeSelectionLocked || savingCompanyTheme}
                className="flex-1 bg-[#1e3a8a] hover:bg-[#1d2f75] text-white font-semibold py-3 rounded-xl transition-colors text-sm cursor-pointer inline-flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {savingCompanyTheme ? <InlineLoader /> : <Check className="h-4 w-4" />}
                {canChangeCompanyTheme ? "Apply Company Theme" : "Apply Theme"}
              </button>
            </div>

            {normalizedSelectedTheme === previewModal && (
              <div className="absolute top-4 left-4 rounded-full bg-emerald-500 text-white text-[10px] font-bold px-2.5 py-1 shadow-md inline-flex items-center gap-1">
                <Check className="h-3 w-3" /> Selected
              </div>
            )}
            </div>
          </div>
        </ModalPortal>
      )}

      <ConnectionMessengerPanel
        open={messagingOpen}
        onClose={() => setMessagingOpen(false)}
        initialPeerUserId={primaryAdminUserId}
        lockedPeer
        title="Message Company Admin"
        subtitle={
          primaryAdminName
            ? `Request a theme change from ${primaryAdminName}`
            : "Request a theme change"
        }
        initialDraftText={THEME_REQUEST_DRAFT}
      />

    </div>
  );
}

interface ThemeFamilyCardProps {
  family: ThemeFamilyDef;
  description?: { tagline: string; features: string[] };
  selectedTheme: string;
  onSelectTheme: (themeId: string) => void;
  onPreviewTheme: (themeId: string) => void;
  portfolioData: PortfolioData;
  themeSelectionLocked?: boolean;
}

/** Map tier → human label and colour tokens */
const TIER_BADGE: Record<
  string,
  { label: string; bg: string; text: string }
> = {
  basic:    { label: "Basic",    bg: "#e0f2fe", text: "#0369a1" },
  standard: { label: "Standard", bg: "#f0fdf4", text: "#15803d" },
  premium:  { label: "Premium",  bg: "#fdf4ff", text: "#7e22ce" },
  enterprise: { label: "Exclusive", bg: "#fff7ed", text: "#c2410c" },
};

function ThemeFamilyCard({
  family,
  selectedTheme,
  onSelectTheme,
  onPreviewTheme,
  portfolioData,
  themeSelectionLocked = false,
}: ThemeFamilyCardProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const dirRef = useRef<1 | -1>(1);
  const activeThemeId = family.themeIds.includes(selectedTheme)
    ? selectedTheme
    : family.defaultThemeId;
  const activeTheme = getTheme(activeThemeId);
  const isFamilySelected = family.themeIds.includes(selectedTheme);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const speed = 0.5;

    const tick = () => {
      if (!el) return;
      el.scrollTop += speed * dirRef.current;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1)
        dirRef.current = -1;
      if (el.scrollTop <= 0) dirRef.current = 1;
      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  return (
    <div
      role="button"
      tabIndex={themeSelectionLocked ? -1 : 0}
      aria-disabled={themeSelectionLocked}
      onClick={() => {
        if (themeSelectionLocked) return;
        onPreviewTheme(activeThemeId);
      }}
      onKeyDown={(event) => {
        if (themeSelectionLocked) return;
        if (event.key === "Enter" || event.key === " ")
          onPreviewTheme(activeThemeId);
      }}
      className={`group relative rounded-3xl overflow-hidden border transition-all duration-300 text-left ${
        themeSelectionLocked ? "cursor-not-allowed" : "cursor-pointer"
      } ${
        isFamilySelected
          ? "border-[#1e3a8a] ring-2 ring-blue-200/70 scale-[1.01] shadow-[0_18px_36px_rgba(30,58,138,0.16)]"
          : "border-slate-200 hover:border-slate-300 hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(15,23,42,0.12)]"
      }`}
    >
      {/* Gradient header bar */}
      <div
        className="h-3 w-full"
        style={{ background: activeTheme.gradient }}
      />

      {themeSelectionLocked ? (
        <div className="absolute top-4 left-4 z-10 inline-flex items-center gap-1 rounded-full bg-slate-900/75 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-md">
          <Lock className="h-3 w-3" /> Locked
        </div>
      ) : null}

      <div className="p-4 sm:p-5 bg-white">
        {/* Header with title and tier badge */}
        <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
          <h3
            className={`text-lg font-bold ${isFamilySelected ? "text-[#1e3a8a]" : "text-slate-900"}`}
          >
            {family.name}
          </h3>
          {(() => {
            const badge = TIER_BADGE[family.tier] ?? TIER_BADGE.basic;
            return (
              <span
                className="inline-flex items-center rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide whitespace-nowrap"
                style={{ backgroundColor: badge.bg, color: badge.text }}
              >
                {badge.label}
              </span>
            );
          })()}
        </div>

        {/* Preview frame */}
        <div
          ref={scrollRef}
          className="h-40 overflow-hidden pointer-events-none flex justify-center gap-3 relative bg-slate-50 rounded-2xl border border-slate-100"
          style={{ scrollBehavior: "auto" }}
        >
          <div
            className="origin-top-center shrink-0"
            style={{
              transform: "scale(0.35)",
              width: "400px",
              transformOrigin: "top center",
            }}
          >
            <PortfolioPreviewFrame
              data={portfolioData}
              themeId={activeThemeId}
              height={480}
              scale={0.65}
              className="rounded-[26px] border-0 shadow-none bg-slate-900"
              scrollClassName="bg-slate-900"
              isMobile
            />
          </div>
        </div>

        {/* Color palette swatches */}
        <div className="mt-4 flex flex-col gap-2">
          <div>
            <span className="text-[10px] tracking-[0.22em] uppercase text-slate-400 font-semibold">
              Color Palette
            </span>
          </div>
          <div className="w-full grid grid-cols-3 gap-3">
            {prioritizeSelectedThemeIds(family.themeIds, selectedTheme).map((themeId) => {
              const theme = getTheme(themeId);
              const isSelected = selectedTheme === themeId;
              return (
                <button
                  key={themeId}
                  type="button"
                  disabled={themeSelectionLocked}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (themeSelectionLocked) return;
                    onSelectTheme(themeId);
                  }}
                  aria-label={`Select ${theme.name}`}
                  aria-pressed={isSelected}
                  className={`h-10 w-full rounded-md transition-all duration-200 flex items-center justify-center gap-1 relative ${
                    isSelected
                      ? "border-2 border-[#1e3a8a] ring-2 ring-blue-200/70 bg-blue-50 shadow-sm"
                      : "border border-slate-200 bg-white hover:border-slate-300 hover:-translate-y-0.5"
                  }`}
                >
                  <span
                    className="h-full w-full rounded-md border border-white shadow-md"
                    style={{ background: theme.gradient }}
                  />
                  {isSelected ? (
                    <span className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-[#1e3a8a] text-white flex items-center justify-center shadow-md">
                      <Check className="h-3 w-3" />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {isFamilySelected && (
        <div className="absolute top-4 right-4 rounded-full bg-[#1e3a8a] text-white text-[10px] font-bold px-2.5 py-1 shadow-md inline-flex items-center gap-1">
          <Check className="h-3 w-3" /> Selected
        </div>
      )}

      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
        style={{
          background:
            "linear-gradient(to top, rgba(15,23,42,0.04), transparent 40%)",
        }}
      />
    </div>
  );
}

function getFamilyIdForTheme(themeId: string): string {
  return (
    THEME_FAMILIES.find((family) => family.themeIds.includes(themeId))?.id ??
    "elegant-dark"
  );
}

function getFamilyForTheme(themeId: string): ThemeFamilyDef | undefined {
  return THEME_FAMILIES.find((family) => family.themeIds.includes(themeId));
}
