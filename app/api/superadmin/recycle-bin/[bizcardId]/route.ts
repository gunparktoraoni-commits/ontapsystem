import { NextRequest, NextResponse } from "next/server";
import { getClientIp, getUserAgent, logAuditEvent } from "@/server/lib/auth";
import { withSuperAdmin, type SuperAdminContext } from "@/lib/auth/superadmin-middleware";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { deleteUserAndBizcard } from "@/server/lib/superadmin/user-bizcards";
import { prisma } from "@/server/lib/prisma";

type RouteContext = SuperAdminContext & {
  params: Promise<{ bizcardId: string }>;
};

function parseBizcardId(raw: string): bigint | null {
  try {
    const value = BigInt(raw);
    return value > BigInt(0) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Permanently purge a soft-deleted user + bizcard(s) from the Recycle Bin.
 */
export const DELETE = withSuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  const rateCheck = checkRateLimit("superadmin-recycle-bin-purge", getClientIp(req));
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SUPERADMIN_RECYCLE_BIN_RATE_LIMITED",
          tag: "[SUPERADMIN_RECYCLE_BIN]",
          message: "Too many permanent delete requests. Please slow down.",
        },
      },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } },
    );
  }

  const { bizcardId } = await context.params;
  const parsedBizcardId = parseBizcardId(bizcardId);
  if (!parsedBizcardId) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SUPERADMIN_RECYCLE_BIN_INVALID_ID",
          tag: "[SUPERADMIN_RECYCLE_BIN]",
          message: "Invalid bizcardId path parameter.",
        },
      },
      { status: 400 },
    );
  }

  try {
    // Only allow permanent delete for entries already in the Recycle Bin.
    const softDeleted = await prisma.bizcard.findFirst({
      where: {
        bizcard_id: parsedBizcardId,
        is_blank: false,
        user_id: { not: null },
        deleted_at: { not: null },
        user: { deleted_at: { not: null } },
      },
      select: { bizcard_id: true },
    });

    if (!softDeleted) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "SUPERADMIN_RECYCLE_BIN_NOT_FOUND",
            tag: "[SUPERADMIN_RECYCLE_BIN]",
            message: "Recycle Bin entry not found. Move the user to Recycle Bin before permanently deleting.",
          },
        },
        { status: 404 },
      );
    }

    const deleted = await deleteUserAndBizcard(parsedBizcardId);

    await logAuditEvent(
      "superadmin_user_permanent_delete",
      Number(user.userId),
      getClientIp(req),
      getUserAgent(req),
      {
        deletedBizcardId: deleted.bizcard_id,
        deletedUserId: deleted.user_id,
        serialId: deleted.serial_id,
        userEmail: deleted.user_email,
      },
    );

    return NextResponse.json({
      success: true,
      message: "User and all associated data permanently deleted.",
      data: {
        bizcard_id: deleted.bizcard_id,
        user_id: deleted.user_id,
        serial_id: deleted.serial_id,
      },
      meta: {
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "BIZCARD_NOT_FOUND") {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "SUPERADMIN_RECYCLE_BIN_NOT_FOUND",
            tag: "[SUPERADMIN_RECYCLE_BIN]",
            message: "Recycle Bin entry not found or already permanently deleted.",
          },
        },
        { status: 404 },
      );
    }

    console.error("[SUPERADMIN_RECYCLE_BIN] Failed to permanently delete user", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SUPERADMIN_RECYCLE_BIN_PURGE_FAILED",
          tag: "[SUPERADMIN_RECYCLE_BIN]",
          message: "Failed to permanently delete user from Recycle Bin.",
        },
      },
      { status: 500 },
    );
  }
}, { errorMode: "superadmin" });
