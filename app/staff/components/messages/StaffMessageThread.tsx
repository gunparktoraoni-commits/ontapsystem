"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { SupportMessage } from "@/app/lib/supportMessaging";
import { ModalPortal } from "@/app/components/ModalPortal";

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function StaffMessageThread({
  messages,
  showEscalateMenu = false,
  onEscalateUserMessage,
}: {
  messages: SupportMessage[];
  showEscalateMenu?: boolean;
  onEscalateUserMessage?: (messageId: string, target: "dev" | "super_admin") => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [escalateMenuOpen, setEscalateMenuOpen] = useState<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (

      <div className="flex flex-1 items-center justify-center text-sm text-gray-500 px-4 text-center">
        No messages yet. Start the conversation below.
      </div>

    );
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg) => {
          const isStaff = msg.senderRole === "staff";
          const isSystem = msg.messageType !== "text" || msg.senderRole === "system";
          const body = msg.body ?? "";

          if (isSystem) {
            return (
              <div key={msg.id} className="flex justify-center">
                <div className="max-w-[90%] rounded-xl bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-800 text-center">
                  {msg.body}
                </div>
              </div>
            );
          }


          
          
          return (
            <div key={msg.id} className={`flex ${isStaff ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[82%] flex flex-col gap-1 ${isStaff ? "items-end" : "items-start"}`}>
                <div className="flex items-center gap-2">
                  {!isStaff && (
                    <span className="text-[10px] uppercase tracking-wide text-gray-400">
                      {msg.senderName}
                    </span>
                  )}
                  {showEscalateMenu && !isStaff && msg.senderRole === "user" && onEscalateUserMessage && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setEscalateMenuOpen(escalateMenuOpen === msg.id ? null : msg.id)}
                        className="text-gray-400 hover:text-gray-600 text-xs px-1"
                        aria-label="Message actions"
                      >
                        ⋮
                      </button>
                      <ModalPortal isOpen={escalateMenuOpen === msg.id} onClose={() => setEscalateMenuOpen(null)}>
                        <div className="absolute left-0 top-5 min-w-[10rem] rounded-lg border border-gray-200 bg-white shadow-lg py-1">
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50"
                            onClick={() => {
                              onEscalateUserMessage(msg.id, "dev");
                              setEscalateMenuOpen(null);
                            }}
                          >
                            Escalate to Dev
                          </button>
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50"
                            onClick={() => {
                              onEscalateUserMessage(msg.id, "super_admin");
                              setEscalateMenuOpen(null);
                            }}
                          >
                            Escalate to Super Admin
                          </button>
                        </div>
                      </ModalPortal>
                    </div>
                  )}
                </div>
                <div
                  className={`rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                    isStaff
                      ? "bg-[#2A4792] text-white rounded-br-md"
                      : "bg-[#C5D4F5] text-gray-900 rounded-bl-md"
                  }`}
                >
                  {body && <p className="whitespace-pre-wrap break-words">{body}</p>}
                  {msg.attachments.map((att) => (
                    <div key={att.id} className="mt-2">
                      {att.mediaKind === "video" ? (
                        <video
                          src={att.mediaUrl}
                          controls
                          className="max-w-full rounded-lg max-h-48"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setLightboxUrl(att.mediaUrl)}
                          className="block"
                        >
                          <img
                            src={att.mediaUrl}
                            alt={att.fileName ?? "attachment"}
                            className="max-w-full rounded-lg max-h-48 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                          />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <span className="text-[10px] text-gray-400 px-1">{formatTime(msg.createdAt)}</span>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {lightboxUrl && (
        <ModalPortal isOpen={!!lightboxUrl} onClose={() => setLightboxUrl(null)}>
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 z-[10000]"
            aria-label="Close"
          >
            <X className="h-6 w-6" />
          </button>
          <img
            src={lightboxUrl}
            alt="Full size attachment"
            className="max-h-[90vh] max-w-full object-contain rounded-xl"
            onClick={(e) => e.stopPropagation()}
          />
        </ModalPortal>
      )}
    </>
  );
}
