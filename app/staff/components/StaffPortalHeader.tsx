"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Bell, CalendarDays, LogOut, MessageSquare } from "lucide-react";
import { AccountMenuLegalLinks } from "@/app/components/legal/AccountMenuLegalLinks";
import { PhysicalBizCardHelpButton } from "@/app/components/PhysicalBizCardHelp";
import { InlineLoader } from "../../components/Loader";
import { getFrontendApiBaseUrl } from "../../components/apiBase";
import { clearClientAuthCache, performLogout } from "../../lib/logoutClient";
import { toServableMediaSrc } from "../../lib/portfolioDisplay";

const CSRF_COOKIE_NAME = "csrf-token";
const USER_SYNC_EVENT = "ontap:user-sync";
const API = getFrontendApiBaseUrl();

interface StaffNotification {
  id: string;
  title: string | null;
  message: string | null;
  event_type: string;
  created_at: string;
  read_at: string | null;
  is_read: boolean;
  action_url: string | null;
  action_text: string | null;
}

type StaffPortalHeaderProps = {
  pageTitle: string;
};

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
  if (!safe) return "ST";
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

export default function StaffPortalHeader({
  pageTitle,
}: StaffPortalHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [initials, setInitials] = useState("ST");
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [supportUnread, setSupportUnread] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<StaffNotification[]>([]);
  const [notificationsHasMore, setNotificationsHasMore] = useState(false);
  const [notificationsPage, setNotificationsPage] = useState(1);
  const [notificationsLoadingMore, setNotificationsLoadingMore] = useState(false);
  const notificationListRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<HTMLDivElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const applyIdentity = (name: string, image?: string | null): boolean => {
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
        const response = await fetch(`${API}/api/user/profile`, {
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = await response.json();
        const profile = data?.data;
        const { full } = extractNameParts({
          first_name: profile?.first_name,
          last_name: profile?.last_name,
          firstName: profile?.firstName,
          lastName: profile?.lastName,
          name: profile?.email,
        });
        const image =
          typeof profile?.profile_image === "string"
            ? profile.profile_image
            : typeof profile?.profileImage === "string"
              ? profile.profileImage
              : typeof profile?.profile_url === "string"
                ? profile.profile_url
                : "";
        applyIdentity(full, image || null);
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
  }, []);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (avatarRef.current && !avatarRef.current.contains(event.target as Node)) {
        setAvatarOpen(false);
      }
      if (
        notificationRef.current &&
        !notificationRef.current.contains(event.target as Node)
      ) {
        setNotificationOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const fetchSupportUnread = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/staff/support/unread/count`, {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        setSupportUnread(Number(data?.data?.count ?? 0));
      }
    } catch {
      // ignore badge errors
    }
  }, []);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/staff/notifications/unread/count`, {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setUnreadCount(Number(data.data?.unreadCount ?? 0));
        }
      }
    } catch {
      // ignore notification badge errors
    }
  }, []);

  const fetchNotifications = useCallback(async (pageNum = 1, append = false) => {
    try {
      if (append) setNotificationsLoadingMore(true);
      const response = await fetch(
        `${API}/api/staff/notifications?limit=10&page=${pageNum}`,
        { credentials: "include" },
      );
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          const list = (data.data?.notifications ?? []) as StaffNotification[];
          setNotifications((prev) => (append ? [...prev, ...list] : list));
          setNotificationsHasMore(Boolean(data.data?.hasMore));
          setNotificationsPage(pageNum);
        }
      }
    } catch {
      // ignore notification list errors
    } finally {
      if (append) setNotificationsLoadingMore(false);
    }
  }, []);

  const loadMoreNotifications = async () => {
    if (notificationsLoadingMore || !notificationsHasMore) return;
    await fetchNotifications(notificationsPage + 1, true);
  };

  const markAsRead = async (notificationId: string) => {
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === notificationId
          ? { ...n, is_read: true, read_at: n.read_at ?? new Date().toISOString() }
          : n,
      ),
    );
    try {
      const csrfToken = await ensureCsrfToken();
      await fetch(`${API}/api/notifications/${notificationId}/read`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        },
      });
    } catch {
      // ignore mark-as-read errors
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
        },
      });
      if (response.ok) {
        setNotifications((prev) =>
          prev.map((n) => ({
            ...n,
            is_read: true,
            read_at: n.read_at ?? new Date().toISOString(),
          })),
        );
        setUnreadCount(0);
      }
    } catch {
      // ignore mark-all-read errors
    }
  };

  const handleNotificationClick = async (notification: StaffNotification) => {
    const wasUnread = !notification.is_read && !notification.read_at;
    void markAsRead(notification.id);
    if (wasUnread) setUnreadCount((prev) => Math.max(0, prev - 1));
    setNotificationOpen(false);
    const url =
      typeof notification.action_url === "string"
        ? notification.action_url.trim()
        : "";
    if (url) router.push(url);
  };

  useEffect(() => {
    void fetchUnreadCount();
    void fetchSupportUnread();
    const interval = setInterval(() => {
      void fetchUnreadCount();
      void fetchSupportUnread();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount, fetchSupportUnread]);

  useEffect(() => {
    if (notificationOpen) {
      void fetchNotifications(1, false);
    }
  }, [notificationOpen, fetchNotifications]);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setAvatarOpen(false);
    await performLogout({
      apiBaseUrl: API,
      redirectTo: "/super-login",
    });
  };

  return (
    <header className="box-border shrink-0 bg-white border-b border-gray-200 shadow-sm px-2 sm:px-6 lg:px-8 h-16 w-full max-w-full min-w-0 flex items-center justify-between gap-2 sm:gap-3 z-30">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <h1 className="min-w-0 truncate text-base sm:text-2xl font-bold text-gray-900">{pageTitle}</h1>
      </div>

      <div className="ml-1 flex shrink-0 items-center gap-1 sm:gap-3">
        <Link
          href="/staff/calendar"
          className={`rounded-full p-1.5 sm:p-2 transition-colors ${
            pathname.startsWith("/staff/calendar")
              ? "bg-[#EEF2FA] text-[#2A4792]"
              : "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          }`}
          aria-label="Calendar"
          title="Calendar"
        >
          <CalendarDays className="h-5 w-5" />
        </Link>
        <Link
          href="/staff/messages"
          className="relative rounded-full p-1.5 sm:p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
          aria-label="Client messages"
        >
          <MessageSquare className="h-5 w-5" />
          {supportUnread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-semibold text-white">
              {supportUnread > 9 ? "9+" : supportUnread}
            </span>
          )}
        </Link>

        {/* Help guide and notification dropdown */}
        <div className="relative" ref={notificationRef}>
          <PhysicalBizCardHelpButton />

          {notificationOpen && (
            <div className="absolute right-0 mt-2 w-[min(20rem,calc(100vw-1.5rem))] bg-white rounded-xl shadow-lg border border-gray-100 py-2 max-h-96 overflow-hidden z-50">
              <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-800">Notifications</h3>
                <div className="flex items-center gap-2">
                  {unreadCount > 0 && (
                    <>
                      <span className="text-xs text-red-600 font-semibold">
                        {unreadCount} unread
                      </span>
                      <button
                        type="button"
                        onClick={() => void markAllAsRead()}
                        className="text-xs text-blue-600 hover:text-blue-800 font-semibold"
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
                    if (!el || notificationsLoadingMore || !notificationsHasMore) return;
                    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
                      void loadMoreNotifications();
                    }
                  }}
                  className="divide-y divide-gray-100 max-h-[22rem] overflow-y-auto"
                >
                  {notifications.map((notification) => {
                    const isUnread = !notification.is_read && !notification.read_at;
                    return (
                    <div
                      key={notification.id}
                      onClick={() => void handleNotificationClick(notification)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleNotificationClick(notification);
                      }}
                      className={`px-4 py-3 hover:bg-gray-50 cursor-pointer ${
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
                            {new Date(notification.created_at).toLocaleString()}
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
                    <p className="px-4 py-3 text-center text-xs text-gray-400">Loading more…</p>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>

        {/* User avatar dropdown */}
        <div className="relative shrink-0" ref={avatarRef}>
          <button
            type="button"
            onClick={() => setAvatarOpen((value) => !value)}
            className="flex items-center gap-2 rounded-full hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 sm:pl-1 sm:pr-3 sm:py-1"
            aria-label="Account menu"
          >
            <span
              className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white font-semibold text-sm"
              style={{ background: "linear-gradient(135deg,#2A4792,#4785B8)" }}
            >
              {profileImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profileImage}
                  alt={fullName || "Staff user"}
                  className="h-8 w-8 rounded-full object-cover"
                  onError={() => setProfileImage(null)}
                />
              ) : (
                initials
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

          {avatarOpen && (
            <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-50">
              {fullName && (
                <div className="px-4 py-2 border-b border-gray-100">
                  <p className="text-sm font-semibold text-gray-800 truncate">{fullName}</p>
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
              <AccountMenuLegalLinks onNavigate={() => setAvatarOpen(false)} />
              <button
                type="button"
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
                    <LogOut className="h-4 w-4" /> Logout
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export { clearClientAuthCache };
