"use client";

import type { SupportMessage } from "@/app/lib/supportMessaging";

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function SupportThread({
  messages,
  currentUserRole,
  highlightQuery = "",
  showWelcome = false,
  onEscalateUserMessage,
  showEscalateMenu = false,
}: {
  messages: SupportMessage[];
  currentUserRole: string;
  highlightQuery?: string;
  showWelcome?: boolean;
  showEscalateMenu?: boolean;
  onEscalateUserMessage?: (messageId: string, target: "dev" | "super_admin") => void;
}) {
  if (messages.length === 0) {
    if (showWelcome) {
      return (
        <div className="flex flex-1 items-center justify-center px-6 py-8 text-center">
          <div className="max-w-xs">
            <p className="text-sm font-semibold text-gray-900">How can we help you today?</p>
            <p className="mt-2 text-sm text-gray-500 leading-relaxed">
              You are connected with Ontap Support. Send a message or attach a photo or video below,
              and our team will respond as soon as possible.
            </p>
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-500 px-4 text-center">
        No messages yet.
      </div>
    );
  }

  return (
    <div className="min-h-0 min-w-0 w-full flex-1 space-y-3 overflow-y-auto px-3 py-4">
      {messages.map((msg) => {
        const isOwn = msg.senderRole === currentUserRole;
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
          <div key={msg.id} className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
            <div className={`flex min-w-0 max-w-[82%] flex-col gap-1 ${isOwn ? "items-end" : "items-start"}`}>
              <div className="flex items-center gap-2">
                {!isOwn && (
                  <span className="text-[10px] uppercase tracking-wide text-gray-400">{msg.senderName}</span>
                )}
                {showEscalateMenu && !isOwn && msg.senderRole === "user" && onEscalateUserMessage && (
                  <div className="relative group">
                    <button
                      type="button"
                      className="text-gray-400 hover:text-gray-600 text-xs px-1"
                      aria-label="Message actions"
                    >
                      ⋮
                    </button>
                    <div className="hidden group-hover:block group-focus-within:block absolute left-0 top-5 z-20 min-w-[10rem] rounded-lg border border-gray-200 bg-white shadow-lg py-1">
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50"
                        onClick={() => onEscalateUserMessage(msg.id, "dev")}
                      >
                        Escalate to Dev
                      </button>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50"
                        onClick={() => onEscalateUserMessage(msg.id, "super_admin")}
                      >
                        Escalate to Super Admin
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div
                className={`min-w-0 max-w-full break-words rounded-2xl px-3 py-2 text-sm shadow-sm ${
                  isOwn
                    ? "bg-[#2A4792] text-white rounded-br-md"
                    : "bg-gray-100 text-gray-900 rounded-bl-md"
                }`}
              >
                {body && (
                  <p className="whitespace-pre-wrap break-words">{body}</p>
                )}
                {msg.attachments.map((att) => (
                  <div key={att.id} className="mt-2">
                    {att.mediaKind === "video" ? (
                      <video src={att.mediaUrl} controls className="block h-auto max-h-[min(24rem,50vh)] max-w-full rounded-lg object-contain" />
                    ) : (
                      <img src={att.mediaUrl} alt={att.fileName ?? "attachment"} className="block h-auto max-h-[min(24rem,50vh)] max-w-full rounded-lg object-contain" />
                    )}
                  </div>
                ))}
              </div>
              <span className="text-[10px] text-gray-400 px-1">{formatTime(msg.createdAt)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
