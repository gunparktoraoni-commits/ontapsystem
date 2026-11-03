import { NextRequest, NextResponse } from "next/server";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { resolvePhysicalCardScan } from "@/lib/bizcard/scan-routing";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serialId: string }> }
) {
  const ip = getClientIp(request);
  const startedAt = Date.now();

  try {
    const rateCheck = checkRateLimit("bizcard-resolve", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            tag: "[BIZCARD_SCAN_API]",
            message: "Too many scan requests. Please slow down.",
          },
        },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    const { serialId } = await params;

    let sessionUserId: bigint | null = null;
    try {
      const resolved = await resolveRequestSession(request, { tryRefresh: true });
      sessionUserId = resolved.session ? BigInt(resolved.session.userId) : null;
    } catch (sessionErr) {
      console.error("[BIZCARD_SCAN_API] Session resolution failed, continuing anonymously", sessionErr);
    }

    const result = await resolvePhysicalCardScan(serialId, sessionUserId);

    const wantsRedirect = request.nextUrl.searchParams.get("redirect") === "true";
    if (wantsRedirect && result.redirectUrl && result.nextAction !== "show_portfolio") {
      return NextResponse.redirect(new URL(result.redirectUrl, request.url), { status: 307 });
    }

    if (wantsRedirect && result.nextAction === "show_portfolio" && result.redirectUrl) {
      return NextResponse.redirect(new URL(result.redirectUrl, request.url), { status: 308 });
    }

    return NextResponse.json({
      success: true,
      data: result,
      meta: {
        requestId: crypto.randomUUID(),
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[BIZCARD_SCAN_API] Failed to resolve scan", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SCAN_RESOLVE_FAILED",
          tag: "[BIZCARD_SCAN_API]",
          message: "Unable to process this card scan right now.",
        },
      },
      { status: 500 }
    );
  }
}
