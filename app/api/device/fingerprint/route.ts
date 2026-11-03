// POST /api/device/fingerprint
// Get or create device ID from fingerprint
// Auth optional — If authenticated, links device to user
// Returns device_id for frontend storage

import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { DeviceService } from "@/lib/services/device.service";
import { generateRequestId } from "@/lib/utils/request-utils";
import { isValidFingerprint } from "@/lib/utils/device-fingerprint";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

export async function POST(request: NextRequest) {
  const requestId = generateRequestId();
  const ip = getClientIp(request);

  // Rate limiting - shared for all device fingerprint requests from an IP
  const rateCheck = checkRateLimit("device-fingerprint", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "RATE_LIMIT",
          message: "Too many requests. Please slow down.",
          retry_after: Math.ceil(rateCheck.retryAfterMs / 1000),
        },
        meta: { requestId, timestamp: new Date().toISOString() },
      },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  try {
    // Parse request body
    let fingerprint: unknown;
    try {
      const body = await request.json();
      fingerprint = body.fingerprint || body.visitorId || body.device_fingerprint;
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_REQUEST",
            message: "Request body must be valid JSON",
          },
          meta: { requestId, timestamp: new Date().toISOString() },
        },
        { status: 400 }
      );
    }

    // Validate fingerprint format
    if (!isValidFingerprint(fingerprint)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_FINGERPRINT",
            message: "Fingerprint must be a non-empty string between 32-256 characters",
          },
          meta: { requestId, timestamp: new Date().toISOString() },
        },
        { status: 400 }
      );
    }

    // Optional auth check
    const resolved = await resolveRequestSession(request);
    const userId = resolved.session ? BigInt(resolved.session.userId) : null;

    // Get or create device
    const deviceService = new DeviceService(requestId);
    const deviceId = await deviceService.getOrCreateDeviceId(fingerprint, userId);

    // Get device stats
    const stats = await deviceService.getDeviceStats(deviceId);
    const linkedUserIds = stats?.linked_user_ids
      ? (typeof stats.linked_user_ids === 'string'
          ? JSON.parse(stats.linked_user_ids)
          : stats.linked_user_ids
        )
      : [];

    return NextResponse.json(
      serialize({
        success: true,
        data: {
          device_id: deviceId,
          is_new_device: !stats || stats.spins_used === 0,
          is_authenticated: !!userId,
          spins_used: stats?.spins_used || 0,
          linked_user_count: linkedUserIds.length,
          last_spin_at: stats?.last_spin_at?.toISOString() || null,
          first_seen_at: stats?.first_seen_at?.toISOString() || new Date().toISOString(),
        },
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
        },
      })
    );
  } catch (error) {
    console.error("[Device Fingerprint] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to process device fingerprint",
        },
        meta: { requestId, timestamp: new Date().toISOString() },
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  // GET endpoint for testing/debugging only
  // Returns info about current device if fingerprint provided in query
  const fingerprint = request.nextUrl.searchParams.get("fingerprint");

  if (!fingerprint) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "MISSING_FINGERPRINT",
          message: "fingerprint query parameter required",
        },
      },
      { status: 400 }
    );
  }

  try {
    const requestId = generateRequestId();
    const deviceService = new DeviceService(requestId);
    const stats = await deviceService.getDeviceStats(fingerprint);

    if (!stats) {
      return NextResponse.json({
        success: true,
        data: {
          device_id: fingerprint,
          exists: false,
          message: "Device not found in system",
        },
      });
    }

    const linkedUserIds = stats.linked_user_ids
      ? (typeof stats.linked_user_ids === 'string'
          ? JSON.parse(stats.linked_user_ids)
          : stats.linked_user_ids
        )
      : [];

    return NextResponse.json(
      serialize({
        success: true,
        data: {
          device_id: fingerprint,
          exists: true,
          spins_used: stats.spins_used,
          linked_user_count: linkedUserIds.length,
          first_seen_at: stats.first_seen_at?.toISOString(),
          last_spin_at: stats.last_spin_at?.toISOString(),
        },
      })
    );
  } catch (error) {
    console.error("[Device Fingerprint GET] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to fetch device info",
        },
      },
      { status: 500 }
    );
  }
}
