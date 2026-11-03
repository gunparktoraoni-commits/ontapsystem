"use client";

import React, { useState, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Sidebar from "../components/Sidebar";
import { AccountMenuLegalLinks } from "../components/legal/AccountMenuLegalLinks";
import { Settings, LogOut, Menu, MessageCircle, CalendarDays, Bell } from "lucide-react";
import Link from "next/link";
import { getFrontendApiBaseUrl } from "../components/apiBase";
import { FullPageLoader } from "../components/Loader";
import {
  fetchSubscriptionState,
  shouldRedirectToSubscription,
  getSubscriptionRedirectReason,
  getSubscriptionExpiryWarning,
  hasActivePremiumPlan,
  type SubscriptionExpiryWarning,
} from "../components/subscriptionAccess";
import { SubscriptionExpiryWarningModal } from "../components/SubscriptionExpiryWarningModal";
import { ExclusivePremiumOfferModal } from "../components/ExclusivePremiumOfferModal";
import { PremiumTrialRecapModal } from "../components/PremiumTrialRecapModal";
import { PremiumUpgradeExperience } from "../components/premium/PremiumUpgradeExperience";
import {
  canAccessPath,
  getSafePortalRedirect,
  rememberPortalPath,
} from "../lib/portalAccess";
import {
  FrontendSubscriptionError,
  formatTaggedError,
} from "../components/frontendErrorCodes";
import ConnectionMessengerPanel from "../components/messaging/ConnectionMessengerPanel";
import { SupportPopUp } from "../components/support/SupportPopUp";
import { PhysicalBizCardHelpButton } from "../components/PhysicalBizCardHelp";
import { InlineLoader } from "../components/Loader";
import { showToast } from "../components/Toast";
import {
  MESSENGER_VISIBILITY_EVENT,
  isMessengerPanelOpen,
} from "../lib/messengerVisibility";
import {
  clearImpersonationHandoff,
  readImpersonationHandoffToken,
  buildImpersonationHeaders,
} from "../lib/superadminImpersonationHandoff";
import { buildLoginRedirectPath } from "@/lib/bizcard/claim-urls";
import { clearClientAuthCache, performLogout } from "../lib/logoutClient";
import { toServableMediaSrc } from "../lib/portfolioDisplay";
import { PortalPageAccessProvider } from "../components/PortalPageAccessProvider";
import { PortalPageAccessGuard } from "../components/PortalPageAccessGuard";
// Add these inside the component or at module level

const CSRF_COOKIE_NAME = "csrf-token";
const API = getFrontendApiBaseUrl();

function resolveMediaUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  const servable = toServableMediaSrc(value);
  if (/^https?:\/\//i.test(servable)) return servable;
  if (servable.startsWith("/")) return `${API}${servable}`;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return `${API}${value}`;
  return value;
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
    const response = await fetch(`${API}/api/csrf-token`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return readCsrfCookie();
    const payload = await response.json().catch(() => null);
    const token =
      payload?.csrfToken || payload?.csrf_token || payload?.token || "";
    return token || readCsrfCookie();
  } catch {
    return readCsrfCookie();
  }
}

const USER_SYNC_EVENT = "ontap:user-sync";
const SETUP_SESSION_KEY = "ontap:setup:session";

function extractNameParts(userLike: unknown): { full: string } {
  const u =
    userLike && typeof userLike === "object"
      ? (userLike as Record<string, unknown>)
      : {};
  const first = String(u.firstName ?? u.first_name ?? "").trim();
  const last = String(u.lastName ?? u.last_name ?? "").trim();
  const fullFallback = String(u.fullName ?? u.full_name ?? u.name ?? "").trim();
  return {
    full: [first, last].filter(Boolean).join(" ").trim() || fullFallback,
  };
}

function getInitials(name: string): string {
  const safe = (name || "").trim();
  if (!safe) return "--";
  return safe
    .split(/\s+/)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function readAuthUserName(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem("authUser");
    if (!raw) return "";
    return extractNameParts(JSON.parse(raw)).full;
  } catch {
    return "";
  }
}

function readAuthUserProfileImage(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem("authUser");
    if (!raw) return "";
    const u = JSON.parse(raw) as Record<string, unknown>;
    const image = String(
      u.profile_url ?? u.profile_image ?? u.profileUrl ?? u.profileImage ?? "",
    ).trim();
    return image ? resolveMediaUrl(image) : "";
  } catch {
    return "";
  }
}

/* Pages that should NOT get the sidebar/header (auth flows) */
const AUTH_PREFIXES = [
  "/user/forgot-password",
  "/user/signup",
  "/user/onboarding",
  "/user/verify-email",
];

const FORCE_PASSWORD_CHANGE_PATH = "/user/change-password-required";

function shouldSkipPortalPolling(pathname: string): boolean {
  if (typeof window === "undefined") return false;

  // Skip polling on auth/setup pages
  if (AUTH_PREFIXES.some((p) => pathname.startsWith(p))) return true;

  // Skip polling during ongoing setup session (not yet completed)
  try {
    const stored = window.localStorage.getItem(SETUP_SESSION_KEY);
    if (!stored) return false;
    const parsed = JSON.parse(stored) as { isComplete?: boolean } | null;
    return parsed ? parsed.isComplete !== true : false;
  } catch {
    return false;
  }
}

interface Notification {
  id: string;
  title: string;
  message: string;
  event_type: string;
  created_at: string;
  read_at: string | null;
  is_read?: boolean;
  action_url: string | null;
  action_text: string | null;
  metadata: Record<string, unknown>;
}

interface NotificationsResponse {
  success: boolean;
  data: {
    unreadCount: number;
    highPriorityCount: number;
  };
}

/* Map pathname → page title shown in the top header */
const PAGE_TITLES: { prefix: string; title: string }[] = [
  { prefix: "/user/dashboard", title: "Dashboard" },
  { prefix: "/user/bizcard-list", title: "BizCard List" },
  { prefix: "/user/bizcard", title: "BizCard Dashboard" },
  { prefix: "/user/leads", title: "Leads" },
  { prefix: "/user/inquiry", title: "Inquiry" },
  { prefix: "/user/affiliate", title: "Affiliate Status" },
  { prefix: "/user/calendar", title: "Calendar" },
  { prefix: "/user/connections", title: "Connections" },
  { prefix: "/user/services", title: "Services" },
  { prefix: "/user/emarket", title: "E-Market" },
  { prefix: "/user/missions", title: "Missions" },
  { prefix: "/user/orders", title: "Orders" },
  { prefix: "/user/settings", title: "Settings" },
];

const BIZCARD_DASHBOARD_PATH = /^\/frontend\/user\/bizcard\/([^/]+)\/?$/;

function matchesPathPrefix(pathname: string, prefix: string): boolean {
  if (!pathname.startsWith(prefix)) return false;
  if (pathname.length === prefix.length) return true;
  return pathname[prefix.length] === "/";
}

function getPageTitle(pathname: string): string {
  const bizcardSegment = BIZCARD_DASHBOARD_PATH.exec(pathname)?.[1];
  if (bizcardSegment && bizcardSegment !== "create-new") {
    return "BizCard Dashboard";
  }

  const orderReceiptMatch = /^\/frontend\/user\/orders\/[^/]+\/?$/.exec(pathname);
  if (orderReceiptMatch) {
    return "Order Receipt";
  }

  return (
    PAGE_TITLES.find(({ prefix }) => matchesPathPrefix(pathname, prefix))?.title ??
    "Dashboard"
  );
}

export default function UserLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const buildAuthBounceUrl = () => {
    const search = searchParams?.toString() ? `?${searchParams.toString()}` : "";
    return buildLoginRedirectPath(pathname || "/", search);
  };
  /* Auth guard state */
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  /* Impersonation state */
  const [impersonationActive, setImpersonationActive] = useState(false);
  const [impersonatedName, setImpersonatedName] = useState<string>("");
  /* Avatar state */
  const [initials, setInitials] = useState("--");
  const [fullName, setFullName] = useState("-----");
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const prevUnreadRef = useRef(0);
  const toastedAcceptIdsRef = useRef<Set<string>>(new Set());
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notificationsHasMore, setNotificationsHasMore] = useState(false);
  const [notificationsPage, setNotificationsPage] = useState(1);
  const [notificationsLoadingMore, setNotificationsLoadingMore] = useState(false);
  const notificationListRef = useRef<HTMLDivElement>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [messengerOpen, setMessengerOpen] = useState(false);
  const [supportUnread, setSupportUnread] = useState(0);
  const [messagingUnread, setMessagingUnread] = useState(0);
  const [expiryWarning, setExpiryWarning] = useState<SubscriptionExpiryWarning | null>(null);
  const [expiryWarningDismissed, setExpiryWarningDismissed] = useState(false);
  const [canSeeCalendar, setCanSeeCalendar] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);
  const lastAllowedPathRef = useRef("/user/dashboard");
  const isAuthPage = AUTH_PREFIXES.some((p) => pathname.startsWith(p));
  const isForcePasswordPage = pathname.startsWith(FORCE_PASSWORD_CHANGE_PATH);
  const skipPortalPolling = shouldSkipPortalPolling(pathname) || isForcePasswordPage;

  /* ── Auth Guard: validate session before rendering protected content ── */
  useEffect(() => {
    // Skip auth check for public auth pages (signup, forgot-password, verify-email)
    if (AUTH_PREFIXES.some((p) => pathname.startsWith(p))) {
      setAuthChecked(true);
      setIsAuthenticated(true);
      return;
    }

    setAuthChecked(false);
    setIsAuthenticated(false);

    let cancelled = false;
    const validateSession = async () => {
      try {
        const res = await fetch(`${API}/api/auth/session`, {
          credentials: "include",
          cache: "no-store",
          headers: buildImpersonationHeaders(),
        });
        if (cancelled) return;
        if (!res.ok) {
          clearClientAuthCache();
          const loginUrl = buildAuthBounceUrl();
          router.replace(loginUrl);
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        if (!data.authenticated) {
          clearClientAuthCache();
          const loginUrl = buildAuthBounceUrl();
          router.replace(loginUrl);
          return;
        }
        const role = String(data.user?.role ?? "user").toLowerCase();
        const isImpersonating = Boolean(data.impersonation?.active);

        // When superadmin is impersonating, appRole stays "super_admin" but
        // the effective role (data.user.role) is the target user's portal role.
        // Allow access to /user/* in this case without redirecting away.
        if (!isImpersonating && !canAccessPath(role, pathname)) {
          router.replace(getSafePortalRedirect(role, lastAllowedPathRef.current));
          return;
        }

        // Set impersonation banner state
        if (isImpersonating) {
          const firstName = String(data.user?.firstName ?? "").trim();
          const lastName = String(data.user?.lastName ?? "").trim();
          const name = [firstName, lastName].filter(Boolean).join(" ") || data.user?.email || "User";
          setImpersonationActive(true);
          setImpersonatedName(String(name));
        } else {
          setImpersonationActive(false);
          setImpersonatedName("");
        }

        if (
          !isImpersonating &&
          data.user?.requiresPasswordChange === true &&
          !pathname.startsWith(FORCE_PASSWORD_CHANGE_PATH)
        ) {
          router.replace(FORCE_PASSWORD_CHANGE_PATH);
          return;
        }

        if (
          !isImpersonating &&
          data.user?.requiresPasswordChange !== true &&
          pathname.startsWith(FORCE_PASSWORD_CHANGE_PATH)
        ) {
          router.replace(getSafePortalRedirect(role, lastAllowedPathRef.current));
          return;
        }

        // PCO placeholder emails must change email on the login page (OTP flow).
        if (!isImpersonating && data.user?.requiresEmailChange === true) {
          router.replace("/");
          return;
        }

        if (
          !isImpersonating &&
          (role === "admin" || role === "manager" || role === "company_admin") &&
          pathname.startsWith("/user")
        ) {
          try {
            const companyRes = await fetch(`${API}/api/company/my-company`, {
              credentials: "include",
              cache: "no-store",
            });
            if (companyRes.ok) {
              const companyPayload = await companyRes.json().catch(() => ({}));
              const companyData = companyPayload?.data ?? companyPayload;
              const status = String(companyData?.status ?? "").toLowerCase();
              const myRole = String(companyData?.my_role ?? "").toLowerCase();
              if (
                status === "active" &&
                (myRole === "admin" || myRole === "manager" || myRole === "company_admin")
              ) {
                router.replace(getSafePortalRedirect("company_admin"));
                return;
              }
            }
          } catch {
            // ignore company lookup errors
          }
        }
        setIsAuthenticated(true);
        setCurrentUserId(String(data.user?.id ?? data.user?.userId ?? data.user?.user_id ?? ""));
      } catch {
        if (!cancelled) {
          clearClientAuthCache();
          const loginUrl = buildAuthBounceUrl();
          router.replace(loginUrl);
        }
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    };
    void validateSession();
    return () => {
      cancelled = true;
    };
    // Only re-run when the pathname, query, or router changes — NOT when impersonationActive,
    // authChecked, or isAuthenticated change. Those are outputs of this effect, not
    // inputs. Including them in deps causes re-entrancy: the effect resets
    // authChecked/isAuthenticated to false, triggering itself again infinitely.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (isAuthPage || !authChecked || !isAuthenticated) return;
    // During impersonation all /user/* paths are permitted — no path enforcement.
    if (impersonationActive) return;
    if (canAccessPath("user", pathname)) {
      lastAllowedPathRef.current = pathname;
      rememberPortalPath("user", pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, isAuthenticated, isAuthPage, pathname]);

  useEffect(() => {
    // Skip identity fetch on auth pages (signup, verify-email, forgot-password) — no session exists
    if (isAuthPage || !isAuthenticated) return;

    const applyIdentity = (name: string, image?: string | null) => {
      const safe = name.trim();
      if (safe) {
        setFullName(safe);
        setInitials(getInitials(safe));
      }
      if (image !== undefined) {
        const resolved = image ? resolveMediaUrl(image) : "";
        setProfileImage(resolved || null);
      }
      return Boolean(safe);
    };
    const hydrateFromLocal = () => {
      applyIdentity(readAuthUserName(), readAuthUserProfileImage() || null);
    };
    const hydrateFromApi = async () => {
      try {
        const r = await fetch(`${API}/api/user/profile`, {
          credentials: "include",
          cache: "no-store",
          headers: buildImpersonationHeaders(),
        });
        if (!r.ok) return;
        const d = await r.json();
        const p = d?.data;
        const { full } = extractNameParts({
          first_name: p?.first_name,
          last_name: p?.last_name,
          firstName: p?.firstName,
          lastName: p?.lastName,
          name: p?.email,
        });
        const image =
          typeof p?.profile_image === "string"
            ? p.profile_image
            : typeof p?.profileImage === "string"
              ? p.profileImage
              : typeof p?.profile_url === "string"
                ? p.profile_url
                : null;
        applyIdentity(full, image);
      } catch {
        // ignore API errors
      }
    };
    const syncIdentity = () => {
      hydrateFromLocal();
      void hydrateFromApi();
    };
    syncIdentity();
    window.addEventListener(USER_SYNC_EVENT, syncIdentity);
    window.addEventListener("focus", syncIdentity);
    return () => {
      window.removeEventListener(USER_SYNC_EVENT, syncIdentity);
      window.removeEventListener("focus", syncIdentity);
    };
  }, [isAuthPage, isAuthenticated]);

  /* Close dropdowns when clicking outside */
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (avatarRef.current && !avatarRef.current.contains(target)) {
        setAvatarOpen(false);
      }
      const clickedBell = notificationRef.current?.contains(target);
      const clickedPanel =
        target instanceof Element &&
        Boolean(target.closest("[data-notification-panel]"));
      if (!clickedBell && !clickedPanel) {
        setNotificationOpen(false);
      }
    };

    if (avatarOpen || notificationOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [avatarOpen, notificationOpen]);

  const fetchSupportUnread = async () => {
    try {
      const response = await fetch(`${API}/api/support/unread/count`, {
        credentials: "include",
        headers: buildImpersonationHeaders(),
      });
      if (response.ok) {
        const data = await response.json();
        setSupportUnread(Number(data?.data?.count ?? 0));
      }
    } catch {
      // ignore support badge errors
    }
  };

  const fetchMessagingUnread = async () => {
    try {
      const response = await fetch(`${API}/api/messaging/unread/count`, {
        credentials: "include",
        headers: buildImpersonationHeaders(),
      });
      if (response.ok) {
        const data = await response.json();
        setMessagingUnread(Number(data?.data?.count ?? 0));
      }
    } catch {
      // ignore messaging badge errors
    }
  };

  const refreshMessengerUnread = async () => {
    await Promise.all([fetchSupportUnread(), fetchMessagingUnread()]);
  };

  const messengerFabUnread = supportUnread + messagingUnread;

  /* Fetch unread notification count */
  const fetchUnreadCount = async () => {
    try {
      const response = await fetch(`${API}/api/notifications/unread/count`, {
        credentials: "include",
        headers: buildImpersonationHeaders(),
      });
      if (response.ok) {
        const data: NotificationsResponse = await response.json();
        if (data.success) {
          const next = data.data.unreadCount;
          const prev = prevUnreadRef.current;
          setUnreadCount(next);
          if (next > prev) {
            try {
              const listRes = await fetch(`${API}/api/notifications?limit=10`, {
                credentials: "include",
                headers: buildImpersonationHeaders(),
              });
              if (listRes.ok) {
                const listData = await listRes.json();
                const items = (listData?.data?.notifications ?? []) as Notification[];
                for (const item of items) {
                  if (
                    item.event_type === "friend_request_accepted"
                    && !item.read_at
                    && !toastedAcceptIdsRef.current.has(item.id)
                  ) {
                    toastedAcceptIdsRef.current.add(item.id);
                    showToast(
                      item.message || "Your connection request was accepted",
                      "success",
                    );
                  }
                }
              }
            } catch {
              // ignore toast enrichment errors
            }
          }
          prevUnreadRef.current = next;
        }
      }
    } catch (error) {
      console.error("Failed to fetch unread count:", error);
    }
  };
  /* Fetch notifications list */
  const fetchNotifications = async (pageNum = 1, append = false) => {
    try {
      if (append) setNotificationsLoadingMore(true);
      const response = await fetch(
        `${API}/api/notifications?limit=10&page=${pageNum}`,
        {
          credentials: "include",
          headers: buildImpersonationHeaders(),
        },
      );
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          const list = (data.data.notifications || []) as Notification[];
          setNotifications((prev) => (append ? [...prev, ...list] : list));
          setNotificationsHasMore(Boolean(data.data.hasMore));
          setNotificationsPage(pageNum);
        }
      }
    } catch (error) {
      console.error("Failed to fetch notifications:", error);
    } finally {
      if (append) setNotificationsLoadingMore(false);
    }
  };

  const loadMoreNotifications = async () => {
    if (notificationsLoadingMore || !notificationsHasMore) return;
    await fetchNotifications(notificationsPage + 1, true);
  };

  const markAsRead = async (notificationId: string) => {
    // Optimistic UI — clicked notifications appear read immediately
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === notificationId
          ? { ...n, read_at: n.read_at ?? new Date().toISOString(), is_read: true }
          : n,
      ),
    );
    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch(
        `${API}/api/notifications/${notificationId}/read`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
            ...buildImpersonationHeaders(),
          },
        },
      );
      if (!response.ok) {
        console.error("Failed to mark as read:", response.status);
      }
    } catch (error) {
      console.error("Failed to mark notification as read:", error);
    }
  };

  const handleNotificationClick = async (notification: Notification) => {
    const wasUnread = !notification.read_at && notification.is_read !== true;
    void markAsRead(notification.id);
    if (wasUnread) {
      setUnreadCount((prev) => Math.max(0, prev - 1));
    }
    setNotificationOpen(false);
    const url =
      typeof notification.action_url === "string"
        ? notification.action_url.trim()
        : "";
    if (url.includes("openSupport=1")) {
      setSupportOpen(true);
      if (pathname.startsWith("/user/")) {
        router.push(url.startsWith("/") ? url : `/user/dashboard?openSupport=1`);
      } else {
        router.push("/user/dashboard?openSupport=1");
      }
      return;
    }
    if (url) {
      router.push(url);
    }
  };

  const markAllAsRead = async () => {
    try {
      const csrfToken = await ensureCsrfToken();
      const response = await fetch(`${API}/api/notifications/mark-all-read`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
          ...buildImpersonationHeaders(),
        },
      });
      if (response.ok) {
        setNotifications((prev) =>
          prev.map((n) => ({
            ...n,
            read_at: n.read_at ?? new Date().toISOString(),
            is_read: true,
          })),
        );
        setUnreadCount(0);
      } else {
        console.error("Failed to mark all as read:", response.status);
      }
    } catch (error) {
      console.error("Failed to mark all as read:", error);
    }
  };

  /* ── Notification & Support Polling ──────────────────────────────
     Fetch unread notification and support counts periodically, but ONLY:
     • When NOT on auth/signup pages (isAuthPage check)
     • When user is authenticated and session is validated
     • When not currently in an active setup/onboarding flow
     
     Prevents 401/403 errors during signup flow when session may not be
     fully established or user is still completing account setup.
     ────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (isAuthPage || !isAuthenticated || skipPortalPolling) return;

    void fetchUnreadCount();
    void refreshMessengerUnread();
    const interval = setInterval(() => {
      void fetchUnreadCount();
      void refreshMessengerUnread();
    }, 10000); // Poll every 10 seconds for nearer real-time accept/message alerts
    return () => clearInterval(interval);
  }, [isAuthPage, isAuthenticated, skipPortalPolling]);

  /* Fetch notifications when dropdown opens */
  useEffect(() => {
    if (notificationOpen) {
      void fetchNotifications(1, false);
    }
  }, [notificationOpen]);

  useEffect(() => {
    if (searchParams?.get("openSupport") === "1") {
      setSupportOpen(true);
    }
  }, [searchParams]);

  useEffect(() => {
    setMessengerOpen(isMessengerPanelOpen());
    const onVisibility = (event: Event) => {
      const detail = (event as CustomEvent<{ open?: boolean }>).detail;
      setMessengerOpen(Boolean(detail?.open) || isMessengerPanelOpen());
    };
    window.addEventListener(MESSENGER_VISIBILITY_EVENT, onVisibility);
    return () => window.removeEventListener(MESSENGER_VISIBILITY_EVENT, onVisibility);
  }, []);

  useEffect(() => {
    // ── Subscription guard — THREE layers ──────────────────────────────────
    // 1. Auth page / forced password change: no portal navigation yet.
    if (isAuthPage || isForcePasswordPage) return;

    // 2. Synchronous impersonation check from sessionStorage — fires at t=0
    //    before any async session call completes. The enter page writes this
    //    key BEFORE window.location.replace("/user/dashboard"), so it is
    //    always present by the time this effect runs during impersonation.
    //    This is the critical guard that stops the subscription redirect from
    //    racing ahead of the auth effect's async session check.
    if (
      typeof window !== "undefined" &&
      Boolean(window.sessionStorage.getItem("superadmin_impersonation_handoff_token"))
    ) return;

    // 3. Wait for auth to complete — impersonationActive is only set to true
    //    after validateSession finishes. Checking !authChecked here ensures we
    //    never run the subscription redirect before we know whether the SA is
    //    impersonating.
    if (!authChecked) return;

    // 4. State-based impersonation check — redundant safety net after authChecked.
    if (impersonationActive) return;

    let active = true;

    const checkSubscription = async () => {
      // Re-check synchronously at call time — the gap between effect setup and
      // this call may have allowed impersonation state to change.
      if (
        typeof window !== "undefined" &&
        Boolean(window.sessionStorage.getItem("superadmin_impersonation_handoff_token"))
      ) return;
      if (impersonationActive) return;

      try {
        const state = await fetchSubscriptionState(API);
        if (!active) return;
        // Final check after the async fetch — impersonation may have been set
        // while the fetch was in-flight.
        if (
          typeof window !== "undefined" &&
          Boolean(window.sessionStorage.getItem("superadmin_impersonation_handoff_token"))
        ) return;
        if (impersonationActive) return;
        if (shouldRedirectToSubscription(state)) {
          const currentTab =
            typeof window !== "undefined"
              ? (new URLSearchParams(window.location.search).get("tab")?.trim().toLowerCase() ?? "")
              : "";
          const onSubscriptionPage =
            pathname.startsWith("/user/emarket") && currentTab === "subscription";

          const warning = getSubscriptionExpiryWarning(state);
          if (onSubscriptionPage && warning) {
            setExpiryWarning(warning);
          } else if (!onSubscriptionPage) {
            setExpiryWarning(null);
            const reason = getSubscriptionRedirectReason(state);
            router.replace(`/user/emarket?tab=subscription&reason=${reason}`);
          }
          return;
        }

        const warning = getSubscriptionExpiryWarning(state);
        setExpiryWarning(warning);
      } catch (error) {
        const fallback = formatTaggedError(
          FrontendSubscriptionError.SUBSCRIPTION_EXPIRED,
          "Unable to verify subscription status. Keeping current route.",
        );
        console.error(fallback, error);
      }
    };

    const triggerCheck = () => { void checkSubscription(); };

    triggerCheck();
    const intervalId = window.setInterval(triggerCheck, 60000);
    window.addEventListener("focus", triggerCheck);
    window.addEventListener(USER_SYNC_EVENT, triggerCheck);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", triggerCheck);
      window.removeEventListener(USER_SYNC_EVENT, triggerCheck);
    };
    // authChecked triggers re-run when session validation completes.
    // impersonationActive is read inside but NOT in deps — adding it would
    // cause this effect to re-run and re-register event listeners every time
    // impersonation state changes, producing duplicate subscription checks.
    // The synchronous sessionStorage guard + the in-flight checks handle it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthPage, authChecked, pathname, router]);

  useEffect(() => {
    if (!authChecked || !isAuthenticated || isAuthPage) {
      setCanSeeCalendar(false);
      return;
    }

    let cancelled = false;
    const loadPremiumCalendarAccess = async () => {
      try {
        const response = await fetch(`${API}/api/user/subscription`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: buildImpersonationHeaders(),
        });
        if (!response.ok) {
          if (!cancelled) setCanSeeCalendar(false);
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
        if (!cancelled) {
          setCanSeeCalendar(
            hasActivePremiumPlan({
              tier: data?.tier != null ? String(data.tier) : null,
              accessReason:
                data?.access_reason != null ? String(data.access_reason) : null,
              isTrial: Boolean(data?.is_trial),
              status: data?.status != null ? String(data.status) : null,
              isExpired: Boolean(data?.is_expired),
            }),
          );
        }
      } catch {
        if (!cancelled) setCanSeeCalendar(false);
      }
    };

    void loadPremiumCalendarAccess();
    window.addEventListener(USER_SYNC_EVENT, loadPremiumCalendarAccess);
    return () => {
      cancelled = true;
      window.removeEventListener(USER_SYNC_EVENT, loadPremiumCalendarAccess);
    };
  }, [authChecked, isAuthenticated, isAuthPage]);

  const handleEndImpersonation = async () => {
    try {
      const handoffToken = readImpersonationHandoffToken();
      const csrfToken = readCsrfCookie();
      await fetch(`${API}/api/superadmin/companies/impersonation/end`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        },
        body: JSON.stringify(
          handoffToken
            ? { token: handoffToken, reason: "Ended from user impersonation view" }
            : { reason: "Ended from user impersonation view" }
        ),
      });
    } catch {
      // Best-effort — clear local state regardless
    }
    clearImpersonationHandoff();
    window.location.assign("/superadmin/client-list");
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setAvatarOpen(false);

    setIsAuthenticated(false);
    setAuthChecked(false);
    setFullName("-----");
    setInitials("--");

    await performLogout({
      apiBaseUrl: API,
      redirectTo: "/",
    });
  };

  /* ── Auth pages: render children only, no sidebar/header ── */
  if (isAuthPage || isForcePasswordPage) {
    return <>{children}</>;
  }

  /* ── Auth guard: show nothing until session is validated ── */
  if (!authChecked || !isAuthenticated) {
    return (
      <div className="bg-[#F4F7FC]">
        <FullPageLoader text="Validating session..." />
      </div>
    );
  }

  const title = getPageTitle(pathname);

  return (
    <PortalPageAccessProvider portal="user">
    <div className="bg-[#F4F7FC] relative w-full h-full">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
      />

      {/*
        The sidebar is fixed-positioned and never participates in document flow.
        On mobile (< lg): no left margin — the sidebar overlays on top via fixed+transform.
        On desktop (lg+): static left margin reserves space for the always-visible sidebar.
        Expanded sidebar = w-55 (13.75rem) → lg:ml-55
        Collapsed sidebar = w-16  (4rem)   → lg:ml-16
        sidebarCollapsed only toggles the desktop margin; it must never affect mobile.
        transition-[margin] is scoped to lg so mobile toggles never cause a layout shift.
      */}
      <div
        className={`h-screen overflow-hidden flex flex-col lg:transition-[margin-left] lg:duration-300 lg:ease-in-out ${sidebarCollapsed ? "lg:ml-16" : "lg:ml-55"
          }`}
      >
        {/* ── Sticky White Top Header ── */}
        <header className="shrink-0 bg-white border-b border-gray-200 shadow-sm px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between z-20">
          {/* Left: hamburger (mobile) + accent bar + page title */}
          <div className="flex items-center gap-3">
            <button
              className="hidden lg:flex p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-600"
              onClick={() => setSidebarCollapsed((prev) => !prev)}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <Menu className="h-5 w-5" />
            </button>
            <span
              className="h-6 w-1 rounded-full shrink-0"
              style={{ background: "linear-gradient(180deg,#2A4792,#4785B8)" }}
            />
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
              {title}
            </h1>
          </div>

          {/* Right: calendar + help + account */}
          <div className="flex items-center gap-2 sm:gap-3 relative">
            {canSeeCalendar && (
              <Link
                href="/user/calendar"
                className={`rounded-full p-2 transition-colors ${
                  pathname.startsWith("/user/calendar")
                    ? "bg-[#EEF2FA] text-[#2A4792]"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
                aria-label="Calendar"
                title="Calendar"
              >
                <CalendarDays className="h-5 w-5" />
              </Link>
            )}
            <div ref={notificationRef}>
              <PhysicalBizCardHelpButton
                accountKey={currentUserId}
                autoCheck={authChecked && isAuthenticated && !isAuthPage && !impersonationActive}
              />
            </div>
            <div className="relative" ref={avatarRef}>
              <button
                onClick={() => {
                  setNotificationOpen(false);
                  setAvatarOpen((v) => !v);
                }}
                className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 select-none"
                aria-label="Account menu"
              >
                <span className="relative inline-flex h-8 w-8 shrink-0">
                  {profileImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={profileImage}
                      alt={fullName || "Account"}
                      className="h-8 w-8 rounded-full object-cover"
                      onError={() => setProfileImage(null)}
                    />
                  ) : (
                    <span
                      className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold text-white"
                      style={{
                        background: "linear-gradient(135deg,#2A4792,#4785B8)",
                      }}
                    >
                      {initials}
                    </span>
                  )}
                  {unreadCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white ring-2 ring-white">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </span>
                {fullName && (
                  <span className="hidden sm:block text-sm font-semibold text-gray-800 max-w-30 truncate">
                    {fullName}
                  </span>
                )}
              </button>

              {/* Avatar Dropdown */}
              {avatarOpen && (
                <div className="absolute top-full right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-50 animate-fade-in-down">
                  {fullName && (
                    <div className="px-4 py-2 border-b border-gray-100">
                      <p className="text-sm font-semibold text-gray-800 truncate">
                        {fullName}
                      </p>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setAvatarOpen(false);
                      setNotificationOpen(true);
                    }}
                    className="w-full flex items-center justify-between gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <span className="flex items-center gap-2"><Bell className="h-4 w-4" /> Notifications</span>
                    {unreadCount > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600">{unreadCount}</span>}
                  </button>
                  <button
                    onClick={() => {
                      setAvatarOpen(false);
                      router.push("/user/settings");
                    }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <Settings className="h-4 w-4" /> Settings
                  </button>
                  <AccountMenuLegalLinks onNavigate={() => setAvatarOpen(false)} />
                  <button
                    onClick={() => void handleLogout()}
                    disabled={loggingOut}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loggingOut ? (
                      <>
                        <InlineLoader /> Logging out...
                      </>
                    ) : (
                      <>
                        <LogOut className="h-4 w-4" /> Log Out
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Anchored to the right edge of header actions so it stays in-viewport on mobile */}
            {notificationOpen && (
              <div
                data-notification-panel
                className="absolute top-full right-0 z-50 mt-2 w-[min(20rem,calc(100vw-1.5rem))] sm:w-80 bg-white rounded-xl shadow-lg border border-gray-100 py-2 h-96 max-h-96 overflow-hidden"
              >
                <div className="px-3 sm:px-4 py-2 border-b border-gray-100 flex items-center justify-between gap-2 min-w-0">
                  <h3 className="text-sm font-semibold text-gray-800 shrink-0">
                    Notifications
                  </h3>
                  <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                    {unreadCount > 0 && (
                      <>
                        <span className="text-xs text-red-600 font-semibold whitespace-nowrap">
                          {unreadCount} unread
                        </span>
                        <button
                          onClick={markAllAsRead}
                          className="text-xs text-blue-600 hover:text-blue-800 font-semibold whitespace-nowrap shrink-0"
                        >
                          Mark all read
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {notifications.length === 0 ? (
                  <div className="px-4 py-8 text-center text-gray-500 text-sm">
                    No notifications
                  </div>
                ) : (
                  <div
                    ref={notificationListRef}
                    onScroll={() => {
                      const el = notificationListRef.current;
                      if (!el || notificationsLoadingMore || !notificationsHasMore) {
                        return;
                      }
                      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
                        void loadMoreNotifications();
                      }
                    }}
                    className="divide-y divide-gray-200 h-full overflow-x-hidden overflow-y-auto flex flex-col pb-7"
                  >
                    {notifications.map((notification) => {
                      const isUnread =
                        !notification.read_at && notification.is_read !== true;
                      return (
                      <div
                        key={notification.id}
                        onClick={() => void handleNotificationClick(notification)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleNotificationClick(notification);
                        }}
                        className={`w-full px-4 py-3 hover:bg-gray-50 cursor-pointer ${
                          isUnread ? "bg-blue-50/50" : ""
                          }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {notification.title || notification.event_type}
                            </p>
                            <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                              {notification.message}
                            </p>
                            <p className="text-xs text-gray-400 mt-1">
                              {new Date(
                                notification.created_at,
                              ).toLocaleString()}
                            </p>
                          </div>
                          {isUnread && (
                            <div className="h-2 w-2 rounded-full bg-blue-500 mt-2 shrink-0" />
                          )}
                        </div>
                      </div>
                      );
                    })}
                    {notificationsLoadingMore ? (
                      <p className="px-4 py-3 text-center text-xs text-gray-400">
                        Loading more…
                      </p>
                    ) : null}
                    {!notificationsHasMore && notifications.length >= 10 ? (
                      <p className="px-4 py-3 text-center text-xs text-gray-400">
                        End of notifications
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        {/* ── Superadmin impersonation banner ── */}
        {impersonationActive && (
          <div
            className="shrink-0 border-b border-[#1a1f3a] px-4 py-2.5 sm:px-6 lg:px-8"
            style={{ background: "linear-gradient(90deg,#1a1f3a 0%,#252b4a 100%)" }}
            role="alert"
            aria-live="polite"
          >
            <div className="flex items-center justify-between gap-3">
              {/* Left: Impersonation Mode badge */}
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#d97706] bg-[#d97706]/15 px-3 py-1 text-xs font-semibold text-[#fbbf24]">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-3.5 w-3.5"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z"
                    clipRule="evenodd"
                  />
                </svg>
                Impersonation Mode
              </span>

              {/* Center: impersonation label */}
              <p className="min-w-0 flex-1 text-center text-sm font-medium text-white">
                You are impersonating:{" "}
                <span className="font-semibold">{impersonatedName}</span>
              </p>

              {/* Right: Exit button */}
              <button
                type="button"
                onClick={() => void handleEndImpersonation()}
                className="shrink-0 rounded-lg border border-white/20 bg-white/10 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-white/20"
              >
                Exit
              </button>
            </div>
          </div>
        )}

        {/* ── Page content (each page owns its own scroll) ── */}
        <div className="flex-1 overflow-y-auto bg-[#F4F7FC] p-4 pb-28 sm:p-6 sm:pb-28 lg:p-8 lg:pb-8">
          <PortalPageAccessGuard portal="user">{children}</PortalPageAccessGuard>
        </div>
      </div>

      <div className="fixed bottom-24 right-4 z-[39999] lg:bottom-6 lg:right-6">
        <ConnectionMessengerPanel
          open={supportOpen}
          initialView={messagingUnread > 0 ? "list" : "support"}
          onClose={() => {
            setSupportOpen(false);
            void refreshMessengerUnread();
          }}
        />
        {!supportOpen && !messengerOpen && !isAuthPage ? (
          <div className="relative">
            <SupportPopUp
              enabled={authChecked && !isAuthPage && !impersonationActive}
            />
            {messengerFabUnread > 0 ? (
              <>
                <div className="pointer-events-none absolute inset-0 rounded-full bg-primary/40 animate-fab-pulse" />
                <div
                  className="pointer-events-none absolute inset-0 rounded-full bg-primary/30 animate-fab-pulse"
                  style={{ animationDelay: "0.8s" }}
                />
              </>
            ) : null}
            <button
              type="button"
              onClick={() => setSupportOpen(true)}
              className={`relative bg-white shadow-xl rounded-full flex items-center justify-center p-4 w-auto aspect-square text-primary hover:bg-primary-light hover:text-white focus:scale-95 focus:bg-primary focus:text-white transition-all duration-20 ${
                messengerFabUnread > 0 ? "animate-messenger-attention ring-2 ring-primary/40" : ""
              }`}
              aria-label={
                messengerFabUnread > 0
                  ? `Open messages, ${messengerFabUnread} unread`
                  : "Open messages"
              }
            >
            <MessageCircle className="h-6 w-6 stroke-2" />
            {messengerFabUnread > 0 && (
              <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white shadow-sm">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" />
                <span className="relative">{messengerFabUnread > 9 ? "9+" : messengerFabUnread}</span>
              </span>
            )}
            </button>
          </div>
        ) : null}
      </div>

      <SubscriptionExpiryWarningModal
        open={Boolean(expiryWarning) && !expiryWarningDismissed && !isAuthPage}
        title={expiryWarning?.title ?? ""}
        message={expiryWarning?.message ?? ""}
        onDismiss={() => setExpiryWarningDismissed(true)}
      />
      <ExclusivePremiumOfferModal enabled={authChecked && !isAuthPage && !impersonationActive} />
      <PremiumTrialRecapModal enabled={authChecked && !isAuthPage && !impersonationActive} />
      <PremiumUpgradeExperience enabled={authChecked && !isAuthPage} />
    </div>
    </PortalPageAccessProvider>
  );
}
