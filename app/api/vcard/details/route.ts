import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { withPerformanceTracking } from "@/middleware/performance";
import { applyDetailsPrivacy, buildVisibilityFlags } from "@/lib/vcard/privacy-filter";
import {
  getOptionalSessionUserId,
  resolveProfileByUsernameOrId,
  serializeBigInts,
  toIsoOrNull,
  toNullableString,
} from "@/lib/vcard/queries";

export async function GET(request: NextRequest) {
  return withPerformanceTracking(request, async () => {
    const ip = getClientIp(request);
    const rl = checkRateLimit("vcard-view", ip);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many requests. Please slow down." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
      );
    }

    const q = request.nextUrl.searchParams;
    const username = toNullableString(q.get("username"));
    const userId = toNullableString(q.get("userId"));

    if (!username && !userId) {
      return NextResponse.json(
        { success: false, error: "username or userId is required." },
        { status: 400 }
      );
    }

    try {
      const sessionUserId = await getOptionalSessionUserId(request);

    if (userId && !sessionUserId) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    if (userId && sessionUserId && sessionUserId !== BigInt(userId)) {
      return NextResponse.json({ success: false, error: "Forbidden." }, { status: 403 });
    }

    const profile = await resolveProfileByUsernameOrId({ username, userId });
    if (!profile) {
      return NextResponse.json({ success: false, error: "Profile not found." }, { status: 404 });
    }

    const isOwner = Boolean(sessionUserId && sessionUserId === profile.user_id);
    if (!isOwner && (!profile.vcard_published || !profile.is_active)) {
      return NextResponse.json({ success: false, error: "Profile is private." }, { status: 403 });
    }

    let profileAddress = "";
    let companyName: string | null = null;

    if (profile.bizcard_id) {
      const [bizcardAddress, bizcardCompany] = await Promise.all([
        prisma.bizcard.findUnique({
          where: { bizcard_id: profile.bizcard_id },
          select: {
            area: true,
            baranggay: true,
            city: true,
            region: true,
            zip_code: true,
          },
        }),
        prisma.bizcard.findUnique({
          where: { bizcard_id: profile.bizcard_id },
          select: { company: { select: { name: true } } },
        }),
      ]);

      companyName = bizcardCompany?.company?.name ?? null;
      profileAddress = [
        bizcardAddress?.area,
        bizcardAddress?.baranggay,
        bizcardAddress?.city,
        bizcardAddress?.region,
        bizcardAddress?.zip_code?.toString(),
      ]
        .filter((part): part is string => Boolean(part))
        .join(", ");
    } else {
      const [userAddress, userCompany] = await Promise.all([
        prisma.address.findFirst({
          where: { user_id: profile.user_id },
          select: { area: true, brgy: true, city: true, region: true, zipcode: true },
        }),
        prisma.user.findUnique({
          where: { user_id: profile.user_id },
          select: { company: { select: { name: true } } },
        }),
      ]);

      companyName = userCompany?.company?.name ?? null;
      profileAddress = [
        userAddress?.area,
        userAddress?.brgy,
        userAddress?.city,
        userAddress?.region,
        userAddress?.zipcode,
      ]
        .filter((part): part is string => Boolean(part))
        .join(", ");
    }

    const withPrivacy = applyDetailsPrivacy(
      {
        email_address: profile.email,
        phone_number: profile.contact,
        alternative_email: profile.alt_email,
        alternative_number: profile.alt_contact,
      },
      isOwner
    );

    const payload = {
      success: true,
      data: {
        bizcard_id: profile.bizcard_id,
        custom_uri: profile.custom_uri,
        bizcard_name: profile.vcard_name ?? `${profile.first_name} ${profile.last_name}`.trim(),
        description: profile.vcard_description,
        first_name: profile.first_name,
        last_name: profile.last_name,
        professional_title: profile.job_position ?? profile.prof_title,
        post_nominal: profile.post_nominal,
        suffix: profile.suffix,
        company: companyName,
        address: profileAddress || null,
        bio: profile.about,
        email_address: withPrivacy.email_address,
        phone_number: withPrivacy.phone_number,
        alternative_email: withPrivacy.alternative_email,
        alternative_number: withPrivacy.alternative_number,
        default_language: "en",
        is_public: profile.vcard_published && profile.is_active,
        last_updated: toIsoOrNull(profile.updated_at),
        visibility: buildVisibilityFlags(isOwner),
      },
    };

    const headers: HeadersInit = {
      "Cache-Control": "private, no-store, no-cache, must-revalidate",
    };

      return NextResponse.json(serializeBigInts(payload), { status: 200, headers });
    } catch (error) {
      console.error("[vcard/details GET] Unexpected error:", error);
      return NextResponse.json(
        { success: false, error: "An unexpected error occurred. Please try again." },
        { status: 500 }
      );
    }
  });
}
