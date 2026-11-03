// app/api/bizcard/[bizcardId]/gallery/route.ts
import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, resolveEffectiveUserId, getClientIp, getUserAgent } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { validateUploadedFile, SERVICE_VIDEO_MAX_BYTES } from "@/server/lib/media";
import { GalleryMediaService } from "@/lib/services/gallery-media.service";
import { AppError, createNotFoundError, createUnauthorizedError, createValidationError, ErrorCode } from "@/lib/errors/types";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { MediaErrorCode, toErrorCode } from "@/lib/errors/media-errors";
import { subscriptionService } from "@/lib/services/subscription.service";
import { createUpgradeRequiredError } from "@/lib/errors/subscription-errors";
import { isPrivilegedPremiumRole } from "@/lib/auth/privileged-premium";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, value) => (typeof value === "bigint" ? value.toString() : value)));

function parseBizcardId(raw: string, requestId: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw createValidationError("bizcardId", "must be a positive integer", requestId);
  }
  return value;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bizcardId: string }> }
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
    const rate = checkRateLimit("bizcard-gallery-list", `${ip}:${effectiveUserId}`);
    if (!rate.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: ErrorCode.RATE_LIMIT_EXCEEDED,
            message: "Too many requests. Please try again later.",
            requestId,
            retryAfter: Math.ceil(rate.retryAfterMs / 1000),
          },
          meta: { requestId, responseTime: Date.now() - startedAt },
        },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } }
      );
    }

    const { bizcardId: rawBizcardId } = await params;
    const bizcardId = parseBizcardId(rawBizcardId, requestId);

    const service = new GalleryMediaService(requestId);
    const media = await service.getUserGallery(bizcardId, String(effectiveUserId));

    return jsonSuccess(
      serialize({ bizcardId, media, total: media.length }),
      { requestId, responseTime: Date.now() - startedAt },
      200
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/bizcard/[bizcardId]/gallery GET] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bizcardId: string }> }
): Promise<NextResponse> {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();

  try {
    const resolved = await resolveRequestSession(request, { tryRefresh: true });
    if (!resolved.session) {
      throw createUnauthorizedError("Authentication required", requestId);
    }

    const effectiveUserId = resolveEffectiveUserId(resolved);
    const userId = BigInt(effectiveUserId);
    const isPrivilegedPremium = isPrivilegedPremiumRole(resolved.session.role);
    const canUploadGallery = isPrivilegedPremium || await subscriptionService.checkFeatureAccess(
      userId,
      "canUploadGallery"
    );
    if (!canUploadGallery) {
      const status = await subscriptionService.getSubscriptionStatus(userId);
      const error = createUpgradeRequiredError(
        "gallery upload",
        "standard",
        status.tier
      );
      return NextResponse.json(
        {
          ...error,
          meta: { requestId, timestamp: new Date().toISOString() },
        },
        { status: 403 }
      );
    }

    const ip = getClientIp(request);
    const rate = checkRateLimit("bizcard-gallery-upload", `${ip}:${effectiveUserId}`);
    if (!rate.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: ErrorCode.RATE_LIMIT_EXCEEDED,
            message: "Too many uploads. Please try again later.",
            requestId,
            retryAfter: Math.ceil(rate.retryAfterMs / 1000),
          },
          meta: { requestId, responseTime: Date.now() - startedAt },
        },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } }
      );
    }

    const { bizcardId: rawBizcardId } = await params;
    const bizcardId = parseBizcardId(rawBizcardId, requestId);

    const targetBizcard = await prisma.bizcard.findFirst({
      where: {
        bizcard_id: BigInt(bizcardId),
        user_id: userId,
        deactivated_flag: false,
      },
      select: {
        subscription_tier: true,
      },
    });

    if (!targetBizcard) {
      throw createNotFoundError("Bizcard", rawBizcardId, requestId);
    }

    if (!isPrivilegedPremium && targetBizcard.subscription_tier === "basic") {
      const error = createUpgradeRequiredError(
        "gallery upload",
        "standard",
        "basic"
      );
      return NextResponse.json(
        {
          ...error,
          meta: { requestId, timestamp: new Date().toISOString() },
        },
        { status: 403 }
      );
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      throw createValidationError("body", "must be multipart/form-data", requestId);
    }

    const file = formData.get("file");
    const mediaUrl = (formData.get("media_url") as string | null)?.trim() || null;
    const title = (formData.get("title") as string | null) ?? undefined;
    const description = (formData.get("description") as string | null) ?? undefined;
    const isFeatured = formData.get("is_featured") === "true";
    const category = (formData.get("category") as string | null) ?? "gallery";

    const service = new GalleryMediaService(requestId);
    const userIdStr = String(effectiveUserId);

    if (!(file instanceof File) && mediaUrl) {
      const mimeType = ((formData.get("mime_type") as string | null) ?? "video/mp4")
        .toLowerCase()
        .split(";")[0]
        .trim();
      const kind = mimeType.startsWith("video/") ? "video" : "image";
      const bytes = Number(formData.get("bytes") ?? 0);
      const validation = validateUploadedFile(mimeType, bytes, kind, {
        maxBytes: category === "video" || kind === "video" ? SERVICE_VIDEO_MAX_BYTES : undefined,
      });
      if (!validation.valid) {
        const code = validation.code === "FILE_TOO_LARGE"
          ? toErrorCode(MediaErrorCode.MEDIA_TOO_LARGE)
          : toErrorCode(MediaErrorCode.MEDIA_INVALID_TYPE);
        throw new AppError(code, validation.error, validation.code === "FILE_TOO_LARGE" ? 413 : 400, {}, requestId);
      }

      const publicId = (formData.get("public_id") as string | null)?.trim();
      if (!publicId) {
        throw createValidationError("public_id", "is required when media_url is provided", requestId);
      }

      const created = await service.registerCloudinaryMedia({
        bizcardId,
        userId: userIdStr,
        secureUrl: mediaUrl,
        publicId,
        mimeType,
        bytes: Number.isFinite(bytes) ? bytes : 0,
        fileCategory: category,
        metadata: {
          title,
          description,
          is_featured: isFeatured,
        },
        ip,
        userAgent: getUserAgent(request),
      });

      return jsonSuccess(serialize(created), { requestId, responseTime: Date.now() - startedAt }, 201);
    }

    if (!(file instanceof File)) {
      throw new AppError(
        toErrorCode(MediaErrorCode.MEDIA_NO_FILE),
        "No file provided",
        400,
        {},
        requestId
      );
    }

    const mimeTypeRaw = file.type.toLowerCase().split(";")[0].trim();
    const mimeType =
      category === "video" && !mimeTypeRaw.startsWith("video/")
        ? "video/mp4"
        : mimeTypeRaw;
    const kind =
      category === "video" || mimeType.startsWith("video/") ? "video" : "image";
    const validation = validateUploadedFile(mimeType, file.size, kind, {
      maxBytes: category === "video" || kind === "video" ? SERVICE_VIDEO_MAX_BYTES : undefined,
    });
    if (!validation.valid) {
      const code = validation.code === "FILE_TOO_LARGE"
        ? toErrorCode(MediaErrorCode.MEDIA_TOO_LARGE)
        : toErrorCode(MediaErrorCode.MEDIA_INVALID_TYPE);
      throw new AppError(code, validation.error, validation.code === "FILE_TOO_LARGE" ? 413 : 400, {}, requestId);
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const created = await service.uploadMedia({
      bizcardId,
      userId: userIdStr,
      fileBuffer: buffer,
      originalName: file.name,
      mimeType,
      fileCategory: category,
      metadata: {
        title,
        description,
        is_featured: isFeatured,
      },
      ip,
      userAgent: getUserAgent(request),
    });

    return jsonSuccess(serialize(created), { requestId, responseTime: Date.now() - startedAt }, 201);
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/bizcard/[bizcardId]/gallery POST] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
