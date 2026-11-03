"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { csrfClient } from "@/lib/csrf-client";
import type {
  MessagingAttachmentInput,
  MessagingConversation,
  MessagingMessage,
} from "../lib/connectionMessaging";
import { normalizeMessagingMediaUrl } from "../lib/connectionMessaging";

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

function messagesSignature(messages: MessagingMessage[]): string {
  if (messages.length === 0) return "0";
  const last = messages[messages.length - 1];
  const seenId = [...messages].reverse().find((m) => m.seen)?.id ?? "";
  const unsentCount = messages.filter((m) => m.unsent).length;
  return `${messages.length}:${last.id}:${last.createdAt}:${seenId}:${unsentCount}`;
}

function normalizeMessages(messages: MessagingMessage[]): MessagingMessage[] {
  return messages.map((message) => ({
    ...message,
    attachments: message.attachments.map((attachment) => ({
      ...attachment,
      mediaUrl: normalizeMessagingMediaUrl(attachment.mediaUrl),
    })),
  }));
}

export function useConnectionMessaging(options: {
  enabled?: boolean;
  initialPeerUserId?: string | null;
  pollMs?: number;
  listPollMs?: number;
}) {
  const {
    enabled = true,
    initialPeerUserId = null,
    pollMs = 5000,
    listPollMs = 15000,
  } = options;

  const [conversations, setConversations] = useState<MessagingConversation[]>([]);
  const [activePeerUserId, setActivePeerUserId] = useState<string | null>(initialPeerUserId);
  const [messages, setMessages] = useState<MessagingMessage[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesSigRef = useRef("");
  const activePeerRef = useRef(activePeerUserId);
  const hasLoadedListRef = useRef(false);

  useEffect(() => {
    activePeerRef.current = activePeerUserId;
  }, [activePeerUserId]);

  useEffect(() => {
    if (initialPeerUserId) {
      setActivePeerUserId(initialPeerUserId);
    }
  }, [initialPeerUserId]);

  const loadConversations = useCallback(async (silent = false) => {
    if (!silent && !hasLoadedListRef.current) setInitialLoading(true);
    try {
      const res = await fetch("/api/messaging/conversations", {
        credentials: "include",
        cache: "no-store",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(parseApiError(payload, "Failed to load conversations"));
      }
      const list = (payload.data?.conversations ?? []) as MessagingConversation[];
      setConversations(list);
      setError(null);
      hasLoadedListRef.current = true;
      return list;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load conversations";
      setError(message);
      return [];
    } finally {
      if (!silent) setInitialLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (peerUserId: string, silent = false) => {
    try {
      const res = await fetch(`/api/messaging/conversations/${peerUserId}/messages`, {
        credentials: "include",
        cache: "no-store",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(parseApiError(payload, "Failed to load messages"));
      }
      const nextMessages = normalizeMessages((payload.data?.messages ?? []) as MessagingMessage[]);
      const nextSig = messagesSignature(nextMessages);
      if (nextSig !== messagesSigRef.current) {
        messagesSigRef.current = nextSig;
        setMessages(nextMessages);
      }
      if (!silent) setError(null);
      return nextMessages;
    } catch (err) {
      if (!silent) {
        const message = err instanceof Error ? err.message : "Failed to load messages";
        setError(message);
      }
      return [];
    }
  }, []);

  const refreshPresence = useCallback(async (peerIds: string[]) => {
    if (peerIds.length === 0) return;
    try {
      const opts = await csrfClient.getFetchOptions("POST", { user_ids: peerIds });
      const res = await fetch("/api/messaging/peers/presence", opts);
      if (!res.ok) return;
      const payload = await res.json();
      const presence = (payload.data?.presence ?? []) as Array<{
        userId: string;
        isOnline: boolean;
        lastActive: string | null;
        lastActiveLabel: string;
      }>;
      if (presence.length === 0) return;
      const map = new Map(presence.map((p) => [p.userId, p]));
      setConversations((prev) =>
        prev.map((c) => {
          const p = map.get(c.peerUserId);
          if (!p) return c;
          return {
            ...c,
            peer: {
              ...c.peer,
              isOnline: p.isOnline,
              lastActive: p.lastActive,
              lastActiveLabel: p.lastActiveLabel,
            },
          };
        }),
      );
    } catch {
      // ignore presence poll errors
    }
  }, []);

  const selectConversation = useCallback(
    async (peerUserId: string) => {
      if (!peerUserId) {
        setActivePeerUserId(null);
        messagesSigRef.current = "";
        setMessages([]);
        return;
      }
      setActivePeerUserId(peerUserId);
      messagesSigRef.current = "";
      setMessages([]);
      let opened: MessagingConversation | null = null;
      try {
        const res = await fetch(`/api/messaging/conversations/${peerUserId}`, {
          credentials: "include",
          cache: "no-store",
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(parseApiError(payload, "Failed to open conversation"));
        }
        opened = (payload?.data?.conversation as MessagingConversation | undefined) ?? null;
        if (opened?.peerUserId) {
          setConversations((prev) => {
            const without = prev.filter((c) => c.peerUserId !== opened!.peerUserId);
            return [opened!, ...without];
          });
        }
        setError(null);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to open conversation";
        setError(message);
      }
      await loadMessages(peerUserId);
      const list = await loadConversations(true);
      // Company-admin threads may not appear in the associates list — keep them visible.
      if (
        opened?.peerUserId &&
        !list.some((c) => c.peerUserId === opened!.peerUserId)
      ) {
        setConversations([opened, ...list]);
      }
    },
    [loadConversations, loadMessages],
  );

  const clearSelection = useCallback(() => {
    setActivePeerUserId(null);
    messagesSigRef.current = "";
    setMessages([]);
  }, []);

  const sendMessage = useCallback(
    async (
      body: string,
      attachments: MessagingAttachmentInput[] = [],
      sharedAssociateUserId?: string,
    ) => {
      const peerUserId = activePeerRef.current;
      if (!peerUserId) return;
      setSending(true);
      setError(null);
      try {
        const opts = await csrfClient.getFetchOptions("POST", {
          body,
          attachments,
          sharedAssociateUserId,
        });
        const res = await fetch(`/api/messaging/conversations/${peerUserId}/messages`, opts);
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(parseApiError(payload, "Failed to send message"));
        }
        const message = normalizeMessages([payload.data as MessagingMessage])[0];
        setMessages((prev) => {
          if (prev.some((m) => m.id === message.id)) return prev;
          const next = [...prev, message];
          messagesSigRef.current = messagesSignature(next);
          return next;
        });
        await loadConversations(true);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to send message";
        setError(message);
        throw err;
      } finally {
        setSending(false);
      }
    },
    [loadConversations],
  );

  const unsendMessage = useCallback(
    async (messageId: string) => {
      const peerUserId = activePeerRef.current;
      if (!peerUserId) return;
      setError(null);
      const opts = await csrfClient.getFetchOptions("POST", {});
      const res = await fetch(
        `/api/messaging/conversations/${peerUserId}/messages/${messageId}/unsend`,
        opts,
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(parseApiError(payload, "Failed to unsend message"));
      }
      const updated = normalizeMessages([payload.data as MessagingMessage])[0];
      setMessages((prev) => {
        const next = prev.map((m) => (m.id === messageId ? { ...m, ...updated } : m));
        messagesSigRef.current = messagesSignature(next);
        return next;
      });
      await loadConversations(true);
    },
    [loadConversations],
  );

  const hideMessage = useCallback(
    async (messageId: string) => {
      const peerUserId = activePeerRef.current;
      if (!peerUserId) return;
      setError(null);
      const opts = await csrfClient.getFetchOptions("POST", {});
      const res = await fetch(
        `/api/messaging/conversations/${peerUserId}/messages/${messageId}/hide`,
        opts,
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(parseApiError(payload, "Failed to delete message"));
      }
      setMessages((prev) => {
        const next = prev.filter((m) => m.id !== messageId);
        messagesSigRef.current = messagesSignature(next);
        return next;
      });
      await loadConversations(true);
    },
    [loadConversations],
  );

  // Resolve current user id once for bubble alignment
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/session", { credentials: "include", cache: "no-store" });
        if (!res.ok) return;
        const payload = await res.json();
        const id =
          payload?.user?.userId
          ?? payload?.user?.id
          ?? payload?.data?.user?.userId
          ?? payload?.session?.userId
          ?? null;
        if (!cancelled && id != null) setCurrentUserId(String(id));
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // Initial load + open peer
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      const list = await loadConversations();
      if (cancelled) return;
      await refreshPresence(list.map((c) => c.peerUserId));
      if (cancelled) return;
      const peer = initialPeerUserId;
      if (peer) {
        await selectConversation(peer);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only re-run when panel opens or initial peer changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, initialPeerUserId]);

  // Poll active thread
  useEffect(() => {
    if (!enabled || pollMs <= 0 || !activePeerUserId) return;
    const id = window.setInterval(() => {
      void loadMessages(activePeerUserId, true);
    }, pollMs);
    return () => window.clearInterval(id);
  }, [enabled, pollMs, activePeerUserId, loadMessages]);

  // Poll conversation list + presence
  useEffect(() => {
    if (!enabled || listPollMs <= 0) return;
    const id = window.setInterval(() => {
      void (async () => {
        const list = await loadConversations(true);
        await refreshPresence(list.map((c) => c.peerUserId));
      })();
    }, listPollMs);
    return () => window.clearInterval(id);
  }, [enabled, listPollMs, loadConversations, refreshPresence]);

  // Refresh list when connections change
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      void loadConversations(true);
    };
    window.addEventListener("ontap:connections-changed", refresh);
    return () => window.removeEventListener("ontap:connections-changed", refresh);
  }, [enabled, loadConversations]);

  const activeConversation =
    conversations.find((c) => c.peerUserId === activePeerUserId) ?? null;

  return {
    conversations,
    activePeerUserId,
    activeConversation,
    messages,
    currentUserId,
    initialLoading,
    sending,
    error,
    setError,
    selectConversation,
    clearSelection,
    sendMessage,
    unsendMessage,
    hideMessage,
    refreshConversations: loadConversations,
    refreshMessages: () =>
      activePeerUserId ? loadMessages(activePeerUserId) : Promise.resolve([]),
  };
}
