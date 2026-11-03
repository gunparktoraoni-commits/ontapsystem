"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2,
  Edit2,
  ExternalLink,
  ImageIcon,
  Plus,
  RefreshCw,
  Search,
  Tag,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  PortalBadge,
  PortalEmptyState,
  PortalModal,
  PortalPageHeader,
  PortalPanel,
  PortalToastStack,
  statusToBadgeVariant,
  usePortalToasts,
} from "../../components/ui";
import { InlineLoader } from "@/app/components/Loader";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
  process.env.NEXT_PUBLIC_API_URL?.trim() ||
  "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type PromoStatus = "active" | "scheduled" | "expired" | "inactive";

type PromoType =
  | "discount"
  | "buy_one_get_one"
  | "free_shipping"
  | "fixed_amount"
  | "percentage"
  | "free_merch";

type Promo = {
  promo_id: number;
  promo_name: string;
  description: string | null;
  promo_type: PromoType;
  promo_img: string | null;
  redirect_path: string | null;
  discount_value: number | null;
  discount_percentage: number | null;
  start_date: string;
  end_date: string;
  target_groups: string[];
  tags: string[];
  minimum_order_amount: number | null;
  maximum_discount_amount: number | null;
  usage_limit: number | null;
  usage_count: number;
  per_user_limit: number;
  is_active: boolean;
  status: PromoStatus;
  days_remaining: number;
  created_at: string;
  updated_at: string | null;
};

type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  pages: number;
};

type FormValues = {
  promo_name: string;
  description: string;
  promo_type: PromoType;
  promo_img: string;
  redirect_path: string;
  discount_value: string;
  discount_percentage: string;
  start_date: string;
  end_date: string;
  target_groups: string[];
  tags: string[];
  usage_limit: string;
  per_user_limit: string;
  minimum_order_amount: string;
  maximum_discount_amount: string;
};

const EMPTY_FORM: FormValues = {
  promo_name: "",
  description: "",
  promo_type: "percentage",
  promo_img: "",
  redirect_path: "",
  discount_value: "",
  discount_percentage: "",
  start_date: "",
  end_date: "",
  target_groups: ["all_users"],
  tags: ["discount_promo"],
  usage_limit: "",
  per_user_limit: "1",
  minimum_order_amount: "",
  maximum_discount_amount: "",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const PROMO_TYPE_LABELS: Record<PromoType, string> = {
  percentage: "% Off",
  fixed_amount: "Fixed Amount Off",
  discount: "Discount",
  buy_one_get_one: "Buy One Get One",
  free_shipping: "Free Shipping",
  free_merch: "Free Merch",
};

const TARGET_GROUP_OPTIONS = [
  { value: "all_users", label: "All Users" },
  { value: "newly_registered", label: "Newly Registered" },
  { value: "new_users", label: "New Users" },
  { value: "first_time_buyers", label: "First Time Buyers" },
  { value: "frequent_buyers", label: "Frequent Buyers" },
  { value: "bulk_orders", label: "Bulk Orders" },
  { value: "subscription_basic", label: "Basic Subscribers" },
  { value: "subscription_standard", label: "Standard Subscribers" },
  { value: "subscription_premium", label: "Premium Subscribers" },
  { value: "free_trial_users", label: "Free Trial Users" },
  { value: "company_admins", label: "Company Admins" },
];

const TAG_OPTIONS = [
  { value: "discount_promo", label: "Discount Promo" },
  { value: "bogo", label: "BOGO" },
  { value: "seasonal", label: "Seasonal" },
  { value: "clearance", label: "Clearance" },
  { value: "welcome", label: "Welcome" },
];

const PROMO_IMAGE_ACCEPT = ".jpg,.jpeg,.png,image/jpeg,image/png";
const PROMO_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png"]);
const PROMO_IMAGE_EXT = /\.(jpe?g|png)$/i;

function formatDateTimeLocal(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

function formatDisplayDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-PH", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

function normalizePromo(raw: Record<string, unknown>): Promo {
  return {
    promo_id: Number(raw.promo_id),
    promo_name: String(raw.promo_name ?? ""),
    description: raw.description != null ? String(raw.description) : null,
    promo_type: (raw.promo_type as PromoType) || "percentage",
    promo_img: raw.promo_img != null ? String(raw.promo_img) : null,
    redirect_path: raw.redirect_path != null ? String(raw.redirect_path) : null,
    discount_value: raw.discount_value != null ? Number(raw.discount_value) : null,
    discount_percentage: raw.discount_percentage != null ? Number(raw.discount_percentage) : null,
    start_date: String(raw.start_date ?? ""),
    end_date: String(raw.end_date ?? ""),
    target_groups: asStringArray(raw.target_groups),
    tags: asStringArray(raw.tags),
    minimum_order_amount:
      raw.minimum_order_amount != null ? Number(raw.minimum_order_amount) : null,
    maximum_discount_amount:
      raw.maximum_discount_amount != null ? Number(raw.maximum_discount_amount) : null,
    usage_limit: raw.usage_limit != null ? Number(raw.usage_limit) : null,
    usage_count: Number(raw.usage_count ?? 0),
    per_user_limit: Number(raw.per_user_limit ?? 1),
    is_active: Boolean(raw.is_active),
    status: (raw.status as PromoStatus) || "inactive",
    days_remaining: Number(raw.days_remaining ?? 0),
    created_at: String(raw.created_at ?? ""),
    updated_at: raw.updated_at != null ? String(raw.updated_at) : null,
  };
}

function offerLabel(promo: Promo): string {
  if (promo.promo_type === "percentage" && promo.discount_percentage != null) {
    return `${promo.discount_percentage}% OFF`;
  }
  if (
    (promo.promo_type === "fixed_amount" || promo.promo_type === "discount") &&
    promo.discount_value != null
  ) {
    return `₱${Number(promo.discount_value).toLocaleString("en-PH", { maximumFractionDigits: 0 })} OFF`;
  }
  return PROMO_TYPE_LABELS[promo.promo_type] ?? promo.promo_type;
}

function promoToForm(p: Promo): FormValues {
  return {
    promo_name: p.promo_name,
    description: p.description ?? "",
    promo_type: p.promo_type,
    promo_img: p.promo_img ?? "",
    redirect_path: p.redirect_path ?? "",
    discount_value: p.discount_value !== null ? String(p.discount_value) : "",
    discount_percentage: p.discount_percentage !== null ? String(p.discount_percentage) : "",
    start_date: formatDateTimeLocal(p.start_date),
    end_date: formatDateTimeLocal(p.end_date),
    target_groups: p.target_groups.length ? [...p.target_groups] : ["all_users"],
    tags: p.tags.length ? [...p.tags] : ["discount_promo"],
    usage_limit: p.usage_limit !== null ? String(p.usage_limit) : "",
    per_user_limit: String(p.per_user_limit || 1),
    minimum_order_amount:
      p.minimum_order_amount !== null && p.minimum_order_amount !== undefined
        ? String(p.minimum_order_amount)
        : "",
    maximum_discount_amount:
      p.maximum_discount_amount !== null && p.maximum_discount_amount !== undefined
        ? String(p.maximum_discount_amount)
        : "",
  };
}

// ---------------------------------------------------------------------------
// PromoCard — table row on desktop, card on mobile
// ---------------------------------------------------------------------------
function PromoCard({
  promo,
  onEdit,
  onToggle,
  onDelete,
  toggling,
}: {
  promo: Promo;
  onEdit: (p: Promo) => void;
  onToggle: (p: Promo) => void;
  onDelete: (p: Promo) => void;
  toggling: boolean;
}) {
  const badgeVariant = statusToBadgeVariant(promo.status);
  const offer = offerLabel(promo);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:gap-4"
    >
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-[#1e3a8a] to-[#2563eb] flex items-center justify-center">
        {promo.promo_img ? (
          <img src={promo.promo_img} alt={promo.promo_name} className="h-full w-full object-cover" />
        ) : (
          <Tag className="h-6 w-6 text-white/60" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-0.5">
          <p className="text-sm font-bold text-gray-900 truncate">{promo.promo_name}</p>
          <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-700 ring-1 ring-amber-200/80">
            {offer}
          </span>
          <PortalBadge variant={badgeVariant}>{promo.status}</PortalBadge>
        </div>
        {promo.description && (
          <p className="text-xs text-gray-500 line-clamp-1 mb-1">{promo.description}</p>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-gray-400">
          <span>
            {formatDisplayDate(promo.start_date)} → {formatDisplayDate(promo.end_date)}
            {promo.days_remaining > 0 && promo.status === "active"
              ? ` · ${promo.days_remaining}d left`
              : ""}
          </span>
          <span>
            Used: {promo.usage_count}
            {promo.usage_limit !== null ? ` / ${promo.usage_limit}` : ""}
          </span>
          {promo.target_groups.length > 0 && (
            <span>
              Audience:{" "}
              {promo.target_groups
                .slice(0, 2)
                .map(
                  (g) =>
                    TARGET_GROUP_OPTIONS.find((o) => o.value === g)?.label ?? g.replace(/_/g, " ")
                )
                .join(", ")}
              {promo.target_groups.length > 2 ? ` +${promo.target_groups.length - 2}` : ""}
            </span>
          )}
          {promo.redirect_path && (
            <span className="flex items-center gap-1 text-sky-500">
              <ExternalLink className="h-3 w-3" />
              {promo.redirect_path}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => onToggle(promo)}
          disabled={toggling}
          aria-label={promo.is_active ? "Deactivate promo" : "Activate promo"}
          className="h-8 w-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors disabled:opacity-40"
        >
          {toggling ? (
            <InlineLoader />
          ) : promo.is_active ? (
            <ToggleRight className="h-4 w-4 text-emerald-500" />
          ) : (
            <ToggleLeft className="h-4 w-4" />
          )}
        </button>
        <button
          type="button"
          onClick={() => onEdit(promo)}
          aria-label="Edit promo"
          className="h-8 w-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-sky-50 hover:text-sky-600 transition-colors"
        >
          <Edit2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(promo)}
          aria-label="Delete promo"
          className="h-8 w-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// PromoForm — create / edit form inside the modal
// ---------------------------------------------------------------------------
function PromoForm({
  values,
  onChange,
  onSubmit,
  submitting,
  onNotice,
}: {
  values: FormValues;
  onChange: (patch: Partial<FormValues>) => void;
  onSubmit: () => void;
  submitting: boolean;
  isEdit: boolean;
  onNotice: (type: "success" | "error", message: string) => void;
}) {
  const needsDiscountValue = values.promo_type === "fixed_amount" || values.promo_type === "discount";
  const needsDiscountPct = values.promo_type === "percentage";
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const toggleArrayItem = (field: "target_groups" | "tags", val: string) => {
    const current = values[field] as string[];
    onChange({
      [field]: current.includes(val) ? current.filter((v) => v !== val) : [...current, val],
    });
  };

  const uploadPromoImage = async (file: File) => {
    const mimeOk = PROMO_IMAGE_MIME_TYPES.has(file.type);
    const nameOk = PROMO_IMAGE_EXT.test(file.name);
    if (!mimeOk && !nameOk) {
      onNotice("error", "Only JPG and PNG images are allowed.");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("context", "newsletter");
      const response = await fetch(`${API_BASE}/api/media/upload`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as {
        url?: string;
        error?: string;
      } | null;
      const url = typeof payload?.url === "string" ? payload.url : "";
      if (!response.ok || !url) {
        onNotice("error", payload?.error || "Failed to upload promo image.");
        return;
      }
      onChange({ promo_img: url });
    } catch {
      onNotice("error", "Failed to upload promo image.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="space-y-6"
    >
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-bold text-gray-900">Campaign basics</h3>
          <p className="text-xs text-gray-500">Name the deal and set the offer customers will see.</p>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Promo Name *</label>
          <input
            type="text"
            value={values.promo_name}
            onChange={(e) => onChange({ promo_name: e.target.value })}
            required
            minLength={2}
            maxLength={255}
            placeholder="e.g. Summer Sale 20% Off"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Marketing copy</label>
          <textarea
            value={values.description}
            onChange={(e) => onChange({ description: e.target.value })}
            rows={2}
            maxLength={1000}
            placeholder="Short description shown on the promo slide"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Promo Type *</label>
            <select
              value={values.promo_type}
              onChange={(e) => onChange({ promo_type: e.target.value as PromoType })}
              required
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {Object.entries(PROMO_TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          {needsDiscountPct && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Discount % (1–100) *
              </label>
              <input
                type="number"
                min={1}
                max={100}
                value={values.discount_percentage}
                onChange={(e) => onChange({ discount_percentage: e.target.value })}
                placeholder="e.g. 20"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          )}
          {needsDiscountValue && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Discount Amount (₱) *
              </label>
              <input
                type="number"
                min={0.01}
                step={0.01}
                value={values.discount_value}
                onChange={(e) => onChange({ discount_value: e.target.value })}
                placeholder="e.g. 100.00"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3 border-t border-gray-100 pt-5">
        <div>
          <h3 className="text-sm font-bold text-gray-900">Creative & destination</h3>
          <p className="text-xs text-gray-500">Banner image and where the slide sends shoppers.</p>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">
            <ImageIcon className="inline h-3 w-3 mr-1" />
            Promo Image
          </label>
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={uploading || submitting}
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <Upload className={`h-4 w-4 ${uploading ? "animate-pulse" : ""}`} />
                {uploading ? "Uploading…" : values.promo_img ? "Replace image" : "Upload image"}
              </button>
              {values.promo_img ? (
                <button
                  type="button"
                  disabled={uploading || submitting}
                  onClick={() => onChange({ promo_img: "" })}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-500 hover:text-rose-600 disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                  Remove
                </button>
              ) : null}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={PROMO_IMAGE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadPromoImage(file);
              }}
            />
            {values.promo_img ? (
              <div className="relative mt-3 h-24 w-full overflow-hidden rounded-xl border border-gray-100 bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={values.promo_img}
                  alt="Promo preview"
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>
            ) : (
              <p className="mt-2 text-[10px] text-gray-400">
                Optional — JPG or PNG only. Displayed in the sidebar promo slider.
              </p>
            )}
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">
            <ExternalLink className="inline h-3 w-3 mr-1" />
            Redirect Path
          </label>
          <input
            type="text"
            value={values.redirect_path}
            onChange={(e) => onChange({ redirect_path: e.target.value })}
            maxLength={512}
            placeholder="/admin/emarket or /user/emarket"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </section>

      <section className="space-y-3 border-t border-gray-100 pt-5">
        <div>
          <h3 className="text-sm font-bold text-gray-900">Schedule</h3>
          <p className="text-xs text-gray-500">When this campaign goes live and when it ends.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Start Date *</label>
            <input
              type="datetime-local"
              value={values.start_date}
              onChange={(e) => onChange({ start_date: e.target.value })}
              required
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">End Date *</label>
            <input
              type="datetime-local"
              value={values.end_date}
              onChange={(e) => onChange({ end_date: e.target.value })}
              required
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>
      </section>

      <section className="space-y-3 border-t border-gray-100 pt-5">
        <div>
          <h3 className="text-sm font-bold text-gray-900">Audience & tags</h3>
          <p className="text-xs text-gray-500">Who sees this deal and how it is categorized.</p>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-2">Target Groups *</label>
          <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto rounded-lg border border-gray-100 p-2 bg-gray-50/50">
            {TARGET_GROUP_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-2 cursor-pointer text-xs text-gray-700 hover:text-gray-900"
              >
                <input
                  type="checkbox"
                  checked={values.target_groups.includes(opt.value)}
                  onChange={() => toggleArrayItem("target_groups", opt.value)}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary/30"
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-2">Tags *</label>
          <div className="flex flex-wrap gap-2">
            {TAG_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`inline-flex items-center gap-1.5 cursor-pointer rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  values.tags.includes(opt.value)
                    ? "border-primary/40 bg-primary/5 text-primary font-semibold"
                    : "border-gray-200 text-gray-600 hover:border-gray-300"
                }`}
              >
                <input
                  type="checkbox"
                  checked={values.tags.includes(opt.value)}
                  onChange={() => toggleArrayItem("tags", opt.value)}
                  className="sr-only"
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-3 border-t border-gray-100 pt-5">
        <div>
          <h3 className="text-sm font-bold text-gray-900">Rules & limits</h3>
          <p className="text-xs text-gray-500">Usage caps and order thresholds for the promo.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Usage Limit</label>
            <input
              type="number"
              min={1}
              value={values.usage_limit}
              onChange={(e) => onChange({ usage_limit: e.target.value })}
              placeholder="Unlimited if empty"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Per User Limit *</label>
            <input
              type="number"
              min={1}
              value={values.per_user_limit}
              onChange={(e) => onChange({ per_user_limit: e.target.value })}
              required
              placeholder="1"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              Minimum Order (₱)
            </label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={values.minimum_order_amount}
              onChange={(e) => onChange({ minimum_order_amount: e.target.value })}
              placeholder="Optional"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              Max Discount Cap (₱)
            </label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={values.maximum_discount_amount}
              onChange={(e) => onChange({ maximum_discount_amount: e.target.value })}
              placeholder="Optional (for % promos)"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>
      </section>

      <button type="submit" className="hidden" disabled={submitting} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------
export default function PromosManagementPanel() {
  const { toasts, push: pushToast, dismiss: removeToast } = usePortalToasts();

  // List state
  const [promos, setPromos] = useState<Promo[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>({ page: 1, limit: 20, total: 0, pages: 1 });
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"" | "active" | "inactive">("");
  const [page, setPage] = useState(1);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Promo | null>(null);
  const [formValues, setFormValues] = useState<FormValues>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  // Toggle / delete state
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Promo | null>(null);
  const [deleting, setDeleting] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);

  // -------------------------------------------------------------------------
  // Fetch promos
  // -------------------------------------------------------------------------
  const fetchPromos = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (search.trim()) params.set("search", search.trim());
      if (filterStatus === "active") params.set("is_active", "true");
      if (filterStatus === "inactive") params.set("is_active", "false");

      const res = await fetch(`${API_BASE}/api/superadmin/promos?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as {
        success: boolean;
        data: { promos: Array<Record<string, unknown>>; pagination: PaginationMeta };
      };
      if (!json.success) throw new Error("API error");
      setPromos((json.data.promos ?? []).map((row) => normalizePromo(row)));
      setPagination(json.data.pagination);
    } catch {
      pushToast("error", "Failed to load promos. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [page, search, filterStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void fetchPromos(); }, [fetchPromos]);

  // Debounce search
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = (val: string) => {
    setSearch(val);
    setPage(1);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => void fetchPromos(), 400);
  };

  // -------------------------------------------------------------------------
  // Open create / edit modal
  // -------------------------------------------------------------------------
  const openCreate = () => {
    setEditTarget(null);
    setFormValues(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (p: Promo) => {
    setEditTarget(p);
    setFormValues(promoToForm(p));
    setModalOpen(true);
  };

  const closeModal = () => {
    if (submitting) return;
    setModalOpen(false);
    setEditTarget(null);
  };

  // -------------------------------------------------------------------------
  // Submit create / update
  // -------------------------------------------------------------------------
  const handleSubmit = async () => {
    if (!formValues.promo_name.trim() || formValues.promo_name.trim().length < 2) {
      pushToast("error", "Promo name must be at least 2 characters.");
      return;
    }
    if (formValues.target_groups.length === 0) {
      pushToast("error", "Select at least one target group.");
      return;
    }
    if (formValues.tags.length === 0) {
      pushToast("error", "Select at least one tag.");
      return;
    }
    if (!formValues.start_date || !formValues.end_date) {
      pushToast("error", "Start date and end date are required.");
      return;
    }
    if (new Date(formValues.start_date) >= new Date(formValues.end_date)) {
      pushToast("error", "Start date must be before end date.");
      return;
    }
    if (formValues.promo_type === "percentage") {
      const pct = Number(formValues.discount_percentage);
      if (!formValues.discount_percentage || !Number.isFinite(pct) || pct < 1 || pct > 100) {
        pushToast("error", "Enter a discount percentage between 1 and 100.");
        return;
      }
    }
    if (formValues.promo_type === "fixed_amount" || formValues.promo_type === "discount") {
      const amount = Number(formValues.discount_value);
      if (!formValues.discount_value || !Number.isFinite(amount) || amount <= 0) {
        pushToast("error", "Enter a valid discount amount greater than 0.");
        return;
      }
    }

    const body: Record<string, unknown> = {
      promo_name: formValues.promo_name.trim(),
      description: formValues.description.trim() || undefined,
      promo_type: formValues.promo_type,
      promo_img: formValues.promo_img.trim() || undefined,
      redirect_path: formValues.redirect_path.trim() || undefined,
      start_date: new Date(formValues.start_date).toISOString(),
      end_date: new Date(formValues.end_date).toISOString(),
      target_groups: formValues.target_groups,
      tags: formValues.tags,
      per_user_limit: Number(formValues.per_user_limit) || 1,
    };

    if (formValues.usage_limit) body.usage_limit = Number(formValues.usage_limit);
    if (formValues.minimum_order_amount) {
      body.minimum_order_amount = Number(formValues.minimum_order_amount);
    }
    if (formValues.maximum_discount_amount) {
      body.maximum_discount_amount = Number(formValues.maximum_discount_amount);
    }

    if (formValues.promo_type === "percentage" && formValues.discount_percentage) {
      body.discount_percentage = Number(formValues.discount_percentage);
    }
    if (
      (formValues.promo_type === "fixed_amount" || formValues.promo_type === "discount") &&
      formValues.discount_value
    ) {
      body.discount_value = Number(formValues.discount_value);
    }

    setSubmitting(true);
    try {
      const url = editTarget
        ? `${API_BASE}/api/superadmin/promos/${editTarget.promo_id}`
        : `${API_BASE}/api/superadmin/promos`;
      const method = editTarget ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json() as { success: boolean; data?: Record<string, unknown> };
      if (!res.ok || !json.success) throw new Error("API error");

      pushToast("success", editTarget ? "Promo updated successfully." : "Promo created successfully.");
      closeModal();
      void fetchPromos();
    } catch {
      pushToast("error", editTarget ? "Failed to update promo." : "Failed to create promo.");
    } finally {
      setSubmitting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Toggle active
  // -------------------------------------------------------------------------
  const handleToggle = async (p: Promo) => {
    setTogglingId(p.promo_id);
    try {
      const res = await fetch(`${API_BASE}/api/superadmin/promos/${p.promo_id}/toggle`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !p.is_active }),
      });
      const json = await res.json() as { success: boolean };
      if (!res.ok || !json.success) throw new Error("API error");
      pushToast("success", p.is_active ? "Promo deactivated." : "Promo activated.");
      void fetchPromos();
    } catch {
      pushToast("error", "Failed to toggle promo status.");
    } finally {
      setTogglingId(null);
    }
  };

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------
  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`${API_BASE}/api/superadmin/promos/${deleteTarget.promo_id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const json = await res.json() as { success: boolean };
      if (!res.ok || !json.success) throw new Error("API error");
      pushToast("success", "Promo deleted.");
      setDeleteTarget(null);
      void fetchPromos();
    } catch {
      pushToast("error", "Failed to delete promo.");
    } finally {
      setDeleting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Pagination
  // -------------------------------------------------------------------------
  const pageNumbers = useMemo<number[]>(() => {
    const nums: number[] = [];
    for (let i = 1; i <= pagination.pages; i++) nums.push(i);
    return nums;
  }, [pagination.pages]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PortalToastStack toasts={toasts} onDismiss={removeToast} />

      {/* Header */}
      <PortalPageHeader
        title="Promos & Deals"
        subtitle="Launch campaigns, set audiences, and control offers shown in the marketplace promo slider."
        actions={
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Promo
          </button>
        }
      />

      {/* Toolbar */}
      <PortalPanel padding="sm">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search promos..."
              className="w-full rounded-lg border border-gray-200 pl-9 pr-4 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            {search && (
              <button
                type="button"
                onClick={() => handleSearchChange("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value as "" | "active" | "inactive"); setPage(1); }}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <button
              type="button"
              onClick={() => void fetchPromos()}
              disabled={loading}
              aria-label="Refresh"
              className="h-9 w-9 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors disabled:opacity-40"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </PortalPanel>

      {/* Promo list */}
      {loading && promos.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <InlineLoader />
        </div>
      ) : promos.length === 0 ? (
        <PortalEmptyState
          title="No promos found"
          description="Create your first promotion to have it appear in the sidebar promo slider."
          icon={Tag}
          action={
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Create First Promo
            </button>
          }
        />
      ) : (
        <AnimatePresence mode="popLayout">
          <div className="space-y-3">
            {promos.map((p) => (
              <PromoCard
                key={p.promo_id}
                promo={p}
                onEdit={openEdit}
                onToggle={handleToggle}
                onDelete={setDeleteTarget}
                toggling={togglingId === p.promo_id}
              />
            ))}
          </div>
        </AnimatePresence>
      )}

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="flex items-center justify-center gap-1.5 pt-2">
          {pageNumbers.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setPage(n)}
              className={`h-8 min-w-[2rem] rounded-lg px-2 text-sm font-medium transition-colors ${
                n === page
                  ? "bg-primary text-white shadow-sm"
                  : "border border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      <PortalModal
        open={modalOpen}
        onClose={closeModal}
        title={editTarget ? "Edit Promo" : "New Promo"}
        description={
          editTarget
            ? `Update campaign details for "${editTarget.promo_name}".`
            : "Set up a marketing campaign with offer, schedule, audience, and limits."
        }
        size="lg"
        preventClose={submitting}
        footer={
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={closeModal}
              disabled={submitting}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary/90 transition-colors disabled:opacity-60"
            >
              {submitting ? <InlineLoader /> : <CheckCircle2 className="h-4 w-4" />}
              {submitting ? "Saving..." : editTarget ? "Save Changes" : "Create Promo"}
            </button>
          </div>
        }
      >
        <PromoForm
          values={formValues}
          onChange={(patch) => setFormValues((prev) => ({ ...prev, ...patch }))}
          onSubmit={handleSubmit}
          submitting={submitting}
          isEdit={!!editTarget}
          onNotice={pushToast}
        />
      </PortalModal>

      {/* Delete Confirm Modal */}
      <PortalModal
        open={!!deleteTarget}
        onClose={() => !deleting && setDeleteTarget(null)}
        title="Delete Promo"
        description={deleteTarget ? `Are you sure you want to permanently delete "${deleteTarget.promo_name}"? This cannot be undone.` : ""}
        size="sm"
        preventClose={deleting}
        footer={
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleDeleteConfirm()}
              disabled={deleting}
              className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2 text-sm font-semibold text-white hover:bg-rose-700 transition-colors disabled:opacity-60"
            >
              {deleting ? <InlineLoader /> : <Trash2 className="h-4 w-4" />}
              {deleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        }
      >
        <p className="text-sm text-gray-500">This promo will be removed from the sidebar slider immediately.</p>
      </PortalModal>
    </div>
  );
}
