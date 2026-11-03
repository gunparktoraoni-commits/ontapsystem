import { NextResponse } from "next/server";
import { isPrivilegedPremiumRole } from "@/lib/auth/privileged-premium";
import { SubscriptionAccessService } from "@/lib/services/subscription-access.service";

const INTERNAL_CALENDAR_ROLES = new Set([
  "staff",
  "admin",
  "company_admin",
  "manager",
  "super_admin",
  "dev",
]);

/** Premium-only for end-user accounts; internal portal roles keep calendar access. */
export async function requireCalendarPremiumAccess(
  userId: bigint,
  role: string | null | undefined,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const normalizedRole = String(role ?? "")
    .trim()
    .toLowerCase();

  if (isPrivilegedPremiumRole(normalizedRole) || INTERNAL_CALENDAR_ROLES.has(normalizedRole)) {
    return { ok: true };
  }

  const accessService = new SubscriptionAccessService(`calendar:${userId.toString()}`);
  const status = await accessService.getUserAccessStatus(userId);
  const effectiveTier = status.premiumBoostActive ? "premium" : status.highestTier;

  if (status.hasAccess && effectiveTier === "premium") {
    return { ok: true };
  }

  return {
    ok: false,
    response: NextResponse.json(
      {
        success: false,
        error: "Calendar is a Premium feature. Upgrade your subscription to access it.",
        code: "PREMIUM_REQUIRED",
      },
      { status: 403 },
    ),
  };
}
