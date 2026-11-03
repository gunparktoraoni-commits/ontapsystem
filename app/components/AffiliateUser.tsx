'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Copy,
  Link2,
  MousePointerClick,
  Share2,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { csrfClient } from '@/lib/csrf-client';
import { getFrontendApiBaseUrl } from './apiBase';
import { SectionLoader } from '../components/Loader';
import ConnectionMessengerPanel from './messaging/ConnectionMessengerPanel';

const API = getFrontendApiBaseUrl();

const isStateChangingMethod = (method: string) =>
  ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());

const isCsrfFailure = (status: number, payload: unknown): boolean => {
  if (status !== 403) return false;
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as { code?: string; error?: unknown; message?: string };
  if (record.code === 'CSRF_TOKEN_INVALID' || record.code === 'INVALID_CSRF_TOKEN') return true;
  if (typeof record.error === 'string' && /csrf/i.test(record.error)) return true;
  if (typeof record.message === 'string' && /csrf/i.test(record.message)) return true;
  return false;
};

type ApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  error?: string;
  code?: string;
  message?: string;
  requiresAuth?: boolean;
};

type SummaryData = {
  total_earnings_lifetime?: string;
  total_earnings_this_period?: string;
  total_earnings_pending?: string;
  pending_clients_count?: number;
  conversion_rate?: number;
  total_referrals_count?: number;
  withdrawable_amount?: string;
  currency?: string;
  comparison?: {
    earnings_change?: string;
    referrals_change?: string;
    conversion_change?: string;
  };
};

type ReferralClient = {
  id?: string;
  referral_id?: number;
  email?: string;
  status?: string;
  joined_at?: string;
  joined_date?: string;
  last_activity?: string;
  order_count?: number;
  total_orders?: number;
  lifetime_value?: string;
  commission_earned?: string | number;
};

type ClientsData = {
  client_list?: ReferralClient[];
};

type EarningsData = {
  earnings_by_period?: Array<{ period?: string; total_earnings?: string; commission_count?: number }>;
  pending_earnings?: {
    items?: Array<{ amount?: string; expected_clearance_date?: string }>;
  };
};

type FunnelData = {
  conversion_rates?: {
    overall?: number;
    overall_click_to_order?: number;
  };
  historical_trend?: Array<{
    date?: string;
    clicks?: number;
    signups?: number;
    orders?: number;
  }>;
  comparison_to_previous?: {
    rate_change?: string;
    clicks_change?: string;
    signups_change?: string;
    orders_change?: string;
    revenue_change?: string;
  };
};

type WithdrawData = {
  available_balance?: string;
  pending_clearance?: string;
  minimum_withdrawal?: string;
  meets_threshold?: boolean;
  currency?: string;
  withdrawal_methods?: Array<{ id?: string; label?: string }>;
};

type ActivitiesData = {
  activities?: Array<{
    type?: string;
    summary?: string;
    email?: string;
    timestamp?: string;
    time_ago?: string;
  }>;
};

type LinksData = {
  links?: Array<{
    full_url?: string;
    performance_trend?: Array<{ date?: string; clicks?: number; conversions?: number }>;
  }>;
};

type AffiliateLinksData = {
  affiliate_code?: string;
  default_link?: string;
  custom_links?: Array<{
    link_id?: string;
    name?: string;
    slug?: string;
    url?: string;
    is_active?: boolean;
  }>;
};

function toNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getCurrencySymbol(code?: string): string {
  const normalized = String(code ?? '').toUpperCase();
  if (normalized === 'PHP') return '₱';
  return '₱';
}

function formatMoney(value: unknown): string {
  const n = toNum(value, 0);
  return n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 });
}

function toDateKey(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return toDateKey(parsed);
}

function startOfLocalDay(date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

type DailyActivity = {
  dateKey: string;
  label: string;
  shortLabel: string;
  referrals: number;
  clicks: number;
  orders: number;
};

type HourlyActivity = {
  hourKey: string;
  hour: number;
  label: string;
  shortLabel: string;
  referrals: number;
};

const PERFORMANCE_HOURS = [8, 10, 12, 14, 16, 18, 20] as const;

function formatHourLabel(hour: number): string {
  return `${hour}:00`;
}

function toLocalDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function bucketPerformanceHour(hour: number): number {
  const clamped = Math.min(Math.max(hour, PERFORMANCE_HOURS[0]), PERFORMANCE_HOURS[PERFORMANCE_HOURS.length - 1]);
  for (let i = PERFORMANCE_HOURS.length - 1; i >= 0; i -= 1) {
    if (clamped >= PERFORMANCE_HOURS[i]) return PERFORMANCE_HOURS[i];
  }
  return PERFORMANCE_HOURS[0];
}

function buildTodayHourlySeries(
  clients: ReferralClient[],
  activities: Array<{ type?: string; timestamp?: string }> = [],
): HourlyActivity[] {
  const todayKey = toDateKey(startOfLocalDay());
  const counts = new Map<number, number>(PERFORMANCE_HOURS.map((hour) => [hour, 0]));

  const bump = (timestamp: unknown) => {
    const date = toLocalDate(timestamp);
    if (!date || toDateKey(date) !== todayKey) return false;
    // Date-only values resolve to midnight and would falsely stack into 8:00.
    const raw = String(timestamp ?? '');
    const hasClockTime = /T\d{2}:\d{2}|\d{2}:\d{2}/.test(raw);
    if (!hasClockTime) return false;
    const hour = bucketPerformanceHour(date.getHours());
    counts.set(hour, (counts.get(hour) ?? 0) + 1);
    return true;
  };

  let countedFromClients = 0;
  for (const client of clients) {
    if (bump(client.joined_at ?? client.joined_date ?? client.last_activity)) {
      countedFromClients += 1;
    }
  }

  // Use referral activities when client rows lack clock timestamps.
  if (countedFromClients === 0) {
    for (const activity of activities) {
      const type = String(activity.type ?? '').toLowerCase();
      if (!(type.includes('signup') || type.includes('referral') || type.includes('new_referral'))) {
        continue;
      }
      bump(activity.timestamp);
    }
  }

  return PERFORMANCE_HOURS.map((hour) => {
    const shortLabel = formatHourLabel(hour);
    return {
      hourKey: `${todayKey}T${String(hour).padStart(2, '0')}:00`,
      hour,
      label: shortLabel,
      shortLabel,
      referrals: counts.get(hour) ?? 0,
    };
  });
}

function buildDailyActivityMap(
  funnelTrend: Array<{ date?: string; clicks?: number; signups?: number; orders?: number }>,
  clients: ReferralClient[],
  earningsPeriods: Array<{ period?: string; commission_count?: number }>,
  activities: Array<{ type?: string; timestamp?: string }> = [],
): Map<string, DailyActivity> {
  const map = new Map<string, DailyActivity>();

  const ensure = (dateKey: string): DailyActivity => {
    let entry = map.get(dateKey);
    if (!entry) {
      const date = new Date(`${dateKey}T12:00:00`);
      entry = {
        dateKey,
        label: Number.isNaN(date.getTime())
          ? dateKey
          : date.toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            }),
        shortLabel: Number.isNaN(date.getTime())
          ? dateKey
          : date.toLocaleDateString(undefined, { weekday: 'short' }),
        referrals: 0,
        clicks: 0,
        orders: 0,
      };
      map.set(dateKey, entry);
    }
    return entry;
  };

  for (const item of funnelTrend) {
    const key = toDateKey(item.date);
    if (!key) continue;
    const entry = ensure(key);
    entry.clicks = Math.max(entry.clicks, toNum(item.clicks, 0));
    entry.referrals = Math.max(entry.referrals, toNum(item.signups, 0));
    entry.orders = Math.max(entry.orders, toNum(item.orders, 0));
  }

  const clientCounts = new Map<string, number>();
  for (const client of clients) {
    const key = toDateKey(client.joined_date ?? client.joined_at ?? client.last_activity);
    if (!key) continue;
    clientCounts.set(key, (clientCounts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of clientCounts) {
    const entry = ensure(key);
    entry.referrals = Math.max(entry.referrals, count);
  }

  for (const period of earningsPeriods) {
    const key = toDateKey(period.period);
    if (!key) continue;
    const entry = ensure(key);
    entry.orders = Math.max(entry.orders, toNum(period.commission_count, 0));
  }

  for (const activity of activities) {
    const key = toDateKey(activity.timestamp);
    if (!key) continue;
    const entry = ensure(key);
    const type = String(activity.type ?? '').toLowerCase();
    if (type.includes('click')) entry.clicks = Math.max(entry.clicks, 1);
    else if (type.includes('signup') || type.includes('referral')) {
      entry.referrals = Math.max(entry.referrals, 1);
    } else if (type.includes('order') || type.includes('commission')) {
      entry.orders = Math.max(entry.orders, 1);
    }
  }

  return map;
}

function generateReferralPath(values: number[], width = 700, height = 200): string {
  if (values.length === 0) return `M 0,${height}`;
  const max = Math.max(...values, 1);
  const dx = values.length === 1 ? 0 : width / (values.length - 1);
  const pointY = (value: number) => height - (value / max) * height * 0.9;

  if (values.length === 1) {
    return `M 0,${pointY(values[0])} L ${width},${pointY(values[0])}`;
  }

  let path = `M 0,${pointY(values[0])}`;
  for (let i = 0; i < values.length - 1; i++) {
    const x1 = i * dx;
    const y1 = pointY(values[i]);
    const x2 = (i + 1) * dx;
    const y2 = pointY(values[i + 1]);
    path += ` C ${x1 + dx / 2},${y1} ${x2 - dx / 2},${y2} ${x2},${y2}`;
  }
  return path;
}

const AffiliateUser = () => {
  const [copied, setCopied] = useState(false);
  const [selectedDate, setSelectedDate] = useState<number>(() => new Date().getDate());
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [clients, setClients] = useState<ReferralClient[]>([]);
  const [earnings, setEarnings] = useState<EarningsData | null>(null);
  const [funnel, setFunnel] = useState<FunnelData | null>(null);
  const [withdrawBalance, setWithdrawBalance] = useState<WithdrawData | null>(null);
  const [activities, setActivities] = useState<ActivitiesData | null>(null);
  const [linksPerformance, setLinksPerformance] = useState<LinksData | null>(null);
  const [affiliateLinks, setAffiliateLinks] = useState<AffiliateLinksData | null>(null);
  const referralLink =
    String(affiliateLinks?.default_link ?? linksPerformance?.links?.[0]?.full_url ?? '').trim() ||
    '';

  const authFetch = async (url: string, init: RequestInit = {}, retry = true): Promise<Response> => {
    const method = String(init.method ?? 'GET').toUpperCase();
    const needsCsrf = isStateChangingMethod(method);

    const buildInit = async (forceCsrfRefresh = false): Promise<RequestInit> => {
      const headers = new Headers(init.headers ?? undefined);
      if (init.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      if (needsCsrf) {
        const csrfToken = await csrfClient.getToken(forceCsrfRefresh, API || undefined);
        if (csrfToken) {
          headers.set('X-CSRF-Token', csrfToken);
          headers.set('x-csrf-token', csrfToken);
        }
      }
      return {
        ...init,
        method,
        credentials: 'include',
        cache: 'no-store',
        headers,
      };
    };

    const doFetch = (target: string, opts: RequestInit) =>
      fetch(target, opts);

    let requestInit = await buildInit(false);
    let response = await doFetch(url, requestInit);

    // Middleware rejects state-changing API calls without a matching CSRF header.
    if (needsCsrf && response.status === 403) {
      const csrfPayload = await response.clone().json().catch(() => null);
      if (isCsrfFailure(response.status, csrfPayload)) {
        requestInit = await buildInit(true);
        response = await doFetch(url, requestInit);
      }
    }

    if (response.status === 401 && retry) {
      const refreshed = await doFetch(`${API}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
      });
      if (refreshed.ok) {
        requestInit = await buildInit(false);
        response = await doFetch(url, requestInit);
      }
    }
    return response;
  };
  const apiGet = async <T,>(path: string): Promise<T> => {
    const response = await authFetch(`${API}${path}`, { method: 'GET' });
    const raw = await response.text();
    let payload: ApiEnvelope<T> = {};
    try { payload = JSON.parse(raw) as ApiEnvelope<T>; } catch { /* non-json */ }

    if (!response.ok || payload.success === false) {
      const message = payload.error || payload.message || `Request failed (${response.status})`;
      throw new Error(message);
    }
    return (payload.data ?? (payload as unknown as T));
  };
  const postWithdrawalRequest = async () => {
    if (!withdrawBalance || withdrawing) return;
    setWithdrawing(true);
    setError('');
    try {
      const method = String(withdrawBalance.withdrawal_methods?.[0]?.id ?? 'paypal');
      const amount = toNum(withdrawBalance.minimum_withdrawal, 0);
      const authRaw = localStorage.getItem('authUser');
      const authUser = authRaw ? (JSON.parse(authRaw) as Record<string, unknown>) : {};
      const email = String(authUser.email ?? '').trim();

      const accountDetails: Record<string, unknown> = method === 'gcash'
        ? { mobile: String(authUser.phone_number ?? authUser.contact ?? '').trim() }
        : method === 'bank_transfer'
          ? {
              account_name: String(authUser.fullName ?? authUser.name ?? 'Affiliate User').trim(),
              account_number: '0000000000',
              bank_name: 'Unknown Bank',
            }
          : { email };
      const response = await authFetch(`${API}/api/affiliate/withdraw/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          method,
          account_details: accountDetails,
          notes: 'Dashboard withdrawal request',
        }),
      });

      const raw = await response.text();

      let payload: ApiEnvelope<Record<string, unknown>> = {};
      try { payload = JSON.parse(raw) as ApiEnvelope<Record<string, unknown>>; } catch { /* non-json */ }
      if (!response.ok || payload.success === false) {
        const message = payload.error || payload.message || `Withdrawal failed (${response.status})`;
        throw new Error(message);
      }
      const refreshed = await apiGet<WithdrawData>('/api/affiliate/withdraw/balance');
      setWithdrawBalance(refreshed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to request withdrawal.';
      setError(msg);
    } finally {
      setWithdrawing(false);
    }
  };
  React.useEffect(() => {
    let cancelled = false;
    const loadAffiliate = async () => {
      setLoading(true);
      setError('');
      const requests = await Promise.allSettled([
        apiGet<SummaryData>('/api/affiliate/dashboard/summary?timeframe=month&include_comparison=true'),
        apiGet<ClientsData>('/api/affiliate/referrals/clients?page=1&limit=100'),
        apiGet<EarningsData>('/api/affiliate/earnings/breakdown?filter=month&granularity=day&page=1&limit=20'),
        apiGet<FunnelData>('/api/affiliate/conversion/funnel?timeframe=month'),
        apiGet<WithdrawData>('/api/affiliate/withdraw/balance'),
        apiGet<ActivitiesData>('/api/affiliate/activities/recent?page=1&limit=20'),
        apiGet<LinksData>('/api/affiliate/links/performance?timeframe=month'),
        apiGet<AffiliateLinksData>('/api/affiliate/links'),
      ]);

      if (cancelled) return;

      const errors: string[] = [];

      if (requests[0].status === 'fulfilled') setSummary(requests[0].value);
      else errors.push(requests[0].reason?.message ?? 'Summary fetch failed.');

      if (requests[1].status === 'fulfilled') setClients(requests[1].value.client_list ?? []);
      else errors.push(requests[1].reason?.message ?? 'Clients fetch failed.');

      if (requests[2].status === 'fulfilled') setEarnings(requests[2].value);
      else errors.push(requests[2].reason?.message ?? 'Earnings fetch failed.');

      if (requests[3].status === 'fulfilled') setFunnel(requests[3].value);
      else errors.push(requests[3].reason?.message ?? 'Funnel fetch failed.');

      if (requests[4].status === 'fulfilled') setWithdrawBalance(requests[4].value);
      else errors.push(requests[4].reason?.message ?? 'Withdraw balance fetch failed.');

      if (requests[5].status === 'fulfilled') setActivities(requests[5].value);
      else errors.push(requests[5].reason?.message ?? 'Activities fetch failed.');

      if (requests[6].status === 'fulfilled') setLinksPerformance(requests[6].value);
      else errors.push(requests[6].reason?.message ?? 'Links performance fetch failed.');

      if (requests[7].status === 'fulfilled') setAffiliateLinks(requests[7].value);
      else errors.push(requests[7].reason?.message ?? 'Affiliate links fetch failed.');

      if (errors.length > 0) {
        setError(errors[0]);
      }
      setLoading(false);
    };

    loadAffiliate();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCopy = () => {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (!referralLink) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join me on ONTAP',
          text: 'Use my referral link to get started on ONTAP.',
          url: referralLink,
        });
        return;
      } catch {
        // The native share sheet was dismissed; keep the page state unchanged.
        return;
      }
    }
    handleCopy();
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: { y: 0, opacity: 1 }
  };

  const activityByDate = buildDailyActivityMap(
    funnel?.historical_trend ?? [],
    clients,
    earnings?.earnings_by_period ?? [],
    activities?.activities ?? [],
  );
  const hourlySeries = buildTodayHourlySeries(clients, activities?.activities ?? []);
  const referralSeries = hourlySeries.map((point) => point.referrals);
  const referralPath = generateReferralPath(referralSeries);
  const maxAxis = Math.max(...referralSeries, 1);
  const activePointIndex =
    hoveredPointIndex ??
    (referralSeries.some((value) => value > 0)
      ? referralSeries.reduce(
          (bestIndex, value, index, arr) => (value >= arr[bestIndex] ? index : bestIndex),
          0,
        )
      : referralSeries.length - 1);
  const activePoint = hourlySeries[activePointIndex] ?? hourlySeries[hourlySeries.length - 1];
  const activeValue = activePoint?.referrals ?? 0;
  const activeXPercent =
    hourlySeries.length <= 1 ? 50 : (activePointIndex / (hourlySeries.length - 1)) * 100;
  const activeYPercent = 100 - (activeValue / maxAxis) * 90;
  
  const calendarYear = calendarMonth.getFullYear();
  const calendarMonthIndex = calendarMonth.getMonth();
  const calendarMonthLabel = calendarMonth.toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
  });
  const calendarDayCount = new Date(calendarYear, calendarMonthIndex + 1, 0).getDate();
  const calendarStartOffset = (new Date(calendarYear, calendarMonthIndex, 1).getDay() + 6) % 7;
  const daysInMonth = Array.from({ length: calendarDayCount }, (_, i) => i + 1);
  const selectedDateKey = toDateKey(new Date(calendarYear, calendarMonthIndex, selectedDate));
  const selectedDayActivity = activityByDate.get(selectedDateKey) ?? {
    dateKey: selectedDateKey,
    label: `${calendarMonth.toLocaleString(undefined, { month: 'long' })} ${selectedDate}, ${calendarYear}`,
    shortLabel: '',
    referrals: 0,
    clicks: 0,
    orders: 0,
  };

  const currency = getCurrencySymbol(summary?.currency || withdrawBalance?.currency);
  const totalEarnings = `${currency} ${formatMoney(summary?.total_earnings_lifetime)}`;
  const availableAmount = `${currency} ${formatMoney(withdrawBalance?.available_balance ?? summary?.withdrawable_amount)}`;
  const pendingText = `Pendings${typeof summary?.pending_clients_count === 'number' ? ` (${summary.pending_clients_count})` : ''}`;
  const conversionRate = `${toNum(
    summary?.conversion_rate ??
      funnel?.conversion_rates?.overall_click_to_order ??
      funnel?.conversion_rates?.overall,
    0,
  ).toFixed(1)}%`;
  const totalReferrals = String(toNum(summary?.total_referrals_count ?? clients.length, 0));
  const earningsChange = summary?.comparison?.earnings_change || funnel?.comparison_to_previous?.revenue_change || '+0.00%';
  const conversionChange =
    summary?.comparison?.conversion_change ||
    funnel?.comparison_to_previous?.rate_change ||
    '+0.00%';
  const referralsChange =
    summary?.comparison?.referrals_change ||
    funnel?.comparison_to_previous?.signups_change ||
    '+0';
  const minWithdrawal = formatMoney(withdrawBalance?.minimum_withdrawal ?? 100);
  const recentReferralText = clients.length > 0
    ? `${clients[0].email ?? 'Unknown'} • ${clients[0].status ?? 'pending'} • ${clients.length} referral(s)`
    : (activities?.activities?.find((a) => a.type === 'new_referral' || a.type === 'signup')?.summary ?? 'No recent referrals yet.');
  const withdrawalAvailable = toNum(withdrawBalance?.available_balance ?? summary?.withdrawable_amount, 0);
  const withdrawalMinimum = Math.max(toNum(withdrawBalance?.minimum_withdrawal, 100), 1);
  const withdrawalProgress = Math.min((withdrawalAvailable / withdrawalMinimum) * 100, 100);
  const metricCards = [
    {
      label: 'Total earnings',
      value: totalEarnings,
      change: earningsChange,
      helper: 'Lifetime commission',
      icon: CircleDollarSign,
      tone: 'bg-emerald-50 text-emerald-600',
    },
    {
      label: 'Available balance',
      value: availableAmount,
      change: earningsChange,
      helper: pendingText,
      icon: Wallet,
      tone: 'bg-blue-50 text-[#2A4792]',
    },
    {
      label: 'Conversion rate',
      value: conversionRate,
      change: conversionChange,
      helper: 'Clicks to customers',
      icon: MousePointerClick,
      tone: 'bg-violet-50 text-violet-600',
    },
    {
      label: 'Total referrals',
      value: totalReferrals,
      change: referralsChange,
      helper: 'People referred',
      icon: Users,
      tone: 'bg-cyan-50 text-cyan-600',
    },
  ];


  return (
    <div className="relative flex min-h-full w-full flex-col gap-6">
      {loading && 
        <div className="absolute inset-0 z-[9999] flex items-center justify-center rounded-2xl bg-[#F4F7FC]/95 backdrop-blur-sm">
          <SectionLoader text="Loading affiliate dashboard..." />
        </div>
      }
      <motion.div 
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
        
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-950 sm:text-3xl">
            Affiliate performance
          </h1>
          <p className="mt-1 text-sm text-gray-500">Track referrals, earnings, and your next payout in one place.</p>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 shadow-sm">
          <Activity className="h-4 w-4 text-[#4785B8]" />
          Current overview
        </div>
      </motion.div>
      <motion.div 
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="flex flex-col gap-6"
      >
        {/* Referral Link Banner */}
        <motion.div variants={itemVariants} className="relative isolate overflow-hidden rounded-3xl border border-white/20 bg-[linear-gradient(135deg,#20387D_0%,#2A4792_52%,#4785B8_100%)] p-5 text-white shadow-[0_18px_50px_rgba(32,56,125,0.24)] sm:p-7">
          <div className="pointer-events-none absolute -right-20 -top-28 -z-10 h-72 w-72 rounded-full border-[40px] border-white/[0.06]" />
          <div className="pointer-events-none absolute -bottom-28 left-1/3 -z-10 h-64 w-64 rounded-full bg-cyan-300/15 blur-3xl" />
          <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-white/20 bg-white/10 shadow-inner backdrop-blur-md">
                <Link2 className="h-5 w-5" />
              </div>
              <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Grow your network</h2>
              <p className="mt-1 text-sm font-medium text-blue-100/90">Share your personal link and earn ₱100 for every successful referral.</p>
              <div className="mt-5 flex w-full max-w-2xl items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center justify-between rounded-2xl border border-white/20 bg-white/10 p-1.5 shadow-inner backdrop-blur-md">
                  <span className="min-w-0 truncate px-2 text-xs font-medium text-white/90 sm:px-3 sm:text-sm">
                    {referralLink || 'Your affiliate link will appear here once available'}
                  </span>
                  <button
                    onClick={handleCopy}
                    disabled={!referralLink}
                    className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-bold text-[#20387D] shadow-sm transition-all duration-200 hover:scale-[1.02] hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 sm:px-4 sm:text-sm"
                  >
                    {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>
            <button
              onClick={() => void handleShare()}
              disabled={!referralLink}
              className="inline-flex w-full items-center justify-center gap-2 self-end rounded-2xl border border-white/25 bg-white/10 px-6 py-3 text-sm font-bold text-white shadow-sm backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
            >
              <Share2 className="h-4 w-4" />
              Share referral link
            </button>
          </div>
        </motion.div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {metricCards.map((metric) => {
            const Icon = metric.icon;
            return (
              <motion.div
                key={metric.label}
                variants={itemVariants}
                whileHover={{ y: -4 }}
                className="group rounded-2xl border border-gray-100 bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.05)] transition-shadow hover:shadow-[0_12px_30px_rgba(32,56,125,0.12)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-500">{metric.label}</p>
                    <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-gray-950">{metric.value}</h3>
                  </div>
                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-transform duration-200 group-hover:scale-105 ${metric.tone}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between gap-2 border-t border-gray-100 pt-3">
                  <span className="truncate text-xs font-medium text-gray-400">{metric.helper}</span>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-600">
                    <TrendingUp className="h-3 w-3" />
                    {metric.change}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>
        {/* Performance & Calendar section */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Performance Chart */}
          <motion.div variants={itemVariants} className="flex flex-col gap-5 rounded-2xl border border-gray-100 bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.05)] sm:p-6 lg:col-span-2">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-gray-950">Performance overview</h3>
                  <span className="rounded-full bg-[#EEF2FA] px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[#2A4792]">Live</span>
                </div>
                <p className="mt-1 text-xs text-gray-400">Referral activity by hour today</p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-gray-500">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#2A4792]" />
                  Referrals
                </div>
                <span className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-gray-600">Today</span>
              </div>
            </div>
            
            <div className="relative mt-2 flex h-44 w-full grow sm:mt-4 sm:h-56">
              <div className="flex flex-col justify-between pb-6 pr-3 text-[10px] font-semibold text-gray-400 sm:pr-4">
                {[1, 0.75, 0.5, 0.25, 0].map((ratio) => (
                  <span key={ratio}>{Math.round(maxAxis * ratio)}</span>
                ))}
              </div>

              <div
                className="relative flex grow flex-col"
                onMouseLeave={() => setHoveredPointIndex(null)}
              >
                <div className="absolute inset-x-0 bottom-6 top-0 z-0 flex flex-col justify-between pl-1">
                  {[0, 1, 2, 3, 4].map((idx) => (
                    <div key={idx} className="w-full border-t border-gray-100" />
                  ))}
                </div>

                <svg
                  className="absolute inset-x-0 top-0 z-10 w-full overflow-visible"
                  style={{ height: 'calc(100% - 1.5rem)' }}
                  viewBox="0 0 700 200"
                  preserveAspectRatio="none"
                >
                  <motion.path 
                    initial={false}
                    animate={{ d: referralPath }}
                    transition={{ type: 'spring', stiffness: 40, damping: 10 }}
                    fill="none" 
                    stroke="#2A4792"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  {hourlySeries.map((point, index) => {
                    const x = hourlySeries.length <= 1 ? 350 : (index / (hourlySeries.length - 1)) * 700;
                    const y = 200 - (point.referrals / maxAxis) * 200 * 0.9;
                    return (
                      <circle
                        key={point.hourKey}
                        cx={x}
                        cy={y}
                        r={hoveredPointIndex === index ? 6 : 4}
                        fill="#2A4792"
                        stroke="#ffffff"
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  })}
                </svg>

                <div
                  className="absolute inset-x-0 top-0 z-20 grid"
                  style={{
                    height: 'calc(100% - 1.5rem)',
                    gridTemplateColumns: `repeat(${hourlySeries.length}, minmax(0, 1fr))`,
                  }}
                >
                  {hourlySeries.map((point, index) => (
                    <button
                      key={`hit-${point.hourKey}`}
                      type="button"
                      className="relative h-full cursor-pointer border-0 bg-transparent"
                      aria-label={`${point.referrals} referrals at ${point.label}`}
                      onMouseEnter={() => setHoveredPointIndex(index)}
                      onFocus={() => setHoveredPointIndex(index)}
                      onClick={() => setHoveredPointIndex(index)}
                    >
                      <span className="sr-only">{point.referrals} referrals</span>
                    </button>
                  ))}
                </div>

                {activePoint && (
                  <div className="pointer-events-none absolute inset-x-0 top-0 z-30" style={{ height: 'calc(100% - 1.5rem)' }}>
                  <motion.div 
                      className="absolute flex h-0 w-0 flex-col items-center justify-center"
                    initial={false}
                    animate={{ 
                        left: `${activeXPercent}%`,
                        top: `${activeYPercent}%`,
                      }}
                      transition={{ type: 'spring', stiffness: 120, damping: 18 }}
                    >
                      <div
                        className="absolute bottom-full mb-5 whitespace-nowrap rounded-xl border border-white/10 bg-[#111827] px-3.5 py-2.5 text-xs text-white shadow-xl"
                        style={{ left: '50%', transform: 'translateX(-50%)' }}
                      >
                      <div className="flex items-center gap-1.5 font-semibold text-gray-100">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#6BBAEB]" />
                          {activeValue} {activeValue === 1 ? 'referral' : 'referrals'}
                      </div>
                        <div className="mt-1 text-left text-[10px] font-medium text-gray-400">
                          {activePoint.label}
                    </div>
                      </div>
                    <div className="absolute flex h-8 w-8 items-center justify-center rounded-full bg-[#2A4792]/20 shadow-[0_0_18px_rgba(42,71,146,0.30)]">
                      <div className="h-4 w-4 rounded-full border-[3px] border-white bg-[#2A4792] shadow-sm" />
                    </div>
                  </motion.div>
                </div>
                )}

                <div className="absolute inset-x-0 bottom-0 flex justify-between pl-1 text-[11px] font-semibold text-gray-400">
                  {hourlySeries.map((point) => (
                    <span key={`label-${point.hourKey}`} className="flex-1 text-center">
                      {point.shortLabel}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>

          {/* Calendar Card */}
          <motion.div variants={itemVariants} className="flex flex-col rounded-2xl border border-gray-100 bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.05)] sm:p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#4785B8]">Activity date</p>
                <h3 className="mt-1 text-base font-bold text-gray-950">{calendarMonthLabel}</h3>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => {
                    setCalendarMonth(new Date(calendarYear, calendarMonthIndex - 1, 1));
                    setSelectedDate(1);
                  }}
                  className="rounded-lg border border-gray-200 p-1.5 text-gray-500 transition-all hover:border-[#A8B8D9] hover:bg-[#EEF2FA] hover:text-[#2A4792] active:scale-95"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() => {
                    setCalendarMonth(new Date(calendarYear, calendarMonthIndex + 1, 1));
                    setSelectedDate(1);
                  }}
                  className="rounded-lg border border-gray-200 p-1.5 text-gray-500 transition-all hover:border-[#A8B8D9] hover:bg-[#EEF2FA] hover:text-[#2A4792] active:scale-95"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-wide text-gray-400">
              <div>Mo</div><div>Tu</div><div>We</div><div>Th</div><div>Fr</div><div>Sa</div><div>Su</div>
            </div>
            
            <div className="grid grid-cols-7 gap-1 text-center text-xs sm:text-sm">
              {Array.from({ length: calendarStartOffset }, (_, index) => (
                <div key={`empty-${index}`} className="aspect-square" />
              ))}
              {daysInMonth.map((day) => {
                const dayKey = toDateKey(new Date(calendarYear, calendarMonthIndex, day));
                const dayActivity = activityByDate.get(dayKey);
                const hasActivity = Boolean(
                  dayActivity &&
                    (dayActivity.referrals > 0 || dayActivity.clicks > 0 || dayActivity.orders > 0),
                );
                const isSelected = selectedDate === day;
                return (
                <button 
                  key={day}
                    type="button"
                  onClick={() => setSelectedDate(day)}
                    className={`relative flex aspect-square items-center justify-center rounded-xl transition-all ${
                      isSelected 
                      ? 'bg-[#2A4792] font-bold text-white shadow-[0_6px_14px_rgba(42,71,146,0.28)] scale-105'
                        : hasActivity
                          ? 'font-semibold text-[#2A4792] bg-[#EEF2FA] hover:bg-[#D5DDEF]'
                      : 'font-medium text-gray-600 hover:bg-[#EEF2FA] hover:text-[#2A4792]'
                  }`}
                >
                  {day}
                    {hasActivity && !isSelected ? (
                      <span className="absolute bottom-1 h-1 w-1 rounded-full bg-[#2A4792]" />
                    ) : null}
                </button>
                );
              })}
            </div>
            <div className="mt-auto border-t border-gray-100 pt-4">
              <p className="text-xs font-medium text-gray-400">Selected date activity</p>
              <p className="mt-1 text-sm font-bold text-gray-800">
                {calendarMonth.toLocaleString(undefined, { month: 'long' })} {selectedDate}, {calendarYear}
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-[#F8FAFD] px-2 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Referrals</p>
                  <p className="mt-1 text-sm font-bold text-gray-800">{selectedDayActivity.referrals}</p>
                </div>
                <div className="rounded-xl bg-[#F8FAFD] px-2 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Clicks</p>
                  <p className="mt-1 text-sm font-bold text-gray-800">{selectedDayActivity.clicks}</p>
                </div>
                <div className="rounded-xl bg-[#F8FAFD] px-2 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Orders</p>
                  <p className="mt-1 text-sm font-bold text-gray-800">{selectedDayActivity.orders}</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {error && (
          <motion.div
            variants={itemVariants}
            className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800"
            role="status"
          >
            Some affiliate data could not be refreshed. {error}
          </motion.div>
        )}

        {/* Referrals & Withdrawal */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          
          {/* Recent Referrals */}
          <motion.div variants={itemVariants} className="flex min-h-[300px] flex-col rounded-2xl border border-gray-100 bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.05)] sm:p-6 lg:col-span-2">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-gray-950">Recent referrals</h3>
                <p className="mt-1 text-xs text-gray-400">Your newest affiliate relationships</p>
              </div>
              <span className="rounded-full bg-[#EEF2FA] px-3 py-1 text-xs font-bold text-[#2A4792]">{clients.length} total</span>
            </div>

            {clients.length > 0 ? (
              <div className="divide-y divide-gray-100">
                {clients.slice(0, 5).map((client, index) => {
                  const email = client.email || `Referral ${index + 1}`;
                  const status = String(client.status || 'pending').toLowerCase();
                  const statusClass = status === 'active' || status === 'completed'
                    ? 'bg-emerald-50 text-emerald-600'
                    : 'bg-amber-50 text-amber-600';
                  return (
                    <div key={client.id ?? client.referral_id ?? `${email}-${index}`} className="group flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EEF2FA] text-sm font-extrabold text-[#2A4792] transition-colors group-hover:bg-[#D5DDEF]">
                        {email.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-gray-800">{email}</p>
                        <p className="mt-0.5 text-xs text-gray-400">
                          {client.joined_date || client.joined_at
                            ? new Date(String(client.joined_date || client.joined_at)).toLocaleDateString()
                            : 'Recently joined'}
                        </p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold capitalize ${statusClass}`}>{status}</span>
                      <ArrowUpRight className="h-4 w-4 text-gray-300 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[#2A4792]" />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-[#D5DDEF] bg-[#F8FAFD] px-6 py-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EEF2FA] text-[#2A4792]">
                  <UserPlus className="h-5 w-5" />
                </div>
                <p className="mt-4 text-sm font-bold text-gray-700">No referrals yet</p>
                <p className="mt-1 max-w-xs text-xs leading-5 text-gray-400">{recentReferralText}</p>
              </div>
            )}
          </motion.div>

          {/* Withdrawal Card */}
          <motion.div variants={itemVariants} className="relative isolate flex min-h-[300px] flex-col overflow-hidden rounded-2xl border border-[#D5DDEF] bg-[linear-gradient(145deg,#FFFFFF_0%,#F4F7FC_55%,#EEF2FA_100%)] p-5 shadow-[0_6px_24px_rgba(32,56,125,0.08)] sm:p-6">
            <div className="pointer-events-none absolute -right-16 -top-16 -z-10 h-44 w-44 rounded-full bg-[#4785B8]/10 blur-2xl" />
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#4785B8]">Payout balance</p>
                <h3 className="mt-1 text-base font-bold text-gray-950">Withdrawal</h3>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#20387D] text-white shadow-[0_8px_20px_rgba(32,56,125,0.22)]">
                <Wallet className="h-5 w-5" />
              </div>
            </div>

            <div className="my-auto py-6">
              <p className="text-xs font-medium text-gray-400">Available to withdraw</p>
              <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-gray-950 sm:text-4xl">{availableAmount}</h2>
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between text-[11px] font-semibold">
                  <span className="text-gray-500">Minimum payout progress</span>
                  <span className="text-[#2A4792]">{Math.round(withdrawalProgress)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[#D5DDEF]">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${withdrawalProgress}%` }}
                    transition={{ duration: 0.7, ease: 'easeOut' }}
                    className="h-full rounded-full bg-[linear-gradient(90deg,#20387D,#4785B8)]"
                  />
                </div>
                <p className="mt-3 text-xs leading-5 text-gray-500">
                  Minimum withdrawal: <span className="font-bold text-[#2A4792]">{currency} {minWithdrawal}</span>
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled
              aria-disabled="true"
              title="Withdrawals are temporarily unavailable"
              className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#20387D] py-3 text-sm font-bold text-white shadow-[0_8px_18px_rgba(32,56,125,0.20)] opacity-50 cursor-not-allowed"
            >
              Request withdrawal
              <ArrowUpRight className="h-4 w-4" />
            </button>
            <p className="mt-3 text-xs leading-5 text-gray-500">
              Withdrawals are temporarily unavailable while our payout account is being set up.
              If you have concerns, message a superadmin directly.
            </p>
            <button
              type="button"
              onClick={() => setSupportOpen(true)}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[#D5DDEF] bg-white py-2.5 text-sm font-bold text-[#20387D] transition-all hover:bg-[#F4F7FC]"
            >
              Message superadmin
            </button>
          </motion.div>
        </div>
      </motion.div>

      <ConnectionMessengerPanel
        open={supportOpen}
        initialView="support"
        onClose={() => setSupportOpen(false)}
      />
    </div>
  );
};

export default AffiliateUser;