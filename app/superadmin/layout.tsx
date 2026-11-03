"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "./components/Sidebar";
import PortalHeader from "./components/PortalHeader";
import { getFrontendApiBaseUrl } from "../components/apiBase";
import {
  canAccessPath,
  getSafePortalRedirect,
  isCrossPortalPath,
  rememberPortalPath,
} from "../lib/portalAccess";
import { csrfClient } from "@/lib/csrf-client";
import {
  buildImpersonationHeaders,
  clearImpersonationHandoff,
  readImpersonationCompanyId,
  readImpersonationHandoffToken,
  readImpersonationUserId,
} from "@/app/lib/superadminImpersonationHandoff";
import { FullPageLoader } from "@/app/components/Loader";

const TITLES: Record<string, string> = {
  "/superadmin/dashboard": "Dashboard",
  "/superadmin/bizcard-list": "Generate BizCards",
  "/superadmin/user-bizcards": "User BizCards",
  "/superadmin/recycle-bin": "Recycle Bin",
  "/superadmin/bizcard": "BizCard Editor",
  "/superadmin/bizcard/create-new": "Create BizCard",
  "/superadmin/company-list": "Companies",
  "/superadmin/company-creation-requests": "Creation Requests",
  "/superadmin/client-list": "Users",
  "/superadmin/affiliate": "Affiliates",
  "/superadmin/subscription-transactions": "Subscription Transactions",
  "/superadmin/orders": "Orders",
  "/superadmin/support-escalations": "Support Escalations",
  "/superadmin/promos": "Promos & Deals",
  "/superadmin/missions-rewards": "Missions & Rewards",
  "/superadmin/manage-content": "Manage Content",
  "/superadmin/product": "Manage Content",
  "/superadmin/user-experience": "User Experience",
  "/superadmin/user-experience/feedback": "Feedback",
  "/superadmin/user-experience/feature-requests": "Feature Requests",
  "/superadmin/staff": "Staff",
  "/superadmin/calendar": "Calendar",
  "/superadmin/settings": "Settings",
};



function resolvePageTitle(pathname: string): string {
  if (/^\/superadmin\/company\/[^/]+/.test(pathname)) {
    return "Company";
  }
  if (/^\/superadmin\/user\/[^/]+/.test(pathname)) {
    return "User Workspace";
  }
  if (/^\/superadmin\/bizcard\/[^/]+/.test(pathname)) {
    return "BizCard Editor";
  }

  
  const match = Object.entries(TITLES).find(
    ([href]) => pathname === href || pathname.startsWith(`${href}/`),
  );
  return match?.[1] ?? "Super Admin";
}



function extractUserName(user: Record<string, unknown> | undefined): string {
  if (!user) return "Super Admin";
  const first = String(user.firstName ?? user.first_name ?? "").trim();
  const last = String(user.lastName ?? user.last_name ?? "").trim();
  const full = [first, last].filter(Boolean).join(" ").trim();
  return full || String(user.fullName ?? user.full_name ?? user.name ?? "Super Admin");
}


function readStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return (
    window.localStorage.getItem("auth_token") ||
    window.sessionStorage.getItem("auth_token") ||
    window.localStorage.getItem("superadmin_token") ||
    window.sessionStorage.getItem("superadmin_token") ||
    null
  );
}



function isImpersonationCompanyRoute(pathname: string): boolean {
  return /^\/superadmin\/company\/[^/]+/.test(pathname);
}

function isImpersonationUserRoute(pathname: string): boolean {
  return /^\/superadmin\/user\/[^/]+/.test(pathname);
}


export default function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;

}) {
  const pathname = usePathname();
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userRole, setUserRole] = useState("super_admin");
  const [userName, setUserName] = useState("Super Admin");
  const [userEmail, setUserEmail] = useState<string | undefined>();
  const [impersonationActive, setImpersonationActive] = useState(false);
  const [impersonationCompanyId, setImpersonationCompanyId] = useState<string | null>(null);
  const [endingImpersonation, setEndingImpersonation] = useState(false);
  const lastAllowedPathRef = useRef("/superadmin/dashboard");
  const API = getFrontendApiBaseUrl();
  const pageTitle = useMemo(() => resolvePageTitle(pathname), [pathname]);

  useEffect(() => {
    if (canAccessPath(userRole, pathname)) {
      lastAllowedPathRef.current = pathname;
      rememberPortalPath(userRole, pathname);
    }
  }, [pathname, userRole]);



  useEffect(() => {
    let cancelled = false;
    const validateSession = async () => {
      try {
        const res = await fetch(`${API}/api/auth/session`, {
          credentials: "include",
          cache: "no-store",
          headers: buildImpersonationHeaders(),
        });
        
        if (cancelled) return;
        if (!res.ok) {
          router.replace("/super-login");
          return;
        }

        const data = await res.json();
        if (cancelled) return;
        if (!data.authenticated) {
          router.replace("/super-login");
          return;
        }
        const appRole = String(data.user?.appRole ?? data.user?.role ?? "").toLowerCase();
        const portalRole = String(data.user?.role ?? appRole).toLowerCase();
        const impersonating = Boolean(data.impersonation?.active);
        if (appRole !== "super_admin" && appRole !== "dev") {
          // Authenticated but wrong portal — bounce to their own last page, not login.
          router.replace(getSafePortalRedirect(portalRole || appRole));
          return;
        }
        setUserRole(appRole);
        setImpersonationActive(impersonating);
        setImpersonationCompanyId(readImpersonationCompanyId());
        if (impersonating) {
          setUserName(extractUserName(data.user));
        } else {
          setUserName(extractUserName(data.user));
        }
        setUserEmail(typeof data.user?.email === "string" ? data.user.email : undefined);

        if (impersonating) {
          const companyId = readImpersonationCompanyId();
          const userId = readImpersonationUserId();
          const companyRoute = companyId
            ? `/superadmin/company/${encodeURIComponent(companyId)}`
            : null;

          if (companyRoute) {
            // Company-mode: enforce navigation to the company workspace.
            if (!pathname.startsWith(companyRoute) && pathname !== "/superadmin/impersonate/enter") {
              router.replace(companyRoute);
              return;
            }
          } else if (userId) {
            // User-mode: enforce navigation to /superadmin/user/:userId.
            // This mirrors the company-mode pattern exactly — both keep the SA
            // inside the superadmin route tree so the superadmin layout stays
            // mounted and stable, eliminating the layout-switching bounce loop.
            const userRoute = `/superadmin/user/${encodeURIComponent(userId)}`;
            if (!pathname.startsWith(userRoute) && pathname !== "/superadmin/impersonate/enter") {
              router.replace(userRoute);
              return;
            }
          } else {
            // No companyId and no userId — handoff data missing, fall through.
          }
        }

        if (isCrossPortalPath(pathname) && !canAccessPath(appRole, pathname)) {
          router.replace(getSafePortalRedirect(appRole, lastAllowedPathRef.current));
          return;
        }
        setIsAuthenticated(true);
        rememberPortalPath(appRole, pathname);
      } catch {
        if (!cancelled) {
          router.replace("/super-login");
        }
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    };
    void validateSession();
    return () => {
      cancelled = true;
    };
  }, [router, API, pathname]);

  useEffect(() => {
    if (!authChecked || !isAuthenticated) return;
    if (impersonationActive) {
      if (isImpersonationCompanyRoute(pathname) || isImpersonationUserRoute(pathname) || pathname === "/superadmin/impersonate/enter") {
        // Company-mode, [userId] redirect page, or enter page — allow.
        return;
      }
      const companyId = impersonationCompanyId ?? readImpersonationCompanyId();
      const userId = readImpersonationUserId();
      if (companyId) {
        // Company-mode: enforce.
        router.replace(`/superadmin/company/${encodeURIComponent(companyId)}`);
        return;
      }
      if (userId) {
        // User-mode: the [userId] page fires window.location.replace("/user/dashboard").
        // Do NOT call router.replace here — it keeps the superadmin layout mounted
        // and creates the bounce loop. If we somehow ended up on an unexpected
        // /superadmin/* path, navigate softly to the [userId] page ONCE and let
        // its window.location.replace complete the handoff.
        const userRoute = `/superadmin/user/${encodeURIComponent(userId)}`;
        if (!pathname.startsWith(userRoute)) {
          router.replace(userRoute);
        }
        return;
      }
      // No handoff data — allow rendering.
      return;
    }
    if (canAccessPath(userRole, pathname)) return;
    router.replace(getSafePortalRedirect(userRole, lastAllowedPathRef.current));
  }, [authChecked, impersonationActive, impersonationCompanyId, isAuthenticated, pathname, router, userRole]);

  // handleEndImpersonation
  const handleEndImpersonation = async () => {
    setEndingImpersonation(true);
    try {
      const handoffToken = readImpersonationHandoffToken();
      const csrfToken = await csrfClient.getToken(false, API || undefined);
      const response = await fetch(`${API}/api/superadmin/companies/impersonation/end`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
          ...(readStoredToken() ? { Authorization: `Bearer ${readStoredToken()}` } : {}),
          ...buildImpersonationHeaders(),
        },
        body: JSON.stringify(handoffToken ? { token: handoffToken, reason: "Ended from superadmin company impersonation" } : { reason: "Ended from superadmin company impersonation" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof (payload as { error?: { message?: string } }).error === "object"
            ? (payload as { error?: { message?: string } }).error?.message
            : null;
        throw new Error(message || "Failed to end impersonation");
      }
      // Determine redirect destination BEFORE clearing (reading from sessionStorage).
      const isUserMode = readImpersonationUserId() !== null && readImpersonationCompanyId() === null;
      clearImpersonationHandoff();
      window.location.assign(isUserMode ? "/superadmin/client-list" : "/superadmin/dashboard");
    } catch (error) {
      console.error("Failed to end impersonation:", error);
    } finally {
      setEndingImpersonation(false);
    }
  };


  if (!authChecked || !isAuthenticated) {
    return <FullPageLoader text="Validating session..." />;
  }
  return (
    <div className="bg-[#F4F7FC]">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        impersonationActive={impersonationActive}
        impersonationCompanyId={impersonationCompanyId}
      />

      <div className="flex h-screen flex-col overflow-hidden lg:transition-[margin-left] lg:duration-300 lg:ease-in-out lg:ml-55">
        <PortalHeader
          pageTitle={pageTitle}
          userName={userName}
          userEmail={userEmail}
        />

        {impersonationActive ? (
          <div
            className="sticky top-0 z-40 shrink-0 border-b border-[#1a1f3a] px-3 py-2.5 sm:px-6 lg:px-8"
            style={{ background: "linear-gradient(90deg,#1a1f3a 0%,#252b4a 100%)" }}
            role="alert"
            aria-live="polite"
          >
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <div className="flex min-w-0 items-center justify-between gap-2 sm:justify-start sm:gap-3">
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#d97706] bg-[#d97706]/15 px-2.5 py-1 text-[11px] font-semibold text-[#fbbf24] sm:px-3 sm:text-xs">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-3.5 w-3.5"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {impersonationCompanyId ? "Company mode" : "User mode"}
                </span>

                <button
                  type="button"
                  onClick={() => void handleEndImpersonation()}
                  disabled={endingImpersonation}
                  className="inline-flex shrink-0 items-center justify-center rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50 sm:hidden"
                >
                  {endingImpersonation ? "Exiting…" : "Exit"}
                </button>
              </div>

              <p className="min-w-0 text-left text-sm font-medium text-white sm:flex-1 sm:text-center">
                <span className="text-white/70">Viewing as</span>{" "}
                <span className="font-semibold wrap-break-word">{userName}</span>
                {userEmail ? (
                  <span className="mt-0.5 block truncate text-xs font-normal text-white/60 sm:mt-0 sm:ml-2 sm:inline">
                    {userEmail}
                  </span>
                ) : null}
              </p>

              <button
                type="button"
                onClick={() => void handleEndImpersonation()}
                disabled={endingImpersonation}
                className="hidden shrink-0 rounded-lg border border-white/20 bg-white/10 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50 sm:inline-flex"
              >
                {endingImpersonation ? "Exiting…" : "Exit Impersonation"}
              </button>
            </div>
          </div>
        ) : null}

        <main className="flex-1 overflow-y-auto bg-[#F4F7FC] p-4 pb-28 sm:p-6 sm:pb-28 lg:p-8 lg:pb-8">
          <div key={pathname} className="animate-fade-in-up">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
