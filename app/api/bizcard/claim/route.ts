// app/api/bizcard/claim/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkSerialSearchRateLimit } from "@/lib/bizcard/security";
import { SerialIdService } from "@/lib/services/serialIdService";
import { protectAgainstBots } from "@/lib/middleware/rateLimit";
import { findVirtualCardsForMerge, buildSignupUrl, buildManualRegisterUrl } from "@/lib/bizcard/scan-routing";

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const ip = getClientIp(request);
  
  try {
    // Bot protection
    const botCheck = await protectAgainstBots(request);
    if (botCheck) return botCheck;
    
    // Rate limiting for serial ID searches
    const rateCheck = checkSerialSearchRateLimit(ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: `Too many serial ID lookup attempts. Please try again in ${Math.ceil(rateCheck.retryAfterMs / 1000)} seconds.`,
          },
        },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
      );
    }
    
    // Parse request body
    let body: { serialId?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_BODY", message: "Invalid request body." } },
        { status: 400 }
      );
    }
    
    const serialIdService = SerialIdService.getInstance();
    const serialId = serialIdService.normalizeSerialId(body.serialId || "");
    
    if (!serialId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "MISSING_SERIAL_ID",
            message: "Valid serial ID is required.",
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
            message: "Invalid serial ID format. Expected format: XXXX-XXXX-XXXX",
          },
        },
        { status: 400 }
      );
    }
    
    // Find the blank card
    const blankCard = await prisma.bizcard.findFirst({
      where: {
        serial_id: serialId,
        deactivated_flag: false,
      },
      select: {
        bizcard_id: true,
        serial_id: true,
        is_blank: true,
        user_id: true,
        subscription_tier: true,
      },
    });
    
    if (!blankCard) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "CARD_NOT_FOUND",
            message: "No bizcard found with this serial ID.",
          },
        },
        { status: 404 }
      );
    }
    
    if (blankCard.user_id) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "CARD_ALREADY_CLAIMED",
            message: "This card has already been claimed.",
          },
        },
        { status: 400 }
      );
    }

    const subscriptionTier =
      typeof blankCard.subscription_tier === "string"
        ? blankCard.subscription_tier.trim().toLowerCase()
        : null;
    const normalizedTier =
      subscriptionTier === "basic" ||
      subscriptionTier === "standard" ||
      subscriptionTier === "premium"
        ? subscriptionTier
        : null;
    
    // Check if user is authenticated
    const resolved = await resolveRequestSession(request, { tryRefresh: true });
    
    if (resolved.session) {
      const userId = BigInt(resolved.session.userId);
      const existingVirtualCards = await findVirtualCardsForMerge(userId);

      if (existingVirtualCards.length > 0) {
        return NextResponse.json({
          success: true,
          data: {
            requiresMerge: true,
            serialId,
            subscriptionTier: normalizedTier,
            virtualCards: existingVirtualCards,
            message: "You have existing virtual cards. Merge this physical card with one of them or register manually.",
          },
        });
      }

      return NextResponse.json({
        success: true,
        data: {
          requiresProfileCreate: true,
          serialId,
          subscriptionTier: normalizedTier,
          redirectUrl: buildManualRegisterUrl(serialId),
          message: "No existing virtual cards found. Create a BizCard profile to link this physical card.",
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        requiresRegistration: true,
        serialId,
        subscriptionTier: normalizedTier,
        redirectUrl: buildSignupUrl(serialId),
        message: "Please create an account to claim this bizcard.",
      },
    });
  } catch (error) {
    console.error("[bizcard/claim] Unhandled error:", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "CLAIM_FAILED",
          message: "Failed to process claim request.",
        },
      },
      { status: 500 }
    );
  }
}