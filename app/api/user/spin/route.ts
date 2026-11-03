// POST /api/user/spin
// Auth required — performs a roulette spin and returns the prize.
// Rate limit: 10/min per user.
// Device tracking: Prevents same device from spinning more than once

import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { RouletteService } from "@/lib/services/roulette.service";
import { DeviceService } from "@/lib/services/device.service";
import { generateRequestId } from "@/lib/utils/request-utils";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

export async function POST(request: NextRequest) {
  const requestId = generateRequestId();
  const ip = getClientIp(request);

  // Authentication check
  const resolved = await resolveRequestSession(request);
  if (!resolved.session) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Authentication required.", requiresAuth: true },
        meta: { requestId, timestamp: new Date().toISOString() },
      },
      { status: 401 }
    );
  }

  // Stricter rate limiting for spin action per user
  const rateCheck = checkRateLimit("user-spin-action", `${ip}:${resolved.session.userId}`);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SPIN_RATE_LIMIT",
          message: "Too many spin attempts. Please try again later.",
          retry_after: Math.ceil(rateCheck.retryAfterMs / 1000),
        },
        meta: { requestId, timestamp: new Date().toISOString() },
      },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  try {
    // Parse request body for device fingerprint
    let deviceId: string | null = null;
    try {
      const body = await request.json();
      deviceId = body.deviceId || body.device_id;
    } catch {
      // Body might not be JSON, that's okay - continue without device check
    }

    // Device eligibility check (if deviceId provided)
    if (deviceId) {
      const deviceService = new DeviceService(requestId);
      const userId = BigInt(resolved.session.userId);

      try {
        const eligibility = await deviceService.checkDeviceEligibility(deviceId, userId);
        
        if (!eligibility.allowed) {
          return NextResponse.json(
            {
              success: false,
              error: {
                code: "DEVICE_ALREADY_SPUN",
                message: eligibility.message || "This device has already been used for roulette spins.",
                device_id: deviceId,
              },
              meta: { requestId, timestamp: new Date().toISOString() },
            },
            { status: 403 }
          );
        }
      } catch (deviceError) {
        console.error("[Spin] Device check error:", deviceError);
        // Log but don't fail - device checking shouldn't block the spin
        // if there's an error in device service
      }
    }

    const service = new RouletteService(requestId);
    const userId = BigInt(resolved.session.userId);
    const result = await service.performSpin(userId);

    if (!result.success) {
      return NextResponse.json(
        serialize({
          success: false,
          error: {
            code: result.errorCode || "NO_SPINS_AVAILABLE",
            message: result.error || "Failed to perform spin",
            redirect_url: "/marketplace/orders",
          },
          meta: { requestId, timestamp: new Date().toISOString() },
        }),
        { status: 403 }
      );
    }

    // Record device spin AFTER successful spin
    if (deviceId) {
      const deviceService = new DeviceService(requestId);
      try {
        await deviceService.recordDeviceSpin(deviceId, userId);
      } catch (recordError) {
        console.error("[Spin] Failed to record device spin:", recordError);
        // Log but don't fail - already performed spin successfully
      }
    }

    // Build response based on prize type
    const responseData: Record<string, unknown> = {
      prize: {
        type: result.prize?.type,
        label: result.prize?.label,
        discount_percentage: result.prize?.discountPercentage || null,
      },
      remaining_spins: result.remainingSpins,
    };

    // Add voucher details if discount prize
    if (result.prize?.type === "discount") {
      responseData.voucher_code = result.voucherCode;
      responseData.voucher_id = result.promoId;
      responseData.expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
    }

    return NextResponse.json(
      serialize({
        success: true,
        data: responseData,
        meta: { requestId, timestamp: new Date().toISOString() },
      })
    );
  } catch (error) {
    console.error("[Spin] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to perform spin",
        },
        meta: { requestId, timestamp: new Date().toISOString() },
      },
      { status: 500 }
    );
  }
}
