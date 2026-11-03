// ──────────────────────────────────────────────────────────────
// Activity Logger — Lightweight Dashboard Event Tracking
// ──────────────────────────────────────────────────────────────
// Records meaningful portfolio events to the ActivityLog table so
// portfolio owners can see a live feed of what's happening on their
// profile (new views, connections, inquiries, contact saves, card scans).
//
// Design principles:
//   - Fire-and-forget: callers never await errors from this function.
//     Dashboard activity is non-critical; a DB write failure should
//     never break a user-facing API response.
//   - Thin wrapper: no validation, no rate-limiting — callers are
//     trusted internal API handlers.
//   - No sensitive data in meta: caller is responsible for omitting PII
//     (e.g. pass visitor "display name" not their email or full user row).
// ──────────────────────────────────────────────────────────────

import { prisma } from "./prisma";

/**
 * Write one ActivityLog row for the given user.
 *
 * @param userId       — The portfolio OWNER who should see this event in their feed.
 * @param activityType — One of: PROFILE_VIEW | NEW_CONNECTION | NEW_SCAN | NEW_INQUIRY | CONTACT_SAVED
 * @param referenceId  — BigInt PK of the source record for deep-linking (optional).
 * @param meta         — Extra display context stored as JSON (optional, keep slim).
 *
 * This function is intentionally fire-and-forget — it never throws.
 * Callers should NOT await it when they do not need the result.
 */
export async function getUserDisplayName(userId: bigint): Promise<string> {
  try {
    const user = await prisma.user.findUnique({
      where: { user_id: userId },
      select: { first_name: true, last_name: true, email: true },
    });
    if (!user) return "Someone";
    const name = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();
    return name || "Someone";
  } catch {
    return "Someone";
  }
}

export function parseActivityMeta(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

export async function logActivity(
  userId: number,
  activityType: string,
  referenceId?: bigint | null,
  meta?: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        user_id:       BigInt(userId),
        activity_type: activityType,
        reference_id:  referenceId ?? null,
        ...(meta !== undefined ? { meta: JSON.stringify(meta) } : {}),
      },
    });
  } catch (err) {
    // Non-fatal: log to console but never propagate to the caller.
    console.error("[logActivity] Failed to write activity log:", err);
  }
}
