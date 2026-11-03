// ──────────────────────────────────────────────────────────────
// Cloudinary Upload Service
// ──────────────────────────────────────────────────────────────
// Centralises every Cloudinary interaction for the media pipeline.
//
// Two upload patterns are supported, matching the Vercel constraint
// that serverless function payloads are capped at ≈ 4.5 MB:
//
//   1. Proxied upload  (/api/media/upload)
//      Backend receives the binary buffer, validates it, then streams
//      it to Cloudinary. Practical for images (≤ 4.5 MB Vercel limit).
//
//   2. Signed direct upload  (/api/media/sign → /api/media/register)
//      Backend generates a time-limited HMAC signature. The frontend
//      posts the file directly to Cloudinary's upload API, bypassing
//      the Vercel function payload limit entirely. Required for videos
//      and any file that may exceed ≈ 4.5 MB.
//
// Deterministic public_id strategy:
//   Each owner+context combination maps to a stable Cloudinary public_id.
//   Re-uploading replaces the old asset *in-place* (overwrite: true +
//   invalidate: true). This prevents orphaned CDN assets and keeps the
//   same URL valid after a profile photo change.
//
// Environment variable support (in priority order):
//   CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET
//   OR
//   CLOUDINARY_URL="cloudinary://api_key:api_secret@cloud_name"
// ──────────────────────────────────────────────────────────────

// server/lib/cloudinary.ts (updated)
// ──────────────────────────────────────────────────────────────
// Cloudinary Upload Service with File Renaming Support
// ──────────────────────────────────────────────────────────────

import { v2 as cloudinary } from "cloudinary";
import type { UploadApiOptions, UploadApiResponse } from "cloudinary";

// Configuration
interface CloudinaryCredentials {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

function resolveCredentials(): CloudinaryCredentials {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (cloudName && apiKey && apiSecret) {
    return { cloudName, apiKey, apiSecret };
  }

  const url = process.env.CLOUDINARY_URL;
  if (url) {
    const match = url.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
    if (!match) {
      throw new Error("CLOUDINARY_URL has an invalid format.");
    }
    return { apiKey: match[1], apiSecret: match[2], cloudName: match[3] };
  }
  throw new Error("Cloudinary credentials are not configured.");
}
let _credentials: CloudinaryCredentials | null = null;
function getCredentials(): CloudinaryCredentials {
  if (!_credentials) {
    _credentials = resolveCredentials();
    cloudinary.config({
      cloud_name: _credentials.cloudName,
      api_key: _credentials.apiKey,
      api_secret: _credentials.apiSecret,
      secure: true,
    });
  }
  return _credentials;
}
export const CLOUDINARY_FOLDERS = {
  profile: "ontap/profiles",
  cover: "ontap/covers",
  service: "ontap/services",
  portfolio: "ontap/portfolio",
  gallery: "ontap/gallery",
  support: "ontap/support",
} as const;
export type UploadContext = keyof typeof CLOUDINARY_FOLDERS;
export interface CloudinaryUploadResult {
  secure_url: string;
  public_id: string;
  resource_type: string;
  format: string;
  bytes: number;
  width?: number;
  height?: number;
  duration?: number;
}
export interface CloudinarySignResult {
  signature: string;
  timestamp: number;
  api_key: string;
  cloud_name: string;
  upload_url: string;
  folder: string;
  public_id: string;
}
function uploadBuffer(buffer: Buffer, options: UploadApiOptions): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err || !result) {
        reject(err ?? new Error("Cloudinary upload_stream returned no result."));
      } else {
        resolve(result);
      }
    });
    stream.end(buffer);
  });
}
/**
 * Sanitize filename to be filesystem and Cloudinary-safe
 * Removes special characters, spaces, and limits length
 */
export function sanitizeFileName(fileName: string): string {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 100);
}
/**
 * Generate filename: {bizcardId}_{sanitizedTitle}.{extension}
 * If title is not provided, falls back to timestamp
 */
export function generateMediaFileName(
  bizcardId: string,
  title: string | null | undefined,
  extension: string
): string {
  const sanitizedTitle = title && title.trim()
    ? sanitizeFileName(title.trim())
    : `media_${Date.now()}`;
  return `${bizcardId}_${sanitizedTitle}.${extension}`;
}

function buildPublicId(
  context: UploadContext,
  ownerIdStr: string,
  subId?: string,
  customFileName?: string
): string {
  if (context === "service" && subId) {
    return `s${subId}_u${ownerIdStr}`;
  }
  if (context === "portfolio" || context === "gallery" || context === "support") {
    // Use custom filename if provided, otherwise timestamp
    const fileName = customFileName || `${Date.now()}`;
    return `${CLOUDINARY_FOLDERS[context]}/${fileName}`;
  }
  return `u${ownerIdStr}_${context}`;
}
/**
 * Upload a binary buffer to Cloudinary with optional custom filename
 */
export async function uploadToCloudinary(
  buffer: Buffer,
  mimeType: string,
  context: UploadContext,
  ownerIdStr: string,
  subId?: string,
  customFileName?: string
): Promise<CloudinaryUploadResult> {
  getCredentials();
  const isVideo = mimeType.startsWith("video/");
  const resource_type = isVideo ? "video" : "image" as const;
  const folder = CLOUDINARY_FOLDERS[context];
  let publicId: string;
  if (customFileName) {
    // Use custom filename without extension
    const nameWithoutExt = customFileName.replace(/\.[^/.]+$/, "");
    publicId = `${folder}/${nameWithoutExt}`;
  } else {
    publicId = buildPublicId(context, ownerIdStr, subId);
  }
  const options: UploadApiOptions = {
    folder,
    public_id: publicId,
    resource_type,
    overwrite: true,
    invalidate: true,
  };
  const result = await uploadBuffer(buffer, options);
  return {
    secure_url: result.secure_url,
    public_id: result.public_id,
    resource_type: result.resource_type,
    format: result.format,
    bytes: result.bytes,
    width: result.width,
    height: result.height,
    duration: (result as Record<string, unknown>).duration as number | undefined,
  };
}
export function signUploadRequest(
  context: UploadContext,
  resourceType: "image" | "video",
  ownerIdStr: string,
  subId?: string,
  customFileName?: string
): CloudinarySignResult {
  const { cloudName, apiKey, apiSecret } = getCredentials();
  const timestamp = Math.round(Date.now() / 1000);
  const folder = CLOUDINARY_FOLDERS[context];
  const publicId = buildPublicId(context, ownerIdStr, subId, customFileName);
  const paramsToSign: Record<string, string | number> = {
    folder,
    overwrite: 1,
    public_id: publicId,
    timestamp,
  };
  const signature = cloudinary.utils.api_sign_request(paramsToSign, apiSecret);
  return {
    signature,
    timestamp,
    api_key: apiKey,
    cloud_name: cloudName,
    upload_url: `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
    folder,
    public_id: publicId,
  };
}
export async function deleteFromCloudinary(
  publicId: string,
  resourceType: "image" | "video" | "raw" = "image"
): Promise<void> {
  try {
    getCredentials();
    await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      invalidate: true,
    });
  } catch (error) {
    console.error(`[cloudinary] Failed to delete asset "${publicId}":`, error);
  }
}
export function isOwnCloudinaryUrl(url: string): boolean {
  const { cloudName } = getCredentials();
  return url.startsWith(`https://res.cloudinary.com/${cloudName}/`);
}