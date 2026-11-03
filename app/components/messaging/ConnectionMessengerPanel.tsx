"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, MessageCircle, X } from "lucide-react";
import { InlineLoader } from "../Loader";
import { useConnectionMessaging } from "@/app/hooks/useConnectionMessaging";
import MessagingThread from "./MessagingThread";
import MessagingComposer from "./MessagingComposer";
import SupportThread from "../support/SupportThread";
import SupportMessageComposer from "../support/SupportMessageComposer";
import SupportSearchBar from "../support/SupportSearchBar";
import { SupportEscalationNotice, SupportResolutionNotice } from "../support/SupportEscalationNotice";
import { useSupportMessaging } from "@/app/hooks/useSupportMessaging";
import type { SupportConversation } from "@/app/lib/supportMessaging";
import { setMessengerPanelOpen } from "@/app/lib/messengerVisibility";

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function Avatar({
  name,
  url,
  size = "md",
}: {
  name: string;
  url?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const dim =
    size === "sm" ? "h-9 w-9 text-xs" : size === "lg" ? "h-12 w-12 text-sm" : "h-10 w-10 text-sm";
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" className={`${dim} rounded-full object-cover`} />
    );
  }
  return (
    <div
      className={`${dim} flex items-center justify-center rounded-full bg-[#eef2ff] font-semibold text-[#2A4792]`}
    >
      {getInitials(name)}
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#2A4792] transition hover:bg-[#eef2ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A4792]/40 sm:hidden"
      aria-label="Back to conversations"
    >
      <ArrowLeft className="h-5 w-5" />
    </button>
  );
}

export default function ConnectionMessengerPanel({
  open,
  onClose,
  initialPeerUserId = null,
  initialView = "list",
  lockedPeer = false,
  title = "Messages",
  subtitle = "Chat with your connections",
  initialDraftText = null,
}: {
  open: boolean;
  onClose: () => void;
  initialPeerUserId?: string | null;
  initialView?: "list" | "support";
  /** When true, hide the conversation list and lock the thread to initialPeerUserId. */
  lockedPeer?: boolean;
  title?: string;
  subtitle?: string;
  initialDraftText?: string | null;
}) {
  const [activeKind, setActiveKind] = useState<"direct" | "support" | null>(
    initialPeerUserId ? "direct" : null,
  );
  const [supportSummary, setSupportSummary] = useState<SupportConversation | null>(null);
  const [supportStarted, setSupportStarted] = useState(false);
  const {
    conversations,
    activePeerUserId,
    activeConversation,
    messages,
    initialLoading,
    sending,
    error,
    selectConversation,
    clearSelection,
    sendMessage,
    unsendMessage,
    hideMessage,
  } = useConnectionMessaging({
    enabled: open,
    initialPeerUserId,
    pollMs: 5000,
    listPollMs: 15000,
  });

  
  const support = useSupportMessaging({
    mode: "user",
    enabled: open && activeKind === "support" && (Boolean(supportSummary) || supportStarted),
    pollMs: 5000,
  });

  useEffect(() => {
    if (!open) return;
    setMessengerPanelOpen(true);
    return () => setMessengerPanelOpen(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (initialView === "support") {
      setSupportStarted(true);
      setActiveKind("support");
    }
  }, [initialView, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;  
    void Promise.all([
      fetch("/api/support/conversation?create=false", {
        credentials: "include",
        cache: "no-store",
      }).then(async (res) => (res.ok ? ((await res.json()).data as SupportConversation | null) : null)),
      fetch("/api/support/unread/count", {
        credentials: "include",
        cache: "no-store",
      }).then(async (res) => (res.ok ? Number((await res.json()).data?.count ?? 0) : 0)),
    ])
      .then(([data, unreadCount]) => {
        if (cancelled) return;
        setSupportSummary(data ? { ...data, unreadCount } : null);
        if (initialView === "support" && data) setActiveKind("support");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [initialView, open]);

  useEffect(() => {
    if (support.conversation) setSupportSummary(support.conversation);
  }, [support.conversation]);

  useEffect(() => {
    if (open && initialPeerUserId) {
      setActiveKind("direct");
    }
  }, [initialPeerUserId, open]);

  const openDirect = async (peerUserId: string) => {
    setActiveKind("direct");
    await selectConversation(peerUserId);
  };

  const openSupport = () => {
    setSupportStarted(true);
    setActiveKind("support");
  };

  const backToList = () => {
    if (lockedPeer) return;
    setActiveKind(null);
    clearSelection();
  };

  const supportConversation = support.conversation ?? supportSummary;
  const supportName = supportConversation?.staff?.name ?? "Customer Support";
  const supportPosition = supportConversation?.staff?.position ?? "OnTap support team";
  const supportImage = supportConversation?.staff?.profileUrl ?? "/ontaplogo.svg";
  const showMobileThread = lockedPeer || activeKind !== null;

  const onlineAssociates = useMemo(
    () => conversations.filter((conv) => conv.peer.isOnline),
    [conversations],
  );

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[80] bg-[#07101c]/55 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className="fixed right-0 top-0 z-[90] flex h-dvh w-full max-w-[920px] flex-col overflow-hidden border-l border-white/20 bg-[linear-gradient(145deg,rgba(32,56,125,0.97)_0%,rgba(74,111,165,0.93)_55%,rgba(107,143,196,0.90)_100%)] shadow-[0_8px_32px_rgba(0,0,0,0.22)] backdrop-blur-[8px] sm:rounded-l-2xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            role="dialog"
            aria-label="Messages"
          >
            <div className="flex items-center justify-between border-b border-white/20 bg-white/10 px-4 py-3 text-white shadow-sm backdrop-blur-md">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5" />
                <div>
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="text-[11px] text-white/80">{subtitle}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-transparent p-1 transition-all duration-200 hover:scale-105 hover:border-white/20 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 active:scale-95"
                aria-label="Close messages"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="m-2 flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/25 bg-white/[0.91] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] backdrop-blur-xl sm:m-3">
              {/* Conversation list */}
              {!lockedPeer ? (
              <div
                className={`w-full border-r border-[#20387D]/10 bg-white/25 sm:w-[320px] sm:shrink-0 ${
                  showMobileThread ? "hidden sm:flex sm:flex-col" : "flex flex-col"
                }`}
              >
                <div className="border-b border-[#20387D]/10 bg-[#20387D]/5 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[#20387D]/75">
                  Conversations
                </div>

                {onlineAssociates.length > 0 && (
                  <div className="border-b border-[#20387D]/10 px-3 py-3">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#20387D]/70">
                      Online now
                    </p>
                    <div className="flex gap-3 overflow-x-auto pb-1">
                      {onlineAssociates.map((conv) => {
                        const active =
                          activeKind === "direct" && conv.peerUserId === activePeerUserId;
                        return (
                          <button
                            key={`online-${conv.peerUserId}`}
                            type="button"
                            onClick={() => void openDirect(conv.peerUserId)}
                            className={`flex w-[4.5rem] shrink-0 flex-col items-center gap-1 rounded-xl p-1.5 text-center transition ${
                              active ? "bg-[#20387D]/10" : "hover:bg-white/60"
                            }`}
                            aria-label={`Open chat with ${conv.peer.name}`}
                            title={conv.peer.name}
                          >
                            <div className="relative">
                              <Avatar name={conv.peer.name} url={conv.peer.profileUrl} size="lg" />
                              <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
                            </div>
                            <span className="w-full truncate text-[11px] font-medium text-[#111827]">
                              {conv.peer.name.split(" ")[0]}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {!supportSummary && (
                  <div className="border-b border-[#e5e7eb] p-3">
                    <button
                      type="button"
                      onClick={openSupport}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#2A4792] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#1f3471]"
                    >
                      <MessageCircle className="h-4 w-4" />
                      Contact customer support
                    </button>
                  </div>
                )}
                {supportSummary && (
                  <button
                    type="button"
                    onClick={openSupport}
                    className={`flex w-full items-start gap-3 border-b border-[#e5e7eb] px-3 py-3 text-left ${
                      activeKind === "support" ? "bg-[#eef2ff]" : "hover:bg-[#f8fafc]"
                    }`}
                  >
                    <Avatar name={supportName} url={supportImage} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-[#111827]">{supportName}</p>
                        {(supportSummary.unreadCount ?? support.unreadCount) > 0 && (
                          <span className="rounded-full bg-[#2A4792] px-1.5 py-0.5 text-[10px] font-bold text-white">
                            {(supportSummary.unreadCount ?? support.unreadCount) > 9
                              ? "9+"
                              : (supportSummary.unreadCount ?? support.unreadCount)}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-[#6b7280]">
                        {supportSummary.lastMessagePreview || supportPosition}
                      </p>
                    </div>
                  </button>
                )}
                {initialLoading && conversations.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center gap-2 text-sm text-[#6b7280]">
                    <InlineLoader />
                    Loading...
                  </div>
                ) : conversations.length === 0 && !supportSummary ? (
                  <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-[#6b7280]">
                    No connections yet. Accept associate requests to start messaging.
                  </div>
                ) : (
                  <ul className="flex-1 overflow-y-auto">
                    {conversations.map((conv) => {
                      const active =
                        activeKind === "direct" && conv.peerUserId === activePeerUserId;
                      return (
                        <li key={conv.peerUserId}>
                          <button
                            type="button"
                            onClick={() => void openDirect(conv.peerUserId)}
                            className={`flex w-full items-start gap-3 border-b border-[#20387D]/5 px-3 py-3 text-left transition-all duration-200 ${
                              active
                                ? "bg-[#20387D]/10 shadow-[inset_3px_0_0_#20387D]"
                                : "hover:bg-white/55"
                            }`}
                          >
                            <div className="relative">
                              <Avatar name={conv.peer.name} url={conv.peer.profileUrl} size="sm" />
                              <span
                                className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white ${
                                  conv.peer.isOnline ? "bg-emerald-500" : "bg-gray-300"
                                }`}
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-sm font-semibold text-[#111827]">
                                  {conv.peer.name}
                                </p>
                                {conv.unreadCount > 0 && (
                                  <span className="rounded-full bg-[#2A4792] px-1.5 py-0.5 text-[10px] font-bold text-white">
                                    {conv.unreadCount}
                                  </span>
                                )}
                              </div>
                              <p className="truncate text-xs text-[#6b7280]">
                                {conv.lastMessagePreview || "No messages yet"}
                              </p>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              ) : null}

              {/* Thread */}
              <div
                className={`min-h-0 min-w-0 flex-1 flex-col bg-white/35 ${
                  showMobileThread ? "flex" : "hidden sm:flex"
                }`}
              >
                {activeKind === "support" ? (
                  <>
                    <div className="flex items-center gap-3 border-b border-[#e5e7eb] px-4 py-3">
                      <BackButton onClick={backToList} />
                      <Avatar name={supportName} url={supportImage} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[#111827]">{supportName}</p>
                        <p className="truncate text-xs text-[#6b7280]">{supportPosition}</p>
                      </div>
                    </div>
                    <SupportSearchBar
                      value={support.searchQuery}
                      onChange={support.setSearchQuery}
                      onSubmit={() => void support.refresh({ silent: true })}
                    />
                    <SupportEscalationNotice
                      conversation={supportConversation}
                      loading={support.initialLoading}
                    />
                    <SupportResolutionNotice
                      conversation={supportConversation}
                      loading={support.initialLoading}
                    />
                    {support.error && (
                      <div className="mx-3 mt-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
                        {support.error}
                      </div>
                    )}
                    {support.initialLoading && support.messages.length === 0 ? (
                      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-[#6b7280]">
                        <InlineLoader />
                        Loading support...
                      </div>
                    ) : (
                      <SupportThread
                        messages={support.messages}
                        currentUserRole="user"
                        highlightQuery={support.searchQuery}
                        showWelcome={support.messages.length === 0}
                      />
                    )}
                    <SupportMessageComposer
                      disabled={
                        supportConversation?.status === "resolved" ||
                        supportConversation?.status === "closed"
                      }
                      sending={support.sending}
                      onSend={async (body, attachments) => {
                        await support.sendMessage(body, attachments);
                        setSupportSummary(support.conversation);
                      }}
                    />
                  </>
                ) : !activeConversation || activeKind !== "direct" ? (
                  <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-[#6b7280]">
                    Select a conversation to start chatting.
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3 border-b border-[#20387D]/10 bg-white/35 px-4 py-3 backdrop-blur-sm">
                      {!lockedPeer ? <BackButton onClick={backToList} /> : null}
                      <Avatar
                        name={activeConversation.peer.name}
                        url={activeConversation.peer.profileUrl}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[#111827]">
                          {activeConversation.peer.name}
                        </p>
                        <p className="truncate text-xs text-[#6b7280]">
                          {lockedPeer
                            ? "Company Admin"
                            : activeConversation.peer.jobPosition
                              || activeConversation.peer.companyName
                              || "Connection"}
                        </p>
                        <p
                          className={`text-[11px] font-medium ${
                            activeConversation.peer.isOnline
                              ? "text-emerald-600"
                              : "text-[#9ca3af]"
                          }`}
                        >
                          {activeConversation.peer.lastActiveLabel}
                        </p>
                      </div>
                    </div>

                    {error && (
                      <div className="mx-3 mt-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
                        {error}
                      </div>
                    )}

                    {initialLoading && messages.length === 0 ? (
                      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-[#6b7280]">
                        <InlineLoader />
                        Opening conversation...
                      </div>
                    ) : (
                      <MessagingThread
                        messages={messages}
                        peerUserId={activeConversation.peerUserId}
                        peerName={activeConversation.peer.name}
                        sending={sending}
                        onWave={() => sendMessage("👋")}
                        onUnsend={unsendMessage}
                        onHide={hideMessage}
                      />
                    )}

                    <MessagingComposer
                      sending={sending}
                      activePeerUserId={activeConversation.peerUserId}
                      initialText={initialDraftText}
                      onSend={async (body, attachments, sharedAssociateUserId) => {
                        await sendMessage(body, attachments, sharedAssociateUserId);
                      }}
                    />
                  </>
                )}
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
