import { NextRequest, NextResponse } from "next/server";
import { type SuperAdminContext, withSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { NewsletterCampaignService } from "@/lib/services/newsletter-campaign.service";
import { toProductPromoErrorNextResponse } from "@/lib/errors/product-promo-http";

const getHandler = withSuperAdmin(async (req: NextRequest, context: Record<string, unknown> & SuperAdminContext) => {
  const startedAt = Date.now();
  const { requestId } = context;

  try {
    const page = Number.parseInt(req.nextUrl.searchParams.get("page") ?? "1", 10);
    const limit = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10);
    const search = req.nextUrl.searchParams.get("search") ?? undefined;

    const service = new NewsletterCampaignService(requestId);
    const result = await service.listSubscribers({ page, limit, search });

    return NextResponse.json({
      success: true,
      data: result,
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
      "[NEWSLETTER_API] Failed to list subscribers"
    );
  }
});

export async function GET(req: NextRequest, context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }) {
  return getHandler(req, context);
}
