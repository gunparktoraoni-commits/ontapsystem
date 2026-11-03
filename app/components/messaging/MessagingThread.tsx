"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, MoreVertical, UserRound } from "lucide-react";
import type { MessagingMessage } from "@/app/lib/connectionMessaging";
import { showToast } from "@/app/components/Toast";

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export default function MessagingThread({
  messages,
  peerUserId,
  peerName,
  sending = false,
  onWave,
  onUnsend,
  onHide,
}: {
  messages: MessagingMessage[];
  peerUserId: string;
  peerName: string;
  sending?: boolean;
  onWave?: () => Promise<void> | void;
  onUnsend?: (messageId: string) => Promise<void>;
  onHide?: (messageId: string) => Promise<void>;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastMessageId = messages[messages.length - 1]?.id;
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [waving, setWaving] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, lastMessageId]);

  useEffect(() => {
    if (!openMenuId) return;
    const close = () => setOpenMenuId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [openMenuId]);

  const lastSeenOwnId = [...messages].reverse().find((m) => m.senderUserId !== peerUserId && m.seen)?.id;
  const firstName = peerName.split(" ")[0] || "your connection";

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center text-sm text-[#6b7280]">
        <p className="text-base font-semibold text-[#111827]">Start the conversation</p>
        <p className="max-w-xs leading-relaxed">
          You and {firstName} have not messaged yet. Want to break the ice with a friendly wave?
        </p>
        {onWave && (
          <button
            type="button"
            disabled={sending || waving}
            onClick={() => {
              void (async () => {
                setWaving(true);
                try {
                  await onWave();
                } catch (err) {
                  showToast(err instanceof Error ? err.message : "Failed to send wave", "error");
                } finally {
                  setWaving(false);
                }
              })();
            }}
            className="mt-1 inline-flex h-16 w-16 items-center justify-center rounded-full border border-[#bfdbfe] bg-[#eff6ff] text-3xl shadow-sm transition hover:-translate-y-0.5 hover:bg-[#dbeafe] disabled:cursor-wait disabled:opacity-60"
            aria-label={`Wave to ${firstName}`}
            title={`Wave to ${firstName}`}
          >
            {waving || sending ? "…" : "👋"}
          </button>
        )}
        <p className="text-xs text-[#9ca3af]">Tap the wave to say hi</p>
      </div>
    );
  }

  const runAction = async (messageId: string, action: "unsend" | "hide") => {
    setOpenMenuId(null);
    setBusyId(messageId);
    try {
      if (action === "unsend") await onUnsend?.(messageId);
      else await onHide?.(messageId);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Action failed", "error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
      {messages.map((msg) => {
        const mine = msg.senderUserId !== peerUserId;
        const showSeen = mine && msg.seen && msg.id === lastSeenOwnId;
        const menuOpen = openMenuId === msg.id;

        if (msg.unsent) {
          return (
            <div key={msg.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <p className="px-2 text-[11px] italic text-[#9ca3af]">
                {mine ? "You unsent a message" : "Message unsent"}
              </p>
            </div>
          );
        }

        return (
          <div key={msg.id} className={`group flex ${mine ? "justify-end" : "justify-start"}`}>
            <div className={`relative flex max-w-[85%] items-start gap-1 ${mine ? "flex-row-reverse" : "flex-row"}`}>
              {mine && (onUnsend || onHide) && (
                <div className="relative shrink-0 self-center">
                  <button
                    type="button"
                    disabled={busyId === msg.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuId((prev) => (prev === msg.id ? null : msg.id));
                    }}
                    className={`rounded-full p-1 text-[#9ca3af] transition-opacity hover:bg-[#f3f4f6] hover:text-[#4b5563] ${
                      menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"
                    }`}
                    aria-label="Message actions"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                  {menuOpen && (
                    <div
                      role="menu"
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-0 top-7 z-20 min-w-[140px] overflow-hidden rounded-lg border border-[#e5e7eb] bg-white py-1 shadow-lg"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="block w-full px-3 py-2 text-left text-sm text-[#111827] hover:bg-[#f8fafc]"
                        onClick={() => void runAction(msg.id, "unsend")}
                      >
                        Unsend
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                        onClick={() => void runAction(msg.id, "hide")}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div
                className={`max-w-full rounded-2xl px-3 py-2 text-sm shadow-sm ${
                  mine
                    ? "rounded-br-md bg-[#2A4792] text-white"
                    : "rounded-bl-md border border-[#e5e7eb] bg-white text-[#111827]"
                }`}
              >
                {!mine && (
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[#6b7280]">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#eef2ff] text-[9px] text-[#2A4792]">
                      {getInitials(msg.senderName)}
                    </span>
                    {msg.senderName}
                  </div>
                )}
                {msg.metadata?.associateCard && (
                  <a
                    href={msg.metadata.associateCard.portfolioUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`mb-2 block overflow-hidden rounded-xl border text-left transition-transform hover:-translate-y-0.5 ${
                      mine ? "border-white/25 bg-white text-[#111827]" : "border-[#dbeafe] bg-[#f8fafc]"
                    }`}
                  >
                    <div className="relative h-20 bg-gradient-to-r from-[#2A4792] to-[#4785B8]">
                      {msg.metadata.associateCard.coverUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={msg.metadata.associateCard.coverUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="flex items-center gap-3 px-3 pb-3">
                      <div className="-mt-5 flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-[#eef2ff] text-[#2A4792]">
                        {msg.metadata.associateCard.profileUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={msg.metadata.associateCard.profileUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <UserRound className="h-6 w-6" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1 pt-2">
                        <p className="truncate font-semibold">{msg.metadata.associateCard.name}</p>
                        <p className="truncate text-xs text-[#6b7280]">
                          {msg.metadata.associateCard.position || msg.metadata.associateCard.role || "Associate"}
                        </p>
                      </div>
                      <ExternalLink className="mt-2 h-4 w-4 shrink-0 text-[#2A4792]" />
                    </div>
                  </a>
                )}
                {msg.body && (
                  <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.body}</p>
                )}
                {msg.attachments.length > 0 && (
                  <div className={`mt-2 space-y-2 ${msg.body ? "" : ""}`}>
                    {msg.attachments.map((att) =>
                      att.mediaKind === "video" ? (
                        <video
                          key={att.id}
                          src={att.mediaUrl}
                          controls
                          className="max-h-56 w-full rounded-lg bg-black"
                        />
                      ) : (
                        <a key={att.id} href={att.mediaUrl} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={att.mediaUrl}
                            alt={att.fileName ?? "Image"}
                            className="max-h-56 w-full rounded-lg object-cover"
                          />
                        </a>
                      ),
                    )}
                  </div>
                )}
                <div className={`mt-1 flex items-center gap-2 ${mine ? "justify-end" : "justify-start"}`}>
                  <p className={`text-[10px] ${mine ? "text-white/70" : "text-[#9ca3af]"}`}>
                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                  {showSeen && (
                    <span className="text-[10px] font-medium text-white/90">Seen</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
