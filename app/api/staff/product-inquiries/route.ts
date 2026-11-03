import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { withStaffPortal, checkStaffPortalRateLimit } from "@/lib/auth/staff-portal-middleware";
import { getRequestId } from "@/lib/errors/http";
import {
  isProductInquiryStatus,
  serializeInquiryRecord,
} from "@/server/lib/product-inquiry";

export async function GET(req: NextRequest) {
  return withStaffPortal(async (context, request) => {
    const requestId = context.requestId || getRequestId(request.headers);
    try {
      await checkStaffPortalRateLimit("product-inquiry", request, requestId);

      const url = new URL(request.url);
      const status = url.searchParams.get("status");
      const q = url.searchParams.get("q")?.trim() || "";
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize") || 20)));
      const skip = (page - 1) * pageSize;

      const where: Record<string, unknown> = {};
      if (status && isProductInquiryStatus(status)) {
        where.status = status;
      }
      if (q) {
        where.OR = [
          { reference_number: { contains: q } },
          { title: { contains: q } },
          { name: { contains: q } },
          { email: { contains: q } },
          { contact: { contains: q } },
        ];
      }

      const [rows, total, pendingCount] = await Promise.all([
        prisma.productInquiry.findMany({
          where,
          orderBy: { created_at: "desc" },
          skip,
          take: pageSize,
        }),
        prisma.productInquiry.count({ where }),
        prisma.productInquiry.count({ where: { status: "pending" } }),
      ]);

      return NextResponse.json({
        success: true,
        data: {
          inquiries: rows.map(serializeInquiryRecord),
          pagination: {
            page,
            pageSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
          },
          pendingCount,
        },
        requestId,
      }) as NextResponse<{ requestId: string }>;
    } catch (error) {
      console.error("[staff/product-inquiries GET]", error);
      return NextResponse.json(
        { success: false, error: "Failed to load product inquiries.", requestId },
        { status: 500 },
      ) as NextResponse<{ requestId: string }>;
    }
  })(req);
}
