import { csrfClient } from "@/lib/csrf-client";

export type SupportAttachment = {
  id: string;
  mediaUrl: string;
  mimeType: string;
  mediaKind: "image" | "video";
  fileName: string | null;
  fileSize: string | null;
};

export type SupportMessage = {
  id: string;
  conversationId: string;
  senderUserId: string;
  senderRole: string;
  body: string | null;
  messageType: string;
  escalationTarget: string | null;
  createdAt: string;
  senderName: string;
  attachments: SupportAttachment[];
};

export type SupportStaffInfo = {
  id: string;
  name: string;
  email: string;
  profileUrl: string | null;
  position: string | null;
  isActive: boolean;
} | null;

export type SupportClientInfo = {
  id: string;
  name: string;
  email: string;
  profileUrl?: string | null;
  phone?: string | null;
  jobPosition?: string | null;
  companyName?: string | null;
  isOnline?: boolean;
  lastActive?: string | null;
};

export type SupportConversation = {
  id: string;
  clientUserId: string;
  staffId: string | null;
  status: string;
  escalationLevel: string;
  escalatedAt: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  createdAt: string;
  client?: SupportClientInfo;
  staff: SupportStaffInfo;
  isPooled: boolean;
  unreadCount?: number;
};

export type SupportAttachmentInput = {
  mediaUrl: string;
  mimeType: string;
  mediaKind: "image" | "video";
  fileName?: string;
  fileSize?: number;
};

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

export async function uploadSupportAttachment(file: File): Promise<SupportAttachmentInput> {
  const mimeType = file.type.toLowerCase();
  const isVideo = mimeType.startsWith("video/");
  const signOpts = await csrfClient.getFetchOptions("POST", {
    context: "support",
    mime_type: mimeType,
    resource_type: isVideo ? "video" : "image",
  });
  const signRes = await fetch("/api/media/sign", signOpts);
  if (!signRes.ok) {
    const err = await signRes.json().catch(() => ({}));
    throw new Error(parseUploadError(err, "Upload sign failed"));
  }
  const sign = await signRes.json() as {
    signature: string;
    timestamp: number;
    api_key: string;
    cloud_name: string;
    upload_url: string;
    folder: string;
    public_id: string;
  };

  const form = new FormData();
  form.append("file", file);
  form.append("api_key", sign.api_key);
  form.append("timestamp", String(sign.timestamp));
  form.append("signature", sign.signature);
  form.append("folder", sign.folder);
  form.append("public_id", sign.public_id);
  form.append("overwrite", "true");

  const uploadRes = await fetch(sign.upload_url, { method: "POST", body: form });
  if (!uploadRes.ok) throw new Error("Cloudinary upload failed");
  const uploaded = await uploadRes.json() as {
    secure_url: string;
    public_id: string;
    format: string;
    bytes: number;
    resource_type?: string;
  };

  const registerOpts = await csrfClient.getFetchOptions("POST", {
    context: "support",
    secure_url: uploaded.secure_url,
    public_id: uploaded.public_id,
    format: uploaded.format,
    bytes: uploaded.bytes,
    mime_type: mimeType,
    resource_type: uploaded.resource_type ?? (isVideo ? "video" : "image"),
  });
  const registerRes = await fetch("/api/media/register", registerOpts);
  if (!registerRes.ok) {
    const err = await registerRes.json().catch(() => ({}));
    throw new Error(parseUploadError(err, "Failed to register upload"));
  }

  return {
    mediaUrl: uploaded.secure_url,
    mimeType,
    mediaKind: isVideo ? "video" : "image",
    fileName: file.name,
    fileSize: file.size,
  };
}
