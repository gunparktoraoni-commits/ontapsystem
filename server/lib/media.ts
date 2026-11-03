// ──────────────────────────────────────────────────────────────
// Media Validation — URL & Size Constraints
// ──────────────────────────────────────────────────────────────
// This system stores media URLs (not binary blobs). Files must be
// pre-uploaded to a CDN (Cloudinary, S3, etc.) by the frontend,
// then the resulting URL is passed to the API.
//
// Size enforcement applies at two layers:
//   1. URL validation (this module) — rejects obviously wrong URLs
//   2. Binary upload endpoints — enforce byte-size limits before
//      writing to CDN and returning a URL to store here
//
// Limits (per product spec):
//   Images  — 10 MB  (10_485_760 bytes)
//   Videos  — 50 MB  (52_428_800 bytes)
// ──────────────────────────────────────────────────────────────

export const MEDIA_LIMITS = {
  IMAGE_MAX_BYTES: 10 * 1024 * 1024,   // 10 MB
  VIDEO_MAX_BYTES: 50 * 1024 * 1024,   // 50 MB
  IMAGE_MAX_MB: 10,
  VIDEO_MAX_MB: 50,
} as const;

/** Bizcard service / gallery video uploads (tighter than global video cap). */
export const SERVICE_VIDEO_MAX_BYTES = 30 * 1024 * 1024;
export const SERVICE_VIDEO_MAX_MB = 30;

/** Allow smaller cover video clips to be uploaded via the server proxy. */
export const COVER_VIDEO_MAX_BYTES = 15 * 1024 * 1024; // 15 MB
export const COVER_VIDEO_MAX_MB = 15;

// Allowed image MIME types for upload validation
// Spec: jpg, jpeg, png, webp, gif — SVG excluded (scripting risk).
// GIF is allowed so animated cover / messaging assets keep their animation.
export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

// Allowed video MIME types for upload validation
// Spec: mp4, mov, webm only — OGG excluded (low adoption)
// video/quicktime covers .mov files reported by macOS/iOS
export const ALLOWED_VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime", // .mov
  "video/webm",
]);

export type MediaValidationResult =
  | { valid: true }
  | { valid: false; error: string; code: "FILE_TOO_LARGE" | "INVALID_TYPE" | "INVALID_URL" };

/**
 * Validate a media URL before storing it.
 *
 * Checks:
 *   1. Must start with https:// (http:// rejected — insecure mixed content)
 *   2. Must not exceed 512 characters (VarChar DB column limit)
 *   3. Must not contain path traversal sequences
 *
 * Does NOT make an HTTP request to verify the URL resolves — that
 * would be SSRF-risky and slow. URL format validation is sufficient
 * for stored CDN URLs.
 *
 * @param url - The CDN URL to validate
 * @param fieldName - Human-readable name for error messages (e.g. "Profile image URL")
 */
export function validateMediaUrl(
  url: string,
  fieldName = "Media URL"
): MediaValidationResult {
  if (!url || typeof url !== "string") {
    return { valid: false, error: `${fieldName} is required.`, code: "INVALID_URL" };
  }

  const trimmed = url.trim();

  // Require HTTPS — HTTP would trigger mixed-content warnings in browsers
  if (!/^https:\/\/.{5,}/i.test(trimmed)) {
    return {
      valid: false,
      error: `${fieldName} must start with https://.`,
      code: "INVALID_URL",
    };
  }

  if (trimmed.length > 512) {
    return {
      valid: false,
      error: `${fieldName} must not exceed 512 characters.`,
      code: "INVALID_URL",
    };
  }

  // Prevent path traversal sequences in URLs
  if (/\.\.[\\/]/.test(trimmed)) {
    return {
      valid: false,
      error: `${fieldName} contains invalid characters.`,
      code: "INVALID_URL",
    };
  }

  return { valid: true };
}

/**
 * Validate an uploaded file's MIME type and byte size.
 *
 * Use this in upload endpoints BEFORE writing to CDN.
 * If rejected, return the error to the client so they can:
 *   a) Compress the file, or
 *   b) Host it externally and provide a CDN URL instead
 *
 * @param mimeType  - The file's MIME type (from Content-Type or multipart header)
 * @param sizeBytes - The file's size in bytes
 * @param kind      - "image" | "video" — determines size limit and type allow-list
 */
export function validateUploadedFile(
  mimeType: string,
  sizeBytes: number,
  kind: "image" | "video",
  options?: { maxBytes?: number },
): MediaValidationResult {
  const allowedTypes =
    kind === "image" ? ALLOWED_IMAGE_MIME_TYPES : ALLOWED_VIDEO_MIME_TYPES;
  const maxBytes =
    options?.maxBytes ??
    (kind === "image" ? MEDIA_LIMITS.IMAGE_MAX_BYTES : MEDIA_LIMITS.VIDEO_MAX_BYTES);
  const maxMb = Math.round(maxBytes / (1024 * 1024));

  const normalizedMime = mimeType.toLowerCase().split(";")[0].trim();

  if (!allowedTypes.has(normalizedMime)) {
    return {
      valid: false,
      error: `Invalid file type "${normalizedMime}". Allowed ${kind} types: ${[...allowedTypes].join(", ")}.`,
      code: "INVALID_TYPE",
    };
  }

  if (sizeBytes > maxBytes) {
    return {
      valid: false,
      error: `Upload rejected: file size ${(sizeBytes / 1024 / 1024).toFixed(1)} MB exceeds the ${maxMb} MB limit for ${kind}s. Please compress the file or provide a hosted URL instead.`,
      code: "FILE_TOO_LARGE",
    };
  }

  return { valid: true };
}
