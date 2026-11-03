import { NextRequest, NextResponse } from "next/server";
import { v2 as cloudinary } from "cloudinary";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { validateCsrfToken } from "@/lib/csrf";

export const maxDuration = 60;

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
]);
const MAX_FILE_SIZE = 5 * 1024 * 1024;

let cloudinaryConfigured = false;

function configureCloudinary() {
  if (cloudinaryConfigured) return;

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (cloudName && apiKey && apiSecret) {
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
    cloudinaryConfigured = true;
    return;
  }

  const url = process.env.CLOUDINARY_URL;
  if (url) {
    cloudinary.config({ secure: true, cloudinary_url: url });
    cloudinaryConfigured = true;
    return;
  }

  throw new Error("Cloudinary credentials are not configured.");
}

function sanitizeFileName(fileName: string): string {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80);
}

function uploadBuffer(buffer: Buffer, options: Record<string, unknown>) {
  return new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err || !result) {
        reject(err ?? new Error("Cloudinary upload failed."));
        return;
      }
      resolve({ secure_url: result.secure_url, public_id: result.public_id });
    });

    stream.end(buffer);
  });
}

export async function POST(request: NextRequest) {
  const requestId = `${Date.now()}`;
  const ip = getClientIp(request);

  const rateCheck = checkRateLimit("upload-logo", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many upload requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } },
    );
  }

  const resolved = await resolveRequestSession(request);
  if (!resolved.session) {
    return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  }

  const csrfValid = await validateCsrfToken(request);
  if (!csrfValid) {
    return NextResponse.json({ success: false, error: "CSRF validation failed." }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid multipart form data." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: "Missing file upload." }, { status: 400 });
  }

  const mimeType = file.type?.toLowerCase().trim() || "";
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return NextResponse.json(
      { success: false, error: "Unsupported file type." },
      { status: 400 },
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { success: false, error: "Logo file must be 5 MB or smaller." },
      { status: 413 },
    );
  }

  try {
    configureCloudinary();
    const buffer = Buffer.from(await file.arrayBuffer());
    const folder = `custom-logos/${resolved.session.userId}`;
    const publicId = `${Date.now()}-${sanitizeFileName(file.name || "logo")}`;

    const result = await uploadBuffer(buffer, {
      folder,
      public_id: publicId,
      resource_type: "auto",
      overwrite: true,
      invalidate: true,
    });

    return NextResponse.json({
      success: true,
      url: result.secure_url,
      publicId: result.public_id,
      requestId,
    });
  } catch (error) {
    console.error("[upload/logo]", error);
    return NextResponse.json({ success: false, error: "Failed to upload logo." }, { status: 500 });
  }
}