export const SERVICE_VIDEO_MAX_BYTES = 30 * 1024 * 1024;
export const SERVICE_VIDEO_MAX_DURATION_SEC = 15;
export const SIGNED_UPLOAD_THRESHOLD_BYTES = 4 * 1024 * 1024;

function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read video metadata."));
    };
    video.src = url;
  });
}

export async function validateServiceVideo(file: File): Promise<string | null> {
  if (file.size > SERVICE_VIDEO_MAX_BYTES) {
    return `Video must be ${SERVICE_VIDEO_MAX_BYTES / (1024 * 1024)} MB or smaller.`;
  }

  try {
    const duration = await readVideoDuration(file);
    if (!Number.isFinite(duration) || duration > SERVICE_VIDEO_MAX_DURATION_SEC) {
      return `Video must be ${SERVICE_VIDEO_MAX_DURATION_SEC} seconds or shorter.`;
    }
  } catch {
    return "Could not validate video duration. Try another file.";
  }

  return null;
}

type SignedUploadParams = {
  signature: string;
  timestamp: number;
  api_key: string;
  cloud_name: string;
  upload_url: string;
  folder: string;
  public_id: string;
};

export async function uploadFileViaSignedCloudinary(
  file: File,
  signResponse: SignedUploadParams,
): Promise<{
  secure_url: string;
  public_id: string;
  resource_type: string;
  format: string;
  bytes: number;
  width?: number;
  height?: number;
}> {
  const form = new FormData();
  form.append("file", file);
  form.append("signature", signResponse.signature);
  form.append("timestamp", String(signResponse.timestamp));
  form.append("api_key", signResponse.api_key);
  form.append("folder", signResponse.folder);
  form.append("public_id", signResponse.public_id);
  form.append("overwrite", "1");

  const response = await fetch(signResponse.upload_url, {
    method: "POST",
    body: form,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.secure_url) {
    throw new Error(payload?.error?.message || "Cloudinary upload failed.");
  }

  return payload;
}

export async function uploadBizcardGalleryVideo(
  apiBase: string,
  bizcardId: string,
  file: File,
  meta: { title: string; description: string },
  headers: HeadersInit = {},
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const validationError = await validateServiceVideo(file);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  if (file.size <= SIGNED_UPLOAD_THRESHOLD_BYTES) {
    const form = new FormData();
    form.append("file", file);
    form.append("title", meta.title);
    form.append("description", meta.description);
    form.append("category", "video");
    const res = await fetch(`${apiBase}/api/bizcard/${encodeURIComponent(bizcardId)}/gallery`, {
      method: "POST",
      credentials: "include",
      headers,
      body: form,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, error: json?.error?.message || json?.error || "Gallery upload failed." };
    }
    const url = json?.data?.url || json?.data?.file_url || json?.url;
    return { ok: true, url: typeof url === "string" ? url : "" };
  }

  const signRes = await fetch(`${apiBase}/api/media/sign`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...Object.fromEntries(new Headers(headers)) },
    body: JSON.stringify({
      context: "portfolio",
      mime_type: file.type || "video/mp4",
    }),
  });
  const signJson = await signRes.json().catch(() => null);
  if (!signRes.ok || !signJson?.signature) {
    return { ok: false, error: signJson?.error || "Could not prepare video upload." };
  }

  try {
    const cloudinary = await uploadFileViaSignedCloudinary(file, signJson);
    const form = new FormData();
    form.append("media_url", cloudinary.secure_url);
    form.append("public_id", cloudinary.public_id);
    form.append("mime_type", file.type || "video/mp4");
    form.append("bytes", String(cloudinary.bytes ?? file.size));
    form.append("title", meta.title);
    form.append("description", meta.description);
    form.append("category", "video");
    const res = await fetch(`${apiBase}/api/bizcard/${encodeURIComponent(bizcardId)}/gallery`, {
      method: "POST",
      credentials: "include",
      headers,
      body: form,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, error: json?.error?.message || json?.error || "Gallery import failed." };
    }
    const url = json?.data?.url || cloudinary.secure_url;
    return { ok: true, url: typeof url === "string" ? url : cloudinary.secure_url };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Signed video upload failed.",
    };
  }
}
