import { prisma } from "@/server/lib/prisma";
import {
  logAuditEvent,
  validatePassword,
  verifyPassword,
} from "@/server/lib/auth";
import {
  SuperAdminErrorCode,
  createSuperAdminError,
} from "@/lib/errors/superadmin-errors";
import {
  buildPasswordCredentialPayload,
  decryptPasswordFromVault,
} from "@/server/lib/password-vault";

export const PASSWORD_VIEW_MODES = ["one_time", "timed", "permanent"] as const;
export type PasswordViewMode = (typeof PASSWORD_VIEW_MODES)[number];

export const PASSWORD_VIEW_DURATION_PRESETS = [
  { id: "1h", label: "1 hour", hours: 1 },
  { id: "24h", label: "24 hours", hours: 24 },
  { id: "7d", label: "7 days", hours: 24 * 7 },
  { id: "30d", label: "30 days", hours: 24 * 30 },
] as const;

export type PasswordViewPreference = {
  mode: PasswordViewMode;
  duration_hours: number;
};

export const DEFAULT_PASSWORD_VIEW_PREFERENCE: PasswordViewPreference = {
  mode: "one_time",
  duration_hours: 24,
};

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

function normalizePreference(raw: unknown): PasswordViewPreference {
  if (!isObjectRecord(raw)) return { ...DEFAULT_PASSWORD_VIEW_PREFERENCE };

  const mode = PASSWORD_VIEW_MODES.includes(raw.mode as PasswordViewMode)
    ? (raw.mode as PasswordViewMode)
    : DEFAULT_PASSWORD_VIEW_PREFERENCE.mode;

  const durationHours = Number(raw.duration_hours);
  const safeHours =
    Number.isFinite(durationHours) && durationHours > 0
      ? Math.min(Math.floor(durationHours), 24 * 365)
      : DEFAULT_PASSWORD_VIEW_PREFERENCE.duration_hours;

  return { mode, duration_hours: safeHours };
}

function grantIsActive(grant: {
  revoked_at: Date | null;
  expires_at: Date | null;
  mode: string;
  one_time_consumed: boolean;
}): boolean {
  if (grant.revoked_at) return false;
  if (grant.mode === "one_time" && grant.one_time_consumed) return false;
  if (grant.expires_at && grant.expires_at.getTime() <= Date.now()) return false;
  return true;
}

export class SuperadminPasswordViewService {
  constructor(private readonly requestId: string) {}

  async getPreference(superadminUserId: number): Promise<PasswordViewPreference> {
    const preference = await prisma.notificationPreference.findUnique({
      where: { user_id: BigInt(superadminUserId) },
      select: { preferences: true },
    });

    const parsed = parsePreferencesBlob(preference?.preferences);
    return normalizePreference(parsed.password_view);
  }

  async updatePreference(
    superadminUserId: number,
    next: PasswordViewPreference,
  ): Promise<PasswordViewPreference> {
    if (!PASSWORD_VIEW_MODES.includes(next.mode)) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_FILTER,
        "Invalid password view mode.",
        400,
        this.requestId,
        { mode: next.mode },
      );
    }

    if (next.mode === "timed") {
      if (!Number.isInteger(next.duration_hours) || next.duration_hours < 1) {
        throw createSuperAdminError(
          SuperAdminErrorCode.INVALID_FILTER,
          "Timed password viewing requires a positive duration in hours.",
          400,
          this.requestId,
          { duration_hours: next.duration_hours },
        );
      }
    }

    const preference = await prisma.notificationPreference.findUnique({
      where: { user_id: BigInt(superadminUserId) },
      select: { id: true, preferences: true },
    });

    const normalized: PasswordViewPreference = {
      mode: next.mode,
      duration_hours:
        next.mode === "timed"
          ? Math.min(Math.max(1, Math.floor(next.duration_hours)), 24 * 365)
          : next.duration_hours || DEFAULT_PASSWORD_VIEW_PREFERENCE.duration_hours,
    };

    if (!preference) {
      await prisma.notificationPreference.create({
        data: {
          id: `npref_${superadminUserId}_${Date.now()}`,
          user_id: BigInt(superadminUserId),
          preferences: JSON.stringify({ password_view: normalized }),
        },
      });
    } else {
      const parsed = parsePreferencesBlob(preference.preferences);
      parsed.password_view = normalized;
      await prisma.notificationPreference.update({
        where: { id: preference.id },
        data: {
          preferences: JSON.stringify(parsed),
          updated_at: new Date(),
        },
      });
    }

    await logAuditEvent(
      "SUPERADMIN_PASSWORD_VIEW_PREFERENCE_UPDATED",
      superadminUserId,
      undefined,
      undefined,
      { requestId: this.requestId, preference: normalized },
    );

    return normalized;
  }

  async getActiveGrant(superadminUserId: number, targetUserId?: number) {
    const grants = await prisma.superadminPasswordViewGrant.findMany({
      where: {
        superadmin_user_id: BigInt(superadminUserId),
        revoked_at: null,
        ...(typeof targetUserId === "number" && targetUserId > 0
          ? {
              OR: [
                { target_user_id: null },
                { target_user_id: BigInt(targetUserId) },
              ],
            }
          : {}),
      },
      orderBy: { created_at: "desc" },
      take: 20,
    });

    return grants.find((grant) => grantIsActive(grant)) ?? null;
  }

  async getPasswordStatus(superadminUserId: number, targetUserId: number) {
    const [target, credential, preference, activeGrant] = await Promise.all([
      prisma.user.findUnique({
        where: { user_id: BigInt(targetUserId) },
        select: {
          user_id: true,
          first_name: true,
          last_name: true,
          email: true,
          role: true,
          deactivated_flag: true,
        },
      }),
      prisma.credential.findUnique({
        where: { user_id: BigInt(targetUserId) },
        select: {
          password_encrypted: true,
          password_changed_at: true,
          must_change_password: true,
        },
      }),
      this.getPreference(superadminUserId),
      this.getActiveGrant(superadminUserId, targetUserId),
    ]);

    if (!target || target.deactivated_flag) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_FILTER,
        "Target user not found.",
        404,
        this.requestId,
        { targetUserId },
      );
    }

    if (target.role === "super_admin") {
      throw createSuperAdminError(
        SuperAdminErrorCode.IMPERSONATION_NOT_ALLOWED,
        "Cannot manage password for another superadmin.",
        403,
        this.requestId,
        { targetUserId },
      );
    }

    return {
      target: {
        user_id: Number(target.user_id),
        name: [target.first_name, target.last_name].filter(Boolean).join(" ").trim() || target.email,
        email: target.email,
      },
      vault_available: Boolean(credential?.password_encrypted),
      password_changed_at: credential?.password_changed_at?.toISOString() ?? null,
      must_change_password: Boolean(credential?.must_change_password),
      preference,
      active_grant: activeGrant
        ? {
            grant_id: Number(activeGrant.grant_id),
            mode: activeGrant.mode as PasswordViewMode,
            duration_hours: activeGrant.duration_hours,
            expires_at: activeGrant.expires_at?.toISOString() ?? null,
            one_time_consumed: activeGrant.one_time_consumed,
            requires_reauth: false,
          }
        : null,
      requires_reauth: !activeGrant,
    };
  }

  private async verifySuperadminPassword(superadminUserId: number, password: string) {
    const credential = await prisma.credential.findUnique({
      where: { user_id: BigInt(superadminUserId) },
      select: { password_hash: true },
    });

    if (!credential?.password_hash) {
      throw createSuperAdminError(
        SuperAdminErrorCode.UNAUTHORIZED_ACCESS,
        "Superadmin credentials not found.",
        401,
        this.requestId,
      );
    }

    const matches = await verifyPassword(password, credential.password_hash);
    if (!matches) {
      throw createSuperAdminError(
        SuperAdminErrorCode.UNAUTHORIZED_ACCESS,
        "Incorrect superadmin password.",
        401,
        this.requestId,
      );
    }
  }

  private async createGrant(
    superadminUserId: number,
    targetUserId: number,
    mode: PasswordViewMode,
    durationHours: number,
  ) {
    // Revoke prior active grants for this SA (keep history via revoked_at).
    await prisma.superadminPasswordViewGrant.updateMany({
      where: {
        superadmin_user_id: BigInt(superadminUserId),
        revoked_at: null,
      },
      data: {
        revoked_at: new Date(),
        updated_at: new Date(),
      },
    });

    const expiresAt =
      mode === "timed"
        ? new Date(Date.now() + durationHours * 60 * 60 * 1000)
        : mode === "one_time"
          ? null
          : null;

    return prisma.superadminPasswordViewGrant.create({
      data: {
        superadmin_user_id: BigInt(superadminUserId),
        // Timed/permanent grants unlock viewing across users; one-time stays scoped.
        target_user_id: mode === "one_time" ? BigInt(targetUserId) : null,
        mode,
        duration_hours: mode === "timed" ? durationHours : null,
        expires_at: expiresAt,
        one_time_consumed: false,
      },
    });
  }

  async revealPassword(input: {
    superadminUserId: number;
    targetUserId: number;
    superadminPassword?: string;
    mode?: PasswordViewMode;
    durationHours?: number;
    ip?: string;
    userAgent?: string;
  }) {
    const status = await this.getPasswordStatus(input.superadminUserId, input.targetUserId);

    if (!status.vault_available) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_FILTER,
        "This user's password is not available for viewing. Set a new password to enable vault recovery.",
        409,
        this.requestId,
        { targetUserId: input.targetUserId },
      );
    }

    let grant = await this.getActiveGrant(input.superadminUserId, input.targetUserId);
    const needsReauth = !grant;

    if (needsReauth) {
      if (!input.superadminPassword?.trim()) {
        throw createSuperAdminError(
          SuperAdminErrorCode.UNAUTHORIZED_ACCESS,
          "Superadmin password is required to reveal this password.",
          401,
          this.requestId,
        );
      }

      await this.verifySuperadminPassword(input.superadminUserId, input.superadminPassword.trim());

      const preference = status.preference;
      const mode = input.mode ?? preference.mode;
      const durationHours =
        input.durationHours ??
        (mode === "timed" ? preference.duration_hours : preference.duration_hours);

      if (!PASSWORD_VIEW_MODES.includes(mode)) {
        throw createSuperAdminError(
          SuperAdminErrorCode.INVALID_FILTER,
          "Invalid password view mode.",
          400,
          this.requestId,
          { mode },
        );
      }

      grant = await this.createGrant(
        input.superadminUserId,
        input.targetUserId,
        mode,
        durationHours,
      );

      // Persist chosen mode as the SA default for next time.
      await this.updatePreference(input.superadminUserId, {
        mode,
        duration_hours: durationHours,
      });
    }

    if (!grant) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INTERNAL_ERROR,
        "Password view grant could not be established.",
        500,
        this.requestId,
      );
    }

    const activeGrant = grant;

    const credential = await prisma.credential.findUnique({
      where: { user_id: BigInt(input.targetUserId) },
      select: { password_encrypted: true },
    });

    if (!credential?.password_encrypted) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_FILTER,
        "Password vault entry is missing.",
        409,
        this.requestId,
      );
    }

    let plaintext: string;
    try {
      plaintext = decryptPasswordFromVault(credential.password_encrypted, this.requestId);
    } catch {
      throw createSuperAdminError(
        SuperAdminErrorCode.INTERNAL_ERROR,
        "Failed to decrypt password vault entry.",
        500,
        this.requestId,
      );
    }

    if (activeGrant.mode === "one_time") {
      await prisma.superadminPasswordViewGrant.update({
        where: { grant_id: activeGrant.grant_id },
        data: {
          one_time_consumed: true,
          updated_at: new Date(),
        },
      });
    }

    await logAuditEvent(
      "SUPERADMIN_PASSWORD_REVEALED",
      input.superadminUserId,
      input.ip,
      input.userAgent,
      {
        requestId: this.requestId,
        targetUserId: input.targetUserId,
        mode: activeGrant.mode,
        requiredReauth: needsReauth,
      },
    );

    await prisma.clientAuditLog.create({
      data: {
        client_user_id: BigInt(input.targetUserId),
        action: "PASSWORD_VIEWED_BY_SUPERADMIN",
        performed_by: BigInt(input.superadminUserId),
        new_values: JSON.stringify({
          mode: activeGrant.mode,
          grant_id: Number(activeGrant.grant_id),
        }),
        ip_address: input.ip ?? null,
        user_agent: input.userAgent ?? null,
        request_id: this.requestId,
      },
    });

    return {
      password: plaintext,
      mode: activeGrant.mode as PasswordViewMode,
      expires_at: activeGrant.expires_at?.toISOString() ?? null,
      one_time: activeGrant.mode === "one_time",
      required_reauth: needsReauth,
    };
  }

  async changeUserPassword(input: {
    superadminUserId: number;
    targetUserId: number;
    superadminPassword: string;
    newPassword: string;
    confirmPassword: string;
    mustChangePassword?: boolean;
    ip?: string;
    userAgent?: string;
  }) {
    await this.getPasswordStatus(input.superadminUserId, input.targetUserId);
    await this.verifySuperadminPassword(input.superadminUserId, input.superadminPassword.trim());

    if (input.newPassword !== input.confirmPassword) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_FILTER,
        "New password and confirmation do not match.",
        400,
        this.requestId,
      );
    }

    const validation = validatePassword(input.newPassword);
    if (!validation.valid) {
      throw createSuperAdminError(
        SuperAdminErrorCode.INVALID_FILTER,
        validation.errors[0] || "Password does not meet requirements.",
        400,
        this.requestId,
        { errors: validation.errors },
      );
    }

    const payload = await buildPasswordCredentialPayload(input.newPassword, this.requestId);

    await prisma.credential.upsert({
      where: { user_id: BigInt(input.targetUserId) },
      update: {
        password_hash: payload.password_hash,
        password_encrypted: payload.password_encrypted,
        password_changed_at: payload.password_changed_at,
        must_change_password: Boolean(input.mustChangePassword),
        updated_at: payload.updated_at,
      },
      create: {
        user_id: BigInt(input.targetUserId),
        password_hash: payload.password_hash,
        password_encrypted: payload.password_encrypted,
        password_changed_at: payload.password_changed_at,
        must_change_password: Boolean(input.mustChangePassword),
        email_verified: true,
        email_verified_at: new Date(),
      },
    });

    await logAuditEvent(
      "SUPERADMIN_USER_PASSWORD_CHANGED",
      input.superadminUserId,
      input.ip,
      input.userAgent,
      {
        requestId: this.requestId,
        targetUserId: input.targetUserId,
        mustChangePassword: Boolean(input.mustChangePassword),
      },
    );

    await prisma.clientAuditLog.create({
      data: {
        client_user_id: BigInt(input.targetUserId),
        action: "PASSWORD_CHANGED_BY_SUPERADMIN",
        performed_by: BigInt(input.superadminUserId),
        new_values: JSON.stringify({
          must_change_password: Boolean(input.mustChangePassword),
        }),
        ip_address: input.ip ?? null,
        user_agent: input.userAgent ?? null,
        request_id: this.requestId,
      },
    });

    return {
      message: "User password updated successfully.",
      vault_available: Boolean(payload.password_encrypted),
      must_change_password: Boolean(input.mustChangePassword),
    };
  }

  async revokeGrants(superadminUserId: number) {
    await prisma.superadminPasswordViewGrant.updateMany({
      where: {
        superadmin_user_id: BigInt(superadminUserId),
        revoked_at: null,
      },
      data: {
        revoked_at: new Date(),
        updated_at: new Date(),
      },
    });

    await logAuditEvent(
      "SUPERADMIN_PASSWORD_VIEW_GRANTS_REVOKED",
      superadminUserId,
      undefined,
      undefined,
      { requestId: this.requestId },
    );

    return { message: "Password viewing access revoked." };
  }
}
