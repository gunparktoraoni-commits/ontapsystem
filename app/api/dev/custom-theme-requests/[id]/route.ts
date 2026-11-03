import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { validateCsrfToken } from "@/lib/csrf";
import {
  CUSTOM_THEME_PAYMENT_PENDING_STATUSES,
  customThemeRequestUserInclude,
  isCustomThemeDevVisibleStatus,
  serializeCustomThemeRequest,
} from "@/server/lib/custom-theme-request";
import { forwardPaidCustomThemeRequestToDev } from "@/server/lib/marketplace/custom-theme-request-payment";

type RouteContext = { params: Promise<{ id: string }> };

async function requireDevSession(request: NextRequest) {
  const result = await resolveRequestSession(request, { tryRefresh: true });
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
  if (!["dev", "super_admin", "superadmin"].includes(role)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: "Insufficient permissions." },
        { status: 403 },
      ),
    };
  }
  return { ok: true as const, session: result.session };
}

/**
 * GET /api/dev/custom-theme-requests/[id]
 * Full custom theme request detail (marks pending as reviewing on first open).
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const ip = getClientIp(request);
  const rate = checkRateLimit("dev-custom-theme-requests-detail", ip);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many requests." },
      { status: 429 },
    );
  }

  const auth = await requireDevSession(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json(
      { success: false, error: "Invalid request id." },
      { status: 400 },
    );
  }

  const row = await prisma.customThemeRequest.findUnique({
    where: { id: BigInt(id) },
    include: customThemeRequestUserInclude,
  });
  if (!row) {
    return NextResponse.json(
      { success: false, error: "Custom theme request not found." },
      { status: 404 },
    );
  }

  if (
    (CUSTOM_THEME_PAYMENT_PENDING_STATUSES as readonly string[]).includes(
      row.status,
    )
  ) {
    return NextResponse.json(
      {
        success: false,
        error: "This request is unpaid and has not been forwarded yet.",
      },
      { status: 404 },
    );
  }

  // Retry support escalation if payment succeeded but forwarding failed earlier.
  if (row.paid_at && !row.conversation_id) {
    await forwardPaidCustomThemeRequestToDev(row.id);
  }

  const current = await prisma.customThemeRequest.findUnique({
    where: { id: row.id },
    include: customThemeRequestUserInclude,
  });
  if (!current) {
    return NextResponse.json(
      { success: false, error: "Custom theme request not found." },
      { status: 404 },
    );
  }

  if (current.status === "pending" && !current.read_at) {
    const updated = await prisma.customThemeRequest.update({
      where: { id: current.id },
      data: {
        status: "reviewing",
        read_at: new Date(),
        assigned_to: BigInt(auth.session.userId),
      },
      include: customThemeRequestUserInclude,
    });
    return NextResponse.json({
      success: true,
      data: serializeCustomThemeRequest(updated),
    });
  }

  return NextResponse.json({
    success: true,
    data: serializeCustomThemeRequest(current),
  });
}

/**
 * PATCH /api/dev/custom-theme-requests/[id]
 * Update status / staff notes / assignment for a custom theme request.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const ip = getClientIp(request);
  const rate = checkRateLimit("dev-custom-theme-requests-update", ip);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many requests." },
      { status: 429 },
    );
  }

  const auth = await requireDevSession(request);
  if (!auth.ok) return auth.response;

  const csrfValid = await validateCsrfToken(request);
  if (!csrfValid) {
    return NextResponse.json(
      { success: false, error: "CSRF validation failed." },
      { status: 403 },
    );
  }

  const { id } = await context.params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json(
      { success: false, error: "Invalid request id." },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    status?: string;
    staffNotes?: string | null;
    assignToSelf?: boolean;
  };

  const existing = await prisma.customThemeRequest.findUnique({
    where: { id: BigInt(id) },
  });
  if (!existing) {
    return NextResponse.json(
      { success: false, error: "Custom theme request not found." },
      { status: 404 },
    );
  }

  if (
    (CUSTOM_THEME_PAYMENT_PENDING_STATUSES as readonly string[]).includes(
      existing.status,
    )
  ) {
    return NextResponse.json(
      {
        success: false,
        error: "This request is unpaid and cannot be updated yet.",
      },
      { status: 409 },
    );
  }

  const data: {
    status?: string;
    staff_notes?: string | null;
    assigned_to?: bigint | null;
    read_at?: Date | null;
  } = {};

  if (typeof body.status === "string") {
    if (!isCustomThemeDevVisibleStatus(body.status)) {
      return NextResponse.json(
        { success: false, error: "Invalid status." },
        { status: 400 },
      );
    }
    data.status = body.status;
    if (
      (body.status === "reviewing" || body.status === "quoted") &&
      !existing.read_at
    ) {
      data.read_at = new Date();
    }
  }

  if (body.staffNotes !== undefined) {
    data.staff_notes =
      body.staffNotes === null
        ? null
        : String(body.staffNotes).trim().slice(0, 4000);
  }

  if (body.assignToSelf) {
    data.assigned_to = BigInt(auth.session.userId);
  }

  const updated = await prisma.customThemeRequest.update({
    where: { id: existing.id },
    data,
    include: customThemeRequestUserInclude,
  });

  return NextResponse.json({
    success: true,
    data: serializeCustomThemeRequest(updated),
  });
}
