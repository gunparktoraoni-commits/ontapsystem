import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getRequestId } from "@/lib/errors/http";
import { withStaffPortal } from "@/lib/auth/staff-portal-middleware";
import { SupportMessagingService, type EscalationTarget } from "@/lib/services/support-messaging.service";
import { supportErrorResponse } from "@/lib/api/support-route-utils";
import {
  SupportMessagingErrorCode,
  createSupportMessagingError,
} from "@/lib/errors/support-messaging-errors";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withStaffPortal(async (context, request) => {
    const requestId = context.requestId || getRequestId(request.headers);
    try {
      const ip = getClientIp(request);
      const rate = checkRateLimit("support-escalate", ip);
      if (!rate.allowed) {
        return NextResponse.json(
          { success: false, error: "Too many requests.", requestId },
          { status: 429 },
        );
      }

      const { id } = await params;
      const body = (await request.json()) as Record<string, unknown>;
      const target = body.target === "super_admin" ? "super_admin" : body.target === "dev" ? "dev" : null;
      if (!target) {
        throw createSupportMessagingError(
          SupportMessagingErrorCode.INVALID_PAYLOAD,
          'target must be "dev" or "super_admin".',
          400,
          requestId,
        );
      }

      const service = new SupportMessagingService();
      const conversation = await service.escalateConversation(
        BigInt(id),
        context.staffId,
        target as EscalationTarget,
      );
      return NextResponse.json({ success: true, data: conversation, requestId });
    } catch (error) {
      return supportErrorResponse(error, requestId);
    }
  })(req);
}
