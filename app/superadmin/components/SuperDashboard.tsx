'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  CreditCard,
  ScanLine,
  Users,
} from 'lucide-react';

import GeoHeatMap from './GeoHeatMap';
import RecentActivityCard from './RecentActivityCard';
import SystemHealthAnalyticsCard from './SystemHealthAnalyticsCard';
import UserDirectoryPerformanceCard from './UserDirectoryPerformanceCard';
import UsersTrendChart from './UsersTrendChart';
import { PortalPanel } from './ui/PortalPanel';
import { PortalPageHeader } from './ui/PortalPageHeader';
import { PortalStatCard } from './ui/PortalStatCard';
import {
  DASHBOARD_ACCENT,
  DASHBOARD_CARD_MIN_H,
  DASHBOARD_CARD_SHELL,
  DASHBOARD_GLASS_STYLE,
} from './ui/portalTokens';
import {
  asRecord,
  fetchClientsSummary,
  fetchDashboardMetrics,
  formatPercentDelta,
  pickNumber,
} from './dashboardApi';

type SummaryCard = {
  label: string;
  value: string;
  delta: string;
  icon: typeof Users;
};

const DEFAULT_SUMMARY_CARDS: SummaryCard[] = [
  { label: 'Total Users', value: '0', delta: '+0.0%', icon: Users },
  { label: 'New Users', value: '0', delta: '+0.0%', icon: Activity },
  { label: 'Basic accounts', value: '0', delta: '+0.0%', icon: CreditCard },
  { label: 'Standard Accounts', value: '0', delta: '+0.0%', icon: ScanLine },
  { label: 'Premium Accounts', value: '0', delta: '+0.0%', icon: ScanLine },
];

// Returns a localized number string. Treats null/undefined as 0 so the cards
// never render a placeholder dash for missing fields.
function formatNumber(value: number | null | undefined): string {
  const safe = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return safe.toLocaleString();
}

// Build the 5 summary cards by merging two backend sources:
//   1. /api/superadmin/dashboard/metrics — totals + percentage deltas + trend
//   2. /api/superadmin/clients/summary  — authoritative subscription breakdown
//      (free / basic / premium / enterprise) and last-30-days new-client count
// All extracted numbers fall back to 0 so the cards never display dashes.
function pickTierTrend(
  trend: unknown[],
  key: string
): { current: number | null; percentage_change: number | null } {
  const row = trend
    .map((entry) => asRecord(entry))
    .find((entry) => entry?.key === key);
  return {
    current: pickNumber(row?.current),
    percentage_change: pickNumber(row?.percentage_change),
  };
}

function mapSummaryCards(metricsPayload: unknown, clientsPayload: unknown): SummaryCard[] {
  const metricsRoot = asRecord(metricsPayload);
  const metricsData = asRecord(metricsRoot?.data) ?? metricsRoot ?? {};
  const totals = asRecord(metricsData.totals) ?? {};
  const comparisons = asRecord(metricsData.comparisons) ?? {};
  const usersComparison = asRecord(comparisons.users) ?? {};
  const tierTrend = Array.isArray(metricsData.user_tier_trend) ? metricsData.user_tier_trend : [];
  const newUsersTrend = pickTierTrend(tierTrend, 'new_users');
  const basicTrend = pickTierTrend(tierTrend, 'basic');
  const standardTrend = pickTierTrend(tierTrend, 'standard');
  const premiumTrend = pickTierTrend(tierTrend, 'premium');

  const clientsRoot = asRecord(clientsPayload);
  const clientsData = asRecord(clientsRoot?.data) ?? clientsRoot ?? {};
  const clientsSubs =
    asRecord(clientsData.subscription_distribution) ??
    asRecord(clientsData.subscriptions) ??
    asRecord(clientsData.subscription_breakdown) ??
    asRecord(clientsData.tiers) ??
    {};

  const totalUsers =
    pickNumber(
      totals.total_users,
      clientsData.total_clients,
      clientsData.total_users,
    ) ?? 0;
  const newUsers =
    pickNumber(
      newUsersTrend.current,
      clientsData.new_clients,
      clientsData.new_clients_last_30_days,
      clientsData.new_in_period
    ) ?? 0;

  const basicAccounts =
    pickNumber(basicTrend.current, clientsSubs.basic, clientsSubs.basic_count, clientsData.basic_count) ?? 0;

  const standardAccounts =
    pickNumber(
      standardTrend.current,
      clientsSubs.standard,
      clientsSubs.free,
      clientsSubs.standard_count,
      clientsSubs.free_count,
      clientsData.standard_count,
      clientsData.free_count
    ) ?? 0;

  const premiumAccounts =
    pickNumber(
      premiumTrend.current,
      clientsSubs.premium,
      clientsSubs.enterprise,
      clientsSubs.premium_count,
      clientsSubs.enterprise_count,
      clientsData.premium_count
    ) ?? 0;

  const totalDelta = pickNumber(usersComparison.percentage_change);
  const newUsersDelta = pickNumber(newUsersTrend.percentage_change);
  const basicDelta = pickNumber(basicTrend.percentage_change);
  const standardDelta = pickNumber(standardTrend.percentage_change);
  const premiumDelta = pickNumber(premiumTrend.percentage_change);

  return [
    { label: 'Total Users', value: formatNumber(totalUsers), delta: formatPercentDelta(totalDelta), icon: Users },
    { label: 'New Users', value: formatNumber(newUsers), delta: formatPercentDelta(newUsersDelta), icon: Activity },
    { label: 'Basic accounts', value: formatNumber(basicAccounts), delta: formatPercentDelta(basicDelta), icon: CreditCard },
    { label: 'Standard Accounts', value: formatNumber(standardAccounts), delta: formatPercentDelta(standardDelta), icon: ScanLine },
    { label: 'Premium Accounts', value: formatNumber(premiumAccounts), delta: formatPercentDelta(premiumDelta), icon: ScanLine },
  ];
}

export default function SuperDashboard() {
  const [summaryCards, setSummaryCards] = useState<SummaryCard[]>(DEFAULT_SUMMARY_CARDS);
  // `isInitialLoading` is true only on the very first fetch so the skeletons
  // disappear after the first successful (or failed) load and never reappear
  // during background polling refreshes.
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function loadMetrics() {
      try {
        const [metricsResult, clientsResult] = await Promise.allSettled([
          fetchDashboardMetrics('this_month', controller.signal),
          fetchClientsSummary(controller.signal),
        ]);
        if (cancelled) return;

        const metricsPayload =
          metricsResult.status === 'fulfilled' ? metricsResult.value : null;
        const clientsPayload =
          clientsResult.status === 'fulfilled' ? clientsResult.value : null;

        if (metricsResult.status === 'rejected') {
          console.error('SuperDashboard metrics fetch error:', metricsResult.reason);
        }
        if (clientsResult.status === 'rejected') {
          console.error('SuperDashboard clients summary fetch error:', clientsResult.reason);
        }

        setSummaryCards(mapSummaryCards(metricsPayload, clientsPayload));
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        console.error('SuperDashboard fetch error:', err);
      } finally {
        if (!cancelled) setIsInitialLoading(false);
      }
    }

    void loadMetrics();
    const pollInterval = window.setInterval(loadMetrics, 60_000);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(pollInterval);
    };
  }, []);

  return (
    <section className="mx-auto max-w-[1600px] space-y-6 sm:space-y-7">
      <div className={`${DASHBOARD_CARD_SHELL} px-5 py-5 sm:px-7 sm:py-6`} style={DASHBOARD_GLASS_STYLE}>
        <PortalPageHeader
          title="Welcome back, Super Admin"
          subtitle="Monitor platform health and track key business metrics in one place."
          className="[&_h2]:text-white [&_p]:text-slate-400"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5 sm:gap-5">
        {summaryCards.map(({ label, value, delta, icon: Icon }) => (
          <PortalStatCard
            key={label}
            label={label}
            value={value}
            delta={delta}
            icon={Icon}
            loading={isInitialLoading}
            accent={DASHBOARD_ACCENT}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 sm:gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)] xl:items-stretch">
        <UsersTrendChart />
        <RecentActivityCard />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:gap-6">
        <PortalPanel variant="glass" padding="lg" className={DASHBOARD_CARD_MIN_H}>
          <SystemHealthAnalyticsCard />
        </PortalPanel>
        <div className={DASHBOARD_CARD_MIN_H}>
          <UserDirectoryPerformanceCard />
        </div>
      </div>

      <GeoHeatMap />
    </section>
  );
}

