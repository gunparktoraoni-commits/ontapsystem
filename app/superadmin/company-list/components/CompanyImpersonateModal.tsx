"use client";

import { PortalModal } from "../../components/ui";
import { CompanyLogoAvatar } from "./CompanyLogoAvatar";

export type CompanyDetailData = {
  company: {
    company_id: string;
    company_name: string;
    company_slug: string | null;
    status: string;
    subscription_tier: string | null;
    approval_required: boolean;
    company_theme: string | null;
    settings: Record<string, unknown>;
    current_employees: number;
    max_employees: number | null;
    description: string | null;
    email: string | null;
    logo_url: string | null;
    security_code: string | null;
    rejection_reason: string | null;
    pending_name_change: string | null;
    last_name_change_request: string | null;
    created_at: string;
    approved_at: string | null;
    updated_at: string | null;
    created_by: { user_id: string; name: string; email: string } | null;
    approved_by: { user_id: string; name: string; email: string } | null;
    admin: { user_id: string; name: string; email: string } | null;
  };
  metrics?: {
    employees_total: number;
    employees_active: number;
    employees_restricted: number;
    pending_join_requests: number;
    pending_name_change_requests: number;
  };
  recent_audit_logs?: Array<{
    log_id: string;
    action: string;
    details: string | null;
    created_at: string;
    actor: { user_id: string; name: string; email: string };
  }>;
};

type CompanyImpersonateModalProps = {
  open: boolean;
  loading: boolean;
  starting: boolean;
  data: CompanyDetailData | null;
  onClose: () => void;
  onStartImpersonation: () => void;
  toTitleCase: (value: string) => string;
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "N/A";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "N/A" : parsed.toLocaleString();
}

export function CompanyImpersonateModal({
  open,
  loading,
  starting,
  data,
  onClose,
  onStartImpersonation,
  toTitleCase,
}: CompanyImpersonateModalProps) {
  const company = data?.company;
  const canImpersonate =
    Boolean(company?.admin?.user_id) &&
    company?.status === "active" &&
    !starting &&
    !loading;

  return (
    <PortalModal
      open={open}
      onClose={onClose}
      title="Company Impersonation"
      description="Review company details before acting as the primary company administrator."
      size="xl"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canImpersonate}
            onClick={onStartImpersonation}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {starting ? "Starting..." : "Start Impersonation"}
          </button>
        </div>
      }
    >
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-4 animate-pulse rounded bg-primary/10" />
          ))}
        </div>
      ) : company ? (
        <div className="space-y-6">
          <div className="flex items-start gap-4">
            <CompanyLogoAvatar name={company.company_name} logoUrl={company.logo_url} className="h-14 w-14 rounded-2xl object-cover" />
            <div>
              <h3 className="text-lg font-bold text-gray-900">{company.company_name}</h3>
              <p className="text-sm text-gray-500">{company.company_slug || "No slug"}</p>
              <p className="mt-1 text-sm text-gray-600">{company.description || "No description"}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <DetailItem label="Company ID" value={company.company_id} />
            <DetailItem label="Slug" value={company.company_slug || "No slug"} />
            <DetailItem label="Status" value={toTitleCase(company.status)} />
            <DetailItem label="Subscription" value={toTitleCase(company.subscription_tier || "none")} />
            <DetailItem label="Theme" value={company.company_theme || "default"} />
            <DetailItem label="Email" value={company.email || "N/A"} />
            <DetailItem label="Employees" value={`${company.current_employees}`} />
            <DetailItem label="Approval required" value={company.approval_required ? "Yes" : "No"} />
            <DetailItem label="Security code" value={company.security_code || "N/A"} />
            <DetailItem label="Created" value={formatDate(company.created_at)} />
            <DetailItem label="Approved" value={formatDate(company.approved_at)} />
            <DetailItem label="Updated" value={formatDate(company.updated_at)} />
            <DetailItem label="Pending name change" value={company.pending_name_change || "None"} />
            <DetailItem label="Last name change request" value={company.last_name_change_request || "None"} />
            <DetailItem label="Rejection reason" value={company.rejection_reason || "None"} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <PersonCard title="Admin" person={company.admin} />
            <PersonCard title="Created by" person={company.created_by} />
            <PersonCard title="Approved by" person={company.approved_by} />
          </div>

          {data.metrics ? (
            <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
              <h4 className="mb-3 text-sm font-semibold text-gray-900">Metrics</h4>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
                <DetailItem label="Total employees" value={String(data.metrics.employees_total)} />
                <DetailItem label="Active" value={String(data.metrics.employees_active)} />
                <DetailItem label="Restricted" value={String(data.metrics.employees_restricted)} />
                <DetailItem label="Join requests" value={String(data.metrics.pending_join_requests)} />
                <DetailItem label="Name changes" value={String(data.metrics.pending_name_change_requests)} />
              </dl>
            </div>
          ) : null}

          {data.recent_audit_logs && data.recent_audit_logs.length > 0 ? (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-900">Recent audit logs</h4>
              <ul className="max-h-48 space-y-2 overflow-y-auto text-sm">
                {data.recent_audit_logs.map((log) => (
                  <li key={log.log_id} className="rounded-lg border border-gray-100 px-3 py-2">
                    <p className="font-medium text-gray-900">{log.action}</p>
                    <p className="text-xs text-gray-500">
                      {log.actor.name} · {formatDate(log.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {!company.admin?.user_id ? (
            <p className="text-sm text-amber-700">This company has no assigned primary administrator. Impersonation is unavailable.</p>
          ) : null}
          {company.status === "restricted" ? (
            <p className="text-sm text-rose-700">Restricted companies cannot be impersonated.</p>
          ) : null}
          {company.status === "pending" ? (
            <p className="text-sm text-amber-700">Pending companies cannot be impersonated until approved.</p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-gray-500">No company details available.</p>
      )}
    </PortalModal>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900">{value}</dd>
    </div>
  );
}

function PersonCard({
  title,
  person,
}: {
  title: string;
  person: { name: string; email: string } | null;
}) {
  return (
    <div className="rounded-xl border border-gray-100 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</p>
      <p className="mt-1 text-sm font-semibold text-gray-900">{person?.name || "N/A"}</p>
      <p className="text-xs text-gray-500">{person?.email || "N/A"}</p>
    </div>
  );
}
