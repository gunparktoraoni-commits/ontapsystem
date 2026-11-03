/**
 * Service Media Validation Module
 * Comprehensive validation, sanitization, and metadata extraction for service media
 * Handles both images and videos with strict size, duration, and format constraints
 */

// ─────────────────────────────────────────────────────────────────────
// CONSTANTS & CONFIGURATION
// ─────────────────────────────────────────────────────────────────────

export const MEDIA_LIMITS = {
  // Image limits
  IMAGE_MAX_SIZE_MB: 10,
  IMAGE_MAX_SIZE_BYTES: 10 * 1024 * 1024,
  IMAGE_MAX_WIDTH: 4000,
  IMAGE_MAX_HEIGHT: 4000,
  
  // Video limits
  VIDEO_MAX_SIZE_MB: 50,
  VIDEO_MAX_SIZE_BYTES: 50 * 1024 * 1024,
  VIDEO_MAX_DURATION_SECONDS: 15,
  VIDEO_MIN_DURATION_SECONDS: 0.5,
  
  // General limits
  TOTAL_MEDIA_PER_SERVICE: 5,
  MAX_FILES_PER_UPLOAD: 5,
};

// Supported MIME types
export const SUPPORTED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export const SUPPORTED_VIDEO_MIMES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime', // .mov
]);

// File extension mapping
const MIME_TO_EXTENSIONS: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/jpg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'video/mp4': ['.mp4'],
  'video/webm': ['.webm'],
  'video/quicktime': ['.mov'],
};

// ─────────────────────────────────────────────────────────────────────
// ERROR TYPES & HANDLING
// ─────────────────────────────────────────────────────────────────────

export enum MediaValidationErrorCode {
  UNSUPPORTED_FORMAT = 'UNSUPPORTED_FORMAT',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  VIDEO_TOO_LONG = 'VIDEO_TOO_LONG',
  VIDEO_TOO_SHORT = 'VIDEO_TOO_SHORT',
  INVALID_VIDEO_METADATA = 'INVALID_VIDEO_METADATA',
  INVALID_IMAGE_METADATA = 'INVALID_IMAGE_METADATA',
  INVALID_FILE = 'INVALID_FILE',
  MIME_TYPE_MISMATCH = 'MIME_TYPE_MISMATCH',
  IMAGE_DIMENSIONS_INVALID = 'IMAGE_DIMENSIONS_INVALID',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export interface MediaValidationError {
  code: MediaValidationErrorCode;
  message: string;
  fileName: string;
  tag: string;
}

export interface MediaValidationResult {
  valid: boolean;
  error?: MediaValidationError;
  metadata?: MediaMetadata;
}

export interface MediaMetadata {
  type: 'image' | 'video';
  mimeType: string;
  fileSize: number;
  fileSizeFormatted: string;
  duration?: number; // in seconds, for videos
  width?: number; // for images and videos
  height?: number; // for images and videos
  fileName: string;
}

// ─────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────

/**
 * Format bytes to human-readable size
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Format duration to human-readable time
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'Unknown';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins > 0) return `${mins}:${secs.toString().padStart(2, '0')}`;
  return `${secs}s`;
}

/**
 * Determine if MIME type is for an image
 */
export function isImageMime(mimeType: string | null): boolean {
  if (!mimeType) return false;
  return SUPPORTED_IMAGE_MIMES.has(mimeType.toLowerCase());
}

/**
 * Determine if MIME type is for a video
 */
export function isVideoMime(mimeType: string | null): boolean {
  if (!mimeType) return false;
  return SUPPORTED_VIDEO_MIMES.has(mimeType.toLowerCase());
}

/**
 * Detect media type from MIME type and file extension
 */
export function detectMediaType(
  mimeType: string | null,
  fileName: string,
): 'image' | 'video' | null {
  if (isImageMime(mimeType)) return 'image';
  if (isVideoMime(mimeType)) return 'video';

  // Fallback: check extension
  const ext = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
  for (const [mime, exts] of Object.entries(MIME_TO_EXTENSIONS)) {
    if (exts.includes(ext)) {
      return isImageMime(mime) ? 'image' : 'video';
    }
  }

  return null;
}

/**
 * Extract video duration and dimensions from blob
 */
export function getVideoMetadata(
  file: File,
): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.remove();
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Video metadata read timeout'));
    }, 10000);

    video.onloadedmetadata = () => {
      clearTimeout(timeout);
      cleanup();
      resolve({
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      });
    };

    video.onerror = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error('Failed to load video metadata'));
    };

    video.src = url;
  });
}

/**
 * Extract image dimensions from blob
 */
export function getImageMetadata(
  file: File,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = document.createElement('img');

    const cleanup = () => {
      URL.revokeObjectURL(url);
      img.remove();
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Image metadata read timeout'));
    }, 5000);

    img.onload = () => {
      clearTimeout(timeout);
      cleanup();
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    };

    img.onerror = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}

// ─────────────────────────────────────────────────────────────────────
// VALIDATION FUNCTIONS
// ─────────────────────────────────────────────────────────────────────

/**
 * Comprehensive validation for image files
 */
export async function validateImageFile(
  file: File,
): Promise<MediaValidationResult> {
  const tag = '[SERVICE_MEDIA_IMAGE_VALIDATION]';

  try {
    // Check file size
    if (file.size > MEDIA_LIMITS.IMAGE_MAX_SIZE_BYTES) {
      return {
        valid: false,
        error: {
          code: MediaValidationErrorCode.FILE_TOO_LARGE,
          message: `Image exceeds ${MEDIA_LIMITS.IMAGE_MAX_SIZE_MB}MB limit (${formatFileSize(file.size)})`,
          fileName: file.name,
          tag,
        },
      };
    }

    // Check MIME type
    const mimeType = file.type.toLowerCase();
    if (!SUPPORTED_IMAGE_MIMES.has(mimeType)) {
      return {
        valid: false,
        error: {
          code: MediaValidationErrorCode.UNSUPPORTED_FORMAT,
          message: `Unsupported image format: ${mimeType || 'unknown'}. Supported: JPEG, PNG, WebP, GIF`,
          fileName: file.name,
          tag,
        },
      };
    }

    // Extract image dimensions
    let width = 0,
      height = 0;
    try {
      const dims = await getImageMetadata(file);
      width = dims.width;
      height = dims.height;
    } catch (err) {
      return {
        valid: false,
        error: {
          code: MediaValidationErrorCode.INVALID_IMAGE_METADATA,
          message: `Failed to read image: ${err instanceof Error ? err.message : 'Unknown error'}`,
          fileName: file.name,
          tag,
        },
      };
    }

    // Check dimensions
    if (width > MEDIA_LIMITS.IMAGE_MAX_WIDTH || height > MEDIA_LIMITS.IMAGE_MAX_HEIGHT) {
      return {
        valid: false,
        error: {
          code: MediaValidationErrorCode.IMAGE_DIMENSIONS_INVALID,
          message: `Image dimensions (${width}x${height}) exceed limits (max ${MEDIA_LIMITS.IMAGE_MAX_WIDTH}x${MEDIA_LIMITS.IMAGE_MAX_HEIGHT})`,
          fileName: file.name,
          tag,
        },
      };
    }

    return {
      valid: true,
      metadata: {
        type: 'image',
        mimeType,
        fileSize: file.size,
        fileSizeFormatted: formatFileSize(file.size),
        width,
        height,
        fileName: file.name,
      },
    };
  } catch (err) {
    return {
      valid: false,
      error: {
        code: MediaValidationErrorCode.UNKNOWN_ERROR,
        message: `Unexpected error validating image: ${err instanceof Error ? err.message : 'Unknown'}`,
        fileName: file.name,
        tag,
      },
    };
  }
}

/**
 * Comprehensive validation for video files
 */
export async function validateVideoFile(
  file: File,
): Promise<MediaValidationResult> {
  const tag = '[SERVICE_MEDIA_VIDEO_VALIDATION]';

  try {
    // Check file size
    if (file.size > MEDIA_LIMITS.VIDEO_MAX_SIZE_BYTES) {
      return {
        valid: false,
        error: {
          code: MediaValidationErrorCode.FILE_TOO_LARGE,
          message: `Video exceeds ${MEDIA_LIMITS.VIDEO_MAX_SIZE_MB}MB limit (${formatFileSize(file.size)})`,
          fileName: file.name,
          tag,
        },
      };
    }

    // Check MIME type
    const mimeType = file.type.toLowerCase();
    if (!SUPPORTED_VIDEO_MIMES.has(mimeType)) {
      return {
        valid: false,
        error: {
          code: MediaValidationErrorCode.UNSUPPORTED_FORMAT,
          message: `Unsupported video format: ${mimeType || 'unknown'}. Supported: MP4, WebM, MOV`,
          fileName: file.name,
          tag,
        },
      };
    }

    // Extract video metadata
    let duration = 0,
      width = 0,
      height = 0;
    try {
      const metadata = await getVideoMetadata(file);
      duration = metadata.duration;
      width = metadata.width;
      height = metadata.height;
    } catch (err) {
      return {
        valid: false,
        error: {
          code: MediaValidationErrorCode.INVALID_VIDEO_METADATA,
          message: `Failed to read video metadata: ${err instanceof Error ? err.message : 'Unknown error'}`,
          fileName: file.name,
          tag,
        },
      };
    }

    // Check duration constraints
    if (duration < MEDIA_LIMITS.VIDEO_MIN_DURATION_SECONDS) {
      return {
        valid: false,
        error: {
          code: MediaValidationErrorCode.VIDEO_TOO_SHORT,
          message: `Video is too short (${formatDuration(duration)}). Minimum: ${formatDuration(MEDIA_LIMITS.VIDEO_MIN_DURATION_SECONDS)}`,
          fileName: file.name,
          tag,
        },
      };
    }

    if (duration > MEDIA_LIMITS.VIDEO_MAX_DURATION_SECONDS) {
      return {
        valid: false,
        error: {
          code: MediaValidationErrorCode.VIDEO_TOO_LONG,
          message: `Video exceeds ${MEDIA_LIMITS.VIDEO_MAX_DURATION_SECONDS}s limit (${formatDuration(duration)})`,
          fileName: file.name,
          tag,
        },
      };
    }

    return {
      valid: true,
      metadata: {
        type: 'video',
        mimeType,
        fileSize: file.size,
        fileSizeFormatted: formatFileSize(file.size),
        duration,
        width,
        height,
        fileName: file.name,
      },
    };
  } catch (err) {
    return {
      valid: false,
      error: {
        code: MediaValidationErrorCode.UNKNOWN_ERROR,
        message: `Unexpected error validating video: ${err instanceof Error ? err.message : 'Unknown'}`,
        fileName: file.name,
        tag,
      },
    };
  }
}

/**
 * Unified media file validation
 */
export async function validateMediaFile(
  file: File,
): Promise<MediaValidationResult> {
  const tag = '[SERVICE_MEDIA_VALIDATION]';

  try {
    // Validate file object
    if (!file || !(file instanceof File)) {
      return {
        valid: false,
        error: {
          code: MediaValidationErrorCode.INVALID_FILE,
          message: 'Invalid file object',
          fileName: (file as any)?.name || 'unknown',
          tag,
        },
      };
    }

    // Detect media type
    const mediaType = detectMediaType(file.type, file.name);
    if (!mediaType) {
      return {
        valid: false,
        error: {
          code: MediaValidationErrorCode.UNSUPPORTED_FORMAT,
          message: `Could not determine file type. File: ${file.name}, MIME: ${file.type || 'unknown'}`,
          fileName: file.name,
          tag,
        },
      };
    }

    // Validate based on type
    if (mediaType === 'image') {
      return validateImageFile(file);
    } else {
      return validateVideoFile(file);
    }
  } catch (err) {
    return {
      valid: false,
      error: {
        code: MediaValidationErrorCode.UNKNOWN_ERROR,
        message: `Validation error: ${err instanceof Error ? err.message : 'Unknown'}`,
        fileName: file?.name || 'unknown',
        tag,
      },
    };
  }
}

/**
 * Batch validate multiple media files
 */
export async function validateMediaFiles(
  files: File[],
): Promise<{
  valid: MediaValidationResult[];
  invalid: MediaValidationError[];
}> {
  const results = await Promise.all(files.map(validateMediaFile));

  return {
    valid: results.filter((r) => r.valid),
    invalid: results.filter((r) => !r.valid).map((r) => r.error!),
  };
}

/**
 * Generate human-readable error message for UI display
 */
export function getErrorMessage(error: MediaValidationError): string {
  return `${error.fileName}: ${error.message}`;
}

/**
 * Generate detailed error report for debugging
 */
export function getDetailedErrorReport(error: MediaValidationError): string {
  return `${error.tag} ${error.code}: ${error.message} (File: ${error.fileName})`;
}
