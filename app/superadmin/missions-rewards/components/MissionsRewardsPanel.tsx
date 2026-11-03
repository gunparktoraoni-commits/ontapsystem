"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Edit2, Plus, RefreshCw, Trophy } from "lucide-react";
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
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import { getTheme } from "@/app/components/BizCardPreview";
import { csrfClient } from "@/lib/csrf-client";

const API = getFrontendApiBaseUrl();

function isStateChangingMethod(method?: string) {
  const normalized = (method ?? "GET").toUpperCase();
  return normalized !== "GET" && normalized !== "HEAD" && normalized !== "OPTIONS";
}

function isCsrfError(status: number, payload: unknown): boolean {
  if (status !== 403) return false;
  if (!payload || typeof payload !== "object") return true;
  const objectPayload = payload as {
    code?: string;
    error?: { code?: string; message?: string } | string;
    message?: string;
  };
  const code =
    objectPayload.code ??
    (typeof objectPayload.error === "object" ? objectPayload.error?.code : undefined);
  if (code === "CSRF_TOKEN_INVALID" || code === "INVALID_CSRF_TOKEN") return true;
  const message =
    (typeof objectPayload.error === "object" ? objectPayload.error?.message : undefined) ??
    objectPayload.message ??
    (typeof objectPayload.error === "string" ? objectPayload.error : "");
  return /csrf/i.test(message) || !message;
}

type TabId = "overview" | "mission_rewards" | "redemptions";

type ThemeOption = {
  id: string;
  theme_name: string;
  theme_path: string;
  tag: string | null;
  tier?: string | null;
  price: number;
  preview_image: string | null;
  description?: string | null;
};

type MissionRewardRow = {
  id: string;
  key: string;
  title: string;
  description: string | null;
  instruction: string | null;
  requirement_type: string;
  target: number;
  status: string;
  unlocked_count: number;
  reward: {
    id: string;
    name: string;
    description: string | null;
    type: string;
    status: string;
    duration_days: number | null;
    theme_id: string | null;
    theme_name: string | null;
    theme_preview_image: string | null;
    theme_tag: string | null;
    feature_key: string | null;
  } | null;
};

type RedemptionRow = {
  id: string;
  status: string;
  unlocked_at: string;
  claimed_at: string | null;
  user: { id: string; name: string; email: string };
  reward: { id: string; name: string; type: string };
  mission: { id: string; key: string; title: string } | null;
};

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "mission_rewards", label: "Mission Rewards" },
  { id: "redemptions", label: "Redemptions" },
];

const REWARD_TYPES = [
  { value: "premium_access", label: "Premium Access" },
  { value: "theme_access", label: "Theme Access" },
  { value: "feature_access", label: "Feature Access" },
];

const DEFAULT_INSTRUCTION =
  "Refer new users who complete an eligible Ontap purchase or subscription.";

/** Paid marketplace themes are excluded from Theme Access reward selection. */
function isExcludedMissionRewardTheme(theme: {
  tag: string | null;
}) {
  return (theme.tag || "").trim().toLowerCase() === "paid";
}

function ThemeVisualPreview({
  theme,
  className,
}: {
  theme: ThemeOption;
  className?: string;
}) {
  const def = getTheme(theme.theme_path);
  if (theme.preview_image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={theme.preview_image}
        alt={theme.theme_name}
        className={className ?? "h-full w-full object-cover"}
      />
    );
  }
  return (
    <div
      className={className ?? "h-full w-full"}
      style={{
        background: def.gradient,
        backgroundImage: `${def.pattern}, ${def.gradient}`,
      }}
      aria-label={`${theme.theme_name} preview`}
    />
  );
}

async function apiJson(path: string, init?: RequestInit) {
  const method = (init?.method ?? "GET").toUpperCase();
  const needsCsrf = isStateChangingMethod(method);

  const buildHeaders = (csrfToken: string | null): HeadersInit => {
    const headers = new Headers(init?.headers ?? undefined);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (csrfToken) {
      headers.set("X-CSRF-Token", csrfToken);
    }
    return headers;
  };

  const execute = (csrfToken: string | null) =>
    fetch(`${API}${path}`, {
      ...init,
      method,
      credentials: "include",
      cache: "no-store",
      headers: buildHeaders(csrfToken),
    });

  let csrfToken: string | null = null;
  if (needsCsrf) {
    csrfToken = await csrfClient.getToken(false, API || undefined);
  }

  let res = await execute(csrfToken);
  let payload = await res.json().catch(() => null);

  if (!res.ok && needsCsrf && isCsrfError(res.status, payload)) {
    const refreshed = await csrfClient.getToken(true, API || undefined);
    if (refreshed && refreshed !== csrfToken) {
      res = await execute(refreshed);
      payload = await res.json().catch(() => null);
    }
  }

  if (!res.ok || payload?.success === false) {
    throw new Error(
      payload?.error?.message || payload?.error || `Request failed (${res.status})`,
    );
  }
  return payload;
}

type FormState = {
  title: string;
  description: string;
  instruction: string;
  target: string;
  status: string;
  reward_name: string;
  reward_description: string;
  reward_type: string;
  duration_days: string;
  theme_id: string;
  feature_key: string;
  reward_status: string;
};

const emptyForm = (): FormState => ({
  title: "",
  description: "",
  instruction: DEFAULT_INSTRUCTION,
  target: "5",
  status: "active",
  reward_name: "",
  reward_description: "",
  reward_type: "premium_access",
  duration_days: "7",
  theme_id: "",
  feature_key: "",
  reward_status: "active",
});

export default function MissionsRewardsPanel() {
  const { toasts, push, dismiss } = usePortalToasts();
  const [tab, setTab] = useState<TabId>("overview");
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<MissionRewardRow[]>([]);
  const [themes, setThemes] = useState<ThemeOption[]>([]);
  const [redemptions, setRedemptions] = useState<RedemptionRow[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MissionRewardRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, themesRes, redemptionsRes] = await Promise.all([
        apiJson("/api/superadmin/mission-rewards"),
        apiJson("/api/superadmin/rewards/theme-options"),
        apiJson("/api/superadmin/reward-redemptions?limit=50"),
      ]);
      setRows(listRes.data?.mission_rewards ?? []);
      setThemes(themesRes.data?.themes ?? []);
      setRedemptions(redemptionsRes.data?.redemptions ?? []);
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Unable to load data.");
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const overview = useMemo(
    () => ({
      total: rows.length,
      active: rows.filter((r) => r.status === "active").length,
      withReward: rows.filter((r) => r.reward).length,
      unlocks: redemptions.length,
    }),
    [rows, redemptions],
  );

  const openCreate = () => {
    setEditing(null);
    const f = emptyForm();
    const first = themes.find((t) => !isExcludedMissionRewardTheme(t));
    f.theme_id = first?.id ?? "";
    setForm(f);
    setModalOpen(true);
  };

  const openEdit = (row: MissionRewardRow) => {
    setEditing(row);
    setForm({
      title: row.title,
      description: row.description ?? "",
      instruction: row.instruction ?? DEFAULT_INSTRUCTION,
      target: String(row.target),
      status: row.status,
      reward_name: row.reward?.name ?? "",
      reward_description: row.reward?.description ?? "",
      reward_type: row.reward?.type ?? "premium_access",
      duration_days: String(row.reward?.duration_days ?? 7),
      theme_id: row.reward?.theme_id
        ? themes.some(
            (t) =>
              t.id === row.reward?.theme_id && !isExcludedMissionRewardTheme(t),
          )
          ? row.reward.theme_id
          : themes.find((t) => !isExcludedMissionRewardTheme(t))?.id ?? ""
        : themes.find((t) => !isExcludedMissionRewardTheme(t))?.id ?? "",
      feature_key: row.reward?.feature_key ?? "",
      reward_status: row.reward?.status ?? "active",
    });
    setModalOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        instruction: form.instruction.trim() || null,
        target: Number(form.target),
        status: form.status,
        reward_name: form.reward_name.trim(),
        reward_description: form.reward_description.trim() || null,
        reward_type: form.reward_type,
        reward_status: form.reward_status,
      };
      if (form.reward_type === "premium_access") {
        body.duration_days = Number(form.duration_days);
      }
      if (form.reward_type === "theme_access") {
        body.theme_id = form.theme_id;
      }
      if (form.reward_type === "feature_access") {
        body.feature_key = form.feature_key.trim() || null;
      }

      if (editing) {
        await apiJson(`/api/superadmin/mission-rewards/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        push("success", "Mission Reward updated.");
      } else {
        await apiJson("/api/superadmin/mission-rewards", {
          method: "POST",
          body: JSON.stringify(body),
        });
        push("success", "Mission Reward created.");
      }
      setModalOpen(false);
      await loadAll();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Unable to save.");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (row: MissionRewardRow) => {
    const next = row.status === "active" ? "inactive" : "active";
    try {
      await apiJson(`/api/superadmin/mission-rewards/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: next,
          reward_status: next,
        }),
      });
      push("success", `${row.title} is now ${next}.`);
      await loadAll();
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Unable to update.");
    }
  };

  const typeLabel = (type: string) =>
    REWARD_TYPES.find((t) => t.value === type)?.label ?? type;

  const selectedTheme = themes.find((t) => t.id === form.theme_id);

  const selectableThemes = useMemo(
    () => themes.filter((t) => !isExcludedMissionRewardTheme(t)),
    [themes],
  );

  const selectTheme = (theme: ThemeOption) => {
    setForm((s) => ({
      ...s,
      theme_id: theme.id,
      reward_name: s.reward_name.trim() ? s.reward_name : theme.theme_name,
    }));
  };

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PortalToastStack toasts={toasts} onDismiss={dismiss} />
      <PortalPageHeader
        title="Missions & Rewards"
        subtitle="Configure mission requirements and their rewards together."
        actions={
          <div className="flex flex-wrap gap-2">
           
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-xl bg-[#2A4792] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1e3578]"
            >
              <Plus className="h-4 w-4" />
              Create Mission Reward
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        {TABS.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`rounded-xl px-3 py-2 text-sm font-semibold border ${
                active
                  ? "border-transparent text-white"
                  : "border-[#d8deee] text-gray-600 hover:bg-gray-50"
              }`}
              style={
                active
                  ? { background: "linear-gradient(135deg, #2A4792, #4785B8)" }
                  : undefined
              }
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-gray-100 bg-white p-10 text-sm text-gray-500">
          <InlineLoader />
          Loading…
        </div>
      ) : (
        <>
          {tab === "overview" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: "Mission Rewards", value: overview.total },
                { label: "Active", value: overview.active },
                { label: "With Reward", value: overview.withReward },
                { label: "Recent Unlocks", value: overview.unlocks },
              ].map((card) => (
                <PortalPanel key={card.label} className="p-5">
                  <p className="text-sm font-semibold text-gray-500">
                    {card.label}
                  </p>
                  <p className="mt-2 text-3xl font-extrabold text-gray-950">
                    {card.value}
                  </p>
                </PortalPanel>
              ))}
            </div>
          )}

          {tab === "mission_rewards" && (
            <PortalPanel className="overflow-hidden p-0">
              {rows.length === 0 ? (
                <PortalEmptyState
                  icon={Trophy}
                  title="No mission rewards"
                  description="Create a mission with its reward in one step."
                  action={
                    <button
                      type="button"
                      onClick={openCreate}
                      className="rounded-xl bg-[#2A4792] px-4 py-2 text-sm font-semibold text-white"
                    >
                      Create Mission Reward
                    </button>
                  }
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-gray-100 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-4 py-3">Mission</th>
                        <th className="px-4 py-3">Target</th>
                        <th className="px-4 py-3">Reward</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Unlocked</th>
                        <th className="px-4 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rows.map((row) => (
                        <tr key={row.id}>
                          <td className="px-4 py-3">
                            <p className="font-semibold text-gray-900">
                              {row.title}
                            </p>
                            <p className="text-xs text-gray-500">{row.key}</p>
                          </td>
                          <td className="px-4 py-3">
                            {row.target} qualified referrals
                          </td>
                          <td className="px-4 py-3">
                            {row.reward ? (
                              <>
                                <p className="font-medium">{row.reward.name}</p>
                                <p className="text-xs text-gray-500">
                                  {typeLabel(row.reward.type)}
                                </p>
                              </>
                            ) : (
                              <span className="text-amber-600">Unassigned</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <PortalBadge
                              variant={statusToBadgeVariant(row.status)}
                            >
                              {row.status}
                            </PortalBadge>
                          </td>
                          <td className="px-4 py-3">{row.unlocked_count}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => openEdit(row)}
                                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => void toggleStatus(row)}
                                className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                              >
                                {row.status === "active"
                                  ? "Deactivate"
                                  : "Activate"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </PortalPanel>
          )}

          {tab === "redemptions" && (
            <PortalPanel className="overflow-hidden p-0">
              {redemptions.length === 0 ? (
                <PortalEmptyState
                  title="No unlocks yet"
                  description="User rewards appear after mission completion grants."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-gray-100 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-4 py-3">User</th>
                        <th className="px-4 py-3">Reward</th>
                        <th className="px-4 py-3">Mission</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Unlocked</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {redemptions.map((row) => (
                        <tr key={row.id}>
                          <td className="px-4 py-3">
                            <p className="font-semibold text-gray-900">
                              {row.user.name || "User"}
                            </p>
                            <p className="text-xs text-gray-500">
                              {row.user.email}
                            </p>
                          </td>
                          <td className="px-4 py-3">{row.reward.name}</td>
                          <td className="px-4 py-3">
                            {row.mission?.title ?? "—"}
                          </td>
                          <td className="px-4 py-3">
                            <PortalBadge
                              variant={statusToBadgeVariant(row.status)}
                            >
                              {row.status}
                            </PortalBadge>
                          </td>
                          <td className="px-4 py-3 text-gray-500">
                            {new Date(row.unlocked_at).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </PortalPanel>
          )}
        </>
      )}

      <PortalModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Edit Mission Reward" : "Create Mission Reward"}
        size="xl"
        className="max-w-[min(96vw,1100px)] min-h-[min(82vh,780px)]"
        bodyClassName="overflow-hidden flex flex-col"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={
                saving ||
                !form.title.trim() ||
                !form.reward_name.trim() ||
                (form.reward_type === "theme_access" && !form.theme_id)
              }
              onClick={() => void save()}
              className="rounded-xl bg-[#2A4792] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving
                ? "Saving..."
                : editing
                  ? "Save changes"
                  : "Create Mission Reward"}
            </button>
          </div>
        }
      >
        <div className="grid min-h-0 flex-1 gap-5 overflow-hidden lg:grid-cols-2">
          {/* Left: form + theme list — independent scroll */}
          <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain pr-1">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
              Mission details
            </p>
            <label className="block text-sm">
              <span className="mb-1 block font-semibold text-gray-700">
                Mission name *
              </span>
              <input
                value={form.title}
                onChange={(e) =>
                  setForm((s) => ({ ...s, title: e.target.value }))
                }
                className="w-full rounded-xl border border-gray-200 px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-semibold text-gray-700">
                Description
              </span>
              <textarea
                value={form.description}
                onChange={(e) =>
                  setForm((s) => ({ ...s, description: e.target.value }))
                }
                className="w-full rounded-xl border border-gray-200 px-3 py-2"
                rows={2}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-semibold text-gray-700">
                How to complete
              </span>
              <textarea
                value={form.instruction}
                onChange={(e) =>
                  setForm((s) => ({ ...s, instruction: e.target.value }))
                }
                className="w-full rounded-xl border border-gray-200 px-3 py-2"
                rows={3}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block font-semibold text-gray-700">
                  Target *
                </span>
                <input
                  type="number"
                  min={1}
                  value={form.target}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, target: e.target.value }))
                  }
                  className="w-full rounded-xl border border-gray-200 px-3 py-2"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-semibold text-gray-700">
                  Status
                </span>
                <select
                  value={form.status}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, status: e.target.value }))
                  }
                  className="w-full rounded-xl border border-gray-200 px-3 py-2"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
            </div>
            <p className="text-xs text-gray-500">
              Requirement: Qualified Referrals
            </p>

            <p className="pt-2 text-xs font-bold uppercase tracking-wide text-gray-500">
              Reward
            </p>
            <label className="block text-sm">
              <span className="mb-1 block font-semibold text-gray-700">
                Reward name *
              </span>
              <input
                value={form.reward_name}
                onChange={(e) =>
                  setForm((s) => ({ ...s, reward_name: e.target.value }))
                }
                className="w-full rounded-xl border border-gray-200 px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-semibold text-gray-700">
                Reward description
              </span>
              <textarea
                value={form.reward_description}
                onChange={(e) =>
                  setForm((s) => ({
                    ...s,
                    reward_description: e.target.value,
                  }))
                }
                className="w-full rounded-xl border border-gray-200 px-3 py-2"
                rows={2}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-semibold text-gray-700">
                Reward type *
              </span>
              <select
                value={form.reward_type}
                onChange={(e) =>
                  setForm((s) => ({ ...s, reward_type: e.target.value }))
                }
                className="w-full rounded-xl border border-gray-200 px-3 py-2"
              >
                {REWARD_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>

            {form.reward_type === "premium_access" && (
              <label className="block text-sm">
                <span className="mb-1 block font-semibold text-gray-700">
                  Duration (days) *
                </span>
                <input
                  type="number"
                  min={1}
                  value={form.duration_days}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, duration_days: e.target.value }))
                  }
                  className="w-full rounded-xl border border-gray-200 px-3 py-2"
                />
              </label>
            )}

            {form.reward_type === "theme_access" && (
              <div>
                <p className="mb-2 text-sm font-semibold text-gray-700">
                  Select theme *
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {selectableThemes.map((t) => {
                    const selected = form.theme_id === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => selectTheme(t)}
                        className={`rounded-xl border p-2 text-left transition-shadow ${
                          selected
                            ? "border-[#2A4792] ring-2 ring-[#2A4792]/20"
                            : "border-gray-200 hover:border-gray-300"
                        }`}
                      >
                        <div className="mb-1 h-20 overflow-hidden rounded-lg bg-gray-100">
                          <ThemeVisualPreview theme={t} />
                        </div>
                        <p className="truncate text-xs font-bold text-gray-800">
                          {t.theme_name}
                        </p>
                        <p className="text-[10px] uppercase text-gray-400">
                          {t.tier || t.tag || "theme"}
                        </p>
                      </button>
                    );
                  })}
                </div>
                {selectableThemes.length === 0 ? (
                  <p className="mt-2 text-xs text-amber-600">
                    No selectable themes available.
                  </p>
                ) : null}
              </div>
            )}

            {form.reward_type === "feature_access" && (
              <label className="block text-sm">
                <span className="mb-1 block font-semibold text-gray-700">
                  Feature key
                </span>
                <input
                  value={form.feature_key}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, feature_key: e.target.value }))
                  }
                  className="w-full rounded-xl border border-gray-200 px-3 py-2"
                  placeholder="future_feature_key"
                />
              </label>
            )}

            <label className="block text-sm">
              <span className="mb-1 block font-semibold text-gray-700">
                Reward status
              </span>
              <select
                value={form.reward_status}
                onChange={(e) =>
                  setForm((s) => ({ ...s, reward_status: e.target.value }))
                }
                className="w-full rounded-xl border border-gray-200 px-3 py-2"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          </div>

          {/* Right: live preview — independent scroll */}
          <div className="min-h-0 overflow-y-auto overscroll-contain rounded-2xl border border-[#e8edf7] bg-[#F8FAFD] p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
              Preview
            </p>
            <h3 className="mt-2 text-lg font-extrabold text-gray-950">
              {form.title.trim() || "Mission name"}
            </h3>
            <p className="mt-1 text-sm text-gray-600">
              {form.description.trim() || "Mission description"}
            </p>
            <p className="mt-3 text-sm font-semibold text-[#2A4792]">
              {form.target || "—"} qualified referrals
            </p>

            <div className="mt-4 rounded-xl border border-white bg-white p-3 shadow-sm">
              <p className="text-[11px] font-bold uppercase text-gray-500">
                Reward
              </p>

              {form.reward_type === "theme_access" ? (
                <>
                  <div className="mt-2 overflow-hidden rounded-xl border border-[#e8edf7] bg-gray-50">
                    {selectedTheme ? (
                      <ThemeVisualPreview
                        theme={selectedTheme}
                        className="h-56 w-full object-cover object-top"
                      />
                    ) : (
                      <div className="flex h-48 flex-col items-center justify-center gap-2 text-gray-400">
                        <span className="text-3xl">🎨</span>
                        <span className="text-xs">Select a theme to preview</span>
                      </div>
                    )}
                  </div>
                  <p className="mt-3 text-base font-bold text-gray-900">
                    {form.reward_name.trim() ||
                      selectedTheme?.theme_name ||
                      "Theme reward"}
                  </p>
                  <p className="text-xs font-semibold text-gray-500">
                    Theme Access
                  </p>
                  {selectedTheme ? (
                    <dl className="mt-3 space-y-1.5 text-xs text-gray-600">
                      <div className="flex justify-between gap-2">
                        <dt className="text-gray-400">Theme</dt>
                        <dd className="font-semibold text-gray-800">
                          {selectedTheme.theme_name}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-gray-400">Tier</dt>
                        <dd className="font-semibold uppercase text-gray-800">
                          {selectedTheme.tier || selectedTheme.tag || "—"}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-gray-400">Path</dt>
                        <dd className="truncate font-mono text-[11px] text-gray-700">
                          {selectedTheme.theme_path}
                        </dd>
                      </div>
                      {selectedTheme.description ? (
                        <div className="pt-1">
                          <dt className="text-gray-400">About</dt>
                          <dd className="mt-0.5 text-gray-700">
                            {selectedTheme.description}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  ) : null}
                  {form.reward_description.trim() ? (
                    <p className="mt-3 text-sm text-gray-600">
                      {form.reward_description}
                    </p>
                  ) : null}
                </>
              ) : (
                <>
                  <div className="mt-2 flex h-24 items-center justify-center rounded-lg bg-gray-50 text-3xl">
                    {form.reward_type === "premium_access" ? "🎁" : "✨"}
                  </div>
                  <p className="mt-2 text-sm font-bold text-gray-900">
                    {form.reward_name.trim() || "Reward name"}
                  </p>
                  <p className="text-xs text-gray-500">
                    {typeLabel(form.reward_type)}
                    {form.reward_type === "premium_access"
                      ? ` · ${form.duration_days || "—"} days`
                      : ""}
                  </p>
                  {form.reward_description.trim() ? (
                    <p className="mt-2 text-sm text-gray-600">
                      {form.reward_description}
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      </PortalModal>
    </div>
  );
}
