export enum SubscriptionErrorCode {
  SUBSCRIPTION_EXPIRED = "SUB_29000",
  FEATURE_NOT_AVAILABLE = "SUB_29001",
  UPGRADE_REQUIRED = "SUB_29002",
  TRIAL_ALREADY_USED = "SUB_29003",
  INVALID_TIER = "SUB_29004",
  LIMIT_REACHED = "SUB_29005",
  CARD_LIMIT_EXCEEDED = "SUB_29006",
  COMPANY_CREATION_NOT_ALLOWED = "SUB_29007",
  GALLERY_UPLOAD_NOT_ALLOWED = "SUB_29008",
  INQUIRY_MANAGEMENT_NOT_ALLOWED = "SUB_29009",
  ANALYTICS_NOT_AVAILABLE = "SUB_29010",
}

export interface SubscriptionErrorResponse {
  success: false;
  error: {
    code: SubscriptionErrorCode;
    message: string;
    redirect_url?: string;
    details?: Record<string, unknown>;
  };
  meta?: {
    requestId: string;
    timestamp: string;
  };
}

export function createSubscriptionError(
  code: SubscriptionErrorCode,
  message: string,
  redirectUrl?: string,
  details?: Record<string, unknown>
): SubscriptionErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      ...(redirectUrl && { redirect_url: redirectUrl }),
      ...(details && { details }),
    },
  };
}

export function createUpgradeRequiredError(
  feature: string,
  requiredTier: string,
  currentTier: string
): SubscriptionErrorResponse {
  return createSubscriptionError(
    SubscriptionErrorCode.UPGRADE_REQUIRED,
    `Upgrade required to access ${feature}. Your current ${currentTier} plan does not include this feature.`,
    `/pricing?upgrade=${requiredTier}&reason=${feature}`,
    { required_tier: requiredTier, current_tier: currentTier, feature }
  );
}

export function createExpiredError(): SubscriptionErrorResponse {
  return createSubscriptionError(
    SubscriptionErrorCode.SUBSCRIPTION_EXPIRED,
    "Your subscription has expired. Please renew to continue accessing all features.",
    "/user/emarket?tab=subscription&reason=expired",
    { expired: true }
  );
}

export function createTrialExpiredError(): SubscriptionErrorResponse {
  return createSubscriptionError(
    SubscriptionErrorCode.SUBSCRIPTION_EXPIRED,
    "Your free trial has ended. Subscribe to keep premium features active.",
    "/user/emarket?tab=subscription&reason=trial",
    { trial_expired: true }
  );
}

export function createLimitReachedError(
  resource: string,
  current: number,
  max: number
): SubscriptionErrorResponse {
  return createSubscriptionError(
    SubscriptionErrorCode.LIMIT_REACHED,
    `You have reached the limit for ${resource} (${current}/${max}). Please upgrade your plan for more.`,
    "/pricing?reason=limit_reached",
    { resource, current, max }
  );
}
