// ──────────────────────────────────────────────────────────────
// Shared client helper for uploading a company profile image / logo
// to Cloudflare R2 via POST /api/media/upload (context: "logo").
//
// Kept framework-agnostic so both the company-admin settings panel and
// the superadmin "Add Company" modal can reuse the same validation and
// upload path. Callers supply the resolved API base URL and any auth /
// CSRF headers appropriate for their surface.
// ──────────────────────────────────────────────────────────────

export const COMPANY_LOGO_ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

/** Max company logo size (5 MB) — kept well under the API image cap. */
export const COMPANY_LOGO_MAX_BYTES = 5 * 1024 * 1024;

export function isAllowedCompanyLogoFile(file: File): boolean {
  const mimeType = file.type.toLowerCase();
  if (COMPANY_LOGO_ALLOWED_MIME_TYPES.has(mimeType)) return true;
  const fileName = file.name.toLowerCase();
  return (
    fileName.endsWith(".png") ||
    fileName.endsWith(".jpg") ||
    fileName.endsWith(".jpeg") ||
    fileName.endsWith(".webp") ||
    fileName.endsWith(".svg")
  );
}

/** Returns an error message when the file is not a valid company logo, else null. */
export function validateCompanyLogoFile(file: File): string | null {
  if (!isAllowedCompanyLogoFile(file)) {
    return "Logo must be a PNG, JPG, WEBP, or SVG image.";
  }
  if (file.size > COMPANY_LOGO_MAX_BYTES) {
    return "Logo image must be 5 MB or smaller.";
  }
  return null;
}

function extractUploadError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const obj = payload as { error?: unknown; details?: unknown; message?: unknown };
  if (typeof obj.error === "string" && obj.error.trim()) return obj.error;
  if (typeof obj.message === "string" && obj.message.trim()) return obj.message;
  return fallback;
}

export type CompanyLogoUploadOptions = {
  /** Fully-qualified API base URL (e.g. from getFrontendApiBaseUrl()). */
  apiBaseUrl?: string;
  /** Auth / CSRF headers appropriate for the caller's surface. */
  headers?: HeadersInit;
};

/**
 * Uploads a company logo to R2 and returns the servable public URL.
 * Throws with a user-friendly message on failure.
 */
export async function uploadCompanyLogoImage(
  file: File,
  options: CompanyLogoUploadOptions = {},
): Promise<string> {
  const validationError = validateCompanyLogoFile(file);
  if (validationError) {
    throw new Error(validationError);
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("context", "logo");

  const base = (options.apiBaseUrl ?? "").replace(/\/+$/, "");
  const response = await fetch(`${base}/api/media/upload`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: options.headers,
    body: formData,
  });

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new Error(extractUploadError(payload, "Failed to upload company logo."));
  }

  const uploadedUrl = typeof payload?.url === "string" ? payload.url.trim() : "";
  if (!uploadedUrl) {
    throw new Error("Upload completed but no logo URL was returned.");
  }
  return uploadedUrl;
}
