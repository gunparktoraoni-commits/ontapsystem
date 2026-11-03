import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession } from "@/server/lib/auth";
import { getProductSubscriptionService } from "@/lib/services/product-subscription.service";
import { prisma } from "@/server/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bizcardId: string }> }
) {
  try {
    const { bizcardId: bizcardIdStr } = await params;
    const resolved = await resolveRequestSession(request);
    if (!resolved.session) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Authentication required" },
        { status: 401 }
      );
    }

    const bizcardId = BigInt(bizcardIdStr);
    const userId = BigInt(resolved.session.userId);

    // Verify bizcard belongs to user
    const bizcard = await prisma.bizcard.findFirst({
      where: {
        bizcard_id: bizcardId,
        user_id: userId,
      },
      select: { bizcard_id: true },
    });

    if (!bizcard) {
      return NextResponse.json(
        { error: "BIZCARD_NOT_FOUND", message: "Bizcard not found" },
        { status: 404 }
      );
    }

    const subscriptionService = getProductSubscriptionService(
      request.headers.get("x-request-id") ?? "get-bizcard-subscription"
    );

    const subscription = await subscriptionService.getBizcardSubscription(bizcardId);

    return NextResponse.json(
      {
        success: true,
        data: subscription,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[bizcard/subscription error]", error);

    return NextResponse.json(
      {
        error: "FETCH_FAILED",
        message: error instanceof Error ? error.message : "Failed to fetch subscription",
      },
      { status: 500 }
    );
  }
}
