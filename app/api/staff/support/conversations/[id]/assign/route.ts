import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getRequestId } from "@/lib/errors/http";
import { withStaffPortal } from "@/lib/auth/staff-portal-middleware";
import { SupportMessagingService } from "@/lib/services/support-messaging.service";
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
      const rate = checkRateLimit("support-assign", ip);
      if (!rate.allowed) {
        return NextResponse.json(
          { success: false, error: "Too many requests.", requestId },
          { status: 429 },
        );
      }

      const { id } = await params;

      if (!id) {
        throw createSupportMessagingError(
          SupportMessagingErrorCode.INVALID_PAYLOAD,
          "Conversation ID is required.",
          400,
          requestId,
        );
      }

      let conversationId: bigint;
      try {
        conversationId = BigInt(id);
      } catch {
        throw createSupportMessagingError(
          SupportMessagingErrorCode.INVALID_PAYLOAD,
          "Invalid conversation ID format.",
          400,
          requestId,
        );
      }

      const service = new SupportMessagingService();
      const conversation = await service.assignConversationToStaff(
        conversationId,
        context.staffId,
      );

      return NextResponse.json(
        { success: true, data: conversation, requestId },
        { status: 200 },
      );
    } catch (error) {
      return supportErrorResponse(error, requestId);
    }
  })(req);
}
