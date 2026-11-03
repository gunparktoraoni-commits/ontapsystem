import { NextRequest, NextResponse } from "next/server";
import { prismaAnalytics } from "@/server/lib/prisma-analytics";
import { validateToken, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  formatPercentageChange,
  formatTimeAgo,
  resolveAnalyticsDateRange,
} from "@/server/lib/analytics";

type AggregatedPayload = {
  summary: {
    total_views: number;
    unique_visitors: number;
    total_saves: number;
    unique_savers: number;
    conversion_rate: number;
    comparison: {
      views_change: string;
      saves_change: string;
    };
  };
  charts: {
    views_over_time: Array<{ date: string; views: number; unique: number }>;
    saves_over_time: Array<{ date: string; saves: number; unique: number }>;
  };
  locations: {
    countries: Array<{ country: string; code: string; views: number; unique: number }>;
    cities: Array<{ city: string; country: string; views: number; unique: number }>;
    map_data: Array<{ lat: number; lng: number; count: number; city: string }>;
  };
  date_range: {
    filter: string;
    start: string;
    end: string;
  };
};

type CacheEntry = {
  expiresAt: number;
  value: AggregatedPayload;
};

type ViewSummaryRow = { total_views: bigint; unique_visitors: bigint };
type SaveSummaryRow = { total_saves: bigint; unique_savers: bigint };
type PreviousViewRow = { total_views: bigint };
type PreviousSaveRow = { total_saves: bigint };
type ViewsByDayRow = { day: Date | string; views: bigint; unique_visitors: bigint };
type SavesByDayRow = { day: Date | string; saves: bigint; unique_savers: bigint };
type CountryRow = { country: string | null; code: string | null; views: bigint; unique_visitors: bigint };
type CityRow = {
  city: string | null;
  country: string | null;
  views: bigint;
  unique_visitors: bigint;
  lat: string | null;
  lng: string | null;
};
type RecentCountRow = { total: bigint };
type RecentActivityRow = {
  id: string;
  type: "profile_view" | "contact_save";
  created_at: Date;
  city: string | null;
  country: string | null;
  country_code: string | null;
  device_type: string | null;
  browser: string | null;
  save_type: string | null;
};

const aggregateCache = new Map<string, CacheEntry>();
const AGGREGATE_CACHE_TTL_MS = 5 * 60 * 1000;

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toDateKey(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const parsed = new Date(String(value));
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

function buildDays(start: Date, end: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(start);
  cursor.setUTCHours(0, 0, 0, 0);
  const endUtc = new Date(end);
  endUtc.setUTCHours(0, 0, 0, 0);

  while (cursor.getTime() <= endUtc.getTime()) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

async function fetchAggregates(
  ownerId: bigint,
  filter: string,
  start: Date,
  end: Date,
  previousStart: Date,
  previousEnd: Date
): Promise<AggregatedPayload> {
  const [
    viewSummaryRows,
    saveSummaryRows,
    previousViewRows,
    previousSaveRows,
    viewsByDayRows,
    savesByDayRows,
    countriesRows,
    citiesRows,
  ]: [
    ViewSummaryRow[],
    SaveSummaryRow[],
    PreviousViewRow[],
    PreviousSaveRow[],
    ViewsByDayRow[],
    SavesByDayRow[],
    CountryRow[],
    CityRow[],
  ] = await Promise.all([
    prismaAnalytics.$queryRaw<ViewSummaryRow[]>`
      SELECT
        COUNT(*) AS total_views,
        COUNT(DISTINCT CASE
          WHEN visitor_user_id IS NOT NULL THEN CONCAT('u:', visitor_user_id)
          WHEN anonymous_session_id IS NOT NULL THEN CONCAT('a:', anonymous_session_id)
          WHEN visitor_ip_prefix IS NOT NULL THEN CONCAT('ip:', visitor_ip_prefix)
          ELSE NULL
        END) AS unique_visitors
      FROM PortfolioView
      WHERE portfolio_owner_id = ${ownerId}
        AND created_at BETWEEN ${start} AND ${end}
    `,
    prismaAnalytics.$queryRaw<SaveSummaryRow[]>`
      SELECT
        COUNT(*) AS total_saves,
        COUNT(DISTINCT CASE
          WHEN visitor_user_id IS NOT NULL THEN CONCAT('u:', visitor_user_id)
          WHEN anonymous_session_id IS NOT NULL THEN CONCAT('a:', anonymous_session_id)
          WHEN visitor_ip_prefix IS NOT NULL THEN CONCAT('ip:', visitor_ip_prefix)
          ELSE NULL
        END) AS unique_savers
      FROM ContactSave
      WHERE portfolio_owner_id = ${ownerId}
        AND created_at BETWEEN ${start} AND ${end}
    `,
    prismaAnalytics.$queryRaw<PreviousViewRow[]>`
      SELECT COUNT(*) AS total_views
      FROM PortfolioView
      WHERE portfolio_owner_id = ${ownerId}
        AND created_at BETWEEN ${previousStart} AND ${previousEnd}
    `,
    prismaAnalytics.$queryRaw<PreviousSaveRow[]>`
      SELECT COUNT(*) AS total_saves
      FROM ContactSave
      WHERE portfolio_owner_id = ${ownerId}
        AND created_at BETWEEN ${previousStart} AND ${previousEnd}
    `,
    prismaAnalytics.$queryRaw<ViewsByDayRow[]>`
      SELECT
        DATE(created_at) AS day,
        COUNT(*) AS views,
        COUNT(DISTINCT CASE
          WHEN visitor_user_id IS NOT NULL THEN CONCAT('u:', visitor_user_id)
          WHEN anonymous_session_id IS NOT NULL THEN CONCAT('a:', anonymous_session_id)
          WHEN visitor_ip_prefix IS NOT NULL THEN CONCAT('ip:', visitor_ip_prefix)
          ELSE NULL
        END) AS unique_visitors
      FROM PortfolioView
      WHERE portfolio_owner_id = ${ownerId}
        AND created_at BETWEEN ${start} AND ${end}
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at) ASC
    `,
    prismaAnalytics.$queryRaw<SavesByDayRow[]>`
      SELECT
        DATE(created_at) AS day,
        COUNT(*) AS saves,
        COUNT(DISTINCT CASE
          WHEN visitor_user_id IS NOT NULL THEN CONCAT('u:', visitor_user_id)
          WHEN anonymous_session_id IS NOT NULL THEN CONCAT('a:', anonymous_session_id)
          WHEN visitor_ip_prefix IS NOT NULL THEN CONCAT('ip:', visitor_ip_prefix)
          ELSE NULL
        END) AS unique_savers
      FROM ContactSave
      WHERE portfolio_owner_id = ${ownerId}
        AND created_at BETWEEN ${start} AND ${end}
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at) ASC
    `,
    prismaAnalytics.$queryRaw<CountryRow[]>`
      SELECT
        country AS country,
        country_code AS code,
        COUNT(*) AS views,
        COUNT(DISTINCT CASE
          WHEN visitor_user_id IS NOT NULL THEN CONCAT('u:', visitor_user_id)
          WHEN anonymous_session_id IS NOT NULL THEN CONCAT('a:', anonymous_session_id)
          WHEN visitor_ip_prefix IS NOT NULL THEN CONCAT('ip:', visitor_ip_prefix)
          ELSE NULL
        END) AS unique_visitors
      FROM PortfolioView
      WHERE portfolio_owner_id = ${ownerId}
        AND created_at BETWEEN ${start} AND ${end}
      GROUP BY country, country_code
      ORDER BY views DESC
      LIMIT 10
    `,
    prismaAnalytics.$queryRaw<CityRow[]>`
      SELECT
        city AS city,
        COALESCE(country_code, country) AS country,
        COUNT(*) AS views,
        COUNT(DISTINCT CASE
          WHEN visitor_user_id IS NOT NULL THEN CONCAT('u:', visitor_user_id)
          WHEN anonymous_session_id IS NOT NULL THEN CONCAT('a:', anonymous_session_id)
          WHEN visitor_ip_prefix IS NOT NULL THEN CONCAT('ip:', visitor_ip_prefix)
          ELSE NULL
        END) AS unique_visitors,
        MAX(latitude) AS lat,
        MAX(longitude) AS lng
      FROM PortfolioView
      WHERE portfolio_owner_id = ${ownerId}
        AND created_at BETWEEN ${start} AND ${end}
        AND city IS NOT NULL
      GROUP BY city, COALESCE(country_code, country)
      ORDER BY views DESC
      LIMIT 10
    `,
  ]);

  const totalViews = toNumber(viewSummaryRows[0]?.total_views ?? 0);
  const uniqueVisitors = toNumber(viewSummaryRows[0]?.unique_visitors ?? 0);
  const totalSaves = toNumber(saveSummaryRows[0]?.total_saves ?? 0);
  const uniqueSavers = toNumber(saveSummaryRows[0]?.unique_savers ?? 0);

  const previousViews = toNumber(previousViewRows[0]?.total_views ?? 0);
  const previousSaves = toNumber(previousSaveRows[0]?.total_saves ?? 0);

  const conversionRate = totalViews === 0 ? 0 : Math.round(((totalSaves / totalViews) * 100) * 10) / 10;

  const allDays = buildDays(start, end);
  const viewMap = new Map(viewsByDayRows.map((r) => [toDateKey(r.day), r]));
  const saveMap = new Map(savesByDayRows.map((r) => [toDateKey(r.day), r]));

  const viewsOverTime = allDays.map((day) => {
    const row = viewMap.get(day);
    return {
      date: day,
      views: row ? toNumber(row.views) : 0,
      unique: row ? toNumber(row.unique_visitors) : 0,
    };
  });

  const savesOverTime = allDays.map((day) => {
    const row = saveMap.get(day);
    return {
      date: day,
      saves: row ? toNumber(row.saves) : 0,
      unique: row ? toNumber(row.unique_savers) : 0,
    };
  });

  const countries = countriesRows.map((row) => ({
    country: row.country ?? "Unknown",
    code: row.code ?? "XX",
    views: toNumber(row.views),
    unique: toNumber(row.unique_visitors),
  }));

  const cities = citiesRows.map((row) => ({
    city: row.city ?? "Unknown",
    country: row.country ?? "XX",
    views: toNumber(row.views),
    unique: toNumber(row.unique_visitors),
  }));

  const mapData = citiesRows
    .map((row) => {
      const lat = row.lat != null ? Number(row.lat) : NaN;
      const lng = row.lng != null ? Number(row.lng) : NaN;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return {
        lat,
        lng,
        count: toNumber(row.views),
        city: row.city ?? "Unknown",
      };
    })
    .filter((v): v is { lat: number; lng: number; count: number; city: string } => v !== null);

  return {
    summary: {
      total_views: totalViews,
      unique_visitors: uniqueVisitors,
      total_saves: totalSaves,
      unique_savers: uniqueSavers,
      conversion_rate: conversionRate,
      comparison: {
        views_change: formatPercentageChange(totalViews, previousViews),
        saves_change: formatPercentageChange(totalSaves, previousSaves),
      },
    },
    charts: {
      views_over_time: viewsOverTime,
      saves_over_time: savesOverTime,
    },
    locations: {
      countries,
      cities,
      map_data: mapData,
    },
    date_range: {
      filter,
      start: start.toISOString(),
      end: end.toISOString(),
    },
  };
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rawToken = request.cookies.get("session_token")?.value;
    if (!rawToken) {
      return NextResponse.json({ error: "Authentication required.", requiresAuth: true }, { status: 401 });
    }

    const session = await validateToken(rawToken);
    if (!session) {
      return NextResponse.json({ error: "Session expired. Please log in again.", requiresAuth: true }, { status: 401 });
    }

    // Per-user limit (30/min) as requested.
    const rateCheck = checkRateLimit("analytics-dashboard", String(session.userId));
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many analytics requests. Please slow down." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
      );
    }

    const search = request.nextUrl.searchParams;
    const page = parsePositiveInt(search.get("page"), 1);
    const limit = Math.min(parsePositiveInt(search.get("limit"), 20), 100);
    const offset = (page - 1) * limit;

    const rangeResult = resolveAnalyticsDateRange(
      search.get("filter"),
      search.get("startDate"),
      search.get("endDate")
    );
    if (!rangeResult.ok) {
      return NextResponse.json({ error: rangeResult.error }, { status: 422 });
    }

    const ownerId = BigInt(session.userId);
    const { filter, start, end, previousStart, previousEnd } = rangeResult.data;

    const cacheKey = `${ownerId.toString()}|${filter}|${start.toISOString()}|${end.toISOString()}`;
    const now = Date.now();
    const cachedEntry = aggregateCache.get(cacheKey);

    let aggregate: AggregatedPayload;
    let cached = false;

    if (cachedEntry && cachedEntry.expiresAt > now) {
      aggregate = cachedEntry.value;
      cached = true;
    } else {
      aggregate = await fetchAggregates(ownerId, filter, start, end, previousStart, previousEnd);
      aggregateCache.set(cacheKey, {
        expiresAt: now + AGGREGATE_CACHE_TTL_MS,
        value: aggregate,
      });
    }

    // Real-time (uncached) recent activity feed.
    const [recentCountRows, recentRows]: [RecentCountRow[], RecentActivityRow[]] = await Promise.all([
      prismaAnalytics.$queryRaw<RecentCountRow[]>`
        SELECT
          (
            (SELECT COUNT(*) FROM PortfolioView WHERE portfolio_owner_id = ${ownerId} AND created_at BETWEEN ${start} AND ${end}) +
            (SELECT COUNT(*) FROM ContactSave WHERE portfolio_owner_id = ${ownerId} AND created_at BETWEEN ${start} AND ${end})
          ) AS total
      `,
      prismaAnalytics.$queryRaw<RecentActivityRow[]>`
        SELECT * FROM (
          SELECT
            CONCAT('view-', id) AS id,
            'profile_view' AS type,
            created_at,
            city,
            country,
            country_code,
            device_type,
            browser,
            NULL AS save_type
          FROM PortfolioView
          WHERE portfolio_owner_id = ${ownerId}
            AND created_at BETWEEN ${start} AND ${end}

          UNION ALL

          SELECT
            CONCAT('save-', id) AS id,
            'contact_save' AS type,
            created_at,
            city,
            country,
            country_code,
            device_type,
            browser,
            save_type
          FROM ContactSave
          WHERE portfolio_owner_id = ${ownerId}
            AND created_at BETWEEN ${start} AND ${end}
        ) AS events
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
    ]);

    const recentTotal = toNumber(recentCountRows[0]?.total ?? 0);
    const recentItems = recentRows.map((row) => {
      const location = row.city && row.country_code
        ? `${row.city}, ${row.country_code}`
        : row.country
          ? row.country
          : "Unknown";
      const device = `${row.device_type ?? "Unknown"} / ${row.browser ?? "Unknown"}`;

      const description = row.type === "profile_view"
        ? `Profile viewed from ${location}`
        : `Contact saved${row.save_type ? ` (${row.save_type})` : ""}`;

      return {
        id: row.id,
        type: row.type,
        description,
        timestamp: row.created_at.toISOString(),
        time_ago: formatTimeAgo(row.created_at),
        location,
        device,
      };
    });

    return NextResponse.json(
      serialize({
        success: true,
        data: {
          summary: aggregate.summary,
          charts: aggregate.charts,
          locations: aggregate.locations,
          recent_activities: {
            items: recentItems,
            pagination: {
              page,
              limit,
              total: recentTotal,
              pages: Math.max(1, Math.ceil(recentTotal / limit)),
            },
          },
          date_range: aggregate.date_range,
        },
        meta: {
          generated_at: new Date().toISOString(),
          response_time_ms: Date.now() - startedAt,
          cached,
          requester_ip: ip,
        },
      })
    );
  } catch (err) {
    console.error("[api/analytics] Unhandled error:", err);
    return NextResponse.json({ success: false, error: "An unexpected error occurred." }, { status: 500 });
  }
}
