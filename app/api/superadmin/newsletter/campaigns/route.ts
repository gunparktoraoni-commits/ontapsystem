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
import { isMarketingEmailContentEmpty } from "@/server/lib/email";

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

const createCampaignSchema = z
  .object({
    title: z.string().trim().min(2).max(255),
    content: z.string().optional().default(""),
    image_urls: z.array(z.string().trim().url().max(512)).max(6).optional().default([]),
    audience: z.array(audienceEnum).min(1),
    custom_user_ids: z.array(z.string().trim().min(1)).optional(),
    custom_emails: z.array(emailAddressSchema).max(200).optional().default([]),
    scheduled_at: z.coerce.date().nullable().optional(),
  })
  .refine(
    (data) => !isMarketingEmailContentEmpty(data.content ?? "") || (data.image_urls?.length ?? 0) > 0,
    {
      message: "Add campaign content or attach at least one image",
      path: ["content"],
    }
  )
  .refine(
    (data) => !(data.audience.includes("custom") && data.audience.includes("custom_emails")),
    {
      message: "Custom Selection and Enter Email Addresses cannot be used together",
      path: ["audience"],
    }
  )
  .refine(
    (data) => !data.audience.includes("custom_emails") || (data.custom_emails?.length ?? 0) > 0,
    {
      message: "Enter at least one valid email address",
      path: ["custom_emails"],
    }
  );

const getHandler = withSuperAdmin(async (req: NextRequest, context: Record<string, unknown> & SuperAdminContext) => {
  const startedAt = Date.now();
  const { requestId } = context;

  try {
    const service = new NewsletterCampaignService(requestId);
    const campaigns = await service.listCampaigns();

    return NextResponse.json({
      success: true,
      data: { campaigns },
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
      "[NEWSLETTER_API] Failed to list campaigns"
    );
  }
});

const postHandler = withSuperAdmin(async (req: NextRequest, context: Record<string, unknown> & SuperAdminContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkProductPromoRateLimit(req, "CREATE_PRODUCT", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toProductPromoErrorResponse(
          ProductPromoErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many campaign create requests",
          requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt
        ),
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter ?? 1) } }
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = createCampaignSchema.safeParse(body);
    if (!parsed.success) {
      throw createProductPromoError(
        ProductPromoErrorCode.PRODUCT_CREATION_FAILED,
        "Invalid campaign payload",
        400,
        requestId,
        { issues: parsed.error.issues }
      );
    }

    const service = new NewsletterCampaignService(requestId);
    const campaign = await service.createCampaign(parsed.data, String(user.id));

    return NextResponse.json(
      {
        success: true,
        data: campaign,
        meta: {
          requestId,
          responseTime: Date.now() - startedAt,
          timestamp: new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return toProductPromoErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "[NEWSLETTER_API] Failed to create campaign"
    );
  }
});

export async function GET(req: NextRequest, context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }) {
  return getHandler(req, context);
}

export async function POST(req: NextRequest, context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }) {
  return postHandler(req, context);
}
