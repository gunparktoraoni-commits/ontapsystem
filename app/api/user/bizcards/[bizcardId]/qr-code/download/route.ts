import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { prisma } from "@/server/lib/prisma";
import { AppError } from "@/lib/errors/types";
import { QRCodeService } from "@/lib/services/qr-code.service";
import { requireSession } from "../../../_helpers";

function parseBizcardId(value: string): bigint | null {
  try {
    const parsed = BigInt(value);
    if (parsed <= BigInt(0)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bizcardId: string }> }
) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("user-bizcard-qr-download", ip);
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

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const rawParams = await params;
  const bizcardId = parseBizcardId(rawParams.bizcardId);
  if (!bizcardId) {
    return NextResponse.json(
      { success: false, error: { code: "BIZCARD_NOT_FOUND", message: "Bizcard not found." } },
      { status: 404 }
    );
  }

  const requestId = `bizcardqrdl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const bizcard = await prisma.bizcard.findFirst({
      where: { bizcard_id: bizcardId, user_id: auth.userId },
      select: {
        bizcard_id: true,
        url_alias: true,
      },
    });

    if (!bizcard) {
      return NextResponse.json(
        { success: false, error: { code: "BIZCARD_NOT_FOUND", message: "Bizcard not found." } },
        { status: 404 }
      );
    }

    if (!bizcard.url_alias) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "QR_ALIAS_MISSING",
            message: "Bizcard has no url_alias. Set a public alias first.",
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
        "Content-Disposition": `attachment; filename="bizcard-${bizcard.bizcard_id.toString()}-offline-qr.${image.extension}"`,
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

    console.error("[user/bizcards/[bizcardId]/qr-code/download] unexpected error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to download offline QR code",
        },
      },
      { status: 500 }
    );
  }
}
