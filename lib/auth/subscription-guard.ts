import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession } from "@/server/lib/auth";
import { subscriptionService, TierFeatures } from "@/lib/services/subscription.service";
import {
  createUpgradeRequiredError,
  createExpiredError,
  createLimitReachedError,
} from "@/lib/errors/subscription-errors";
import { generateRequestId } from "@/lib/utils/request-utils";

// Helper to serialize BigInt
const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

async function isPrivilegedPremiumUser(userId: bigint): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { user_id: userId },
    select: { role: true },
  });
  const role = String(user?.role ?? "")
    .trim()
    .toLowerCase();
  return role === "dev" || role === "super_admin";
}

function isPrivilegedSessionRole(role: string | null | undefined): boolean {
  const normalized = String(role ?? "")
    .trim()
    .toLowerCase();
  return normalized === "dev" || normalized === "super_admin";
}

// Middleware to require a specific feature
export function requireFeature(feature: keyof TierFeatures) {
  return async (userId: bigint | string, req?: NextRequest) => {
    const userIdBigInt = typeof userId === "string" ? BigInt(userId) : userId;
    const requestId = req ? generateRequestId() : "sys_" + Date.now();

    if (req) {
      const resolved = await resolveRequestSession(req);
      if (isPrivilegedSessionRole(resolved.session?.role)) {
        return { allowed: true, response: null };
      }
    }

    if (await isPrivilegedPremiumUser(userIdBigInt)) {
      return { allowed: true, response: null };
    }

    // Check if subscription is expired
    const isExpired = await subscriptionService.isSubscriptionExpired(userIdBigInt);
    if (isExpired) {
      const error = createExpiredError();
      return {
        allowed: false,
        response: NextResponse.json(serialize({ ...error, meta: { requestId, timestamp: new Date().toISOString() } }), { status: 403 }),
      };
    }

    // Check feature access
    const hasFeature = await subscriptionService.checkFeatureAccess(userIdBigInt, feature);
    if (!hasFeature) {
      const status = await subscriptionService.getSubscriptionStatus(userIdBigInt);
      const error = createUpgradeRequiredError(
        feature,
        "standard", // Suggest standard tier for most features
        status.tier
      );
      return {
        allowed: false,
        response: NextResponse.json(serialize({ ...error, meta: { requestId, timestamp: new Date().toISOString() } }), { status: 403 }),
      };
    }

    return { allowed: true, response: null };
  };
}

// Middleware to require active subscription
export async function requireActiveSubscription(userId: bigint | string, req?: NextRequest) {
  const userIdBigInt = typeof userId === "string" ? BigInt(userId) : userId;
  const requestId = req ? generateRequestId() : "sys_" + Date.now();

  if (req) {
    const resolved = await resolveRequestSession(req);
    if (isPrivilegedSessionRole(resolved.session?.role)) {
      return { allowed: true, response: null };
    }
  }

  if (await isPrivilegedPremiumUser(userIdBigInt)) {
    return { allowed: true, response: null };
  }

  const isExpired = await subscriptionService.isSubscriptionExpired(userIdBigInt);
  if (isExpired) {
    const error = createExpiredError();
    return {
      allowed: false,
      response: NextResponse.json(serialize({ ...error, meta: { requestId, timestamp: new Date().toISOString() } }), { status: 403 }),
    };
  }

  return { allowed: true, response: null };
}

// Check virtual card creation limit
export async function checkVirtualCardLimit(userId: bigint | string, req?: NextRequest) {
  const userIdBigInt = typeof userId === "string" ? BigInt(userId) : userId;
  const requestId = req ? generateRequestId() : "sys_" + Date.now();

  const check = await subscriptionService.canCreateVirtualCard(userIdBigInt);

  if (!check.allowed) {
    const error = createLimitReachedError(
      "virtual cards",
      check.current,
      check.max
    );
    return {
      allowed: false,
      response: NextResponse.json(serialize({ ...error, meta: { requestId, timestamp: new Date().toISOString() } }), { status: 403 }),
      current: check.current,
      max: check.max,
    };
  }

  return { allowed: true, response: null, current: check.current, max: check.max };
}

// Check physical card creation limit
export async function checkPhysicalCardLimit(userId: bigint | string, req?: NextRequest) {
  const userIdBigInt = typeof userId === "string" ? BigInt(userId) : userId;
  const requestId = req ? generateRequestId() : "sys_" + Date.now();

  const check = await subscriptionService.canCreatePhysicalCard(userIdBigInt);

  if (!check.allowed) {
    const error = createLimitReachedError(
      "physical cards",
      check.current,
      check.max
    );
    return {
      allowed: false,
      response: NextResponse.json(serialize({ ...error, meta: { requestId, timestamp: new Date().toISOString() } }), { status: 403 }),
      current: check.current,
      max: check.max,
    };
  }

  return { allowed: true, response: null, current: check.current, max: check.max };
}

// Check company creation permission
export async function checkCompanyCreationPermission(userId: bigint | string, req?: NextRequest) {
  return requireFeature("canCreateCompany")(userId, req);
}

// Check gallery upload permission
export async function checkGalleryUploadPermission(userId: bigint | string, req?: NextRequest) {
  return requireFeature("canUploadGallery")(userId, req);
}

// Check inquiry management permission
export async function checkInquiryManagementPermission(userId: bigint | string, req?: NextRequest) {
  return requireFeature("canManageInquiries")(userId, req);
}

// Check analytics access permission
export async function checkAnalyticsPermission(userId: bigint | string, req?: NextRequest) {
  return requireFeature("canRealTimeAnalytics")(userId, req);
}

// Wrapper for API route handlers
export function withSubscriptionCheck(
  handler: (req: NextRequest, context: { userId: bigint }) => Promise<NextResponse>,
  options?: {
    requireActive?: boolean;
    feature?: keyof TierFeatures;
    checkCardLimit?: "virtual" | "physical";
  }
) {
  return async (req: NextRequest, context: { userId: bigint }) => {
    const { userId } = context;

    // Check active subscription
    if (options?.requireActive !== false) {
      const activeCheck = await requireActiveSubscription(userId, req);
      if (!activeCheck.allowed) {
        return activeCheck.response!;
      }
    }

    // Check specific feature
    if (options?.feature) {
      const featureCheck = await requireFeature(options.feature)(userId, req);
      if (!featureCheck.allowed) {
        return featureCheck.response!;
      }
    }

    // Check card limit
    if (options?.checkCardLimit === "virtual") {
      const limitCheck = await checkVirtualCardLimit(userId, req);
      if (!limitCheck.allowed) {
        return limitCheck.response!;
      }
    }

    if (options?.checkCardLimit === "physical") {
      const limitCheck = await checkPhysicalCardLimit(userId, req);
      if (!limitCheck.allowed) {
        return limitCheck.response!;
      }
    }

    return handler(req, context);
  };
}

// Get subscription-aware response headers
export async function getSubscriptionHeaders(userId: bigint | string): Promise<Record<string, string>> {
  const userIdBigInt = typeof userId === "string" ? BigInt(userId) : userId;
  const status = await subscriptionService.getSubscriptionStatus(userIdBigInt);

  return {
    "X-Subscription-Tier": status.tier,
    "X-Subscription-Status": status.status,
    "X-Subscription-Expired": String(status.isExpired),
    ...(status.expiresAt && { "X-Subscription-Expires": status.expiresAt.toISOString() }),
  };
}
