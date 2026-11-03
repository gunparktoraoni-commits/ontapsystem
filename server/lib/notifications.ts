import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import type { Prisma } from "@prisma/client";
import { getClientIp, getUserAgent, resolveRequestSession } from "@/server/lib/auth";

export const NOTIFICATION_EVENT_TYPES = [
  "profile_view",
  "contact_download",
  "friend_request_sent",
  "friend_request_accepted",
  "profile_shared",
  "inquiry_sent",
  "system_update",
  "subscription_expiring",
  "connection_added",
  "birthday",
  "achievement",
  "mention",
  "comment",
  "support_message_received",
  "support_escalated",
  "support_resolved",
  "direct_message_received",
  "client_order_placed",
  "client_assigned",
  "product_inquiry_received",
  "calendar_event_shared",
  "calendar_event_reminder",
  "calendar_event_attendance",
] as const;


export const NOTIFICATION_PRIORITIES = ["critical", "high", "medium", "low"] as const;
export const EMAIL_PRIORITIES = ["immediate", "batch", "digest"] as const;


type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];
type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];
type EmailPriority = (typeof EMAIL_PRIORITIES)[number];
const cache = new Map<string, { expiresAt: number; value: unknown }>();
export function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

export function serializeBigInts<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}


export function isValidEventType(raw: string): raw is NotificationEventType {
  return (NOTIFICATION_EVENT_TYPES as readonly string[]).includes(raw);
}


export function isValidPriority(raw: string): raw is NotificationPriority {
  return (NOTIFICATION_PRIORITIES as readonly string[]).includes(raw);

}



export async function requireNotificationSession(request: NextRequest) {
  const resolved = await resolveRequestSession(request);
  if (!resolved.session) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Authentication required.", requiresAuth: true }, { status: 401 }),
    };
  }
  return { ok: true as const, session: resolved.session, refreshed: resolved.refreshed };
}


export function isAdminRole(role: string): boolean {
  return role === "admin" || role === "company_admin";

}

type PortalRole = "user" | "admin" | "staff" | "super_admin" | "dev";

function normalizePortalRole(role: string): PortalRole {
  const r = String(role ?? "user").trim().toLowerCase();
  if (r === "super_admin" || r === "superadmin") return "super_admin";
  if (r === "dev") return "dev";
  if (r === "staff") return "staff";
  if (r === "admin" || r === "company_admin" || r === "manager") return "admin";
  return "user";
}

function withQueryParam(base: string, key: string, value: string): string {
  if (!value) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${key}=${encodeURIComponent(value)}`;
}

function portalDashboardPath(role: PortalRole): string {
  switch (role) {
    case "super_admin":
      return "/superadmin/client-list";
    case "dev":
      return "/dev/dashboard";
    case "staff":
      return "/staff/dashboard";
    case "admin":
      return "/admin/dashboard";
    default:
      return "/user/dashboard";
  }
}

function portalBizcardDashboardPath(
  role: PortalRole,
  bizcardId = "",
): string {
  const id = bizcardId.trim();
  if (id) {
    const encoded = encodeURIComponent(id);
    if (role === "admin") return `/admin/bizcard/${encoded}`;
    if (role === "staff") return `/staff/bizcard/${encoded}`;
    if (role === "super_admin") return `/superadmin/bizcard/${encoded}`;
    return `/user/bizcard/${encoded}`;
  }

  if (role === "admin") return "/admin/bizcard-list";
  if (role === "staff") return "/staff/bizcard-list";
  if (role === "super_admin") return "/superadmin/bizcard-list";
  return "/user/bizcard-list";
}

function portalAssociatePath(role: PortalRole): string {
  if (role === "admin") return "/admin/associate";
  if (role === "staff") return "/staff/associate";
  return "/user/associate";
}

function portalInquiryPath(role: PortalRole): string {
  if (role === "admin") return "/admin/inquiry-page";
  if (role === "staff") return "/staff/inquiry";
  if (role === "dev") return "/dev/inquiry";
  return "/user/inquiry";
}

function portalLeadsPath(role: PortalRole): string {
  if (role === "admin") return "/admin/leads";
  return "/user/leads";
}

function portalSubscriptionPath(role: PortalRole): string {
  if (role === "admin") return "/admin/emarket?tab=subscription";
  if (role === "staff") return "/staff/emarket?tab=subscription";
  return "/user/emarket?tab=subscription";
}

function portalCalendarPath(role: PortalRole, eventId = ""): string {
  let base = "/user/calendar";
  if (role === "super_admin") base = "/superadmin/calendar";
  else if (role === "staff") base = "/staff/calendar";
  else if (role === "admin") base = "/admin/calendar";
  return eventId ? withQueryParam(base, "event", eventId) : base;
}

function metaString(meta: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const raw = meta[key];
    if (raw != null && String(raw).trim()) return String(raw).trim();
  }
  return "";
}

/** True when URL is a generic portal home we should remap by recipient role. */
function isGenericPortalDashboard(url: string): boolean {
  const path = (url.split("?")[0] || "").replace(/\/$/, "") || "/";
  return (
    path === "/user/dashboard" ||
    path === "/admin/dashboard" ||
    path === "/staff/dashboard" ||
    path === "/dev/dashboard" ||
    path === "/superadmin/dashboard" ||
    path === "/superadmin/client-list"
  );
}

/**
 * Rewrite stored/default action URLs so each role lands in its own portal.
 * Applied on write (createNotificationFromEvent) and again on list GETs.
 */
export function resolveNotificationActionUrlForRole(
  eventType: string,
  role: string,
  metadata: Record<string, unknown> | null | undefined,
  fallbackUrl: string,
): string {
  const meta = metadata && typeof metadata === "object" ? metadata : {};
  const portalRole = normalizePortalRole(role);
  const conversationId = metaString(meta, "conversationId", "conversation_id");
  const eventId = metaString(meta, "event_id", "eventId", "calendar_event_id");
  const fallback = typeof fallbackUrl === "string" ? fallbackUrl.trim() : "";

  if (
    eventType === "support_escalated" ||
    eventType === "support_message_received" ||
    eventType === "support_resolved"
  ) {
    if (portalRole === "dev") {
      return withQueryParam("/dev/escalations", "conversationId", conversationId);
    }
    if (portalRole === "super_admin") {
      return withQueryParam(
        "/superadmin/support-escalations",
        "conversationId",
        conversationId,
      );
    }
    if (portalRole === "staff") {
      return conversationId
        ? `/staff/messages/${encodeURIComponent(conversationId)}`
        : "/staff/messages";
    }
    if (portalRole === "admin") {
      return "/admin/dashboard?openSupport=1";
    }
    return "/user/dashboard?openSupport=1";
  }

  if (
    eventType === "calendar_event_shared" ||
    eventType === "calendar_event_reminder" ||
    eventType === "calendar_event_attendance"
  ) {
    return portalCalendarPath(portalRole, eventId);
  }

  if (eventType === "inquiry_sent") {
    if (metaString(meta, "source") === "visitor_lead") {
      return portalLeadsPath(portalRole);
    }
    return portalInquiryPath(portalRole);
  }

  if (eventType === "profile_view" || eventType === "contact_download") {
    const bizcardId = metaString(meta, "bizcard_id", "bizcardId");
    return portalBizcardDashboardPath(portalRole, bizcardId);
  }

  if (
    eventType === "friend_request_sent" ||
    eventType === "friend_request_accepted" ||
    eventType === "connection_added" ||
    eventType === "direct_message_received" ||
    eventType === "profile_shared"
  ) {
    return portalAssociatePath(portalRole);
  }

  if (eventType === "subscription_expiring") {
    return portalSubscriptionPath(portalRole);
  }

  if (eventType === "system_update" || eventType === "achievement") {
    // Keep explicit custom/deep links; remap generic dashboards by role.
    if (!fallback || isGenericPortalDashboard(fallback)) {
      return portalDashboardPath(portalRole);
    }
    return fallback;
  }

  if (eventType === "client_order_placed") {
    return "/staff/orders";
  }
  if (eventType === "product_inquiry_received") {
    return "/staff/product-inquiries";
  }
  if (eventType === "client_assigned") {
    return "/staff/clients";
  }

  // Legacy bad URL stored on older escalation rows
  if (fallback.includes("/superadmin/support-escalations") && portalRole !== "super_admin") {
    if (portalRole === "dev") {
      return withQueryParam("/dev/escalations", "conversationId", conversationId);
    }
    if (portalRole === "staff") {
      return conversationId
        ? `/staff/messages/${encodeURIComponent(conversationId)}`
        : "/staff/messages";
    }
    if (portalRole === "admin") {
      return "/admin/dashboard?openSupport=1";
    }
    return "/user/dashboard?openSupport=1";
  }

  // Remap common /user/* leftovers when the recipient is not a user.
  if (portalRole !== "user" && fallback.startsWith("/user/")) {
    if (fallback.startsWith("/user/inquiry")) return portalInquiryPath(portalRole);
    if (fallback.startsWith("/user/leads")) return portalLeadsPath(portalRole);
    if (
      fallback.startsWith("/user/analytics") ||
      /^\/user\/bizcard(\/|$|\?)/.test(fallback)
    ) {
      const fromPath = fallback.match(/\/user\/bizcard\/([^/?#]+)/)?.[1] ?? "";
      const bizcardId = metaString(meta, "bizcard_id", "bizcardId") || fromPath;
      return portalBizcardDashboardPath(portalRole, bizcardId);
    }
    if (fallback.startsWith("/user/associate")) return portalAssociatePath(portalRole);
    if (fallback.startsWith("/user/calendar")) {
      const qEvent = fallback.includes("event=")
        ? (fallback.split("event=")[1]?.split("&")[0] ?? "")
        : eventId;
      return portalCalendarPath(portalRole, decodeURIComponent(qEvent || ""));
    }
    if (fallback.startsWith("/user/emarket")) {
      const qs = fallback.includes("?") ? fallback.slice(fallback.indexOf("?")) : "";
      if (portalRole === "admin") return `/admin/emarket${qs}`;
      if (portalRole === "staff") return `/staff/emarket${qs}`;
    }
    if (isGenericPortalDashboard(fallback)) return portalDashboardPath(portalRole);
  }

  return fallback || portalDashboardPath(portalRole);
}



export function getDefaultPreferences(): Record<string, { in_app: boolean; email: boolean; digest: boolean; priority: NotificationPriority }> {
  return {
    profile_view: { in_app: true, email: false, digest: true, priority: "medium" },
    contact_download: { in_app: true, email: true, digest: false, priority: "high" },
    friend_request_sent: { in_app: true, email: true, digest: false, priority: "critical" },
    friend_request_accepted: { in_app: true, email: false, digest: false, priority: "high" },
    profile_shared: { in_app: true, email: false, digest: true, priority: "medium" },
    inquiry_sent: { in_app: true, email: true, digest: false, priority: "high" },
    system_update: { in_app: true, email: true, digest: false, priority: "medium" },
    subscription_expiring: { in_app: true, email: true, digest: false, priority: "high" },
    connection_added: { in_app: true, email: true, digest: false, priority: "high" },
    birthday: { in_app: true, email: true, digest: false, priority: "low" },
    achievement: { in_app: true, email: false, digest: true, priority: "low" },
    mention: { in_app: true, email: true, digest: false, priority: "high" },
    comment: { in_app: true, email: true, digest: false, priority: "medium" },
    promotional: { in_app: false, email: false, digest: false, priority: "low" },
    support_message_received: { in_app: true, email: true, digest: false, priority: "high" },
    support_escalated: { in_app: true, email: true, digest: false, priority: "high" },
    support_resolved: { in_app: true, email: true, digest: false, priority: "medium" },
    direct_message_received: { in_app: true, email: false, digest: false, priority: "high" },
    client_order_placed: { in_app: true, email: true, digest: false, priority: "high" },
    product_inquiry_received: { in_app: true, email: true, digest: false, priority: "high" },
    client_assigned: { in_app: true, email: true, digest: false, priority: "high" },
    calendar_event_shared: { in_app: true, email: false, digest: false, priority: "high" },
    calendar_event_reminder: { in_app: true, email: false, digest: false, priority: "high" },
    calendar_event_attendance: { in_app: true, email: false, digest: false, priority: "medium" },
  };
}

export async function getOrCreateNotificationPreference(userId: bigint): Promise<{
  id: string;
  user_id: bigint;
  email_verified: boolean;
  digest_schedule: string;
  digest_time: string;
  timezone: string;
  quiet_hours: string | null;
  preferences: string;
  emails_sent_today: number;
  email_frequency_reset: Date | null;
  unsubscribed_at: Date | null;
}> {
  const [existing, credential] = await Promise.all([
    prisma.notificationPreference.findUnique({
    where: { user_id: userId },
    }),
    prisma.credential.findUnique({
      where: { user_id: userId },
      select: { email_verified: true },
    }),
  ]);
  const credentialVerified = credential?.email_verified === true;

  if (existing) {
    if (credentialVerified && !existing.email_verified) {
      return prisma.notificationPreference.update({
        where: { user_id: userId },
        data: { email_verified: true },
      });
    }
    return existing;
  }

  return prisma.notificationPreference.create({
    data: {
      id: randomId("npref"),
      user_id: userId,
      preferences: JSON.stringify(getDefaultPreferences()),
      quiet_hours: JSON.stringify({
        enabled: false,
        start: "22:00",
        end: "08:00",
        timezone: "UTC",
      }),
      digest_schedule: "daily",
      digest_time: "08:00",
      timezone: "UTC",
      email_verified: credentialVerified,
      emails_sent_today: 0,
      email_frequency_reset: new Date(),
    },
  });
}

export function shouldSuppressForQuietHours(pref: unknown, now = new Date()): boolean {
  if (!pref) return false;
  const p =
    typeof pref === "string"
      ? (() => {
          try {
            const parsed: unknown = JSON.parse(pref);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed)
              ? (parsed as Record<string, unknown>)
              : null;
          } catch {
            return null;
          }
        })()
      : typeof pref === "object" && !Array.isArray(pref)
        ? (pref as Record<string, unknown>)
        : null;
  if (!p) return false;
  if (p.enabled !== true) return false;
  const start = typeof p.start === "string" ? p.start : "22:00";
  const end = typeof p.end === "string" ? p.end : "08:00";
  const timezone = typeof p.timezone === "string" ? p.timezone : "UTC";
  const [sh, sm] = start.split(":").map((v) => Number(v));
  const [eh, em] = end.split(":").map((v) => Number(v));
  if (!Number.isFinite(sh) || !Number.isFinite(sm) || !Number.isFinite(eh) || !Number.isFinite(em)) return false;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const currentHour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const currentMinute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  const minutes = currentHour * 60 + currentMinute;
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;

  if (startMin <= endMin) return minutes >= startMin && minutes < endMin;
  return minutes >= startMin || minutes < endMin;
}

export function setNotificationCache(key: string, value: unknown, ttlMs: number): void {
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
}

export function getNotificationCache<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.value as T;
}

export function clearNotificationCachePrefix(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export function formatTimeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export async function getUnreadSummary(userId: bigint) {
  const [total, byPriority] = await Promise.all([
    prisma.userNotification.count({ where: { user_id: userId, is_read: false } }),
    prisma.userNotification.groupBy({
      by: ["priority"],
      where: { user_id: userId, is_read: false },
      _count: { _all: true },
    }),
  ]);

  const summary = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const row of byPriority) {
    if (row.priority in summary) {
      summary[row.priority as keyof typeof summary] = row._count._all;
    }
  }

  return { unread_count: total, by_priority: summary };
}

export async function recordDeliveryEvent(params: {
  notificationId: string;
  userId: bigint;
  eventType: string;
  channel: string;
  metadata?: Record<string, unknown>;
  request?: NextRequest;
}): Promise<void> {
  const ip = params.request ? getClientIp(params.request) : null;
  const ua = params.request ? getUserAgent(params.request) : null;
  await prisma.notificationEvent.create({
    data: {
      id: randomId("nevt"),
      notification_id: params.notificationId,
      user_id: params.userId,
      event_type: params.eventType,
      channel: params.channel,
      metadata: JSON.stringify(params.metadata ?? {}),
      ip_address: ip === "unknown" ? null : ip,
      user_agent: ua ?? null,
    },
  });
}

export function buildNotificationContent(eventType: string, metadata: Record<string, unknown>): {
  title: string;
  message: string;
  action_url: string;
  action_text: string;
} {
  const actionOverride =
    typeof metadata.action_url === "string" && metadata.action_url.trim()
      ? metadata.action_url.trim()
      : null;
  const actionTextOverride =
    typeof metadata.action_text === "string" && metadata.action_text.trim()
      ? metadata.action_text.trim()
      : null;

  const finalize = (content: {
    title: string;
    message: string;
    action_url: string;
    action_text: string;
  }) => ({
    title: typeof metadata.title === "string" && metadata.title.trim() ? metadata.title.trim() : content.title,
    message:
      typeof metadata.message === "string" && metadata.message.trim()
        ? metadata.message.trim()
        : content.message,
    action_url: actionOverride ?? content.action_url,
    action_text: actionTextOverride ?? content.action_text,
  });

  switch (eventType) {
    case "profile_view": {
      const viewer = typeof metadata.viewer_name === "string" ? metadata.viewer_name : "Someone";
      const biz = typeof metadata.viewer_business === "string" ? metadata.viewer_business : "their business";
      const bizcardId =
        typeof metadata.bizcard_id === "string" || typeof metadata.bizcard_id === "number"
          ? String(metadata.bizcard_id)
          : typeof metadata.bizcardId === "string" || typeof metadata.bizcardId === "number"
            ? String(metadata.bizcardId)
            : "";
      return {
        title: "New profile view",
        message: `${viewer} from ${biz} viewed your profile`,
        action_url: portalBizcardDashboardPath("user", bizcardId),
        action_text: "Open BizCard Dashboard",
      };
    }
    case "contact_download": {
      const bizcardId =
        typeof metadata.bizcard_id === "string" || typeof metadata.bizcard_id === "number"
          ? String(metadata.bizcard_id)
          : typeof metadata.bizcardId === "string" || typeof metadata.bizcardId === "number"
            ? String(metadata.bizcardId)
            : "";
      return {
        title: "Contact downloaded",
        message: "Someone downloaded your contact information",
        action_url: portalBizcardDashboardPath("user", bizcardId),
        action_text: "Open BizCard Dashboard",
      };
    }
    case "friend_request_sent":
      return {
        title: "New friend request",
        message: "You received a new friend request",
        action_url: "/user/associate",
        action_text: "Review Request",
      };
    case "friend_request_accepted":
      return {
        title: "Friend request accepted",
        message: "Your connection request was accepted",
        action_url: "/user/associate",
        action_text: "Open Connections",
      };
    case "inquiry_sent": {
      const isVisitorLead = metadata.source === "visitor_lead";
      const sender =
        typeof metadata.sender_name === "string" && metadata.sender_name.trim()
          ? metadata.sender_name.trim()
          : "Someone";
      return finalize({
        title: isVisitorLead ? "New portfolio lead" : "New inquiry",
        message: isVisitorLead
          ? `${sender} left contact details on your portfolio`
          : "You received a new message inquiry",
        action_url: isVisitorLead ? "/user/leads" : "/user/inquiry",
        action_text: isVisitorLead ? "Open Leads" : "Open Inquiry",
      });
    }
    case "connection_added":
      return {
        title: "New connection",
        message: "You have a new confirmed connection",
        action_url: "/user/associate",
        action_text: "View Connections",
      };
    case "system_update":
      return {
        title: "System update",
        message: "Platform update is available",
        action_url: "/user/dashboard",
        action_text: "Open Dashboard",
      };
    case "subscription_expiring": {
      const kind = typeof metadata.kind === "string" ? metadata.kind : "";
      const customTitle = typeof metadata.title === "string" ? metadata.title.trim() : "";
      const customMessage = typeof metadata.message === "string" ? metadata.message.trim() : "";
      const title =
        customTitle ||
        (kind === "free_trial"
          ? "Free trial ending"
          : kind === "expired"
            ? "Subscription expired"
            : "Subscription expiring");
      return {
        title,
        message:
          customMessage ||
          "Your subscription is about to expire. Renew now to avoid interruption.",
        action_url: "/user/emarket?tab=subscription",
        action_text: "Renew Now",
      };
    }
    case "support_message_received":
      return finalize({
        title: "New support message",
        message: "You received a new customer support message",
        action_url: "/user/dashboard?openSupport=1",
        action_text: "Open Support",
      });
    case "support_escalated": {
      const target = metadata.target === "super_admin" ? "Super Admin" : "Development";
      return finalize({
        title: "Support escalated",
        message: `A support conversation was escalated to ${target}`,
        action_url: "/user/dashboard?openSupport=1",
        action_text: "View Escalation",
      });
    }
    case "support_resolved":
      return finalize({
        title: "Support issue resolved",
        message: "Your escalated support issue has been marked as fixed",
        action_url: "/user/dashboard?openSupport=1",
        action_text: "View Support",
      });
    case "direct_message_received":
      return {
        title: "New message",
        message: "You received a new message from a connection",
        action_url: "/user/associate",
        action_text: "Open Messages",
      };
    case "client_order_placed": {
      const orderNumber =
        typeof metadata.order_number === "string" ? metadata.order_number : "a new order";
      const clientName =
        typeof metadata.client_name === "string" ? metadata.client_name : "A client";
      return {
        title: "New client order",
        message: `${clientName} placed order ${orderNumber}`,
        action_url: "/staff/orders",
        action_text: "View Orders",
      };
    }
    case "product_inquiry_received": {
      const reference =
        typeof metadata.reference_number === "string"
          ? metadata.reference_number
          : "a new inquiry";
      const clientName =
        typeof metadata.client_name === "string" ? metadata.client_name : "A client";
      const inquiryTitle =
        typeof metadata.title === "string" ? metadata.title : "Product inquiry";
      return {
        title: "New product inquiry",
        message: `${clientName}: ${inquiryTitle} (${reference})`,
        action_url: "/staff/product-inquiries",
        action_text: "Open Inquiry",
      };
    }
    case "client_assigned": {
      const assignedClientName =
        typeof metadata.client_name === "string" ? metadata.client_name : "A client";
      return finalize({
        title: "New client assigned",
        message: `Super Admin assigned ${assignedClientName} to you.`,
        action_url: "/staff/clients",
        action_text: "View Clients",
      });
    }
    case "calendar_event_shared": {
      const eventTitle =
        typeof metadata.event_title === "string" ? metadata.event_title : "an appointment";
      const ownerName =
        typeof metadata.owner_name === "string" ? metadata.owner_name : "Someone";
      const eventId =
        typeof metadata.event_id === "string"
          ? metadata.event_id
          : typeof metadata.eventId === "string"
            ? metadata.eventId
            : typeof metadata.calendar_event_id === "string"
              ? metadata.calendar_event_id
              : "";
      return finalize({
        title: "New calendar appointment",
        message: `${ownerName} shared "${eventTitle}" with you.`,
        action_url: eventId
          ? `/user/calendar?event=${encodeURIComponent(eventId)}`
          : "/user/calendar",
        action_text: "View invitation",
      });
    }
    case "calendar_event_reminder": {
      const eventTitle =
        typeof metadata.event_title === "string" ? metadata.event_title : "your appointment";
      const kind = metadata.reminder_kind === "upcoming" ? "soon" : "today";
      const eventId =
        typeof metadata.event_id === "string"
          ? metadata.event_id
          : typeof metadata.eventId === "string"
            ? metadata.eventId
            : "";
      return finalize({
        title: kind === "soon" ? "Appointment starting soon" : "Appointment is today",
        message: `Reminder: "${eventTitle}" is ${kind === "soon" ? "starting within 2 hours" : "scheduled for today"}.`,
        action_url: eventId
          ? `/user/calendar?event=${encodeURIComponent(eventId)}`
          : "/user/calendar",
        action_text: "Open calendar",
      });
    }
    case "calendar_event_attendance": {
      const eventTitle =
        typeof metadata.event_title === "string" ? metadata.event_title : "your appointment";
      const attendeeName =
        typeof metadata.attendee_name === "string" ? metadata.attendee_name : "Someone";
      const eventId =
        typeof metadata.event_id === "string"
          ? metadata.event_id
          : typeof metadata.eventId === "string"
            ? metadata.eventId
            : "";
      return finalize({
        title: "Someone is attending your event",
        message: `${attendeeName} joined "${eventTitle}".`,
        action_url: eventId
          ? `/user/calendar?event=${encodeURIComponent(eventId)}`
          : "/user/calendar",
        action_text: "View event",
      });
    }
    default:
      return finalize({
        title: "New notification",
        message: "You have a new notification",
        action_url: "/user/dashboard",
        action_text: "Open Dashboard",
      });
  }
}

export async function isBlockedEitherDirection(a: bigint, b: bigint): Promise<boolean> {
  const hit = await prisma.blockedUser.findFirst({
    where: {
      OR: [
        { user_id: a, blocked_user_id: b },
        { user_id: b, blocked_user_id: a },
      ],
    },
    select: { id: true },
  });
  return Boolean(hit);
}

export async function queueEmailForNotification(params: {
  userId: bigint;
  notificationId?: string | null;
  recipientEmail: string;
  recipientName: string | null;
  subject: string;
  templateName: string;
  templateData: Record<string, unknown>;
  emailType: string;
  priority: number;
  /** When true, SMTP-send immediately after queueing (still tracked in the queue). */
  sendNow?: boolean;
}) {
  const row = await prisma.notificationEmailQueue.create({
    data: {
      id: randomId("eq"),
      user_id: params.userId,
      notification_id: params.notificationId ?? null,
      email_type: params.emailType,
      priority: params.priority,
      subject: params.subject,
      template_name: params.templateName,
      template_data: JSON.stringify(params.templateData),
      recipient_email: params.recipientEmail,
      recipient_name: params.recipientName,
      status: "queued",
      attempts: 0,
      max_attempts: 3,
      opens: 0,
      clicks: 0,
    },
  });

  if (params.sendNow) {
    await dispatchQueuedNotificationEmail(row.id);
  }

  return row;
}

/**
 * Queue a notification email when the recipient's preferences allow it.
 * Used by company/superadmin helpers that create UserNotification outside createNotificationFromEvent.
 */
export async function maybeQueueEmailForCreatedNotification(params: {
  userId: bigint;
  notificationId: string;
  eventType: string;
  title: string;
  message: string;
  actionUrl?: string | null;
  actionText?: string | null;
  metadata?: Record<string, unknown>;
  needsEmail?: boolean;
}): Promise<boolean> {
  if (params.needsEmail === false) return false;

  const [pref, user] = await Promise.all([
    getOrCreateNotificationPreference(params.userId),
    prisma.user.findUnique({
      where: { user_id: params.userId },
      select: { email: true, first_name: true, is_active: true },
    }),
  ]);

  if (!user?.is_active || !user.email) return false;
  if (pref.unsubscribed_at !== null) return false;
  if (!pref.email_verified) return false;
  if (shouldSuppressForQuietHours(pref.quiet_hours)) return false;

  let prefs: Record<string, { email?: boolean }> = {};
  try {
    const parsed: unknown = JSON.parse(pref.preferences);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      prefs = parsed as Record<string, { email?: boolean }>;
    }
  } catch {
    prefs = {};
  }

  const defaults = getDefaultPreferences();
  const perType =
    prefs[params.eventType] ??
    defaults[params.eventType as keyof typeof defaults] ??
    // SA / company custom event types: follow system_update email preference
    prefs.system_update ??
    defaults.system_update;

  if (perType.email !== true) return false;

  const frontendUrl = (process.env.FRONTEND_URL ?? "").replace(/\/$/, "");
  const actionPath = params.actionUrl?.trim() || "";
  const actionLink =
    actionPath && frontendUrl
      ? actionPath.startsWith("http")
        ? actionPath
        : `${frontendUrl}${actionPath.startsWith("/") ? "" : "/"}${actionPath}`
      : actionPath || frontendUrl;

  await queueEmailForNotification({
    userId: params.userId,
    notificationId: params.notificationId,
    recipientEmail: user.email,
    recipientName: user.first_name,
    subject: params.title,
    templateName:
      params.eventType === "system_update" || params.eventType.startsWith("sa_")
        ? "system-update"
        : "default",
    templateData: {
      ...(params.metadata ?? {}),
      app_name: process.env.EMAIL_FROM_NAME ?? "OnTap",
      user_name: user.first_name,
      title: params.title,
      message: params.message,
      action_url: actionLink,
      action_text: params.actionText ?? "View",
      app_url: frontendUrl,
    },
    emailType: "immediate",
    priority: 75,
  });

  return true;
}

function normalizeQueuedTemplateData(input: unknown): Record<string, unknown> {
  if (!input) return {};
  if (typeof input === "string") {
    try {
      const parsed: unknown = JSON.parse(input);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

/** Send one queued notification email now and update queue/delivery status. */
export async function dispatchQueuedNotificationEmail(queueId: string): Promise<void> {
  const { renderNotificationTemplate } = await import("@/server/lib/notification-templates");
  const { sendEmailMessage } = await import("@/server/lib/email");

  const email = await prisma.notificationEmailQueue.findUnique({ where: { id: queueId } });
  if (!email || email.status !== "queued") return;

  try {
    const rendered = renderNotificationTemplate(
      email.template_name ?? "default",
      normalizeQueuedTemplateData(email.template_data),
    );
    await sendEmailMessage({
      to: email.recipient_email,
      subject: email.subject || rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    await prisma.notificationEmailQueue.update({
      where: { id: email.id },
      data: {
        status: "sent",
        sent_at: new Date(),
        last_attempt: new Date(),
        attempts: { increment: 1 },
        error_message: null,
      },
    });

    if (email.notification_id) {
      await prisma.notificationDelivery.updateMany({
        where: { notification_id: email.notification_id, channel: "email" },
        data: {
          status: "delivered",
          delivered_at: new Date(),
          error_message: null,
        },
      });
      await recordDeliveryEvent({
        notificationId: email.notification_id,
        userId: email.user_id,
        eventType: "delivered",
        channel: "email",
      });
    }
  } catch (error) {
    await prisma.notificationEmailQueue.update({
      where: { id: email.id },
      data: {
        status: "failed",
        attempts: { increment: 1 },
        last_attempt: new Date(),
        error_message:
          error instanceof Error ? error.message.slice(0, 1000) : "Unknown email send failure.",
      },
    });
    throw error;
  }
}

function resolveTemplateName(eventType: NotificationEventType): string {
  switch (eventType) {
    case "friend_request_sent":
      return "friend-request";
    case "profile_view":
      return "profile-view";
    case "contact_download":
      return "contact-download";
    case "system_update":
      return "system-update";
    case "subscription_expiring":
      return "system-update";
    default:
      return "default";
  }
}

function resolvePriorityWeight(priority: NotificationPriority): number {
  switch (priority) {
    case "critical":
      return 100;
    case "high":
      return 75;
    case "medium":
      return 50;
    default:
      return 10;
  }
}

export async function createNotificationFromEvent(params: {
  targetUserId: bigint;
  triggerUserId?: bigint | null;
  eventType: NotificationEventType;
  priority?: NotificationPriority;
  metadata?: Record<string, unknown>;
  needsEmail?: boolean;
  emailPriority?: EmailPriority;
}, txClient?: Prisma.TransactionClient): Promise<{
  success: boolean;
  notificationId: string | null;
  queuedForEmail: boolean;
  unreadCount: number;
  userPreferencesRespected: {
    in_app: boolean;
    email: boolean;
    digest: boolean;
  };
  reason?: string;
}> {
  const triggerUserId = params.triggerUserId ?? null;

  if (triggerUserId && triggerUserId === params.targetUserId) {
    return {
      success: false,
      notificationId: null,
      queuedForEmail: false,
      unreadCount: 0,
      userPreferencesRespected: { in_app: false, email: false, digest: false },
      reason: "self_target_blocked",
    };
  }

  const [targetUser, triggerUser] = await Promise.all([
    prisma.user.findUnique({
      where: { user_id: params.targetUserId },
      select: {
        user_id: true,
        email: true,
        first_name: true,
        is_active: true,
        role: true,
      },
    }),
    triggerUserId
      ? prisma.user.findUnique({
          where: { user_id: triggerUserId },
          select: { user_id: true, first_name: true, company: { select: { name: true } } },
        })
      : Promise.resolve(null),
  ]);

  if (!targetUser || !targetUser.is_active) {
    return {
      success: false,
      notificationId: null,
      queuedForEmail: false,
      unreadCount: 0,
      userPreferencesRespected: { in_app: false, email: false, digest: false },
      reason: "target_not_found",
    };
  }

  if (triggerUserId && (await isBlockedEitherDirection(triggerUserId, params.targetUserId))) {
    return {
      success: false,
      notificationId: null,
      queuedForEmail: false,
      unreadCount: 0,
      userPreferencesRespected: { in_app: false, email: false, digest: false },
      reason: "blocked",
    };
  }

  const pref = await getOrCreateNotificationPreference(params.targetUserId);
  const prefs = (() => {
    try {
      const parsed: unknown = JSON.parse(pref.preferences);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, { in_app?: boolean; email?: boolean; digest?: boolean; priority?: string }>;
      }
      return {};
    } catch {
      return {};
    }
  })();
  const perType = prefs?.[params.eventType] ?? getDefaultPreferences()[params.eventType] ?? {
    in_app: true,
    email: false,
    digest: false,
    priority: "medium",
  };
  const resolvedPriority = params.priority ?? (isValidPriority(String(perType.priority)) ? (perType.priority as NotificationPriority) : "medium");
  const resolvedEmailPriority = params.emailPriority ?? (perType.digest ? "digest" : "batch");

  const shouldInApp = perType.in_app !== false;
  // Omitting needsEmail follows preferences; explicit false suppresses (e.g. DMs).
  const emailRequested = params.needsEmail !== false;
  const shouldEmail =
    emailRequested &&
    pref.unsubscribed_at === null &&
    pref.email_verified === true &&
    perType.email === true &&
    !shouldSuppressForQuietHours(pref.quiet_hours);

  if (!shouldInApp && !shouldEmail && perType.digest !== true) {
    const digestEnabled = Boolean(perType.digest);
    const unread = await getUnreadSummary(params.targetUserId);
    return {
      success: false,
      notificationId: null,
      queuedForEmail: false,
      unreadCount: unread.unread_count,
      userPreferencesRespected: {
        in_app: false,
        email: false,
        digest: digestEnabled,
      },
      reason: "suppressed_by_preferences",
    };
  }

  const content = buildNotificationContent(params.eventType, params.metadata ?? {});
  const actionUrl = resolveNotificationActionUrlForRole(
    params.eventType,
    targetUser.role,
    params.metadata ?? {},
    content.action_url,
  );
  content.action_url = actionUrl;
  const notificationId = randomId("notif");

  // Use a single transaction to write notification and delivery records to avoid
  // long-lived interactive transactions and reduce chances of transaction ID errors.
  const ops = [];

  if (shouldInApp || shouldEmail || perType.digest === true) {
    ops.push(
      prisma.userNotification.create({
        data: {
          id: notificationId,
          user_id: params.targetUserId,
          trigger_user_id: triggerUserId,
          event_type: params.eventType,
          priority: resolvedPriority,
          title: content.title,
          message: content.message,
          metadata: JSON.stringify(params.metadata ?? {}),
          action_url: content.action_url,
          action_text: content.action_text,
        },
      })
    );

    ops.push(
      prisma.notificationDelivery.create({
        data: {
          id: randomId("ndel"),
          notification_id: notificationId,
          channel: "in_app",
          status: shouldInApp ? "delivered" : "pending",
          delivered_at: shouldInApp ? new Date() : null,
        },
      })
    );
  }

  if (shouldEmail) {
    // create email queue entry and delivery record in the same transaction
    ops.push(
      prisma.notificationEmailQueue.create({
        data: {
          id: randomId("eq"),
          user_id: params.targetUserId,
          notification_id: notificationId ?? null,
          email_type: resolvedEmailPriority,
          priority: resolvePriorityWeight(resolvedPriority),
          subject: content.title,
          template_name: resolveTemplateName(params.eventType),
          template_data: JSON.stringify({
            ...(params.metadata ?? {}),
            app_name: process.env.EMAIL_FROM_NAME ?? "OnTap",
            user_name: targetUser.first_name,
            sender_name: triggerUser?.first_name,
            sender_business: triggerUser?.company?.name ?? null,
            title: content.title,
            message: content.message,
            action_url: content.action_url,
            action_text: content.action_text,
            app_url: process.env.FRONTEND_URL ?? "",
          }),
          recipient_email: targetUser.email,
          recipient_name: targetUser.first_name,
          status: "queued",
          attempts: 0,
          max_attempts: 3,
          opens: 0,
          clicks: 0,
        },
      })
    );

    ops.push(
      prisma.notificationDelivery.create({
        data: {
          id: randomId("ndel"),
          notification_id: notificationId,
          channel: "email",
          status: "pending",
        },
      })
    );
  }

  if (ops.length > 0) {
    try {
      if (txClient) {
        // If caller gave us a transaction client, use it directly.
        // Write sequentially on the provided transaction client to keep ordering.
        await txClient.userNotification.create({
          data: {
            id: notificationId,
            user_id: params.targetUserId,
            trigger_user_id: triggerUserId,
            event_type: params.eventType,
            priority: resolvedPriority,
            title: content.title,
            message: content.message,
            metadata: JSON.stringify(params.metadata ?? {}),
            action_url: content.action_url,
            action_text: content.action_text,
          },
        });

        if (shouldInApp || shouldEmail || perType.digest === true) {
          await txClient.notificationDelivery.create({
            data: {
              id: randomId("ndel"),
              notification_id: notificationId,
              channel: "in_app",
              status: shouldInApp ? "delivered" : "pending",
              delivered_at: shouldInApp ? new Date() : null,
            },
          });
        }

        if (shouldEmail) {
          await txClient.notificationEmailQueue.create({
            data: {
              id: randomId("eq"),
              user_id: params.targetUserId,
              notification_id: notificationId ?? null,
              email_type: resolvedEmailPriority,
              priority: resolvePriorityWeight(resolvedPriority),
              subject: content.title,
              template_name: resolveTemplateName(params.eventType),
              template_data: JSON.stringify({
                ...(params.metadata ?? {}),
                app_name: process.env.EMAIL_FROM_NAME ?? "OnTap",
                user_name: targetUser.first_name,
                sender_name: triggerUser?.first_name,
                sender_business: triggerUser?.company?.name ?? null,
                title: content.title,
                message: content.message,
                action_url: content.action_url,
                action_text: content.action_text,
                app_url: process.env.FRONTEND_URL ?? "",
              }),
              recipient_email: targetUser.email,
              recipient_name: targetUser.first_name,
              status: "queued",
              attempts: 0,
              max_attempts: 3,
              opens: 0,
              clicks: 0,
            },
          });

          await txClient.notificationDelivery.create({
            data: {
              id: randomId("ndel"),
              notification_id: notificationId,
              channel: "email",
              status: "pending",
            },
          });
        }
      } else {
        // Prefer array-style transaction for speed; if it fails, we'll fallback
        // to a callback-style transaction which creates a fresh transaction client.
        try {
          await prisma.$transaction(ops);
        } catch (innerErr) {
          console.error('[Notifications] Transaction array failed, retrying with callback transaction:', innerErr);
          try {
            await prisma.$transaction(async (tx) => {
              // recreate writes sequentially inside a fresh transaction
              await tx.userNotification.create({
                data: {
                  id: notificationId,
                  user_id: params.targetUserId,
                  trigger_user_id: triggerUserId,
                  event_type: params.eventType,
                  priority: resolvedPriority,
                  title: content.title,
                  message: content.message,
                  metadata: JSON.stringify(params.metadata ?? {}),
                  action_url: content.action_url,
                  action_text: content.action_text,
                },
              });

              if (shouldInApp || shouldEmail || perType.digest === true) {
                await tx.notificationDelivery.create({
                  data: {
                    id: randomId("ndel"),
                    notification_id: notificationId,
                    channel: "in_app",
                    status: shouldInApp ? "delivered" : "pending",
                    delivered_at: shouldInApp ? new Date() : null,
                  },
                });
              }

              if (shouldEmail) {
                await tx.notificationEmailQueue.create({
                  data: {
                    id: randomId("eq"),
                    user_id: params.targetUserId,
                    notification_id: notificationId ?? null,
                    email_type: resolvedEmailPriority,
                    priority: resolvePriorityWeight(resolvedPriority),
                    subject: content.title,
                    template_name: resolveTemplateName(params.eventType),
                    template_data: JSON.stringify({
                      ...(params.metadata ?? {}),
                      app_name: process.env.EMAIL_FROM_NAME ?? "OnTap",
                      user_name: targetUser.first_name,
                      sender_name: triggerUser?.first_name,
                      sender_business: triggerUser?.company?.name ?? null,
                      title: content.title,
                      message: content.message,
                      action_url: content.action_url,
                      action_text: content.action_text,
                      app_url: process.env.FRONTEND_URL ?? "",
                    }),
                    recipient_email: targetUser.email,
                    recipient_name: targetUser.first_name,
                    status: "queued",
                    attempts: 0,
                    max_attempts: 3,
                    opens: 0,
                    clicks: 0,
                  },
                });

                await tx.notificationDelivery.create({
                  data: {
                    id: randomId("ndel"),
                    notification_id: notificationId,
                    channel: "email",
                    status: "pending",
                  },
                });
              }
            });
          } catch (finalErr) {
            console.error('[Notifications] Callback transaction retry failed:', finalErr);
            // Final fallback: attempt to reset the Prisma connection and perform
            // best-effort individual writes. This can clear stale transaction
            // state that sometimes causes "Transaction not found" errors.
            try {
              try {
                await prisma.$disconnect();
              } catch (_) {}
              await prisma.$connect();

              // Best-effort individual writes without a surrounding transaction
              await prisma.userNotification.create({
                data: {
                  id: notificationId,
                  user_id: params.targetUserId,
                  trigger_user_id: triggerUserId,
                  event_type: params.eventType,
                  priority: resolvedPriority,
                  title: content.title,
                  message: content.message,
                  metadata: JSON.stringify(params.metadata ?? {}),
                  action_url: content.action_url,
                  action_text: content.action_text,
                },
              });

              if (shouldInApp || shouldEmail || perType.digest === true) {
                await prisma.notificationDelivery.create({
                  data: {
                    id: randomId("ndel"),
                    notification_id: notificationId,
                    channel: "in_app",
                    status: shouldInApp ? "delivered" : "pending",
                    delivered_at: shouldInApp ? new Date() : null,
                  },
                });
              }

              if (shouldEmail) {
                await prisma.notificationEmailQueue.create({
                  data: {
                    id: randomId("eq"),
                    user_id: params.targetUserId,
                    notification_id: notificationId ?? null,
                    email_type: resolvedEmailPriority,
                    priority: resolvePriorityWeight(resolvedPriority),
                    subject: content.title,
                    template_name: resolveTemplateName(params.eventType),
                    template_data: JSON.stringify({
                      ...(params.metadata ?? {}),
                      app_name: process.env.EMAIL_FROM_NAME ?? "OnTap",
                      user_name: targetUser.first_name,
                      sender_name: triggerUser?.first_name,
                      sender_business: triggerUser?.company?.name ?? null,
                      title: content.title,
                      message: content.message,
                      action_url: content.action_url,
                      action_text: content.action_text,
                      app_url: process.env.FRONTEND_URL ?? "",
                    }),
                    recipient_email: targetUser.email,
                    recipient_name: targetUser.first_name,
                    status: "queued",
                    attempts: 0,
                    max_attempts: 3,
                    opens: 0,
                    clicks: 0,
                  },
                });

                await prisma.notificationDelivery.create({
                  data: {
                    id: randomId("ndel"),
                    notification_id: notificationId,
                    channel: "email",
                    status: "pending",
                  },
                });
              }
            } catch (finalFallbackErr) {
              console.error('[Notifications] Final fallback failed to write notification records:', finalFallbackErr);
            }
          }
        }
      }
    } catch (err) {
      console.error('[Notifications] Error writing notification records in transaction or fallback:', err);
    }
  }

  clearNotificationCachePrefix(`notifications:${params.targetUserId.toString()}:`);
  const unread = await getUnreadSummary(params.targetUserId);

  return {
    success: true,
    notificationId,
    queuedForEmail: shouldEmail,
    unreadCount: unread.unread_count,
    userPreferencesRespected: {
      in_app: shouldInApp,
      email: shouldEmail,
      digest: perType.digest === true,
    },
  };
}

export function buildDigestItems(notifications: Array<{
  title: string | null;
  message: string | null;
  event_type: string;
}>): Array<{ title: string; message: string; count: number }> {
  const grouped = new Map<string, { title: string; message: string; count: number }>();

  for (const notification of notifications) {
    const key = `${notification.event_type}:${notification.title ?? ""}:${notification.message ?? ""}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    grouped.set(key, {
      title: notification.title ?? "Update",
      message: notification.message ?? "You have a new notification.",
      count: 1,
    });
  }

  return Array.from(grouped.values());
}

export async function notifyAssignedStaffForOrder(
  clientUserId: bigint,
  orderId: bigint,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const assignments = await prisma.staffClientAssignment.findMany({
    where: { client_user_id: clientUserId, is_active: true },
    select: {
      staff_id: true,
      client: {
        select: { first_name: true, last_name: true, email: true },
      },
    },
  });

  if (assignments.length === 0) return;

  const client = assignments[0]?.client;
  const clientName =
    [client?.first_name, client?.last_name].filter(Boolean).join(" ").trim() ||
    client?.email ||
    "Client";

  await Promise.allSettled(
    assignments.map((assignment) =>
      createNotificationFromEvent({
        targetUserId: assignment.staff_id,
        triggerUserId: clientUserId,
        eventType: "client_order_placed",
        priority: "high",
        metadata: {
          ...metadata,
          order_id: orderId.toString(),
          client_name: clientName,
        },
        needsEmail: true,
        emailPriority: "immediate",
      }),
    ),
  );
}
