// ──────────────────────────────────────────────────────────────
// GET /api/dashboard — Portfolio Owner Dashboard Overview
// ──────────────────────────────────────────────────────────────
// Returns aggregated metrics and widgets for the authenticated user's
// personal dashboard page.
//
// Authentication: Required (session_token cookie).
//
// Response shape:
// {
//   metrics: {
//     totalViews:        number   — portfolio page views this month
//     totalConnections:  number   — accepted connections created this month
//     totalInquiries:    number   — inquiries received this month
//     unreadInquiries:   number   — inquiries not yet marked read (all-time)
//     totalContactSaves: number   — contact save/download events this month
//     metricsPeriod:     string   — YYYY-MM period key for the counts above
//   },
//   recentInquiries: [            — latest 5 unread inquiries for inbox widget
//     { inquiryId, visitorName, subject, createdAt }
//   ],
//   qrCode:       string | null   — base64 SVG data URL from VCardSetup
//   portfolioUrl: string | null   — full public URL to the user's portfolio
//   hasCompany:   boolean         — whether this user belongs to a company
// }
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { format } from "date-fns";
import { prisma } from "@/server/lib/prisma";
import { prismaAnalytics } from "@/server/lib/prisma-analytics";
import { resolveRequestSession, resolveEffectiveUserId, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { buildVCardPublicUrl } from "@/server/lib/qr";
import { QRCodeService } from "@/lib/services/qr-code.service";
import { resolveBizcardDashboardDateRange } from "@/lib/services/bizcard-dashboard.service";

const prismaAny = prisma as any;

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

function isPoolTimeoutError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2024"
  );
}

async function safeAnalyticsCount(run: () => Promise<number>, label: string): Promise<number> {
  try {
    return await run();
  } catch (err) {
    // Degrade gracefully when analytics pool is exhausted so dashboard
    // remains usable instead of failing the whole request.
    if (isPoolTimeoutError(err)) {
      console.warn(`[dashboard] ${label} fallback to 0 due to analytics pool timeout (P2024).`);
      return 0;
    }
    throw err;
  }
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);

  try {
    // ── Rate Limiting ──────────────────────────────
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

    // ── Authentication + impersonation resolution ──
    // resolveRequestSession reads both the session cookie and the
    // x-impersonation-token header. resolveEffectiveUserId returns the
    // impersonated user's id when a superadmin has an active impersonation
    // session, so this endpoint correctly returns that user's dashboard data.
    const resolved = await resolveRequestSession(request, { tryRefresh: true });
    if (!resolved.session) {
      return NextResponse.json(
        { error: "Authentication required.", requiresAuth: true },
        { status: 401 }
      );
    }

    const userId = BigInt(resolveEffectiveUserId(resolved));
    const monthRange = resolveBizcardDashboardDateRange("this_month");
    const monthStart = monthRange.start;
    const monthEnd = monthRange.end;
    const metricsPeriod = format(monthStart, "yyyy-MM");

    // Split into two smaller batches to reduce per-request pool pressure.
    const [totalViews, totalContactSaves] = await Promise.all([
      safeAnalyticsCount(
        () =>
          prismaAnalytics.portfolioView.count({
            where: {
              portfolio_owner_id: userId,
              created_at: { gte: monthStart, lte: monthEnd },
            },
          }),
        "portfolioView.count"
      ),
      safeAnalyticsCount(
        () =>
          prismaAnalytics.contactSave.count({
            where: {
              portfolio_owner_id: userId,
              created_at: { gte: monthStart, lte: monthEnd },
            },
          }),
        "contactSave.count"
      ),
    ]);

    const [totalConnections, totalInquiries, unreadInquiries, recentInquiries, primaryBizcard, user] =
      await Promise.all([
        prisma.connection.count({
          where: {
            status: "accepted",
            OR: [{ requester_user_id: userId }, { recipient_user_id: userId }],
            created_at: { gte: monthStart, lte: monthEnd },
          },
        }),
        prisma.inquiry.count({
          where: {
            user_id: userId,
            created_at: { gte: monthStart, lte: monthEnd },
          },
        }),
        prisma.inquiry.count({ where: { user_id: userId, status: { in: ["new", "unread"] } } }),
        prisma.inquiry.findMany({
          where: { user_id: userId, status: { in: ["new", "unread"] } },
          orderBy: { created_at: "desc" },
          take: 5,
          select: {
            inquiry_id: true,
            visitor_name: true,
            subject: true,
            created_at: true,
          },
        }),
        // Fetch primary bizcard with QR code data
        prismaAny.bizcard.findFirst({
          where: { user_id: userId, deactivated_flag: false },
          orderBy: { created_at: "desc" },
          take: 1,
          select: {
            bizcard_id: true,
            url_alias: true,
            qr_code_url: true,
            portfolio_qr_code_url: true,
            vcf_file_url: true,
            qr_code_generated_at: true,
            qr_code_last_accessed: true,
            scan_count: true,
            portfolio_url: true,
          },
        }),
        prisma.user.findUnique({
          where: { user_id: userId },
          select: {
            custom_uri: true,
            company_id: true,
          },
        }),
      ]);

    const customUri = user?.custom_uri ?? null;
    const aliasForPublicUrl = primaryBizcard?.url_alias ?? customUri;
    const portfolioUrl = primaryBizcard?.portfolio_url ?? (aliasForPublicUrl ? buildVCardPublicUrl(aliasForPublicUrl) : null);

    let qrCode = primaryBizcard?.qr_code_url ?? null;
    const portfolioQrCode = primaryBizcard?.portfolio_qr_code_url ?? null;
    // VCF is generated on demand — prefer live download URL over any legacy Cloudinary link.
    const vcfFileUrl = aliasForPublicUrl
      ? `/api/public/${encodeURIComponent(aliasForPublicUrl)}?download=vcard`
      : null;
    let qrGeneratedAt = primaryBizcard?.qr_code_generated_at ?? null;

    if (!qrCode && primaryBizcard?.bizcard_id && aliasForPublicUrl) {
      try {
        const requestId = `dashboard_qr_${Date.now()}`;
        const qrService = new QRCodeService(requestId);
        const generated = await qrService.getOrGenerateQRCode(primaryBizcard.bizcard_id, aliasForPublicUrl);
        qrCode = generated.qr_code_url;
        qrGeneratedAt = generated.generated_at;
      } catch (qrError) {
        // Dashboard should remain functional even if QR generation fails.
        console.error("[dashboard] QR generation fallback failed:", qrError);
      }
    }

    return NextResponse.json(
      serialize({
        metrics: {
          totalViews,
          totalConnections,
          totalInquiries,
          unreadInquiries,
          totalContactSaves,
          metricsPeriod,
        },
        recentInquiries: recentInquiries.map((inq) => ({
          inquiryId:   inq.inquiry_id,
          visitorName: inq.visitor_name,
          subject:     inq.subject ?? null,
          createdAt:   inq.created_at,
        })),
        qrCode,
        portfolioQrCode,
        vcfFileUrl,
        qrCodeGeneratedAt: qrGeneratedAt,
        qrCodeLastAccessed: primaryBizcard?.qr_code_last_accessed ?? null,
        qrScanCount: Number(primaryBizcard?.scan_count ?? 0),
        portfolioUrl,
        hasCompany:   user?.company_id != null,
      }),
      { status: 200 }
    );
  } catch (err) {
    console.error("[dashboard] Unhandled error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
