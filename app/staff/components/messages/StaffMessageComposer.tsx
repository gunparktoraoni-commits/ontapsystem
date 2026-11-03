"use client";

import { useEffect, useRef, useState } from "react";
import { File, Image, Paperclip } from "lucide-react";
import type { SupportAttachmentInput } from "@/app/lib/supportMessaging";
import { uploadSupportAttachment } from "@/app/lib/supportMessaging";
import { InlineLoader } from "@/app/components/Loader";

type PendingAttachment = {
  id: string;
  file: File;
  previewUrl: string;
  mimeType: string;
  mediaKind: "image" | "video";
};

const ACCEPTED = "image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm";
const ACCEPTED_MIME = new Set(ACCEPTED.split(","));

export default function StaffMessageComposer({
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
  const fileRef = useRef<HTMLInputElement>(null);
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

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const slots = Math.max(0, 5 - pending.length);
    const selected = Array.from(files)
      .filter((file) => ACCEPTED_MIME.has(file.type.toLowerCase()))
      .slice(0, slots);
    const next: PendingAttachment[] = selected.map((file) => {
      const mimeType = file.type.toLowerCase();
      return {
        id: `${file.name}-${file.size}-${file.lastModified}`,
        file,
        previewUrl: URL.createObjectURL(file),
        mimeType,
        mediaKind: mimeType.startsWith("video/") ? "video" : "image",
      };
    });
    setPending((prev) => [...prev, ...next].slice(0, 5));
    if (fileRef.current) fileRef.current.value = "";
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

  const busy = sending || uploading;

  return (
    <div className="rounded-2xl bg-[#C5D4F5] p-3 mx-4 mb-4 space-y-2">
      {pending.length > 0 && (
        <div className="flex flex-wrap gap-2 px-1">
          {pending.map((item) => (
            <div key={item.id} className="relative h-16 w-16 rounded-lg overflow-hidden border border-white/50">
              {item.mediaKind === "video" ? (
                <video src={item.previewUrl} className="h-full w-full object-cover" muted playsInline />
              ) : (
                <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
              )}
              <button
                type="button"
                onClick={() => removePending(item.id)}
                className="absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-black/60 text-white text-[10px]"
                aria-label="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
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
          disabled={disabled || busy}
          onClick={() => fileRef.current?.click()}
          className="p-1.5 text-[#2A4792] hover:bg-white/40 rounded-lg disabled:opacity-50"
          aria-label="Attach files"
        >
          <File className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => fileRef.current?.click()}
          className="p-1.5 text-[#2A4792] hover:bg-white/40 rounded-lg disabled:opacity-50"
          aria-label="Attach media"
        >
          <Image className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled={disabled || busy || pending.length >= 5}
          onClick={() => fileRef.current?.click()}
          className="p-1.5 text-[#2A4792] disabled:opacity-50"
          aria-label="Attach file"
        >
          <Paperclip className="h-4 w-4" />
        </button>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write your message...."
          disabled={disabled}
          className="flex-1 rounded-xl border-0 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4785B8]/30 disabled:opacity-50"
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
          className="shrink-0 px-3 py-2 text-sm font-semibold text-[#2A4792] hover:underline disabled:opacity-50"
        >
          {busy ? <InlineLoader /> : "Send"}
        </button>
      </div>
    </div>
  );
}
