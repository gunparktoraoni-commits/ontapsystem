"use client";

import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Check,
  ChevronDown,
  ImagePlus,
  Loader2,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { ModalPortal } from "../ModalPortal";
import { showToast } from "../Toast";
import { getFrontendApiBaseUrl } from "../apiBase";

const API = getFrontendApiBaseUrl();
const CSRF_COOKIE_NAME = "csrf-token";
const VISIBLE_OPTION_COUNT = 5;
const MAX_REFERENCE_IMAGES = 5;
/** Display fee — authoritative amount is enforced server-side. */
const CUSTOM_THEME_FEE_PHP = 200;

const THEME_STYLE_OPTIONS = [
  { id: "minimal", label: "Minimal / clean" },
  { id: "luxury", label: "Luxury / premium" },
  { id: "bold", label: "Bold / high-impact" },
  { id: "editorial", label: "Editorial / magazine" },
  { id: "corporate", label: "Corporate / professional" },
  { id: "playful", label: "Playful / friendly" },
  { id: "tech", label: "Tech / futuristic" },
  { id: "organic", label: "Organic / natural" },
  { id: "brutalist", label: "Brutalist / raw" },
  { id: "glass", label: "Glass / soft blur" },
  { id: "retro", label: "Retro / vintage" },
  { id: "soft-pastel", label: "Soft pastel" },
] as const;

const HEADING_DEFAULT = "Modern sans (clean, geometric)";
const BODY_DEFAULT = "Highly readable sans";

type Props = {
  open: boolean;
  onClose: () => void;
};

type ReferenceImage = {
  url: string;
  name: string;
};

type FieldKey =
  | "projectName"
  | "themeStyles"
  | "mood"
  | "moreDetails"
  | "referenceImages"
  | "primaryColor"
  | "inspirationUrls";

type FieldErrors = Partial<Record<FieldKey, string>>;

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
    if (!response.ok) return readCookie(CSRF_COOKIE_NAME);
    const payload = (await response.json()) as Record<string, unknown>;
    const data =
      payload.data && typeof payload.data === "object"
        ? (payload.data as Record<string, unknown>)
        : null;
    const token =
      (typeof payload.csrfToken === "string" && payload.csrfToken) ||
      (typeof payload.csrf_token === "string" && payload.csrf_token) ||
      (typeof data?.csrfToken === "string" && data.csrfToken) ||
      (typeof data?.token === "string" && data.token) ||
      null;
    return token?.trim() || readCookie(CSRF_COOKIE_NAME);
  } catch {
    return readCookie(CSRF_COOKIE_NAME);
  }
}

function normalizeHex(value: string): string | null {
  const trimmed = value.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
    if (trimmed.length === 4) {
      const r = trimmed[1];
      const g = trimmed[2];
      const b = trimmed[3];
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return trimmed.toLowerCase();
  }
  return null;
}

function toggleValue(list: string[], value: string, max: number): string[] {
  if (list.includes(value)) return list.filter((item) => item !== value);
  if (list.length >= max) return list;
  return [...list, value];
}

function extractUploadUrl(payload: Record<string, unknown> | null): string {
  if (!payload) return "";
  if (typeof payload.url === "string" && payload.url.trim()) {
    return payload.url.trim();
  }
  const data =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : null;
  if (data && typeof data.url === "string" && data.url.trim()) {
    return data.url.trim();
  }
  if (typeof payload.publicUrl === "string" && payload.publicUrl.trim()) {
    return payload.publicUrl.trim();
  }
  return "";
}

function validateForm(values: {
  projectName: string;
  themeStyles: string[];
  mood: string;
  moreDetails: string;
  referenceImages: ReferenceImage[];
  primaryColor: string;
  inspirationUrls: string;
}): FieldErrors {
  const errors: FieldErrors = {};
  const project = values.projectName.trim();
  if (!project) errors.projectName = "Project name is required.";
  else if (project.length < 2) errors.projectName = "Enter at least 2 characters.";
  else if (project.length > 120) errors.projectName = "Keep under 120 characters.";

  if (values.themeStyles.length < 1) {
    errors.themeStyles = "Select at least one style.";
  } else if (values.themeStyles.length > 4) {
    errors.themeStyles = "Select up to 4 styles.";
  }

  if (!["light", "dark", "either", "high-contrast"].includes(values.mood)) {
    errors.mood = "Choose a mood.";
  }

  const brief = values.moreDetails.trim();
  if (!brief) errors.moreDetails = "A short brief is required.";
  else if (brief.length < 20) {
    errors.moreDetails = `Add at least 20 characters (${brief.length}/20).`;
  } else if (brief.length > 4000) {
    errors.moreDetails = "Keep the brief under 4000 characters.";
  }

  if (values.referenceImages.length > MAX_REFERENCE_IMAGES) {
    errors.referenceImages = `Up to ${MAX_REFERENCE_IMAGES} images only.`;
  }

  const color = values.primaryColor.trim();
  if (color) {
    if (color.startsWith("#") && !normalizeHex(color)) {
      errors.primaryColor = "Use a valid hex color like #1e3a8a.";
    } else if (color.length > 40) {
      errors.primaryColor = "Color value is too long.";
    }
  }

  const links = values.inspirationUrls.trim();
  if (links) {
    if (links.length > 1000) {
      errors.inspirationUrls = "Inspiration links are too long.";
    } else {
      for (const part of links.split(/[\n,]+/).map((p) => p.trim()).filter(Boolean)) {
        try {
          const withProtocol = /^https?:\/\//i.test(part) ? part : `https://${part}`;
          const parsed = new URL(withProtocol);
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            errors.inspirationUrls = `"${part}" must be an http(s) link.`;
            break;
          }
        } catch {
          errors.inspirationUrls = `"${part}" is not a valid URL.`;
          break;
        }
      }
    }
  }

  return errors;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1 text-xs font-medium text-red-600" role="alert">
      {message}
    </p>
  );
}

function inputClass(hasError: boolean): string {
  return `mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm outline-none ${
    hasError
      ? "border-red-400 focus:border-red-500"
      : "border-slate-200 focus:border-slate-400"
  }`;
}

function OptionalBlock({
  title,
  children,
  forceOpen = false,
}: {
  title: string;
  children: ReactNode;
  forceOpen?: boolean;
}) {
  return (
    <details
      className="group rounded-xl border border-slate-200"
      open={forceOpen ? true : undefined}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium text-slate-700">
        {title}
        <ChevronDown className="h-4 w-4 text-slate-400 transition group-open:rotate-180" />
      </summary>
      <div className="space-y-3 border-t border-slate-100 px-3 py-3">{children}</div>
    </details>
  );
}

export default function RequestCustomThemeModal({ open, onClose }: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const formScrollRef = useRef<HTMLFormElement | null>(null);

  const [projectName, setProjectName] = useState("");
  const [themeStyles, setThemeStyles] = useState<string[]>([]);
  const [mood, setMood] = useState<"light" | "dark" | "either" | "high-contrast">(
    "either",
  );
  const [moreDetails, setMoreDetails] = useState("");
  const [primaryColor, setPrimaryColor] = useState("");
  const [inspirationUrls, setInspirationUrls] = useState("");
  const [avoidList, setAvoidList] = useState("");
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [stylesExpanded, setStylesExpanded] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const formValues = useMemo(
    () => ({
      projectName,
      themeStyles,
      mood,
      moreDetails,
      referenceImages,
      primaryColor,
      inspirationUrls,
    }),
    [
      projectName,
      themeStyles,
      mood,
      moreDetails,
      referenceImages,
      primaryColor,
      inspirationUrls,
    ],
  );

  const fieldErrors = useMemo(() => validateForm(formValues), [formValues]);
  const canSubmit = Object.keys(fieldErrors).length === 0;

  useEffect(() => {
    if (submitAttempted && canSubmit) setError(null);
  }, [submitAttempted, canSubmit]);

  const showError = (field: FieldKey) =>
    submitAttempted || touched[field] ? fieldErrors[field] : undefined;

  const markTouched = (field: FieldKey) => {
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
  };

  const resetForm = () => {
    setProjectName("");
    setThemeStyles([]);
    setMood("either");
    setMoreDetails("");
    setPrimaryColor("");
    setInspirationUrls("");
    setAvoidList("");
    setReferenceImages([]);
    setStylesExpanded(false);
    setError(null);
    setTouched({});
    setSubmitAttempted(false);
  };

  const handleClose = () => {
    if (busy || uploadingImages) return;
    onClose();
  };

  const uploadReferenceFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const remaining = MAX_REFERENCE_IMAGES - referenceImages.length;
    if (remaining <= 0) {
      showToast(`You can upload up to ${MAX_REFERENCE_IMAGES} images.`, "error");
      return;
    }

    const selected = Array.from(files).slice(0, remaining);
    setUploadingImages(true);
    setError(null);
    markTouched("referenceImages");

    try {
      const csrf = await ensureCsrfToken();
      const uploaded: ReferenceImage[] = [];

      for (const file of selected) {
        if (!file.type.startsWith("image/")) {
          throw new Error("Only image files are allowed.");
        }
        if (file.size > 8 * 1024 * 1024) {
          throw new Error("Each image must be 8MB or smaller.");
        }

        const formData = new FormData();
        formData.append("file", file);
        // R2 upload context — inquiry folder is supported by /api/media/upload
        formData.append("context", "inquiry");

        const headers = new Headers();
        if (csrf) headers.set("X-CSRF-Token", csrf);

        const response = await fetch(`${API}/api/media/upload`, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers,
          body: formData,
        });

        const payload = (await response.json().catch(() => null)) as Record<
          string,
          unknown
        > | null;

        if (!response.ok && response.status !== 207) {
          throw new Error(
            typeof payload?.error === "string"
              ? payload.error
              : "Failed to upload image to storage.",
          );
        }

        const url = extractUploadUrl(payload);
        if (!url) {
          throw new Error("Upload finished but no image URL was returned.");
        }
        if (!/^https?:\/\//i.test(url)) {
          throw new Error("Upload returned an invalid image URL.");
        }

        uploaded.push({ url, name: file.name });
      }

      setReferenceImages((prev) => [...prev, ...uploaded]);
      if (uploaded.length > 0) {
        showToast(
          uploaded.length === 1
            ? "Reference image uploaded."
            : `${uploaded.length} reference images uploaded.`,
          "success",
        );
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to upload reference images.";
      setError(message);
      showToast(message, "error");
    } finally {
      setUploadingImages(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitAttempted(true);
    const errors = validateForm(formValues);
    if (Object.keys(errors).length > 0) {
      const first = Object.values(errors)[0] ?? "Please fix the highlighted fields.";
      setError(first);
      showToast(first, "error");
      const firstKey = Object.keys(errors)[0];
      const el = formScrollRef.current?.querySelector(`[data-field="${firstKey}"]`);
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const csrf = await ensureCsrfToken();
      const headers = new Headers({ "Content-Type": "application/json" });
      if (csrf) headers.set("X-CSRF-Token", csrf);

      const response = await fetch(`${API}/api/marketplace/custom-theme-request`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers,
        body: JSON.stringify({
          projectName: projectName.trim(),
          industry: null,
          useCase: null,
          targetAudience: null,
          primaryGoals: [],
          themeStyles,
          mood,
          colorWay: {
            primary: primaryColor.trim() || null,
            secondary: null,
            accent: null,
            background: null,
            notes: null,
          },
          typography: {
            headingStyle: HEADING_DEFAULT,
            bodyStyle: BODY_DEFAULT,
            tone: null,
            preferredFonts: null,
            notes: null,
          },
          layoutPreferences: [],
          mustHaveSections: [],
          brandPersonality: [],
          languages: null,
          brandAssets: null,
          deliverableScope: "Discuss with OnTap",
          inspirationUrls: inspirationUrls.trim() || null,
          referenceImageUrls: referenceImages.map((image) => image.url),
          avoidList: avoidList.trim() || null,
          competitorNotes: null,
          moreDetails: moreDetails.trim(),
          contactPreference: "either",
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : "Unable to submit your custom theme request.",
        );
      }

      const data = payload?.data ?? null;
      const orderObj = data?.order ?? null;
      const invoiceUrl = String(
        (typeof data?.invoiceUrl === "string" && data.invoiceUrl) ||
          (typeof data?.invoice_url === "string" && data.invoice_url) ||
          (typeof orderObj?.invoiceUrl === "string" && orderObj.invoiceUrl) ||
          (typeof orderObj?.invoice_url === "string" && orderObj.invoice_url) ||
          "",
      ).trim();
      const requiresPayment = data?.requiresPayment !== false;

      if (requiresPayment && !invoiceUrl) {
        throw new Error(
          "Payment invoice was created but no Xendit checkout URL was returned. Please try again.",
        );
      }

      if (invoiceUrl) {
        // Navigate first — closing the modal / toast must not cancel the redirect.
        window.location.assign(invoiceUrl);
        return;
      }

      showToast(
        payload.message ||
          "Custom theme request submitted. Our design team will follow up.",
        "success",
      );
      resetForm();
      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to submit theme request.";
      setError(message);
      showToast(message, "error");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const visibleStyles = stylesExpanded
    ? THEME_STYLE_OPTIONS
    : THEME_STYLE_OPTIONS.slice(0, VISIBLE_OPTION_COUNT);
  const hiddenStyleCount = Math.max(
    0,
    THEME_STYLE_OPTIONS.length - VISIBLE_OPTION_COUNT,
  );

  return (
    <ModalPortal isOpen onClose={handleClose}>
      <div
        className="relative flex w-[min(100vw-1.25rem,28rem)] max-h-[90vh] flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label="Request a custom theme"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">
              Request custom theme
            </h2>
            <p className="text-xs text-slate-500">
              ₱{CUSTOM_THEME_FEE_PHP} design fee · pay first, then our team
              reviews your brief.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={busy || uploadingImages}
            aria-label="Close"
            className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          ref={formScrollRef}
          onSubmit={(event) => void handleSubmit(event)}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4"
          noValidate
        >
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div data-field="projectName">
            <label className="text-xs font-medium text-slate-600">
              Project or brand name *
            </label>
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onBlur={() => markTouched("projectName")}
              placeholder="e.g. Acme Studio"
              aria-invalid={Boolean(showError("projectName"))}
              className={inputClass(Boolean(showError("projectName")))}
            />
            <FieldError message={showError("projectName")} />
          </div>

          <div data-field="themeStyles">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-slate-600">
                Visual direction *
              </label>
              <span className="text-[11px] text-slate-400">
                {themeStyles.length}/4
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {visibleStyles.map((option) => {
                const active = themeStyles.includes(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      markTouched("themeStyles");
                      setThemeStyles((prev) => toggleValue(prev, option.id, 4));
                    }}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      active
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    {active ? (
                      <span className="inline-flex items-center gap-1">
                        <Check className="h-3 w-3" />
                        {option.label}
                      </span>
                    ) : (
                      option.label
                    )}
                  </button>
                );
              })}
            </div>
            {hiddenStyleCount > 0 ? (
              <button
                type="button"
                onClick={() => setStylesExpanded((prev) => !prev)}
                className="mt-2 text-xs font-medium text-slate-500 hover:text-slate-800"
              >
                {stylesExpanded ? "Show less" : `Show more (+${hiddenStyleCount})`}
              </button>
            ) : null}
            <FieldError message={showError("themeStyles")} />
          </div>

          <div data-field="mood">
            <label className="text-xs font-medium text-slate-600">Mood *</label>
            <select
              value={mood}
              onChange={(e) => {
                markTouched("mood");
                setMood(e.target.value as typeof mood);
              }}
              onBlur={() => markTouched("mood")}
              aria-invalid={Boolean(showError("mood"))}
              className={inputClass(Boolean(showError("mood")))}
            >
              <option value="either">Open to either</option>
              <option value="light">Light / airy</option>
              <option value="dark">Dark / dramatic</option>
              <option value="high-contrast">High contrast</option>
            </select>
            <FieldError message={showError("mood")} />
          </div>

          <div data-field="moreDetails">
            <label className="text-xs font-medium text-slate-600">
              Creative brief *
            </label>
            <textarea
              value={moreDetails}
              onChange={(e) => setMoreDetails(e.target.value)}
              onBlur={() => markTouched("moreDetails")}
              rows={5}
              placeholder="Describe the feeling, hero idea, brand rules, and what success looks like."
              aria-invalid={Boolean(showError("moreDetails"))}
              className={inputClass(Boolean(showError("moreDetails")))}
            />
            <div className="mt-1 flex items-start justify-between gap-2">
              <FieldError message={showError("moreDetails")} />
              <p className="ml-auto text-[11px] text-slate-400">
                {moreDetails.trim().length}/4000 · min 20
              </p>
            </div>
          </div>

          <OptionalBlock
            title="Optional details"
            forceOpen={Boolean(
              showError("primaryColor") ||
                showError("inspirationUrls") ||
                showError("referenceImages"),
            )}
          >
            <div data-field="primaryColor">
              <label className="text-xs font-medium text-slate-600">
                Primary color
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <span
                  className="h-9 w-9 shrink-0 rounded-lg border border-slate-200"
                  style={{
                    backgroundColor: normalizeHex(primaryColor) || "#e2e8f0",
                  }}
                />
                <input
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  onBlur={() => markTouched("primaryColor")}
                  placeholder="#1e3a8a"
                  aria-invalid={Boolean(showError("primaryColor"))}
                  className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ${
                    showError("primaryColor")
                      ? "border-red-400"
                      : "border-slate-200"
                  }`}
                />
              </div>
              <FieldError message={showError("primaryColor")} />
            </div>

            <div data-field="inspirationUrls">
              <label className="text-xs font-medium text-slate-600">
                Inspiration links
              </label>
              <textarea
                value={inspirationUrls}
                onChange={(e) => setInspirationUrls(e.target.value)}
                onBlur={() => markTouched("inspirationUrls")}
                rows={2}
                placeholder="One URL per line"
                aria-invalid={Boolean(showError("inspirationUrls"))}
                className={inputClass(Boolean(showError("inspirationUrls")))}
              />
              <FieldError message={showError("inspirationUrls")} />
            </div>

            <div>
              <label className="text-xs font-medium text-slate-600">
                Please avoid
              </label>
              <textarea
                value={avoidList}
                onChange={(e) => setAvoidList(e.target.value)}
                rows={2}
                placeholder="Anything we should not use"
                className={inputClass(false)}
              />
            </div>

            <div data-field="referenceImages" className="space-y-2">
              <div className="flex items-center gap-2">
                <ImagePlus className="h-3.5 w-3.5 text-slate-500" />
                <label className="text-xs font-medium text-slate-600">
                  Reference images (optional)
                </label>
              </div>
              <p className="text-[11px] text-slate-400">
                Upload screenshots or moodboards if you have them. Stored on R2.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => void uploadReferenceFiles(e.target.files)}
              />
              <button
                type="button"
                disabled={
                  uploadingImages ||
                  referenceImages.length >= MAX_REFERENCE_IMAGES
                }
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                {uploadingImages ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {uploadingImages
                  ? "Uploading…"
                  : `Add images (${referenceImages.length}/${MAX_REFERENCE_IMAGES})`}
              </button>
              <FieldError message={showError("referenceImages")} />
              {referenceImages.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {referenceImages.map((image) => (
                    <div
                      key={image.url}
                      className="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={image.url}
                        alt={image.name}
                        className="h-20 w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setReferenceImages((prev) =>
                            prev.filter((item) => item.url !== image.url),
                          )
                        }
                        className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100"
                        aria-label={`Remove ${image.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </OptionalBlock>
        </form>
        <div className="flex shrink-0 flex-col gap-2 border-t border-slate-100 px-4 py-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-slate-600">
                Custom theme request fee
              </p>
              <p className="text-sm font-semibold text-slate-900">
                ₱{CUSTOM_THEME_FEE_PHP}
              </p>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-slate-500">
              You’ll pay securely via Xendit. Your brief is forwarded to
              developers only after payment succeeds.
            </p>
          </div>
          {submitAttempted && !canSubmit ? (
            <p className="text-xs font-medium text-red-600">
              {Object.keys(fieldErrors).length === 1
                ? "1 field needs attention."
                : `${Object.keys(fieldErrors).length} fields need attention.`}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || uploadingImages}
              onClick={handleClose}
              className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || uploadingImages}
              onClick={() => formScrollRef.current?.requestSubmit()}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {busy ? "Preparing payment…" : `Pay ₱${CUSTOM_THEME_FEE_PHP} & continue`}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
