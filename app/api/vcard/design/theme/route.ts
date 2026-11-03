import { NextRequest, NextResponse } from "next/server";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  applyVcardThemeSelection,
  parseThemeSelectionPayload,
  ThemeSelectionError,
} from "@/lib/services/vcard-theme-selection.service";

function withSecurityHeaders(headers: HeadersInit = {}): HeadersInit {
  return {
    ...headers,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

export async function PUT(request: NextRequest) {
  try {
    const resolved = await resolveRequestSession(request, { tryRefresh: true });
    if (!resolved.session) {
      return NextResponse.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication required.",
          },
        },
        { status: 401, headers: withSecurityHeaders() }
      );
    }

    const ip = getClientIp(request);
    const rl = checkRateLimit("vcard-theme-update", `${ip}:${resolved.session.userId}`);
    if (!rl.allowed) {
      return NextResponse.json(
        {
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Too many requests.",
          },
        },
        {
          status: 429,
          headers: withSecurityHeaders({
            "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)),
          }),
        }
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Invalid JSON body.",
          },
        },
        { status: 400, headers: withSecurityHeaders() }
      );
    }

    const parsed = parseThemeSelectionPayload(rawBody);
    const data = await applyVcardThemeSelection({
      sessionUserId: BigInt(resolved.session.userId),
      themeId: parsed.themeId,
      previewOnly: parsed.previewOnly,
      alias: parsed.alias,
    });

    return NextResponse.json(
      {
        success: true,
        data,
      },
      { status: 200, headers: withSecurityHeaders() }
    );
  } catch (error) {
    if (error instanceof ThemeSelectionError) {
      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.message,
          },
        },
        { status: error.status, headers: withSecurityHeaders() }
      );
    }

    console.error("[vcard/design/theme PUT] Unexpected error:", error);
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "An unexpected error occurred. Please try again.",
        },
      },
      { status: 500, headers: withSecurityHeaders() }
    );
  }
}
