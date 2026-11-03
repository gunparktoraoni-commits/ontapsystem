export const BIZCARD_SUBSCRIPTION_TIERS = ["basic", "standard", "premium"] as const;

export type BizcardSubscriptionTier = (typeof BIZCARD_SUBSCRIPTION_TIERS)[number];

export const DEFAULT_BIZCARD_SUBSCRIPTION_TIER: BizcardSubscriptionTier = "basic";

const TIER_LABELS: Record<BizcardSubscriptionTier, string> = {
  basic: "Basic",
  standard: "Standard",
  premium: "Premium",
};

export function isBizcardSubscriptionTier(value: string): value is BizcardSubscriptionTier {
  return (BIZCARD_SUBSCRIPTION_TIERS as readonly string[]).includes(value);
}

/** Normalize input to a valid tier, or null if explicitly invalid. */
export function parseBizcardSubscriptionTier(
  input: unknown,
  options?: { defaultOnMissing?: boolean }
): BizcardSubscriptionTier | null {
  const defaultOnMissing = options?.defaultOnMissing ?? true;

  if (input === undefined || input === null || input === "") {
    return defaultOnMissing ? DEFAULT_BIZCARD_SUBSCRIPTION_TIER : null;
  }

  if (typeof input !== "string") {
    return null;
  }

  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    return defaultOnMissing ? DEFAULT_BIZCARD_SUBSCRIPTION_TIER : null;
  }

  return isBizcardSubscriptionTier(normalized) ? normalized : null;
}

export function formatBizcardSubscriptionTierLabel(
  tier: string | null | undefined
): string {
  if (!tier) return "—";
  const normalized = tier.trim().toLowerCase();
  if (isBizcardSubscriptionTier(normalized)) {
    return TIER_LABELS[normalized];
  }
  return tier;
}
