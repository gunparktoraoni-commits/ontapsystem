import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession } from "@/server/lib/auth";
import { getProductSubscriptionService } from "@/lib/services/product-subscription.service";

export async function GET(request: NextRequest) {
  try {
    const resolved = await resolveRequestSession(request);
    if (!resolved.session) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Authentication required" },
        { status: 401 }
      );
    }

    const userId = BigInt(resolved.session.userId);
    const subscriptionService = getProductSubscriptionService(
      request.headers.get("x-request-id") ?? "get-user-subscriptions"
    );

    const subscriptions = await subscriptionService.getUserSubscriptions(userId);

    return NextResponse.json(
      {
        success: true,
        data: subscriptions,
        count: subscriptions.length,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[user/subscriptions error]", error);

    return NextResponse.json(
      {
        error: "FETCH_FAILED",
        message: error instanceof Error ? error.message : "Failed to fetch subscriptions",
      },
      { status: 500 }
    );
  }
}
