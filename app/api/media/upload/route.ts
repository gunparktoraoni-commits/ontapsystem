// ──────────────────────────────────────────────────────────────
// POST /api/media/upload — R2 Media Upload (Proxied)
// ──────────────────────────────────────────────────────────────
// Receives a binary file from the frontend, uploads to R2,
// then saves the URL to the database.
//
// Advantages over Cloudinary:
//   - No payload limit constraints (R2 handles large files internally)
//   - Deterministic URLs (no CDN transformation URLs)
//   - Direct binary upload (streaming to R2)
//
// Upload contexts and their DB side-effects:
//   "profile"   → updates User.profile_url + Bizcard.profile_img + inserts Media row
//   "cover"     → updates User.cover_url + Bizcard.cover_img + inserts Media row
//   "service"   → inserts Media row (related_type = "service_gallery")
//   "portfolio" → inserts Media row (related_type = "portfolio")
//
// Request: multipart/form-data
//   file        (File)    — the binary
//   context     (string)  — "profile" | "cover" | "service" | "portfolio"
//   service_id  (string)  — required when context = "service"
//
// Response 200:
//   { url, key, mediaId, contentType, size }
//
// Error responses:
//   400  Validation failure or bad form data
//   401  Unauthenticated
//   403  Service not owned by caller
//   413  File too large
//   500  R2 or DB failure
//
// Security:
//   • Session cookie required
//   • Rate limited: 20 uploads / 10 min per IP
//   • MIME type validated against allow-list
//   • File size enforced: images ≤ 50 MB, videos ≤ 500 MB
//   • Service ownership verified before write
//   • All DB writes scoped to effective user id (supports superadmin impersonation)
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, resolveEffectiveUserId, getClientIp } from "@/server/lib/auth";
import { uploadToR2, type UploadContext } from "@/server/lib/r2-storage";
import { validateUploadedFile, COVER_VIDEO_MAX_BYTES } from "@/server/lib/media";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { invalidateCache, generateCacheKey } from "@/lib/cache";

export const maxDuration = 60;

const VALID_CONTEXTS = new Set<string>(["profile", "cover", "service", "portfolio", "support", "messaging", "notice", "newsletter", "inquiry", "logo"]);

// R2 has no payload limit, but we set reasonable limits
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;   // 50 MB
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;  // 500 MB

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  // ── Rate Limiting ──────────────────────────────────────────
  const rateCheck = checkRateLimit("media-upload", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many upload requests. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
      }
    );
  }

  // ── Authentication ─────────────────────────────────────────
  const resolved = await resolveRequestSession(request);
  const session = resolved.session;
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // Use effective user so superadmin impersonation writes the target user's media.
  const userId = BigInt(resolveEffectiveUserId(resolved));
  const userIdStr = userId.toString();

  // ── Parse Multipart Form Data ──────────────────────────────
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid multipart/form-data body." },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  const contextRaw = formData.get("context");
  const serviceIdRaw = formData.get("service_id");

  // ── Validate 'file' field ──────────────────────────────────
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "Missing 'file' field. Attach the binary as a File in the form data." },
      { status: 400 }
    );
  }

  // ── Validate 'context' field ───────────────────────────────
  if (!contextRaw || typeof contextRaw !== "string" || !VALID_CONTEXTS.has(contextRaw)) {
    return NextResponse.json(
      {
        error: "Invalid or missing 'context' field.",
        details: "Must be one of: profile, cover, service, portfolio, support, messaging, notice, newsletter, inquiry, logo",
      },
      { status: 400 }
    );
  }
  const context = contextRaw as UploadContext;

  // ── Get MIME type ──────────────────────────────────────────
  const mimeType = file.type.toLowerCase().split(";")[0].trim();
  const isVideo = mimeType.startsWith("video/");
  const isImage = mimeType.startsWith("image/");

  if (!isImage && !isVideo) {
    return NextResponse.json(
      { error: `Unsupported MIME type: ${mimeType}` },
      { status: 400 }
    );
  }

  // ── Validate file size ─────────────────────────────────────
  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (file.size > maxBytes) {
    return NextResponse.json(
      {
        error: `File exceeds maximum size. Max for ${isVideo ? "videos" : "images"}: ${maxBytes / 1024 / 1024} MB`,
        code: "FILE_TOO_LARGE",
        maxBytes,
      },
      { status: 413 }
    );
  }

  // ── Validate MIME type ─────────────────────────────────────
  const kind = isVideo ? "video" : "image";
  const fileValidation = validateUploadedFile(mimeType, file.size, kind, {
    maxBytes: isVideo && context === "cover" ? COVER_VIDEO_MAX_BYTES : undefined,
  });
  if (!fileValidation.valid) {
    const status = fileValidation.code === "FILE_TOO_LARGE" ? 413 : 400;
    return NextResponse.json(
      { error: fileValidation.error, code: fileValidation.code },
      { status }
    );
  }

  // ── Service Ownership Check ────────────────────────────────
  if (context === "service" && serviceIdRaw) {
    const service = await prisma.service.findFirst({
      where: { service_id: BigInt(serviceIdRaw as string), user_id: userId },
      select: { service_id: true },
    });
    if (!service) {
      return NextResponse.json(
        { error: "Service not found or access denied." },
        { status: 403 }
      );
    }
  }

  // ── Read File Buffer ───────────────────────────────────────
  const buffer = Buffer.from(await file.arrayBuffer());

  // ── Upload to R2 ───────────────────────────────────────────
  let uploadResult;
  try {
    uploadResult = await uploadToR2(
      buffer,
      mimeType,
      context,
      userIdStr,
      file.name
    );
  } catch (uploadError) {
    console.error("[media/upload] R2 upload failed:", uploadError);
    return NextResponse.json(
      { error: "Media upload to storage failed. Please try again." },
      { status: 500 }
    );
  }

  const { key, url } = uploadResult;

  // ── Persist to Database ────────────────────────────────────
  const now = new Date();

  try {
    let mediaId: bigint;

    if (context === "profile" || context === "cover") {
      const bizcardImageField =
        context === "profile"
          ? ({ profile_img: url, updated_at: now } as const)
          : ({ cover_img: url, updated_at: now } as const);

      const [, mediaRow] = await Promise.all([
        prisma.user.update({
          where: { user_id: userId },
          data: {
            [context === "profile" ? "profile_url" : "cover_url"]: url,
            updated_at: now,
          },
        }),
        prisma.media.create({
          data: {
            user_id: userId,
            related_type: context,
            related_id: userId,
            file_name: file.name,
            file_url: url,
            mime_type: mimeType,
            size: BigInt(buffer.length),
            storage_provider: "r2",
            metadata: JSON.stringify({ r2_key: key }),
          },
          select: { media_id: true },
        }),
        // Keep Bizcard images in sync so public portfolio does not serve stale migrated URLs.
        prisma.bizcard.updateMany({
          where: { user_id: userId },
          data: bizcardImageField,
        }),
      ]);
      mediaId = mediaRow.media_id;

      // Invalidate public profile caches for known aliases + the user profile session cache.
      try {
        const [user, bizcards] = await Promise.all([
          prisma.user.findUnique({
            where: { user_id: userId },
            select: { custom_uri: true, serial_id: true },
          }),
          prisma.bizcard.findMany({
            where: { user_id: userId, deactivated_flag: false },
            select: { url_alias: true },
          }),
        ]);
        const aliases = new Set<string>();
        for (const raw of [
          user?.custom_uri,
          user?.serial_id,
          ...bizcards.map((b) => b.url_alias),
        ]) {
          const normalized = String(raw ?? "").trim().toLowerCase();
          if (normalized) aliases.add(normalized);
        }
        await Promise.all([
          invalidateCache(generateCacheKey("user", userIdStr, "profile")),
          ...[...aliases].map((alias) =>
            invalidateCache(generateCacheKey("public", "profile", alias)),
          ),
        ]);
      } catch (cacheErr) {
        console.warn("[media/upload] public cache invalidation failed:", cacheErr);
      }
    } else if (context === "service" && serviceIdRaw) {
      const serviceId = BigInt(serviceIdRaw as string);
      const existingCount = await prisma.media.count({
        where: {
          user_id: userId,
          related_type: "service_gallery",
          related_id: serviceId,
        },
      });

      const mediaRow = await prisma.media.create({
        data: {
          user_id: userId,
          related_type: "service_gallery",
          related_id: serviceId,
          file_name: file.name,
          file_url: url,
          mime_type: mimeType,
          size: BigInt(buffer.length),
          storage_provider: "r2",
          metadata: JSON.stringify({
            r2_key: key,
            display_order: existingCount,
          }),
        },
        select: { media_id: true },
      });
      mediaId = mediaRow.media_id;
    } else if (context === "messaging") {
      const mediaRow = await prisma.media.create({
        data: {
          user_id: userId,
          related_type: "messaging_attachment",
          file_name: file.name,
          file_url: url,
          mime_type: mimeType,
          size: BigInt(buffer.length),
          storage_provider: "r2",
          metadata: JSON.stringify({ r2_key: key }),
        },
        select: { media_id: true },
      });
      mediaId = mediaRow.media_id;
    } else {
      const mediaRow = await prisma.media.create({
        data: {
          user_id: userId,
          related_type: context,
          file_name: file.name,
          file_url: url,
          mime_type: mimeType,
          size: BigInt(buffer.length),
          storage_provider: "r2",
          metadata: JSON.stringify({ r2_key: key }),
        },
        select: { media_id: true },
      });
      mediaId = mediaRow.media_id;
    }

    return NextResponse.json(
      {
        url,
        key,
        mediaId: mediaId.toString(),
        contentType: mimeType,
        size: buffer.length,
      },
      { status: 200 }
    );
  } catch (dbError) {
    console.error("[media/upload] DB write failed after successful R2 upload:", dbError);
    
    // File is safely on R2, even if DB write failed
    return NextResponse.json(
      {
        url,
        key,
        warning: "File uploaded to storage but database record could not be saved.",
        code: "DB_WRITE_FAILED",
      },
      { status: 207 }
    );
  }
}
