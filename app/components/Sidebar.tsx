"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PortalSidebar from "./PortalSidebar";
import {
  USER_NAV_ENTRIES,
  flattenNavEntries,
  isNavGroup,
  type PortalNavEntry,
} from "../config/portalNavigation";
import { useOptionalPortalPageAccess } from "./PortalPageAccessProvider";
import { getFrontendApiBaseUrl } from "./apiBase";
import { withImpersonationHeaders } from "../lib/superadminImpersonationHandoff";
import { hasActivePremiumPlan } from "./subscriptionAccess";

const USER_SYNC_EVENT = "ontap:user-sync";
const MISSIONS_HREF = "/user/missions";
/** Near real-time refresh after off-tab upgrades (e.g. Xendit return). */
const PREMIUM_NAV_POLL_MS = 30_000;

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  collapsed?: boolean;
}

export default function Sidebar({ open, onClose, collapsed = false }: SidebarProps) {
  const access = useOptionalPortalPageAccess();
  /** Hidden until Premium is confirmed — avoids flashing premium-only nav for Free/Basic/Standard. */
  const [canSeePremiumNav, setCanSeePremiumNav] = useState(false);

  const loadPremiumNavAccess = useCallback(async () => {
    try {
      const response = await fetch(
        `${getFrontendApiBaseUrl()}/api/user/subscription`,
        {
          method: "GET",
          cache: "no-store",
          credentials: "include",
          headers: withImpersonationHeaders(),
        },
      );
      if (!response.ok) {
        setCanSeePremiumNav(false);
        return;
      }
      const payload = (await response.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      const data =
        payload?.data && typeof payload.data === "object"
          ? (payload.data as Record<string, unknown>)
          : null;

      setCanSeePremiumNav(
        hasActivePremiumPlan({
          tier: data?.tier != null ? String(data.tier) : null,
          accessReason:
            data?.access_reason != null ? String(data.access_reason) : null,
          isTrial: Boolean(data?.is_trial),
          status: data?.status != null ? String(data.status) : null,
          isExpired: Boolean(data?.is_expired),
        }),
      );
    } catch {
      setCanSeePremiumNav(false);
    }
  }, []);

  useEffect(() => {
    void loadPremiumNavAccess();
    window.addEventListener(USER_SYNC_EVENT, loadPremiumNavAccess);
    window.addEventListener("focus", loadPremiumNavAccess);
    const intervalId = window.setInterval(() => {
      void loadPremiumNavAccess();
    }, PREMIUM_NAV_POLL_MS);
    return () => {
      window.removeEventListener(USER_SYNC_EVENT, loadPremiumNavAccess);
      window.removeEventListener("focus", loadPremiumNavAccess);
      window.clearInterval(intervalId);
    };
  }, [loadPremiumNavAccess]);

  const navEntries = useMemo(() => {
    const flat = flattenNavEntries(USER_NAV_ENTRIES);
    const filtered = access ? access.filterNavItems(flat) : flat;
    const allowedHrefs = new Set(filtered.map((item) => item.href));
    if (!canSeePremiumNav) {
      allowedHrefs.delete(MISSIONS_HREF);
    }
    return USER_NAV_ENTRIES.map((entry) =>
      isNavGroup(entry)
        ? { ...entry, items: entry.items.filter((item) => allowedHrefs.has(item.href)) }
        : entry,
    ).filter((entry) =>
      isNavGroup(entry) ? entry.items.length > 0 : allowedHrefs.has(entry.href),
    ) as PortalNavEntry[];
  }, [access, canSeePremiumNav]);
  const navItems = useMemo(() => flattenNavEntries(navEntries), [navEntries]);
  return (
    <PortalSidebar
      portal="user"
      navItems={navItems}
      navEntries={navEntries}
      open={open}
      onClose={onClose}
      collapsed={collapsed}
    />
  );
}
