"use client";

import React, { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { InlineLoader } from "../../../components/Loader";
import { companyAdminApiRequest, mapEmployeeRow, normalizeResponseData } from "../../lib/companyAdminApi";

type AuditLogRow = {
  log_id: string;
  actor_name: string;
  role: string;
  is_co_admin: boolean;
  action: string;
  created_at: string;
  details: Record<string, unknown> | null;
};

type PerformanceRow = {
  id: string;
  name: string;
  role: string;
  activity: { views: number; leads: number; inquiries: number; rank: number };
};

export default function CompanyActivityLogsPanel() {
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [performanceRows, setPerformanceRows] = useState<PerformanceRow[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(true);
  const [loadingPerformance, setLoadingPerformance] = useState(true);
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotalPages, setAuditTotalPages] = useState(1);

  const loadAuditLogs = useCallback(async (page: number) => {
    setLoadingAudit(true);
    try {
      const payload = (await companyAdminApiRequest(
        `/api/company/audit-logs?page=${page}&limit=15`,
      )) as { data?: { logs?: AuditLogRow[]; total_pages?: number } };
      const data = normalizeResponseData(payload) as { logs?: AuditLogRow[]; total_pages?: number };
      setAuditLogs(data.logs ?? []);
      setAuditTotalPages(data.total_pages ?? 1);
    } catch {
      setAuditLogs([]);
    } finally {
      setLoadingAudit(false);
    }
  }, []);

  const loadPerformance = useCallback(async () => {
    setLoadingPerformance(true);
    try {
      const payload = (await companyAdminApiRequest("/api/company/employees?limit=50")) as {
        data?: { employees?: Record<string, unknown>[] };
      };
      const data = normalizeResponseData(payload) as { employees?: Record<string, unknown>[] };
      const rows = (data.employees ?? []).map((row) => {
        const mapped = mapEmployeeRow(row);
        return {
          id: mapped.id,
          name: mapped.name,
          role: mapped.role,
          activity: mapped.activity,
        };
      });
      setPerformanceRows(rows.sort((a, b) => b.activity.views - a.activity.views));
    } catch {
      setPerformanceRows([]);
    } finally {
      setLoadingPerformance(false);
    }
  }, []);

  useEffect(() => {
    void loadAuditLogs(auditPage);
  }, [auditPage, loadAuditLogs]);

  useEffect(() => {
    void loadPerformance();
  }, [loadPerformance]);

  return (
    <div className="space-y-8">
      <section>
        <h4 className="text-sm font-bold text-gray-900 mb-3">Audit Trail</h4>
        {loadingAudit ? (
          <div className="flex justify-center py-8"><InlineLoader /></div>
        ) : auditLogs.length === 0 ? (
          <p className="text-sm text-gray-500">No audit activity recorded yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Member</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => (
                  <tr key={log.log_id} className="border-t border-gray-100">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                      {format(new Date(log.created_at), "MMM d, yyyy h:mm a")}
                    </td>
                    <td className="px-3 py-2">
                      <p className="font-medium text-gray-900">{log.actor_name}</p>
                      <p className="text-xs text-gray-500">
                        {log.is_co_admin ? "Co-Admin" : log.role}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-gray-700">{log.action.replace(/[._]/g, " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {auditTotalPages > 1 && (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={auditPage <= 1}
              onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-xs text-gray-500">Page {auditPage} of {auditTotalPages}</span>
            <button
              type="button"
              disabled={auditPage >= auditTotalPages}
              onClick={() => setAuditPage((p) => p + 1)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </section>

      <section>
        <h4 className="text-sm font-bold text-gray-900 mb-3">Team Performance</h4>
        {loadingPerformance ? (
          <div className="flex justify-center py-8"><InlineLoader /></div>
        ) : performanceRows.length === 0 ? (
          <p className="text-sm text-gray-500">No performance data available.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">Member</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Views</th>
                  <th className="px-3 py-2">Leads</th>
                  <th className="px-3 py-2">Inquiries</th>
                </tr>
              </thead>
              <tbody>
                {performanceRows.map((row) => (
                  <tr key={row.id} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-medium text-gray-900">{row.name}</td>
                    <td className="px-3 py-2 capitalize text-gray-600">{row.role}</td>
                    <td className="px-3 py-2 text-gray-700">{row.activity.views}</td>
                    <td className="px-3 py-2 text-gray-700">{row.activity.leads}</td>
                    <td className="px-3 py-2 text-gray-700">{row.activity.inquiries}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
