'use client';

import React, { useEffect, useMemo, useState, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Settings, LogOut, MessageCircle, CalendarDays, Bell } from 'lucide-react';
import { AccountMenuLegalLinks } from '@/app/components/legal/AccountMenuLegalLinks';
import { PhysicalBizCardHelpButton } from '../components/PhysicalBizCardHelp';
import ConnectionMessengerPanel from '@/app/components/messaging/ConnectionMessengerPanel';
import { FullPageLoader, SectionLoader } from '@/app/components/Loader';
import AdminSidebar from './components/AdminSidebar';
import { getFrontendApiBaseUrl } from '../components/apiBase';
import {
  canAccessPath,
  getSafePortalRedirect,
  rememberPortalPath,
} from '../lib/portalAccess';
import { csrfClient } from '@/lib/csrf-client';
import {
  buildImpersonationHeaders,
  clearImpersonationHandoff,
  readImpersonationHandoffToken,
} from '@/app/lib/superadminImpersonationHandoff';
import { performLogout } from '@/app/lib/logoutClient';
import { PortalPageAccessProvider } from '@/app/components/PortalPageAccessProvider';
import { PortalPageAccessGuard } from '@/app/components/PortalPageAccessGuard';
import {
  MESSENGER_VISIBILITY_EVENT,
  isMessengerPanelOpen,
} from '@/app/lib/messengerVisibility';
const USER_SYNC_EVENT = 'ontap:user-sync';

const API_BASE_URL = getFrontendApiBaseUrl();

function readStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return (
    window.localStorage.getItem('auth_token') ||
    window.sessionStorage.getItem('auth_token') ||
    window.localStorage.getItem('superadmin_token') ||
    window.sessionStorage.getItem('superadmin_token') ||
    null
  );
}

function buildAuthHeaders(): HeadersInit {
  const token = readStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function extractNameParts(userLike: unknown): { full: string } {
  const u = userLike && typeof userLike === 'object'
    ? (userLike as Record<string, unknown>)
    : {};
  const first = String(u.firstName ?? u.first_name ?? '').trim();
  const last = String(u.lastName ?? u.last_name ?? '').trim();
  const fullFallback = String(u.fullName ?? u.full_name ?? u.name ?? '').trim();
  return { full: [first, last].filter(Boolean).join(' ').trim() || fullFallback };
}

function getInitials(name: string): string {
  const safe = (name || '').trim();
  if (!safe) return 'DR';
  return safe
    .split(/\s+/)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function readAuthUserName(): string {
  if (typeof window === 'undefined') return '';
  try {
    const raw = localStorage.getItem('authUser');
    if (!raw) return '';
    return extractNameParts(JSON.parse(raw)).full;
  } catch {
    return '';
  }
}

type CompanyProfile = {
  company_id: string;
  company_name: string;
  status: string;
  my_role?: string | null;
};

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

const PAGE_TITLES: { prefix: string; title: string }[] = [
  { prefix: '/admin/dashboard', title: 'Dashboard' },
  { prefix: '/admin/company', title: 'Company' },
  { prefix: '/admin/employee-list', title: 'Employee List' },
  { prefix: '/admin/bizcard-list', title: 'BizCard List' },
  { prefix: '/admin/bizcard', title: 'BizCard Dashboard' },
  { prefix: '/admin/leads', title: 'Leads' },
  { prefix: '/admin/inquiry-page', title: 'Inquiry' },
  { prefix: '/admin/affiliate', title: 'Affiliate Status' },
  { prefix: '/admin/associate', title: 'Associate' },
  { prefix: '/admin/calendar', title: 'Calendar' },
 
  { prefix: '/admin/emarket', title: 'E-Market' },
  { prefix: '/admin/settings', title: 'Settings' },
];

function resolvePageTitle(pathname: string): string {
  const match = PAGE_TITLES.find((item) => pathname === item.prefix || pathname.startsWith(`${item.prefix}/`));
  return match?.title ?? 'Dashboard';
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  /* Auth guard state */
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [initials, setInitials] = useState('DR');
  const [fullName, setFullName] = useState('');
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notificationsHasMore, setNotificationsHasMore] = useState(false);
  const [notificationsPage, setNotificationsPage] = useState(1);
  const [notificationsLoadingMore, setNotificationsLoadingMore] = useState(false);
  const notificationListRef = useRef<HTMLDivElement>(null);
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const avatarRef = useRef<HTMLDivElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);
  const lastAllowedPathRef = useRef('/admin/dashboard');
  const [userRole, setUserRole] = useState('admin');
  const [impersonationActive, setImpersonationActive] = useState(false);
  const [endingImpersonation, setEndingImpersonation] = useState(false);
  
  /* Support messenger state */
  const [supportOpen, setSupportOpen] = useState(false);
  const [messengerOpen, setMessengerOpen] = useState(false);
  const [supportUnread, setSupportUnread] = useState(0);
  const [messagingUnread, setMessagingUnread] = useState(0);
  const pageTitle = useMemo(() => resolvePageTitle(pathname), [pathname]);

  /* ── Auth Guard: validate session before rendering protected content ── */
  useEffect(() => {
    let cancelled = false;
    const validateSession = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/auth/session`, {
          credentials: 'include',
          headers: buildImpersonationHeaders(),
        });
        if (cancelled) return;
        if (!res.ok) {
          localStorage.removeItem('authUser');
          router.replace('/');
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        if (!data.authenticated) {
          localStorage.removeItem('authUser');
          router.replace('/');
          return;
        }
        const role = String(data.user?.role ?? 'user').toLowerCase();
        const impersonating = Boolean(data.impersonation?.active);
        setImpersonationActive(impersonating);
        setUserRole(role);
        if (impersonating) {
          const impersonatedName = [data.user?.firstName, data.user?.lastName].filter(Boolean).join(' ').trim();
          if (impersonatedName) {
            setFullName(impersonatedName);
            setInitials(getInitials(impersonatedName));
          }
        }
        if (!canAccessPath(role, pathname) && !impersonating) {
          router.replace(getSafePortalRedirect(role, lastAllowedPathRef.current));
          return;
        }
        if (!canAccessPath(role, pathname) && impersonating) {
          router.replace('/admin/dashboard');
          return;
        }
        if (
          !impersonating &&
          data.user?.requiresPasswordChange === true
        ) {
          router.replace('/user/change-password-required');
          return;
        }
        // PCO placeholder emails must change email on the login page (OTP flow).
        if (!impersonating && data.user?.requiresEmailChange === true) {
          router.replace('/');
          return;
        }
        setIsAuthenticated(true);
      } catch {
        if (!cancelled) {
          localStorage.removeItem('authUser');
          router.replace('/');
        }
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    };
    void validateSession();
    return () => { cancelled = true; };
  }, [router, pathname]);

  useEffect(() => {
    if (!authChecked || !isAuthenticated) return;
    if (canAccessPath(userRole, pathname)) {
      lastAllowedPathRef.current = pathname;
      rememberPortalPath(userRole, pathname);
    }
  }, [authChecked, isAuthenticated, pathname, userRole]);

  useEffect(() => {
    if (!authChecked || !isAuthenticated) return;
    if (canAccessPath(userRole, pathname)) return;
    router.replace(getSafePortalRedirect(userRole, lastAllowedPathRef.current));
  }, [authChecked, isAuthenticated, pathname, router, userRole]);

  useEffect(() => {
    const applyName = (name: string) => {
      const safe = name.trim();
      if (!safe) return false;
      setFullName(safe);
      setInitials(getInitials(safe));
      return true;
    };
    const hydrateFromLocal = () => {
      if (applyName(readAuthUserName())) return;
      // Do not use latestPortfolioAlias / portfolio_* — can leak another user's name.
    };
    const hydrateFromApi = async () => {
      try {
        const r = await fetch(`${API_BASE_URL}/api/vcard/profile`, { credentials: 'include' });
        if (!r.ok) return;
        const d = await r.json();
        const p = d?.profile;
        const { full } = extractNameParts({
          first_name: p?.first_name,
          last_name: p?.last_name,
          firstName: p?.firstName,
          lastName: p?.lastName,
          name: p?.vcard_name,
        });
        applyName(full || p?.vcard_name || '');
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
    window.addEventListener('focus', syncIdentity);
    return () => {
      window.removeEventListener(USER_SYNC_EVENT, syncIdentity);
      window.removeEventListener('focus', syncIdentity);
    };
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) {
        setAvatarOpen(false);
      }
      if (notificationRef.current && !notificationRef.current.contains(e.target as Node)) {
        setNotificationOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fetchUnreadCount = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/notifications/unread/count`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data: NotificationsResponse = await response.json();
        if (data.success) {
          setUnreadCount(data.data.unreadCount);
        }
      }
    } catch (error) {
      console.error('Failed to fetch unread count:', error);
    }
  };

  const fetchNotifications = async (pageNum = 1, append = false) => {
    try {
      if (append) setNotificationsLoadingMore(true);
      const response = await fetch(
        `${API_BASE_URL}/api/notifications?limit=10&page=${pageNum}`,
        { credentials: 'include' },
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
      console.error('Failed to fetch notifications:', error);
    } finally {
      if (append) setNotificationsLoadingMore(false);
    }
  };

  const loadMoreNotifications = async () => {
    if (notificationsLoadingMore || !notificationsHasMore) return;
    await fetchNotifications(notificationsPage + 1, true);
  };

  const markAsRead = async (notificationId: string) => {
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === notificationId
          ? { ...n, read_at: n.read_at ?? new Date().toISOString(), is_read: true }
          : n,
      ),
    );
    try {
      const csrfToken = await csrfClient.getToken(false, API_BASE_URL || undefined);
      const response = await fetch(`${API_BASE_URL}/api/notifications/${notificationId}/read`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
      });
      if (!response.ok) {
        console.error('Failed to mark as read:', response.status);
      }
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  };


  const handleNotificationClick = async (notification: Notification) => {
    const wasUnread = !notification.read_at && notification.is_read !== true;
    void markAsRead(notification.id);
    if (wasUnread) setUnreadCount((prev) => Math.max(0, prev - 1));
    setNotificationOpen(false);
    const url = typeof notification.action_url === 'string' ? notification.action_url.trim() : '';
    if (url.includes('openSupport=1')) {
      setSupportOpen(true);
      return;
    }
    if (url) router.push(url);
  };

  const markAllAsRead = async () => {
    try {
      const csrfToken = await csrfClient.getToken(false, API_BASE_URL || undefined);
      const response = await fetch(`${API_BASE_URL}/api/notifications/mark-all-read`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
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
      }
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    }
  };

  const fetchSupportUnread = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/support/unread/count`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setSupportUnread(Number(data.data?.count ?? 0));
      }
    } catch (error) {
      console.error('Failed to fetch support unread count:', error);
    }
  };

  const fetchMessagingUnread = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/messaging/unread/count`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setMessagingUnread(Number(data?.data?.count ?? 0));
      }
    } catch (error) {
      console.error('Failed to fetch messaging unread count:', error);
    }
  };

  const refreshMessengerUnread = async () => {
    await Promise.all([fetchSupportUnread(), fetchMessagingUnread()]);
  };

  const messengerFabUnread = supportUnread + messagingUnread;

  useEffect(() => {
    void fetchUnreadCount();
    void refreshMessengerUnread();
    const interval = setInterval(() => {
      void fetchUnreadCount();
      void refreshMessengerUnread();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const base = getFrontendApiBaseUrl();
    void csrfClient.getToken(true, base || undefined);
  }, []);

  useEffect(() => {
    if (notificationOpen) {
      fetchNotifications();
    }
  }, [notificationOpen]);

  useEffect(() => {
    if (searchParams?.get('openSupport') === '1') {
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
    let isMounted = true;
    const fetchCompanyProfile = async () => {
      setLoading(true);
      try {
        const response = await fetch(`${API_BASE_URL}/api/company/my-company`, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...buildAuthHeaders(),
            ...buildImpersonationHeaders(),
          },
        });
        if (!response.ok) {
          if (isMounted) router.replace('/user/dashboard');
          return;
        }
        const payload = (await response.json().catch(() => ({}))) as {
          data?: { company_id?: string; company_name?: string; status?: string; my_role?: string };
        };
        const data = payload.data ?? {};
        const role = String(data.my_role ?? '').toLowerCase();
        const status = String(data.status ?? '').toLowerCase();
        if (status !== 'active' || !(role === 'admin' || role === 'manager' || role === 'company_admin')) {
          if (isMounted) router.replace('/user/dashboard');
          return;
        }
        if (isMounted) {
          setCompanyProfile({
            company_id: String(data.company_id ?? ''),
            company_name: String(data.company_name ?? ''),
            status,
            my_role: role,
          });
          try {
            const raw = window.localStorage.getItem('authUser');
            const existing = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
            const portalRole = role === 'manager' ? 'manager' : 'company_admin';
            window.localStorage.setItem(
              'authUser',
              JSON.stringify({
                ...existing,
                role: portalRole,
                company_id: String(data.company_id ?? ''),
              })
            );
          } catch {
            // ignore localStorage errors
          }
        }
      } catch {
        if (isMounted) router.replace('/user/dashboard');
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    void fetchCompanyProfile();
    return () => {
      isMounted = false;
    };
  }, [router]);

  const handleLogout = async () => {
    await performLogout({
      apiBaseUrl: API_BASE_URL,
      redirectTo: '/',
    });
  };

  const handleEndImpersonation = async () => {
    setEndingImpersonation(true);
    try {
      const handoffToken = readImpersonationHandoffToken();
      const csrfToken = await csrfClient.getToken(false, API_BASE_URL || undefined);
      const response = await fetch(`${API_BASE_URL}/api/superadmin/companies/impersonation/end`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
          ...buildAuthHeaders(),
          ...buildImpersonationHeaders(),
        },
        body: JSON.stringify(
          handoffToken
            ? { token: handoffToken, reason: 'Ended from admin impersonation banner' }
            : { reason: 'Ended from admin impersonation banner' },
        ),
      });
      if (!response.ok) {
        throw new Error('Failed to end impersonation');
      }
      clearImpersonationHandoff();
      window.location.assign('/superadmin/dashboard');
    } catch (error) {
      console.error('Failed to end impersonation:', error);
    } finally {
      setEndingImpersonation(false);
    }
  };

  /* ── Auth guard: show nothing until session is validated ── */
  if (!authChecked || !isAuthenticated) {
    return <FullPageLoader text="Validating session..." />;
  }

  return (
    <PortalPageAccessProvider portal="admin">
    <div className="bg-[#F4F7FC]">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="lg:ml-55 h-screen overflow-hidden flex flex-col">
        <header className="shrink-0 bg-white border-b border-gray-200 shadow-sm px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between z-30">
          <div className="flex items-center gap-3">
            <span
              className="h-6 w-1 rounded-full shrink-0"
              style={{ background: 'linear-gradient(180deg,#2A4792,#4785B8)' }}
            />
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{pageTitle}</h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/admin/calendar"
              className={`rounded-full p-2 transition-colors ${
                pathname.startsWith('/admin/calendar')
                  ? 'bg-[#EEF2FA] text-[#2A4792]'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
              aria-label="Calendar"
              title="Calendar"
            >
              <CalendarDays className="h-5 w-5" />
            </Link>
            <div className="relative" ref={notificationRef}>
              <PhysicalBizCardHelpButton />
              {notificationOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-lg border border-gray-100 py-2 z-50 max-h-96 flex flex-col overflow-hidden">
                  <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between shrink-0">
                    <h3 className="text-sm font-semibold text-gray-800">Notifications</h3>
                    <div className="flex items-center gap-2">
                      {unreadCount > 0 && (
                        <>
                          <span className="text-xs text-red-600 font-semibold">{unreadCount} unread</span>
                          <button
                            onClick={markAllAsRead}
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
                      className="divide-y divide-gray-100 overflow-y-auto max-h-80"
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
                            if (e.key === 'Enter') void handleNotificationClick(notification);
                          }}
                          className={`px-4 py-3 hover:bg-gray-50 cursor-pointer ${
                            isUnread ? 'bg-blue-50/50' : ''
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
                      {notificationsLoadingMore && (
                        <div className="px-4 py-2 text-center text-xs text-gray-400">Loading more…</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="relative" ref={avatarRef}>
              <button
                onClick={() => setAvatarOpen(v => !v)}
                className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 select-none"
                aria-label="Account menu"
              >
                <div
                  className="relative h-8 w-8 rounded-full flex items-center justify-center text-white font-semibold text-sm shrink-0"
                  style={{ background: 'linear-gradient(135deg,#2A4792,#4785B8)' }}
                >
                  {initials}
                  {unreadCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white ring-2 ring-white">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </div>
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
                  <button
                    onClick={() => { setAvatarOpen(false); router.push('/admin/settings'); }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <Settings className="h-4 w-4" /> Settings
                  </button>
                  <AccountMenuLegalLinks onNavigate={() => setAvatarOpen(false)} />
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <LogOut className="h-4 w-4" /> Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {impersonationActive ? (
          <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2.5 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-medium text-amber-900">
                Superadmin impersonation active — acting as <span className="font-semibold">{fullName || 'company admin'}</span>
              </p>
              <button
                type="button"
                onClick={() => void handleEndImpersonation()}
                disabled={endingImpersonation}
                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                {endingImpersonation ? 'Ending...' : 'End Impersonation'}
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto bg-[#F4F7FC] p-4 pb-28 sm:p-6 sm:pb-28 lg:p-8 lg:pb-8">
          {loading ? (
            <SectionLoader text="Loading admin workspace..." minHeightClass="min-h-[50vh]" />
          ) : (
            <PortalPageAccessGuard portal="admin">{children}</PortalPageAccessGuard>
          )}
        </div>
      </div>

      {!(supportOpen || messengerOpen) ? (
        <div className="fixed bottom-24 right-4 z-99999 lg:bottom-6 lg:right-6">
          <div className="relative">
            {messengerFabUnread > 0 ? (
              <>
                <div className="pointer-events-none absolute inset-0 rounded-full bg-primary/40 animate-fab-pulse" />
                <div
                  className="pointer-events-none absolute inset-0 rounded-full bg-primary/30 animate-fab-pulse"
                  style={{ animationDelay: '0.8s' }}
                />
              </>
            ) : null}
            <button
              type="button"
              onClick={() => setSupportOpen(true)}
              className={`relative bg-white shadow-xl rounded-full flex items-center justify-center p-4 w-auto aspect-square text-primary hover:bg-primary-light hover:text-white focus:scale-95 focus:bg-primary focus:text-white transition-all duration-20 ${
                messengerFabUnread > 0 ? 'animate-messenger-attention ring-2 ring-primary/40' : ''
              }`}
              aria-label={
                messengerFabUnread > 0
                  ? `Open messages, ${messengerFabUnread} unread`
                  : 'Open messages'
              }
            >
              <MessageCircle className="h-6 w-6 stroke-2" />
              {messengerFabUnread > 0 && (
                <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white shadow-sm">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" />
                  <span className="relative">{messengerFabUnread > 9 ? '9+' : messengerFabUnread}</span>
                </span>
              )}
            </button>
          </div>
        </div>
      ) : null}
      <ConnectionMessengerPanel
        open={supportOpen}
        initialView={messagingUnread > 0 ? 'list' : 'support'}
        onClose={() => {
          setSupportOpen(false);
          void refreshMessengerUnread();
        }}
      />
    </div>
    </PortalPageAccessProvider>
  );
}
