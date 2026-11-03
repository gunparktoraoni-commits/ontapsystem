// ──────────────────────────────────────────────────────────────
// Cloudflare R2 Upload Service
// ──────────────────────────────────────────────────────────────
// Replaces Cloudinary with Cloudflare R2 for media storage.
// Supports direct uploads and signed URLs with identical patterns
// to the previous Cloudinary implementation.
//
// Environment variables:
//   R2_ACCOUNT_ID           — Cloudflare Account ID
//   R2_ACCESS_KEY_ID        — R2 API Token Access Key ID
//   R2_SECRET_ACCESS_KEY    — R2 API Token Secret Access Key
//   R2_ENDPOINT             — R2 endpoint URL (https://xxx.r2.cloudflarestorage.com)
//   R2_BUCKET_NAME          — Bucket name (default: "ontap-media")
// ──────────────────────────────────────────────────────────────

import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";

// Configuration
interface R2Credentials {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  bucketName: string;
}

function resolveCredentials(): R2Credentials {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const endpoint = process.env.R2_ENDPOINT;
  const bucketName = process.env.R2_BUCKET_NAME || "ontap-media";

  if (!accountId || !accessKeyId || !secretAccessKey || !endpoint) {
    throw new Error("R2 credentials are not configured. Check R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT.");
  }

  return { accountId, accessKeyId, secretAccessKey, endpoint, bucketName };
}

let _credentials: R2Credentials | null = null;
let _s3Client: S3Client | null = null;

function getCredentials(): R2Credentials {
  if (!_credentials) {
    _credentials = resolveCredentials();
  }
  return _credentials;
}

function getS3Client(): S3Client {
  if (!_s3Client) {
    const creds = getCredentials();
    _s3Client = new S3Client({
      region: "auto",
      endpoint: creds.endpoint,
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
      },
    });
  }
  return _s3Client;
}

// R2 folder structure mirrors the old Cloudinary CLOUDINARY_FOLDERS
export const R2_FOLDERS = {
  profile: "ontap/profiles",
  cover: "ontap/covers",
  service: "ontap/services",
  portfolio: "ontap/portfolio",
  gallery: "ontap/gallery",
  support: "ontap/support",
} as const;

export type UploadContext = keyof typeof R2_FOLDERS;

export interface R2UploadResult {
  url: string;
  key: string;
  bucketName: string;
  mimeType: string;
  bytes: number;
  width?: number;
  height?: number;
  duration?: number;
}

export interface R2SignResult {
  uploadUrl: string;
  key: string;
  bucketName: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresIn: number;
}

/**
 * Sanitize filename to be filesystem and R2-safe
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
 * Generate a unique R2 key for the file
 * Pattern: {folder}/{fileName}
 */
function buildKey(
  context: UploadContext,
  ownerIdStr: string,
  subId?: string,
  customFileName?: string
): string {
  const folder = R2_FOLDERS[context];

  if (customFileName) {
    // Use custom filename without extension (we'll preserve it separately)
    const nameWithoutExt = customFileName.replace(/\.[^/.]+$/, "");
    return `${folder}/${ownerIdStr}/${nameWithoutExt}`;
  }

  if (context === "service" && subId) {
    return `${folder}/${ownerIdStr}/service_${subId}`;
  }

  if (context === "portfolio" || context === "gallery" || context === "support") {
    // Include timestamp for uniqueness
    const timestamp = Date.now();
    return `${folder}/${ownerIdStr}/${timestamp}_${crypto.randomBytes(4).toString("hex")}`;
  }

  // profile, cover
  return `${folder}/${ownerIdStr}/${context}`;
}

/**
 * Upload a binary buffer to R2
 */
export async function uploadToR2(
  buffer: Buffer,
  mimeType: string,
  context: UploadContext,
  ownerIdStr: string,
  subId?: string,
  customFileName?: string,
  metadata?: {
    width?: number;
    height?: number;
    duration?: number;
  }
): Promise<R2UploadResult> {
  try {
    const creds = getCredentials();
    const client = getS3Client();
    
    const key = buildKey(context, ownerIdStr, subId, customFileName);
    
    // Create the public URL
    const url = `${creds.endpoint}/${creds.bucketName}/${key}`;

    // Prepare metadata
    const metadataObj: Record<string, string> = {
      context,
      owner_id: ownerIdStr,
      uploaded_at: new Date().toISOString(),
    };

    if (metadata?.width) metadataObj.width = String(metadata.width);
    if (metadata?.height) metadataObj.height = String(metadata.height);
    if (metadata?.duration) metadataObj.duration = String(metadata.duration);

    const command = new PutObjectCommand({
      Bucket: creds.bucketName,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      Metadata: metadataObj,
      // Allow public read access
      ACL: "public-read",
    });

    await client.send(command);

    return {
      url,
      key,
      bucketName: creds.bucketName,
      mimeType,
      bytes: buffer.length,
      width: metadata?.width,
      height: metadata?.height,
      duration: metadata?.duration,
    };
  } catch (error) {
    console.error("[r2] Upload failed:", error);
    throw new Error(`R2 upload failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

/**
 * Delete an object from R2
 */
export async function deleteFromR2(key: string): Promise<void> {
  try {
    const creds = getCredentials();
    const client = getS3Client();

    const command = new DeleteObjectCommand({
      Bucket: creds.bucketName,
      Key: key,
    });

    await client.send(command);
  } catch (error) {
    console.error(`[r2] Failed to delete asset "${key}":`, error);
    // Don't throw — log and continue (fire-and-forget pattern)
  }
}

/**
 * Generate a signed PUT URL for direct browser uploads to R2
 * The frontend will PUT the file directly to this URL
 */
export async function generateSignedUploadUrl(
  context: UploadContext,
  ownerIdStr: string,
  subId?: string,
  customFileName?: string,
  expiresIn: number = 3600
): Promise<R2SignResult> {
  try {
    const creds = getCredentials();
    const client = getS3Client();

    const key = buildKey(context, ownerIdStr, subId, customFileName);

    const command = new PutObjectCommand({
      Bucket: creds.bucketName,
      Key: key,
      // Note: ACL not included in presigned URL by default
    });

    const uploadUrl = await getSignedUrl(client, command, { expiresIn });

    return {
      uploadUrl,
      key,
      bucketName: creds.bucketName,
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
      },
      expiresIn,
    };
  } catch (error) {
    console.error("[r2] Failed to generate signed URL:", error);
    throw new Error(`Failed to generate signed R2 upload URL: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

/**
 * Validate that a URL belongs to our R2 bucket
 */
export function isOwnR2Url(url: string): boolean {
  try {
    const creds = getCredentials();
    const baseUrl = `${creds.endpoint}/${creds.bucketName}`;
    return url.startsWith(baseUrl);
  } catch {
    return false;
  }
}

/**
 * Get the R2 key from a full URL
 */
export function getKeyFromR2Url(url: string): string | null {
  try {
    const creds = getCredentials();
    const baseUrl = `${creds.endpoint}/${creds.bucketName}/`;
    
    if (!url.startsWith(baseUrl)) {
      return null;
    }

    return url.slice(baseUrl.length);
  } catch {
    return null;
  }
}

/**
 * Get a public R2 URL from a key
 */
export function getR2Url(key: string): string {
  const creds = getCredentials();
  return `${creds.endpoint}/${creds.bucketName}/${key}`;
}

/**
 * Generate a signed download URL (for temporary access control if needed)
 */
export async function generateSignedDownloadUrl(
  key: string,
  expiresIn: number = 3600
): Promise<string> {
  try {
    const creds = getCredentials();
    const client = getS3Client();

    const command = new GetObjectCommand({
      Bucket: creds.bucketName,
      Key: key,
    });

    return await getSignedUrl(client, command, { expiresIn });
  } catch (error) {
    console.error("[r2] Failed to generate download URL:", error);
    throw new Error(`Failed to generate R2 download URL: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

/**
 * Check if R2 credentials are properly configured
 */
export function isR2Configured(): boolean {
  try {
    getCredentials();
    return true;
  } catch {
    return false;
  }
}
