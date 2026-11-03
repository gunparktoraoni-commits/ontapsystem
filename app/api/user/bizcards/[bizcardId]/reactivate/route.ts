import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { getClientIp, getUserAgent, logAuditEvent } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getUserBizcardLimits } from "@/lib/bizcard/limits";
import { requireSession } from "../../_helpers";

function parseBizcardId(value: string): bigint | null {
  try {
    const parsed = BigInt(value);
    if (parsed <= BigInt(0)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bizcardId: string }> }
) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);
  const rateCheck = checkRateLimit("user-bizcards-reactivate", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const rawParams = await params;
  const bizcardId = parseBizcardId(rawParams.bizcardId);
  if (!bizcardId) {
    return NextResponse.json(
      { success: false, error: { code: "BIZCARD_NOT_FOUND", message: "Bizcard not found." } },
      { status: 404 }
    );
  }

  try {
    const bizcard = await prisma.bizcard.findFirst({
      where: { bizcard_id: bizcardId, user_id: auth.userId },
      select: {
        bizcard_id: true,
        bizcard_name: true,
        deactivated_flag: true,
      },
    });

    if (!bizcard) {
      return NextResponse.json(
        { success: false, error: { code: "BIZCARD_NOT_FOUND", message: "Bizcard not found." } },
        { status: 404 }
      );
    }

    if (bizcard.deactivated_flag) {
      await prisma.bizcard.update({
        where: { bizcard_id: bizcard.bizcard_id },
        data: { deactivated_flag: false, updated_at: new Date() },
      });
    }

    const limits = await getUserBizcardLimits(auth.userId);

    await logAuditEvent("bizcard_reactivate", Number(auth.userId), ip, ua, {
      bizcardId: bizcard.bizcard_id.toString(),
      exceededLimitAfterReactivation: limits.isLimitReached,
    });

    return NextResponse.json({
      success: true,
      message: "Bizcard reactivated successfully",
      data: {
        bizcard_id: bizcard.bizcard_id.toString(),
        bizcard_name: bizcard.bizcard_name,
        status: "active",
        subscription_status: {
          current_bizcards: limits.currentBizcards,
          max_allowed: Number.isFinite(limits.maxBizcards) ? limits.maxBizcards : "unlimited",
          warning: limits.isLimitReached
            ? "Reactivating this bizcard exceeds your current limit. Upgrade to keep all bizcards active."
            : null,
          upgrade_required: limits.upgradeRequired,
          upgrade_url: "/settings/subscription/upgrade",
        },
      },
    });
  } catch (error) {
    console.error("[user/bizcards/[bizcardId]/reactivate POST]", error);
    return NextResponse.json(
      { success: false, error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
