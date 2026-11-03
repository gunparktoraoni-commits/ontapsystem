"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  PortalBadge,
  PortalDataTable,
  PortalEmptyState,
  PortalModal,
  PortalTableBody,
  PortalTableCell,
  PortalTableHead,
  PortalTableHeaderCell,
  PortalTableRow,
} from "../../components/ui";
import { fmtCurrency, manageContentRequest } from "./manage-content-shared";

type SubscriptionPlan = {
  id: string;
  name: string;
  tier_code: string;
  price_monthly: number;
  price_yearly: number;
  features: string[];
  display_order: number;
  is_active: boolean;
};

const INCLUSION_OPTIONS = [
  "Create virtual cards",
  "Merge physical cards",
  "Gallery upload",
  "Inquiry management",
  "Real-time analytics",
  "Company creation",
  "Affiliate access",
  "Priority support",
  "Unlimited associates",
  "Theme access",
];

type PlanForm = {
  name: string;
  tier_code: string;
  price_monthly: string;
  price_yearly: string;
  place_before_plan_id: string;
  features: string[];
  customFeature: string;
};

const EMPTY_FORM: PlanForm = {
  name: "",
  tier_code: "",
  price_monthly: "",
  price_yearly: "",
  place_before_plan_id: "",
  features: [],
  customFeature: "",
};

type SubscriptionTiersTabProps = {
  onNotice: (type: "success" | "error", message: string) => void;
};

export default function SubscriptionTiersTab({ onNotice }: SubscriptionTiersTabProps) {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ mode: "add" | "edit"; plan?: SubscriptionPlan } | null>(
    null
  );
  const [deleteTarget, setDeleteTarget] = useState<SubscriptionPlan | null>(null);
  const [form, setForm] = useState<PlanForm>(EMPTY_FORM);

  const loadPlans = useCallback(async () => {
    setLoading(true);
    try {
      const response = await manageContentRequest(
        "/api/superadmin/subscription-plans?include_inactive=true"
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error("Failed to load subscription tiers");
      const list = payload?.data?.plans ?? [];
      setPlans(Array.isArray(list) ? list : []);
    } catch {
      onNotice("error", "Failed to load subscription tiers.");
    } finally {
      setLoading(false);
    }
  }, [onNotice]);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setModal({ mode: "add" });
  };

  const openEdit = (plan: SubscriptionPlan) => {
    setForm({
      name: plan.name,
      tier_code: plan.tier_code,
      price_monthly: String(plan.price_monthly),
      price_yearly: String(plan.price_yearly),
      place_before_plan_id: "",
      features: plan.features ?? [],
      customFeature: "",
    });
    setModal({ mode: "edit", plan });
  };

  const toggleFeature = (feature: string) => {
    setForm((f) => ({
      ...f,
      features: f.features.includes(feature)
        ? f.features.filter((item) => item !== feature)
        : [...f.features, feature],
    }));
  };

  const addCustomFeature = () => {
    const value = form.customFeature.trim();
    if (!value || form.features.includes(value)) return;
    setForm((f) => ({ ...f, features: [...f.features, value], customFeature: "" }));
  };

  const buildPayload = () => {
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      tier_code: form.tier_code.trim(),
      price_monthly: parseFloat(form.price_monthly) || 0,
      price_yearly: parseFloat(form.price_yearly) || 0,
      features: form.features,
    };
    if (form.place_before_plan_id) {
      payload.place_before_plan_id = Number(form.place_before_plan_id);
    }
    return payload;
  };

  const handleSave = async () => {
    if (!modal || !form.name.trim() || !form.tier_code.trim()) return;
    try {
      const response =
        modal.mode === "add"
          ? await manageContentRequest("/api/superadmin/subscription-plans", {
              method: "POST",
              body: JSON.stringify(buildPayload()),
            })
          : await manageContentRequest(`/api/superadmin/subscription-plans/${modal.plan!.id}`, {
              method: "PUT",
              body: JSON.stringify(buildPayload()),
            });
      if (!response.ok) {
        onNotice("error", "Failed to save subscription tier.");
        return;
      }
      onNotice(
        "success",
        modal.mode === "add" ? "Subscription tier created." : "Subscription tier updated."
      );
      setModal(null);
      await loadPlans();
    } catch {
      onNotice("error", "Failed to save subscription tier.");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const response = await manageContentRequest(
        `/api/superadmin/subscription-plans/${deleteTarget.id}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        onNotice("error", "Failed to delete subscription tier.");
        return;
      }
      onNotice("success", "Subscription tier archived.");
      setDeleteTarget(null);
      await loadPlans();
    } catch {
      onNotice("error", "Failed to delete subscription tier.");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          Manage subscription tiers shown in the marketplace. Existing subscribers keep their
          current plan.
        </p>
        <button
          type="button"
          onClick={openAdd}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover"
        >
          <Plus className="h-4 w-4" />
          Add New Tier
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading subscription tiers…</p>
      ) : plans.length === 0 ? (
        <PortalEmptyState
          title="No subscription tiers"
          description="Create tiers to define pricing and inclusions for BizCard subscriptions."
        />
      ) : (
        <PortalDataTable>
          <PortalTableHead>
            <PortalTableRow>
              <PortalTableHeaderCell>Title</PortalTableHeaderCell>
              <PortalTableHeaderCell>Monthly</PortalTableHeaderCell>
              <PortalTableHeaderCell>Yearly</PortalTableHeaderCell>
              <PortalTableHeaderCell>Inclusions</PortalTableHeaderCell>
              <PortalTableHeaderCell>Status</PortalTableHeaderCell>
              <PortalTableHeaderCell className="text-right">Actions</PortalTableHeaderCell>
            </PortalTableRow>
          </PortalTableHead>
          <PortalTableBody>
            {plans.map((plan) => (
              <PortalTableRow key={plan.id}>
                <PortalTableCell>
                  <div>
                    <p className="font-semibold text-gray-900">{plan.name}</p>
                    <p className="text-xs text-gray-400">{plan.tier_code}</p>
                  </div>
                </PortalTableCell>
                <PortalTableCell>{fmtCurrency(plan.price_monthly)}</PortalTableCell>
                <PortalTableCell>{fmtCurrency(plan.price_yearly)}</PortalTableCell>
                <PortalTableCell>
                  <p className="line-clamp-2 text-xs text-gray-500">
                    {(plan.features ?? []).slice(0, 3).join(", ") || "—"}
                  </p>
                </PortalTableCell>
                <PortalTableCell>
                  <PortalBadge variant={plan.is_active ? "success" : "warning"}>
                    {plan.is_active ? "Active" : "Archived"}
                  </PortalBadge>
                </PortalTableCell>
                <PortalTableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => openEdit(plan)}
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-primary"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(plan)}
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </PortalTableCell>
              </PortalTableRow>
            ))}
          </PortalTableBody>
        </PortalDataTable>
      )}

      <PortalModal
        open={Boolean(modal)}
        onClose={() => setModal(null)}
        title={modal?.mode === "add" ? "Add Subscription Tier" : "Edit Subscription Tier"}
        description="Configure title, pricing, inclusions, and display order."
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
              disabled={!form.name.trim() || !form.tier_code.trim()}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Save
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-700">Tier Code</label>
              <input
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                value={form.tier_code}
                onChange={(e) => setForm((f) => ({ ...f, tier_code: e.target.value }))}
                placeholder="basic, standard, premium"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-700">
                Place Before
              </label>
              <select
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                value={form.place_before_plan_id}
                onChange={(e) =>
                  setForm((f) => ({ ...f, place_before_plan_id: e.target.value }))
                }
              >
                <option value="">End of list</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-700">
                Monthly Price
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                value={form.price_monthly}
                onChange={(e) => setForm((f) => ({ ...f, price_monthly: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-700">
                Yearly Price
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                value={form.price_yearly}
                onChange={(e) => setForm((f) => ({ ...f, price_yearly: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-gray-700">Inclusions</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {INCLUSION_OPTIONS.map((option) => (
                <label key={option} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={form.features.includes(option)}
                    onChange={() => toggleFeature(option)}
                  />
                  {option}
                </label>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm"
                placeholder="Add custom inclusion"
                value={form.customFeature}
                onChange={(e) => setForm((f) => ({ ...f, customFeature: e.target.value }))}
              />
              <button
                type="button"
                onClick={addCustomFeature}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-600"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      </PortalModal>

      <PortalModal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete Subscription Tier"
        description={`Archive "${deleteTarget?.name}"? It will be hidden from new subscriptions.`}
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
              Delete
            </button>
          </div>
        }
      >
        <p className="text-sm text-gray-600">
          Existing subscribers on this tier are not affected.
        </p>
      </PortalModal>
    </div>
  );
}
