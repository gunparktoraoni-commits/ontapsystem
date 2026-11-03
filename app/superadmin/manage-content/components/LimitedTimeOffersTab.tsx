"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  PortalBadge,
  PortalEmptyState,
  PortalModal,
  PortalPanel,
} from "../../components/ui";
import {
  extractKeyList,
  fmtDate,
  manageContentRequest,
  normalizeList,
  safeNumber,
  safeString,
  toDateInput,
  toDateTimeLocal,
} from "./manage-content-shared";

type PromoStatus = "active" | "paused" | "expired" | "scheduled";

type Promo = {
  id: number;
  name: string;
  description: string;
  promo_type: string;
  startDate: string;
  endDate: string;
  status: PromoStatus;
  target_groups: string[];
};

const OFFER_TYPES = [
  { value: "buy_one_get_one", label: "Buy 1 Take 1" },
  { value: "percentage", label: "Discount (%)" },
  { value: "fixed_amount", label: "Discount (Fixed)" },
  { value: "free_merch", label: "Free Merch" },
  { value: "free_shipping", label: "Free Shipping" },
  { value: "discount", label: "General Discount" },
];

type TargetGroupOption = { key: string; label: string };

type PromoForm = {
  name: string;
  description: string;
  promo_type: string;
  startMode: "now" | "custom";
  endMode: "now" | "custom";
  startDate: string;
  endDate: string;
  target_groups: string[];
};

const EMPTY_FORM: PromoForm = {
  name: "",
  description: "",
  promo_type: "percentage",
  startMode: "now",
  endMode: "custom",
  startDate: "",
  endDate: "",
  target_groups: ["all_users"],
};

function derivePromoStatus(
  rawStatus: unknown,
  isActive: unknown,
  endDate: string
): PromoStatus {
  const status = safeString(rawStatus).toLowerCase();
  if (status === "active" || status === "paused" || status === "expired" || status === "scheduled") {
    return status as PromoStatus;
  }
  const now = Date.now();
  if (endDate) {
    const endTime = new Date(endDate).getTime();
    if (!Number.isNaN(endTime) && endTime < now) return "expired";
  }
  if (typeof isActive === "boolean") return isActive ? "active" : "paused";
  return "paused";
}

function mapApiPromo(raw: Record<string, unknown>): Promo | null {
  const id = safeNumber(raw.promo_id ?? raw.promoId ?? raw.id);
  if (!id) return null;
  const startDate = toDateInput(raw.start_date ?? raw.starts_at ?? raw.startDate);
  const endDate = toDateInput(raw.end_date ?? raw.expires_at ?? raw.endDate);
  return {
    id,
    name: safeString(raw.promo_name ?? raw.name) || "Untitled Offer",
    description: safeString(raw.description),
    promo_type: safeString(raw.promo_type ?? raw.promoType) || "discount",
    startDate,
    endDate,
    status: derivePromoStatus(raw.status, raw.is_active ?? raw.isActive, endDate),
    target_groups: normalizeList(raw.target_groups),
  };
}

type LimitedTimeOffersTabProps = {
  onNotice: (type: "success" | "error", message: string) => void;
};

export default function LimitedTimeOffersTab({ onNotice }: LimitedTimeOffersTabProps) {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [targetGroups, setTargetGroups] = useState<TargetGroupOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ mode: "add" | "edit"; promo?: Promo } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Promo | null>(null);
  const [form, setForm] = useState<PromoForm>(EMPTY_FORM);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [promosRes, metaRes] = await Promise.all([
        manageContentRequest("/api/superadmin/promos?limit=100"),
        manageContentRequest("/api/superadmin/promos/target-groups"),
      ]);
      const promosPayload = await promosRes.json().catch(() => null);
      const metaPayload = await metaRes.json().catch(() => null);
      const raw =
        promosPayload?.data?.promos ??
        promosPayload?.data?.items ??
        promosPayload?.promos ??
        [];
      const mapped = Array.isArray(raw)
        ? raw.map((item: Record<string, unknown>) => mapApiPromo(item)).filter(Boolean)
        : [];
      setPromos(mapped as Promo[]);
      const groups = extractKeyList(metaPayload?.data?.target_groups);
      if (groups.length) {
        const labels = metaPayload?.data?.target_groups as Array<{ key: string; label: string }>;
        setTargetGroups(
          Array.isArray(labels)
            ? labels.map((g) => ({ key: g.key, label: g.label }))
            : groups.map((key) => ({ key, label: key.replace(/_/g, " ") }))
        );
      }
    } catch {
      onNotice("error", "Failed to load offers.");
    } finally {
      setLoading(false);
    }
  }, [onNotice]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const activePromos = promos.filter((p) => p.status === "active" || p.status === "scheduled");

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setModal({ mode: "add" });
  };

  const openEdit = (promo: Promo) => {
    setForm({
      name: promo.name,
      description: promo.description,
      promo_type: promo.promo_type,
      startMode: "custom",
      endMode: "custom",
      startDate: toDateTimeLocal(promo.startDate),
      endDate: toDateTimeLocal(promo.endDate),
      target_groups: promo.target_groups.length ? promo.target_groups : ["all_users"],
    });
    setModal({ mode: "edit", promo });
  };

  const toggleGroup = (key: string) => {
    setForm((f) => ({
      ...f,
      target_groups: f.target_groups.includes(key)
        ? f.target_groups.filter((g) => g !== key)
        : [...f.target_groups, key],
    }));
  };

  const resolveDate = (mode: "now" | "custom", value: string) => {
    if (mode === "now") return new Date();
    return value ? new Date(value) : new Date();
  };

  const handleSave = async () => {
    if (!modal || !form.name.trim()) return;
    const start = resolveDate(form.startMode, form.startDate);
    const end = resolveDate(form.endMode, form.endDate);
    if (end < start) {
      onNotice("error", "End date must be after start date.");
      return;
    }
    const payload = {
      promo_name: form.name.trim(),
      description: form.description.trim() || undefined,
      promo_type: form.promo_type,
      start_date: start.toISOString(),
      end_date: end.toISOString(),
      target_groups: form.target_groups.length ? form.target_groups : ["all_users"],
      tags: ["discount_promo"],
    };

    try {
      const response =
        modal.mode === "add"
          ? await manageContentRequest("/api/superadmin/promos", {
              method: "POST",
              body: JSON.stringify(payload),
            })
          : await manageContentRequest(`/api/superadmin/promos/${modal.promo!.id}`, {
              method: "PUT",
              body: JSON.stringify(payload),
            });
      if (!response.ok) {
        onNotice("error", "Failed to save offer.");
        return;
      }
      onNotice("success", modal.mode === "add" ? "Offer created." : "Offer updated.");
      setModal(null);
      await loadData();
    } catch {
      onNotice("error", "Failed to save offer.");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const response = await manageContentRequest(`/api/superadmin/promos/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        onNotice("error", "Failed to remove offer.");
        return;
      }
      onNotice("success", "Offer removed.");
      setDeleteTarget(null);
      await loadData();
    } catch {
      onNotice("error", "Failed to remove offer.");
    }
  };

  const statusVariant = (status: PromoStatus) => {
    if (status === "active") return "success" as const;
    if (status === "scheduled") return "info" as const;
    if (status === "expired") return "neutral" as const;
    return "warning" as const;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          Manage limited-time offers shown to eligible users in the marketplace.
        </p>
        <button
          type="button"
          onClick={openAdd}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover"
        >
          <Plus className="h-4 w-4" />
          Add New Offer
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading offers…</p>
      ) : activePromos.length === 0 ? (
        <PortalEmptyState
          title="No active offers"
          description="Create a limited-time offer to promote discounts and special deals."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {activePromos.map((promo) => (
            <PortalPanel key={promo.id} padding="md">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap gap-2">
                    <PortalBadge variant={statusVariant(promo.status)}>{promo.status}</PortalBadge>
                    <PortalBadge variant="primary">
                      {OFFER_TYPES.find((t) => t.value === promo.promo_type)?.label ??
                        promo.promo_type}
                    </PortalBadge>
                  </div>
                  <h3 className="font-bold text-gray-900">{promo.name}</h3>
                  <p className="mt-1 line-clamp-2 text-sm text-gray-500">{promo.description}</p>
                  <p className="mt-2 text-xs text-gray-400">
                    {fmtDate(promo.startDate)} → {fmtDate(promo.endDate)}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(promo)}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-primary"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(promo)}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </PortalPanel>
          ))}
        </div>
      )}

      <PortalModal
        open={Boolean(modal)}
        onClose={() => setModal(null)}
        title={modal?.mode === "add" ? "Add Limited Time Offer" : "Edit Offer"}
        description="Configure offer details, schedule, and eligible users."
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setModal(null)}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!form.name.trim()}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Save Offer
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">Title</label>
            <input
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">Description</label>
            <textarea
              rows={3}
              className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">Offer Type</label>
            <select
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              value={form.promo_type}
              onChange={(e) => setForm((f) => ({ ...f, promo_type: e.target.value }))}
            >
              {OFFER_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-700">Start</label>
              <select
                className="mb-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                value={form.startMode}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    startMode: e.target.value as "now" | "custom",
                  }))
                }
              >
                <option value="now">Right away</option>
                <option value="custom">Custom date/time</option>
              </select>
              {form.startMode === "custom" ? (
                <input
                  type="datetime-local"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                  value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                />
              ) : null}
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-700">End</label>
              <select
                className="mb-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                value={form.endMode}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    endMode: e.target.value as "now" | "custom",
                  }))
                }
              >
                <option value="custom">Custom date/time</option>
                <option value="now">Right away (same day)</option>
              </select>
              {form.endMode === "custom" ? (
                <input
                  type="datetime-local"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                  value={form.endDate}
                  onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                />
              ) : null}
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-gray-700">
              Eligible Users
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {targetGroups.map((group) => (
                <label key={group.key} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={form.target_groups.includes(group.key)}
                    onChange={() => toggleGroup(group.key)}
                  />
                  {group.label}
                </label>
              ))}
            </div>
          </div>
        </div>
      </PortalModal>

      <PortalModal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Remove Offer"
        description={`Remove "${deleteTarget?.name}"?`}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white"
            >
              Remove
            </button>
          </div>
        }
      >
        <p className="text-sm text-gray-600">This offer will no longer be available to users.</p>
      </PortalModal>
    </div>
  );
}
