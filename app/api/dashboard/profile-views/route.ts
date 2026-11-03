import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { prismaAnalytics } from "@/server/lib/prisma-analytics";
import {
  resolveRequestSession,
  resolveEffectiveUserId,
  getClientIp,
} from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { formatTimeAgo } from "@/server/lib/analytics";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

function formatLocation(city?: string | null, country?: string | null): string | null {
  const parts = [city?.trim(), country?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);

  try {
    const rateCheck = checkRateLimit("dashboard", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    const resolved = await resolveRequestSession(request, { tryRefresh: true });
    if (!resolved.session) {
      return NextResponse.json(
        { error: "Authentication required.", requiresAuth: true },
        { status: 401 }
      );
    }

    const userId = BigInt(resolveEffectiveUserId(resolved));
    const { searchParams } = new URL(request.url);
    const rawPage = parseInt(searchParams.get("page") ?? "1", 10);
    const rawLimit = parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10);
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const limit =
      Number.isFinite(rawLimit) && rawLimit >= MIN_LIMIT && rawLimit <= MAX_LIMIT
        ? rawLimit
        : DEFAULT_LIMIT;

    const views = await prismaAnalytics.portfolioView.findMany({
      where: { portfolio_owner_id: userId },
      orderBy: { created_at: "desc" },
      take: 400,
      select: {
        visitor_user_id: true,
        anonymous_session_id: true,
        visitor_ip_hash: true,
        country: true,
        city: true,
        device_type: true,
        created_at: true,
      },
    });

    type Group = {
      key: string;
      viewerId: string | null;
      isAnonymous: boolean;
      viewCount: number;
      city: string | null;
      country: string | null;
      deviceType: string | null;
      viewedAt: Date;
    };

    const groups = new Map<string, Group>();
    for (const view of views) {
      const key = view.visitor_user_id
        ? `user:${view.visitor_user_id.toString()}`
        : `anon:${view.anonymous_session_id || view.visitor_ip_hash || view.created_at.toISOString()}`;
      const existing = groups.get(key);
      if (existing) {
        existing.viewCount += 1;
        if (view.created_at > existing.viewedAt) {
          existing.viewedAt = view.created_at;
          existing.city = view.city;
          existing.country = view.country;
          existing.deviceType = view.device_type;
        }
        continue;
      }
      groups.set(key, {
        key,
        viewerId: view.visitor_user_id?.toString() ?? null,
        isAnonymous: !view.visitor_user_id,
        viewCount: 1,
        city: view.city,
        country: view.country,
        deviceType: view.device_type,
        viewedAt: view.created_at,
      });
    }

    const ordered = [...groups.values()].sort(
      (a, b) => b.viewedAt.getTime() - a.viewedAt.getTime(),
    );
    const totalItems = ordered.length;
    const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);
    const pageGroups = ordered.slice((page - 1) * limit, page * limit);

    const pageIds = pageGroups
      .map((group) => group.viewerId)
      .filter((id): id is string => Boolean(id))
      .map((id) => BigInt(id));

    const visitorUsers =
      pageIds.length > 0
        ? await prisma.user.findMany({
            where: { user_id: { in: pageIds } },
            select: {
              user_id: true,
              first_name: true,
              last_name: true,
              profile_url: true,
              custom_uri: true,
            },
          })
        : [];
    const visitorMap = new Map(
      visitorUsers.map((visitor) => [visitor.user_id.toString(), visitor]),
    );

    const now = new Date();
    const viewers = pageGroups.map((group) => {
      const visitor = group.viewerId ? visitorMap.get(group.viewerId) : null;
      return {
        viewerId: group.viewerId,
        isAnonymous: group.isAnonymous || !visitor,
        firstName: visitor?.first_name ?? "Guest",
        lastName: visitor?.last_name ?? "visitor",
        profileUrl: visitor?.profile_url ?? null,
        customUri: visitor?.custom_uri ?? null,
        location: formatLocation(group.city, group.country),
        city: group.city,
        country: group.country,
        deviceType: group.deviceType,
        viewCount: group.viewCount,
        viewedAt: group.viewedAt.toISOString(),
        timeAgo: formatTimeAgo(group.viewedAt, now),
      };
    });

    return NextResponse.json(
      serialize({
        viewers,
        pagination: {
          page,
          limit,
          totalItems,
          totalPages,
        },
      }),
      { status: 200 },
    );
  } catch (err) {
    console.error("[dashboard/profile-views] Unhandled error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred." },
      { status: 500 },
    );
  }
}
