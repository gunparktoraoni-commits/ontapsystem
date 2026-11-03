"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Sparkles, X } from "lucide-react";
import RecentBizCardSidebar from "./RecentBizCardSidebar";
import SidebarPromoSlider from "./SidebarPromoSlider";
import MobileBottomNav from "./MobileBottomNav";
import { getFrontendApiBaseUrl } from "./apiBase";
import { withImpersonationHeaders } from "../lib/superadminImpersonationHandoff";
import {
  type PortalKey,
  type PortalNavEntry,
  type PortalNavItem,
  getBizcardClickPath,
  isNavGroup,
} from "../config/portalNavigation";
import { hasActivePremiumPlan } from "./subscriptionAccess";
import { openPremiumUpgradeExperience } from "./premium/PremiumUpgradeExperience";

const USER_SYNC_EVENT = "ontap:user-sync";
const DEFAULT_DISPLAY_NAME = "User";
const SIDEBAR_PREMIUM_PROMO_DISMISS_KEY = "ontap:sidebar-premium-promo-dismissed";

function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Maps /api/user/subscription fields to the sidebar plan label. */
function resolveSubscriptionPlanLabel(input: {
  tier?: string | null;
  accessReason?: string | null;
  isTrial?: boolean;
}): string | null {
  const tier = String(input.tier ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const reason = String(input.accessReason ?? "").trim().toLowerCase();
  const isTrial = Boolean(input.isTrial);

  if (
    tier === "free_trial" ||
    reason === "free_trial" ||
    (tier === "none" && (isTrial || reason === "free_trial"))
  ) {
    return "Free Trial";
  }

  if (tier === "basic") return "Basic";
  if (tier === "standard") return "Standard";
  if (tier === "premium") return "Premium";
  return null;
}

function readPremiumPromoDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_PREMIUM_PROMO_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}


function writePremiumPromoDismissed() {
  try {
    window.localStorage.setItem(SIDEBAR_PREMIUM_PROMO_DISMISS_KEY, "1");
  } catch {
    // ignore storage errors
  }
}

function FreeTrialGemIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <polygon
        points="32,4 58,24 48,58 16,58 6,24"
        fill="url(#gem-grad)"
        stroke="url(#gem-stroke)"
        strokeWidth="2"
      />
      <polygon points="32,4 22,24 42,24" fill="#FFD97D" opacity="0.9" />
      <polygon points="22,24 16,58 32,58 32,24" fill="#F5A623" opacity="0.7" />
      <polygon points="42,24 32,24 32,58 48,58" fill="#F7C948" opacity="0.8" />
      <polygon points="6,24 22,24 16,58" fill="#E8972C" opacity="0.55" />
      <polygon points="58,24 42,24 48,58" fill="#FADB5F" opacity="0.55" />
      <defs>
        <linearGradient id="gem-grad" x1="32" y1="0" x2="32" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFD97D" />
          <stop offset="1" stopColor="#F5A623" />
        </linearGradient>
        <linearGradient id="gem-stroke" x1="32" y1="0" x2="32" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FADB5F" />
          <stop offset="1" stopColor="#E8972C" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function formatTrialEndDate(expiresAt: string): string {
  try {
    const date = new Date(expiresAt);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function UserSubscriptionStatusIndicator() {
  const [planLabel, setPlanLabel] = useState<string | null>(null);
  const [isPremium, setIsPremium] = useState(false);
  const [isFreeTrial, setIsFreeTrial] = useState(false);
  const [daysRemaining, setDaysRemaining] = useState<number | null>(null);
  const [trialEndDate, setTrialEndDate] = useState<string | null>(null);
  const [promoDismissed, setPromoDismissed] = useState(false);

  useEffect(() => {
    setPromoDismissed(readPremiumPromoDismissed());
  }, []);

  const loadPlan = useCallback(async () => {
    try {
      const response = await fetch(
        `${getFrontendApiBaseUrl()}/api/user/subscription`,
        {
          method: "GET",
          cache: "no-store",
          credentials: "include",
          headers: withImpersonationHeaders(),
        },
      );
      if (!response.ok) {
        setPlanLabel(null);
        setIsPremium(false);
        setIsFreeTrial(false);
        setDaysRemaining(null);
        setTrialEndDate(null);
        return;
      }
      const payload = (await response.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      const data =
        payload?.data && typeof payload.data === "object"
          ? (payload.data as Record<string, unknown>)
          : null;

      const label = resolveSubscriptionPlanLabel({
        tier: data?.tier != null ? String(data.tier) : null,
        accessReason:
          data?.access_reason != null ? String(data.access_reason) : null,
        isTrial: Boolean(data?.is_trial),
      });
      setPlanLabel(label);
      setIsFreeTrial(label === "Free Trial");
      setDaysRemaining(
        data?.days_remaining != null && Number.isFinite(Number(data.days_remaining))
          ? Number(data.days_remaining)
          : null,
      );
      setTrialEndDate(
        data?.expires_at != null ? String(data.expires_at) : null,
      );
      setIsPremium(
        hasActivePremiumPlan({
          tier: data?.tier != null ? String(data.tier) : null,
          accessReason:
            data?.access_reason != null ? String(data.access_reason) : null,
          isTrial: Boolean(data?.is_trial),
          status: data?.status != null ? String(data.status) : null,
          isExpired: Boolean(data?.is_expired),
        }),
      );
    } catch {
      setPlanLabel(null);
      setIsPremium(false);
      setIsFreeTrial(false);
      setDaysRemaining(null);
      setTrialEndDate(null);
    }
  }, []);

  useEffect(() => {
    void loadPlan();
    window.addEventListener(USER_SYNC_EVENT, loadPlan);
    window.addEventListener("focus", loadPlan);
    return () => {
      window.removeEventListener(USER_SYNC_EVENT, loadPlan);
      window.removeEventListener("focus", loadPlan);
    };
  }, [loadPlan]);

  if (!planLabel) return null;

  const statusLine = (() => {
    if (isPremium) return "Active";
    if (
      isFreeTrial &&
      daysRemaining != null &&
      daysRemaining >= 0
    ) {
      return `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} remaining`;
    }
    return "Current plan";
  })();

  const showPromo = !isPremium && !promoDismissed;

  const dismissPromo = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    writePremiumPromoDismissed();
    setPromoDismissed(true);
  };

  const formattedEndDate = trialEndDate ? formatTrialEndDate(trialEndDate) : null;

  return (
    <div className="shrink-0 px-3 pb-4 pt-1">
      {isPremium ? (
        <div className="space-y-2">
          <div
            className="flex items-center gap-2.5 rounded-xl border border-[#c5d0e0] bg-[#edf2f7] px-2.5 py-2"
            title={`${planLabel} plan`}
            aria-label={`Subscription status: ${planLabel} Active`}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1a365d]">
              <Sparkles className="h-4 w-4 text-white" aria-hidden={true} />
            </span>
            <span className="min-w-0 flex flex-col leading-tight">
              <span className="truncate text-[11px] font-bold uppercase tracking-wide text-[#1a365d]">
                {planLabel}
              </span>
              <span className="text-[11px] font-medium text-[#1a365d]">
                Active
              </span>
            </span>
          </div>
          <Link
            href="/user/missions"
            className="block px-1 text-[11px] font-semibold text-[#1a365d]/80 transition hover:text-[#1a365d]"
          >
            Explore Missions
          </Link>
        </div>
      ) : isFreeTrial && showPromo ? (
        <div
          className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-[#4C6BC1] via-[#5A7AD4] to-[#7B93E4] px-4 pb-4 pt-5 shadow-lg shadow-black/20"
          aria-label="Free trial status — Upgrade to Premium"
        >
          <div className="pointer-events-none absolute -right-4 -top-4 h-24 w-24 rounded-full bg-white/[0.06]" />
          <div className="pointer-events-none absolute -bottom-6 -left-6 h-20 w-20 rounded-full bg-white/[0.04]" />

          <button
            type="button"
            onClick={dismissPromo}
            className="absolute right-2 top-2 z-10 rounded-md p-1 text-white/40 transition hover:bg-white/10 hover:text-white/70"
            aria-label="Dismiss free trial promotion"
          >
            <X className="h-3.5 w-3.5" aria-hidden={true} />
          </button>

          <div className="relative flex flex-col items-center text-center">
            <FreeTrialGemIcon className="h-10 w-10 drop-shadow-md" />

            <h3 className="mt-3 text-[13px] font-bold leading-tight text-white">
              Upgrade to Premium
            </h3>

            {formattedEndDate && (
              <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-white/90 backdrop-blur-sm">
                Trial ends {formattedEndDate}
              </span>
            )}

            <p className="mt-2 text-[11px] leading-snug text-white/80">
              {daysRemaining != null && daysRemaining >= 0
                ? `Your ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} free trial will end soon`
                : "Your free trial will end soon"}
            </p>

            <button
              type="button"
              onClick={() => openPremiumUpgradeExperience({ source: "sidebar" })}
              className="mt-3 w-full rounded-xl border-2 border-white/30 bg-white/15 px-3 py-2 text-[12px] font-bold text-white backdrop-blur-sm transition hover:border-white/50 hover:bg-white/25 active:scale-[0.97]"
            >
              View Plans
            </button>
          </div>
        </div>
      ) : showPromo ? (
        <div
          className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-[#4C6BC1] via-[#5A7AD4] to-[#7B93E4] px-4 pb-4 pt-5 shadow-lg shadow-black/20"
          aria-label={`Subscription status: ${planLabel}. Upgrade to Premium.`}
        >
          <div className="pointer-events-none absolute -right-4 -top-4 h-24 w-24 rounded-full bg-white/[0.06]" />
          <div className="pointer-events-none absolute -bottom-6 -left-6 h-20 w-20 rounded-full bg-white/[0.04]" />

          <button
            type="button"
            onClick={dismissPromo}
            className="absolute right-2 top-2 z-10 rounded-md p-1 text-white/40 transition hover:bg-white/10 hover:text-white/70"
            aria-label="Dismiss Premium promotion"
          >
            <X className="h-3.5 w-3.5" aria-hidden={true} />
          </button>

          <div className="relative flex flex-col items-center text-center">
            <FreeTrialGemIcon className="h-10 w-10 drop-shadow-md" />

            <h3 className="mt-3 text-[13px] font-bold leading-tight text-white">
              Upgrade to Premium
            </h3>

            {planLabel && (
              <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-white/90 backdrop-blur-sm">
                Current plan: {planLabel}
              </span>
            )}

            <p className="mt-2 text-[11px] leading-snug text-white/80">
              Unlock Premium themes, missions &amp; exclusive features
            </p>

            <button
              type="button"
              onClick={() => openPremiumUpgradeExperience({ source: "sidebar" })}
              className="mt-3 w-full rounded-xl border-2 border-white/30 bg-white/15 px-3 py-2 text-[12px] font-bold text-white backdrop-blur-sm transition hover:border-white/50 hover:bg-white/25 active:scale-[0.97]"
            >
              View Plans
            </button>
          </div>
        </div>
      ) : (
        <div
          className="flex items-center gap-2.5 rounded-xl border border-[#c5d0e0] bg-[#edf2f7] px-2.5 py-2"
          title={`${planLabel} plan`}
          aria-label={`Subscription status: ${planLabel}`}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1a365d]">
            <Sparkles className="h-4 w-4 text-white" aria-hidden={true} />
          </span>
          <span className="min-w-0 flex flex-col leading-tight">
            <span className="truncate text-[11px] font-bold uppercase tracking-wide text-[#1a365d]">
              {planLabel}
            </span>
            <span className="text-[11px] font-medium text-[#1a365d]">
              {statusLine}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

export type PortalSidebarProps = {
  portal: PortalKey;
  navItems: PortalNavItem[];
  navEntries?: PortalNavEntry[];
  open: boolean;
  onClose: () => void;
  /** Desktop-only: when true the sidebar collapses to an icon-rail (w-16). Mobile is unaffected. */
  collapsed?: boolean;
  roleBadge?: string | null;
  defaultDisplayName?: string;
};

function NavLinkItem({
  item,
  pathname,
  collapsed,
  indented = false,
}: {
  item: PortalNavItem;
  pathname: string;
  collapsed: boolean;
  indented?: boolean;
}) {
  const isActive = isNavActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      draggable={false}
      title={collapsed ? item.label : undefined}
      className={`relative flex items-center rounded-lg text-sm transition-all duration-200 group ${
        collapsed
          ? "justify-center px-0 py-2.5 lg:px-0"
          : indented
            ? "gap-3 px-3 py-2.5 pl-6"
            : "gap-3 px-3 py-2.5"
      } ${
        isActive
          ? "bg-white/18 text-white font-semibold"
          : "text-white/65 font-medium hover:bg-white/8 hover:text-white"
      }`}
    >
      {isActive && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.75 h-5 bg-[#6BBAEB] rounded-r-full" />
      )}
      <item.icon
        className={`h-4.5 w-4.5 shrink-0 transition-colors duration-200 ${
          isActive
            ? "text-[#7EC8F0]"
            : "text-white/50 group-hover:text-white/80"
        }`}
      />
      <span
        className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${
          collapsed ? "lg:hidden" : ""
        }`}
      >
        {item.label}
      </span>
    </Link>
  );
}

export default function PortalSidebar({
  portal,
  navItems,
  navEntries,
  open,
  onClose,
  collapsed = false,
  roleBadge = null,
  defaultDisplayName: _defaultDisplayName = DEFAULT_DISPLAY_NAME,
}: PortalSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    onClose();
  }, [pathname]); 

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 1024) onClose();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [onClose]);

  const handleCardClick = (target: { bizcardId: string; serialId: string }) => {
    router.push(getBizcardClickPath(portal, target));
  };

  const desktopWidthClass = collapsed ? "lg:w-16" : "lg:w-55";
  const showUserPlanStatus = portal === "user" && !collapsed;

  return (
    <>
 
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-[7998] lg:hidden"
          aria-hidden="true"
          onClick={onClose}
        />
      )}

      <aside
        className={[
          // Base: fixed, full height, flex column, on top of everything
          "fixed top-0 left-0 h-screen flex flex-col z-[7999]",
          // Width: mobile always full sidebar (w-55), desktop respects collapsed
          "w-55",
          desktopWidthClass,
          // Slide transition for transform AND width
          "transition-[transform,width] duration-300 ease-in-out overflow-hidden",
          // Background gradient + shadow
          "bg-linear-to-b from-[#192d68] via-[#1e3578] to-[#2a4792]",
          "shadow-[4px_0_24px_rgba(0,0,0,0.3)]",
          // Mobile: hide off-screen when closed; Desktop: always visible (translate-x-0)
          open ? "translate-x-0" : "-translate-x-full",
          "lg:translate-x-0",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {/* Logo — show full logo when expanded, icon only when collapsed */}
        <div
          className={`flex items-center border-b border-white/8 shrink-0 transition-all duration-300 ${
            collapsed
              ? "justify-center px-2 pt-4 pb-3 lg:pt-4 lg:pb-3"
              : "justify-center px-5 pt-6 pb-4"
          }`}
        >
          <img
            src="/logotap.png"
            alt="OnTap Logo"
            width={160}
            height={80}
            className={`transition-all duration-300 object-contain ${
              collapsed ? "h-8 w-auto lg:h-8" : "h-20 w-auto"
            }`}
            draggable={false}
            decoding="async"
          />
        </div>

        {/* Mobile close — interactive edge tab */}
        <button
          type="button"
          onClick={onClose}
          className="group lg:hidden absolute top-[11%] -right-3 z-50 flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-[#5BA3D9] via-[#4785B8] to-[#2A4792] text-white shadow-[0_6px_18px_rgba(25,45,104,0.55)] ring-[3px] ring-white/90 transition-all duration-200 hover:scale-110 hover:from-[#6BB3E8] hover:to-[#1e3578] hover:shadow-[0_8px_22px_rgba(42,71,146,0.65)] hover:ring-[#D5DDEF] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label="Close menu"
        >
          <span className="absolute inset-0 rounded-full bg-white/20 opacity-0 transition-opacity duration-200 group-hover:opacity-100" aria-hidden="true" />
          <X className="relative h-5 w-5 stroke-[2.75] transition-transform duration-200 group-hover:rotate-90" />
        </button>
        {/* Navigation */}
        <nav className="hidden w-full flex-1 flex-col space-y-0.5 overflow-y-auto overflow-x-hidden px-1.5 pt-3 pb-2 lg:flex">
          {/* Recent BizCard — only show when sidebar is expanded and not superadmin */}
          {!collapsed && portal !== "superadmin" && (
            <RecentBizCardSidebar
              onCardClick={handleCardClick}
              className="mb-2"
            />
          )}

          {(navEntries ?? navItems).map((entry) => {
            if (isNavGroup(entry)) {
            return (
                <div key={entry.label} className="pt-1.5">
                  <div
                    className={`flex items-center py-1.5 text-xs font-semibold uppercase tracking-wide text-white/40 ${
                      collapsed ? "justify-center px-0 lg:px-0" : "gap-3 px-3"
                    }`}
                    title={collapsed ? entry.label : undefined}
                  >
                    <entry.icon className="h-4 w-4 shrink-0" />
                <span
                      className={`whitespace-nowrap overflow-hidden ${
                    collapsed ? "lg:hidden" : ""
                  }`}
                >
                      {entry.label}
                </span>
                  </div>
                  {entry.items.map((item) => (
                    <NavLinkItem
                      key={item.href}
                      item={item}
                      pathname={pathname}
                      collapsed={collapsed}
                      indented={!collapsed}
                    />
                  ))}
                </div>
              );
            }
            return (
              <NavLinkItem
                key={entry.href}
                item={entry}
                pathname={pathname}
                collapsed={collapsed}
              />
            );
          })}
        </nav>

        {/* Promo slider — hidden when collapsed or no active promos exist */}
        {!collapsed && <SidebarPromoSlider />}

        {roleBadge ? (
          <>
        <div className="mx-3 h-px bg-white/8 shrink-0" />
        <div className={`py-4 shrink-0 ${collapsed ? "px-1.5" : "px-4"}`}>
              <div className="flex justify-center">
                <span className="inline-flex items-center rounded-full bg-[#4CAF50] px-3 py-1 text-[11px] font-semibold text-white shadow-sm">
                  {roleBadge}
                </span>
              </div>
            </div>
          </>
        ) : null}

        {/* User subscription plan status — bottom of user sidebar only */}
        {showUserPlanStatus ? <UserSubscriptionStatusIndicator /> : null}
      </aside>
      <MobileBottomNav items={navItems} />
    </>
  );
}
