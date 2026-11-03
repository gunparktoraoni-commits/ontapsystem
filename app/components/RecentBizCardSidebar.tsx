"use client";

import { useCallback, useEffect, useState } from "react";
import ElegantDark from "../themes/cards/ElegantDark";
import ModernMinimalist from "../themes/cards/ModernMinimalist";
import SimpleClassico from "../themes/cards/SimpleClassico";
import BubbleGlass from "../themes/cards/BubbleGlass";
import OceanGradient from "../themes/cards/OceanGradient";
import PremiumGotham from "../themes/cards/PremiumGotham";
import RoyalPurple from "../themes/cards/RoyalPurple";
import LuxuriousEditorial from "../themes/cards/LuxuriousEditorial";
import NouveauRiche from "../themes/cards/NouveauRiche";
import OgNeumorphic from "../themes/cards/OgNeumorphic";
import { getFrontendApiBaseUrl } from "./apiBase";
import {
  fetchSubscriptionState,
  type FrontendAccessReason,
} from "./subscriptionAccess";
import {
  BIZCARD_ACCESSED_EVENT,
  getLastAccessedBizcards,
  resolveBizcardDisplayName,
  type LastAccessedBizcard,
} from "../lib/lastAccessedBizcard";
import {
  PORTFOLIO_REFRESH_STORAGE_KEY,
  USER_SYNC_EVENT,
  resolveActiveCardTheme,
  resolveSidebarTheme,
} from "../lib/bizcardThemeSync";
import type { BizcardClickTarget } from "../config/portalNavigation";

const API = getFrontendApiBaseUrl();

type Bizcard = LastAccessedBizcard;

const themeComponents: Record<string, React.ComponentType<any>> = {
  "elegant-dark": ElegantDark,
  "modern-minimalist": ModernMinimalist,
  "simple-classico": SimpleClassico,
  "bubble-glass": BubbleGlass,
  "floral-madness": BubbleGlass,
  "ocean-gradient": OceanGradient,
  "premium-gotham": PremiumGotham,
  "royal-purple": RoyalPurple,
  "luxurious-editorial": LuxuriousEditorial,
  "nouveau-riche": NouveauRiche,
  "og-neumorphic": OgNeumorphic,
};

type AccessNotice = {
  hasAccess: boolean;
  reason: FrontendAccessReason;
};

function getAccessNoticeMessage(reason: FrontendAccessReason): string {
  if (reason === "trial_expired") {
    return "Free trial ended — subscribe to continue";
  }
  if (reason === "subscription_expired" || reason === "expired") {
    return "Subscription expired — upgrade to continue";
  }
  if (reason === "none") {
    return "No active subscription — choose a plan to continue";
  }
  return "Subscription expired — upgrade to continue";
}

function formatDate(raw: string) {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "N/A";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();
  return `${month}-${day}-${year}`;
}

function resolveCardTheme(card: Bizcard, urlAlias?: string): string {
  return resolveActiveCardTheme(card.bizcard_theme || "elegant-dark", urlAlias);
}

function mapApiCard(card: Record<string, unknown>): Bizcard & { url_alias?: string } {
  return {
    bizcard_id: String(card.bizcard_id ?? ""),
    serial_id: String(card.serial_id ?? ""),
    bizcard_name: resolveBizcardDisplayName(card),
    bizcard_theme: String(card.bizcard_theme ?? "elegant-dark"),
    created_at: String(card.created_at ?? ""),
    accessed_at: String(card.updated_at ?? card.created_at ?? new Date().toISOString()),
    url_alias: String(card.url_alias ?? ""),
  };
}

function applyPortfolioThemes(cards: Array<Bizcard & { url_alias?: string }>): Bizcard[] {
  return cards.map((card) => ({
    bizcard_id: card.bizcard_id,
    serial_id: card.serial_id,
    bizcard_name: card.bizcard_name,
    bizcard_theme: resolveCardTheme(card, card.url_alias),
    created_at: card.created_at,
    accessed_at: card.accessed_at,
  }));
}

type RecentBizCardSidebarProps = {
  onCardClick: (target: BizcardClickTarget) => void;
  className?: string;
};

export default function RecentBizCardSidebar({
  onCardClick,
  className = "",
}: RecentBizCardSidebarProps) {
  const [bizcards, setBizcards] = useState<Bizcard[]>([]);
  const [currentBizcardIndex, setCurrentBizcardIndex] = useState(0);
  const [accessNotice, setAccessNotice] = useState<AccessNotice | null>(null);
  const [themeRevision, setThemeRevision] = useState(0);

  const refreshBizcards = useCallback(async () => {
    try {
      const res = await fetch(
        `${API}/api/user/bizcards?limit=5&sortBy=updated_at&sortDir=desc`,
        {
          credentials: "include",
          cache: "no-store",
        },
      );
      if (res.ok) {
        const data = await res.json();
        const cards = (data.data?.bizcards || []).map(mapApiCard);
        setBizcards(applyPortfolioThemes(cards));
        setCurrentBizcardIndex(0);
        setThemeRevision((prev) => prev + 1);
        return;
      }
      // Auth lost / forbidden — drop any previous user's cards immediately.
      if (res.status === 401 || res.status === 403) {
        setBizcards([]);
        setCurrentBizcardIndex(0);
        return;
      }
    } catch (err) {
      console.error("Failed to fetch bizcards:", err);
    }

    const recent = applyPortfolioThemes(getLastAccessedBizcards());
    setBizcards(recent);
    setCurrentBizcardIndex(0);
    setThemeRevision((prev) => prev + 1);
  }, []);

  useEffect(() => {
    const fetchAccessNotice = async () => {
      try {
        const state = await fetchSubscriptionState(API);
        setAccessNotice({
          hasAccess: state.access.hasAccess,
          reason: state.access.reason,
        });
      } catch {
        setAccessNotice(null);
      }
    };

    const sync = () => {
      void refreshBizcards();
      void fetchAccessNotice();
    };

    sync();
    window.addEventListener(USER_SYNC_EVENT, sync);
    window.addEventListener(BIZCARD_ACCESSED_EVENT, sync);
    window.addEventListener("focus", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(USER_SYNC_EVENT, sync);
      window.removeEventListener(BIZCARD_ACCESSED_EVENT, sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("storage", sync);
    };
  }, [refreshBizcards]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === PORTFOLIO_REFRESH_STORAGE_KEY || event.key.startsWith("portfolio_")) {
        void refreshBizcards();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refreshBizcards]);

  if (bizcards.length === 0) return null;

  const currentBizcard = bizcards[currentBizcardIndex] ?? bizcards[0];
  const themePath = currentBizcard.bizcard_theme || "elegant-dark";
  const resolved = resolveSidebarTheme(themePath);
  const ThemeComponent = themeComponents[resolved.family] ?? ElegantDark;
  const dateSource =
    currentBizcard.created_at || currentBizcard.accessed_at || "";

  const cardProps: {
    cardName: string;
    serialID: string;
    dateMade: string;
    isActive: boolean;
    onSideNav: boolean;
    theme?: string;
  } = {
    cardName:
      currentBizcard.bizcard_name ||
      `BizCard ${currentBizcard.serial_id}`,
    serialID: currentBizcard.serial_id,
    dateMade: formatDate(dateSource),
    isActive: accessNotice?.hasAccess ?? false,
    onSideNav: true,
  };
  if (resolved.cardTheme) {
    cardProps.theme = resolved.cardTheme;
  }

  return (
    <div className={`w-full min-h-40 flex flex-col gap-2 ${className}`}>
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-primary-100 tracking-wide">
          Recently Accessed
        </h2>
        {bizcards.length > 1 && (
          <div className="flex gap-1.5">
            {bizcards.map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setCurrentBizcardIndex(idx)}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  idx === currentBizcardIndex
                    ? "w-4 bg-white"
                    : "w-1.5 bg-white/40 hover:bg-white/60"
                }`}
                aria-label={`Go to bizcard ${idx + 1}`}
              />
            ))}
          </div>
        )}
      </div>

      <div
        onClick={() =>
          onCardClick({
            bizcardId: currentBizcard.bizcard_id,
            serialId: currentBizcard.serial_id,
          })
        }
        className="cursor-pointer transition-all duration-200"
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onCardClick({
              bizcardId: currentBizcard.bizcard_id,
              serialId: currentBizcard.serial_id,
            });
          }
        }}
      >
        <ThemeComponent
          key={`${currentBizcard.bizcard_id}-${themePath}-${themeRevision}`}
          props={cardProps}
        />
      </div>

      {accessNotice && !accessNotice.hasAccess && (
        <p className="text-xs text-red-300 text-center mt-1">
          {getAccessNoticeMessage(accessNotice.reason)}
        </p>
      )}
    </div>
  );
}
