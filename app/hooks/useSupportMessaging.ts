"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { csrfClient } from "@/lib/csrf-client";
import type {
  SupportAttachmentInput,
  SupportConversation,
  SupportMessage,
} from "../lib/supportMessaging";

type UserApiMode = "user" | "staff" | "admin";

function messagesUrl(mode: UserApiMode, conversationId?: string): string {
  if (mode === "user") return "/api/support/messages";
  if (mode === "staff" && conversationId) {
    return `/api/staff/support/conversations/${conversationId}/messages`;
  }
  if (mode === "admin" && conversationId) {
    return `/api/superadmin/support/conversations/${conversationId}/messages`;
  }
  return "/api/support/messages";
}

function sendUrl(mode: UserApiMode, conversationId: string): string {
  if (mode === "user") return "/api/support/messages";
  if (mode === "staff") return `/api/staff/support/conversations/${conversationId}/messages`;
  return `/api/superadmin/support/conversations/${conversationId}/messages`;
}

function parseApiError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const err = payload as Record<string, unknown>;
  if (typeof err.error === "string" && err.error.trim()) return err.error;
  if (err.error && typeof err.error === "object") {
    const nested = err.error as Record<string, unknown>;
    if (typeof nested.message === "string" && nested.message.trim()) return nested.message;
  }
  if (typeof err.message === "string" && err.message.trim()) return err.message;
  return fallback;
}

function isCsrfFailure(status: number, payload: unknown): boolean {
  if (status !== 403) return false;
  if (!payload || typeof payload !== "object") return false;
  const record = payload as { code?: string; error?: string };
  if (record.code === "CSRF_TOKEN_INVALID" || record.code === "INVALID_CSRF_TOKEN") {
    return true;
  }
  return typeof record.error === "string" && /csrf/i.test(record.error);
}

async function postWithCsrfRetry(url: string, body: unknown): Promise<Response> {
  let opts = await csrfClient.getFetchOptions("POST", body);
  let res = await fetch(url, opts);
  if (res.status === 403) {
    const payload = await res.clone().json().catch(() => ({}));
    if (isCsrfFailure(res.status, payload)) {
      opts = await csrfClient.getFetchOptions("POST", body, true);
      res = await fetch(url, opts);
    }
  }
  return res;
}

function messagesSignature(messages: SupportMessage[]): string {
  if (messages.length === 0) return "0";
  const last = messages[messages.length - 1];
  return `${messages.length}:${last.id}:${last.createdAt}`;
}

export function useSupportMessaging(options: {
  mode: UserApiMode;
  conversationId?: string | null;
  enabled?: boolean;
  pollMs?: number;
}) {
  const { mode, conversationId, enabled = true, pollMs = 5000 } = options;
  const [conversation, setConversation] = useState<SupportConversation | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [initialLoading, setInitialLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef(searchQuery);
  const hasLoadedOnceRef = useRef(false);
  const messagesSigRef = useRef("");

  useEffect(() => {
    searchRef.current = searchQuery;
  }, [searchQuery]);

  const loadUserConversation = useCallback(async () => {
    const res = await fetch("/api/support/conversation", { credentials: "include", cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load conversation");
    const payload = await res.json();
    return payload.data as SupportConversation;
  }, []);

  const loadMessages = useCallback(async (convId: string, q?: string) => {
    const url = new URL(messagesUrl(mode, convId), window.location.origin);
    if (q?.trim()) url.searchParams.set("q", q.trim());
    const res = await fetch(url.toString(), { credentials: "include", cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load messages");
    const payload = await res.json();
    if (mode === "user") {
      const data = payload.data as { conversation: SupportConversation; messages: SupportMessage[] };
      const nextMessages = data.messages;
      const nextSig = messagesSignature(nextMessages);
      if (nextSig !== messagesSigRef.current) {
        messagesSigRef.current = nextSig;
        setConversation(data.conversation);
        setMessages(nextMessages);
      } else if (data.conversation) {
        setConversation(data.conversation);
      }
      return nextMessages;
    }
    const nextMessages = payload.data as SupportMessage[];
    const nextSig = messagesSignature(nextMessages);
    if (nextSig !== messagesSigRef.current) {
      messagesSigRef.current = nextSig;
      setMessages(nextMessages);
    }
    return nextMessages;
  }, [mode]);

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!enabled) return;
    const silent = options?.silent ?? hasLoadedOnceRef.current;
    if (!silent) {
      setInitialLoading(true);
    }
    setError(null);
    try {
      if (mode === "user") {
        await loadMessages("", searchRef.current);
      } else if (conversationId) {
        await loadMessages(conversationId, searchRef.current);
      }
      hasLoadedOnceRef.current = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load support messages");
    } finally {
      if (!silent) {
        setInitialLoading(false);
      }
    }
  }, [conversationId, enabled, loadMessages, mode]);

  const refreshUnread = useCallback(async () => {
    if (!enabled) return;
    const endpoint =
      mode === "user"
        ? "/api/support/unread/count"
        : mode === "staff"
          ? "/api/staff/support/unread/count"
          : "/api/superadmin/support/escalations/unread/count";
    try {
      const res = await fetch(endpoint, { credentials: "include", cache: "no-store" });
      if (!res.ok) return;
      const payload = await res.json();
      setUnreadCount(Number(payload.data?.count ?? 0));
    } catch {
      // ignore badge errors
    }
  }, [enabled, mode]);

  const sendMessage = useCallback(async (body: string, attachments: SupportAttachmentInput[] = []) => {
    setSending(true);
    setError(null);
    try {
      let convId = conversationId ?? conversation?.id;
      if (mode === "user" && !convId) {
        const conv = await loadUserConversation();
        convId = conv.id;
        setConversation(conv);
      }
      if (!convId) throw new Error("No conversation selected");

      const res = await postWithCsrfRetry(sendUrl(mode, convId), { body, attachments });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(parseApiError(err, "Send failed"));
      }
      await refresh({ silent: true });
      await refreshUnread();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send message");
      throw e;
    } finally {
      setSending(false);
    }
  }, [conversation?.id, conversationId, loadUserConversation, mode, refresh, refreshUnread]);

  const escalate = useCallback(async (target: "dev" | "super_admin") => {
    if (!conversationId) return;
    const res = await postWithCsrfRetry(
      `/api/staff/support/conversations/${conversationId}/escalate`,
      { target },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(parseApiError(err, "Escalation failed"));
    }
    const payload = await res.json();
    setConversation(payload.data as SupportConversation);
    await refresh({ silent: true });
  }, [conversationId, refresh]);

  const resolveConversation = useCallback(async (note?: string) => {
    if (!conversationId) return;
    const res = await postWithCsrfRetry(
      `/api/superadmin/support/conversations/${conversationId}/resolve`,
      { note },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(parseApiError(err, "Resolve failed"));
    }
    const payload = await res.json();
    setConversation(payload.data as SupportConversation);
    await refresh({ silent: true });
    await refreshUnread();
  }, [conversationId, refresh, refreshUnread]);

  useEffect(() => {
    hasLoadedOnceRef.current = false;
    messagesSigRef.current = "";
  }, [conversationId]);

  useEffect(() => {
    if (!enabled) return;
    void refresh({ silent: hasLoadedOnceRef.current });
  }, [enabled, refresh, conversationId]);

  useEffect(() => {
    if (!enabled) return;
    void refreshUnread();
    const id = window.setInterval(() => { void refreshUnread(); }, 30000);
    return () => window.clearInterval(id);
  }, [enabled, refreshUnread]);

  useEffect(() => {
    if (!enabled || pollMs <= 0) return;
    const id = window.setInterval(() => { void refresh({ silent: true }); }, pollMs);
    return () => window.clearInterval(id);
  }, [enabled, pollMs, refresh]);

  return {
    conversation,
    setConversation,
    messages,
    searchQuery,
    setSearchQuery,
    loading: initialLoading,
    initialLoading,
    sending,
    unreadCount,
    error,
    refresh,
    refreshUnread,
    sendMessage,
    escalate,
    resolveConversation,
  };
}
