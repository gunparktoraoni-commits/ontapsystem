import { NextRequest, NextResponse } from "next/server";
import { validateToken, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  isPortfolioLeadStatus,
  serializeLead,
  updatePortfolioLeadStatus,
} from "@/lib/services/portfolio-lead.service";
import { sanitizePortfolioLeadOwnerNotes } from "@/app/lib/portfolioLeadConstants";

/**
 * PATCH /api/leads/[leadId] — update lead status / owner notes.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("leads-update", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429 },
    );
  }

  const rawToken = request.cookies.get("session_token")?.value;
  if (!rawToken) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const session = await validateToken(rawToken);
  if (!session) {
    return NextResponse.json({ error: "Session expired." }, { status: 401 });
  }

  const { leadId: rawId } = await params;
  let leadId: bigint;
  try {
    leadId = BigInt(rawId);
  } catch {
    return NextResponse.json({ error: "Invalid lead id." }, { status: 422 });
  }

  const rawBody = await request.text();
  if (rawBody.length > 16 * 1024) {
    return NextResponse.json({ error: "Request body too large." }, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const status = typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
  if (!isPortfolioLeadStatus(status)) {
    return NextResponse.json({ error: "Invalid status." }, { status: 422 });
  }

  const ownerNotes =
    body.ownerNotes === undefined
      ? undefined
      : sanitizePortfolioLeadOwnerNotes(body.ownerNotes);
  const channelRaw =
    typeof body.contactChannel === "string" ? body.contactChannel.trim().toLowerCase() : null;
  const contactChannel =
    channelRaw === "call" || channelRaw === "email" || channelRaw === "other"
      ? channelRaw
      : null;

  const updated = await updatePortfolioLeadStatus({
    userId: BigInt(session.userId),
    leadId,
    status,
    ownerNotes,
    contactChannel,
  });

  if (!updated) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    data: { lead: serializeLead(updated) },
  });
}
