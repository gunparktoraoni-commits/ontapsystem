"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Gift,
  LayoutTemplate,
  Sparkles,
  Trophy,
  X,
} from "lucide-react";
import { ModalPortal } from "@/app/components/ModalPortal";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import { showToast } from "@/app/components/Toast";
import { hasActivePremiumPlan } from "@/app/components/subscriptionAccess";
import { buildImpersonationHeaders } from "@/app/lib/superadminImpersonationHandoff";
import { THEME_FAMILIES } from "@/lib/constants/theme-families";

const OPEN_EVENT = "ontap:open-premium-upgrade";
const PENDING_KEY = "ontap:pending-premium-upgrade";
const USER_SYNC_EVENT = "ontap:user-sync";
const CSRF_COOKIE_NAME = "csrf-token";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type PlanKey = "basic" | "standard" | "premium";

/** Display prices aligned with SubscriptionTab marketplace cards (₱99 / ₱199 / ₱299). */
const PLAN_DISPLAY_MONTHLY: Record<PlanKey, number> = {
  basic: 99,
  standard: 199,
  premium: 299,
};

type ViewMode = "discover" | "success";

type SubscriptionSnapshot = {
  tier: string | null;
  accessReason: string | null;
  isTrial: boolean;
  status: string | null;
  isExpired: boolean;
  daysRemaining: number | null;
};

type PlanCard = {
  key: PlanKey;
  name: string;
  apiPlanId: string | null;
  monthlyPrice: number;
  description: string;
  isCurrent: boolean;
};

type BizcardOption = {
  serialId: string;
  name: string;
};

type OpenDetail = {
  source?: string;
  view?: ViewMode;
};

function resolvePlanKey(name: string | null | undefined): PlanKey | null {
  if (!name) return null;
  const normalized = name.trim().toLowerCase();
  if (normalized.includes("basic")) return "basic";
  if (normalized.includes("standard")) return "standard";
  if (normalized.includes("premium")) return "premium";
  return null;
}

function resolveCurrentPlanKey(snapshot: SubscriptionSnapshot): PlanKey | "free_trial" | null {
  const tier = String(snapshot.tier ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const reason = String(snapshot.accessReason ?? "").trim().toLowerCase();

  if (
    tier === "free_trial" ||
    reason === "free_trial" ||
    (tier === "none" && (snapshot.isTrial || reason === "free_trial"))
  ) {
    return "free_trial";
  }
  if (tier === "basic") return "basic";
  if (tier === "standard") return "standard";
  if (tier === "premium") return "premium";
  return null;
}

function formatPhp(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(amount);
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

function generateIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureCsrfToken(apiBase: string): Promise<string | null> {
  const fromCookie = readCookie(CSRF_COOKIE_NAME);
  if (fromCookie) return fromCookie;
  try {
    const response = await fetch(`${apiBase}/api/csrf-token`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return readCookie(CSRF_COOKIE_NAME);
    const payload = await response.json().catch(() => null);
    const data =
      payload?.data && typeof payload.data === "object" ? payload.data : null;
    const token =
      payload?.csrfToken ||
      payload?.csrf_token ||
      payload?.token ||
      (data && (data as Record<string, unknown>).csrfToken) ||
      null;
    return String(token || "").trim() || readCookie(CSRF_COOKIE_NAME);
  } catch {
    return readCookie(CSRF_COOKIE_NAME);
  }
}

async function authFetch(
  apiBase: string,
  url: string,
  init: RequestInit = {},
  canRetry = true,
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(buildImpersonationHeaders());
  if (init.headers) {
    new Headers(init.headers).forEach((value, key) => {
      headers.set(key, value);
    });
  }
  if (MUTATING_METHODS.has(method)) {
    const csrfToken = await ensureCsrfToken(apiBase);
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
    const refreshHeaders = new Headers(buildImpersonationHeaders());
    const refreshCsrf = await ensureCsrfToken(apiBase);
    if (refreshCsrf) refreshHeaders.set("X-CSRF-Token", refreshCsrf);
    const refreshResponse = await fetch(`${apiBase}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: refreshHeaders,
    });
    if (refreshResponse.ok) return fetch(url, requestInit);
  }
  return response;
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const raw = payload as Record<string, unknown>;
  if (typeof raw.error === "string" && raw.error.trim()) return raw.error;
  if (raw.error && typeof raw.error === "object") {
    const err = raw.error as Record<string, unknown>;
    if (typeof err.message === "string" && err.message.trim()) return err.message;
  }
  if (typeof raw.message === "string" && raw.message.trim()) return raw.message;
  return fallback;
}

const PREMIUM_THEME_PREVIEWS = THEME_FAMILIES.filter(
  (family) => family.tier === "premium" && family.id.startsWith("premium/"),
).slice(0, 3);

export function openPremiumUpgradeExperience(detail?: OpenDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(OPEN_EVENT, { detail: detail ?? {} }),
  );
}

export function clearPendingPremiumUpgrade() {
  try {
    window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}

export function markPendingPremiumUpgrade() {
  try {
    window.sessionStorage.setItem(PENDING_KEY, "1");
  } catch {
    // ignore
  }
}

type PremiumUpgradeExperienceProps = {
  enabled?: boolean;
};

export function PremiumUpgradeExperience({
  enabled = true,
}: PremiumUpgradeExperienceProps) {
  return (
    <Suspense fallback={null}>
      <PremiumUpgradeExperienceInner enabled={enabled} />
    </Suspense>
  );
}

function PremiumUpgradeExperienceInner({
  enabled = true,
}: PremiumUpgradeExperienceProps) {
  const API = getFrontendApiBaseUrl();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ViewMode>("discover");
  const [loading, setLoading] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [subscription, setSubscription] = useState<SubscriptionSnapshot | null>(
    null,
  );
  const [plans, setPlans] = useState<PlanCard[]>([]);
  const [bizcards, setBizcards] = useState<BizcardOption[]>([]);
  const [selectedSerial, setSelectedSerial] = useState<string | null>(null);
  const [previewFeature, setPreviewFeature] = useState<string | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setPreviewFeature(null);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [subRes, plansRes, bizRes] = await Promise.all([
        authFetch(API, `${API}/api/user/subscription`),
        authFetch(API, `${API}/api/marketplace/subscriptions/plans`),
        authFetch(API, `${API}/api/user/bizcards`),
      ]);

      let snapshot: SubscriptionSnapshot = {
        tier: null,
        accessReason: null,
        isTrial: false,
        status: null,
        isExpired: false,
        daysRemaining: null,
      };

      if (subRes.ok) {
        const payload = await subRes.json().catch(() => null);
        const data =
          payload?.data && typeof payload.data === "object"
            ? (payload.data as Record<string, unknown>)
            : null;
        if (data) {
          snapshot = {
            tier: data.tier != null ? String(data.tier) : null,
            accessReason:
              data.access_reason != null ? String(data.access_reason) : null,
            isTrial: Boolean(data.is_trial),
            status: data.status != null ? String(data.status) : null,
            isExpired: Boolean(data.is_expired),
            daysRemaining:
              data.days_remaining != null
                ? Number(data.days_remaining)
                : null,
          };
        }
      }
      setSubscription(snapshot);

      const currentKey = resolveCurrentPlanKey(snapshot);
      const isPremium = hasActivePremiumPlan({
        tier: snapshot.tier,
        accessReason: snapshot.accessReason,
        isTrial: snapshot.isTrial,
        status: snapshot.status,
        isExpired: snapshot.isExpired,
      });

      const planCards: PlanCard[] = [];
      if (plansRes.ok) {
        const plansPayload = await plansRes.json().catch(() => null);
        const rawPlans = Array.isArray(plansPayload?.data?.plans)
          ? plansPayload.data.plans
          : [];
        const byKey = new Map<PlanKey, PlanCard>();
        for (const plan of rawPlans) {
          const key = resolvePlanKey(String(plan?.name ?? ""));
          if (!key || byKey.has(key)) continue;
          byKey.set(key, {
            key,
            name:
              key === "basic"
                ? "Basic"
                : key === "standard"
                  ? "Standard"
                  : "Premium",
            apiPlanId: plan?.id != null ? String(plan.id) : null,
            // Match SubscriptionTab display pricing (not raw DB seed amounts).
            monthlyPrice: PLAN_DISPLAY_MONTHLY[key],
            description: String(plan?.description || "").trim(),
            isCurrent: currentKey === key,
          });
        }
        for (const key of ["basic", "standard", "premium"] as PlanKey[]) {
          const card = byKey.get(key);
          if (card) planCards.push(card);
        }
      }
      setPlans(planCards);

      const options: BizcardOption[] = [];
      if (bizRes.ok) {
        const bizPayload = await bizRes.json().catch(() => null);
        const list = Array.isArray(bizPayload?.data?.bizcards)
          ? bizPayload.data.bizcards
          : [];
        for (const card of list) {
          const serialId = String(card?.serial_id ?? "").trim();
          if (!serialId) continue;
          const name =
            String(card?.bizcard_name ?? "").trim() ||
            `${String(card?.first_name ?? "").trim()} ${String(card?.last_name ?? "").trim()}`.trim() ||
            serialId;
          options.push({ serialId, name });
        }
      }
      setBizcards(options);
      setSelectedSerial((prev) => {
        if (prev && options.some((o) => o.serialId === prev)) return prev;
        return options[0]?.serialId ?? null;
      });

      return { isPremium, snapshot };
    } catch {
      showToast("Unable to load Premium details. Please try again.", "error");
      return { isPremium: false, snapshot: null };
    } finally {
      setLoading(false);
    }
  }, [API]);

  const openDiscover = useCallback(async () => {
    const result = await loadData();
    if (result.isPremium) {
      setView("success");
      setOpen(true);
      return;
    }
    setView("discover");
    setOpen(true);
  }, [loadData]);

  const openSuccessIfPremium = useCallback(async () => {
    const result = await loadData();
    if (!result.isPremium) return false;
    clearPendingPremiumUpgrade();
    window.dispatchEvent(new CustomEvent(USER_SYNC_EVENT));
    setView("success");
    setOpen(true);
    return true;
  }, [loadData]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenDetail>).detail ?? {};
      if (detail.view === "success") {
        void openSuccessIfPremium();
        return;
      }
      void openDiscover();
    };

    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [enabled, openDiscover, openSuccessIfPremium]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const welcome = searchParams.get("premium_welcome");
    if (welcome === "1") {
      void (async () => {
        const shown = await openSuccessIfPremium();
        if (shown) {
          router.replace("/user/dashboard", { scroll: false });
        }
      })();
      return;
    }

    let pending = false;
    try {
      pending = window.sessionStorage.getItem(PENDING_KEY) === "1";
    } catch {
      pending = false;
    }
    if (pending) {
      void openSuccessIfPremium();
    }
  }, [enabled, openSuccessIfPremium, router, searchParams]);

  const handleUpgrade = async () => {
    if (upgrading) return;
    const premiumPlan = plans.find((p) => p.key === "premium");
    if (!premiumPlan?.apiPlanId) {
      showToast("Premium plan is unavailable right now.", "error");
      return;
    }
    if (!selectedSerial) {
      showToast("Add a BizCard before upgrading to Premium.", "error");
      return;
    }

    setUpgrading(true);
    try {
      markPendingPremiumUpgrade();
      const response = await authFetch(
        API,
        `${API}/api/marketplace/subscription/change-plan`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            planId: premiumPlan.apiPlanId,
            action: "upgrade",
            bizcardSerialId: selectedSerial,
          }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        clearPendingPremiumUpgrade();
        throw new Error(
          extractErrorMessage(payload, "Failed to start Premium upgrade."),
        );
      }
      if (payload.data?.invoiceUrl) {
        window.location.href = String(payload.data.invoiceUrl);
        return;
      }
      clearPendingPremiumUpgrade();
      window.dispatchEvent(new CustomEvent(USER_SYNC_EVENT));
      showToast(payload.message || "Welcome to Premium.", "success");
      setView("success");
    } catch (err) {
      clearPendingPremiumUpgrade();
      const message =
        err instanceof Error ? err.message : "Failed to start Premium upgrade.";
      showToast(message, "error");
    } finally {
      setUpgrading(false);
    }
  };

  if (!enabled) return null;

  const currentKey = subscription
    ? resolveCurrentPlanKey(subscription)
    : null;
  const isFreeTrial = currentKey === "free_trial";
  const trialDays =
    subscription?.daysRemaining != null && subscription.daysRemaining > 0
      ? subscription.daysRemaining
      : null;

  return (
    <ModalPortal isOpen={open} onClose={close}>
      <AnimatePresence mode="wait">
        {open ? (
          <motion.div
            key={view}
            role="dialog"
            aria-modal="true"
            aria-labelledby="premium-upgrade-title"
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="relative mx-3 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:mx-4"
          >
            <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-[#2A4792] via-[#3B569F] to-[#4785B8]" />
            <button
              type="button"
              onClick={close}
              aria-label="Close Premium experience"
              className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="overflow-y-auto px-5 pb-6 pt-7 sm:px-7">
              {view === "success" ? (
                <SuccessView
                  onExploreMissions={() => {
                    close();
                    router.push("/user/missions");
                  }}
                  onReturn={() => {
                    close();
                    router.push("/user/dashboard");
                  }}
                />
              ) : (
                <DiscoverView
                  loading={loading}
                  isFreeTrial={isFreeTrial}
                  trialDays={trialDays}
                  currentKey={currentKey}
                  plans={plans}
                  bizcards={bizcards}
                  selectedSerial={selectedSerial}
                  onSelectSerial={setSelectedSerial}
                  upgrading={upgrading}
                  previewFeature={previewFeature}
                  onPreviewFeature={setPreviewFeature}
                  onUpgrade={() => void handleUpgrade()}
                />
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </ModalPortal>
  );
}

function SuccessView({
  onExploreMissions,
  onReturn,
}: {
  onExploreMissions: () => void;
  onReturn: () => void;
}) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#EEF3FB]">
        <Sparkles className="h-7 w-7 text-[#2A4792]" aria-hidden />
      </div>
      <h2
        id="premium-upgrade-title"
        className="text-2xl font-bold tracking-tight text-slate-900"
      >
        Welcome to Premium
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        Your Premium experience is now unlocked.
      </p>
      <ul className="mx-auto mt-6 max-w-sm space-y-2.5 text-left">
        {[
          "Missions & Rewards",
          "Premium Themes",
          "Premium Features",
        ].map((item) => (
          <li
            key={item}
            className="flex items-center gap-2.5 text-sm text-slate-700"
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <Check className="h-3.5 w-3.5" aria-hidden />
            </span>
            {item}
          </li>
        ))}
      </ul>
      <div className="mt-7 flex flex-col gap-2">
        <button
          type="button"
          onClick={onExploreMissions}
          className="inline-flex w-full items-center justify-center rounded-xl bg-[#2A4792] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#243d7d]"
        >
          Explore Missions
        </button>
        <button
          type="button"
          onClick={onReturn}
          className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
        >
          Return to Dashboard
        </button>
      </div>
    </div>
  );
}

function DiscoverView({
  loading,
  isFreeTrial,
  trialDays,
  currentKey,
  plans,
  bizcards,
  selectedSerial,
  onSelectSerial,
  upgrading,
  previewFeature,
  onPreviewFeature,
  onUpgrade,
}: {
  loading: boolean;
  isFreeTrial: boolean;
  trialDays: number | null;
  currentKey: PlanKey | "free_trial" | null;
  plans: PlanCard[];
  bizcards: BizcardOption[];
  selectedSerial: string | null;
  onSelectSerial: (serial: string) => void;
  upgrading: boolean;
  previewFeature: string | null;
  onPreviewFeature: (id: string | null) => void;
  onUpgrade: () => void;

}) {

  const premiumPlan = plans.find((p) => p.key === "premium");
  const alreadyPremium = currentKey === "premium";
  return (
    <>
      <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-[#EEF3FB] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#2A4792]">
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        Premium
      </div>
      <h2
      
        id="premium-upgrade-title"
        className="pr-8 text-2xl font-bold tracking-tight text-slate-900"
      >
        Unlock the Full Ontap Experience
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        Unlock more ways to grow your network, showcase your business, and earn
        exclusive rewards.
      </p>

      {isFreeTrial && trialDays != null ? (
        <p className="mt-3 rounded-xl border border-[#D5DDEF] bg-[#EEF2FA] px-3 py-2 text-xs font-medium text-[#2A4792]">
          Your free trial has {trialDays} day{trialDays === 1 ? "" : "s"}{" "}
          remaining. Explore Premium features available after upgrade.
        </p>
      ) : null}

      {loading ? (
        <div className="mt-6 space-y-3">
          <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
          <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
          <div className="h-32 animate-pulse rounded-xl bg-slate-100" />
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <FeaturePreviewCard
              id="missions"
              icon={<Trophy className="h-5 w-5" />}
              title="Missions & Rewards"
              description="Build your network, complete missions, and unlock exclusive rewards."
              previewOpen={previewFeature === "missions"}
              onToggle={() =>
                onPreviewFeature(
                  previewFeature === "missions" ? null : "missions",
                )
              }
            >
              <div className="space-y-2 rounded-lg bg-slate-50 p-2.5">
                <div className="h-2 w-[75%] rounded-full bg-[#D5DDEF]" />
                <div className="h-8 rounded-lg border border-dashed border-[#A8B8D9] bg-white px-2 py-1.5 text-[11px] text-slate-500">
                  Mission progress preview
                </div>
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#2A4792]">
                  <Gift className="h-3.5 w-3.5" />
                  Rewards unlock with referrals
                </div>
              </div>

            </FeaturePreviewCard>
            <FeaturePreviewCard
              id="themes"
              icon={<LayoutTemplate className="h-5 w-5" />}
              title="Premium Themes"
              description="Unlock premium and exclusive themes for your digital business card."
              previewOpen={previewFeature === "themes"}
              onToggle={() =>
                onPreviewFeature(previewFeature === "themes" ? null : "themes")
              }
            >
              <div className="grid grid-cols-3 gap-1.5">
                {PREMIUM_THEME_PREVIEWS.map((theme) => (
                  <div
                    key={theme.id}
                    className="rounded-lg border border-slate-200 bg-gradient-to-br from-[#EEF2FA] to-[#D5DDEF] px-1.5 py-2 text-center"
                  >
                    <p className="truncate text-[9px] font-semibold text-[#2A4792]">
                      {theme.name}
                    </p>
                  </div>
                ))}
              </div>
            </FeaturePreviewCard>

            <FeaturePreviewCard
              id="features"
              icon={<Sparkles className="h-5 w-5" />}
              title="Exclusive Features"
              description="Inquiry inbox, company tools, and advanced analytics reserved for Premium."
              previewOpen={previewFeature === "features"}
              onToggle={() =>
                onPreviewFeature(
                  previewFeature === "features" ? null : "features",
                )
              }
            >
              <ul className="space-y-1.5 text-[11px] text-slate-600">
                <li className="rounded-md bg-slate-50 px-2 py-1.5">
                  Portfolio inquiries
                </li>
                <li className="rounded-md bg-slate-50 px-2 py-1.5">
                  Company management
                </li>
                <li className="rounded-md bg-slate-50 px-2 py-1.5">
                  Real-time analytics
                </li>
              </ul>
            </FeaturePreviewCard>
          </div>

          <div className="mt-7">
            <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">
              Choose your plan
            </h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {plans.map((plan) => {
                const isPremiumCard = plan.key === "premium";
                const isCurrent = plan.isCurrent || currentKey === plan.key;
                return (
                  <div
                    key={plan.key}
                    className={`relative rounded-2xl border p-4 transition ${
                      isPremiumCard
                        ? "border-[#2A4792] bg-[#F7F9FD] shadow-md shadow-[#2A4792]/10"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    {isPremiumCard ? (
                      <span className="absolute -top-2.5 right-3 rounded-full bg-[#2A4792] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                        Recommended
                      </span>
                    ) : null}
                    <p className="text-sm font-bold text-slate-900">
                      {plan.name}
                    </p>
                    <p className="mt-1 text-lg font-extrabold text-[#2A4792]">
                      {plan.monthlyPrice > 0
                        ? `${formatPhp(plan.monthlyPrice)}`
                        : "—"}
                      {plan.monthlyPrice > 0 ? (
                        <span className="text-xs font-medium text-slate-500">
                          /mo
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                      {isCurrent
                        ? "Current Plan"
                        : isPremiumCard
                          ? "Full Ontap experience"
                          : "Available"}
                    </p>
                    {plan.description ? (
                      <p className="mt-2 line-clamp-2 text-[11px] text-slate-500">
                        {plan.description}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          {bizcards.length > 1 ? (
            <div className="mt-5">
              <label
                htmlFor="premium-bizcard-select"
                className="text-xs font-semibold text-slate-600"
              >
                BizCard to upgrade
              </label>
              <select
                id="premium-bizcard-select"
                value={selectedSerial ?? ""}
                onChange={(e) => onSelectSerial(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-[#2A4792] focus:ring-2 focus:ring-[#2A4792]/20"
              >
                {bizcards.map((card) => (
                  <option key={card.serialId} value={card.serialId}>
                    {card.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {bizcards.length === 0 ? (
            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              You need a BizCard before upgrading.{" "}
              <Link
                href="/user/emarket"
                className="font-semibold underline underline-offset-2"
              >
                Go to e-market
              </Link>
            </div>
          ) : null}

          <div className="mt-6">
            {alreadyPremium ? (
              <p className="text-center text-sm font-semibold text-[#2A4792]">
                You&apos;re a Premium Member
              </p>
            ) : (
              <button
                type="button"
                disabled={
                  upgrading || !premiumPlan?.apiPlanId || bizcards.length === 0
                }
                onClick={onUpgrade}
                className="inline-flex w-full items-center justify-center rounded-xl bg-[#2A4792] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#243d7d] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {upgrading
                  ? "Starting checkout…"
                  : isFreeTrial
                    ? "Upgrade to Premium"
                    : "Upgrade to Premium"}
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}

function FeaturePreviewCard({
  id,
  icon,
  title,
  description,
  previewOpen,
  onToggle,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  description: string;
  previewOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm transition hover:border-[#A8B8D9]">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#EEF3FB] text-[#2A4792]">
        {icon}
      </div>
      <h4 className="mt-3 text-sm font-bold text-slate-900">{title}</h4>
      <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
        {description}
      </p>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={previewOpen}
        aria-controls={`premium-preview-${id}`}
        className="mt-3 text-xs font-bold text-[#2A4792] hover:text-[#1c2763]"
      >
        {previewOpen ? "Hide preview" : "Preview"}
      </button>
      <AnimatePresence>
        {previewOpen ? (
          <motion.div
            id={`premium-preview-${id}`}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-2.5">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
