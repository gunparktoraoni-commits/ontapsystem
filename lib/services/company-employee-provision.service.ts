/**
 * Company-admin manual employee account provisioning.
 *
 * Creates a real ONTAP User + Credential (bcrypt) + CompanyEmployee + placeholder Bizcard.
 * Does NOT replace the invitation flow — use createInvitation for Send Invites.
 *
 * Email verification: company admin is treated as a trusted provisioner, so
 * Credential.email_verified is set true so the employee can log in immediately.
 * must_change_password is always true so the admin-chosen password is temporary.
 *
 * Existing ONTAP users: rejected with guidance to use Send Invitation (no duplicates,
 * no password overwrite).
 */

import { prisma } from "@/server/lib/prisma";
import { hashPassword, validatePassword } from "@/server/lib/auth";
import { logCompanyAudit, syncMemberBizcardsToCompany } from "@/server/lib/company";
import { generateUniqueUrlAlias } from "@/lib/bizcard/url-generator";
import {
  isValidInviteRole,
  normalizeInviteRole,
  permissionsForInviteRole,
  type CompanyInviteRole,
} from "@/lib/services/company-employee-invite.service";

export type ProvisionEmployeeInput = {
  companyId: bigint;
  actorUserId: bigint;
  email: string;
  password: string;
  role?: string;
  firstName?: string;
  lastName?: string;
  requestId?: string;
  ipAddress?: string | null;
};

export type ProvisionEmployeeSuccess = {
  ok: true;
  employee_id: string;
  user_id: string;
  name: string;
  email: string;
  role: string;
  status: "Active";
  profile_image: string | null;
};

export type ProvisionEmployeeFailure = {
  ok: false;
  reason:
    | "invalid_email"
    | "invalid_password"
    | "invalid_role"
    | "already_connected"
    | "other_company"
    | "existing_user"
    | "pending_registration"
    | "limit_reached"
    | "company_not_found"
    | "failed";
  message: string;
  statusCode: number;
};

export type ProvisionEmployeeResult = ProvisionEmployeeSuccess | ProvisionEmployeeFailure;

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

function deriveNameParts(
  email: string,
  firstName?: string,
  lastName?: string,
): { firstName: string; lastName: string } {
  const local = email.split("@")[0] ?? "employee";
  const cleaned = local.replace(/[._+-]+/g, " ").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);

  const first =
    (firstName ?? "").trim() ||
    (parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) : "Employee");
  const last =
    (lastName ?? "").trim() ||
    (parts.length > 1
      ? parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ")
      : "User");

  return {
    firstName: first.slice(0, 100),
    lastName: last.slice(0, 100),
  };
}

function portalRoleForCompanyRole(role: CompanyInviteRole): string {
  return role === "admin" || role === "manager" ? "company_admin" : "user";
}

export async function provisionCompanyEmployee(
  params: ProvisionEmployeeInput,
): Promise<ProvisionEmployeeResult> {
  const email = normalizeEmail(params.email);

  if (!email || !isValidEmail(email)) {
    return {
      ok: false,
      reason: "invalid_email",
      message: "Please enter a valid email address.",
      statusCode: 400,
    };
  }

  if (!isValidInviteRole(params.role ?? "employee")) {
    return {
      ok: false,
      reason: "invalid_role",
      message:
        "Invalid role. Use admin, manager, employee, viewer, or a custom role (letters, numbers, spaces, hyphens; max 20 characters).",
      statusCode: 400,
    };
  }

  const role = normalizeInviteRole(params.role);
  const passwordValidation = validatePassword(params.password);
  if (!passwordValidation.valid) {
    return {
      ok: false,
      reason: "invalid_password",
      message: passwordValidation.errors[0] ?? "Password does not meet requirements.",
      statusCode: 400,
    };
  }

  const company = await prisma.company.findUnique({
    where: { company_id: params.companyId },
    select: {
      company_id: true,
      name: true,
      status: true,
      max_employees: true,
      current_employees: true,
      company_theme: true,
    },
  });

  if (!company) {
    return {
      ok: false,
      reason: "company_not_found",
      message: "Company not found.",
      statusCode: 404,
    };
  }

  if (company.status !== "active") {
    return {
      ok: false,
      reason: "failed",
      message: "This company is not currently active.",
      statusCode: 400,
    };
  }

  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: {
      user_id: true,
      company_id: true,
      first_name: true,
      last_name: true,
      email: true,
      profile_url: true,
    },
  });

  if (existingUser) {
    const alreadyMember = await prisma.companyEmployee.findFirst({
      where: {
        company_id: params.companyId,
        user_id: existingUser.user_id,
      },
      select: { employee_id: true },
    });

    if (alreadyMember) {
      return {
        ok: false,
        reason: "already_connected",
        message: "User is already a member of this company.",
        statusCode: 409,
      };
    }

    if (existingUser.company_id && existingUser.company_id !== params.companyId) {
      return {
        ok: false,
        reason: "other_company",
        message: "User already belongs to another company.",
        statusCode: 409,
      };
    }

    // v1: do not attach or overwrite passwords for existing accounts.
    return {
      ok: false,
      reason: "existing_user",
      message:
        "This email already has an ONTAP account. Use Send Invitation instead to add them to your company.",
      statusCode: 409,
    };
  }

  const pendingRegistration = await prisma.pendingRegistration.findUnique({
    where: { email },
    select: { email: true },
  });

  if (pendingRegistration) {
    return {
      ok: false,
      reason: "pending_registration",
      message:
        "This email has a pending registration. Ask the user to finish signup, or use Send Invitation.",
      statusCode: 409,
    };
  }

  const maxEmployees = company.max_employees ?? 0;
  const currentEmployees = company.current_employees ?? 0;
  if (maxEmployees > 0 && currentEmployees >= maxEmployees) {
    return {
      ok: false,
      reason: "limit_reached",
      message: "Company employee limit reached.",
      statusCode: 409,
    };
  }

  const { firstName, lastName } = deriveNameParts(
    email,
    params.firstName,
    params.lastName,
  );
  const passwordHash = await hashPassword(params.password);
  const permissions = permissionsForInviteRole(role);
  const portalRole = portalRoleForCompanyRole(role);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          role: portalRole,
          registration_type: "individual",
          first_name: firstName,
          last_name: lastName,
          email,
          company_id: params.companyId,
          is_active: true,
          credentials: {
            create: {
              password_hash: passwordHash,
              // Trusted company-admin provisioner: allow login without OTP.
              // Employee must change password on first login.
              email_verified: true,
              email_verified_at: new Date(),
              must_change_password: true,
            },
          },
          permissions: { create: {} },
        },
        select: {
          user_id: true,
          first_name: true,
          last_name: true,
          email: true,
          profile_url: true,
        },
      });

      const employee = await tx.companyEmployee.create({
        data: {
          company_id: params.companyId,
          user_id: user.user_id,
          role,
          permissions,
          is_active: true,
        },
        select: {
          employee_id: true,
          role: true,
        },
      });

      await tx.company.update({
        where: { company_id: params.companyId },
        data: { current_employees: { increment: 1 } },
      });

      // Cancel pending invites for this email so the list stays clean.
      await tx.companyEmployeeInvitation.updateMany({
        where: {
          company_id: params.companyId,
          email,
          status: "pending",
        },
        data: {
          status: "declined",
          user_id: user.user_id,
        },
      });

      return { user, employee };
    });

    // Placeholder Bizcard outside the main tx (url alias generation may query DB).
    try {
      const placeholderUrlAlias = await generateUniqueUrlAlias({
        requestedAlias: `user_${created.user.user_id.toString()}`,
        firstName,
        lastName,
        userId: created.user.user_id,
      });
      await prisma.bizcard.create({
        data: {
          user_id: created.user.user_id,
          company_id: params.companyId,
          bizcard_name: `${firstName} ${lastName}`.trim(),
          url_alias: placeholderUrlAlias,
          first_name: firstName,
          last_name: lastName,
          email,
          contact_number: "",
          city: "",
          bizcard_type: "virtual",
          bizcard_theme: company.company_theme ?? "default",
          is_blank: true,
          generated_by_user_id: created.user.user_id,
          claimed_by_user_id: null,
          generated_at: new Date(),
          created_at: new Date(),
          last_url_alias_changed_at: null,
        },
      });
      await prisma.$transaction(async (tx) => {
        await syncMemberBizcardsToCompany(tx, created.user.user_id, params.companyId);
      });
    } catch (placeholderError) {
      console.error("[company-employee-provision] Failed to create placeholder bizcard:", {
        userId: created.user.user_id.toString(),
        error: placeholderError,
      });
    }

    const displayName =
      `${created.user.first_name} ${created.user.last_name}`.trim() || email;

    await logCompanyAudit({
      companyId: params.companyId,
      userId: params.actorUserId,
      action: "employee.created",
      requestId: params.requestId,
      ipAddress: params.ipAddress,
      details: {
        employeeId: created.employee.employee_id.toString(),
        employeeUserId: created.user.user_id.toString(),
        email,
        role: created.employee.role,
        method: "manual_provision",
      },
    });

    return {
      ok: true,
      employee_id: created.employee.employee_id.toString(),
      user_id: created.user.user_id.toString(),
      name: displayName,
      email: created.user.email,
      role: created.employee.role,
      status: "Active",
      profile_image: created.user.profile_url ?? null,
    };
  } catch (error) {
    console.error("[company-employee-provision] Unexpected failure", {
      email,
      companyId: params.companyId.toString(),
      error,
    });
    return {
      ok: false,
      reason: "failed",
      message: "Failed to create employee account. Please try again.",
      statusCode: 500,
    };
  }
}
