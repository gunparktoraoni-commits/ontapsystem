import { NextRequest, NextResponse } from "next/server";

import {
  isCrossPortalServiceConfigured,
  verifyCrossPortalServiceRequest,
} from "@/server/lib/cross-portal-service-auth";

const MAX_INTERNAL_BODY_BYTES = 8 * 1024;

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function internalSuccess<T>(data: T, requestId: string, startedAt: number): NextResponse {
  return noStore(
    NextResponse.json({
      success: true,
      data,
      meta: {
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    }),
  );
}

export function internalError(
  code: string,
  message: string,
  status: number,
  requestId: string,
  headers?: Record<string, string>,
): NextResponse {
  const response = NextResponse.json(
    {
      success: false,
      error: { code, message },
      meta: { requestId, timestamp: new Date().toISOString() },
    },
    { status },
  );
  for (const [key, value] of Object.entries(headers ?? {})) {
    response.headers.set(key, value);
  }
  return noStore(response);
}

/**
 * Verify a signed SmartPet → OnTap POST and return its parsed JSON body.
 * Signature is checked over the exact raw body before anything is parsed.
 */
export async function readSignedInternalJson(
  req: NextRequest,
  path: string,
  requestId: string,
): Promise<{ ok: true; json: unknown } | { ok: false; response: NextResponse }> {
  if (!isCrossPortalServiceConfigured()) {
    return {
      ok: false,
      response: internalError("SERVICE_UNAVAILABLE", "Cross-portal service is not configured.", 503, requestId),
    };
  }

  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_INTERNAL_BODY_BYTES) {
    return { ok: false, response: internalError("PAYLOAD_TOO_LARGE", "Request body is too large.", 413, requestId) };
  }

  const bodyText = await req.text();
  if (Buffer.byteLength(bodyText, "utf8") > MAX_INTERNAL_BODY_BYTES) {
    return { ok: false, response: internalError("PAYLOAD_TOO_LARGE", "Request body is too large.", 413, requestId) };
  }

  try {
    verifyCrossPortalServiceRequest({ method: "POST", path, bodyText, headers: req.headers });
  } catch (error) {
    const code = error instanceof Error ? error.message : "CROSS_PORTAL_AUTH_INVALID";
    return {
      ok: false,
      response: internalError(
        "CROSS_PORTAL_AUTH_FAILED",
        "Cross-portal service authentication failed.",
        code === "CROSS_PORTAL_AUTH_REPLAY" ? 409 : 401,
        requestId,
      ),
    };
  }

  try {
    return { ok: true, json: JSON.parse(bodyText || "{}") as unknown };
  } catch {
    return { ok: false, response: internalError("INVALID_REQUEST_PAYLOAD", "Invalid JSON body.", 400, requestId) };
  }
}
