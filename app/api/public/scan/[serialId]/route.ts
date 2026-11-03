import { NextRequest, NextResponse } from "next/server";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { AppError, ErrorCode } from "@/lib/errors/types";
import { PhysicalCardService } from "@/lib/services/physical-card.service";
import {
  buildManualRegisterUrl,
  buildMergeChoiceUrl,
  buildSignupUrl,
  findVirtualCardsForMerge,
} from "@/lib/bizcard/scan-routing";

function generateErrorPage(title: string, message: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f4f4f5; color: #18181b; }
    .box { background: #fff; border: 1px solid #e4e4e7; border-radius: 14px; padding: 28px; max-width: 460px; box-shadow: 0 10px 30px rgba(0,0,0,0.08); }
    h1 { margin: 0 0 10px; font-size: 24px; }
    p { margin: 0 0 14px; color: #52525b; line-height: 1.5; }
    a { color: #0f766e; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <div class="box">
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="/">Return to Home</a>
  </div>
</body>
</html>`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serialId: string }> }
) {
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || "unknown";
  const { serialId } = await params;

  const rateCheck = checkRateLimit("public-scan", ip);
  if (!rateCheck.allowed) {
    return new NextResponse(
      generateErrorPage("Too Many Requests", "Please wait a moment before scanning again."),
      {
        status: 429,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)),
        },
      }
    );
  }

  const requestId = `scan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const service = new PhysicalCardService(requestId);
    const result = await service.scanPhysicalCard(serialId, {
      ip,
      userAgent,
    });

    return NextResponse.redirect(new URL(result.redirect_url, request.url), { status: 302 });
  } catch (error) {
    if (error instanceof AppError) {
      // Handle blank physical card specially (user_id == null)
      if (error.code === ErrorCode.PHYSICAL_CARD_EMPTY_RECORD) {
        const resolved = await resolveRequestSession(request, { tryRefresh: true });
        if (!resolved.session) {
          const redirectUrl = buildSignupUrl(serialId);
          return NextResponse.redirect(new URL(redirectUrl, request.url), { status: 302 });
        }

        const userId = BigInt(resolved.session.userId);
        const virtualCards = await findVirtualCardsForMerge(userId);

        if (virtualCards.length > 0) {
          const mergeUi = buildMergeChoiceUrl(serialId, virtualCards[0].id);
          return NextResponse.redirect(new URL(mergeUi, request.url), { status: 302 });
        }

        const setupUrl = buildManualRegisterUrl(serialId);
        return NextResponse.redirect(new URL(setupUrl, request.url), { status: 302 });
      }

      return new NextResponse(
        generateErrorPage("Card Not Found", "The scanned card could not be matched to an active public profile."),
        {
          status: error.statusCode,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }
      );
    }

    console.error("[public/scan] unexpected error", {
      requestId,
      serialId,
      error: error instanceof Error ? error.message : String(error),
    });

    return new NextResponse(
      generateErrorPage("Scan Error", "An unexpected error occurred while processing the scan."),
      {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }
    );
  }
}
