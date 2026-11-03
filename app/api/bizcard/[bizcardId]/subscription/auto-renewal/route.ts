import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession } from "@/server/lib/auth";
import { getProductSubscriptionService } from "@/lib/services/product-subscription.service";
import { prisma } from "@/server/lib/prisma";

interface AutoRenewalRequest {
  enabled?: boolean;
}

export async function PATCH(
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

    const body: AutoRenewalRequest = await request.json();
    const bizcardId = BigInt(bizcardIdStr);
    const userId = BigInt(resolved.session.userId);

    // Verify bizcard belongs to user
    const bizcard = await prisma.bizcard.findFirst({
      where: {
        bizcard_id: bizcardId,
        user_id: userId,
      },
      select: {
        bizcard_id: true,
        subscription_tier: true,
      },
    });

    if (!bizcard) {
      return NextResponse.json(
        { error: "BIZCARD_NOT_FOUND", message: "Bizcard not found" },
        { status: 404 }
      );
    }

    if (!bizcard.subscription_tier) {
      return NextResponse.json(
        {
          error: "NO_SUBSCRIPTION",
          message: "Bizcard does not have an active subscription",
        },
        { status: 400 }
      );
    }

    const subscriptionService = getProductSubscriptionService(
      request.headers.get("x-request-id") ?? "toggle-auto-renewal"
    );

    // If enabled is explicitly false, cancel auto-renewal
    if (body.enabled === false) {
      const result = await subscriptionService.cancelAutoRenewal(bizcardId, userId);
      return NextResponse.json(
        {
          success: true,
          data: result,
        },
        { status: 200 }
      );
    }

    // If enabled is true, enable auto-renewal
    if (body.enabled === true) {
      const updated = await prisma.bizcard.update({
        where: { bizcard_id: bizcardId },
        data: { auto_renewal_enabled: true },
        select: {
          bizcard_id: true,
          bizcard_name: true,
          auto_renewal_enabled: true,
        },
      });

      return NextResponse.json(
        {
          success: true,
          data: {
            bizcard_id: Number(updated.bizcard_id),
            bizcard_name: updated.bizcard_name,
            auto_renewal_enabled: updated.auto_renewal_enabled,
            message: "Auto-renewal has been enabled for this subscription",
          },
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        error: "INVALID_REQUEST",
        message: "Please specify 'enabled' as true or false",
      },
      { status: 400 }
    );
  } catch (error) {
    console.error("[bizcard/subscription/auto-renewal error]", error);

    const message = error instanceof Error ? error.message : "Failed to update auto-renewal";
    const status = message.includes("NOT_FOUND") ? 404 : 500;

    return NextResponse.json(
      {
        error: "UPDATE_FAILED",
        message,
      },
      { status }
    );
  }
}
