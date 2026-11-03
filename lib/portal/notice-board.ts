/**
 * Notice Board catalog — types, placements, audiences, and UX metadata.
 */

export const NOTICE_TYPES = [
  {
    id: "system_update",
    label: "System update",
    description: "Maintenance windows, outages, and operational changes.",
    accent: "#B45309",
  },
  {
    id: "whats_new",
    label: "What's new",
    description: "Product launches, feature releases, and changelog cards.",
    accent: "#2A4792",
  },
  {
    id: "survey",
    label: "Survey",
    description: "In-app form builder (rating, single/multi choice, yes/no, text) with optional external link.",
    accent: "#7C3AED",
  },
  {
    id: "promotion",
    label: "Promotion",
    description: "Limited offers and campaigns with optional graphic media attachments.",
    accent: "#059669",
  },
  {
    id: "alert",
    label: "Alert",
    description: "Urgent policy or security notices that need attention.",
    accent: "#DC2626",
  },
] as const;

export const NOTICE_STATUSES = ["draft", "scheduled", "published", "archived"] as const;

export const NOTICE_PRIORITIES = ["critical", "high", "medium", "low"] as const;

export const NOTICE_CHANNELS = [
  { id: "in_app", label: "In-app notification" },
  { id: "email", label: "Email" },
] as const;

export const NOTICE_PORTALS = [
  {
    id: "user",
    label: "User portal",
    description: "Individual OnTap card holders.",
  },
  {
    id: "admin",
    label: "Company admin",
    description: "Company admins and managers.",
  },
  {
    id: "staff",
    label: "Staff portal",
    description: "Internal support and operations staff.",
  },
] as const;

export const NOTICE_PLACEMENTS = [
  { id: "global_banner", label: "Global top banner", portals: ["user", "admin", "staff"] as const },
  { id: "dashboard", label: "Dashboard / home", portals: ["user", "admin", "staff"] as const },
  { id: "bizcards", label: "BizCards pages", portals: ["user", "admin", "staff"] as const },
  { id: "inquiry", label: "Inquiry", portals: ["user", "admin"] as const },
  { id: "affiliate", label: "Affiliate Status", portals: ["user", "admin"] as const },
  { id: "associate", label: "Associate", portals: ["user", "admin", "staff"] as const },
  { id: "emarket", label: "E-market", portals: ["user", "admin"] as const },
  { id: "company", label: "Company management", portals: ["admin"] as const },
  { id: "messages", label: "Messages", portals: ["staff"] as const },
  { id: "clients", label: "Clients", portals: ["staff"] as const },
  { id: "orders", label: "Client Orders", portals: ["staff"] as const },
  { id: "settings", label: "Settings", portals: ["user", "admin", "staff"] as const },
] as const;

export const NOTICE_AUDIENCES = [
  { id: "role_user", label: "Users", group: "Roles", description: "Standard user accounts" },
  { id: "role_company_admin", label: "Company admins", group: "Roles", description: "admin / company_admin / manager" },
  { id: "role_staff", label: "Staff", group: "Roles", description: "Internal staff accounts" },
  { id: "tier_basic", label: "Basic subscription", group: "Plans", description: "Users with Basic tier cards" },
  { id: "tier_standard", label: "Standard subscription", group: "Plans", description: "Users with Standard tier cards" },
  { id: "tier_premium", label: "Premium subscription", group: "Plans", description: "Users with Premium tier cards" },
  { id: "tier_free_trial", label: "Free trial", group: "Plans", description: "Active free-trial subscribers" },
  { id: "new_users", label: "New users", group: "Lifecycle", description: "Accounts created in the last 30 days" },
  { id: "all_matched_portals", label: "Everyone in selected portals", group: "Broad", description: "All active people in the chosen portals" },
  { id: "custom_users", label: "Specific users only", group: "Custom", description: "Only the users you pick by name/email" },
] as const;

export const SURVEY_QUESTION_TYPES = [
  { id: "single", label: "Single choice", description: "Pick one option" },
  { id: "multiple", label: "Multiple choice", description: "Select all that apply" },
  { id: "rating", label: "Rating 1–5", description: "Star / numeric scale" },
  { id: "yes_no", label: "Yes / No", description: "Binary answer" },
  { id: "text", label: "Short text", description: "Free-form response" },
] as const;

export type SurveyQuestionTypeId = (typeof SURVEY_QUESTION_TYPES)[number]["id"];

export type SurveyQuestion = {
  id: string;
  prompt: string;
  type: SurveyQuestionTypeId;
  options?: string[];
  required?: boolean;
  min?: number;
  max?: number;
};

export type NoticeTypeId = (typeof NOTICE_TYPES)[number]["id"];
export type NoticeStatusId = (typeof NOTICE_STATUSES)[number];
export type NoticePriorityId = (typeof NOTICE_PRIORITIES)[number];
export type NoticeChannelId = (typeof NOTICE_CHANNELS)[number]["id"];
export type NoticePortalId = (typeof NOTICE_PORTALS)[number]["id"];
export type NoticePlacementId = (typeof NOTICE_PLACEMENTS)[number]["id"];
export type NoticeAudienceId = (typeof NOTICE_AUDIENCES)[number]["id"];

export function isNoticeType(value: string): value is NoticeTypeId {
  return NOTICE_TYPES.some((item) => item.id === value);
}

export function isNoticeStatus(value: string): value is NoticeStatusId {
  return (NOTICE_STATUSES as readonly string[]).includes(value);
}

export function getNoticeTypeMeta(id: string) {
  return NOTICE_TYPES.find((item) => item.id === id) ?? NOTICE_TYPES[0];
}

/** Map a portal pathname to the notice surface placement key. */
export function resolvePlacementFromPath(pathname: string): NoticePlacementId | null {
  if (pathname.includes("/dashboard")) return "dashboard";
  if (pathname.includes("/bizcard")) return "bizcards";
  if (pathname.includes("/inquiry")) return "inquiry";
  if (pathname.includes("/affiliate")) return "affiliate";
  if (pathname.includes("/associate")) return "associate";
  if (pathname.includes("/emarket")) return "emarket";
  if (pathname.includes("/company") || pathname.includes("/employee-list")) return "company";
  if (pathname.includes("/messages")) return "messages";
  if (pathname.includes("/clients")) return "clients";
  if (pathname.includes("/orders")) return "orders";
  if (pathname.includes("/settings")) return "settings";
  return null;
}
