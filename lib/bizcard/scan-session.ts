import type { PhysicalCardScanResult } from "@/lib/bizcard/scan-routing";
import { isValidSerialId, normalizeSerialId } from "@/lib/bizcard/serial-id-format";
import { classifyBlankCardNextAction, persistClaimSerial } from "@/lib/bizcard/claim-urls";

export type ScanSessionWarmResult = {
  authenticated: boolean;
  refreshed: boolean;
};

type PortfolioResolveJson = {
  resolvedBy?: string;
  serialId?: string;
  customUri?: string;
  portfolioUrl?: string | null;
  redirectUrl?: string;
  requiresRegistration?: boolean;
  nextAction?: PhysicalCardScanResult["nextAction"];
  virtualCards?: PhysicalCardScanResult["virtualCards"];
  shouldRedirect?: boolean;
  error?: string;
};

function mapPortfolioResolveToScanResult(
  serialId: string,
  payload: PortfolioResolveJson,
): PhysicalCardScanResult | null {
  if (payload.nextAction === "merge_choice") {
    return {
      serialId,
      status: "blank",
      isPlaceholder: true,
      nextAction: "merge_choice",
      portfolioUrl: payload.portfolioUrl ?? null,
      customUri: null,
      redirectUrl: payload.redirectUrl ?? null,
      virtualCards: Array.isArray(payload.virtualCards) ? payload.virtualCards : [],
    };
  }

  if (payload.nextAction === "manual_register") {
    return {
      serialId,
      status: "blank",
      isPlaceholder: true,
      nextAction: "manual_register",
      portfolioUrl: payload.portfolioUrl ?? null,
      customUri: null,
      redirectUrl: payload.redirectUrl ?? null,
      virtualCards: [],
    };
  }

  if (payload.requiresRegistration || payload.nextAction === "signup") {
    return {
      serialId,
      status: "blank",
      isPlaceholder: true,
      nextAction: "signup",
      portfolioUrl: payload.portfolioUrl ?? null,
      customUri: null,
      redirectUrl: payload.redirectUrl ?? null,
      virtualCards: [],
    };
  }

  const customUri = payload.customUri?.trim() || null;
  const portfolioUrl = payload.portfolioUrl?.trim() || (customUri ? `/${customUri}` : null);

  if (customUri || portfolioUrl) {
    return {
      serialId,
      status: "linked",
      isPlaceholder: false,
      nextAction: "show_portfolio",
      portfolioUrl,
      customUri,
      redirectUrl: portfolioUrl,
      virtualCards: [],
    };
  }

  return null;
}

async function fetchPortfolioResolveFallback(
  serialId: string,
): Promise<{ ok: true; data: PhysicalCardScanResult } | { ok: false; message: string }> {
  const normalized = serialId.trim().toUpperCase();
  const response = await fetch(
    `/api/portfolio/resolve/${encodeURIComponent(normalized)}?format=json`,
    {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    },
  );

  const payload = (await response.json().catch(() => null)) as PortfolioResolveJson | null;
  if (!response.ok || !payload) {
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : response.status === 404
          ? "Card not found."
          : "Unable to resolve this card right now.";
    return { ok: false, message };
  }

  const mapped = mapPortfolioResolveToScanResult(normalized, payload);
  if (!mapped) {
    return { ok: false, message: "Unable to resolve this card right now." };
  }

  return { ok: true, data: mapped };
}

/**
 * Refresh expired access tokens (via refresh_token cookie) before scan routing.
 * Critical for iOS Safari where session_token may expire while the user still
 * appears logged in via client-side auth state.
 */
export async function warmScanSession(): Promise<ScanSessionWarmResult> {
  try {
    const response = await fetch("/api/auth/session-health", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      return { authenticated: false, refreshed: false };
    }
    const payload = (await response.json().catch(() => null)) as {
      authenticated?: boolean;
      refreshed?: boolean;
    } | null;
    return {
      authenticated: payload?.authenticated === true,
      refreshed: payload?.refreshed === true,
    };
  } catch {
    return { authenticated: false, refreshed: false };
  }
}

export async function fetchPhysicalCardScan(
  serialId: string,
): Promise<{ ok: true; data: PhysicalCardScanResult } | { ok: false; message: string }> {
  const normalized = normalizeSerialId(serialId);
  if (!normalized || !isValidSerialId(normalized)) {
    return { ok: false, message: "Invalid card serial format." };
  }

  persistClaimSerial(normalized);
  await warmScanSession();

  const response = await fetch(`/api/bizcard/scan/${encodeURIComponent(normalized)}`, {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  const payload = await response.json().catch(() => null);
  if (response.ok && payload?.success && payload?.data) {
    const data = payload.data as PhysicalCardScanResult;
    // Normalize legacy manual_register wording for callers that branch on classification.
    void classifyBlankCardNextAction(data.nextAction);
    return { ok: true, data };
  }

  if (response.status >= 500) {
    const fallback = await fetchPortfolioResolveFallback(normalized);
    if (fallback.ok) {
      return fallback;
    }
  }

  const message =
    typeof payload?.error?.message === "string"
      ? payload.error.message
      : "Unable to process this card scan right now.";
  return { ok: false, message };
}

export function resolvePortfolioHref(aliasOrUrl: string): string {
  const value = aliasOrUrl.trim();
  if (!value) return "/";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return value;
  return `/${encodeURIComponent(value)}`;
}
