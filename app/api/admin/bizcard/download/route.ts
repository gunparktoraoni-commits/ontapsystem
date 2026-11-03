import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/middleware/roleAuth";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { prisma } from "@/server/lib/prisma";
import { buildBlankBizcardsWorkbook } from "@/lib/services/excelService";
import { logAdminAudit } from "@/lib/services/adminAuditService";

const prismaAny = prisma as any;

type StatusFilter = "all" | "claimed" | "unclaimed";

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ["super_admin", "dev"]);
  if (!auth.ok) return auth.response;

  const ip = getClientIp(request);
  const limiter = checkRateLimit("admin-bizcard-download", `${ip}:${auth.actor.userId.toString()}`);
  if (!limiter.allowed) {
    const retryAfter = Math.max(1, Math.ceil(limiter.retryAfterMs / 1000));
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many export requests. Please try again shortly.",
          retryAfter,
        },
      },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  try {
    const statusParam = (request.nextUrl.searchParams.get("status") || "all").toLowerCase();
    const status: StatusFilter =
      statusParam === "claimed" || statusParam === "unclaimed" ? statusParam : "all";

    const fromDateRaw = request.nextUrl.searchParams.get("from");
    const toDateRaw = request.nextUrl.searchParams.get("to");
    const fromDate = parseDate(fromDateRaw);
    const toDate = parseDate(toDateRaw);

    const where: Record<string, unknown> = {
      is_blank: true,
    };

    if (status === "claimed") {
      where.claimed_at = { not: null };
    } else if (status === "unclaimed") {
      where.claimed_at = null;
    }

    if (fromDate || toDate) {
      where.generated_at = {
        ...(fromDate ? { gte: fromDate } : {}),
        ...(toDate ? { lte: toDate } : {}),
      };
    }

    const blankCards = await prismaAny.bizcard.findMany({
      where,
      orderBy: { generated_at: "desc" },
      select: {
        bizcard_id: true,
        serial_id: true,
        qr_code_url: true,
        portfolio_url: true,
        generated_at: true,
        claimed_at: true,
        claimed_by_user_id: true,
      },
    });

    const claimedUserIds: bigint[] = Array.from(
      new Set(
        blankCards
          .map((row: { claimed_by_user_id?: bigint | null }) => row.claimed_by_user_id)
          .filter((value: bigint | null | undefined): value is bigint => typeof value === "bigint")
      )
    );

    const claimedUsers = claimedUserIds.length
      ? await prisma.user.findMany({
          where: {
            user_id: {
              in: claimedUserIds,
            },
          },
          select: {
            user_id: true,
            first_name: true,
            last_name: true,
            email: true,
          },
        })
      : [];

    const userMap = new Map(
      claimedUsers.map((user) => [
        user.user_id.toString(),
        {
          name: `${user.first_name} ${user.last_name}`.trim(),
          email: user.email,
        },
      ])
    );

    const workbookRows = blankCards.map((card: any) => {
      const owner = card.claimed_by_user_id
        ? userMap.get(card.claimed_by_user_id.toString())
        : null;

      return {
        id: card.bizcard_id.toString(),
        serialId: card.serial_id,
        qrCodeUrl: card.qr_code_url,
        portfolioUrl: card.portfolio_url,
        generatedAt: card.generated_at ?? null,
        claimedAt: card.claimed_at ?? null,
        claimedByName: owner?.name ?? null,
        claimedByEmail: owner?.email ?? null,
      };
    });

    const buffer = await buildBlankBizcardsWorkbook(workbookRows, {
      exportedBy: auth.actor.email,
      status,
      fromDate: fromDateRaw,
      toDate: toDateRaw,
    });

    await logAdminAudit({
      adminUserId: auth.actor.userId,
      adminEmail: auth.actor.email,
      action: "DOWNLOAD_BLANK_CARDS_EXCEL",
      details: {
        count: workbookRows.length,
        filters: { status, fromDate: fromDateRaw, toDate: toDateRaw },
      },
      ipAddress: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    });

    const payload = new Uint8Array(buffer);

    return new NextResponse(payload, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="blank_bizcards_${new Date()
          .toISOString()
          .slice(0, 10)}.xlsx"`,
        "Content-Length": String(payload.byteLength),
      },
    });
  } catch (error) {
    console.error("[admin/bizcard/download] error", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "DOWNLOAD_FAILED",
          message: "Failed to generate Excel file",
        },
      },
      { status: 500 }
    );
  }
}
