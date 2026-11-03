"use client";

import {
  Package,
  Plus,
  Trash2,
  Video,
  ImageIcon,
  Images,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import StepIndicator from "./StepIndicator";
import RichTextEditor from "./RichTextEditor";
import type { GalleryItem, ServiceItem, VideoItem } from "../types";
import { dataUrlToBlob } from "./BizCardShared";
import { getFrontendApiBaseUrl } from "./apiBase";
import { buildImpersonationHeaders } from "@/app/lib/superadminImpersonationHandoff";
import {
  uploadBizcardGalleryVideo,
  validateServiceVideo,
} from "@/lib/media/video-upload";

interface ServicesProductsProps {
  onContinue: (services: ServiceItem[]) => void;
  onRealtimeSave?: (services: ServiceItem[]) => void;
  onRealtimeGallery?: (gallery: GalleryItem[]) => void;
  onRealtimeVideos?: (videos: VideoItem[]) => void;
  onBack: () => void;
  currentStep: number;
  totalSteps: number;
  initialServices?: ServiceItem[];
  initialGallery?: GalleryItem[];
  initialVideos?: VideoItem[];
  draftScopeKey?: string;
}
const API = getFrontendApiBaseUrl();

const EMPTY_SERVICE: ServiceItem = {
  id: 1,
  title: "",
  tagline: "",
  description: "",
  featured_image: null,
  videoUrl: "",
  videoFile: null,
};

const EMPTY_GALLERY_DRAFT: Omit<GalleryItem, "id"> = {
  url: "",
  title: "",
  description: "",
  altText: null,
  fileName: null,
  imageDataUrl: null,
  mimeType: null,
};
const SERVICES_DRAFT_KEY = "signup_services_draft";
const GALLERY_DRAFT_KEY = "signup_gallery_draft";
const VIDEOS_DRAFT_KEY = "signup_videos_draft";
const USER_SYNC_EVENT = "ontap:user-sync";
const CSRF_COOKIE_NAME = "csrf-token";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
function buildScopedServicesDraftKey(scopeKey?: string): string {
  const normalized = String(scopeKey ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return `${SERVICES_DRAFT_KEY}:anonymous`;
  }
  return `${SERVICES_DRAFT_KEY}:${encodeURIComponent(normalized)}`;
}
function buildScopedGalleryDraftKey(scopeKey?: string): string {
  const normalized = String(scopeKey ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return `${GALLERY_DRAFT_KEY}:anonymous`;
  }
  return `${GALLERY_DRAFT_KEY}:${encodeURIComponent(normalized)}`;
}
function buildScopedVideosDraftKey(scopeKey?: string): string {
  const normalized = String(scopeKey ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return `${VIDEOS_DRAFT_KEY}:anonymous`;
  }
  return `${VIDEOS_DRAFT_KEY}:${encodeURIComponent(normalized)}`;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const cookies = document.cookie ? document.cookie.split("; ") : [];
  for (const cookie of cookies) {
    const [rawKey, ...rest] = cookie.split("=");
    const key = decodeURIComponent(rawKey || "").trim();
    if (key !== name) continue;
    return decodeURIComponent(rest.join("=") || "").trim() || null;
  }
  return null;
}

async function ensureCsrfToken(): Promise<string | null> {
  const fromCookie = readCookie(CSRF_COOKIE_NAME);
  if (fromCookie) return fromCookie;

  try {
    const response = await fetch(`${API}/api/csrf-token`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });

    if (!response.ok) {
      return readCookie(CSRF_COOKIE_NAME);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const token =
      (typeof payload.csrfToken === "string" && payload.csrfToken) ||
      (typeof payload.csrf_token === "string" && payload.csrf_token) ||
      (typeof payload.token === "string" && payload.token) ||
      (payload.data &&
      typeof payload.data === "object" &&
      typeof (payload.data as Record<string, unknown>).csrfToken === "string"
        ? String((payload.data as Record<string, unknown>).csrfToken)
        : null);

    return token?.trim() || readCookie(CSRF_COOKIE_NAME);
  } catch {
    return readCookie(CSRF_COOKIE_NAME);
  }
}

async function authFetchWithCsrf(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const method = String(init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers ?? undefined);

  if (MUTATING_METHODS.has(method)) {
    const csrfToken = await ensureCsrfToken();
    if (csrfToken) {
      headers.set("X-CSRF-Token", csrfToken);
    }
  }

  // Add impersonation headers if present
  const impersonationHeaders = buildImpersonationHeaders();
  Object.entries(impersonationHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });

  return fetch(url, {
    ...init,
    method,
    credentials: "include",
    headers,
  });
}

async function buildCsrfHeaders(): Promise<HeadersInit> {
  const csrfToken = await ensureCsrfToken();
  return csrfToken ? { "X-CSRF-Token": csrfToken } : {};
}

async function uploadSignupVideo(
  bizcardId: string,
  video: VideoItem,
): Promise<{ ok: boolean; url?: string }> {
  if (!video.videoDataUrl?.startsWith("data:")) return { ok: true };
  const blob = dataUrlToBlob(video.videoDataUrl);
  const file = new File([blob], video.fileName || `video-${video.id}.mp4`, {
    type: blob.type || video.mimeType || "video/mp4",
  });
  const headers = await buildCsrfHeaders();
  const result = await uploadBizcardGalleryVideo(
    API,
    bizcardId,
    file,
    {
      title: video.title,
      description: video.description,
    },
    headers,
  );
  if (!result.ok) return { ok: false };
  return { ok: true, url: result.url };
}

function isPreviewableVideoUrl(url: string): boolean {
  const normalized = url.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes("/video/upload/") ||
    normalized.endsWith(".mp4") ||
    normalized.endsWith(".mov") ||
    normalized.endsWith(".webm")
  );
}

const ServicesProducts: React.FC<ServicesProductsProps> = ({
  onContinue,
  onRealtimeSave,
  onRealtimeGallery,
  onRealtimeVideos,
  onBack,
  currentStep,
  totalSteps,
  initialServices,
  initialGallery,
  initialVideos,
  draftScopeKey,
}) => {
  const servicesDraftKey = useMemo(
    () => buildScopedServicesDraftKey(draftScopeKey),
    [draftScopeKey],
  );
  const galleryDraftKey = useMemo(
    () => buildScopedGalleryDraftKey(draftScopeKey),
    [draftScopeKey],
  );
  const videosDraftKey = useMemo(
    () => buildScopedVideosDraftKey(draftScopeKey),
    [draftScopeKey],
  );

  const [services, setServices] = useState<ServiceItem[]>(() => {
    if (initialServices && initialServices.length > 0) return initialServices;

    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem(servicesDraftKey);
        if (raw) {
          const parsed = JSON.parse(raw) as ServiceItem[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        }
      } catch {
        // Ignore malformed draft cache and fall back to empty service.
      }
    }

    return [EMPTY_SERVICE];
  });

  const [gallery, setGallery] = useState<GalleryItem[]>(() => {
    if (initialGallery && initialGallery.length > 0) return initialGallery;

    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem(galleryDraftKey);
        if (raw) {
          const parsed = JSON.parse(raw) as GalleryItem[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        }
      } catch {
        // Ignore malformed draft cache and fall back to empty gallery.
      }
    }

    return [];
  });

  const [videos, setVideos] = useState<VideoItem[]>(() => {
    if (initialVideos && initialVideos.length > 0) return initialVideos;

    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem(videosDraftKey);
        if (raw) {
          const parsed = JSON.parse(raw) as VideoItem[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        }
      } catch {
        // Ignore malformed draft cache and fall back to empty videos.
      }
    }

    return [];
  });

  const [saveLabel, setSaveLabel] = useState("Save Services");
  const [saveNotice, setSaveNotice] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [serviceFieldErrors, setServiceFieldErrors] = useState<Record<number, { title?: boolean; description?: boolean }>>({});
  const imageRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const galleryFileRef = useRef<HTMLInputElement | null>(null);
  const saveLabelTimeoutRef = useRef<number | null>(null);
  const saveNoticeTimeoutRef = useRef<number | null>(null);
  const [galleryStatus, setGalleryStatus] = useState<
    "idle" | "saving" | "saved"
  >("idle");
  const [videosStatus, setVideosStatus] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const [subscriptionPlan, setSubscriptionPlan] = useState("Basic");
  const galleryStatusTimeoutRef = useRef<number | null>(null);
  const videosStatusTimeoutRef = useRef<number | null>(null);

  // NEW: store dimensions for each service's featured image
  const [serviceImageDimensions, setServiceImageDimensions] = useState<Record<number, { width: number; height: number }>>({});

  const persistServices = useCallback((nextServices: ServiceItem[]) => {
    try {
      localStorage.setItem(servicesDraftKey, JSON.stringify(nextServices));
    } catch {
      // Ignore local storage write errors; setup can still continue with in-memory state.
    }
  }, [servicesDraftKey]);

  const persistGallery = useCallback(
    (nextGallery: GalleryItem[]) => {
      try {
        localStorage.setItem(galleryDraftKey, JSON.stringify(nextGallery));
      } catch {
        // Ignore local storage write errors; setup can still continue with in-memory state.
      }
    },
    [galleryDraftKey],
  );

  const persistVideos = useCallback(
    (nextVideos: VideoItem[]) => {
      try {
        localStorage.setItem(videosDraftKey, JSON.stringify(nextVideos));
      } catch {
        // Ignore local storage write errors; setup can still continue with in-memory state.
      }
    },
    [videosDraftKey],
  );

  const commitServices = (updater: (prev: ServiceItem[]) => ServiceItem[]) => {
    setServices((prev) => {
      const next = updater(prev);
      persistServices(next);
      return next;
    });
  };

  const commitGallery = (updater: (prev: GalleryItem[]) => GalleryItem[]) => {
    setGallery((prev) => {
      const next = updater(prev);
      persistGallery(next);
      return next;
    });
  };

  const commitVideos = (updater: (prev: VideoItem[]) => VideoItem[]) => {
    setVideos((prev) => {
      const next = updater(prev);
      persistVideos(next);
      return next;
    });
  };

  const showSaveNotice = useCallback(
    (type: "success" | "error", message: string) => {
      setSaveNotice({ type, message });
      if (saveNoticeTimeoutRef.current !== null) {
        window.clearTimeout(saveNoticeTimeoutRef.current);
      }
      saveNoticeTimeoutRef.current = window.setTimeout(() => {
        setSaveNotice(null);
      }, 4200);
    },
    [],
  );

  useEffect(() => {
    onRealtimeSave?.(services);
    persistServices(services);
  }, [services, onRealtimeSave, persistServices]);

  useEffect(() => {
    onRealtimeGallery?.(gallery);
    persistGallery(gallery);
  }, [gallery, onRealtimeGallery, persistGallery]);

  useEffect(() => {
    onRealtimeVideos?.(videos);
    persistVideos(videos);
  }, [videos, onRealtimeVideos, persistVideos]);

  const fetchSubscriptionPlan = useCallback(async () => {
    try {
      const response = await authFetchWithCsrf(`${API}/api/user/subscription`, {
        cache: "no-store",
      });

      if (!response.ok) {
        console.error("Failed to fetch subscription plan:", response.status);
        setSubscriptionPlan("Basic");
        return;
      }

      const payload = (await response.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      const data = (payload?.data ?? payload) as Record<string, unknown> | null;
      const tierRaw = String(data?.tier ?? data?.plan ?? "Basic").trim();
      const accessReason = String(data?.access_reason ?? "").toLowerCase();
      const isTrial = Boolean(data?.is_trial);
      const plan =
        tierRaw.toLowerCase() === "none" &&
        (isTrial || accessReason === "free_trial")
          ? "Free Trial"
          : tierRaw;

      setSubscriptionPlan(plan || "Basic");
    } catch (error) {
      console.error("Failed to fetch subscription plan:", error);
      setSubscriptionPlan("Basic");
    }
  }, []);

  useEffect(() => {
    void fetchSubscriptionPlan();
    window.addEventListener(USER_SYNC_EVENT, fetchSubscriptionPlan);
    window.addEventListener("focus", fetchSubscriptionPlan);

    return () => {
      window.removeEventListener(USER_SYNC_EVENT, fetchSubscriptionPlan);
      window.removeEventListener("focus", fetchSubscriptionPlan);
    };
  }, [fetchSubscriptionPlan]);

  useEffect(() => {
    return () => {
      if (saveLabelTimeoutRef.current !== null) {
        window.clearTimeout(saveLabelTimeoutRef.current);
      }
      if (saveNoticeTimeoutRef.current !== null) {
        window.clearTimeout(saveNoticeTimeoutRef.current);
      }
      if (galleryStatusTimeoutRef.current !== null) {
        window.clearTimeout(galleryStatusTimeoutRef.current);
      }
      if (videosStatusTimeoutRef.current !== null) {
        window.clearTimeout(videosStatusTimeoutRef.current);
      }
    };
  }, []);

  const addService = () => {
    const newService: ServiceItem = {
      id: Date.now(),
      title: "",
      tagline: "",
      description: "",
      featured_image: null,
      videoUrl: "",
      videoFile: null,
    };
    commitServices((prev) => [...prev, newService]);
  };

  const addGalleryItem = () => {
    const newItem: GalleryItem = {
      id: Date.now(),
      url: "",
      title: "",
      description: "",
      altText: null,
      fileName: null,
      imageDataUrl: null,
      mimeType: null,
    };
    commitGallery((prev) => [...prev, newItem]);
  };

  const removeGalleryItem = (id: number) => {
    commitGallery((prev) => prev.filter((item) => item.id !== id));
  };

  const updateGalleryItem = (
    id: number,
    field: keyof GalleryItem,
    value: string | null,
  ) => {
    commitGallery((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    );
  };

  const handleGalleryImageChange = (
    id: number,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showSaveNotice("error", "Only image files are allowed for gallery.");
      e.target.value = "";
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showSaveNotice("error", "Image must be 10 MB or smaller.");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () =>
      updateGalleryItem(id, "imageDataUrl", reader.result as string);
    reader.readAsDataURL(file);
    updateGalleryItem(id, "fileName", file.name);
    updateGalleryItem(id, "mimeType", file.type);
  };

  // Video handlers
  const addVideo = () => {
    const newVideo: VideoItem = {
      id: Date.now(),
      title: "",
      description: "",
      fileName: "",
      fileSize: 0,
      videoDataUrl: null,
      mimeType: null,
    };
    commitVideos((prev) => [...prev, newVideo]);
  };

  const removeVideo = (id: number) => {
    commitVideos((prev) => prev.filter((video) => video.id !== id));
  };

  const updateVideo = (
    id: number,
    field: keyof VideoItem,
    value: string | number | null,
  ) => {
    commitVideos((prev) =>
      prev.map((video) =>
        video.id === id ? { ...video, [field]: value } : video,
      ),
    );
  };

  const handleVideoFileUpload = async (
    id: number,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validationError = await validateServiceVideo(file);
    if (validationError) {
      showSaveNotice("error", validationError);
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      updateVideo(id, "videoDataUrl", reader.result as string);
      updateVideo(id, "fileName", file.name);
      updateVideo(id, "mimeType", file.type);
      updateVideo(id, "fileSize", file.size);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const removeService = (id: number) => {
    commitServices((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((s) => s.id !== id);
    });
    // Also remove its dimensions
    setServiceImageDimensions((prev) => {
      const newMap = { ...prev };
      delete newMap[id];
      return newMap;
    });
  };

  const updateService = (id: number, field: keyof ServiceItem, value: string | null) => {
    commitServices((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
    if ((field === 'title' || field === 'description') && value !== null) {
      setServiceFieldErrors((prev) => {
        const next = { ...prev };
        const current = { ...(next[id] ?? {}) };
        if (field === 'title') {
          current.title = !value.trim();
        } else {
          current.description = !value.trim();
        }
        if (!current.title && !current.description) {
          delete next[id];
        } else {
          next[id] = current;
        }
        return next;
      });
    }
    // If we're clearing the image, remove its dimensions
    if (field === 'featured_image' && value === null) {
      setServiceImageDimensions((prev) => {
        const newMap = { ...prev };
        delete newMap[id];
        return newMap;
      });
    }
  };

  const handleImageChange = (
    id: number,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showSaveNotice('error', 'Only image files are allowed.');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      updateService(id, 'featured_image', dataUrl);
      // Get natural dimensions for aspect ratio
      const img = new Image();
      img.onload = () => {
        setServiceImageDimensions((prev) => ({
          ...prev,
          [id]: { width: img.naturalWidth, height: img.naturalHeight },
        }));
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const normalizeServicesForSave = (rows: ServiceItem[]) =>
    rows.filter((s) =>
      Boolean(s.title.trim() || s.description.trim() || s.featured_image),
    );

  const validateServicesForSave = (rows: ServiceItem[]) => {
    const servicesToSave = normalizeServicesForSave(rows);
    const nextErrors: Record<number, { title?: boolean; description?: boolean }> = {};

    servicesToSave.forEach((service) => {
      const titleMissing = !service.title.trim();
      const descriptionMissing = !service.description.trim();
      if (titleMissing || descriptionMissing) {
        nextErrors[service.id] = {
          ...(titleMissing ? { title: true } : {}),
          ...(descriptionMissing ? { description: true } : {}),
        };
      }
    });

    setServiceFieldErrors(nextErrors);

    return {
      servicesToSave,
      isValid: Object.keys(nextErrors).length === 0,
    };
  };

  const syncServicesToDashboard = async (rows: ServiceItem[]): Promise<{ syncedCount: number; failedCount: number }> => {
    const existingByOrder = new Map<number, string>();
    let profileUserId = "";
    let profileAlias = "";

    try {
      const profileRes = await authFetchWithCsrf(`${API}/api/vcard/profile`, {
        cache: "no-store",
      });
      if (profileRes.ok) {
        const profilePayload = (await profileRes.json()) as {
          profile?: Record<string, unknown>;
        };
        const profile = (profilePayload.profile ?? {}) as Record<
          string,
          unknown
        >;
        profileUserId = String(profile.user_id ?? "").trim();
        profileAlias = String(profile.custom_uri ?? "").trim();
      }
    } catch {
      // If profile probe fails, proceed with create-only flow below.
    }

    if (profileUserId || profileAlias) {
      const queryParts: string[] = ["type=services"];
      if (profileUserId) {
        queryParts.unshift(`userId=${encodeURIComponent(profileUserId)}`);
      } else if (profileAlias) {
        queryParts.unshift(`username=${encodeURIComponent(profileAlias)}`);
      }

      const listResponse = await authFetchWithCsrf(
        `${API}/api/vcard/services?${queryParts.join("&")}`,
        {
          cache: "no-store",
        },
      );

      if (listResponse.ok) {
        const payload = (await listResponse.json()) as {
          data?: Record<string, unknown>;
        };
        const data = (payload.data ?? {}) as Record<string, unknown>;
        const existing = Array.isArray(data.services) ? data.services : [];

        existing.forEach((rawSvc, index) => {
          const svc = (rawSvc ?? {}) as Record<string, unknown>;
          const orderRaw = Number(
            svc.display_order ?? svc.displayOrder ?? index,
          );
          const order = Number.isFinite(orderRaw) ? orderRaw : index;
          const id = String(svc.service_id ?? svc.id ?? "").trim();
          if (id) existingByOrder.set(order, id);
        });
      }
    }

    let syncedCount = 0;
    let failedCount = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const svc = rows[index];
      const body: Record<string, unknown> = {
        name: svc.title.trim(),
        tagline: svc.tagline.trim() || undefined,
        description: (svc.description || svc.title).trim(),
        serviceUrl: svc.videoUrl.trim() || undefined,
        displayOrder: index,
        isVisible: true,
        status: "active",
      };
      if (svc.featured_image && svc.featured_image.startsWith("http")) {
        body.featuredImageUrl = svc.featured_image;
      }
      const payload = Object.fromEntries(
        Object.entries(body).filter(([, value]) => value !== undefined),
      );

      const existingId = existingByOrder.get(index);
      const endpoint = existingId
        ? `${API}/api/bizcard/services/${encodeURIComponent(existingId)}`
        : `${API}/api/bizcard/services`;
      const method = existingId ? "PUT" : "POST";

      const response = await authFetchWithCsrf(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        syncedCount += 1;
      } else {
        failedCount += 1;
      }
    }

    return { syncedCount, failedCount };
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const { isValid } = validateServicesForSave(services);
    if (!isValid) {
      showSaveNotice('error', 'Please fill in all required service fields before continuing.');
      return;
    }
    persistServices(services);
    onContinue(services);
  };
  const handleSaveServices = async () => {
    const { servicesToSave, isValid } = validateServicesForSave(services);
    if (servicesToSave.length === 0) {
      showSaveNotice("error", "Add at least one service before saving.");
      return;
    }
    if (!isValid) {
      showSaveNotice('error', 'Please fill in all required service fields before saving.');
      return;
    }

    setSaving(true);
    setSaveLabel("Saving...");
    persistServices(services);
    persistGallery(gallery);
    persistVideos(videos);
    onRealtimeSave?.(services);
    onRealtimeGallery?.(gallery);
    onRealtimeVideos?.(videos);

    let syncResult = { syncedCount: 0, failedCount: servicesToSave.length };
    try {
      syncResult = await syncServicesToDashboard(servicesToSave);
    } catch {
      syncResult = { syncedCount: 0, failedCount: servicesToSave.length };
    }

    // Try to upload gallery items and videos if bizcardId is available
    let gallerySyncedCount = 0;
    let galleryFailedCount = 0;
    let videosSyncedCount = 0;
    let videosFailedCount = 0;
    let bizcardId = "";

    try {
      const profileRes = await authFetchWithCsrf(`${API}/api/vcard/profile`, {
        cache: "no-store",
      });
      if (profileRes.ok) {
        const profilePayload = (await profileRes.json()) as {
          profile?: Record<string, unknown>;
        };
        const profile = (profilePayload.profile ?? {}) as Record<
          string,
          unknown
        >;
        bizcardId = String(
          profile.bizcard_id ?? profile.bizcardId ?? "",
        ).trim();
      }
    } catch {
      // If profile probe fails, continue without gallery/video upload
    }

    if (bizcardId) {
      const galleryEndpointBase = `${API}/api/bizcard/${encodeURIComponent(bizcardId)}/gallery`;

      // Upload gallery items
      for (const item of gallery) {
        if (!item.imageDataUrl?.startsWith("data:")) continue;

        try {
          const blob = dataUrlToBlob(item.imageDataUrl);
          const fd = new FormData();
          fd.append(
            "file",
            new File([blob], item.fileName || `gallery-${item.id}.jpg`, {
              type: blob.type || item.mimeType || "image/jpeg",
            }),
          );
          fd.append("title", item.title);
          fd.append("description", item.description);
          fd.append("alt_text", item.altText ?? item.title);
          fd.append("category", "gallery");

          const uploadRes = await authFetchWithCsrf(galleryEndpointBase, {
            method: "POST",
            body: fd,
          });
          if (uploadRes.ok) {
            gallerySyncedCount += 1;
            // Update item with the uploaded URL
            const uploadPayload = await uploadRes.json();
            const created = (uploadPayload.data ?? uploadPayload) as Record<
              string,
              unknown
            >;
            const uploadedUrl = String(
              created.url ?? created.file_url ?? created.secure_url ?? "",
            ).trim();
            if (uploadedUrl) {
              updateGalleryItem(item.id, "url", uploadedUrl);
              updateGalleryItem(item.id, "imageDataUrl", null);
            }
          } else {
            galleryFailedCount += 1;
          }
        } catch {
          galleryFailedCount += 1;
        }
      }

      // Upload video items
      for (const video of videos) {
        if (!video.videoDataUrl?.startsWith("data:")) continue;

        try {
          const uploadResult = await uploadSignupVideo(bizcardId, video);
          if (uploadResult.ok) {
            videosSyncedCount += 1;
            if (uploadResult.url) {
              updateVideo(video.id, "fileName", uploadResult.url);
              updateVideo(video.id, "videoDataUrl", null);
            }
          } else {
            videosFailedCount += 1;
          }
        } catch {
          videosFailedCount += 1;
        }
      }
    }

    setSaveLabel("Saved");
    if (saveLabelTimeoutRef.current !== null) {
      window.clearTimeout(saveLabelTimeoutRef.current);
    }
    saveLabelTimeoutRef.current = window.setTimeout(() => {
      setSaveLabel("Save Services");
    }, 1200);
    setSaving(false);

    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("portfolio_refresh_ts", String(Date.now()));
      } catch {
        // Ignore storage write failures.
      }
      window.dispatchEvent(new CustomEvent(USER_SYNC_EVENT));
    }

    const totalFailed =
      syncResult.failedCount + galleryFailedCount + videosFailedCount;
    if (totalFailed === 0) {
      showSaveNotice("success", "Successfully saved services");
      return;
    }

    const totalAttempted =
      servicesToSave.length + gallery.length + videos.length;
    const totalSuccess =
      syncResult.syncedCount + gallerySyncedCount + videosSyncedCount;
    showSaveNotice(
      "error",
      `Saved ${totalSuccess} of ${totalAttempted} items locally. ${totalFailed} item${totalFailed !== 1 ? "s" : ""} failed to sync in real time.`,
    );
  };

  // Get bizcardId for gallery/video uploads
  const getBizcardId = async (): Promise<string | null> => {
    try {
      const profileRes = await authFetchWithCsrf(`${API}/api/vcard/profile`, {
        cache: "no-store",
      });
      if (profileRes.ok) {
        const profilePayload = (await profileRes.json()) as {
          profile?: Record<string, unknown>;
        };
        const profile = (profilePayload.profile ?? {}) as Record<
          string,
          unknown
        >;
        return (
          String(profile.bizcard_id ?? profile.bizcardId ?? "").trim() || null
        );
      }
    } catch {
      // Ignore error
    }
    return null;
  };

  // Separate Gallery save handler
  const handleSaveGallery = async () => {
    if (gallery.length === 0) {
      showSaveNotice("error", "Add at least one gallery item before saving.");
      return;
    }

    setGalleryStatus("saving");
    persistGallery(gallery);
    onRealtimeGallery?.(gallery);

    let gallerySyncedCount = 0;
    let galleryFailedCount = 0;

    const bizcardId = await getBizcardId();

    if (bizcardId) {
      const galleryEndpointBase = `${API}/api/bizcard/${encodeURIComponent(bizcardId)}/gallery`;

      for (const item of gallery) {
        if (!item.imageDataUrl?.startsWith("data:")) continue;

        try {
          const blob = dataUrlToBlob(item.imageDataUrl);
          const fd = new FormData();
          fd.append(
            "file",
            new File([blob], item.fileName || `gallery-${item.id}.jpg`, {
              type: blob.type || item.mimeType || "image/jpeg",
            }),
          );
          fd.append("title", item.title);
          fd.append("description", item.description);
          fd.append("alt_text", item.altText ?? item.title);
          fd.append("category", "gallery");

          const uploadRes = await authFetchWithCsrf(galleryEndpointBase, {
            method: "POST",
            body: fd,
          });
          if (uploadRes.ok) {
            gallerySyncedCount += 1;
            const uploadPayload = await uploadRes.json();
            const created = (uploadPayload.data ?? uploadPayload) as Record<
              string,
              unknown
            >;
            const uploadedUrl = String(
              created.url ?? created.file_url ?? created.secure_url ?? "",
            ).trim();
            const savedId = Number(
              created.id ?? created.mediaId ?? created.media_id ?? item.id,
            );
            if (uploadedUrl) {
              setGallery((prev) =>
                prev.map((entry) =>
                  entry.id === item.id
                    ? {
                        ...entry,
                        id:
                          Number.isFinite(savedId) && savedId > 0
                            ? savedId
                            : entry.id,
                        url: uploadedUrl,
                        imageDataUrl: null,
                      }
                    : entry,
                ),
              );
            }
          } else {
            galleryFailedCount += 1;
          }
        } catch {
          galleryFailedCount += 1;
        }
      }
    }

    // Trigger real-time sync
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("portfolio_refresh_ts", String(Date.now()));
      } catch {
        // Ignore
      }
      window.dispatchEvent(new CustomEvent(USER_SYNC_EVENT));
    }

    if (galleryFailedCount === 0) {
      setGalleryStatus("saved");
      if (galleryStatusTimeoutRef.current !== null)
        window.clearTimeout(galleryStatusTimeoutRef.current);
      galleryStatusTimeoutRef.current = window.setTimeout(
        () => setGalleryStatus("idle"),
        2500,
      );
      showSaveNotice("success", "Successfully saved gallery");
    } else {
      setGalleryStatus("idle");
      showSaveNotice(
        "error",
        `Gallery saved locally, but ${galleryFailedCount} item${galleryFailedCount !== 1 ? "s" : ""} failed to sync.`,
      );
    }
  };

  // Separate Videos save handler
  const handleSaveVideos = async () => {
    if (videos.length === 0) {
      showSaveNotice("error", "Add at least one video before saving.");
      return;
    }

    setVideosStatus("saving");
    persistVideos(videos);
    onRealtimeVideos?.(videos);

    let videosSyncedCount = 0;
    let videosFailedCount = 0;

    const bizcardId = await getBizcardId();

    if (bizcardId) {
      for (const video of videos) {
        if (!video.videoDataUrl?.startsWith("data:")) continue;

        try {
          const uploadResult = await uploadSignupVideo(bizcardId, video);
          if (uploadResult.ok) {
            videosSyncedCount += 1;
            if (uploadResult.url) {
              updateVideo(video.id, "fileName", uploadResult.url);
              updateVideo(video.id, "videoDataUrl", null);
            }
          } else {
            videosFailedCount += 1;
          }
        } catch {
          videosFailedCount += 1;
        }
      }
    }

    // Trigger real-time sync
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("portfolio_refresh_ts", String(Date.now()));
      } catch {
        // Ignore
      }
      window.dispatchEvent(new CustomEvent(USER_SYNC_EVENT));
    }

    if (videosFailedCount === 0) {
      setVideosStatus("saved");
      if (videosStatusTimeoutRef.current !== null)
        window.clearTimeout(videosStatusTimeoutRef.current);
      videosStatusTimeoutRef.current = window.setTimeout(
        () => setVideosStatus("idle"),
        2500,
      );
      showSaveNotice("success", "Successfully saved videos");
    } else {
      setVideosStatus("idle");
      showSaveNotice(
        "error",
        `Videos saved locally, but ${videosFailedCount} item${videosFailedCount !== 1 ? "s" : ""} failed to sync.`,
      );
    }
  };

  return (
    <div className="w-full max-w-md bg-white rounded-2xl p-8">
      <StepIndicator currentStep={currentStep} totalSteps={totalSteps} />
      <h1 className="text-2xl font-bold text-gray-900 mb-1">
        Services / Products
      </h1>
      <p className="text-gray-400 text-sm mb-6">
        Add the services or products you want to features in your page
      </p>
      {saveNotice && (
        <div
          className={`fixed top-4 left-1/2 z-50 -translate-x-1/2 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold shadow-lg animate-in fade-in slide-in-from-top-2 ${saveNotice.type === "success" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`}
        >
          {saveNotice.type === "success" ? (
            <CheckCircle className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          <span>{saveNotice.message}</span>
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        {services.map((service) => (
          <div
            key={service.id}
            className="border border-gray-200 rounded-xl p-4 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5 text-gray-700" />
                <span className="text-sm font-semibold text-gray-700">
                  Items
                </span>
              </div>
              {services.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeService(service.id)}
                  className="text-red-400 hover:text-red-600 cursor-pointer"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
            {/* Service Title */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Service Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Graphic Design"
                value={service.title}
                onChange={(e) => updateService(service.id, 'title', e.target.value)}
                className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-1 transition-colors ${
                  serviceFieldErrors[service.id]?.title
                    ? 'border-red-400 text-red-900 focus:border-red-500 focus:ring-red-500'
                    : 'border-gray-200 focus:border-blue-500 focus:ring-blue-500'
                }`}
              />
              {serviceFieldErrors[service.id]?.title ? (
                <p className="mt-1 text-xs font-medium text-red-600">Service title is required.</p>
              ) : null}
            </div>

            {/* Tagline */}
            <div>
              <div className="flex justify-between mb-1">
                <label className="block text-xs font-semibold text-gray-600">
                  Tagline
                </label>
                <span className="text-[10px] text-blue-500">(optional)</span>
              </div>
              <input
                type="text"
                placeholder="e.g. Make your brand visible"
                value={service.tagline}
                onChange={(e) =>
                  updateService(service.id, "tagline", e.target.value)
                }
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Description <span className="text-red-500">*</span>
              </label>
              <RichTextEditor
                placeholder="Describe your Services description..."
                value={service.description}
                onChange={(html) =>
                  updateService(service.id, "description", html)
                }
                rows={3}
                ariaLabel="Service description"
                className={`rounded-xl border transition-colors bg-white focus-within:ring-1 ${
                  serviceFieldErrors[service.id]?.description
                    ? 'border-red-400 focus-within:border-red-500 focus-within:ring-red-500'
                    : 'border-gray-200 focus-within:border-blue-500 focus-within:ring-blue-500'
                }`}
              />
              {serviceFieldErrors[service.id]?.description ? (
                <p className="mt-1 text-xs font-medium text-red-600">Description is required.</p>
              ) : null}
            </div>

            {/* Showcase Product – now using background-image with dynamic aspect ratio */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Service Image
              </label>
              <div
                className="w-full border border-gray-200 rounded-xl bg-gray-50 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-100 transition-colors overflow-hidden"
                style={{
                  aspectRatio: serviceImageDimensions[service.id]
                    ? serviceImageDimensions[service.id].width / serviceImageDimensions[service.id].height
                    : 'auto',
                  minHeight: serviceImageDimensions[service.id] ? undefined : '112px', // h-28 ≈ 7rem
                  backgroundImage: service.featured_image ? `url(${service.featured_image})` : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  backgroundRepeat: 'no-repeat',
                }}
                onClick={() => imageRefs.current[service.id]?.click()}
              >
                {!service.featured_image && (
                  <>
                    <ImageIcon className="h-8 w-8 text-gray-300 mb-1" />
                    <span className="text-xs text-gray-400">
                      Click to upload image
                    </span>
                    <span className="text-[10px] text-gray-300 mt-0.5">
                      JPG, PNG, or WEBP
                    </span>
                  </>
                )}
              </div>
              <input
                ref={(el) => {
                  imageRefs.current[service.id] = el;
                }}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleImageChange(service.id, e)}
              />
            </div>
            {/* Cancel / Save */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => removeService(service.id)}
                className="flex-1 border border-gray-200 hover:bg-gray-50 text-gray-600 font-medium py-2.5 rounded-xl transition-colors text-sm cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveServices}
                disabled={saving}
                className="flex-1 bg-[#2D3A8C] hover:bg-[#243080] text-white font-medium py-2.5 rounded-xl transition-colors text-sm cursor-pointer"
              >
                {saveLabel}
              </button>
            </div>
          </div>
        ))}

        {/* Add Services */}
        <button
          type="button"
          onClick={addService}
          className="w-full flex items-center justify-center gap-2 text-blue-600 font-semibold text-sm py-2 hover:text-blue-800 transition-colors cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Add Services
        </button>

        {/* Gallery Section */}
        {(subscriptionPlan === "Premium" ||
          subscriptionPlan === "Standard") && (
          <div className="pt-4 border-t border-gray-100">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Images className="h-5 w-5 text-gray-700" />
                <span className="text-sm font-semibold text-gray-700">
                  Gallery
                </span>
              </div>
            </div>

            {gallery.length === 0 && (
              <div className="text-center py-4 text-gray-400 text-xs">
                No gallery items yet. Click "Add Gallery Item" to start.
              </div>
            )}

            {gallery.map((item) => (
              <div
                key={item.id}
                className="border border-gray-200 rounded-xl p-4 space-y-3 mb-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-600">
                    Gallery Item
                  </span>
                  <button
                    type="button"
                    onClick={() => removeGalleryItem(item.id)}
                    className="text-red-400 hover:text-red-600 cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {/* Gallery Title */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    Title
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Portfolio highlight"
                    value={item.title}
                    onChange={(e) =>
                      updateGalleryItem(item.id, "title", e.target.value)
                    }
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                  />
                </div>

                {/* Gallery Description */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    Description
                  </label>
                  <textarea
                    placeholder="Describe this gallery item..."
                    value={item.description}
                    onChange={(e) =>
                      updateGalleryItem(item.id, "description", e.target.value)
                    }
                    rows={2}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors resize-none"
                  />
                </div>

                {/* Gallery Image Upload */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    Image
                  </label>
                  <div
                    className="w-full h-24 border border-gray-200 rounded-xl bg-gray-50 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-100 transition-colors overflow-hidden"
                    onClick={() => galleryFileRef.current?.click()}
                  >
                    {item.imageDataUrl ? (
                      <img
                        src={item.imageDataUrl}
                        alt={item.title}
                        className="w-full h-full object-cover"
                      />
                    ) : item.url ? (
                      <img
                        src={item.url}
                        alt={item.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <>
                        <ImageIcon className="h-6 w-6 text-gray-300 mb-1" />
                        <span className="text-xs text-gray-400">
                          Click to upload image
                        </span>
                        <span className="text-[10px] text-gray-300 mt-0.5">
                          JPG, PNG, or WEBP
                        </span>
                      </>
                    )}
                  </div>
                  <input
                    ref={galleryFileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handleGalleryImageChange(item.id, e)}
                  />
                </div>
              </div>
            ))}

            {/* Add Gallery Item */}
            <button
              type="button"
              onClick={addGalleryItem}
              className="w-full flex items-center justify-center gap-2 text-blue-600 font-semibold text-sm py-2 hover:text-blue-800 transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              Add Gallery Item
            </button>

            {/* Save Gallery Button */}
            {gallery.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  void handleSaveGallery();
                }}
                disabled={galleryStatus === "saving"}
                className={`w-full mt-3 inline-flex items-center justify-center gap-2 font-semibold py-2.5 rounded-xl transition-colors text-sm cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed ${galleryStatus === "saved" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-[#2D3A8C] hover:bg-[#243080] text-white"}`}
              >
                {galleryStatus === "saving" && <span>Saving Gallery...</span>}
                {galleryStatus === "saved" && (
                  <>
                    <CheckCircle className="h-4 w-4" />
                    <span>Gallery Saved</span>
                  </>
                )}
                {galleryStatus === "idle" && <span>Save Gallery</span>}
              </button>
            )}
          </div>
        )}

        {(subscriptionPlan === "Premium" ||
          subscriptionPlan === "Standard") && (
          <div className="pt-4 border-t border-gray-100">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Video className="h-5 w-5 text-gray-700" />
                <span className="text-sm font-semibold text-gray-700">
                  Videos
                </span>
              </div>
            </div>

            {videos.length === 0 && (
              <div className="text-center py-4 text-gray-400 text-xs">
                No videos yet. Click "Add Video" to start.
              </div>
            )}

            {videos.map((video) => (
              <div
                key={video.id}
                className="border border-gray-200 rounded-xl p-4 space-y-3 mb-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-600">
                    Video Item
                  </span>
                  <button
                    type="button"
                    onClick={() => removeVideo(video.id)}
                    className="text-red-400 hover:text-red-600 cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {/* Video Title */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    Title
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Product Demo"
                    value={video.title}
                    onChange={(e) =>
                      updateVideo(video.id, "title", e.target.value)
                    }
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                  />
                </div>

                {/* Video Description */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    Description
                  </label>
                  <textarea
                    placeholder="Describe this video..."
                    value={video.description}
                    onChange={(e) =>
                      updateVideo(video.id, "description", e.target.value)
                    }
                    rows={2}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors resize-none"
                  />
                </div>

                {/* Video URL Input */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    Video URL
                  </label>
                  <input
                    type="url"
                    placeholder="Paste YouTube, Vimeo, or direct video URL"
                    value={
                      video.videoDataUrl?.startsWith("data:")
                        ? ""
                        : video.fileName
                    }
                    onChange={(e) => {
                      updateVideo(video.id, "fileName", e.target.value);
                      updateVideo(video.id, "videoDataUrl", null);
                    }}
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                  />
                </div>

                {/* Video File Upload */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    Or Upload Video File
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      accept="video/*"
                      onChange={(e) => handleVideoFileUpload(video.id, e)}
                      className="text-xs text-gray-600 file:mr-2 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-medium file:bg-blue-50 file:text-blue-600 hover:file:bg-blue-100"
                    />
                  </div>
                  {video.fileSize > 0 && (
                    <p className="text-[10px] text-gray-400 mt-1">
                      Size: {(video.fileSize / 1024 / 1024).toFixed(1)} MB
                    </p>
                  )}
                </div>

                {/* Video Preview */}
                {(video.videoDataUrl ||
                  (video.fileName && video.fileName.startsWith("http"))) && (
                  <div className="mt-2">
                    {video.videoDataUrl ? (
                      <video
                        src={video.videoDataUrl}
                        controls
                        className="w-full max-h-40 rounded-lg border border-gray-200 bg-black"
                      />
                    ) : (
                      <a
                        href={video.fileName}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:underline"
                      >
                        <Video className="h-3.5 w-3.5" />
                        View Video
                      </a>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Add Video */}
            <button
              type="button"
              onClick={addVideo}
              className="w-full flex items-center justify-center gap-2 text-blue-600 font-semibold text-sm py-2 hover:text-blue-800 transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              Add Video
            </button>

            {/* Save Videos Button */}
            {videos.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  void handleSaveVideos();
                }}
                disabled={videosStatus === "saving"}
                className={`w-full mt-3 inline-flex items-center justify-center gap-2 font-semibold py-2.5 rounded-xl transition-colors text-sm cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed ${videosStatus === "saved" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-[#2D3A8C] hover:bg-[#243080] text-white"}`}
              >
                {videosStatus === "saving" && <span>Saving Videos...</span>}
                {videosStatus === "saved" && (
                  <>
                    <CheckCircle className="h-4 w-4" />
                    <span>Videos Saved</span>
                  </>
                )}
                {videosStatus === "idle" && <span>Save Videos</span>}
              </button>
            )}
          </div>
        )}

        {/* Navigation Buttons */}
        <div className="flex gap-3 pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={onBack}
            className="flex-1 border border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold py-3 rounded-xl transition-colors text-sm cursor-pointer"
          >
            Back
          </button>
          <button
            type="submit"
            className="flex-1 bg-[#2D3A8C] hover:bg-[#243080] text-white font-semibold py-3 rounded-xl transition-colors text-sm cursor-pointer"
          >
            Continue
          </button>
        </div>
      </form>
    </div>
  );
};

export default ServicesProducts;