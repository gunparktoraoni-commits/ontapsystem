import { NextRequest, NextResponse } from "next/server";
import { type SuperAdminContext, withSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { NewsletterCampaignService } from "@/lib/services/newsletter-campaign.service";
import { checkProductPromoRateLimit } from "@/lib/rate-limit/product-promo-limits";
import {
  ProductPromoErrorCode,
  toProductPromoErrorResponse,
} from "@/lib/errors/product-promo-errors";
import { toProductPromoErrorNextResponse } from "@/lib/errors/product-promo-http";

type RouteParams = { params: Promise<{ campaignId: string }> };

const postHandler = withSuperAdmin(async (req: NextRequest, context: Record<string, unknown> & SuperAdminContext & RouteParams) => {
  const startedAt = Date.now();
  const { requestId, user } = context;
  const { campaignId } = await context.params;

  try {
    const rateLimit = checkProductPromoRateLimit(req, "CREATE_PRODUCT", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toProductPromoErrorResponse(
          ProductPromoErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many campaign send requests",
          requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt
        ),
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter ?? 1) } }
      );
    }

    const service = new NewsletterCampaignService(requestId);
    const campaign = await service.sendCampaign(campaignId);

    return NextResponse.json({
      success: true,
      data: campaign,
      meta: {
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return toProductPromoErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "[NEWSLETTER_API] Failed to send campaign"
    );
  }
});

export const POST = postHandler;
