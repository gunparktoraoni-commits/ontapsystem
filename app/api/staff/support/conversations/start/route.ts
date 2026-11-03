import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRequestId } from "@/lib/errors/http";
import {
  withStaffPortal,
  checkStaffPortalRateLimit,
} from "@/lib/auth/staff-portal-middleware";
import { SupportMessagingService } from "@/lib/services/support-messaging.service";
import { supportErrorResponse } from "@/lib/api/support-route-utils";
import {
  SupportMessagingErrorCode,
  createSupportMessagingError,
} from "@/lib/errors/support-messaging-errors";

// ─────────────────────────────────────────────────────────────
// Validation schema
// ─────────────────────────────────────────────────────────────

const bodySchema = z.object({
  clientUserId: z
    .string()
    .trim()
    .regex(/^\d+$/, "clientUserId must be a numeric string"),
});

// ─────────────────────────────────────────────────────────────
// POST /api/staff/support/conversations/start
//
// Staff-initiated conversation creation (or retrieval if one
// already exists for this client).
//
// Body: { clientUserId: string }
// Response: { success: true, data: SupportConversation }
// ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  return withStaffPortal(async (context, request) => {
    const requestId = context.requestId || getRequestId(request.headers);

    try {
      await checkStaffPortalRateLimit(
        "staff-portal-support-write",
        request,
        requestId,
      );

      // ── 1. Parse & validate body ───────────────────────────
      let rawBody: unknown;
      try {
        rawBody = await request.json();
      } catch {
        throw createSupportMessagingError(
          SupportMessagingErrorCode.INVALID_PAYLOAD,
          "Request body must be valid JSON",
          400,
        );
      }

      const parsed = bodySchema.safeParse(rawBody);
      if (!parsed.success) {
        throw createSupportMessagingError(
          SupportMessagingErrorCode.INVALID_PAYLOAD,
          parsed.error.errors[0]?.message ?? "Invalid request body",
          400,
        );
      }

      const clientUserId = BigInt(parsed.data.clientUserId);

      // ── 2. Get or create conversation ──────────────────────
      const service = new SupportMessagingService();
      const conversation = await service.getOrCreateConversationForClient(
        clientUserId,
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
