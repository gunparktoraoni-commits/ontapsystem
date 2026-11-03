const CSS_VAR_KEY = /^--[a-z0-9-]{1,64}$/;
const MAX_SIGNED_BIGINT_64 = BigInt("9223372036854775807");

export type CssVariables = Record<string, string>;

export function normalizeCssVariables(input: unknown): CssVariables {
  if (!input || typeof input !== "object") return {};

  const out: CssVariables = {};
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const key = rawKey.trim().toLowerCase();
    if (!CSS_VAR_KEY.test(key)) continue;

    const value = String(rawValue ?? "").trim();
    if (!value || value.length > 256) continue;

    out[key] = value;
  }

  return out;
}

export function parseThemeCssVariables(raw: string | null | undefined): CssVariables {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeCssVariables(parsed);
  } catch {
    return {};
  }
}

export function validateThemeIdInput(raw: unknown): bigint | null {
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) {
    return BigInt(raw);
  }

  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^\d{1,20}$/.test(trimmed)) return null;

  try {
    const value = BigInt(trimmed);
    if (value <= BigInt(0)) return null;
    if (value > MAX_SIGNED_BIGINT_64) return null;
    return value;
  } catch {
    return null;
  }
}
