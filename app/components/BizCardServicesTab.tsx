"use client";

import React, { useEffect, useRef, useState } from "react";
import { SectionLoader } from "./Loader";
import {
  Briefcase,
  ExternalLink,
  ImagePlus,
  Pencil,
  Plus,
  Trash2,
  Upload,
  Video,
  X,
  RefreshCw,
} from "lucide-react";
import type { GalleryItem, ServiceItem, ServiceMediaItem, VideoItem } from "../types";
import ServiceMediaSlider, { toServableMediaSrc } from "./ServiceMediaSlider";
import {
  compressImage,
  Input,
  Label,
  SectionCard,
  Textarea,
} from "./BizCardShared";
import { getFrontendApiBaseUrl } from "./apiBase";
import RichTextEditor from "./RichTextEditor";
import { buildImpersonationHeaders } from "@/app/lib/superadminImpersonationHandoff";
import { buildCompanyActingHeaders } from "@/app/lib/companyEmployeeActingHandoff";
import { ModalPortal } from "./ModalPortal";
import { showConfirmDialog } from "./ConfirmDialog";
import {
  uploadBizcardGalleryVideo,
  validateServiceVideo,
} from "@/lib/media/video-upload";
import {
  collectUploadedServiceMedia,
  dataUrlToBlob,
  summarizeServiceMediaUploadFailures,
  uploadPendingServiceMedia,
  type ServiceMediaUploadDraft,
  type ServiceMediaUploadStatus,
} from "@/lib/media/service-media-upload";
import { showToast } from "./Toast";

const CARD_GRADIENTS = [
  "linear-gradient(135deg,#1e3a8a,#3b82f6)",
  "linear-gradient(135deg,#065f46,#10b981)",
  "linear-gradient(135deg,#7c3aed,#a78bfa)",
  "linear-gradient(135deg,#92400e,#f59e0b)",
  "linear-gradient(135deg,#9f1239,#f43f5e)",
  "linear-gradient(135deg,#0e7490,#22d3ee)",
];

const EMPTY_SERVICE: Omit<ServiceItem, "id"> = {
  title: "",
  tagline: "",
  description: "",
  featured_image: null,
  videoUrl: "",
  videoFile: null,
  media: [],
};

const EMPTY_GALLERY_DRAFT: Omit<GalleryItem, "id"> = {
  url: "",
  title: "",
  description: "",
  altText: "",
  fileName: null,
  imageDataUrl: null,
  mimeType: null,
};

type VideoDraft = {
  title: string;
  description: string;
  url: string; // External URL (YouTube / direct mp4 / etc.)
  fileName: string; // Local file name when uploading
  mimeType: string; // MIME type for direct uploads
  videoDataUrl: string;
  fileSize: number;
};
const EMPTY_VIDEO_DRAFT: VideoDraft = {
  title: "",
  description: "",
  url: "",
  fileName: "",
  mimeType: "",
  videoDataUrl: "",
  fileSize: 0,
};

type ServiceMediaDraft = ServiceMediaUploadDraft;

const API = getFrontendApiBaseUrl();
const PORTFOLIO_BROADCAST_CHANNEL = "ontap-portfolio-sync";
const CSRF_COOKIE_NAME = "csrf-token";
const USER_SYNC_EVENT = "ontap:user-sync";
const SERVICE_SYNC_COOLDOWN_MS = 3000;
const SERVICE_DELETE_SUPPRESS_MS = 45000;
function readCsrfCookie(): string {
  if (typeof document === "undefined") return "";
  const target = `${CSRF_COOKIE_NAME}=`;
  const match = document.cookie.split("; ").find((c) => c.startsWith(target));
  return match ? decodeURIComponent(match.slice(target.length)) : "";
}
async function ensureCsrfToken(): Promise<string> {
  const fromCookie = readCsrfCookie();
  if (fromCookie) return fromCookie;
  try {
    const response = await fetch(`${API}/api/csrf-token`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return readCsrfCookie();
    const payload = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const fromBody =
      (typeof payload?.csrfToken === "string" && payload.csrfToken) ||
      (typeof payload?.csrf_token === "string" && payload.csrf_token) ||
      (typeof payload?.token === "string" && payload.token) ||
      "";
    return (
      (typeof fromBody === "string" ? fromBody.trim() : "") || readCsrfCookie()
    );
  } catch {
    return readCsrfCookie();
  }
}
async function buildAuthHeaders(
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...extra };
  const csrf = await ensureCsrfToken();
  if (csrf) headers["X-CSRF-Token"] = csrf;
  // Add impersonation / company-acting headers if present
  const impHeaders = buildImpersonationHeaders();
  Object.entries(impHeaders).forEach(([key, value]) => {
    headers[key] = value;
  });
  const actingHeaders = buildCompanyActingHeaders();
  Object.entries(actingHeaders).forEach(([key, value]) => {
    headers[key] = value;
  });
  return headers;
}
function broadcastSyncEvent() {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(USER_SYNC_EVENT));
  } catch {
    // ignore environments without CustomEvent
  }
}
type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };
type ServiceSaveErrorKind =
  | "network"
  | "upload"
  | "unsupported_file"
  | "server"
  | "unknown";
type ServiceSaveErrorState = { message: string; retryable: boolean };

function classifyServiceSaveError(
  err: unknown,
  context?: { status?: number; phase?: "upload" | "save" },
): { kind: ServiceSaveErrorKind; message: string } {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "";
  const lower = raw.toLowerCase();

  const isNetwork =
    err instanceof TypeError ||
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("network error") ||
    lower.includes("load failed") ||
    lower.includes("network request failed");
  if (isNetwork) {
    return {
      kind: "network",
      message: "Network error. Please check your connection and try again.",
    };
  }

  if (
    lower.includes("unsupported") ||
    lower.includes("mime") ||
    lower.includes("file type") ||
    lower.includes("not supported") ||
    lower.includes("invalid file") ||
    lower.includes("invalid_type")
  ) {
    return {
      kind: "unsupported_file",
      message: "Unsupported file type. Please upload a supported file.",
    };
  }

  if (context?.phase === "upload" || lower.includes("upload")) {
    return {
      kind: "upload",
      message: "Upload failed. Please try again.",
    };
  }

  if (typeof context?.status === "number" && context.status >= 400) {
    const serverMessage = raw.trim();
    const isGeneric =
      !serverMessage ||
      /^request failed \(\d+\)$/i.test(serverMessage) ||
      serverMessage.toLowerCase() === "unknown error";
    return {
      kind: "server",
      message: isGeneric
        ? "Server error. Please try again later."
        : serverMessage,
    };
  }

  return {
    kind: "unknown",
    message: "An unexpected error occurred. Please try again.",
  };
}
function extractErrorMessage(payload: unknown, status: number): string {
  // Backends sometimes return error as an object ({ message, code }) which
  // would stringify to "[object Object]". Walk a few common shapes to extract
  // a human-readable message before falling back to the status code.
  if (payload && typeof payload === "object") {
    const rec = payload as Record<string, unknown>;
    const candidates: unknown[] = [
      rec.error,
      rec.message,
      rec.detail,
      (rec.error as Record<string, unknown> | undefined)?.message,
      (rec.error as Record<string, unknown> | undefined)?.error,
      (rec.data as Record<string, unknown> | undefined)?.message,
      (rec.data as Record<string, unknown> | undefined)?.error,
    ];
    let base: string | null = null;
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) {
        base = c.trim();
        break;
      }
      if (c && typeof c === "object") {
        const inner = c as Record<string, unknown>;
        const m = inner.message ?? inner.error ?? inner.detail;
        if (typeof m === "string" && m.trim()) {
          base = m.trim();
          break;
        }
      }
    }
    const details = rec.details;
    if (Array.isArray(details) && details.length > 0) {
      const detailText = details
        .map((d) => (typeof d === "string" ? d.trim() : ""))
        .filter(Boolean)
        .join(" ");
      if (detailText) {
        return base ? `${base} ${detailText}` : detailText;
      }
    }
    if (base) return base;
  }
  return `Request failed (${status})`;
}
async function parseApiResponse<T>(res: Response): Promise<ApiResult<T>> {
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    return {
      ok: false,
      error: extractErrorMessage(payload, res.status),
      status: res.status,
    };
  }
  const body = payload as Record<string, unknown> | null;
  const data = (body?.data ?? body) as T;
  return { ok: true, data };
}
/* Services ───────────────────────────────────────────────────────── */
async function apiCreateService(
  draft: Omit<ServiceItem, "id">,
): Promise<ApiResult<Record<string, unknown>>> {
  const form = new FormData();
  form.append("name", draft.title.trim());
  form.append("description", draft.description.trim());
  if (draft.tagline) form.append("tagline", draft.tagline.trim());
  if (draft.videoUrl) form.append("serviceUrl", draft.videoUrl.trim());
  form.append("isVisible", "true");
  form.append("status", "active");
  const blob = draft.featured_image
    ? await dataUrlToBlob(draft.featured_image)
    : null;
  if (blob)
    form.append(
      "featured_image",
      new File([blob], "service.jpg", { type: blob.type || "image/jpeg" }),
    );

  // Add media array if present
  if (draft.media && draft.media.length > 0) {
    form.append("media", JSON.stringify(draft.media));
  }

  const res = await fetch(`${API}/api/bizcard/services`, {
    method: "POST",
    credentials: "include",
    headers: await buildAuthHeaders(),
    body: form,
  });
  return parseApiResponse(res);
}

async function apiUpdateService(
  serviceId: number | string,
  draft: Omit<ServiceItem, "id">,
  opts: { removeFeaturedImage?: boolean } = {},
): Promise<ApiResult<Record<string, unknown>>> {
  const form = new FormData();
  form.append("name", draft.title.trim());
  form.append("description", draft.description.trim());
  form.append("tagline", draft.tagline.trim());
  form.append("serviceUrl", draft.videoUrl.trim());
  const blob =
    draft.featured_image && draft.featured_image.startsWith("data:")
      ? await dataUrlToBlob(draft.featured_image)
      : null;
  if (blob) {
    form.append(
      "featured_image",
      new File([blob], "service.jpg", { type: blob.type || "image/jpeg" }),
    );
  } else if (opts.removeFeaturedImage) {
    form.append("remove_featured_image", "true");
  }

  // Add media array if present
  if (draft.media && draft.media.length > 0) {
    form.append("media", JSON.stringify(draft.media));
  }

  const res = await fetch(
    `${API}/api/bizcard/services/${encodeURIComponent(String(serviceId))}`,
    {
      method: "PUT",
      credentials: "include",
      headers: await buildAuthHeaders(),
      body: form,
    },
  );
  return parseApiResponse(res);
}

async function apiDeleteService(
  serviceId: number | string,
): Promise<ApiResult<unknown>> {
  const res = await fetch(
    `${API}/api/bizcard/services/${encodeURIComponent(String(serviceId))}`,
    {
      method: "DELETE",
      credentials: "include",
      headers: await buildAuthHeaders(),
    },
  );
  return parseApiResponse(res);
}

/* Gallery / videos (share the bizcard gallery endpoint) ──────────── */
async function apiUploadGalleryMedia(
  bizcardId: string,
  payload: {
    file: Blob;
    fileName: string;
    mimeType: string;
    title: string;
    description: string;
    altText?: string;
    category: "gallery" | "video";
  },
  onProgress?: (pct: number) => void,
): Promise<ApiResult<Record<string, unknown>>> {
  if (!bizcardId)
    return { ok: false, error: "Missing bizcard ID; refresh and try again." };
  if (payload.category === "video") {
    const file = new File([payload.file], payload.fileName, {
      type: payload.mimeType,
    });
    const validationError = await validateServiceVideo(file);
    if (validationError) return { ok: false, error: validationError };
    const headers = await buildAuthHeaders();
    const result = await uploadBizcardGalleryVideo(
      API,
      bizcardId,
      file,
      {
        title: payload.title,
        description: payload.description,
      },
      headers,
    );
    if (!result.ok) return { ok: false, error: result.error };
    return {
      ok: true,
      data: { url: result.url, mime_type: "video/mp4", media_type: "video" },
    };
  }
  const form = new FormData();
  form.append(
    "file",
    new File([payload.file], payload.fileName, { type: payload.mimeType }),
  );
  form.append("title", payload.title);
  form.append("description", payload.description);
  if (payload.altText) form.append("alt_text", payload.altText);
  form.append("category", payload.category);

  // If caller provided an onProgress callback, use XMLHttpRequest to report upload progress.
  if (typeof onProgress === "function") {
    return await new Promise<ApiResult<Record<string, unknown>>>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open(
        "POST",
        `${API}/api/bizcard/${encodeURIComponent(bizcardId)}/gallery`,
        true,
      );
      xhr.withCredentials = true;
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          const pct = Math.round((ev.loaded / ev.total) * 100);
          try {
            onProgress(pct);
          } catch {
            /* ignore */
          }
        }
      };
      xhr.onload = async () => {
        let payloadResp: unknown = null;
        try {
          payloadResp = JSON.parse(xhr.responseText);
        } catch { }
        if (xhr.status >= 200 && xhr.status < 300) {
          let dataObj: Record<string, unknown> = {};
          if (payloadResp && typeof payloadResp === "object") {
            dataObj = ((payloadResp as any).data ?? payloadResp) as Record<
              string,
              unknown
            >;
          }
          resolve({ ok: true, data: dataObj });
        } else {
          const err = extractErrorMessage(payloadResp, xhr.status);
          resolve({ ok: false, error: err });
        }
      };
      xhr.onerror = () =>
        resolve({ ok: false, error: "Network error during upload" });
      // Attach auth headers (CSRF)
      ensureCsrfToken()
        .then((csrf) => {
          if (csrf) xhr.setRequestHeader("X-CSRF-Token", csrf);
          xhr.send(form);
        })
        .catch(() => xhr.send(form));
    });
  }

  const res = await fetch(
    `${API}/api/bizcard/${encodeURIComponent(bizcardId)}/gallery`,
    {
      method: "POST",
      credentials: "include",
      headers: await buildAuthHeaders(),
      body: form,
    },
  );
  return parseApiResponse(res);
}

async function apiUpdateGalleryMedia(
  bizcardId: string,
  mediaId: number | string,
  updates: {
    title?: string;
    description?: string;
    altText?: string;
    file?: Blob;
    fileName?: string;
    mimeType?: string;
  },
  onProgress?: (pct: number) => void,
): Promise<ApiResult<Record<string, unknown>>> {
  if (!bizcardId)
    return { ok: false, error: "Missing bizcard ID; refresh and try again." };

  // Replacement image → multipart FormData (supports progress via XHR).
  if (updates.file) {
    const form = new FormData();
    form.append(
      "file",
      new File([updates.file], updates.fileName ?? `gallery-${Date.now()}.jpg`, {
        type: updates.mimeType ?? updates.file.type ?? "image/jpeg",
      }),
    );
    if (updates.title !== undefined) form.append("title", updates.title);
    if (updates.description !== undefined)
      form.append("description", updates.description);
    if (updates.altText !== undefined) form.append("alt_text", updates.altText);

    if (typeof onProgress === "function") {
      return await new Promise<ApiResult<Record<string, unknown>>>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open(
          "PUT",
          `${API}/api/bizcard/${encodeURIComponent(bizcardId)}/gallery/${encodeURIComponent(String(mediaId))}`,
          true,
        );
        xhr.withCredentials = true;
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            const pct = Math.round((ev.loaded / ev.total) * 100);
            try {
              onProgress(pct);
            } catch {
              /* ignore */
            }
          }
        };
        xhr.onload = () => {
          let payloadResp: unknown = null;
          try {
            payloadResp = JSON.parse(xhr.responseText);
          } catch {
            /* ignore */
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            let dataObj: Record<string, unknown> = {};
            if (payloadResp && typeof payloadResp === "object") {
              dataObj = ((payloadResp as { data?: unknown }).data ??
                payloadResp) as Record<string, unknown>;
            }
            resolve({ ok: true, data: dataObj });
          } else {
            resolve({
              ok: false,
              error: extractErrorMessage(payloadResp, xhr.status),
            });
          }
        };
        xhr.onerror = () =>
          resolve({ ok: false, error: "Network error during upload" });
        ensureCsrfToken()
          .then((csrf) => {
            if (csrf) xhr.setRequestHeader("X-CSRF-Token", csrf);
            xhr.send(form);
          })
          .catch(() => xhr.send(form));
      });
    }

    const res = await fetch(
      `${API}/api/bizcard/${encodeURIComponent(bizcardId)}/gallery/${encodeURIComponent(String(mediaId))}`,
      {
        method: "PUT",
        credentials: "include",
        headers: await buildAuthHeaders(),
        body: form,
      },
    );
    return parseApiResponse(res);
  }

  const body: Record<string, unknown> = {};
  if (updates.title !== undefined) body.title = updates.title;
  if (updates.description !== undefined) body.description = updates.description;
  if (updates.altText !== undefined) body.alt_text = updates.altText;
  const res = await fetch(
    `${API}/api/bizcard/${encodeURIComponent(bizcardId)}/gallery/${encodeURIComponent(String(mediaId))}`,
    {
      method: "PUT",
      credentials: "include",
      headers: await buildAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    },
  );
  return parseApiResponse(res);
}

async function apiDeleteGalleryMedia(
  bizcardId: string,
  mediaId: number | string,
): Promise<ApiResult<unknown>> {
  if (!bizcardId)
    return { ok: false, error: "Missing bizcard ID; refresh and try again." };
  const res = await fetch(
    `${API}/api/bizcard/${encodeURIComponent(bizcardId)}/gallery/${encodeURIComponent(String(mediaId))}`,
    {
      method: "DELETE",
      credentials: "include",
      headers: await buildAuthHeaders(),
    },
  );
  return parseApiResponse(res);
}

/**
 * Merge helpers: when refreshing from the backend, we must preserve any
 * locally-added items that have not yet been persisted to the backend.
 * Without this, hitting the page refresh button right after adding an item
 * would cause it to vanish (backend doesn't have it yet, so the empty diff
 * overwrites local state). We identify items by stable signatures rather
 * than IDs (local IDs come from Date.now(), backend IDs are different).
 */
function serviceSignature(svc: ServiceItem): string {
  return [
    svc.title.trim().toLowerCase(),
    svc.tagline.trim().toLowerCase(),
    svc.description.trim().toLowerCase(),
    svc.videoUrl.trim().toLowerCase(),
  ].join("|");
}
function isServiceMeaningful(service: ServiceItem): boolean {
  return Boolean(
    service.title.trim() ||
    service.tagline.trim() ||
    service.description.trim() ||
    service.videoUrl.trim() ||
    String(service.featured_image ?? "").trim() ||
    (service.media && service.media.length > 0),
  );
}
function pickNonEmptyText(primary: string, fallback: string): string {
  const p = primary.trim();
  if (p) return p;
  return fallback.trim();
}
function pickNonEmptyImage(
  primary: string | null,
  fallback: string | null,
): string | null {
  const p = String(primary ?? "").trim();
  if (p) return p;
  const f = String(fallback ?? "").trim();
  return f || null;
}
function mergeServiceEntry(
  primary: ServiceItem,
  fallback?: ServiceItem | null,
): ServiceItem {
  if (!fallback) return primary;
  return {
    ...primary,
    title: pickNonEmptyText(primary.title, fallback.title),
    tagline: pickNonEmptyText(primary.tagline, fallback.tagline),
    description: pickNonEmptyText(primary.description, fallback.description),
    featured_image: pickNonEmptyImage(
      primary.featured_image,
      fallback.featured_image,
    ),
    videoUrl: pickNonEmptyText(primary.videoUrl, fallback.videoUrl),
    videoFile: primary.videoFile ?? fallback.videoFile ?? null,
    media: primary.media?.length ? primary.media : fallback.media,
  };
}
function mergeServicesWithLocal(
  backend: ServiceItem[] | null,
  local: ServiceItem[],
): ServiceItem[] | null {
  if (backend === null) return local.length > 0 ? local : null;
  if (backend.length === 0) return local.length > 0 ? local : backend;
  if (local.length === 0) return backend;
  const matchedIds = new Set<number>();
  const matchedSigs = new Set<string>();
  const merged = backend.map((svc, idx) => {
    const byId = local.find((item) => item.id === svc.id) ?? null;
    const sig = serviceSignature(svc);
    const bySig = sig
      ? (local.find((item) => serviceSignature(item) === sig) ?? null)
      : null;
    const byIndex = local[idx] ?? null;
    const match = byId ?? bySig ?? byIndex;
    if (match) {
      matchedIds.add(match.id);
      const matchSig = serviceSignature(match);
      if (matchSig) matchedSigs.add(matchSig);
    }
    return mergeServiceEntry(svc, match);
  });
  const localOnly = local.filter((svc, idx) => {
    if (matchedIds.has(svc.id)) return false;
    const sig = serviceSignature(svc);
    if (sig && matchedSigs.has(sig)) return false;
    const byIndex = backend[idx];
    if (
      byIndex &&
      (byIndex.id === svc.id || (sig && serviceSignature(byIndex) === sig))
    )
      return false;
    return true;
  });
  return localOnly.length > 0 ? [...merged, ...localOnly] : merged;
}
function gallerySignature(item: GalleryItem): string {
  if (item.url && item.url.startsWith("http")) return `url:${item.url}`;
  if (item.imageDataUrl) return `data:${item.imageDataUrl.slice(0, 64)}`;
  return `local:${item.id}`;
}
function videoSignature(item: VideoItem): string {
  if (item.fileName && item.fileName.startsWith("http"))
    return `url:${item.fileName}`;
  if (item.videoDataUrl) return `data:${item.videoDataUrl.slice(0, 64)}`;
  return `local:${item.id}`;
}
function mergePreservingLocal<T>(
  backend: T[] | null,
  local: T[],
  signature: (item: T) => string,
): T[] | null {
  if (backend === null) return null;
  if (local.length === 0) return backend;
  const seen = new Set(backend.map(signature));
  const localOnly = local.filter((item) => {
    const sig = signature(item);
    return Boolean(sig) && !seen.has(sig);
  });
  return localOnly.length > 0 ? [...backend, ...localOnly] : backend;
}

function broadcastPortfolioUpdate(
  alias: string,
  payload: { services?: unknown; gallery?: unknown; videos?: unknown },
) {
  if (typeof window === "undefined") return;
  // NOTE: We intentionally do NOT dispatch the same-tab USER_SYNC_EVENT here.
  // This component listens to that event and calls refreshLatestData(), which would
  // overwrite freshly-added local items with stale backend data before the user has
  // saved (causing items to "disappear" a few seconds after being added).
  // BroadcastChannel.postMessage does not echo back to the sender, and the `storage`
  // event does not fire in the writing tab — so other tabs/windows still receive the
  // sync without affecting the active editing tab.
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(PORTFOLIO_BROADCAST_CHANNEL);
      channel.postMessage({ alias, ts: Date.now(), ...payload });
      channel.close();
    }
  } catch {
    // BroadcastChannel may be unavailable in some environments; storage event is the fallback.
  }
}

function isPreviewableVideoUrl(url: string): boolean {
  const normalized = url.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes("/video/upload/") ||
    normalized.endsWith(".mp4") ||
    normalized.endsWith(".mov") ||
    normalized.endsWith(".webm") ||
    normalized.includes(".mp4?") ||
    normalized.includes(".mov?") ||
    normalized.includes(".webm?")
  );
}

function previewGallerySource(item: GalleryItem): string {
  const raw = item.url || item.imageDataUrl || "";
  return raw ? toServableMediaSrc(raw) : "";
}

function serviceImageSource(service: ServiceItem): string {
  const featured = String(service.featured_image ?? "").trim();
  if (featured) return featured;

  const media = service.media ?? [];
  const firstImage = media.find(
    (m) => m.url && !String(m.mimeType ?? "").toLowerCase().startsWith("video/"),
  );
  if (firstImage?.url) return firstImage.url;

  const firstAny = media.find((m) => Boolean(m.url));
  return firstAny?.url ? String(firstAny.url) : "";
}

function pickMediaUrl(raw: Record<string, unknown>): string {
  return String(
    raw.url ??
    raw.file_url ??
    raw.secure_url ??
    raw.media_url ??
    raw.video_url ??
    raw.thumbnail ??
    "",
  ).trim();
}

function pickMediaId(raw: Record<string, unknown>, fallback: number): number {
  const candidate = Number(raw.id ?? raw.mediaId ?? raw.media_id ?? fallback);
  return Number.isFinite(candidate) && candidate > 0 ? candidate : fallback;
}

function pickServiceImage(raw: Record<string, unknown>): string | null {
  const explicit = String(
    raw.featuredImage ??
    raw.featured_image ??
    raw.featuredImageUrl ??
    raw.featured_image_url ??
    raw.icon ??
    raw.icon_url ??
    "",
  ).trim();
  if (explicit) return explicit;
  const mediaBuckets = [
    raw.media,
    raw.serviceMedia,
    raw.service_media,
    raw.gallery,
    raw.galleryMedia,
  ];
  for (const bucket of mediaBuckets) {
    if (!Array.isArray(bucket) || bucket.length === 0) continue;
    const last = bucket[bucket.length - 1] as Record<string, unknown>;
    const mediaUrl = pickMediaUrl(last);
    if (mediaUrl) return mediaUrl;
  }
  return null;
}

type StoredIdentity = {
  userId: string;
  alias: string;
  bizcardId: string;
};

type LocalPortfolioSnapshot = {
  services?: ServiceItem[];
  gallery?: GalleryItem[];
  videos?: VideoItem[];
};

function readStoredIdentity(): StoredIdentity {
  if (typeof window === "undefined") {
    return { userId: "", alias: "", bizcardId: "" };
  }

  let userId = "";
  let alias = "";
  let bizcardId = "";
  try {
    const raw = localStorage.getItem("authUser");
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      userId = String(
        parsed.user_id ?? parsed.userId ?? parsed.id ?? "",
      ).trim();
      alias = String(
        parsed.custom_uri ??
        parsed.customUri ??
        parsed.alias ??
        parsed.username ??
        "",
      ).trim();
      bizcardId = String(parsed.bizcard_id ?? parsed.bizcardId ?? "").trim();
    }
  } catch {
    // ignore localStorage parsing errors
  }

  if (!alias) {
    alias = String(localStorage.getItem("latestPortfolioAlias") ?? "").trim();
  }

  if (!alias) {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("portfolio_")) continue;
      if (key === "portfolio_refresh_ts") continue;
      const candidate = key.slice("portfolio_".length).trim();
      if (candidate) {
        alias = candidate;
        break;
      }
    }
  }

  return { userId, alias, bizcardId };
}

function normalizeStoredService(
  raw: unknown,
  index: number,
): ServiceItem | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const title = String(record.title ?? "").trim();
  const description = String(record.description ?? "").trim();
  const tagline = String(record.tagline ?? "").trim();
  const featured =
    typeof record.featured_image === "string" ? record.featured_image : null;
  const videoUrl = String(record.videoUrl ?? "").trim();
  const media = Array.isArray(record.media)
    ? record.media
      .map((m) => {
        const mediaRecord = m as Record<string, unknown>;
        return {
          id: String(mediaRecord.id ?? Math.random()),
          url: String(mediaRecord.url ?? "").trim(),
          mimeType: String(mediaRecord.mimeType ?? "").trim() || null,
          fileName: String(mediaRecord.fileName ?? "").trim() || null,
        };
      })
      .filter((m) => m.url)
    : [];

  if (!title && !description && !videoUrl && !featured && media.length === 0)
    return null;

  return {
    id: Number(record.id ?? index + 1),
    title,
    tagline,
    description,
    featured_image: featured,
    videoUrl,
    videoFile: null,
    media,
  };
}

function normalizeStoredGallery(
  raw: unknown,
  index: number,
): GalleryItem | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const url = String(record.url ?? "").trim();
  const imageDataUrl =
    typeof record.imageDataUrl === "string" ? record.imageDataUrl : null;
  if (!url && !imageDataUrl) return null;

  return {
    id: Number(record.id ?? index + 1),
    url,
    title: String(record.title ?? "").trim(),
    description: String(record.description ?? "").trim(),
    altText: String(record.altText ?? "").trim() || null,
    fileName: String(record.fileName ?? "").trim() || null,
    imageDataUrl,
    mimeType: String(record.mimeType ?? "").trim() || null,
  };
}

function normalizeStoredVideo(raw: unknown, index: number): VideoItem | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const fileName = String(record.fileName ?? "").trim();
  const videoDataUrl =
    typeof record.videoDataUrl === "string" ? record.videoDataUrl : null;
  if (!fileName && !videoDataUrl) return null;

  return {
    id: Number(record.id ?? index + 1),
    title: String(record.title ?? "").trim(),
    description: String(record.description ?? "").trim(),
    fileName,
    fileSize: Number(record.fileSize ?? 0) || 0,
    videoDataUrl,
    mimeType: String(record.mimeType ?? "").trim() || null,
  };
}
/** Device portfolio blobs are never a source of truth for editor or public display. */
function readLocalSnapshot(_alias: string): LocalPortfolioSnapshot | null {
  return null;
}

function persistLocalSnapshot(
  alias: string,
  next: LocalPortfolioSnapshot,
  _opts: {
    allowEmptyServices?: boolean;
    allowEmptyGallery?: boolean;
    allowEmptyVideos?: boolean;
  } = {},
): void {
  if (typeof window === "undefined" || !alias) return;
  try {
    // Keep a lightweight refresh signal only — do not write portfolio_* content.
    localStorage.setItem("latestPortfolioAlias", alias);
    localStorage.setItem("portfolio_refresh_ts", String(Date.now()));
  } catch {
    // ignore localStorage errors
  }
  // Notify same-tab listeners and other tabs/windows immediately for real-time sync.
  broadcastPortfolioUpdate(alias, {
    services: next.services,
    gallery: next.gallery,
    videos: next.videos,
  });
}
function isVideoMedia(
  url: string,
  mimeType: string | null,
  type?: string | null,
): boolean {
  const mime = String(mimeType ?? "").toLowerCase();
  if (mime.startsWith("video/")) return true;
  const kind = String(type ?? "").toLowerCase();
  if (kind === "video") return true;
  if (mime.startsWith("image/") || kind === "image") return false;
  if (!url) return false;
  const lowerUrl = url.toLowerCase();
  return (
    lowerUrl.endsWith(".mp4") ||
    lowerUrl.endsWith(".mov") ||
    lowerUrl.endsWith(".webm") ||
    lowerUrl.includes(".mp4?") ||
    lowerUrl.includes(".mov?") ||
    lowerUrl.includes(".webm?")
  );
}

function isMediaFile(file: File): { isVideo: boolean; isImage: boolean } {
  const mimeType = file.type.toLowerCase();
  return {
    isVideo: mimeType.startsWith("video/"),
    isImage: mimeType.startsWith("image/"),
  };
}

function mapServiceMediaFromRecord(record: Record<string, unknown>): ServiceMediaItem[] {
  const buckets = [
    record.media,
    record.serviceMedia,
    record.service_media,
    record.gallery,
  ];
  for (const bucket of buckets) {
    if (!Array.isArray(bucket) || bucket.length === 0) continue;
    return bucket
      .map((m) => {
        const mediaRecord = m as Record<string, unknown>;
        return {
          id: String(mediaRecord.id ?? Math.random()),
          url: String(mediaRecord.url ?? mediaRecord.file_url ?? "").trim(),
          mimeType:
            String(mediaRecord.mimeType ?? mediaRecord.mime_type ?? "").trim() ||
            null,
          fileName:
            String(mediaRecord.fileName ?? mediaRecord.file_name ?? "").trim() ||
            null,
        };
      })
      .filter((m) => m.url);
  }
  return [];
}

async function fetchOwnerServicesWithMedia(): Promise<ServiceItem[] | null> {
  try {
    const res = await fetch(`${API}/api/bizcard/services?limit=100&sort=display_order&order=asc`, {
      credentials: "include",
      cache: "no-store",
      headers: { ...buildImpersonationHeaders(), ...buildCompanyActingHeaders() },
    });
    if (!res.ok) return null;
    const payload = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const rows = Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload)
        ? payload
        : [];
    const mapped = mapServiceRows(rows);
    return mapped.length > 0 || Array.isArray(payload?.data) ? mapped : null;
  } catch {
    return null;
  }
}

async function fetchServiceMediaById(
  serviceId: number,
): Promise<ServiceMediaItem[]> {
  const services = await fetchOwnerServicesWithMedia();
  if (!services) return [];
  const match = services.find((svc) => svc.id === serviceId);
  return match?.media ?? [];
}



function mapServiceRows(raw: unknown): ServiceItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      const record = item as Record<string, unknown>;
      const media = mapServiceMediaFromRecord(record);
      return {
        id: Number(record.id ?? record.service_id ?? index + 1),
        title: String(record.name ?? record.title ?? "").trim(),
        tagline: String(record.tagline ?? "").trim(),
        description: String(record.description ?? "").trim(),
        featured_image: pickServiceImage(record),
        videoUrl: String(record.serviceUrl ?? record.service_url ?? "").trim(),
        videoFile: null,
        media,
      };
    })
    .filter((svc) =>
      Boolean(
        svc.title ||
          svc.description ||
          svc.videoUrl ||
          svc.featured_image ||
          (svc.media && svc.media.length > 0),
      ),
    );
}
function extractServiceFromApi(payload: unknown): ServiceItem | null {
  if (!payload) return null;
  if (Array.isArray(payload)) {
    return mapServiceRows(payload)[0] ?? null;
  }
  if (typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const list = Array.isArray(record.services) ? record.services : null;
    if (list && list.length > 0) {
      return mapServiceRows(list)[0] ?? null;
    }
    const candidate = (record.service ?? record.data ?? record) as Record<
      string,
      unknown
    > | null;
    if (candidate && typeof candidate === "object") {
      return mapServiceRows([candidate])[0] ?? null;
    }
  }
  return null;
}
function mapGalleryRows(raw: unknown): GalleryItem[] {
  if (!Array.isArray(raw)) return [];
  const rows: GalleryItem[] = [];
  raw.forEach((item, index) => {
    const record = item as Record<string, unknown>;
    const url = pickMediaUrl(record);
    const mimeType =
      String(record.mime_type ?? record.file_type ?? "").trim() || null;
    const type = String(record.type ?? "").trim() || null;
    if (!url.startsWith("http") || isVideoMedia(url, mimeType, type)) return;
    rows.push({
      id: Number(record.id ?? record.media_id ?? index + 1),
      url,
      title: String(record.title ?? record.file_name ?? "").trim(),
      description: String(record.description ?? record.caption ?? "").trim(),
      altText: String(record.alt_text ?? record.altText ?? "").trim() || null,
      fileName: String(record.file_name ?? "").trim() || null,
      imageDataUrl: null,
      mimeType,
    });
  });
  return rows;
}

function mapVideoRows(raw: unknown): VideoItem[] {
  if (!Array.isArray(raw)) return [];
  const rows: VideoItem[] = [];
  raw.forEach((item, index) => {
    const record = item as Record<string, unknown>;
    const url = pickMediaUrl(record);
    const mimeType =
      String(record.mime_type ?? record.file_type ?? "").trim() || null;
    const type = String(record.type ?? "").trim() || null;
    if (!url.startsWith("http") || !isVideoMedia(url, mimeType, type)) return;
    rows.push({
      id: Number(record.id ?? record.media_id ?? index + 1),
      title: String(record.title ?? "").trim(),
      description: String(record.description ?? record.caption ?? "").trim(),
      fileName: url,
      fileSize: 0,
      videoDataUrl: null,
      mimeType,
    });
  });
  return rows;
}
function splitBizcardMedia(raw: unknown): {
  gallery: GalleryItem[];
  videos: VideoItem[];
} {
  if (!Array.isArray(raw)) return { gallery: [], videos: [] };
  const gallery: GalleryItem[] = [];
  const videos: VideoItem[] = [];

  raw.forEach((item, index) => {
    const record = item as Record<string, unknown>;
    const url = pickMediaUrl(record);
    if (!url.startsWith("http")) return;
    const mimeType =
      String(record.mime_type ?? record.file_type ?? "").trim() || null;
    const type = String(record.type ?? "").trim() || null;

    if (isVideoMedia(url, mimeType, type)) {
      videos.push({
        id: Number(record.id ?? record.media_id ?? index + 1),
        title: String(record.title ?? "").trim(),
        description: String(record.description ?? record.caption ?? "").trim(),
        fileName: url,
        fileSize: 0,
        videoDataUrl: null,
        mimeType,
      });
      return;
    }

    gallery.push({
      id: Number(record.id ?? record.media_id ?? index + 1),
      url,
      title: String(record.title ?? record.file_name ?? "").trim(),
      description: String(record.description ?? record.caption ?? "").trim(),
      altText: String(record.alt_text ?? record.altText ?? "").trim() || null,
      fileName: String(record.file_name ?? "").trim() || null,
      imageDataUrl: null,
      mimeType,
    });
  });
  return { gallery, videos };
}

export interface ServicesTabProps {
  services: ServiceItem[];
  setServices: React.Dispatch<React.SetStateAction<ServiceItem[]>>;
  gallery: GalleryItem[];
  setGallery: React.Dispatch<React.SetStateAction<GalleryItem[]>>;
  videos: VideoItem[];
  setVideos: React.Dispatch<React.SetStateAction<VideoItem[]>>;
  canUploadGallery?: boolean;
  isDevUser?: boolean;
  showGallery?: boolean;
  /** Owner bizcard id — seeds upload/delete helpers immediately (avoids Missing bizcard ID races). */
  bizcardId?: string;
  /**
   * When false (Create New BizCard), keep the parent’s empty/local state.
   * Do not load or persist the user’s existing BizCard services/gallery/videos.
   */
  syncWithServer?: boolean;
}

export default function ServicesTab({
  services,
  setServices,
  gallery,
  setGallery,
  videos,
  setVideos,
  canUploadGallery = false,
  isDevUser = false,
  showGallery = true,
  bizcardId: bizcardIdProp = "",
  syncWithServer = true,
}: ServicesTabProps) {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Data is ready when we have initial data loaded
    // Mark as loaded and stop showing the loading screen
    hasLoadedRef.current = true;
    setLoading(false);
  }, []);

  // Drop any non-video rows that were incorrectly seeded into the Videos list
  // (e.g. gallery images from an earlier unfiltered owner-media load).
  useEffect(() => {
    const cleaned = videos.filter((item) =>
      isVideoMedia(item.fileName, item.mimeType ?? null),
    );
    if (cleaned.length === videos.length) return;
    setVideos(cleaned);
  }, [videos, setVideos]);

  // Keep gallery image-only.
  useEffect(() => {
    const cleaned = gallery.filter(
      (item) => !isVideoMedia(item.url, item.mimeType ?? null),
    );
    if (cleaned.length === gallery.length) return;
    setGallery(cleaned);
  }, [gallery, setGallery]);

  const modalImgRef = useRef<HTMLInputElement>(null);
  const serviceMediaFileRef = useRef<HTMLInputElement>(null);
  const galleryFileRef = useRef<HTMLInputElement>(null);
  const videoFileRef = useRef<HTMLInputElement>(null);
  const additionalServiceMediaFileRef = useRef<HTMLInputElement>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Omit<ServiceItem, "id">>(EMPTY_SERVICE);
  const [serviceMediaList, setServiceMediaList] = useState<ServiceMediaDraft[]>(
    [],
  );
  const [dragOverImage, setDragOverImage] = useState(false);
  const [galleryModalOpen, setGalleryModalOpen] = useState(false);
  const [galleryEditingId, setGalleryEditingId] = useState<number | null>(null);
  const [galleryDraft, setGalleryDraft] =
    useState<Omit<GalleryItem, "id">>(EMPTY_GALLERY_DRAFT);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [videoEditingId, setVideoEditingId] = useState<number | null>(null);
  const [videoDraft, setVideoDraft] = useState<VideoDraft>(EMPTY_VIDEO_DRAFT);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serviceSaveError, setServiceSaveError] =
    useState<ServiceSaveErrorState | null>(null);
  const [galleryUploadProgress, setGalleryUploadProgress] = useState<number>(0);
  const [serviceMediaUploadProgress, setServiceMediaUploadProgress] =
    useState<number>(0);
  const galleryLastUploadRef = useRef<{
    file: Blob;
    fileName: string;
    mimeType: string;
    title: string;
    description: string;
    altText?: string;
    category: "gallery" | "video";
  } | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const deletedServiceIdsRef = useRef<Map<number, number>>(new Map());
  const deletedGalleryIdsRef = useRef<Map<number, number>>(new Map());
  const deletedVideoIdsRef = useRef<Map<number, number>>(new Map());
  const allowEmptyServicesRef = useRef(false);
  const allowEmptyGalleryRef = useRef(false);
  const allowEmptyVideosRef = useRef(false);
  const canUploadGalleryEffective = isDevUser || canUploadGallery;

  // Refs hold the latest state so refreshLatestData can merge without
  // becoming a re-running dependency itself.
  const servicesRef = useRef(services);
  const galleryRef = useRef(gallery);
  const videosRef = useRef(videos);
  const hasLoadedRef = useRef(false);
  const lastLocalUpdateRef = useRef(0);
  const bizcardIdRef = useRef<string>(bizcardIdProp.trim());

  useEffect(() => {
    const next = bizcardIdProp.trim();
    if (next) bizcardIdRef.current = next;
  }, [bizcardIdProp]);
  useEffect(() => {
    servicesRef.current = services;
  }, [services]);
  useEffect(() => {
    galleryRef.current = gallery;
  }, [gallery]);
  useEffect(() => {
    videosRef.current = videos;
  }, [videos]);

  const notify = React.useCallback((message: string, type?: "success" | "error" | "info") => {
    const inferred =
      type ??
      (/could not|failed|required|please |upgrade|error|maximum|only |must be|provide /i.test(
        message,
      )
        ? "error"
        : "success");
    showToast(message, inferred);
  }, []);

  const markServiceDeleted = React.useCallback((id: number) => {
    deletedServiceIdsRef.current.set(id, Date.now());
  }, []);

  const isServiceSuppressed = React.useCallback((id: number) => {
    const now = Date.now();
    for (const [key, ts] of deletedServiceIdsRef.current.entries()) {
      if (now - ts > SERVICE_DELETE_SUPPRESS_MS) {
        deletedServiceIdsRef.current.delete(key);
      }
    }
    return deletedServiceIdsRef.current.has(id);
  }, []);

  const markGalleryDeleted = React.useCallback((id: number) => {
    deletedGalleryIdsRef.current.set(id, Date.now());
  }, []);

  const isGallerySuppressed = React.useCallback((id: number) => {
    const now = Date.now();
    for (const [key, ts] of deletedGalleryIdsRef.current.entries()) {
      if (now - ts > SERVICE_DELETE_SUPPRESS_MS) {
        deletedGalleryIdsRef.current.delete(key);
      }
    }
    return deletedGalleryIdsRef.current.has(id);
  }, []);

  const markVideoDeleted = React.useCallback((id: number) => {
    deletedVideoIdsRef.current.set(id, Date.now());
  }, []);

  const isVideoSuppressed = React.useCallback((id: number) => {
    const now = Date.now();
    for (const [key, ts] of deletedVideoIdsRef.current.entries()) {
      if (now - ts > SERVICE_DELETE_SUPPRESS_MS) {
        deletedVideoIdsRef.current.delete(key);
      }
    }
    return deletedVideoIdsRef.current.has(id);
  }, []);

  const refreshLatestData = React.useCallback(async () => {
    // Create New BizCard must stay empty — never hydrate from another card.
    if (!syncWithServer) {
      hasLoadedRef.current = true;
      setRefreshing(false);
      setLoading(false);
      return;
    }
    setRefreshing(true);
    try {
      const storedIdentity = readStoredIdentity();
      let profile: Record<string, unknown> | null = null;
      try {
        const profileRes = await fetch(`${API}/api/vcard/profile`, {
          credentials: "include",
          cache: "no-store",
          headers: { ...buildImpersonationHeaders(), ...buildCompanyActingHeaders() },
        });
        if (profileRes.ok) {
          const payload = (await profileRes.json().catch(() => null)) as Record<
            string,
            unknown
          > | null;
          const payloadData =
            payload && typeof payload === "object"
              ? (payload["data"] as Record<string, unknown> | null)
              : null;
          const candidate = (payload?.["profile"] ??
            payloadData?.["profile"] ??
            payloadData ??
            payload?.["user"] ??
            null) as Record<string, unknown> | null;
          if (candidate && typeof candidate === "object") profile = candidate;
        }
      } catch {
        // ignore profile fetch errors
      }
      const userId = String(
        profile?.user_id ?? storedIdentity.userId ?? "",
      ).trim();
      const alias = String(
        profile?.custom_uri ?? profile?.customUri ?? storedIdentity.alias ?? "",
      ).trim();
      let bizcardId = String(
        profile?.bizcard_id ??
        profile?.bizcardId ??
        storedIdentity.bizcardId ??
        "",
      ).trim();
      const profileServices = mapServiceRows(profile?.services);
      const localSnapshot = alias ? readLocalSnapshot(alias) : null;
      const fallbackServices = localSnapshot?.services ?? [];
      const fallbackGallery = localSnapshot?.gallery ?? [];
      const fallbackVideos = localSnapshot?.videos ?? [];
      const scoped = userId
        ? `userId=${encodeURIComponent(userId)}&type=all`
        : alias
          ? `username=${encodeURIComponent(alias)}&type=all`
          : "";
      let scopedPayload: {
        services: ServiceItem[];
        gallery: GalleryItem[];
        videos: VideoItem[];
      } | null = null;
      if (scoped) {
        const serviceRes = await fetch(`${API}/api/vcard/services?${scoped}`, {
          credentials: "include",
          cache: "no-store",
          headers: { ...buildImpersonationHeaders(), ...buildCompanyActingHeaders() },
        });
        if (serviceRes.ok) {
          const payload = (await serviceRes.json().catch(() => null)) as Record<
            string,
            unknown
          > | null;
          const data = (payload?.data ?? payload) as Record<string, unknown>;
          scopedPayload = {
            services: mapServiceRows(data.services),
            gallery: [],
            videos: [],
          };
        }
      }
      let resolvedGallery: GalleryItem[] | null = null;
      let resolvedVideos: VideoItem[] | null = null;
      let ownerMediaResolved = false;

      if (bizcardId) {
        const mediaRes = await fetch(
          `${API}/api/bizcard/${encodeURIComponent(bizcardId)}/gallery`,
          { credentials: "include", cache: "no-store" },
        );
        if (mediaRes.ok) {
          ownerMediaResolved = true;
          const payload = (await mediaRes.json().catch(() => null)) as Record<
            string,
            unknown
          > | null;
          const data = (payload?.data ?? payload) as Record<string, unknown>;
          const media = Array.isArray(data.media)
            ? data.media
            : Array.isArray(data.gallery)
              ? data.gallery
              : [];
          const split = splitBizcardMedia(media);
          resolvedGallery = split.gallery;
          resolvedVideos = split.videos;
        }
      }

      if (!ownerMediaResolved && alias) {
        const publicRes = await fetch(
          `${API}/api/public/${encodeURIComponent(alias)}/gallery`,
          { cache: "no-store" },
        );
        if (publicRes.ok) {
          const payload = (await publicRes.json().catch(() => null)) as Record<
            string,
            unknown
          > | null;
          const data = (payload?.data ?? payload) as Record<string, unknown>;
          resolvedGallery = mapGalleryRows(data.gallery);
          resolvedVideos = mapVideoRows(data.videos);
          if (!bizcardId) {
            const candidate = String(data.bizcard_id ?? "").trim();
            if (candidate) bizcardId = candidate;
          }
        }
      }

      // Stash bizcardId so the API helpers (gallery/video upload &
      // delete) can use it without refetching the profile each time.
      if (bizcardId) bizcardIdRef.current = bizcardId;

      let resolvedServices: ServiceItem[] | null = null;
      // Prefer /api/bizcard/services — it includes the serviceMedia gallery.
      // /api/vcard/services omits media, which left Edit Service with an empty gallery.
      const ownerServices = await fetchOwnerServicesWithMedia();
      if (ownerServices) {
        resolvedServices = ownerServices;
      } else if (scopedPayload) {
        resolvedServices = scopedPayload.services;
        if (resolvedServices.length === 0 && profileServices.length > 0) {
          resolvedServices = profileServices;
        }
      } else if (profileServices.length > 0) {
        resolvedServices = profileServices;
      }

      // Combine local (in-memory + cached) sources so unsaved items are preserved.
      // Priority: current React state (most recent) > localStorage snapshot.
      const localServicesUnion = (
        mergePreservingLocal(
          fallbackServices,
          servicesRef.current,
          serviceSignature,
        ) ?? fallbackServices
      ).filter(isServiceMeaningful);
      const localGalleryUnion = (
        mergePreservingLocal(
          fallbackGallery,
          galleryRef.current,
          gallerySignature,
        ) ?? fallbackGallery
      ).filter(
        (item) => !isVideoMedia(item.url, item.mimeType ?? null),
      );
      const localVideosUnion = (
        mergePreservingLocal(
          fallbackVideos,
          videosRef.current,
          videoSignature,
        ) ?? fallbackVideos
      ).filter((item) =>
        isVideoMedia(item.fileName, item.mimeType ?? null),
      );

      const resolvedServicesFiltered = resolvedServices
        ? resolvedServices.filter(isServiceMeaningful)
        : null;
      const mergedServices = mergeServicesWithLocal(
        resolvedServicesFiltered,
        localServicesUnion,
      );
      const filteredMergedServices = mergedServices
        ? mergedServices.filter((svc) => !isServiceSuppressed(svc.id))
        : null;
      if (resolvedGallery === null && localGalleryUnion.length > 0) {
        resolvedGallery = localGalleryUnion;
      } else if (resolvedGallery !== null) {
        resolvedGallery = mergePreservingLocal(
          resolvedGallery,
          localGalleryUnion,
          gallerySignature,
        );
      }

      if (resolvedVideos === null && localVideosUnion.length > 0) {
        resolvedVideos = localVideosUnion;
      } else if (resolvedVideos !== null) {
        resolvedVideos = mergePreservingLocal(
          resolvedVideos,
          localVideosUnion,
          videoSignature,
        );
      }

      if (resolvedGallery !== null) {
        resolvedGallery = resolvedGallery.filter(
          (item) =>
            !isGallerySuppressed(item.id) &&
            !isVideoMedia(item.url, item.mimeType ?? null),
        );
      }
      if (resolvedVideos !== null) {
        resolvedVideos = resolvedVideos.filter(
          (item) =>
            !isVideoSuppressed(item.id) &&
            isVideoMedia(item.fileName, item.mimeType ?? null),
        );
      }

      if (filteredMergedServices !== null) setServices(filteredMergedServices);

      // Gallery/Videos come only from the bizcard gallery endpoint.
      // Never fall back to /api/vcard/services payload — that used to project
      // service media into Gallery and strip service featured images in themes.
      if (resolvedGallery !== null) {
        setGallery(resolvedGallery);
      }
      if (resolvedVideos !== null) {
        setVideos(resolvedVideos);
      }
    } finally {
      hasLoadedRef.current = true;
      setRefreshing(false);
    }
  }, [
    syncWithServer,
    setGallery,
    setServices,
    setVideos,
    isServiceSuppressed,
    isGallerySuppressed,
    isVideoSuppressed,
  ]);
  useEffect(() => {
    // Always fetch fresh server data — never hydrate portfolio content from device cache.
    // Create New BizCard (syncWithServer=false) keeps the empty local list.
    void refreshLatestData();
  }, [refreshLatestData, setServices, setGallery, setVideos, canUploadGallery]);

  // Re-fetch when ServicesProducts (signup step) or other parts of the app
  // dispatch the global `ontap:user-sync` event after a successful save so
  // newly added services / gallery / videos appear without manual reload.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let delayTimer: ReturnType<typeof setTimeout> | null = null;
    const handleSync = () => {
      // If local state was updated very recently (parent just saved), schedule
      // a delayed refetch so the backend has time to index new data.  Otherwise
      // refetch immediately (e.g. event from another component).
      if (delayTimer) clearTimeout(delayTimer);
      const elapsed = Date.now() - lastLocalUpdateRef.current;
      if (elapsed < SERVICE_SYNC_COOLDOWN_MS) {
        delayTimer = setTimeout(() => {
          void refreshLatestData();
        }, SERVICE_SYNC_COOLDOWN_MS - elapsed);
      } else {
        void refreshLatestData();
      }
    };
    window.addEventListener("ontap:user-sync", handleSync);
    return () => {
      window.removeEventListener("ontap:user-sync", handleSync);
      if (delayTimer) clearTimeout(delayTimer);
    };
  }, [refreshLatestData]);

  const scheduleRefreshLatestData = React.useCallback(
    (delayMs?: number) => {
      if (typeof window === "undefined") return;
      const elapsed = Date.now() - lastLocalUpdateRef.current;
      const wait =
        typeof delayMs === "number"
          ? delayMs
          : Math.max(0, SERVICE_SYNC_COOLDOWN_MS - elapsed);
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
      if (wait <= 0) {
        void refreshLatestData();
        return;
      }
      refreshTimerRef.current = window.setTimeout(() => {
        void refreshLatestData();
      }, wait);
    },
    [refreshLatestData],
  );

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    // Only persist to localStorage when editing (canUploadGallery = true).
    // When viewing a portfolio (read-only), skip persistence to avoid
    // overwriting cached data and causing stale data issues.
    if (!canUploadGallery) return;

    // Skip persisting on initial mount when state is still empty (pre-fetch).
    // Without this guard, empty initial state would clear localStorage before
    // refreshLatestData can read previously cached items, causing data loss on refresh.
    const meaningfulServices = services.filter(isServiceMeaningful);
    const hasMeaningfulData =
      meaningfulServices.length > 0 || gallery.length > 0 || videos.length > 0;
    if (!hasLoadedRef.current && !hasMeaningfulData) return;
    lastLocalUpdateRef.current = Date.now();
    const { alias } = readStoredIdentity();
    if (!alias) return;
    const allowEmptyServices = allowEmptyServicesRef.current;
    allowEmptyServicesRef.current = false;
    const allowEmptyGallery = allowEmptyGalleryRef.current;
    allowEmptyGalleryRef.current = false;
    const allowEmptyVideos = allowEmptyVideosRef.current;
    allowEmptyVideosRef.current = false;
    persistLocalSnapshot(
      alias,
      { services: meaningfulServices, gallery, videos },
      { allowEmptyServices, allowEmptyGallery, allowEmptyVideos },
    );
  }, [services, gallery, videos, canUploadGallery]);

  const openAdd = () => {
    setEditingId(null);
    setDraft(EMPTY_SERVICE);
    setServiceMediaList([]);
    setServiceSaveError(null);
    setModalOpen(true);
  };

  const openAddGallery = () => {
    if (!canUploadGalleryEffective) {
      notify("Upgrade to Standard or Premium to add gallery images.");
      return;
    }
    setGalleryEditingId(null);
    setGalleryDraft(EMPTY_GALLERY_DRAFT);
    setGalleryModalOpen(true);
  };

  const openEdit = (svc: ServiceItem) => {
    setEditingId(svc.id);
    setDraft({
      title: svc.title,
      tagline: svc.tagline,
      description: svc.description,
      featured_image: svc.featured_image,
      videoUrl: svc.videoUrl,
      videoFile: svc.videoFile,
      media: svc.media || [],
    });
    const existingMedia = (svc.media || []).map((m) => ({
      id: m.id,
      url: m.url,
      mimeType: m.mimeType,
      fileName: m.fileName,
      dataUrl: null,
      uploadStatus: "uploaded" as ServiceMediaUploadStatus,
      uploadError: null,
    }));
    setServiceMediaList(existingMedia);
    setServiceSaveError(null);
    setModalOpen(true);

    // If list was hydrated without media (legacy vcard payload), fetch owner media.
    if (existingMedia.length === 0 && Number.isFinite(svc.id) && svc.id > 0) {
      void (async () => {
        const remoteMedia = await fetchServiceMediaById(svc.id);
        if (remoteMedia.length === 0) return;
        setServiceMediaList((prev) => {
          if (prev.length > 0) return prev;
          return remoteMedia.map((m) => ({
            id: m.id,
            url: m.url,
            mimeType: m.mimeType,
            fileName: m.fileName,
            dataUrl: null,
            uploadStatus: "uploaded" as ServiceMediaUploadStatus,
            uploadError: null,
          }));
        });
        setDraft((prev) => ({
          ...prev,
          media: remoteMedia,
          featured_image:
            prev.featured_image ||
            remoteMedia.find(
              (m) =>
                !String(m.mimeType ?? "").toLowerCase().startsWith("video/"),
            )?.url ||
            remoteMedia[0]?.url ||
            null,
        }));
        setServices((prev) => {
          const next = prev.map((row) =>
            row.id === svc.id
              ? {
                  ...row,
                  media: remoteMedia,
                  featured_image:
                    row.featured_image ||
                    remoteMedia.find(
                      (m) =>
                        !String(m.mimeType ?? "")
                          .toLowerCase()
                          .startsWith("video/"),
                    )?.url ||
                    remoteMedia[0]?.url ||
                    null,
                }
              : row,
          );
          servicesRef.current = next;
          return next;
        });
      })();
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setDraft(EMPTY_SERVICE);
    setServiceMediaList([]);
    setServiceMediaUploadProgress(0);
    setSaving(false);
    setServiceSaveError(null);
  };

  const visibleServices = React.useMemo(
    () => services.filter(isServiceMeaningful),
    [services],
  );

  const commitModal = async () => {
    if (saving) return;
    if (!draft.title.trim()) {
      setServiceSaveError({
        message: "Service title is required.",
        retryable: false,
      });
      return;
    }
    // Description is optional — users may add a service with title (+ media) only.
    // For new services, at least one media item is required; for editing, optional if already existing
    if (!editingId && serviceMediaList.length === 0) {
      setServiceSaveError({
        message: "Please upload at least one image or video for the service.",
        retryable: false,
      });
      return;
    }

    setSaving(true);
    setServiceSaveError(null);

    try {
      const uploadFile = async ({
        file,
        context,
        serviceId,
      }: {
        file: File;
        context: "service" | "portfolio";
        serviceId: number | null;
      }) => {
        const form = new FormData();
        form.append("file", file);
        form.append("context", context);
        if (serviceId !== null) {
          form.append("service_id", String(serviceId));
        }
        const uploadRes = await fetch(`${API}/api/media/upload`, {
          method: "POST",
          credentials: "include",
          headers: await buildAuthHeaders(),
          body: form,
        });
        if (!uploadRes.ok) {
          const uploadErr = await uploadRes.json().catch(() => null);
          throw new Error(extractErrorMessage(uploadErr, uploadRes.status));
        }
        const uploadJson = (await uploadRes.json()) as Record<string, unknown>;
        const r2PublicUrl = String(
          uploadJson.url ?? uploadJson.publicUrl ?? "",
        ).trim();
        if (!r2PublicUrl) {
          throw new Error("Missing public URL after upload.");
        }
        return { url: r2PublicUrl };
      };

      const uploadBatch = await uploadPendingServiceMedia({
        list: serviceMediaList,
        serviceId: editingId,
        uploadFile,
        onProgress: (done, total) => {
          setServiceMediaUploadProgress(
            total > 0 ? Math.round((done / total) * 100) : 0,
          );
        },
        onItemComplete: (outcome) => {
          setServiceMediaList((prev) =>
            prev.map((item) => {
              if (item.id !== outcome.id) return item;
              if (outcome.ok) {
                return {
                  ...item,
                  url: outcome.media.url,
                  mimeType: outcome.media.mimeType ?? item.mimeType,
                  fileName: outcome.media.fileName ?? item.fileName,
                  dataUrl: null,
                  uploadStatus: "uploaded",
                  uploadError: null,
                };
              }
              return {
                ...item,
                uploadStatus: "failed",
                uploadError: outcome.error,
              };
            }),
          );
          if (!outcome.ok) {
            notify(outcome.error);
          }
        },
      });

      setServiceMediaList(uploadBatch.list);

      if (!uploadBatch.allSucceeded) {
        const message =
          summarizeServiceMediaUploadFailures(uploadBatch.outcomes) ||
          "Some media files failed to upload.";
        setServiceSaveError({
          message: `${message} Already uploaded files were kept — Retry only re-uploads failed media.`,
          retryable: true,
        });
        return;
      }

      const processedMedia: ServiceMediaItem[] = collectUploadedServiceMedia(
        uploadBatch.list,
      );

      // Optimistic local update — keeps UI responsive while the network
      // request is in flight.  refreshLatestData() right after will
      // reconcile any server-assigned IDs.
      const previousServices = servicesRef.current;
      const optimisticDraft: Omit<ServiceItem, "id"> = {
        ...draft,
        title: draft.title.trim(),
        tagline: draft.tagline.trim(),
        description: draft.description.trim(),
        videoUrl: draft.videoUrl.trim(),
        media: processedMedia,
        featured_image:
          draft.featured_image ||
          processedMedia.find(
            (m) => !String(m.mimeType ?? "").toLowerCase().startsWith("video/"),
          )?.url ||
          processedMedia[0]?.url ||
          null,
      };
      const optimisticId = editingId ?? Date.now();
      if (editingId !== null) {
        setServices((prev) => {
          const next = prev.map((svc) =>
            svc.id === editingId ? { ...svc, ...optimisticDraft } : svc,
          );
          servicesRef.current = next;
          return next;
        });
      } else {
        setServices((prev) => {
          const next = [...prev, { id: optimisticId, ...optimisticDraft }];
          servicesRef.current = next;
          return next;
        });
      }
      lastLocalUpdateRef.current = Date.now();

      // Create New BizCard: keep drafts local only — do not write onto an existing card.
      if (!syncWithServer) {
        closeModal();
        notify(
          editingId !== null
            ? "Service updated"
            : "Service added",
        );
        return;
      }

      const result =
        editingId !== null
          ? await apiUpdateService(editingId, optimisticDraft)
          : await apiCreateService(optimisticDraft);
      if (!result.ok) {
        // Roll back optimistic list so a failed save does not look successful.
        setServices(() => {
          servicesRef.current = previousServices;
          return previousServices;
        });
        const classified = classifyServiceSaveError(result.error, {
          status: result.status,
          phase: "save",
        });
        setServiceSaveError({
          message: classified.message,
          retryable: true,
        });
      } else {
        const wasEditing = editingId !== null;
        const saved = extractServiceFromApi(result.data);
        if (saved) {
          setServices((prev) => {
            const next = prev.map((svc) => {
              if (svc.id !== optimisticId) return svc;
              const merged = mergeServiceEntry(saved, svc);
              const nextId =
                Number.isFinite(saved.id) && saved.id > 0 ? saved.id : svc.id;
              const resolvedMedia =
                saved.media && saved.media.length > 0
                  ? saved.media
                  : processedMedia;
              return { ...merged, id: nextId, media: resolvedMedia };
            });
            servicesRef.current = next;
            return next;
          });
          lastLocalUpdateRef.current = Date.now();
        }
        // Hide modal immediately — do not wait on toast/refresh work.
        closeModal();
        notify(
          wasEditing
            ? "Service updated successfully"
            : "Service added successfully",
        );
        void refreshLatestData();
        broadcastSyncEvent();
      }
    } catch (err) {
      const phase: "upload" | "save" =
        err instanceof Error && /upload/i.test(err.message)
          ? "upload"
          : err instanceof TypeError
            ? "upload"
            : "save";
      const classified = classifyServiceSaveError(err, { phase });
      setServiceSaveError({
        message: classified.message,
        retryable: true,
      });
      notify(classified.message);
    } finally {
      setSaving(false);
      setServiceMediaUploadProgress(0);
      // Refetch independently so the UI shows the canonical backend
      // record (including the real service_id and R2 URL).
      scheduleRefreshLatestData();
    }
  };

  const retryFailedServiceMedia = () => {
    void commitModal();
  };

  const requestDeleteService = async (svc: ServiceItem) => {
    if (saving) return;
    const confirmed = await showConfirmDialog({
      title: "Delete service",
      message: svc.title.trim()
        ? `Delete "${svc.title.trim()}" from your bizcard? This cannot be undone.`
        : "Delete this service from your bizcard? This cannot be undone.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      variant: "danger",
    });
    if (!confirmed) return;
    await confirmDeleteService(svc);
  };

  const confirmDeleteService = async (target: ServiceItem) => {
    if (saving) return;
    setSaving(true);
    markServiceDeleted(target.id);
    // Optimistic removal — restore on failure.
    const previous = servicesRef.current;
    const nextServices = previous.filter((svc) => svc.id !== target.id);
    if (nextServices.length === 0) {
      allowEmptyServicesRef.current = true;
    }
    setServices(() => {
      servicesRef.current = nextServices;
      return nextServices;
    });
    lastLocalUpdateRef.current = Date.now();
    try {
      if (!syncWithServer) {
        notify("Service removed");
        return;
      }
      const result = await apiDeleteService(target.id);
      if (!result.ok) {
        deletedServiceIdsRef.current.delete(target.id);
        allowEmptyServicesRef.current = false;
        notify(`Could not delete service: ${result.error}`);
        setServices(() => {
          servicesRef.current = previous;
          return previous;
        });
      } else {
        notify("Successfully deleted");
        broadcastSyncEvent();
      }
    } catch (err) {
      deletedServiceIdsRef.current.delete(target.id);
      allowEmptyServicesRef.current = false;
      notify(
        `Network error while deleting service: ${err instanceof Error ? err.message : "unknown error"}`,
      );
      setServices(() => {
        servicesRef.current = previous;
        return previous;
      });
    } finally {
      setSaving(false);
      scheduleRefreshLatestData();
    }
  };

  const requestDeleteGalleryItem = async (id: number) => {
    if (saving) return;
    const confirmed = await showConfirmDialog({
      title: "Delete gallery item",
      message: "Delete this gallery item from your bizcard? This cannot be undone.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      variant: "danger",
    });
    if (!confirmed) return;
    await removeGalleryItem(id);
  };

  const requestDeleteVideo = async (id: number) => {
    if (saving) return;
    const confirmed = await showConfirmDialog({
      title: "Delete video",
      message: "Delete this video from your bizcard? This cannot be undone.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      variant: "danger",
    });
    if (!confirmed) return;
    await removeVideo(id);
  };

  const requestRemoveServiceMedia = async (index: number) => {
    const confirmed = await showConfirmDialog({
      title: "Remove media",
      message: "Remove this media from the service? Unsaved changes still need to be saved.",
      confirmLabel: "Remove",
      cancelLabel: "Cancel",
      variant: "danger",
    });
    if (!confirmed) return;
    setServiceMediaList((prev) => prev.filter((_, i) => i !== index));
  };

  const applyModalImage = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    if (file.size > 10 * 1024 * 1024) {
      notify("Image must be 10 MB or smaller.", "error");
      return;
    }
    const compressed = await compressImage(file, 900, 0.84);
    setDraft((prev) => ({ ...prev, featured_image: compressed }));
  };

  const handleModalImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await applyModalImage(file);
    e.target.value = "";
  };

  const openEditGallery = (item: GalleryItem) => {
    setGalleryEditingId(item.id);
    setGalleryDraft({
      url: item.url,
      title: item.title,
      description: item.description,
      altText: item.altText ?? "",
      fileName: item.fileName ?? null,
      imageDataUrl: item.imageDataUrl ?? null,
      mimeType: item.mimeType ?? null,
    });
    setGalleryModalOpen(true);
  };

  const closeGalleryModal = () => {
    setGalleryModalOpen(false);
    setGalleryEditingId(null);
    setGalleryDraft(EMPTY_GALLERY_DRAFT);
    setGalleryUploadProgress(0);
    setSaving(false);
  };

  const applyGalleryImage = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      notify("Only image files are allowed.", "error");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      notify("Image must be 10 MB or smaller.", "error");
      return;
    }
    const compressed = await compressImage(file, 1200, 0.84);
    setGalleryDraft((prev) => ({
      ...prev,
      url: "",
      imageDataUrl: compressed,
      fileName: file.name,
      mimeType: file.type || null,
      altText: prev.altText || prev.title || file.name,
    }));
  };

  const handleGalleryFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await applyGalleryImage(file);
    e.target.value = "";
  };

  const commitGalleryModal = async () => {
    if (saving) return;
    const previewUrl =
      galleryDraft.url.trim() || galleryDraft.imageDataUrl || "";
    if (!previewUrl) return;
    const normalized = {
      ...galleryDraft,
      url: galleryDraft.url.trim(),
      title: galleryDraft.title.trim(),
      description: galleryDraft.description.trim(),
      altText: (galleryDraft.altText ?? galleryDraft.title).trim() || null,
    };

    setSaving(true);

    const optimisticId = galleryEditingId ?? Date.now();

    // Optimistic local update.
    if (galleryEditingId !== null) {
      setGallery((prev) =>
        prev.map((item) =>
          item.id === galleryEditingId ? { ...item, ...normalized } : item,
        ),
      );
    } else {
      setGallery((prev) => [...prev, { id: optimisticId, ...normalized }]);
    }

    try {
      if (galleryEditingId !== null) {
        // Edit: update metadata always; if a new local image was chosen
        // (imageDataUrl set), also replace the stored binary via multipart PUT.
        const replacementBlob = normalized.imageDataUrl
          ? await dataUrlToBlob(normalized.imageDataUrl)
          : null;
        if (replacementBlob) setGalleryUploadProgress(0);
        const result = await apiUpdateGalleryMedia(
          bizcardIdRef.current,
          galleryEditingId,
          {
            title: normalized.title,
            description: normalized.description,
            altText: normalized.altText ?? "",
            ...(replacementBlob
              ? {
                  file: replacementBlob,
                  fileName:
                    normalized.fileName ?? `gallery-${Date.now()}.jpg`,
                  mimeType:
                    normalized.mimeType ??
                    replacementBlob.type ??
                    "image/jpeg",
                }
              : {}),
          },
          replacementBlob
            ? (pct) => setGalleryUploadProgress(pct)
            : undefined,
        );
        if (!result.ok) {
          notify(`Could not save gallery item: ${result.error}`);
          setGalleryUploadProgress(0);
        } else {
          // Hide modal immediately once the server accepts the upload/update.
          closeGalleryModal();
          const updated = (result.data ?? {}) as Record<string, unknown>;
          const savedUrl = String(
            updated.url ??
              updated.file_url ??
              updated.secure_url ??
              normalized.url ??
              "",
          ).trim();
          const editId = galleryEditingId;
          setGallery((prev) =>
            prev.map((item) =>
              item.id === editId
                ? {
                    ...item,
                    ...normalized,
                    url: savedUrl || item.url,
                    imageDataUrl: null,
                    mimeType:
                      String(updated.mime_type ?? normalized.mimeType ?? "").trim() ||
                      item.mimeType,
                  }
                : item,
            ),
          );
          notify("You've successfully updated the gallery");
        }
      } else {
        // Create — needs a binary, prefer the locally-uploaded data URL.
        const blob = normalized.imageDataUrl
          ? await dataUrlToBlob(normalized.imageDataUrl)
          : null;
        if (!blob) {
          notify("Please upload an image file before saving.");
          setGallery((prev) => prev.filter((item) => item.id !== optimisticId));
        } else {
          setGalleryUploadProgress(0);
          const payload = {
            file: blob,
            fileName: normalized.fileName ?? `gallery-${Date.now()}.jpg`,
            mimeType: normalized.mimeType ?? blob.type ?? "image/jpeg",
            title: normalized.title,
            description: normalized.description,
            altText: normalized.altText ?? "",
            category: "gallery" as const,
          };
          galleryLastUploadRef.current = payload;
          const result = await apiUploadGalleryMedia(
            bizcardIdRef.current,
            payload,
            (pct) => setGalleryUploadProgress(pct),
          );
          if (!result.ok) {
            notify(`Could not save gallery item: ${result.error}`);
            setGalleryUploadProgress(0);
            // Roll back optimistic ghost row with temporary Date.now() id.
            setGallery((prev) => prev.filter((item) => item.id !== optimisticId));
          } else {
            // Hide modal immediately once the upload is accepted by the server.
            closeGalleryModal();
            const created = (result.data ?? {}) as Record<string, unknown>;
            const savedId = pickMediaId(created, optimisticId);
            const savedUrl = String(
              created.url ??
              created.file_url ??
              created.secure_url ??
              previewUrl,
            ).trim();
            setGallery((prev) =>
              prev.map((item) =>
                item.id === optimisticId
                  ? {
                    ...item,
                    id: savedId,
                    url: savedUrl || item.url,
                    imageDataUrl: null,
                  }
                  : item,
              ),
            );
            notify("You've successfully added the gallery");
          }
        }
      }
    } catch (err) {
      notify(
        `Network error while saving gallery item: ${err instanceof Error ? err.message : "unknown error"}`,
      );
      if (galleryEditingId === null) {
        setGallery((prev) => prev.filter((item) => item.id !== optimisticId));
      }
    } finally {
      setSaving(false);
      void refreshLatestData();
      broadcastSyncEvent();
    }
  };

  const retryGalleryUpload = async () => {
    if (saving) return;
    const payload = galleryLastUploadRef.current;
    if (!payload) return;
    setSaving(true);
    setGalleryUploadProgress(0);
    try {
      const result = await apiUploadGalleryMedia(
        bizcardIdRef.current,
        payload,
        (pct) => setGalleryUploadProgress(pct),
      );
      if (!result.ok)
        notify(`Could not save gallery item: ${result.error}`);
      else {
        closeGalleryModal();
        const created = (result.data ?? {}) as Record<string, unknown>;
        const savedId = pickMediaId(created, 0);
        const savedUrl = String(
          created.url ?? created.file_url ?? created.secure_url ?? "",
        ).trim();
        setGallery((prev) => [
          ...prev,
          {
            id: savedId > 0 ? savedId : Date.now(),
            url: savedUrl,
            title: payload.title,
            description: payload.description,
            altText: payload.altText ?? "",
          } as GalleryItem,
        ]);
        notify("You've successfully added the gallery");
      }
    } catch (err) {
      notify(
        `Network error while saving gallery item: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    } finally {
      setSaving(false);
      void refreshLatestData();
      broadcastSyncEvent();
    }
  };

  const removeGalleryItem = async (id: number) => {
    if (saving) return;
    setSaving(true);
    const previous = galleryRef.current;
    // Optimistic UI removal — public alias page receives the update via the
    // BroadcastChannel fired by persistLocalSnapshot when state changes.
    markGalleryDeleted(id);
    allowEmptyGalleryRef.current = true;
    setGallery((prev) => prev.filter((item) => item.id !== id));
    try {
      const result = await apiDeleteGalleryMedia(bizcardIdRef.current, id);
      if (!result.ok) {
        notify(`Could not delete gallery item: ${result.error}`);
        deletedGalleryIdsRef.current.delete(id);
        allowEmptyGalleryRef.current = false;
        setGallery(previous);
      } else {
        notify("Successfully deleted gallery item");
      }
    } catch (err) {
      notify(
        `Network error while deleting gallery item: ${err instanceof Error ? err.message : "unknown error"}`,
      );
      deletedGalleryIdsRef.current.delete(id);
      allowEmptyGalleryRef.current = false;
      setGallery(previous);
    } finally {
      setSaving(false);
      void refreshLatestData();
      broadcastSyncEvent();
    }
  };

  /* ── Video modal ────────────────────────────────────────────────
   * Video addition was previously an inline expanding card.  Per the
   * latest UX requirement it is now a dedicated modal that mirrors
   * the gallery modal pattern (Title / Description / URL / Upload).
   */
  const openAddVideo = () => {
    setVideoEditingId(null);
    setVideoDraft(EMPTY_VIDEO_DRAFT);
    setVideoModalOpen(true);
  };

  const openEditVideo = (video: VideoItem) => {
    setVideoEditingId(video.id);
    setVideoDraft({
      title: video.title ?? "",
      description: video.description ?? "",
      url: video.fileName?.startsWith("http") ? video.fileName : "",
      fileName: video.fileName ?? "",
      mimeType: video.mimeType ?? "",
      videoDataUrl: video.videoDataUrl ?? "",
      fileSize: video.fileSize ?? 0,
    });
    setVideoModalOpen(true);
  };

  const closeVideoModal = () => {
    setVideoModalOpen(false);
    setVideoEditingId(null);
    setVideoDraft(EMPTY_VIDEO_DRAFT);
    setSaving(false);
  };

  const handleVideoModalFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validationError = await validateServiceVideo(file);
    if (validationError) {
      notify(validationError, "error");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      setVideoDraft((prev) => ({
        ...prev,
        url: "",
        fileName: file.name,
        mimeType: file.type || "video/mp4",
        videoDataUrl: dataUrl,
        fileSize: file.size,
      }));
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const commitVideoModal = async () => {
    if (saving) return;
    const trimmedTitle = videoDraft.title.trim();
    if (!trimmedTitle) {
      notify("Video title is required.");
      return;
    }
    const trimmedUrl = videoDraft.url.trim();
    const hasUpload = Boolean(videoDraft.videoDataUrl);
    if (!trimmedUrl && !hasUpload) {
      notify("Provide a video URL or upload a video file.");
      return;
    }

    setSaving(true);

    // Optimistic local update so the user sees their video immediately.
    const optimisticVideo: VideoItem = {
      id: videoEditingId ?? Date.now(),
      title: trimmedTitle,
      description: videoDraft.description.trim(),
      fileName: trimmedUrl || videoDraft.fileName || trimmedTitle,
      fileSize: videoDraft.fileSize,
      videoDataUrl: hasUpload ? videoDraft.videoDataUrl : null,
      mimeType: videoDraft.mimeType || null,
    };
    if (videoEditingId !== null) {
      setVideos((prev) =>
        prev.map((v) => (v.id === videoEditingId ? optimisticVideo : v)),
      );
    } else {
      setVideos((prev) => [...prev, optimisticVideo]);
    }

    try {
      if (videoEditingId !== null) {
        // Backend supports metadata-only updates via the gallery PUT.
        const result = await apiUpdateGalleryMedia(
          bizcardIdRef.current,
          videoEditingId,
          {
            title: trimmedTitle,
            description: videoDraft.description.trim(),
          },
        );
        if (!result.ok)
          notify(`Could not save video: ${result.error}`);
        else {
          closeVideoModal();
          notify("Successfully updated the video");
        }
      } else if (hasUpload) {
        const blob = await dataUrlToBlob(videoDraft.videoDataUrl);
        if (!blob) {
          notify("Could not read the uploaded video file.");
          setVideos((prev) =>
            prev.filter((video) => video.id !== optimisticVideo.id),
          );
        } else {
          const result = await apiUploadGalleryMedia(bizcardIdRef.current, {
            file: blob,
            fileName: videoDraft.fileName || `video-${Date.now()}.mp4`,
            mimeType: videoDraft.mimeType || blob.type || "video/mp4",
            title: trimmedTitle,
            description: videoDraft.description.trim(),
            category: "video",
          });
          if (!result.ok) {
            notify(`Could not save video: ${result.error}`);
            setVideos((prev) =>
              prev.filter((video) => video.id !== optimisticVideo.id),
            );
          } else {
            const created = (result.data ?? {}) as Record<string, unknown>;
            const savedUrl = String(
              created.url ?? created.file_url ?? created.secure_url ?? "",
            ).trim();
            const savedId = pickMediaId(created, optimisticVideo.id);
            setVideos((prev) =>
              prev.map((video) =>
                video.id === optimisticVideo.id
                  ? {
                      ...video,
                      id: savedId > 0 ? savedId : video.id,
                      fileName: savedUrl || video.fileName,
                      videoDataUrl: null,
                      mimeType:
                        String(created.mime_type ?? video.mimeType ?? "").trim() ||
                        video.mimeType,
                    }
                  : video,
              ),
            );
            // Hide modal as soon as the upload is accepted.
            closeVideoModal();
            notify("Successfully added the video");
          }
        }
      } else {
        // External URL — there is no per-resource "video URL" endpoint
        // in the API surface this component has access to, so we keep
        // it locally and let the parent's batched save persist it
        // alongside services.  refreshLatestData() will reflect any
        // backend-side persistence.
        closeVideoModal();
        notify("Successfully added the video");
      }
    } catch (err) {
      notify(
        `Network error while saving video: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    } finally {
      setSaving(false);
      void refreshLatestData();
      broadcastSyncEvent();
    }
  };

  const removeVideo = async (id: number) => {
    if (saving) return;
    setSaving(true);
    const previous = videosRef.current;
    markVideoDeleted(id);
    allowEmptyVideosRef.current = true;
    setVideos((prev) => prev.filter((video) => video.id !== id));
    try {
      // Videos are stored in the gallery table on the backend, so the
      // gallery DELETE endpoint also deletes videos.
      const result = await apiDeleteGalleryMedia(bizcardIdRef.current, id);
      if (!result.ok) {
        notify(`Could not delete video: ${result.error}`);
        deletedVideoIdsRef.current.delete(id);
        allowEmptyVideosRef.current = false;
        setVideos(previous);
      } else {
        notify("Successfully deleted video");
      }
    } catch (err) {
      notify(
        `Network error while deleting video: ${err instanceof Error ? err.message : "unknown error"}`,
      );
      deletedVideoIdsRef.current.delete(id);
      allowEmptyVideosRef.current = false;
      setVideos(previous);
    } finally {
      setSaving(false);
      void refreshLatestData();
      broadcastSyncEvent();
    }
  };

  if (loading && !hasLoadedRef.current) {
    return <SectionLoader text="Loading services..." />;
  }

  return (
    <>
      <div className="space-y-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <div
                className="h-8 w-8 rounded-xl flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg,#1e3a8a,#4785B8)",
                }}
              >
                <Briefcase className="h-4 w-4 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
                  Services &amp; Products
                </h3>
                <p className="text-[11px] text-gray-400">
                  {visibleServices.length} service
                  {visibleServices.length !== 1 ? "s" : ""} added
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openAdd}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md active:scale-95"
                style={{
                  background: "linear-gradient(135deg,#2A4792,#4785B8)",
                }}
              >
                Add Service
              </button>
            </div>
          </div>
          {visibleServices.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 rounded-2xl border-2 border-dashed border-gray-200">
              <div
                className="h-14 w-14 rounded-2xl flex items-center justify-center mb-3"
                style={{
                  background: "linear-gradient(135deg,#eef2fa,#dbeafe)",
                }}
              >
                <Briefcase className="h-6 w-6 text-blue-400" />
              </div>
              <p className="text-sm font-semibold text-gray-500">
                No services yet
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                Showcase what you offer to visitors
              </p>
            </div>
          )}
          {visibleServices.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {visibleServices.map((svc, idx) => (
                <div
                  key={svc.id}
                  className="group relative rounded-2xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-md transition-shadow bg-white"
                >
                  <div className="w-full bg-gray-100 flex items-center justify-center min-h-36">
                    {/* Show mixed media: videos first, then images */}
                    {(() => {
                      const items = [] as {
                        id: string;
                        src: string;
                        type: "video" | "image";
                      }[];
                      const seen = new Set<string>();
                      const pushItem = (
                        id: string,
                        src: string,
                        type: "video" | "image",
                      ) => {
                        const key = src.trim();
                        if (!key || seen.has(key)) return;
                        seen.add(key);
                        items.push({ id, src: key, type });
                      };

                      for (const m of svc.media ?? []) {
                        if (!m.url) continue;
                        pushItem(
                          String(m.id),
                          toServableMediaSrc(m.url),
                          String(m.mimeType ?? "")
                            .toLowerCase()
                            .startsWith("video/")
                            ? "video"
                            : "image",
                        );
                      }

                      if (svc.videoUrl) {
                        pushItem(
                          `v-${svc.id}`,
                          toServableMediaSrc(svc.videoUrl),
                          "video",
                        );
                      }

                      const img = serviceImageSource(svc);
                      if (img) {
                        pushItem(`i-${svc.id}`, toServableMediaSrc(img), "image");
                      }

                      if (items.length === 0) {
                        return (
                          <div
                            style={{
                              background:
                                CARD_GRADIENTS[idx % CARD_GRADIENTS.length],
                            }}
                            className="w-full min-h-36"
                          />
                        );
                      }
                      return (
                        <ServiceMediaSlider
                          items={items}
                          className="w-full max-h-80"
                        />
                      );
                    })()}
                  </div>
                  <span className="absolute top-3 left-3 bg-white/20 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-0.5 rounded-full border border-white/30">
                    #{idx + 1}
                  </span>
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => openEdit(svc)}
                      className="flex items-center gap-1.5 bg-white text-gray-800 text-xs font-semibold px-3 py-1.5 rounded-xl shadow hover:bg-blue-50 transition-colors"
                    >
                      <Pencil className="h-3 w-3" /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void requestDeleteService(svc)}
                      className="flex items-center gap-1.5 bg-red-500 text-white text-xs font-semibold px-3 py-1.5 rounded-xl shadow hover:bg-red-600 transition-colors"
                    >
                      <Trash2 className="h-3 w-3" /> Remove
                    </button>
                  </div>
                  <div className="px-4 pt-3 pb-4">
                    <p className="text-sm font-bold text-gray-900 truncate">
                      {svc.title || (
                        <span className="text-gray-300 italic">
                          Untitled service
                        </span>
                      )}
                    </p>
                    {svc.tagline && (
                      <p className="text-xs text-blue-600 font-medium mt-0.5 truncate">
                        {svc.tagline}
                      </p>
                    )}
                    {svc.description && (
                      <p className="text-xs text-gray-500 mt-1.5 leading-relaxed line-clamp-2">
                        {svc.description}
                      </p>
                    )}
                    {svc.videoUrl && (
                      <div className="mt-2 space-y-1.5">
                        <a
                          href={svc.videoUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:text-primary-hover"
                        >
                          <Video className="h-3.5 w-3.5" />
                          View service video
                          <ExternalLink className="h-3 w-3" />
                        </a>
                        {isPreviewableVideoUrl(svc.videoUrl) && (
                          <video
                            src={svc.videoUrl}
                            controls
                            preload="metadata"
                            className="w-full max-h-28 rounded-lg border border-gray-200 bg-black"
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {showGallery ? (
          <SectionCard title="Gallery">
            {gallery.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                {gallery.map((item) => {
                  const src = previewGallerySource(item);
                  return (
                    <div
                      key={item.id}
                      className="rounded-2xl overflow-hidden border border-gray-100 bg-white shadow-sm"
                    >
                      <div className="relative aspect-4/3 bg-gray-50">
                        {src ? (
                          <img
                            src={src}
                            alt={item.altText ?? item.title ?? ""}
                            draggable={false}
                            onDragStart={(e) => e.preventDefault()}
                            className="h-full w-full object-contain object-center"
                          />
                        ) : null}
                        <div className="absolute top-2 right-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => openEditGallery(item)}
                            aria-label="Edit gallery item"
                            className="h-8 w-8 rounded-full bg-white/90 text-gray-700 flex items-center justify-center shadow"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void requestDeleteGalleryItem(item.id)}
                            aria-label="Delete gallery item"
                            className="h-8 w-8 rounded-full bg-black/70 text-white flex items-center justify-center shadow"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="p-3">
                        <p className="text-sm font-semibold text-gray-900">
                          {item.title || "Untitled image"}
                        </p>
                        {item.description && (
                          <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                            {item.description}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-4 mb-3">
                No gallery images yet.
              </p>
            )}

            {!canUploadGalleryEffective && !isDevUser && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 mb-3 text-sm text-amber-900">
                Gallery uploads are available on Standard and Premium plans.
                Existing gallery items remain visible and editable.
              </div>
            )}
            <button
              type="button"
              onClick={openAddGallery}
              disabled={!canUploadGalleryEffective}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed text-sm font-semibold transition-colors ${canUploadGalleryEffective
                  ? "border-primary/30 text-primary hover:border-primary/60 hover:bg-primary/5"
                  : "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                }`}
            >
              <ImagePlus className="h-4 w-4" />
              Add Gallery Item
            </button>
          </SectionCard>
        ) : null}

        <SectionCard title="Videos">
          {videos.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4 mb-3">
              No videos added yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              {videos.map((video) => {
                const previewUrl =
                  video.videoDataUrl ||
                  (video.fileName.startsWith("http") ? video.fileName : "");
                const canEmbed =
                  previewUrl &&
                  (isPreviewableVideoUrl(previewUrl) ||
                    Boolean(video.videoDataUrl));
                return (
                  <div
                    key={video.id}
                    className="rounded-2xl overflow-hidden border border-gray-100 bg-white shadow-sm"
                  >
                    <div className="relative aspect-video bg-black">
                      {canEmbed ? (
                        <video
                          src={previewUrl}
                          controls
                          preload="metadata"
                          className="h-full w-full object-cover"
                        />
                      ) : previewUrl ? (
                        <a
                          href={previewUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex h-full w-full items-center justify-center gap-2 text-xs font-semibold text-white/90 bg-linear-to-br from-slate-700 to-slate-900"
                        >
                          <ExternalLink className="h-4 w-4" /> Open linked video
                        </a>
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-white/60">
                          <Video className="h-8 w-8" />
                        </div>
                      )}
                      <div className="absolute top-2 right-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => openEditVideo(video)}
                          className="h-8 w-8 rounded-full bg-white/90 text-gray-700 flex items-center justify-center shadow"
                          aria-label="Edit video"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void requestDeleteVideo(video.id)}
                          className="h-8 w-8 rounded-full bg-black/70 text-white flex items-center justify-center shadow"
                          aria-label="Delete video"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="p-3">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {video.title || "Untitled video"}
                      </p>
                      {video.description && (
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                          {video.description}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <button
            type="button"
            onClick={openAddVideo}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-primary/30 text-sm font-semibold text-primary hover:border-primary/60 hover:bg-primary/5 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Video
          </button>
        </SectionCard>

      </div>
      <ModalPortal isOpen={modalOpen} onClose={saving ? undefined : closeModal}>
        <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-fade-in-up">
          <div className="flex flex-col items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2.5">
              <div
                className="h-8 w-8 rounded-xl flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg,#1e3a8a,#4785B8)",
                }}
              >
                <Briefcase className="h-4 w-4 text-white" />
              </div>
              <h2 className="text-base font-bold text-gray-900">
                {editingId !== null ? "Edit Service" : "New Service"}
              </h2>
            </div>
            <button
              type="button"
              onClick={closeModal}
              disabled={saving}
              aria-label="Close"
              className="h-8 w-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <X className="h-4 w-4" />
            </button>
            </div>

            <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <Label>Service Media</Label>
                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Add up to 5 images or videos
                      </p>
                      <div className="mt-2 text-[10px] text-gray-400 space-y-1">
                        <p>📷 Images: JPEG, PNG, WebP, GIF (max 10MB each)</p>
                        <p>🎬 Videos: MP4, WebM, MOV (max 50MB, max 15 seconds)</p>
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-gray-600 bg-gray-100 px-2.5 py-1 rounded-full">
                      {serviceMediaList.length}/5
                    </span>
                  </div>

                  {/* Media Slider Display */}
                  {serviceMediaList.length > 0 && (
                    <div className="mb-4">
                      <ServiceMediaSlider
                        items={serviceMediaList.map((media, idx) => ({
                          id: media.id,
                          src: media.dataUrl || media.url,
                          type: media.mimeType?.startsWith('video/') ? "video" : "image",
                          title: `Media ${idx + 1}`,
                        }))}
                        className="w-full h-48 rounded-xl overflow-hidden border border-gray-200 mb-3"
                        intervalMs={4000}
                        autoPlayVideo={false}
                      />

                      {/* Thumbnail Grid Below Slider */}
                      <div className="grid grid-cols-5 gap-2">
                        {serviceMediaList.map((media, index) => {
                          const rawSrc = media.dataUrl || media.url;
                          const src = media.dataUrl
                            ? rawSrc
                            : toServableMediaSrc(rawSrc);
                          const isVideo = media.mimeType?.startsWith('video/');
                          const failed = media.uploadStatus === "failed";
                          const uploading = media.uploadStatus === "uploading";
                          return (
                            <div
                              key={media.id}
                              className={`relative group rounded-lg overflow-hidden bg-gray-100 aspect-square border cursor-pointer transition-colors ${
                                failed
                                  ? "border-rose-400 ring-1 ring-rose-200"
                                  : "border-gray-200 hover:border-blue-400"
                              }`}
                              title={
                                media.uploadError ||
                                media.fileName ||
                                `Media ${index + 1}`
                              }
                            >
                              {isVideo ? (
                                <video
                                  src={src}
                                  className="w-full h-full object-cover"
                                  preload="metadata"
                                  draggable={false}
                                  onDragStart={(e) => e.preventDefault()}
                                  style={{ backgroundColor: '#000' }}
                                />
                              ) : (
                                <img
                                  src={src}
                                  alt={`Media ${index + 1}`}
                                  draggable={false}
                                  onDragStart={(e) => e.preventDefault()}
                                  className="w-full h-full object-cover"
                                />
                              )}
                              {(failed || uploading) && (
                                <div className="absolute inset-0 bg-black/55 flex flex-col items-center justify-center gap-1 p-1">
                                  {uploading ? (
                                    <span className="text-[9px] font-semibold text-white">
                                      Uploading…
                                    </span>
                                  ) : (
                                    <>
                                      <span className="text-[9px] font-semibold text-rose-100 text-center leading-tight">
                                        Failed
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => retryFailedServiceMedia()}
                                        disabled={saving}
                                        className="inline-flex items-center gap-0.5 rounded bg-white/95 px-1.5 py-0.5 text-[9px] font-bold text-rose-700 disabled:opacity-50"
                                      >
                                        <RefreshCw className="h-2.5 w-2.5" />
                                        Retry
                                      </button>
                                    </>
                                  )}
                                </div>
                              )}
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                <button
                                  type="button"
                                  onClick={() => void requestRemoveServiceMedia(index)}
                                  className="h-6 w-6 rounded-full bg-red-500 text-white flex items-center justify-center shadow hover:bg-red-600 transition-colors"
                                  title="Remove media"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                              <span className="absolute top-1 left-1 text-[10px] font-bold text-white bg-black/50 px-1.5 py-0.5 rounded">
                                {index + 1}
                              </span>
                              {isVideo && !failed && !uploading && (
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                  <Video className="h-4 w-4 text-white/80" />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {serviceMediaUploadProgress > 0 && saving && (
                        <div className="mt-2">
                          <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-blue-500 transition-all"
                              style={{ width: `${serviceMediaUploadProgress}%` }}
                            />
                          </div>
                          <p className="mt-1 text-[10px] text-gray-500">
                            Uploading media… {serviceMediaUploadProgress}%
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Upload Button */}
                  {serviceMediaList.length < 5 && (
                    <button
                      type="button"
                      onClick={() =>
                        additionalServiceMediaFileRef.current?.click()
                      }
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 border-dashed border-gray-300 hover:border-primary/40 hover:bg-primary/5 text-xs font-semibold text-gray-600 transition-colors"
                    >
                      <Plus className="h-4 w-4" />
                      Add Media ({serviceMediaList.length}/5)
                    </button>
                  )}

                  <input
                    ref={additionalServiceMediaFileRef}
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    onChange={async (e) => {
                      const files = e.target.files;
                      if (!files || files.length === 0) return;

                      const currentCount = serviceMediaList.length;
                      const maxSlots = 5 - currentCount;

                      if (maxSlots <= 0) {
                        notify("Maximum 5 media items allowed.");
                        e.target.value = "";
                        return;
                      }

                      // Import validation utilities
                      const {
                        validateMediaFile,
                        MEDIA_LIMITS,
                        getErrorMessage,
                        isImageMime,
                        formatFileSize,
                        formatDuration,
                      } = await import("@/lib/media/service-media-validation");

                      const filesToProcess = Array.from(files).slice(0, maxSlots);
                      const failedFiles: string[] = [];
                      const newMedia: ServiceMediaDraft[] = [];

                      for (const file of filesToProcess) {
                        // Comprehensive validation
                        const validationResult = await validateMediaFile(file);

                        if (!validationResult.valid) {
                          failedFiles.push(getErrorMessage(validationResult.error!));
                          continue;
                        }

                        const metadata = validationResult.metadata!;

                        try {
                          let dataUrl: string;
                          if (metadata.type === "image") {
                            // Compress images for better performance
                            dataUrl = await compressImage(file, 1000, 0.84);
                          } else {
                            // For videos, read as data URL directly (will be uploaded to Cloudinary later)
                            dataUrl = await new Promise<string>((resolve, reject) => {
                              const reader = new FileReader();
                              reader.onload = () => {
                                resolve(
                                  typeof reader.result === "string" ? reader.result : "",
                                );
                              };
                              reader.onerror = () =>
                                reject(new Error("Failed to read video file"));
                              reader.readAsDataURL(file);
                            });
                          }

                          newMedia.push({
                            id: `service-media-${Date.now()}-${Math.random()}`,
                            url: "",
                            mimeType: metadata.mimeType,
                            fileName: metadata.fileName,
                            dataUrl,
                            uploadStatus: "pending",
                            uploadError: null,
                          });
                        } catch (err) {
                          failedFiles.push(
                            `${file.name} (${err instanceof Error ? err.message : "processing error"})`,
                          );
                        }
                      }

                      if (newMedia.length > 0) {
                        setServiceMediaList((prev) => [...prev, ...newMedia]);
                      }

                      // Show comprehensive feedback
                      if (failedFiles.length > 0) {
                        notify(
                          `Some files could not be added:\n\n${failedFiles
                            .slice(0, 3)
                            .join("\n")}${failedFiles.length > 3 ? `\n...and ${failedFiles.length - 3} more` : ""}`,
                        );
                      } else if (newMedia.length > 0) {
                        notify(
                          `Successfully added ${newMedia.length} media file${newMedia.length > 1 ? "s" : ""}`,
                        );
                      }

                      e.target.value = "";
                    }}
                  />
                </div>
              </div>

              <div>
                <Label required>Service Title</Label>
                <Input
                  value={draft.title}
                  onChange={(value) =>
                    setDraft((prev) => ({ ...prev, title: value }))
                  }
                  placeholder="e.g. Signage Printing"
                />
              </div>

              <div>
                <Label>Tagline</Label>
                <Input
                  value={draft.tagline}
                  onChange={(value) =>
                    setDraft((prev) => ({ ...prev, tagline: value }))
                  }
                  placeholder="Short catchy phrase"
                />
              </div>

              <div>
                <Label>Description</Label>
                <RichTextEditor
                  value={draft.description}
                  onChange={(value) =>
                    setDraft((prev) => ({ ...prev, description: value }))
                  }
                  placeholder="Describe what this service offers..."
                  rows={4}
                  ariaLabel="Service description"
                />
              </div>
            </div>

            {serviceSaveError && (
              <div
                className="mx-6 mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5"
                role="alert"
              >
                <p className="text-sm text-rose-700">{serviceSaveError.message}</p>
                {serviceSaveError.retryable && (
                  <button
                    type="button"
                    onClick={() => {
                      retryFailedServiceMedia();
                    }}
                    disabled={saving}
                    className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-800 bg-white border border-rose-200 hover:bg-rose-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry failed media
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
              <button
                type="button"
                onClick={closeModal}
                disabled={saving}
                className="px-5 py-2 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void commitModal();
                }}
                disabled={saving || !draft.title.trim()}
                className="px-5 py-2 rounded-xl text-sm font-semibold text-white shadow-sm transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: "linear-gradient(135deg,#2A4792,#4785B8)",
                }}
              >
                {saving
                  ? editingId !== null
                    ? "Saving…"
                    : "Adding..."
                  : editingId !== null
                    ? "Save Changes"
                    : "Add Service"}
              </button>
            </div>
          </div>
        </div>
      </ModalPortal>

      <ModalPortal isOpen={galleryModalOpen} onClose={closeGalleryModal}>
        <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-fade-in-up mx-4">
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="h-8 w-8 rounded-xl flex items-center justify-center shrink-0"
                style={{
                  background: "linear-gradient(135deg,#1e3a8a,#4785B8)",
                }}
              >
                <ImagePlus className="h-4 w-4 text-white" />
              </div>
              <h2 className="text-base font-bold text-gray-900 truncate">
                {galleryEditingId !== null
                  ? "Edit Gallery Item"
                  : "New Gallery Item"}
              </h2>
            </div>
            <button
              type="button"
              onClick={closeGalleryModal}
              aria-label="Close"
              className="h-8 w-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 transition-colors shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <Label required>Image</Label>
                <div
                  className="relative h-44 rounded-xl overflow-hidden border-2 border-dashed border-gray-200 hover:border-primary/40 cursor-pointer"
                  onClick={() => galleryFileRef.current?.click()}
                >
                  {previewGallerySource({ id: 0, ...galleryDraft }) ? (
                    <img
                      src={previewGallerySource({ id: 0, ...galleryDraft })}
                      alt=""
                      draggable={false}
                      onDragStart={(e) => e.preventDefault()}
                      className="h-full w-full object-contain object-center"
                    />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-50">
                      <Upload className="h-8 w-8 text-gray-300 mb-2" />
                      <p className="text-sm font-medium text-gray-400">
                        Upload image
                      </p>
                      <p className="text-xs text-gray-300 mt-0.5">
                        PNG, JPG, WEBP up to 10 MB
                      </p>
                    </div>
                  )}
                </div>
                <input
                  ref={galleryFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    void handleGalleryFile(e);
                  }}
                />
              </div>

              {galleryUploadProgress > 0 && (
                <div>
                  <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden mt-2">
                    <div
                      className="h-2 bg-blue-500"
                      style={{ width: `${galleryUploadProgress}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-500 mt-1">
                    Uploading image: {galleryUploadProgress}%
                  </p>
                </div>
              )}

              <div>
                <Label required>Title</Label>
                <Input
                  value={galleryDraft.title}
                  onChange={(value) =>
                    setGalleryDraft((prev) => ({ ...prev, title: value }))
                  }
                  placeholder="e.g. Booth setup"
                />
              </div>

              <div>
                <Label>Description</Label>
                <Textarea
                  value={galleryDraft.description}
                  onChange={(value) =>
                    setGalleryDraft((prev) => ({ ...prev, description: value }))
                  }
                  rows={3}
                  placeholder="Optional caption or context"
                />
              </div>
          </div>

          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
              <button
                type="button"
                onClick={closeGalleryModal}
                className="px-5 py-2 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void commitGalleryModal();
                }}
                disabled={
                  saving || !previewGallerySource({ id: 0, ...galleryDraft })
                }
                className="px-5 py-2 rounded-xl text-sm font-semibold text-white shadow-sm transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: "linear-gradient(135deg,#2A4792,#4785B8)",
                }}
              >
                {saving
                  ? "Saving…"
                  : galleryEditingId !== null
                    ? "Save Item"
                    : "Add Item"}
              </button>
              {galleryLastUploadRef.current && (
                <button
                  type="button"
                  onClick={() => {
                    void retryGalleryUpload();
                  }}
                  disabled={saving}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-primary bg-white/5 hover:bg-white/10 transition-colors"
                >
                  Retry Upload
                </button>
              )}
          </div>
        </div>
      </ModalPortal>

      <ModalPortal isOpen={videoModalOpen} onClose={closeVideoModal}>
        <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-fade-in-up">
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
            <div className="flex items-center gap-2.5">
              <div
                className="h-8 w-8 rounded-xl flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg,#1e3a8a,#4785B8)",
                }}
              >
                <Video className="h-4 w-4 text-white" />
              </div>
              <h2 className="text-base font-bold text-gray-900">
                {videoEditingId !== null ? "Edit Video" : "New Video"}
              </h2>
            </div>
            <button
              type="button"
              onClick={closeVideoModal}
              aria-label="Close"
              className="h-8 w-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
            <div>
              <Label required>Video Title</Label>
              <Input
                value={videoDraft.title}
                onChange={(value) =>
                  setVideoDraft((prev) => ({ ...prev, title: value }))
                }
                placeholder="e.g. Product Walkthrough"
              />
            </div>

            <div>
              <Label>Description</Label>
              <Textarea
                value={videoDraft.description}
                onChange={(value) =>
                  setVideoDraft((prev) => ({ ...prev, description: value }))
                }
                rows={3}
                placeholder="Optional context for this video"
              />
            </div>

            <div>
              <Label>Video URL</Label>
              <Input
                value={videoDraft.url}
                onChange={(value) =>
                  setVideoDraft((prev) => ({
                    ...prev,
                    url: value,
                    // Picking a URL clears any uploaded file binary so we
                    // don't accidentally send both to the backend.
                    fileName: value ? "" : prev.fileName,
                    mimeType: value ? "" : prev.mimeType,
                    videoDataUrl: value ? "" : prev.videoDataUrl,
                    fileSize: value ? 0 : prev.fileSize,
                  }))
                }
                placeholder="YouTube, Vimeo, or direct file URL"
              />
            </div>

            <div>
              <Label>Or upload a video file</Label>
              <button
                type="button"
                onClick={() => videoFileRef.current?.click()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-gray-200 text-xs font-semibold text-gray-600 hover:border-primary/40 hover:bg-primary/5 transition-colors"
              >
                <Upload className="h-4 w-4" />
                {videoDraft.videoDataUrl
                  ? `Replace file (${videoDraft.fileName || "video"})`
                  : "Upload video file (max 30 MB / 15 sec)"}
              </button>
              <input
                ref={videoFileRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={handleVideoModalFile}
              />
              {videoDraft.fileSize > 0 && (
                <p className="text-[11px] text-gray-400 mt-1">
                  {(videoDraft.fileSize / 1024 / 1024).toFixed(1)} MB
                </p>
              )}

              {videoDraft.videoDataUrl && (
                <video
                  src={videoDraft.videoDataUrl}
                  controls
                  className="w-full max-h-56 rounded-xl border border-gray-200 bg-black"
                />
              )}
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
              <button
                type="button"
                onClick={closeVideoModal}
                className="px-5 py-2 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void commitVideoModal();
                }}
                disabled={
                  saving ||
                  !videoDraft.title.trim() ||
                  (!videoDraft.url.trim() && !videoDraft.videoDataUrl)
                }
                className="px-5 py-2 rounded-xl text-sm font-semibold text-white shadow-sm transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: "linear-gradient(135deg,#2A4792,#4785B8)",
                }}
              >
                {saving
                  ? "Saving…"
                  : videoEditingId !== null
                    ? "Save Changes"
                    : "Add Video"}
              </button>
            </div>
          </div>
        </div>
      </ModalPortal>
    </>
  );
}
