import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { prisma } from "@/server/lib/prisma";
import { AppError } from "@/lib/errors/types";
import { QRCodeService } from "@/lib/services/qr-code.service";

const prismaAny = prisma as any;

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("dashboard-qr-download", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many requests.",
        },
      },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  const resolved = await resolveRequestSession(request, { tryRefresh: true });
  if (!resolved.session) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required",
        },
      },
      { status: 401 }
    );
  }

  const requestId = `dashqrdl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const userId = BigInt(resolved.session.userId);

  try {
    const bizcard = await prismaAny.bizcard.findFirst({
      where: { user_id: userId, deactivated_flag: false },
      orderBy: [{ created_at: "asc" }],
      select: {
        bizcard_id: true,
        url_alias: true,
      },
    });

    if (!bizcard) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "BIZCARD_NOT_FOUND",
            message: "No active bizcard found",
          },
        },
        { status: 404 }
      );
    }

    if (!bizcard.url_alias) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "QR_ALIAS_MISSING",
            message: "Primary bizcard has no url_alias. Set a public alias first.",
          },
        },
        { status: 409 }
      );
    }

    const qrService = new QRCodeService(requestId);
    const { payload } = await qrService.buildOfflineQrPayload(bizcard.bizcard_id);
    const image = await qrService.generateDownloadImage(payload);
    const body = new Uint8Array(image.buffer);

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": image.contentType,
        "Content-Disposition": `attachment; filename="qr-code-${bizcard.bizcard_id.toString()}.${image.extension}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        },
        { status: error.statusCode }
      );
    }

    console.error("[user/dashboard/qr-code/download] unexpected error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to download QR code",
        },
      },
      { status: 500 }
    );
  }
}
