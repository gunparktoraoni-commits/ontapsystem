import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  buildReferralUrl,
  buildTrackedReferralUrl,
  getOrGenerateAffiliateCode,
} from "@/server/lib/affiliate";
import { prisma } from "@/server/lib/prisma";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

/**
 * GET /api/affiliate/links
 * Get all referral links created by the current user (for custom domains, tracking, etc.)
 * Auth required.
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("affiliate-links", ip);
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
      // Get user's affiliate code
      const user = await prisma.user.findUnique({
        where: { user_id: userId },
        select: {
          affiliate_code: true,
          is_affiliate: true,
          is_affiliate_restricted: true,
        },
      });

      if (!user || !user.is_affiliate || user.is_affiliate_restricted) {
        return NextResponse.json(
          { error: "User is not an active affiliate." },
          { status: 403 }
        );
      }

      if (!user.affiliate_code) {
        await getOrGenerateAffiliateCode(userId);
      }

      const refreshedUser = await prisma.user.findUnique({
        where: { user_id: userId },
        select: { affiliate_code: true },
      });

      if (!refreshedUser?.affiliate_code) {
        return NextResponse.json(
          { error: "Unable to generate affiliate code. Contact support." },
          { status: 500 }
        );
      }

      const affiliateCode = refreshedUser.affiliate_code;

      // Fetch all affiliate links created by this user
      const affiliateLinks = await prisma.affiliateLink.findMany({
        where: { affiliate_user_id: userId },
        select: {
          id: true,
          affiliate_user_id: true,
          name: true,
          slug: true,
          target_url: true,
          is_active: true,
          created_at: true,
          updated_at: true,
        },
        orderBy: { created_at: "desc" },
      });

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://portal.ontap.ph";
      const defaultLink = buildTrackedReferralUrl(affiliateCode, appUrl);
      const storefrontLink = buildReferralUrl(affiliateCode);

      return NextResponse.json(
        serialize({
          success: true,
          data: {
            affiliate_code: user.affiliate_code,
            default_link: defaultLink,
            storefront_link: storefrontLink,
            custom_links: affiliateLinks.map((link) => ({
              link_id: link.id,
              name: link.name,
              slug: link.slug,
              url: link.target_url || defaultLink,
              is_active: link.is_active,
              created_at: link.created_at,
              updated_at: link.updated_at,
            })),
          },
        }),
        { status: 200 }
      );
    } catch (error) {
      console.error("[affiliate/links] query error:", error);
      return NextResponse.json(
        { success: false, error: "Failed to retrieve affiliate links." },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("[affiliate/links] unexpected error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error." },
      { status: 500 }
    );
  }
}
