export enum FrontendSubscriptionError {
  SUBSCRIPTION_EXPIRED = 'FE_SUB_60000',
  FREE_TRIAL_EXPIRED = 'FE_SUB_60001',
  THEME_APPLY_FAILED = 'FE_THEME_60002',
  GALLERY_SSL_ERROR = 'FE_GALLERY_60003',
  THEME_API_NOT_FOUND = 'FE_THEME_API_60004',
}

export enum DashboardErrorCode {
  BIZCARD_NOT_FOUND = 'FE_BIZCARD_70001',
  UNAUTHORIZED_ACCESS = 'FE_BIZCARD_70002',
  SUBSCRIPTION_REQUIRED = 'FE_BIZCARD_70003',
  DATA_FETCH_FAILED = 'FE_BIZCARD_70004',
}

export function formatTaggedError(
  code: FrontendSubscriptionError | DashboardErrorCode,
  message: string,
  requestId?: string | null
): string {
  const rid = requestId && requestId.trim().length > 0 ? ` requestId=${requestId}` : '';
  return `[${code}] ${message}${rid}`;
}
