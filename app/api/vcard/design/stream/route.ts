import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { parseThemeCssVariables } from "@/lib/vcard/theme-validator";
import { subscribeTheme } from "@/lib/vcard/theme-stream";
import { USERNAME_REGEX, resolveProfileByUsernameOrId, toNullableString } from "@/lib/vcard/queries";

export const runtime = "nodejs";

async function getCurrentThemePayload(username: string) {
  const profile = await resolveProfileByUsernameOrId({ username });
  if (!profile || !profile.vcard_published || !profile.is_active) return null;
  const themePath = profile.theme_path;
  if (!themePath) return null;

  const theme = await prisma.theme.findFirst({
    where: {
      theme_path: themePath,
      is_active: true,
    },
    select: {
      id: true,
      theme_name: true,
      css_variables: true,
      preview_image: true,
      tag: true,
      price: true,
    },
  });

  if (!theme) {
    return {
      username: profile.custom_uri ?? profile.serial_id ?? `user-${profile.user_id.toString()}`,
      theme: {
        id: themePath,
        name: themePath,
        preview_image: null,
        is_premium: false,
        price: 0,
        css_variables: {},
      },
      updated_at: profile.updated_at?.toISOString() ?? new Date().toISOString(),
    };
  }

  return {
    username: profile.custom_uri ?? profile.serial_id ?? `user-${profile.user_id.toString()}`,
    theme: {
      id: theme.id.toString(),
      name: theme.theme_name,
      preview_image: theme.preview_image,
      is_premium: theme.tag !== "free" || Number(theme.price ?? 0) > 0,
      price: Number(theme.price ?? 0),
      css_variables: parseThemeCssVariables(theme.css_variables),
    },
    updated_at: profile.updated_at?.toISOString() ?? new Date().toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = checkRateLimit("vcard-theme-stream", ip);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many stream requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  const username = toNullableString(request.nextUrl.searchParams.get("username"))?.toLowerCase() ?? null;
  if (!username || !USERNAME_REGEX.test(username)) {
    return NextResponse.json({ success: false, error: "username is invalid." }, { status: 400 });
  }

  const initialPayload = await getCurrentThemePayload(username);
  if (!initialPayload) {
    return NextResponse.json({ success: false, error: "Profile not found." }, { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (event: string, payload: unknown) => {
        const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
        controller.enqueue(encoder.encode(data));
      };

      write("theme", initialPayload);

      const unsubscribe = subscribeTheme(username, (payload) => {
        write("theme", payload);
      });

      const heartbeat = setInterval(() => {
        write("ping", { time: Date.now() });
      }, 30_000);

      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Ignore close errors when stream already ended.
        }
      });
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
