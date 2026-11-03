"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Send, Smile, X } from "lucide-react";
import type { SupportAttachmentInput } from "@/app/lib/supportMessaging";
import { uploadSupportAttachment } from "@/app/lib/supportMessaging";
import { showToast } from "@/app/components/Toast";
import { InlineLoader } from "../Loader";
import MessagingEmojiPicker from "../messaging/MessagingEmojiPicker";

type PendingAttachment = {
  id: string;
  file: File;
  previewUrl: string;
  mimeType: string;
  mediaKind: "image" | "video";
};

const ACCEPTED = "image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm";
const ACCEPTED_MIME = new Set(ACCEPTED.split(","));

const MAX_ATTACHMENTS = 5;
const JPEG_QUALITY = 0.8;
const MAX_CONVERT_BYTES = 4 * 1024 * 1024; // 4MB - don't attempt to convert huge images

export default function SupportMessageComposer({
  disabled = false,
  sending = false,
  onSend,
}: {
  disabled?: boolean;
  sending?: boolean;
  onSend: (body: string, attachments: SupportAttachmentInput[]) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingRef = useRef(pending);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(() => {
    return () => {
      pendingRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, []);

  const removePending = (id: string) => {
    setPending((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const fileToJpeg = async (file: File): Promise<File> => {
    try {
      const type = file.type.toLowerCase();
      if (type === "image/jpeg") return file;
      if (!type.startsWith("image/")) return file;
      if (file.size > MAX_CONVERT_BYTES) {
        showToast("Image too large to convert; uploading original.", "info");
        return file;
      }

      // Convert via createImageBitmap + canvas
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0);

      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
      );
      if (!blob) return file;
      const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
      return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
    } catch (err) {
      // fallback: return original
      return file;
    }
  };

  const addPendingFiles = async (files: File[]) => {
    if (!files?.length) return;
    const slots = Math.max(0, MAX_ATTACHMENTS - pendingRef.current.length);
    if (slots <= 0) {
      showToast(`You can attach up to ${MAX_ATTACHMENTS} files.`, "info");
      return;
    }

    const accepted = files
      .filter((f) => ACCEPTED_MIME.has(f.type.toLowerCase()))
      .slice(0, slots);

    const converted = await Promise.all(
      accepted.map(async (f) => {
        try {
          return await fileToJpeg(f);
        } catch {
          return f;
        }
      })
    );

    // Normalize filenames for screenshots
    const normalizedFiles = converted.map((file) => {
      const name = file.name.toLowerCase();
      // Check if it's likely a screenshot with generic name
      if (name.startsWith("image") || name === "blob" || name.includes("screenshot")) {
        const timestamp = Date.now();
        return new File([file], `screenshot-${timestamp}.jpg`, { 
          type: "image/jpeg",
          lastModified: Date.now() 
        });
      }
      return file;
    });

    const next: PendingAttachment[] = normalizedFiles.map((file) => {
      const mimeType = file.type.toLowerCase();
      return {
        id: `${file.name}-${file.size}-${file.lastModified}`,
        file,
        previewUrl: URL.createObjectURL(file),
        mimeType,
        mediaKind: mimeType.startsWith("video/") ? "video" : "image",
      };
    });

    setPending((prev) => [...prev, ...next].slice(0, MAX_ATTACHMENTS));
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return;
    void addPendingFiles(Array.from(files));
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    try {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === "file") {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        e.preventDefault();
        
        // Check if any image files are being pasted (including screenshots)
        const hasImageFiles = files.some(f => f.type.toLowerCase().startsWith("image/"));
        if (hasImageFiles) {
          showToast("Screenshot added as attachment", "success");
        }
        
        await addPendingFiles(files);
      }
    } catch (err) {
      // ignore
    }
  };

  // Also add paste handler to outer container for more reliable screenshot capture
  const handleContainerPaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    // Prevent default to ensure the textarea handles text paste
    if (e.clipboardData?.types.includes("text/plain")) {
      return;
    }
    try {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === "file") {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        const hasImageFiles = files.some(f => f.type.toLowerCase().startsWith("image/"));
        if (hasImageFiles) {
          showToast("Screenshot added as attachment", "success");
        }
        await addPendingFiles(files);
      }
    } catch (err) {
      // ignore
    }
  };

  const submit = async () => {
    const body = text.trim();
    if (!body && pending.length === 0) return;
    setUploading(true);
    try {
      const uploaded: SupportAttachmentInput[] = [];
      for (const item of pending) {
        uploaded.push(await uploadSupportAttachment(item.file));
      }
      await onSend(body, uploaded);
      pending.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      setText("");
      setPending([]);
    } finally {
      setUploading(false);
    }
  };

  const insertEmoji = (emoji: string) => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? text.length;
    const end = input?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    requestAnimationFrame(() => input?.focus());
  };

  const runSlashCommand = (command: "icons" | "media") => {
    setText((prev) => prev.replace(/(^|\s)\/(?:icons|media)?$/, "$1").replace(/\s+$/, ""));
    setSlashQuery(null);
    if (command === "icons") setEmojiOpen(true);
    else fileRef.current?.click();
  };

  const updateText = (value: string) => {
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
    const slash = value.match(/(?:^|\s)\/([a-z]*)$/i);
    setSlashQuery(slash ? slash[1].toLowerCase() : null);
  };

  const busy = sending || uploading;

  return (
    <div className="shrink-0 space-y-2 border-t border-gray-200 bg-white p-3" onPaste={handleContainerPaste}>
      {pending.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-2 space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500 px-1">
            Attachment preview
          </p>
          <div className="flex flex-wrap gap-2">
            {pending.map((item) => (
              <div key={item.id} className="flex flex-col gap-1 w-28 shrink-0">
                <div className="relative h-24 rounded-lg overflow-hidden border border-gray-200 bg-white">
                  {item.mediaKind === "video" ? (
                    <video
                      src={item.previewUrl}
                      className="h-full w-full object-cover"
                      muted
                      playsInline
                      controls
                    />
                  ) : (
                    <img
                      src={item.previewUrl}
                      alt={item.file.name}
                      className="h-full w-full object-cover"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => removePending(item.id)}
                    className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/60 text-white flex items-center justify-center"
                    aria-label="Remove attachment"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <p className="truncate text-[10px] text-gray-500 px-0.5" title={item.file.name}>
                  {item.file.name}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="relative flex min-w-0 items-center gap-2">
        {slashQuery !== null && (
          <div className="absolute bottom-full left-0 z-20 mb-2 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
            {(!slashQuery || "icons".startsWith(slashQuery)) && (
              <button type="button" onClick={() => runSlashCommand("icons")} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50">
                <Smile className="h-4 w-4 text-[#2A4792]" /> /icons
              </button>
            )}
            {(!slashQuery || "media".startsWith(slashQuery)) && (
              <button type="button" onClick={() => runSlashCommand("media")} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50">
                <ImagePlus className="h-4 w-4 text-[#2A4792]" /> /media
              </button>
            )}
          </div>
        )}
        <MessagingEmojiPicker onSelect={insertEmoji} open={emojiOpen} onOpenChange={setEmojiOpen} />
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED}
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <button
          type="button"
          disabled={disabled || busy || pending.length >= 5}
          onClick={() => fileRef.current?.click()}
          className="h-10 w-10 shrink-0 rounded-full p-2 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          aria-label="Attach media"
        >
          <ImagePlus className="h-4 w-4" />
        </button>
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => updateText(e.target.value)}
          placeholder="Type a message..."
          rows={2}
          disabled={disabled}
          className="min-h-10 min-w-0 flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => { void submit(); }}
          className="h-10 w-10 shrink-0 rounded-full bg-primary p-2 text-white hover:bg-primary-hover disabled:opacity-50"
          aria-label="Send message"
        >
          {busy ? <InlineLoader /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
