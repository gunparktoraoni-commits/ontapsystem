  "use client";

  import { useCallback, useEffect, useMemo, useRef, useState } from "react";
  import { useRouter } from "next/navigation";
  import {
    Building2,
    ChevronDown,
    ChevronUp,
    Download,
    Filter,
    ImagePlus,
    Plus,
    Search,
    X,
    Ban,
    FileUser,
    Building,
    Pencil,
    Shield,
  } from "lucide-react";
import {
  PortalModal,
  PortalPageHeader,
  PortalPanel,
  PortalStatCard,
  PORTAL_ACCENTS,
} from "../components/ui";
import { CompanyLogoAvatar } from "./components/CompanyLogoAvatar";
import { CompanyImpersonateModal, type CompanyDetailData } from "./components/CompanyImpersonateModal";
import { CompanyRestrictConfirmModal } from "./components/CompanyRestrictConfirmModal";
import { CompanyAdminsModal } from "./components/CompanyAdminsModal";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import { persistImpersonationHandoff } from "@/app/lib/superadminImpersonationHandoff";
import { SkeletonLoader, InlineLoader } from "../../components/Loader";
import { toServableMediaSrc } from "@/app/lib/portfolioDisplay";
import { uploadCompanyLogoImage } from "@/app/lib/companyLogoUpload";
import { showConfirmDialog } from "@/app/components/ConfirmDialog";

type CompanyStatusFilter = "all" | "pending" | "active" | "rejected" | "restricted";
  type SubscriptionFilter = "all" | "basic" | "premium" | "enterprise";
  type SortBy = "company_name" | "current_employees" | "status";
  type SortDir = "asc" | "desc";
  type ExportFormat = "csv" | "xlsx";

  type ApiCompany = {
    company_id: string;
    company_name: string;
    company_slug: string | null;
    status: "pending" | "active" | "rejected" | string;
    subscription_tier: "basic" | "premium" | "enterprise" | string | null;
    current_employees: number;
    max_employees: number | null;
    approval_required: boolean;
    email: string | null;
    logo_url: string | null;
    created_at: string;
    approved_at: string | null;
    created_by: { user_id: string; name: string; email: string } | null;
    admin: { user_id: string; name: string; email: string } | null;
    counts: {
      employees: number;
      join_requests: number;
      name_change_requests: number;
    };
  };

  type CompanyDetailResponse = {
    success: boolean;
    data?: CompanyDetailData;
    error?: { message?: string };
    message?: string;
  };

  type CompaniesListResponse = {
    success: boolean;
    data?: {
      companies: ApiCompany[];
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };

      summary: {
        total_companies: number;
        status_breakdown: {
          pending: number;
          active: number;
          rejected: number;
          restricted?: number;
        };
      };
    };
    error?: { message?: string };
    message?: string;
  };


  const API_BASE_URL = getFrontendApiBaseUrl();
  const CSRF_COOKIE_NAME = "csrf-token";
  const COMPANY_APPROVE_ENDPOINT = "/api/company/approve";
  const IMPERSONATION_HANDOFF_COOKIE = "superadmin_impersonation_handoff";

  function toTitleCase(value: string): string {
    if (!value) return "N/A";
    return value
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  }

  function getStatusBadgeClass(status: string): string {
    if (status === "active") return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (status === "pending") return "bg-amber-50 text-amber-700 border-amber-200";
    if (status === "restricted") return "bg-slate-100 text-slate-700 border-slate-300";
    return "bg-rose-50 text-rose-700 border-rose-200";
  }


  function getSubscriptionBadgeClass(subscription: string | null): string {
    if (subscription === "enterprise") return "bg-violet-50 text-violet-700 border-violet-200";
    if (subscription === "premium") return "bg-sky-50 text-sky-700 border-sky-200";
    if (subscription === "basic") return "bg-amber-50 text-amber-700 border-amber-200";
    return "bg-slate-50 text-slate-700 border-slate-200";
  }


  function readCookie(name: string): string | null {
    if (typeof document === "undefined") return null;
    const match = document.cookie.match(
      new RegExp(`(?:^|; )${name.replace(/([.*+?^${}()|[\]\\])/g, "\\$1")}=([^;]*)`)
    );
    return match ? decodeURIComponent(match[1]) : null;
  }

  function readStoredToken(): string | null {
    const local = typeof window !== "undefined" ? window.localStorage : null;
    const session = typeof window !== "undefined" ? window.sessionStorage : null;
    return (
      local?.getItem("auth_token") ||
      local?.getItem("superadmin_token") ||
      session?.getItem("auth_token") ||
      session?.getItem("superadmin_token") ||
      null
    );
  }

  async function ensureCsrfToken(): Promise<string | null> {
    if (typeof window === "undefined") return null;
    const fromCookie = readCookie(CSRF_COOKIE_NAME);
    if (fromCookie) return fromCookie;

    try {
      const response = await fetch(`${API_BASE_URL}/api/csrf-token`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      if (!response.ok) {
        return readCookie(CSRF_COOKIE_NAME);
      }

      const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      const data = payload && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : null;
      const token =
        (payload && typeof payload.csrfToken === "string" && payload.csrfToken) ||
        (payload && typeof payload.csrf_token === "string" && payload.csrf_token) ||
        (payload && typeof payload.token === "string" && payload.token) ||
        (data && typeof data.csrfToken === "string" && data.csrfToken) ||
        null;

      return token?.trim() || readCookie(CSRF_COOKIE_NAME);
    } catch {
      return readCookie(CSRF_COOKIE_NAME);
    }
  }

  function extractErrorMessage(payload: unknown, fallback: string): string {
    if (!payload || typeof payload !== "object") return fallback;
    const objectPayload = payload as { error?: { message?: string } | string; message?: string };
    if (typeof objectPayload.error === "string") return objectPayload.error;
    if (objectPayload.error?.message) return objectPayload.error.message;
    if (objectPayload.message) return objectPayload.message;
    return fallback;
  }

  async function buildCompanyListAuthHeaders(method = "GET"): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const token = readStoredToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase())) {
      const csrf = await ensureCsrfToken();
      if (csrf) {
        headers["X-CSRF-Token"] = csrf;
        headers["x-csrf-token"] = csrf;
      }
    }
    return headers;
  }

  function extractImpersonationToken(payload: unknown): string | null {
    if (!payload || typeof payload !== "object") return null;
    const root = payload as Record<string, unknown>;
    const data = root.data;
    if (!data || typeof data !== "object") return null;
    const record = data as Record<string, unknown>;
    for (const key of ["impersonation_token", "impersonationToken", "token"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return null;
  }

  function buildImpersonationEnterUrl(companyId: string | undefined, handoffToken: string | null): string {
    const params = new URLSearchParams();
    if (companyId) params.set("companyId", companyId);
    const query = params.toString();
    const base = query ? `/superadmin/impersonate/enter?${query}` : "/superadmin/impersonate/enter";
    return handoffToken ? `${base}#handoff=${encodeURIComponent(handoffToken)}` : base;
  }


  export default function CompanyListPage() {
    const router = useRouter();
    const [companies, setCompanies] = useState<ApiCompany[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [searchInput, setSearchInput] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<CompanyStatusFilter>("all");
    const [subscriptionFilter, setSubscriptionFilter] = useState<SubscriptionFilter>("all");
    const [sortBy, setSortBy] = useState<SortBy>("company_name");
    const [sortDir, setSortDir] = useState<SortDir>("asc");
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(10);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCompanies, setTotalCompanies] = useState(0);
    const [statusBreakdown, setStatusBreakdown] = useState({ pending: 0, active: 0, rejected: 0 });
    const [isExporting, setIsExporting] = useState(false);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [showImpersonateModal, setShowImpersonateModal] = useState(false);
    const [showRestrictModal, setShowRestrictModal] = useState(false);
    const [showAdminsModal, setShowAdminsModal] = useState(false);
    const [impersonateLoading, setImpersonateLoading] = useState(false);
    const [impersonateStarting, setImpersonateStarting] = useState(false);
    const [restrictLoading, setRestrictLoading] = useState(false);
    const [directImpersonatingCompanyId, setDirectImpersonatingCompanyId] = useState<string | null>(null);
    const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
    const [selectedCompanyName, setSelectedCompanyName] = useState<string | null>(null);
    const [impersonatePayload, setImpersonatePayload] = useState<CompanyDetailData | null>(null);
    const [mutationLoading, setMutationLoading] = useState(false);

    const [createForm, setCreateForm] = useState({
      company_name: "",
      description: "",
      subscription_tier: "premium",
      logo_url: "",
    });
    const [createLogoUploading, setCreateLogoUploading] = useState(false);
    const createLogoInputRef = useRef<HTMLInputElement>(null);
    const [settingsForm, setSettingsForm] = useState({
      approval_required: false,
      settingsJson: "{\n  \"branding\": \"default\"\n}",
    });
    const [rejectReasonDraft, setRejectReasonDraft] = useState("");
    const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
    const [rejectReasonInput, setRejectReasonInput] = useState("");

    useEffect(() => {
      const timer = window.setTimeout(() => {
        setDebouncedSearch(searchInput.trim());
        setPage(1);
      }, 300);
      return () => window.clearTimeout(timer);
    }, [searchInput]);

    const fetchCompanies = useCallback(async () => {
      setLoading(true);
      setError(null);
      try {
        const token = readStoredToken();
        const params = new URLSearchParams({
          page: String(page),
          limit: String(limit),
          sort_by: sortBy,
          sort_dir: sortDir,
          status: statusFilter,
          subscription_tier: subscriptionFilter,
        });
        if (debouncedSearch) {
          params.set("search", debouncedSearch);
        }
        const response = await fetch(`${API_BASE_URL}/api/superadmin/companies?${params.toString()}`, {
          method: "GET",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        const payload = (await response.json()) as CompaniesListResponse;
        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(extractErrorMessage(payload, "Failed to load companies."));
        }
        setCompanies(payload.data.companies);
        setTotalPages(payload.data.pagination.pages);
        setTotalCompanies(payload.data.pagination.total);
        setStatusBreakdown(payload.data.summary.status_breakdown);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed to load companies.");
        setCompanies([]);
      } finally {
        setLoading(false);
      }
    }, [debouncedSearch, limit, page, sortBy, sortDir, statusFilter, subscriptionFilter]);
    useEffect(() => {
      void fetchCompanies();
    }, [fetchCompanies]);
    useEffect(() => {
      if (!successMessage) return;
      const timer = window.setTimeout(() => setSuccessMessage(null), 3500);
      return () => window.clearTimeout(timer);
    }, [successMessage]);
    const summaryCards = useMemo(
      () => [
        { label: "Total Companies", value: totalCompanies, icon: Building2 },
        { label: "Active Companies", value: statusBreakdown.active, icon: Building },
        { label: "Pending Approvals", value: statusBreakdown.pending, icon: FileUser },
      ],
      [statusBreakdown.active, statusBreakdown.pending, totalCompanies]
    );
    async function performExport(format: ExportFormat): Promise<void> {
      setIsExporting(true);
      setError(null);
      try {
        const token = readStoredToken();
        const params = new URLSearchParams({
          format,
          status: statusFilter,
          subscription_tier: subscriptionFilter,
        });
        if (debouncedSearch) {
          params.set("search", debouncedSearch);
        }
        const response = await fetch(`${API_BASE_URL}/api/superadmin/companies/export?${params.toString()}`, {
          method: "GET",
          credentials: "include",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!response.ok) {
          let payload: unknown = null;
          try {
            payload = await response.json();
          } catch {
            payload = null;
          }
          throw new Error(extractErrorMessage(payload, "Export failed. Please try again."));
        }
        const blob = await response.blob();
        const disposition = response.headers.get("Content-Disposition") ?? "";
        const match = disposition.match(/filename="?(.*?)"?$/i);
        const filename = match?.[1] || `companies_export.${format}`;
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        window.URL.revokeObjectURL(url);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Export failed. Please try again.");
      } finally {
        setIsExporting(false);
      }
    }
    async function openImpersonateModal(companyId: string, companyName: string): Promise<void> {
      setSelectedCompanyId(companyId);
      setSelectedCompanyName(companyName);
      setImpersonatePayload(null);
      setShowImpersonateModal(true);
      setImpersonateLoading(true);
      setError(null);
      try {
        const token = readStoredToken();
        const response = await fetch(`${API_BASE_URL}/api/superadmin/companies/${companyId}`, {
          method: "GET",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        const payload = (await response.json()) as CompanyDetailResponse;
        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(extractErrorMessage(payload, "Failed to fetch company details."));
        }
        setImpersonatePayload(payload.data);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed to fetch company details.");
        setShowImpersonateModal(false);
      } finally {
        setImpersonateLoading(false);
      }
    }

    function openAdminsModal(companyId: string, companyName: string): void {
      setSelectedCompanyId(companyId);
      setSelectedCompanyName(companyName);
      setShowAdminsModal(true);
      setError(null);
    }

    async function startImpersonation(): Promise<void> {
      const adminUserId = impersonatePayload?.company.admin?.user_id;
      if (!adminUserId) return;
      setImpersonateStarting(true);
      setError(null);
      try {
        const token = readStoredToken();
        const csrfToken = await ensureCsrfToken();
        const response = await fetch(`${API_BASE_URL}/api/superadmin/companies/impersonation/start`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
          },
          body: JSON.stringify({
            target_user_id: Number(adminUserId),
            reason: "Superadmin company impersonation from company detail",
            ttl_minutes: 120,
          }),
        });
        const payload = (await response.json()) as {
          success?: boolean;
          data?: { impersonation_token?: string; impersonationToken?: string; token?: string };
          error?: { message?: string };
          message?: string;
        };
        if (!response.ok || !payload.success) {
          throw new Error(extractErrorMessage(payload, "Failed to start impersonation."));
        }
        const impersonationToken =
          extractImpersonationToken(payload) ||
          readCookie(IMPERSONATION_HANDOFF_COOKIE);
        const companyId = impersonatePayload?.company.company_id;
        if (impersonationToken) {
          persistImpersonationHandoff(impersonationToken, companyId);
        }
        setShowImpersonateModal(false);
        window.location.assign(buildImpersonationEnterUrl(companyId, impersonationToken));
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed to start impersonation.");
      } finally {
        setImpersonateStarting(false);
      }
    }

    // ── Direct impersonation from Edit icon (no modal) ───────────────────────
    // Fetches the company's admin user_id silently then immediately starts the
    // impersonation session — no intermediate CompanyImpersonateModal is shown.
    async function directImpersonateCompany(company: ApiCompany): Promise<void> {
      const adminUserId = company.admin?.user_id;
      if (!adminUserId) {
        setError("This company has no assigned primary administrator. Impersonation is unavailable.");
        return;
      }
      if (company.status !== "active") {
        setError(`Cannot impersonate a company that is ${company.status}.`);
        return;
      }
      setDirectImpersonatingCompanyId(company.company_id);
      setError(null);
      try {
        const token = readStoredToken();
        const csrfToken = await ensureCsrfToken();
        const response = await fetch(`${API_BASE_URL}/api/superadmin/companies/impersonation/start`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
          },
          body: JSON.stringify({
            target_user_id: Number(adminUserId),
            reason: "Superadmin direct company impersonation via Edit icon",
            ttl_minutes: 120,
          }),
        });
        const payload = (await response.json()) as {
          success?: boolean;
          data?: { impersonation_token?: string; impersonationToken?: string; token?: string };
          error?: { message?: string };
          message?: string;
        };
        if (!response.ok || !payload.success) {
          throw new Error(extractErrorMessage(payload, "Failed to start impersonation."));
        }
        const impersonationToken =
          extractImpersonationToken(payload) ||
          readCookie(IMPERSONATION_HANDOFF_COOKIE);
        if (impersonationToken) {
          persistImpersonationHandoff(impersonationToken, company.company_id);
        }
        window.location.assign(buildImpersonationEnterUrl(company.company_id, impersonationToken));
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed to start impersonation.");
        setDirectImpersonatingCompanyId(null);
      }
    }

    function openRestrictModal(companyId: string, companyName: string): void {
      setSelectedCompanyId(companyId);
      setSelectedCompanyName(companyName);
      setShowRestrictModal(true);
    }

    async function restrictCompany(): Promise<void> {
      if (!selectedCompanyId) return;
      setRestrictLoading(true);
      setError(null);
      try {
        const token = readStoredToken();
        const response = await fetch(`${API_BASE_URL}/api/superadmin/companies/${selectedCompanyId}/restrict`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        const payload = (await response.json()) as { success?: boolean; error?: { message?: string }; message?: string };
        if (!response.ok || !payload.success) {
          throw new Error(extractErrorMessage(payload, "Failed to restrict company."));
        }
        setShowRestrictModal(false);
        setSuccessMessage("Company restricted and all associated accounts suspended.");
        await fetchCompanies();
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed to restrict company.");
      } finally {
        setRestrictLoading(false);
      }
    }

    async function openEditSettings(companyId: string): Promise<void> {
      setSelectedCompanyId(companyId);
      setMutationLoading(true);
      setError(null);
      try {
        const token = readStoredToken();
        const response = await fetch(`${API_BASE_URL}/api/superadmin/companies/${companyId}`, {
          method: "GET",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        const payload = (await response.json()) as CompanyDetailResponse;
        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(extractErrorMessage(payload, "Failed to fetch editable settings."));
        }
        setSettingsForm({
          approval_required: payload.data.company.approval_required,
          settingsJson: JSON.stringify(payload.data.company.settings || {}, null, 2),
        });
        setShowSettingsModal(true);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed to fetch editable settings.");
      } finally {
        setMutationLoading(false);
      }
    }
    async function updateCompanySettings(): Promise<void> {
      if (!selectedCompanyId) return;
      setMutationLoading(true);
      setError(null);
      try {
        const token = readStoredToken();
        let parsedSettings: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(settingsForm.settingsJson);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("Settings JSON must be an object.");
          }
          parsedSettings = parsed as Record<string, unknown>;
        } catch (parseError) {
          throw new Error(parseError instanceof Error ? parseError.message : "Invalid settings JSON.");
        }
        const response = await fetch(`${API_BASE_URL}/api/superadmin/companies/${selectedCompanyId}/settings`, {
          method: "PUT",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            settings: parsedSettings,
            approval_required: settingsForm.approval_required,
          }),
        });
        const payload = (await response.json()) as { success?: boolean; error?: { message?: string }; message?: string };
        if (!response.ok || !payload.success) {
          throw new Error(extractErrorMessage(payload, "Failed to update company settings."));
        }
        setShowSettingsModal(false);
        setSuccessMessage("Company settings updated successfully.");
        await fetchCompanies();
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed to update company settings.");
      } finally {
        setMutationLoading(false);
      }
    }
    async function handleCreateLogoSelected(
      event: React.ChangeEvent<HTMLInputElement>,
    ): Promise<void> {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;

      setCreateLogoUploading(true);
      setError(null);
      try {
        const token = readStoredToken();
        const headers = new Headers();
        if (token) headers.set("Authorization", `Bearer ${token}`);
        const csrfToken = await ensureCsrfToken();
        if (csrfToken) headers.set("X-CSRF-Token", csrfToken);

        const uploadedUrl = await uploadCompanyLogoImage(file, {
          apiBaseUrl: API_BASE_URL,
          headers,
        });
        setCreateForm((prev) => ({ ...prev, logo_url: uploadedUrl }));
      } catch (uploadError) {
        setError(
          uploadError instanceof Error
            ? uploadError.message
            : "Failed to upload company logo.",
        );
      } finally {
        setCreateLogoUploading(false);
      }
    }
    async function createCompanyRequest(): Promise<void> {
      setMutationLoading(true);
      setError(null);
      try {
        const token = readStoredToken();
        const response = await fetch(`${API_BASE_URL}/api/company/create`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            company_name: createForm.company_name.trim(),
            description: createForm.description.trim(),
            logo_url: createForm.logo_url.trim() || undefined,
            subscription_tier: createForm.subscription_tier,
          }),
        });
        const payload = (await response.json()) as { success?: boolean; error?: { message?: string }; message?: string };
        if (!response.ok || !payload.success) {
          throw new Error(extractErrorMessage(payload, "Failed to create company request."));
        }
        setShowCreateModal(false);
        setCreateForm({ company_name: "", description: "", subscription_tier: "premium", logo_url: "" });
        setSuccessMessage("Company request created successfully.");
        await fetchCompanies();
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed to create company request.");
      } finally {
        setMutationLoading(false);
      }
    }
    async function reviewPending(companyId: string, action: "approve" | "reject"): Promise<void> {
      setMutationLoading(true);
      setError(null);
      try {
        const token = readStoredToken();
        const csrfToken = await ensureCsrfToken();
        const body: { request_id: string; action: "approve" | "reject"; rejection_reason?: string } = {
          request_id: companyId,
          action,
        };
        if (action === "reject") {
          if (!rejectReasonDraft.trim()) {
            throw new Error("Rejection reason is required.");
          }
          body.rejection_reason = rejectReasonDraft.trim();
        }
        const response = await fetch(`${API_BASE_URL}${COMPANY_APPROVE_ENDPOINT}`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
          },
          body: JSON.stringify(body),
        });
        const payload = (await response.json()) as { success?: boolean; error?: { message?: string }; message?: string };
        if (!response.ok || !payload.success) {
          throw new Error(extractErrorMessage(payload, `Failed to ${action} company.`));
        }

        setRejectReasonDraft("");
        setSuccessMessage(`Company ${action}d successfully.`);
        await fetchCompanies();
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : `Failed to ${action} company.`);
      } finally {
        setMutationLoading(false);
      }
    }
    async function handleDelete(companyId: string): Promise<void> {
      const confirmed = await showConfirmDialog({
        title: "Remove company from list?",
        message:
          "Company deletion is not available yet. This will only remove the company from your current view until the backend supports permanent deletion.",
        confirmLabel: "Remove from list",
        variant: "warning",
      });
      if (!confirmed) return;
      setError(null);
      setCompanies((current) => current.filter((company) => company.company_id !== companyId));
      setSuccessMessage("Company removed from the current list. The company remains in the system.");
      if (companies.length === 1 && page > 1) {
        setPage((current) => Math.max(1, current - 1));
      }
    }
    function toggleSort(field: SortBy): void {
      if (field === sortBy) {
        setSortDir((previous) => (previous === "asc" ? "desc" : "asc"));
      } else {
        setSortBy(field);
        setSortDir("asc");
      }
      setPage(1);
    }
    function renderSortIcon(field: SortBy): React.ReactNode {
      if (sortBy !== field) {
        return <ChevronDown className="h-4 w-4 text-[#9aa8c9]" />;
      }
      return sortDir === "asc" ? (
        <ChevronUp className="h-4 w-4 text-primary" />
      ) : (
        <ChevronDown className="h-4 w-4 text-primary" />
      );
    }
    const canGoPrev = page > 1;
    const canGoNext = page < totalPages;
    return (
      <section className="space-y-5 sm:space-y-6">
        <PortalPageHeader
          title="Company List"
          subtitle="Fully connected to Super Admin Companies API."
          actions={
            <>
              <button
                type="button"
                disabled={isExporting}
                onClick={() => void performExport("csv")}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                {isExporting ? "Exporting..." : "Export CSV"}
              </button>
              <button
                type="button"
                disabled={isExporting}
                onClick={() => void performExport("xlsx")}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                {isExporting ? "Exporting..." : "Export XLSX"}
              </button>
              <button
                type="button"
                onClick={() => router.push("/superadmin/company-creation-requests")}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-gray-50"
              >
                Pending Requests
              </button>
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
              >
                <Plus className="h-4 w-4" />
                Add Company
              </button>
            </>
          }
        />
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}
        {successMessage && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {successMessage}
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-5">
          {summaryCards.map((card, index) => (
            <PortalStatCard
              key={card.label}
              label={card.label}
              value={card.value.toLocaleString()}
              icon={card.icon}
              accent={
                index === 0
                  ? PORTAL_ACCENTS.companies
                  : index === 1
                    ? PORTAL_ACCENTS.revenue
                    : PORTAL_ACCENTS.warning
              }
            />
          ))}
        </div>
        <PortalPanel title="Companies" padding="md">
          <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-5">
            <div className="relative lg:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search by company, email, slug, description..."
                className="w-full rounded-lg border border-gray-100 bg-white py-2.5 pl-9 pr-3 text-sm text-gray-900 outline-none"
              />
            </div>
            <div className="relative">
              <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <select
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value as CompanyStatusFilter);
                  setPage(1);
                }}
                className="w-full rounded-lg border border-gray-100 bg-white py-2.5 pl-9 pr-3 text-sm text-gray-900 outline-none"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="rejected">Rejected</option>
                <option value="restricted">Restricted</option>
              </select>
            </div>
            <div className="relative">
              <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <select
                value={subscriptionFilter}
                onChange={(event) => {
                  setSubscriptionFilter(event.target.value as SubscriptionFilter);
                  setPage(1);
                }}
                className="w-full rounded-lg border border-gray-100 bg-white py-2.5 pl-9 pr-3 text-sm text-gray-900 outline-none"
              >
                <option value="all">All Plans</option>
                <option value="basic">Basic</option>
                <option value="premium">Premium</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <select
              value={limit}
              onChange={(event) => {
                setLimit(Number(event.target.value));
                setPage(1);
              }}
              className="w-full rounded-lg border border-gray-100 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none"
            >
              <option value={10}>10 rows</option>
              <option value={20}>20 rows</option>
              <option value={50}>50 rows</option>
            </select>
          </div>
          <div className="overflow-x-auto rounded-xl border border-[#e2e9f6]">
            <table className="min-w-[900px] w-full border-collapse">
              <thead className="bg-[#f8fbff]">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">
                    <button type="button" onClick={() => toggleSort("company_name")} className="inline-flex items-center gap-1">
                      COMPANY {renderSortIcon("company_name")}
                    </button>
                  </th>
                  <th className="px-4 py-3">Admin</th>
                  <th className="px-4 py-3">
                    <button type="button" onClick={() => toggleSort("current_employees")} className="inline-flex items-center gap-1">
                      EMPLOYEES {renderSortIcon("current_employees")}
                    </button>
                  </th>
                  <th className="px-4 py-3">Subscription</th>
                  <th className="px-4 py-3">
                    <button type="button" onClick={() => toggleSort("status")} className="inline-flex items-center gap-1">
                      Status {renderSortIcon("status")}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {loading ? (
                  Array.from({ length: Math.min(limit, 6) }).map((_, index) => (
                    <tr key={`skeleton-${index}`} className="border-t border-[#eef3ff]">
                      <td colSpan={6} className="px-4 py-4">
                        <SkeletonLoader width="w-full" height="h-4" className="rounded" />
                      </td>
                    </tr>
                  ))
                ) : companies.length ? (
                  companies.map((company, index) => (
                    <tr key={company.company_id} className={`border-t border-[#eef3ff] text-sm ${index % 2 ? "bg-[#fcfdff]" : "bg-white"}`}>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <CompanyLogoAvatar
                            name={company.company_name}
                            logoUrl={company.logo_url}
                            className="h-12 w-12 aspect-square rounded-xl object-cover ring-1 ring-[#d7e3f3]"
                          />
                          <div>
                            <button
                              type="button"
                              title="View company details"
                              onClick={() => void openImpersonateModal(company.company_id, company.company_name)}
                              className="text-left font-semibold text-gray-900 hover:text-primary focus:outline-none focus-visible:underline"
                            >
                              {company.company_name}
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <p className="font-medium text-gray-900">{company.admin?.name || company.created_by?.name || "Unassigned"}</p>
                        <p className="text-xs text-gray-500">{company.admin?.email || company.created_by?.email || company.email || "N/A"}</p>
                      </td>
                      <td className="px-4 py-4 font-semibold text-gray-900">
                        {(company.counts?.employees ?? company.current_employees).toLocaleString()}
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getSubscriptionBadgeClass(company.subscription_tier)}`}>
                          {toTitleCase(company.subscription_tier || "none")}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getStatusBadgeClass(company.status)}`}>
                          {toTitleCase(company.status)}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center justify-end gap-2">
                          {company.status === "pending" ? (
                            <>
                              <button
                                type="button"
                                disabled={mutationLoading}
                                title="Approve"
                                onClick={() => void reviewPending(company.company_id, "approve")}
                                className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 disabled:opacity-50"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                disabled={mutationLoading}
                                title="Reject"
                                onClick={() => {
                                  setRejectTargetId(company.company_id);
                                  setRejectReasonInput("");
                                }}
                                className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-50"
                              >
                                Reject
                              </button>
                            </>
                          ) : null}
                          <button
                            type="button"
                            title="Manage company admins"
                            disabled={company.status === "pending" || company.status === "rejected"}
                            onClick={(e) => {
                              e.stopPropagation();
                              openAdminsModal(company.company_id, company.company_name);
                            }}
                            className="rounded-lg border border-violet-200 bg-violet-50 p-2 text-violet-700 transition-colors hover:bg-violet-100 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 disabled:border-gray-100"
                          >
                            <Shield className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            title="Impersonate company admin"
                            disabled={
                              company.status !== "active" ||
                              !company.admin?.user_id ||
                              directImpersonatingCompanyId === company.company_id
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              void directImpersonateCompany(company);
                            }}
                            className="rounded-lg border border-[#c8ddf6] bg-[#eef6ff] p-2 text-[#3a6fcf] transition-colors hover:bg-[#d8ecff] hover:text-[#2a5cbf] disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 disabled:border-gray-100"
                          >
                            {directImpersonatingCompanyId === company.company_id ? (
                              <InlineLoader className="text-[#3a6fcf]" />
                            ) : (
                              <Pencil className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            title="Restrict"
                            disabled={company.status === "restricted" || restrictLoading}
                            onClick={() => openRestrictModal(company.company_id, company.company_name)}
                            className="rounded-lg border border-gray-100 bg-white p-2 text-gray-900 hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
                          >
                            <Ban className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr className="border-t border-[#eef3ff]">
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-500">
                      No companies found for the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-gray-500">
              Page <span className="font-semibold text-gray-900">{page}</span> of{" "}
              <span className="font-semibold text-gray-900">{totalPages}</span> ·{" "}
              <span className="font-semibold text-gray-900">{totalCompanies.toLocaleString()}</span> total
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!canGoPrev}
                onClick={() => setPage((previous) => Math.max(1, previous - 1))}
                className="rounded-md border border-gray-100 px-3 py-1.5 text-sm font-semibold text-gray-900 disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={!canGoNext}
                onClick={() => setPage((previous) => Math.min(totalPages, previous + 1))}
                className="rounded-md border border-gray-100 px-3 py-1.5 text-sm font-semibold text-gray-900 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </PortalPanel>
        <CompanyImpersonateModal
          open={showImpersonateModal}
          loading={impersonateLoading}
          starting={impersonateStarting}
          data={impersonatePayload}
          onClose={() => setShowImpersonateModal(false)}
          onStartImpersonation={() => void startImpersonation()}
          toTitleCase={toTitleCase}
        />
        <CompanyAdminsModal
          open={showAdminsModal}
          companyId={selectedCompanyId}
          companyName={selectedCompanyName}
          onClose={() => setShowAdminsModal(false)}
          apiBaseUrl={API_BASE_URL}
          buildAuthHeaders={buildCompanyListAuthHeaders}
          extractErrorMessage={extractErrorMessage}
          onChanged={() => void fetchCompanies()}
          onSuccessMessage={(message) => setSuccessMessage(message)}
          onErrorMessage={(message) => setError(message)}
        />
        <CompanyRestrictConfirmModal
          open={showRestrictModal}
          companyName={selectedCompanyName}
          loading={restrictLoading}
          onClose={() => setShowRestrictModal(false)}
          onConfirm={() => void restrictCompany()}
        />
        <PortalModal
          open={Boolean(rejectTargetId)}
          onClose={() => setRejectTargetId(null)}
          title="Reject Company"
          description="Provide a reason for rejecting this company request."
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectTargetId(null)}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={mutationLoading || !rejectReasonInput.trim()}
                onClick={() => {
                  if (!rejectTargetId) return;
                  setRejectReasonDraft(rejectReasonInput.trim());
                  void reviewPending(rejectTargetId, "reject").then(() => {
                    setRejectTargetId(null);
                    setRejectReasonInput("");
                  });
                }}
                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                Reject Company
              </button>
            </div>
          }
        >
          <textarea
            value={rejectReasonInput}
            onChange={(e) => setRejectReasonInput(e.target.value)}
            rows={4}
            placeholder="Rejection reason..."
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </PortalModal>
        {showCreateModal && (
          <PortalModal
            open={showCreateModal}
            onClose={() => setShowCreateModal(false)}
            title="Add Company"
            size="lg"
            preventClose={mutationLoading}
            footer={
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowCreateModal(false)} className="rounded-lg border border-gray-100 px-4 py-2 text-sm font-semibold">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={mutationLoading || !createForm.company_name.trim()}
                  onClick={() => void createCompanyRequest()}
                  className="rounded-lg border border-primary bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {mutationLoading ? "Saving..." : "Create"}
                </button>
              </div>
            }
          >
            <div className="space-y-3">
              <input
                value={createForm.company_name}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, company_name: event.target.value }))}
                placeholder="Company name"
                className="w-full rounded-lg border border-gray-100 px-3 py-2.5 text-sm"
              />
              <textarea
                value={createForm.description}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="Description"
                rows={3}
                className="w-full rounded-lg border border-gray-100 px-3 py-2.5 text-sm"
              />
              <div className="rounded-lg border border-gray-100 p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-100 bg-gray-50">
                    {createForm.logo_url.trim() ? (
                      <img
                        src={toServableMediaSrc(createForm.logo_url.trim())}
                        alt="Company logo preview"
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <Building2 className="h-6 w-6 text-gray-300" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-800">Company profile image</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => createLogoInputRef.current?.click()}
                        disabled={createLogoUploading || mutationLoading}
                        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        {createLogoUploading ? (
                          <>
                            <InlineLoader />
                            Uploading…
                          </>
                        ) : (
                          <>
                            <ImagePlus className="h-4 w-4" />
                            {createForm.logo_url.trim() ? "Replace image" : "Upload image"}
                          </>
                        )}
                      </button>
                      {createForm.logo_url.trim() && !createLogoUploading && (
                        <button
                          type="button"
                          onClick={() => setCreateForm((prev) => ({ ...prev, logo_url: "" }))}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                        >
                          <X className="h-3.5 w-3.5" />
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <input
                  ref={createLogoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={(event) => void handleCreateLogoSelected(event)}
                />
                <input
                  value={createForm.logo_url}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, logo_url: event.target.value }))}
                  placeholder="Or paste an image URL (optional)"
                  className="mt-2 w-full rounded-lg border border-gray-100 px-3 py-2 text-sm"
                />
              </div>
              <select
                value={createForm.subscription_tier}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, subscription_tier: event.target.value }))}
                className="w-full rounded-lg border border-gray-100 px-3 py-2.5 text-sm"
              >
                <option value="basic">Basic</option>
                <option value="premium">Premium</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
          </PortalModal>
        )}

        {showSettingsModal && (
          <PortalModal
            open={showSettingsModal}
            onClose={() => setShowSettingsModal(false)}
            title="Edit Company Settings"
            size="lg"
            preventClose={mutationLoading}
            footer={
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowSettingsModal(false)} className="rounded-lg border border-gray-100 px-4 py-2 text-sm font-semibold">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={mutationLoading}
                  onClick={() => void updateCompanySettings()}
                  className="rounded-lg border border-primary bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {mutationLoading ? "Saving..." : "Save Settings"}
                </button>
              </div>
            }
          >
            <label className="mb-3 flex items-center gap-2 text-sm text-gray-900">
              <input
                type="checkbox"
                checked={settingsForm.approval_required}
                onChange={(event) => setSettingsForm((prev) => ({ ...prev, approval_required: event.target.checked }))}
              />
              Approval required
            </label>
            <textarea
              value={settingsForm.settingsJson}
              onChange={(event) => setSettingsForm((prev) => ({ ...prev, settingsJson: event.target.value }))}
              rows={10}
              className="w-full rounded-lg border border-gray-100 px-3 py-2.5 text-xs font-mono"
            />
          </PortalModal>
        )}
      </section>
    );
  }
