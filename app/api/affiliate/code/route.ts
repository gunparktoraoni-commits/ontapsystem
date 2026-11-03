import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getOrGenerateAffiliateCode, AffiliateLinkErrorCode } from "@/server/lib/affiliate";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

/**
 * GET /api/affiliate/code
 * Get the current user's affiliate code.
 * If user doesn't have one, generate and save it.
 * Auth required.
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("affiliate-code", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  try {
    const result = await resolveRequestSession(request);
    if (!result.session) {
      return NextResponse.json(
        { error: "Authentication required.", requiresAuth: true },
        { status: 401 }
      );
    }

    const userId = BigInt(result.session.userId);

    try {
      const affiliateCode = await getOrGenerateAffiliateCode(userId);

      return NextResponse.json(
        serialize({
          success: true,
          data: {
            affiliate_code: affiliateCode,
            generated_at: new Date().toISOString(),
          },
        }),
        { status: 200 }
      );
    } catch (error) {
      console.error("[affiliate/code] generation error:", error);
      return NextResponse.json(
        {
          success: false,
          error: "Failed to generate affiliate code.",
          code: AffiliateLinkErrorCode.REFERRAL_LINK_GENERATION_FAILED,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("[affiliate/code] unexpected error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error." },
      { status: 500 }
    );
  }
}
