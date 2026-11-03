import { csrfClient } from "@/lib/csrf-client";

export type MessagingAttachment = {
  id: string;
  mediaUrl: string;
  mimeType: string;
  mediaKind: "image" | "video";
  fileName: string | null;
  fileSize: string | null;
};

export type MessagingAttachmentInput = {
  mediaUrl: string;
  mimeType: string;
  mediaKind: "image" | "video";
  fileName?: string;
  fileSize?: number;
};

export type MessagingPeer = {
  id: string;
  name: string;
  email: string;
  profileUrl: string | null;
  jobPosition: string | null;
  companyName: string | null;
  isOnline: boolean;
  lastActive: string | null;
  lastActiveLabel: string;
};

export type AssociateCardSnapshot = {
  version: "associate_card_v1";
  userId: string;
  name: string;
  role: string;
  position: string | null;
  profileUrl: string | null;
  coverUrl: string | null;
  portfolioUrl: string;
};

export type MessagingMessageMetadata = {
  associateCard?: AssociateCardSnapshot;
};

export type MessagingConversation = {
  conversationId: string | null;
  peerUserId: string;
  peer: MessagingPeer;
  lastMessageAt: string | null;
  lastMessagePreview: string;
  unreadCount: number;
  hasMessages: boolean;
};

export type MessagingMessage = {
  id: string;
  conversationId: string;
  senderUserId: string;
  body: string | null;
  messageType: string;
  createdAt: string;
  senderName: string;
  metadata: MessagingMessageMetadata | null;
  attachments: MessagingAttachment[];
  /** True when the sender unsent the message for everyone. */
  unsent: boolean;
  /** True when the peer has read this outbound message (sender view only). */
  seen: boolean;
};

/**
 * Messaging attachments are stored as absolute proxy URLs.
 * In local/dev, `R2_PUBLIC_URL` may point at production, so rewrite
 * `/api/media/file/...` URLs onto the current origin for rendering.
 */
export function normalizeMessagingMediaUrl(url: string): string {
  if (!url || typeof window === "undefined") return url;
  try {
    const currentOrigin = window.location.origin;
    const parsed = new URL(url, currentOrigin);
    if (!parsed.pathname.startsWith("/api/media/file/")) {
      return parsed.toString();
    }
    if (parsed.origin === currentOrigin) {
      return parsed.toString();
    }
    return `${currentOrigin}${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function parseUploadError(err: unknown, fallback: string): string {
  if (!err || typeof err !== "object") return fallback;
  const payload = err as { error?: string | { message?: string }; message?: string };
  if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  if (payload.error && typeof payload.error === "object" && payload.error.message) {
    return payload.error.message;
  }
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message;
  return fallback;
}

/** Proxied R2 upload via /api/media/upload with messaging context. */
export async function uploadMessagingAttachment(file: File): Promise<MessagingAttachmentInput> {
  const mimeType = file.type.toLowerCase();
  const isVideo = mimeType.startsWith("video/");
  const allowedImage = ["image/jpeg", "image/jpg", "image/png", "image/gif"];
  const allowedVideo = ["video/mp4", "video/webm"];
  if (isVideo && !allowedVideo.includes(mimeType)) {
    throw new Error("Only MP4 and WebM videos are allowed.");
  }
  if (!isVideo && !allowedImage.includes(mimeType)) {
    throw new Error("Only JPEG, PNG, and GIF images are allowed.");
  }

  const form = new FormData();
  form.append("file", file);
  form.append("context", "messaging");

  const token = await csrfClient.getToken();
  const headers = csrfClient.buildHeaders(token);
  headers.delete("Content-Type");

  const uploadRes = await fetch("/api/media/upload", {
    method: "POST",
    credentials: "include",
    headers,
    body: form,
    cache: "no-store",
  });
  // 207 = R2 ok but DB row missing → sendMessage ownership check will fail
  if (!uploadRes.ok || uploadRes.status === 207) {
    const err = await uploadRes.json().catch(() => ({}));
    throw new Error(parseUploadError(err, "Upload failed"));
  }
  const uploaded = (await uploadRes.json()) as { url?: string; mediaId?: string };
  if (!uploaded.url) {
    throw new Error("Upload did not return a media URL.");
  }

  return {
    mediaUrl: normalizeMessagingMediaUrl(uploaded.url),
    mimeType,
    mediaKind: isVideo ? "video" : "image",
    fileName: file.name,
    fileSize: file.size,
  };
}
