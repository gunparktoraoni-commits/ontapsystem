"use client";

import { useMemo } from "react";
import PortalSidebar from "../../components/PortalSidebar";
import { ADMIN_NAV_ITEMS } from "../../config/portalNavigation";
import { useOptionalPortalPageAccess } from "../../components/PortalPageAccessProvider";

interface AdminSidebarProps {
  open: boolean;
  onClose: () => void;
}

export default function AdminSidebar({ open, onClose }: AdminSidebarProps) {
  const access = useOptionalPortalPageAccess();
  const navItems = useMemo(
    () => (access ? access.filterNavItems(ADMIN_NAV_ITEMS) : ADMIN_NAV_ITEMS),
    [access],
  );

  return (
    <PortalSidebar
      portal="admin"
      navItems={navItems}
      open={open}
      onClose={onClose}
      roleBadge="Admin"
      defaultDisplayName="Draw Ranger"
    />
  );
}
