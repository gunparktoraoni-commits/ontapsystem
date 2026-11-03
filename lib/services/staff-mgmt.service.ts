import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import { hashPassword } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";
import { toJsonString } from "@/server/lib/json-field";
import { createStaffMgmtError, StaffMgmtErrorCode } from "@/lib/errors/staff-mgmt-errors";
import { EmailService } from "@/lib/services/emailService";
import {
  getOnlineCutoffDate,
  isUserCurrentlyOnline,
} from "@/server/lib/user-presence";

const STAFF_INVITE_TOKEN_BYTES = 32;
const STAFF_INVITE_TOKEN_EXPIRY_MS = 48 * 60 * 60 * 1000;
const RECENT_ACTIVITY_DAYS = 7;

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
const MAX_EXPORT_ROWS = 25_000;
const MAX_SEARCH_RESULTS = 20;

const STAFF_ROLE_KEYS = ["web_developer", "sales_rep", "admin", "support_agent", "analyst"] as const;
const DEPARTMENT_KEYS = ["web_dev", "sales", "admin", "support", "analytics"] as const;
const DATE_FILTERS = ["today", "yesterday", "this_week", "this_month", "custom"] as const;

export type DateFilterType = (typeof DATE_FILTERS)[number];
export type StaffRole = (typeof STAFF_ROLE_KEYS)[number];
export type Department = (typeof DEPARTMENT_KEYS)[number];

export interface StaffPermissionFlags {
  can_create: boolean;
  can_read: boolean;
  can_update: boolean;
  can_delete: boolean;
}

export interface StaffAnalytics {
  total_staff: number;
  web_developers: number;
  sales_representatives: number;
  admin_count: number;
  support_agents: number;
  analysts: number;
  active_staff: number;
  inactive_staff: number;
  online_staff: number;
  offline_staff: number;
  recent_activity_staff: number;
}

export type StaffPermissions = Record<string, StaffPermissionFlags>;

export interface StaffListItem {
  staff_id: number;
  user_id: number;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  role_key: string;
  department: string;
  department_key: string;
  is_active: boolean;
  invitation_status: "invited" | "active" | "inactive";
  joined_at: Date;
  last_login_at: Date | null;
  is_online: boolean;
  profile_image: string | null;
  permissions?: StaffPermissions;
}

export interface StaffDetails {
  staff_id: number;
  user_id: number;
  name: string;
  email: string;
  phone: string | null;
  profile_image: string | null;
  role: {
    id: number;
    name: string;
    key: string;
  };
  department: {
    id: number;
    name: string;
    key: string;
  };
  is_active: boolean;
  joined_at: Date;
  permissions: StaffPermissions;
  recent_activity: Array<{
    action: string;
    details: unknown;
    created_at: Date;
  }>;
}

export interface CreateStaffData {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  role_key: StaffRole;
  department_key: Department;
  profile_image?: string;
  permissions?: StaffPermissions;
}

export interface StaffListFilters {
  page?: number;
  limit?: number;
  role?: StaffRole;
  department?: Department;
  search?: string;
  presence?: "online" | "offline" | "recent";
}

export interface OrderActorContext {
  ipAddress?: string;
  userAgent?: string;
  requestOrigin?: string;
}

export type StaffExportFilter = "all" | "specific";
export type StaffExportFormat = "csv" | "xlsx";
export type StaffExportDateFilter = "all" | DateFilterType;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value: bigint): number {
  return Number(value);
}

function normalizeText(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parsePage(page: number | undefined, requestId: string): number {
  const normalized = page ?? 1;
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw createStaffMgmtError(
      StaffMgmtErrorCode.INVALID_FILTER_TYPE,
      "page must be a positive integer",
      400,
      requestId,
      { page: normalized }
    );
  }
  return normalized;
}

function parseLimit(limit: number | undefined, requestId: string): number {
  const normalized = limit ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(normalized) || normalized <= 0 || normalized > MAX_PAGE_SIZE) {
    throw createStaffMgmtError(
      StaffMgmtErrorCode.INVALID_FILTER_TYPE,
      `limit must be between 1 and ${MAX_PAGE_SIZE}`,
      400,
      requestId,
      { limit: normalized }
    );
  }
  return normalized;
}

function parseActorUserId(actorId: string, requestId: string): bigint {
  const normalized = actorId.trim();
  if (!/^\d+$/.test(normalized)) {
    throw createStaffMgmtError(
      StaffMgmtErrorCode.INVALID_FILTER_TYPE,
      "Invalid actor user id",
      400,
      requestId,
      { actorId }
    );
  }
  return BigInt(normalized);
}

function escapeCsv(value: unknown): string {
  const stringValue = value == null ? "" : String(value);
  if (stringValue.includes(",") || stringValue.includes("\"") || stringValue.includes("\n")) {
    return `"${stringValue.replace(/\"/g, '""')}"`;
  }
  return stringValue;
}

function isDateFilter(value: string): value is DateFilterType {
  return (DATE_FILTERS as readonly string[]).includes(value);
}

function normalizePermissionsMap(
  permissions: StaffPermissions,
  requestId: string,
  allowedModules: Set<string>
): StaffPermissions {
  if (!isObjectRecord(permissions)) {
    throw createStaffMgmtError(
      StaffMgmtErrorCode.INVALID_PERMISSION_CONFIG,
      "permissions must be an object",
      400,
      requestId
    );
  }

  const normalized: StaffPermissions = {};

  for (const [moduleKey, value] of Object.entries(permissions)) {
    if (!allowedModules.has(moduleKey)) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.PERMISSION_NOT_FOUND,
        `Unknown module: ${moduleKey}`,
        400,
        requestId,
        { module: moduleKey }
      );
    }

    if (!isObjectRecord(value)) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.INVALID_PERMISSION_CONFIG,
        `Invalid permission config for module ${moduleKey}`,
        400,
        requestId,
        { module: moduleKey }
      );
    }

    normalized[moduleKey] = {
      can_create: value.can_create === true,
      can_read: value.can_read === true,
      can_update: value.can_update === true,
      can_delete: value.can_delete === true,
    };
  }

  return normalized;
}

function buildPermissionsObject(
  rows: Array<{
    module: string;
    can_create: boolean;
    can_read: boolean;
    can_update: boolean;
    can_delete: boolean;
  }>
): StaffPermissions {
  const map: StaffPermissions = {};

  for (const row of rows) {
    map[row.module] = {
      can_create: row.can_create,
      can_read: row.can_read,
      can_update: row.can_update,
      can_delete: row.can_delete,
    };
  }

  return map;
}

function toDateRange(
  filter: DateFilterType,
  requestId: string,
  customStartDate?: string,
  customEndDate?: string
): { start: Date; end: Date } {
  const now = new Date();

  const startOfDay = (date: Date): Date => {
    const output = new Date(date);
    output.setHours(0, 0, 0, 0);
    return output;
  };

  const endOfDay = (date: Date): Date => {
    const output = new Date(date);
    output.setHours(23, 59, 59, 999);
    return output;
  };

  if (filter === "today") {
    return { start: startOfDay(now), end: endOfDay(now) };
  }

  if (filter === "yesterday") {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return { start: startOfDay(yesterday), end: endOfDay(yesterday) };
  }

  if (filter === "this_week") {
    const start = new Date(now);
    const day = start.getDay();
    const mondayDistance = day === 0 ? 6 : day - 1;
    start.setDate(start.getDate() - mondayDistance);
    return { start: startOfDay(start), end: endOfDay(now) };
  }

  if (filter === "this_month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: startOfDay(start), end: endOfDay(now) };
  }

  if (!customStartDate || !customEndDate) {
    throw createStaffMgmtError(
      StaffMgmtErrorCode.INVALID_DATE_RANGE,
      "Custom date range requires start_date and end_date",
      400,
      requestId,
      { date_filter: filter }
    );
  }

  const parsedStart = new Date(customStartDate);
  const parsedEnd = new Date(customEndDate);

  if (Number.isNaN(parsedStart.getTime()) || Number.isNaN(parsedEnd.getTime())) {
    throw createStaffMgmtError(
      StaffMgmtErrorCode.INVALID_DATE_RANGE,
      "Invalid custom date range",
      400,
      requestId,
      {
        start_date: customStartDate,
        end_date: customEndDate,
      }
    );
  }

  const start = startOfDay(parsedStart);
  const end = endOfDay(parsedEnd);

  if (start.getTime() > end.getTime()) {
    throw createStaffMgmtError(
      StaffMgmtErrorCode.INVALID_DATE_RANGE,
      "start_date must be less than or equal to end_date",
      400,
      requestId,
      {
        start_date: customStartDate,
        end_date: customEndDate,
      }
    );
  }

  return { start, end };
}

function hashStaffInviteToken(token: string): string {
  return crypto.createHash("sha256").update(token.trim()).digest("hex");
}

function resolveStaffInviteBaseUrl(requestOrigin?: string): string {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.FRONTEND_URL?.trim() ||
    "";
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  if (requestOrigin) {
    try {
      const origin = new URL(requestOrigin).origin;
      if (origin && origin !== "null") {
        return origin.replace(/\/+$/, "");
      }
    } catch {
      // Ignore malformed request origin and continue to fallbacks.
    }
  }

  if (process.env.NODE_ENV === "development") {
    const port = process.env.PORT?.trim() || "3000";
    return `http://localhost:${port}`;
  }

  return "";
}

type StaffInviteEmailResult = {
  emailSent: boolean;
  reason?: string;
};

async function sendStaffInviteVerificationLink(
  userId: bigint,
  email: string,
  firstName: string,
  requestId: string,
  requestOrigin?: string
): Promise<StaffInviteEmailResult> {
  const plainToken = crypto.randomBytes(STAFF_INVITE_TOKEN_BYTES).toString("hex");
  const tokenHash = hashStaffInviteToken(plainToken);
  const expiresAt = new Date(Date.now() + STAFF_INVITE_TOKEN_EXPIRY_MS);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.emailVerificationToken.updateMany({
      where: {
        user_id: userId,
        used_at: null,
      },
      data: {
        used_at: now,
      },
    });

    await tx.emailVerificationToken.create({
      data: {
        user_id: userId,
        target_email: email,
        token_hash: tokenHash,
        expires_at: expiresAt,
      },
    });
  });

  const baseUrl = resolveStaffInviteBaseUrl(requestOrigin);
  if (!baseUrl) {
    console.warn(
      "[StaffMgmt] Application URL is not configured; invite token saved but email not sent. Set NEXT_PUBLIC_APP_URL, APP_URL, or FRONTEND_URL on production.",
      {
        requestId,
        email,
        requestOrigin: requestOrigin ?? null,
      }
    );
    return {
      emailSent: false,
      reason: "Application URL is not configured.",
    };
  }

  const verifyUrl = `${baseUrl}/staff/verify?token=${encodeURIComponent(plainToken)}`;

  try {
    const emailService = EmailService.getInstance();
    const emailResult = await emailService.sendStaffInviteVerificationEmail({
      email,
      firstName,
      verifyUrl,
      expiresAt,
    });

    if (!emailResult.success) {
      console.error("[StaffMgmt] Staff invite email failed to send", {
        requestId,
        email,
        emailError: emailResult.error,
      });
      return {
        emailSent: false,
        reason: emailResult.error ?? "Email provider failed to send invite.",
      };
    }

    return { emailSent: true };
  } catch (error) {
    console.error("[StaffMgmt] Staff invite email service error", {
      requestId,
      email,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      emailSent: false,
      reason: "Email service is unavailable.",
    };
  }
}

export class StaffManagementService {
  private readonly requestId: string;
  private readonly timezone: string;

  constructor(requestId: string, timezone: string = "UTC") {
    this.requestId = requestId;
    this.timezone = timezone;
  }

  async verifySuperAdmin(userId: string): Promise<void> {
    const parsedUserId = parseActorUserId(userId, this.requestId);

    const user = await prisma.user.findUnique({
      where: { user_id: parsedUserId },
      select: { role: true },
    });

    if (!user || user.role !== "super_admin") {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.SUPERADMIN_REQUIRED,
        "SuperAdmin access required for staff management",
        403,
        this.requestId,
        {
          userId,
          currentRole: user?.role,
        }
      );
    }
  }

  private async getModuleKeys(): Promise<string[]> {
    const modules = await prisma.staffModule.findMany({
      select: { module_key: true },
      orderBy: { display_order: "asc" },
    });

    if (modules.length === 0) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.PERMISSION_NOT_FOUND,
        "Permission modules are not configured",
        500,
        this.requestId
      );
    }

    return modules.map((module) => module.module_key);
  }

  async getStaffAnalytics(): Promise<StaffAnalytics> {
    const recentCutoff = new Date(Date.now() - RECENT_ACTIVITY_DAYS * 24 * 60 * 60 * 1000);

    const [totalStaff, activeStaff, inactiveStaff, byRole, roles, staffUsers, recentActivityStaffIds] =
      await Promise.all([
        prisma.staffProfile.count(),
        prisma.staffProfile.count({ where: { is_active: true } }),
        prisma.staffProfile.count({ where: { is_active: false } }),
        prisma.staffProfile.groupBy({
          by: ["role_id"],
          _count: { _all: true },
        }),
        prisma.staffRole.findMany({
          select: { role_id: true, role_key: true },
        }),
        prisma.staffProfile.findMany({
          select: {
            staff_id: true,
            user: {
              select: {
                last_active: true,
                is_online: true,
                last_login_at: true,
                userActivity: { select: { last_active: true } },
              },
            },
          },
        }),
        prisma.staffActivityLog.findMany({
          where: { created_at: { gte: recentCutoff } },
          select: { staff_id: true },
          distinct: ["staff_id"],
        }),
      ]);

    const roleIdByKey = new Map(roles.map((role) => [role.role_key, role.role_id]));
    const countByRoleId = new Map(byRole.map((row) => [row.role_id.toString(), row._count._all]));

    const getRoleCount = (roleKey: StaffRole): number => {
      const roleId = roleIdByKey.get(roleKey);
      if (!roleId) return 0;
      return countByRoleId.get(roleId.toString()) ?? 0;
    };

    let onlineStaff = 0;
    let offlineStaff = 0;
    const recentStaffIdSet = new Set(recentActivityStaffIds.map((row) => row.staff_id.toString()));

    for (const row of staffUsers) {
      const lastActive = row.user.last_active ?? row.user.userActivity?.last_active ?? null;
      const online = isUserCurrentlyOnline({
        is_online: row.user.is_online,
        last_active: lastActive,
      });
      if (online) onlineStaff += 1;
      else offlineStaff += 1;

      const recentLogin =
        row.user.last_login_at != null && row.user.last_login_at.getTime() >= recentCutoff.getTime();
      const recentActive = lastActive != null && lastActive.getTime() >= recentCutoff.getTime();
      if (recentLogin || recentActive) {
        recentStaffIdSet.add(row.staff_id.toString());
      }
    }

    return {
      total_staff: totalStaff,
      web_developers: getRoleCount("web_developer"),
      sales_representatives: getRoleCount("sales_rep"),
      admin_count: getRoleCount("admin"),
      support_agents: getRoleCount("support_agent"),
      analysts: getRoleCount("analyst"),
      active_staff: activeStaff,
      inactive_staff: inactiveStaff,
      online_staff: onlineStaff,
      offline_staff: offlineStaff,
      recent_activity_staff: recentStaffIdSet.size,
    };
  }

  async getStaffList(filters: StaffListFilters = {}): Promise<{
    staff: StaffListItem[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
      has_next: boolean;
      has_previous: boolean;
    };
  }> {
    const page = parsePage(filters.page, this.requestId);
    const limit = parseLimit(filters.limit, this.requestId);
    const skip = (page - 1) * limit;
    const onlineCutoff = getOnlineCutoffDate();
    const recentCutoff = new Date(Date.now() - RECENT_ACTIVITY_DAYS * 24 * 60 * 60 * 1000);

    const where: Prisma.StaffProfileWhereInput = {};

    if (filters.role) {
      where.role = { role_key: filters.role };
    }

    if (filters.department) {
      where.department = { department_key: filters.department };
    }

    const search = normalizeText(filters.search);
    const searchClauses: Prisma.StaffProfileWhereInput[] | undefined = search
      ? [
          { user: { first_name: { contains: search } } },
          { user: { last_name: { contains: search } } },
          { user: { email: { contains: search } } },
          { role: { role_name: { contains: search } } },
          { department: { department_name: { contains: search } } },
        ]
      : undefined;

    const presenceClause: Prisma.StaffProfileWhereInput | undefined =
      filters.presence === "online"
        ? {
            user: {
              OR: [
                { last_active: { gte: onlineCutoff } },
                { userActivity: { last_active: { gte: onlineCutoff } } },
              ],
            },
          }
        : filters.presence === "offline"
          ? {
              NOT: {
                user: {
                  OR: [
                    { last_active: { gte: onlineCutoff } },
                    { userActivity: { last_active: { gte: onlineCutoff } } },
                  ],
                },
              },
            }
          : filters.presence === "recent"
            ? {
                OR: [
                  { user: { last_login_at: { gte: recentCutoff } } },
                  { user: { last_active: { gte: recentCutoff } } },
                  { user: { userActivity: { last_active: { gte: recentCutoff } } } },
                  { activityLogs: { some: { created_at: { gte: recentCutoff } } } },
                ],
              }
            : undefined;

    const andClauses: Prisma.StaffProfileWhereInput[] = [];
    if (searchClauses) andClauses.push({ OR: searchClauses });
    if (presenceClause) andClauses.push(presenceClause);
    if (andClauses.length === 1) {
      Object.assign(where, andClauses[0]);
    } else if (andClauses.length > 1) {
      where.AND = andClauses;
    }

    const [rows, total] = await Promise.all([
      prisma.staffProfile.findMany({
        where,
        include: {
          user: {
            select: {
              user_id: true,
              first_name: true,
              last_name: true,
              email: true,
              contact: true,
              profile_url: true,
              is_active: true,
              is_online: true,
              created_at: true,
              last_login_at: true,
              last_active: true,
              userActivity: {
                select: { last_active: true },
              },
              credentials: {
                select: {
                  email_verified: true,
                },
              },
              bizcards: {
                where: { deactivated_flag: false, profile_img: { not: null } },
                orderBy: { updated_at: "desc" },
                take: 1,
                select: { profile_img: true },
              },
            },
          },
          role: {
            select: {
              role_name: true,
              role_key: true,
            },
          },
          department: {
            select: {
              department_name: true,
              department_key: true,
            },
          },
          permissions: {
            select: {
              module: true,
              can_create: true,
              can_read: true,
              can_update: true,
              can_delete: true,
            },
          },
        },
        orderBy: { joined_at: "desc" },
        skip,
        take: limit,
      }),
      prisma.staffProfile.count({ where }),
    ]);

    const pages = Math.max(1, Math.ceil(total / limit));

    return {
      staff: rows.map((row) => {
        const emailVerified = row.user.credentials?.email_verified === true;
        const invitationStatus: StaffListItem["invitation_status"] = !emailVerified
          ? "invited"
          : row.is_active
            ? "active"
            : "inactive";
        const lastActive = row.user.last_active ?? row.user.userActivity?.last_active ?? null;
        const isOnline = isUserCurrentlyOnline({
          is_online: row.user.is_online,
          last_active: lastActive,
        });
        const profileImage =
          (row.user.profile_url ?? "").trim() ||
          (row.user.bizcards[0]?.profile_img ?? "").trim() ||
          null;

        return {
          staff_id: toNumber(row.staff_id),
          user_id: toNumber(row.user.user_id),
          name: `${row.user.first_name} ${row.user.last_name}`.trim(),
          email: row.user.email,
          phone: row.user.contact,
          role: row.role.role_name,
          role_key: row.role.role_key,
          department: row.department.department_name,
          department_key: row.department.department_key,
          is_active: row.is_active && emailVerified,
          invitation_status: invitationStatus,
          joined_at: row.joined_at,
          last_login_at: row.user.last_login_at,
          is_online: isOnline,
          profile_image: profileImage,
          permissions: buildPermissionsObject(row.permissions),
        };
      }),
      pagination: {
        page,
        limit,
        total,
        pages,
        has_next: page < pages,
        has_previous: page > 1,
      },
    };
  }

  async getStaffDetails(staffId: number): Promise<StaffDetails> {
    if (!Number.isInteger(staffId) || staffId <= 0) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.INVALID_FILTER_TYPE,
        "staffId must be a positive integer",
        400,
        this.requestId,
        { staffId }
      );
    }

    const staff = await prisma.staffProfile.findUnique({
      where: { staff_id: BigInt(staffId) },
      include: {
        user: {
          select: {
            user_id: true,
            first_name: true,
            last_name: true,
            email: true,
            contact: true,
            profile_url: true,
          },
        },
        role: {
          select: {
            role_id: true,
            role_name: true,
            role_key: true,
          },
        },
        department: {
          select: {
            department_id: true,
            department_name: true,
            department_key: true,
          },
        },
        permissions: {
          select: {
            module: true,
            can_create: true,
            can_read: true,
            can_update: true,
            can_delete: true,
          },
        },
        activityLogs: {
          orderBy: { created_at: "desc" },
          take: 20,
          select: {
            action: true,
            details: true,
            created_at: true,
          },
        },
      },
    });

    if (!staff) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.STAFF_NOT_FOUND,
        `Staff with ID ${staffId} not found`,
        404,
        this.requestId,
        { staffId }
      );
    }

    return {
      staff_id: toNumber(staff.staff_id),
      user_id: toNumber(staff.user.user_id),
      name: `${staff.user.first_name} ${staff.user.last_name}`.trim(),
      email: staff.user.email,
      phone: staff.user.contact,
      profile_image: staff.user.profile_url,
      role: {
        id: toNumber(staff.role.role_id),
        name: staff.role.role_name,
        key: staff.role.role_key,
      },
      department: {
        id: toNumber(staff.department.department_id),
        name: staff.department.department_name,
        key: staff.department.department_key,
      },
      is_active: staff.is_active,
      joined_at: staff.joined_at,
      permissions: buildPermissionsObject(staff.permissions),
      recent_activity: staff.activityLogs.map((log) => ({
        action: log.action,
        details: log.details,
        created_at: log.created_at,
      })),
    };
  }

  async createStaff(
    staffData: CreateStaffData,
    createdBy: string,
    context?: OrderActorContext
  ): Promise<{
    staff_id: number;
    user_id: number;
    name: string;
    email: string;
    role: string;
    department: string;
    message: string;
    email_sent: boolean;
    email_error: string | null;
  }> {
    const actorUserId = parseActorUserId(createdBy, this.requestId);
    const email = staffData.email.trim().toLowerCase();

    const [role, department, moduleKeys] = await Promise.all([
      prisma.staffRole.findUnique({ where: { role_key: staffData.role_key } }),
      prisma.department.findUnique({ where: { department_key: staffData.department_key } }),
      this.getModuleKeys(),
    ]);

    if (!role) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.INVALID_ROLE,
        `Invalid role: ${staffData.role_key}`,
        400,
        this.requestId,
        { roleKey: staffData.role_key }
      );
    }

    if (!department) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.INVALID_DEPARTMENT,
        `Invalid department: ${staffData.department_key}`,
        400,
        this.requestId,
        { departmentKey: staffData.department_key }
      );
    }

    const rawPermissions = staffData.permissions ?? {};
    const permissionsInput =
      Object.keys(rawPermissions).length > 0
        ? rawPermissions
        : Object.fromEntries(
            moduleKeys.map((moduleKey) => [
              moduleKey,
              {
                can_create: false,
                can_read: true,
                can_update: false,
                can_delete: false,
              },
            ]),
          );

    const normalizedPermissions = normalizePermissionsMap(
      permissionsInput,
      this.requestId,
      new Set(moduleKeys)
    );

    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: {
        user_id: true,
        role: true,
      },
    });

    if (existingUser && (existingUser.role === "super_admin" || existingUser.role === "dev")) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.STAFF_EMAIL_EXISTS,
        "Email belongs to a privileged account and cannot be assigned as staff",
        409,
        this.requestId,
        { email, role: existingUser.role }
      );
    }

    const created = await prisma.$transaction(async (tx) => {
      let userId: bigint;

      if (!existingUser) {
        const temporaryPassword = this.generateTemporaryPassword();
        const passwordHash = await hashPassword(temporaryPassword);

        const user = await tx.user.create({
          data: {
            role: "staff",
            first_name: staffData.first_name.trim(),
            last_name: staffData.last_name.trim(),
            email,
            contact: normalizeText(staffData.phone) ?? null,
            profile_url: normalizeText(staffData.profile_image) ?? null,
            is_active: false,
          },
          select: { user_id: true },
        });

        await tx.credential.create({
          data: {
            user_id: user.user_id,
            password_hash: passwordHash,
            email_verified: false,
            must_change_password: true,
          },
        });

        userId = user.user_id;
      } else {
        const alreadyStaff = await tx.staffProfile.findUnique({
          where: { user_id: existingUser.user_id },
          select: { staff_id: true },
        });

        if (alreadyStaff) {
          throw createStaffMgmtError(
            StaffMgmtErrorCode.STAFF_ALREADY_EXISTS,
            "User is already a staff member",
            409,
            this.requestId,
            { userId: existingUser.user_id.toString() }
          );
        }

        await tx.user.update({
          where: { user_id: existingUser.user_id },
          data: {
            role: "staff",
            first_name: staffData.first_name.trim(),
            last_name: staffData.last_name.trim(),
            contact: normalizeText(staffData.phone) ?? null,
            profile_url: normalizeText(staffData.profile_image) ?? null,
            is_active: false,
          },
        });

        const existingCredential = await tx.credential.findUnique({
          where: { user_id: existingUser.user_id },
          select: { credentials_id: true },
        });

        if (existingCredential) {
          await tx.credential.update({
            where: { credentials_id: existingCredential.credentials_id },
            data: {
              email_verified: false,
              email_verified_at: null,
              must_change_password: true,
            },
          });
        } else {
          const temporaryPassword = this.generateTemporaryPassword();
          const passwordHash = await hashPassword(temporaryPassword);
          await tx.credential.create({
            data: {
              user_id: existingUser.user_id,
              password_hash: passwordHash,
              email_verified: false,
              must_change_password: true,
            },
          });
        }

        userId = existingUser.user_id;
      }

      const staffProfile = await tx.staffProfile.create({
        data: {
          user_id: userId,
          role_id: role.role_id,
          department_id: department.department_id,
          is_active: false,
          updated_by: actorUserId,
        },
        select: {
          staff_id: true,
          user_id: true,
        },
      });

      const permissionRows = moduleKeys.map((moduleKey) => {
        const permission = normalizedPermissions[moduleKey] ?? {
          can_create: false,
          can_read: false,
          can_update: false,
          can_delete: false,
        };

        return {
          staff_id: staffProfile.staff_id,
          module: moduleKey,
          can_create: permission.can_create,
          can_read: permission.can_read,
          can_update: permission.can_update,
          can_delete: permission.can_delete,
        };
      });

      await tx.staffPermission.createMany({
        data: permissionRows,
      });

      await tx.staffActivityLog.create({
        data: {
          staff_id: staffProfile.staff_id,
          user_id: actorUserId,
          action: "STAFF_CREATED",
          details: toJsonString({
            email,
            role_key: staffData.role_key,
            department_key: staffData.department_key,
            timezone: this.timezone,
          }),
          ip_address: context?.ipAddress ?? null,
          user_agent: context?.userAgent ?? null,
          request_id: this.requestId,
        },
      });

      return {
        staff_id: toNumber(staffProfile.staff_id),
        user_id: toNumber(staffProfile.user_id),
      };
    });

    const inviteResult = await sendStaffInviteVerificationLink(
      BigInt(created.user_id),
      email,
      staffData.first_name.trim(),
      this.requestId,
      context?.requestOrigin
    );

    return {
      ...created,
      name: `${staffData.first_name.trim()} ${staffData.last_name.trim()}`,
      email,
      role: staffData.role_key,
      department: staffData.department_key,
      email_sent: inviteResult.emailSent,
      email_error: inviteResult.emailSent ? null : inviteResult.reason ?? "Invite email was not sent.",
      message: inviteResult.emailSent
        ? "Staff invitation sent successfully. The invitee must use the verification link to set their password."
        : "Staff account created, but the invitation email could not be sent. Resend the invite after verifying email configuration.",
    };
  }

  async updateStaffPermissions(
    staffId: number,
    permissions: StaffPermissions,
    updatedBy: string,
    context?: OrderActorContext
  ): Promise<{ staff_id: number; message: string }> {
    if (!Number.isInteger(staffId) || staffId <= 0) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.INVALID_FILTER_TYPE,
        "staffId must be a positive integer",
        400,
        this.requestId,
        { staffId }
      );
    }

    const actorUserId = parseActorUserId(updatedBy, this.requestId);

    const [staff, moduleKeys] = await Promise.all([
      prisma.staffProfile.findUnique({
        where: { staff_id: BigInt(staffId) },
        select: { staff_id: true },
      }),
      this.getModuleKeys(),
    ]);

    if (!staff) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.STAFF_NOT_FOUND,
        `Staff with ID ${staffId} not found`,
        404,
        this.requestId,
        { staffId }
      );
    }

    const normalizedPermissions = normalizePermissionsMap(
      permissions,
      this.requestId,
      new Set(moduleKeys)
    );

    if (Object.keys(normalizedPermissions).length === 0) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.INVALID_PERMISSION_CONFIG,
        "permissions must contain at least one module",
        400,
        this.requestId
      );
    }

    await prisma.$transaction(async (tx) => {
      for (const [module, config] of Object.entries(normalizedPermissions)) {
        await tx.staffPermission.upsert({
          where: {
            staff_id_module: {
              staff_id: BigInt(staffId),
              module,
            },
          },
          update: {
            can_create: config.can_create,
            can_read: config.can_read,
            can_update: config.can_update,
            can_delete: config.can_delete,
          },
          create: {
            staff_id: BigInt(staffId),
            module,
            can_create: config.can_create,
            can_read: config.can_read,
            can_update: config.can_update,
            can_delete: config.can_delete,
          },
        });
      }

      await tx.staffActivityLog.create({
        data: {
          staff_id: BigInt(staffId),
          user_id: actorUserId,
          action: "PERMISSIONS_UPDATED",
          details: toJsonString({
            permissions: normalizedPermissions as unknown as Prisma.JsonObject,
          }),
          ip_address: context?.ipAddress ?? null,
          user_agent: context?.userAgent ?? null,
          request_id: this.requestId,
        },
      });
    });

    return {
      staff_id: staffId,
      message: "Staff permissions updated successfully",
    };
  }

  async updateStaffRole(
    staffId: number,
    roleKey: StaffRole,
    departmentKey: Department,
    updatedBy: string,
    context?: OrderActorContext
  ): Promise<{ staff_id: number; role: string; department: string; message: string }> {
    if (!Number.isInteger(staffId) || staffId <= 0) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.INVALID_FILTER_TYPE,
        "staffId must be a positive integer",
        400,
        this.requestId,
        { staffId }
      );
    }

    const actorUserId = parseActorUserId(updatedBy, this.requestId);

    const [staff, role, department] = await Promise.all([
      prisma.staffProfile.findUnique({
        where: { staff_id: BigInt(staffId) },
        select: {
          staff_id: true,
          role_id: true,
          department_id: true,
        },
      }),
      prisma.staffRole.findUnique({
        where: { role_key: roleKey },
        select: { role_id: true },
      }),
      prisma.department.findUnique({
        where: { department_key: departmentKey },
        select: { department_id: true },
      }),
    ]);

    if (!staff) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.STAFF_NOT_FOUND,
        `Staff with ID ${staffId} not found`,
        404,
        this.requestId,
        { staffId }
      );
    }

    if (!role) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.INVALID_ROLE,
        `Invalid role: ${roleKey}`,
        400,
        this.requestId,
        { roleKey }
      );
    }

    if (!department) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.INVALID_DEPARTMENT,
        `Invalid department: ${departmentKey}`,
        400,
        this.requestId,
        { departmentKey }
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.staffProfile.update({
        where: { staff_id: BigInt(staffId) },
        data: {
          role_id: role.role_id,
          department_id: department.department_id,
          updated_by: actorUserId,
        },
      });

      await tx.staffActivityLog.create({
        data: {
          staff_id: BigInt(staffId),
          user_id: actorUserId,
          action: "ROLE_UPDATED",
          details: toJsonString({
            old_role_id: staff.role_id.toString(),
            new_role_id: role.role_id.toString(),
            old_department_id: staff.department_id.toString(),
            new_department_id: department.department_id.toString(),
          }),
          ip_address: context?.ipAddress ?? null,
          user_agent: context?.userAgent ?? null,
          request_id: this.requestId,
        },
      });
    });

    return {
      staff_id: staffId,
      role: roleKey,
      department: departmentKey,
      message: "Staff role and department updated successfully",
    };
  }

  async toggleStaffStatus(
    staffId: number,
    isActive: boolean,
    updatedBy: string,
    context?: OrderActorContext
  ): Promise<{ staff_id: number; is_active: boolean; message: string }> {
    if (!Number.isInteger(staffId) || staffId <= 0) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.INVALID_FILTER_TYPE,
        "staffId must be a positive integer",
        400,
        this.requestId,
        { staffId }
      );
    }

    const actorUserId = parseActorUserId(updatedBy, this.requestId);

    const staff = await prisma.staffProfile.findUnique({
      where: { staff_id: BigInt(staffId) },
      select: {
        staff_id: true,
        user_id: true,
        is_active: true,
      },
    });

    if (!staff) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.STAFF_NOT_FOUND,
        `Staff with ID ${staffId} not found`,
        404,
        this.requestId,
        { staffId }
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.staffProfile.update({
        where: { staff_id: BigInt(staffId) },
        data: {
          is_active: isActive,
          updated_by: actorUserId,
        },
      });

      await tx.user.update({
        where: { user_id: staff.user_id },
        data: {
          is_active: isActive,
        },
      });

      await tx.staffActivityLog.create({
        data: {
          staff_id: BigInt(staffId),
          user_id: actorUserId,
          action: isActive ? "STAFF_ACTIVATED" : "STAFF_DEACTIVATED",
          details: toJsonString({
            previous_status: staff.is_active,
            new_status: isActive,
          }),
          ip_address: context?.ipAddress ?? null,
          user_agent: context?.userAgent ?? null,
          request_id: this.requestId,
        },
      });
    });

    return {
      staff_id: staffId,
      is_active: isActive,
      message: `Staff member has been ${isActive ? "activated" : "deactivated"}`,
    };
  }

  async deleteStaff(
    staffId: number,
    deletedBy: string,
    context?: OrderActorContext
  ): Promise<{ staff_id: number; message: string }> {
    if (!Number.isInteger(staffId) || staffId <= 0) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.INVALID_FILTER_TYPE,
        "staffId must be a positive integer",
        400,
        this.requestId,
        { staffId }
      );
    }

    parseActorUserId(deletedBy, this.requestId);

    const staff = await prisma.staffProfile.findUnique({
      where: { staff_id: BigInt(staffId) },
      select: {
        staff_id: true,
        user_id: true,
        user: {
          select: {
            role: true,
            email: true,
            first_name: true,
            last_name: true,
          },
        },
      },
    });

    if (!staff) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.STAFF_NOT_FOUND,
        `Staff with ID ${staffId} not found`,
        404,
        this.requestId,
        { staffId }
      );
    }

    if (staff.user.role === "super_admin" || staff.user.role === "dev") {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.SUPERADMIN_REQUIRED,
        "Privileged accounts cannot be deleted through staff management",
        403,
        this.requestId,
        { staffId, role: staff.user.role }
      );
    }

    const userId = staff.user_id;

    await prisma.$transaction(async (tx) => {
      await tx.staffProfile.updateMany({
        where: { updated_by: userId },
        data: { updated_by: null },
      });

      await tx.inquiry.updateMany({
        where: { assigned_to_staff_id: userId },
        data: { assigned_to_staff_id: null },
      });

      await tx.staffProfile.delete({
        where: { staff_id: BigInt(staffId) },
      });

      await tx.user.delete({
        where: { user_id: userId },
      });
    });

    return {
      staff_id: staffId,
      message: "Staff member deleted successfully",
    };
  }

  async searchUsers(
    searchTerm: string
  ): Promise<Array<{ user_id: number; name: string; email: string; profile_image: string | null }>> {
    const normalized = normalizeText(searchTerm);
    if (!normalized) {
      return [];
    }

    const users = await prisma.user.findMany({
      where: {
        role: "user",
        staffProfile: { is: null },
        OR: [
          { email: { contains: normalized } },
          { first_name: { contains: normalized } },
          { last_name: { contains: normalized } },
        ],
      },
      take: MAX_SEARCH_RESULTS,
      orderBy: { created_at: "desc" },
      select: {
        user_id: true,
        first_name: true,
        last_name: true,
        email: true,
        profile_url: true,
      },
    });

    return users.map((user) => ({
      user_id: toNumber(user.user_id),
      name: `${user.first_name} ${user.last_name}`.trim(),
      email: user.email,
      profile_image: user.profile_url,
    }));
  }

  async assignStaffToUser(
    userId: number,
    roleKey: StaffRole,
    departmentKey: Department,
    permissions: StaffPermissions,
    assignedBy: string,
    context?: OrderActorContext
  ): Promise<{
    staff_id: number;
    user_id: number;
    name: string;
    email: string;
    role: string;
    department: string;
    message: string;
  }> {
    if (!Number.isInteger(userId) || userId <= 0) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.INVALID_FILTER_TYPE,
        "user_id must be a positive integer",
        400,
        this.requestId,
        { userId }
      );
    }

    const actorUserId = parseActorUserId(assignedBy, this.requestId);

    const [user, role, department, moduleKeys] = await Promise.all([
      prisma.user.findUnique({
        where: { user_id: BigInt(userId) },
        select: {
          user_id: true,
          first_name: true,
          last_name: true,
          email: true,
          role: true,
        },
      }),
      prisma.staffRole.findUnique({ where: { role_key: roleKey } }),
      prisma.department.findUnique({ where: { department_key: departmentKey } }),
      this.getModuleKeys(),
    ]);

    if (!user) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.STAFF_NOT_FOUND,
        `User with ID ${userId} not found`,
        404,
        this.requestId,
        { userId }
      );
    }

    if (user.role === "super_admin" || user.role === "dev") {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.INSUFFICIENT_PERMISSIONS,
        "Cannot assign privileged account as staff",
        403,
        this.requestId,
        {
          userId,
          role: user.role,
        }
      );
    }

    if (!role) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.INVALID_ROLE,
        `Invalid role: ${roleKey}`,
        400,
        this.requestId,
        { roleKey }
      );
    }

    if (!department) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.INVALID_DEPARTMENT,
        `Invalid department: ${departmentKey}`,
        400,
        this.requestId,
        { departmentKey }
      );
    }

    const normalizedPermissions = normalizePermissionsMap(
      permissions,
      this.requestId,
      new Set(moduleKeys)
    );

    const existingStaff = await prisma.staffProfile.findUnique({
      where: { user_id: BigInt(userId) },
      select: { staff_id: true },
    });

    if (existingStaff) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.STAFF_ALREADY_EXISTS,
        "User is already a staff member",
        409,
        this.requestId,
        { userId }
      );
    }

    const created = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { user_id: user.user_id },
        data: {
          role: "staff",
          is_active: true,
        },
      });

      const staff = await tx.staffProfile.create({
        data: {
          user_id: user.user_id,
          role_id: role.role_id,
          department_id: department.department_id,
          is_active: true,
          updated_by: actorUserId,
        },
        select: {
          staff_id: true,
          user_id: true,
        },
      });

      const permissionRows = moduleKeys.map((moduleKey) => {
        const permission = normalizedPermissions[moduleKey] ?? {
          can_create: false,
          can_read: false,
          can_update: false,
          can_delete: false,
        };

        return {
          staff_id: staff.staff_id,
          module: moduleKey,
          can_create: permission.can_create,
          can_read: permission.can_read,
          can_update: permission.can_update,
          can_delete: permission.can_delete,
        };
      });

      await tx.staffPermission.createMany({
        data: permissionRows,
      });

      await tx.staffActivityLog.create({
        data: {
          staff_id: staff.staff_id,
          user_id: actorUserId,
          action: "STAFF_ASSIGNED",
          details: toJsonString({
            userId,
            roleKey,
            departmentKey,
          }),
          ip_address: context?.ipAddress ?? null,
          user_agent: context?.userAgent ?? null,
          request_id: this.requestId,
        },
      });

      return {
        staff_id: toNumber(staff.staff_id),
        user_id: toNumber(staff.user_id),
      };
    });

    return {
      ...created,
      name: `${user.first_name} ${user.last_name}`.trim(),
      email: user.email,
      role: roleKey,
      department: departmentKey,
      message: "User has been assigned as staff member",
    };
  }

  private generateTemporaryPassword(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
    const bytes = crypto.randomBytes(12);
    let output = "";
    for (let i = 0; i < bytes.length; i += 1) {
      output += chars[bytes[i] % chars.length];
    }
    return output;
  }

  async exportStaffList(
    filter: StaffExportFilter,
    staffInfo?: string,
    role?: StaffRole,
    dateFilter?: StaffExportDateFilter,
    customStartDate?: string,
    customEndDate?: string,
    department?: Department,
    format: StaffExportFormat = "csv"
  ): Promise<Buffer> {
    const where: Prisma.StaffProfileWhereInput = {};

    const normalizedFilter = normalizeText(filter) ?? "all";
    if (normalizedFilter !== "all" && normalizedFilter !== "specific") {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.INVALID_FILTER_TYPE,
        "Invalid filter. Allowed: all, specific",
        400,
        this.requestId,
        { filter }
      );
    }

    if (role) {
      where.role = { role_key: role };
    }

    if (department) {
      where.department = { department_key: department };
    }

    const searchTerm = normalizeText(staffInfo);
    if (normalizedFilter === "specific" && searchTerm) {
      where.OR = [
        { user: { first_name: { contains: searchTerm } } },
        { user: { last_name: { contains: searchTerm } } },
        { user: { email: { contains: searchTerm } } },
      ];
    }

    const normalizedDateFilter = (dateFilter ?? "all").toLowerCase();
    if (normalizedDateFilter !== "all") {
      if (!isDateFilter(normalizedDateFilter)) {
        throw createStaffMgmtError(
          StaffMgmtErrorCode.INVALID_DATE_RANGE,
          "Invalid date_filter. Allowed: all, today, yesterday, this_week, this_month, custom",
          400,
          this.requestId,
          { date_filter: dateFilter }
        );
      }

      const range = toDateRange(
        normalizedDateFilter,
        this.requestId,
        customStartDate,
        customEndDate
      );

      where.joined_at = {
        gte: range.start,
        lte: range.end,
      };
    }

    const total = await prisma.staffProfile.count({ where });
    if (total > MAX_EXPORT_ROWS) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.EXPORT_TOO_LARGE,
        `Export exceeds maximum row limit (${MAX_EXPORT_ROWS})`,
        413,
        this.requestId,
        {
          total,
          maxRows: MAX_EXPORT_ROWS,
        }
      );
    }

    const rows = await prisma.staffProfile.findMany({
      where,
      include: {
        user: {
          select: {
            user_id: true,
            first_name: true,
            last_name: true,
            email: true,
            contact: true,
            profile_url: true,
          },
        },
        role: {
          select: {
            role_name: true,
            role_key: true,
          },
        },
        department: {
          select: {
            department_name: true,
            department_key: true,
          },
        },
      },
      orderBy: { joined_at: "desc" },
    });

    const exportRows = rows.map((row) => ({
      staff_id: toNumber(row.staff_id),
      user_id: toNumber(row.user.user_id),
      name: `${row.user.first_name} ${row.user.last_name}`.trim(),
      email: row.user.email,
      phone: row.user.contact ?? "",
      role: row.role.role_name,
      role_key: row.role.role_key,
      department: row.department.department_name,
      department_key: row.department.department_key,
      status: row.is_active ? "Active" : "Inactive",
      joined_at: row.joined_at.toISOString(),
      profile_image: row.user.profile_url ?? "",
    }));

    if (format === "xlsx") {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Staff");

      worksheet.columns = [
        { header: "Staff ID", key: "staff_id", width: 12 },
        { header: "User ID", key: "user_id", width: 12 },
        { header: "Name", key: "name", width: 28 },
        { header: "Email", key: "email", width: 32 },
        { header: "Phone", key: "phone", width: 20 },
        { header: "Role", key: "role", width: 22 },
        { header: "Role Key", key: "role_key", width: 20 },
        { header: "Department", key: "department", width: 22 },
        { header: "Department Key", key: "department_key", width: 20 },
        { header: "Status", key: "status", width: 14 },
        { header: "Joined At", key: "joined_at", width: 28 },
        { header: "Profile Image", key: "profile_image", width: 40 },
      ];

      for (const row of exportRows) {
        worksheet.addRow(row);
      }

      const workbookBuffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(workbookBuffer as ArrayBuffer);
    }

    const headers = [
      "Staff ID",
      "User ID",
      "Name",
      "Email",
      "Phone",
      "Role",
      "Role Key",
      "Department",
      "Department Key",
      "Status",
      "Joined At",
      "Profile Image",
    ];

    const lines = [
      headers.join(","),
      ...exportRows.map((row) =>
        [
          row.staff_id,
          row.user_id,
          row.name,
          row.email,
          row.phone,
          row.role,
          row.role_key,
          row.department,
          row.department_key,
          row.status,
          row.joined_at,
          row.profile_image,
        ]
          .map(escapeCsv)
          .join(",")
      ),
    ];

    return Buffer.from(lines.join("\n"), "utf8");
  }
}
