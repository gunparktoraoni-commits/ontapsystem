// ──────────────────────────────────────────────────────────────
// Authentication & Session Management — Production Security Layer
// ──────────────────────────────────────────────────────────────
// Architecture: Server-side session store (DB-backed) + HTTP-only cookies
//
// WHY NOT pure JWT-in-cookie?
// - JWTs cannot be revoked before expiry without a server-side blacklist
// - A DB-backed session gives instant revocation (logout, compromise)
// - Refresh tokens enable long "remember me" sessions securely
//
// Token Lifecycle:
// 1. Login → server creates Session row → sets httpOnly cookie with token
// 2. Each request → middleware reads cookie → hashes token → looks up Session
// 3. If remember_me, a refresh token cookie is also set
// 4. When access token expires, refresh endpoint rotates the pair
// 5. Logout → Session.revoked = true → cookies cleared
//
// Cookie Security:
// - httpOnly: JS cannot read the token (XSS mitigation)
// - secure: only sent over HTTPS
// - sameSite: "none" (required for cross-origin Hostinger→Vercel)
// - path: "/" to cover all routes
//
// CSRF Protection:
// - SameSite=None requires Secure flag
// - State-changing endpoints require POST (no GET side-effects)
// - Origin header validation in middleware
// - Double-submit via X-CSRF-Token header can be layered on top
// ──────────────────────────────────────────────────────────────

import bcrypt from "bcryptjs";
import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { prismaAnalytics } from "./prisma-analytics";
import { sendSecurityAlert } from "./security-alerts";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import {
  type ImpersonationTokenSource,
  getImpersonationTokenFromRequest,
  validateSuperadminImpersonationToken,
  clearImpersonationCookiesFromStore,
} from "@/server/lib/superadmin-impersonation";
import {
  type CompanyActingPayload,
  getCompanyActingTokenFromRequest,
  validateCompanyActingToken,
  clearCompanyActingCookiesFromStore,
} from "@/server/lib/company-employee-acting-context";
import {
  recordUserLoginPresence,
  recordUserLogoutPresence,
  touchUserPresence,
} from "@/server/lib/user-presence";
import { CSRF_COOKIE_NAME, getExpiredCsrfCookieOptions } from "@/lib/csrf";
import { isForcedPlaceholderEmail } from "@/lib/auth/placeholder-email";

// ──────────────────────────────────────────
// Constants
// ──────────────────────────────────────────

const SESSION_COOKIE_NAME = "session_token";
const REFRESH_COOKIE_NAME = "refresh_token";
const REVERIFICATION_STATE_COOKIE_NAME = "reauth_state";
const REVERIFICATION_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const REVERIFICATION_STATE_TTL_MS = 15 * 60 * 1000;

// Access token lifetimes
const ACCESS_TOKEN_TTL_SHORT = 24 * 60 * 60;          // 24 hours (no remember-me)
const ACCESS_TOKEN_TTL_LONG = 24 * 60 * 60;           // 24 hours (remember-me)

// Refresh token lifetimes
const REFRESH_TOKEN_TTL_SHORT = 7 * 24 * 60 * 60;    // 7 days (no remember-me)
const REFRESH_TOKEN_TTL_LONG = 7 * 24 * 60 * 60;     // 7 days (remember-me)

// Token byte length (256 bits of entropy → 64-char hex string)
const TOKEN_BYTES = 32;

// Grace window to treat immediate same-device refresh-token replays as
// benign concurrency (e.g. multiple parallel 401 retries in one browser).
const REFRESH_REUSE_GRACE_MS = 30 * 1000;

type RefreshSessionResult = {
  success: boolean;
  error?: string;
  session?: SessionPayload;
  rotatedFromSessionId?: number;
};

// Deduplicate concurrent refresh attempts for the same refresh token
// (React Strict Mode / parallel /api/auth/session calls).
const inflightRefreshByHash = new Map<string, Promise<RefreshSessionResult>>();

/**
 * Update payload for every revocation except refresh rotation. Only rotated
 * rows keep their refresh_hash, so presenting a refresh token of a session
 * that was logged out or revoked (e.g. from SmartPet or another device) is
 * rejected as unknown instead of tripping reuse detection, which would revoke
 * every other live session of the user.
 */
export function revokedSessionData(revokedAt: Date = new Date()) {
  return { revoked: true, refresh_hash: null, updated_at: revokedAt };
}

// ──────────────────────────────────────────
// Session Payload Type
// ──────────────────────────────────────────

export interface SessionPayload {
  userId: number;
  email: string;
  role: string;
  sessionId: number;
  rememberMe: boolean;
  expiresAt: Date;
}

export interface ImpersonationPayload {
  tokenId: number;
  superadminUserId: number;
  targetUserId: number;
  sessionId: number | null;
  reason: string | null;
  expiresAt: Date;
  createdAt: Date;
  source: ImpersonationTokenSource;
}

export interface RequestSessionResult {
  session: SessionPayload | null;
  refreshed: boolean;
  impersonation: ImpersonationPayload | null;
  companyActing: CompanyActingPayload | null;
  requiresReverification: boolean;
}

/**
 * Returns the user id that should act on user-scoped APIs.
 * Priority: superadmin impersonation → company employee acting context → session user.
 */
export function resolveEffectiveUserId(auth: RequestSessionResult): number {
  if (!auth.session) {
    throw new Error("Session required to resolve effective user id");
  }

  if (auth.impersonation && auth.session.role.trim().toLowerCase() === "super_admin") {
    return auth.impersonation.targetUserId;
  }

  if (auth.companyActing && auth.companyActing.actorUserId === auth.session.userId) {
    return auth.companyActing.employeeUserId;
  }

  return auth.session.userId;
}

// ──────────────────────────────────────────
// Cryptographic Helpers
// ──────────────────────────────────────────

/**
 * Generate a cryptographically secure random token.
 * Returns a 64-character hex string (256 bits of entropy).
 */
function generateToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString("hex");
}

/**
 * SHA-256 hash a token for storage.
 * WHY: We never store raw tokens in the database. If the DB is compromised,
 * the attacker cannot forge sessions — they'd need the original token.
 */
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function getAuthSigningSecret(): string {
  return process.env.JWT_SECRET || process.env.AFFILIATE_ENCRYPTION_KEY || "default-pepper";
}

function signStatePayload(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", getAuthSigningSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifyStatePayload<T extends Record<string, unknown>>(token: string): T | null {
  const separatorIndex = token.lastIndexOf(".");
  if (separatorIndex <= 0) return null;

  const body = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);
  const expected = crypto.createHmac("sha256", getAuthSigningSecret()).update(body).digest("base64url");

  const expectedBuffer = Buffer.from(expected, "base64url");
  const signatureBuffer = Buffer.from(signature, "base64url");
  if (expectedBuffer.length !== signatureBuffer.length) return null;
  if (!crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!decoded || typeof decoded !== "object") return null;
    return decoded as T;
  } catch {
    return null;
  }
}

export function isReverificationRequired(user: { created_at: Date; last_reverification_at: Date | null }): boolean {
  const anchor = user.last_reverification_at ?? user.created_at;
  return Date.now() - anchor.getTime() >= REVERIFICATION_WINDOW_MS;
}

export function createReverificationStateToken(payload: {
  userId: number;
  email: string;
  purpose: "webauthn_auth" | "webauthn_register" | "webauthn_login" | "otp_reauth";
  challenge?: string;
}): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + REVERIFICATION_STATE_TTL_MS);
  const token = signStatePayload({
    ...payload,
    issuedAt: Date.now(),
    expiresAt: expiresAt.toISOString(),
    nonce: crypto.randomBytes(16).toString("base64url"),
  });

  return { token, expiresAt };
}

export function parseReverificationStateToken(token: string): {
  userId: number;
  email: string;
  purpose: "webauthn_auth" | "webauthn_register" | "webauthn_login" | "otp_reauth";
    challenge?: string;
  issuedAt: number;
  expiresAt: string;
  nonce: string;
} | null {
  const decoded = verifyStatePayload<Record<string, unknown>>(token);
  if (!decoded) return null;

  const userId = Number(decoded.userId);
  const email = typeof decoded.email === "string" ? decoded.email : "";
  const purpose = decoded.purpose;
  const challenge = typeof decoded.challenge === "string" ? decoded.challenge : undefined;
  const issuedAt = Number(decoded.issuedAt);
  const expiresAt = typeof decoded.expiresAt === "string" ? decoded.expiresAt : "";
  const nonce = typeof decoded.nonce === "string" ? decoded.nonce : "";

  if (!Number.isInteger(userId) || userId <= 0) return null;
  if (!email || !issuedAt || !expiresAt || !nonce) return null;
  if (purpose !== "webauthn_auth" && purpose !== "webauthn_register" && purpose !== "webauthn_login" && purpose !== "otp_reauth") return null;
  if (Date.parse(expiresAt) < Date.now()) return null;

  return { userId, email, purpose, challenge, issuedAt, expiresAt, nonce };
}

function isUserEffectivelyRestricted(isRestricted: boolean, restrictedUntil: Date | null): boolean {
  if (!isRestricted) return false;
  return restrictedUntil === null || restrictedUntil.getTime() > Date.now();
}

// ──────────────────────────────────────────
// Password Hashing (bcrypt + cost factor 12)
// ──────────────────────────────────────────
// WHY bcrypt?
// - Designed for password hashing (slow by design)
// - Cost factor 12 requires ~250ms per hash on modern hardware
// - Makes brute-force attacks computationally infeasible
// - Includes built-in salt (no separate salt storage needed)

const SALT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  const salt = await bcrypt.genSalt(SALT_ROUNDS);
  return bcrypt.hash(plain, salt);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ──────────────────────────────────────────
// Password Validation
// ──────────────────────────────────────────
// Enforces:
//   - Minimum 8 characters
//   - At least 1 lowercase letter
//   - At least 1 uppercase letter
//   - At least 1 digit
//   - At least 1 special character
//   - No whitespace
//   - Only allowed characters (prevent injection via password field)

const ALLOWED_SPECIAL = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/;

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push("Password must be at least 8 characters long.");
  }
  if (password.length > 128) {
    // Prevent bcrypt DoS — bcrypt has a 72-byte input limit internally,
    // but we cap at 128 chars to prevent large payload attacks
    errors.push("Password must not exceed 128 characters.");
  }
  if (/\s/.test(password)) {
    errors.push("Password must not contain whitespace.");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least 1 lowercase letter.");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least 1 uppercase letter.");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain at least 1 digit.");
  }
  if (!ALLOWED_SPECIAL.test(password)) {
    errors.push(
      "Password must contain at least 1 special character (!@#$%^&*()_+-=[]{}|;':\",./<>?`~)."
    );
  }
  const allowedChars =
    /^[a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]+$/;
  if (!allowedChars.test(password)) {
    errors.push(
      "Password contains disallowed characters. Only letters, digits, and specific special characters are allowed."
    );
  }

  return { valid: errors.length === 0, errors };
}

// ──────────────────────────────────────────
// Email Validation
// ──────────────────────────────────────────

export function isValidEmail(email: string): boolean {
  // Basic structural check — not a full RFC 5322 parser, but catches
  // obvious injection attempts and malformed addresses
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
}

// ──────────────────────────────────────────
// Session Management (Server-Side Token Store)
// ──────────────────────────────────────────

/**
 * Get secure cookie configuration.
 * Extracted to ensure consistency across all cookie operations.
 *
 * WHY these flags:
 * - httpOnly: Prevents XSS attacks from reading the token
 * - secure: Ensures cookies only sent over HTTPS
 * - sameSite "none": Required for cross-origin (Hostinger frontend → Vercel backend)
 * - path "/": Cookie available to all API routes
 */
function isProductionDeployment(): boolean {
  // NODE_ENV alone is unreliable — Hostinger may keep NODE_ENV=development
  // in .env even on the live server. Use COOKIE_SECURE env var override or
  // detect production by the HTTPS app URL.
  if (process.env.COOKIE_SECURE?.trim().toLowerCase() === "true") return true;
  if (process.env.NODE_ENV === "production") return true;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.FRONTEND_URL ?? "";
  return appUrl.trim().startsWith("https://");
}

function shouldUsePartitionedCookies(): boolean {
  const value = process.env.COOKIE_PARTITIONED?.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return isProductionDeployment();
}

function getCookieOptions(maxAge: number) {
  const isProd = isProductionDeployment();
  const options: {
    httpOnly: true;
    secure: boolean;
    sameSite: "none" | "lax";
    path: string;
    maxAge: number;
    partitioned?: boolean;
  } = {
    httpOnly: true,                                    // JS cannot access
    // In production: secure + sameSite=none for cross-origin Hostinger→Vercel
    // In dev: secure must still be true for sameSite=none to work (modern browser requirement)
    secure: true,
    sameSite: isProd ? "none" : "lax",
    path: "/",
    maxAge,
  };

  if (shouldUsePartitionedCookies()) {
    options.partitioned = true;
  }

  return options;
}


/**
 * Returns cookie options for the short-lived reauth_state cookie.
 * Uses SameSite=None in production for cross-origin Hostinger deployments.
 */
export function getReauthStateCookieOptions(maxAge: number) {
  const isProd = isProductionDeployment();
  const options: {
    httpOnly: true;
    secure: boolean;
    sameSite: "none" | "lax";
    path: string;
    maxAge: number;
    partitioned?: boolean;
  } = {
    httpOnly: true,
    secure: true,
    sameSite: isProd ? "none" : "lax",
    path: "/",
    maxAge,
  };
  if (shouldUsePartitionedCookies()) {
    options.partitioned = true;
  }
  return options;
}

/**
 * Create a new authenticated session.
 *
 * Flow:
 * 1. Generate cryptographically random access token
 * 2. Generate refresh token (if remember-me)
 * 3. Hash both tokens for DB storage (never store plaintext)
 * 4. Create Session record with user context + IP + UA
 * 5. Set httpOnly cookies with appropriate TTLs
 *
 * @param user - Authenticated user details
 * @param rememberMe - Whether to extend session lifetime
 * @param ip - Client IP for audit trail
 * @param userAgent - Browser user-agent for audit trail
 */
export async function createSession(
  user: { userId: number; email: string; role: string },
  rememberMe: boolean = false,
  ip?: string,
  userAgent?: string,
  options?: { location?: string | null }
): Promise<{ accessToken: string; refreshToken?: string; session: SessionPayload }> {
  const accessToken = generateToken();
  const accessTokenHash = hashToken(accessToken);

  const accessTTL = rememberMe ? ACCESS_TOKEN_TTL_LONG : ACCESS_TOKEN_TTL_SHORT;
  const accessExpiresAt = new Date(Date.now() + accessTTL * 1000);

  let refreshToken: string | undefined;
  let refreshTokenHash: string | undefined;
  let refreshExpiresAt: Date | undefined;

  if (rememberMe) {
    refreshToken = generateToken();
    refreshTokenHash = hashToken(refreshToken);
    refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_LONG * 1000);
  } else {
    // Even without remember-me, provide a refresh token for seamless UX
    // during the active browser session — just with shorter TTL
    refreshToken = generateToken();
    refreshTokenHash = hashToken(refreshToken);
    refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SHORT * 1000);
  }

  // Store session in DB (hashed tokens only)
  const createdSession = await prisma.session.create({
    data: {
      user_id: BigInt(user.userId),
      token_hash: accessTokenHash,
      refresh_hash: refreshTokenHash,
      expires_at: accessExpiresAt,
      refresh_expires_at: refreshExpiresAt,
      ip_address: ip?.substring(0, 45),       // Truncate to fit column
      user_agent: userAgent?.substring(0, 512),
      remember_me: rememberMe,
    },
    select: { id: true },
  });

  // Set httpOnly cookies
  const cookieStore = await cookies();

  if (process.env.NODE_ENV !== "production") {
    try {
      const accessSample = `${accessToken.slice(0, 6)}...${accessToken.slice(-6)}`;
      const refreshSample = refreshToken ? `${refreshToken.slice(0, 6)}...${refreshToken.slice(-6)}` : null;
      console.debug("[auth][createSession] setting cookies", { accessSample, accessLength: accessToken.length, refreshSample, refreshLength: refreshToken ? refreshToken.length : 0 });
    } catch {
      console.debug("[auth][createSession] setting cookies (unable to sample tokens)");
    }
  }

  cookieStore.set(
    SESSION_COOKIE_NAME,
    accessToken,
    getCookieOptions(accessTTL)
  );

  if (refreshToken) {
    const refreshTTL = rememberMe ? REFRESH_TOKEN_TTL_LONG : REFRESH_TOKEN_TTL_SHORT;
    cookieStore.set(
      REFRESH_COOKIE_NAME,
      refreshToken,
      getCookieOptions(refreshTTL)
    );
  }

  try {
    await recordUserLoginPresence({
      userId: user.userId,
      sessionId: String(createdSession.id),
      userAgent,
      ipAddress: ip,
      location: options?.location ?? null,
    });
  } catch (presenceError) {
    console.error("[auth][createSession] presence tracking failed:", presenceError);
  }

  return {
    accessToken,
    refreshToken,
    session: {
      userId: user.userId,
      email: user.email,
      role: user.role,
      sessionId: Number(createdSession.id),
      rememberMe,
      expiresAt: accessExpiresAt,
    },
  };
}

/**
 * Validate the current session from cookies.
 *
 * Flow:
 * 1. Read session_token cookie
 * 2. Hash the token
 * 3. Look up the Session row by hash
 * 4. Verify it's not revoked and not expired
 * 5. Return session payload
 *
 * WHY hash-based lookup instead of JWT verification?
 * - Allows instant revocation (just set revoked=true)
 * - No secret key management needed
 * - No JWT expiration parsing quirks
 * - Session data is always fresh from DB
 */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  return validateToken(token);
}

/**
 * Validate a session token (extracted for reuse in middleware and routes).
 */
export async function validateToken(token: string): Promise<SessionPayload | null> {
  const tokenHash = hashToken(token);

  const session = await prisma.session.findUnique({
    where: { token_hash: tokenHash },
    select: {
      id: true,
      user_id: true,
      remember_me: true,
      expires_at: true,
      revoked: true,
      user: {
        select: {
          email: true,
          role: true,
          deactivated_flag: true,
          is_restricted: true,
          restricted_until: true,
        },
      },
    },
  });

  if (!session) return null;
  if (session.revoked) return null;
  if (session.expires_at < new Date()) return null;
  if (session.user.deactivated_flag) return null;
  if (isUserEffectivelyRestricted(session.user.is_restricted, session.user.restricted_until)) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { user_id: session.user_id },
    select: { created_at: true, last_reverification_at: true },
  });

  // Placeholder PCO accounts skip reverification at login so they can finish
  // forced email change on the login page — keep that session usable here too.
  if (
    user &&
    isReverificationRequired(user) &&
    !isForcedPlaceholderEmail(session.user.email)
  ) {
    return null;
  }

  return {
    userId: Number(session.user_id),
    email: session.user.email,
    role: session.user.role,
    sessionId: Number(session.id),
    rememberMe: session.remember_me,
    expiresAt: session.expires_at,
  };
}

/**
 * Read session token from a NextRequest (for use in edge middleware).
 * Does NOT perform DB validation — the middleware acts as a fast-reject
 * for missing tokens. Full validation happens in route handlers.
 */
export function getSessionTokenFromRequest(request: NextRequest): string | null {
  return request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
}

function hasKnownIp(ip: string | null | undefined): boolean {
  if (!ip) return false;
  const normalized = ip.trim().toLowerCase();
  return normalized.length > 0 && normalized !== "unknown";
}

function normalizeUserAgentFingerprint(userAgent: string | null | undefined): string {
  return (userAgent ?? "").trim().slice(0, 180);
}

/**
 * Refresh an expired access token using a valid refresh token.
 *
 * Security considerations:
 * - Refresh token rotation: old token is revoked, new pair is issued
 * - Prevents replay attacks — if an old refresh token is reused,
 *   the entire session family is revoked (theft detection)
 * - New tokens get new hashes, old session row is marked revoked
 * - Concurrent refreshes with the same token share one in-flight rotation
 */
export async function refreshSession(options?: {
  refreshToken?: string;
  ip?: string;
  userAgent?: string;
}): Promise<RefreshSessionResult> {
  const cookieStore = await cookies();
  const refreshTokenRaw = options?.refreshToken ?? cookieStore.get(REFRESH_COOKIE_NAME)?.value;

  if (!refreshTokenRaw) {
    return { success: false, error: "No refresh token provided." };
  }

  const refreshHash = hashToken(refreshTokenRaw);
  const inflight = inflightRefreshByHash.get(refreshHash);
  if (inflight) {
    return inflight;
  }

  const pending = performRefreshSession(refreshTokenRaw, options).finally(() => {
    inflightRefreshByHash.delete(refreshHash);
  });
  inflightRefreshByHash.set(refreshHash, pending);
  return pending;
}

async function performRefreshSession(
  refreshTokenRaw: string,
  options?: {
    refreshToken?: string;
    ip?: string;
    userAgent?: string;
  }
): Promise<RefreshSessionResult> {
  // DEBUG: log basic info about the incoming refresh token to help
  // diagnose cases where the cookie is present but lookup fails.
  try {
    const sample = `${refreshTokenRaw.slice(0, 6)}...${refreshTokenRaw.slice(-6)}`;
    console.debug("[auth][refresh] received refresh token (masked)", { sample, length: refreshTokenRaw.length });
  } catch {
    console.debug("[auth][refresh] received refresh token (unable to sample)");
  }

  const refreshHash = hashToken(refreshTokenRaw);

  const session = await prisma.session.findUnique({
    where: { refresh_hash: refreshHash },
    select: {
      id: true,
      user_id: true,
      remember_me: true,
      refresh_expires_at: true,
      revoked: true,
      ip_address: true,
      user_agent: true,
      updated_at: true,
      user: {
        select: {
          email: true,
          role: true,
          deactivated_flag: true,
          is_restricted: true,
          restricted_until: true,
        },
      },
    },
  });

  // SECURITY: If the refresh token doesn't match any session, it might
  // have been stolen and already rotated — revoke all sessions for this user
  if (!session) {
    try {
      console.debug("[auth][refresh] no session found for refreshHash", { refreshHash });
    } catch {
      console.debug("[auth][refresh] no session found for refresh token (hashing failed)");
    }
    return { success: false, error: "Invalid refresh token." };
  }

  if (session.revoked) {
    const revokedAt = session.updated_at;
    const recentlyRevoked =
      revokedAt instanceof Date && Date.now() - revokedAt.getTime() <= REFRESH_REUSE_GRACE_MS;

    const requestIp = options?.ip?.trim();
    const sessionIp = session.ip_address?.trim();
    const sameKnownIp = hasKnownIp(requestIp) && hasKnownIp(sessionIp) && requestIp === sessionIp;

    const requestUa = normalizeUserAgentFingerprint(options?.userAgent);
    const sessionUa = normalizeUserAgentFingerprint(session.user_agent);
    const sameUserAgent = requestUa.length > 0 && requestUa === sessionUa;

    if (recentlyRevoked && (sameKnownIp || sameUserAgent)) {
      return {
        success: false,
        error: "Refresh token already rotated. Retry with latest session cookies.",
      };
    }

    // THEFT DETECTION: a rotated-away refresh token was reused.
    // Revoke ALL sessions for this user as a precaution, and burn the reused
    // token so the same stale cookie cannot repeat the purge on later visits.
    await prisma.session.updateMany({
      where: { user_id: session.user_id, OR: [{ revoked: false }, { id: session.id }] },
      data: revokedSessionData(),
    });

    // Log this security event
    await Promise.allSettled([
      logAuditEvent(
        "REFRESH_TOKEN_REUSE_DETECTED",
        Number(session.user_id),
        options?.ip,
        options?.userAgent,
        { revokedSessionId: Number(session.id) }
      ),
      sendSecurityAlert({
        type: "REFRESH_TOKEN_REUSE_DETECTED",
        severity: "critical",
        userId: Number(session.user_id),
        ip: options?.ip,
        userAgent: options?.userAgent,
        metadata: { revokedSessionId: Number(session.id) },
      }),
    ]);

    return { success: false, error: "Session compromised. All sessions revoked." };
  }

  if (session.refresh_expires_at && session.refresh_expires_at < new Date()) {
    return { success: false, error: "Refresh token expired." };
  }

  if (session.user.deactivated_flag) {
    return { success: false, error: "Account deactivated." };
  }

  if (isUserEffectivelyRestricted(session.user.is_restricted, session.user.restricted_until)) {
    return { success: false, error: "Account suspended." };
  }

  // Check 90-day reverification policy before issuing new tokens.
  // If the user's reverification window has lapsed, the refresh must also
  // be rejected so the login flow can prompt re-verification instead of
  // issuing a session that validateToken() would immediately invalidate.
  const userForReauth = await prisma.user.findUnique({
    where: { user_id: session.user_id },
    select: { created_at: true, last_reverification_at: true },
  });
  if (
    userForReauth &&
    isReverificationRequired(userForReauth) &&
    !isForcedPlaceholderEmail(session.user.email)
  ) {
    return { success: false, error: "Reverification required." };
  }

  // Revoke old session
  const rotatedAt = new Date();
  await prisma.session.update({
    where: { id: session.id },
    data: { revoked: true, updated_at: rotatedAt },
  });

  // Issue new session (token rotation)
  const rotated = await createSession(
    {
      userId: Number(session.user_id),
      email: session.user.email,
      role: session.user.role,
    },
    session.remember_me,
    options?.ip,
    options?.userAgent
  );

  return {
    success: true,
    session: rotated.session,
    rotatedFromSessionId: Number(session.id),
  };
}

export async function resolveRequestSession(
  request: NextRequest,
  options?: { tryRefresh?: boolean }
): Promise<RequestSessionResult> {
  const resolveImpersonation = async (
    session: SessionPayload
  ): Promise<ImpersonationPayload | null> => {
    if (session.role.trim().toLowerCase() !== "super_admin") {
      return null;
    }

    const token = getImpersonationTokenFromRequest(request);
    if (!token.token || !token.source) {
      return null;
    }

    try {
      const validation = await validateSuperadminImpersonationToken(token.token);
      if (validation.state !== "valid" || !validation.snapshot) {
        return null;
      }

      if (validation.snapshot.superadminUserId !== session.userId) {
        return null;
      }

      return {
        tokenId: validation.snapshot.tokenId,
        superadminUserId: validation.snapshot.superadminUserId,
        targetUserId: validation.snapshot.targetUserId,
        sessionId: validation.snapshot.sessionId,
        reason: validation.snapshot.reason,
        expiresAt: validation.snapshot.expiresAt,
        createdAt: validation.snapshot.createdAt,
        source: token.source,
      };
    } catch (err) {
      console.error("[auth] impersonation lookup failed:", err);
      return null;
    }
  };

  const resolveCompanyActing = async (
    session: SessionPayload,
  ): Promise<CompanyActingPayload | null> => {
    const token = getCompanyActingTokenFromRequest(request);
    if (!token.token || !token.source) {
      return null;
    }

    try {
      return await validateCompanyActingToken({
        rawToken: token.token,
        actorUserId: session.userId,
        source: token.source,
      });
    } catch (err) {
      console.error("[auth] company acting lookup failed:", err);
      return null;
    }
  };

  const rawToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (rawToken) {
    const session = await validateToken(rawToken);
    if (session) {
      void touchUserPresence(session.userId, String(session.sessionId)).catch((error) => {
        console.error("[auth] presence touch failed:", error);
      });

      return {
        session,
        refreshed: false,
        impersonation: await resolveImpersonation(session),
        companyActing: await resolveCompanyActing(session),
        requiresReverification: false,
      };
    }
  }

  if (options?.tryRefresh === false) {
    return {
      session: null,
      refreshed: false,
      impersonation: null,
      companyActing: null,
      requiresReverification: false,
    };
  }

  const refreshToken = request.cookies.get(REFRESH_COOKIE_NAME)?.value;
  if (!refreshToken) {
    return {
      session: null,
      refreshed: false,
      impersonation: null,
      companyActing: null,
      requiresReverification: false,
    };
  }

  const refreshed = await refreshSession({
    refreshToken,
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  });

  if (!refreshed.success || !refreshed.session) {
    return {
      session: null,
      refreshed: false,
      impersonation: null,
      companyActing: null,
      requiresReverification: false,
    };
  }

  void touchUserPresence(
    refreshed.session.userId,
    String(refreshed.session.sessionId),
  ).catch((error) => {
    console.error("[auth] presence touch failed:", error);
  });

  return {
    session: refreshed.session,
    refreshed: true,
    impersonation: await resolveImpersonation(refreshed.session),
    companyActing: await resolveCompanyActing(refreshed.session),
    requiresReverification: false,
  };
}

/**
 * Destroy (revoke) the current session.
 * Clears auth cookies and marks the session as revoked in DB.
 * Also clears reauth + impersonation cookies so logout is absolute across browsers.
 */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const refreshToken = cookieStore.get(REFRESH_COOKIE_NAME)?.value;
  const revokedAt = new Date();
  const sessionIdsForPresence = new Set<string>();

  if (token) {
    const tokenHash = hashToken(token);
    const existingSession = await prisma.session.findUnique({
      where: { token_hash: tokenHash },
      select: { id: true },
    });

    if (existingSession) {
      sessionIdsForPresence.add(String(existingSession.id));
    }

    // Revoke in DB — even if cookie is somehow retained, session is invalid
    await prisma.session.updateMany({
      where: { token_hash: tokenHash },
      data: revokedSessionData(revokedAt),
    });
  }

  // If access cookie is missing/stale but refresh cookie remains, revoke by refresh hash too
  if (refreshToken) {
    const refreshHash = hashToken(refreshToken);
    const refreshSession = await prisma.session.findFirst({
      where: { refresh_hash: refreshHash, revoked: false },
      select: { id: true },
    });
    if (refreshSession) {
      sessionIdsForPresence.add(String(refreshSession.id));
    }
    await prisma.session.updateMany({
      where: { refresh_hash: refreshHash },
      data: revokedSessionData(revokedAt),
    });
  }

  for (const sessionId of sessionIdsForPresence) {
    try {
      await recordUserLogoutPresence(sessionId);
    } catch (presenceError) {
      console.error("[auth][destroySession] presence logout failed:", presenceError);
    }
  }

  // Clear cookies regardless — attributes must match how they were set (Safari/Chrome CHIPS)
  cookieStore.set(SESSION_COOKIE_NAME, "", getCookieOptions(0));
  cookieStore.set(REFRESH_COOKIE_NAME, "", getCookieOptions(0));
  cookieStore.set(REVERIFICATION_STATE_COOKIE_NAME, "", getReauthStateCookieOptions(0));
  cookieStore.set(CSRF_COOKIE_NAME, "", getExpiredCsrfCookieOptions());
  await clearImpersonationCookiesFromStore(cookieStore);
  await clearCompanyActingCookiesFromStore(cookieStore);
}

/**
 * Revoke ALL sessions for a user (e.g., after password change, compromise).
 */
export async function revokeAllSessions(userId: number): Promise<void> {
  await prisma.session.updateMany({
    where: { user_id: BigInt(userId), revoked: false },
    data: revokedSessionData(),
  });
}

// ──────────────────────────────────────────
// Verification Code Helpers (Password Reset)
// ──────────────────────────────────────────

const CODE_LENGTH = 6;
const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Generate a 6-character alphanumeric code using crypto.randomBytes.
 * WHY crypto.randomBytes? Math.random() is not cryptographically secure.
 * Used for PASSWORD RESET codes. Plain stored (legacy VerificationCode path).
 *
 * Charset: uppercase letters (no I, O) + digits (no 0, 1) = 32 characters.
 * 256 / 32 = 8 exactly — zero modular bias, uniform distribution guaranteed.
 * Uppercase-only makes codes easier for users to type from email.
 */
export function generateVerificationCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 chars — 256 % 32 = 0, no bias
  let code = "";
  const randomBytes = crypto.randomBytes(CODE_LENGTH);
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += chars[randomBytes[i] % chars.length];
  }
  return code;
}

export async function createVerificationCode(userId: number): Promise<string> {
  // Invalidate any existing unused codes for this user
  await prisma.verificationCode.updateMany({
    where: { user_id: BigInt(userId), used: false },
    data: { used: true },
  });

  const code = generateVerificationCode();
  // Normalize to uppercase before hashing — verifyCode() also normalizes to
  // uppercase, making verification case-insensitive for the user.
  const codeHash = hashToken(code.toUpperCase());
  const expiresAt = new Date(Date.now() + CODE_EXPIRY_MS);

  await prisma.verificationCode.create({
    data: {
      code_hash: codeHash,
      user_id: BigInt(userId),
      expires_at: expiresAt,
    },
  });

  return code; // Return plain code to be sent via email
}

export async function verifyCode(
  userId: number,
  code: string
): Promise<boolean> {
  // Hash the submitted code and compare against stored hash
  const codeHash = hashToken(code.toUpperCase());

  const record = await prisma.verificationCode.findFirst({
    where: {
      user_id: BigInt(userId),
      code_hash: codeHash,
      used: false,
      expires_at: { gt: new Date() },
    },
    orderBy: { created_at: "desc" },
  });

  if (!record) return false;

  // Mark as used (one-time use)
  await prisma.verificationCode.update({
    where: { id: record.id },
    data: { used: true },
  });

  return true;
}

// ──────────────────────────────────────────
// Email OTP (Registration Verification)
// ──────────────────────────────────────────
// Separate from password-reset VerificationCode for clean separation
// of concerns. Uses a stronger character set (upper + lower + digits +
// special) for higher entropy per character.
//
// OTP Character Set: 26 upper + 26 lower + 10 digits + 10 special = 72 chars
// 6-char OTP from 72-char alphabet → 72^6 ≈ 1.39 × 10^11 combinations
// Even at 10 attempts/sec, exhaustive search would take ~440 years.
//
// Security:
// - OTP is hashed with SHA-256 before DB storage
// - Max 5 verification attempts per OTP instance
// - Expires after 10 minutes
// - Invalidated immediately after successful use
// - All previous unused OTPs revoked when new one is issued

const OTP_LENGTH = 6;
const OTP_EXPIRY_MS = 10 * 60 * 1000;   // 10 minutes
const OTP_MAX_ATTEMPTS = 5;             // Brute-force limit per OTP

// Character pool: upper + lower + digits + selected specials
// Specials chosen to be URL/JSON safe and visually unambiguous
const OTP_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

/**
 * Generate a cryptographically secure 6-character OTP.
 * Returns the plain-text OTP to be sent via email.
 * Note: ambiguous characters (I, l, O, 0, 1) are excluded.
 */
export function generateEmailOtp(): string {
  let otp = "";
  // Rejection sampling ensures uniform distribution across the charset
  // (avoids modular bias that occurs when charset length doesn't divide 256 evenly)
  const max = 256 - (256 % OTP_CHARS.length); // Unbiased upper bound
  while (otp.length < OTP_LENGTH) {
    const byte = crypto.randomBytes(1)[0];
    if (byte < max) {
      otp += OTP_CHARS[byte % OTP_CHARS.length];
    }
  }
  return otp;
}

/**
 * Create and persist a new email verification OTP for a user.
 * Previous unused OTPs for the same user are invalidated.
 *
 * @returns The plain-text OTP (send this via email, never store it)
 */
export type EmailOtpPurpose = "email_verification" | "otp_reauth" | "force_email_change";

export async function createEmailOtp(userId: number, purpose: EmailOtpPurpose = "email_verification"): Promise<string> {
  // Revoke all existing unused OTPs for this user — prevents parallel brute force
  await prisma.emailOtp.updateMany({
    where: { user_id: BigInt(userId), used: false, purpose },
    data: { used: true },
  });

  const otp = generateEmailOtp();
  const otpHash = hashToken(otp); // SHA-256; never store the plain OTP
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

  await prisma.emailOtp.create({
    data: {
      user_id: BigInt(userId),
      otp_hash: otpHash,
      purpose,
      expires_at: expiresAt,
    },
  });

  return otp; // Caller sends this in the email
}

/**
 * Verify an email OTP submitted by the user.
 *
 * Flow:
 * 1. Find the latest unused, unexpired OTP for the user
 * 2. Increment attempt counter (even before verifying — prevents timing oracle)
 * 3. If max attempts exceeded, invalidate OTP and return false
 * 4. Hash the submitted OTP and compare with stored hash
 * 5. On success: mark OTP used, mark credential as email_verified
 *
 * @returns "verified" | "invalid" | "expired" | "max_attempts"
 */
export async function verifyEmailOtp(
  userId: number,
  submittedOtp: string,
  purpose: EmailOtpPurpose = "email_verification"
): Promise<"verified" | "invalid" | "expired" | "max_attempts"> {
  // Find the latest non-revoked OTP record for this user
  const record = await prisma.emailOtp.findFirst({
    where: {
      user_id: BigInt(userId),
      used: false,
      purpose,
    },
    orderBy: { created_at: "desc" },
  });

  if (!record) return "invalid";

  // Check expiry first (don't increment attempts for expired OTPs)
  if (record.expires_at < new Date()) return "expired";

  // Increment attempt counter in DB — attack mitigation
  const updated = await prisma.emailOtp.update({
    where: { id: record.id },
    data: { attempts: { increment: 1 } },
  });

  // If attempt limit reached, revoke the OTP immediately
  if (updated.attempts > OTP_MAX_ATTEMPTS) {
    await prisma.emailOtp.update({
      where: { id: record.id },
      data: { used: true },
    });
    return "max_attempts";
  }

  // Compare submitted OTP hash against stored hash (constant-time via crypto.timingSafeEqual)
  const submittedHash = hashToken(submittedOtp);
  const storedHashBuf = Buffer.from(record.otp_hash, "hex");
  const submittedHashBuf = Buffer.from(submittedHash, "hex");

  // Timing-safe comparison — prevents timing side-channel attacks
  const isMatch =
    storedHashBuf.length === submittedHashBuf.length &&
    crypto.timingSafeEqual(storedHashBuf, submittedHashBuf);

  if (!isMatch) return "invalid";

  // Mark OTP as used and verify the credential in a single transaction
  const operations: Array<Prisma.PrismaPromise<unknown>> = [
    prisma.emailOtp.update({
      where: { id: record.id },
      data: { used: true },
    }),
  ];

  if (purpose === "email_verification") {
    operations.push(
      prisma.credential.update({
        where: { user_id: BigInt(userId) },
        data: {
          email_verified: true,
          email_verified_at: new Date(),
        },
      }),
    );
  }

  await prisma.$transaction(operations);

  return "verified";
}

/**
 * Check whether a user's email is verified.
 */
export async function isEmailVerified(userId: number): Promise<boolean> {
  const credential = await prisma.credential.findUnique({
    where: { user_id: BigInt(userId) },
    select: { email_verified: true },
  });
  return credential?.email_verified ?? false;
}

// ──────────────────────────────────────────
// Audit Logging
// ──────────────────────────────────────────
// WHY: OWASP requires security event logging for:
// - Failed login attempts (detect brute force)
// - Successful logins (detect account compromise)
// - Password changes (detect unauthorized changes)
// - Session revocations (detect token theft)

export async function logAuditEvent(
  action: string,
  userId?: number,
  ip?: string,
  userAgent?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await prismaAnalytics.auditLog.create({
      data: {
        action,
        user_id: userId ? BigInt(userId) : null,
        ip_address: ip?.substring(0, 45),
        user_agent: userAgent?.substring(0, 512),
        metadata: metadata ? (metadata as Record<string, string | number | boolean>) : undefined,
      },
    });
  } catch (error) {
    // Audit logging should never crash the request
    console.error("Audit log write failed:", error);
  }
}

// ──────────────────────────────────────────
// Request Helpers
// ──────────────────────────────────────────

/**
 * Extract client IP from request headers.
 * Checks proxy/CDN headers before falling back to x-forwarded-for.
 */
export function getClientIp(request: NextRequest): string {
  const headerCandidates = [
    "cf-connecting-ip",
    "x-real-ip",
    "true-client-ip",
    "x-client-ip",
    "x-forwarded-for",
  ];

  for (const header of headerCandidates) {
    const value = request.headers.get(header);
    if (!value) continue;

    const candidate =
      header === "x-forwarded-for" ? value.split(",")[0]?.trim() ?? "" : value.trim();

    if (candidate && isUsableClientIp(candidate)) {
      return candidate;
    }
  }

  const requestIp = (request as NextRequest & { ip?: string | null }).ip?.trim();
  if (requestIp && isUsableClientIp(requestIp)) {
    return requestIp;
  }

  return "unknown";
}

function isUsableClientIp(ip: string): boolean {
  const normalized = ip.trim();
  if (!normalized || normalized.toLowerCase() === "unknown") {
    return false;
  }

  return true;
}

/**
 * Extract user agent from request.
 */
export function getUserAgent(request: NextRequest): string {
  return request.headers.get("user-agent") ?? "unknown";
}

// ──────────────────────────────────────────
// Session Cleanup (Cron / Scheduled)
// ──────────────────────────────────────────
// Call this periodically to clean up expired sessions and old audit logs.
// On Vercel, use a cron job endpoint (vercel.json crons).

export async function cleanupExpiredSessions(): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: {
      OR: [
        { revoked: true, updated_at: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        { expires_at: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      ],
    },
  });
  return result.count;
}