import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { withStaffPortal, checkStaffPortalRateLimit } from "@/lib/auth/staff-portal-middleware";
import { getRequestId } from "@/lib/errors/http";
import {
  isProductInquiryStatus,
  serializeInquiryRecord,
} from "@/server/lib/product-inquiry";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
  return withStaffPortal(async (portalCtx, request) => {
    const requestId = portalCtx.requestId || getRequestId(request.headers);
    try {
      await checkStaffPortalRateLimit("product-inquiry", request, requestId);
      const { id } = await context.params;
      const inquiryId = BigInt(id);

      const row = await prisma.productInquiry.findUnique({ where: { id: inquiryId } });
      if (!row) {
        return NextResponse.json(
          { success: false, error: "Inquiry not found.", requestId },
          { status: 404 },
        ) as NextResponse<{ requestId: string }>;
      }

      // First open marks pending → read
      if (row.status === "pending" && !row.read_at) {
        const updated = await prisma.productInquiry.update({
          where: { id: inquiryId },
          data: {
            status: "read",
            read_at: new Date(),
            assigned_to: portalCtx.staffId ?? row.assigned_to,
          },
        });
        return NextResponse.json({
          success: true,
          data: serializeInquiryRecord(updated),
          requestId,
        }) as NextResponse<{ requestId: string }>;
      }

      return NextResponse.json({
        success: true,
        data: serializeInquiryRecord(row),
        requestId,
      }) as NextResponse<{ requestId: string }>;
    } catch (error) {
      console.error("[staff/product-inquiries/[id] GET]", error);
      return NextResponse.json(
        { success: false, error: "Failed to load inquiry.", requestId },
        { status: 500 },
      ) as NextResponse<{ requestId: string }>;
    }
  })(req);
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  return withStaffPortal(async (portalCtx, request) => {
    const requestId = portalCtx.requestId || getRequestId(request.headers);
    try {
      await checkStaffPortalRateLimit("product-inquiry", request, requestId);
      const { id } = await context.params;
      const inquiryId = BigInt(id);

      const body = (await request.json().catch(() => ({}))) as {
        status?: string;
        staffNotes?: string | null;
        assignToSelf?: boolean;
      };

      const existing = await prisma.productInquiry.findUnique({ where: { id: inquiryId } });
      if (!existing) {
        return NextResponse.json(
          { success: false, error: "Inquiry not found.", requestId },
          { status: 404 },
        ) as NextResponse<{ requestId: string }>;
      }

      const data: {
        status?: string;
        staff_notes?: string | null;
        assigned_to?: bigint | null;
        read_at?: Date | null;
        contacted_at?: Date | null;
      } = {};

      if (typeof body.status === "string") {
        if (!isProductInquiryStatus(body.status)) {
          return NextResponse.json(
            { success: false, error: "Invalid status.", requestId },
            { status: 400 },
          ) as NextResponse<{ requestId: string }>;
        }
        data.status = body.status;
        if (body.status === "read" && !existing.read_at) data.read_at = new Date();
        if (body.status === "contacted" && !existing.contacted_at) {
          data.contacted_at = new Date();
        }
      }

      if (body.staffNotes !== undefined) {
        data.staff_notes =
          body.staffNotes === null ? null : String(body.staffNotes).trim().slice(0, 4000);
      }

      if (body.assignToSelf) {
        data.assigned_to = portalCtx.staffId;
      }

      const updated = await prisma.productInquiry.update({
        where: { id: inquiryId },
        data,
      });

      return NextResponse.json({
        success: true,
        data: serializeInquiryRecord(updated),
        requestId,
      }) as NextResponse<{ requestId: string }>;
    } catch (error) {
      console.error("[staff/product-inquiries/[id] PATCH]", error);
      return NextResponse.json(
        { success: false, error: "Failed to update inquiry.", requestId },
        { status: 500 },
      ) as NextResponse<{ requestId: string }>;
    }
  })(req);
}
