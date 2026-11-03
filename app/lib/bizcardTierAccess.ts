export type BizcardTierRow = {
  subscription_tier?: string | null;
  is_active?: boolean;
};

const STANDARD_PLUS = new Set(['standard', 'premium', 'enterprise']);

export function normalizeTier(tier: string | null | undefined): string {
  return String(tier ?? '').trim().toLowerCase();
}

export function hasStandardOrHigherBizcard(cards: BizcardTierRow[]): boolean {
  return cards.some((card) => {
    if (card.is_active === false) return false;
    return STANDARD_PLUS.has(normalizeTier(card.subscription_tier));
  });
}

export function hasPremiumBizcard(cards: BizcardTierRow[]): boolean {
  return cards.some((card) => {
    if (card.is_active === false) return false;
    const tier = normalizeTier(card.subscription_tier);
    return tier === 'premium' || tier === 'enterprise';
  });
}

export async function fetchUserBizcardTiers(apiBase: string): Promise<BizcardTierRow[]> {
  const res = await fetch(`${apiBase}/api/user/bizcards`, {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!res.ok) return [];
  const payload = await res.json().catch(() => null) as Record<string, unknown> | null;
  const data = (payload?.data ?? payload) as Record<string, unknown> | null;
  const list = data?.bizcards ?? payload?.bizcards;
  return Array.isArray(list) ? (list as BizcardTierRow[]) : [];
}
