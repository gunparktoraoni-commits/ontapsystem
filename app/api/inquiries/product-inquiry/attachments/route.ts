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
  "image/gif",
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

/**
 * POST /api/inquiries/product-inquiry/attachments
 * Upload reference images/PDFs for a product inquiry (before submit).
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("upload-logo", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many upload requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } },
    );
  }

  const auth = await resolveRequestSession(request);
  if (!auth.session) {
    return NextResponse.json(
      { success: false, error: "Authentication required.", requiresAuth: true },
      { status: 401 },
    );
  }

  const csrfValid = await validateCsrfToken(request);
  if (!csrfValid) {
    return NextResponse.json(
      { success: false, error: "CSRF validation failed.", code: "INVALID_CSRF_TOKEN" },
      { status: 403 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid multipart form data." },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { success: false, error: "Missing file." },
      { status: 400 },
    );
  }

  const mimeType = file.type.toLowerCase().split(";")[0].trim();
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return NextResponse.json(
      {
        success: false,
        error: "Unsupported file type. Use JPG, PNG, WEBP, GIF, or PDF.",
      },
      { status: 400 },
    );
  }

  if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { success: false, error: "File must be between 1 byte and 5 MB." },
      { status: 400 },
    );
  }

  try {
    configureCloudinary();
    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = sanitizeFileName(file.name || "inquiry-attachment");
    const userId = String(auth.session.userId ?? "anon");
    const uploaded = await uploadBuffer(buffer, {
      folder: `ontap/inquiries/${userId}`,
      public_id: `${Date.now()}-${safeName}`,
      resource_type: mimeType === "application/pdf" ? "raw" : "image",
    });

    return NextResponse.json({
      success: true,
      data: {
        url: uploaded.secure_url,
        publicId: uploaded.public_id,
        name: file.name || safeName,
        mimeType,
        size: file.size,
        uploadedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[product-inquiry/attachments]", error);
    return NextResponse.json(
      { success: false, error: "Failed to upload attachment. Please try again." },
      { status: 500 },
    );
  }
}
