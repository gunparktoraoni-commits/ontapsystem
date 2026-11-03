import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import {
  archiveNotice,
  getNoticeByPublicId,
  publishNotice,
  softDeleteNotice,
  updateNotice,
  type NoticeInput,
} from "@/lib/services/dev/notice-board.service";
import {
  isNoticeType,
  type NoticeAudienceId,
  type NoticeChannelId,
  type NoticePlacementId,
  type NoticePortalId,
  type NoticePriorityId,
  type NoticeStatusId,
} from "@/lib/portal/notice-board";
import { logAuditEvent, getClientIp, getUserAgent } from "@/server/lib/auth";

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

type RouteContext = {
  params: Promise<{ noticeId: string }>;
};

export const GET = withDashboardSuperAdmin(
  async (_request: NextRequest, context: RouteContext) => {
    try {
      const { noticeId } = await context.params;
      const notice = await getNoticeByPublicId(noticeId);
      if (!notice) {
        return NextResponse.json({ success: false, error: "Notice not found." }, { status: 404 });
      }
      return NextResponse.json({ success: true, data: notice });
    } catch (error) {
      console.error("[dev/notices/:id GET]", error);
      return NextResponse.json({ success: false, error: "Failed to load notice." }, { status: 500 });
    }
  },
);

export const PATCH = withDashboardSuperAdmin(
  async (request: NextRequest, context: RouteContext) => {
    try {
      const { noticeId } = await context.params;
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const actorId = (context as RouteContext & { user: { userId: bigint } }).user.userId;

      if (body.action === "publish") {
        const result = await publishNotice(noticeId, actorId, {
          notify: body.notify !== false,
        });
        await logAuditEvent(
          "DEV_NOTICE_PUBLISHED",
          undefined,
          getClientIp(request),
          getUserAgent(request),
          {
            noticeId,
            delivery: result.delivery,
          },
        );
        return NextResponse.json({ success: true, data: result });
      }

      if (body.action === "archive") {
        const notice = await archiveNotice(noticeId, actorId);
        return NextResponse.json({ success: true, data: notice });
      }

      const patch: Partial<NoticeInput> & { status?: NoticeStatusId } = {};
      if (typeof body.title === "string") patch.title = body.title;
      if (typeof body.summary === "string" || body.summary === null) patch.summary = body.summary as string | null;
      if (typeof body.body === "string") patch.body = body.body;
      if (typeof body.noticeType === "string" && isNoticeType(body.noticeType)) {
        patch.noticeType = body.noticeType;
      }
      if (typeof body.status === "string") patch.status = body.status as NoticeStatusId;
      if (typeof body.priority === "string") patch.priority = body.priority as NoticePriorityId;
      if (Array.isArray(body.portals)) patch.portals = parseStringArray(body.portals) as NoticePortalId[];
      if (Array.isArray(body.placements)) {
        patch.placements = parseStringArray(body.placements) as NoticePlacementId[];
      }
      if (Array.isArray(body.audiences)) {
        patch.audiences = parseStringArray(body.audiences) as NoticeAudienceId[];
      }
      if (Array.isArray(body.channels)) {
        patch.channels = parseStringArray(body.channels) as NoticeChannelId[];
      }
      if (typeof body.ctaLabel === "string" || body.ctaLabel === null) {
        patch.ctaLabel = body.ctaLabel as string | null;
      }
      if (typeof body.ctaUrl === "string" || body.ctaUrl === null) {
        patch.ctaUrl = body.ctaUrl as string | null;
      }
      if (typeof body.surveyUrl === "string" || body.surveyUrl === null) {
        patch.surveyUrl = body.surveyUrl as string | null;
      }
      if (typeof body.accentColor === "string" || body.accentColor === null) {
        patch.accentColor = body.accentColor as string | null;
      }
      if (typeof body.startsAt === "string" || body.startsAt === null) {
        patch.startsAt = body.startsAt as string | null;
      }
      if (typeof body.endsAt === "string" || body.endsAt === null) {
        patch.endsAt = body.endsAt as string | null;
      }
      if (Array.isArray(body.whatsNewAdded)) patch.whatsNewAdded = parseStringArray(body.whatsNewAdded);
      if (Array.isArray(body.whatsNewFixed)) patch.whatsNewFixed = parseStringArray(body.whatsNewFixed);
      if (Array.isArray(body.whatsNewRemoved)) {
        patch.whatsNewRemoved = parseStringArray(body.whatsNewRemoved);
      }
      if (Array.isArray(body.surveyQuestions)) {
        patch.surveyQuestions = body.surveyQuestions as NoticeInput["surveyQuestions"];
      }
      if (Array.isArray(body.targetUserIds)) {
        patch.targetUserIds = parseStringArray(body.targetUserIds);
      }
      if (Array.isArray(body.mediaUrls)) patch.mediaUrls = parseStringArray(body.mediaUrls);

      const result = await updateNotice(noticeId, patch, actorId, {
        notify: body.notify !== false,
      });
      await logAuditEvent(
        "DEV_NOTICE_UPDATED",
        undefined,
        getClientIp(request),
        getUserAgent(request),
        {
          noticeId,
          delivery: result.delivery,
          targetUserCount: result.notice.targetUserIds.length,
        },
      );
      return NextResponse.json({
        success: true,
        data: {
          ...result.notice,
          delivery: result.delivery,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update notice.";
      console.error("[NOTICE_BOARD_API][dev/notices/:id PATCH]", error);
      return NextResponse.json(
        {
          success: false,
          error: message,
          code: "DEV_NOTICE_UPDATE_FAILED",
          tag: "[NOTICE_BOARD_API]",
        },
        { status: 400 },
      );
    }
  },
);

export const DELETE = withDashboardSuperAdmin(
  async (request: NextRequest, context: RouteContext) => {
    try {
      const { noticeId } = await context.params;
      const actorId = (context as RouteContext & { user: { userId: bigint } }).user.userId;
      await softDeleteNotice(noticeId, actorId);
      await logAuditEvent(
        "DEV_NOTICE_DELETED",
        undefined,
        getClientIp(request),
        getUserAgent(request),
        { noticeId },
      );
      return NextResponse.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete notice.";
      return NextResponse.json({ success: false, error: message }, { status: 400 });
    }
  },
);
