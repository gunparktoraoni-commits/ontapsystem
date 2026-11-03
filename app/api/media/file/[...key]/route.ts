// ──────────────────────────────────────────────────────────────
// GET /api/media/file/[...key] — Public R2 media proxy
// ──────────────────────────────────────────────────────────────
// R2 S3 endpoint URLs are private and cannot be loaded in <img>/<video>.
// This route streams objects from R2 so the browser can load them same-origin.
//
// Security:
//   • Path traversal blocked (`..`, absolute paths)
//   • Only known upload folder prefixes are allowed
//   • No listing / no write methods

import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getClientForMediaProxy, getBucketForMediaProxy } from "@/server/lib/r2-storage";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_PREFIXES = [
  "profiles/",
  "covers/",
  "services/",
  "portfolio/",
  "gallery/",
  "support/",
  "messaging/",
  "logos/",
  "notices/",
  "newsletter/",
  "ontap/",
] as const;

function sanitizeKey(parts: string[]): string | null {
  if (!parts.length) return null;
  const key = parts
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    })
    .join("/");

  if (!key || key.includes("..") || key.startsWith("/") || key.includes("\\")) {
    return null;
  }

  if (!ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return null;
  }

  return key;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
  try {
    const { key: keyParts } = await params;
    const key = sanitizeKey(Array.isArray(keyParts) ? keyParts : []);
    if (!key) {
      return NextResponse.json({ error: "Invalid media path." }, { status: 400 });
    }

    const client = getClientForMediaProxy();
    const bucket = getBucketForMediaProxy();

    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );

    if (!response.Body) {
      return NextResponse.json({ error: "Media not found." }, { status: 404 });
    }

    const body = response.Body.transformToWebStream();
    const contentType =
      response.ContentType || "application/octet-stream";

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        ...(response.ContentLength != null
          ? { "Content-Length": String(response.ContentLength) }
          : {}),
        ...(response.ETag ? { ETag: response.ETag } : {}),
      },
    });
  } catch (error: unknown) {
    const name = (error as { name?: string; Code?: string })?.name
      || (error as { Code?: string })?.Code
      || "";
    if (name === "NoSuchKey" || name === "NotFound") {
      return NextResponse.json({ error: "Media not found." }, { status: 404 });
    }
    console.error("[media/file] Failed to stream R2 object:", error);
    return NextResponse.json(
      { error: "Failed to load media." },
      { status: 500 },
    );
  }
}
