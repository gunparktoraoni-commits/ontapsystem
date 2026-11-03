import crypto from "node:crypto";
import { prisma } from "@/server/lib/prisma";
import {
  hashPassword,
  logAuditEvent,
  revokeAllSessions,
  revokedSessionData,
  validatePassword,
  verifyPassword,
} from "@/server/lib/auth";
import { SettingsErrorCode, createSettingsError } from "@/lib/errors/settings-errors";
import { EncryptionService } from "@/lib/services/encryption.service";
import { TwoFactorService } from "@/lib/services/two-factor.service";
import { resolveLoginGeoFromIp } from "@/lib/services/geolocation.service";

export type NotificationFrequency = "daily" | "weekly" | "semi_monthly" | "monthly";

export type SuperadminNotificationPreferences = {
  user_activity: {
    new_registration: boolean;
    user_report_frequency: NotificationFrequency;
    inactive_users: boolean;
    transactions: boolean;
    company_requests: boolean;
  };
  security: {
    multiple_devices: boolean;
    security_report_frequency: NotificationFrequency;
    staff_device_login: boolean;
    account_lockouts: boolean;
  };
  staff_activity: {
    company_changes: boolean;
    user_record_modifications: boolean;
    staff_activity_report_frequency: NotificationFrequency;
    staff_password_changes: boolean;
  };
  system_health: {
    server_downtime: boolean;
    page_load_speed: boolean;
    high_error_rates: boolean;
    failed_cron_jobs: boolean;
    system_health_report_frequency: NotificationFrequency;
  };
  affiliate: {
    payout_alerts: boolean;
    most_used_codes: boolean;
    affiliate_report_frequency: NotificationFrequency;
  };
  transaction: {
    new_bizcard_orders: boolean;
    new_subscriptions: boolean;
    cancelled_orders: boolean;
    completed_orders: boolean;
    order_report_frequency: NotificationFrequency;
  };
};

export type SuperadminNotificationPreferencesUpdate = {
  [K in keyof SuperadminNotificationPreferences]?: Partial<SuperadminNotificationPreferences[K]>;
};

export type ProfileUpdateInput = {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  location?: string;
  profile_image?: string;
  cover_image?: string;
};

export type SecuritySettingsUpdateInput = {
  auto_logout_minutes?: number;
  login_notifications?: boolean;
  password_rotation_days?: number;
  suspicious_ips?: string[];
};

export type AddPaymentChannelInput = {
  bank_name: string;
  account_name: string;
  account_number: string;
  account_type?: "checking" | "savings" | "business";
  routing_number?: string;
  swift_code?: string;
  is_default?: boolean;
};

export type UpdatePaymentChannelInput = {
  bank_name?: string;
  account_name?: string;
  account_number?: string;
  account_type?: "checking" | "savings" | "business";
  routing_number?: string;
  swift_code?: string;
  is_default?: boolean;
};

const DEFAULT_NOTIFICATIONS: SuperadminNotificationPreferences = {
  user_activity: {
    new_registration: true,
    user_report_frequency: "weekly",
    inactive_users: false,
    transactions: true,
    company_requests: true,
  },
  security: {
    multiple_devices: true,
    security_report_frequency: "daily",
    staff_device_login: true,
    account_lockouts: true,
  },
  staff_activity: {
    company_changes: true,
    user_record_modifications: true,
    staff_activity_report_frequency: "weekly",
    staff_password_changes: true,
  },
  system_health: {
    server_downtime: true,
    page_load_speed: false,
    high_error_rates: true,
    failed_cron_jobs: true,
    system_health_report_frequency: "daily",
  },
  affiliate: {
    payout_alerts: true,
    most_used_codes: false,
    affiliate_report_frequency: "weekly",
  },
  transaction: {
    new_bizcard_orders: true,
    new_subscriptions: true,
    cancelled_orders: true,
    completed_orders: true,
    order_report_frequency: "daily",
  },
};

const FREQUENCIES = new Set<NotificationFrequency>([
  "daily",
  "weekly",
  "semi_monthly",
  "monthly",
]);

const IPV4_REGEX =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6_REGEX = /^([0-9a-fA-F]{1,4}:){1,7}[0-9a-fA-F]{1,4}$/;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePreferencesBlob(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isObjectRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function randomPreferenceId(): string {
  return `npref_${crypto.randomBytes(8).toString("hex")}`;
}

function parseDeviceInfo(userAgent: string | null | undefined): {
  deviceType: string;
  browser: string;
  os: string;
} {
  const ua = (userAgent ?? "").toLowerCase();

  let deviceType = "desktop";
  if (/(iphone|ipad|android|mobile)/.test(ua)) {
    deviceType = "mobile";
  } else if (/(tablet)/.test(ua)) {
    deviceType = "tablet";
  }

  let browser = "Unknown";
  if (ua.includes("edg/")) browser = "Edge";
  else if (ua.includes("chrome/")) browser = "Chrome";
  else if (ua.includes("safari/") && !ua.includes("chrome/")) browser = "Safari";
  else if (ua.includes("firefox/")) browser = "Firefox";

  let os = "Unknown";
  if (ua.includes("windows")) os = "Windows";
  else if (ua.includes("mac os")) os = "macOS";
  else if (ua.includes("android")) os = "Android";
  else if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ios")) os = "iOS";
  else if (ua.includes("linux")) os = "Linux";

  return { deviceType, browser, os };
}

function maskAccountNumber(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "****";
  return `****${trimmed.slice(-4)}`;
}

function validateFrequency(value: unknown, requestId: string): value is NotificationFrequency {
  if (typeof value !== "string" || !FREQUENCIES.has(value as NotificationFrequency)) {
    throw createSettingsError(
      SettingsErrorCode.INVALID_FREQUENCY,
      "Invalid notification frequency",
      400,
      requestId,
      { value }
    );
  }
  return true;
}

function ensureIpList(ips: string[], requestId: string): string[] {
  const normalized = ips.map((entry) => entry.trim()).filter((entry) => entry.length > 0);

  if (normalized.length > 100) {
    throw createSettingsError(
      SettingsErrorCode.INVALID_IP_BLOCK_LIST,
      "Suspicious IP list cannot exceed 100 entries",
      400,
      requestId,
      { count: normalized.length }
    );
  }

  for (const ip of normalized) {
    if (!IPV4_REGEX.test(ip) && !IPV6_REGEX.test(ip)) {
      throw createSettingsError(
        SettingsErrorCode.INVALID_IP_BLOCK_LIST,
        "One or more suspicious IP entries are invalid",
        400,
        requestId,
        { ip }
      );
    }
  }

  return normalized;
}

function toPreferencePayload(
  payload: SuperadminNotificationPreferencesUpdate,
  requestId: string
): SuperadminNotificationPreferencesUpdate {
  const next: SuperadminNotificationPreferencesUpdate = {};

  if (payload.user_activity) {
    const userActivity = payload.user_activity;
    if (
      userActivity.user_report_frequency !== undefined &&
      validateFrequency(userActivity.user_report_frequency, requestId)
    ) {
      // validated
    }
    next.user_activity = { ...userActivity } as SuperadminNotificationPreferences["user_activity"];
  }

  if (payload.security) {
    const security = payload.security;
    if (
      security.security_report_frequency !== undefined &&
      validateFrequency(security.security_report_frequency, requestId)
    ) {
      // validated
    }
    next.security = { ...security } as SuperadminNotificationPreferences["security"];
  }

  if (payload.staff_activity) {
    const staffActivity = payload.staff_activity;
    if (
      staffActivity.staff_activity_report_frequency !== undefined &&
      validateFrequency(staffActivity.staff_activity_report_frequency, requestId)
    ) {
      // validated
    }
    next.staff_activity = {
      ...staffActivity,
    } as SuperadminNotificationPreferences["staff_activity"];
  }

  if (payload.system_health) {
    const systemHealth = payload.system_health;
    if (
      systemHealth.system_health_report_frequency !== undefined &&
      validateFrequency(systemHealth.system_health_report_frequency, requestId)
    ) {
      // validated
    }
    next.system_health = {
      ...systemHealth,
    } as SuperadminNotificationPreferences["system_health"];
  }

  if (payload.affiliate) {
    const affiliate = payload.affiliate;
    if (
      affiliate.affiliate_report_frequency !== undefined &&
      validateFrequency(affiliate.affiliate_report_frequency, requestId)
    ) {
      // validated
    }
    next.affiliate = { ...affiliate } as SuperadminNotificationPreferences["affiliate"];
  }

  if (payload.transaction) {
    const transaction = payload.transaction;
    if (
      transaction.order_report_frequency !== undefined &&
      validateFrequency(transaction.order_report_frequency, requestId)
    ) {
      // validated
    }
    next.transaction = {
      ...transaction,
    } as SuperadminNotificationPreferences["transaction"];
  }

  return next;
}

export class SuperadminSettingsService {
  private readonly requestId: string;
  private readonly encryptionService: EncryptionService;
  private readonly twoFactorService: TwoFactorService;

  constructor(requestId: string) {
    this.requestId = requestId;
    this.encryptionService = new EncryptionService(requestId);
    this.twoFactorService = new TwoFactorService(requestId);
  }

  async getProfile(userId: number): Promise<{
    user_id: number;
    name: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
    location: string | null;
    profile_image: string | null;
    cover_image: string | null;
    serial_id: string | null;
    role: string;
    member_since: Date;
  }> {
    const user = await prisma.user.findUnique({
      where: { user_id: BigInt(userId) },
      select: {
        user_id: true,
        first_name: true,
        last_name: true,
        email: true,
        contact: true,
        location: true,
        profile_url: true,
        cover_url: true,
        serial_id: true,
        role: true,
        created_at: true,
      },
    });

    if (!user) {
      throw createSettingsError(
        SettingsErrorCode.PROFILE_NOT_FOUND,
        "Superadmin profile not found",
        404,
        this.requestId,
        { userId }
      );
    }

    return {
      user_id: Number(user.user_id),
      name: `${user.first_name} ${user.last_name}`.trim(),
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      phone: user.contact,
      location: user.location,
      profile_image: user.profile_url,
      cover_image: user.cover_url,
      serial_id: user.serial_id,
      role: user.role,
      member_since: user.created_at,
    };
  }

  async updateProfile(userId: number, updates: ProfileUpdateInput): Promise<{
    user_id: number;
    name: string;
    email: string;
    phone: string | null;
    location: string | null;
    message: string;
  }> {
    if (updates.email) {
      const existing = await prisma.user.findFirst({
        where: {
          email: updates.email,
          user_id: { not: BigInt(userId) },
        },
        select: { user_id: true },
      });

      if (existing) {
        throw createSettingsError(
          SettingsErrorCode.INVALID_EMAIL,
          "Email already in use",
          409,
          this.requestId,
          { email: updates.email }
        );
      }
    }

    if (updates.phone !== undefined && updates.phone !== null) {
      const phone = updates.phone.trim();
      if (phone.length > 20 || (phone.length > 0 && !/^[0-9+\-()\s.]{1,20}$/.test(phone))) {
        throw createSettingsError(
          SettingsErrorCode.INVALID_PHONE,
          "Invalid phone format",
          400,
          this.requestId,
          { phone: updates.phone }
        );
      }
    }

    const data: Record<string, unknown> = {};
    if (updates.first_name !== undefined) data.first_name = updates.first_name.trim();
    if (updates.last_name !== undefined) data.last_name = updates.last_name.trim();
    if (updates.email !== undefined) data.email = updates.email.trim().toLowerCase();
    if (updates.phone !== undefined) data.contact = updates.phone.trim() || null;
    if (updates.location !== undefined) data.location = updates.location.trim() || null;
    if (updates.profile_image !== undefined) data.profile_url = updates.profile_image.trim() || null;
    if (updates.cover_image !== undefined) data.cover_url = updates.cover_image.trim() || null;

    const updated = await prisma.user.update({
      where: { user_id: BigInt(userId) },
      data,
      select: {
        user_id: true,
        first_name: true,
        last_name: true,
        email: true,
        contact: true,
        location: true,
      },
    });

    await logAuditEvent("SUPERADMIN_SETTINGS_PROFILE_UPDATED", userId, undefined, undefined, {
      requestId: this.requestId,
      updatedFields: Object.keys(data),
    });

    return {
      user_id: Number(updated.user_id),
      name: `${updated.first_name} ${updated.last_name}`.trim(),
      email: updated.email,
      phone: updated.contact,
      location: updated.location,
      message: "Profile updated successfully",
    };
  }

  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<void> {
    const credential = await prisma.credential.findUnique({
      where: { user_id: BigInt(userId) },
      select: { credentials_id: true, password_hash: true },
    });

    if (!credential) {
      throw createSettingsError(
        SettingsErrorCode.PROFILE_NOT_FOUND,
        "Credential record not found",
        404,
        this.requestId,
        { userId }
      );
    }

    const isValidCurrent = await verifyPassword(currentPassword, credential.password_hash);
    if (!isValidCurrent) {
      throw createSettingsError(
        SettingsErrorCode.INCORRECT_CURRENT_PASSWORD,
        "Current password is incorrect",
        401,
        this.requestId
      );
    }

    const strength = validatePassword(newPassword);
    if (!strength.valid) {
      throw createSettingsError(
        SettingsErrorCode.PASSWORD_TOO_WEAK,
        "Password does not meet security requirements",
        400,
        this.requestId,
        { errors: strength.errors }
      );
    }

    const isSame = await verifyPassword(newPassword, credential.password_hash);
    if (isSame) {
      throw createSettingsError(
        SettingsErrorCode.PASSWORD_SAME_AS_OLD,
        "New password cannot be the same as the old password",
        400,
        this.requestId
      );
    }

    const hashedPassword = await hashPassword(newPassword);
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.credential.update({
        where: { credentials_id: credential.credentials_id },
        data: {
          password_hash: hashedPassword,
          password_changed_at: now,
          must_change_password: false,
          updated_at: now,
        },
      });

      await tx.passwordHistory.create({
        data: {
          user_id: BigInt(userId),
          password_hash: hashedPassword,
        },
      });
    });

    await revokeAllSessions(userId);
    await logAuditEvent("SUPERADMIN_SETTINGS_PASSWORD_CHANGED", userId, undefined, undefined, {
      requestId: this.requestId,
    });
  }

  async getSecuritySettings(userId: number): Promise<{
    two_factor_enabled: boolean;
    auto_logout_minutes: number;
    auto_logout_enabled: boolean;
    login_notifications_enabled: boolean;
    password_rotation_days: number;
    password_rotation_enabled: boolean;
    suspicious_ips: string[];
  }> {
    const user = await prisma.user.findUnique({
      where: { user_id: BigInt(userId) },
      select: {
        two_factor_enabled: true,
        auto_logout_minutes: true,
        login_notifications: true,
        password_rotation_days: true,
        suspicious_ips: true,
      },
    });

    if (!user) {
      throw createSettingsError(
        SettingsErrorCode.PROFILE_NOT_FOUND,
        "User not found",
        404,
        this.requestId,
        { userId }
      );
    }

    const suspiciousIps = Array.isArray(user.suspicious_ips)
      ? user.suspicious_ips.map((entry) => String(entry))
      : [];

    return {
      two_factor_enabled: user.two_factor_enabled,
      auto_logout_minutes: user.auto_logout_minutes,
      auto_logout_enabled: true,
      login_notifications_enabled: user.login_notifications,
      password_rotation_days: user.password_rotation_days,
      password_rotation_enabled: true,
      suspicious_ips: suspiciousIps,
    };
  }

  async updateSecuritySettings(
    userId: number,
    settings: SecuritySettingsUpdateInput
  ): Promise<{ message: string }> {
    const data: Record<string, unknown> = {};

    if (settings.auto_logout_minutes !== undefined) {
      if (!Number.isInteger(settings.auto_logout_minutes) || settings.auto_logout_minutes < 1) {
        throw createSettingsError(
          SettingsErrorCode.INVALID_AUTO_LOGOUT_VALUE,
          "Auto logout minutes must be at least 1",
          400,
          this.requestId,
          { auto_logout_minutes: settings.auto_logout_minutes }
        );
      }
      data.auto_logout_minutes = settings.auto_logout_minutes;
    }

    if (settings.password_rotation_days !== undefined) {
      if (!Number.isInteger(settings.password_rotation_days) || settings.password_rotation_days < 1) {
        throw createSettingsError(
          SettingsErrorCode.INVALID_PASSWORD_ROTATION_DAYS,
          "Password rotation days must be at least 1",
          400,
          this.requestId,
          { password_rotation_days: settings.password_rotation_days }
        );
      }
      data.password_rotation_days = settings.password_rotation_days;
    }

    if (settings.login_notifications !== undefined) {
      data.login_notifications = settings.login_notifications;
    }

    if (settings.suspicious_ips !== undefined) {
      data.suspicious_ips = ensureIpList(settings.suspicious_ips, this.requestId);
    }

    await prisma.user.update({
      where: { user_id: BigInt(userId) },
      data,
      select: { user_id: true },
    });

    await logAuditEvent("SUPERADMIN_SETTINGS_SECURITY_UPDATED", userId, undefined, undefined, {
      requestId: this.requestId,
      updatedFields: Object.keys(data),
    });

    return { message: "Security settings updated successfully" };
  }

  async setupTwoFactor(userId: number): Promise<{
    secret: string;
    qrCode: string;
    manualEntryKey: string;
    otpauthUrl: string;
  }> {
    const user = await prisma.user.findUnique({
      where: { user_id: BigInt(userId) },
      select: { email: true, two_factor_enabled: true },
    });

    if (!user) {
      throw createSettingsError(
        SettingsErrorCode.PROFILE_NOT_FOUND,
        "User not found",
        404,
        this.requestId,
        { userId }
      );
    }

    if (user.two_factor_enabled) {
      throw createSettingsError(
        SettingsErrorCode.TWO_FACTOR_ALREADY_ENABLED,
        "Two-factor authentication is already enabled",
        409,
        this.requestId,
        { userId }
      );
    }

    return this.twoFactorService.generateTwoFactorSetup(user.email);
  }

  async enableTwoFactor(userId: number, secret: string, verificationCode: string): Promise<void> {
    await this.twoFactorService.enableTwoFactor(userId, secret, verificationCode);
    await logAuditEvent("SUPERADMIN_SETTINGS_2FA_ENABLED", userId, undefined, undefined, {
      requestId: this.requestId,
    });
  }

  async disableTwoFactor(userId: number): Promise<void> {
    await this.twoFactorService.disableTwoFactor(userId);
    await logAuditEvent("SUPERADMIN_SETTINGS_2FA_DISABLED", userId, undefined, undefined, {
      requestId: this.requestId,
    });
  }

  async recordLogin(params: {
    userId: number;
    sessionId: string;
    userAgent?: string;
    ipAddress?: string;
    location?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  }): Promise<void> {
    const { deviceType, browser, os } = parseDeviceInfo(params.userAgent);
    const normalizedIp = params.ipAddress?.trim().slice(0, 45) ?? null;
    const hasResolvableIp = Boolean(normalizedIp && normalizedIp.toLowerCase() !== "unknown");

    const geo = hasResolvableIp
      ? await resolveLoginGeoFromIp(normalizedIp!, {
          location: params.location ?? null,
          latitude: params.latitude ?? null,
          longitude: params.longitude ?? null,
        })
      : {
          location: params.location?.trim() || null,
          latitude: params.latitude ?? null,
          longitude: params.longitude ?? null,
        };

    const loginTime = new Date();

    await prisma.loginHistory.create({
      data: {
        user_id: BigInt(params.userId),
        device_type: deviceType,
        browser,
        os,
        ip_address: normalizedIp,
        location: geo.location?.slice(0, 255) ?? null,
        latitude: geo.latitude ?? null,
        longitude: geo.longitude ?? null,
        session_id: params.sessionId,
        is_active: true,
        login_time: loginTime,
      },
    });
  }

  async markLogoutBySession(sessionId: string): Promise<void> {
    const { recordUserLogoutPresence } = await import("@/server/lib/user-presence");
    await recordUserLogoutPresence(sessionId);
  }

  async getLoginHistory(
    userId: number,
    page = 1,
    limit = 20,
    filters: {
      from?: Date;
      to?: Date;
      device?: string;
      active?: boolean;
    } = {}
  ): Promise<{
    history: Array<{
      login_id: number;
      session_id: string | null;
      device_type: string | null;
      browser: string | null;
      os: string | null;
      ip_address: string | null;
      location: string | null;
      login_time: string;
      logout_time: string | null;
      is_active: boolean;
    }>;
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
      has_next: boolean;
      has_previous: boolean;
    };
  }> {
    const resolvedPage = Number.isInteger(page) && page > 0 ? page : 1;
    const resolvedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20;
    const skip = (resolvedPage - 1) * resolvedLimit;

    const where: {
      user_id: bigint;
      login_time?: { gte?: Date; lte?: Date };
      os?: string;
      is_active?: boolean;
    } = { user_id: BigInt(userId) };

    if (filters.from || filters.to) {
      where.login_time = {};
      if (filters.from) where.login_time.gte = filters.from;
      if (filters.to) where.login_time.lte = filters.to;
    }

    if (filters.device) {
      where.os = filters.device;
    }

    if (typeof filters.active === "boolean") {
      where.is_active = filters.active;
    }

    const [history, total] = await Promise.all([
      prisma.loginHistory.findMany({
        where,
        orderBy: { login_time: "desc" },
        skip,
        take: resolvedLimit,
      }),
      prisma.loginHistory.count({ where }),
    ]);

    return {
      history: history.map((record) => ({
        login_id: Number(record.login_id),
        session_id: record.session_id,
        device_type: record.device_type,
        browser: record.browser,
        os: record.os,
        ip_address: record.ip_address,
        location: record.location,
        login_time: record.login_time.toISOString(),
        logout_time: record.logout_time?.toISOString() ?? null,
        is_active: record.is_active,
      })),
      pagination: {
        page: resolvedPage,
        limit: resolvedLimit,
        total,
        pages: Math.ceil(total / resolvedLimit),
        has_next: skip + resolvedLimit < total,
        has_previous: resolvedPage > 1,
      },
    };
  }

  async getActiveSessions(userId: number): Promise<{
    active_sessions: Array<{
      session_id: string;
      device_type: string | null;
      browser: string | null;
      os: string | null;
      ip_address: string | null;
      location: string | null;
      created_at: Date;
      last_activity: Date | null;
    }>;
  }> {
    const sessions = await prisma.activeSession.findMany({
      where: {
        user_id: BigInt(userId),
        OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
      },
      orderBy: { created_at: "desc" },
    });

    return {
      active_sessions: sessions.map((session) => ({
        session_id: session.session_id,
        device_type: session.device_type,
        browser: session.browser,
        os: session.os,
        ip_address: session.ip_address,
        location: session.location,
        created_at: session.created_at,
        last_activity: session.last_activity,
      })),
    };
  }

  async revokeSession(userId: number, sessionId: string): Promise<void> {
    const session = await prisma.activeSession.findUnique({
      where: { session_id: sessionId },
      select: { session_id: true, user_id: true },
    });

    if (!session || session.user_id !== BigInt(userId)) {
      throw createSettingsError(
        SettingsErrorCode.SESSION_NOT_FOUND,
        "Session not found",
        404,
        this.requestId,
        { sessionId }
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.activeSession.delete({ where: { session_id: sessionId } });
      await tx.loginHistory.updateMany({
        where: { session_id: sessionId, is_active: true },
        data: {
          is_active: false,
          logout_time: new Date(),
        },
      });
    });

    if (/^\d+$/.test(sessionId)) {
      await prisma.session.updateMany({
        where: {
          id: BigInt(sessionId),
          user_id: BigInt(userId),
        },
        data: revokedSessionData(),
      });
    }

    await logAuditEvent("SUPERADMIN_SETTINGS_SESSION_REVOKED", userId, undefined, undefined, {
      requestId: this.requestId,
      sessionId,
    });
  }

  async revokeAllOtherSessions(userId: number, currentSessionId: string): Promise<number> {
    const deleteResult = await prisma.activeSession.deleteMany({
      where: {
        user_id: BigInt(userId),
        session_id: { not: currentSessionId },
      },
    });

    await prisma.loginHistory.updateMany({
      where: {
        user_id: BigInt(userId),
        session_id: { not: currentSessionId },
        is_active: true,
      },
      data: {
        is_active: false,
        logout_time: new Date(),
      },
    });

    if (/^\d+$/.test(currentSessionId)) {
      await prisma.session.updateMany({
        where: {
          user_id: BigInt(userId),
          revoked: false,
          NOT: {
            id: BigInt(currentSessionId),
          },
        },
        data: revokedSessionData(),
      });
    } else {
      await prisma.session.updateMany({
        where: {
          user_id: BigInt(userId),
          revoked: false,
        },
        data: revokedSessionData(),
      });
    }

    await logAuditEvent("SUPERADMIN_SETTINGS_SESSIONS_REVOKED_ALL_OTHER", userId, undefined, undefined, {
      requestId: this.requestId,
      currentSessionId,
      revokedCount: deleteResult.count,
    });

    return deleteResult.count;
  }

  async exportLoginHistory(userId: number): Promise<Buffer> {
    try {
      const history = await prisma.loginHistory.findMany({
        where: { user_id: BigInt(userId) },
        orderBy: { login_time: "desc" },
      });

      const headers = [
        "Date",
        "Device Type",
        "Browser",
        "Operating System",
        "IP Address",
        "Location",
        "Status",
        "Logout Time",
      ];

      const escapeCsv = (value: string): string => {
        if (value.includes(",") || value.includes('"') || value.includes("\n")) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      };

      const rows = history.map((record) => {
        const values = [
          record.login_time.toISOString(),
          record.device_type ?? "",
          record.browser ?? "",
          record.os ?? "",
          record.ip_address ?? "",
          record.location ?? "",
          record.is_active ? "Active" : "Logged Out",
          record.logout_time ? record.logout_time.toISOString() : "Still Active",
        ];

        return values.map((value) => escapeCsv(String(value))).join(",");
      });

      return Buffer.from([headers.join(","), ...rows].join("\n"), "utf-8");
    } catch (error) {
      throw createSettingsError(
        SettingsErrorCode.LOGIN_HISTORY_EXPORT_FAILED,
        "Failed to export login history",
        500,
        this.requestId,
        { error: error instanceof Error ? error.message : "Unknown error" }
      );
    }
  }

  async getNotificationPreferences(userId: number): Promise<SuperadminNotificationPreferences> {
    let preference = await prisma.notificationPreference.findUnique({
      where: { user_id: BigInt(userId) },
    });

    if (!preference) {
      preference = await prisma.notificationPreference.create({
        data: {
          id: randomPreferenceId(),
          user_id: BigInt(userId),
          email_verified: false,
          digest_schedule: "daily",
          digest_time: "08:00",
          timezone: "UTC",
          quiet_hours: JSON.stringify({
            enabled: false,
            start: "22:00",
            end: "08:00",
            timezone: "UTC",
          }),
          preferences: JSON.stringify({ superadmin_settings: DEFAULT_NOTIFICATIONS }),
          emails_sent_today: 0,
          email_frequency_reset: new Date(),
        },
      });
    }

    const parsed = parsePreferencesBlob(preference.preferences);
    const settings = parsed.superadmin_settings;
    if (!isObjectRecord(settings)) {
      return { ...DEFAULT_NOTIFICATIONS };
    }

    return {
      user_activity: {
        ...DEFAULT_NOTIFICATIONS.user_activity,
        ...(isObjectRecord(settings.user_activity) ? settings.user_activity : {}),
      },
      security: {
        ...DEFAULT_NOTIFICATIONS.security,
        ...(isObjectRecord(settings.security) ? settings.security : {}),
      },
      staff_activity: {
        ...DEFAULT_NOTIFICATIONS.staff_activity,
        ...(isObjectRecord(settings.staff_activity) ? settings.staff_activity : {}),
      },
      system_health: {
        ...DEFAULT_NOTIFICATIONS.system_health,
        ...(isObjectRecord(settings.system_health) ? settings.system_health : {}),
      },
      affiliate: {
        ...DEFAULT_NOTIFICATIONS.affiliate,
        ...(isObjectRecord(settings.affiliate) ? settings.affiliate : {}),
      },
      transaction: {
        ...DEFAULT_NOTIFICATIONS.transaction,
        ...(isObjectRecord(settings.transaction) ? settings.transaction : {}),
      },
    };
  }

  async updateNotificationPreferences(
    userId: number,
    preferences: SuperadminNotificationPreferencesUpdate
  ): Promise<{ message: string }> {
    const updates = toPreferencePayload(preferences, this.requestId);

    let preference = await prisma.notificationPreference.findUnique({
      where: { user_id: BigInt(userId) },
      select: { id: true, preferences: true },
    });

    if (!preference) {
      preference = await prisma.notificationPreference.create({
        data: {
          id: randomPreferenceId(),
          user_id: BigInt(userId),
          email_verified: false,
          digest_schedule: "daily",
          digest_time: "08:00",
          timezone: "UTC",
          quiet_hours: JSON.stringify({
            enabled: false,
            start: "22:00",
            end: "08:00",
            timezone: "UTC",
          }),
          preferences: JSON.stringify({ superadmin_settings: DEFAULT_NOTIFICATIONS }),
          emails_sent_today: 0,
          email_frequency_reset: new Date(),
        },
        select: { id: true, preferences: true },
      });
    }

    const parsed = parsePreferencesBlob(preference.preferences);
    const currentSettings = isObjectRecord(parsed.superadmin_settings)
      ? parsed.superadmin_settings
      : DEFAULT_NOTIFICATIONS;

    const nextSettings = {
      user_activity: {
        ...DEFAULT_NOTIFICATIONS.user_activity,
        ...(isObjectRecord((currentSettings as Record<string, unknown>).user_activity)
          ? ((currentSettings as Record<string, unknown>)
              .user_activity as Record<string, unknown>)
          : {}),
        ...(updates.user_activity ?? {}),
      },
      security: {
        ...DEFAULT_NOTIFICATIONS.security,
        ...(isObjectRecord((currentSettings as Record<string, unknown>).security)
          ? ((currentSettings as Record<string, unknown>).security as Record<string, unknown>)
          : {}),
        ...(updates.security ?? {}),
      },
      staff_activity: {
        ...DEFAULT_NOTIFICATIONS.staff_activity,
        ...(isObjectRecord((currentSettings as Record<string, unknown>).staff_activity)
          ? ((currentSettings as Record<string, unknown>)
              .staff_activity as Record<string, unknown>)
          : {}),
        ...(updates.staff_activity ?? {}),
      },
      system_health: {
        ...DEFAULT_NOTIFICATIONS.system_health,
        ...(isObjectRecord((currentSettings as Record<string, unknown>).system_health)
          ? ((currentSettings as Record<string, unknown>)
              .system_health as Record<string, unknown>)
          : {}),
        ...(updates.system_health ?? {}),
      },
      affiliate: {
        ...DEFAULT_NOTIFICATIONS.affiliate,
        ...(isObjectRecord((currentSettings as Record<string, unknown>).affiliate)
          ? ((currentSettings as Record<string, unknown>).affiliate as Record<string, unknown>)
          : {}),
        ...(updates.affiliate ?? {}),
      },
      transaction: {
        ...DEFAULT_NOTIFICATIONS.transaction,
        ...(isObjectRecord((currentSettings as Record<string, unknown>).transaction)
          ? ((currentSettings as Record<string, unknown>).transaction as Record<string, unknown>)
          : {}),
        ...(updates.transaction ?? {}),
      },
    };

    const nextPreferences = {
      ...parsed,
      superadmin_settings: nextSettings,
    };

    await prisma.notificationPreference.update({
      where: { user_id: BigInt(userId) },
      data: {
        preferences: JSON.stringify(nextPreferences),
        updated_at: new Date(),
      },
      select: { id: true },
    });

    await logAuditEvent("SUPERADMIN_SETTINGS_NOTIFICATIONS_UPDATED", userId, undefined, undefined, {
      requestId: this.requestId,
      updatedCategories: Object.keys(preferences),
    });

    return { message: "Notification preferences updated successfully" };
  }

  async getPaymentChannels(userId: number): Promise<{
    channels: Array<{
      channel_id: number;
      bank_name: string;
      account_name: string;
      account_number_masked: string;
      account_type: string;
      swift_code: string | null;
      is_default: boolean;
      created_at: Date;
    }>;
  }> {
    const channels = await prisma.paymentChannel.findMany({
      where: {
        user_id: BigInt(userId),
        is_active: true,
      },
      orderBy: [{ is_default: "desc" }, { created_at: "desc" }],
    });

    return {
      channels: channels.map((channel) => {
        const accountNumber = this.encryptionService.decrypt(
          channel.account_number,
          channel.account_number_iv,
          channel.account_number_auth_tag
        );

        return {
          channel_id: Number(channel.channel_id),
          bank_name: channel.bank_name,
          account_name: channel.account_name,
          account_number_masked: maskAccountNumber(accountNumber),
          account_type: channel.account_type,
          swift_code: channel.swift_code,
          is_default: channel.is_default,
          created_at: channel.created_at,
        };
      }),
    };
  }

  async addPaymentChannel(userId: number, input: AddPaymentChannelInput): Promise<{
    channel_id: number;
    bank_name: string;
    account_name: string;
    account_number_masked: string;
    is_default: boolean;
    message: string;
  }> {
    const bankName = input.bank_name.trim();
    const accountName = input.account_name.trim();
    const accountNumber = input.account_number.trim();

    if (!bankName || !accountName || !accountNumber) {
      throw createSettingsError(
        SettingsErrorCode.INVALID_BANK_DETAILS,
        "bank_name, account_name, and account_number are required",
        400,
        this.requestId
      );
    }

    if (accountNumber.length < 4 || accountNumber.length > 64) {
      throw createSettingsError(
        SettingsErrorCode.INVALID_BANK_DETAILS,
        "account_number must be between 4 and 64 characters",
        400,
        this.requestId
      );
    }

    const encryptedAccount = this.encryptionService.encrypt(accountNumber);
    const encryptedRouting = input.routing_number
      ? this.encryptionService.encrypt(input.routing_number.trim())
      : null;

    if (input.is_default) {
      await prisma.paymentChannel.updateMany({
        where: { user_id: BigInt(userId) },
        data: { is_default: false },
      });
    }

    const channel = await prisma.paymentChannel.create({
      data: {
        user_id: BigInt(userId),
        bank_name: bankName,
        account_name: accountName,
        account_number: encryptedAccount.encryptedData,
        account_number_iv: encryptedAccount.iv,
        account_number_auth_tag: encryptedAccount.authTag,
        account_type: input.account_type ?? "checking",
        routing_number: encryptedRouting?.encryptedData ?? null,
        routing_number_iv: encryptedRouting?.iv ?? null,
        routing_number_auth_tag: encryptedRouting?.authTag ?? null,
        swift_code: input.swift_code?.trim() || null,
        is_default: input.is_default === true,
        is_active: true,
      },
    });

    await logAuditEvent("SUPERADMIN_SETTINGS_PAYMENT_CHANNEL_CREATED", userId, undefined, undefined, {
      requestId: this.requestId,
      channelId: Number(channel.channel_id),
      bankName,
    });

    return {
      channel_id: Number(channel.channel_id),
      bank_name: channel.bank_name,
      account_name: channel.account_name,
      account_number_masked: maskAccountNumber(accountNumber),
      is_default: channel.is_default,
      message: "Payment channel added successfully",
    };
  }

  async updatePaymentChannel(
    userId: number,
    channelId: number,
    updates: UpdatePaymentChannelInput
  ): Promise<{ message: string }> {
    const existing = await prisma.paymentChannel.findFirst({
      where: {
        channel_id: BigInt(channelId),
        user_id: BigInt(userId),
      },
      select: { channel_id: true },
    });

    if (!existing) {
      throw createSettingsError(
        SettingsErrorCode.PAYMENT_CHANNEL_NOT_FOUND,
        "Payment channel not found",
        404,
        this.requestId,
        { channelId }
      );
    }

    const data: Record<string, unknown> = {};

    if (updates.bank_name !== undefined) data.bank_name = updates.bank_name.trim();
    if (updates.account_name !== undefined) data.account_name = updates.account_name.trim();
    if (updates.account_type !== undefined) data.account_type = updates.account_type;
    if (updates.swift_code !== undefined) data.swift_code = updates.swift_code.trim() || null;

    if (updates.account_number !== undefined) {
      const encrypted = this.encryptionService.encrypt(updates.account_number.trim());
      data.account_number = encrypted.encryptedData;
      data.account_number_iv = encrypted.iv;
      data.account_number_auth_tag = encrypted.authTag;
    }

    if (updates.routing_number !== undefined) {
      if (updates.routing_number.trim().length === 0) {
        data.routing_number = null;
        data.routing_number_iv = null;
        data.routing_number_auth_tag = null;
      } else {
        const encrypted = this.encryptionService.encrypt(updates.routing_number.trim());
        data.routing_number = encrypted.encryptedData;
        data.routing_number_iv = encrypted.iv;
        data.routing_number_auth_tag = encrypted.authTag;
      }
    }

    if (updates.is_default !== undefined) {
      if (updates.is_default) {
        await prisma.paymentChannel.updateMany({
          where: { user_id: BigInt(userId) },
          data: { is_default: false },
        });
      }
      data.is_default = updates.is_default;
    }

    await prisma.paymentChannel.update({
      where: { channel_id: BigInt(channelId) },
      data,
    });

    await logAuditEvent("SUPERADMIN_SETTINGS_PAYMENT_CHANNEL_UPDATED", userId, undefined, undefined, {
      requestId: this.requestId,
      channelId,
      updatedFields: Object.keys(data),
    });

    return { message: "Payment channel updated successfully" };
  }

  async deletePaymentChannel(userId: number, channelId: number): Promise<void> {
    const existing = await prisma.paymentChannel.findFirst({
      where: {
        channel_id: BigInt(channelId),
        user_id: BigInt(userId),
      },
      select: { channel_id: true },
    });

    if (!existing) {
      throw createSettingsError(
        SettingsErrorCode.PAYMENT_CHANNEL_NOT_FOUND,
        "Payment channel not found",
        404,
        this.requestId,
        { channelId }
      );
    }

    await prisma.paymentChannel.update({
      where: { channel_id: BigInt(channelId) },
      data: { is_active: false, is_default: false },
    });

    await logAuditEvent("SUPERADMIN_SETTINGS_PAYMENT_CHANNEL_DELETED", userId, undefined, undefined, {
      requestId: this.requestId,
      channelId,
    });
  }

  async setDefaultPaymentChannel(userId: number, channelId: number): Promise<void> {
    const existing = await prisma.paymentChannel.findFirst({
      where: {
        channel_id: BigInt(channelId),
        user_id: BigInt(userId),
        is_active: true,
      },
      select: { channel_id: true },
    });

    if (!existing) {
      throw createSettingsError(
        SettingsErrorCode.PAYMENT_CHANNEL_NOT_FOUND,
        "Payment channel not found",
        404,
        this.requestId,
        { channelId }
      );
    }

    await prisma.$transaction([
      prisma.paymentChannel.updateMany({
        where: { user_id: BigInt(userId) },
        data: { is_default: false },
      }),
      prisma.paymentChannel.update({
        where: { channel_id: BigInt(channelId) },
        data: { is_default: true },
      }),
    ]);

    await logAuditEvent("SUPERADMIN_SETTINGS_PAYMENT_CHANNEL_SET_DEFAULT", userId, undefined, undefined, {
      requestId: this.requestId,
      channelId,
    });
  }
}
