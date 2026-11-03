// app/api/superadmin/bizcard/mark-distributed-all/route.ts
//
// PUT /api/superadmin/bizcard/mark-distributed-all
//
// Atomically marks ALL available (Unclaimed) blank BizCards as
// "Assigned / Pending Registration" — the batch equivalent of
// PUT /api/superadmin/bizcard/:serialId/mark-distributed.
//
// Eligibility (same derivation as Available Cards / Unclaimed CSV status):
//   • is_blank = true
//   • user_id IS NULL
//   • manually_distributed_at IS NULL
//
// Atomicity:
//   All eligible cards are updated inside a single Prisma interactive
//   transaction (findMany + updateMany). On any failure the transaction
//   rolls back so either every eligible card is distributed or none are.
//
// Security:
//   • Protected by withSuperAdmin middleware (requires super_admin / dev role).
//   • Rate-limited: 5 requests/minute per IP.
//   • No request body required.
//
// Response (200 OK):
//   {
//     success: true,
//     data: {
//       count: number,
//       serialIds: string[],
//       manuallyDistributedAt: string | null,  // ISO timestamp (null when count=0)
//       status: "assigned"
//     }
//   }

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkSuperadminRateLimit } from "@/lib/bizcard/security";
import { withSuperAdmin, type SuperAdminContext } from "@/lib/auth/superadmin-middleware";
import { SuperAdminErrorCode, toSuperAdminErrorResponse } from "@/lib/errors/superadmin-errors";
import { logAdminAudit } from "@/lib/services/adminAuditService";

const AUDIT_SERIAL_ID_CAP = 200;

const prismaAny = prisma as unknown as {
  $transaction: <T>(
    fn: (tx: {
      bizcard: {
        findMany: (args: unknown) => Promise<
          Array<{ bizcard_id: bigint; serial_id: string | null }>
        >;
        updateMany: (args: unknown) => Promise<{ count: number }>;
      };
    }) => Promise<T>,
  ) => Promise<T>;
};

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

type RouteContext = SuperAdminContext;

export const PUT = withSuperAdmin(
  async (request: NextRequest, context: RouteContext) => {
    const startTime = Date.now();
    const { requestId, user } = context;

    // ── Rate Limiting ──────────────────────────────────────────
    const rateCheck = checkSuperadminRateLimit(request, "MARK_DISTRIBUTED_ALL");
    if (!rateCheck.allowed) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
          `Too many requests. Please try again in ${rateCheck.retryAfter} seconds.`,
          requestId,
          { endpoint: "MARK_DISTRIBUTED_ALL", retryAfter: rateCheck.retryAfter },
          Date.now() - startTime,
        ),
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } },
      );
    }

    try {
      const now = new Date();

      const { count, serialIds } = await prismaAny.$transaction(async (tx) => {
        const eligible = await tx.bizcard.findMany({
          where: {
            is_blank: true,
            user_id: null,
            manually_distributed_at: null,
          },
          select: {
            bizcard_id: true,
            serial_id: true,
          },
        });

        if (eligible.length === 0) {
          return { count: 0, serialIds: [] as string[] };
        }

        const ids = eligible.map((card) => card.bizcard_id);
        const result = await tx.bizcard.updateMany({
          where: {
            bizcard_id: { in: ids },
            is_blank: true,
            user_id: null,
            manually_distributed_at: null,
          },
          data: {
            manually_distributed_at: now,
            manually_distributed_by: BigInt(user.id),
            updated_at: now,
          },
        });

        // Guard against a concurrent claim/distribute race: if fewer rows
        // updated than expected, abort so the client can retry cleanly.
        if (result.count !== eligible.length) {
          throw new Error(
            `Atomic distribute-all aborted: expected ${eligible.length} updates, got ${result.count}`,
          );
        }

        return {
          count: result.count,
          serialIds: eligible
            .map((card) => card.serial_id)
            .filter((id): id is string => typeof id === "string" && id.length > 0),
        };
      });

      if (count > 0) {
        await logAdminAudit({
          adminUserId: BigInt(user.id),
          adminEmail: user.email,
          action: "MARK_ALL_BIZCARDS_MANUALLY_DISTRIBUTED",
          details: {
            count,
            distributedAt: now.toISOString(),
            serialIds:
              serialIds.length > AUDIT_SERIAL_ID_CAP
                ? serialIds.slice(0, AUDIT_SERIAL_ID_CAP)
                : serialIds,
            serialIdsTruncated: serialIds.length > AUDIT_SERIAL_ID_CAP,
          },
          ipAddress: request.headers.get("x-forwarded-for") ?? undefined,
          userAgent: request.headers.get("user-agent") ?? undefined,
        });
      }

      return NextResponse.json(
        {
          success: true,
          data: serialize({
            count,
            serialIds,
            manuallyDistributedAt: count > 0 ? now.toISOString() : null,
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
      console.error("[superadmin/bizcard/mark-distributed-all] Unhandled error:", error);
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.BIZCARD_MARK_DISTRIBUTED_ALL_FAILED,
          "Failed to distribute all available bizcards.",
          requestId,
          {},
          Date.now() - startTime,
        ),
        { status: 500 },
      );
    }
  },
  { errorMode: "superadmin" },
);
