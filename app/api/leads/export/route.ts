import { NextRequest, NextResponse } from "next/server";
import { validateToken, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { buildPortfolioLeadsExcelBuffer } from "@/lib/services/portfolio-lead.service";

/**
 * GET /api/leads/export — download Excel of all leads for the owner.
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("leads-export", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many export requests. Please wait." },
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

  const buffer = await buildPortfolioLeadsExcelBuffer(BigInt(session.userId));
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `ontap-leads-${stamp}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
