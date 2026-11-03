// app/api/superadmin/bizcard/generate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkSuperadminRateLimit } from "@/lib/bizcard/security";
import { SerialIdService } from "@/lib/services/serialIdService";
import { logAdminAudit } from "@/lib/services/adminAuditService";
import { enqueueQRGeneration, initializeQRQueue } from "@/lib/services/qr-code.queue";
import { buildPortfolioSerialUrl } from "@/lib/bizcard/scan-routing";
import { withSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { SuperAdminErrorCode, toSuperAdminErrorResponse } from "@/lib/errors/superadmin-errors";
import { parseBizcardSubscriptionTier } from "@/lib/bizcard/tiers";

let qrQueueInitialized = false;

function ensureQRQueueInitialized() {
  if (!qrQueueInitialized) {
    initializeQRQueue();
    qrQueueInitialized = true;
  }
}

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

export const POST = withSuperAdmin(async (request: NextRequest, context) => {
  const startTime = Date.now();
  const { requestId, user } = context;
  
  try {
    // Rate limiting
    const rateCheck = checkSuperadminRateLimit(request, "GENERATE");
    if (!rateCheck.allowed) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
          `Too many generate requests. Please try again in ${rateCheck.retryAfter} seconds.`,
          requestId,
          { endpoint: "GENERATE", retryAfter: rateCheck.retryAfter },
          Date.now() - startTime
        ),
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter) } }
      );
    }
    
    // Parse request body
    let body: { count?: number; subscription_tier?: unknown; subscriptionTier?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.BIZCARD_INVALID_DATA,
          "Invalid JSON body. Provide { count: number, subscription_tier?: string }.",
          requestId,
          undefined,
          Date.now() - startTime
        ),
        { status: 400 }
      );
    }
    
    const count = body.count;
    const tierInput = body.subscription_tier ?? body.subscriptionTier;
    const subscriptionTier = parseBizcardSubscriptionTier(tierInput);
    if (subscriptionTier === null) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.BIZCARD_INVALID_DATA,
          "subscription_tier must be one of: basic, standard, premium.",
          requestId,
          { subscription_tier: tierInput },
          Date.now() - startTime
        ),
        { status: 400 }
      );
    }
    
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 10000) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.BIZCARD_INVALID_DATA,
          "count must be an integer between 1 and 10000.",
          requestId,
          { count },
          Date.now() - startTime
        ),
        { status: 400 }
      );
    }
    
    // Initialize QR queue
    ensureQRQueueInitialized();
    
    // Generate unique serial IDs
    const serialIdService = SerialIdService.getInstance();
    const serialIds = await serialIdService.generateBatchSerialIds(count);
    
    // Create blank bizcards
    const createdCards: Array<{
      id: bigint;
      serialId: string;
      qrCodeUrl: string | null;
      portfolioUrl: string | null;
      bizcard_style: string;
      subscriptionTier: string;
    }> = [];
    
    const userId = BigInt(user.id);
    
    for (const serialId of serialIds) {
      const portfolioUrl = buildPortfolioSerialUrl(serialId);
      
      const card = await prisma.bizcard.create({
        data: {
          serial_id: serialId,
          bizcard_name: `Blank Card ${serialId}`,
          first_name: "Blank",
          last_name: "Card",
          email: `blank+${serialId}@temp.ontap.ph`,
          contact_number: "00000000000",
          city: "System",
          bizcard_type: "physical",
          bizcard_style: "polyvinyl",
          is_blank: true,
          deactivated_flag: false,
          portfolio_url: portfolioUrl,
          generated_by_user_id: userId,
          generated_at: new Date(),
          created_at: new Date(),
          subscription_tier: subscriptionTier,
        },
        select: {
          bizcard_id: true,
          serial_id: true,
          qr_code_url: true,
          portfolio_url: true,
          bizcard_style: true,
          subscription_tier: true,
        },
      });
      
      createdCards.push({
        id: card.bizcard_id,
        serialId: card.serial_id ?? "",
        qrCodeUrl: card.qr_code_url,
        portfolioUrl: card.portfolio_url ?? portfolioUrl,
        bizcard_style: card.bizcard_style,
        subscriptionTier: card.subscription_tier ?? subscriptionTier,
      });
      
      // Enqueue QR generation
      try {
        enqueueQRGeneration(card.bizcard_id);
      } catch (qrErr) {
        console.warn(`[bizcard/generate] QR generation enqueue failed for ${serialId}:`, qrErr);
      }
    }
    
    // Log audit
    await logAdminAudit({
      adminUserId: userId,
      adminEmail: user.email,
      action: "GENERATE_BLANK_BIZCARDS",
      details: {
        count,
        subscription_tier: subscriptionTier,
        serialIds: createdCards.map(c => c.serialId),
        generatedBy: user.id,
      },
      ipAddress: request.headers.get("x-forwarded-for") ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    
    const responseTime = Date.now() - startTime;
    
    return NextResponse.json(
      {
        success: true,
        data: {
          count: createdCards.length,
          cards: serialize(createdCards),
        },
        meta: {
          requestId,
          responseTime,
          timestamp: new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[superadmin/bizcard/generate] Unhandled error:", error);
    return NextResponse.json(
      toSuperAdminErrorResponse(
        SuperAdminErrorCode.BIZCARD_CREATION_FAILED,
        "Failed to generate blank bizcards.",
        requestId,
        undefined,
        Date.now() - startTime
      ),
      { status: 500 }
    );
  }
}, { errorMode: "superadmin" });