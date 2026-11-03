// app/api/bizcard/[bizcardId]/gallery/[mediaId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, resolveEffectiveUserId, getClientIp, getUserAgent } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { validateUploadedFile } from "@/server/lib/media";
import { GalleryMediaService } from "@/lib/services/gallery-media.service";
import { AppError, createUnauthorizedError, createValidationError, ErrorCode } from "@/lib/errors/types";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { MediaErrorCode, toErrorCode } from "@/lib/errors/media-errors";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, value) => (typeof value === "bigint" ? value.toString() : value)));

function parsePositiveInt(raw: string, field: string, requestId: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw createValidationError(field, "must be a positive integer", requestId);
  }
  return value;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ bizcardId: string; mediaId: string }> }
): Promise<NextResponse> {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();

  try {
    const resolved = await resolveRequestSession(request, { tryRefresh: true });
    if (!resolved.session) {
      throw createUnauthorizedError("Authentication required", requestId);
    }

    const effectiveUserId = resolveEffectiveUserId(resolved);
    const ip = getClientIp(request);
    const rate = checkRateLimit("bizcard-gallery-update", `${ip}:${effectiveUserId}`);
    if (!rate.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: ErrorCode.RATE_LIMIT_EXCEEDED,
            message: "Too many update attempts. Please try again later.",
            requestId,
            retryAfter: Math.ceil(rate.retryAfterMs / 1000),
          },
          meta: { requestId, responseTime: Date.now() - startedAt },
        },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } }
      );
    }

    const { bizcardId: rawBizcardId, mediaId: rawMediaId } = await params;
    const bizcardId = parsePositiveInt(rawBizcardId, "bizcardId", requestId);
    const mediaId = parsePositiveInt(rawMediaId, "mediaId", requestId);

    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    const isMultipart = contentType.includes("multipart/form-data");

    let updates: {
      alt_text?: string | null;
      title?: string | null;
      description?: string | null;
      display_order?: number;
      is_featured?: boolean;
    } = {};
    let replacementFile:
      | {
          fileBuffer: Buffer;
          originalName: string;
          mimeType: string;
        }
      | undefined;

    if (isMultipart) {
      let formData: FormData;
      try {
        formData = await request.formData();
      } catch {
        throw createValidationError("body", "must be multipart/form-data", requestId);
      }

      const titleRaw = formData.get("title");
      const descriptionRaw = formData.get("description");
      const altRaw = formData.get("alt_text");
      if (typeof titleRaw === "string") updates.title = titleRaw;
      if (typeof descriptionRaw === "string") updates.description = descriptionRaw;
      if (typeof altRaw === "string") updates.alt_text = altRaw;

      const file = formData.get("file");
      if (file instanceof File) {
        const mimeType = file.type.toLowerCase().split(";")[0].trim();
        const kind = mimeType.startsWith("video/") ? "video" : "image";
        const validation = validateUploadedFile(mimeType, file.size, kind);
        if (!validation.valid) {
          const code =
            validation.code === "FILE_TOO_LARGE"
              ? toErrorCode(MediaErrorCode.MEDIA_TOO_LARGE)
              : toErrorCode(MediaErrorCode.MEDIA_INVALID_TYPE);
          throw new AppError(
            code,
            validation.error,
            validation.code === "FILE_TOO_LARGE" ? 413 : 400,
            {},
            requestId,
          );
        }
        const bytes = await file.arrayBuffer();
        replacementFile = {
          fileBuffer: Buffer.from(bytes),
          originalName: file.name || `gallery-${Date.now()}`,
          mimeType,
        };
      }
    } else {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        throw createValidationError("body", "must be valid JSON", requestId);
      }

      if (!body || typeof body !== "object") {
        throw createValidationError("body", "must be a JSON object", requestId);
      }

      const payload = body as Record<string, unknown>;
      updates = {
        alt_text:
          payload.alt_text === null ? null : typeof payload.alt_text === "string" ? payload.alt_text : undefined,
        title: payload.title === null ? null : typeof payload.title === "string" ? payload.title : undefined,
        description:
          payload.description === null
            ? null
            : typeof payload.description === "string"
              ? payload.description
              : undefined,
        display_order: typeof payload.display_order === "number" ? payload.display_order : undefined,
        is_featured: typeof payload.is_featured === "boolean" ? payload.is_featured : undefined,
      };
    }

    const hasAnyUpdate =
      Boolean(replacementFile) || Object.values(updates).some((value) => value !== undefined);
    if (!hasAnyUpdate) {
      throw createValidationError(
        "body",
        "must provide at least one updatable field or a replacement file",
        requestId,
      );
    }

    const service = new GalleryMediaService(requestId);
    const updated = await service.updateMedia({
      bizcardId,
      userId: String(effectiveUserId),
      mediaId,
      updates,
      file: replacementFile,
      ip,
      userAgent: getUserAgent(request),
    });

    return jsonSuccess(serialize(updated), { requestId, responseTime: Date.now() - startedAt }, 200);
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/bizcard/[bizcardId]/gallery/[mediaId] PUT] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ bizcardId: string; mediaId: string }> }
): Promise<NextResponse> {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();

  try {
    const resolved = await resolveRequestSession(request, { tryRefresh: true });
    if (!resolved.session) {
      throw createUnauthorizedError("Authentication required", requestId);
    }

    const effectiveUserId = resolveEffectiveUserId(resolved);
    const ip = getClientIp(request);
    const rate = checkRateLimit("bizcard-gallery-delete", `${ip}:${effectiveUserId}`);
    if (!rate.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: ErrorCode.RATE_LIMIT_EXCEEDED,
            message: "Too many delete attempts. Please try again later.",
            requestId,
            retryAfter: Math.ceil(rate.retryAfterMs / 1000),
          },
          meta: { requestId, responseTime: Date.now() - startedAt },
        },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } }
      );
    }

    const { bizcardId: rawBizcardId, mediaId: rawMediaId } = await params;
    const bizcardId = parsePositiveInt(rawBizcardId, "bizcardId", requestId);
    const mediaId = parsePositiveInt(rawMediaId, "mediaId", requestId);
    const permanent = request.nextUrl.searchParams.get("permanent") === "true";

    const service = new GalleryMediaService(requestId);
    await service.deleteMedia({
      bizcardId,
      userId: String(effectiveUserId),
      mediaId,
      permanent,
      ip,
      userAgent: getUserAgent(request),
    });

    return jsonSuccess(
      { deleted: true, mediaId, permanent },
      { requestId, responseTime: Date.now() - startedAt },
      200
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/bizcard/[bizcardId]/gallery/[mediaId] DELETE] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
