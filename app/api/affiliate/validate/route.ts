import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { validateAffiliateCode } from "@/server/lib/affiliate";

/**
 * GET /api/affiliate/validate?code=CODE
 * Public: returns whether a referral code is valid. No affiliate PII.
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("affiliate-validate", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many requests. Please slow down." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)),
        },
      },
    );
  }

  try {
    const code = request.nextUrl.searchParams.get("code")?.trim() ?? "";
    if (!code) {
      return NextResponse.json({
        success: true,
        data: { valid: false, code: "" },
      });
    }

    const affiliate = await validateAffiliateCode(code);
    const normalized = code.trim().toUpperCase();

    const response = NextResponse.json({
      success: true,
      data: {
        valid: Boolean(affiliate),
        code: normalized,
      },
    });

    if (affiliate) {
      const host = request.nextUrl.hostname.toLowerCase();
      const cookieOptions: {
        maxAge: number;
        sameSite: "lax";
        path: string;
        domain?: string;
      } = {
        maxAge: 30 * 24 * 60 * 60,
        sameSite: "lax",
        path: "/",
      };
      if (host === "ontap.ph" || host.endsWith(".ontap.ph")) {
        cookieOptions.domain = ".ontap.ph";
      }
      response.cookies.set("__affiliate_ref", normalized, cookieOptions);
    }

    return response;
  } catch (error) {
    console.error("[affiliate/validate] unexpected error:", error);
    return NextResponse.json(
      { success: false, error: "Unable to validate referral code." },
      { status: 500 },
    );
  }
}
