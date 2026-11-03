import { NextRequest, NextResponse } from "next/server";
import { validateToken, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  applyVcardThemeSelection,
  parseThemeSelectionPayload,
  ThemeSelectionError,
} from "@/lib/services/vcard-theme-selection.service";

function withDeprecationHeaders(headers: HeadersInit = {}): HeadersInit {
  return {
    ...headers,
    Deprecation: "true",
    Sunset: "Sat, 31 Dec 2026 23:59:59 GMT",
  };
}

export async function PATCH(request: NextRequest) {
  const ip = getClientIp(request);

  try {
    const rateCheck = checkRateLimit("bizcard-theme-apply", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Too many theme changes. Please try again later.",
          },
        },
        {
          status: 429,
          headers: withDeprecationHeaders({
            "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)),
          }),
        }
      );
    }

    const rawToken = request.cookies.get("session_token")?.value;
    if (!rawToken) {
      return NextResponse.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication required.",
          },
        },
        { status: 401, headers: withDeprecationHeaders() }
      );
    }

    const session = await validateToken(rawToken);
    if (!session) {
      return NextResponse.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication required.",
          },
        },
        { status: 401, headers: withDeprecationHeaders() }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Invalid JSON body.",
          },
        },
        { status: 400, headers: withDeprecationHeaders() }
      );
    }

    const parsed = parseThemeSelectionPayload(body);
    const data = await applyVcardThemeSelection({
      sessionUserId: BigInt(session.userId),
      themeId: parsed.themeId,
      previewOnly: parsed.previewOnly,
      alias: parsed.alias,
    });

    return NextResponse.json(
      {
        success: true,
        data,
      },
      { status: 200, headers: withDeprecationHeaders() }
    );
  } catch (err) {
    if (err instanceof ThemeSelectionError) {
      return NextResponse.json(
        {
          error: {
            code: err.code,
            message: err.message,
          },
        },
        { status: err.status, headers: withDeprecationHeaders() }
      );
    }

    console.error("[bizcard/user/theme PATCH] Unhandled error:", err);
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "An unexpected error occurred.",
        },
      },
      { status: 500, headers: withDeprecationHeaders() }
    );
  }
}
