import crypto from "crypto";
import { prisma } from "@/server/lib/prisma";
import { syncMemberBizcardsToCompany } from "@/server/lib/company";
import { notifyCompanyAdmins } from "@/server/lib/company-notifications";
import { EmailService } from "@/lib/services/emailService";
import { resolveAppBaseUrl, type RequestLike } from "@/lib/utils/app-base-url";

const INVITE_TOKEN_BYTES = 32;
const INVITE_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

const SYSTEM_ROLES = new Set(["admin", "manager", "employee", "viewer"]);
const MAX_INVITE_ROLE_LENGTH = 20;
const CUSTOM_ROLE_PATTERN = /^[a-z0-9]+(?:[ _-][a-z0-9]+)*$/i;

const ROLE_PERMISSIONS: Record<string, Record<string, boolean>> = {
  admin: {
    manage_employees: true,
    view_analytics: true,
    edit_company: true,
    manage_inquiries: true,
  },
  manager: {
    manage_employees: false,
    view_analytics: true,
    edit_company: false,
    manage_inquiries: true,
  },
  employee: {
    manage_employees: false,
    view_analytics: false,
    edit_company: false,
    manage_inquiries: false,
  },
  viewer: {
    manage_employees: false,
    view_analytics: false,
    edit_company: false,
    manage_inquiries: false,
  },
};

/** System roles plus optional custom labels (stored on CompanyEmployee.role, max 20 chars). */
export type CompanyInviteRole = string;

export type CreateInvitationResult =
  | {
      ok: true;
      invitationId: string;
      plainToken: string;
      email: string;
      userId: string | null;
      expiresAt: Date;
      emailAlreadySent?: boolean;
    }
  | {
      ok: false;
      reason:
        | "already_connected"
        | "already_invited"
        | "invalid"
        | "failed";
      message: string;
    };

export type SendInvitationEmailResult = {
  emailSent: boolean;
  acceptUrl?: string;
  reason?: string;
};

export type ResendInvitationResult =
  | {
      ok: true;
      invitationId: string;
      email: string;
      emailSent: boolean;
      expiresAt: Date;
      message: string;
    }
  | {
      ok: false;
      reason:
        | "not_found"
        | "already_accepted"
        | "already_connected"
        | "invalid"
        | "failed"
        | "email_failed"
        | "cooldown";
      message: string;
      retryAfterSeconds?: number;
    };

export type AcceptInvitationResult =
  | {
      ok: true;
      companyId: string;
      role: CompanyInviteRole;
      redirectPath: string;
    }
  | {
      ok: false;
      reason:
        | "not_found"
        | "expired"
        | "already_accepted"
        | "declined"
        | "email_mismatch"
        | "already_in_company"
        | "other_company"
        | "limit_reached";
      message: string;
    };

function hashInviteToken(plainToken: string): string {
  return crypto.createHash("sha256").update(plainToken).digest("hex");
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

export function sanitizeInviteRoleInput(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function isValidInviteRole(value: string | undefined): boolean {
  const role = sanitizeInviteRoleInput(value);
  if (!role) return false;
  if (SYSTEM_ROLES.has(role)) return true;
  return role.length <= MAX_INVITE_ROLE_LENGTH && CUSTOM_ROLE_PATTERN.test(role);
}

export function normalizeInviteRole(value: string | undefined): CompanyInviteRole {
  const role = sanitizeInviteRoleInput(value);
  if (!role) return "employee";
  if (SYSTEM_ROLES.has(role)) return role;
  if (role.length <= MAX_INVITE_ROLE_LENGTH && CUSTOM_ROLE_PATTERN.test(role)) {
    return role;
  }
  return "employee";
}

export function permissionsForInviteRole(role: CompanyInviteRole): string {
  const permissions = ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.employee;
  return JSON.stringify(permissions);
}

export function redirectPathForCompanyRole(role: CompanyInviteRole): string {
  if (role === "admin" || role === "manager") {
    return "/admin/dashboard";
  }
  return "/user/dashboard";
}

export async function createInvitation(params: {
  companyId: bigint;
  email: string;
  role?: string;
  invitedBy: bigint;
  request?: RequestLike;
}): Promise<CreateInvitationResult> {
  const email = normalizeEmail(params.email);
  const role = normalizeInviteRole(params.role);

  const company = await prisma.company.findUnique({
    where: { company_id: params.companyId },
    select: {
      company_id: true,
      max_employees: true,
      current_employees: true,
    },
  });

  if (!company) {
    return { ok: false, reason: "invalid", message: "Company not found." };
  }

  const existingMember = await prisma.companyEmployee.findFirst({
    where: {
      company_id: params.companyId,
      user: { email },
    },
    select: { employee_id: true },
  });

  if (existingMember) {
    return {
      ok: false,
      reason: "already_connected",
      message: "User is already a member of this company.",
    };
  }

  const existingPending = await prisma.companyEmployeeInvitation.findFirst({
    where: {
      company_id: params.companyId,
      email,
      status: "pending",
      expires_at: { gt: new Date() },
    },
    select: { invitation_id: true },
  });

  if (existingPending) {
    return {
      ok: false,
      reason: "already_invited",
      message: "A pending invitation already exists for this email.",
    };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { user_id: true, company_id: true },
  });

  if (user?.company_id && user.company_id !== params.companyId) {
    return {
      ok: false,
      reason: "invalid",
      message: "User already belongs to another company.",
    };
  }

  const expiredPending = await prisma.companyEmployeeInvitation.findFirst({
    where: {
      company_id: params.companyId,
      email,
      status: "pending",
      expires_at: { lte: new Date() },
    },
    orderBy: { created_at: "desc" },
    select: { invitation_id: true },
  });

  if (expiredPending) {
    const resent = await resendInvitation({
      companyId: params.companyId,
      invitationId: expiredPending.invitation_id,
      invitedBy: params.invitedBy,
      request: params.request,
    });

    if (!resent.ok) {
      return {
        ok: false,
        reason:
          resent.reason === "already_connected" ||
          resent.reason === "invalid" ||
          resent.reason === "failed"
            ? resent.reason
            : "invalid",
        message: resent.message,
      };
    }

    return {
      ok: true,
      invitationId: resent.invitationId,
      plainToken: "",
      email: resent.email,
      userId: user?.user_id?.toString() ?? null,
      expiresAt: resent.expiresAt,
      emailAlreadySent: resent.emailSent,
    };
  }

  const maxEmployees = company.max_employees ?? 0;
  const pendingCount = await prisma.companyEmployeeInvitation.count({
    where: {
      company_id: params.companyId,
      status: "pending",
      expires_at: { gt: new Date() },
    },
  });

  if (
    maxEmployees > 0 &&
    (company.current_employees ?? 0) + pendingCount >= maxEmployees
  ) {
    return {
      ok: false,
      reason: "failed",
      message: "Company employee limit reached.",
    };
  }

  const plainToken = crypto.randomBytes(INVITE_TOKEN_BYTES).toString("hex");
  const tokenHash = hashInviteToken(plainToken);
  const expiresAt = new Date(Date.now() + INVITE_TOKEN_EXPIRY_MS);

  const invitation = await prisma.companyEmployeeInvitation.create({
    data: {
      company_id: params.companyId,
      email,
      user_id: user?.user_id ?? null,
      role,
      token_hash: tokenHash,
      status: "pending",
      invited_by: params.invitedBy,
      expires_at: expiresAt,
    },
  });

  return {
    ok: true,
    invitationId: invitation.invitation_id.toString(),
    plainToken,
    email,
    userId: user?.user_id?.toString() ?? null,
    expiresAt,
  };
}

function formatInviteEmailFailure(reason?: string): string {
  if (!reason) {
    return "Invitation email could not be delivered.";
  }
  if (reason.startsWith("EMAIL_NOT_CONFIGURED")) {
    return "Email delivery is not configured on the server. Verify SMTP or Resend settings in production.";
  }
  return reason;
}

export async function sendInvitationEmail(params: {
  email: string;
  companyName: string;
  inviterName: string;
  plainToken: string;
  expiresAt: Date;
  request?: RequestLike;
}): Promise<SendInvitationEmailResult> {
  let baseUrl: string;
  try {
    baseUrl = resolveAppBaseUrl(params.request);
  } catch {
    return {
      emailSent: false,
      reason: "Application URL is not configured.",
    };
  }

  const acceptUrl = `${baseUrl}/company/accept-invite?token=${encodeURIComponent(params.plainToken)}`;

  const emailService = EmailService.getInstance();
  const result = await emailService.sendCompanyEmployeeInviteEmail({
    email: params.email,
    companyName: params.companyName,
    inviterName: params.inviterName,
    acceptUrl,
    expiresAt: params.expiresAt,
  });

  if (!result.success) {
    return {
      emailSent: false,
      acceptUrl,
      reason: formatInviteEmailFailure(result.error ?? "Email provider failed to send invite."),
    };
  }

  return { emailSent: true, acceptUrl };
}

export async function resendInvitation(params: {
  companyId: bigint;
  invitationId: bigint;
  invitedBy: bigint;
  request?: RequestLike;
}): Promise<ResendInvitationResult> {
  const invitation = await prisma.companyEmployeeInvitation.findFirst({
    where: {
      invitation_id: params.invitationId,
      company_id: params.companyId,
    },
    include: {
      company: { select: { name: true, status: true } },
    },
  });

  if (!invitation) {
    return {
      ok: false,
      reason: "not_found",
      message: "Invitation not found.",
    };
  }

  if (invitation.status === "accepted") {
    return {
      ok: false,
      reason: "already_accepted",
      message: "This invitation has already been accepted.",
    };
  }

  if (invitation.company.status !== "active") {
    return {
      ok: false,
      reason: "invalid",
      message: "This company is not currently active.",
    };
  }

  const existingMember = await prisma.companyEmployee.findFirst({
    where: {
      company_id: params.companyId,
      user: { email: invitation.email },
    },
    select: { employee_id: true },
  });

  if (existingMember) {
    await prisma.companyEmployeeInvitation.update({
      where: { invitation_id: invitation.invitation_id },
      data: { status: "accepted", accepted_at: new Date() },
    });
    return {
      ok: false,
      reason: "already_connected",
      message: "User is already a member of this company.",
    };
  }

  const user = await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { user_id: true, company_id: true },
  });

  if (user?.company_id && user.company_id !== params.companyId) {
    return {
      ok: false,
      reason: "invalid",
      message: "User already belongs to another company.",
    };
  }

  const plainToken = crypto.randomBytes(INVITE_TOKEN_BYTES).toString("hex");
  const tokenHash = hashInviteToken(plainToken);
  const expiresAt = new Date(Date.now() + INVITE_TOKEN_EXPIRY_MS);

  const inviter = await prisma.user.findUnique({
    where: { user_id: params.invitedBy },
    select: { first_name: true, last_name: true },
  });
  const inviterName =
    `${inviter?.first_name ?? ""} ${inviter?.last_name ?? ""}`.trim() ||
    "Your company admin";

  const emailResult = await sendInvitationEmail({
    email: invitation.email,
    companyName: invitation.company.name,
    inviterName,
    plainToken,
    expiresAt,
    request: params.request,
  });

  if (!emailResult.emailSent) {
    console.error("[company-employee-invite] Resend email failed", {
      invitationId: invitation.invitation_id.toString(),
      email: invitation.email,
      reason: emailResult.reason ?? "unknown",
    });
    return {
      ok: false,
      reason: "email_failed",
      message:
        emailResult.reason ??
        "Invitation was not resent because the email could not be delivered.",
    };
  }

  await prisma.companyEmployeeInvitation.update({
    where: { invitation_id: invitation.invitation_id },
    data: {
      token_hash: tokenHash,
      expires_at: expiresAt,
      status: "pending",
      invited_by: params.invitedBy,
      user_id: user?.user_id ?? invitation.user_id,
      accepted_at: null,
    },
  });

  const resolvedUserId = user?.user_id ?? invitation.user_id;
  if (resolvedUserId) {
    await prisma.userNotification.create({
      data: {
        id: randomId("notif"),
        user_id: resolvedUserId,
        trigger_user_id: params.invitedBy,
        event_type: "system_update",
        priority: "medium",
        title: "Company invitation resent",
        message: `${inviterName} resent your invitation to join ${invitation.company.name}.`,
        metadata: JSON.stringify({
          companyId: params.companyId.toString(),
          invitationId: invitation.invitation_id.toString(),
        }),
        action_url: emailResult.acceptUrl ?? "/company/accept-invite",
        action_text: "Accept invitation",
      },
    });
  }

  return {
    ok: true,
    invitationId: invitation.invitation_id.toString(),
    email: invitation.email,
    emailSent: true,
    expiresAt,
    message: "Invitation resent successfully.",
  };
}

export async function cancelInvitation(params: {
  companyId: bigint;
  invitationId: bigint;
}): Promise<
  | { ok: true; invitationId: string; email: string; message: string }
  | {
      ok: false;
      reason: "not_found" | "already_accepted" | "invalid";
      message: string;
    }
> {
  const invitation = await prisma.companyEmployeeInvitation.findFirst({
    where: {
      invitation_id: params.invitationId,
      company_id: params.companyId,
    },
    select: {
      invitation_id: true,
      email: true,
      status: true,
    },
  });

  if (!invitation) {
    return {
      ok: false,
      reason: "not_found",
      message: "Invitation not found.",
    };
  }

  if (invitation.status === "accepted") {
    return {
      ok: false,
      reason: "already_accepted",
      message: "This invitation has already been accepted.",
    };
  }

  if (invitation.status !== "pending") {
    return {
      ok: false,
      reason: "invalid",
      message: "Only pending invitations can be deleted.",
    };
  }

  await prisma.companyEmployeeInvitation.delete({
    where: { invitation_id: invitation.invitation_id },
  });

  return {
    ok: true,
    invitationId: invitation.invitation_id.toString(),
    email: invitation.email,
    message: "Invitation deleted successfully.",
  };
}

export async function listPendingInvitations(
  companyId: bigint,
  search?: string,
): Promise<
  Array<{
    invitation_id: string;
    email: string;
    role: string;
    user_id: string | null;
    name: string;
    invited_at: Date;
    expires_at: Date;
    is_expired: boolean;
  }>
> {
  const normalizedSearch = search?.trim().toLowerCase() ?? "";
  const now = new Date();
  const rows = await prisma.companyEmployeeInvitation.findMany({
    where: {
      company_id: companyId,
      status: "pending",
    },
    include: {
      user: {
        select: {
          user_id: true,
          first_name: true,
          last_name: true,
        },
      },
    },
    orderBy: { created_at: "desc" },
  });

  const filteredRows = normalizedSearch
    ? rows.filter((row) => row.email.toLowerCase().includes(normalizedSearch))
    : rows;

  return filteredRows.map((row) => {
    const fullName = row.user
      ? `${row.user.first_name} ${row.user.last_name}`.trim()
      : "";
    const name =
      fullName ||
      row.email.split("@")[0]?.replace(/[._-]+/g, " ") ||
      row.email;

    return {
      invitation_id: row.invitation_id.toString(),
      email: row.email,
      role: row.role,
      user_id: row.user_id?.toString() ?? null,
      name,
      invited_at: row.created_at,
      expires_at: row.expires_at,
      is_expired: row.expires_at.getTime() <= now.getTime(),
    };
  });
}

export async function verifyInvitationToken(plainToken: string): Promise<
  | {
      valid: true;
      email: string;
      companyName: string;
      role: CompanyInviteRole;
      expiresAt: Date;
    }
  | { valid: false; reason: string }
> {
  const tokenHash = hashInviteToken(plainToken.trim());
  const invitation = await prisma.companyEmployeeInvitation.findUnique({
    where: { token_hash: tokenHash },
    include: {
      company: { select: { name: true, status: true } },
    },
  });

  if (!invitation) {
    return { valid: false, reason: "Invitation not found or invalid." };
  }

  if (invitation.status === "accepted") {
    return { valid: false, reason: "This invitation has already been accepted." };
  }

  if (invitation.status === "declined") {
    return { valid: false, reason: "This invitation was declined." };
  }

  if (invitation.expires_at.getTime() < Date.now()) {
    return { valid: false, reason: "This invitation has expired." };
  }

  if (invitation.company.status !== "active") {
    return { valid: false, reason: "This company is not currently active." };
  }

  return {
    valid: true,
    email: invitation.email,
    companyName: invitation.company.name,
    role: normalizeInviteRole(invitation.role),
    expiresAt: invitation.expires_at,
  };
}

export async function acceptInvitation(params: {
  plainToken: string;
  sessionUserId: bigint;
}): Promise<AcceptInvitationResult> {
  const tokenHash = hashInviteToken(params.plainToken.trim());

  const invitation = await prisma.companyEmployeeInvitation.findUnique({
    where: { token_hash: tokenHash },
    include: {
      company: {
        select: {
          company_id: true,
          name: true,
          status: true,
          max_employees: true,
          current_employees: true,
        },
      },
    },
  });

  if (!invitation) {
    return { ok: false, reason: "not_found", message: "Invitation not found." };
  }

  if (invitation.status === "accepted") {
    return {
      ok: false,
      reason: "already_accepted",
      message: "This invitation has already been accepted.",
    };
  }

  if (invitation.status === "declined") {
    return {
      ok: false,
      reason: "declined",
      message: "This invitation was declined.",
    };
  }

  if (invitation.expires_at.getTime() < Date.now()) {
    return {
      ok: false,
      reason: "expired",
      message: "This invitation has expired.",
    };
  }

  if (invitation.company.status !== "active") {
    return {
      ok: false,
      reason: "not_found",
      message: "This company is not currently active.",
    };
  }

  const user = await prisma.user.findUnique({
    where: { user_id: params.sessionUserId },
    select: { user_id: true, email: true, company_id: true },
  });

  if (!user) {
    return { ok: false, reason: "not_found", message: "User not found." };
  }

  if (normalizeEmail(user.email) !== normalizeEmail(invitation.email)) {
    return {
      ok: false,
      reason: "email_mismatch",
      message: "Please sign in with the email address that received this invitation.",
    };
  }

  const role = normalizeInviteRole(invitation.role);
  const redirectPath = redirectPathForCompanyRole(role);
  const now = new Date();

  // Idempotent: already a member — close the pending invite and succeed.
  if (user.company_id === invitation.company_id) {
    if (invitation.status === "pending") {
      await prisma.companyEmployeeInvitation.update({
        where: { invitation_id: invitation.invitation_id },
        data: {
          status: "accepted",
          accepted_at: invitation.accepted_at ?? now,
          user_id: user.user_id,
        },
      });
    }

    return {
      ok: true,
      companyId: invitation.company_id.toString(),
      role,
      redirectPath,
    };
  }

  if (user.company_id) {
    return {
      ok: false,
      reason: "other_company",
      message: "You already belong to another company.",
    };
  }

  const maxEmployees = invitation.company.max_employees ?? 0;
  if (
    maxEmployees > 0 &&
    (invitation.company.current_employees ?? 0) >= maxEmployees
  ) {
    return {
      ok: false,
      reason: "limit_reached",
      message: "This company has reached its employee limit.",
    };
  }

  const permissions = permissionsForInviteRole(role);
  const memberUser = await prisma.user.findUnique({
    where: { user_id: user.user_id },
    select: { first_name: true, last_name: true, email: true },
  });
  const memberDisplayName =
    `${memberUser?.first_name ?? ""} ${memberUser?.last_name ?? ""}`.trim() ||
    memberUser?.email ||
    invitation.email;

  await prisma.$transaction(async (tx) => {
    await tx.companyEmployeeInvitation.update({
      where: { invitation_id: invitation.invitation_id },
      data: {
        status: "accepted",
        accepted_at: now,
        user_id: user.user_id,
      },
    });

    const existingEmployee = await tx.companyEmployee.findFirst({
      where: {
        company_id: invitation.company_id,
        user_id: user.user_id,
      },
      select: { employee_id: true },
    });

    if (!existingEmployee) {
      await tx.companyEmployee.create({
        data: {
          company_id: invitation.company_id,
          user_id: user.user_id,
          role,
          permissions,
        },
      });

      await tx.company.update({
        where: { company_id: invitation.company_id },
        data: { current_employees: { increment: 1 } },
      });
    }

    const portalRole =
      role === "admin" || role === "manager" ? "company_admin" : "user";

    await tx.user.update({
      where: { user_id: user.user_id },
      data: {
        company_id: invitation.company_id,
        role: portalRole,
      },
    });

    await syncMemberBizcardsToCompany(tx, user.user_id, invitation.company_id);
  });

  await prisma.userNotification.create({
    data: {
      id: randomId("notif"),
      user_id: user.user_id,
      event_type: "system_update",
      priority: "medium",
      title: "Welcome to the team",
      message: `You have joined ${invitation.company.name}.`,
      metadata: JSON.stringify({
        companyId: invitation.company_id.toString(),
        role,
      }),
      action_url: redirectPath,
      action_text: "Open dashboard",
    },
  });

  try {
    await notifyCompanyAdmins(invitation.company_id, "employee_management_enabled", {
      triggerUserId: user.user_id,
      title: "Employee joined",
      message: `${memberDisplayName} accepted their invitation and joined ${invitation.company.name}.`,
      metadata: {
        company_id: invitation.company_id.toString(),
        invitation_id: invitation.invitation_id.toString(),
        employee_user_id: user.user_id.toString(),
        role,
      },
      actionUrl: "/admin/employee-list",
      actionText: "View employees",
    });
  } catch (error) {
    console.error("[acceptInvitation] Failed to notify company admins:", error);
  }

  // Notify the inviter when they are not the joining user (covers managers who invite).
  if (invitation.invited_by && invitation.invited_by !== user.user_id) {
    const inviterIsCompanyAdmin = await prisma.companyEmployee.findFirst({
      where: {
        company_id: invitation.company_id,
        user_id: invitation.invited_by,
        is_active: true,
        role: "admin",
      },
      select: { employee_id: true },
    });
    const company = await prisma.company.findUnique({
      where: { company_id: invitation.company_id },
      select: { admin_id: true, created_by: true },
    });
    const isPrimaryAdmin =
      company?.admin_id === invitation.invited_by ||
      company?.created_by === invitation.invited_by;

    if (!inviterIsCompanyAdmin && !isPrimaryAdmin) {
      try {
        await prisma.userNotification.create({
          data: {
            id: randomId("notif"),
            user_id: invitation.invited_by,
            trigger_user_id: user.user_id,
            event_type: "system_update",
            priority: "medium",
            title: "Invitation accepted",
            message: `${memberDisplayName} accepted your invitation to join ${invitation.company.name}.`,
            metadata: JSON.stringify({
              companyId: invitation.company_id.toString(),
              invitationId: invitation.invitation_id.toString(),
              employeeUserId: user.user_id.toString(),
            }),
            action_url: "/admin/employee-list",
            action_text: "View employees",
          },
        });
      } catch (error) {
        console.error("[acceptInvitation] Failed to notify inviter:", error);
      }
    }
  }

  try {
    let dashboardUrl = redirectPath;
    try {
      const baseUrl = resolveAppBaseUrl();
      dashboardUrl = `${baseUrl}${redirectPath}`;
    } catch {
      // Fall back to relative path text if app URL is not configured.
    }

    const emailService = EmailService.getInstance();
    const emailResult = await emailService.sendCompanyJoinConfirmationEmail({
      email: user.email,
      companyName: invitation.company.name,
      dashboardUrl,
    });
    if (!emailResult.success) {
      console.error("[acceptInvitation] Join confirmation email failed:", emailResult.error);
    }
  } catch (error) {
    console.error("[acceptInvitation] Join confirmation email threw:", error);
  }

  return {
    ok: true,
    companyId: invitation.company_id.toString(),
    role,
    redirectPath,
  };
}

export async function processDeferredCompanyInvites(params: {
  companyId: bigint;
  invitedBy: bigint;
  emails: string[];
  request?: RequestLike;
}): Promise<void> {
  const company = await prisma.company.findUnique({
    where: { company_id: params.companyId },
    select: { name: true },
  });
  if (!company) return;

  const inviter = await prisma.user.findUnique({
    where: { user_id: params.invitedBy },
    select: { first_name: true, last_name: true },
  });
  const inviterName =
    `${inviter?.first_name ?? ""} ${inviter?.last_name ?? ""}`.trim() ||
    "Your company admin";

  for (const rawEmail of params.emails) {
    const created = await createInvitation({
      companyId: params.companyId,
      email: rawEmail,
      invitedBy: params.invitedBy,
      request: params.request,
    });

    if (!created.ok) continue;

    const emailResult = await sendInvitationEmail({
      email: created.email,
      companyName: company.name,
      inviterName,
      plainToken: created.plainToken,
      expiresAt: created.expiresAt,
      request: params.request,
    });

    if (created.userId) {
      await prisma.userNotification.create({
        data: {
          id: randomId("notif"),
          user_id: BigInt(created.userId),
          trigger_user_id: params.invitedBy,
          event_type: "system_update",
          priority: "medium",
          title: "You were invited to join a company",
          message: `${inviterName} invited you to join ${company.name}.`,
          metadata: JSON.stringify({
            companyId: params.companyId.toString(),
            invitationId: created.invitationId,
          }),
          action_url: emailResult.acceptUrl ?? "/company/accept-invite",
          action_text: "Accept invitation",
        },
      });
    }
  }
}
