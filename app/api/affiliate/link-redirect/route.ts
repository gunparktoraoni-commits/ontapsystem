import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/server/lib/auth";
import {
  recordAffiliateClick,
  resolveAffiliateLinkDestination,
  validateAffiliateCode,
} from "@/server/lib/affiliate";

/**
 * GET /api/affiliate/link-redirect?ref=CODE
 * Process affiliate link click: record the click, set cookie, redirect to storefront.
 * Authenticated users are redirected inside the portal (e-market or cart).
 * No auth required (public endpoint).
 */
export async function GET(request: NextRequest) {
  const fallbackPortalMarket = new URL("/user/emarket", request.url);

  try {
    const referralCode = request.nextUrl.searchParams.get("ref")?.trim() ?? "";

    if (!referralCode) {
      const destination = await resolveAffiliateLinkDestination(request);
      return NextResponse.redirect(destination);
    }

    const affiliate = await validateAffiliateCode(referralCode);
    if (!affiliate) {
      console.warn(
        `[affiliate/link-redirect] Invalid referral code: ${referralCode}`,
      );
      const destination = await resolveAffiliateLinkDestination(request);
      return NextResponse.redirect(destination);
    }

    try {
      const ip = getClientIp(request);
      await recordAffiliateClick(affiliate.user_id, ip);
    } catch (error) {
      console.error("[affiliate/link-redirect] failed to record click:", error);
    }

    const destination = await resolveAffiliateLinkDestination(request, referralCode);
    const response = NextResponse.redirect(destination);

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

    response.cookies.set(
      "__affiliate_ref",
      referralCode.trim().toUpperCase(),
      cookieOptions,
    );

    return response;
  } catch (error) {
    console.error("[affiliate/link-redirect] unexpected error:", error);
    try {
      const destination = await resolveAffiliateLinkDestination(request);
      return NextResponse.redirect(destination);
    } catch {
      return NextResponse.redirect(fallbackPortalMarket);
    }
  }
}
