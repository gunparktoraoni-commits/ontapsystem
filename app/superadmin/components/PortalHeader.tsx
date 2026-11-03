"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Bell, CalendarDays, LogOut, MessageSquare, Settings, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { AccountMenuLegalLinks } from "@/app/components/legal/AccountMenuLegalLinks";
import { PhysicalBizCardHelpButton } from "@/app/components/PhysicalBizCardHelp";
import Link from "next/link";
import { InlineLoader } from "@/app/components/Loader";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import { performLogout } from "@/app/lib/logoutClient";

const CSRF_COOKIE_NAME = "csrf-token";
const NOTIFICATION_POLL_INTERVAL_MS = 10_000;
const SA_EVENT_COMPANY_CREATION = "sa_company_creation_request";
const SA_EVENT_NEW_USER_REGISTRATION = "sa_new_user_registration";

function readCsrfCookie(): string {
  if (typeof document === "undefined") return "";
  const target = `${CSRF_COOKIE_NAME}=`;
  const match = document.cookie.split("; ").find((entry) => entry.startsWith(target));
  return match ? decodeURIComponent(match.slice(target.length)) : "";
}

async function ensureCsrfToken(apiBase: string): Promise<string> {
  const fromCookie = readCsrfCookie();
  if (fromCookie) return fromCookie;
  try {
    const response = await fetch(`${apiBase}/api/csrf-token`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return readCsrfCookie();
    const payload = await response.json().catch(() => null);
    const token = payload?.csrfToken || payload?.csrf_token || payload?.token || "";
    return token || readCsrfCookie();
  } catch {
    return readCsrfCookie();
  }
}

function getInitials(name: string): string {
  const safe = (name || "").trim();
  if (!safe) return "SA";
  return safe.split(/\s+/).map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

/**
 * Compact OnTap ↔ SmartPet portal switch.
 * Left = current (OnTap). Right click/toggle = SSO into SmartPet SUPERADMIN.
 */
function PortalSystemSwitch({
  disabled,
  switching,
  onSwitch,
}: {
  disabled?: boolean;
  switching: boolean;
  onSwitch: () => void;
}) {
  return (
    <div className="border-b border-gray-100 px-3 py-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        Switch portal
      </p>
      <button
        type="button"
        onClick={onSwitch}
        disabled={disabled || switching}
        title="Open SmartPet superadmin portal"
        className="group flex w-full items-center justify-between gap-2 rounded-full border border-gray-200 bg-gray-50 px-2 py-1.5 transition hover:border-primary/40 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
        aria-label="Switch to SmartPet superadmin portal"
      >
        <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-white shadow-sm ring-2 ring-primary/30">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logotap.png" alt="OnTap" width={22} height={22} className="object-contain" />
        </span>

        <span className="relative flex h-6 w-11 shrink-0 items-center rounded-full bg-primary/15 px-0.5 transition group-hover:bg-primary/25">
          <span
            className={`absolute h-5 w-5 rounded-full bg-primary shadow transition-transform duration-200 ${
              switching ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </span>

        <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-[#5A382C] shadow-sm ring-2 ring-transparent transition group-hover:ring-[#8B6250]/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/pettags-mark.svg" alt="SmartPet" width={22} height={22} className="object-contain" />
        </span>
      </button>
      <p className="mt-1.5 text-[11px] leading-snug text-gray-500">
        {switching ? "Opening SmartPet…" : "Tap to open SmartPet as superadmin"}
      </p>
    </div>
  );
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface SuperadminNotification {
  id: string;
  event_type: string;
  priority: string;
  title: string | null;
  message: string | null;
  metadata: Record<string, unknown>;
  action_url: string | null;
  action_text: string | null;
  is_read: boolean;
  created_at: string;
}

type PortalHeaderProps = {
  pageTitle: string;
  userName?: string;
  userEmail?: string;
};

function NotificationItem({
  notification,
  onMarkRead,
  onNavigate,
  onCompanyAction,
  actionInProgress,
}: {
  notification: SuperadminNotification;
  onMarkRead: (id: string) => void;
  onNavigate: (url: string) => void;
  onCompanyAction: (companyId: string, action: "approve" | "reject", notifId: string) => void;
  actionInProgress: string | null;
}) {
  const isCompanyRequest = notification.event_type === SA_EVENT_COMPANY_CREATION;
  const isNewUserRegistration = notification.event_type === SA_EVENT_NEW_USER_REGISTRATION;
  const companyId =
    typeof notification.metadata.company_id === "string" ? notification.metadata.company_id : null;
  const requiresAction = notification.metadata.requires_action === true;

  const registrationActionUrl = (() => {
    if (!isNewUserRegistration) return null;
    const metaUserId =
      typeof notification.metadata.new_user_id === "string"
        ? notification.metadata.new_user_id.trim()
        : "";
    if (metaUserId) {
      return `/superadmin/client-list?viewUserId=${encodeURIComponent(metaUserId)}`;
    }
    return notification.action_url;
  })();

  const handleActivate = () => {
    onMarkRead(notification.id);
    // Registration alerts open the existing client Profile View (same as Eye → View profile).
    const url = registrationActionUrl ?? notification.action_url;
    if (url) onNavigate(url);
  };

  const dotColor: Record<string, string> = {
    critical: "bg-red-500",
    high: "bg-orange-400",
    medium: "bg-blue-400",
    low: "bg-gray-300",
  };

  return (
    <div
      className={`cursor-pointer px-4 py-3 transition-colors hover:bg-gray-50 ${!notification.is_read ? "bg-blue-50/40" : ""}`}
      onClick={handleActivate}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") handleActivate(); }}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotColor[notification.priority] ?? "bg-gray-300"}`}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className={`text-xs font-semibold leading-tight ${notification.is_read ? "text-gray-700" : "text-gray-900"}`}>
              {notification.title ?? "Notification"}
            </p>
            <span className="shrink-0 text-[10px] text-gray-400">{formatTimeAgo(notification.created_at)}</span>
          </div>
          {notification.message && (
            <p className="mt-0.5 text-xs leading-snug text-gray-500 line-clamp-2">{notification.message}</p>
          )}
          {isCompanyRequest && requiresAction && companyId && (
            <div className="mt-2 flex gap-2" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                disabled={actionInProgress !== null}
                onClick={() => onCompanyAction(companyId, "approve", notification.id)}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionInProgress === `approve:${companyId}` ? <InlineLoader /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Approve
              </button>
              <button
                type="button"
                disabled={actionInProgress !== null}
                onClick={() => onCompanyAction(companyId, "reject", notification.id)}
                className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionInProgress === `reject:${companyId}` ? <InlineLoader /> : <XCircle className="h-3.5 w-3.5" />}
                Reject
              </button>
            </div>
          )}
          {notification.action_url && notification.action_text && !isCompanyRequest && (
            <a
              href={registrationActionUrl ?? notification.action_url}
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                onMarkRead(notification.id);
                if (registrationActionUrl) {
                  e.preventDefault();
                  onNavigate(registrationActionUrl);
                }
              }}
            >
              <ExternalLink className="h-3 w-3" />
              {isNewUserRegistration ? "View Profile" : notification.action_text}
            </a>
          )}
        </div>
        {!notification.is_read && (
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />
        )}
      </div>
    </div>
  );
}

export default function PortalHeader({
  pageTitle,
  userName = "Super Admin",
  userEmail,
}: PortalHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const API = getFrontendApiBaseUrl();
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [switchingPortal, setSwitchingPortal] = useState(false);
  const [portalSwitchError, setPortalSwitchError] = useState<string | null>(null);
  const [supportUnread, setSupportUnread] = useState(0);
  const [notifications, setNotifications] = useState<SuperadminNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notificationsHasMore, setNotificationsHasMore] = useState(false);
  const [notificationsPage, setNotificationsPage] = useState(1);
  const [notificationsLoadingMore, setNotificationsLoadingMore] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const avatarRef = useRef<HTMLDivElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);
  const notificationListRef = useRef<HTMLDivElement>(null);
  const displayName = userName.trim() || "Super Admin";
  const initials = getInitials(displayName);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) setAvatarOpen(false);
      if (notificationRef.current && !notificationRef.current.contains(e.target as Node)) setNotificationOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const fetchSupportUnread = async () => {
      try {
        const res = await fetch(`${API}/api/superadmin/support/escalations/unread/count`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setSupportUnread(Number(data?.data?.count ?? 0));
        }
      } catch { /* ignore */ }
    };
    void fetchSupportUnread();
    const interval = setInterval(() => { void fetchSupportUnread(); }, 30000);
    return () => clearInterval(interval);
  }, [API]);

  const fetchNotifications = useCallback(async (opts?: { silent?: boolean; page?: number; append?: boolean }) => {
    const silent = opts?.silent ?? false;
    const pageNum = opts?.page ?? 1;
    const append = opts?.append ?? false;
    if (!silent && !append) setNotifLoading(true);
    if (append) setNotificationsLoadingMore(true);
    try {
      const res = await fetch(
        `${API}/api/superadmin/notifications?limit=10&page=${pageNum}`,
        { credentials: "include", cache: "no-store" },
      );
      if (!res.ok) return;
      const payload = await res.json();
      const data = payload?.data;
      if (data) {
        const list = Array.isArray(data.notifications) ? (data.notifications as SuperadminNotification[]) : [];
        setNotifications((prev) => (append ? [...prev, ...list] : list));
        setNotificationsHasMore(Boolean(data.hasMore ?? data.pagination?.hasMore));
        setNotificationsPage(pageNum);
        if (!append && typeof data.unread_count === "number") {
          setUnreadCount(data.unread_count);
        }
      }
    } catch { /* non-fatal */ } finally {
      if (!silent && !append) setNotifLoading(false);
      if (append) setNotificationsLoadingMore(false);
    }
  }, [API]);

  const loadMoreNotifications = useCallback(async () => {
    if (notificationsLoadingMore || !notificationsHasMore) return;
    await fetchNotifications({ silent: true, page: notificationsPage + 1, append: true });
  }, [fetchNotifications, notificationsHasMore, notificationsLoadingMore, notificationsPage]);

  useEffect(() => {
    void fetchNotifications({ silent: false });
    const interval = setInterval(() => {
      // Avoid wiping infinite-scroll pages while the dropdown is open.
      if (notificationOpen) return;
      void fetchNotifications({ silent: true, page: 1, append: false });
    }, NOTIFICATION_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchNotifications, notificationOpen]);

  const handleMarkRead = useCallback(async (id: string) => {
    let shouldDecrement = false;
    setNotifications((prev) => {
      const target = prev.find((n) => n.id === id);
      shouldDecrement = Boolean(target && !target.is_read);
      return prev.map((n) => (n.id === id ? { ...n, is_read: true } : n));
    });
    if (shouldDecrement) setUnreadCount((prev) => Math.max(0, prev - 1));
    try {
      const csrfToken = await ensureCsrfToken(API);
      await fetch(`${API}/api/superadmin/notifications/${encodeURIComponent(id)}/read`, {
        method: "PATCH",
        credentials: "include",
        headers: { ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}) },
      });
    } catch { /* non-fatal */ }
  }, [API]);

  const handleNotificationNavigate = useCallback((url: string) => {
    setNotificationOpen(false);
    // If Users page is already mounted, open Profile View immediately (don't wait on soft-nav).
    try {
      const parsed = new URL(url, window.location.origin);
      const userId = parsed.searchParams.get("viewUserId")?.trim() ?? "";
      if (userId && parsed.pathname.includes("/superadmin/client-list")) {
        window.dispatchEvent(
          new CustomEvent("sa-open-client-profile", { detail: { userId } }),
        );
      }
    } catch {
      /* non-fatal */
    }
    router.push(url);
  }, [router]);

  const handleMarkAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
    try {
      const csrfToken = await ensureCsrfToken(API);
      await fetch(`${API}/api/superadmin/notifications/mark-all-read`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}) },
      });
    } catch { /* non-fatal */ }
  }, [API]);

  const handleCompanyAction = useCallback(async (companyId: string, action: "approve" | "reject", notifId: string) => {
    const key = `${action}:${companyId}`;
    setActionInProgress(key);
    try {
      const csrfToken = await ensureCsrfToken(API);
      const res = await fetch(`${API}/api/superadmin/company-requests/${encodeURIComponent(companyId)}/approve`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}) },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        setNotifications((prev) => prev.map((n) =>
          n.id === notifId ? { ...n, is_read: true, metadata: { ...n.metadata, requires_action: false } } : n
        ));
        setUnreadCount((prev) => Math.max(0, prev - 1));
        setTimeout(() => { void fetchNotifications({ silent: true }); }, 1500);
      }
    } catch (err) {
      console.error(`[PortalHeader] company ${action} error:`, err);
    } finally {
      setActionInProgress(null);
    }
  }, [API, fetchNotifications]);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setAvatarOpen(false);
    await performLogout({
      apiBaseUrl: API,
      redirectTo: "/super-login?logged_out=1",
    });
  };

  const handlePortalSwitch = async () => {
    if (switchingPortal) return;
    setPortalSwitchError(null);
    setSwitchingPortal(true);
    try {
      const csrf = await ensureCsrfToken(API);
      const response = await fetch(`${API}/api/superadmin/portal-switch/pet-tags`, {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.redirectUrl) {
        throw new Error(
          payload?.error || "Unable to switch to SmartPet right now.",
        );
      }
      window.location.assign(String(payload.redirectUrl));
    } catch (error) {
      setSwitchingPortal(false);
      setPortalSwitchError(
        error instanceof Error ? error.message : "Portal switch failed.",
      );
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 shadow-sm sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <span className="hidden h-6 w-1 shrink-0 rounded-full sm:block" style={{ background: "linear-gradient(180deg,#2A4792,#4785B8)" }} />
        <h1 className="truncate text-xl font-bold text-gray-900 sm:text-2xl">{pageTitle}</h1>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <Link
          href="/superadmin/calendar"
          className={`rounded-full p-2 transition-colors ${
            pathname.startsWith("/superadmin/calendar")
              ? "bg-[#EEF2FA] text-[#2A4792]"
              : "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          } focus:outline-none focus:ring-2 focus:ring-primary/30`}
          aria-label="Calendar"
          title="Calendar"
        >
          <CalendarDays className="h-5 w-5" />
        </Link>
        {/* Support badge */}
        <Link href="/superadmin/support-escalations" className="relative rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30" aria-label="Support escalations">
          <MessageSquare className="h-5 w-5" />
          {supportUnread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-semibold text-white">
              {supportUnread > 9 ? "9+" : supportUnread}
            </span>
          )}
        </Link>

        {/* Notification bell */}
        <div className="relative" ref={notificationRef}>
          <PhysicalBizCardHelpButton />

          {notificationOpen && (
            <div className="absolute right-0 mt-2 w-80 rounded-xl border border-gray-100 bg-white shadow-lg sm:w-96">
              <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                <p className="text-sm font-semibold text-gray-900">
                  Notifications
                  {unreadCount > 0 && (
                    <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">{unreadCount}</span>
                  )}
                </p>
                {unreadCount > 0 && (
                  <button type="button" onClick={() => void handleMarkAllRead()} className="text-[11px] font-semibold text-primary hover:underline">
                    Mark all read
                  </button>
                )}
              </div>
              <div
                ref={notificationListRef}
                onScroll={() => {
                  const el = notificationListRef.current;
                  if (!el || notificationsLoadingMore || !notificationsHasMore) return;
                  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
                    void loadMoreNotifications();
                  }
                }}
                className="max-h-[380px] overflow-y-auto divide-y divide-gray-50 [scrollbar-width:thin]"
              >
                {notifLoading && notifications.length === 0 ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-500"><InlineLoader />Loading…</div>
                ) : notifications.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-gray-500">No notifications yet</p>
                ) : (
                  <>
                    {notifications.map((n) => (
                      <NotificationItem
                        key={n.id}
                        notification={n}
                        onMarkRead={handleMarkRead}
                        onNavigate={handleNotificationNavigate}
                        onCompanyAction={handleCompanyAction}
                        actionInProgress={actionInProgress}
                      />
                    ))}
                    {notificationsLoadingMore && (
                      <div className="flex items-center justify-center gap-2 py-3 text-xs text-gray-400">
                        <InlineLoader />Loading more…
                      </div>
                    )}
                  </>
                )}
              </div>
              {notifications.length > 0 && (
                <div className="border-t border-gray-100 px-4 py-2.5 text-center">
                  <Link href="/superadmin/client-list" className="text-[11px] font-semibold text-primary hover:underline" onClick={() => setNotificationOpen(false)}>
                    View all
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Avatar */}
        <div className="relative" ref={avatarRef}>
          <button type="button" onClick={() => setAvatarOpen((v) => !v)} className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 transition-colors hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary/30" aria-label="Account menu">
            <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ background: "linear-gradient(135deg,#2A4792,#4785B8)" }}>
              {initials}
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white ring-2 ring-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </div>
            <span className="hidden max-w-28 truncate text-sm font-semibold text-gray-800 sm:block">{displayName}</span>
          </button>
          {avatarOpen && (
            <div className="absolute right-0 z-50 mt-2 w-60 rounded-xl border border-gray-100 bg-white py-1 shadow-lg">
              <div className="border-b border-gray-100 px-4 py-2">
                <p className="truncate text-sm font-semibold text-gray-800">{displayName}</p>
                {userEmail && <p className="truncate text-xs text-gray-500">{userEmail}</p>}
              </div>
              <PortalSystemSwitch
                switching={switchingPortal}
                onSwitch={() => void handlePortalSwitch()}
              />
              {portalSwitchError ? (
                <p className="px-4 py-1.5 text-[11px] text-red-600" role="alert">
                  {portalSwitchError}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setAvatarOpen(false);
                  setNotificationOpen(true);
                  void fetchNotifications({ silent: false });
                }}
                className="flex w-full items-center justify-between gap-2 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                <span className="flex items-center gap-2"><Bell className="h-4 w-4" />Notifications</span>
                {unreadCount > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600">{unreadCount}</span>}
              </button>
              <button type="button" onClick={() => { setAvatarOpen(false); router.push("/superadmin/settings"); }} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50">
                <Settings className="h-4 w-4" />Settings
              </button>
              <AccountMenuLegalLinks onNavigate={() => setAvatarOpen(false)} />
              <button type="button" onClick={() => void handleLogout()} disabled={loggingOut} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">
                {loggingOut ? <><InlineLoader /> Logging out...</> : <><LogOut className="h-4 w-4" />Logout</>}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
