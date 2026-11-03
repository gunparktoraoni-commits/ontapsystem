"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import CompanyDashboardContent from "@/app/admin/company/components/CompanyDashboardContent";
import { companyAdminApiRequest, normalizeResponseData, type CompanyProfile } from "@/app/admin/lib/companyAdminApi";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import { SectionLoader } from "@/app/components/Loader";
import {
  buildImpersonationHeaders,
  readImpersonationCompanyId,
} from "@/app/lib/superadminImpersonationHandoff";
import { PortalPageHeader, PortalPanel } from "../../components/ui";

const API_BASE_URL = getFrontendApiBaseUrl();

type SessionResponse = {
  authenticated?: boolean;
  impersonation?: { active?: boolean };
};

export default function SuperadminImpersonatedCompanyPage() {
  const router = useRouter();
  const params = useParams();
  const routeCompanyId = String(params.companyId ?? "").trim();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const verifyImpersonationContext = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReady(false);
    try {
      const sessionRes = await fetch(`${API_BASE_URL}/api/auth/session`, {
        credentials: "include",
        cache: "no-store",
        headers: buildImpersonationHeaders(),
      });
      const session = (await sessionRes.json()) as SessionResponse;
      if (!session.authenticated || !session.impersonation?.active) {
        router.replace("/superadmin/company-list");
        return;
      }

      const storedCompanyId = readImpersonationCompanyId();
      if (storedCompanyId && storedCompanyId !== routeCompanyId) {
        router.replace(`/superadmin/company/${encodeURIComponent(storedCompanyId)}`);
        return;
      }

      const payload = (await companyAdminApiRequest("/api/company/my-company")) as {
        data?: CompanyProfile;
      } & CompanyProfile;
      const data = normalizeResponseData(payload) as CompanyProfile;
      if (!data.company_id || String(data.company_id) !== routeCompanyId) {
        setError("Company context does not match the impersonation session.");
        return;
      }

      setReady(true);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to load impersonated company workspace.",
      );
    } finally {
      setLoading(false);
    }
  }, [routeCompanyId, router]);

  useEffect(() => {
    void verifyImpersonationContext();
  }, [verifyImpersonationContext]);

  return (
    <section className="space-y-5 sm:space-y-6">
      <PortalPageHeader
        title="Company"
        subtitle="Super Admin impersonation — company workspace."
      />

      {loading ? (
        <PortalPanel>
          <SectionLoader text="Loading company workspace..." />
        </PortalPanel>
      ) : error ? (
        <PortalPanel>
          <div className="space-y-4">
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
            <button
              type="button"
              onClick={() => router.push("/superadmin/company-list")}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-primary hover:bg-gray-50"
            >
              Back to Company List
            </button>
          </div>
        </PortalPanel>
      ) : ready ? (
        <CompanyDashboardContent />
      ) : null}
    </section>
  );
}
