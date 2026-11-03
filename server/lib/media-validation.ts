// server/lib/media-validation.ts
import { ALLOWED_IMAGE_MIME_TYPES, ALLOWED_VIDEO_MIME_TYPES, validateMediaUrl, validateUploadedFile } from "./media";

export const TITLE_MAX_LENGTH = 255;
export const DESCRIPTION_MAX_LENGTH = 5000;

/**
 * Validate title field
 */
export function validateTitle(title: unknown): { valid: boolean; error?: string; value: string | null } {
  if (title === null || title === undefined) {
    return { valid: true, value: null };
  }
  
  if (typeof title !== "string") {
    return { valid: false, error: "Title must be a string.", value: null };
  }
  
  const trimmed = title.trim();
  
  if (trimmed.length === 0) {
    return { valid: true, value: null };
  }
  
  if (trimmed.length > TITLE_MAX_LENGTH) {
    return { 
      valid: false, 
      error: `Title must not exceed ${TITLE_MAX_LENGTH} characters.`, 
      value: null 
    };
  }
  
  // Prevent HTML/script injection
  const sanitized = trimmed
    .replace(/<script[^>]*>.*?<\/script>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/[&<>]/g, (char) => {
      switch (char) {
        case "&": return "&amp;";
        case "<": return "&lt;";
        case ">": return "&gt;";
        default: return char;
      }
    });
  
  return { valid: true, value: sanitized };
}

/**
 * Validate description field
 */
export function validateDescription(description: unknown): { valid: boolean; error?: string; value: string | null } {
  if (description === null || description === undefined) {
    return { valid: true, value: null };
  }
  
  if (typeof description !== "string") {
    return { valid: false, error: "Description must be a string.", value: null };
  }
  
  const trimmed = description.trim();
  
  if (trimmed.length === 0) {
    return { valid: true, value: null };
  }
  
  if (trimmed.length > DESCRIPTION_MAX_LENGTH) {
    return { 
      valid: false, 
      error: `Description must not exceed ${DESCRIPTION_MAX_LENGTH} characters.`, 
      value: null 
    };
  }
  
  // Strip HTML tags for security
  const sanitized = trimmed
    .replace(/<script[^>]*>.*?<\/script>/gi, "")
    .replace(/<[^>]*>/g, "");
  
  return { valid: true, value: sanitized };
}

/**
 * Generate sanitized filename from bizcard_id and title
 * Format: {bizcardId}_{sanitizedTitle}_{timestamp}.{extension}
 */
export function generateSanitizedFileName(
  bizcardId: string,
  title: string | null,
  originalFileName: string,
  extension: string
): string {
  // Get extension from original file or use provided extension
  const ext = extension.startsWith(".") ? extension : `.${extension}`;
  
  // Get base name without extension
  const baseName = originalFileName.replace(/\.[^/.]+$/, "");
  
  // Sanitize title for filename
  let titlePart = "";
  if (title && title.trim()) {
    titlePart = sanitizeForFilename(title) + "_";
  }
  
  // Generate filename with timestamp
  const timestamp = Date.now();
  return `${bizcardId}_${titlePart}${timestamp}${ext}`;
}

/**
 * Sanitize string for use in filename
 */
function sanitizeForFilename(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 100);
}

export { validateMediaUrl, validateUploadedFile, ALLOWED_IMAGE_MIME_TYPES, ALLOWED_VIDEO_MIME_TYPES };