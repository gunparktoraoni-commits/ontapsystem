import { NextRequest, NextResponse } from "next/server";
import { getRequestId } from "@/lib/errors/http";
import { withStaffPortal, checkStaffPortalRateLimit } from "@/lib/auth/staff-portal-middleware";
import { SupportMessagingService } from "@/lib/services/support-messaging.service";
import { supportErrorResponse } from "@/lib/api/support-route-utils";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withStaffPortal(async (context, request) => {
    const requestId = context.requestId || getRequestId(request.headers);
    try {
      await checkStaffPortalRateLimit("staff-portal-support-read", request, requestId);
      const { id } = await params;
      const before = request.nextUrl.searchParams.get("before");
      const q = request.nextUrl.searchParams.get("q") ?? undefined;
      const service = new SupportMessagingService();
      const messages = await service.listMessages(BigInt(id), {
        userId: context.staffId,
        role: "staff",
      }, {
        before: before ? BigInt(before) : undefined,
        q,
      });
      return NextResponse.json({ success: true, data: messages, requestId });
    } catch (error) {
      return supportErrorResponse(error, requestId);
    }
  })(req);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withStaffPortal(async (context, request) => {
    const requestId = context.requestId || getRequestId(request.headers);
    try {
      await checkStaffPortalRateLimit("staff-portal-support-send", request, requestId);
      const { id } = await params;
      const body = (await request.json()) as Record<string, unknown>;
      const text = typeof body.body === "string" ? body.body : "";
      const attachments = Array.isArray(body.attachments) ? body.attachments : [];
      const service = new SupportMessagingService();
      const message = await service.sendMessage(BigInt(id), {
        userId: context.staffId,
        role: "staff",
      }, {
        body: text,
        attachments: attachments
          .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === "object")
          .map((a) => ({
            mediaUrl: String(a.mediaUrl ?? ""),
            mimeType: String(a.mimeType ?? ""),
            mediaKind: a.mediaKind === "video" ? "video" : "image",
            fileName: typeof a.fileName === "string" ? a.fileName : undefined,
            fileSize: typeof a.fileSize === "number" ? a.fileSize : undefined,
          })),
      });
      return NextResponse.json({ success: true, data: message, requestId }, { status: 201 });
    } catch (error) {
      return supportErrorResponse(error, requestId);
    }
  })(req);
}
