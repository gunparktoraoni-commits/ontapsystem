import { NextRequest, NextResponse } from "next/server";
import { type SuperAdminContext, withSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { checkProductPromoRateLimit } from "@/lib/rate-limit/product-promo-limits";
import { ProductPromoErrorCode, toProductPromoErrorResponse } from "@/lib/errors/product-promo-errors";

const TARGET_GROUPS = [
  {
    key: "all_users",
    label: "All Users",
    description: "All active registered users",
  },
  {
    key: "new_users",
    label: "New Users",
    description: "Users who registered recently",
  },
  {
    key: "newly_registered",
    label: "Newly Registered Users",
    description: "Users who registered within the configured onboarding window",
  },
  {
    key: "subscription_basic",
    label: "Basic BizCard Users",
    description: "Users with an active basic subscription tier",
  },
  {
    key: "subscription_standard",
    label: "Standard BizCard Users",
    description: "Users with an active standard subscription tier",
  },
  {
    key: "subscription_premium",
    label: "Premium BizCard Users",
    description: "Users with an active premium subscription tier",
  },
  {
    key: "free_trial_users",
    label: "Free Trial Users",
    description: "Users currently on a free trial plan",
  },
  {
    key: "company_admins",
    label: "Company Admins",
    description: "Users with company administrator privileges",
  },
  {
    key: "bulk_orders",
    label: "Bulk Order Customers",
    description: "Users with high cumulative quantity orders",
  },
  {
    key: "frequent_buyers",
    label: "Frequent Buyers",
    description: "Users above the configured completed-order threshold",
  },
  {
    key: "first_time_buyers",
    label: "First Time Buyers",
    description: "Users with no completed order yet",
  },
] as const;

const PROMO_TAGS = [
  { key: "discount_promo", label: "Discount Promo", color: "green" },
  { key: "bogo", label: "Buy One Get One", color: "blue" },
  { key: "seasonal", label: "Seasonal Promo", color: "orange" },
  { key: "clearance", label: "Clearance Sale", color: "red" },
  { key: "welcome", label: "Welcome Promo", color: "purple" },
] as const;

const getHandler = withSuperAdmin(async (req: NextRequest, context: Record<string, unknown> & SuperAdminContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  const rateLimit = checkProductPromoRateLimit(req, "GET_TARGET_GROUPS", String(user.id));
  if (!rateLimit.success) {
    return NextResponse.json(
      toProductPromoErrorResponse(
        ProductPromoErrorCode.RATE_LIMIT_EXCEEDED,
        "Too many target-group requests",
        requestId,
        { retryAfter: rateLimit.retryAfter },
        Date.now() - startedAt
      ),
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfter ?? 1),
        },
      }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      target_groups: TARGET_GROUPS,
      promo_tags: PROMO_TAGS,
    },
    meta: {
      requestId,
      responseTime: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    },
  });
});

export async function GET(req: NextRequest, context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }) {
  return getHandler(req, context);
}
