"use client";

import React, { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { FullPageLoader } from "@/app/components/Loader";
import {
  canAccessPath,
  getSafePortalRedirect,
  isCrossPortalPath,
  rememberPortalPath,
} from "@/app/lib/portalAccess";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import { clearClientAuthCache } from "@/app/lib/logoutClient";
import { csrfClient } from "@/lib/csrf-client";
import DevSidebar from "./components/DevSidebar";

const API = getFrontendApiBaseUrl();

export default function DevLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState("dev");

  useEffect(() => {
    // Warm CSRF without clearing an existing valid cookie (avoids races with early mutations).
    void csrfClient.getToken(false, API || undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const validateSession = async () => {
      try {
        const res = await fetch(`${API}/api/auth/session`, {
          credentials: "include",
          cache: "no-store",
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
        if (role !== "dev") {
          router.replace(getSafePortalRedirect(role || "user"));
          return;
        }
        setUserRole(role);
        if (isCrossPortalPath(pathname) && !canAccessPath(role, pathname)) {
          router.replace(getSafePortalRedirect(role));
          return;
        }
        // Ensure CSRF is available before interactive pages mount mutations.
        await csrfClient.getToken(false, API || undefined);
        if (cancelled) return;
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
  }, [router, pathname]);

  useEffect(() => {
    if (!authChecked || !isAuthenticated) return;
    if (canAccessPath(userRole, pathname)) {
      rememberPortalPath(userRole, pathname);
      return;
    }
    router.replace(getSafePortalRedirect(userRole));
  }, [authChecked, isAuthenticated, pathname, router, userRole]);

  if (!authChecked || !isAuthenticated) {
    return <FullPageLoader text="Verifying developer access..." />;
  }

  return <DevSidebar>{children}</DevSidebar>;
}
