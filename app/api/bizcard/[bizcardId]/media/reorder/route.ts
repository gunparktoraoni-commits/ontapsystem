import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, getClientIp, getUserAgent } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { AppError, createUnauthorizedError, createValidationError, ErrorCode } from "@/lib/errors/types";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { MediaService } from "@/lib/services/media.service";

function parsePositiveInt(raw: string, field: string, requestId: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw createValidationError(field, "must be a positive integer", requestId);
  }
  return value;
}

function parseOrderedIds(body: unknown, requestId: string): number[] {
  if (!body || typeof body !== "object") {
    throw createValidationError("body", "must be a JSON object", requestId);
  }

  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.orderedMediaIds)) {
    throw createValidationError("orderedMediaIds", "must be an array of media IDs", requestId);
  }

  return record.orderedMediaIds.map((id, index) => {
    const value = Number(id);
    if (!Number.isInteger(value) || value <= 0) {
      throw createValidationError(`orderedMediaIds[${index}]`, "must be a positive integer", requestId);
    }
    return value;
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bizcardId: string }> }
): Promise<NextResponse> {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();

  try {
    const session = await resolveRequestSession(request, { tryRefresh: true });
    if (!session.session) {
      throw createUnauthorizedError("Authentication required", requestId);
    }

    const ip = getClientIp(request);
    const rate = checkRateLimit("bizcard-media-reorder", `${ip}:${session.session.userId}`);
    if (!rate.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: ErrorCode.RATE_LIMIT_EXCEEDED,
            message: "Too many reorder attempts. Please try again later.",
            requestId,
            retryAfter: Math.ceil(rate.retryAfterMs / 1000),
          },
          meta: { requestId, responseTime: Date.now() - startedAt },
        },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } }
      );
    }

    const { bizcardId: rawBizcardId } = await params;
    const bizcardId = parsePositiveInt(rawBizcardId, "bizcardId", requestId);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw createValidationError("body", "must be valid JSON", requestId);
    }

    const orderedMediaIds = parseOrderedIds(body, requestId);

    const service = new MediaService(requestId);
    await service.reorderMedia({
      bizcardId,
      userId: session.session.userId,
      orderedMediaIds,
      ip,
      userAgent: getUserAgent(request),
    });

    return jsonSuccess({ reordered: true, orderedMediaIds }, { requestId, responseTime: Date.now() - startedAt }, 200);
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/bizcard/[bizcardId]/media/reorder POST] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
