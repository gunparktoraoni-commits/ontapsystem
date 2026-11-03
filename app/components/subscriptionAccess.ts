import { FrontendSubscriptionError } from './frontendErrorCodes';
import { withImpersonationHeaders } from '../lib/superadminImpersonationHandoff';

export type FrontendAccessReason =
  | 'free_trial'
  | 'active_subscription'
  | 'trial_expired'
  | 'subscription_expired'
  | 'expired'
  | 'none';

export interface FrontendAccessStatus {
  hasAccess: boolean;
  reason: FrontendAccessReason;
  expiresAt?: string | null;
  daysRemaining?: number;
  highestTier?: 'basic' | 'standard' | 'premium' | null;
  expirationKind?: 'free_trial' | 'paid_subscription' | null;
}

export interface FrontendSubscriptionStatus {
  tier: string;
  status: 'active' | 'expired' | 'pending_activation';
  expiresAt?: string | null;
  daysRemaining?: number;
  accessReason?: FrontendAccessReason;
  trialExpired?: boolean;
  subscriptionExpired?: boolean;
  expirationKind?: 'free_trial' | 'paid_subscription' | null;
}

export interface SubscriptionState {
  source: 'access-status' | 'user-subscription' | 'merged';
  access: FrontendAccessStatus;
  subscription?: FrontendSubscriptionStatus;
}

function normalizeDays(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.floor(parsed));
}

function inferLegacyExpiredReason(
  payload: Record<string, unknown> | undefined,
): FrontendAccessReason {
  const expiration =
    payload?.expiration && typeof payload.expiration === 'object'
      ? (payload.expiration as Record<string, unknown>)
      : null;
  const expirationKind = String(expiration?.kind ?? '').trim().toLowerCase();
  if (expirationKind === 'free_trial') return 'trial_expired';
  if (expirationKind === 'paid_subscription') return 'subscription_expired';

  const freeTrial =
    payload?.free_trial && typeof payload.free_trial === 'object'
      ? (payload.free_trial as Record<string, unknown>)
      : null;
  const bizcardSubscription =
    payload?.bizcard_subscription && typeof payload.bizcard_subscription === 'object'
      ? (payload.bizcard_subscription as Record<string, unknown>)
      : null;

  if (Boolean(freeTrial?.expired)) return 'trial_expired';
  if (Boolean(bizcardSubscription?.expired)) return 'subscription_expired';
  return 'expired';
}

function normalizeAccessReason(
  reasonRaw: string,
  hasAccess: boolean,
  payload?: Record<string, unknown>,
): FrontendAccessReason {
  const normalized = reasonRaw.trim().toLowerCase();
  if (
    normalized === 'free_trial' ||
    normalized === 'active_subscription' ||
    normalized === 'trial_expired' ||
    normalized === 'subscription_expired' ||
    normalized === 'expired' ||
    normalized === 'none'
  ) {
    if (normalized === 'expired') {
      return inferLegacyExpiredReason(payload);
    }
    return normalized as FrontendAccessReason;
  }

  return hasAccess ? 'active_subscription' : 'none';
}

function normalizeAccessStatus(
  raw: unknown,
  payload?: Record<string, unknown>,
): FrontendAccessStatus {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const hasAccess = Boolean(obj.hasAccess ?? obj.has_access);
  const reasonRaw = String(obj.reason ?? '').trim().toLowerCase();
  const reason = normalizeAccessReason(reasonRaw, hasAccess, payload);

  const expiration =
    payload?.expiration && typeof payload.expiration === 'object'
      ? (payload.expiration as Record<string, unknown>)
      : null;

  return {
    hasAccess,
    reason,
    expiresAt: (obj.expiresAt ?? obj.expires_at ?? null) as string | null,
    daysRemaining: normalizeDays(obj.daysRemaining ?? obj.days_remaining),
    highestTier: (obj.highestTier ?? obj.highest_tier ?? null) as FrontendAccessStatus['highestTier'],
    expirationKind: (expiration?.kind ??
      obj.expirationKind ??
      obj.expiration_kind ??
      null) as FrontendAccessStatus['expirationKind'],
  };
}

function normalizeSubscriptionStatus(raw: unknown): FrontendSubscriptionStatus | undefined {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!obj) return undefined;

  const tier = String(obj.tier ?? '').trim();
  const statusRaw = String(obj.status ?? '').trim().toLowerCase();
  const status =
    statusRaw === 'active' || statusRaw === 'expired' || statusRaw === 'pending_activation'
      ? (statusRaw as FrontendSubscriptionStatus['status'])
      : undefined;

  const accessReasonRaw = String(obj.access_reason ?? obj.accessReason ?? '').trim().toLowerCase();
  const accessReason = accessReasonRaw
    ? normalizeAccessReason(accessReasonRaw, status === 'active', obj)
    : undefined;

  if (!tier && !status) return undefined;

  return {
    tier: tier || 'unknown',
    status: status ?? 'active',
    expiresAt: (obj.expires_at ?? obj.expiresAt ?? null) as string | null,
    daysRemaining: normalizeDays(obj.days_remaining ?? obj.daysRemaining),
    accessReason,
    trialExpired: Boolean(obj.trial_expired ?? obj.trialExpired),
    subscriptionExpired: Boolean(obj.subscription_expired ?? obj.subscriptionExpired),
    expirationKind: (obj.expiration_kind ??
      obj.expirationKind ??
      null) as FrontendSubscriptionStatus['expirationKind'],
  };
}

function parseRequestId(meta: unknown): string | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  const raw = String((meta as Record<string, unknown>).requestId ?? '').trim();
  return raw || undefined;
}

function parseFeatureCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}


export interface SubscriptionSummary {
  state: SubscriptionState;
  currentPhysicalCards: number;
  currentVirtualCards: number;
}



export async function fetchSubscriptionSummary(apiBase: string): Promise<SubscriptionSummary> {
  const response = await fetch(`${apiBase}/api/user/subscription`, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'include',
    headers: withImpersonationHeaders(),
  });


  
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const data = payload?.data && typeof payload.data === 'object' ? (payload.data as Record<string, unknown>) : {};
  const features = data.features && typeof data.features === 'object' ? (data.features as Record<string, unknown>) : {};


  if (!response.ok) {
    const err = new Error('Unable to fetch subscription summary.') as Error & {
      requestId?: string;
    };
    err.requestId = parseRequestId(payload?.meta);
    throw err;
  }
  


  const subscription = normalizeSubscriptionStatus(data);
  const mergedAccess = buildAccessFromSubscription(subscription);

  
  return {
    state: {
      source: 'user-subscription',
      access: mergedAccess,
      subscription,
    },
    
    currentPhysicalCards: parseFeatureCount(features.current_physical_cards ?? features.currentPhysicalCards),
    currentVirtualCards: parseFeatureCount(features.current_virtual_cards ?? features.currentVirtualCards),
  };
}

function buildAccessFromSubscription(subscription: FrontendSubscriptionStatus | undefined): FrontendAccessStatus {
  if (!subscription) {
    return { hasAccess: false, reason: 'none' };
  }

  if (subscription.accessReason) {
    const hasAccess =
      subscription.status === 'active' &&
      !subscription.trialExpired &&
      !subscription.subscriptionExpired &&
      (subscription.daysRemaining ?? 1) > 0;

    return {
      hasAccess,
      reason: subscription.accessReason,
      expiresAt: subscription.expiresAt ?? null,
      daysRemaining: subscription.daysRemaining,
      highestTier: (subscription.tier as FrontendAccessStatus['highestTier']) ?? null,
      expirationKind: subscription.expirationKind ?? null,
    };
  }

  if (subscription.trialExpired) {
    return {
      hasAccess: false,
      reason: 'trial_expired',
      expiresAt: subscription.expiresAt ?? null,
      daysRemaining: 0,
      expirationKind: 'free_trial',
    };
  }

  if (subscription.subscriptionExpired || subscription.status === 'expired') {
    return {
      hasAccess: false,
      reason: subscription.subscriptionExpired ? 'subscription_expired' : 'expired',
      expiresAt: subscription.expiresAt ?? null,
      daysRemaining: subscription.daysRemaining ?? 0,
      expirationKind: subscription.expirationKind ?? 'paid_subscription',
    };
  }



  return {
    hasAccess: subscription.status === 'active' && (subscription.daysRemaining ?? 1) > 0,
    reason: subscription.status === 'active' ? 'active_subscription' : 'none',
    expiresAt: subscription.expiresAt ?? null,
    daysRemaining: subscription.daysRemaining,
    highestTier: (subscription.tier as FrontendAccessStatus['highestTier']) ?? null,
  };
}


export async function fetchSubscriptionState(apiBase: string): Promise<SubscriptionState> {
  const accessResponse = await fetch(`${apiBase}/api/user/access-status`, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'include',
    headers: withImpersonationHeaders(),
  });

  let accessPayload: Record<string, unknown> | null = null;
  if (accessResponse.ok) {
    accessPayload = (await accessResponse.json().catch(() => null)) as Record<string, unknown> | null;
  }

  const data =
    accessPayload?.data && typeof accessPayload.data === 'object'
      ? (accessPayload.data as Record<string, unknown>)
      : undefined;

  const access = normalizeAccessStatus(data?.access_status, data);

  if (accessResponse.ok) {
    return {
      source: 'access-status',
      access,
    };
  }

  const subscriptionResponse = await fetch(`${apiBase}/api/user/subscription`, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'include',
    headers: withImpersonationHeaders(),
  });
  const subscriptionPayload = (await subscriptionResponse.json().catch(() => null)) as Record<string, unknown> | null;
  const requestId = parseRequestId(subscriptionPayload?.meta);

  if (!subscriptionResponse.ok) {
    const err = new Error('Unable to fetch subscription state.') as Error & {
      errorCode?: FrontendSubscriptionError;
      requestId?: string;
    };
    err.errorCode = FrontendSubscriptionError.SUBSCRIPTION_EXPIRED;
    err.requestId = requestId;
    throw err;
  }

  const subscription = normalizeSubscriptionStatus(subscriptionPayload?.data);
  const mergedAccess = buildAccessFromSubscription(subscription);

  return {
    source: 'merged',
    access: mergedAccess,
    subscription,
  };
}

export function shouldRedirectToSubscription(state: SubscriptionState): boolean {
  if (!state.access.hasAccess) {
    return (
      state.access.reason === 'trial_expired' ||
      state.access.reason === 'subscription_expired' ||
      state.access.reason === 'expired' ||
      state.access.reason === 'none'
    );
  }

  if (typeof state.access.daysRemaining === 'number' && state.access.daysRemaining <= 0) {
    return true;
  }

  if (state.subscription?.trialExpired || state.subscription?.subscriptionExpired) {
    return true;
  }

  if (state.subscription?.status === 'expired') {
    return true;
  }

  if (typeof state.subscription?.daysRemaining === 'number' && state.subscription.daysRemaining <= 0) {
    return true;
  }

  return false;
}

export function shouldRestrictMarketplaceTabs(
  state: SubscriptionState,
  currentPhysicalCards?: number,
): boolean {
  if (!state.access.hasAccess) return true;
  if (state.access.reason === 'free_trial') return true;
  if (typeof currentPhysicalCards === 'number' && currentPhysicalCards <= 0) return true;
  return false;
}

export function getSubscriptionRedirectReason(state: SubscriptionState): 'expired' | 'trial' {
  if (state.access.reason === 'trial_expired') return 'trial';
  if (state.access.reason === 'subscription_expired') return 'expired';
  if (state.access.reason === 'free_trial') return 'trial';
  if (state.access.reason === 'expired') {
    if (state.access.expirationKind === 'free_trial') return 'trial';
    return 'expired';
  }
  if (state.subscription?.trialExpired) return 'trial';
  if (state.subscription?.subscriptionExpired) return 'expired';
  if (state.subscription?.expirationKind === 'free_trial') return 'trial';
  return 'expired';
}

export type SubscriptionExpiryWarning = {
  title: string;
  message: string;
};

/** Returns dashboard warning copy when trial/paid expiry thresholds are met. */
export function getSubscriptionExpiryWarning(
  state: SubscriptionState,
): SubscriptionExpiryWarning | null {
  const days = state.access.daysRemaining;
  const kind =
    state.access.expirationKind ??
    (state.access.reason === 'free_trial'
      ? 'free_trial'
      : state.access.reason === 'active_subscription'
        ? 'paid_subscription'
        : null);

  const expired =
    !state.access.hasAccess &&
    (state.access.reason === 'trial_expired' ||
      state.access.reason === 'subscription_expired' ||
      state.access.reason === 'expired');

  if (expired) {
    return {
      title: 'Subscription expired',
      message: 'Your subscription has expired. Please renew to continue using the service.',
    };
  }

  if (kind === 'free_trial' && days === 1) {
    return {
      title: 'Free trial ending',
      message:
        'Your free trial is about to expire. Subscribe now to continue using the service.',
    };
  }

  if (kind === 'paid_subscription' && (days === 1 || days === 3)) {
    return {
      title: 'Subscription expiring',
      message:
        days === 1
          ? 'Your subscription will expire in 1 day. Renew now to avoid interruption.'
          : 'Your subscription will expire in 3 days. Renew now to avoid interruption.',
    };
  }

  return null;
}

/**
 * True when the user has an active Premium plan for Premium-only UI
 * (e.g. Missions & Rewards). Free Trial / Basic / Standard / expired → false.
 * Aligns with PortalSidebar plan-label rules (trial wins over boosted tier).
 */
export function hasActivePremiumPlan(input: {
  tier?: string | null;
  accessReason?: string | null;
  isTrial?: boolean;
  status?: string | null;
  isExpired?: boolean;
}): boolean {
  const tier = String(input.tier ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const reason = String(input.accessReason ?? '').trim().toLowerCase();
  const status = String(input.status ?? '').trim().toLowerCase();
  const isTrial = Boolean(input.isTrial);
  const isExpired = Boolean(input.isExpired) || status === 'expired';

  if (isExpired || status === 'pending_activation') return false;

  if (
    tier === 'free_trial' ||
    reason === 'free_trial' ||
    (tier === 'none' && (isTrial || reason === 'free_trial'))
  ) {
    return false;
  }

  return tier === 'premium';
}
