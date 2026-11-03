import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { uploadToR2 } from "@/server/lib/r2";
import {
  validateMediaUrl,
  validateUploadedFile,
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_VIDEO_MIME_TYPES,
} from "@/server/lib/media";

const MAX_ITEMS_PER_REQUEST = 50;
const FETCH_TIMEOUT_MS = 20_000;

type ImportItemInput = {
  source_url?: string;
  file_name?: string;
  mime_type?: string;
  related_type?: string;
  related_id?: string | number | null;
};

function normalizeMimeType(value: string | null | undefined): string {
  if (!value) return "";
  return value.toLowerCase().split(";")[0].trim();
}

function parseBigIntOrNull(value: unknown): bigint | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    return BigInt(String(value));
  } catch {
    return null;
  }
}

function inferMimeTypeFromUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  return "";
}

async function fetchAsBuffer(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Source fetch failed with ${response.status}`);
    }

    const contentType = normalizeMimeType(response.headers.get("content-type"));
    const arrayBuffer = await response.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), contentType };
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("media-gallery-import", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many import requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  const resolved = await resolveRequestSession(request);
  if (!resolved.session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const userId = BigInt(resolved.session.userId);
  const userIdStr = String(resolved.session.userId);

  let body: { items?: ImportItemInput[] } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "items must be a non-empty array." }, { status: 400 });
  }
  if (items.length > MAX_ITEMS_PER_REQUEST) {
    return NextResponse.json(
      { error: `items must not exceed ${MAX_ITEMS_PER_REQUEST} per request.` },
      { status: 422 }
    );
  }

  const imported: Array<{ index: number; media_id: string; file_url: string; mime_type: string }> = [];
  const failed: Array<{ index: number; source_url?: string; error: string }> = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i] ?? {};
    const sourceUrl = typeof item.source_url === "string" ? item.source_url.trim() : "";

    if (!sourceUrl) {
      failed.push({ index: i, error: "source_url is required." });
      continue;
    }

    const urlValidation = validateMediaUrl(sourceUrl, "source_url");
    if (!urlValidation.valid) {
      failed.push({ index: i, source_url: sourceUrl, error: urlValidation.error });
      continue;
    }

    try {
      const { buffer, contentType } = await fetchAsBuffer(sourceUrl);

      const hintedMime = normalizeMimeType(typeof item.mime_type === "string" ? item.mime_type : "");
      const inferredMime = inferMimeTypeFromUrl(sourceUrl);
      const mimeType = hintedMime || contentType || inferredMime;

      const isImage = ALLOWED_IMAGE_MIME_TYPES.has(mimeType);
      const isVideo = ALLOWED_VIDEO_MIME_TYPES.has(mimeType);

      if (!isImage && !isVideo) {
        failed.push({
          index: i,
          source_url: sourceUrl,
          error: `Unsupported media type "${mimeType || "unknown"}".`,
        });
        continue;
      }

      const kind = isVideo ? "video" : "image";
      const fileValidation = validateUploadedFile(mimeType, buffer.length, kind);
      if (!fileValidation.valid) {
        failed.push({ index: i, source_url: sourceUrl, error: fileValidation.error });
        continue;
      }

      const upload = await uploadToR2(buffer, mimeType, "portfolio", userIdStr);

      const media = await prisma.media.create({
        data: {
          user_id: userId,
          related_type: typeof item.related_type === "string" && item.related_type.trim() ? item.related_type.trim() : "portfolio",
          related_id: parseBigIntOrNull(item.related_id),
          file_name:
            typeof item.file_name === "string" && item.file_name.trim()
              ? item.file_name.trim().slice(0, 255)
              : `${upload.key.split("/").pop() ?? "media"}.bin`,
          file_url: upload.url,
          mime_type: mimeType,
          size: BigInt(upload.bytes),
          storage_provider: "r2",
          cloudinary_public_id: upload.key,
          metadata: JSON.stringify({
            source_url: sourceUrl,
            imported_at: new Date().toISOString(),
            r2: {
              key: upload.key,
              bucketName: upload.bucketName,
            },
          }),
        },
        select: { media_id: true, file_url: true, mime_type: true },
      });

      imported.push({
        index: i,
        media_id: media.media_id.toString(),
        file_url: media.file_url,
        mime_type: media.mime_type ?? mimeType,
      });
    } catch (error) {
      failed.push({
        index: i,
        source_url: sourceUrl,
        error: error instanceof Error ? error.message : "Import failed.",
      });
    }
  }

  return NextResponse.json(
    {
      success: failed.length === 0,
      summary: {
        requested: items.length,
        imported: imported.length,
        failed: failed.length,
      },
      imported,
      failed,
    },
    { status: failed.length > 0 ? 207 : 200 }
  );
}
