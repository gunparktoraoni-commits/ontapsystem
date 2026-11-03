"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ExternalLink, Mail, UserRound } from "lucide-react";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import { toServableMediaSrc } from "@/app/lib/portfolioDisplay";
import {
  PortalBadge,
  PortalModal,
  statusToBadgeVariant,
} from "../../components/ui";

function resolveAffiliateAvatar(raw: string | null | undefined): string | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return null;
  return toServableMediaSrc(value) || null;
}

export type AffiliateDetailRange =
  | "this_month"
  | "last_3_months"
  | "last_6_months"
  | "last_12_months";

type AffiliateDetailPayload = {
  profile: {
    affiliate_id: number;
    name: string;
    email: string;
    serial_id: string | null;
    subscription: string;
    profile_image: string | null;
    portfolio_url: string | null;
    affiliate_code: string;
    commission_rate: number;
    date_started: string;
    is_restricted: boolean;
  };
  tags: string[];
  stats: {
    total_referrals: number;
    successful_referrals: number;
    total_orders: number;
    total_commission: number;
    paid_commissions: number;
    pending_commissions: number;
    conversion_rate: number;
    withdrawal_total: number;
    pending_withdrawals: number;
  };
  referral_orders: Array<{
    commission_id: string;
    order_id: string;
    order_number: string;
    date: string;
    status: string;
    order_total: number;
    commission_amount: number;
    commission_status: string;
    commission_rate: number;
    referred_user: string;
    referred_email: string;
    items_summary: string;
    payment_method: string | null;
  }>;
  order_chart: Array<{
    period: string;
    label: string;
    order_count: number;
    revenue: number;
  }>;
  commissions: Array<{
    commission_id: string;
    order_number: string | null;
    amount: number;
    status: string;
    created_at: string;
    paid_at: string | null;
  }>;
  withdrawals: Array<{
    id: string;
    amount: number;
    status: string;
    payment_method: string | null;
    reference_number: string | null;
    requested_at: string;
    processed_at: string | null;
  }>;
};

type AffiliateDetailModalProps = {
  affiliateId: number | null;
  open: boolean;
  onClose: () => void;
};

const RANGE_OPTIONS: Array<{ id: AffiliateDetailRange; label: string }> = [
  { id: "this_month", label: "This Month" },
  { id: "last_3_months", label: "Last 3 months" },
  { id: "last_6_months", label: "Last 6 months" },
  { id: "last_12_months", label: "Last 12 months" },
];

const money = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "PHP" }).format(value);

const formatDate = (value: string | null | undefined) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

function tagVariant(tag: string): "success" | "warning" | "danger" | "info" | "primary" {
  if (tag.includes("Needs Attention")) return "danger";
  if (tag.includes("Rising")) return "info";
  if (tag.includes("Biggest") || tag.includes("High Earner")) return "success";
  if (tag.includes("Top Referrer")) return "primary";
  return "warning";
}

export default function AffiliateDetailModal({
  affiliateId,
  open,
  onClose,
}: AffiliateDetailModalProps) {
  const API = getFrontendApiBaseUrl();
  const [range, setRange] = useState<AffiliateDetailRange>("last_6_months");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<AffiliateDetailPayload | null>(null);
  const [section, setSection] = useState<"orders" | "payouts">("orders");
  const [avatarFailed, setAvatarFailed] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!affiliateId || !open) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API}/api/superadmin/affiliates/${affiliateId}?range=${encodeURIComponent(range)}`,
        { credentials: "include", cache: "no-store" },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success || !payload?.data) {
        throw new Error(payload?.error?.message ?? "Failed to load affiliate details.");
      }
      const data = payload.data as AffiliateDetailPayload;
      setDetail({
        ...data,
        profile: {
          ...data.profile,
          profile_image: resolveAffiliateAvatar(data.profile.profile_image),
        },
      });
    } catch (err) {
      setDetail(null);
      setError(err instanceof Error ? err.message : "Failed to load affiliate details.");
    } finally {
      setLoading(false);
    }
  }, [API, affiliateId, open, range]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    if (!open) {
      setSection("orders");
      setRange("last_6_months");
      setDetail(null);
      setError(null);
      setAvatarFailed(false);
    }
  }, [open]);

  const initials = useMemo(() => {
    const name = detail?.profile.name ?? "";
    return name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "A";
  }, [detail?.profile.name]);

  return (
    <PortalModal
      open={open}
      onClose={onClose}
      title={detail?.profile.name ?? "Affiliate details"}
      description="Performance, referral orders, commissions, and withdrawal history."
      size="xl"
    >
      {loading && !detail ? (
        <div className="flex min-h-[280px] items-center justify-center text-sm text-gray-500">
          Loading affiliate profile…
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : detail ? (
        <div className="space-y-5">
          <div className="flex flex-col gap-4 rounded-2xl border border-gray-100 bg-gradient-to-br from-slate-50 to-white p-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-gray-200 bg-primary/10 text-base font-bold text-primary">
                {detail.profile.profile_image && !avatarFailed ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={detail.profile.profile_image}
                    alt={detail.profile.name}
                    className="h-full w-full object-cover"
                    onError={() => setAvatarFailed(true)}
                  />
                ) : (
                  initials
                )}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-lg font-bold text-gray-900">{detail.profile.name}</h3>
                  {detail.profile.is_restricted ? (
                    <PortalBadge variant="danger">Restricted</PortalBadge>
                  ) : (
                    <PortalBadge variant="success">Active</PortalBadge>
                  )}
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-500">
                  <Mail className="h-3.5 w-3.5" />
                  {detail.profile.email}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {detail.tags.length ? (
                    detail.tags.map((tag) => (
                      <PortalBadge key={tag} variant={tagVariant(tag)} className="normal-case tracking-normal">
                        {tag}
                      </PortalBadge>
                    ))
                  ) : (
                    <span className="text-xs text-gray-400">No performance tags yet</span>
                  )}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 sm:grid-cols-4">
                  <div>
                    <dt className="font-semibold text-gray-400">Serial ID</dt>
                    <dd className="font-medium text-gray-800">{detail.profile.serial_id ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-gray-400">Subscription</dt>
                    <dd className="font-medium capitalize text-gray-800">{detail.profile.subscription}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-gray-400">Affiliate code</dt>
                    <dd className="font-medium text-gray-800">{detail.profile.affiliate_code}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-gray-400">Commission</dt>
                    <dd className="font-medium text-gray-800">{detail.profile.commission_rate}%</dd>
                  </div>
                </dl>
              </div>
            </div>
            {detail.profile.portfolio_url ? (
              <a
                href={detail.profile.portfolio_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 self-start rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-primary hover:bg-gray-50"
              >
                <ExternalLink className="h-4 w-4" />
                Open portfolio
              </a>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "Successful referrals", value: String(detail.stats.successful_referrals) },
              { label: "Referred orders", value: String(detail.stats.total_orders) },
              { label: "Total commission", value: money(detail.stats.total_commission) },
              { label: "Pending payout", value: money(detail.stats.pending_commissions) },
            ].map((card) => (
              <div key={card.label} className="rounded-2xl border border-gray-100 bg-white px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{card.label}</p>
                <p className="mt-1 text-base font-bold text-gray-900">{card.value}</p>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-4">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="text-sm font-bold text-gray-900">Referred orders</h4>
                <p className="text-xs text-gray-500">Monthly volume of orders attributed to this affiliate</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {RANGE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setRange(option.id)}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                      range === option.id
                        ? "bg-primary text-white"
                        : "border border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={detail.order_chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="affiliateOrdersGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4785B8" stopOpacity={1} />
                      <stop offset="100%" stopColor="#2A4792" stopOpacity={0.9} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 6" vertical={false} stroke="rgba(42,71,146,0.12)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "#64748b", fontWeight: 600 }}
                    axisLine={{ stroke: "rgba(59,87,163,0.2)" }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    width={32}
                    tick={{ fontSize: 10, fill: "#475569" }}
                    axisLine={{ stroke: "rgba(59,87,163,0.2)" }}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(59,87,163,0.06)", radius: 8 }}
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid #e5e7eb",
                      boxShadow: "0 8px 20px rgba(15,23,42,0.08)",
                    }}
                    formatter={(value, name) => {
                      if (name === "order_count") return [value, "Orders"];
                      if (name === "revenue") return [money(Number(value ?? 0)), "Revenue"];
                      return [value, name];
                    }}
                  />
                  <Bar dataKey="order_count" fill="url(#affiliateOrdersGrad)" radius={[8, 8, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="flex gap-2 border-b border-gray-100 pb-2">
            <button
              type="button"
              onClick={() => setSection("orders")}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                section === "orders" ? "bg-primary/10 text-primary" : "text-gray-500 hover:bg-gray-50"
              }`}
            >
              Referral history
            </button>
            <button
              type="button"
              onClick={() => setSection("payouts")}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                section === "payouts" ? "bg-primary/10 text-primary" : "text-gray-500 hover:bg-gray-50"
              }`}
            >
              Payouts & withdrawals
            </button>
          </div>

          {section === "orders" ? (
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {detail.referral_orders.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
                  No referred orders in this period.
                </div>
              ) : (
                detail.referral_orders.map((order) => (
                  <div
                    key={order.commission_id}
                    className="rounded-2xl border border-gray-100 bg-white px-4 py-3 transition hover:border-primary/20 hover:bg-slate-50/60"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-gray-900">{order.order_number}</p>
                        <p className="text-xs text-gray-500">
                          {formatDate(order.date)} · {order.items_summary}
                        </p>
                      </div>
                      <PortalBadge variant={statusToBadgeVariant(order.status)}>
                        {order.status}
                      </PortalBadge>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-600 sm:grid-cols-4">
                      <div>
                        <p className="text-gray-400">Referred</p>
                        <p className="font-semibold text-gray-800">{order.referred_user}</p>
                      </div>
                      <div>
                        <p className="text-gray-400">Order total</p>
                        <p className="font-semibold text-gray-800">{money(order.order_total)}</p>
                      </div>
                      <div>
                        <p className="text-gray-400">Commission</p>
                        <p className="font-semibold text-gray-800">
                          {money(order.commission_amount)} ({order.commission_rate}%)
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-400">Commission status</p>
                        <p className="font-semibold capitalize text-gray-800">{order.commission_status}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <h4 className="mb-2 text-sm font-bold text-gray-900">Commissions received</h4>
                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {detail.commissions.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-gray-200 px-3 py-6 text-center text-xs text-gray-500">
                      No commissions yet.
                    </p>
                  ) : (
                    detail.commissions.map((row) => (
                      <div key={row.commission_id} className="rounded-xl border border-gray-100 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-gray-900">{money(row.amount)}</p>
                          <PortalBadge variant={statusToBadgeVariant(row.status)}>{row.status}</PortalBadge>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">
                          {row.order_number ?? "Order"} · {formatDate(row.created_at)}
                          {row.paid_at ? ` · Paid ${formatDate(row.paid_at)}` : ""}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div>
                <h4 className="mb-2 text-sm font-bold text-gray-900">Withdraw activity</h4>
                <div className="mb-2 rounded-xl border border-gray-100 bg-slate-50 px-3 py-2 text-xs text-gray-600">
                  Completed withdrawals:{" "}
                  <span className="font-semibold text-gray-900">{money(detail.stats.withdrawal_total)}</span>
                  {" · "}
                  Pending:{" "}
                  <span className="font-semibold text-gray-900">{money(detail.stats.pending_withdrawals)}</span>
                </div>
                <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                  {detail.withdrawals.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-gray-200 px-3 py-6 text-center text-xs text-gray-500">
                      No withdrawal requests yet.
                    </p>
                  ) : (
                    detail.withdrawals.map((row) => (
                      <div key={row.id} className="rounded-xl border border-gray-100 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-gray-900">{money(row.amount)}</p>
                          <PortalBadge variant={statusToBadgeVariant(row.status)}>{row.status}</PortalBadge>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">
                          {row.payment_method ?? "Method n/a"} · Requested {formatDate(row.requested_at)}
                          {row.processed_at ? ` · Processed ${formatDate(row.processed_at)}` : ""}
                        </p>
                        {row.reference_number ? (
                          <p className="mt-0.5 text-[11px] text-gray-400">Ref: {row.reference_number}</p>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <p className="flex items-center gap-2 text-xs text-gray-400">
              <UserRound className="h-3.5 w-3.5 animate-pulse" />
              Refreshing…
            </p>
          ) : null}
        </div>
      ) : null}
    </PortalModal>
  );
}
