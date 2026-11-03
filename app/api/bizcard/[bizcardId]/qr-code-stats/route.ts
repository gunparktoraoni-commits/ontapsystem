import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { prisma } from "@/server/lib/prisma";

const prismaAny = prisma as any;

function parseBizcardId(input: string): bigint | null {
  if (!/^\d+$/.test(input)) return null;
  return BigInt(input);
}

function getDateBoundaries(now = new Date()) {
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);

  const startWeek = new Date(startToday);
  const day = startWeek.getDay();
  const diff = (day + 6) % 7;
  startWeek.setDate(startWeek.getDate() - diff);

  const startMonth = new Date(startToday.getFullYear(), startToday.getMonth(), 1);

  return { startToday, startWeek, startMonth };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bizcardId: string }> }
) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit("bizcard-qr-stats", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many requests.",
        },
      },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  const resolved = await resolveRequestSession(request, { tryRefresh: true });
  if (!resolved.session) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required",
        },
      },
      { status: 401 }
    );
  }

  const { bizcardId: bizcardIdRaw } = await params;
  const bizcardId = parseBizcardId(bizcardIdRaw);
  if (!bizcardId) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INVALID_BIZCARD_ID",
          message: "bizcardId must be numeric",
        },
      },
      { status: 400 }
    );
  }

  const requestId = `qrst_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const userId = BigInt(resolved.session.userId);

  try {
    const [bizcard, caller] = await Promise.all([
      prismaAny.bizcard.findUnique({
        where: { bizcard_id: bizcardId },
        select: {
          bizcard_id: true,
          user_id: true,
          company_id: true,
        },
      }),
      prismaAny.user.findUnique({
        where: { user_id: userId },
        select: { user_id: true, role: true, company_id: true },
      }),
    ]);

    if (!bizcard) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "BIZCARD_NOT_FOUND",
            message: "Bizcard not found",
          },
        },
        { status: 404 }
      );
    }

    const isOwner = bizcard.user_id && bizcard.user_id === userId;
    const isSuper = caller?.role === "super_admin" || caller?.role === "dev";
    const isCompanyAdmin =
      caller?.role === "company_admin" &&
      caller?.company_id != null &&
      bizcard.company_id != null &&
      caller.company_id === bizcard.company_id;

    if (!isOwner && !isSuper && !isCompanyAdmin) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "You are not allowed to view QR stats for this bizcard",
          },
        },
        { status: 403 }
      );
    }

    const { startToday, startWeek, startMonth } = getDateBoundaries();

    const [totalScans, scansToday, scansThisWeek, scansThisMonth, lastScan] = await Promise.all([
      prismaAny.qRCodeScan.count({ where: { bizcard_id: bizcardId, scan_successful: true } }),
      prismaAny.qRCodeScan.count({
        where: {
          bizcard_id: bizcardId,
          scan_successful: true,
          scan_timestamp: { gte: startToday },
        },
      }),
      prismaAny.qRCodeScan.count({
        where: {
          bizcard_id: bizcardId,
          scan_successful: true,
          scan_timestamp: { gte: startWeek },
        },
      }),
      prismaAny.qRCodeScan.count({
        where: {
          bizcard_id: bizcardId,
          scan_successful: true,
          scan_timestamp: { gte: startMonth },
        },
      }),
      prismaAny.qRCodeScan.findFirst({
        where: { bizcard_id: bizcardId, scan_successful: true },
        orderBy: { scan_timestamp: "desc" },
        select: { scan_timestamp: true },
      }),
    ]);

    const [uniqueIpRows, topLocationsRows, timelineRows] = await Promise.all([
      prisma.$queryRaw<Array<{ unique_ips: bigint | number }>>(Prisma.sql`
        SELECT COUNT(DISTINCT scanner_ip) AS unique_ips
        FROM qr_code_scans
        WHERE bizcard_id = ${bizcardId}
          AND scan_successful = TRUE
          AND scanner_ip IS NOT NULL
      `),
      prisma.$queryRaw<Array<{ location: string | null; count: bigint | number }>>(Prisma.sql`
        SELECT scanner_location AS location, COUNT(*) AS count
        FROM qr_code_scans
        WHERE bizcard_id = ${bizcardId}
          AND scan_successful = TRUE
          AND scanner_location IS NOT NULL
        GROUP BY scanner_location
        ORDER BY count DESC
        LIMIT 5
      `),
      prisma.$queryRaw<Array<{ scan_date: Date; count: bigint | number }>>(Prisma.sql`
        SELECT DATE(scan_timestamp) AS scan_date, COUNT(*) AS count
        FROM qr_code_scans
        WHERE bizcard_id = ${bizcardId}
          AND scan_successful = TRUE
          AND scan_timestamp >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY DATE(scan_timestamp)
        ORDER BY scan_date DESC
      `),
    ]);

    const uniqueIps = Number(uniqueIpRows[0]?.unique_ips ?? 0);

    return NextResponse.json({
      success: true,
      data: {
        total_scans: Number(totalScans),
        last_scan: lastScan?.scan_timestamp ?? null,
        scans_today: Number(scansToday),
        scans_this_week: Number(scansThisWeek),
        scans_this_month: Number(scansThisMonth),
        unique_ips: uniqueIps,
        top_locations: topLocationsRows.map((row) => ({
          location: row.location ?? "Unknown",
          count: Number(row.count),
        })),
        scan_timeline: timelineRows
          .map((row) => ({
            date: row.scan_date instanceof Date ? row.scan_date.toISOString().slice(0, 10) : String(row.scan_date),
            count: Number(row.count),
          }))
          .reverse(),
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[bizcard/[bizcardId]/qr-code-stats] unexpected error", {
      requestId,
      bizcardId: bizcardId.toString(),
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch QR code stats",
        },
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}
