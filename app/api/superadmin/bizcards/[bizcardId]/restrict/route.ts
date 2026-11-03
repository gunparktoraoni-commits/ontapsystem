import { NextRequest, NextResponse } from "next/server";
import { getClientIp, getUserAgent, logAuditEvent } from "@/server/lib/auth";
import { withSuperAdmin, type SuperAdminContext } from "@/lib/auth/superadmin-middleware";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { setSuperAdminBizcardRestricted } from "@/server/lib/superadmin/user-bizcards";

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

async function parseBody(req: NextRequest): Promise<{ restricted: boolean; reason: string | null }> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("INVALID_BODY");
  }

  if (typeof body.restricted !== "boolean") {
    throw new Error("INVALID_RESTRICTED_FLAG");
  }

  const reason =
    typeof body.reason === "string" && body.reason.trim().length > 0
      ? body.reason.trim().slice(0, 500)
      : null;

  return { restricted: body.restricted, reason };
}

export const PATCH = withSuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  const rateCheck = checkRateLimit("superadmin-user-bizcards-restrict", getClientIp(req));
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SUPERADMIN_BIZCARDS_RATE_LIMITED",
          tag: "[SUPERADMIN_BIZCARDS]",
          message: "Too many bizcard restriction requests. Please slow down.",
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
          code: "SUPERADMIN_BIZCARDS_INVALID_ID",
          tag: "[SUPERADMIN_BIZCARDS]",
          message: "Invalid bizcardId path parameter.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const payload = await parseBody(req);
    const data = await setSuperAdminBizcardRestricted(parsedBizcardId, payload.restricted);

    await logAuditEvent(
      payload.restricted ? "superadmin_bizcard_restrict" : "superadmin_bizcard_unrestrict",
      Number(user.userId),
      getClientIp(req),
      getUserAgent(req),
      {
        targetBizcardId: data.bizcard_id,
        targetUserId: data.user_id,
        serialId: data.serial_id,
        reason: payload.reason,
      },
    );

    return NextResponse.json({
      success: true,
      data,
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
            code: "SUPERADMIN_BIZCARDS_NOT_FOUND",
            tag: "[SUPERADMIN_BIZCARDS]",
            message: "Bizcard not found.",
          },
        },
        { status: 404 },
      );
    }

    if (
      error instanceof Error &&
      (error.message === "INVALID_BODY" || error.message === "INVALID_RESTRICTED_FLAG")
    ) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "SUPERADMIN_BIZCARDS_INVALID_BODY",
            tag: "[SUPERADMIN_BIZCARDS]",
            message: "Request body must include a boolean restricted field.",
          },
        },
        { status: 400 },
      );
    }

    console.error("[SUPERADMIN_BIZCARDS] Failed to update bizcard restriction", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SUPERADMIN_BIZCARDS_UPDATE_FAILED",
          tag: "[SUPERADMIN_BIZCARDS]",
          message: "Failed to update bizcard restriction.",
        },
      },
      { status: 500 },
    );
  }
}, { errorMode: "superadmin" });
