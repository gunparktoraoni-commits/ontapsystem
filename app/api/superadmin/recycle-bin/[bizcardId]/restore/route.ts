import { NextRequest, NextResponse } from "next/server";
import { getClientIp, getUserAgent, logAuditEvent } from "@/server/lib/auth";
import { withSuperAdmin, type SuperAdminContext } from "@/lib/auth/superadmin-middleware";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { restoreUserAndBizcard } from "@/server/lib/superadmin/user-bizcards";

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

export const POST = withSuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  const rateCheck = checkRateLimit("superadmin-recycle-bin-restore", getClientIp(req));
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SUPERADMIN_RECYCLE_BIN_RATE_LIMITED",
          tag: "[SUPERADMIN_RECYCLE_BIN]",
          message: "Too many restore requests. Please slow down.",
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
    const restored = await restoreUserAndBizcard(parsedBizcardId);

    await logAuditEvent(
      "superadmin_user_restore",
      Number(user.userId),
      getClientIp(req),
      getUserAgent(req),
      {
        restoredBizcardId: restored.bizcard_id,
        restoredUserId: restored.user_id,
        serialId: restored.serial_id,
        userEmail: restored.user_email,
      },
    );

    return NextResponse.json({
      success: true,
      message: "User restored successfully.",
      data: {
        bizcard_id: restored.bizcard_id,
        user_id: restored.user_id,
        serial_id: restored.serial_id,
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
            message: "Recycle Bin entry not found or already restored.",
          },
        },
        { status: 404 },
      );
    }

    console.error("[SUPERADMIN_RECYCLE_BIN] Failed to restore user", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SUPERADMIN_RECYCLE_BIN_RESTORE_FAILED",
          tag: "[SUPERADMIN_RECYCLE_BIN]",
          message: "Failed to restore user from Recycle Bin.",
        },
      },
      { status: 500 },
    );
  }
}, { errorMode: "superadmin" });
