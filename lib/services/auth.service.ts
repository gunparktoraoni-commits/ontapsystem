import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";
import { prismaAnalytics } from "@/server/lib/prisma-analytics";
import {
  createSession,
  destroySession,
  isReverificationRequired,
  logAuditEvent,
  refreshSession,
  revokeAllSessions,
  validatePassword,
  verifyPassword,
} from "@/server/lib/auth";
import { buildPasswordCredentialPayload } from "@/server/lib/password-vault";
import {
  checkAccountLockout,
  recordFailedAttempt,
  recordSuccessfulLogin,
} from "@/server/lib/rate-limit";
import { sendVerificationEmail } from "@/server/lib/email";
import { logAdminAudit } from "@/lib/services/adminAuditService";
import { AuthErrorCode, createAuthError } from "@/lib/errors/auth-errors";
import { SuperadminSettingsService } from "@/lib/services/superadmin-settings.service";

const DUMMY_HASH = "$2a$12$LJ3m4ys3Lz0Yc3LRXBBXHO0000000000000000000000000000000";
const PASSWORD_RESET_TOKEN_BYTES = 18;
const PASSWORD_RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000;
const STAFF_INVITE_TOKEN_MIN_LENGTH = 16;

export const ADMIN_AUTH_ALLOWED_ROLES = ["super_admin", "staff", "dev"] as const;

const ADMIN_ROLE_SET = new Set<string>(ADMIN_AUTH_ALLOWED_ROLES);

export interface AuthRequestContext {
  ipAddress?: string;
  userAgent?: string;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface AdminLoginInput {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface AdminResetPasswordInput {
  token: string;
  newPassword: string;
  confirmPassword: string;
}

export interface AdminPasswordChangeInput {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface AdminSessionActor {
  userId: number;
  email: string;
  role: string;
  rememberMe: boolean;
  sessionId?: number;
}

interface AdminUserSnapshot {
  userId: number;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  customUri: string | null;
  requiresPasswordChange: boolean;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isAllowedAdminRole(role: string): boolean {
  return ADMIN_ROLE_SET.has(role.toLowerCase());
}

function generateResetToken(): string {
  return crypto.randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString("hex").toUpperCase();
}

function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashStaffInviteToken(token: string): string {
  return crypto.createHash("sha256").update(token.trim()).digest("hex");
}

function maskEmail(email: string): string {
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return "***";
  return `${localPart.slice(0, 1)}***@${domain}`;
}

function toUserSnapshot(input: {
  user_id: bigint;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  custom_uri: string | null;
  credentials: { must_change_password: boolean | null } | null;
}): AdminUserSnapshot {
  return {
    userId: Number(input.user_id),
    email: input.email,
    firstName: input.first_name,
    lastName: input.last_name,
    role: input.role,
    customUri: input.custom_uri,
    requiresPasswordChange: input.credentials?.must_change_password === true,
  };
}

export class AdminAuthService {
  private readonly requestId: string;

  constructor(requestId: string) {
    this.requestId = requestId;
  }

  private async writeAdminAudit(
    userId: number,
    email: string,
    action: string,
    details: Record<string, unknown> | undefined,
    context: AuthRequestContext
  ): Promise<void> {
    await logAdminAudit({
      adminUserId: BigInt(userId),
      adminEmail: email,
      action,
      details,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  }

  private assertAdminRole(role: string): void {
    if (!isAllowedAdminRole(role)) {
      throw createAuthError(
        AuthErrorCode.ADMIN_ROLE_REQUIRED,
        "Admin role required for this endpoint",
        403,
        this.requestId,
        { currentRole: role, allowedRoles: ADMIN_AUTH_ALLOWED_ROLES }
      );
    }
  }

  private isSuperadminRole(role: string): boolean {
    return role.trim().toLowerCase() === "super_admin";
  }

  private async trackSuperadminLogin(
    userId: number,
    role: string,
    sessionId: number,
    context: AuthRequestContext
  ): Promise<void> {
    if (!this.isSuperadminRole(role)) {
      return;
    }

    try {
      const settingsService = new SuperadminSettingsService(this.requestId);
      await settingsService.recordLogin({
        userId,
        sessionId: String(sessionId),
        userAgent: context.userAgent,
        ipAddress: context.ipAddress,
        location: context.location ?? null,
        latitude: context.latitude ?? null,
        longitude: context.longitude ?? null,
      });
    } catch (error) {
      await logAuditEvent(
        "SUPERADMIN_SETTINGS_SESSION_TRACKING_LOGIN_FAILED",
        userId,
        context.ipAddress,
        context.userAgent,
        {
          requestId: this.requestId,
          sessionId,
          error: error instanceof Error ? error.message : "Unknown error",
        }
      );
    }
  }

  private async trackSuperadminLogout(
    userId: number,
    role: string,
    sessionId: number | undefined,
    context: AuthRequestContext
  ): Promise<void> {
    if (!this.isSuperadminRole(role) || !sessionId) {
      return;
    }

    try {
      const settingsService = new SuperadminSettingsService(this.requestId);
      await settingsService.markLogoutBySession(String(sessionId));
    } catch (error) {
      await logAuditEvent(
        "SUPERADMIN_SETTINGS_SESSION_TRACKING_LOGOUT_FAILED",
        userId,
        context.ipAddress,
        context.userAgent,
        {
          requestId: this.requestId,
          sessionId,
          error: error instanceof Error ? error.message : "Unknown error",
        }
      );
    }
  }

  private async updateLastLogin(userId: number, ipAddress?: string): Promise<void> {
    await prisma.user.update({
      where: { user_id: BigInt(userId) },
      data: {
        last_login_at: new Date(),
        last_login_ip: ipAddress?.slice(0, 45) ?? null,
      },
    });
  }

  private async getAdminUser(userId: number): Promise<AdminUserSnapshot> {
    const user = await prisma.user.findUnique({
      where: { user_id: BigInt(userId) },
      select: {
        user_id: true,
        email: true,
        first_name: true,
        last_name: true,
        role: true,
        custom_uri: true,
        deactivated_flag: true,
        credentials: {
          select: {
            must_change_password: true,
          },
        },
      },
    });

    if (!user || user.deactivated_flag) {
      throw createAuthError(
        AuthErrorCode.SESSION_NOT_FOUND,
        "Active admin session user not found",
        401,
        this.requestId,
        { userId }
      );
    }

    this.assertAdminRole(user.role);

    return toUserSnapshot(user);
  }

  async login(input: AdminLoginInput, context: AuthRequestContext): Promise<{
    user: AdminUserSnapshot;
    session: {
      sessionId: number;
      rememberMe: boolean;
      expiresAt: string;
    };
  }> {
    const email = normalizeEmail(input.email);
    const password = input.password;

    const [lockoutCheck, credential] = await Promise.all([
      checkAccountLockout(email),
      prisma.credential.findFirst({
        where: { user: { email } },
        select: {
          password_hash: true,
          email_verified: true,
          must_change_password: true,
          user: {
            select: {
              user_id: true,
              email: true,
              first_name: true,
              last_name: true,
              role: true,
              custom_uri: true,
              deactivated_flag: true,
              created_at: true,
              last_reverification_at: true,
            },
          },
        },
      }),
    ]);

    if (lockoutCheck.locked) {
      throw createAuthError(
        AuthErrorCode.LOCKOUT_ACTIVE,
        "Account temporarily locked due to too many failed attempts",
        429,
        this.requestId,
        {
          retryAfterSeconds: Math.max(1, Math.ceil(lockoutCheck.retryAfterMs / 1000)),
          failedAttempts: lockoutCheck.failedAttempts,
        }
      );
    }

    const hashToCompare = credential?.password_hash ?? DUMMY_HASH;
    const isPasswordValid = await verifyPassword(password, hashToCompare);

    if (!credential || !isPasswordValid) {
      await Promise.all([
        recordFailedAttempt(email, context.ipAddress ?? "unknown"),
        logAuditEvent("ADMIN_LOGIN_FAILED", undefined, context.ipAddress, context.userAgent, {
          email,
          requestId: this.requestId,
        }),
      ]);

      throw createAuthError(
        AuthErrorCode.INVALID_CREDENTIALS,
        "Invalid email or password",
        401,
        this.requestId
      );
    }

    const user = credential.user;
    const userId = Number(user.user_id);

    if (user.deactivated_flag) {
      await logAuditEvent("ADMIN_LOGIN_DEACTIVATED_ACCOUNT", userId, context.ipAddress, context.userAgent, {
        requestId: this.requestId,
      });

      throw createAuthError(
        AuthErrorCode.ACCOUNT_DEACTIVATED,
        "This account is deactivated",
        403,
        this.requestId,
        { userId }
      );
    }

    if (!isAllowedAdminRole(user.role)) {
      await Promise.all([
        recordFailedAttempt(email, context.ipAddress ?? "unknown"),
        logAuditEvent("ADMIN_LOGIN_ROLE_BLOCKED", userId, context.ipAddress, context.userAgent, {
          requestId: this.requestId,
          role: user.role,
        }),
      ]);

      throw createAuthError(
        AuthErrorCode.ADMIN_ROLE_REQUIRED,
        "Admin role required for this endpoint",
        403,
        this.requestId,
        {
          userId,
          role: user.role,
          allowedRoles: ADMIN_AUTH_ALLOWED_ROLES,
        }
      );
    }

    if (!credential.email_verified) {
      await logAuditEvent("ADMIN_LOGIN_UNVERIFIED_EMAIL", userId, context.ipAddress, context.userAgent, {
        requestId: this.requestId,
      });

      const unverifiedMessage =
        user.role === "staff"
          ? "Please verify your account first."
          : "Email must be verified before admin login";

      throw createAuthError(
        AuthErrorCode.EMAIL_NOT_VERIFIED,
        unverifiedMessage,
        403,
        this.requestId,
        { userId, role: user.role }
      );
    }

    // Successful admin password auth counts as 90-day reverification.
    // Without this stamp, createSession succeeds but validateToken/refresh
    // immediately reject the session and the portal bounces back to /super-login.
    if (
      isReverificationRequired({
        created_at: user.created_at,
        last_reverification_at: user.last_reverification_at,
      })
    ) {
      await prisma.user.update({
        where: { user_id: user.user_id },
        data: { last_reverification_at: new Date() },
      });
    }

    const createdSession = await createSession(
      {
        userId,
        email: user.email,
        role: user.role,
      },
      input.rememberMe === true,
      context.ipAddress,
      context.userAgent,
      { location: context.location ?? null }
    );

    await Promise.all([
      recordSuccessfulLogin(email, context.ipAddress ?? "unknown"),
      this.updateLastLogin(userId, context.ipAddress),
      this.trackSuperadminLogin(userId, user.role, createdSession.session.sessionId, context),
      logAuditEvent("ADMIN_LOGIN_SUCCESS", userId, context.ipAddress, context.userAgent, {
        requestId: this.requestId,
        rememberMe: input.rememberMe === true,
        sessionId: createdSession.session.sessionId,
      }),
      this.writeAdminAudit(
        userId,
        user.email,
        "ADMIN_LOGIN_SUCCESS",
        {
          requestId: this.requestId,
          rememberMe: input.rememberMe === true,
          sessionId: createdSession.session.sessionId,
        },
        context
      ),
    ]);

    return {
      user: {
        userId,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        customUri: user.custom_uri,
        requiresPasswordChange: credential.must_change_password === true,
      },
      session: {
        sessionId: createdSession.session.sessionId,
        rememberMe: createdSession.session.rememberMe,
        expiresAt: createdSession.session.expiresAt.toISOString(),
      },
    };
  }

  async refresh(context: AuthRequestContext): Promise<{
    user: AdminUserSnapshot;
    session: {
      sessionId: number;
      rememberMe: boolean;
      expiresAt: string;
      refreshed: boolean;
    };
  }> {
    const refreshed = await refreshSession({
      ip: context.ipAddress,
      userAgent: context.userAgent,
    });

    if (!refreshed.success || !refreshed.session) {
      throw createAuthError(
        AuthErrorCode.INVALID_REFRESH_TOKEN,
        refreshed.error ?? "Invalid refresh token",
        401,
        this.requestId
      );
    }

    const session = refreshed.session;

    if (!isAllowedAdminRole(session.role)) {
      await destroySession();
      throw createAuthError(
        AuthErrorCode.ADMIN_ROLE_REQUIRED,
        "Admin role required for this endpoint",
        403,
        this.requestId,
        {
          role: session.role,
          allowedRoles: ADMIN_AUTH_ALLOWED_ROLES,
        }
      );
    }

    const user = await this.getAdminUser(session.userId);

    await Promise.all([
      this.updateLastLogin(user.userId, context.ipAddress),
      this.trackSuperadminLogout(
        user.userId,
        session.role,
        refreshed.rotatedFromSessionId,
        context
      ),
      this.trackSuperadminLogin(user.userId, session.role, session.sessionId, context),
      logAuditEvent("ADMIN_REFRESH_SUCCESS", user.userId, context.ipAddress, context.userAgent, {
        requestId: this.requestId,
        sessionId: session.sessionId,
      }),
      this.writeAdminAudit(
        user.userId,
        user.email,
        "ADMIN_REFRESH_SUCCESS",
        {
          requestId: this.requestId,
          sessionId: session.sessionId,
        },
        context
      ),
    ]);

    return {
      user,
      session: {
        sessionId: session.sessionId,
        rememberMe: session.rememberMe,
        expiresAt: session.expiresAt.toISOString(),
        refreshed: true,
      },
    };
  }

  async logout(actor: AdminSessionActor | null, context: AuthRequestContext): Promise<void> {
    await destroySession();

    if (!actor) {
      return;
    }

    // Superadmin sessions are shared with SmartPet; signing out ends them everywhere.
    const actorRole = String(actor.role ?? "").trim().toLowerCase();
    if (actorRole === "super_admin" || actorRole === "dev") {
      await revokeAllSessions(actor.userId);
    }

    await Promise.all([
      this.trackSuperadminLogout(actor.userId, actor.role, actor.sessionId, context),
      logAuditEvent("ADMIN_LOGOUT", actor.userId, context.ipAddress, context.userAgent, {
        requestId: this.requestId,
      }),
      this.writeAdminAudit(
        actor.userId,
        actor.email,
        "ADMIN_LOGOUT",
        {
          requestId: this.requestId,
        },
        context
      ),
    ]);
  }

  async forgotPassword(emailInput: string, context: AuthRequestContext): Promise<{
    message: string;
    email: string;
    expiresIn: number;
  }> {
    const email = normalizeEmail(emailInput);
    const genericMessage = "If an eligible admin account exists, password reset instructions have been sent.";

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        user_id: true,
        email: true,
        role: true,
        deactivated_flag: true,
      },
    });

    if (!user || user.deactivated_flag || !isAllowedAdminRole(user.role)) {
      await logAuditEvent("ADMIN_FORGOT_PASSWORD_IGNORED", undefined, context.ipAddress, context.userAgent, {
        requestId: this.requestId,
        email,
      });

      return {
        message: genericMessage,
        email: maskEmail(email),
        expiresIn: 3600,
      };
    }

    const token = generateResetToken();
    const tokenHash = hashResetToken(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TOKEN_EXPIRY_MS);

    await prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: {
          user_id: user.user_id,
          used_at: null,
        },
        data: {
          used_at: now,
        },
      });

      await tx.passwordResetToken.create({
        data: {
          user_id: user.user_id,
          token_hash: tokenHash,
          requested_ip: context.ipAddress?.slice(0, 45) ?? null,
          requested_user_agent: context.userAgent?.slice(0, 512) ?? null,
          expires_at: expiresAt,
        },
      });
    });

    try {
      await sendVerificationEmail(user.email, token, 60);
    } catch (error) {
      await logAuditEvent(
        "ADMIN_FORGOT_PASSWORD_EMAIL_FAILED",
        Number(user.user_id),
        context.ipAddress,
        context.userAgent,
        {
          requestId: this.requestId,
          error: error instanceof Error ? error.message : "Unknown email error",
        }
      );
    }

    await Promise.all([
      logAuditEvent("ADMIN_FORGOT_PASSWORD_REQUEST", Number(user.user_id), context.ipAddress, context.userAgent, {
        requestId: this.requestId,
      }),
      this.writeAdminAudit(
        Number(user.user_id),
        user.email,
        "ADMIN_FORGOT_PASSWORD_REQUEST",
        {
          requestId: this.requestId,
        },
        context
      ),
    ]);

    return {
      message: genericMessage,
      email: maskEmail(email),
      expiresIn: 3600,
    };
  }

  async resetPassword(input: AdminResetPasswordInput, context: AuthRequestContext): Promise<{
    message: string;
    resetAt: string;
  }> {
    if (input.newPassword !== input.confirmPassword) {
      throw createAuthError(
        AuthErrorCode.PASSWORD_MISMATCH,
        "confirm_password must match new_password",
        422,
        this.requestId
      );
    }

    const passwordPolicy = validatePassword(input.newPassword);
    if (!passwordPolicy.valid) {
      throw createAuthError(
        AuthErrorCode.PASSWORD_POLICY_VIOLATION,
        "Password does not meet security requirements",
        422,
        this.requestId,
        { errors: passwordPolicy.errors }
      );
    }

    const normalizedToken = input.token.trim().toUpperCase();
    if (!normalizedToken) {
      throw createAuthError(
        AuthErrorCode.INVALID_TOKEN,
        "Reset token is required",
        422,
        this.requestId
      );
    }

    const tokenHash = hashResetToken(normalizedToken);
    const now = new Date();

    const resetRecord = await prisma.passwordResetToken.findFirst({
      where: {
        token_hash: tokenHash,
        used_at: null,
      },
      orderBy: {
        created_at: "desc",
      },
      include: {
        user: {
          select: {
            user_id: true,
            email: true,
            role: true,
            deactivated_flag: true,
          },
        },
      },
    });

    if (!resetRecord) {
      throw createAuthError(
        AuthErrorCode.RESET_TOKEN_INVALID,
        "Invalid or expired reset token",
        400,
        this.requestId
      );
    }

    if (resetRecord.expires_at <= now) {
      await prisma.passwordResetToken.update({
        where: { id: resetRecord.id },
        data: { used_at: now },
      });

      throw createAuthError(
        AuthErrorCode.RESET_TOKEN_EXPIRED,
        "Reset token has expired",
        400,
        this.requestId
      );
    }

    const user = resetRecord.user;
    if (!isAllowedAdminRole(user.role) || user.deactivated_flag) {
      throw createAuthError(
        AuthErrorCode.RESET_TOKEN_INVALID,
        "Invalid or expired reset token",
        400,
        this.requestId
      );
    }

    const credential = await prisma.credential.findUnique({
      where: { user_id: user.user_id },
      select: {
        credentials_id: true,
        password_hash: true,
      },
    });

    if (!credential) {
      throw createAuthError(
        AuthErrorCode.SESSION_NOT_FOUND,
        "Credential record not found",
        404,
        this.requestId,
        { userId: Number(user.user_id) }
      );
    }

    const isPasswordReuse = await verifyPassword(input.newPassword, credential.password_hash);
    if (isPasswordReuse) {
      throw createAuthError(
        AuthErrorCode.PASSWORD_REUSE_NOT_ALLOWED,
        "New password must be different from current password",
        409,
        this.requestId
      );
    }

    const passwordPayload = await buildPasswordCredentialPayload(input.newPassword, this.requestId);

    await prisma.$transaction(async (tx) => {
      await tx.credential.update({
        where: { credentials_id: credential.credentials_id },
        data: {
          password_hash: passwordPayload.password_hash,
          password_encrypted: passwordPayload.password_encrypted,
          password_changed_at: passwordPayload.password_changed_at,
          must_change_password: false,
          updated_at: passwordPayload.updated_at,
        },
      });

      await tx.passwordResetToken.update({
        where: { id: resetRecord.id },
        data: { used_at: now },
      });

      await tx.passwordResetToken.updateMany({
        where: {
          user_id: user.user_id,
          used_at: null,
        },
        data: { used_at: now },
      });
    });

    await Promise.all([
      revokeAllSessions(Number(user.user_id)),
      prismaAnalytics.accountLockout.updateMany({
        where: { email: user.email },
        data: {
          failed_attempts: 0,
          locked_until: null,
          last_attempt_at: now,
          updated_at: now,
        },
      }),
      logAuditEvent("ADMIN_PASSWORD_RESET", Number(user.user_id), context.ipAddress, context.userAgent, {
        requestId: this.requestId,
      }),
      this.writeAdminAudit(
        Number(user.user_id),
        user.email,
        "ADMIN_PASSWORD_RESET",
        {
          requestId: this.requestId,
        },
        context
      ),
    ]);

    return {
      message: "Password reset successful. Please log in with your new password.",
      resetAt: now.toISOString(),
    };
  }

  async changePassword(
    input: AdminPasswordChangeInput,
    actor: AdminSessionActor,
    context: AuthRequestContext
  ): Promise<{
    message: string;
    changedAt: string;
    session: {
      sessionId: number;
      expiresAt: string;
    };
  }> {
    this.assertAdminRole(actor.role);

    if (input.newPassword !== input.confirmPassword) {
      throw createAuthError(
        AuthErrorCode.PASSWORD_MISMATCH,
        "confirm_password must match new_password",
        422,
        this.requestId
      );
    }

    if (input.currentPassword === input.newPassword) {
      throw createAuthError(
        AuthErrorCode.PASSWORD_REUSE_NOT_ALLOWED,
        "New password must be different from current password",
        409,
        this.requestId
      );
    }

    const passwordPolicy = validatePassword(input.newPassword);
    if (!passwordPolicy.valid) {
      throw createAuthError(
        AuthErrorCode.PASSWORD_POLICY_VIOLATION,
        "Password does not meet security requirements",
        422,
        this.requestId,
        { errors: passwordPolicy.errors }
      );
    }

    const credential = await prisma.credential.findUnique({
      where: { user_id: BigInt(actor.userId) },
      select: {
        credentials_id: true,
        password_hash: true,
      },
    });

    if (!credential) {
      throw createAuthError(
        AuthErrorCode.SESSION_NOT_FOUND,
        "Credential record not found",
        404,
        this.requestId,
        { userId: actor.userId }
      );
    }

    const currentMatches = await verifyPassword(input.currentPassword, credential.password_hash);
    if (!currentMatches) {
      throw createAuthError(
        AuthErrorCode.CURRENT_PASSWORD_INVALID,
        "Current password is invalid",
        401,
        this.requestId
      );
    }

    const isPasswordReuse = await verifyPassword(input.newPassword, credential.password_hash);
    if (isPasswordReuse) {
      throw createAuthError(
        AuthErrorCode.PASSWORD_REUSE_NOT_ALLOWED,
        "New password must be different from current password",
        409,
        this.requestId
      );
    }

    const passwordPayload = await buildPasswordCredentialPayload(input.newPassword, this.requestId);
    const now = new Date();

    await prisma.credential.update({
      where: { credentials_id: credential.credentials_id },
      data: {
        password_hash: passwordPayload.password_hash,
        password_encrypted: passwordPayload.password_encrypted,
        password_changed_at: passwordPayload.password_changed_at,
        must_change_password: false,
        updated_at: passwordPayload.updated_at,
      },
    });

    await revokeAllSessions(actor.userId);

    const sessionResult = await createSession(
      {
        userId: actor.userId,
        email: actor.email,
        role: actor.role,
      },
      actor.rememberMe,
      context.ipAddress,
      context.userAgent
    );

    await Promise.all([
      logAuditEvent("ADMIN_PASSWORD_CHANGED", actor.userId, context.ipAddress, context.userAgent, {
        requestId: this.requestId,
      }),
      this.writeAdminAudit(
        actor.userId,
        actor.email,
        "ADMIN_PASSWORD_CHANGED",
        {
          requestId: this.requestId,
          sessionId: sessionResult.session.sessionId,
        },
        context
      ),
    ]);

    return {
      message: "Password changed successfully",
      changedAt: now.toISOString(),
      session: {
        sessionId: sessionResult.session.sessionId,
        expiresAt: sessionResult.session.expiresAt.toISOString(),
      },
    };
  }

  async setInitialStaffPassword(
    input: { newPassword: string; confirmPassword: string },
    actor: AdminSessionActor,
    context: AuthRequestContext
  ): Promise<{
    message: string;
    changedAt: string;
    session: {
      sessionId: number;
      expiresAt: string;
    };
  }> {
    if (actor.role !== "staff") {
      throw createAuthError(
        AuthErrorCode.ADMIN_ROLE_REQUIRED,
        "Only staff accounts can use initial password setup",
        403,
        this.requestId,
        { role: actor.role }
      );
    }

    if (input.newPassword !== input.confirmPassword) {
      throw createAuthError(
        AuthErrorCode.PASSWORD_MISMATCH,
        "confirm_password must match new_password",
        422,
        this.requestId
      );
    }

    const passwordPolicy = validatePassword(input.newPassword);
    if (!passwordPolicy.valid) {
      throw createAuthError(
        AuthErrorCode.PASSWORD_POLICY_VIOLATION,
        "Password does not meet security requirements",
        422,
        this.requestId,
        { errors: passwordPolicy.errors }
      );
    }

    const credential = await prisma.credential.findUnique({
      where: { user_id: BigInt(actor.userId) },
      select: {
        credentials_id: true,
        password_hash: true,
        must_change_password: true,
        email_verified: true,
      },
    });

    if (!credential) {
      throw createAuthError(
        AuthErrorCode.SESSION_NOT_FOUND,
        "Credential record not found",
        404,
        this.requestId,
        { userId: actor.userId }
      );
    }

    if (!credential.email_verified) {
      throw createAuthError(
        AuthErrorCode.EMAIL_NOT_VERIFIED,
        "Email must be verified before setting a password",
        403,
        this.requestId,
        { userId: actor.userId }
      );
    }

    if (!credential.must_change_password) {
      throw createAuthError(
        AuthErrorCode.INVALID_REQUEST_PAYLOAD,
        "Password setup is not required for this account",
        400,
        this.requestId
      );
    }

    const passwordPayload = await buildPasswordCredentialPayload(input.newPassword, this.requestId);
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.credential.update({
        where: { credentials_id: credential.credentials_id },
        data: {
          password_hash: passwordPayload.password_hash,
          password_encrypted: passwordPayload.password_encrypted,
          password_changed_at: passwordPayload.password_changed_at,
          must_change_password: false,
          updated_at: passwordPayload.updated_at,
        },
      });

      await tx.user.update({
        where: { user_id: BigInt(actor.userId) },
        data: {
          is_active: true,
          updated_at: now,
        },
      });

      await tx.staffProfile.updateMany({
        where: { user_id: BigInt(actor.userId) },
        data: {
          is_active: true,
          updated_at: now,
        },
      });
    });

    await revokeAllSessions(actor.userId);

    const sessionResult = await createSession(
      {
        userId: actor.userId,
        email: actor.email,
        role: actor.role,
      },
      actor.rememberMe,
      context.ipAddress,
      context.userAgent
    );

    await Promise.all([
      logAuditEvent("STAFF_PASSWORD_SETUP", actor.userId, context.ipAddress, context.userAgent, {
        requestId: this.requestId,
      }),
      this.writeAdminAudit(
        actor.userId,
        actor.email,
        "STAFF_PASSWORD_SETUP",
        {
          requestId: this.requestId,
          sessionId: sessionResult.session.sessionId,
        },
        context
      ),
    ]);

    return {
      message: "Password set successfully",
      changedAt: now.toISOString(),
      session: {
        sessionId: sessionResult.session.sessionId,
        expiresAt: sessionResult.session.expiresAt.toISOString(),
      },
    };
  }

  async verifyStaffInviteToken(token: string): Promise<{
    valid: boolean;
    email?: string;
    firstName?: string;
    lastName?: string;
    reason?: string;
  }> {
    const normalizedToken = token.trim();
    if (normalizedToken.length < STAFF_INVITE_TOKEN_MIN_LENGTH) {
      return { valid: false, reason: "Invalid or missing verification token." };
    }

    const tokenHash = hashStaffInviteToken(normalizedToken);
    const now = new Date();

    const record = await prisma.emailVerificationToken.findFirst({
      where: {
        token_hash: tokenHash,
        used_at: null,
        expires_at: { gt: now },
      },
      orderBy: { created_at: "desc" },
      include: {
        user: {
          select: {
            role: true,
            email: true,
            first_name: true,
            last_name: true,
            credentials: {
              select: {
                email_verified: true,
              },
            },
          },
        },
      },
    });

    if (!record) {
      return { valid: false, reason: "This verification link is invalid or has expired." };
    }

    if (record.user.role !== "staff") {
      return { valid: false, reason: "This verification link is not valid for a staff account." };
    }

    if (record.user.credentials?.email_verified) {
      return { valid: false, reason: "This staff account has already been verified." };
    }

    return {
      valid: true,
      email: record.user.email,
      firstName: record.user.first_name,
      lastName: record.user.last_name,
    };
  }

  async completeStaffInviteVerification(
    token: string,
    newPassword: string,
    confirmPassword: string,
    context: AuthRequestContext
  ): Promise<{
    message: string;
    user: AdminUserSnapshot;
    session: {
      sessionId: number;
      expiresAt: string;
    };
  }> {
    const normalizedToken = token.trim();
    if (normalizedToken.length < STAFF_INVITE_TOKEN_MIN_LENGTH) {
      throw createAuthError(
        AuthErrorCode.INVALID_TOKEN,
        "Invalid or missing verification token",
        400,
        this.requestId
      );
    }

    if (newPassword !== confirmPassword) {
      throw createAuthError(
        AuthErrorCode.PASSWORD_MISMATCH,
        "confirm_password must match new_password",
        422,
        this.requestId
      );
    }

    const passwordPolicy = validatePassword(newPassword);
    if (!passwordPolicy.valid) {
      throw createAuthError(
        AuthErrorCode.PASSWORD_POLICY_VIOLATION,
        "Password does not meet security requirements",
        422,
        this.requestId,
        { errors: passwordPolicy.errors }
      );
    }

    const tokenHash = hashStaffInviteToken(normalizedToken);
    const now = new Date();

    const inviteRecord = await prisma.emailVerificationToken.findFirst({
      where: {
        token_hash: tokenHash,
        used_at: null,
        expires_at: { gt: now },
      },
      orderBy: { created_at: "desc" },
      include: {
        user: {
          select: {
            user_id: true,
            email: true,
            first_name: true,
            last_name: true,
            role: true,
            custom_uri: true,
            deactivated_flag: true,
            credentials: {
              select: {
                credentials_id: true,
                email_verified: true,
              },
            },
          },
        },
      },
    });

    if (!inviteRecord) {
      throw createAuthError(
        AuthErrorCode.INVALID_TOKEN,
        "This verification link is invalid or has expired",
        400,
        this.requestId
      );
    }

    const user = inviteRecord.user;
    if (user.role !== "staff") {
      throw createAuthError(
        AuthErrorCode.ADMIN_ROLE_REQUIRED,
        "This verification link is not valid for a staff account",
        403,
        this.requestId
      );
    }

    if (user.deactivated_flag) {
      throw createAuthError(
        AuthErrorCode.ACCOUNT_DEACTIVATED,
        "This account has been deactivated",
        403,
        this.requestId
      );
    }

    if (!user.credentials) {
      throw createAuthError(
        AuthErrorCode.SESSION_NOT_FOUND,
        "Credential record not found",
        404,
        this.requestId
      );
    }

    if (user.credentials.email_verified) {
      throw createAuthError(
        AuthErrorCode.INVALID_REQUEST_PAYLOAD,
        "This staff account has already been verified",
        400,
        this.requestId
      );
    }

    const userId = Number(user.user_id);
    const passwordPayload = await buildPasswordCredentialPayload(newPassword, this.requestId);

    await prisma.$transaction(async (tx) => {
      await tx.credential.update({
        where: { credentials_id: user.credentials!.credentials_id },
        data: {
          password_hash: passwordPayload.password_hash,
          password_encrypted: passwordPayload.password_encrypted,
          email_verified: true,
          email_verified_at: now,
          must_change_password: false,
          password_changed_at: passwordPayload.password_changed_at,
          updated_at: passwordPayload.updated_at,
        },
      });

      await tx.user.update({
        where: { user_id: user.user_id },
        data: {
          is_active: true,
          updated_at: now,
        },
      });

      await tx.staffProfile.updateMany({
        where: { user_id: user.user_id },
        data: {
          is_active: true,
          updated_at: now,
        },
      });

      await tx.emailVerificationToken.update({
        where: { id: inviteRecord.id },
        data: { used_at: now },
      });

      await tx.emailVerificationToken.updateMany({
        where: {
          user_id: user.user_id,
          used_at: null,
          id: { not: inviteRecord.id },
        },
        data: { used_at: now },
      });
    });

    await revokeAllSessions(userId);

    const sessionResult = await createSession(
      {
        userId,
        email: user.email,
        role: user.role,
      },
      false,
      context.ipAddress,
      context.userAgent
    );

    await Promise.all([
      logAuditEvent("STAFF_INVITE_VERIFIED", userId, context.ipAddress, context.userAgent, {
        requestId: this.requestId,
      }),
      this.writeAdminAudit(
        userId,
        user.email,
        "STAFF_INVITE_VERIFIED",
        {
          requestId: this.requestId,
          sessionId: sessionResult.session.sessionId,
        },
        context
      ),
    ]);

    return {
      message: "Account verified and password created successfully.",
      user: {
        userId,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        customUri: user.custom_uri,
        requiresPasswordChange: false,
      },
      session: {
        sessionId: sessionResult.session.sessionId,
        expiresAt: sessionResult.session.expiresAt.toISOString(),
      },
    };
  }

  async verify(userId: number): Promise<AdminUserSnapshot> {
    return this.getAdminUser(userId);
  }

  asJsonDetails(input: Record<string, unknown>): Prisma.JsonObject {
    return input as Prisma.JsonObject;
  }
}
