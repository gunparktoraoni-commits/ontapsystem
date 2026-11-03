// ──────────────────────────────────────────────────────────────
// Cloudflare R2 Storage Service
// ──────────────────────────────────────────────────────────────
// Centralizes all R2 interactions for the media pipeline.
//
// Upload patterns supported:
//   1. Direct upload  (/api/media/upload)
//      Backend receives binary buffer, uploads to R2, saves URL to DB
//      Works for all file sizes (R2 handles multipart internally)
//
//   2. Presigned upload  (/api/media/sign)
//      Backend generates a time-limited presigned URL.
//      Frontend posts directly to R2, bypassing Vercel payload limits.
//      Reduces backend bandwidth usage.
//
// File naming strategy:
//   - Deterministic paths: /{context}/{userId}/{timestamp}-{sanitizedName}
//   - Supports custom filenames for versioning
//   - Automatic cleanup via object lifecycle or manual deletion
//
// Environment variables:
//   R2_ACCOUNT_ID        - Your Cloudflare account ID
//   R2_TOKEN_VALUE       - R2 API token (not used for presigned URLs)
//   R2_ACCESS_KEY_ID     - S3-compatible access key
//   R2_SECRET_ACCESS_KEY - S3-compatible secret key
//   R2_ENDPOINT          - R2 S3 API endpoint (private)
//   R2_BUCKET_NAME       - Bucket name (default: ontap-media)
//   R2_PUBLIC_URL        - Optional app origin; when set, getPublicUrl returns
//                          {R2_PUBLIC_URL}/api/media/file/{key} for browser display
//
// R2 Features leveraged:
//   - S3-compatible API (uses AWS SDK v3)
//   - Presigned URLs (time-limited, no credentials in URL)
//   - Bucket operations (list, delete, head)
//   - Metadata preservation (Content-Type, Cache-Control)
// ──────────────────────────────────────────────────────────────

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

interface R2Credentials {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  bucket: string;
}

function resolveCredentials(): R2Credentials {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const endpoint = process.env.R2_ENDPOINT;
  const bucket = process.env.R2_BUCKET_NAME || "ontap-media";

  if (!accountId || !accessKeyId || !secretAccessKey || !endpoint) {
    const missing = [];
    if (!accountId) missing.push("R2_ACCOUNT_ID");
    if (!accessKeyId) missing.push("R2_ACCESS_KEY_ID");
    if (!secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
    if (!endpoint) missing.push("R2_ENDPOINT");
    
    console.error("[r2-storage] Missing R2 credentials:", {
      missing,
      accountIdSet: !!accountId,
      accessKeyIdSet: !!accessKeyId,
      secretAccessKeySet: !!secretAccessKey,
      endpointSet: !!endpoint,
      bucketSet: !!bucket,
      timestamp: new Date().toISOString(),
    });
    
    throw new Error(
      `R2 credentials not configured. Missing: ${missing.join(", ")}`
    );
  }
  return { accountId, accessKeyId, secretAccessKey, endpoint, bucket };
}
let _client: S3Client | null = null;
let _credentials: R2Credentials | null = null;

function getClient(): S3Client {
  if (!_client) {
    try {
      _credentials = resolveCredentials();
      console.debug("[r2-storage] Initializing S3Client with endpoint:", {
        endpoint: _credentials.endpoint,
        bucket: _credentials.bucket,
        accessKeyIdLength: _credentials.accessKeyId.length,
      });

      _client = new S3Client({
        region: "auto",
        endpoint: _credentials.endpoint,
        credentials: {
          accessKeyId: _credentials.accessKeyId,
          secretAccessKey: _credentials.secretAccessKey,
        },
        // Avoid SDK checksum query params on presigned URLs — they break
        // browser PUT uploads even when R2 CORS is configured correctly.
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      });
      
      console.debug("[r2-storage] S3Client initialized successfully");
    } catch (error) {
      console.error("[r2-storage] Failed to initialize S3Client:", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }
  return _client;
}

/** Exposed for the same-origin media proxy (`GET /api/media/file/...`). */
export function getClientForMediaProxy(): S3Client {
  return getClient();
}

export function getBucketForMediaProxy(): string {
  return getCredentials().bucket;
}

function getCredentials(): R2Credentials {
  if (!_credentials) {
    _credentials = resolveCredentials();
  }
  return _credentials;
}

// ──────────────────────────────────────────
// Public URL Construction
// ──────────────────────────────────────────

function normalizeEndpoint(endpoint: string): string {
  let baseUrl = endpoint;
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    baseUrl = `https://${baseUrl}`;
  }
  return baseUrl.replace(/\/$/, "");
}

function getS3StylePublicUrl(key: string): string {
  const credentials = getCredentials();
  const baseUrl = normalizeEndpoint(credentials.endpoint);
  const normalizedKey = key.replace(/^\//, "");
  if (!normalizedKey) {
    return `${baseUrl}/${credentials.bucket}/`;
  }
  return `${baseUrl}/${credentials.bucket}/${normalizedKey}`;
}

function getProxyPublicBase(): string | null {
  const publicBase = process.env.R2_PUBLIC_URL?.trim();
  if (!publicBase) return null;
  return publicBase.replace(/\/$/, "");
}

/**
 * Build a browser-loadable URL for an R2 object key.
 * When R2_PUBLIC_URL is set, returns an absolute same-origin media proxy URL
 * (`{R2_PUBLIC_URL}/api/media/file/{key}`) because private R2 S3 endpoints
 * cannot be loaded directly in <img>/<video>.
 * Otherwise falls back to the path-style S3 endpoint URL.
 */
export function getPublicUrl(key: string): string {
  const normalizedKey = key.replace(/^\//, "");
  const publicBase = getProxyPublicBase();

  if (publicBase) {
    if (!normalizedKey) {
      return `${publicBase}/api/media/file/`;
    }
    const encodedKey = normalizedKey
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return `${publicBase}/api/media/file/${encodedKey}`;
  }

  return getS3StylePublicUrl(normalizedKey);
}

// ──────────────────────────────────────────
// Upload Contexts & Path Generation
// ──────────────────────────────────────────

export const R2_FOLDERS = {
  profile: "profiles",
  cover: "covers",
  service: "services",
  portfolio: "portfolio",
  gallery: "gallery",
  support: "support",
  messaging: "messaging",
  logo: "logos",
  notice: "notices",
  newsletter: "newsletter",
  inquiry: "inquiries",
} as const;

export type UploadContext = keyof typeof R2_FOLDERS;

/**
 * Sanitize filename to be R2-safe (S3-compatible)
 */
export function sanitizeFileName(fileName: string): string {
  return fileName
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9._-]{2,}/g, "_")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/_+/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^[_.]+|_$/g, "")
    .substring(0, 100);
}

/** Single path segment: no separators, dots, or traversal. */
function sanitizeKeySegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, "").substring(0, 64);
  return cleaned || "unknown";
}

function fileExtension(fileName: string): string {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(fileName.trim());
  return match ? match[1].toLowerCase() : "bin";
}

/**
 * Generate R2 key path: {context}/{userId}/{timestamp}-{sanitizedName}.{ext}
 */
export function generateR2Key(
  context: UploadContext,
  userId: string,
  fileName: string,
  customName?: string
): string {
  const folder = R2_FOLDERS[context];
  const timestamp = Date.now();
  const sanitized =
    sanitizeFileName(customName || fileName.replace(/\.[^/.]+$/, "")) || "file";
  const ext = fileExtension(fileName);

  return `${folder}/${sanitizeKeySegment(userId)}/${timestamp}-${sanitized}.${ext}`;
}

// ──────────────────────────────────────────
// Upload Result Types
// ──────────────────────────────────────────

export interface R2UploadResult {
  key: string;
  url: string;
  contentType: string;
  size: number;
  etag: string;
}

export interface R2PresignedUrlResult {
  uploadUrl: string;
  key: string;
  expiresIn: number; // seconds
}

// ──────────────────────────────────────────
// Upload Operations
// ──────────────────────────────────────────

/**
 * Upload a binary buffer to R2
 */
export async function uploadToR2(
  buffer: Buffer,
  contentType: string,
  context: UploadContext,
  userId: string,
  fileName: string
): Promise<R2UploadResult> {
  const client = getClient();
  const credentials = getCredentials();
  
  const key = generateR2Key(context, userId, fileName);
  
  const command = new PutObjectCommand({
    Bucket: credentials.bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: "public, max-age=31536000", // 1 year for immutable content
    Metadata: {
      "upload-context": context,
      "upload-user-id": userId,
      "upload-timestamp": new Date().toISOString(),
    },
  });

  try {
    const response = await client.send(command);
    
    return {
      key,
      url: getPublicUrl(key),
      contentType,
      size: buffer.length,
      etag: response.ETag || "",
    };
  } catch (error) {
    console.error(`[r2] Upload failed for key "${key}":`, error);
    throw new Error(`R2 upload failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

/**
 * Generate a presigned URL for direct browser-to-R2 upload
 * Default expiration: 1 hour
 */
export async function generatePresignedUploadUrl(
  context: UploadContext,
  userId: string,
  fileName: string,
  expiresIn: number = 3600 // 1 hour in seconds
): Promise<R2PresignedUrlResult> {
  try {
    const client = getClient();
    const credentials = getCredentials();
    
    const key = generateR2Key(context, userId, fileName);
    
    console.debug("[r2-storage] Generating presigned URL for key:", {
      key,
      bucket: credentials.bucket,
      expiresIn,
    });

    // Keep the signed command minimal: only Bucket + Key.
    // Extra headers (CacheControl, ContentType) force browsers to send them
    // on PUT and trigger CORS preflight against R2.
    const command = new PutObjectCommand({
      Bucket: credentials.bucket,
      Key: key,
    });

    const uploadUrl = await getSignedUrl(client, command, { expiresIn });
    
    console.debug("[r2-storage] Presigned URL generated successfully:", {
      key,
      uploadUrlLength: uploadUrl.length,
    });

    return {
      uploadUrl,
      key,
      expiresIn,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : "";
    
    console.error(`[r2-storage] Presigned URL generation failed:`, {
      context,
      userId,
      fileName,
      errorMsg,
      errorStack,
      errorType: error?.constructor?.name,
      timestamp: new Date().toISOString(),
    });
    
    throw new Error(
      `Failed to generate presigned upload URL: ${errorMsg}`
    );
  }
}

// ──────────────────────────────────────────
// Deletion Operations
// ──────────────────────────────────────────

/**
 * Delete an object from R2
 */
export async function deleteFromR2(key: string): Promise<void> {
  const client = getClient();
  const credentials = getCredentials();
  
  const command = new DeleteObjectCommand({
    Bucket: credentials.bucket,
    Key: key,
  });

  try {
    await client.send(command);
    console.debug(`[r2] Deleted object: ${key}`);
  } catch (error) {
    console.error(`[r2] Failed to delete object "${key}":`, error);
    // Don't throw - deletion failures shouldn't cascade
    // Log for monitoring but allow request to continue
  }
}

/**
 * Delete multiple objects from R2
 */
export async function deleteMultipleFromR2(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  
  const client = getClient();
  const credentials = getCredentials();
  
  // R2 supports bulk delete, but we'll do them in parallel for simplicity
  await Promise.allSettled(
    keys.map(key => deleteFromR2(key))
  );
}

// ──────────────────────────────────────────
// Object Verification
// ──────────────────────────────────────────

/**
 * Check if an object exists in R2
 */
export async function checkObjectExists(key: string): Promise<boolean> {
  const client = getClient();
  const credentials = getCredentials();
  
  const command = new HeadObjectCommand({
    Bucket: credentials.bucket,
    Key: key,
  });

  try {
    await client.send(command);
    return true;
  } catch (error: unknown) {
    // HeadObject throws error if object doesn't exist
    if ((error as { name?: string }).name === "NotFound") {
      return false;
    }
    console.error(`[r2] HeadObject check failed for key "${key}":`, error);
    return false;
  }
}

/**
 * Get object metadata (size, content-type, last-modified)
 */
export async function getObjectMetadata(key: string): Promise<{
  size: number;
  contentType: string;
  lastModified: Date;
} | null> {
  const client = getClient();
  const credentials = getCredentials();
  
  const command = new HeadObjectCommand({
    Bucket: credentials.bucket,
    Key: key,
  });

  try {
    const response = await client.send(command);
    return {
      size: response.ContentLength || 0,
      contentType: response.ContentType || "application/octet-stream",
      lastModified: response.LastModified || new Date(),
    };
  } catch (error: unknown) {
    if ((error as { name?: string }).name === "NotFound") {
      return null;
    }
    console.error(`[r2] Metadata lookup failed for key "${key}":`, error);
    return null;
  }
}

// ──────────────────────────────────────────
// Batch Operations
// ──────────────────────────────────────────

/**
 * List all objects in a folder
 */
export async function listObjectsInFolder(folderPrefix: string): Promise<Array<{ key: string; size: number; modified: Date }>> {
  const client = getClient();
  const credentials = getCredentials();
  
  const command = new ListObjectsV2Command({
    Bucket: credentials.bucket,
    Prefix: folderPrefix,
    MaxKeys: 1000, // R2 limit
  });

  try {
    const response = await client.send(command);
    
    return (response.Contents || [])
      .filter((obj: { Key?: string; Size?: number; LastModified?: Date }) => obj.Key && obj.Size !== undefined && obj.LastModified)
      .map((obj: { Key?: string; Size?: number; LastModified?: Date }) => ({
        key: obj.Key!,
        size: obj.Size || 0,
        modified: obj.LastModified || new Date(),
      }));
  } catch (error) {
    console.error(`[r2] List operation failed for prefix "${folderPrefix}":`, error);
    return [];
  }
}

/**
 * Get all media for a user across all contexts
 */
export async function listUserMedia(userId: string): Promise<Array<{ context: UploadContext; key: string; size: number }>> {
  const folderPrefix = `*/user/${userId}`;
  // This is a simplified version - in production, you'd iterate each context
  
  const allMedia: Array<{ context: UploadContext; key: string; size: number }> = [];
  
  for (const [context] of Object.entries(R2_FOLDERS)) {
    const prefix = `${context}/${userId}/`;
    const objects = await listObjectsInFolder(prefix);
    
    objects.forEach(obj => {
      allMedia.push({
        context: context as UploadContext,
        key: obj.key,
        size: obj.size,
      });
    });
  }
  
  return allMedia;
}

// ──────────────────────────────────────────
// URL Validation
// ──────────────────────────────────────────

/**
 * Verify that a URL belongs to our R2 media (proxied public URL or legacy S3 URL).
 */
export function isOwnR2Url(url: string): boolean {
  return extractKeyFromR2Url(url) !== null;
}

/**
 * Extract R2 object key from a public URL (proxied or legacy S3 path-style).
 */
export function extractKeyFromR2Url(url: string): string | null {
  if (!url || typeof url !== "string") return null;

  const publicBase = getProxyPublicBase();
  if (publicBase) {
    const proxyPrefix = `${publicBase}/api/media/file/`;
    if (url.startsWith(proxyPrefix)) {
      const encoded = url.slice(proxyPrefix.length);
      if (!encoded) return null;
      try {
        return encoded
          .split("/")
          .map((segment) => decodeURIComponent(segment))
          .join("/");
      } catch {
        return encoded;
      }
    }
  }

  // Relative same-origin proxy paths
  const relativeProxy = "/api/media/file/";
  if (url.startsWith(relativeProxy)) {
    const encoded = url.slice(relativeProxy.length);
    if (!encoded) return null;
    try {
      return encoded
        .split("/")
        .map((segment) => decodeURIComponent(segment))
        .join("/");
    } catch {
      return encoded;
    }
  }

  // Legacy path-style S3 endpoint URLs
  try {
    const credentials = getCredentials();
    const s3Base = getS3StylePublicUrl("");
    if (url.startsWith(s3Base)) {
      const key = url.slice(s3Base.length);
      return key || null;
    }
    // Also accept URLs that omit trailing slash on empty-key base
    const s3BaseNoSlash = `${normalizeEndpoint(credentials.endpoint)}/${credentials.bucket}/`;
    if (url.startsWith(s3BaseNoSlash)) {
      const key = url.slice(s3BaseNoSlash.length);
      return key || null;
    }
  } catch {
    return null;
  }

  return null;
}
