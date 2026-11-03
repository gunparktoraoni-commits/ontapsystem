import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  isProductInquiryStatus,
  serializeInquiryRecord,
} from "@/server/lib/product-inquiry";

function requireOpsSession(request: NextRequest) {
  return resolveRequestSession(request).then((result) => {
    if (!result.session) {
      return {
        ok: false as const,
        response: NextResponse.json(
          { success: false, error: "Authentication required." },
          { status: 401 },
        ),
      };
    }
    const role = String(result.session.role ?? "").trim().toLowerCase();
    if (!["super_admin", "superadmin", "admin", "staff", "dev"].includes(role)) {
      return {
        ok: false as const,
        response: NextResponse.json(
          { success: false, error: "Insufficient permissions." },
          { status: 403 },
        ),
      };
    }
    return { ok: true as const, session: result.session };
  });
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rate = checkRateLimit("product-inquiry", ip);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many requests." },
      { status: 429 },
    );
  }

  const auth = await requireOpsSession(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const q = url.searchParams.get("q")?.trim() || "";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize") || 20)));
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {};
  if (status && isProductInquiryStatus(status)) where.status = status;
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
  });
}
