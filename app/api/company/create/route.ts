// /api/company/create/route.ts

import crypto from "crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, getUserAgent, resolveRequestSession } from "@/server/lib/auth";
import { validateCompanyCreateRequestInput } from "@/server/lib/validators";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { CompanyErrorCode, createCompanyError } from "@/lib/errors/company-errors";
import { actorUserIdFromSession,
  assertUserCompanyCreationEligible,
  ensureUniqueCompanySlug,
  logCompanyAudit,
} from "@/server/lib/company";
import { updateUserSubscriptionFlags } from "@/lib/auth/subscription-guards";
import { notifySuperadminsCompanyCreation } from "@/lib/services/superadmin-notifications.service";

function randomSecurityKey(): string {
  return crypto.randomBytes(32).toString("hex");
}

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  try {
    const rl = checkRateLimit("company-create", ip);
    if (!rl.allowed) {
      throw createCompanyError(
        CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
        "Too many company creation attempts. Please try again later.",
        429,
        requestId,
        { retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000) },
      );
    }

    const auth = await resolveRequestSession(request, { tryRefresh: true });
    if (!auth.session) {
      throw createCompanyError(
        CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
        "Authentication required.",
        401,
        requestId,
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      throw createCompanyError(CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION, "Invalid JSON body.", 400, requestId);
    }

    const validation = validateCompanyCreateRequestInput(body);
    if (!validation.valid) {
      throw createCompanyError(
        CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
        validation.errors[0] ?? "Validation failed.",
        400,
        requestId,
        { errors: validation.errors },
      );
    }

    const payload = validation.data;
    const userId = actorUserIdFromSession(auth);

    const inviteEmailsRaw = Array.isArray(body.invite_emails) ? body.invite_emails : [];
    const inviteEmails = inviteEmailsRaw
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(entry));
    const uniqueInviteEmails = [...new Set(inviteEmails)].slice(0, 50);

    const actor = await prisma.user.findUnique({
      where: { user_id: userId },
      select: {
        user_id: true,
        company_id: true,
        first_name: true,
        last_name: true,
        email: true,
      },
    });

    if (!actor) {
      throw createCompanyError(CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION, "User not found.", 404, requestId);
    }

    if (actor.company_id) {
      throw createCompanyError(
        CompanyErrorCode.EMPLOYEE_IN_ANOTHER_COMPANY,
        "You already belong to a company.",
        409,
        requestId,
      );
    }

    const { tier } = await assertUserCompanyCreationEligible(userId, requestId);

    const pending = await prisma.company.findFirst({
      where: { created_by: userId, status: "pending" },
      select: { company_id: true },
    });

    if (pending) {
      throw createCompanyError(
        CompanyErrorCode.COMPANY_PENDING_APPROVAL,
        "You already have a pending company application.",
        409,
        requestId,
        { pendingRequestId: pending.company_id.toString() },
      );
    }

    const nameInUse = await prisma.company.findFirst({
      where: { name: payload.company_name },
      select: { company_id: true },
    });

    if (nameInUse) {
      throw createCompanyError(
        CompanyErrorCode.COMPANY_ALREADY_EXISTS,
        "Company name already exists.",
        409,
        requestId,
      );
    }

    const slug = await ensureUniqueCompanySlug(payload.company_name);

    const created = await prisma.company.create({
      data: {
        name: payload.company_name,
        company_slug: slug,
        description: payload.description,
        logo_url: payload.logo_url,
        security_key: randomSecurityKey(),
        security_code: null,
        approval_required: true,
        company_theme: "default",
        settings: JSON.stringify({
          allow_employee_invites: false,
          ...(uniqueInviteEmails.length > 0
            ? { pending_invite_emails: uniqueInviteEmails }
            : {}),
        }),
        status: "pending",
        subscription_tier: tier,
        max_employees: null,
        current_employees: 0,
        created_by: userId,
        admin_id: userId,
      },
      select: {
        company_id: true,
        name: true,
        status: true,
        created_at: true,
      },
    });

    await prisma.companyEmployee.create({
      data: {
        company_id: created.company_id,
        user_id: userId,
        role: "admin",
        is_active: true,
        permissions: JSON.stringify({
          manage_employees: true,
          view_analytics: true,
          edit_company: true,
          manage_inquiries: true,
        }),
      },
    });

    await prisma.user.update({
      where: { user_id: userId },
      data: { company_id: created.company_id },
    });

    await updateUserSubscriptionFlags(userId);

    await prisma.userNotification.create({
      data: {
        id: randomId("notif"),
        user_id: userId,
        trigger_user_id: userId,
        event_type: "system_update",
        priority: "medium",
        title: "Company application submitted",
        message: `Your company "${created.name}" application is pending review.`,
        metadata: JSON.stringify({
          company_id: created.company_id.toString(),
          company_name: created.name,
          status: created.status,
          subscription_tier: tier,
        }),
        action_url: "/user/dashboard",
        action_text: "View status",
      },
    });

    await logCompanyAudit({
      companyId: created.company_id,
      userId,
      action: "COMPANY_APPLICATION_SUBMITTED",
      requestId,
      ipAddress: ip,
      userAgent,
      details: {
        company_name: created.name,
        subscription_tier: tier,
      },
    });

    // ── Notify superadmins (non-blocking) ──────────────────────────────────
    const requestingUserName =
      [actor.first_name, actor.last_name].filter(Boolean).join(" ").trim() || actor.email;
    void notifySuperadminsCompanyCreation({
      companyId: created.company_id.toString(),
      companyName: created.name,
      requestingUserId: Number(userId),
      requestingUserName,
    });

    return jsonSuccess(
      {
        company_id: created.company_id.toString(),
        company_name: created.name,
        status: created.status,
        subscription_tier: tier,
        message: "Your company application has been submitted for approval. You will be notified once approved.",
        estimated_response_time: "2-3 business days",
      },
      { requestId, responseTime: Date.now() - startedAt },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/company/create POST] Unexpected error", { requestId, error });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
