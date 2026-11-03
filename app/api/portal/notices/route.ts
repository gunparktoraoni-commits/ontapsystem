import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession } from "@/server/lib/auth";
import { getActiveNoticesForUser } from "@/lib/services/dev/notice-board.service";
import type { NoticePlacementId, NoticePortalId } from "@/lib/portal/notice-board";

/**
 * Active notice cards for the signed-in portal user (surface banners).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await resolveRequestSession(request, { tryRefresh: true });
    if (!auth.session) {
      return NextResponse.json(
        { success: false, error: "Authentication required." },
        { status: 401 },
      );
    }

    const portalParam = request.nextUrl.searchParams.get("portal");
    const placementParam = request.nextUrl.searchParams.get("placement");
    const portal =
      portalParam === "user" || portalParam === "admin" || portalParam === "staff"
        ? (portalParam as NoticePortalId)
        : null;

    if (!portal) {
      return NextResponse.json(
        { success: false, error: "portal must be user, admin, or staff." },
        { status: 422 },
      );
    }

    const placement = placementParam
      ? (placementParam as NoticePlacementId)
      : null;

    const notices = await getActiveNoticesForUser({
      portal,
      placement,
      userId: BigInt(auth.session.userId),
    });

    return NextResponse.json({
      success: true,
      data: {
        notices: notices.map((notice) => ({
          publicId: notice.publicId,
          title: notice.title,
          summary: notice.summary,
          body: notice.body,
          noticeType: notice.noticeType,
          noticeTypeLabel: notice.noticeTypeLabel,
          priority: notice.priority,
          accentColor: notice.accentColor,
          ctaLabel: notice.ctaLabel,
          ctaUrl: notice.ctaUrl,
          surveyUrl: notice.surveyUrl,
          placements: notice.placements,
          publishedAt: notice.publishedAt,
          endsAt: notice.endsAt,
          whatsNewAdded: notice.whatsNewAdded,
          whatsNewFixed: notice.whatsNewFixed,
          whatsNewRemoved: notice.whatsNewRemoved,
          surveyQuestions: notice.surveyQuestions,
          mediaUrls: notice.mediaUrls,
        })),
      },
    });
  } catch (error) {
    console.error("[portal/notices]", error);
    return NextResponse.json(
      { success: false, error: "Failed to load notices." },
      { status: 500 },
    );
  }
}
