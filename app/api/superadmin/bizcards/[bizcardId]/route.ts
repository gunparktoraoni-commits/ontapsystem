import { NextRequest, NextResponse } from "next/server";
import { getClientIp, getUserAgent, logAuditEvent } from "@/server/lib/auth";
import { withSuperAdmin, type SuperAdminContext } from "@/lib/auth/superadmin-middleware";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  getSuperAdminUserBizcard,
  softDeleteUserAndBizcard,
  updateSuperAdminUserBizcard,
} from "@/server/lib/superadmin/user-bizcards";

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

async function parseUpdateBody(
  req: NextRequest,
): Promise<{ subscription_tier?: string; portfolio_url?: string }> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("INVALID_BODY");
  }

  const payload: { subscription_tier?: string; portfolio_url?: string } = {};

  if (body.subscription_tier !== undefined) {
    if (typeof body.subscription_tier !== "string" || !body.subscription_tier.trim()) {
      throw new Error("INVALID_SUBSCRIPTION_TIER");
    }
    payload.subscription_tier = body.subscription_tier.trim();
  }

  if (body.portfolio_url !== undefined) {
    if (typeof body.portfolio_url !== "string" || !body.portfolio_url.trim()) {
      throw new Error("INVALID_PORTFOLIO_URL");
    }
    payload.portfolio_url = body.portfolio_url.trim();
  }

  if (payload.subscription_tier === undefined && payload.portfolio_url === undefined) {
    throw new Error("NO_VALID_FIELDS");
  }

  return payload;
}

export const GET = withSuperAdmin(async (_req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId } = context;

  const rateCheck = checkRateLimit("superadmin-user-bizcards-detail", getClientIp(_req));
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SUPERADMIN_BIZCARDS_RATE_LIMITED",
          tag: "[SUPERADMIN_BIZCARDS]",
          message: "Too many bizcard detail requests. Please slow down.",
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
    const data = await getSuperAdminUserBizcard(parsedBizcardId);
    if (!data) {
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
    console.error("[SUPERADMIN_BIZCARDS] Failed to load bizcard detail", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SUPERADMIN_BIZCARDS_FETCH_FAILED",
          tag: "[SUPERADMIN_BIZCARDS]",
          message: "Failed to load bizcard details.",
        },
      },
      { status: 500 },
    );
  }
}, { errorMode: "superadmin" });

export const PATCH = withSuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  const rateCheck = checkRateLimit("superadmin-user-bizcards-update", getClientIp(req));
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SUPERADMIN_BIZCARDS_RATE_LIMITED",
          tag: "[SUPERADMIN_BIZCARDS]",
          message: "Too many bizcard update requests. Please slow down.",
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
    const payload = await parseUpdateBody(req);
    const data = await updateSuperAdminUserBizcard(parsedBizcardId, payload, requestId);

    await logAuditEvent("superadmin_bizcard_update", Number(user.userId), getClientIp(req), getUserAgent(req), {
      targetBizcardId: data.bizcard_id,
      targetUserId: data.user_id,
      serialId: data.serial_id,
      updatedFields: Object.keys(payload),
    });

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
      (error.message === "INVALID_BODY" ||
        error.message === "INVALID_SUBSCRIPTION_TIER" ||
        error.message === "INVALID_PORTFOLIO_URL" ||
        error.message === "NO_VALID_FIELDS")
    ) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "SUPERADMIN_BIZCARDS_INVALID_BODY",
            tag: "[SUPERADMIN_BIZCARDS]",
            message: "Request body must include at least one valid field to update.",
          },
        },
        { status: 400 },
      );
    }

    if (error instanceof Error && error.message === "PORTFOLIO_URL_LOCKED") {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "SUPERADMIN_BIZCARDS_PORTFOLIO_LOCKED",
            tag: "[SUPERADMIN_BIZCARDS]",
            message: "Portfolio URL is derived from the user's URL alias and cannot be edited here.",
          },
        },
        { status: 400 },
      );
    }

    console.error("[SUPERADMIN_BIZCARDS] Failed to update bizcard", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SUPERADMIN_BIZCARDS_UPDATE_FAILED",
          tag: "[SUPERADMIN_BIZCARDS]",
          message: "Failed to update bizcard.",
        },
      },
      { status: 500 },
    );
  }
}, { errorMode: "superadmin" });

export const DELETE = withSuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  const rateCheck = checkRateLimit("superadmin-user-bizcards-delete", getClientIp(req));
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SUPERADMIN_BIZCARDS_RATE_LIMITED",
          tag: "[SUPERADMIN_BIZCARDS]",
          message: "Too many delete requests. Please slow down.",
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
    const deleted = await softDeleteUserAndBizcard(parsedBizcardId);

    await logAuditEvent(
      "superadmin_user_soft_delete",
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
      message: "User moved to Recycle Bin successfully.",
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
            code: "SUPERADMIN_BIZCARDS_NOT_FOUND",
            tag: "[SUPERADMIN_BIZCARDS]",
            message: "Bizcard not found or already in Recycle Bin.",
          },
        },
        { status: 404 },
      );
    }

    console.error("[SUPERADMIN_BIZCARDS] Failed to soft-delete user and bizcard", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SUPERADMIN_BIZCARDS_DELETE_FAILED",
          tag: "[SUPERADMIN_BIZCARDS]",
          message: "Failed to move user to Recycle Bin.",
        },
      },
      { status: 500 },
    );
  }
}, { errorMode: "superadmin" });
