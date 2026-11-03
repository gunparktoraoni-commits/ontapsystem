"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Info,
  LogOut,
  Search,
  ShieldCheck,
  ShieldX,
  X,
} from 'lucide-react';
import { getFrontendApiBaseUrl } from '@/app/components/apiBase';
import { PortalModal } from '../../components/ui';

type SessionStatus = 'Active' | 'Expired' | 'Logged Out';
type DevicePlatform = 'Windows' | 'macOS' | 'Linux' | 'iOS' | 'Android';
type DateRangePreset = 'all_time' | 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom';
type DeviceFilter = 'all_devices' | DevicePlatform;
type ExportFormat = 'csv' | 'pdf';
type PaginationToken = number | 'ellipsis';

interface LoginSession {
  id: string;
  sessionId: string;
  loginAtIso: string;
  lastActivityIso: string;
  logoutAtIso: string | null;
  browserName: string;
  browserVersion: string;
  osName: string;
  osVersion: string;
  platform: DevicePlatform;
  ipAddress: string;
  city: string;
  region: string;
  country: string;
  status: SessionStatus;
  isCurrent: boolean;
  userAgent: string;
  deviceFingerprint: string;
}

interface ToastState {
  type: 'success' | 'error';
  message: string;
}

const BACKEND_URL = '';

function getSettingsApiBase(): string {
  return getFrontendApiBaseUrl() || BACKEND_URL;
}
const POLL_INTERVAL_MS = 10_000;

const UNAVAILABLE_LABEL = '—';

const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const DATE_ONLY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

function parseLocationString(location: string | null | undefined): {
  city: string;
  region: string;
  country: string;
} {
  const unavailable = { city: UNAVAILABLE_LABEL, region: UNAVAILABLE_LABEL, country: UNAVAILABLE_LABEL };

  if (!location?.trim() || location.trim().toLowerCase() === 'unknown location') {
    return unavailable;
  }

  const parts = location.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 3) {
    return { city: parts[0], region: parts[1], country: parts.slice(2).join(', ') };
  }
  if (parts.length === 2) {
    return { city: parts[0], region: UNAVAILABLE_LABEL, country: parts[1] };
  }
  return { city: UNAVAILABLE_LABEL, region: UNAVAILABLE_LABEL, country: parts[0] };
}

function toIsoDateParam(date: Date): string {
  return date.toISOString();
}

function buildLoginHistoryQuery(params: {
  page: number;
  limit: number;
  datePreset: DateRangePreset;
  customStartDate: string;
  customEndDate: string;
  deviceFilter: DeviceFilter;
  showActiveOnly: boolean;
}): string {
  const search = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit),
  });

  const range = getDateRange(params.datePreset, params.customStartDate, params.customEndDate);
  if (range) {
    search.set('from', toIsoDateParam(range.start));
    search.set('to', toIsoDateParam(range.end));
  }

  if (params.deviceFilter !== 'all_devices') {
    search.set('device', params.deviceFilter);
  }

  if (params.showActiveOnly) {
    search.set('active', 'true');
  }

  return search.toString();
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return UNAVAILABLE_LABEL;

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return UNAVAILABLE_LABEL;

  const parts = TIMESTAMP_FORMATTER.formatToParts(date);
  const lookup = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '00';

  return `${lookup('year')}-${lookup('month')}-${lookup('day')} ${lookup('hour')}:${lookup('minute')}:${lookup('second')}`;
}

function parseApiDateTime(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  return null;
}

function formatDisplayIp(value: string | null | undefined): string {
  const normalized = value?.trim();
  if (!normalized || normalized.toLowerCase() === 'unknown' || normalized.toLowerCase() === 'n/a') {
    return UNAVAILABLE_LABEL;
  }
  return normalized;
}

function formatDateOnly(iso: string): string {
  return DATE_ONLY_FORMATTER.format(new Date(iso));
}

function formatLocation(session: LoginSession): string {
  const parts = [session.city, session.region, session.country].filter(
    (part) => part && part !== UNAVAILABLE_LABEL
  );
  return parts.length > 0 ? parts.join(', ') : UNAVAILABLE_LABEL;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function getDateRange(preset: DateRangePreset, customStart: string, customEnd: string): { start: Date; end: Date } | null {
  const now = new Date();
  const today = startOfDay(now);

  if (preset === 'all_time') return null;

  if (preset === 'today') {
    return { start: today, end: endOfDay(today) };
  }

  if (preset === 'yesterday') {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return { start: yesterday, end: endOfDay(yesterday) };
  }

  if (preset === 'this_week') {
    const weekStart = new Date(today);
    const weekDay = weekStart.getDay();
    const offset = weekDay === 0 ? -6 : 1 - weekDay;
    weekStart.setDate(weekStart.getDate() + offset);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    return { start: startOfDay(weekStart), end: endOfDay(weekEnd) };
  }

  if (preset === 'this_month') {
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { start: monthStart, end: endOfDay(monthEnd) };
  }

  if (preset === 'custom') {
    if (!customStart || !customEnd) return null;
    const parsedStart = new Date(`${customStart}T00:00:00`);
    const parsedEnd = new Date(`${customEnd}T23:59:59`);

    if (Number.isNaN(parsedStart.getTime()) || Number.isNaN(parsedEnd.getTime())) return null;

    return { start: parsedStart, end: parsedEnd };
  }

  return null;
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function buildPaginationTokens(currentPage: number, totalPages: number): PaginationToken[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 3) {
    return [1, 2, 3, 'ellipsis', totalPages];
  }

  if (currentPage >= totalPages - 2) {
    return [1, 'ellipsis', totalPages - 2, totalPages - 1, totalPages];
  }

  return [1, 'ellipsis', currentPage - 1, currentPage, currentPage + 1, 'ellipsis', totalPages];
}

function statusBadgeClass(status: SessionStatus): string {
  if (status === 'Active') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }

  if (status === 'Expired') {
    return 'border-slate-200 bg-slate-100 text-slate-600';
  }

  return 'border-rose-200 bg-rose-50 text-rose-700';
}

function ToggleSwitch({
  checked,
  onCheckedChange,
  ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onCheckedChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4b74bf] focus-visible:ring-offset-2 ${
        checked ? 'border-primary bg-primary' : 'border-gray-100 bg-[#eef3ff]'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function ActionConfirmationModal({
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  loading,
  open,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
  open: boolean;
}) {
  return (
    <PortalModal
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      size="sm"
      preventClose={loading}
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="inline-flex items-center justify-center rounded-xl border border-gray-100 bg-white px-4 py-2 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="inline-flex items-center justify-center rounded-xl border border-[#b34848] bg-[#c65252] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#b34848] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Processing...' : confirmLabel}
          </button>
        </div>
      }
    >
      <p className="sr-only">{description}</p>
    </PortalModal>
  );
}

function mapPlatform(value: unknown): DevicePlatform {
  if (value === 'Windows' || value === 'macOS' || value === 'Linux' || value === 'iOS' || value === 'Android') {
    return value;
  }
  return 'Windows';
}

function mapApiSession(item: Record<string, unknown>, currentSessionId: string | null): LoginSession {
  const sessionId = String(item.session_id ?? '');
  const isActive = Boolean(item.is_active);
  const logoutTime = parseApiDateTime(item.logout_time);
  const loginTime = parseApiDateTime(item.login_time);

  let status: SessionStatus = 'Expired';
  if (isActive) {
    status = 'Active';
  } else if (logoutTime) {
    status = 'Logged Out';
  }

  const osName = typeof item.os === 'string' && item.os.trim() ? item.os : UNAVAILABLE_LABEL;
  const location = parseLocationString(typeof item.location === 'string' ? item.location : null);

  return {
    id: String(item.login_id ?? sessionId),
    sessionId,
    loginAtIso: loginTime ?? '',
    lastActivityIso: logoutTime ?? loginTime ?? '',
    logoutAtIso: logoutTime,
    browserName: typeof item.browser === 'string' && item.browser.trim() ? item.browser : UNAVAILABLE_LABEL,
    browserVersion: '',
    osName,
    osVersion: '',
    platform: mapPlatform(osName),
    ipAddress: formatDisplayIp(typeof item.ip_address === 'string' ? item.ip_address : null),
    city: location.city,
    region: location.region,
    country: location.country,
    status,
    isCurrent: currentSessionId !== null && sessionId === currentSessionId,
    userAgent: 'N/A',
    deviceFingerprint: 'N/A',
  };
}

async function revokeSessionRequest(sessionId: string): Promise<void> {
        const response = await fetch(`${getSettingsApiBase()}/api/superadmin/settings/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error(`Session revoke failed: ${response.status}`);
}

async function revokeAllOtherSessionsRequest(currentSessionId: string): Promise<void> {
  const response = await fetch(`${getSettingsApiBase()}/api/superadmin/settings/sessions/revoke-all`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_session_id: currentSessionId }),
  });
  if (!response.ok) throw new Error(`Revoke-all failed: ${response.status}`);
}

export default function LoginHistoryPanel() {
  const [sessions, setSessions] = useState<LoginSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [totalRecords, setTotalRecords] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [datePreset, setDatePreset] = useState<DateRangePreset>('all_time');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [deviceFilter, setDeviceFilter] = useState<DeviceFilter>('all_devices');
  const [showActiveOnly, setShowActiveOnly] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  const [selectedSession, setSelectedSession] = useState<LoginSession | null>(null);
  const [logoutTarget, setLogoutTarget] = useState<LoginSession | null>(null);
  const [confirmLogoutAllOpen, setConfirmLogoutAllOpen] = useState(false);

  const [isRevokingSession, setIsRevokingSession] = useState<string | null>(null);
  const [isRevokingAll, setIsRevokingAll] = useState(false);

  const [isExportOpen, setIsExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv');
  const [exportDatePreset, setExportDatePreset] = useState<DateRangePreset>('this_month');
  const [exportCustomStartDate, setExportCustomStartDate] = useState('');
  const [exportCustomEndDate, setExportCustomEndDate] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function fetchLoginHistory(silent = false): Promise<void> {
      if (!silent) {
        setIsLoading(true);
      }

      try {
        const query = buildLoginHistoryQuery({
          page: currentPage,
          limit: pageSize,
          datePreset,
          customStartDate,
          customEndDate,
          deviceFilter,
          showActiveOnly,
        });

        const response = await fetch(`${getSettingsApiBase()}/api/superadmin/settings/login-history?${query}`, {
          method: 'GET',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!response.ok) throw new Error(`Login history fetch failed: ${response.status}`);

        const payload = await response.json();
        const data = payload?.data;
        const rows = data?.history ?? [];
        const sessionId =
          typeof data?.current_session_id === 'string' ? data.current_session_id : null;

        if (!Array.isArray(rows) || !isMounted) return;

        setCurrentSessionId(sessionId);
        setSessions(
          rows
            .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
            .map((row) => mapApiSession(row, sessionId))
        );

        const pagination = data?.pagination;
        if (pagination && typeof pagination === 'object') {
          setTotalRecords(typeof pagination.total === 'number' ? pagination.total : rows.length);
          setTotalPages(typeof pagination.pages === 'number' ? Math.max(1, pagination.pages) : 1);
        } else {
          setTotalRecords(rows.length);
          setTotalPages(1);
        }
      } catch (error) {
        console.error('Failed to fetch login history:', error);
      } finally {
        if (isMounted && !silent) {
          setIsLoading(false);
        }
      }
    }

    void fetchLoginHistory();
    const intervalId = window.setInterval(() => {
      void fetchLoginHistory(true);
    }, POLL_INTERVAL_MS);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [currentPage, customEndDate, customStartDate, datePreset, deviceFilter, pageSize, showActiveOnly]);

  const activeSessionCount = useMemo(() => {
    return sessions.filter((session) => session.status === 'Active').length;
  }, [sessions]);

  const activeOtherSessionCount = useMemo(() => {
    return sessions.filter((session) => session.status === 'Active' && !session.isCurrent).length;
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return sessions;

    return sessions.filter((session) => {
      const searchable = [
        session.ipAddress,
        session.browserName,
        session.browserVersion,
        session.osName,
        session.osVersion,
        session.city,
        session.region,
        session.country,
        session.platform,
      ]
        .join(' ')
        .toLowerCase();

      return searchable.includes(query);
    });
  }, [searchQuery, sessions]);

  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedSessions = filteredSessions;

  const paginationTokens = useMemo(() => {
    return buildPaginationTokens(safeCurrentPage, totalPages);
  }, [safeCurrentPage, totalPages]);

  const firstVisible = totalRecords === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1;
  const lastVisible = Math.min(safeCurrentPage * pageSize, totalRecords);

  const showToast = (next: ToastState) => {
    setToast(next);

    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }

    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, 3000);
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setDatePreset('all_time');
    setCustomStartDate('');
    setCustomEndDate('');
    setDeviceFilter('all_devices');
    setShowActiveOnly(false);
    setCurrentPage(1);
  };

  const updateSessionStatus = (id: string, nextStatus: SessionStatus) => {
    const nowIso = new Date().toISOString();
    setSessions((previous) => {
      return previous.map((session) => {
        if (session.id !== id) return session;
        return {
          ...session,
          status: nextStatus,
          lastActivityIso: nowIso,
          logoutAtIso: nextStatus === 'Active' ? session.logoutAtIso : nowIso,
        };
      });
    });
  };

  const handleConfirmSingleLogout = async () => {
    if (!logoutTarget) return;

    if (logoutTarget.isCurrent || logoutTarget.status !== 'Active') {
      setLogoutTarget(null);
      return;
    }

    setIsRevokingSession(logoutTarget.id);

    try {
      await revokeSessionRequest(logoutTarget.sessionId);
      updateSessionStatus(logoutTarget.id, 'Logged Out');
      showToast({ type: 'success', message: 'Session successfully terminated.' });
    } catch {
      showToast({ type: 'error', message: 'Failed to terminate session. Please try again.' });
    } finally {
      setIsRevokingSession(null);
      setLogoutTarget(null);
    }
  };

  const handleConfirmLogoutAllOthers = async () => {
    const current =
      sessions.find((session) => session.isCurrent) ??
      (currentSessionId ? { sessionId: currentSessionId } : null);
    if (!current) {
      setConfirmLogoutAllOpen(false);
      showToast({ type: 'error', message: 'Current session not found. Unable to continue.' });
      return;
    }

    setIsRevokingAll(true);

    try {
      await revokeAllOtherSessionsRequest(current.sessionId);
      let revokedCount = 0;
      const nowIso = new Date().toISOString();

      setSessions((previous) => {
        return previous.map((session) => {
          if (session.isCurrent || session.status !== 'Active') {
            return session;
          }

          revokedCount += 1;
          return {
            ...session,
            status: 'Logged Out',
            lastActivityIso: nowIso,
            logoutAtIso: nowIso,
          };
        });
      });

      showToast({
        type: 'success',
        message: `Terminated ${revokedCount} active session${revokedCount === 1 ? '' : 's'} on other devices.`,
      });
    } catch {
      showToast({ type: 'error', message: 'Failed to log out other sessions. Please try again.' });
    } finally {
      setIsRevokingAll(false);
      setConfirmLogoutAllOpen(false);
    }
  };

  const resolveExportRows = (): LoginSession[] => {
    const range = getDateRange(exportDatePreset, exportCustomStartDate, exportCustomEndDate);

    if (!range) {
      return [...sessions];
    }

    return sessions.filter((session) => {
      const loginAt = new Date(session.loginAtIso);
      return loginAt >= range.start && loginAt <= range.end;
    });
  };

  const exportCsv = (rows: LoginSession[]) => {
    const header = [
      'Timestamp',
      'Browser',
      'Operating System',
      'IP Address',
      'Location',
      'Status',
      'Current Session',
      'Session ID',
    ];

    const body = rows.map((session) => {
      return [
        formatTimestamp(session.loginAtIso),
        `${session.browserName} ${session.browserVersion}`,
        `${session.osName} ${session.osVersion}`,
        session.ipAddress,
        formatLocation(session),
        session.status,
        session.isCurrent ? 'Yes' : 'No',
        session.sessionId,
      ];
    });

    const csv = [header, ...body]
      .map((line) => line.map((value) => csvEscape(String(value))).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'login-history-export.csv';
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const handleConfirmExport = () => {
    const rows = resolveExportRows();

    if (!rows.length) {
      showToast({ type: 'error', message: 'No session records available for the selected export range.' });
      return;
    }

    if (exportFormat === 'csv') {
      exportCsv(rows);
    } else {
      console.log('POST /api/superadmin/sessions/export', {
        format: exportFormat,
        rangePreset: exportDatePreset,
        customStartDate: exportCustomStartDate,
        customEndDate: exportCustomEndDate,
        rows,
      });
    }

    setIsExportOpen(false);
    showToast({
      type: 'success',
      message: `Login history exported as ${exportFormat.toUpperCase()} (${rows.length} record(s)).`,
    });
  };

  return (
    <section className="space-y-6">
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="fixed right-4 top-4 z-50 w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-4 shadow-[0_24px_60px_rgba(15,23,42,0.24)]"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-start gap-3">
              <span
                className={`mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-xl ${
                  toast.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                }`}
              >
                {toast.type === 'success' ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : (
                  <AlertTriangle className="h-5 w-5" />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900">
                  {toast.type === 'success' ? 'Success' : 'Action Required'}
                </p>
                <p className="mt-1 text-sm text-gray-500">{toast.message}</p>
              </div>

              <button
                type="button"
                onClick={() => setToast(null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-100 text-gray-500 transition-colors hover:bg-gray-50"
                aria-label="Dismiss message"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <h3 className="text-2xl font-bold text-gray-900">Login History</h3>
          <p className="text-sm text-gray-500">Complete log of all login attempts and active sessions</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setConfirmLogoutAllOpen(true)}
            disabled={activeOtherSessionCount === 0 || isRevokingAll}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-300 bg-white px-4 py-2.5 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LogOut className="h-4 w-4" />
            {isRevokingAll ? 'Processing...' : 'Log Out All Other Sessions'}
          </button>

          <button
            type="button"
            onClick={() => setIsExportOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#3f86d4] bg-[#4798ee] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#3f88d5]"
          >
            <Download className="h-4 w-4" />
            Export
          </button>
        </div>
      </header>

      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#e9f6ec] text-emerald-700">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-gray-900">
              You have {activeSessionCount} active session{activeSessionCount === 1 ? '' : 's'}.
            </p>
            <p className="mt-0.5 text-sm text-gray-500">
              Review active devices regularly and revoke any session you do not recognize.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8ca0c2]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search by IP address, browser, or location..."
              className="h-11 w-full rounded-xl border border-gray-100 bg-[#fbfdff] pl-10 pr-3 text-sm text-[#304a76] outline-none transition-colors focus:border-[#87acdd]"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1fr_auto_auto]">
            <label className="space-y-1">
              <span className="text-xs font-semibold text-gray-500">Date Range</span>
              <div className="relative">
                <CalendarRange className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8ca0c2]" />
                <select
                  value={datePreset}
                  onChange={(event) => {
                    setDatePreset(event.target.value as DateRangePreset);
                    setCurrentPage(1);
                  }}
                  className="h-10 w-full rounded-lg border border-gray-100 bg-white pl-9 pr-3 text-sm font-semibold text-[#2b467c] outline-none transition-colors focus:border-[#89addd]"
                >
                  <option value="all_time">All Time</option>
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="this_week">This Week</option>
                  <option value="this_month">This Month</option>
                  <option value="custom">Custom Date Range</option>
                </select>
              </div>
            </label>

            <label className="space-y-1">
              <span className="text-xs font-semibold text-gray-500">Device / Platform</span>
              <select
                value={deviceFilter}
                onChange={(event) => {
                  setDeviceFilter(event.target.value as DeviceFilter);
                  setCurrentPage(1);
                }}
                className="h-10 w-full rounded-lg border border-gray-100 bg-white px-3 text-sm font-semibold text-[#2b467c] outline-none transition-colors focus:border-[#89addd]"
              >
                <option value="all_devices">All Devices</option>
                <option value="Windows">Windows</option>
                <option value="macOS">macOS</option>
                <option value="Linux">Linux</option>
                <option value="iOS">iOS</option>
                <option value="Android">Android</option>
              </select>
            </label>

            <label className="inline-flex items-end">
              <button
                type="button"
                onClick={handleClearFilters}
                className="h-10 w-full rounded-lg border border-gray-100 px-3 text-sm font-semibold text-[#3d5586] transition-colors hover:bg-gray-50"
              >
                Clear Filters
              </button>
            </label>

            <label className="flex items-center gap-3 rounded-lg border border-gray-100 bg-[#fbfdff] px-3 py-2">
              <ToggleSwitch
                checked={showActiveOnly}
                onCheckedChange={(next) => {
                  setShowActiveOnly(next);
                  setCurrentPage(1);
                }}
                ariaLabel="Show active sessions only"
              />
              <span className="text-sm font-semibold text-[#2b467c]">Show Active Sessions Only</span>
            </label>
          </div>

          {datePreset === 'custom' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-semibold text-gray-500">Start Date</span>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(event) => {
                    setCustomStartDate(event.target.value);
                    setCurrentPage(1);
                  }}
                  className="h-10 w-full rounded-lg border border-gray-100 bg-white px-3 text-sm font-semibold text-[#2b467c] outline-none transition-colors focus:border-[#89addd]"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold text-gray-500">End Date</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(event) => {
                    setCustomEndDate(event.target.value);
                    setCurrentPage(1);
                  }}
                  className="h-10 w-full rounded-lg border border-gray-100 bg-white px-3 text-sm font-semibold text-[#2b467c] outline-none transition-colors focus:border-[#89addd]"
                />
              </label>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold text-[#5f7295]">
            {searchQuery.trim()
              ? `Showing ${paginatedSessions.length} matching record(s) on this page`
              : `Showing ${firstVisible}-${lastVisible} of ${totalRecords} records`}
            {isLoading ? ' · Refreshing...' : ''}
          </p>
          <p className="text-sm text-gray-500">Auto-refreshes every 10 seconds. Click a session for full details.</p>
        </div>

        {isLoading && sessions.length === 0 ? (
          <div className="rounded-2xl border border-gray-100 bg-[#fbfdff] px-4 py-12 text-center">
            <p className="text-sm font-semibold text-gray-900">Loading login history...</p>
          </div>
        ) : paginatedSessions.length > 0 ? (
          <motion.div layout className="space-y-3">
            <AnimatePresence initial={false}>
              {paginatedSessions.map((session) => {
                const isActive = session.status === 'Active';
                const isMuted = session.status !== 'Active';

                return (
                  <motion.article
                    key={session.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: isMuted ? 0.78 : 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.98 }}
                    transition={{ duration: 0.3 }}
                    className={`cursor-pointer rounded-2xl border bg-white p-4 shadow-sm transition-all duration-150 hover:scale-[1.01] hover:shadow-[0_10px_24px_rgba(24,39,75,0.12)] ${
                      session.isCurrent
                        ? 'border-[#9fb9e8] bg-[#f5f9ff]'
                        : isActive
                          ? 'border-emerald-200'
                          : 'border-gray-100'
                    }`}
                    onClick={() => setSelectedSession(session)}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-1">
                        <p className="text-base font-bold text-gray-900">
                          Login: {session.loginAtIso ? formatTimestamp(session.loginAtIso) : UNAVAILABLE_LABEL}
                        </p>
                        <p className="text-xs text-gray-500">
                          {session.logoutAtIso
                            ? `Logout: ${formatTimestamp(session.logoutAtIso)}`
                            : `Last activity: ${formatTimestamp(session.lastActivityIso)}`}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {session.isCurrent && (
                          <span className="rounded-full border border-[#b7cdf3] bg-[#eaf2ff] px-2.5 py-1 text-[11px] font-semibold text-[#2f5ca8]">
                            Current Session
                          </span>
                        )}

                        <motion.span
                          key={`${session.id}-${session.status}`}
                          initial={{ opacity: 0.4, scale: 0.96 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.3 }}
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusBadgeClass(session.status)}`}
                        >
                          {session.status}
                        </motion.span>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="rounded-xl border border-[#e8eef8] bg-[#fbfdff] px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#7b8cad]">Browser</p>
                        <p className="mt-1 text-sm font-semibold text-gray-900">
                          {session.browserName} {session.browserVersion}
                        </p>
                      </div>

                      <div className="rounded-xl border border-[#e8eef8] bg-[#fbfdff] px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#7b8cad]">Operating System</p>
                        <p className="mt-1 text-sm font-semibold text-gray-900">
                          {session.osName} {session.osVersion}
                        </p>
                      </div>

                      <div className="rounded-xl border border-[#e8eef8] bg-[#fbfdff] px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#7b8cad]">IP Address</p>
                        <p className="mt-1 text-sm font-semibold text-gray-900">{session.ipAddress}</p>
                      </div>

                      <div className="rounded-xl border border-[#e8eef8] bg-[#fbfdff] px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#7b8cad]">Location</p>
                        <p className="mt-1 text-sm font-semibold text-gray-900">{formatLocation(session)}</p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedSession(session);
                        }}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm font-semibold text-[#3d5586] transition-colors hover:bg-gray-50 sm:w-auto"
                      >
                        <Info className="h-4 w-4" />
                        Session Details
                      </button>

                      {session.isCurrent ? (
                        <span className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#b7cdf3] bg-[#eaf2ff] px-3 py-2 text-sm font-semibold text-[#2f5ca8]">
                          Current Session - Cannot Log Out
                        </span>
                      ) : session.status === 'Active' ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setLogoutTarget(session);
                          }}
                          disabled={isRevokingSession === session.id}
                          className="inline-flex items-center justify-center gap-2 rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <LogOut className="h-4 w-4" />
                          {isRevokingSession === session.id ? 'Logging out...' : 'Log Out'}
                        </button>
                      ) : (
                        <span className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600">
                          <ShieldX className="h-4 w-4" />
                          Session Ended
                        </span>
                      )}
                    </div>
                  </motion.article>
                );
              })}
            </AnimatePresence>
          </motion.div>
        ) : (
          <div className="rounded-2xl border border-dashed border-gray-100 bg-[#fbfdff] px-4 py-12 text-center">
            <p className="text-sm font-semibold text-gray-900">No sessions matched your filters.</p>
            <p className="mt-1 text-sm text-gray-500">Try changing the date, device, or active-session filter.</p>
          </div>
        )}

        <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold text-[#5f7295]">
            Page {safeCurrentPage} of {totalPages}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage(Math.max(1, safeCurrentPage - 1))}
              disabled={safeCurrentPage === 1}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-100 text-[#5f7295] transition-colors hover:bg-[#f4f8ff] disabled:cursor-not-allowed disabled:opacity-45"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            {paginationTokens.map((token, index) => {
              if (token === 'ellipsis') {
                return (
                  <span key={`ellipsis-${index}`} className="px-1 text-sm font-semibold text-[#7b8cab]">
                    ...
                  </span>
                );
              }

              const active = token === safeCurrentPage;

              return (
                <button
                  key={token}
                  type="button"
                  onClick={() => setCurrentPage(token)}
                  className={`inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-2 text-sm font-semibold transition-colors ${
                    active
                      ? 'border-[#3f8fe6] bg-[#3f8fe6] text-white'
                      : 'border-gray-100 text-[#5f7295] hover:bg-[#f4f8ff]'
                  }`}
                >
                  {token}
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => setCurrentPage(Math.min(totalPages, safeCurrentPage + 1))}
              disabled={safeCurrentPage === totalPages}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-100 text-[#5f7295] transition-colors hover:bg-[#f4f8ff] disabled:cursor-not-allowed disabled:opacity-45"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>

      <ActionConfirmationModal
        open={Boolean(logoutTarget)}
        title="Log Out Session"
        description="Are you sure you want to log out this session? The user will be immediately signed out from that device."
        confirmLabel="Log Out"
        onCancel={() => setLogoutTarget(null)}
        onConfirm={handleConfirmSingleLogout}
        loading={isRevokingSession === logoutTarget?.id}
      />

      <ActionConfirmationModal
        open={confirmLogoutAllOpen}
        title="Log Out All Other Sessions"
        description="This will log you out from all devices except this one. Continue?"
        confirmLabel="Log Out Others"
        onCancel={() => setConfirmLogoutAllOpen(false)}
        onConfirm={handleConfirmLogoutAllOthers}
        loading={isRevokingAll}
      />

      <PortalModal
        open={Boolean(selectedSession)}
        onClose={() => setSelectedSession(null)}
        title="Session Details"
        description="Technical details for security review and auditing."
        size="lg"
        footer={
          <button
            type="button"
            onClick={() => setSelectedSession(null)}
            className="inline-flex w-full items-center justify-center rounded-xl border border-primary bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#233f7d]"
          >
            Close
          </button>
        }
      >
        {selectedSession ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-gray-100 bg-[#fbfdff] px-4 py-3 sm:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#7d8ead]">Session Summary</p>
                  <p className="mt-1 text-sm font-bold text-gray-900">
                    {selectedSession.browserName} {selectedSession.browserVersion} on {selectedSession.osName} {selectedSession.osVersion}
                  </p>
                  <p className="mt-1 text-sm text-gray-500">{formatLocation(selectedSession)}</p>
                </div>

                <div className="rounded-xl border border-gray-100 bg-[#fbfdff] px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#7d8ead]">Login Timestamp</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">
                    {selectedSession.loginAtIso ? formatTimestamp(selectedSession.loginAtIso) : UNAVAILABLE_LABEL}
                  </p>
                </div>

                <div className="rounded-xl border border-gray-100 bg-[#fbfdff] px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#7d8ead]">Logout Timestamp</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">
                    {selectedSession.logoutAtIso ? formatTimestamp(selectedSession.logoutAtIso) : '—'}
                  </p>
                </div>

                <div className="rounded-xl border border-gray-100 bg-[#fbfdff] px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#7d8ead]">Status</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">{selectedSession.status}</p>
                </div>

                <div className="rounded-xl border border-gray-100 bg-[#fbfdff] px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#7d8ead]">Session ID</p>
                  <p className="mt-1 break-all font-mono text-xs text-gray-900">{selectedSession.sessionId}</p>
                </div>

                <div className="rounded-xl border border-gray-100 bg-[#fbfdff] px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#7d8ead]">Device Fingerprint</p>
                  <p className="mt-1 break-all font-mono text-xs text-gray-900">{selectedSession.deviceFingerprint}</p>
                </div>

                <div className="rounded-xl border border-gray-100 bg-[#fbfdff] px-4 py-3 sm:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#7d8ead]">User Agent</p>
                  <p className="mt-1 break-all text-xs text-gray-900">{selectedSession.userAgent}</p>
                </div>
          </div>
        ) : null}
      </PortalModal>

      <PortalModal
        open={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        title="Export Login History"
        description="Choose export format and date range."
        size="lg"
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setIsExportOpen(false)}
              className="inline-flex items-center justify-center rounded-xl border border-gray-100 bg-white px-4 py-2 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmExport}
              className="inline-flex items-center justify-center rounded-xl border border-primary bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#233f7d]"
            >
              Export
            </button>
          </div>
        }
      >
        <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#7d8ead]">Export Format</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-gray-100 bg-[#fbfdff] px-3 py-2.5">
                      <input
                        type="radio"
                        checked={exportFormat === 'csv'}
                        onChange={() => setExportFormat('csv')}
                        className="h-4 w-4 accent-[#2a4d98]"
                      />
                      <span className="text-sm font-semibold text-gray-900">CSV</span>
                    </label>

                    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-gray-100 bg-[#fbfdff] px-3 py-2.5">
                      <input
                        type="radio"
                        checked={exportFormat === 'pdf'}
                        onChange={() => setExportFormat('pdf')}
                        className="h-4 w-4 accent-[#2a4d98]"
                      />
                      <span className="text-sm font-semibold text-gray-900">PDF (mock)</span>
                    </label>
                  </div>
                </div>

                <label className="space-y-1">
                  <span className="text-xs font-semibold text-gray-500">Date Range</span>
                  <select
                    value={exportDatePreset}
                    onChange={(event) => setExportDatePreset(event.target.value as DateRangePreset)}
                    className="h-10 w-full rounded-lg border border-gray-100 bg-white px-3 text-sm font-semibold text-[#2b467c] outline-none transition-colors focus:border-[#89addd]"
                  >
                    <option value="all_time">All Time</option>
                    <option value="today">Today</option>
                    <option value="yesterday">Yesterday</option>
                    <option value="this_week">This Week</option>
                    <option value="this_month">This Month</option>
                    <option value="custom">Custom Date Range</option>
                  </select>
                </label>

                {exportDatePreset === 'custom' && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-gray-500">Start Date</span>
                      <input
                        type="date"
                        value={exportCustomStartDate}
                        onChange={(event) => setExportCustomStartDate(event.target.value)}
                        className="h-10 w-full rounded-lg border border-gray-100 bg-white px-3 text-sm font-semibold text-[#2b467c] outline-none transition-colors focus:border-[#89addd]"
                      />
                    </label>

                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-gray-500">End Date</span>
                      <input
                        type="date"
                        value={exportCustomEndDate}
                        onChange={(event) => setExportCustomEndDate(event.target.value)}
                        className="h-10 w-full rounded-lg border border-gray-100 bg-white px-3 text-sm font-semibold text-[#2b467c] outline-none transition-colors focus:border-[#89addd]"
                      />
                    </label>
                  </div>
                )}
        </div>
      </PortalModal>
    </section>
  );
}
