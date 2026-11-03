import { NextRequest, NextResponse } from "next/server";
import { ThemeService } from "@/lib/services/theme.service";
import { AppError, ErrorCode, createUnauthorizedError, createValidationError } from "@/lib/errors/types";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

interface PreviewPayload {
  bizcardId?: unknown;
  themeId?: unknown;
  colorWayId?: unknown;
}

function parsePositiveInt(value: unknown, field: string, requestId: string): number {
  const num = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(num) || num <= 0) {
    throw createValidationError(field, "must be a positive integer", requestId);
  }
  return num;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();

  try {
    const resolved = await resolveRequestSession(request, { tryRefresh: true });
    if (!resolved.session) {
      throw createUnauthorizedError("Authentication required", requestId);
    }

    const ip = getClientIp(request);
    const rate = checkRateLimit("vcard-theme-preview", `${ip}:${resolved.session.userId}`);
    if (!rate.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: ErrorCode.RATE_LIMIT_EXCEEDED,
            message: "Too many preview requests. Please try again later.",
            retryAfter: Math.ceil(rate.retryAfterMs / 1000),
            requestId,
          },
          meta: { requestId, responseTime: Date.now() - startedAt },
        },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) } }
      );
    }

    let body: PreviewPayload;
    try {
      body = (await request.json()) as PreviewPayload;
    } catch {
      throw createValidationError("body", "must be valid JSON", requestId);
    }

    const bizcardId = parsePositiveInt(body.bizcardId, "bizcardId", requestId);
    const themeId = parsePositiveInt(body.themeId, "themeId", requestId);
    const colorWayId = parsePositiveInt(body.colorWayId, "colorWayId", requestId);

    const service = new ThemeService(requestId);
    const preview = await service.createPreviewSession(
      bizcardId,
      themeId,
      colorWayId,
      String(resolved.session.userId)
    );

    return jsonSuccess(preview, {
      requestId,
      responseTime: Date.now() - startedAt,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/bizcard/theme/preview POST] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
