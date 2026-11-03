"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ModalPortal } from "@/app/components/ModalPortal";
import { showToast } from "@/app/components/Toast";
import { toServableMediaSrc } from "@/app/lib/portfolioDisplay";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Building2,
  ChevronDown,
  Eye,
  Users,
  Target,
  Mail,
  TrendingUp,
  TrendingDown,
  Search,
  Settings,
  UserPlus,
  ArrowRight,
  MoreVertical,
  Trash2,
  X,
} from "lucide-react";
import { InlineLoader, SectionLoader } from "../../../components/Loader";
import {
  companyAdminApiRequest,
  formatIsoDate,
  getInviteResendCooldownRemaining,
  initialsFromName,
  mapEmployeeRow,
  normalizeResponseData,
  setInviteResendCooldown,
  syncInviteResendCooldownFromError,
  TIME_FILTER_OPTIONS,
  type CompanyProfile,
  type EmployeePreviewRow,
  type TimeFilter,
} from "../../lib/companyAdminApi";
import EditEmployeeModal from "../../employee-list/components/EditEmployeeModal";
import JoinRequestsModal from "./JoinRequestsModal";
import CompanySettingsPanel from "./CompanySettingsPanel";
import EmployeeDetailModal from "./EmployeeDetailModal";

type EmployeeSeriesPoint = {
  userId: number;
  name: string;
  total: number;
  series: number[];
};

type MultiEmployeeChart = {
  labels: string[];
  employees: EmployeeSeriesPoint[];
};

type TopPerformer = {
  metric: string;
  name: string;
  role: string;
  value: number;
  profileImage: string | null;
};

const EMPLOYEE_LINE_COLORS = ["#2A4792", "#4785B8", "#0f766e", "#c2410c", "#7c3aed"] as const;

function buildMultiEmployeeChartData(chart: MultiEmployeeChart): Array<Record<string, string | number>> {
  return chart.labels.map((label, index) => {
    const row: Record<string, string | number> = { label };
    for (const employee of chart.employees) {
      row[`emp_${employee.userId}`] = Number(employee.series[index] ?? 0);
    }
    return row;
  });
}

function TopEmployeesMetricChart({
  title,
  chart,
  loading,
}: {
  title: string;
  chart: MultiEmployeeChart;
  loading: boolean;
}) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const data = useMemo(() => buildMultiEmployeeChartData(chart), [chart]);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-gray-900">{title}</h3>
          <p className="mt-1 text-xs text-gray-400">Top 5 employees over the selected period</p>
        </div>
        {hoveredKey ? (
          <span className="rounded-full bg-[#EEF2FA] px-2.5 py-1 text-[11px] font-semibold text-[#2A4792]">
            {chart.employees.find((employee) => `emp_${employee.userId}` === hoveredKey)?.name ?? "Employee"}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="h-[240px] flex items-center justify-center">
          <InlineLoader />
        </div>
      ) : chart.employees.length === 0 || data.length === 0 ? (
        <div className="h-[240px] flex items-center justify-center text-sm text-gray-400">No data</div>
      ) : (
        <>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={data}
                margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                onMouseLeave={() => setHoveredKey(null)}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "#9CA3AF" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#9CA3AF" }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  formatter={(value, name) => {
                    const key = String(name);
                    const employee = chart.employees.find((row) => `emp_${row.userId}` === key);
                    return [Number(value).toLocaleString(), employee?.name ?? "Employee"];
                  }}
                  labelFormatter={(label) => String(label)}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #E5E7EB",
                    boxShadow: "0 8px 24px rgba(15,23,42,0.08)",
                  }}
                />
                {chart.employees.map((employee, index) => {
                  const dataKey = `emp_${employee.userId}`;
                  const color = EMPLOYEE_LINE_COLORS[index % EMPLOYEE_LINE_COLORS.length];
                  const isHovered = hoveredKey === dataKey;
                  const isDimmed = hoveredKey !== null && !isHovered;
                  return (
                    <Line
                      key={dataKey}
                      type="monotone"
                      dataKey={dataKey}
                      name={dataKey}
                      stroke={isDimmed ? "#D1D5DB" : color}
                      strokeWidth={isHovered ? 3.5 : 2}
                      dot={false}
                      activeDot={{
                        r: 5,
                        fill: color,
                        stroke: "#fff",
                        strokeWidth: 2,
                        onMouseOver: () => setHoveredKey(dataKey),
                      }}
                      strokeOpacity={isDimmed ? 0.45 : 1}
                      onMouseOver={() => setHoveredKey(dataKey)}
                      style={{ transition: "stroke 120ms ease, stroke-opacity 120ms ease" }}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {chart.employees.map((employee, index) => {
              const dataKey = `emp_${employee.userId}`;
              const color = EMPLOYEE_LINE_COLORS[index % EMPLOYEE_LINE_COLORS.length];
              const isHovered = hoveredKey === dataKey;
              const isDimmed = hoveredKey !== null && !isHovered;
              return (
                <button
                  key={dataKey}
                  type="button"
                  onMouseEnter={() => setHoveredKey(dataKey)}
                  onMouseLeave={() => setHoveredKey(null)}
                  onFocus={() => setHoveredKey(dataKey)}
                  onBlur={() => setHoveredKey(null)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                    isHovered
                      ? "border-[#2A4792]/30 bg-[#EEF2FA] text-[#2A4792]"
                      : isDimmed
                        ? "border-gray-100 bg-gray-50 text-gray-400"
                        : "border-gray-100 bg-white text-gray-600"
                  }`}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: isDimmed ? "#D1D5DB" : color }}
                  />
                  <span className="max-w-[9rem] truncate">{employee.name}</span>
                  <span className="opacity-70">{employee.total.toLocaleString()}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function EmployeeAvatar({
  name,
  profileImage,
  className,
}: {
  name: string;
  profileImage: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const trimmed = profileImage?.trim() ?? "";
  const servableSrc = trimmed ? toServableMediaSrc(trimmed) : "";
  const showImage = Boolean(servableSrc) && !failed;

  useEffect(() => {
    setFailed(false);
  }, [servableSrc]);

  if (showImage) {
    return (
      <img
        src={servableSrc}
        alt=""
        className={className ?? "h-full w-full object-cover"}
        onError={() => setFailed(true)}
      />
    );
  }
  return <>{initialsFromName(name)}</>;
}

function toDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

export default function CompanyDashboardContent() {
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [timeFilter, setTimeFilter] = useState<TimeFilter>("this_month");
  const [filterOpen, setFilterOpen] = useState(false);
  const [customStart, setCustomStart] = useState(formatIsoDate(new Date(Date.now() - 7 * 86400000)));
  const [customEnd, setCustomEnd] = useState(formatIsoDate(new Date()));

  const [summary, setSummary] = useState({
    views: 0,
    leads: 0,
    inquiries: 0,
    employees: 0,
    viewsChange: 0,
    leadsChange: 0,
    inquiriesChange: 0,
  });
  const [summaryLoading, setSummaryLoading] = useState(true);

  const [viewsChart, setViewsChart] = useState<MultiEmployeeChart>({ labels: [], employees: [] });
  const [leadsChart, setLeadsChart] = useState<MultiEmployeeChart>({ labels: [], employees: [] });
  const [inquiriesChart, setInquiriesChart] = useState<MultiEmployeeChart>({ labels: [], employees: [] });
  const [chartsLoading, setChartsLoading] = useState(true);

  const [topPerformers, setTopPerformers] = useState<TopPerformer[]>([]);

  const [employees, setEmployees] = useState<EmployeePreviewRow[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(true);
  const [resendState, setResendState] = useState<Record<string, boolean>>({});
  const [deleteTarget, setDeleteTarget] = useState<EmployeePreviewRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [cooldownNow, setCooldownNow] = useState(() => Date.now());
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [pendingRequests, setPendingRequests] = useState(0);
  const [joinRequestsOpen, setJoinRequestsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Latest professional editor (row click). */
  const [editEmployee, setEditEmployee] = useState<EmployeePreviewRow | null>(null);
  /** Governance summary (Actions menu): co-admin / transfer / restrict / remove. */
  const [governanceEmployee, setGovernanceEmployee] = useState<EmployeePreviewRow | null>(null);

  const apiFilter = useMemo(
    () => TIME_FILTER_OPTIONS.find((o) => o.value === timeFilter)?.apiFilter ?? "this_month",
    [timeFilter],
  );

  const canEditCompany = company?.my_permissions?.includes("edit_company") ?? false;

  const loadCompany = useCallback(async () => {
    try {
      const payload = (await companyAdminApiRequest("/api/company/my-company")) as {
        data?: CompanyProfile;
      } & CompanyProfile;
      const data = normalizeResponseData(payload) as CompanyProfile;
      setCompany(data);
    } catch {
      setCompany(null);
    }
  }, []);

  const loadCharts = useCallback(async (startDate: string, endDate: string) => {
    setChartsLoading(true);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const payload = (await companyAdminApiRequest(
        `/api/company/dashboard/top-employees-time-series?start_date=${startDate}&end_date=${endDate}&limit=5&timezone=${encodeURIComponent(tz)}`,
      )) as {
        data?: {
          labels?: string[];
          profile_views?: Array<{
            user_id?: number;
            name?: string;
            total?: number;
            series?: number[];
          }>;
          leads?: Array<{
            user_id?: number;
            name?: string;
            total?: number;
            series?: number[];
          }>;
          inquiries?: Array<{
            user_id?: number;
            name?: string;
            total?: number;
            series?: number[];
          }>;
        };
      };

      const data = normalizeResponseData(payload);
      const labels = Array.isArray(data.labels) ? data.labels.map(String) : [];

      const mapEmployees = (
        rows: Array<{
          user_id?: number;
          name?: string;
          total?: number;
          series?: number[];
        }> = [],
      ): EmployeeSeriesPoint[] =>
        rows
          .map((row) => ({
            userId: Number(row.user_id ?? 0),
            name: String(row.name ?? "Employee").trim() || "Employee",
            total: Number(row.total ?? 0),
            series: Array.isArray(row.series)
              ? row.series.map((value) => Number(value ?? 0))
              : new Array(labels.length).fill(0),
          }))
          .filter((row) => Number.isFinite(row.userId) && row.userId > 0);

      setViewsChart({ labels, employees: mapEmployees(data.profile_views) });
      setLeadsChart({ labels, employees: mapEmployees(data.leads) });
      setInquiriesChart({ labels, employees: mapEmployees(data.inquiries) });
    } catch {
      setViewsChart({ labels: [], employees: [] });
      setLeadsChart({ labels: [], employees: [] });
      setInquiriesChart({ labels: [], employees: [] });
    } finally {
      setChartsLoading(false);
    }
  }, []);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setChartsLoading(true);
    try {
      const params = new URLSearchParams({ filter: apiFilter, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
      if (timeFilter === "custom") {
        params.set("start_date", customStart);
        params.set("end_date", customEnd);
      }
      const payload = (await companyAdminApiRequest(
        `/api/company/dashboard/summary?${params.toString()}`,
      )) as {
        data?: {
          total_profile_views?: number;
          leads_generated?: number;
          total_inquiries?: number;
          total_employees?: number;
          comparisons?: {
            profile_views?: { percentage?: number; direction?: "up" | "down" | "same" };
            leads?: { percentage?: number; direction?: "up" | "down" | "same" };
            inquiries?: { percentage?: number; direction?: "up" | "down" | "same" };
          };
        };
        meta?: { date_range?: { start?: string; end?: string } };
      };

      const data = payload.data ?? {};
      const comparisons = data.comparisons ?? {};
      const signedChange = (
        entry?: { percentage?: number; direction?: "up" | "down" | "same" },
      ) => {
        const pct = Number(entry?.percentage ?? 0);
        if (entry?.direction === "down") return -pct;
        if (entry?.direction === "same") return 0;
        return pct;
      };
      setSummary({
        views: Number(data.total_profile_views ?? 0),
        leads: Number(data.leads_generated ?? 0),
        inquiries: Number(data.total_inquiries ?? 0),
        employees: Number(data.total_employees ?? company?.current_employees ?? 0),
        viewsChange: signedChange(comparisons.profile_views),
        leadsChange: signedChange(comparisons.leads),
        inquiriesChange: signedChange(comparisons.inquiries),
      });

      const rangeStart = payload.meta?.date_range?.start;
      const rangeEnd = payload.meta?.date_range?.end;
      if (rangeStart && rangeEnd) {
        await loadCharts(toDateOnly(rangeStart), toDateOnly(rangeEnd));
      } else if (timeFilter === "custom") {
        await loadCharts(customStart, customEnd);
      } else {
        setViewsChart({ labels: [], employees: [] });
        setLeadsChart({ labels: [], employees: [] });
        setInquiriesChart({ labels: [], employees: [] });
        setChartsLoading(false);
      }
    } catch {
      setSummary((prev) => ({ ...prev, views: 0, leads: 0, inquiries: 0 }));
      setViewsChart({ labels: [], employees: [] });
      setLeadsChart({ labels: [], employees: [] });
      setInquiriesChart({ labels: [], employees: [] });
      setChartsLoading(false);
    } finally {
      setSummaryLoading(false);
    }
  }, [apiFilter, timeFilter, customStart, customEnd, company?.current_employees, loadCharts]);

  const loadTopPerformers = useCallback(async () => {
    const metrics = [
      { key: "profile_views", label: "Most Views", api: "profile_views" },
      { key: "leads", label: "Most Contact Saved", api: "leads" },
      { key: "inquiries", label: "Most Inquiry", api: "inquiries" },
    ] as const;

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const results: TopPerformer[] = [];

    for (const metric of metrics) {
      try {
        const params = new URLSearchParams({
          filter: apiFilter,
          metric: metric.api,
          limit: "1",
          timezone: tz,
        });
        if (timeFilter === "custom") {
          params.set("start_date", customStart);
          params.set("end_date", customEnd);
        }
        const payload = (await companyAdminApiRequest(
          `/api/company/dashboard/employee-rankings?${params.toString()}`,
        )) as {
          data?: {
            rankings?: Array<{
              name?: string;
              role?: string;
              profile_image?: string | null;
              metric_value?: number;
              value?: number;
              profile_views?: number;
              contact_saves?: number;
              inquiries?: number;
            }>;
          };
        };
        const top = payload.data?.rankings?.[0];
        if (!top) continue;

        const value = Number(
          top.metric_value ??
            top.value ??
            (metric.api === "profile_views"
              ? top.profile_views
              : metric.api === "leads"
                ? top.contact_saves
                : top.inquiries) ??
            0,
        );
        if (!Number.isFinite(value) || value <= 0) continue;

        const rawImage = typeof top.profile_image === "string" ? top.profile_image.trim() : "";
        results.push({
          metric: metric.label,
          name: String(top.name ?? "—"),
          role: String(top.role ?? "Employee"),
          value,
          profileImage: rawImage ? toServableMediaSrc(rawImage) : null,
        });
      } catch {
        // skip metric
      }
    }
    setTopPerformers(results);
  }, [apiFilter, timeFilter, customStart, customEnd]);

  const loadEmployees = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setEmployeesLoading(true);
    try {
      const params = new URLSearchParams({ page: "1", limit: "10", status: "all" });
      if (debouncedSearch) params.set("search", debouncedSearch);
      const payload = (await companyAdminApiRequest(
        `/api/company/employees?${params.toString()}`,
      )) as { employees?: Array<Record<string, unknown>>; data?: { employees?: Array<Record<string, unknown>> } };
      const data = normalizeResponseData(payload);
      const rows = Array.isArray(data.employees) ? data.employees : [];
      setEmployees(rows.map(mapEmployeeRow));
    } catch {
      if (!options?.silent) setEmployees([]);
    } finally {
      if (!options?.silent) setEmployeesLoading(false);
    }
  }, [debouncedSearch]);

  const handleReinvite = useCallback(
    async (employee: EmployeePreviewRow) => {
      if (!employee.invitationId) {
        showToast("Invitation ID is missing for this user.", "error");
        return;
      }

      const cooldownRemaining = getInviteResendCooldownRemaining(employee.id, cooldownNow);
      if (cooldownRemaining > 0) {
        showToast(
          `Please wait ${Math.ceil(cooldownRemaining / 1000)} seconds before resending.`,
          "error",
        );
        return;
      }

      setResendState((prev) => ({ ...prev, [employee.id]: true }));
      try {
        await companyAdminApiRequest("/api/company/invitations/resend", {
          method: "POST",
          body: JSON.stringify({ invitation_id: employee.invitationId }),
        });
        setInviteResendCooldown(employee.id);
        showToast(`Invitation resent to ${employee.email}.`, "success");
        await loadEmployees({ silent: true });
      } catch (error) {
        syncInviteResendCooldownFromError(employee.id, error);
        showToast(
          error instanceof Error ? error.message : "Failed to resend invitation.",
          "error",
        );
      } finally {
        setResendState((prev) => ({ ...prev, [employee.id]: false }));
      }
    },
    [cooldownNow, loadEmployees, showToast],
  );

  const handleConfirmDeleteInvitation = useCallback(async () => {
    if (!deleteTarget?.invitationId) return;
    setDeleteLoading(true);
    try {
      await companyAdminApiRequest(`/api/company/invitations/${deleteTarget.invitationId}`, {
        method: "DELETE",
      });
      setEmployees((prev) => prev.filter((row) => row.id !== deleteTarget.id));
      showToast(`Invitation for ${deleteTarget.email} was deleted.`, "success");
      setDeleteTarget(null);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to delete invitation.",
        "error",
      );
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteTarget, showToast]);

  const loadPendingCount = useCallback(async () => {
    try {
      const payload = (await companyAdminApiRequest(
        "/api/company/join-requests?status=pending&limit=50",
      )) as { requests?: unknown[]; data?: { requests?: unknown[] } };
      const data = normalizeResponseData(payload);
      const rows = Array.isArray(data.requests) ? data.requests : [];
      setPendingRequests(rows.length);
    } catch {
      setPendingRequests(0);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await loadCompany();
      await loadPendingCount();
      setLoading(false);
    };
    void init();
  }, [loadCompany, loadPendingCount]);

  useEffect(() => {
    void loadSummary();
    void loadTopPerformers();
  }, [loadSummary, loadTopPerformers]);

  useEffect(() => {
    void loadEmployees();
  }, [loadEmployees]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadEmployees({ silent: true });
    }, 15_000);

    const handleFocusRefresh = () => {
      void loadEmployees({ silent: true });
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") handleFocusRefresh();
    };

    window.addEventListener("focus", handleFocusRefresh);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", handleFocusRefresh);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [loadEmployees]);

  useEffect(() => {
    const timer = window.setInterval(() => setCooldownNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 400);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-filter-dropdown]")) {
        setFilterOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const summaryCards = [

    { label: "Profile Views", value: summary.views, change: summary.viewsChange, icon: Eye },
    { label: "Leads Generated", value: summary.leads, change: summary.leadsChange, icon: Target },
    { label: "Total Inquiry", value: summary.inquiries, change: summary.inquiriesChange, icon: Mail },
    { label: "Total Employees", value: summary.employees, change: 0, icon: Users },

  ];

  if (loading) {
    return <SectionLoader text="Loading company dashboard..." />;
  }
  return (
    <div className="space-y-6">
      {/* Company header */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="overflow-hidden rounded-2xl border border-gray-100 bg-white p-0 shadow-sm sm:p-5 lg:p-6"
      >
        <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-4 gap-y-3 p-4 sm:flex sm:flex-col sm:gap-4 sm:p-0 lg:flex-row lg:items-start lg:justify-between">
          <div className="contents sm:flex sm:min-w-0 sm:items-start sm:gap-4">
            <div className="row-span-3 flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-primary/10 sm:row-auto sm:h-16 sm:w-16">
              {company?.logo_url ? (
                <img src={toServableMediaSrc(company.logo_url)} alt="" className="h-full w-full object-cover" />
              ) : (
                <Building2 className="h-8 w-8 text-primary" />
              )}
            </div>
            <div className="contents sm:block sm:min-w-0">
              <h1 className="break-words text-xl font-bold leading-tight text-[#2a3c71] sm:truncate sm:text-2xl">
                {company?.company_name ?? "Company"}
              </h1>
              <p className="mt-1 break-words text-sm text-[#6f7fa8] line-clamp-2">
                {company?.description || "Manage your company profile, team, and performance."}
              </p>
              <p className="mt-2 text-xs font-medium text-gray-600 sm:hidden">
                {company?.current_employees ?? 0}/{company?.max_employees ?? "∞"} employees
              </p>
              <div className="col-span-2 mt-1 flex items-center justify-between gap-2 text-xs sm:mt-2 sm:justify-start">
                <span className="rounded-full bg-blue-50 px-2.5 py-1 font-semibold capitalize text-blue-700">
                  {company?.status ?? "active"}
                </span>
                <span className="hidden rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-600 sm:inline-flex">
                  {company?.current_employees ?? 0}/{company?.max_employees ?? "∞"} employees
                </span>
                {company?.subscription_tier && (
                  <span className="rounded-full bg-violet-50 px-2.5 py-1 font-medium capitalize text-violet-700">
                    {company.subscription_tier}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="-mx-4 col-span-2 flex w-auto flex-col gap-3 border-t border-gray-100 px-4 pt-4 sm:mx-0 sm:w-auto sm:flex-row sm:flex-wrap sm:shrink-0 sm:border-0 sm:px-0 sm:pt-0">
            <button
              type="button"
              onClick={() => setJoinRequestsOpen(true)}
              className="inline-flex w-full items-center justify-start gap-2 rounded-full border border-[#d8e2f2] bg-white px-4 py-3 text-sm font-semibold text-[#2a3c71] sm:w-auto sm:justify-center sm:py-2"
            >
              <UserPlus className="h-4 w-4" />
              Join Requests
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#e8f0ff] px-2 text-xs font-bold text-[#2a3c71]">
                {pendingRequests}
              </span>
            </button>
            {canEditCompany && (
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="inline-flex w-full items-center justify-start gap-2 rounded-full border border-[#d8e2f2] bg-white px-4 py-3 text-sm font-semibold text-[#2a3c71] sm:w-auto sm:justify-center sm:py-2"
              >
                <Settings className="h-4 w-4" />
                Settings
              </button>
            )}
            <Link
              href="/admin/employee-list"
              className="inline-flex w-full items-center justify-start gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-white sm:w-auto sm:justify-center sm:py-2"
            >
              View All Employees
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </motion.section>
      {/* Time filter */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="text-lg font-bold text-gray-900">Performance Overview</h2>
        <div className="relative" data-filter-dropdown>
          <button
            type="button"
            onClick={() => setFilterOpen((v) => !v)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg"
          >
            {TIME_FILTER_OPTIONS.find((o) => o.value === timeFilter)?.label ?? "This Month"}
            <ChevronDown className="h-4 w-4" />
          </button>
          {filterOpen && (
            <div className="absolute right-0 mt-2 w-44 bg-white border border-gray-100 rounded-xl shadow-lg z-10">
              {TIME_FILTER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setTimeFilter(option.value);
                    setFilterOpen(false);
                  }}
                  className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-50 first:rounded-t-xl last:rounded-b-xl ${
                    timeFilter === option.value ? "bg-blue-50 text-blue-600 font-semibold" : "text-gray-700"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {timeFilter === "custom" && (
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-sm">
            <span className="font-medium text-gray-700">Start</span>
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="mt-1 block rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            <span className="font-medium text-gray-700">End</span>
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="mt-1 block rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          </label>
          <button
            type="button"
            onClick={() => {
              void loadSummary();
              void loadTopPerformers();
            }}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
          >
            Apply
          </button>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryCards.map((card) => (
          <div key={card.label} className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">{card.label}</p>
                <p className="mt-2 text-3xl font-bold text-gray-900">
                  {summaryLoading ? "—" : card.value.toLocaleString()}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-primary/10">
                <card.icon className="h-5 w-5 text-primary" />
              </div>
            </div>
            {!summaryLoading && card.change !== 0 && (
              <div className="mt-3 flex items-center gap-1">
                {card.change >= 0 ? (
                  <TrendingUp className="h-4 w-4 text-emerald-500" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-rose-500" />
                )}
                <span className={`text-sm font-semibold ${card.change >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                  {Math.abs(card.change).toFixed(1)}%
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Top performers */}
      {topPerformers.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {topPerformers.map((performer) => (
            <div key={performer.metric} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{performer.metric}</p>
              <div className="mt-3 flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary flex items-center justify-center text-white text-sm font-semibold overflow-hidden">
                  <EmployeeAvatar name={performer.name} profileImage={performer.profileImage} />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{performer.name}</p>
                  <p className="text-xs text-gray-500 capitalize">{performer.role}</p>
                </div>
                <p className="ml-auto font-bold text-primary">{performer.value.toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Charts — top 5 employees per metric */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TopEmployeesMetricChart title="Profile Views" chart={viewsChart} loading={chartsLoading} />
        <TopEmployeesMetricChart title="Contact Saves" chart={leadsChart} loading={chartsLoading} />
        <TopEmployeesMetricChart title="Inquiries" chart={inquiriesChart} loading={chartsLoading} />
      </div>

      {/* Employee preview */}
      <section className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <h2 className="text-lg font-bold text-gray-900">Team Members</h2>
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search employees..."
              className="h-10 w-full rounded-lg border border-gray-200 pl-10 pr-3 text-sm focus:border-primary outline-none"
            />
          </div>
        </div>
        {employeesLoading ? (
          <div className="flex justify-center py-10"><InlineLoader /></div>
        ) : employees.length === 0 ? (
          <p className="text-center py-10 text-sm text-gray-400">No employees found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-gray-400 uppercase border-b border-gray-100">
                <tr>
                  <th className="px-3 py-3">Employee</th>
                  <th className="px-3 py-3">Role</th>
                  <th className="px-3 py-3 text-center">Views</th>
                  <th className="px-3 py-3 text-center">Leads</th>
                  <th className="px-3 py-3 text-center">Inquiries</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {employees.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => {
                      if (row.membershipStatus === "pending_invite") return;
                      setEditEmployee(row);
                    }}
                    className={`hover:bg-gray-50/80 transition-colors ${
                      row.membershipStatus === "pending_invite"
                        ? "cursor-default"
                        : "cursor-pointer"
                    }`}
                  >
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-primary flex items-center justify-center text-white text-xs font-semibold overflow-hidden">
                          <EmployeeAvatar name={row.name} profileImage={row.profileImage} />
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900">{row.name}</p>
                          <p className="text-xs text-gray-500">{row.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 capitalize text-gray-600">{row.role}</td>
                    <td className="px-3 py-3 text-center font-medium">{row.activity.views}</td>
                    <td className="px-3 py-3 text-center font-medium">{row.activity.leads}</td>
                    <td className="px-3 py-3 text-center font-medium">{row.activity.inquiries}</td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                          row.status === "Active"
                            ? "bg-emerald-50 text-emerald-700"
                            : row.status === "Pending Invite"
                              ? "bg-amber-50 text-amber-700"
                              : row.status === "Invite Expired"
                                ? "bg-orange-50 text-orange-700"
                                : "bg-rose-50 text-rose-700"
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      {row.membershipStatus === "pending_invite" ? (
                        <div className="inline-flex items-center justify-end gap-2">
                          {(() => {
                            const cooldownRemaining = getInviteResendCooldownRemaining(
                              row.id,
                              cooldownNow,
                            );
                            const cooldownSeconds = Math.ceil(cooldownRemaining / 1000);
                            const isResending = Boolean(resendState[row.id]);
                            const isCooldownActive = cooldownRemaining > 0;
                            return (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleReinvite(row);
                                }}
                                disabled={isResending || isCooldownActive}
                                className="inline-flex items-center gap-1 rounded-lg border border-[#2a4792]/20 bg-[#e8f0ff] px-2.5 py-1 text-xs font-semibold text-[#2a4792] hover:bg-[#dce8ff] disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {isResending ? (
                                  <InlineLoader />
                                ) : (
                                  <Mail className="h-3 w-3" />
                                )}
                                {isCooldownActive ? `Resend in ${cooldownSeconds}s` : "Re-invite"}
                              </button>
                            );
                          })()}
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setDeleteTarget(row);
                            }}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:text-rose-600"
                            aria-label={`Delete invitation for ${row.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setGovernanceEmployee(row);
                          }}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-800"
                          aria-label={`Manage ${row.name}`}
                          title="Manage member"
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex justify-center">
          <Link href="/admin/employee-list" className="text-sm font-semibold text-primary hover:underline">
            View full employee list →
          </Link>
        </div>
      </section>

      <JoinRequestsModal
        isOpen={joinRequestsOpen}
        onClose={() => setJoinRequestsOpen(false)}
        onUpdated={setPendingRequests}
      />

      <CompanySettingsPanel
        isOpen={settingsOpen}
        company={company}
        canEdit={canEditCompany}
        isPrimaryAdmin={Boolean(company?.is_primary_admin)}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => void loadCompany()}
      />

      {editEmployee && (
        <EditEmployeeModal
          employee={editEmployee}
          onClose={() => setEditEmployee(null)}
          onSaved={async () => {
            await loadEmployees();
            void loadSummary();
            void loadCompany();
          }}
        />
      )}

      <EmployeeDetailModal
        employee={governanceEmployee}
        companyName={company?.company_name ?? "Company"}
        actorIsPrimaryAdmin={Boolean(company?.is_primary_admin)}
        coAdminCount={company?.co_admin_count ?? 0}
        coAdminLimit={company?.co_admin_limit ?? 3}
        onClose={() => setGovernanceEmployee(null)}
        onUpdated={() => {
          void loadEmployees();
          void loadSummary();
          void loadCompany();
        }}
        onEditProfessional={(row) => {
          setGovernanceEmployee(null);
          setEditEmployee(row);
        }}
      />

      {deleteTarget && (
        <ModalPortal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">Delete Invitation</h3>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                aria-label="Close"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-3 text-sm text-gray-600">
              Are you sure you want to permanently delete the invitation for{" "}
              <span className="font-semibold text-gray-900">{deleteTarget.email}</span>? This action
              cannot be undone.
            </p>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDeleteInvitation()}
                disabled={deleteLoading}
                className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {deleteLoading ? <InlineLoader /> : "Delete"}
              </button>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}
