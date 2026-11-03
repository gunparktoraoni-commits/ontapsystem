"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getFrontendApiBaseUrl } from "./apiBase";
import { showToast } from "./Toast";
import { buildImpersonationHeaders } from "@/app/lib/superadminImpersonationHandoff";
import {
  detectPortalFromPath,
  // getBizcardCreatePath,
  getBizcardDetailEditPath,
  getBizcardDetailPath,
} from "../config/portalNavigation";
import {
  ExternalLink,
  PencilLine,
  QrCode,
} from "lucide-react";
import { SectionLoader } from "./Loader";
import { toServableMediaSrc } from "../lib/portfolioDisplay";

const USER_SYNC_EVENT = "ontap:user-sync";
const API = getFrontendApiBaseUrl();

interface CardRow {
  id: string;
  serialId: string;
  name: string;
  title: string;
  status: string;
  isActive: boolean;
  portfolioUrl: string;
  previewUrl: string | null;
  editUrl: string | null;
  profileImg: string | null;
  createdAt: string | null;
  qrCode: string | null;
  urlAliasEditable?: {
    allowed: boolean;
    daysRemaining: number;
    changeAvailableAt: string;
  };
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

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "BC"
  );
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getDisplayName(
  first: unknown,
  last: unknown,
  fallback: unknown,
): string {
  const firstName = String(first ?? "").trim();
  const lastName = String(last ?? "").trim();
  const fallbackName = String(fallback ?? "").trim();
  return [firstName, lastName].filter(Boolean).join(" ").trim() || fallbackName;
}

function mapProfileToRow(profile: Record<string, unknown>): CardRow | null {
  const alias = normalizeString(profile.custom_uri);
  const name = getDisplayName(
    profile.first_name,
    profile.last_name,
    normalizeString(profile.vcard_name) ||
      normalizeString(profile.bizcard_name),
  );
  const serialId = normalizeString(profile.serial_id ?? profile.serialId);

  if (!alias && !serialId && !name) return null;

  return {
    id: String(
      profile.bizcard_id ??
        profile.user_id ??
        (alias || serialId || name || "profile"),
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
    previewUrl: null,
    editUrl: null,
    profileImg:
      normalizeString(profile.profile_url ?? profile.profile_img) || null,
    createdAt:
      normalizeString(
        (profile.vcardSetup as Record<string, unknown> | undefined)
          ?.setup_completed_at,
      ) || null,
    qrCode: null,
  };
}

export default function BizCardList() {
  const pathname = usePathname();
  const router = useRouter();
  const portal = detectPortalFromPath(pathname ?? "");
  const bizcardDetailPath = (id: string) => getBizcardDetailPath(portal, id);
  const bizcardEditPath = (id: string) => getBizcardDetailEditPath(portal, id);
  // const bizcardCreatePath = getBizcardCreatePath(portal);

  const [rows, setRows] = useState<CardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadCards = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);

    try {
      const [bizcardsRes, profileRes] = await Promise.all([
        fetch(
          `${API}/api/user/bizcards?page=1&limit=20&sortBy=created_at&sortDir=desc`,
          {
            credentials: "include",
            cache: "no-store",
            headers: buildImpersonationHeaders(),
          },
        ),
        fetch(`${API}/api/vcard/profile`, {
          credentials: "include",
          cache: "no-store",
          headers: buildImpersonationHeaders(),
        }),
      ]);

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
            normalizeString(card.bizcard_name) ||
              alias ||
              `BizCard ${index + 1}`,
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

          const urlAliasEditableRaw = card.url_alias_editable;
          let urlAliasEditable: CardRow["urlAliasEditable"] = undefined;
          if (urlAliasEditableRaw && typeof urlAliasEditableRaw === "object") {
            const editableObj = urlAliasEditableRaw as Record<string, unknown>;
            urlAliasEditable = {
              allowed: Boolean(editableObj.allowed),
              daysRemaining: Number(editableObj.daysRemaining) || 0,
              changeAvailableAt: normalizeString(editableObj.changeAvailableAt),
            };
          }

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
            previewUrl: normalizeString(card.preview_url) || null,
            editUrl: normalizeString(card.edit_url) || null,
            profileImg: normalizeString(card.profile_img) || null,
            createdAt: normalizeString(card.created_at) || null,
            qrCode: normalizeString(card.qr_code_url) || null,
            urlAliasEditable,
          };
        },
      );

      const profileRow = mapProfileToRow(
        (profilePayload?.profile ?? {}) as Record<string, unknown>,
      );
      const visibleRows =
        mappedRows.length > 0 ? mappedRows : profileRow ? [profileRow] : [];

      setRows(visibleRows);
    } catch {
      setRows([]);
    }

    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    const initialLoadTimer = window.setTimeout(() => {
      void loadCards(false);
    }, 0);

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
      if (key === "frontend_new_bizcard_toast" && event.newValue) {
        showToast(event.newValue, "success");
        window.localStorage.removeItem("frontend_new_bizcard_toast");
      }
    };

    if (typeof window !== "undefined") {
      const toastFromStorage = window.localStorage.getItem(
        "frontend_new_bizcard_toast",
      );
      if (toastFromStorage) {
        showToast(toastFromStorage, "success");
        window.localStorage.removeItem("frontend_new_bizcard_toast");
      }
    }

    window.addEventListener(USER_SYNC_EVENT, handleSync);
    window.addEventListener("focus", handleSync);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.clearTimeout(initialLoadTimer);
      window.removeEventListener(USER_SYNC_EVENT, handleSync);
      window.removeEventListener("focus", handleSync);
      window.removeEventListener("storage", handleStorage);
    };
  }, [loadCards]);

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

  const exportBizcardData = (row: CardRow) => {
    console.log("[BizCardList] export payload", {
      format: ["json", "csv", "vcard"],
      bizcard: {
        id: row.id,
        serialId: row.serialId,
        name: row.name,
        title: row.title,
        portfolioUrl: row.portfolioUrl,
        createdAt: row.createdAt,
      },
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row items-start sm:items-center justify-start lg:justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 bg-gradient-to-r from-[#478BBB] via-[#7CBCE9] to-indigo-white bg-clip-text text-transparent">BizCard Overview</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            This shows all of your BizCards.
          </p>
        </div>
      </div>

      {loading ? (
        <SectionLoader text="Loading your BizCards..." />
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-10 shadow-sm text-center">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-blue-50 text-blue-700 flex items-center justify-center mb-3">
            <QrCode className="h-6 w-6" />
          </div>
          <p className="text-sm font-semibold text-gray-700">No BizCard yet</p>
          <p className="text-xs text-gray-500 mt-1">
            Create your first independent BizCard to get started.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {rows.map((row) => {
            const qrSrc =
              row.portfolioUrl && row.portfolioUrl !== "#"
                ? buildQrCodeUrl(row.portfolioUrl)
                : "";

            return (
              <article
                key={row.id}
                className="group min-w-0 cursor-pointer rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md sm:p-6"
                onClick={() => router.push(bizcardDetailPath(row.id))}
              >
                <div className="flex min-w-0 items-start gap-4">
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                    {row.profileImg ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={toServableMediaSrc(row.profileImg)}
                        alt={row.name || "BizCard"}
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
                      className="flex h-full w-full items-center justify-center bg-linear-to-br from-slate-900 to-blue-700 text-sm font-bold text-white"
                      style={{
                        display: row.profileImg ? "none" : "flex",
                      }}
                    >
                      {getInitials(row.name || "BizCard")}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="break-words text-base font-semibold text-slate-900">
                          {row.name || "BizCard"}
                        </h3>
                        <p className="mt-0.5 break-words text-sm text-blue-700">
                          {row.title || "BizCard Profile"}
                        </p>
                      </div>
                      <span
                        className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide sm:text-[11px] ${statusStyles[row.status?.toLowerCase() ?? "active"] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}
                      >
                        {row.status || "active"}
                      </span>
                    </div>
                  </div>
                </div>

                <dl className="mt-5 grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
                  <div className="min-w-0">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Created at
                    </dt>
                    <dd className="mt-1 break-words text-sm font-medium text-slate-800">
                      {formatDateTime(row.createdAt)}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Serial ID
                    </dt>
                    <dd className="mt-1 break-all text-sm font-medium text-slate-800">
                      {row.serialId || "Not available"}
                    </dd>
                  </div>
                </dl>

                <div className="mt-4 flex min-w-0 flex-col gap-4 border-t border-slate-100 pt-4 sm:flex-row sm:items-end sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Portfolio URL
                    </p>
                    <a
                      href={row.portfolioUrl || "#"}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => event.stopPropagation()}
                      className="mt-1 block break-all text-sm font-semibold text-blue-700 hover:text-blue-800"
                    >
                      {row.portfolioUrl && row.portfolioUrl !== "#"
                        ? row.portfolioUrl
                        : "Portfolio unavailable"}
                    </a>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {qrSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={qrSrc}
                        alt={`QR Code for ${row.name || "BizCard"}`}
                        className="h-14 w-14 rounded-lg border border-slate-200 bg-white object-contain p-1"
                      />
                    ) : (
                      <span className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-400">
                        —
                      </span>
                    )}
                    <Link
                      href={bizcardEditPath(row.id)}
                      onClick={(event) => event.stopPropagation()}
                      aria-label={`Edit ${row.name || "BizCard"}`}
                      className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-blue-100 bg-blue-50 px-3 text-xs font-semibold text-blue-700 shadow-sm transition-colors hover:bg-blue-100"
                    >
                      <PencilLine className="h-4 w-4" />
                      Edit
                    </Link>
                    <a
                      href={row.portfolioUrl || "#"}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => event.stopPropagation()}
                      aria-label={`Open ${row.name || "BizCard"}`}
                      className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[#2D3A8C] px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#243080]"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Open
                    </a>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}





