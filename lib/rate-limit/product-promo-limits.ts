import { NextRequest } from "next/server";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

export const PRODUCT_PROMO_RATE_LIMITS = {
  // Product endpoints
  GET_PRODUCTS: { limit: 60, window: 60, action: "superadmin-products-list" },
  GET_PRODUCT: { limit: 120, window: 60, action: "superadmin-products-detail" },
  CREATE_PRODUCT: { limit: 20, window: 60, action: "superadmin-products-create" },
  UPDATE_PRODUCT: { limit: 30, window: 60, action: "superadmin-products-update" },
  DELETE_PRODUCT: { limit: 10, window: 60, action: "superadmin-products-delete" },
  UPLOAD_IMAGES: { limit: 20, window: 60, action: "superadmin-products-upload-images" },

  // Promo endpoints
  GET_PROMOS: { limit: 60, window: 60, action: "superadmin-promos-list" },
  GET_PROMO: { limit: 120, window: 60, action: "superadmin-promos-detail" },
  CREATE_PROMO: { limit: 20, window: 60, action: "superadmin-promos-create" },
  UPDATE_PROMO: { limit: 30, window: 60, action: "superadmin-promos-update" },
  DELETE_PROMO: { limit: 10, window: 60, action: "superadmin-promos-delete" },
  TOGGLE_PROMO: { limit: 30, window: 60, action: "superadmin-promos-toggle" },
  GET_PROMO_USAGE: { limit: 60, window: 60, action: "superadmin-promos-usage" },
  GET_TARGET_GROUPS: { limit: 30, window: 60, action: "superadmin-promos-target-groups" },
} as const;

export interface ProductPromoRateLimitResult {
  success: boolean;
  retryAfter?: number;
  remaining: number;
}

export function checkProductPromoRateLimit(
  req: NextRequest,
  endpoint: keyof typeof PRODUCT_PROMO_RATE_LIMITS,
  actorKey?: string
): ProductPromoRateLimitResult {
  const config = PRODUCT_PROMO_RATE_LIMITS[endpoint];
  const ip = getClientIp(req);
  const key = actorKey ? `${ip}:${actorKey}` : ip;

  const result = checkRateLimit(config.action, key);
  if (!result.allowed) {
    return {
      success: false,
      retryAfter: Math.max(1, Math.ceil(result.retryAfterMs / 1000)),
      remaining: 0,
    };
  }

  return {
    success: true,
    remaining: result.remaining,
  };
}
