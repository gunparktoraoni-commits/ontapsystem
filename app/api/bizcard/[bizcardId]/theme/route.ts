import { NextRequest } from "next/server";
import { ThemeService } from "@/lib/services/theme.service";
import { AppError, createUnauthorizedError, createValidationError } from "@/lib/errors/types";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { resolveRequestSession } from "@/server/lib/auth";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ bizcardId: string }> }
) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();

  try {
    const resolved = await resolveRequestSession(request, { tryRefresh: true });
    if (!resolved.session) {
      throw createUnauthorizedError("Authentication required", requestId);
    }

    const { bizcardId: rawBizcardId } = await context.params;
    const bizcardId = Number.parseInt(rawBizcardId, 10);
    if (!Number.isInteger(bizcardId) || bizcardId <= 0) {
      throw createValidationError("bizcardId", "must be a positive integer", requestId);
    }

    const service = new ThemeService(requestId);
    const selection = await service.getUserThemeSelection(bizcardId, String(resolved.session.userId));

    return jsonSuccess(selection, {
      requestId,
      responseTime: Date.now() - startedAt,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/bizcard/:bizcardId/theme GET] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
