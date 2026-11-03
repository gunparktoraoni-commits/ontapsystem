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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withDashboardSuperAdmin(async (req: NextRequest) => {
    const requestId = getSupportRequestId(req.headers);
    try {
      const ip = getClientIp(req);
      const rate = checkRateLimit("support-read", ip);
      if (!rate.allowed) {
        return NextResponse.json({ success: false, error: "Too many requests." }, { status: 429 });
      }
      const { id } = await params;
      const actor = await resolveAdminActor(requestId);
      const before = req.nextUrl.searchParams.get("before");
      const q = req.nextUrl.searchParams.get("q") ?? undefined;
      const service = new SupportMessagingService();
      const messages = await service.listMessages(BigInt(id), actor, {
        before: before ? BigInt(before) : undefined,
        q,
      });
      return NextResponse.json({ success: true, data: messages, requestId });
    } catch (error) {
      return supportErrorResponse(error, requestId);
    }
  })(request);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withDashboardSuperAdmin(async (req: NextRequest) => {
    const requestId = getSupportRequestId(req.headers);
    try {
      const ip = getClientIp(req);
      const rate = checkRateLimit("support-message-send", ip);
      if (!rate.allowed) {
        return NextResponse.json({ success: false, error: "Too many requests." }, { status: 429 });
      }
      const { id } = await params;
      const actor = await resolveAdminActor(requestId);
      const body = (await req.json()) as Record<string, unknown>;
      const text = typeof body.body === "string" ? body.body : "";
      const attachments = Array.isArray(body.attachments) ? body.attachments : [];
      const service = new SupportMessagingService();
      const message = await service.sendMessage(BigInt(id), actor, {
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
  })(request);
}
