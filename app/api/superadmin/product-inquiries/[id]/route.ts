import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { validateCsrfToken } from "@/lib/csrf";
import {
  isProductInquiryStatus,
  serializeInquiryRecord,
} from "@/server/lib/product-inquiry";

type RouteContext = { params: Promise<{ id: string }> };

async function requireOps(request: NextRequest) {
  const result = await resolveRequestSession(request);
  if (!result.session) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 }),
    };
  }
  const role = String(result.session.role ?? "").trim().toLowerCase();
  if (!["super_admin", "superadmin", "admin", "staff", "dev"].includes(role)) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Insufficient permissions." }, { status: 403 }),
    };
  }
  return { ok: true as const, session: result.session };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireOps(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const row = await prisma.productInquiry.findUnique({ where: { id: BigInt(id) } });
  if (!row) {
    return NextResponse.json({ success: false, error: "Inquiry not found." }, { status: 404 });
  }
  if (row.status === "pending" && !row.read_at) {
    const updated = await prisma.productInquiry.update({
      where: { id: row.id },
      data: {
        status: "read",
        read_at: new Date(),
        assigned_to: BigInt(auth.session.userId),
      },
    });
    return NextResponse.json({ success: true, data: serializeInquiryRecord(updated) });
  }
  return NextResponse.json({ success: true, data: serializeInquiryRecord(row) });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const ip = getClientIp(request);
  const rate = checkRateLimit("product-inquiry", ip);
  if (!rate.allowed) {
    return NextResponse.json({ success: false, error: "Too many requests." }, { status: 429 });
  }

  const auth = await requireOps(request);
  if (!auth.ok) return auth.response;

  const csrfValid = await validateCsrfToken(request);
  if (!csrfValid) {
    return NextResponse.json({ success: false, error: "CSRF validation failed." }, { status: 403 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    status?: string;
    staffNotes?: string | null;
    assignToSelf?: boolean;
  };

  const existing = await prisma.productInquiry.findUnique({ where: { id: BigInt(id) } });
  if (!existing) {
    return NextResponse.json({ success: false, error: "Inquiry not found." }, { status: 404 });
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
      return NextResponse.json({ success: false, error: "Invalid status." }, { status: 400 });
    }
    data.status = body.status;
    if (body.status === "read" && !existing.read_at) data.read_at = new Date();
    if (body.status === "contacted" && !existing.contacted_at) data.contacted_at = new Date();
  }
  if (body.staffNotes !== undefined) {
    data.staff_notes =
      body.staffNotes === null ? null : String(body.staffNotes).trim().slice(0, 4000);
  }
  if (body.assignToSelf) data.assigned_to = BigInt(auth.session.userId);

  const updated = await prisma.productInquiry.update({
    where: { id: existing.id },
    data,
  });

  return NextResponse.json({ success: true, data: serializeInquiryRecord(updated) });
}
