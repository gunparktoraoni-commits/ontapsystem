import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { AppError } from "@/lib/errors/types";
import { PhysicalCardService } from "@/lib/services/physical-card.service";

function parseBizcardId(input: string): number | null {
  const parsed = Number(input);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bizcardId: string }> }
) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("bizcard-merge-sensitive", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many merge attempts. Please wait before retrying.",
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

  const { bizcardId: bizcardIdRaw } = await params;
  const bizcardId = parseBizcardId(bizcardIdRaw);
  if (!bizcardId) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INVALID_BIZCARD_ID",
          message: "bizcardId must be a positive integer",
        },
      },
      { status: 400 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INVALID_BODY",
          message: "Invalid request body",
        },
      },
      { status: 400 }
    );
  }

  const serialId = String(body.serial_id ?? "");
  const requestId = `merge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const service = new PhysicalCardService(requestId);
    const merged = await service.mergeWithPhysicalCard(
      bizcardId,
      serialId,
      String(resolved.session.userId)
    );

    // Fetch updated bizcard to include url_alias / public alias for frontend redirect
    const updated = await prisma.bizcard.findUnique({
      where: { bizcard_id: BigInt(merged.bizcard_id) },
      select: { url_alias: true, portfolio_url: true },
    });

    const portfolioAlias = updated?.url_alias ?? updated?.portfolio_url ?? null;
    const portfolioUrl = portfolioAlias ? `/${portfolioAlias}` : null;

    return NextResponse.json({
      success: true,
      data: {
        ...merged,
        portfolioUrl,
        message:
          "Your virtual card has been successfully linked to the physical card. The physical card now displays your profile.",
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

    console.error("[bizcard/[bizcardId]/merge] unexpected error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: "MERGE_FAILED",
          message: "Failed to merge virtual and physical cards",
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
