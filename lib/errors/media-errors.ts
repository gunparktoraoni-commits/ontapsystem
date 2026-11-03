import { ErrorCode } from "@/lib/errors/types";

export enum MediaErrorCode {
  // Media errors (2000-2099)
  MEDIA_NOT_FOUND = "MEDIA_2000",
  MEDIA_UPLOAD_FAILED = "MEDIA_2001",
  MEDIA_DELETE_FAILED = "MEDIA_2002",
  MEDIA_INVALID_TYPE = "MEDIA_2003",
  MEDIA_TOO_LARGE = "MEDIA_2004",
  MEDIA_CORRUPTED = "MEDIA_2005",
  MEDIA_ALREADY_DELETED = "MEDIA_2006",
  MEDIA_NO_FILE = "MEDIA_2007",
  MEDIA_INVALID_BIZCARD = "MEDIA_2008",

  // Cloudinary errors (2100-2199)
  CLOUDINARY_UPLOAD_FAILED = "CLOUDINARY_2100",
  CLOUDINARY_DELETE_FAILED = "CLOUDINARY_2101",
  CLOUDINARY_CONNECTION_ERROR = "CLOUDINARY_2102",

  // Gallery errors (2200-2299)
  GALLERY_ACCESS_DENIED = "GALLERY_2200",
  GALLERY_FEATURE_LIMIT = "GALLERY_2201",
  GALLERY_ORDER_INVALID = "GALLERY_2202",
  GALLERY_BIZCARD_NOT_FOUND = "GALLERY_2203",

  // Audit errors (2300-2399)
  AUDIT_LOG_FAILED = "AUDIT_2300",
}

export interface MediaErrorResponse {
  success: false;
  error: {
    code: MediaErrorCode;
    message: string;
    details?: Record<string, unknown>;
    requestId: string;
    timestamp: string;
  };
  meta?: {
    requestId: string;
    responseTime?: number;
  };
}

export function toErrorCode(code: MediaErrorCode): ErrorCode {
  return code as unknown as ErrorCode;
}
