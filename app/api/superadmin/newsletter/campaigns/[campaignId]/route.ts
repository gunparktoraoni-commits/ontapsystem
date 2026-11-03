import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { type SuperAdminContext, withSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { NewsletterCampaignService } from "@/lib/services/newsletter-campaign.service";
import { checkProductPromoRateLimit } from "@/lib/rate-limit/product-promo-limits";
import {
  createProductPromoError,
  ProductPromoErrorCode,
  toProductPromoErrorResponse,
} from "@/lib/errors/product-promo-errors";
import { toProductPromoErrorNextResponse } from "@/lib/errors/product-promo-http";

type RouteParams = { params: Promise<{ campaignId: string }> };

const audienceEnum = z.enum([
  "basic",
  "standard",
  "premium",
  "company_admins",
  "free_trial",
  "custom",
  "custom_emails",
]);

const emailAddressSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Invalid email address")
  .max(254);

const updateCampaignSchema = z
  .object({
    title: z.string().trim().min(2).max(255).optional(),
    content: z.string().trim().optional(),
    image_urls: z.array(z.string().trim().url().max(512)).max(6).optional(),
    audience: z.array(audienceEnum).min(1).optional(),
    custom_user_ids: z.array(z.string().trim().min(1)).optional(),
    custom_emails: z.array(emailAddressSchema).max(200).optional(),
    scheduled_at: z.coerce.date().nullable().optional(),
    status: z.enum(["draft", "queued", "sent", "failed"]).optional(),
  })
  .refine(
    (data) =>
      !data.audience ||
      !(data.audience.includes("custom") && data.audience.includes("custom_emails")),
    {
      message: "Custom Selection and Enter Email Addresses cannot be used together",
      path: ["audience"],
    }
  );

const getHandler = withSuperAdmin(async (req: NextRequest, context: Record<string, unknown> & SuperAdminContext & RouteParams) => {
  const startedAt = Date.now();
  const { requestId } = context;
  const { campaignId } = await context.params;

  try {
    const service = new NewsletterCampaignService(requestId);
    const campaign = await service.getCampaignById(campaignId);

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
      "[NEWSLETTER_API] Failed to get campaign"
    );
  }
});

const putHandler = withSuperAdmin(async (req: NextRequest, context: Record<string, unknown> & SuperAdminContext & RouteParams) => {
  const startedAt = Date.now();
  const { requestId, user } = context;
  const { campaignId } = await context.params;

  try {
    const rateLimit = checkProductPromoRateLimit(req, "UPDATE_PRODUCT", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toProductPromoErrorResponse(
          ProductPromoErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many campaign update requests",
          requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt
        ),
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter ?? 1) } }
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = updateCampaignSchema.safeParse(body);
    if (!parsed.success) {
      throw createProductPromoError(
        ProductPromoErrorCode.PRODUCT_UPDATE_FAILED,
        "Invalid campaign update payload",
        400,
        requestId,
        { issues: parsed.error.issues }
      );
    }

    const service = new NewsletterCampaignService(requestId);
    const campaign = await service.updateCampaign(campaignId, parsed.data);

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
      "[NEWSLETTER_API] Failed to update campaign"
    );
  }
});

const deleteHandler = withSuperAdmin(async (req: NextRequest, context: Record<string, unknown> & SuperAdminContext & RouteParams) => {
  const startedAt = Date.now();
  const { requestId, user } = context;
  const { campaignId } = await context.params;

  try {
    const rateLimit = checkProductPromoRateLimit(req, "DELETE_PRODUCT", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toProductPromoErrorResponse(
          ProductPromoErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many campaign delete requests",
          requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt
        ),
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter ?? 1) } }
      );
    }

    const service = new NewsletterCampaignService(requestId);
    const result = await service.deleteCampaign(campaignId);

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
      "[NEWSLETTER_API] Failed to delete campaign"
    );
  }
});

export const GET = getHandler;
export const PUT = putHandler;
export const DELETE = deleteHandler;
