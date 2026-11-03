import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { prisma } from "@/server/lib/prisma";
import { generateQRCodeDataUrl } from "@/server/lib/qr";
import { requireRole } from "@/lib/middleware/roleAuth";
import { SerialIdService } from "@/lib/services/serialIdService";
import { logAdminAudit } from "@/lib/services/adminAuditService";

const prismaAny = prisma as any;

function resolvePortfolioBaseUrl(): string {
  const direct =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.FRONTEND_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

  return direct.replace(/\/$/, "");
}

function buildPortfolioUrl(serialId: string): string | null {
  const base = resolvePortfolioBaseUrl();
  if (!base) return null;
  return `${base}/api/portfolio/resolve/${encodeURIComponent(serialId)}`;
}

function placeholderEmail(serialId: string): string {
  const token = serialId.replace(/[^A-Z0-9]/gi, "").toLowerCase();
  return `blank+${token}@ontap.local`;
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ["super_admin", "dev"]);
  if (!auth.ok) return auth.response;

  const ip = getClientIp(request);
  const limiter = checkRateLimit("admin-bizcard-generate", `${ip}:${auth.actor.userId.toString()}`);
  if (!limiter.allowed) {
    const retryAfter = Math.max(1, Math.ceil(limiter.retryAfterMs / 1000));
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many generation requests. Please try again shortly.",
          retryAfter,
        },
      },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  try {
    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const requestedCount = Number(body.count ?? 1);
    const count = Number.isInteger(requestedCount) ? requestedCount : 1;

    if (count < 1 || count > 1000) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_COUNT",
            message: "Count must be between 1 and 1000",
          },
        },
        { status: 400 }
      );
    }

    const serialService = SerialIdService.getInstance();
    const serialIds = await serialService.generateBatchSerialIds(count);

    const generatedCards: Array<{
      id: string;
      serialId: string;
      qrCodeUrl: string | null;
      portfolioUrl: string | null;
      createdAt: string;
    }> = [];

    await prismaAny.$transaction(async (tx: any) => {
      for (const serialId of serialIds) {
        const portfolioUrl = buildPortfolioUrl(serialId);
        const qrCodeUrl = portfolioUrl ? generateQRCodeDataUrl(portfolioUrl) : null;

        const created = await tx.bizcard.create({
          data: {
            user_id: null,
            bizcard_name: `Blank Card ${serialId}`,
            serial_id: serialId,
            url_alias: null,
            first_name: "Blank",
            last_name: "Card",
            city: "",
            email: placeholderEmail(serialId),
            contact_number: "N/A",
            bizcard_type: "physical",
            deactivated_flag: false,
            is_blank: true,
            generated_by_user_id: auth.actor.userId,
            generated_at: new Date(),
            qr_code_url: qrCodeUrl,
            qr_code_generated_at: qrCodeUrl ? new Date() : null,
            portfolio_url: portfolioUrl,
          },
          select: {
            bizcard_id: true,
            serial_id: true,
            qr_code_url: true,
            portfolio_url: true,
            created_at: true,
          },
        });

        generatedCards.push({
          id: created.bizcard_id.toString(),
          serialId: created.serial_id,
          qrCodeUrl: created.qr_code_url,
          portfolioUrl: created.portfolio_url,
          createdAt: created.created_at.toISOString(),
        });
      }
    });

    await logAdminAudit({
      adminUserId: auth.actor.userId,
      adminEmail: auth.actor.email,
      action: "GENERATE_BLANK_CARDS",
      details: {
        count,
        sampleSerialIds: serialIds.slice(0, 10),
      },
      ipAddress: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    });

    return NextResponse.json({
      success: true,
      data: {
        count: generatedCards.length,
        cards: generatedCards,
        message: `Successfully generated ${generatedCards.length} blank bizcards`,
      },
    });
  } catch (error) {
    console.error("[admin/bizcard/generate] error", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "GENERATION_FAILED",
          message: "Failed to generate blank bizcards",
        },
      },
      { status: 500 }
    );
  }
}
