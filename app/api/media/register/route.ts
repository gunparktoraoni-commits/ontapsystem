// ──────────────────────────────────────────────────────────────
// POST /api/media/register — Save R2 Upload to Database
// ──────────────────────────────────────────────────────────────
// After frontend uploads directly to R2 (via presigned URL or backend),
// this endpoint persists the file URL and metadata to the database.
//
// This endpoint is also used to recover from rare scenarios where:
//   - Upload succeeded to R2 but DB write failed (207 response)
//   - User wants to register an existing R2 URL
//
// Security — SSRF prevention:
//   The URL is validated to confirm it belongs to our R2 bucket.
//   This prevents attackers from registering arbitrary external URLs.
//
// Request body (JSON):
//   {
//     context:       "profile" | "cover" | "service" | "portfolio",
//     key:           string,              — R2 object key
//     url:           string,              — R2 public URL
//     content_type:  string,              — e.g. "image/jpeg"
//     size:          number,              — bytes
//     service_id?:   string,              — required when context = "service"
//     width?:        number,              — image width (optional)
//     height?:       number,              — image height (optional)
//   }
//
// Response 200:
//   { mediaId: string, url: string }
//
// Rate limited: 30 / 10 min per IP
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { isOwnR2Url, type UploadContext } from "@/server/lib/r2-storage";
import { checkRateLimit } from "@/server/lib/rate-limit";

const VALID_CONTEXTS = new Set<string>(["profile", "cover", "service", "portfolio", "support", "messaging"]);

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  // ── Rate Limiting ──────────────────────────────────────────
  const rateCheck = checkRateLimit("media-register", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
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

  const userId = BigInt(session.userId);

  // ── Parse JSON Body ────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const {
    context: contextRaw,
    key,
    url,
    content_type: contentType,
    size: sizeRaw,
    service_id: serviceIdRaw,
    width: widthRaw,
    height: heightRaw,
  } = body;

  // ── Validate context ───────────────────────────────────────
  if (typeof contextRaw !== "string" || !VALID_CONTEXTS.has(contextRaw)) {
    return NextResponse.json(
      {
        error: "Invalid or missing 'context'.",
        details: "Must be one of: profile, cover, service, portfolio, support, messaging",
      },
      { status: 400 }
    );
  }
  const context = contextRaw as UploadContext;

  // ── Validate URL ───────────────────────────────────────────
  if (typeof url !== "string" || !url) {
    return NextResponse.json(
      { error: "Missing 'url'." },
      { status: 400 }
    );
  }

  // SECURITY: Verify the URL belongs to our R2 bucket.
  if (!isOwnR2Url(url)) {
    return NextResponse.json(
      {
        error: "The provided URL is not a valid asset from this application's media storage.",
        code: "INVALID_URL_ORIGIN",
      },
      { status: 400 }
    );
  }

  // ── Validate other fields ──────────────────────────────────
  if (typeof contentType !== "string" || !contentType) {
    return NextResponse.json(
      { error: "Missing 'content_type'." },
      { status: 400 }
    );
  }

  const size = typeof sizeRaw === "number" ? sizeRaw : 0;
  const width = typeof widthRaw === "number" ? widthRaw : null;
  const height = typeof heightRaw === "number" ? heightRaw : null;
  const keyStr = typeof key === "string" ? key : "";

  // ── service_id check ───────────────────────────────────────
  if (context === "service" && !serviceIdRaw) {
    return NextResponse.json(
      { error: "Missing 'service_id'. Required when context is 'service'." },
      { status: 400 }
    );
  }
  const serviceId = serviceIdRaw ? String(serviceIdRaw) : undefined;

  // ── Service Ownership Check ────────────────────────────────
  if (context === "service" && serviceId) {
    const service = await prisma.service.findFirst({
      where: { service_id: BigInt(serviceId), user_id: userId },
      select: { service_id: true },
    });
    if (!service) {
      return NextResponse.json(
        { error: "Service not found or access denied." },
        { status: 403 }
      );
    }
  }

  // ── Persist to Database ────────────────────────────────────
  const now = new Date();

  try {
    let mediaId: bigint;

    if (context === "profile" || context === "cover") {
      // ── Profile / Cover ──────────────────────────────────────
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
            file_name: keyStr.split("/").pop() || `${context}.${contentType.split("/")[1]}`,
            file_url: url,
            mime_type: contentType,
            size: BigInt(size),
            width: width ? Number(width) : null,
            height: height ? Number(height) : null,
            storage_provider: "r2",
            metadata: JSON.stringify({ r2_key: keyStr }),
          },
          select: { media_id: true },
        }),
      ]);
      mediaId = mediaRow.media_id;
    } else if (context === "service" && serviceId) {
      // ── Service Gallery Media ──────────────────────────────
      const existingCount = await prisma.media.count({
        where: {
          user_id: userId,
          related_type: "service_gallery",
          related_id: BigInt(serviceId),
        },
      });

      const mediaRow = await prisma.media.create({
        data: {
          user_id: userId,
          related_type: "service_gallery",
          related_id: BigInt(serviceId),
          file_name: keyStr.split("/").pop() || "service_media",
          file_url: url,
          mime_type: contentType,
          size: BigInt(size),
          width: width ? Number(width) : null,
          height: height ? Number(height) : null,
          storage_provider: "r2",
          metadata: JSON.stringify({
            r2_key: keyStr,
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
          file_name: keyStr.split("/").pop() || "messaging_media",
          file_url: url,
          mime_type: contentType,
          size: BigInt(size),
          width: width ? Number(width) : null,
          height: height ? Number(height) : null,
          storage_provider: "r2",
          metadata: JSON.stringify({ r2_key: keyStr }),
        },
        select: { media_id: true },
      });
      mediaId = mediaRow.media_id;
    } else {
      // ── Portfolio / General Media ──────────────────────────
      const mediaRow = await prisma.media.create({
        data: {
          user_id: userId,
          related_type: context,
          file_name: keyStr.split("/").pop() || "media",
          file_url: url,
          mime_type: contentType,
          size: BigInt(size),
          width: width ? Number(width) : null,
          height: height ? Number(height) : null,
          storage_provider: "r2",
          metadata: JSON.stringify({ r2_key: keyStr }),
        },
        select: { media_id: true },
      });
      mediaId = mediaRow.media_id;
    }

    return NextResponse.json(
      { mediaId: mediaId.toString(), url },
      { status: 200 }
    );
  } catch (dbError) {
    console.error("[media/register] DB write failed:", dbError);
    return NextResponse.json(
      { error: "Failed to save media record. Please try again." },
      { status: 500 }
    );
  }
}
