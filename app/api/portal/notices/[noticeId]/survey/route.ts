import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession } from "@/server/lib/auth";
import {
  hasUserSurveyResponse,
  submitSurveyResponse,
} from "@/lib/services/dev/notice-board.service";

type RouteContext = { params: Promise<{ noticeId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = await resolveRequestSession(request, { tryRefresh: true });
    if (!auth.session) {
      return NextResponse.json(
        { success: false, error: "Authentication required." },
        { status: 401 },
      );
    }
    const { noticeId } = await context.params;
    const answered = await hasUserSurveyResponse(noticeId, BigInt(auth.session.userId));
    return NextResponse.json({ success: true, data: { answered } });
  } catch (error) {
    console.error("[portal/notices/survey GET]", error);
    return NextResponse.json(
      { success: false, error: "Failed to check survey status." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const auth = await resolveRequestSession(request, { tryRefresh: true });
    if (!auth.session) {
      return NextResponse.json(
        { success: false, error: "Authentication required." },
        { status: 401 },
      );
    }

    const { noticeId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      answers?: Record<string, unknown>;
    };
    if (!body.answers || typeof body.answers !== "object" || Array.isArray(body.answers)) {
      return NextResponse.json(
        { success: false, error: "answers object is required." },
        { status: 422 },
      );
    }

    const result = await submitSurveyResponse({
      noticePublicId: noticeId,
      userId: BigInt(auth.session.userId),
      answers: body.answers,
    });

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to submit survey.";
    const status = /already submitted|not found|not in the audience|no longer active/i.test(message)
      ? 409
      : /required|must be|yes or no/i.test(message)
        ? 422
        : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
