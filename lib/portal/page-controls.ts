/**
 * Catalog of portal pages that can be toggled from the Dev Controls console.
 * `enabled: true` (default) = page is accessible; `false` = under maintenance.
 */

export type PortalPageScope = "user" | "admin" | "staff";

export type PortalPageControlDef = {
  /** Stable flag key stored in DevFeatureFlag.flag_key */
  key: string;
  portal: PortalPageScope;
  label: string;
  /** Primary nav / page href */
  href: string;
  /** Short explanation shown under the control and in the maintenance modal */
  description: string;
  /**
   * Extra path prefixes blocked when this page is off
   * (e.g. bizcard editor routes under My BizCards).
   */
  matchPrefixes?: string[];
};

export const PORTAL_PAGE_CONTROLS: PortalPageControlDef[] = [
  // ── User portal ──────────────────────────────────────────────
  {
    key: "page.user.dashboard",
    portal: "user",
    label: "Dashboard",
    href: "/user/dashboard",
    description:
      "Account overview with activity highlights and shortcuts into the rest of the user portal.",
  },
  {
    key: "page.user.bizcard-list",
    portal: "user",
    label: "My BizCards",
    href: "/user/bizcard-list",
    description:
      "Create, edit, publish, and manage personal digital business cards and themes.",
    matchPrefixes: ["/user/bizcard"],
  },
  {
    key: "page.user.inquiry",
    portal: "user",
    label: "Inquiry",
    href: "/user/inquiry",
    description:
      "Inbox for visitor inquiries and contact messages received from public portfolios.",
  },
  {
    key: "page.user.affiliate",
    portal: "user",
    label: "Affiliate Status",
    href: "/user/affiliate",
    description:
      "Track affiliate referrals, status, and related rewards for the signed-in user.",
  },
  {
    key: "page.user.associate",
    portal: "user",
    label: "Associate",
    href: "/user/associate",
    description:
      "Manage associate / referral links and connections tied to the user account.",
  },
  {
    key: "page.user.calendar",
    portal: "user",
    label: "Calendar",
    href: "/user/calendar",
    description:
      "Schedule appointments and control who can see each event — private, all associates, or custom invites.",
  },
  {
    key: "page.user.emarket",
    portal: "user",
    label: "E-market",
    href: "/user/emarket",
    description:
      "Browse and manage marketplace listings, products, and related commerce tools.",
  },
  {
    key: "page.user.missions",
    portal: "user",
    label: "Missions",
    href: "/user/missions",
    description:
      "Complete missions, grow your network, and unlock Ontap rewards.",
  },
  {
    key: "page.user.settings",
    portal: "user",
    label: "Settings",
    href: "/user/settings",
    description:
      "Profile, security, notification, and account preferences for the user portal.",
  },

  // ── Company admin portal ─────────────────────────────────────
  {
    key: "page.admin.dashboard",
    portal: "admin",
    label: "Dashboard",
    href: "/admin/dashboard",
    description:
      "Company-level overview of cards, activity, and admin shortcuts.",
  },
  {
    key: "page.admin.bizcard-list",
    portal: "admin",
    label: "My BizCards",
    href: "/admin/bizcard-list",
    description:
      "Manage company and personal BizCards available to the company admin.",
    matchPrefixes: ["/admin/bizcard"],
  },
  {
    key: "page.admin.inquiry",
    portal: "admin",
    label: "Inquiry",
    href: "/admin/inquiry-page",
    description:
      "Review and respond to inquiries sent to company portfolios and cards.",
  },
  {
    key: "page.admin.affiliate",
    portal: "admin",
    label: "Affiliate Status",
    href: "/admin/affiliate",
    description:
      "Monitor affiliate performance and status for the company admin account.",
  },
  {
    key: "page.admin.associate",
    portal: "admin",
    label: "Associate",
    href: "/admin/associate",
    description:
      "Manage associate relationships and referral links for the company.",
  },
  {
    key: "page.admin.calendar",
    portal: "admin",
    label: "Calendar",
    href: "/admin/calendar",
    description:
      "Schedule appointments and control visibility for company admin users.",
  },
  {
    key: "page.admin.company",
    portal: "admin",
    label: "Company",
    href: "/admin/company",
    description:
      "Company profile, employees, invites, and organization management tools.",
    matchPrefixes: ["/admin/employee-list"],
  },
  {
    key: "page.admin.emarket",
    portal: "admin",
    label: "E-market",
    href: "/admin/emarket",
    description:
      "Company marketplace listings and commerce tools for the admin portal.",
  },
  {
    key: "page.admin.settings",
    portal: "admin",
    label: "Settings",
    href: "/admin/settings",
    description:
      "Admin account and company portal preferences, security, and notifications.",
  },

  // ── Staff portal ─────────────────────────────────────────────
  {
    key: "page.staff.dashboard",
    portal: "staff",
    label: "Dashboard",
    href: "/staff/dashboard",
    description:
      "Staff home with workload highlights and shortcuts into support tools.",
  },
  {
    key: "page.staff.bizcard-list",
    portal: "staff",
    label: "My BizCards",
    href: "/staff/bizcard-list",
    description:
      "Staff personal BizCards used when representing OnTap to clients.",
    matchPrefixes: ["/staff/bizcard"],
  },
  {
    key: "page.staff.associate",
    portal: "staff",
    label: "Associate",
    href: "/staff/associate",
    description:
      "Staff associate / referral tools linked to the staff account.",
  },
  {
    key: "page.staff.calendar",
    portal: "staff",
    label: "Calendar",
    href: "/staff/calendar",
    description:
      "Schedule appointments and manage event visibility for staff users.",
  },
  {
    key: "page.staff.messages",
    portal: "staff",
    label: "Messages",
    href: "/staff/messages",
    description:
      "Client support conversations and messaging threads handled by staff.",
    matchPrefixes: ["/staff/messages/"],
  },
  {
    key: "page.staff.clients",
    portal: "staff",
    label: "Clients",
    href: "/staff/clients",
    description:
      "Directory of clients assigned to or visible from the staff portal.",
  },
  {
    key: "page.staff.orders",
    portal: "staff",
    label: "Client Orders",
    href: "/staff/orders",
    description:
      "View and assist with client orders placed through the platform.",
  },
  {
    key: "page.staff.settings",
    portal: "staff",
    label: "Settings",
    href: "/staff/settings",
    description:
      "Staff profile, security, and portal preference settings.",
  },
];

export const PORTAL_PAGE_SCOPE_LABELS: Record<PortalPageScope, string> = {
  user: "User portal",
  admin: "Company admin portal",
  staff: "Staff portal",
};

export function getPortalPageControlsByScope(portal: PortalPageScope) {
  return PORTAL_PAGE_CONTROLS.filter((item) => item.portal === portal);
}

export function findPortalPageControlForPath(
  pathname: string,
  portal?: PortalPageScope,
): PortalPageControlDef | null {
  const candidates = portal
    ? PORTAL_PAGE_CONTROLS.filter((item) => item.portal === portal)
    : PORTAL_PAGE_CONTROLS;

  // Prefer the most specific (longest) matching href/prefix.
  let best: PortalPageControlDef | null = null;
  let bestLen = -1;

  for (const item of candidates) {
    const paths = [item.href, ...(item.matchPrefixes ?? [])];
    for (const path of paths) {
      const matches =
        pathname === path ||
        pathname.startsWith(`${path}/`) ||
        (path.endsWith("/") && pathname.startsWith(path));
      if (matches && path.length > bestLen) {
        best = item;
        bestLen = path.length;
      }
    }
  }

  return best;
}

export function pathsBlockedByControl(control: PortalPageControlDef): string[] {
  return [control.href, ...(control.matchPrefixes ?? [])];
}
