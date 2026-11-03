import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { prisma } from "@/server/lib/prisma";
import { buildVCardPublicUrl } from "@/server/lib/qr";
import { AppError } from "@/lib/errors/types";
import { QRCodeService } from "@/lib/services/qr-code.service";

const prismaAny = prisma as any;

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("dashboard-qr", ip);
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

  const userId = BigInt(resolved.session.userId);
  const requestId = `dashqr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const bizcard = await prismaAny.bizcard.findFirst({
      where: {
        user_id: userId,
        deactivated_flag: false,
      },
      orderBy: [{ created_at: "asc" }],
      select: {
        bizcard_id: true,
        bizcard_name: true,
        url_alias: true,
        qr_code_url: true,
        qr_code_generated_at: true,
        qr_code_last_accessed: true,
        scan_count: true,
      },
    });

    if (!bizcard) {
      return NextResponse.json({
        success: true,
        data: {
          has_bizcard: false,
          message: "No bizcard found. Please create one.",
        },
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    if (!bizcard.url_alias) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "QR_ALIAS_MISSING",
            message: "Primary bizcard has no url_alias. Set a public alias first.",
          },
          meta: {
            requestId,
            timestamp: new Date().toISOString(),
          },
        },
        { status: 409 }
      );
    }

    let qrCodeUrl = bizcard.qr_code_url as string | null;
    let qrCodeGeneratedAt = bizcard.qr_code_generated_at as Date | null;

    if (!qrCodeUrl) {
      const qrService = new QRCodeService(requestId);
      const generated = await qrService.getOrGenerateQRCode(bizcard.bizcard_id, bizcard.url_alias);
      qrCodeUrl = generated.qr_code_url;
      qrCodeGeneratedAt = generated.generated_at;
    }

    const publicUrl = buildVCardPublicUrl(bizcard.url_alias);

    return NextResponse.json({
      success: true,
      data: {
        bizcard_id: bizcard.bizcard_id.toString(),
        qr_code_url: qrCodeUrl,
        qr_code_generated_at: qrCodeGeneratedAt,
        qr_code_last_accessed: bizcard.qr_code_last_accessed,
        scan_count: Number(bizcard.scan_count ?? 0),
        public_url: publicUrl,
        qr_code_download_url: "/api/user/dashboard/qr-code/download",
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
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
          meta: {
            requestId,
            timestamp: new Date().toISOString(),
          },
        },
        { status: error.statusCode }
      );
    }

    console.error("[user/dashboard/qr-code] unexpected error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve dashboard QR code",
        },
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}
