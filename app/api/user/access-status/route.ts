import { NextRequest, NextResponse } from "next/server";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { generateRequestId } from "@/lib/utils/request-utils";
import {
  SubscriptionAccessService,
  buildExpirationSnapshot,
} from "@/lib/services/subscription-access.service";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

export async function GET(request: NextRequest) {
  const requestId = generateRequestId();
  const ip = getClientIp(request);

  const rateCheck = checkRateLimit("user-subscription-status", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { success: false, error: { code: "RATE_LIMITED", message: "Too many requests." }, meta: { requestId } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  const auth = await resolveRequestSession(request, { tryRefresh: true });
  if (!auth.session) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Authentication required", requestId } },
      { status: 401 }
    );
  }

  try {
    const accessService = new SubscriptionAccessService(requestId);
    const userId = BigInt(auth.session.userId);
    const [accessStatus, freeTrial, bizcardSubscription] = await Promise.all([
      accessService.getUserAccessStatus(userId),
      accessService.hasActiveFreeTrial(userId),
      accessService.hasActiveBizcardSubscription(userId),
    ]);

    const expiration = buildExpirationSnapshot(accessStatus, freeTrial, bizcardSubscription);

    return NextResponse.json(
      serialize({
        success: true,
        data: {
          access_status: accessStatus,
          free_trial: freeTrial,
          bizcard_subscription: bizcardSubscription,
          expiration,
        },
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
        },
      }),
    );
  } catch (error) {
    console.error("[SUBSCRIPTION_API] ACCESS_STATUS_FETCH_FAILED", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "ACCESS_STATUS_FETCH_FAILED",
          message: "Failed to fetch access status.",
          tag: "[SUBSCRIPTION_API]",
        },
        meta: { requestId, timestamp: new Date().toISOString() },
      },
      { status: 500 },
    );
  }
}