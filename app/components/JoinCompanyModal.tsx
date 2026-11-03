"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, Globe, Lock, Search } from "lucide-react";
import { InlineLoader } from "./Loader";
import { ModalPortal } from "./ModalPortal";
import { getFrontendApiBaseUrl } from "./apiBase";
import { csrfClient } from "@/lib/csrf-client";

const USER_SYNC_EVENT = "ontap:user-sync";
const SEARCH_DEBOUNCE_MS = 400;

export type SearchCompany = {
  company_id: string;
  name: string;
  is_public: boolean;
  logo_url?: string | null;
  description?: string | null;
};

type JoinCompanyModalProps = {
  open: boolean;
  onClose: () => void;
  onSuccess?: (message: string) => void;
  apiBase?: string;
};

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const root = payload as Record<string, unknown>;
  const err = root.error;
  if (err && typeof err === "object") {
    const msg = String((err as Record<string, unknown>).message ?? "").trim();
    if (msg) return msg;
  }
  const data = root.data;
  if (data && typeof data === "object") {
    const msg = String((data as Record<string, unknown>).message ?? "").trim();
    if (msg) return msg;
  }
  return String(root.message ?? fallback);
}

export default function JoinCompanyModal({
  open,
  onClose,
  onSuccess,
  apiBase = getFrontendApiBaseUrl(),
}: JoinCompanyModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [companies, setCompanies] = useState<SearchCompany[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [selectedCompany, setSelectedCompany] = useState<SearchCompany | null>(null);
  const [securityCode, setSecurityCode] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  const resetState = useCallback(() => {
    setSearchQuery("");
    setDebouncedQuery("");
    setCompanies([]);
    setSearchLoading(false);
    setSearchError("");
    setSelectedCompany(null);
    setSecurityCode("");
    setSubmitError("");
    setSubmitting(false);
    setSuccessMessage("");
  }, []);

  useEffect(() => {
    if (!open) {
      resetState();
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, resetState]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchQuery, open]);

  useEffect(() => {
    if (!open) return;

    if (debouncedQuery.length < 2) {
      setCompanies([]);
      setSearchError("");
      setSearchLoading(false);
      return;
    }

    let active = true;
    const runSearch = async () => {
      setSearchLoading(true);
      setSearchError("");
      try {
        const params = new URLSearchParams({
          q: debouncedQuery,
          limit: "10",
        });
        const response = await fetch(`${apiBase}/api/company/search?${params.toString()}`, {
          credentials: "include",
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (!active) return;

        if (!response.ok) {
          setCompanies([]);
          setSearchError(extractErrorMessage(payload, "Unable to search companies."));
          return;
        }

        const data =
          payload && typeof payload === "object" && payload.data && typeof payload.data === "object"
            ? (payload.data as Record<string, unknown>)
            : payload;
        const rows = Array.isArray(data?.companies) ? data.companies : [];
        setCompanies(
          rows.map((row: Record<string, unknown>) => {
            const item = row;
            return {
              company_id: String(item.company_id ?? ""),
              name: String(item.name ?? ""),
              is_public: Boolean(item.is_public),
              logo_url: (item.logo_url ?? null) as string | null,
              description: (item.description ?? null) as string | null,
            };
          }),
        );
      } catch {
        if (!active) return;
        setCompanies([]);
        setSearchError("Unable to search companies. Please try again.");
      } finally {
        if (active) setSearchLoading(false);
      }
    };

    void runSearch();
    return () => {
      active = false;
    };
  }, [debouncedQuery, open, apiBase]);

  const handleSelectCompany = (company: SearchCompany) => {
    setSelectedCompany(company);
    setSecurityCode("");
    setSubmitError("");
    setSuccessMessage("");
  };

  const handleSubmitJoin = async () => {
    if (!selectedCompany) return;

    if (!selectedCompany.is_public && !securityCode.trim()) {
      setSubmitError("Security code is required for private companies.");
      return;
    }

    setSubmitting(true);
    setSubmitError("");

    try {
      const body: Record<string, string> = {
        company_id: selectedCompany.company_id,
      };
      if (securityCode.trim()) {
        body.security_code = securityCode.trim();
      }

      const authToken =
        typeof window !== "undefined"
          ? window.localStorage.getItem("auth_token") ||
            window.sessionStorage.getItem("auth_token")
          : null;
      const csrfToken = await csrfClient.getToken(false, apiBase || undefined);

      const response = await fetch(`${apiBase}/api/company/join`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        },
        body: JSON.stringify(body),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setSubmitError(extractErrorMessage(payload, "Unable to send join request."));
        return;
      }

      const data =
        payload && typeof payload === "object" && payload.data && typeof payload.data === "object"
          ? (payload.data as Record<string, unknown>)
          : payload && typeof payload === "object"
            ? (payload as Record<string, unknown>)
            : null;

      const message = String(
        data?.message ??
          (data?.status === "pending"
            ? "Your join request has been sent for review."
            : "You have successfully joined the company."),
      );

      setSuccessMessage(message);
      window.dispatchEvent(new CustomEvent(USER_SYNC_EVENT));
      onSuccess?.(message);

      window.setTimeout(() => {
        onClose();
      }, 1800);
    } catch {
      setSubmitError("Unable to send join request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <ModalPortal isOpen={open} onClose={onClose}>
      <div className="w-full max-w-lg rounded-3xl border border-gray-100 bg-white shadow-2xl shadow-black/20">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-5">
          <div>
            <h3 className="text-xl font-extrabold text-gray-900 tracking-tight">Join Company</h3>
            <p className="text-sm text-gray-500 mt-1">
              Search for a company and send a join request.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gray-50 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
            aria-label="Close join company modal"
          >
            <span className="text-2xl leading-none">×</span>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {successMessage ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {successMessage}
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setSelectedCompany(null);
                    setSubmitError("");
                  }}
                  placeholder="Search company name..."
                  className="h-11 w-full rounded-xl border border-gray-200 pl-10 pr-3 text-sm text-gray-700 outline-none transition-colors focus:border-[#4785B8]"
                  autoFocus
                />
              </div>

              {searchQuery.trim().length > 0 && searchQuery.trim().length < 2 && (
                <p className="text-xs text-gray-500">Type at least 2 characters to search.</p>
              )}

              {searchLoading && (
                <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                  <InlineLoader />
                  Searching companies...
                </div>
              )}

              {searchError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {searchError}
                </div>
              )}

              {!searchLoading && debouncedQuery.length >= 2 && !searchError && companies.length === 0 && (
                <p className="text-sm text-gray-500 py-2">No companies found.</p>
              )}

              {!selectedCompany && companies.length > 0 && (
                <ul className="max-h-56 overflow-y-auto space-y-2">
                  {companies.map((company) => (
                    <li key={company.company_id}>
                      <button
                        type="button"
                        onClick={() => handleSelectCompany(company)}
                        className="w-full rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3 text-left transition-colors hover:border-[#4785B8]/40 hover:bg-[#F8FAFC]"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-gray-900 truncate">{company.name}</p>
                            {company.description && (
                              <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                                {company.description}
                              </p>
                            )}
                          </div>
                          <span
                            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${
                              company.is_public
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {company.is_public ? (
                              <>
                                <Globe className="h-3 w-3" />
                                Public
                              </>
                            ) : (
                              <>
                                <Lock className="h-3 w-3" />
                                Private
                              </>
                            )}
                          </span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {selectedCompany && (
                <div className="rounded-2xl border border-[#4785B8]/20 bg-[#F8FAFC] px-4 py-4 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-xl bg-[#2A4792]/10 flex items-center justify-center shrink-0">
                      <Building2 className="h-5 w-5 text-[#2A4792]" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-gray-900">{selectedCompany.name}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {selectedCompany.is_public
                          ? "Public company — you can send a join request without a security code."
                          : "Private company — enter the company security code to continue."}
                      </p>
                    </div>
                  </div>

                  {!selectedCompany.is_public && (
                    <div className="space-y-1.5">
                      <label className="text-sm font-semibold text-gray-700">
                        Company security code
                      </label>
                      <input
                        type="text"
                        value={securityCode}
                        onChange={(event) => {
                          setSecurityCode(event.target.value);
                          setSubmitError("");
                        }}
                        placeholder="Enter company key"
                        maxLength={32}
                        className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none transition-colors focus:border-[#4785B8]"
                      />
                    </div>
                  )}

                  {submitError && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {submitError}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCompany(null);
                        setSecurityCode("");
                        setSubmitError("");
                      }}
                      className="px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-600 hover:bg-white border border-gray-200"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSubmitJoin()}
                      disabled={submitting || (!selectedCompany.is_public && !securityCode.trim())}
                      className="ml-auto inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-[#2A4792] hover:bg-[#1e3578] disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {submitting && <InlineLoader />}
                      Send Join Request
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}
