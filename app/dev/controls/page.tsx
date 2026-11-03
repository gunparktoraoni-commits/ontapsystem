"use client";

import React, { useMemo, useState } from "react";
import { ShieldAlert, X } from "lucide-react";
import { InlineLoader, SectionLoader } from "@/app/components/Loader";
import { ModalPortal } from "@/app/components/ModalPortal";
import { DevCard } from "@/app/dev/components/DevCard";
import { DevKpiStrip } from "@/app/dev/components/DevKpiStrip";
import { useDevEndpoint } from "@/app/dev/hooks/useDevEndpoint";
import { devApiJson } from "@/app/dev/lib/devApi";
import type { PortalPageScope } from "@/lib/portal/page-controls";

type PageControl = {
  key: string;
  portal: PortalPageScope;
  label: string;
  href: string;
  description: string;
  enabled: boolean;
  persisted: boolean;
  updatedAt: string | null;
  matchPrefixes?: string[];
};

type ControlsPayload = {
  pages: PageControl[];
  grouped: Array<{
    portal: PortalPageScope;
    label: string;
    pages: PageControl[];
  }>;
  summary: {
    total: number;
    accessible: number;
    maintenance: number;
    persisted: number;
  };
};

function ToggleSwitch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60 ${
        checked ? "bg-primary" : "bg-gray-300"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-6 w-6 mt-0.5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export default function DevControlsPage() {
  const { data, loading, error, reload } = useDevEndpoint<ControlsPayload>("/api/dev/controls");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<PageControl | null>(null);

  const summary = useMemo(
    () =>
      data?.summary ?? {
        total: 0,
        accessible: 0,
        maintenance: 0,
        persisted: 0,
      },
    [data],
  );

  const confirmToggle = async () => {
    if (!confirmTarget) return;
    const control = confirmTarget;
    const nextEnabled = !control.enabled;
    setSavingKey(control.key);
    setMessage(null);
    try {
      const result = await devApiJson(`/api/dev/controls/${encodeURIComponent(control.key)}`, {
        method: "PATCH",
        body: {
          enabled: nextEnabled,
          note: `${nextEnabled ? "Enabled" : "Disabled"} from dev controls at ${new Date().toISOString()}`,
        },
      });
      if (!result.ok) throw new Error(result.error ?? "Failed to update control.");
      setConfirmTarget(null);
      setMessage(
        nextEnabled
          ? `${control.label} is accessible again. Super admins were notified.`
          : `${control.label} is under maintenance for the ${control.portal} portal. Super admins were notified.`,
      );
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to update control.");
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) {
    return (
      <SectionLoader text="Loading..." />
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl bg-white p-6 text-sm text-red-600 shadow-sm">
        {error ?? "Failed to load controls."}
      </div>
    );
  }

  const turningOff = confirmTarget ? confirmTarget.enabled : false;

  return (
    <div className="space-y-6">
      <DevKpiStrip
        items={[
          { label: "Pages", value: summary.total },
          { label: "Accessible", value: summary.accessible },
          {
            label: "Under maintenance",
            value: summary.maintenance,
            tone: summary.maintenance > 0 ? "warning" : undefined,
          },
          { label: "Persisted", value: summary.persisted },
        ]}
      />

      <DevCard
        title="Portal page controls"
        subtitle="Turn pages off to put them under maintenance for every user of that portal. Changes are logged and super admins are notified."
      >
        <div className="space-y-8">
          {message ? (
            <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-700">{message}</div>
          ) : null}

          {data.grouped.map((group) => (
            <section key={group.portal} className="space-y-3">
              <div className="flex items-end justify-between gap-3 border-b border-gray-100 pb-2">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">{group.label}</h3>
                  <p className="text-xs text-gray-500">
                    {group.pages.filter((page) => page.enabled).length} of {group.pages.length}{" "}
                    pages accessible
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {group.pages.map((control) => (
                  <div
                    key={control.key}
                    className={`rounded-xl border px-4 py-4 ${
                      control.enabled
                        ? "border-gray-100 bg-white"
                        : "border-amber-200/80 bg-amber-50/40"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-gray-900">{control.label}</p>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                              control.enabled
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {control.enabled ? "Live" : "Maintenance"}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-gray-600">{control.description}</p>
                        <p className="mt-2 text-xs text-gray-500">
                          {control.href}
                          {control.matchPrefixes?.length
                            ? ` · also blocks ${control.matchPrefixes.join(", ")}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
                        <ToggleSwitch
                          checked={control.enabled}
                          disabled={savingKey === control.key}
                          label={`${control.enabled ? "Disable" : "Enable"} ${control.label}`}
                          onChange={() => setConfirmTarget(control)}
                        />
                        <span className="text-[11px] font-medium text-gray-500">
                          {savingKey === control.key
                            ? "Saving…"
                            : control.enabled
                              ? "On"
                              : "Off"}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </DevCard>

      <ModalPortal isOpen={!!confirmTarget} onClose={() => !savingKey && setConfirmTarget(null)}>
        <div className="mx-4 w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
          <div className="flex items-center gap-2.5 border-b border-gray-100 px-6 pt-5 pb-4">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                turningOff ? "bg-amber-500" : "bg-emerald-500"
              }`}
            >
              <ShieldAlert className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-gray-900">
                {turningOff ? "Put page under maintenance?" : "Restore page access?"}
              </h2>
              <p className="truncate text-xs text-gray-500">{confirmTarget?.label}</p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmTarget(null)}
              aria-label="Close"
              className="ml-auto rounded-full p-2 text-gray-400 hover:bg-gray-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-2 px-6 py-5 text-sm text-gray-600">
            <p>
              {turningOff
                ? `This will hide ${confirmTarget?.label} from the ${confirmTarget?.portal} portal and show a maintenance modal to users who open it.`
                : `This will make ${confirmTarget?.label} accessible again in the ${confirmTarget?.portal} portal.`}
            </p>
            <p className="text-xs text-gray-500">
              The action is logged for audit, and every Super Admin will receive an in-app notification.
            </p>
          </div>
          <div className="flex justify-end gap-3 border-t border-gray-100 bg-gray-50/50 px-6 py-4">
            <button
              type="button"
              disabled={Boolean(savingKey)}
              onClick={() => setConfirmTarget(null)}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={Boolean(savingKey)}
              onClick={() => void confirmToggle()}
              className={`rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
                turningOff ? "bg-amber-600 hover:bg-amber-700" : "bg-primary hover:bg-[#243f82]"
              }`}
            >
              {savingKey ? "Saving…" : turningOff ? "Confirm maintenance" : "Confirm restore"}
            </button>
          </div>
        </div>
      </ModalPortal>
    </div>
  );
}
