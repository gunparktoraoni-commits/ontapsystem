import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp } from "@/server/lib/auth";
import { requireRole } from "@/lib/middleware/roleAuth";
import { AppError } from "@/lib/errors/types";
import { PhysicalCardService } from "@/lib/services/physical-card.service";

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ["super_admin", "dev"]);
  if (!auth.ok) return auth.response;

  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("physical-card-register", `${ip}:${auth.actor.userId.toString()}`);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many physical card registration attempts.",
        },
      },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
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
  const requestId = `physreg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const service = new PhysicalCardService(requestId);
    const created = await service.registerPhysicalCard(serialId);

    return NextResponse.json(
      {
        success: true,
        data: created,
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
        },
      },
      { status: 201 }
    );
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

    console.error("[physical-cards/register] unexpected error", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to register physical card",
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
