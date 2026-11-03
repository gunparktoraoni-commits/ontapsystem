"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import { getFrontendApiBaseUrl } from "../../components/apiBase";
import MobileBottomNav from "../../components/MobileBottomNav";
import { STAFF_NAV_ITEMS } from "../../config/portalNavigation";
import { getBizcardClickPath } from "../../config/portalNavigation";
import { useOptionalPortalPageAccess } from "../../components/PortalPageAccessProvider";
import {
  fetchSubscriptionState,
  type FrontendAccessReason,
} from "../../components/subscriptionAccess";
import {
  BIZCARD_ACCESSED_EVENT,
  getLastAccessedBizcards,
  resolveBizcardDisplayName,
  type LastAccessedBizcard,
} from "../../lib/lastAccessedBizcard";
import {
  PORTFOLIO_REFRESH_STORAGE_KEY,
  USER_SYNC_EVENT,
  readPortfolioTheme,
} from "../../lib/bizcardThemeSync";
import { normalizePortfolioThemeId } from "../../themes/ThemeLoader";
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

const API = getFrontendApiBaseUrl();
const USER_SYNC = "ontap:user-sync";

type Bizcard = LastAccessedBizcard;

type IdentityInfo = {
  fullName: string;
  email: string;
  profileImage: string;
};

type AccessNotice = {
  hasAccess: boolean;
  reason: FrontendAccessReason;
};

type SidebarThemeResolve = {
  family: string;
  cardTheme?: string;
};

const themeComponents: Record<string, React.ComponentType<any>> = {
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

const SIDEBAR_THEME_RESOLVE: Record<string, SidebarThemeResolve> = {
  "elegant-dark": { family: "elegant-dark", cardTheme: "original" },
  "elegant-dark-v2": { family: "elegant-dark", cardTheme: "v2" },
  "elegant-dark-v3": { family: "elegant-dark", cardTheme: "v3" },
  "modern-minimalist": { family: "modern-minimalist", cardTheme: "charcoal-yellow" },
  "charcoal-yellow": { family: "modern-minimalist", cardTheme: "charcoal-yellow" },
  "light-blue": { family: "modern-minimalist", cardTheme: "light-blue" },
  "ocean-blue": { family: "modern-minimalist", cardTheme: "ocean-blue" },
  "simple-classico": { family: "simple-classico", cardTheme: "green-gold" },
  "green-gold": { family: "simple-classico", cardTheme: "green-gold" },
  "blue-red": { family: "simple-classico", cardTheme: "blue-red" },
  "hot-orange": { family: "simple-classico", cardTheme: "hot-orange" },
  "bubble-glass": { family: "floral-madness", cardTheme: "rose-bloom" },
  "floral-madness": { family: "floral-madness", cardTheme: "rose-bloom" },
  "rose-bloom": { family: "floral-madness", cardTheme: "rose-bloom" },
  "hibiscus-dusk": { family: "floral-madness", cardTheme: "hibiscus-dusk" },
  "jasmine-mist": { family: "floral-madness", cardTheme: "jasmine-mist" },
  "candy-flush": { family: "floral-madness", cardTheme: "rose-bloom" },
  "snow-contrast": { family: "floral-madness", cardTheme: "jasmine-mist" },
  "fiery-sunset": { family: "floral-madness", cardTheme: "hibiscus-dusk" },
  "ocean-gradient": { family: "ocean-gradient", cardTheme: "teal" },
  "ocean-gradient-v2": { family: "ocean-gradient", cardTheme: "green" },
  "ocean-gradient-v3": { family: "ocean-gradient", cardTheme: "orange" },
  "premium-gotham": { family: "premium-gotham", cardTheme: "carbon-diamond" },
  "carbon-diamond": { family: "premium-gotham", cardTheme: "carbon-diamond" },
  "void-purple": { family: "premium-gotham", cardTheme: "void-purple" },
  "timeless-gold": { family: "premium-gotham", cardTheme: "timeless-gold" },
  "royal-purple": { family: "royal-purple", cardTheme: "purple" },
  "royal-purple-v2": { family: "royal-purple", cardTheme: "teal" },
  "royal-purple-v3": { family: "royal-purple", cardTheme: "amber" },
  "luxurious-editorial": { family: "luxurious-editorial", cardTheme: "classic-gold" },
  "classic-gold": { family: "luxurious-editorial", cardTheme: "classic-gold" },
  "ocean-blue-gold": { family: "luxurious-editorial", cardTheme: "ocean-blue-gold" },
  "blue-gold": { family: "luxurious-editorial", cardTheme: "ocean-blue-gold" },
  "violet-pink": { family: "luxurious-editorial", cardTheme: "violet-pink" },
  "grainy-white": { family: "luxurious-editorial", cardTheme: "violet-pink" },
  "nouveau-riche": { family: "nouveau-riche", cardTheme: "blood-rose" },
  "pristine-gold": { family: "nouveau-riche", cardTheme: "pristine-gold" },
  "blood-rose": { family: "nouveau-riche", cardTheme: "blood-rose" },
  "minty-green": { family: "nouveau-riche", cardTheme: "minty-green" },
  "og-neumorphic": { family: "og-neumorphic", cardTheme: "ice" },
  "ice-variant": { family: "og-neumorphic", cardTheme: "ice" },
  "warm-pastel": { family: "og-neumorphic", cardTheme: "pastel" },
  "midnight-moon": { family: "og-neumorphic", cardTheme: "moon" },
};

function resolveMediaUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return `${API}${value}`;
  return value;
}

function extractIdentity(userLike: unknown): IdentityInfo {
  const u =
    userLike && typeof userLike === "object"
      ? (userLike as Record<string, unknown>)
      : {};

  const first = String(u.firstName ?? u.first_name ?? "").trim();
  const last = String(u.lastName ?? u.last_name ?? "").trim();
  const fullFallback = String(u.fullName ?? u.full_name ?? u.name ?? "").trim();

  return {
    fullName: [first, last].filter(Boolean).join(" ").trim() || fullFallback,
    email: String(u.email ?? "").trim(),
    profileImage: resolveMediaUrl(
      String(u.profileUrl ?? u.profile_url ?? u.profile_image ?? "").trim(),
    ),
  };
}

function getInitials(name: string, email: string): string {
  const safe = (name || "").trim();
  if (!safe) {
    const mail = email.trim();
    if (mail) return mail[0].toUpperCase();
    return "--";
  }
  return safe
    .split(/\s+/)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function readAuthUserIdentity(): IdentityInfo {
  if (typeof window === "undefined") {
    return { fullName: "", email: "", profileImage: "" };
  }
  try {
    const raw = localStorage.getItem("authUser");
    if (!raw) return { fullName: "", email: "", profileImage: "" };
    return extractIdentity(JSON.parse(raw));
  } catch {
    return { fullName: "", email: "", profileImage: "" };
  }
}

function patchAuthUser(patch: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem("authUser");
    const existing = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const merged = { ...existing, ...patch };
    const first = String(merged.firstName ?? merged.first_name ?? "").trim();
    const last = String(merged.lastName ?? merged.last_name ?? "").trim();
    const fullFallback = String(
      merged.fullName ?? merged.full_name ?? merged.name ?? "",
    ).trim();
    const fullName =
      [first, last].filter(Boolean).join(" ").trim() || fullFallback;
    merged.firstName = first;
    merged.lastName = last;
    merged.fullName = fullName;
    localStorage.setItem("authUser", JSON.stringify(merged));
  } catch {
    // ignore localStorage errors
  }
}

function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

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
  const alias = urlAlias?.trim();
  if (alias) {
    const fromPortfolio = readPortfolioTheme(alias);
    if (fromPortfolio) return fromPortfolio;
  }
  return card.bizcard_theme || "elegant-dark";
}

function resolveStaffSidebarTheme(themeId: string): SidebarThemeResolve {
  const normalized = normalizePortfolioThemeId(themeId) || themeId.trim().toLowerCase();
  if (SIDEBAR_THEME_RESOLVE[normalized]) {
    return SIDEBAR_THEME_RESOLVE[normalized];
  }
  if (themeComponents[normalized]) {
    return { family: normalized };
  }
  return SIDEBAR_THEME_RESOLVE["elegant-dark"];
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

function StaffSidebarBizCardPreview({
  onCardClick,
}: {
  onCardClick: (target: { bizcardId: string; serialId: string }) => void;
}) {
  const [bizcards, setBizcards] = useState<Bizcard[]>([]);
  const [currentBizcardIndex, setCurrentBizcardIndex] = useState(0);
  const [accessNotice, setAccessNotice] = useState<AccessNotice | null>(null);
  const [themeRevision, setThemeRevision] = useState(0);

  const refreshBizcards = useCallback(async () => {
    try {
      const res = await fetch(
        `${API}/api/user/bizcards?limit=5&sortBy=updated_at&sortDir=desc`,
        { credentials: "include", cache: "no-store" },
      );
      if (res.ok) {
        const data = await res.json();
        const cards = (data.data?.bizcards || []).map(mapApiCard);
        setBizcards(applyPortfolioThemes(cards));
        setCurrentBizcardIndex(0);
        setThemeRevision((prev) => prev + 1);
        return;
      }
      if (res.status === 401 || res.status === 403) {
        setBizcards([]);
        setCurrentBizcardIndex(0);
        return;
      }
    } catch {
      // fall through to local cache
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
      if (
        !event.key ||
        event.key === PORTFOLIO_REFRESH_STORAGE_KEY ||
        event.key.startsWith("portfolio_")
      ) {
        void refreshBizcards();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refreshBizcards]);

  if (bizcards.length === 0) return null;

  const currentBizcard = bizcards[currentBizcardIndex] ?? bizcards[0];
  const themePath = currentBizcard.bizcard_theme || "elegant-dark";
  const resolved = resolveStaffSidebarTheme(themePath);
  const ThemeComponent = themeComponents[resolved.family] ?? ElegantDark;
  const dateSource = currentBizcard.created_at || currentBizcard.accessed_at || "";

  const cardProps: {
    cardName: string;
    serialID: string;
    dateMade: string;
    isActive: boolean;
    onSideNav: boolean;
    theme?: string;
  } = {
    cardName:
      currentBizcard.bizcard_name || `BizCard ${currentBizcard.serial_id}`,
    serialID: currentBizcard.serial_id,
    dateMade: formatDate(dateSource),
    isActive: accessNotice?.hasAccess ?? false,
    onSideNav: true,
  };
  if (resolved.cardTheme) {
    cardProps.theme = resolved.cardTheme;
  }

  return (
    <div className="w-full min-h-40 flex flex-col gap-2 mb-2">
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

interface StaffSidebarProps {
  open: boolean;
  onClose: () => void;
}

export default function StaffSidebar({ open, onClose }: StaffSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const access = useOptionalPortalPageAccess();
  const navItems = access ? access.filterNavItems(STAFF_NAV_ITEMS) : STAFF_NAV_ITEMS;
  const [initials, setInitials] = useState("--");
  const [fullName, setFullName] = useState("Staff User");
  const [email, setEmail] = useState("");
  const [profileImage, setProfileImage] = useState("");

  useEffect(() => {
    const applyIdentity = (identity: IdentityInfo) => {
      const safeName = identity.fullName.trim();
      const safeEmail = identity.email.trim();
      const safeImage = resolveMediaUrl(identity.profileImage);
      const displayName = safeName || safeEmail || "Staff User";
      setFullName(displayName);
      setEmail(safeEmail);
      setInitials(getInitials(displayName, safeEmail));
      setProfileImage(safeImage);
    };

    const hydrateFromLocal = () => {
      const localIdentity = readAuthUserIdentity();
      if (
        localIdentity.fullName ||
        localIdentity.email ||
        localIdentity.profileImage
      ) {
        applyIdentity(localIdentity);
        return;
      }
      // Avoid portfolio_* / latestPortfolioAlias fallbacks — they can show another user's name.
    };

    const hydrateFromApi = async () => {
      try {
        const r = await fetch(`${API}/api/user/profile`, {
          credentials: "include",
          cache: "no-store",
        });
        if (!r.ok) return;

        const d = (await r.json()) as {
          success?: boolean;
          data?: Record<string, unknown>;
        };
        if (!d?.success || !d.data) return;

        const profileIdentity: IdentityInfo = {
          fullName: [
            String(d.data.first_name ?? "").trim(),
            String(d.data.last_name ?? "").trim(),
          ]
            .filter(Boolean)
            .join(" ")
            .trim(),
          email: String(d.data.email ?? "").trim(),
          profileImage: resolveMediaUrl(
            String(d.data.profile_image ?? "").trim(),
          ),
        };

        applyIdentity(profileIdentity);
        patchAuthUser({
          first_name: String(d.data.first_name ?? "").trim(),
          last_name: String(d.data.last_name ?? "").trim(),
          firstName: String(d.data.first_name ?? "").trim(),
          lastName: String(d.data.last_name ?? "").trim(),
          email: profileIdentity.email,
          profile_url: profileIdentity.profileImage,
          profile_image: profileIdentity.profileImage,
          profileUrl: profileIdentity.profileImage,
        });
      } catch {
        // ignore API errors
      }
    };

    const syncIdentity = () => {
      hydrateFromLocal();
      void hydrateFromApi();
    };

    syncIdentity();
    window.addEventListener(USER_SYNC, syncIdentity);
    window.addEventListener("focus", syncIdentity);
    
    return () => {

      window.removeEventListener(USER_SYNC, syncIdentity);

      window.removeEventListener("focus", syncIdentity);

    };

  }, []);

  useEffect(() => {
    onClose();
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 1024) onClose();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [onClose]);

  const handleCardClick = (target: { bizcardId: string; serialId: string }) => {

    router.push(getBizcardClickPath("staff", target));

  };

  return (
    <>
      {/* Mobile backdrop overlay — only shown when sidebar is open on small screens */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — always visible on desktop (lg+), slides in/out on mobile */}
      <aside
        className={`fixed top-0 left-0 h-screen w-55 flex flex-col z-50
          bg-linear-to-b from-[#192d68] via-[#1e3578] to-[#2a4792]
          shadow-[4px_0_24px_rgba(0,0,0,0.3)]
          transition-transform duration-300
          ${open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div className="flex items-center justify-center px-5 pt-6 pb-4 border-b border-white/8">
          <img src="/logotap.png" alt="OnTap Logo" width={160} height={80} className="h-20 w-auto" draggable={false} decoding="async" />
        </div>
        {/* Close button — interactive edge tab (mobile only) */}
        <button
          type="button"
          onClick={onClose}
          className="group lg:hidden absolute top-[11%] -right-3 z-50 flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-[#5BA3D9] via-[#4785B8] to-[#2A4792] text-white shadow-[0_6px_18px_rgba(25,45,104,0.55)] ring-[3px] ring-white/90 transition-all duration-200 hover:scale-110 hover:from-[#6BB3E8] hover:to-[#1e3578] hover:shadow-[0_8px_22px_rgba(42,71,146,0.65)] hover:ring-[#D5DDEF] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label="Close menu"
        >
          <span className="absolute inset-0 rounded-full bg-white/20 opacity-0 transition-opacity duration-200 group-hover:opacity-100" aria-hidden="true" />
          <X className="relative h-5 w-5 stroke-[2.75] transition-transform duration-200 group-hover:rotate-90" />
        </button>

        <nav className="hidden w-full flex-1 flex-col space-y-0.5 overflow-y-auto px-3 pt-3 pb-2 lg:flex">
          <StaffSidebarBizCardPreview onCardClick={handleCardClick} />

          {navItems.map((item) => {
            const isActive = isNavActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 group ${
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
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mx-4 h-px bg-white/8" />
        <div className="px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-[#3B6FA8] flex items-center justify-center text-white font-semibold text-sm shrink-0 ring-2 ring-white/20 overflow-hidden">
              {profileImage ? (
                <img
                  src={profileImage}
                  alt="Sidebar avatar"
                  width={36}
                  height={36}
                  className="h-full w-full object-cover"
                  draggable={false}
                  decoding="async"
                />
              ) : (
                initials
              )}
            </div>
            <div className="min-w-0">
              <p className="text-white text-sm font-semibold truncate">{fullName}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-white/55 text-xs truncate">
                  {email || "No email on file"}
                </span>
                <span className="px-1.5 py-0.5 rounded-full bg-[#4CAF50] text-white text-[10px] font-semibold shrink-0">
                  Staff
                </span>
              </div>
            </div>
          </div>
        </div>
      </aside>
      <MobileBottomNav items={navItems} />
    </>
  );
}
