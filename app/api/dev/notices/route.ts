import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import {
  createNotice,
  getNoticeSummary,
  listNotices,
  previewNoticeAudience,
  type NoticeInput,
} from "@/lib/services/dev/notice-board.service";
import {
  NOTICE_AUDIENCES,
  NOTICE_CHANNELS,
  NOTICE_PLACEMENTS,
  NOTICE_PORTALS,
  NOTICE_PRIORITIES,
  NOTICE_TYPES,
  SURVEY_QUESTION_TYPES,
  isNoticeType,
  type NoticeAudienceId,
  type NoticeChannelId,
  type NoticePlacementId,
  type NoticePortalId,
  type NoticePriorityId,
} from "@/lib/portal/notice-board";

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export const GET = withDashboardSuperAdmin(async (request: NextRequest) => {
  try {
    const status = request.nextUrl.searchParams.get("status") ?? undefined;
    const noticeType = request.nextUrl.searchParams.get("type") ?? undefined;
    const portal = request.nextUrl.searchParams.get("portal") ?? undefined;
    const [notices, summary] = await Promise.all([
      listNotices({ status, noticeType, portal }),
      getNoticeSummary(),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        notices,
        summary,
        catalog: {
          types: NOTICE_TYPES,
          portals: NOTICE_PORTALS,
          placements: NOTICE_PLACEMENTS,
          audiences: NOTICE_AUDIENCES,
          channels: NOTICE_CHANNELS,
          priorities: NOTICE_PRIORITIES,
          surveyQuestionTypes: SURVEY_QUESTION_TYPES,
        },
      },
    });
  } catch (error) {
    console.error("[dev/notices GET]", error);
    return NextResponse.json(
      { success: false, error: "Failed to load notices." },
      { status: 500 },
    );
  }
});

export const POST = withDashboardSuperAdmin(
  async (request: NextRequest, context) => {
    try {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

      if (body.action === "preview_audience") {
        const portals = parseStringArray(body.portals);
        const audiences = parseStringArray(body.audiences);
        const targetUserIds = parseStringArray(body.targetUserIds);
        const preview = await previewNoticeAudience(portals, audiences, targetUserIds);
        return NextResponse.json({ success: true, data: preview });
      }

      const noticeType = String(body.noticeType ?? "");
      if (!isNoticeType(noticeType)) {
        return NextResponse.json({ success: false, error: "Invalid notice type." }, { status: 422 });
      }

      const input: NoticeInput = {
        title: String(body.title ?? ""),
        summary: typeof body.summary === "string" ? body.summary : null,
        body: String(body.body ?? ""),
        noticeType,
        status: body.status === "scheduled" ? "scheduled" : "draft",
        priority: (typeof body.priority === "string" ? body.priority : "medium") as NoticePriorityId,
        portals: parseStringArray(body.portals) as NoticePortalId[],
        placements: parseStringArray(body.placements) as NoticePlacementId[],
        audiences: parseStringArray(body.audiences) as NoticeAudienceId[],
        channels: parseStringArray(body.channels) as NoticeChannelId[],
        ctaLabel: typeof body.ctaLabel === "string" ? body.ctaLabel : null,
        ctaUrl: typeof body.ctaUrl === "string" ? body.ctaUrl : null,
        surveyUrl: typeof body.surveyUrl === "string" ? body.surveyUrl : null,
        accentColor: typeof body.accentColor === "string" ? body.accentColor : null,
        startsAt: typeof body.startsAt === "string" ? body.startsAt : null,
        endsAt: typeof body.endsAt === "string" ? body.endsAt : null,
        whatsNewAdded: parseStringArray(body.whatsNewAdded),
        whatsNewFixed: parseStringArray(body.whatsNewFixed),
        whatsNewRemoved: parseStringArray(body.whatsNewRemoved),
        surveyQuestions: Array.isArray(body.surveyQuestions)
          ? (body.surveyQuestions as NoticeInput["surveyQuestions"])
          : [],
        targetUserIds: parseStringArray(body.targetUserIds),
        mediaUrls: parseStringArray(body.mediaUrls),
      };

      const notify = body.notify !== false;
      const result = await createNotice(input, context.user.userId, { notify });
      return NextResponse.json(
        {
          success: true,
          data: {
            ...result.notice,
            delivery: result.delivery,
          },
        },
        { status: 201 },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create notice.";
      return NextResponse.json({ success: false, error: message }, { status: 400 });
    }
  },
);
