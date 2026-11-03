export const PHYSICAL_CARD_HELP_PENDING_PREFIX = "ontap:physical-card-help:pending:";
export const PHYSICAL_CARD_HELP_ELIGIBLE_PREFIX = "ontap:physical-card-help:eligible:";
export const PHYSICAL_CARD_HELP_DISABLED_PREFIX = "ontap:physical-card-help:disabled:";

export function hasVirtualBizCardWithoutSerial(
  bizcards: unknown,
): boolean {
  if (!Array.isArray(bizcards)) return false;
  return bizcards.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const card = entry as Record<string, unknown>;
    return (
      !String(card.serial_id ?? "").trim() &&
      !String(card.serialId ?? "").trim()
    );
  });
}

export function physicalCardHelpStorageKey(prefix: string, accountKey: string): string {
  return `${prefix}${encodeURIComponent(accountKey.trim().toLowerCase())}`;
}
