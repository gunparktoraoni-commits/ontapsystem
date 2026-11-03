"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import { Check, ArrowRight, ChevronDown, ChevronUp, XCircle, Sparkles, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { InlineLoader } from "../Loader";
import { showToast } from "../Toast";
import { ModalPortal } from "../ModalPortal";
import { getFrontendApiBaseUrl } from "../apiBase";
import ElegantDark from "../../themes/cards/ElegantDark";
import ModernMinimalist from "../../themes/cards/ModernMinimalist";
import SimpleClassico from "../../themes/cards/SimpleClassico";
import BubbleGlass from "../../themes/cards/BubbleGlass";
import OceanGradient from "../../themes/cards/OceanGradient";
import PremiumGotham from "../../themes/cards/PremiumGotham";
import RoyalPurple from "../../themes/cards/RoyalPurple";
import LuxuriousEditorial from "../../themes/cards/LuxuriousEditorial";
import NouveauRiche from "../../themes/cards/NouveauRiche";
import OgNeumorphic from "../../themes/cards/OgNeumorphic";
import { LuIdCard } from "react-icons/lu";
import { getThemeFamily, getThemeFamilyById } from "../BizCardPreview";

const API = getFrontendApiBaseUrl();
const USER_SYNC_EVENT = "ontap:user-sync";
const CSRF_COOKIE_NAME = "csrf-token";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// ----------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------
type ApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  message?: string;
  error?: unknown;
};

type RawPlan = {
  id: string;
  name: string;
  description?: string | null;
  monthlyPrice: number;
  yearlyPrice: number;
  features?: unknown;
  isCurrent?: boolean;
};

type PlanTone = "light" | "brand" | "dark";

type PlanCard = {
  id: string;
  apiPlanId: string | null;
  name: string;
  description: string;
  monthlyPrice: number;
  compareMonthlyPrice: number;
  yearlyPrice: number;
  features: string[];
  isCurrent: boolean;
  tone: PlanTone;
};

type CurrentSubscription = {
  id: string;
  planId: string;
  planName: string | null;
  status: string;
  billingCycle: string;
  startedAt: string;
  expiresAt: string;
  autoRenew: boolean;
  downgradePlanId?: string | null;
  usage?: {
    templateDownloadsThisPeriod?: number;
    ordersThisPeriod?: number;
  };
};





type SubscriptionAction = {
  label: string;
  type: "upgrade" | "downgrade" | "current";
  disabled: boolean;
  fee?: number | null;
};

type PlanDisplayConfig = {
  key: "basic" | "standard" | "premium";
  name: string;
  description: string;
  monthlyPrice: number;
  features: string[];
  tone: PlanTone;
};

interface Bizcard {
  cardId: string;
  serialId: string;
  cardName: string;
  urlAlias: string;
  theme?: string;
  purchaseDate: string;
  qrCode: string | null;
  subscriptionTier: string | null;
}

    

// ----------------------------------------------------------------------
// Constants & Helperss
// ----------------------------------------------------------------------
const UPGRADE_FEES: Record<string, number> = {
  basic_to_standard: 199,
  basic_to_premium: 299,
  standard_to_premium: 199,
};
const DOWNGRADE_FEES: Record<string, number> = {
  premium_to_standard: 199,
  standard_to_basic: 99,
};

const PLAN_DISPLAY_CONFIG: PlanDisplayConfig[] = [
  {
    key: "basic",
    name: "Basic",
    description: "Starter access for individuals and new teams.",
    monthlyPrice: 99,
    tone: "light",
    features: [
      "Basic Info and Social Media Links",
      "Product and Services Display",
      "Real-Time Analytics",
      "Standard BizCard Design (OnTap Logo)",
      "2 Virtual/Physical BizCards",
      "5 Free Themes",
      "Up to 30 Associate Connects",
    ],
  },
  {
    key: "standard",
    name: "Standard",
    description: "Expanded tools for growing teams and catalogs.",
    monthlyPrice: 199,
    tone: "brand",
    features: [
      "Everything in Basic Plan",
      "Gallery Showcase",
      "5 Virtual/Physical BizCards",
      "7 Free Themes",
      "Up to 50 Associate Connects",
    ],
  },
  {
    key: "premium",
    name: "Premium",
    description: "Full control, scale, and customization for enterprises.",
    monthlyPrice: 299,
    tone: "dark",
    features: [
      "Everything in the Standard Plan",
      "Company Management",
      "Inquiry Management",
      "Custom BizCard Design (Company Logo)",
      "10 Free Themes",
      "Unlimited Associate Connects",
    ],
  },
];

const themeComponents: Record<string, React.ComponentType<{ props: any }>> = {
  "elegant-dark": ElegantDark,
  "modern-minimalist": ModernMinimalist,
  "simple-classico": SimpleClassico,
  "bubble-glass": BubbleGlass,
  "ocean-gradient": OceanGradient,
  "premium-gotham": PremiumGotham,
  "royal-purple": RoyalPurple,
  "luxurious-editorial": LuxuriousEditorial,
  "nouveau-riche": NouveauRiche,
  "og-neumorphic": OgNeumorphic,
};

const FAMILY_COMPONENT_MAP: Record<string, string> = {
  "elegant-dark": "elegant-dark",
  "ocean-gradient": "ocean-gradient",
  "royal-purple": "royal-purple",
  "basic/simple-classico": "simple-classico",
  "basic/modern-minimalist": "modern-minimalist",
  "premium/luxurious-editorial": "luxurious-editorial",
  "premium/nouveau-riche": "nouveau-riche",
  "premium/og-neumorphic": "og-neumorphic",
  "standard/bubble-glass": "bubble-glass",
  "standard/floral-madness": "bubble-glass",
  "standard/premium-gotham": "premium-gotham",
};

const LEGACY_LAYOUT_PALETTES: Record<string, string> = {
  "elegant-dark": "original",
  "elegant-dark-v2": "v2",
  "elegant-dark-v3": "v3",
  "ocean-gradient": "teal",
  "ocean-gradient-v2": "green",
  "ocean-gradient-v3": "orange",
  "royal-purple": "purple",
  "royal-purple-v2": "amber",
  "royal-purple-v3": "teal",
};

/** Portfolio theme IDs that differ from mini-card component palette keys */
const PORTFOLIO_TO_CARD_PALETTE: Record<string, string> = {
  "ice-variant": "ice",
  "warm-pastel": "pastel",
  "midnight-moon": "moon",
  "blue-gold": "ocean-blue-gold",
  "grainy-white": "violet-pink",
};

function toCardPalette(portfolioPalette: string): string {
  if (LEGACY_LAYOUT_PALETTES[portfolioPalette]) {
    return LEGACY_LAYOUT_PALETTES[portfolioPalette];
  }
  return PORTFOLIO_TO_CARD_PALETTE[portfolioPalette] ?? portfolioPalette;
}



function buildPortfolioUrl(alias: string): string | null {
  const cleanAlias = alias.trim().replace(/^\/+/, "");
  if (!cleanAlias) return null;
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/${cleanAlias}`;
  }
  return `/${cleanAlias}`;
}

function readPortfolioTheme(urlAlias: string): string | null {
  if (!urlAlias || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`portfolio_${urlAlias.trim()}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { selectedTheme?: unknown };
    const theme =
      typeof parsed.selectedTheme === "string" ? parsed.selectedTheme.trim() : "";
    return theme || null;
  } catch {
    return null;
  }
}

function resolveInitialThemeId(urlAlias: string, styleFallback: string): string {
  const fromPortfolio = readPortfolioTheme(urlAlias);
  if (fromPortfolio) return fromPortfolio;
  if (styleFallback && themeComponents[styleFallback]) return styleFallback;
  return "elegant-dark";
}

function resolveCardThemeSelection(selectedThemeId: string): {
  componentKey: string;
  palette: string;
} {
  const normalized = selectedThemeId.trim() || "elegant-dark";

  if (FAMILY_COMPONENT_MAP[normalized]) {
    const family = getThemeFamilyById(normalized);
    return {
      componentKey: FAMILY_COMPONENT_MAP[normalized],
      palette: toCardPalette(family.defaultThemeId),
    };
  }

  if (themeComponents[normalized]) {
    const familyEntry = Object.entries(FAMILY_COMPONENT_MAP).find(
      ([, componentKey]) => componentKey === normalized
    );
    const defaultPortfolioId = familyEntry
      ? getThemeFamilyById(familyEntry[0]).defaultThemeId
      : normalized;
    return {
      componentKey: normalized,
      palette: toCardPalette(defaultPortfolioId),
    };
  }

  const family = getThemeFamily(normalized);
  const componentKey =
    FAMILY_COMPONENT_MAP[family.id] ??
    (themeComponents[normalized] ? normalized : "elegant-dark");

  if (family.themeIds.includes(normalized)) {
    return { componentKey, palette: toCardPalette(normalized) };
  }

  return { componentKey, palette: toCardPalette(family.defaultThemeId) };
}

function mapApiBizcard(card: Record<string, unknown>): Bizcard {
  const urlAlias = String(card.url_alias ?? "").trim();
  const themeFallback = String(
    card.bizcard_theme ?? card.bizcard_style ?? "",
  ).trim();
  return {
    cardId: String(card.bizcard_id),
    serialId: String(card.serial_id),
    cardName:
      String(card.bizcard_name ?? "").trim() ||
      `${String(card.first_name ?? "").trim()} ${String(card.last_name ?? "").trim()}`.trim(),
    urlAlias,
    theme: resolveInitialThemeId(urlAlias, themeFallback),
    purchaseDate: String(card.created_at),
    qrCode: card.qr_code_url ? String(card.qr_code_url) : null,
    subscriptionTier:
      card.subscription_tier != null ? String(card.subscription_tier) : null,
  };
}

function buildCardThemeState(cards: Bizcard[]): Record<string, string> {
  const themes: Record<string, string> = {};
  for (const card of cards) {
    themes[card.serialId] = card.theme || "elegant-dark";
  }
  return themes;
}

function resolvePlanKey(
  name: string | null | undefined
): PlanDisplayConfig["key"] | null {
  if (!name) return null;
  const normalized = name.trim().toLowerCase();
  if (normalized.includes("basic")) return "basic";
  if (normalized.includes("standard")) return "standard";
  if (normalized.includes("premium")) return "premium";
  return null;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const cookies = document.cookie.split("; ");
  for (const cookie of cookies) {
    const [rawKey, ...rest] = cookie.split("=");
    const key = decodeURIComponent(rawKey || "").trim();
    if (key !== name) continue;
    return decodeURIComponent(rest.join("=") || "").trim() || null;
  }
  return null;
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const raw = payload as Record<string, unknown>;
  if (typeof raw.error === "string" && raw.error.trim()) return raw.error;
  if (raw.error && typeof raw.error === "object") {
    const nested = raw.error as Record<string, unknown>;
    if (typeof nested.message === "string" && nested.message.trim())
      return nested.message;
  }
  if (typeof raw.message === "string" && raw.message.trim()) return raw.message;
  return fallback;
}

const PHP_NUMBER_FORMATTER = new Intl.NumberFormat("en-PH", {
  maximumFractionDigits: 0,
});
function formatPhpNumber(value: number): string {
  return PHP_NUMBER_FORMATTER.format(value);
}
function formatPhp(value: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(value);
}
function formatDate(raw: string): string {
  const date = new Date(raw);
  if (isNaN(date.getTime())) return "N/A";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();
  return `${month}-${day}-${year}`;
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
    const payload = await response.json();
    const data =
      payload.data && typeof payload.data === "object" ? payload.data : null;
    const token =
      payload.csrfToken ||
      payload.csrf_token ||
      payload.token ||
      (data && data.csrfToken) ||
      null;
    return token?.trim() || readCookie(CSRF_COOKIE_NAME);
  } catch {
    return readCookie(CSRF_COOKIE_NAME);
  }
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function authFetch(
  url: string,
  init: RequestInit = {},
  canRetry = true
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers ?? {});
  if (MUTATING_METHODS.has(method)) {
    const csrfToken = await ensureCsrfToken();
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
    if (!headers.has("Idempotency-Key")) {
      headers.set("Idempotency-Key", generateIdempotencyKey());
    }
  }
  const requestInit: RequestInit = {
    credentials: "include",
    cache: "no-store",
    ...init,
    method,
    headers,
  };
  const response = await fetch(url, requestInit);
  if (canRetry && (response.status === 401 || response.status === 403)) {
    const refreshHeaders = new Headers();
    const refreshCsrf = await ensureCsrfToken();
    if (refreshCsrf) refreshHeaders.set("X-CSRF-Token", refreshCsrf);
    const refreshResponse = await fetch(`${API}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: refreshHeaders,
    });
    if (refreshResponse.ok) return fetch(url, requestInit);
  }
  return response;
}

// ----------------------------------------------------------------------
// Main Component
// ----------------------------------------------------------------------
export default function SubscriptionTab() {
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">(
    "monthly"
  );
  const [plans, setPlans] = useState<PlanCard[]>([]);
  const [currentSubscription, setCurrentSubscription] =
    useState<CurrentSubscription | null>(null);
  const [bizcards, setBizcards] = useState<Bizcard[]>([]);
  const [cardThemes, setCardThemes] = useState<Record<string, string>>({});
  const [qrCodeNodes, setQrCodeNodes] = useState<Record<string, ReactNode>>({});
  const [selectedBizcardSerial, setSelectedBizcardSerial] = useState<
    string | null
  >(null);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);

  const fetchSubscriptionForSerial = useCallback(
    async (serialId: string | null) => {
      if (!serialId) {
        setCurrentSubscription(null);
        return;
      }
      try {
        const subRes = await authFetch(
          `${API}/api/marketplace/bizcard/subscription?serialId=${serialId}`
        );
        if (subRes.ok) {
          const subPayload = await subRes.json();
          if (subPayload.success && subPayload.data?.subscription) {
            const sub = subPayload.data.subscription;
            const subscriptionData: CurrentSubscription = {
              id: sub.id,
              planId: sub.plan.id,
              planName: sub.plan.name,
              status: sub.status,
              billingCycle: sub.billingCycle,
              startedAt: sub.startedAt,
              expiresAt: sub.expiresAt,
              autoRenew: sub.autoRenew,
              downgradePlanId: sub.downgradePlanId ?? null,
              usage: sub.usage,
            };
            setCurrentSubscription(subscriptionData);
          } else {
            setCurrentSubscription(null);
          }
        } else {
          setCurrentSubscription(null);
        }
      } catch (err) {
        console.error("Error fetching subscription:", err);
        setCurrentSubscription(null);
      }
    },
    []
  );

  const loadPlansAndBizcards = useCallback(async () => {
    setLoading(true);
    try {
      const [plansResponse, bizcardsResponse] = await Promise.all([
        authFetch(`${API}/api/marketplace/subscriptions/plans`),
        authFetch(`${API}/api/user/bizcards`),
      ]);

      const plansPayload = (await plansResponse
        .json()
        .catch(() => null)) as ApiEnvelope<{ plans?: RawPlan[] }> | null;
      if (!plansResponse.ok || !plansPayload?.success) {
        throw new Error(
          extractErrorMessage(plansPayload, "Unable to load subscription plans.")
        );
      }

      let bizcardsData: Bizcard[] = [];
      if (bizcardsResponse.ok) {
        const bizPayload = await bizcardsResponse.json();
        if (bizPayload.success && bizPayload.data?.bizcards) {
          bizcardsData = bizPayload.data.bizcards.map((card: Record<string, unknown>) =>
            mapApiBizcard(card)
          );
        }
      }

      const rawPlans = Array.isArray(plansPayload.data?.plans)
        ? plansPayload.data.plans
        : [];
      const plansByKey = new Map<PlanDisplayConfig["key"], RawPlan>();
      for (const plan of rawPlans) {
        
        const key = resolvePlanKey(plan.name);

        if (key && !plansByKey.has(key)) plansByKey.set(key, plan);
      }

      const normalizedPlans = PLAN_DISPLAY_CONFIG.map<PlanCard>((config) => {
        const matched = plansByKey.get(config.key) ?? null;
        const yearlyPrice = Number(matched?.yearlyPrice ?? 0);
        const resolvedYearlyPrice =
          yearlyPrice > 0 ? yearlyPrice : Math.round(config.monthlyPrice * 12);
        const compareMonthlyPrice = Number(
          matched?.monthlyPrice ?? config.monthlyPrice
        );
        return {
          id: config.key,
          apiPlanId: matched?.id ?? null,
          name: config.name,
          description: matched?.description || config.description,
          monthlyPrice: config.monthlyPrice,
          compareMonthlyPrice,
          yearlyPrice: resolvedYearlyPrice,
          features: config.features,
          isCurrent: false,
          tone: config.tone,
        };
      });

      setPlans(normalizedPlans);
      setBizcards(bizcardsData);
      setCardThemes(buildCardThemeState(bizcardsData));

      if (bizcardsData.length > 0 && !selectedBizcardSerial) {
        setSelectedBizcardSerial(bizcardsData[0].serialId);
      } else if (bizcardsData.length === 0) {
        setSelectedBizcardSerial(null);
      }

      setLoading(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to load subscription data.";
      showToast(message, "error");
      setPlans([]);
      setBizcards([]);
      setCardThemes({});
      setQrCodeNodes({});
      setCurrentSubscription(null);
      setLoading(false);
    }
  }, [selectedBizcardSerial]);
  const refreshBizcardThemes = useCallback(() => {
    setCardThemes((prev) => {
      const next = { ...prev };
      for (const card of bizcards) {
        const stored = card.urlAlias ? readPortfolioTheme(card.urlAlias) : null;
        if (stored) next[card.serialId] = stored;
      }
      return next;
    });
  }, [bizcards]);

  const refreshBizcardsQuietly = useCallback(async () => {
    try {
      const bizcardsResponse = await authFetch(`${API}/api/user/bizcards`);
      if (!bizcardsResponse.ok) return;

      const bizPayload = await bizcardsResponse.json();
      if (!bizPayload.success || !bizPayload.data?.bizcards) return;

      const bizcardsData = bizPayload.data.bizcards.map(
        (card: Record<string, unknown>) => mapApiBizcard(card)
      );
      setBizcards(bizcardsData);
      setCardThemes(buildCardThemeState(bizcardsData));
    } catch {
      refreshBizcardThemes();
    }
  }, [refreshBizcardThemes]);

  useEffect(() => {
    let cancelled = false;
    const generateQrCodes = async () => {
      if (typeof window === "undefined" || bizcards.length === 0) {
        if (!cancelled) setQrCodeNodes({});
        return;
      }
      const next: Record<string, ReactNode> = {};
      await Promise.all(
        bizcards.map(async (card) => {
          const portfolioUrl = buildPortfolioUrl(card.urlAlias);
          if (!portfolioUrl) return;
          try {
            const dataUrl = await QRCode.toDataURL(portfolioUrl, {
              errorCorrectionLevel: "H",
              type: "image/png",
              margin: 1,
              width: 200,
            });
            next[card.serialId] = (
              <img
                src={dataUrl}
                alt={`QR code for ${card.cardName}`}
                className="h-28 w-28 object-contain transition-all duration-300 group-hover:scale-110 group-focus:scale-110"
              />
            );
          } catch (error) {
            console.error(
              `[SubscriptionTab] Failed to generate QR for ${card.serialId}:`,
              error
            );
          }
        })
      );

      if (!cancelled) setQrCodeNodes(next);
    };

    void generateQrCodes();
    return () => {
      cancelled = true;
    };
  }, [bizcards]);

  useEffect(() => {
    const handleUserSync = () => {
      refreshBizcardThemes();
      void refreshBizcardsQuietly();
    };

    window.addEventListener(USER_SYNC_EVENT, handleUserSync);
    window.addEventListener("focus", handleUserSync);
    return () => {
      window.removeEventListener(USER_SYNC_EVENT, handleUserSync);
      window.removeEventListener("focus", handleUserSync);
    };
  }, [refreshBizcardThemes, refreshBizcardsQuietly]);

  useEffect(() => {
    loadPlansAndBizcards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedBizcardSerial) {
      fetchSubscriptionForSerial(selectedBizcardSerial);
    } else {
      setCurrentSubscription(null);
    }
  }, [selectedBizcardSerial, fetchSubscriptionForSerial]);

  const renderBizcardComponent = (card: Bizcard) => {
    const selectedThemeId =
      cardThemes[card.serialId] || card.theme || "elegant-dark";
    const { componentKey, palette } = resolveCardThemeSelection(selectedThemeId);
    const Component = themeComponents[componentKey] || ElegantDark;
    const isActive = selectedBizcardSerial === card.serialId;
    return (
      <Component
        props={{
          cardName: card.cardName,
          serialID: card.serialId,
          dateMade: formatDate(card.purchaseDate),
          qrCode: qrCodeNodes[card.serialId],
          theme: palette,
          isActive,
        }}
      />
    );
  };

  const currentPlan = useMemo(
    () =>
      plans.find(
        (p) => p.apiPlanId && p.apiPlanId === currentSubscription?.planId
      ) || null,
    [currentSubscription?.planId, plans]
  );

  const isPlanExpired = useMemo(() => {
    if (!currentSubscription) return false;
    return new Date(currentSubscription.expiresAt) < new Date();
  }, [currentSubscription]);

  const daysUntilExpiry = useMemo(() => {
    if (!currentSubscription) return null;
    const diff = new Date(currentSubscription.expiresAt).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }, [currentSubscription]);

  const getPlanAction = useCallback(
    (plan: PlanCard): SubscriptionAction => {
      if (!plan.apiPlanId) {
        return { label: "Unavailable", type: "current", disabled: true, fee: null };
      }

      if (currentSubscription && plan.apiPlanId === currentSubscription.planId) {
        return { label: "Current Plan", type: "current", disabled: true, fee: null };
      }

      if (!currentSubscription) {
        return { label: "Purchase", type: "upgrade", disabled: false, fee: null };
      }

      const tierOrder: Record<string, number> = { basic: 1, standard: 2, premium: 3 };
      const currentKey = currentPlan?.id;
      const targetKey = plan.id;

      if (!currentKey || !targetKey) {
        return { label: "Unavailable", type: "current", disabled: true, fee: null };
      }

      const currentRank = tierOrder[currentKey] || 0;
      const targetRank = tierOrder[targetKey] || 0;

      if (targetRank > currentRank) {
        const feeKey = `${currentKey}_to_${targetKey}`;
        const fee = UPGRADE_FEES[feeKey] || null;
        const label = fee ? `Upgrade (₱${fee})` : "Upgrade";
        return { label, type: "upgrade", disabled: false, fee };
      } else if (targetRank < currentRank) {
        if (isPlanExpired) {
          const feeKey = `${currentKey}_to_${targetKey}`;
          const fee = DOWNGRADE_FEES[feeKey] || null;
          const label = fee ? `Downgrade (₱${fee})` : "Downgrade";
          return { label, type: "downgrade", disabled: false, fee };
        } else {
          return {
            label: "Downgrade (plan must expire)",
            type: "downgrade",
            disabled: true,
            fee: null,
          };
        }
      } else {
        return { label: "Unavailable", type: "current", disabled: true, fee: null };
      }
    },
    [currentPlan?.id, currentSubscription, isPlanExpired]
  );

  const handlePlanAction = async (plan: PlanCard) => {
    const action = getPlanAction(plan);
    if (action.disabled || !plan.apiPlanId) return;
    setBusyPlanId(plan.id);
    try {
      const response = await authFetch(
        `${API}/api/marketplace/subscription/change-plan`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            planId: plan.apiPlanId,
            action: action.type,
            bizcardSerialId: selectedBizcardSerial,
          }),
        }
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success)
        throw new Error(extractErrorMessage(payload, "Failed to change plan."));
      if (payload.data?.invoiceUrl) {
        window.location.href = payload.data.invoiceUrl;
        return;
      }
      showToast(payload.message || "Plan changed successfully.", "success");
      if (selectedBizcardSerial) {
        await fetchSubscriptionForSerial(selectedBizcardSerial);
      }
      // Refresh sidebar Premium-gated nav (Missions) without a full page reload.
      window.dispatchEvent(new CustomEvent(USER_SYNC_EVENT));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Plan change failed.";
      showToast(message, "error");
    } finally {
      setBusyPlanId(null);
    }
  };

  const handleCancelSubscription = async () => {
    if (!currentSubscription) return;
    setShowCancelModal(false);
    setCanceling(true);
    try {
      const response = await authFetch(
        `${API}/api/marketplace/subscription/cancel-immediate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bizcardSerialId: selectedBizcardSerial }),
        }
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success)
        throw new Error(
          extractErrorMessage(payload, "Unable to cancel subscription.")
        );
      showToast(payload.message || "Subscription cancelled.", "success");
      if (selectedBizcardSerial) {
        await fetchSubscriptionForSerial(selectedBizcardSerial);
      }
      // Hide Premium-gated nav (Missions) immediately after downgrade/cancel.
      window.dispatchEvent(new CustomEvent(USER_SYNC_EVENT));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to cancel subscription.";
      showToast(message, "error");
    } finally {
      setCanceling(false);
    }
  };

  const togglePlanFeatures = (planId: string) =>
    setExpandedPlanId((prev) => (prev === planId ? null : planId));

  // ----------------------------------------------------------------------
  // JSX
  // ----------------------------------------------------------------------
  return (
    <div>
      {/* BizCards section */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative overflow-hidden rounded-2xl text-white shadow-md"
        style={{ background: "linear-gradient(135deg, #2A4792, #4785B8)" }}
      >
        <div className="p-6">
          <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
            <LuIdCard className="h-5 w-5" />
            My BizCards
          </h3>

          {loading ? (
            // Skeleton while loading
            <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
              <InlineLoader />
            </div>
          ) : bizcards.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-white/80 mb-4">
                You have no existing BizCard. Order one to enjoy premium and
                exclusive perks!
              </p>
              <button
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-[#2A4792] shadow-md transition hover:shadow-lg disabled:opacity-50"
              >
                Purchase BizCard
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex gap-4 overflow-x-auto scrollbar-hide p-4">
              {bizcards.map((card) => (
                <div
                  key={card.serialId}
                  onClick={() => {
                    if (!loading) setSelectedBizcardSerial(card.serialId);
                  }}
                  className={`cursor-pointer transition-all duration-200 ${
                    loading ? "pointer-events-none opacity-50" : ""
                  }`}
                >
                  {renderBizcardComponent(card)}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Animated background circles */}
        <motion.div
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ duration: 8, repeat: Infinity }}
          className="absolute right-0 top-0 -mr-16 -mt-16 h-64 w-64 rounded-full bg-white/10 blur-3xl pointer-events-none"
        />
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
          transition={{ duration: 6, repeat: Infinity, delay: 1 }}
          className="absolute bottom-0 left-0 -ml-16 -mb-16 h-40 w-40 rounded-full bg-white/10 blur-2xl pointer-events-none"
        />
      </motion.div>

      {/* Subscription expiry notice */}
      {selectedBizcardSerial &&
        currentSubscription &&
        daysUntilExpiry !== null &&
        daysUntilExpiry <= 7 && (
          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-md mt-6">
            <div className="flex items-center">
              <Sparkles className="h-5 w-5 text-yellow-400 mr-3" />
              <p className="text-sm text-yellow-700">
                Subscription for this BizCard ends on{" "}
                {formatDate(currentSubscription.expiresAt)}.
                {daysUntilExpiry <= 0
                  ? " Premium features are suspended."
                  : " Renew to keep enjoying benefits."}
              </p>
            </div>
          </div>
        )}

      {/* Cancel subscription button */}
      {currentSubscription && currentSubscription.status === "active" && (
        <div className="flex justify-end mt-4">
          <button
            onClick={() => setShowCancelModal(true)}
            disabled={canceling || loading}
            className="inline-flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            <XCircle className="h-4 w-4" />
            {canceling ? "Cancelling..." : "Cancel Subscription"}
          </button>
        </div>
      )}

      {/* Plans section */}
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm mt-6">
        <div className="mb-8 flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
          <motion.h3
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="text-2xl font-bold"
            style={{ color: "#2A4792" }}
          >
            {selectedBizcardSerial
              ? `Plan for BizCard #${selectedBizcardSerial}`
              : "Upgrade Plan"}
          </motion.h3>
        </div>

        {plans.length === 0 ? (
          <div className="flex min-h-55 items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500">
            No subscription plans are available right now.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 items-start">
            {plans.map((plan, index) => {
              const action = getPlanAction(plan);
              const busy = busyPlanId === plan.id;
              const isCurrent =
                currentSubscription &&
                plan.apiPlanId === currentSubscription.planId;
              const displayPrice =
                billingCycle === "yearly"
                  ? plan.yearlyPrice
                  : plan.monthlyPrice;
              const isBrand = plan.tone === "brand";
              const isDark = plan.tone === "dark";
              const isLight = plan.tone === "light";
              const cardStyle = isBrand
                ? { background: "linear-gradient(135deg, #2A4792, #4785B8)" }
                : isDark
                ? { background: "linear-gradient(135deg, #0F172A, #1E293B)" }
                : undefined;
              const cardBgClass = isBrand
                ? "border-transparent text-white"
                : isDark
                ? "border-slate-900/60 text-white"
                : "border-[#E1E8F5] bg-white text-slate-900";
              const mutedTextClass =
                isBrand || isDark ? "text-white/70" : "text-gray-500";
              const accentTextClass =
                isBrand || isDark ? "text-white" : "text-[#3B569F]";
              const featureTextClass =
                isBrand || isDark ? "text-white/90" : "text-gray-600";
              const featureIconWrap =
                isBrand || isDark
                  ? "bg-white/15 text-white"
                  : "bg-blue-50/50 text-[#3B569F]";
              const buttonClass =
                isBrand || isDark
                  ? "bg-white text-[#2A4792] hover:bg-white/90"
                  : "text-white";
              const buttonStyle =
                isBrand || isDark
                  ? undefined
                  : { background: "linear-gradient(135deg, #2A4792, #4785B8)" };

              return (
                <motion.div
                  key={plan.id}
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ y: -8, scale: 1.01 }}
                  transition={{
                    delay: index * 0.15,
                    type: "spring",
                    stiffness: 300,
                    damping: 24,
                  }}
                  className={`group relative flex flex-col rounded-2xl border p-6 shadow-sm transition-all duration-300 hover:shadow-xl ${cardBgClass} ${
                    isCurrent ? "ring-2 ring-blue-500 ring-offset-2" : ""
                  }`}
                  style={cardStyle}
                >
                  <div className="mb-6">
                    <div className="flex justify-between items-start">
                      <h4 className={`text-xl font-semibold ${accentTextClass}`}>
                        {plan.name}
                      </h4>
                      <button
                        onClick={() => togglePlanFeatures(plan.id)}
                        className="p-1 rounded-full hover:bg-white/10 transition-colors"
                      >
                        {expandedPlanId === plan.id ? (
                          <ChevronUp className="h-5 w-5" />
                        ) : (
                          <ChevronDown className="h-5 w-5" />
                        )}
                      </button>
                    </div>
                    <p className={`mt-1 text-xs ${mutedTextClass}`}>
                      {plan.description}
                    </p>
                    <p
                      className={`mt-4 text-[10px] font-bold uppercase tracking-wider ${mutedTextClass}`}
                    >
                      STARTS AT
                    </p>
                    <div className="mt-1 flex items-baseline gap-1 overflow-hidden">
                      <span className={`text-4xl font-bold ${accentTextClass}`}>
                        ₱
                      </span>
                      <div
                        className={`relative flex h-10 items-end ${accentTextClass}`}
                      >
                        <AnimatePresence mode="popLayout">
                          <motion.span
                            key={`${plan.id}-${billingCycle}`}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            transition={{
                              duration: 0.25,
                              type: "spring",
                              bounce: 0,
                            }}
                            className="text-4xl font-bold"
                          >
                            {formatPhpNumber(displayPrice)}
                          </motion.span>
                        </AnimatePresence>
                      </div>
                      <span
                        className={`ml-1 text-sm font-medium ${mutedTextClass}`}
                      >
                        / on first year
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handlePlanAction(plan)}
                    disabled={
                      !!(action.disabled || busy || loading || isCurrent)
                    }
                    className={`group mb-8 flex w-full items-center justify-between rounded-lg px-6 py-3 text-sm font-bold shadow-md transition-all hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60 ${buttonClass}`}
                    style={buttonStyle}
                  >
                    <span>
                      {busy
                        ? "Processing..."
                        : isCurrent
                        ? "Current Plan"
                        : action.label}
                    </span>
                    {busy ? (
                      <InlineLoader className={isBrand || isDark ? "text-white" : "text-[#2A4792]"} />
                    ) : (
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    )}
                  </button>
                  <AnimatePresence>
                    {expandedPlanId === plan.id && (
                      <motion.ul
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.3 }}
                        className="space-y-4 overflow-hidden"
                      >
                        {plan.features.map((feature, idx) => (
                          <motion.li
                            key={`${plan.id}-feature-${idx}`}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.05 }}
                            className="flex items-center gap-3"
                          >
                            <div
                              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${featureIconWrap}`}
                            >
                              <Check
                                className="h-3.5 w-3.5"
                                strokeWidth={2.5}
                              />
                            </div>
                            <span
                              className={`text-sm font-medium transition-colors ${featureTextClass} ${
                                isLight
                                  ? "group-hover:text-gray-900"
                                  : "group-hover:text-white"
                              }`}
                            >
                              {feature}
                            </span>
                          </motion.li>
                        ))}
                      </motion.ul>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Cancel Confirmation Modal */}
      {showCancelModal && (
        <ModalPortal isOpen={showCancelModal} onClose={() => setShowCancelModal(false)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-6 shadow-2xl"
          >
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-100">
                <AlertTriangle className="h-6 w-6 text-red-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-gray-900">
                  Cancel Subscription
                </h3>
                <div className="mt-2 space-y-2 text-sm text-gray-600">
                  <p>
                    Are you sure you want to cancel your subscription immediately?
                    All premium features will be disabled.
                  </p>
                  <p className="font-semibold text-red-600">
                    ⚠️ This action is <span className="underline">irreversible</span> and
                    <span className="underline"> no refunds</span> will be issued for the remaining period.
                  </p>
                  {selectedBizcardSerial && (
                    <p className="text-xs text-gray-500">
                      BizCard: #{selectedBizcardSerial}
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                onClick={() => setShowCancelModal(false)}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-gray-200 bg-white px-5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
              >
                Go Back
              </button>
              <button
                onClick={handleCancelSubscription}
                disabled={canceling}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-red-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {canceling ? (
                  <>
                    <InlineLoader className="text-white" />
                    Cancelling...
                  </>
                ) : (
                  "Yes, Cancel"
                )}
              </button>
            </div>
          </motion.div>
        </ModalPortal>
      )}
    </div>
  );
}