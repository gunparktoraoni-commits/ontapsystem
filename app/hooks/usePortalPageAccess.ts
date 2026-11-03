"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import {
  findPortalPageControlForPath,
  type PortalPageScope,
} from "@/lib/portal/page-controls";

const API = getFrontendApiBaseUrl();

export type PortalPageAccessItem = {
  key: string;
  portal: PortalPageScope;
  label: string;
  href: string;
  description: string;
  enabled: boolean;
  matchPrefixes: string[];
  blockedPaths: string[];
};

type PageAccessPayload = {
  pages: PortalPageAccessItem[];
  disabled: Array<Omit<PortalPageAccessItem, "enabled">>;
};

function pathIsBlocked(
  pathname: string,
  item: { href: string; matchPrefixes?: string[]; blockedPaths?: string[] },
): boolean {
  const paths = item.blockedPaths?.length
    ? item.blockedPaths
    : [item.href, ...(item.matchPrefixes ?? [])];

  return paths.some(
    (path) =>
      pathname === path ||
      pathname.startsWith(`${path}/`) ||
      (path.endsWith("/") && pathname.startsWith(path)),
  );
}

/**
 * Loads portal page accessibility flags for user / admin / staff shells.
 */
export function usePortalPageAccess(portal: PortalPageScope) {
  const [pages, setPages] = useState<PortalPageAccessItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const response = await fetch(
        `${API}/api/portal/page-access?portal=${encodeURIComponent(portal)}`,
        {
          credentials: "include",
          cache: "no-store",
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error ?? "Failed to load page access.");
      }
      const data = payload.data as PageAccessPayload;
      setPages(Array.isArray(data?.pages) ? data.pages : []);
      if (silent) setError(null);
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : "Failed to load page access.");
        // Fail open so a controls API outage does not lock every portal page.
        setPages([]);
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [portal]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const onFocus = () => {
      // File pickers and other native dialogs return focus to the window without
      // navigating away. A blocking reload unmounts portal pages (e.g. BizCard editor).
      void reload({ silent: true });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);

  const disabledPages = useMemo(
    () => pages.filter((page) => !page.enabled),
    [pages],
  );

  const disabledHrefs = useMemo(
    () => new Set(disabledPages.map((page) => page.href)),
    [disabledPages],
  );

  const getBlockedPage = useCallback(
    (pathname: string) => {
      const hit = disabledPages.find((page) => pathIsBlocked(pathname, page));
      if (hit) return hit;
      // Fallback to catalog match only when we know that control is disabled.
      const catalog = findPortalPageControlForPath(pathname, portal);
      if (!catalog) return null;
      return disabledPages.find((page) => page.key === catalog.key) ?? null;
    },
    [disabledPages, portal],
  );

  const firstAccessibleHref = useMemo(() => {
    const live = pages.find((page) => page.enabled);
    return live?.href ?? null;
  }, [pages]);

  return {
    pages,
    disabledPages,
    disabledHrefs,
    loading,
    error,
    reload,
    getBlockedPage,
    firstAccessibleHref,
    filterNavItems: <T extends { href: string }>(items: T[]) =>
      items.filter((item) => !disabledHrefs.has(item.href)),
  };
}
