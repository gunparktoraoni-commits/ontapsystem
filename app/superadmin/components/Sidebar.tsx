"use client";

import { Building2 } from "lucide-react";
import PortalSidebar from "../../components/PortalSidebar";
import { SUPERADMIN_NAV_ENTRIES, SUPERADMIN_NAV_ITEMS } from "../../config/portalNavigation";

export interface SuperAdminSidebarProps {
  open: boolean;
  onClose: () => void;
  impersonationActive?: boolean;
  impersonationCompanyId?: string | null;
}

export default function Sidebar({
  open,
  onClose,
  impersonationActive = false,
  impersonationCompanyId = null,
}: SuperAdminSidebarProps) {
  const navItems = impersonationActive && impersonationCompanyId
    ? [
        {
          label: "Company",
          icon: Building2,
          href: `/superadmin/company/${encodeURIComponent(impersonationCompanyId)}`,
        },
      ]
    : SUPERADMIN_NAV_ITEMS;

  return (
    <PortalSidebar
      portal="superadmin"
      navItems={navItems}
      navEntries={impersonationActive && impersonationCompanyId ? undefined : SUPERADMIN_NAV_ENTRIES}
      open={open}
      onClose={onClose}
      roleBadge="Super Admin"
      defaultDisplayName="Super Admin"
    />
  );
}
