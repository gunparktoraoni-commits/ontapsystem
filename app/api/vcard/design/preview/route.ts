import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { cacheSet } from "@/lib/vcard/cache";
import { parseThemeCssVariables, validateThemeIdInput } from "@/lib/vcard/theme-validator";
import { USERNAME_REGEX, resolveProfileByUsernameOrId, serializeBigInts, toNullableString } from "@/lib/vcard/queries";

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = checkRateLimit("vcard-theme-preview", ip);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many preview requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  const q = request.nextUrl.searchParams;
  const username = toNullableString(q.get("username"))?.toLowerCase() ?? null;
  const themeId = validateThemeIdInput(q.get("theme_id"));
  const providedSession = toNullableString(q.get("session_id"));

  if (!username || !USERNAME_REGEX.test(username)) {
    return NextResponse.json({ success: false, error: "username is invalid." }, { status: 400 });
  }
  if (!themeId) {
    return NextResponse.json({ success: false, error: "theme_id is invalid." }, { status: 400 });
  }

  try {
    const [profile, theme] = await Promise.all([
      resolveProfileByUsernameOrId({ username }),
      prisma.theme.findUnique({
        where: { id: themeId },
        select: {
          id: true,
          theme_name: true,
          css_variables: true,
          preview_image: true,
          tag: true,
          price: true,
          is_active: true,
        },
      }),
    ]);

    if (!profile) {
      return NextResponse.json({ success: false, error: "Profile not found." }, { status: 404 });
    }

    if (!theme || !theme.is_active) {
      return NextResponse.json({ success: false, error: "Theme not found." }, { status: 404 });
    }

    const sessionId = providedSession ?? randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);

    const previewPayload = {
      preview: true,
      session_id: sessionId,
      username,
      user_id: profile.user_id.toString(),
      theme: {
        id: theme.id.toString(),
        name: theme.theme_name,
        preview_image: theme.preview_image,
        is_premium: theme.tag !== "free" || Number(theme.price ?? 0) > 0,
        price: Number(theme.price ?? 0),
        css_variables: parseThemeCssVariables(theme.css_variables),
      },
      expires_at: expiresAt.toISOString(),
      profile_is_public: profile.vcard_published && profile.is_active,
    };

    cacheSet(`vcard:preview:${username}:${sessionId}`, previewPayload, 15 * 60);

    return NextResponse.json(serializeBigInts({ success: true, data: previewPayload }), {
      status: 200,
      headers: {
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    console.error("[vcard/design/preview GET] Unexpected error:", error);
    return NextResponse.json(
      { success: false, error: "An unexpected error occurred. Please try again." },
      { status: 500 }
    );
  }
}
