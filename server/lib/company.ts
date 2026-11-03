import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";
import type { SessionPayload, RequestSessionResult } from "@/server/lib/auth";
import { CompanyErrorCode, createCompanyError } from "@/lib/errors/company-errors";
import { createUpgradeRequiredError } from "@/lib/errors/subscription-errors";
import { isHitachiCompanyName } from "@/lib/constants/hitachi-companies";

const SLUG_MAX = 255;

export const COMPANY_CREATION_TIERS = ["standard", "premium", "enterprise"] as const;
export type CompanyCreationTier = (typeof COMPANY_CREATION_TIERS)[number];

const TIER_RANK: Record<CompanyCreationTier, number> = {
  standard: 1,
  premium: 2,
  enterprise: 3,
};

function normalizeCompanyCreationTier(raw: string | null | undefined): CompanyCreationTier | null {
  const lowered = (raw ?? "").trim().toLowerCase();
  if (lowered === "standard" || lowered === "premium" || lowered === "enterprise") {
    return lowered;
  }
  return null;
}

export async function getUserCompanyCreationEligibility(userId: bigint): Promise<{
  eligible: boolean;
  highestTier: CompanyCreationTier | null;
  qualifyingBizcardCount: number;
}> {
  const now = new Date();
  const bizcards = await prisma.bizcard.findMany({
    where: {
      user_id: userId,
      deactivated_flag: false,
      subscription_status: "active",
      subscription_expires_at: { gt: now },
    },
    select: { subscription_tier: true },
  });

  const qualifyingTiers = bizcards
    .map((card) => normalizeCompanyCreationTier(card.subscription_tier))
    .filter((tier): tier is CompanyCreationTier => tier !== null);

  if (!qualifyingTiers.length) {
    return { eligible: false, highestTier: null, qualifyingBizcardCount: 0 };
  }

  const highestTier = qualifyingTiers.sort((a, b) => TIER_RANK[b] - TIER_RANK[a])[0];

  return {
    eligible: true,
    highestTier,
    qualifyingBizcardCount: qualifyingTiers.length,
  };
}

export async function assertUserCompanyCreationEligible(
  userId: bigint,
  requestId: string,
): Promise<{ tier: CompanyCreationTier }> {
  const eligibility = await getUserCompanyCreationEligibility(userId);

  if (!eligibility.eligible || !eligibility.highestTier) {
    const error = createUpgradeRequiredError("company creation", "standard", "basic");
    throw createCompanyError(
      CompanyErrorCode.SUBSCRIPTION_REQUIRED,
      "Standard or Premium subscription required for company creation.",
      403,
      requestId,
      {
        error,
        redirect_url: "/user/emarket?tab=subscription&reason=company",
        required_tiers: COMPANY_CREATION_TIERS,
      },
    );
  }

  return { tier: eligibility.highestTier };
}

export const MAX_CO_ADMINS = 3;

export async function syncMemberBizcardsToCompany(
  tx: Prisma.TransactionClient,
  userId: bigint,
  companyId: bigint,
): Promise<void> {
  const company = await tx.company.findUnique({
    where: { company_id: companyId },
    select: { company_theme: true },
  });

  const companyTheme = company?.company_theme ?? "default";

  await tx.bizcard.updateMany({
    where: { user_id: userId },
    data: {
      company_id: companyId,
      bizcard_theme: companyTheme,
    },
  });
}

export async function syncAllMemberBizcardsToCompanyTheme(
  tx: Prisma.TransactionClient,
  companyId: bigint,
  companyTheme: string,
): Promise<number> {
  const company = await tx.company.findUnique({
    where: { company_id: companyId },
    select: { admin_id: true },
  });

  const [members, usersWithCompany] = await Promise.all([
    tx.companyEmployee.findMany({
      where: { company_id: companyId, is_active: true },
      select: { user_id: true },
    }),
    tx.user.findMany({
      where: { company_id: companyId },
      select: { user_id: true },
    }),
  ]);

  const userIds = new Set<bigint>();
  for (const member of members) userIds.add(member.user_id);
  for (const user of usersWithCompany) userIds.add(user.user_id);
  if (company?.admin_id) userIds.add(company.admin_id);

  if (userIds.size === 0) return 0;

  const result = await tx.bizcard.updateMany({
    where: {
      user_id: { in: Array.from(userIds) },
    },
    data: {
      bizcard_theme: companyTheme,
      company_id: companyId,
      updated_at: new Date(),
    },
  });

  return result.count;
}

export type CompanyRole = "admin" | "manager" | "employee" | "viewer";

export interface CompanyThemePolicy {
  managedByCompany: boolean;
  companyId: string | null;
  companyTheme: string | null;
  isHitachiCompany: boolean;
  isHitachiCompanyAdmin: boolean;
  /** Only the primary company admin may change the company-wide theme. */
  canChangeCompanyTheme: boolean;
  isPrimaryAdmin: boolean;
  myRole: CompanyRole | null;
  primaryAdminUserId: string | null;
  primaryAdminName: string | null;
  primaryAdminAvatarUrl: string | null;
}

export async function resolveCompanyThemePolicyForUser(userId: bigint): Promise<CompanyThemePolicy> {
  const emptyPolicy = (): CompanyThemePolicy => ({
    managedByCompany: false,
    companyId: null,
    companyTheme: null,
    isHitachiCompany: false,
    isHitachiCompanyAdmin: false,
    canChangeCompanyTheme: false,
    isPrimaryAdmin: false,
    myRole: null,
    primaryAdminUserId: null,
    primaryAdminName: null,
    primaryAdminAvatarUrl: null,
  });

  const user = await prisma.user.findUnique({
    where: { user_id: userId },
    select: { company_id: true },
  });

  let companyId = user?.company_id ?? null;

  if (!companyId) {
    const employment = await prisma.companyEmployee.findFirst({
      where: { user_id: userId, is_active: true },
      select: { company_id: true },
    });
    companyId = employment?.company_id ?? null;
  }

  if (!companyId) {
    const ownedCompany = await prisma.company.findFirst({
      where: { admin_id: userId },
      select: { company_id: true },
    });
    companyId = ownedCompany?.company_id ?? null;
  }

  if (!companyId) {
    return emptyPolicy();
  }

  const company = await prisma.company.findUnique({
    where: { company_id: companyId },
    select: { company_theme: true, name: true, admin_id: true, created_by: true },
  });

  const primaryAdminUserId = company?.admin_id ?? company?.created_by ?? null;
  const isPrimaryAdmin =
    primaryAdminUserId !== null && primaryAdminUserId === userId;

  let isCompanyAdmin = isPrimaryAdmin;
  let myRole: CompanyRole | null = isPrimaryAdmin ? "admin" : null;

  if (!isPrimaryAdmin) {
    const membership = await prisma.companyEmployee.findFirst({
      where: {
        company_id: companyId,
        user_id: userId,
        is_active: true,
      },
      select: { role: true },
    });
    if (membership?.role) {
      myRole = membership.role as CompanyRole;
      if (membership.role === "admin") isCompanyAdmin = true;
    }
  }

  let primaryAdminName: string | null = null;
  let primaryAdminAvatarUrl: string | null = null;
  if (primaryAdminUserId) {
    const primaryAdmin = await prisma.user.findUnique({
      where: { user_id: primaryAdminUserId },
      select: {
        first_name: true,
        last_name: true,
        email: true,
        profile_url: true,
      },
    });
    if (primaryAdmin) {
      const fullName = `${primaryAdmin.first_name ?? ""} ${primaryAdmin.last_name ?? ""}`.trim();
      primaryAdminName = fullName || primaryAdmin.email || "Company Admin";
      primaryAdminAvatarUrl = primaryAdmin.profile_url ?? null;
    }
  }

  const isHitachiCompany = isHitachiCompanyName(company?.name ?? "");

  return {
    managedByCompany: true,
    companyId: companyId.toString(),
    companyTheme: company?.company_theme ?? "default",
    isHitachiCompany,
    isHitachiCompanyAdmin: isHitachiCompany && isCompanyAdmin,
    canChangeCompanyTheme: isPrimaryAdmin,
    isPrimaryAdmin,
    myRole,
    primaryAdminUserId: primaryAdminUserId ? primaryAdminUserId.toString() : null,
    primaryAdminName,
    primaryAdminAvatarUrl,
  };
}

export async function assertUserCanChangeOwnBizcardTheme(
  userId: bigint,
  requestId: string,
): Promise<void> {
  const policy = await resolveCompanyThemePolicyForUser(userId);
  if (!policy.managedByCompany) return;

  throw createCompanyError(
    CompanyErrorCode.COMPANY_THEME_MANAGED,
    "Your portfolio theme is managed by your company. Ask a company admin to update it in Company Settings → Theme.",
    403,
    requestId,
    {
      company_id: policy.companyId,
      company_theme: policy.companyTheme,
    },
  );
}

export async function countCoAdmins(companyId: bigint, primaryAdminId: bigint | null): Promise<number> {
  if (!primaryAdminId) {
    return prisma.companyEmployee.count({
      where: {
        company_id: companyId,
        is_active: true,
        role: "admin",
      },
    });
  }

  return prisma.companyEmployee.count({
    where: {
      company_id: companyId,
      is_active: true,
      role: "admin",
      user_id: { not: primaryAdminId },
    },
  });
}

export function isCoAdminMember(role: string, userId: bigint, primaryAdminId: bigint | null): boolean {
  return role === "admin" && primaryAdminId !== null && userId !== primaryAdminId;
}

export const COMPANY_PERMISSION_KEYS = [
  "manage_employees",
  "view_analytics",
  "edit_company",
  "manage_inquiries",
] as const;

export type CompanyPermissionKey = (typeof COMPANY_PERMISSION_KEYS)[number];

export interface CompanyActorContext {
  companyId: bigint;
  userId: bigint;
  role: CompanyRole;
  permissions: Record<string, boolean>;
  companyStatus: string;
  isPrimaryAdmin: boolean;
  joinedAt: Date | null;
}

export const DEFAULT_CO_ADMIN_PERMISSIONS: Record<CompanyPermissionKey, boolean> = {
  manage_employees: true,
  view_analytics: true,
  edit_company: false,
  manage_inquiries: true,
};

const DEFAULT_ROLE_PERMISSIONS: Record<CompanyRole, Record<string, boolean>> = {
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

function toCompanyRole(value: string | null | undefined): CompanyRole {
  if (value === "admin" || value === "manager" || value === "viewer") return value;
  return "employee";
}

function permissionEnabled(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

function parseMemberPermissions(
  raw: string | null,
  role: CompanyRole,
  isPrimaryAdmin: boolean,
): Record<string, boolean> {
  if (isPrimaryAdmin) {
    return { ...DEFAULT_ROLE_PERMISSIONS.admin };
  }

  const defaults =
    role === "admin"
      ? { ...DEFAULT_CO_ADMIN_PERMISSIONS }
      : { ...DEFAULT_ROLE_PERMISSIONS[role] };

  if (!raw) return defaults;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return defaults;
    }

    return {
      ...defaults,
      ...Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>)
          .filter(([key]) => key in defaults)
          .map(([key, value]) => [key, permissionEnabled(value)]),
      ),
    };
  } catch {
    return defaults;
  }
}

function parsePermissions(raw: string | null, role: CompanyRole): Record<string, boolean> {
  return parseMemberPermissions(raw, role, false);
}

export function isCompanyApproverRole(role: string): boolean {
  return role === "dev" || role === "super_admin";
}

export function ensureCompanyApprover(session: SessionPayload, requestId: string): void {
  if (!isCompanyApproverRole(session.role)) {
    throw createCompanyError(CompanyErrorCode.SUPER_ADMIN_REQUIRED, "Super admin or dev role required.", 403, requestId);
  }
}

export function normalizeSlug(value: string): string {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX);

  return base.length > 0 ? base : `company-${Date.now()}`;
}

export async function ensureUniqueCompanySlug(name: string): Promise<string> {
  const base = normalizeSlug(name);
  let slug = base;
  let attempt = 1;

  while (true) {
    const existing = await prisma.company.findUnique({
      where: { company_slug: slug },
      select: { company_id: true },
    });

    if (!existing) return slug;

    attempt += 1;
    const suffix = `-${attempt}`;
    slug = `${base.slice(0, Math.max(1, SLUG_MAX - suffix.length))}${suffix}`;
  }
}

export function generateSecurityCode(length = 8): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

export function canCreateCompanyWithPlan(planName: string | null, selectedTier: "premium" | "enterprise"): boolean {
  const normalized = (planName ?? "").toLowerCase();
  if (selectedTier === "enterprise") return normalized === "enterprise";
  return normalized === "premium" || normalized === "enterprise";
}

export async function resolveCompanyActorContext(params: {
  userId: bigint;
  requestId: string;
  companyId?: bigint;
  requireActiveMember?: boolean;
}): Promise<CompanyActorContext> {
  const user = await prisma.user.findUnique({
    where: { user_id: params.userId },
    select: {
      user_id: true,
      company_id: true,
      role: true,
    },
  });

  if (!user) {
    throw createCompanyError(CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION, "User not found.", 404, params.requestId);
  }

  const resolvedCompanyId = params.companyId ?? user.company_id;
  if (!resolvedCompanyId) {
    throw createCompanyError(CompanyErrorCode.COMPANY_NOT_FOUND, "No company context found for user.", 404, params.requestId);
  }

  const company = await prisma.company.findUnique({
    where: { company_id: resolvedCompanyId },
    select: {
      company_id: true,
      admin_id: true,
      created_by: true,
      status: true,
      created_at: true,
      settings: true,
    },
  });

  if (!company) {
    throw createCompanyError(CompanyErrorCode.COMPANY_NOT_FOUND, "Company not found.", 404, params.requestId);
  }

  if (company.status === "restricted") {
    throw createCompanyError(
      CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
      "Company is restricted.",
      403,
      params.requestId,
      { companyId: company.company_id.toString(), status: company.status }
    );
  }

  const member = await prisma.companyEmployee.findFirst({
    where: {
      company_id: resolvedCompanyId,
      user_id: params.userId,
    },
    select: {
      company_id: true,
      role: true,
      permissions: true,
      is_active: true,
      joined_at: true,
    },
  });

  const isAdminByCompany =
    company.admin_id === params.userId ||
    (company.admin_id == null && company.created_by === params.userId);
  if (!member && !isAdminByCompany) {
    throw createCompanyError(
      CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
      "You are not a member of this company.",
      403,
      params.requestId
    );
  }

  if (
    member &&
    !isAdminByCompany &&
    params.requireActiveMember !== false &&
    !member.is_active
  ) {
    throw createCompanyError(CompanyErrorCode.EMPLOYEE_RESTRICTED, "Employee is restricted.", 403, params.requestId);
  }

  const role = isAdminByCompany ? "admin" : toCompanyRole(member?.role);
  const permissions = parseMemberPermissions(
    member?.permissions ?? null,
    role,
    isAdminByCompany,
  );

  return {
    companyId: company.company_id,
    userId: params.userId,
    role,
    permissions,
    companyStatus: company.status,
    isPrimaryAdmin: isAdminByCompany,
    joinedAt: member?.joined_at ?? company.created_at ?? null,
  };
}

export function sanitizeCoAdminPermissions(
  input: unknown,
): Record<CompanyPermissionKey, boolean> {
  const base = { ...DEFAULT_CO_ADMIN_PERMISSIONS };
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return base;
  }
  for (const key of COMPANY_PERMISSION_KEYS) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value === "boolean") {
      base[key] = value;
    }
  }
  return base;
}

export async function resolveUserPortalRole(userId: bigint): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { user_id: userId },
    select: { role: true, company_id: true },
  });
  if (!user) return "user";

  const appRole = String(user.role ?? "user").trim().toLowerCase();
  if (appRole === "super_admin") return "super_admin";
  if (appRole === "staff") return "staff";
  if (appRole === "dev") return "dev";

  if (!user.company_id) return "user";

  try {
    const context = await resolveCompanyActorContext({
      userId,
      requestId: "portal-role",
      requireActiveMember: false,
    });
    if (context.companyStatus !== "active") return "user";
    if (context.role === "manager") return "manager";
    if (context.role === "admin") return "company_admin";
  } catch {
    return "user";
  }

  return "user";
}

export function ensureCompanyRole(
  context: CompanyActorContext,
  allowedRoles: CompanyRole[],
  requestId: string
): void {
  if (!allowedRoles.includes(context.role)) {
    throw createCompanyError(
      CompanyErrorCode.INSUFFICIENT_PERMISSIONS,
      "Insufficient company role permissions.",
      403,
      requestId,
      { required: allowedRoles, actual: context.role }
    );
  }
}

export function ensureCompanyPermission(
  context: CompanyActorContext,
  permission: string,
  requestId: string
): void {
  if (context.isPrimaryAdmin) return;
  if (context.permissions[permission] === true) return;

  throw createCompanyError(
    CompanyErrorCode.INSUFFICIENT_PERMISSIONS,
    `Missing required permission: ${permission}`,
    403,
    requestId,
    { permission, role: context.role }
  );
}

export function parseCompanySettings(settingsRaw: string | null): Record<string, unknown> {
  if (!settingsRaw || typeof settingsRaw !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(settingsRaw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to empty object.
  }
  return {};
}

export function ensurePrimaryAdmin(context: CompanyActorContext, requestId: string): void {
  if (context.isPrimaryAdmin) return;

  throw createCompanyError(
    CompanyErrorCode.INSUFFICIENT_PERMISSIONS,
    "Only the primary company administrator can perform this action.",
    403,
    requestId,
    { role: context.role }
  );
}

export function actorUserIdFromSession(auth: RequestSessionResult): bigint {
  if (!auth.session) {
    throw new Error("Session required to resolve company actor user id");
  }
  // Superadmin impersonation: act as the target company member.
  if (auth.impersonation && auth.session.role.trim().toLowerCase() === "super_admin") {
    return BigInt(auth.impersonation.targetUserId);
  }
  // Company employee acting context is for user-scoped BizCard APIs only —
  // company admin endpoints must keep the real admin/manager as the actor.
  return BigInt(auth.session.userId);
}

export async function logCompanyAudit(params: {
  companyId: bigint;
  userId: bigint;
  action: string;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string;
}): Promise<void> {
  try {
    await prisma.companyAuditLog.create({
      data: {
        company_id: params.companyId,
        user_id: params.userId,
        action: params.action,
        details: params.details ? JSON.stringify(params.details) : null,
        ip_address: params.ipAddress ?? null,
        user_agent: params.userAgent ?? null,
        request_id: params.requestId ?? null,
      },
    });
  } catch {
    // Company audit logging is best-effort and should not break user flows.
  }
}
