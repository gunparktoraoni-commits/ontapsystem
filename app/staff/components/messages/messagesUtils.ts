import type { SupportAttachment, SupportConversation } from "@/app/lib/supportMessaging";

export const ONLINE_CUTOFF_MINUTES = 5;

export type ListFilter = "all" | "unread" | "today" | "this_week";
export type AssignmentFilter = "all" | "assigned" | "unassigned";

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function formatListTime(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export function isClientOnline(client?: {
  isOnline?: boolean;
  lastActive?: string | null;
}): boolean {
  if (!client) return false;
  if (!client.lastActive) return false;
  const cutoff = Date.now() - ONLINE_CUTOFF_MINUTES * 60 * 1000;
  const lastActiveMs = new Date(client.lastActive).getTime();
  if (Number.isNaN(lastActiveMs)) return false;
  return lastActiveMs >= cutoff;
}

export function matchesSearch(conv: SupportConversation, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const name = conv.client?.name?.toLowerCase() ?? "";
  const email = conv.client?.email?.toLowerCase() ?? "";
  const preview = conv.lastMessagePreview?.toLowerCase() ?? "";
  return name.includes(q) || email.includes(q) || preview.includes(q);
}

export function matchesFilter(conv: SupportConversation, filter: ListFilter): boolean {
  if (filter === "all") return true;
  if (filter === "unread") return (conv.unreadCount ?? 0) > 0;
  if (!conv.lastMessageAt) return false;
  const msgDate = new Date(conv.lastMessageAt);
  const now = new Date();
  if (filter === "today") {
    return msgDate.toDateString() === now.toDateString();
  }
  if (filter === "this_week") {
    const weekAgo = new Date(now);
    weekAgo.setDate(now.getDate() - 7);
    return msgDate >= weekAgo;
  }
  return true;
}

export function matchesAssignmentFilter(
  conv: SupportConversation,
  filter: AssignmentFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "assigned") return !conv.isPooled && conv.staffId !== null;
  if (filter === "unassigned") return conv.isPooled || conv.staffId === null;
  return true;
}

export type SharedAttachment = SupportAttachment & {
  messageId: string;
  createdAt: string;
};

export function collectAttachments(
  messages: Array<{ id: string; createdAt: string; attachments: SupportAttachment[] }>,
): SharedAttachment[] {
  const items: SharedAttachment[] = [];
  for (const msg of messages) {
    for (const att of msg.attachments) {
      items.push({ ...att, messageId: msg.id, createdAt: msg.createdAt });
    }
  }
  return items.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export const FILTER_OPTIONS: { key: ListFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "today", label: "Today" },
  { key: "this_week", label: "This Week" },
];

export const ASSIGNMENT_OPTIONS: { key: AssignmentFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "assigned", label: "Assigned" },
  { key: "unassigned", label: "Unassigned" },
];
