"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  CreditCard,
  ExternalLink,
  History,
  PencilLine,
  QrCode,
  Shield,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { ModalPortal } from "@/app/components/ModalPortal";
import { InlineLoader, SectionLoader } from "@/app/components/Loader";
import { showToast } from "@/app/components/Toast";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import { toServableMediaSrc } from "@/app/lib/portfolioDisplay";
import {
  companyAdminApiRequest,
  initialsFromName,
  normalizeResponseData,
} from "../../lib/companyAdminApi";
import {
  buildCompanyActingHeaders,
  clearCompanyEmployeeActingContext,
  startCompanyEmployeeActingContext,
} from "../../lib/companyEmployeeActingContext";

const BizCardPage = dynamic(
  () =>
    import("@/app/user/bizcard/BizCardPage").then((mod) => ({
      default: mod.BizCardPage,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center py-16">
        <SectionLoader text="Loading BizCard editor…" />
      </div>
    ),
  },
);

const USER_SYNC_EVENT = "ontap:user-sync";
const API = getFrontendApiBaseUrl();

export type EditEmployeeTarget = {
  id: string;
  userId: string;
  name: string;
  email: string;
  profileImage?: string | null;
  role: string;
  status: "Active" | "Suspended" | "Pending Invite" | "Invite Expired";
};

type EditTab = "bizcards" | "access";

type CardRow = {
  id: string;
  serialId: string;
  name: string;
  title: string;
  status: string;
  isActive: boolean;
  portfolioUrl: string;
  profileImg: string | null;
  createdAt: string | null;
};

type HistoryRow = {
  log_id: string;
  actor_name: string;
  action: string;
  created_at: string;
  details: Record<string, unknown> | null;
};

type Props = {
  employee: EditEmployeeTarget;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
};

const TABS: Array<{ id: EditTab; label: string; description: string; Icon: typeof CreditCard }> = [
  { id: "bizcards", label: "BizCards", description: "Employee BizCards", Icon: CreditCard },
  { id: "access", label: "Access", description: "Role & status", Icon: Shield },
];

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getDisplayName(first: unknown, last: unknown, fallback: unknown): string {
  const firstName = String(first ?? "").trim();
  const lastName = String(last ?? "").trim();
  const fallbackName = String(fallback ?? "").trim();
  return [firstName, lastName].filter(Boolean).join(" ").trim() || fallbackName;
}

function buildPortfolioUrl(alias: string): string {
  const cleanAlias = alias.trim().replace(/^\/+/, "");
  if (!cleanAlias) return "#";
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/${cleanAlias}`;
  }
  return `/${cleanAlias}`;
}

function buildQrCodeUrl(portfolioUrl: string): string {
  if (!portfolioUrl || portfolioUrl === "#") return "";
  return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&ecc=H&margin=8&data=${encodeURIComponent(portfolioUrl)}`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatActionLabel(action: string): string {
  return action
    .replace(/^employee\./, "")
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function mapProfileToRow(profile: Record<string, unknown>): CardRow | null {
  const alias = normalizeString(profile.custom_uri);
  const name = getDisplayName(
    profile.first_name,
    profile.last_name,
    normalizeString(profile.vcard_name) || normalizeString(profile.bizcard_name),
  );
  const serialId = normalizeString(profile.serial_id ?? profile.serialId);
  if (!alias && !serialId && !name) return null;

  return {
    id: String(
      profile.bizcard_id ?? profile.user_id ?? (alias || serialId || name || "profile"),
    ),
    serialId,
    name,
    title: normalizeString(
      profile.job_position ??
        profile.prof_title ??
        profile.professional_title ??
        profile.occupation,
    ),
    status: String(profile.vcard_published === false ? "inactive" : "active"),
    isActive: profile.vcard_published !== false,
    portfolioUrl: alias ? buildPortfolioUrl(alias) : "#",
    profileImg: normalizeString(profile.profile_url ?? profile.profile_img) || null,
    createdAt:
      normalizeString(
        (profile.vcardSetup as Record<string, unknown> | undefined)?.setup_completed_at,
      ) || null,
  };
}

export default function EditEmployeeModal({ employee, onClose, onSaved }: Props) {
  const [tab, setTab] = useState<EditTab>("bizcards");
  const [saving, setSaving] = useState(false);
  const [loadingCards, setLoadingCards] = useState(true);
  const [refreshingCards, setRefreshingCards] = useState(false);
  const [cardRows, setCardRows] = useState<CardRow[]>([]);
  const [editingBizcardId, setEditingBizcardId] = useState<string | null>(null);
  const [actingReady, setActingReady] = useState(false);

  const [editRoleOption, setEditRoleOption] = useState<
    "admin" | "manager" | "employee" | "viewer" | "other"
  >("employee");
  const [editCustomRole, setEditCustomRole] = useState("");
  const [editStatus, setEditStatus] = useState<"Active" | "Suspended">("Active");
  const [editReason, setEditReason] = useState("");
  const [baselineRole, setBaselineRole] = useState("");
  const [baselineStatus, setBaselineStatus] = useState<"Active" | "Suspended">("Active");

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const loadRequestIdRef = useRef(0);
  const employeeIdRef = useRef(employee.id);

  const activeTabMeta = useMemo(
    () => TABS.find((item) => item.id === tab) ?? TABS[0],
    [tab],
  );

  const nextRole =
    editRoleOption === "other"
      ? editCustomRole.trim().toLowerCase().replace(/\s+/g, " ")
      : editRoleOption;
  const roleDirty = nextRole !== baselineRole;
  const statusDirty = editStatus !== baselineStatus;
  const accessDirty = roleDirty || statusDirty;

  const statusStyles = useMemo<Record<string, string>>(
    () => ({
      active: "bg-emerald-50 text-emerald-700 border-emerald-200",
      draft: "bg-amber-50 text-amber-700 border-amber-200",
      inactive: "bg-gray-100 text-gray-600 border-gray-200",
      revoked: "bg-red-50 text-red-700 border-red-200",
      unassigned: "bg-slate-100 text-slate-600 border-slate-200",
    }),
    [],
  );

  const syncRoleStatusFromEmployee = useCallback(() => {
    const normalizedRole = employee.role.toLowerCase();
    if (
      normalizedRole === "admin" ||
      normalizedRole === "manager" ||
      normalizedRole === "employee" ||
      normalizedRole === "viewer"
    ) {
      setEditRoleOption(normalizedRole);
      setEditCustomRole("");
      setBaselineRole(normalizedRole);
    } else {
      setEditRoleOption("other");
      setEditCustomRole(employee.role);
      setBaselineRole(employee.role.toLowerCase());
    }
    const status: "Active" | "Suspended" =
      employee.status === "Suspended" ? "Suspended" : "Active";
    setEditStatus(status);
    setBaselineStatus(status);
  }, [employee.role, employee.status]);

  const loadCards = useCallback(async (silent = false) => {
    const requestId = ++loadRequestIdRef.current;
    if (silent) setRefreshingCards(true);
    else setLoadingCards(true);

    try {
      const actingHeaders = buildCompanyActingHeaders();
      const [bizcardsRes, profileRes] = await Promise.all([
        fetch(
          `${API}/api/user/bizcards?page=1&limit=20&sortBy=created_at&sortDir=desc`,
          {
            credentials: "include",
            cache: "no-store",
            headers: { ...actingHeaders },
          },
        ),
        fetch(`${API}/api/vcard/profile`, {
          credentials: "include",
          cache: "no-store",
          headers: { ...actingHeaders },
        }),
      ]);

      if (requestId !== loadRequestIdRef.current) return;

      const bizcardsPayload = bizcardsRes.ok ? await bizcardsRes.json() : null;
      const profilePayload = profileRes.ok ? await profileRes.json() : null;

      const apiRows = Array.isArray(bizcardsPayload?.data?.bizcards)
        ? bizcardsPayload.data.bizcards
        : Array.isArray(bizcardsPayload?.bizcards)
          ? bizcardsPayload.bizcards
          : [];

      const mappedRows: CardRow[] = apiRows.map(
        (card: Record<string, unknown>, index: number) => {
          const serialId = normalizeString(card.serial_id ?? card.serialId);
          const alias = normalizeString(card.url_alias);
          const name = getDisplayName(
            card.first_name,
            card.last_name,
            normalizeString(card.bizcard_name) || alias || `BizCard ${index + 1}`,
          );
          const title = normalizeString(
            card.professional_title ?? card.job_position ?? card.occupation,
          );
          const portfolioUrl = alias
            ? buildPortfolioUrl(alias)
            : normalizeString(card.portfolio_url) || "#";
          const isActive =
            typeof card.is_active === "boolean"
              ? card.is_active
              : !Boolean(card.deactivated_flag);

          return {
            id: String(card.bizcard_id ?? card.id ?? (serialId || index + 1)),
            serialId,
            name,
            title,
            status: String(
              isActive ? "active" : (card.activation_status ?? "inactive"),
            ).trim(),
            isActive,
            portfolioUrl,
            profileImg: normalizeString(card.profile_img) || null,
            createdAt: normalizeString(card.created_at) || null,
          };
        },
      );

      const profileRow = mapProfileToRow(
        (profilePayload?.profile ?? {}) as Record<string, unknown>,
      );
      const visibleRows =
        mappedRows.length > 0 ? mappedRows : profileRow ? [profileRow] : [];

      setCardRows(visibleRows);
    } catch {
      if (requestId === loadRequestIdRef.current) {
        setCardRows([]);
      }
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setLoadingCards(false);
        setRefreshingCards(false);
      }
    }
  }, []);

  // Start acting context + load cards when employee opens / changes.
  useEffect(() => {
    let cancelled = false;
    employeeIdRef.current = employee.id;
    setTab("bizcards");
    setEditingBizcardId(null);
    setEditReason("");
    setActingReady(false);
    setCardRows([]);
    setLoadingCards(true);
    syncRoleStatusFromEmployee();

    const bootstrap = async () => {
      try {
        await startCompanyEmployeeActingContext(employee.id);
        if (cancelled) return;
        setActingReady(true);
        await loadCards(false);
      } catch (error) {
        if (cancelled) return;
        setActingReady(false);
        setLoadingCards(false);
        showToast(
          error instanceof Error
            ? error.message
            : "Failed to open employee BizCard context.",
          "error",
        );
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
      void clearCompanyEmployeeActingContext(employee.id);
    };
  }, [employee.id, loadCards, syncRoleStatusFromEmployee]);

  useEffect(() => {
    syncRoleStatusFromEmployee();
  }, [syncRoleStatusFromEmployee]);

  // Same refresh signals as User BizCard Overview.
  useEffect(() => {
    if (!actingReady || editingBizcardId) return;

    const handleSync = () => {
      void loadCards(true);
    };

    const handleStorage = (event: StorageEvent) => {
      const key = event.key ?? "";
      if (
        key === "portfolio_refresh_ts" ||
        key === "latestPortfolioAlias" ||
        key.startsWith("portfolio_") ||
        key === "frontend_new_bizcard_refresh"
      ) {
        void loadCards(true);
      }
    };

    window.addEventListener(USER_SYNC_EVENT, handleSync);
    window.addEventListener("focus", handleSync);
    window.addEventListener("storage", handleStorage);

    // Cross-session updates (employee creates a card in another browser) rely on
    // polling — storage/sync events only fire in the same browser.
    const pollId = window.setInterval(() => {
      void loadCards(true);
    }, 10_000);

    return () => {
      window.clearInterval(pollId);
      window.removeEventListener(USER_SYNC_EVENT, handleSync);
      window.removeEventListener("focus", handleSync);
      window.removeEventListener("storage", handleStorage);
    };
  }, [actingReady, editingBizcardId, loadCards]);

  const handleClose = useCallback(() => {
    void clearCompanyEmployeeActingContext(employeeIdRef.current);
    onClose();
  }, [onClose]);

  const openHistory = async () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const payload = await companyAdminApiRequest(
        `/api/company/employees/${employee.id}/activity-history?page=1&limit=20`,
      );
      const data = normalizeResponseData(
        payload as { data?: { logs?: HistoryRow[] } },
      );
      setHistoryRows(data.logs ?? []);
    } catch (error) {
      setHistoryRows([]);
      showToast(
        error instanceof Error ? error.message : "Failed to load activity history.",
        "error",
      );
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSaveAccess = async () => {
    if (editRoleOption === "other") {
      if (!nextRole) {
        showToast("Please enter a custom role.", "error");
        return;
      }
      if (nextRole.length > 20) {
        showToast("Custom role must be at most 20 characters.", "error");
        return;
      }
      if (!/^[a-z0-9]+(?:[ _-][a-z0-9]+)*$/i.test(nextRole)) {
        showToast(
          "Custom role may only contain letters, numbers, spaces, and hyphens.",
          "error",
        );
        return;
      }
    }

    if (!accessDirty) {
      showToast("No changes to save.", "info");
      return;
    }

    setSaving(true);
    try {
      if (roleDirty) {
        await companyAdminApiRequest(`/api/company/employees/${employee.id}/role`, {
          method: "PUT",
          body: JSON.stringify({
            role: nextRole,
            reason: editReason.trim() || undefined,
          }),
        });
      }

      if (statusDirty) {
        await companyAdminApiRequest(`/api/company/employees/${employee.id}/restrict`, {
          method: "POST",
          body: JSON.stringify({
            action: editStatus === "Suspended" ? "restrict" : "unrestrict",
            reason: editReason.trim() || undefined,
          }),
        });
      }

      showToast("Employee access updated successfully.", "success");
      await onSaved();
      handleClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to update employee.", "error");
    } finally {
      setSaving(false);
    }
  };

  const hasCards = cardRows.length > 0;

  const inputClass =
    "mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#2a4792]/20 focus:border-[#2a4792]";

  return (
    <>
      <ModalPortal isOpen onClose={handleClose}>
        <div
          className={`flex items-stretch justify-center ${
            editingBizcardId
              ? "w-[min(100vw-1.5rem,72rem)]"
              : "w-[min(100vw-1.5rem,64rem)]"
          }`}
        >
          <div
            className={`relative flex w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${
              editingBizcardId
                ? "h-[min(96vh,900px)]"
                : "h-[min(92vh,720px)]"
            }`}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-gray-900">Edit Employee</h3>
                <p className="mt-0.5 truncate text-sm font-semibold text-gray-700">{employee.name}</p>
                <p className="truncate text-xs text-gray-500">{employee.email}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => void openHistory()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                >
                  <History className="h-3.5 w-3.5" />
                  View History
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col md:flex-row">
              {!editingBizcardId ? (
                <aside className="hidden w-[220px] shrink-0 border-r border-gray-100 bg-gray-50/70 p-3 md:block">
                  <nav className="space-y-1">
                    {TABS.map((item) => {
                      const Icon = item.Icon;
                      const active = tab === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setTab(item.id)}
                          className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors ${
                            active
                              ? "border border-[#2a4792]/20 bg-[#2a4792]/5 text-[#1f2f56] shadow-sm"
                              : "border border-transparent text-gray-600 hover:bg-white hover:text-gray-900"
                          }`}
                        >
                          <Icon
                            className={`mt-0.5 h-4 w-4 shrink-0 ${active ? "text-[#2a4792]" : "text-gray-400"}`}
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold">{item.label}</span>
                            <span
                              className={`block text-xs ${active ? "text-[#2a4792]/70" : "text-gray-400"}`}
                            >
                              {item.description}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </nav>
                </aside>
              ) : null}

              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                {!editingBizcardId ? (
                  <div className="shrink-0 border-b border-gray-100 px-4 py-2 md:hidden">
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {TABS.map((item) => {
                        const active = tab === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setTab(item.id)}
                            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
                              active
                                ? "bg-[#1f2f56] text-white"
                                : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingBizcardId(null);
                        void loadCards(true);
                        void onSaved();
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      Back to BizCards
                    </button>
                    <p className="truncate text-xs text-gray-500">
                      Editing BizCard with the same editor as My BizCards
                    </p>
                  </div>
                )}

                <div className="relative min-h-0 w-full flex-1 overflow-hidden">
                  {editingBizcardId ? (
                    <div className="h-full overflow-y-auto bg-[#f4f7fb]">
                      <React.Suspense
                        fallback={
                          <div className="flex h-full items-center justify-center py-16">
                            <SectionLoader text="Loading BizCard editor…" />
                          </div>
                        }
                      >
                        <BizCardPage bizcardId={editingBizcardId} embedded />
                      </React.Suspense>
                    </div>
                  ) : (
                    <div className="h-full overflow-y-auto p-4 sm:p-5">
                      <AnimatePresence mode="wait">
                        <motion.div
                          key={tab}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ duration: 0.15 }}
                          className="space-y-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <h4 className="text-base font-bold text-gray-900">
                                {activeTabMeta.label}
                              </h4>
                              <p className="text-xs text-gray-500">
                                {activeTabMeta.description}
                                {tab === "bizcards" && refreshingCards
                                  ? " · Refreshing…"
                                  : ""}
                              </p>
                            </div>
                          </div>

                          {tab === "bizcards" && (
                            <>
                              {loadingCards ? (
                                <div className="flex justify-center py-16">
                                  <SectionLoader text="Loading BizCards…" />
                                </div>
                              ) : !hasCards ? (
                                <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-10 text-center shadow-sm">
                                  <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
                                    <QrCode className="h-6 w-6" />
                                  </div>
                                  <p className="text-sm font-semibold text-gray-700">
                                    No BizCard yet
                                  </p>
                                  <p className="mt-1 text-xs text-gray-500">
                                    This employee does not have a BizCard to manage.
                                  </p>
                                </div>
                              ) : (
                                <div className="space-y-4">
                                  {cardRows.length > 1 ? (
                                    <p className="text-xs text-gray-500">
                                      {cardRows.length} BizCards for this employee
                                    </p>
                                  ) : null}
                                  {cardRows.map((card, index) => (
                                    <div
                                      key={card.id}
                                      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                                    >
                                      {cardRows.length > 1 ? (
                                        <p className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                          BizCard {index + 1}
                                        </p>
                                      ) : null}
                                      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                                        <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-full border-2 border-white bg-slate-100 shadow ring-1 ring-slate-200">
                                          {card.profileImg ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                              src={toServableMediaSrc(card.profileImg)}
                                              alt={card.name || "BizCard"}
                                              className="h-full w-full object-cover object-top"
                                              onError={(event) => {
                                                event.currentTarget.style.display = "none";
                                                const fallback =
                                                  event.currentTarget.nextElementSibling;
                                                if (fallback instanceof HTMLElement) {
                                                  fallback.style.display = "flex";
                                                }
                                              }}
                                            />
                                          ) : null}
                                          <div
                                            className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-900 to-blue-700 text-lg font-bold text-white"
                                            style={{
                                              display: card.profileImg ? "none" : "flex",
                                            }}
                                          >
                                            {initialsFromName(card.name || employee.name)}
                                          </div>
                                        </div>

                                        <div className="min-w-0 flex-1 space-y-3">
                                          <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div className="min-w-0">
                                              <p className="truncate text-lg font-bold text-slate-900">
                                                {card.name || "BizCard"}
                                              </p>
                                              <p className="mt-0.5 truncate text-sm text-blue-600">
                                                {card.title || "BizCard Profile"}
                                              </p>
                                            </div>
                                            <span
                                              className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide sm:text-[11px] ${statusStyles[card.status?.toLowerCase() ?? "active"] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}
                                            >
                                              {card.status || "active"}
                                            </span>
                                          </div>

                                          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                            <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5">
                                              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                                Created At
                                              </dt>
                                              <dd className="mt-0.5 text-sm font-medium text-slate-900">
                                                {formatDateTime(card.createdAt)}
                                              </dd>
                                            </div>
                                            <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5">
                                              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                                Serial_ID
                                              </dt>
                                              <dd className="mt-0.5 break-all text-sm font-medium text-slate-900">
                                                {card.serialId || "Not available"}
                                              </dd>
                                            </div>
                                            <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5 sm:col-span-2">
                                              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                                Portfolio URL
                                              </dt>
                                              <dd className="mt-0.5">
                                                <a
                                                  href={card.portfolioUrl || "#"}
                                                  target="_blank"
                                                  rel="noreferrer"
                                                  className="break-all text-sm font-semibold text-blue-700 hover:text-blue-800"
                                                >
                                                  {card.portfolioUrl &&
                                                  card.portfolioUrl !== "#"
                                                    ? card.portfolioUrl
                                                    : "Portfolio unavailable"}
                                                </a>
                                              </dd>
                                            </div>
                                          </dl>

                                          <div className="flex flex-wrap items-end justify-between gap-4">
                                            <div>
                                              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                                QR Code
                                              </p>
                                              {card.portfolioUrl &&
                                              card.portfolioUrl !== "#" ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img
                                                  src={buildQrCodeUrl(card.portfolioUrl)}
                                                  alt={`QR Code for ${card.name || "BizCard"}`}
                                                  className="h-20 w-20 rounded-lg border border-slate-200 bg-white object-contain p-1"
                                                />
                                              ) : (
                                                <span className="text-xs text-slate-400">—</span>
                                              )}
                                            </div>

                                            <div className="flex items-center gap-2">
                                              <button
                                                type="button"
                                                onClick={() => setEditingBizcardId(card.id)}
                                                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-blue-100 bg-blue-50 px-3 text-xs font-semibold text-blue-700 shadow-sm transition-all hover:bg-blue-100"
                                              >
                                                <PencilLine className="h-4 w-4" />
                                                Edit
                                              </button>
                                              <a
                                                href={card.portfolioUrl || "#"}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[#2D3A8C] px-3 text-xs font-semibold text-white shadow-sm transition-all hover:bg-[#243080]"
                                              >
                                                <ExternalLink className="h-4 w-4" />
                                                Open
                                              </a>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </>
                          )}

                          {tab === "access" && (
                            <div className="space-y-4">
                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div>
                                  <label className="text-sm font-semibold text-gray-700">
                                    Role
                                  </label>
                                  <select
                                    value={editRoleOption}
                                    onChange={(event) =>
                                      setEditRoleOption(
                                        event.target.value as typeof editRoleOption,
                                      )
                                    }
                                    className={inputClass}
                                  >
                                    <option value="admin">Admin</option>
                                    <option value="manager">Manager</option>
                                    <option value="employee">Employee</option>
                                    <option value="viewer">Viewer</option>
                                    <option value="other">Other</option>
                                  </select>
                                  {editRoleOption === "other" && (
                                    <input
                                      type="text"
                                      value={editCustomRole}
                                      onChange={(event) =>
                                        setEditCustomRole(event.target.value)
                                      }
                                      placeholder="e.g. Sales, Support, Staff"
                                      maxLength={20}
                                      className={`${inputClass} mt-2`}
                                    />
                                  )}
                                </div>
                                <div>
                                  <label className="text-sm font-semibold text-gray-700">
                                    Status
                                  </label>
                                  <select
                                    value={editStatus}
                                    onChange={(event) =>
                                      setEditStatus(
                                        event.target.value as typeof editStatus,
                                      )
                                    }
                                    className={inputClass}
                                  >
                                    <option value="Active">Active</option>
                                    <option value="Suspended">Suspended</option>
                                  </select>
                                </div>
                              </div>
                              <div>
                                <label className="text-sm font-semibold text-gray-700">
                                  Reason (optional)
                                </label>
                                <textarea
                                  value={editReason}
                                  onChange={(event) => setEditReason(event.target.value)}
                                  rows={3}
                                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                                />
                              </div>
                            </div>
                          )}
                        </motion.div>
                      </AnimatePresence>
                    </div>
                  )}
                </div>

                {!editingBizcardId ? (
                  <div className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-100 px-4 py-3 sm:px-5">
                    <p className="text-xs text-gray-500">
                      {tab === "access"
                        ? accessDirty
                          ? "Unsaved access changes"
                          : "No access changes"
                        : "BizCard edits save inside the editor"}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleClose}
                        className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold"
                      >
                        Cancel
                      </button>
                      {tab === "access" ? (
                        <button
                          type="button"
                          onClick={() => void handleSaveAccess()}
                          disabled={saving || !accessDirty}
                          className="inline-flex items-center gap-2 rounded-lg bg-[#1f2f56] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                        >
                          {saving ? <InlineLoader /> : "Save Changes"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </ModalPortal>

      {historyOpen && (
        <ModalPortal isOpen={historyOpen} onClose={() => setHistoryOpen(false)}>
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Activity History</h3>
                <p className="text-xs text-gray-500">{employee.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
              {historyLoading ? (
                <div className="flex justify-center py-10">
                  <InlineLoader />
                </div>
              ) : historyRows.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">
                  No activity recorded yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {historyRows.map((row) => (
                    <li
                      key={row.log_id}
                      className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5"
                    >
                      <p className="text-sm font-semibold text-gray-900">
                        {formatActionLabel(row.action)}
                      </p>
                      <p className="text-xs text-gray-500">
                        {row.actor_name} · {new Date(row.created_at).toLocaleString()}
                      </p>
                      {Array.isArray(row.details?.changedFields) ? (
                        <p className="mt-1 text-xs text-gray-600">
                          Fields: {(row.details?.changedFields as string[]).join(", ")}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  );
}
