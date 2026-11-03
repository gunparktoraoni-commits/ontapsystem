import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  CreditCard,
  MessageSquare,
  BarChart3,
  Users,
  Link2,
  ShoppingBag,
  Settings,
  Building2,
  Handshake,
  Package,
  Gem,
  Megaphone,
  AlertTriangle,
  Trash2,
  Shield,
  Activity,
  ClipboardList,
  SlidersHorizontal,
  Layers,
  Database,
  TrendingUp,
  Target,
  Trophy,
  Bell,
  Lightbulb,
  Inbox,
  UserRoundPlus,
} from "lucide-react";

export type PortalNavItem = {
  label: string;
  icon: LucideIcon;
  href: string;
};

export type PortalNavGroup = {
  label: string;
  icon: LucideIcon;
  items: PortalNavItem[];
};

export type PortalNavEntry = PortalNavItem | PortalNavGroup;

export function isNavGroup(entry: PortalNavEntry): entry is PortalNavGroup {
  return "items" in entry;
}

export function flattenNavEntries(entries: PortalNavEntry[]): PortalNavItem[] {
  return entries.flatMap((e) => (isNavGroup(e) ? e.items : [e]));
}

export type PortalKey = "user" | "admin" | "superadmin" | "staff" | "dev";

export const USER_NAV_ENTRIES: PortalNavEntry[] = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/user/dashboard" },
  { label: "My BizCards", icon: CreditCard, href: "/user/bizcard-list" },
  { label: "Leads", icon: UserRoundPlus, href: "/user/leads" },
  { label: "Inquiry", icon: MessageSquare, href: "/user/inquiry" },
  { label: "Affiliate Status", icon: Users, href: "/user/affiliate" },
  { label: "Associate", icon: Link2, href: "/user/associate" },
  { label: "E-market", icon: ShoppingBag, href: "/user/emarket" },
  {
    label: "Growth",
    icon: TrendingUp,
    items: [{ label: "Missions", icon: Target, href: "/user/missions" }],
  },
  { label: "Settings", icon: Settings, href: "/user/settings" },
];

export const USER_NAV_ITEMS: PortalNavItem[] = flattenNavEntries(USER_NAV_ENTRIES);

export const ADMIN_NAV_ITEMS: PortalNavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/admin/dashboard" },
  { label: "My BizCards", icon: CreditCard, href: "/admin/bizcard-list" },
  { label: "Leads", icon: UserRoundPlus, href: "/admin/leads" },
  { label: "Inquiry", icon: MessageSquare, href: "/admin/inquiry-page" },
  { label: "Affiliate Status", icon: Users, href: "/admin/affiliate" },
  { label: "Associate", icon: Link2, href: "/admin/associate" },
  { label: "Company", icon: Building2, href: "/admin/company" },
  { label: "E-market", icon: ShoppingBag, href: "/admin/emarket" },
  { label: "Settings", icon: Settings, href: "/admin/settings" },
];

export const SUPERADMIN_NAV_ENTRIES: PortalNavEntry[] = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/superadmin/dashboard" },
  { label: "Generate BizCards", icon: CreditCard, href: "/superadmin/bizcard-list" },
  { label: "Users", icon: Users, href: "/superadmin/client-list" },
  { label: "Companies", icon: Building2, href: "/superadmin/company-list" },
  { label: "BizCards", icon: CreditCard, href: "/superadmin/user-bizcards" },
  { label: "Recycle Bin", icon: Trash2, href: "/superadmin/recycle-bin" },
  { label: "Affiliates", icon: Handshake, href: "/superadmin/affiliate" },
  { label: "Orders", icon: Package, href: "/superadmin/orders" },
  { label: "Product Inquiries", icon: MessageSquare, href: "/superadmin/product-inquiries" },
  { label: "Support Escalations", icon: MessageSquare, href: "/superadmin/support-escalations" },
  { label: "Subscriptions", icon: Gem, href: "/superadmin/subscription-transactions" },
  { label: "Promos & Deals", icon: Megaphone, href: "/superadmin/promos" },
  { label: "Missions & Rewards", icon: Trophy, href: "/superadmin/missions-rewards" },
  { label: "Manage Content", icon: Package, href: "/superadmin/manage-content" },
  {
    label: "User Experience",
    icon: BarChart3,
    items: [
      { label: "Overview", icon: LayoutDashboard, href: "/superadmin/user-experience" },
      { label: "Feedback", icon: MessageSquare, href: "/superadmin/user-experience/feedback" },
      { label: "Feature Requests", icon: Lightbulb, href: "/superadmin/user-experience/feature-requests" },
      { label: "Announcements", icon: Bell, href: "/superadmin/settings?tab=broadcast" },
    ],
  },
  { label: "Staffs", icon: Users, href: "/superadmin/staff" },
  { label: "Settings", icon: Settings, href: "/superadmin/settings" },
];

export const SUPERADMIN_NAV_ITEMS: PortalNavItem[] = flattenNavEntries(SUPERADMIN_NAV_ENTRIES);

export const STAFF_NAV_ITEMS: PortalNavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/staff/dashboard" },
  { label: "My BizCards", icon: CreditCard, href: "/staff/bizcard-list" },
  { label: "Associate", icon: Link2, href: "/staff/associate" },
  { label: "Messages", icon: MessageSquare, href: "/staff/messages" },
  { label: "Clients", icon: Users, href: "/staff/clients" },
  { label: "Client Orders", icon: Package, href: "/staff/orders" },
  { label: "Product Inquiries", icon: MessageSquare, href: "/staff/product-inquiries" },
  { label: "Settings", icon: Settings, href: "/staff/settings" },
];

/** Developer portal navigation items */
export const DEV_NAV_ITEMS: PortalNavItem[] = [
  { label: "Overview", icon: LayoutDashboard, href: "/dev/overview" },
  { label: "Incidents", icon: AlertTriangle, href: "/dev/incidents" },
  { label: "Escalations", icon: MessageSquare, href: "/dev/escalations" },
  { label: "Theme Requests", icon: Inbox, href: "/dev/inquiry" },
  { label: "Impact", icon: BarChart3, href: "/dev/impact" },
  { label: "Auth Health", icon: Shield, href: "/dev/auth-health" },
  { label: "Jobs & Integrations", icon: Activity, href: "/dev/jobs" },
  { label: "Audit Timeline", icon: ClipboardList, href: "/dev/audit" },
  { label: "Controls", icon: SlidersHorizontal, href: "/dev/controls" },
  { label: "Notice Board", icon: Megaphone, href: "/dev/notice-board" },
  { label: "System Health", icon: Database, href: "/dev/system-health" },
  { label: "API Explorer", icon: Layers, href: "/dev/api-explorer" },
  { label: "Clients", icon: Users, href: "/dev/clients" },
  { label: "Settings", icon: Settings, href: "/dev/settings" },
];

export function getNavItemsForPortal(portal: PortalKey): PortalNavItem[] {
  switch (portal) {
    case "admin":
      return ADMIN_NAV_ITEMS;
    case "superadmin":
      return SUPERADMIN_NAV_ITEMS;
    case "staff":
      return STAFF_NAV_ITEMS;
    case "dev":
      return DEV_NAV_ITEMS;
    default:
      return USER_NAV_ITEMS;
  }
}

export type BizcardClickTarget = {
  bizcardId: string;
  serialId: string;
};

export function detectPortalFromPath(pathname: string): PortalKey {
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/superadmin")) return "superadmin";
  if (pathname.startsWith("/staff")) return "staff";
  if (pathname.startsWith("/dev")) return "dev";
  return "user";
}

export function getBizcardDetailPath(
  portal: PortalKey,
  bizcardId: string,
): string {
  const id = encodeURIComponent(bizcardId);
  switch (portal) {
    case "admin":
      return `/admin/bizcard/${id}`;
    case "superadmin":
      return `/superadmin/bizcard/${id}`;
    case "staff":
      return `/staff/bizcard/${id}`;
    default:
      return `/user/bizcard/${id}`;
  }
}

export function getBizcardListPath(portal: PortalKey): string {
  switch (portal) {
    case "admin":
      return "/admin/bizcard-list";
    case "superadmin":
      return "/superadmin/bizcard-list";
    case "staff":
      return "/staff/bizcard-list";
    default:
      return "/user/bizcard-list";
  }
}

export function getBizcardEditorPath(portal: PortalKey): string {
  switch (portal) {
    case "admin":
      return "/admin/bizcard";
    case "superadmin":
      return "/superadmin/bizcard";
    case "staff":
      return "/staff/bizcard";
    default:
      return "/user/bizcard";
  }
}

// export function getBizcardCreatePath(portal: PortalKey): string {
//   switch (portal) {
//     case "admin":
//       return "/admin/bizcard/create-new";
//     case "superadmin":
//       return "/superadmin/bizcard/create-new";
//     case "staff":
//       return "/staff/bizcard/create-new";
//     default:
//       return "/user/bizcard/create-new";
//   }
// }

export function getBizcardDetailEditPath(
  portal: PortalKey,
  bizcardId: string,
): string {
  const id = encodeURIComponent(bizcardId);
  return `${getBizcardEditorPath(portal)}?bizcardId=${id}`;
}

export function getBizcardEditorPathForId(
  portal: PortalKey,
  bizcardId: string,
): string {
  return getBizcardDetailEditPath(portal, bizcardId);
}

export function getBizcardClickPath(
  portal: PortalKey,
  target: BizcardClickTarget,
): string {
  const bizcardId = target.bizcardId?.trim();
  if (bizcardId) {
    return getBizcardDetailPath(portal, bizcardId);
  }

  switch (portal) {
    case "admin":
      return "/admin/dashboard";
    case "superadmin":
      return "/superadmin";
    case "staff":
      return "/staff/dashboard";
    default:
      return "/user/dashboard";
  }
}
