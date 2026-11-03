"use client";

import { useState, useCallback, useEffect } from "react";
import { useAnalytics } from "@/hooks/useAnalytics";
import {
  DateRangeSelector,
  AnalyticsPeriod,
  periodToApiParams,
  readStoredAnalyticsPeriod,
} from "./DateRangeSelector";
import { ProfileViewsCard, ContactsAddedCard } from "./SummaryCard";
import { EngagementMetricsChart } from "./Charts";
import { TrafficEngagementCard } from "./GeoMap";
import { RecentActivity } from "./RecentActivity";
import { AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { InlineLoader, SectionLoader } from "./Loader";

function getInitialApiState(): {
  period: AnalyticsPeriod;
  filter: string;
  startDate?: string;
  endDate?: string;
} {
  const period = readStoredAnalyticsPeriod();
  const params = periodToApiParams(period);
  return { period, ...params };
}

export default function AnalyticsDashboard() {
  const initial = getInitialApiState();
  const [period, setPeriod] = useState<AnalyticsPeriod>(initial.period);
  const [filter, setFilter] = useState(initial.filter);
  const [startDate, setStartDate] = useState<string | undefined>(initial.startDate);
  const [endDate, setEndDate] = useState<string | undefined>(initial.endDate);
  const [page, setPage] = useState(1);
  const [activityType, setActivityType] = useState<"all" | "profile_view" | "contact_save">("all");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const { data: response, loading, error, refetch } = useAnalytics({
    filter,
    startDate,
    endDate,
    page,
    limit: 20,
  });

  const analyticsData = response?.data;
  const isRefreshing = loading && Boolean(analyticsData);

  const handleRangeChange = useCallback(
    (newFilter: string, newStartDate?: string, newEndDate?: string) => {
      setFilter(newFilter);
      setStartDate(newStartDate);
      setEndDate(newEndDate);
      setPage(1);
    },
    [],
  );

  const handlePeriodChange = useCallback((newPeriod: AnalyticsPeriod) => {
    setPeriod(newPeriod);
  }, []);

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
  }, []);

  const filteredActivities =
    analyticsData?.recent_activities.items.filter(
      (item: { type: string }) => activityType === "all" || item.type === activityType,
    ) ?? [];

  if (!mounted || (loading && !analyticsData)) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center bg-[#F4F7FC]">
        <SectionLoader text="Loading analytics…" />
      </div>
    );
  }

  if (error && !analyticsData) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center bg-[#F4F7FC] p-4">
        <div className="max-w-md rounded-2xl border border-red-100 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <AlertCircle className="h-6 w-6 text-red-600" />
          </div>
          <h3 className="mb-2 text-lg font-bold text-gray-900">Failed to load data</h3>
          <p className="mb-6 text-gray-500">{error}</p>
          <button
            type="button"
            onClick={refetch}
            className="rounded-lg bg-[#2A4792] px-6 py-2 font-medium text-white transition-colors hover:bg-[#1e3568]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scroll-smooth bg-[#F4F7FC]">
      <div className="relative mx-auto max-w-[1600px] p-4 pb-20 sm:p-6 lg:p-8">
        <AnimatePresence>
          {isRefreshing && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pointer-events-none absolute inset-x-4 top-4 z-20 flex justify-end sm:inset-x-6 lg:inset-x-8"
            >
              <span className="inline-flex items-center gap-2 rounded-full border border-[#4785B8]/20 bg-white/90 px-3 py-1.5 text-xs font-medium text-[#2A4792] shadow-sm backdrop-blur-sm">
                <InlineLoader />
                Updating…
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-start sm:justify-end"
        >
          <DateRangeSelector
            currentPeriod={period}
            onPeriodChange={handlePeriodChange}
            onRangeChange={handleRangeChange}
          />
        </motion.div>

        {analyticsData && (
          <motion.div
            key={`${filter}-${startDate ?? ""}-${endDate ?? ""}`}
            initial={{ opacity: 0.6 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.35 }}
            className="space-y-6"
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
              <ProfileViewsCard summary={analyticsData.summary} loading={isRefreshing} />
              <ContactsAddedCard summary={analyticsData.summary} loading={isRefreshing} />
              <TrafficEngagementCard
                mapData={analyticsData.locations.map_data}
                countries={analyticsData.locations.countries}
                cities={analyticsData.locations.cities}
                loading={isRefreshing}
              />
              <EngagementMetricsChart
                viewsData={analyticsData.charts.views_over_time}
                savesData={analyticsData.charts.saves_over_time}
                loading={isRefreshing}
              />
            </div>

            <RecentActivity
              activities={filteredActivities}
              pagination={analyticsData.recent_activities.pagination}
              onPageChange={handlePageChange}
              currentFilter={activityType}
              onFilterChange={setActivityType}
            />
          </motion.div>
        )}
      </div>
    </div>
  );
}
