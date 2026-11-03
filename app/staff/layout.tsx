"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { FullPageLoader } from "../components/Loader";
import StaffSidebar from "./components/SidebarClient";
import StaffPortalHeader, { clearClientAuthCache } from "./components/StaffPortalHeader";
import { getFrontendApiBaseUrl } from "../components/apiBase";
import {
  canAccessPath,
  getSafePortalRedirect,
  isCrossPortalPath,
  rememberPortalPath,
} from "../lib/portalAccess";
import { PortalPageAccessProvider } from "../components/PortalPageAccessProvider";
import { PortalPageAccessGuard } from "../components/PortalPageAccessGuard";

const TITLES: Record<string, string> = {
  "/staff/dashboard": "Dashboard",
  "/staff/orders": "Client Orders",
  "/staff/messages": "Client Messages",
  "/staff/clients": "Clients",
  "/staff/services": "Client Services",
  "/staff/bizcard-list": "My BizCards",
  "/staff/inquiry": "Inquiry",
  "/staff/analytics": "Analytics",
  "/staff/affiliate": "Affiliate Status",
  "/staff/associate": "Associate",
  "/staff/calendar": "Calendar",
  "/staff/emarket": "E-market",
  "/staff/settings": "Settings",
  "/staff/bizcard": "BizCard",
};

function resolvePageTitle(pathname: string): string {
  if (pathname.startsWith("/staff/messages/") && pathname !== "/staff/messages") {
    return "Client Messages";
  }
  const match = Object.entries(TITLES).find(
    ([href]) => pathname === href || pathname.startsWith(`${href}/`),
  );
  return match?.[1] ?? "Staff Portal";
}

export default function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userRole, setUserRole] = useState("staff");
  const lastAllowedPathRef = useRef("/staff/dashboard");

  const API = getFrontendApiBaseUrl();
  const pageTitle = useMemo(() => resolvePageTitle(pathname), [pathname]);

  useEffect(() => {
    if (canAccessPath(userRole, pathname)) {
      lastAllowedPathRef.current = pathname;
      rememberPortalPath(userRole, pathname);
    }
  }, [pathname, userRole]);

  useEffect(() => {
    if (pathname.startsWith("/staff/verify") || pathname.startsWith("/staff/verify-email")) {
      setAuthChecked(true);
      setIsAuthenticated(true);
      return;
    }

    let cancelled = false;
    const validateSession = async () => {
      try {
        const res = await fetch(`${API}/api/auth/session`, {
          credentials: "include",
        });
        if (cancelled) return;
        if (!res.ok) {
          clearClientAuthCache();
          router.replace("/");
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        if (!data.authenticated) {
          clearClientAuthCache();
          router.replace("/");
          return;
        }
        const role = String(data.user?.role ?? "").toLowerCase();
        if (role !== "staff") {
          router.replace(getSafePortalRedirect(role || "user"));
          return;
        }
        setUserRole(role);
        if (isCrossPortalPath(pathname) && !canAccessPath(role, pathname)) {
          router.replace(getSafePortalRedirect(role, lastAllowedPathRef.current));
          return;
        }
        setIsAuthenticated(true);
        rememberPortalPath(role, pathname);
      } catch {
        if (!cancelled) {
          clearClientAuthCache();
          router.replace("/");
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
    if (
      pathname.startsWith("/staff/verify") ||
      pathname.startsWith("/staff/verify-email") ||
      pathname.startsWith("/staff/setup-password")
    ) {
      return;
    }
    if (canAccessPath(userRole, pathname)) return;
    router.replace(getSafePortalRedirect(userRole, lastAllowedPathRef.current));
  }, [authChecked, isAuthenticated, pathname, router, userRole]);

  if (!authChecked || (!isAuthenticated && !pathname.startsWith("/staff/verify") && !pathname.startsWith("/staff/verify-email"))) {
    return <FullPageLoader text="Verifying staff access..." />;
  }

  const isAuthFlowPage =
    pathname.startsWith("/staff/verify") ||
    pathname.startsWith("/staff/verify-email") ||
    pathname.startsWith("/staff/setup-password");

  if (isAuthFlowPage) {
    return <div className="bg-[#F4F7FC] min-h-screen">{children}</div>;
  }

  return (
    <PortalPageAccessProvider portal="staff">
    <div className="bg-[#F4F7FC] min-h-screen">
      <StaffSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="lg:ml-55 min-h-screen min-w-0 flex flex-col">
        <StaffPortalHeader
          pageTitle={pageTitle}
        />
        <main className="flex-1 min-w-0 overflow-x-hidden p-4 pb-28 sm:p-6 sm:pb-28 lg:p-8 lg:pb-8">
          <PortalPageAccessGuard portal="staff">{children}</PortalPageAccessGuard>
        </main>
      </div>
    </div>
    </PortalPageAccessProvider>
  );
}
