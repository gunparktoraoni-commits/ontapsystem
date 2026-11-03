import { NextRequest, NextResponse } from "next/server";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  applyVcardThemeSelection,
  parseThemeSelectionPayload,
  ThemeSelectionError,
} from "@/lib/services/vcard-theme-selection.service";

interface SaveThemePayload {
  bizcardId?: unknown;
  themeId?: unknown;
  theme_id?: unknown;
  colorWayId?: unknown;
  preview_only?: unknown;
  previewOnly?: unknown;
  alias?: unknown;
  username?: unknown;
}

function withDeprecationHeaders(headers: HeadersInit = {}): HeadersInit {
  return {
    ...headers,
    Deprecation: "true",
    Sunset: "Sat, 31 Dec 2026 23:59:59 GMT",
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
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
        { status: 401, headers: withDeprecationHeaders() }
      );
    }

    const ip = getClientIp(request);
    const rate = checkRateLimit("bizcard-theme-apply", `${ip}:${resolved.session.userId}`);
    if (!rate.allowed) {
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
            "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)),
          }),
        }
      );
    }

    let body: SaveThemePayload;
    try {
      body = (await request.json()) as SaveThemePayload;
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

    const parsed = parseThemeSelectionPayload({
      theme_id: body.theme_id ?? body.themeId,
      preview_only: body.preview_only ?? body.previewOnly,
      alias: body.alias ?? body.username,
    });
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
      {
        status: 200,
        headers: withDeprecationHeaders(),
      }
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
        { status: error.status, headers: withDeprecationHeaders() }
      );
    }

    console.error("[api/bizcard/theme POST] Unexpected error", { error });
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "An unexpected error occurred. Please try again.",
        },
      },
      { status: 500, headers: withDeprecationHeaders() }
    );
  }
}
