// app/api/bizcard/merge/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { buildVCardPublicUrl } from "@/server/lib/qr";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { protectAgainstBots } from "@/lib/middleware/rateLimit";
import { SerialIdService } from "@/lib/services/serialIdService";
import { BizcardMergeService } from "@/lib/services/bizcardMergeService";
import { logAdminAudit } from "@/lib/services/adminAuditService";

const prismaAny = prisma as any;

function parseBizcardId(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  return null;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const ip = getClientIp(request);
  
  try {
    // Bot protection
    const botCheck = await protectAgainstBots(request);
    if (botCheck) return botCheck;
    
    // Authentication
    const resolved = await resolveRequestSession(request, { tryRefresh: true });
    if (!resolved.session) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication required to merge cards.",
          },
        },
        { status: 401 }
      );
    }
    
    // Parse request body
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_BODY",
            message: "Invalid request body.",
          },
        },
        { status: 400 }
      );
    }
    
    const serialIdService = SerialIdService.getInstance();
    const serialId = serialIdService.normalizeSerialId(String(body.serialId || ""));
    const virtualCardId = parseBizcardId(body.virtualCardId);
    
    if (!serialId || !virtualCardId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "MISSING_FIELDS",
            message: "Both serial ID and virtual card ID are required.",
          },
        },
        { status: 400 }
      );
    }
    
    if (!serialIdService.validateSerialId(serialId)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_SERIAL_ID",
            message: "Invalid serial ID format.",
          },
        },
        { status: 400 }
      );
    }
    
    const userId = BigInt(resolved.session.userId);
    const userEmail = resolved.session.email;
    
    // Perform merge
    const mergeService = BizcardMergeService.getInstance();
    const result = await mergeService.mergeBlankCard(serialId, virtualCardId, userId);
    
    if (!("success" in result) || !result.success) {
      const error = result as { code: string; message: string };
      const statusMap: Record<string, number> = {
        CARD_NOT_AVAILABLE: 400,
        VIRTUAL_CARD_NOT_FOUND: 404,
        USER_MISMATCH: 403,
        MERGE_FAILED: 500,
      };
      
      return NextResponse.json(
        {
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        },
        { status: statusMap[error.code] || 500 }
      );
    }
    
    // Log audit
    await logAdminAudit({
      adminUserId: userId,
      adminEmail: userEmail,
      action: "MERGE_BLANK_CARD",
      details: {
        serialId,
        virtualCardId: virtualCardId.toString(),
        mergedBy: userId.toString(),
      },
      ipAddress: request.headers.get("x-forwarded-for") ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    
    // Fetch updated card details
    const updatedCard = await prismaAny.bizcard.findUnique({
      where: { bizcard_id: virtualCardId },
      select: {
        bizcard_id: true,
        serial_id: true,
        user_id: true,
        url_alias: true,
        qr_code_url: true,
        portfolio_url: true,
        is_merged: true,
        merged_at: true,
      },
    });

    const urlAlias = updatedCard?.url_alias?.trim() ?? null;
    const portfolioUrl =
      (urlAlias ? buildVCardPublicUrl(urlAlias) : null) ??
      updatedCard?.portfolio_url ??
      (urlAlias ? `/${urlAlias}` : null);
    
    const responseTime = Date.now() - startTime;
    
    return NextResponse.json({
      success: true,
      data: {
        message: "Card merged successfully.",
        bizcard: {
          id: updatedCard.bizcard_id.toString(),
          serialId: updatedCard.serial_id,
          userId: updatedCard.user_id?.toString() || null,
          urlAlias,
          qrCodeUrl: updatedCard.qr_code_url,
          portfolioUrl,
          isMerged: updatedCard.is_merged,
          mergedAt: updatedCard.merged_at,
        },
        mergedFrom: {
          serialId,
          claimedAt: new Date().toISOString(),
        },
      },
      meta: {
        requestId: crypto.randomUUID(),
        responseTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[bizcard/merge] Unhandled error:", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "MERGE_FAILED",
          message: "Failed to merge cards.",
        },
      },
      { status: 500 }
    );
  }
}