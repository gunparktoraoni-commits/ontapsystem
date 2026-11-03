import { NextRequest, NextResponse } from "next/server";
import { getSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { prisma } from "@/server/lib/prisma";
import { withDashboardSuperAdmin } from "@/middleware/superadmin-auth";
import { SupportMessagingService } from "@/lib/services/support-messaging.service";
import { getSupportRequestId, supportErrorResponse } from "@/lib/api/support-route-utils";
import {
  SupportMessagingErrorCode,
  createSupportMessagingError,
} from "@/lib/errors/support-messaging-errors";

async function resolveAdminActor(requestId: string) {
  const session = await getSession();
  if (!session) {
    throw createSupportMessagingError(
      SupportMessagingErrorCode.UNAUTHORIZED,
      "Authentication required.",
      401,
      requestId,
    );
  }
  const user = await prisma.user.findUnique({
    where: { user_id: BigInt(session.userId) },
    select: { role: true },
  });
  if (!user || (user.role !== "dev" && user.role !== "super_admin")) {
    throw createSupportMessagingError(
      SupportMessagingErrorCode.FORBIDDEN,
      "Dev or super admin access required.",
      403,
      requestId,
    );
  }
  return {
    userId: BigInt(session.userId),
    role: user.role === "super_admin" ? ("super_admin" as const) : ("dev" as const),
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withDashboardSuperAdmin(async (req: NextRequest) => {
    const requestId = getSupportRequestId(req.headers);
    try {
      const ip = getClientIp(req);
      const rate = checkRateLimit("support-resolve", ip);
      if (!rate.allowed) {
        return NextResponse.json({ success: false, error: "Too many requests." }, { status: 429 });
      }
      const { id } = await params;
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const note = typeof body.note === "string" ? body.note : undefined;
      const actor = await resolveAdminActor(requestId);
      const service = new SupportMessagingService();
      const conversation = await service.resolveConversation(BigInt(id), actor, note);
      return NextResponse.json({ success: true, data: conversation, requestId });
    } catch (error) {
      return supportErrorResponse(error, requestId);
    }
  })(request);
}
