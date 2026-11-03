"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { motion } from 'framer-motion';
import {
  ChartLine,
  ChevronDown,
  RefreshCcw,
  Search,
  UsersRound,
} from 'lucide-react';
import { SkeletonLoader } from '../../components/Loader';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  asRecord,
  fetchDashboardMetrics,
  fetchStaffActivities,
  fetchStaffAnalytics,
  fetchStaffList,
  pickArray,
  pickNumber,
  pickString,
  type DateFilter,
  type StaffRoleKey,
} from './dashboardApi';
import {
  DASHBOARD_CARD_MIN_H,
  DASHBOARD_CARD_SHELL,
  DASHBOARD_DARK_PANEL_STYLE,
  DASHBOARD_GLASS_STYLE,
  DASHBOARD_SCROLLBAR_CLASS,
  DASHBOARD_SUBTITLE_CLASS,
  DASHBOARD_TITLE_CLASS,
} from './ui/portalTokens';

// ----------------------------- Types -----------------------------

type RoleFilterValue = 'all' | StaffRoleKey;

interface StaffMember {
  id: string;
  name: string;
  email: string;
  roleKey: StaffRoleKey | null;
  roleLabel: string;
  department: string | null;
  status: 'Active' | 'Inactive';
  lastActive: string | null;
  lastActiveLabel: string;
  engagementScore: number | null;
}

interface ChartPoint {
  day: string;
  value: number;
}

type AnalyticsType = 'engagement' | 'activity' | 'staff_performance' | 'company_growth';

const ROLE_OPTIONS: Array<{ value: RoleFilterValue; label: string }> = [
  { value: 'all', label: 'All Roles' },
  { value: 'admin', label: 'Admin' },
  { value: 'sales_rep', label: 'Sales' },
  { value: 'support_agent', label: 'Support' },
  { value: 'web_developer', label: 'Web Developer' },
  { value: 'analyst', label: 'Analyst' },
];

const ROLE_LABELS: Record<StaffRoleKey, string> = {
  admin: 'Admin',
  sales_rep: 'Sales',
  support_agent: 'Support',
  web_developer: 'Web Developer',
  analyst: 'Analyst',
};

const ANALYTICS_OPTIONS: Array<{ value: AnalyticsType; label: string; suffix: string; color: string }> = [
  { value: 'engagement', label: 'Engagement Score Trends', suffix: '%', color: '#35d27f' },
  { value: 'activity', label: 'User Activity (Logins, Actions)', suffix: '', color: '#2a4d98' },
  { value: 'staff_performance', label: 'Staff Performance Metrics', suffix: '%', color: '#7a4dd0' },
  { value: 'company_growth', label: 'Company Creation Trends', suffix: '', color: '#f08a24' },
];

const PERIOD_OPTIONS: Array<{ value: DateFilter; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
];

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ----------------------------- Helpers -----------------------------

function getInitials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2);
}

function getAvatarTone(name: string) {
  const tones = [
    { bg: 'bg-[#e8f0ff]', text: 'text-primary' },
    { bg: 'bg-[#e7f8f1]', text: 'text-[#1f8f63]' },
    { bg: 'bg-[#f3ecff]', text: 'text-[#6e46b4]' },
    { bg: 'bg-[#fff4e9]', text: 'text-[#9a5a16]' },
  ];
  const hash = Array.from(name).reduce((total, char) => total + char.charCodeAt(0), 0);
  return tones[hash % tones.length];
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const diff = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function mapStaffMember(raw: unknown, index: number): StaffMember | null {
  const rec = asRecord(raw);
  if (!rec) return null;

  const id = pickString(rec.id, rec.staff_id, rec.user_id, rec.uuid) ?? `staff-${index}`;
  const firstName = pickString(rec.first_name, rec.given_name) ?? '';
  const lastName = pickString(rec.last_name, rec.family_name) ?? '';
  const fullName =
    pickString(rec.name, rec.full_name, rec.display_name) ??
    (`${firstName} ${lastName}`.trim() || 'Unnamed Staff');

  const email = pickString(rec.email, rec.email_address) ?? '';
  const roleRaw = pickString(rec.role_key, rec.role, asRecord(rec.role)?.key);
  const roleKey =
    roleRaw && (Object.keys(ROLE_LABELS) as StaffRoleKey[]).includes(roleRaw as StaffRoleKey)
      ? (roleRaw as StaffRoleKey)
      : null;
  const roleLabel =
    pickString(rec.role_label, asRecord(rec.role)?.label) ??
    (roleKey ? ROLE_LABELS[roleKey] : roleRaw ?? 'Staff');

  const department = pickString(
    rec.department_label,
    rec.department,
    asRecord(rec.department)?.label,
    asRecord(rec.department)?.key
  );

  const isActive =
    rec.is_active === true ||
    pickString(rec.status, rec.account_status)?.toLowerCase() === 'active';

  const lastActive = pickString(
    rec.last_active_at,
    rec.last_login_at,
    rec.last_seen_at,
    rec.last_activity_at,
    rec.updated_at
  );

  const engagementScore = pickNumber(
    rec.engagement_score,
    rec.performance_score,
    rec.activity_score
  );

  return {
    id,
    name: fullName,
    email,
    roleKey,
    roleLabel,
    department,
    status: isActive ? 'Active' : 'Inactive',
    lastActive,
    lastActiveLabel: relativeTime(lastActive),
    engagementScore,
  };
}

function extractStaffList(payload: unknown): StaffMember[] {
  const root = asRecord(payload);
  const data = asRecord(root?.data) ?? root ?? {};
  const list =
    pickArray(data.staff, data.items, data.results, data.data, data.records) ?? [];
  return list
    .map((entry, index) => mapStaffMember(entry, index))
    .filter((value): value is StaffMember => value !== null);
}

function bucketByWeekday(items: Array<{ timestamp: string | null; value?: number }>): ChartPoint[] {
  // Index 0 = Mon ... 6 = Sun (matches DAY_LABELS).
  const totals = [0, 0, 0, 0, 0, 0, 0];
  const counts = [0, 0, 0, 0, 0, 0, 0];

  items.forEach(({ timestamp, value }) => {
    if (!timestamp) return;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return;
    const jsDay = date.getDay(); // 0=Sun..6=Sat
    const idx = jsDay === 0 ? 6 : jsDay - 1;
    totals[idx] += typeof value === 'number' ? value : 1;
    counts[idx] += 1;
  });

  return DAY_LABELS.map((day, idx) => ({
    day,
    value:
      typeof totals[idx] === 'number' && counts[idx] > 0
        ? totals[idx]
        : 0,
  }));
}

function averageByWeekday(items: Array<{ timestamp: string | null; value: number }>): ChartPoint[] {
  const totals = [0, 0, 0, 0, 0, 0, 0];
  const counts = [0, 0, 0, 0, 0, 0, 0];
  items.forEach(({ timestamp, value }) => {
    if (!timestamp) return;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return;
    const jsDay = date.getDay();
    const idx = jsDay === 0 ? 6 : jsDay - 1;
    totals[idx] += value;
    counts[idx] += 1;
  });
  return DAY_LABELS.map((day, idx) => ({
    day,
    value: counts[idx] > 0 ? Math.round(totals[idx] / counts[idx]) : 0,
  }));
}

function extractActivityTimestamps(payload: unknown): string[] {
  const root = asRecord(payload);
  const data = asRecord(root?.data) ?? root ?? {};
  const list =
    pickArray(data.activities, data.items, data.results, data.staff_activities) ?? [];
  return list
    .map((raw) => {
      const rec = asRecord(raw);
      return pickString(rec?.created_at, rec?.timestamp, rec?.occurred_at, rec?.time);
    })
    .filter((value): value is string => typeof value === 'string');
}

// ----------------------------- Tooltip -----------------------------

function AnalyticsTooltip({
  active,
  payload,
  label,
  suffix,
  metricLabel,
}: {
  active?: boolean;
  payload?: Array<{ value?: number }>;
  label?: string;
  suffix: string;
  metricLabel: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12, ease: 'easeOut' }}
      className="rounded-2xl px-4 py-3 text-xs"
      style={{
        background: 'linear-gradient(135deg, rgba(13,21,37,0.97) 0%, rgba(20,32,60,0.97) 100%)',
        border: '1px solid rgba(59,87,163,0.45)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <p className="font-bold tracking-wide" style={{ color: '#e2e8f0', fontSize: 12 }}>
        {label}
      </p>
      <p className="mt-1.5" style={{ color: '#94a3b8', fontSize: 11 }}>
        {metricLabel}:{' '}
        <span className="font-semibold" style={{ color: '#f1f5f9' }}>
          {payload[0].value ?? 0}
          {suffix}
        </span>
      </p>
    </motion.div>
  );
}

// ----------------------------- Component -----------------------------

export default function UserDirectoryPerformanceCard() {
  // Staff Monitoring state
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [staffLoading, setStaffLoading] = useState<boolean>(true);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilterValue>('all');
  const [activeStaffCount, setActiveStaffCount] = useState<number | null>(null);
  const [totalStaffCount, setTotalStaffCount] = useState<number | null>(null);

  // Analytics state
  const [analyticsType, setAnalyticsType] = useState<AnalyticsType>('engagement');
  const [periodFilter, setPeriodFilter] = useState<DateFilter>('this_week');
  const [chartData, setChartData] = useState<ChartPoint[]>(
    DAY_LABELS.map((day) => ({ day, value: 0 }))
  );
  const [analyticsLoading, setAnalyticsLoading] = useState<boolean>(true);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [chartAnimationDuration, setChartAnimationDuration] = useState(700);
  const hasInteractedRef = useRef(false);

  const selectedAnalytics = useMemo(
    () => ANALYTICS_OPTIONS.find((opt) => opt.value === analyticsType) ?? ANALYTICS_OPTIONS[0],
    [analyticsType]
  );

  // Debounce search input (250ms)
  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(searchValue.trim()), 250);
    return () => window.clearTimeout(handle);
  }, [searchValue]);

  // Fetch staff list whenever role/search changes
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function loadStaff() {
      setStaffLoading(true);
      setStaffError(null);
      try {
        const payload = await fetchStaffList(
          {
            page: 1,
            limit: 50,
            role: roleFilter === 'all' ? undefined : roleFilter,
            search: debouncedSearch || undefined,
          },
          controller.signal
        );
        if (cancelled) return;
        setStaff(extractStaffList(payload));
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        setStaffError(err instanceof Error ? err.message : 'Failed to load staff list.');
      } finally {
        if (!cancelled) setStaffLoading(false);
      }
    }

    void loadStaff();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [roleFilter, debouncedSearch]);

  // Fetch staff analytics summary (totals/active count) on mount + 30s polling
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function loadAnalyticsSummary() {
      try {
        const payload = await fetchStaffAnalytics(controller.signal);
        if (cancelled) return;
        const data =
          asRecord(asRecord(payload)?.data) ?? asRecord(payload) ?? {};
        setTotalStaffCount(pickNumber(data.total_staff, data.total));
        setActiveStaffCount(pickNumber(data.active_staff, data.active));
      } catch {
        // Silent; non-critical aggregate.
      }
    }

    void loadAnalyticsSummary();
    const interval = window.setInterval(loadAnalyticsSummary, 30_000);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, []);

  // Fetch chart data based on selected analytics type + period
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function loadChart() {
      setAnalyticsLoading(true);
      setAnalyticsError(null);
      try {
        if (analyticsType === 'engagement' || analyticsType === 'staff_performance') {
          const payload = await fetchStaffActivities(
            { page: 1, limit: 200, filter: periodFilter },
            controller.signal
          );
          if (cancelled) return;
          const timestamps = extractActivityTimestamps(payload);
          // Use activity counts as a proxy and normalize to 0..100 for engagement.
          const buckets = bucketByWeekday(timestamps.map((t) => ({ timestamp: t })));
          const max = Math.max(...buckets.map((b) => b.value), 1);
          const normalized = buckets.map((b) => ({
            day: b.day,
            value: Math.round((b.value / max) * 100),
          }));
          setChartData(normalized);
        } else if (analyticsType === 'activity') {
          const payload = await fetchStaffActivities(
            { page: 1, limit: 200, filter: periodFilter },
            controller.signal
          );
          if (cancelled) return;
          const timestamps = extractActivityTimestamps(payload);
          setChartData(bucketByWeekday(timestamps.map((t) => ({ timestamp: t }))));
        } else if (analyticsType === 'company_growth') {
          const payload = await fetchDashboardMetrics(periodFilter, controller.signal);
          if (cancelled) return;
          const root = asRecord(payload);
          const data = asRecord(root?.data) ?? root ?? {};
          const companies = asRecord(data.companies) ?? {};
          const series =
            pickArray(
              companies.trend,
              companies.daily_growth,
              data.company_growth,
              data.companies_trend
            ) ?? [];
          // Either an array of numbers or array of {timestamp/date, value/count}
          const items = series.map((entry) => {
            if (typeof entry === 'number') return { timestamp: null, value: entry };
            const rec = asRecord(entry);
            return {
              timestamp: pickString(rec?.date, rec?.day, rec?.timestamp, rec?.created_at),
              value: pickNumber(rec?.value, rec?.count, rec?.total) ?? 0,
            };
          });
          const hasTimestamps = items.some((i) => i.timestamp);
          if (hasTimestamps) {
            const valuedItems = items
              .filter((i): i is { timestamp: string; value: number } =>
                typeof i.timestamp === 'string'
              )
              .map((i) => ({ timestamp: i.timestamp, value: i.value }));
            setChartData(bucketByWeekday(valuedItems));
          } else {
            // Fall back: take the last 7 numeric points and label them by day.
            const numeric = items.map((i) => i.value).slice(-7);
            while (numeric.length < 7) numeric.unshift(0);
            setChartData(DAY_LABELS.map((day, idx) => ({ day, value: numeric[idx] ?? 0 })));
          }
        }
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        setAnalyticsError(
          err instanceof Error ? err.message : 'Failed to load analytics data.'
        );
        setChartData(DAY_LABELS.map((day) => ({ day, value: 0 })));
      } finally {
        if (!cancelled) setAnalyticsLoading(false);
      }
    }

    void loadChart();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [analyticsType, periodFilter]);

  // Derived stats
  const totalUsersDisplay = totalStaffCount ?? staff.length;
  const activeTodayDisplay = useMemo(() => {
    if (activeStaffCount !== null) return activeStaffCount;
    return staff.filter((member) => member.status === 'Active').length;
  }, [activeStaffCount, staff]);
  const topTier = useMemo(() => {
    return staff.filter((member) => (member.engagementScore ?? 0) >= 90).length;
  }, [staff]);

  // Handlers
  const handleSearch = (event: ChangeEvent<HTMLInputElement>) => {
    if (!hasInteractedRef.current) hasInteractedRef.current = true;
    setChartAnimationDuration(350);
    setSearchValue(event.target.value);
  };
  const handleRoleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    if (!hasInteractedRef.current) hasInteractedRef.current = true;
    setChartAnimationDuration(350);
    setRoleFilter(event.target.value as RoleFilterValue);
  };
  const handleAnalyticsTypeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setChartAnimationDuration(450);
    setAnalyticsType(event.target.value as AnalyticsType);
  };
  const handlePeriodChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setChartAnimationDuration(450);
    setPeriodFilter(event.target.value as DateFilter);
  };
  const handleRefresh = () => {
    // Force-refetch staff list by toggling the debouncedSearch state value.
    setStaffLoading(true);
    setDebouncedSearch((v) => v);
    // Trigger a chart refetch as well by re-setting analyticsType (no-op effect dep).
    setAnalyticsLoading(true);
    setAnalyticsType((t) => t);
  };

  return (
    <section
      className={`${DASHBOARD_CARD_SHELL} p-5 lg:p-6 ${DASHBOARD_CARD_MIN_H}`}
      style={DASHBOARD_GLASS_STYLE}
    >
      <div className="relative z-10 grid grid-cols-1 gap-5 lg:grid-cols-5 lg:gap-6">
        {/* ------------------ Staff Monitoring ------------------ */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="flex min-h-0 flex-col lg:col-span-2 lg:border-r lg:pr-6"
          style={{ borderColor: 'rgba(42,71,146,0.28)' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className={`flex items-center gap-2 ${DASHBOARD_TITLE_CLASS}`}>
                <UsersRound className="h-5 w-5 text-[#93c5fd]" />
                Staff Monitoring
              </h3>
              <p className={`mt-1 ${DASHBOARD_SUBTITLE_CLASS}`}>
                Track staff roles, status, and recent activity in real time.
              </p>
            </div>
            <span
              className="rounded-full px-3 py-1 text-center text-xs font-bold"
              style={{
                background: 'rgba(52,211,153,0.12)',
                border: '1px solid rgba(52,211,153,0.3)',
                color: '#34d399',
              }}
            >
              {totalUsersDisplay} Staff
            </span>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-[1fr_165px]">
            <label className="relative block">
              <span className="sr-only">Search staff by name or email</span>
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
                style={{ color: '#64748b' }}
              />
              <input
                type="text"
                value={searchValue}
                onChange={handleSearch}
                placeholder="Search by name or email..."
                className="h-11 w-full rounded-xl pl-10 pr-4 text-sm outline-none transition-all duration-200 focus:ring-1"
                style={{
                  background: 'rgba(42,71,146,0.18)',
                  border: '1px solid rgba(42,71,146,0.35)',
                  color: '#e2e8f0',
                }}
              />
            </label>

            <label className="relative block">
              <span className="sr-only">Filter staff by role</span>
              <select
                value={roleFilter}
                onChange={handleRoleChange}
                className="h-11 w-full appearance-none rounded-xl px-4 pr-10 text-sm font-semibold outline-none transition-all duration-200 focus:ring-1"
                style={{
                  background: 'rgba(42,71,146,0.18)',
                  border: '1px solid rgba(42,71,146,0.35)',
                  color: '#e2e8f0',
                }}
              >
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2"
                style={{ color: '#64748b' }}
              />
            </label>
          </div>

          <div
            className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl"
            style={DASHBOARD_DARK_PANEL_STYLE}
          >
            <div className={`max-h-[300px] flex-1 space-y-2 p-3 ${DASHBOARD_SCROLLBAR_CLASS}`}>
              {staffLoading && staff.length === 0 ? (
                Array.from({ length: 4 }).map((_, idx) => (
                  <div
                    key={`staff-skeleton-${idx}`}
                    className="flex items-center justify-between rounded-xl px-3 py-2.5"
                    style={{ background: 'rgba(59,87,163,0.08)' }}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <SkeletonLoader width="w-10" height="h-10" className="shrink-0 rounded-full" />
                      <div className="space-y-2">
                        <SkeletonLoader width="w-32" height="h-3" className="rounded" />
                        <SkeletonLoader width="w-44" height="h-2.5" className="rounded" />
                      </div>
                    </div>
                    <SkeletonLoader width="w-16" height="h-6" className="rounded-full" />
                  </div>
                ))
              ) : staffError ? (
                <div
                  className="rounded-xl p-5 text-center text-sm font-medium"
                  style={{ color: '#f87171', background: 'rgba(248,113,113,0.08)' }}
                >
                  {staffError}
                </div>
              ) : staff.length > 0 ? (
                staff.map((member) => {
                  const avatarTone = getAvatarTone(member.name);
                  const score = member.engagementScore;
                  return (
                    <div
                      key={member.id}
                      className="group flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition-all duration-200"
                      style={{
                        borderColor: 'rgba(59,87,163,0.2)',
                        background: 'rgba(59,87,163,0.06)',
                      }}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${avatarTone.bg} ${avatarTone.text}`}
                        >
                          {getInitials(member.name)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold" style={{ color: '#e2e8f0' }}>
                            {member.name}
                          </p>
                          <p className="truncate text-xs" style={{ color: '#94a3b8' }}>
                            {member.email || '—'}
                          </p>
                          <p className="mt-0.5 truncate text-[11px]" style={{ color: '#64748b' }}>
                            {member.lastActiveLabel}
                            {member.department ? ` · ${member.department}` : ''}
                          </p>
                        </div>
                      </div>

                      <div className="ml-3 flex shrink-0 flex-col items-end gap-1.5">
                        <span
                          className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                          style={
                            member.roleKey === 'admin'
                              ? {
                                  background: 'linear-gradient(135deg,#3B57A3,#2a3f7a)',
                                  color: '#fff',
                                }
                              : {
                                  background: 'rgba(59,87,163,0.15)',
                                  color: '#93c5fd',
                                }
                          }
                        >
                          {member.roleLabel}
                        </span>
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                          style={
                            member.status === 'Active'
                              ? {
                                  background: 'rgba(52,211,153,0.12)',
                                  color: '#34d399',
                                  border: '1px solid rgba(52,211,153,0.3)',
                                }
                              : {
                                  background: 'rgba(100,116,139,0.15)',
                                  color: '#94a3b8',
                                }
                          }
                        >
                          {member.status}
                        </span>
                        {score !== null ? (
                          <p className="text-sm font-black tabular-nums" style={{ color: '#f1f5f9' }}>
                            {score}%
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div
                  className="rounded-xl p-5 text-center text-sm"
                  style={{ color: '#64748b' }}
                >
                  No staff match the current search and filter selection.
                </div>
              )}
            </div>
          </div>
        </motion.div>

        {/* ------------------ Performance Analytics ------------------ */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut', delay: 0.08 }}
          className="flex min-h-0 flex-col lg:col-span-3"
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h3 className={`flex items-center gap-2 ${DASHBOARD_TITLE_CLASS}`}>
                <ChartLine className="h-5 w-5 text-[#93c5fd]" />
                Performance Analytics
              </h3>
              <p className={`mt-1 ${DASHBOARD_SUBTITLE_CLASS}`}>
                {selectedAnalytics.label} · live data from backend.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="relative block">
                <span className="sr-only">Select analytics type</span>
                <select
                  value={analyticsType}
                  onChange={handleAnalyticsTypeChange}
                  className="h-9 min-w-[180px] appearance-none rounded-xl border border-[rgba(42,71,146,0.45)] bg-[rgba(42,71,146,0.2)] pl-3 pr-8 text-xs font-semibold text-slate-200 outline-none backdrop-blur-sm transition-all duration-200 hover:bg-[rgba(42,71,146,0.3)] focus:border-[#2A4792] focus:ring-2 focus:ring-[#2A4792]/30"
                >
                  {ANALYTICS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                />
              </label>

              <label className="relative block">
                <span className="sr-only">Select time period</span>
                <select
                  value={periodFilter}
                  onChange={handlePeriodChange}
                  className="h-9 appearance-none rounded-xl border border-[rgba(42,71,146,0.45)] bg-[rgba(42,71,146,0.2)] pl-3 pr-8 text-xs font-semibold text-slate-200 outline-none backdrop-blur-sm transition-all duration-200 hover:bg-[rgba(42,71,146,0.3)] focus:border-[#2A4792] focus:ring-2 focus:ring-[#2A4792]/30"
                >
                  {PERIOD_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                />
              </label>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:gap-3">
            {[
              { label: 'Total Staff', value: totalUsersDisplay },
              { label: 'Active Today', value: activeTodayDisplay },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl px-3 py-2.5"
                style={{
                  background: 'rgba(42,71,146,0.18)',
                  border: '1px solid rgba(42,71,146,0.3)',
                }}
              >
                <p
                  className="text-[10px] font-bold uppercase tracking-[0.1em]"
                  style={{ color: '#94a3b8' }}
                >
                  {stat.label}
                </p>
                <p className="mt-1 text-xl font-black tabular-nums" style={{ color: '#f1f5f9' }}>
                  {stat.value}
                </p>
              </div>
            ))}
          </div>

          <div
            className="relative mt-4 h-[240px] overflow-hidden rounded-2xl p-2 sm:h-[260px] lg:h-[280px]"
            style={DASHBOARD_DARK_PANEL_STYLE}
          >
            {analyticsLoading ? (
              <div
                className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl backdrop-blur-sm"
                style={{ background: 'rgba(8,14,30,0.65)' }}
              >
                <span
                  className="inline-flex items-center gap-2 text-xs font-semibold"
                  style={{ color: '#93c5fd' }}
                >
                  <RefreshCcw className="h-3.5 w-3.5 animate-spin" /> Loading analytics…
                </span>
              </div>
            ) : null}
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 16, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="engagementFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={selectedAnalytics.color} stopOpacity={0.45} />
                    <stop offset="95%" stopColor={selectedAnalytics.color} stopOpacity={0.02} />
                  </linearGradient>
                </defs>

                <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="rgba(59,87,163,0.15)" />

                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 12, fill: '#64748b' }}
                />

                <YAxis
                  domain={selectedAnalytics.suffix === '%' ? [0, 100] : ['auto', 'auto']}
                  tickCount={5}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 12, fill: '#64748b' }}
                />

                <Tooltip
                  cursor={{ stroke: 'rgba(59,87,163,0.5)', strokeWidth: 1, strokeDasharray: '3 3' }}
                  content={
                    <AnalyticsTooltip
                      suffix={selectedAnalytics.suffix}
                      metricLabel={selectedAnalytics.label}
                    />
                  }
                />

                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={selectedAnalytics.color}
                  strokeWidth={3}
                  fill="url(#engagementFill)"
                  isAnimationActive
                  animationDuration={chartAnimationDuration}
                  animationEasing="ease-in-out"
                  dot={{ r: 4, fill: selectedAnalytics.color, stroke: '#0d1525', strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: selectedAnalytics.color, stroke: '#0d1525', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div
            className="mt-4 grid grid-cols-1 gap-3 border-t pt-4"
            style={{ borderColor: 'rgba(59,87,163,0.15)' }}
          >
            <div>
              <p
                className="text-[10px] font-bold uppercase tracking-[0.1em]"
                style={{ color: '#64748b' }}
              >
                Top Tier
              </p>
              <p className="mt-1 text-3xl font-black" style={{ color: '#34d399' }}>
                {topTier}
              </p>
            </div>
          </div>

          {analyticsError ? (
            <p className="mt-2 text-xs font-medium" style={{ color: '#f87171' }} role="alert">
              {analyticsError}
            </p>
          ) : null}
        </motion.div>
      </div>
    </section>
  );
}

// Suppress unused-export false positive for averageByWeekday (kept for future use)
void averageByWeekday;
