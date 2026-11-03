"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { InlineLoader, SectionLoader } from "@/app/components/Loader";
import { DevCard } from "@/app/dev/components/DevCard";
import { useDevEndpoint } from "@/app/dev/hooks/useDevEndpoint";
import type { ApiEntry, HttpMethod, LifecycleTag, ApiCategory } from "@/lib/data/api-registry";
import type { PageApiUsage, PortalSurface } from "@/lib/data/api-page-map";
import {
  Search,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Copy,
  Check,
  AlertTriangle,
  Zap,
  Archive,
  Lock,
  Globe,
  Webhook,
  Shield,
  BookOpen,
  Filter,
  X,
  Activity,
  Layers,
  Map as MapIcon,
  ExternalLink,
  FileCode2,
  LayoutList,
} from "lucide-react";

// ─────────────────────── Types ───────────────────────

type ExplorerData = {
  apis: ApiEntry[];
  pages: PageApiUsage[];
  portalLabels: Record<PortalSurface, string>;
  stats: {
    totalEndpoints: number;
    byMethod: Record<string, number>;
    byLifecycle: Record<string, number>;
    byCategory: Record<string, number>;
    byAuth: Record<string, number>;
    mappedEndpoints: number;
    totalPages: number;
    pagesByPortal: Record<string, number>;
  };
};

type BrowseMode = "endpoints" | "pages";

// ─────────────────────── Constants ───────────────────

const METHOD_COLORS: Record<HttpMethod, { bg: string; text: string; border: string }> = {
  GET: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  POST: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  PUT: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  PATCH: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200" },
  DELETE: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200" },
  OPTIONS: { bg: "bg-gray-50", text: "text-gray-600", border: "border-gray-200" },
};

const LIFECYCLE_CONFIG: Record<
  LifecycleTag,
  { label: string; bg: string; text: string; border: string; icon: React.ReactNode; description: string }
> = {
  primary: {
    label: "Primary",
    bg: "bg-[#EEF2FA]",
    text: "text-[#2A4792]",
    border: "border-[#2A4792]/20",
    icon: <Zap className="h-3 w-3" />,
    description: "The canonical, actively maintained endpoint for this operation.",
  },
  fallback: {
    label: "Fallback",
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
    icon: <RefreshCw className="h-3 w-3" />,
    description: "Used when the primary endpoint is unavailable or unsupported by the client.",
  },
  legacy: {
    label: "Legacy",
    bg: "bg-orange-50",
    text: "text-orange-700",
    border: "border-orange-200",
    icon: <Archive className="h-3 w-3" />,
    description: "Maintained for backwards compatibility. Prefer using the primary endpoint.",
  },
  internal: {
    label: "Internal",
    bg: "bg-purple-50",
    text: "text-purple-700",
    border: "border-purple-200",
    icon: <Lock className="h-3 w-3" />,
    description: "Internal system endpoint. Not for external or frontend use.",
  },
  deprecated: {
    label: "Deprecated",
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
    icon: <AlertTriangle className="h-3 w-3" />,
    description: "Scheduled for removal. Migrate to the recommended replacement immediately.",
  },
};

const AUTH_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  session: { label: "Session", icon: <Shield className="h-3 w-3" />, color: "text-blue-600" },
  superadmin: { label: "SuperAdmin", icon: <Shield className="h-3 w-3" />, color: "text-red-600" },
  staff: { label: "Staff", icon: <Shield className="h-3 w-3" />, color: "text-indigo-600" },
  dev: { label: "Dev", icon: <Shield className="h-3 w-3" />, color: "text-purple-600" },
  public: { label: "Public", icon: <Globe className="h-3 w-3" />, color: "text-emerald-600" },
  webhook: { label: "Webhook", icon: <Webhook className="h-3 w-3" />, color: "text-amber-600" },
};

const PORTAL_COLORS: Record<PortalSurface, { bg: string; text: string; border: string; dot: string }> = {
  dev: { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200", dot: "bg-purple-500" },
  superadmin: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200", dot: "bg-red-500" },
  admin: { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200", dot: "bg-indigo-500" },
  staff: { bg: "bg-sky-50", text: "text-sky-700", border: "border-sky-200", dot: "bg-sky-500" },
  user: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", dot: "bg-emerald-500" },
  public: { bg: "bg-gray-50", text: "text-gray-700", border: "border-gray-200", dot: "bg-gray-500" },
};

const ALL_CATEGORIES: ApiCategory[] = [
  "Auth", "User", "BizCard", "Company", "Connections", "Marketplace",
  "Media", "Messaging", "Notifications", "Portfolio", "Products",
  "SuperAdmin", "Staff", "Affiliate", "Analytics", "DevPortal",
  "Cron", "Payments", "Geo", "Debug",
];

const ALL_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const ALL_LIFECYCLES: LifecycleTag[] = ["primary", "fallback", "legacy", "internal", "deprecated"];
const PORTAL_ORDER: PortalSurface[] = ["dev", "superadmin", "admin", "staff", "user", "public"];

// ─────────────────────── Sub-components ──────────────────────

function MethodBadge({ method }: { method: HttpMethod }) {
  const c = METHOD_COLORS[method];
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${c.bg} ${c.text} ${c.border}`}
    >
      {method}
    </span>
  );
}

function LifecycleBadge({ lifecycle }: { lifecycle: LifecycleTag }) {
  const c = LIFECYCLE_CONFIG[lifecycle];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${c.bg} ${c.text} ${c.border}`}
    >
      {c.icon}
      {c.label}
    </span>
  );
}

function AuthBadge({ auth }: { auth: string }) {
  const c = AUTH_CONFIG[auth] ?? { label: auth, icon: <Lock className="h-3 w-3" />, color: "text-gray-500" };
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${c.color}`}>
      {c.icon}
      {c.label}
    </span>
  );
}

function PortalBadge({ portal }: { portal: PortalSurface }) {
  const c = PORTAL_COLORS[portal];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${c.bg} ${c.text} ${c.border}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {portal}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
      title="Copy path"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ─────────────────────── Main Page ───────────────────────────

export default function ApiExplorerPage() {
  const { data, loading, error, reload } = useDevEndpoint<ExplorerData>("/api/dev/api-explorer");

  const [browseMode, setBrowseMode] = useState<BrowseMode>("endpoints");
  const [search, setSearch] = useState("");
  const [filterMethod, setFilterMethod] = useState<HttpMethod | "">("");
  const [filterLifecycle, setFilterLifecycle] = useState<LifecycleTag | "">("");
  const [filterCategory, setFilterCategory] = useState<ApiCategory | "">("");
  const [filterAuth, setFilterAuth] = useState("");
  const [filterPortal, setFilterPortal] = useState<PortalSurface | "">("");
  const [filterMappedOnly, setFilterMappedOnly] = useState(false);
  const [filterDestructive, setFilterDestructive] = useState(false);
  const [filterRateLimited, setFilterRateLimited] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [expandAll, setExpandAll] = useState(false);
  const [focusApiId, setFocusApiId] = useState<string | null>(null);
  const [focusPagePath, setFocusPagePath] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filteredApis = useMemo(() => {
    if (!data) return [];
    let list = data.apis;

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) =>
          e.path.toLowerCase().includes(q) ||
          e.summary.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q) ||
          e.id.toLowerCase().includes(q) ||
          (e.usedByPages ?? []).some(
            (p) => p.path.toLowerCase().includes(q) || p.label.toLowerCase().includes(q),
          ),
      );
    }
    if (filterMethod) list = list.filter((e) => e.method === filterMethod);
    if (filterLifecycle) list = list.filter((e) => e.lifecycle === filterLifecycle);
    if (filterCategory) list = list.filter((e) => e.category === filterCategory);
    if (filterAuth) list = list.filter((e) => e.auth === filterAuth);
    if (filterPortal) {
      list = list.filter((e) => (e.usedByPages ?? []).some((p) => p.portal === filterPortal));
    }
    if (filterMappedOnly) list = list.filter((e) => (e.usedByPages ?? []).length > 0);
    if (filterDestructive) list = list.filter((e) => e.destructive);
    if (filterRateLimited) list = list.filter((e) => e.rateLimited);

    return list;
  }, [
    data,
    search,
    filterMethod,
    filterLifecycle,
    filterCategory,
    filterAuth,
    filterPortal,
    filterMappedOnly,
    filterDestructive,
    filterRateLimited,
  ]);

  const groupedApis = useMemo(() => {
    const map = new Map<string, ApiEntry[]>();
    for (const e of filteredApis) {
      if (!map.has(e.category)) map.set(e.category, []);
      map.get(e.category)!.push(e);
    }
    return map;
  }, [filteredApis]);

  const filteredPages = useMemo(() => {
    if (!data) return [];
    let list = data.pages;
    if (filterPortal) list = list.filter((p) => p.portal === filterPortal);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.path.toLowerCase().includes(q) ||
          p.label.toLowerCase().includes(q) ||
          p.apis.some((a) => a.toLowerCase().includes(q)) ||
          (p.note ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [data, search, filterPortal]);

  const pagesByPortal = useMemo(() => {
    const map = new Map<PortalSurface, PageApiUsage[]>();
    for (const p of filteredPages) {
      if (!map.has(p.portal)) map.set(p.portal, []);
      map.get(p.portal)!.push(p);
    }
    return PORTAL_ORDER.filter((portal) => map.has(portal)).map((portal) => ({
      portal,
      pages: map.get(portal)!,
    }));
  }, [filteredPages]);

  const activeFilterCount =
    [filterMethod, filterLifecycle, filterCategory, filterAuth, filterPortal].filter(Boolean).length +
    (filterDestructive ? 1 : 0) +
    (filterRateLimited ? 1 : 0) +
    (filterMappedOnly ? 1 : 0);

  function clearFilters() {
    setFilterMethod("");
    setFilterLifecycle("");
    setFilterCategory("");
    setFilterAuth("");
    setFilterPortal("");
    setFilterDestructive(false);
    setFilterRateLimited(false);
    setFilterMappedOnly(false);
  }

  function jumpToApi(apiId: string) {
    setBrowseMode("endpoints");
    setFocusApiId(apiId);
    setExpandAll(true);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => {
      scrollToId(`api-${apiId}`);
    }, 80);
  }

  function jumpToPage(pagePath: string) {
    setBrowseMode("pages");
    setFocusPagePath(pagePath);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => {
      scrollToId(`page-${encodeURIComponent(pagePath)}`);
    }, 80);
  }

  useEffect(() => {
    return () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    };
  }, []);

  const apiByPath = useMemo(() => {
    if (!data) return new Map<string, ApiEntry>();
    const map = new Map<string, ApiEntry>();
    for (const api of data.apis) {
      map.set(api.path, api);
      map.set(api.path.replace(/:\w+/g, "*"), api);
    }
    return map;
  }, [data]);

  function resolveRegistryApis(pattern: string): ApiEntry[] {
    if (!data) return [];
    const base = pattern.replace(/\/\*$/, "");
    return data.apis.filter((api) => {
      const p = api.path.replace(/:\w+/g, "*");
      return (
        p === pattern ||
        p === base ||
        p.startsWith(base + "/") ||
        pattern.startsWith(p + "/") ||
        (pattern.endsWith("/*") && (p === base || p.startsWith(base + "/")))
      );
    });
  }

  if (loading) {
    return <SectionLoader text="Loading API explorer..." />;
  }

  if (!data) {
    return (
      <div className="rounded-2xl bg-white p-6 text-sm text-red-600 shadow-sm">
        {error ?? "Failed to load API explorer."}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">API Explorer</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            {data.stats.totalEndpoints} endpoints · {data.stats.totalPages} mapped pages ·{" "}
            {data.stats.mappedEndpoints} endpoints linked to UI
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setBrowseMode("endpoints")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                browseMode === "endpoints"
                  ? "bg-[#2A4792] text-white"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              Endpoints
            </button>
            <button
              type="button"
              onClick={() => setBrowseMode("pages")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                browseMode === "pages"
                  ? "bg-[#2A4792] text-white"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              <MapIcon className="h-3.5 w-3.5" />
              Pages → APIs
            </button>
          </div>
          <button
            type="button"
            onClick={() => void reload()}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Compact stats */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatChip
          label="Endpoints"
          value={data.stats.totalEndpoints}
          hint={`${data.stats.mappedEndpoints} mapped to pages`}
          icon={<Activity className="h-4 w-4 text-[#2A4792]" />}
        />
        <StatChip
          label="Pages mapped"
          value={data.stats.totalPages}
          hint="Across all portals"
          icon={<LayoutList className="h-4 w-4 text-[#2A4792]" />}
        />
        <StatChip
          label="Dev Portal pages"
          value={data.stats.pagesByPortal.dev ?? 0}
          hint="Primary navigation surfaces"
          icon={<FileCode2 className="h-4 w-4 text-purple-600" />}
        />
        <StatChip
          label="Primary lifecycle"
          value={data.stats.byLifecycle.primary ?? 0}
          hint={`${Math.round(((data.stats.byLifecycle.primary ?? 0) / data.stats.totalEndpoints) * 100)}% of registry`}
          icon={<Zap className="h-4 w-4 text-amber-500" />}
        />
      </div>

      {/* Search + Filters */}
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-5 py-4 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder={
                browseMode === "endpoints"
                  ? "Search path, summary, page route, or ID…"
                  : "Search page path, label, or API…"
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-4 text-sm text-gray-800 placeholder-gray-400 focus:border-[#2A4792] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2A4792]/20"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className={`relative inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                showFilters || activeFilterCount > 0
                  ? "border-[#2A4792]/40 bg-[#EEF2FA] text-[#2A4792]"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              <Filter className="h-4 w-4" />
              Filters
              {activeFilterCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#2A4792] text-[9px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
            {browseMode === "endpoints" && (
              <button
                type="button"
                onClick={() => setExpandAll((v) => !v)}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <BookOpen className="h-4 w-4" />
                {expandAll ? "Collapse" : "Expand"} All
              </button>
            )}
          </div>
        </div>

        {showFilters && (
          <div className="border-t border-gray-100 pt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {browseMode === "endpoints" && (
              <>
                <FilterSelect
                  label="Method"
                  value={filterMethod}
                  onChange={(v) => setFilterMethod(v as HttpMethod | "")}
                  options={ALL_METHODS.map((m) => ({ value: m, label: m }))}
                />
                <FilterSelect
                  label="Lifecycle"
                  value={filterLifecycle}
                  onChange={(v) => setFilterLifecycle(v as LifecycleTag | "")}
                  options={ALL_LIFECYCLES.map((l) => ({
                    value: l,
                    label: LIFECYCLE_CONFIG[l].label,
                  }))}
                />
                <FilterSelect
                  label="Category"
                  value={filterCategory}
                  onChange={(v) => setFilterCategory(v as ApiCategory | "")}
                  options={ALL_CATEGORIES.map((c) => ({ value: c, label: c }))}
                />
                <FilterSelect
                  label="Auth"
                  value={filterAuth}
                  onChange={setFilterAuth}
                  options={Object.keys(AUTH_CONFIG).map((a) => ({
                    value: a,
                    label: AUTH_CONFIG[a]?.label ?? a,
                  }))}
                />
              </>
            )}
            <FilterSelect
              label="Portal"
              value={filterPortal}
              onChange={(v) => setFilterPortal(v as PortalSurface | "")}
              options={PORTAL_ORDER.map((p) => ({
                value: p,
                label: data.portalLabels[p] ?? p,
              }))}
            />
            <div className="sm:col-span-2 xl:col-span-5 flex flex-wrap items-center gap-4 pt-1">
              {browseMode === "endpoints" && (
                <>
                  <ToggleChip
                    checked={filterMappedOnly}
                    onChange={setFilterMappedOnly}
                    label="Mapped to pages only"
                  />
                  <ToggleChip
                    checked={filterDestructive}
                    onChange={setFilterDestructive}
                    label="Destructive only"
                  />
                  <ToggleChip
                    checked={filterRateLimited}
                    onChange={setFilterRateLimited}
                    label="Rate limited only"
                  />
                </>
              )}
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                  Clear
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Body: nav + content */}
      <div className="grid gap-5 xl:grid-cols-[220px_minmax(0,1fr)]">
        {/* Sticky nav */}
        <aside className="xl:sticky xl:top-4 xl:self-start">
          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-3 max-h-[70vh] overflow-y-auto">
            <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
              {browseMode === "endpoints" ? "Categories" : "Portals"}
            </p>
            {browseMode === "endpoints" ? (
              <nav className="space-y-0.5">
                {Array.from(groupedApis.entries()).map(([category, entries]) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => scrollToId(`cat-${category}`)}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm text-gray-700 hover:bg-[#EEF2FA] hover:text-[#2A4792] transition-colors"
                  >
                    <span className="truncate font-medium">{category}</span>
                    <span className="ml-2 shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                      {entries.length}
                    </span>
                  </button>
                ))}
                {groupedApis.size === 0 && (
                  <p className="px-2 py-3 text-xs text-gray-400">No categories match.</p>
                )}
              </nav>
            ) : (
              <nav className="space-y-0.5">
                {pagesByPortal.map(({ portal, pages }) => (
                  <button
                    key={portal}
                    type="button"
                    onClick={() => scrollToId(`portal-${portal}`)}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm text-gray-700 hover:bg-[#EEF2FA] hover:text-[#2A4792] transition-colors"
                  >
                    <span className="flex items-center gap-2 truncate font-medium">
                      <span className={`h-2 w-2 rounded-full ${PORTAL_COLORS[portal].dot}`} />
                      {data.portalLabels[portal]}
                    </span>
                    <span className="ml-2 shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                      {pages.length}
                    </span>
                  </button>
                ))}
                {pagesByPortal.length === 0 && (
                  <p className="px-2 py-3 text-xs text-gray-400">No pages match.</p>
                )}
              </nav>
            )}
          </div>
        </aside>

        {/* Main list */}
        <div className="min-w-0 space-y-4">
          <div className="flex items-center justify-between text-sm text-gray-500">
            {browseMode === "endpoints" ? (
              <span>
                Showing <span className="font-semibold text-gray-800">{filteredApis.length}</span> of{" "}
                <span className="font-semibold text-gray-800">{data.stats.totalEndpoints}</span> endpoints
              </span>
            ) : (
              <span>
                Showing <span className="font-semibold text-gray-800">{filteredPages.length}</span> of{" "}
                <span className="font-semibold text-gray-800">{data.stats.totalPages}</span> pages
              </span>
            )}
          </div>

          {browseMode === "endpoints" ? (
            filteredApis.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="space-y-4">
                {Array.from(groupedApis.entries()).map(([category, entries]) => (
                  <div key={category} id={`cat-${category}`} className="scroll-mt-4">
                    <DevCard
                      title={category}
                      subtitle={`${entries.length} endpoint${entries.length === 1 ? "" : "s"}`}
                    >
                      <div className="space-y-2">
                        {entries.map((entry) => (
                          <ApiRowControlled
                            key={entry.id}
                            entry={entry}
                            forceExpand={expandAll || focusApiId === entry.id}
                            highlighted={focusApiId === entry.id}
                            onJumpToPage={jumpToPage}
                          />
                        ))}
                      </div>
                    </DevCard>
                  </div>
                ))}
              </div>
            )
          ) : filteredPages.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-5">
              {pagesByPortal.map(({ portal, pages }) => (
                <div key={portal} id={`portal-${portal}`} className="scroll-mt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <PortalBadge portal={portal} />
                    <h3 className="text-sm font-bold text-gray-900">
                      {data.portalLabels[portal]}
                    </h3>
                    <span className="text-xs text-gray-400">
                      {pages.length} page{pages.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {pages.map((page) => {
                      const highlighted = focusPagePath === page.path;
                      return (
                        <div
                          key={page.path}
                          id={`page-${encodeURIComponent(page.path)}`}
                          className={`scroll-mt-4 rounded-2xl border bg-white shadow-sm overflow-hidden transition-shadow ${
                            highlighted
                              ? "border-[#2A4792] ring-2 ring-[#2A4792]/20"
                              : "border-gray-100"
                          }`}
                        >
                          <div className="border-b border-gray-100 px-4 py-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-semibold text-gray-900 truncate">{page.label}</p>
                                <code className="mt-0.5 block text-[11px] font-mono text-gray-500 truncate">
                                  {page.path}
                                </code>
                              </div>
                              {!page.path.includes("(layout)") && !page.path.includes("[") && (
                                <a
                                  href={page.path.replace(/\s*\(layout\)\s*$/, "")}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-[#2A4792]"
                                  title="Open page"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              )}
                            </div>
                            {page.note && (
                              <p className="mt-1.5 text-[11px] text-gray-500">{page.note}</p>
                            )}
                          </div>
                          <div className="px-3 py-2 space-y-1.5 max-h-64 overflow-y-auto">
                            <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                              Fetches {page.apis.length} API
                              {page.apis.length === 1 ? "" : "s"}
                            </p>
                            {page.apis.map((apiPath) => {
                              const matches = resolveRegistryApis(apiPath);
                              const primary = matches[0] ?? apiByPath.get(apiPath);
                              return (
                                <button
                                  key={apiPath}
                                  type="button"
                                  onClick={() => {
                                    if (primary) jumpToApi(primary.id);
                                  }}
                                  disabled={!primary}
                                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                                    primary
                                      ? "hover:bg-[#EEF2FA] cursor-pointer"
                                      : "opacity-70 cursor-default"
                                  }`}
                                  title={
                                    primary
                                      ? `Jump to ${primary.id}`
                                      : "Not in curated registry (still called by this page)"
                                  }
                                >
                                  {primary ? (
                                    <MethodBadge method={primary.method} />
                                  ) : (
                                    <span className="inline-flex items-center rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-bold text-gray-500">
                                      —
                                    </span>
                                  )}
                                  <code className="flex-1 min-w-0 truncate text-[11px] font-mono text-gray-700">
                                    {apiPath}
                                  </code>
                                  {primary && (
                                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-300" />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatChip({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: number;
  hint: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-4 py-3 flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#EEF2FA]">{icon}</div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{label}</p>
        <p className="text-2xl font-black text-gray-900 leading-none mt-0.5">{value}</p>
        <p className="text-[11px] text-gray-400 mt-1 truncate">{hint}</p>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 focus:border-[#2A4792] focus:outline-none"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ToggleChip({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-gray-300 text-[#2A4792] focus:ring-[#2A4792]"
      />
      <span className="text-sm text-gray-600">{label}</span>
    </label>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white px-6 py-12 text-center shadow-sm">
      <Search className="mx-auto h-8 w-8 text-gray-300 mb-3" />
      <p className="text-sm font-medium text-gray-600">No results match your filters.</p>
      <p className="mt-1 text-xs text-gray-400">Try clearing filters or broadening your search.</p>
    </div>
  );
}

function ApiRowControlled({
  entry,
  forceExpand,
  highlighted,
  onJumpToPage,
}: {
  entry: ApiEntry;
  forceExpand: boolean;
  highlighted?: boolean;
  onJumpToPage: (pagePath: string) => void;
}) {
  const [localExpanded, setLocalExpanded] = useState<boolean | null>(null);
  const expanded = localExpanded !== null ? localExpanded : forceExpand;
  const pages = entry.usedByPages ?? [];

  return (
    <div
      id={`api-${entry.id}`}
      className={`scroll-mt-4 rounded-xl border bg-white overflow-hidden transition-shadow ${
        highlighted ? "border-[#2A4792] ring-2 ring-[#2A4792]/20" : "border-gray-100"
      }`}
    >
      <button
        type="button"
        onClick={() => setLocalExpanded((v) => !(v !== null ? v : forceExpand))}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="shrink-0">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-400" />
          )}
        </span>

        <MethodBadge method={entry.method} />

        <code className="flex-1 min-w-0 truncate text-xs font-mono text-gray-700 sm:text-sm">
          {entry.path}
        </code>

        <span className="hidden md:block truncate max-w-40 text-xs text-gray-500">
          {entry.summary}
        </span>

        {pages.length > 0 ? (
          <span className="hidden sm:inline-flex shrink-0 items-center rounded-full bg-[#EEF2FA] border border-[#2A4792]/15 px-2 py-0.5 text-[10px] font-semibold text-[#2A4792]">
            {pages.length} page{pages.length === 1 ? "" : "s"}
          </span>
        ) : (
          <span className="hidden sm:inline-flex shrink-0 items-center rounded-full bg-gray-50 border border-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-400">
            unmapped
          </span>
        )}

        <div className="hidden lg:flex items-center gap-2 shrink-0">
          <LifecycleBadge lifecycle={entry.lifecycle} />
        </div>

        {entry.destructive && (
          <span title="Destructive">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50/60 px-5 py-4 space-y-4">
          <div>
            <p className="text-sm font-semibold text-gray-900">{entry.summary}</p>
            <p className="mt-1 text-sm text-gray-600 leading-relaxed">{entry.description}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-400 font-medium mb-1">Path</p>
              <div className="flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-2">
                <code className="flex-1 text-xs font-mono text-gray-800 break-all">{entry.path}</code>
                <CopyButton text={entry.path} />
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-400 font-medium mb-1">Returns</p>
              <div className="rounded-lg bg-gray-100 px-3 py-2">
                <code className="text-xs font-mono text-gray-700 break-all leading-relaxed">
                  {entry.returns}
                </code>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 font-medium">Lifecycle</span>
              <LifecycleBadge lifecycle={entry.lifecycle} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 font-medium">Auth</span>
              <AuthBadge auth={entry.auth} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 font-medium">Category</span>
              <span className="text-xs text-gray-700 font-semibold">{entry.category}</span>
            </div>
            {entry.rateLimited && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                Rate Limited
              </span>
            )}
            {entry.destructive && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                Destructive
              </span>
            )}
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-gray-400 font-medium mb-1.5">
              Used by pages
            </p>
            {pages.length === 0 ? (
              <p className="text-xs text-gray-400 italic">
                No mapped portal pages yet for this registry path.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {pages.map((page) => (
                  <button
                    key={page.path}
                    type="button"
                    onClick={() => onJumpToPage(page.path)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors hover:brightness-95 ${PORTAL_COLORS[page.portal].bg} ${PORTAL_COLORS[page.portal].text} ${PORTAL_COLORS[page.portal].border}`}
                    title={`Show ${page.path} in Pages view`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${PORTAL_COLORS[page.portal].dot}`} />
                    {page.label}
                    <code className="opacity-70 font-mono text-[10px]">{page.path}</code>
                  </button>
                ))}
              </div>
            )}
          </div>

          {entry.seeAlso && entry.seeAlso.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-400 font-medium mb-1.5">
                See Also
              </p>
              <div className="flex flex-wrap gap-1.5">
                {entry.seeAlso.map((id) => (
                  <span
                    key={id}
                    className="rounded-full bg-[#EEF2FA] border border-[#2A4792]/20 px-2.5 py-0.5 text-xs font-mono text-[#2A4792]"
                  >
                    {id}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
