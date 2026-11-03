// GET /api/user/subscription
// Auth required — returns the authenticated user's subscription with usage stats and features.
// Rate limit: 60/min per IP.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { subscriptionService } from "@/lib/services/subscription.service";
import { generateRequestId } from "@/lib/utils/request-utils";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

async function requireSession(request: NextRequest) {
  const result = await resolveRequestSession(request);
  if (!result.session) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Authentication required.", requiresAuth: true },
        { status: 401 }
      ),
    };
  }
  return { ok: true as const, session: result.session };
}

export async function GET(request: NextRequest) {
  const requestId = generateRequestId();
  const ip = getClientIp(request);

  // Rate limiting check
  const rateCheck = checkRateLimit("user-subscription-status", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  // Authentication check
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const { session } = auth;

  try {
    const userId = BigInt(session.userId);

    // Get subscription status
    const status = await subscriptionService.getSubscriptionStatus(userId);

    // Get current card counts
    const [virtualCardCount, physicalCardCount] = await Promise.all([
      prisma.bizcard.count({
        where: {
          user_id: userId,
          bizcard_type: "virtual",
          deactivated_flag: false,
        },
      }),
      prisma.bizcard.count({
        where: {
          user_id: userId,
          bizcard_type: "physical",
          deactivated_flag: false,
        },
      }),
    ]);

    // Get theme count
    const themeCount = await prisma.bizcard.findMany({
      where: {
        user_id: userId,
        deactivated_flag: false,
      },
      select: { bizcard_theme: true },
      distinct: ["bizcard_theme"],
    }).then(results => results.length);

    // Get associates count
    const associatesCount = await prisma.companyEmployee.count({
      where: {
        user_id: userId,
        is_active: true,
      },
    });

    // Get available plans (exclude trial)
    const availablePlans = await subscriptionService.getAvailablePlans();





    // Build response
    const response = {
      success: true,
      data: {
        tier: status.tier,
        status: status.status,
        expires_at: status.expiresAt?.toISOString() ?? null,
        days_remaining: status.daysRemaining,
        is_expired: status.isExpired,
        is_trial: status.isTrial,
        access_reason: status.accessReason,
        trial_expired: status.trialExpired,
        subscription_expired: status.subscriptionExpired,
        expiration_kind: status.expirationKind,
        features: {
          max_virtual_cards: status.features.maxVirtualCards,
          current_virtual_cards: virtualCardCount,
          max_physical_cards: status.features.maxPhysicalCards,
          current_physical_cards: physicalCardCount,
          max_themes: status.features.maxThemes,
          current_themes: themeCount,
          max_associates: status.features.maxAssociates,
          current_associates: associatesCount,
          can_create_company: status.features.canCreateCompany,
          can_upload_gallery: status.features.canUploadGallery,
          can_manage_inquiries: status.features.canManageInquiries,
          can_real_time_analytics: status.features.canRealTimeAnalytics,
          can_affiliate: status.features.canAffiliate,
          can_dashboard: status.features.canDashboard,
        },
        available_plans: availablePlans,
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
      },
    };

    return NextResponse.json(serialize(response));
  } catch (error) {
    console.error("[Subscription Status] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to fetch subscription status",
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
