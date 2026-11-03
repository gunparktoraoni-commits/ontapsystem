// app/api/superadmin/bizcard/[serialId]/mark-distributed/route.ts
//
// PUT /api/superadmin/bizcard/:serialId/mark-distributed
//
// Allows a SuperAdmin to manually mark a blank (Available) BizCard as
// "Assigned / Pending Registration" — indicating that the physical card
// has been physically handed to someone, even before they have registered
// on the platform.
//
// Business rules:
//   • Card must be blank (is_blank = true) and not yet claimed (user_id = null).
//   • Calling this endpoint on an already-claimed card returns 409.
//   • If the card was already manually marked, the action is idempotent (200).
//   • The card's `manually_distributed_at` and `manually_distributed_by` fields
//     are set in the database; `user_id` stays null (registration has not happened).
//   • The frontend uses `manually_distributed_at != null && user_id == null` to
//     render the card in "Distributed Cards" with status "Assigned / Pending".
//   • When a user later registers with this serial ID via /api/bizcard/claim +
//     /api/bizcard/merge, the merge service sets `user_id` — at that point the
//     card appears as fully "Claimed" in both Available and Distributed tables.
//
// Security:
//   • Protected by withSuperAdmin middleware (requires super_admin / dev role).
//   • Rate-limited: 30 requests/minute per IP.
//   • Serial ID validated against the established SERIAL_ID_PATTERN.
//   • No body required; all input comes from the URL path parameter.
//
// Response (200 OK):
//   {
//     success: true,
//     data: {
//       serialId: string,
//       manuallyDistributedAt: string,   // ISO timestamp
//       status: "assigned"
//     }
//   }

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkSuperadminRateLimit } from "@/lib/bizcard/security";
import { isValidSerialId } from "@/lib/bizcard/generator";
import { withSuperAdmin, type SuperAdminContext } from "@/lib/auth/superadmin-middleware";
import { SuperAdminErrorCode, toSuperAdminErrorResponse } from "@/lib/errors/superadmin-errors";
import { logAdminAudit } from "@/lib/services/adminAuditService";

// Cast prisma to any so we can access the new schema fields before the Prisma
// client is regenerated (same safe pattern used across this codebase).
const prismaAny = prisma as unknown as {
  bizcard: {
    findFirst: (args: unknown) => Promise<{
      bizcard_id: bigint;
      serial_id: string | null;
      user_id: bigint | null;
      is_blank: boolean;
      manually_distributed_at: Date | null;
      portfolio_url: string | null;
    } | null>;
    update: (args: unknown) => Promise<{
      bizcard_id: bigint;
      serial_id: string | null;
      manually_distributed_at: Date | null;
    }>;
  };
};

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

type RouteContext = SuperAdminContext & {
  params: Promise<{ serialId: string }>;
};

export const PUT = withSuperAdmin(
  async (request: NextRequest, context: RouteContext) => {
    const startTime = Date.now();
    const { requestId, user } = context;

    // ── Rate Limiting ──────────────────────────────────────────
    const rateCheck = checkSuperadminRateLimit(request, "MARK_DISTRIBUTED");
    if (!rateCheck.allowed) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
          `Too many requests. Please try again in ${rateCheck.retryAfter} seconds.`,
          requestId,
          { endpoint: "MARK_DISTRIBUTED", retryAfter: rateCheck.retryAfter },
          Date.now() - startTime,
        ),
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } },
      );
    }

    // ── Extract & Validate Serial ID ───────────────────────────
    const resolvedParams = await context.params;
    const { serialId } = resolvedParams;

    if (!isValidSerialId(serialId)) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.BIZCARD_SERIAL_INVALID,
          "Invalid serial ID format.",
          requestId,
          { serialId },
          Date.now() - startTime,
        ),
        { status: 400 },
      );
    }

    try {
      // ── Fetch Blank Card ─────────────────────────────────────
      const card = await prismaAny.bizcard.findFirst({
        where: {
          serial_id: serialId,
          is_blank: true,
        },
        select: {
          bizcard_id: true,
          serial_id: true,
          user_id: true,
          is_blank: true,
          manually_distributed_at: true,
          portfolio_url: true,
        },
      });

      if (!card) {
        return NextResponse.json(
          toSuperAdminErrorResponse(
            SuperAdminErrorCode.BIZCARD_NOT_FOUND,
            "Blank bizcard not found. Only superadmin-generated blank cards can be manually distributed.",
            requestId,
            { serialId },
            Date.now() - startTime,
          ),
          { status: 404 },
        );
      }

      // ── Guard: Card Already Claimed by a Registered User ──────
      if (card.user_id !== null) {
        return NextResponse.json(
          toSuperAdminErrorResponse(
            SuperAdminErrorCode.BIZCARD_ALREADY_CLAIMED,
            "This card has already been claimed by a registered user and cannot be manually marked as distributed.",
            requestId,
            { serialId, status: "claimed" },
            Date.now() - startTime,
          ),
          { status: 409 },
        );
      }

      // ── Idempotency: Already Manually Distributed ─────────────
      if (card.manually_distributed_at !== null) {
        return NextResponse.json(
          {
            success: true,
            data: serialize({
              serialId: card.serial_id,
              manuallyDistributedAt: card.manually_distributed_at,
              status: "assigned",
              message: "Card was already marked as distributed.",
            }),
            meta: {
              requestId,
              responseTime: Date.now() - startTime,
              timestamp: new Date().toISOString(),
            },
          },
          { status: 200 },
        );
      }

      // ── Persist: Mark as Manually Distributed ────────────────
      const now = new Date();
      const updated = await prismaAny.bizcard.update({
        where: { bizcard_id: card.bizcard_id },
        data: {
          manually_distributed_at: now,
          manually_distributed_by: BigInt(user.id),
          updated_at: now,
        },
        select: {
          bizcard_id: true,
          serial_id: true,
          manually_distributed_at: true,
        },
      });

      // ── Audit Log ──────────────────────────────────────────────
      await logAdminAudit({
        adminUserId: BigInt(user.id),
        adminEmail: user.email,
        action: "MARK_BIZCARD_MANUALLY_DISTRIBUTED",
        details: {
          serialId,
          bizcardId: updated.bizcard_id.toString(),
          distributedAt: now.toISOString(),
        },
        ipAddress: request.headers.get("x-forwarded-for") ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
      });

      return NextResponse.json(
        {
          success: true,
          data: serialize({
            serialId: updated.serial_id,
            manuallyDistributedAt: updated.manually_distributed_at,
            status: "assigned",
          }),
          meta: {
            requestId,
            responseTime: Date.now() - startTime,
            timestamp: new Date().toISOString(),
          },
        },
        { status: 200 },
      );
    } catch (error) {
      console.error("[superadmin/bizcard/mark-distributed] Unhandled error:", error);
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.BIZCARD_MARK_DISTRIBUTED_FAILED,
          "Failed to mark bizcard as distributed.",
          requestId,
          { serialId },
          Date.now() - startTime,
        ),
        { status: 500 },
      );
    }
  },
  { errorMode: "superadmin" },
);
