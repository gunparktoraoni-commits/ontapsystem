// app/api/superadmin/bizcard/download/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";
import { checkSuperadminRateLimit } from "@/lib/bizcard/security";
import { logAdminAudit } from "@/lib/services/adminAuditService";
import { withSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { SuperAdminErrorCode, toSuperAdminErrorResponse } from "@/lib/errors/superadmin-errors";
import { parseBizcardSubscriptionTier } from "@/lib/bizcard/tiers";

export const GET = withSuperAdmin(async (request: NextRequest, context) => {
  const startTime = Date.now();
  const { requestId, user } = context;
  
  try {
    // Rate limiting
    const rateCheck = checkSuperadminRateLimit(request, "DOWNLOAD");
    if (!rateCheck.allowed) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
          `Too many download requests. Please try again in ${rateCheck.retryAfter} seconds.`,
          requestId,
          { endpoint: "DOWNLOAD", retryAfter: rateCheck.retryAfter },
          Date.now() - startTime
        ),
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter) } }
      );
    }
    
    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "all";
    const tierParam = searchParams.get("tier") || "all";
    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");

    if (!["all", "claimed", "unclaimed"].includes(status)) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.BIZCARD_INVALID_DATA,
          "status must be one of: all, claimed, unclaimed.",
          requestId,
          { status },
          Date.now() - startTime
        ),
        { status: 400 }
      );
    }

    const normalizedTier =
      tierParam === "all" ? "all" : parseBizcardSubscriptionTier(tierParam, { defaultOnMissing: false });
    if (tierParam !== "all" && normalizedTier === null) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.BIZCARD_INVALID_DATA,
          "tier must be one of: all, basic, standard, premium.",
          requestId,
          { tier: tierParam },
          Date.now() - startTime
        ),
        { status: 400 }
      );
    }

    if (fromDate && Number.isNaN(new Date(fromDate).getTime())) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.BIZCARD_INVALID_DATA,
          "from must be a valid ISO date string.",
          requestId,
          { from: fromDate },
          Date.now() - startTime
        ),
        { status: 400 }
      );
    }

    if (toDate && Number.isNaN(new Date(toDate).getTime())) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.BIZCARD_INVALID_DATA,
          "to must be a valid ISO date string.",
          requestId,
          { to: toDate },
          Date.now() - startTime
        ),
        { status: 400 }
      );
    }
    
    // Inventory scope: blank physical stock OR merged claims (serial moved onto virtual card).
    const inventoryScope: Prisma.BizcardWhereInput = {
      deactivated_flag: false,
      OR: [
        { is_blank: true },
        { is_merged: true, serial_id: { not: null } },
      ],
    };

    const filters: Prisma.BizcardWhereInput[] = [inventoryScope];
    const generatedAtFilter: Prisma.DateTimeFilter = {};

    if (status === "claimed") {
      filters.push({
        OR: [{ is_merged: true }, { user_id: { not: null } }],
      });
    } else if (status === "unclaimed") {
      // Blank stock not yet registered (includes Assigned / pending registration).
      filters.push({
        is_blank: true,
        user_id: null,
        is_merged: false,
      });
    }

    if (normalizedTier !== "all") {
      filters.push({ subscription_tier: normalizedTier });
    }

    if (fromDate) {
      generatedAtFilter.gte = new Date(fromDate);
    }
    if (toDate) {
      generatedAtFilter.lte = new Date(toDate);
    }
    if (Object.keys(generatedAtFilter).length > 0) {
      filters.push({ generated_at: generatedAtFilter });
    }

    const where: Prisma.BizcardWhereInput =
      filters.length === 1 ? filters[0]! : { AND: filters };

    // Fetch cards — use prisma as any to access manually_distributed_at / is_merged
    // which were added via migrations (manual distribution + merge).
    const prismaAny = prisma as unknown as {
      bizcard: {
        findMany: (args: unknown) => Promise<Array<{
          bizcard_id: bigint;
          serial_id: string | null;
          subscription_tier: string | null;
          generated_at: Date | null;
          claimed_at: Date | null;
          merged_at: Date | null;
          is_merged: boolean | null;
          user_id: bigint | null;
          manually_distributed_at: Date | null;
          first_name: string | null;
          last_name: string | null;
          email: string | null;
          user: { email: string; first_name: string; last_name: string } | null;
          generatedByUser: { email: string } | null;
        }>>;
      };
    };

    const cards = await prismaAny.bizcard.findMany({
      where,
      orderBy: { generated_at: "desc" },
      select: {
        bizcard_id: true,
        serial_id: true,
        subscription_tier: true,
        generated_at: true,
        claimed_at: true,
        merged_at: true,
        is_merged: true,
        user_id: true,
        manually_distributed_at: true,
        first_name: true,
        last_name: true,
        email: true,
        user: {
          select: {
            email: true,
            first_name: true,
            last_name: true,
          },
        },
        generatedByUser: {
          select: {
            email: true,
          },
        },
      },
    });

    // Derive human-readable status:
    //   "Claimed"  — physical serial merged onto a user card, or user_id is set
    //   "Assigned" — SuperAdmin manually distributed but user hasn't registered yet
    //   "Unclaimed"— card is available (neither claimed nor manually distributed)
    function deriveCardStatus(card: {
      user_id: bigint | null;
      is_merged: boolean | null;
      manually_distributed_at: Date | null;
    }): string {
      if (card.is_merged === true || card.user_id !== null) return "Claimed";
      if (card.manually_distributed_at !== null) return "Assigned";
      return "Unclaimed";
    }

    // Generate CSV
    const csvRows: string[][] = [];
    csvRows.push([
      "Bizcard ID",
      "Serial ID",
      "Subscription Tier",
      "Generated At",
      "Status",
      "Claimed At",
      "Claimed By Email",
      "Claimed By Name",
      "Generated By",
      "Manually Distributed At",
    ]);

    for (const card of cards) {
      const claimedAt = card.claimed_at ?? card.merged_at;
      const ownerFirst = (card.user?.first_name ?? card.first_name ?? "").trim();
      const ownerLast = (card.user?.last_name ?? card.last_name ?? "").trim();
      const ownerName = [ownerFirst, ownerLast].filter(Boolean).join(" ");
      const ownerEmail = (card.user?.email ?? card.email ?? "").trim();
      csvRows.push([
        String(card.bizcard_id),
        card.serial_id ?? "",
        card.subscription_tier ?? "",
        card.generated_at?.toISOString() || "",
        deriveCardStatus(card),
        claimedAt?.toISOString() || "",
        ownerEmail,
        ownerName,
        card.generatedByUser?.email || "",
        card.manually_distributed_at?.toISOString() || "",
      ]);
    }
    
    const csvContent = csvRows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
    
    // Log audit
    await logAdminAudit({
      adminUserId: BigInt(user.id),
      adminEmail: user.email,
      action: "EXPORT_BLANK_BIZCARDS",
      details: {
        status,
        tier: tierParam,
        fromDate,
        toDate,
        totalCards: cards.length,
      },
      ipAddress: request.headers.get("x-forwarded-for") ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    
    const responseTime = Date.now() - startTime;
    
    // Return CSV file
    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="blank_bizcards_${new Date().toISOString().split("T")[0]}.csv"`,
        "X-Request-Id": requestId,
        "X-Response-Time": responseTime.toString(),
        "X-Response-Timestamp": new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[superadmin/bizcard/download] Unhandled error:", error);
    return NextResponse.json(
      toSuperAdminErrorResponse(
        SuperAdminErrorCode.BIZCARD_EXPORT_FAILED,
        "Failed to export blank bizcards.",
        requestId,
        undefined,
        Date.now() - startTime
      ),
      { status: 500 }
    );
  }
}, { errorMode: "superadmin" });