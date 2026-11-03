// app/api/superadmin/bizcard/[serialId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkSuperadminRateLimit } from "@/lib/bizcard/security";
import { isValidSerialId } from "@/lib/bizcard/generator";
import { isBizcardSubscriptionTier } from "@/lib/bizcard/tiers";
import { applySuperAdminSubscriptionOverride } from "@/server/lib/superadmin/user-bizcards";
import { withSuperAdmin, type SuperAdminContext } from "@/lib/auth/superadmin-middleware";
import { SuperAdminErrorCode, toSuperAdminErrorResponse } from "@/lib/errors/superadmin-errors";
import { buildVCardPublicUrl } from "@/server/lib/qr";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
export const GET = withSuperAdmin(
  async (
    request: NextRequest,
    context: { params: Promise<{ serialId: string }> } & SuperAdminContext
  ) => {
  const startTime = Date.now();
  const resolvedParams = await context.params;
  const { serialId } = resolvedParams;
  const { requestId } = context;
  
  try {
   
    const rateCheck = checkSuperadminRateLimit(request, "DETAIL");
    if (!rateCheck.allowed) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many requests.",
          requestId,
          { endpoint: "DETAIL", retryAfter: rateCheck.retryAfter },
          Date.now() - startTime
        ),
        { status: 429 }
      );
    }
    
    // Validate serial ID format
    if (!isValidSerialId(serialId)) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.BIZCARD_SERIAL_INVALID,
          "Invalid serial ID format.",
          requestId,
          { serialId },
          Date.now() - startTime
        ),
        { status: 400 }
      );
    }
    

    const card = await prisma.bizcard.findFirst({
      where: {
        serial_id: serialId,
        OR: [{ is_blank: true }, { is_merged: true }],
      },
      select: {
        bizcard_id: true,
        serial_id: true,
        is_blank: true,
        is_merged: true,
        merged_at: true,
        user_id: true,
        claimed_at: true,
        generated_at: true,
        generated_by_user_id: true,
        portfolio_url: true,
        qr_code_url: true,
        subscription_tier: true,
        created_at: true,
        url_alias: true,
        first_name: true,
        last_name: true,
        email: true,
        user: {
          select: {
            user_id: true,
            email: true,
            first_name: true,
            last_name: true,
            custom_uri: true,
          },
        },
        generatedByUser: {
          select: {
            user_id: true,
            email: true,
          },
        },
      },
    });

    if (!card) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.BIZCARD_NOT_FOUND,
          "Bizcard not found.",
          requestId,
          { serialId },
          Date.now() - startTime
        ),
        { status: 404 }
      );
    }

    const responseTime = Date.now() - startTime;
    const derivedStatus =
      card.is_merged || card.user_id ? "claimed" : "unclaimed";

    const ownerFirst = (card.user?.first_name ?? card.first_name ?? "").trim();
    const ownerLast = (card.user?.last_name ?? card.last_name ?? "").trim();
    const ownerName = [ownerFirst, ownerLast].filter(Boolean).join(" ").trim() || null;
    const ownerEmail = (card.user?.email ?? card.email ?? "").trim() || null;
    const alias =
      (card.url_alias ?? card.user?.custom_uri ?? "").trim() || null;
    const aliasPortfolioUrl = alias ? buildVCardPublicUrl(alias) : null;
    // Prefer public alias URL over blank serial resolver URL for Distributed display.
    const resolvedPortfolioUrl = aliasPortfolioUrl ?? card.portfolio_url;

    return NextResponse.json(
      {
        success: true,
        data: serialize({
          ...card,
          portfolio_url: resolvedPortfolioUrl,
          claimed_at: card.claimed_at ?? card.merged_at,
          status: derivedStatus,
          owner_name: ownerName,
          owner_email: ownerEmail,
        }),
        meta: {
          requestId,
          responseTime,
          timestamp: new Date().toISOString(),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[superadmin/bizcard] Unhandled error:", error);
    return NextResponse.json(
      toSuperAdminErrorResponse(
        SuperAdminErrorCode.BIZCARD_DETAIL_FAILED,
        "Failed to load blank bizcard details.",
        requestId,
        { serialId },
        Date.now() - startTime
      ),
      { status: 500 }
    );
  }
  },
  { errorMode: "superadmin" }
);

// DELETE /api/superadmin/bizcard/[serialId]
// Permanently removes a blank (unclaimed) bizcard from the system.
// Only blank cards that have NOT been claimed by a user may be deleted.
// Steps:
//   1. Validate serial ID format and super-admin auth (via withSuperAdmin wrapper).
//   2. Confirm the card exists and is blank + unclaimed.
//   3. Within a transaction, nullify any QRCodeScan references (nullable FK, no cascade)
//      then delete the bizcard record (BizcardMergeHistory, BizcardSubscription, etc.
//      already have onDelete: Cascade in the schema).
export const DELETE = withSuperAdmin(
  async (
    request: NextRequest,
    context: { params: Promise<{ serialId: string }> } & SuperAdminContext
  ) => {
    const startTime = Date.now();
    const resolvedParams = await context.params;
    const { serialId } = resolvedParams;
    const { requestId } = context;

    // Rate limiting — dedicated DELETE bucket (not shared with DETAIL hydration).
    const rateCheck = checkSuperadminRateLimit(request, "DELETE");
    if (!rateCheck.allowed) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many requests.",
          requestId,
          { endpoint: "DELETE", retryAfter: rateCheck.retryAfter },
          Date.now() - startTime
        ),
        { status: 429 }
      );
    }

    // Validate serial ID format
    if (!isValidSerialId(serialId)) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.BIZCARD_SERIAL_INVALID,
          "Invalid serial ID format.",
          requestId,
          { serialId },
          Date.now() - startTime
        ),
        { status: 400 }
      );
    }

    try {
      // Confirm the card exists and is a blank, unclaimed card
      const existing = await prisma.bizcard.findFirst({
        where: {
          serial_id: serialId,
          is_blank: true,
        },
        select: {
          bizcard_id: true,
          user_id: true,
          claimed_at: true,
        },
      });

      if (!existing) {
        return NextResponse.json(
          toSuperAdminErrorResponse(
            SuperAdminErrorCode.BIZCARD_NOT_FOUND,
            "Blank bizcard not found.",
            requestId,
            { serialId },
            Date.now() - startTime
          ),
          { status: 404 }
        );
      }

      // Prevent deletion of claimed cards — they belong to a user
      if (existing.user_id || existing.claimed_at) {
        return NextResponse.json(
          toSuperAdminErrorResponse(
            SuperAdminErrorCode.BIZCARD_ACCESS_DENIED,
            "Cannot delete a bizcard that has already been claimed by a user.",
            requestId,
            { serialId },
            Date.now() - startTime
          ),
          { status: 409 }
        );
      }

      const bizcardId = existing.bizcard_id;

      // Execute deletion in a transaction.
      // QRCodeScan.bizcard_id is nullable with no onDelete cascade, so we nullify
      // those references first before deleting the parent record.
      // All other child relations (BizcardMergeHistory, BizcardSubscription, etc.)
      // are already configured with onDelete: Cascade in the Prisma schema.
      await prisma.$transaction([
        prisma.qRCodeScan.updateMany({
          where: { bizcard_id: bizcardId },
          data: { bizcard_id: null },
        }),
        prisma.bizcard.delete({
          where: { bizcard_id: bizcardId },
        }),
      ]);

      return NextResponse.json(
        {
          success: true,
          data: { serialId, deleted: true },
          meta: {
            requestId,
            responseTime: Date.now() - startTime,
            timestamp: new Date().toISOString(),
          },
        },
        { status: 200 }
      );
    } catch (error) {
      console.error("[superadmin/bizcard] DELETE unhandled error:", error);
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.BIZCARD_DELETE_FAILED,
          "Failed to delete bizcard.",
          requestId,
          { serialId },
          Date.now() - startTime
        ),
        { status: 500 }
      );
    }
  },
  { errorMode: "superadmin" }
);

// PATCH /api/superadmin/bizcard/[serialId]
// Updates the subscription tier (and optionally portfolio URL) of a blank bizcard.
export const PATCH = withSuperAdmin(
  async (
    request: NextRequest,
    context: { params: Promise<{ serialId: string }> } & SuperAdminContext
  ) => {
    const startTime = Date.now();
    const resolvedParams = await context.params;
    const { serialId } = resolvedParams;
    const { requestId } = context;

    // Rate limiting — reuse the DETAIL bucket (same resource, low-frequency admin action)
    const rateCheck = checkSuperadminRateLimit(request, "DETAIL");
    if (!rateCheck.allowed) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many requests.",
          requestId,
          { endpoint: "PATCH", retryAfter: rateCheck.retryAfter },
          Date.now() - startTime
        ),
        { status: 429 }
      );
    }

    // Validate serial ID format
    if (!isValidSerialId(serialId)) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.BIZCARD_SERIAL_INVALID,
          "Invalid serial ID format.",
          requestId,
          { serialId },
          Date.now() - startTime
        ),
        { status: 400 }
      );
    }

    // Parse request body
    let body: Record<string, unknown> | null = null;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      // body parsing failed — fall through to validation below
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.BIZCARD_INVALID_DATA,
          "Request body must be a JSON object.",
          requestId,
          {},
          Date.now() - startTime
        ),
        { status: 400 }
      );
    }

    const updateData: { subscription_tier?: string } = {};

    // Validate subscription_tier if provided
    if (body.subscription_tier !== undefined) {
      const tierRaw = String(body.subscription_tier ?? "").trim().toLowerCase();
      if (!isBizcardSubscriptionTier(tierRaw)) {
        return NextResponse.json(
          toSuperAdminErrorResponse(
            SuperAdminErrorCode.BIZCARD_INVALID_DATA,
            "Invalid subscription tier. Must be one of: basic, standard, premium.",
            requestId,
            { provided: body.subscription_tier },
            Date.now() - startTime
          ),
          { status: 400 }
        );
      }
      updateData.subscription_tier = tierRaw;
    }

    // portfolio_url is derived from the user's URL alias; ignore it so the
    // BizCard management editor can keep sending it without blocking tier updates.

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.BIZCARD_INVALID_DATA,
          "No valid fields provided for update.",
          requestId,
          {},
          Date.now() - startTime
        ),
        { status: 400 }
      );
    }

    try {
      const existing = await prisma.bizcard.findFirst({
        where: {
          serial_id: serialId,
          OR: [{ is_blank: true }, { is_merged: true }],
        },
        select: { bizcard_id: true, user_id: true, is_blank: true },
      });

      if (!existing) {
        return NextResponse.json(
          toSuperAdminErrorResponse(
            SuperAdminErrorCode.BIZCARD_NOT_FOUND,
            "Bizcard not found.",
            requestId,
            { serialId },
            Date.now() - startTime
          ),
          { status: 404 }
        );
      }

      if (updateData.subscription_tier && existing.user_id) {
        await applySuperAdminSubscriptionOverride({
          bizcardId: existing.bizcard_id,
          userId: existing.user_id,
          tier: updateData.subscription_tier as "basic" | "standard" | "premium",
        });
      }

      const updated = await prisma.bizcard.update({
        where: { bizcard_id: existing.bizcard_id },
        data: existing.user_id ? { updated_at: new Date() } : updateData,
        select: {
          bizcard_id: true,
          serial_id: true,
          is_blank: true,
          user_id: true,
          claimed_at: true,
          generated_at: true,
          portfolio_url: true,
          qr_code_url: true,
          subscription_tier: true,
          created_at: true,
          user: {
            select: {
              user_id: true,
              email: true,
              first_name: true,
              last_name: true,
            },
          },
        },
      });

      return NextResponse.json(
        {
          success: true,
          data: serialize({
            ...updated,
            status: updated.user_id ? "claimed" : "unclaimed",
          }),
          meta: {
            requestId,
            responseTime: Date.now() - startTime,
            timestamp: new Date().toISOString(),
          },
        },
        { status: 200 }
      );
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_SUBSCRIPTION_TIER") {
        return NextResponse.json(
          toSuperAdminErrorResponse(
            SuperAdminErrorCode.BIZCARD_INVALID_DATA,
            "Invalid subscription tier. Must be one of: basic, standard, premium.",
            requestId,
            { serialId },
            Date.now() - startTime
          ),
          { status: 400 }
        );
      }
      console.error("[superadmin/bizcard] PATCH unhandled error:", error);
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.BIZCARD_UPDATE_FAILED,
          "Failed to update bizcard.",
          requestId,
          { serialId },
          Date.now() - startTime
        ),
        { status: 500 }
      );
    }
  },
  { errorMode: "superadmin" }
);