"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Send, Smile, UserRoundPlus, X } from "lucide-react";
import { InlineLoader } from "../Loader";
import type { MessagingAttachmentInput } from "@/app/lib/connectionMessaging";
import { uploadMessagingAttachment } from "@/app/lib/connectionMessaging";
import { showToast } from "@/app/components/Toast";
import MessagingEmojiPicker from "./MessagingEmojiPicker";

type PendingAttachment = {
  id: string;
  file: File;
  previewUrl: string;
  mimeType: string;
  mediaKind: "image" | "video";
};

const ACCEPTED = "image/jpeg,image/png,image/gif,video/mp4,video/webm";
const ACCEPTED_MIME = new Set(ACCEPTED.split(","));
const MAX_ATTACHMENTS = 5;

type AssociateSuggestion = {
  id: string;
  name: string;
  profile_image: string | null;
  position: string | null;
  business_name: string | null;
};

function AvatarSuggestion({ associate }: { associate: AssociateSuggestion }) {
  if (associate.profile_image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={associate.profile_image} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
    );
  }
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#eef2ff] text-[#2A4792]">
      <UserRoundPlus className="h-4 w-4" />
    </span>
  );
}

export default function MessagingComposer({
  disabled = false,
  sending = false,
  activePeerUserId,
  initialText = null,
  onSend,
}: {
  disabled?: boolean;
  sending?: boolean;
  activePeerUserId?: string;
  initialText?: string | null;
  onSend: (
    body: string,
    attachments: MessagingAttachmentInput[],
    sharedAssociateUserId?: string,
  ) => Promise<void>;
}) {
  const [text, setText] = useState(initialText ?? "");
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [selectedAssociate, setSelectedAssociate] = useState<AssociateSuggestion | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<AssociateSuggestion[]>([]);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingRef = useRef(pending);
  const seededDraftRef = useRef(false);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(() => {
    if (seededDraftRef.current) return;
    if (!initialText?.trim()) return;
    setText(initialText);
    seededDraftRef.current = true;
  }, [initialText]);

  useEffect(() => {
    seededDraftRef.current = false;
    if (initialText?.trim()) {
      setText(initialText);
      seededDraftRef.current = true;
    } else {
      setText("");
    }
  }, [activePeerUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      pendingRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, []);

  useEffect(() => {
    if (mentionQuery === null || selectedAssociate) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ limit: "8", search: mentionQuery });
      void fetch(`/api/connections/list?${params}`, {
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => response.ok ? response.json() : null)
        .then((payload) => {
          const rows = (payload?.connections ?? []) as AssociateSuggestion[];
          setSuggestions(rows.filter((row) => row.id !== activePeerUserId));
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activePeerUserId, mentionQuery, selectedAssociate]);

  const removePending = (id: string) => {
    setPending((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const onPickFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const next: PendingAttachment[] = [];
    for (const file of Array.from(files)) {
      const mime = file.type.toLowerCase();
      if (!ACCEPTED_MIME.has(mime)) {
        showToast("Only JPEG, PNG, GIF, MP4, and WebM are allowed.", "error");
        continue;
      }
      if (pending.length + next.length >= MAX_ATTACHMENTS) {
        showToast(`Maximum ${MAX_ATTACHMENTS} attachments.`, "error");
        break;
      }
      next.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        mimeType: mime,
        mediaKind: mime.startsWith("video/") ? "video" : "image",
      });
    }
    if (next.length) setPending((prev) => [...prev, ...next]);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleSend = async () => {
    const body = text.trim();
    if ((!body && pending.length === 0 && !selectedAssociate) || disabled || sending || uploading) return;
    setUploading(true);
    try {
      const uploaded: MessagingAttachmentInput[] = [];
      for (const item of pending) {
        uploaded.push(await uploadMessagingAttachment(item.file));
      }
      await onSend(body, uploaded, selectedAssociate?.id);
      setText("");
      setSelectedAssociate(null);
      pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      setPending([]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to send", "error");
    } finally {
      setUploading(false);
    }
  };

  const insertEmoji = (emoji: string) => {
    const el = inputRef.current;
    if (!el) {
      setText((prev) => prev + emoji);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const runSlashCommand = (command: "icons" | "media") => {
    setText((prev) => prev.replace(/(^|\s)\/(?:icons|media)?$/, "$1").replace(/\s+$/, ""));
    setSlashQuery(null);
    if (command === "icons") setEmojiOpen(true);
    else fileRef.current?.click();
  };

  const updateComposerText = (value: string) => {
    const completed = value.match(/(^|\s)\/(icons|media)\s$/i);
    if (completed) {
      const command = completed[2].toLowerCase() as "icons" | "media";
      setText(value.slice(0, completed.index) + completed[1]);
      setSlashQuery(null);
      if (command === "icons") setEmojiOpen(true);
      else fileRef.current?.click();
      return;
    }
    setText(value);
    const mention = value.match(/(?:^|\s)@([^@\n]*)$/);
    setMentionQuery(mention && !selectedAssociate ? mention[1].trim() : null);
    const slash = value.match(/(?:^|\s)\/([a-z]*)$/i);
    setSlashQuery(slash ? slash[1].toLowerCase() : null);
  };

  const selectAssociate = (associate: AssociateSuggestion) => {
    setSelectedAssociate(associate);
    setText((prev) => prev.replace(/(^|\s)@[^@\n]*$/, "$1").trimStart());
    setMentionQuery(null);
    setSuggestions([]);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const busy = disabled || sending || uploading;

  return (
    <div className="border-t border-[#e5e7eb] bg-white p-3">
      {pending.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {pending.map((item) => (
            <div key={item.id} className="relative h-16 w-16 overflow-hidden rounded-lg border border-[#e5e7eb]">
              {item.mediaKind === "video" ? (
                <video src={item.previewUrl} className="h-full w-full object-cover" muted />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
              )}
              <button
                type="button"
                onClick={() => removePending(item.id)}
                className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"
                aria-label="Remove attachment"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {selectedAssociate && (
        <div className="mb-2 inline-flex max-w-full items-center gap-2 rounded-full border border-[#bfdbfe] bg-[#eff6ff] py-1 pl-1 pr-2 text-xs text-[#1e3a8a]">
          {selectedAssociate.profile_image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={selectedAssociate.profile_image} alt="" className="h-6 w-6 rounded-full object-cover" />
          ) : (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white">
              <UserRoundPlus className="h-3.5 w-3.5" />
            </span>
          )}
          <span className="truncate font-semibold">{selectedAssociate.name}</span>
          <button type="button" onClick={() => setSelectedAssociate(null)} aria-label="Remove shared associate">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="relative flex items-end gap-2">
        {(mentionQuery !== null || slashQuery !== null) && (
          <div className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-sm overflow-hidden rounded-xl border border-[#e5e7eb] bg-white shadow-xl">
            {mentionQuery !== null ? (
              suggestions.length > 0 ? suggestions.map((associate) => (
                <button
                  key={associate.id}
                  type="button"
                  onClick={() => selectAssociate(associate)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#f8fafc]"
                >
                  <AvatarSuggestion associate={associate} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[#111827]">{associate.name}</span>
                    <span className="block truncate text-xs text-[#6b7280]">{associate.position || associate.business_name || "Associate"}</span>
                  </span>
                </button>
              )) : (
                <p className="px-3 py-2 text-xs text-[#6b7280]">No matching associates</p>
              )
            ) : (
              <>
                {(!slashQuery || "icons".startsWith(slashQuery)) && (
                  <button type="button" onClick={() => runSlashCommand("icons")} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[#f8fafc]">
                    <Smile className="h-4 w-4 text-[#2A4792]" /> /icons
                  </button>
                )}
                {(!slashQuery || "media".startsWith(slashQuery)) && (
                  <button type="button" onClick={() => runSlashCommand("media")} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[#f8fafc]">
                    <ImagePlus className="h-4 w-4 text-[#2A4792]" /> /media
                  </button>
                )}
              </>
            )}
          </div>
        )}
        <MessagingEmojiPicker onSelect={insertEmoji} open={emojiOpen} onOpenChange={setEmojiOpen} />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#4b5563] hover:bg-[#eef2ff] disabled:opacity-50"
          aria-label="Attach file"
        >
          <ImagePlus className="h-4 w-4" />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED}
          multiple
          className="hidden"
          onChange={(e) => onPickFiles(e.target.files)}
        />
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => updateComposerText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          rows={1}
          placeholder="Type a message..."
          disabled={busy}
          className="max-h-28 min-h-[36px] flex-1 resize-none rounded-xl border border-[#d1d5db] px-3 py-2 text-sm outline-none focus:border-[#2A4792]"
        />
        <button
          type="button"
          disabled={busy || (!text.trim() && pending.length === 0 && !selectedAssociate)}
          onClick={() => void handleSend()}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#2A4792] text-white hover:bg-[#1f3471] disabled:opacity-50"
          aria-label="Send message"
        >
          {uploading || sending ? <InlineLoader className="text-white" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
