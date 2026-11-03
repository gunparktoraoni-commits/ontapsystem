import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import {
  SuperAdminErrorCode,
  toSuperAdminErrorResponse,
} from "@/lib/errors/superadmin-errors";
import { toSuperAdminErrorNextResponse } from "@/lib/errors/superadmin-http";
import { checkSuperAdminDashboardRateLimit } from "@/lib/rate-limit/superadmin-dashboard-limits";
import { prisma } from "@/server/lib/prisma";
import { parseSuperAdminDateRangeFromSearchParams } from "@/lib/utils/superadmin-query";
import type { SuperAdminDateRange } from "@/lib/utils/superadmin-date-range";

type ActivityMode = "login" | "registration";

function toCoord(value: Prisma.Decimal | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseActivityMode(raw: string | null): ActivityMode {
  return raw === "registration" ? "registration" : "login";
}

async function getMapData(limit: number, mode: ActivityMode, dateRange: SuperAdminDateRange) {
  const users = await prisma.user.findMany({
    where:
      mode === "login"
        ? {
            is_active: true,
            last_login_at: {
              gte: dateRange.start,
              lte: dateRange.end,
            },
            last_login_latitude: { not: null },
            last_login_longitude: { not: null },
          }
        : {
            is_active: true,
            created_at: {
              gte: dateRange.start,
              lte: dateRange.end,
            },
            registration_latitude: { not: null },
            registration_longitude: { not: null },
          },
    select: {
      user_id: true,
      first_name: true,
      last_name: true,
      email: true,
      last_login_latitude: true,
      last_login_longitude: true,
      last_login_country: true,
      last_login_city: true,
      last_login_location: true,
      registration_latitude: true,
      registration_longitude: true,
      registration_country: true,
      registration_city: true,
      registration_location: true,
      last_login_at: true,
      created_at: true,
    },
    take: limit,
    orderBy: mode === "login" ? { last_login_at: "desc" } : { created_at: "desc" },
  });

  return users
    .map((user) => {
      const lat =
        mode === "login"
          ? toCoord(user.last_login_latitude)
          : toCoord(user.registration_latitude);
      const lng =
        mode === "login"
          ? toCoord(user.last_login_longitude)
          : toCoord(user.registration_longitude);
      if (lat === null || lng === null) return null;

      return {
        user_id: user.user_id.toString(),
        name: `${user.first_name} ${user.last_name}`.trim(),
        email: user.email,
        location: {
          latitude: lat,
          longitude: lng,
          country:
            mode === "login" ? user.last_login_country : user.registration_country,
          city: mode === "login" ? user.last_login_city : user.registration_city,
          location_string:
            mode === "login" ? user.last_login_location : user.registration_location,
          is_login_location: mode === "login",
        },
        last_active: (
          mode === "login"
            ? user.last_login_at ?? user.created_at
            : user.created_at
        ).toISOString(),
        activity_type: mode === "login" ? "login" : "registration",
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
}

async function getCitiesBreakdown(
  limit: number,
  mode: ActivityMode,
  dateRange: SuperAdminDateRange,
) {
  const users = await prisma.user.findMany({
    where:
      mode === "login"
        ? {
            is_active: true,
            last_login_at: {
              gte: dateRange.start,
              lte: dateRange.end,
            },
            last_login_city: { not: null },
          }
        : {
            is_active: true,
            created_at: {
              gte: dateRange.start,
              lte: dateRange.end,
            },
            registration_city: { not: null },
          },
    select: {
      last_login_city: true,
      last_login_country: true,
      registration_city: true,
      registration_country: true,
    },
  });

  const cityMap = new Map<string, { city: string; country: string; count: number }>();

  for (const user of users) {
    const city = mode === "login" ? user.last_login_city : user.registration_city;
    if (!city) continue;
    const country =
      (mode === "login" ? user.last_login_country : user.registration_country) || "";
    const key = `${city}|${country}`;
    const existing = cityMap.get(key);
    if (existing) existing.count += 1;
    else cityMap.set(key, { city, country, count: 1 });
  }

  const total = users.length || 1;
  return [...cityMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((entry) => ({
      city: entry.city,
      country: entry.country,
      user_count: entry.count,
      percentage: (entry.count / total) * 100,
    }));
}

export const GET = withDashboardSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkSuperAdminDashboardRateLimit(req, "USER_LOCATIONS", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many user location requests. Please try again later.",
          requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt,
        ),
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter ?? 1) } },
      );
    }

    const { searchParams } = req.nextUrl;
    const viewType = (searchParams.get("view") as "map" | "countries" | "cities") || "map";
    const limit = Math.min(1000, Math.max(10, Number.parseInt(searchParams.get("limit") || "100", 10)));
    const mode = parseActivityMode(searchParams.get("activity") ?? searchParams.get("mode"));
    const dateRange = parseSuperAdminDateRangeFromSearchParams(searchParams, requestId, {
      defaultFilter: "today",
      maxDays: 366,
    });

    let data: unknown;
    if (viewType === "cities") {
      data = await getCitiesBreakdown(limit, mode, dateRange);
    } else if (viewType === "countries") {
      const cities = await getCitiesBreakdown(1000, mode, dateRange);
      const countryMap = new Map<string, number>();
      for (const row of cities) {
        const country = row.country || "Unknown";
        countryMap.set(country, (countryMap.get(country) ?? 0) + row.user_count);
      }
      const total = [...countryMap.values()].reduce((sum, n) => sum + n, 0) || 1;
      data = [...countryMap.entries()].map(([country, user_count]) => ({
        country,
        user_count,
        percentage: (user_count / total) * 100,
      }));
    } else {
      data = await getMapData(limit, mode, dateRange);
    }

    return NextResponse.json({
      success: true,
      data,
      meta: {
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
        view_type: viewType,
        activity: mode,
        date_filter: dateRange.filterType,
        start: dateRange.start.toISOString(),
        end: dateRange.end.toISOString(),
        limit,
      },
    });
  } catch (error) {
    return toSuperAdminErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "[USER_LOCATIONS_API] Failed to fetch user locations",
    );
  }
});
