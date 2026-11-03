import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";

export const IMPERSONATION_COOKIE_NAME = "superadmin_impersonation_token";
export const IMPERSONATION_HANDOFF_COOKIE_NAME = "superadmin_impersonation_handoff";

const TOKEN_BYTES = 32;
const DEFAULT_TTL_MINUTES = 30;
const MIN_TTL_MINUTES = 5;
const MAX_TTL_MINUTES = 120;

export type ImpersonationTokenSource = "header" | "cookie";

export type ImpersonationTokenValidationState =
  | "valid"
  | "not_found"
  | "revoked"
  | "expired";

export interface ImpersonationTokenSnapshot {
  tokenId: number;
  superadminUserId: number;
  targetUserId: number;
  sessionId: number | null;
  reason: string | null;
  expiresAt: Date;
  createdAt: Date;
  revoked: boolean;
}

export interface ImpersonationTokenValidationResult {
  state: ImpersonationTokenValidationState;
  snapshot?: ImpersonationTokenSnapshot;
}

export interface CreateImpersonationTokenInput {
  superadminUserId: number;
  targetUserId: number;
  sessionId?: number | null;
  reason?: string | null;
  ttlMinutes?: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface RevokeImpersonationTokenInput {
  tokenId: number;
  endedBySuperadminUserId: number;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

function generateToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString("hex");
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function clampTtlMinutes(ttlMinutes?: number): number {
  if (!Number.isInteger(ttlMinutes)) {
    return DEFAULT_TTL_MINUTES;
  }

  return Math.max(MIN_TTL_MINUTES, Math.min(MAX_TTL_MINUTES, Number(ttlMinutes)));
}

function isProductionDeployment(): boolean {
  if (process.env.COOKIE_SECURE?.trim().toLowerCase() === "true") return true;
  if (process.env.NODE_ENV === "production") return true;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.FRONTEND_URL ?? "";
  return appUrl.trim().startsWith("https://");
}

function shouldUsePartitionedCookies(): boolean {
  const value = process.env.COOKIE_PARTITIONED?.trim().toLowerCase();
  if (value === "false") return false;
  if (value === "true") return isProductionDeployment();
  return isProductionDeployment();
}

function getImpersonationCookieOptions(maxAgeSeconds: number) {
  const isProduction = isProductionDeployment();
  const options: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: "none" | "lax";
    path: string;
    maxAge: number;
    partitioned?: boolean;
  } = {
    httpOnly: true,
    // Match auth/CSRF cookie rules so clear/set attributes align across browsers.
    secure: true,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  };

  if (shouldUsePartitionedCookies()) {
    options.partitioned = true;
  }

  return options;
}

function getHandoffCookieOptions(maxAgeSeconds: number) {
  const options = getImpersonationCookieOptions(maxAgeSeconds);
  return {
    ...options,
    httpOnly: false,
  };
}

function toSnapshot(record: {
  token_id: bigint;
  superadmin_user_id: bigint;
  target_user_id: bigint;
  session_id: bigint | null;
  reason: string | null;
  expires_at: Date;
  created_at: Date;
  revoked: boolean;
}): ImpersonationTokenSnapshot {
  return {
    tokenId: Number(record.token_id),
    superadminUserId: Number(record.superadmin_user_id),
    targetUserId: Number(record.target_user_id),
    sessionId: record.session_id ? Number(record.session_id) : null,
    reason: record.reason,
    expiresAt: record.expires_at,
    createdAt: record.created_at,
    revoked: record.revoked,
  };
}

export function getImpersonationTokenFromRequest(
  request: NextRequest
): { token: string | null; source: ImpersonationTokenSource | null } {
  const headerValue = request.headers.get("x-impersonation-token")?.trim();
  if (headerValue) {
    return { token: headerValue, source: "header" };
  }

  const cookieValue = request.cookies.get(IMPERSONATION_COOKIE_NAME)?.value?.trim();
  if (cookieValue) {
    return { token: cookieValue, source: "cookie" };
  }

  return { token: null, source: null };
}

export async function createSuperadminImpersonationToken(
  input: CreateImpersonationTokenInput
): Promise<{ rawToken: string; tokenId: number; expiresAt: Date }> {
  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  const ttlMinutes = clampTtlMinutes(input.ttlMinutes);
  const now = Date.now();
  const expiresAt = new Date(now + ttlMinutes * 60 * 1000);

  const superadminUserId = BigInt(input.superadminUserId);
  const targetUserId = BigInt(input.targetUserId);
  const sessionId = input.sessionId ? BigInt(input.sessionId) : null;
  const reason = input.reason?.trim() || null;

  await prisma.superadminImpersonationToken.updateMany({
    where: {
      superadmin_user_id: superadminUserId,
      revoked: false,
      expires_at: { gt: new Date() },
    },
    data: {
      revoked: true,
      revoked_at: new Date(),
    },
  });

  const created = await prisma.superadminImpersonationToken.create({
    data: {
      token_hash: tokenHash,
      superadmin_user_id: superadminUserId,
      target_user_id: targetUserId,
      session_id: sessionId,
      reason,
      expires_at: expiresAt,
    },
    select: {
      token_id: true,
      expires_at: true,
    },
  });

  await prisma.superadminImpersonationAuditLog.create({
    data: {
      token_id: created.token_id,
      superadmin_user_id: superadminUserId,
      target_user_id: targetUserId,
      action: "started",
      reason,
      details: JSON.stringify({
        ttl_minutes: ttlMinutes,
      }),
      ip_address: input.ipAddress?.slice(0, 45) ?? null,
      user_agent: input.userAgent?.slice(0, 512) ?? null,
    },
  });

  return {
    rawToken,
    tokenId: Number(created.token_id),
    expiresAt: created.expires_at,
  };
}

export async function validateSuperadminImpersonationToken(
  rawToken: string
): Promise<ImpersonationTokenValidationResult> {
  const tokenHash = hashToken(rawToken);

  const record = await prisma.superadminImpersonationToken.findUnique({
    where: { token_hash: tokenHash },
    select: {
      token_id: true,
      superadmin_user_id: true,
      target_user_id: true,
      session_id: true,
      reason: true,
      expires_at: true,
      created_at: true,
      revoked: true,
    },
  });

  if (!record) {
    return { state: "not_found" };
  }

  const snapshot = toSnapshot(record);

  if (record.revoked) {
    return { state: "revoked", snapshot };
  }

  if (record.expires_at <= new Date()) {
    await prisma.superadminImpersonationToken.updateMany({
      where: {
        token_id: record.token_id,
        revoked: false,
      },
      data: {
        revoked: true,
        revoked_at: new Date(),
      },
    });

    return { state: "expired", snapshot: { ...snapshot, revoked: true } };
  }

  return { state: "valid", snapshot };
}

export async function revokeSuperadminImpersonationTokenById(
  input: RevokeImpersonationTokenInput
): Promise<boolean> {
  const tokenId = BigInt(input.tokenId);
  const endedBySuperadminUserId = BigInt(input.endedBySuperadminUserId);

  const record = await prisma.superadminImpersonationToken.findUnique({
    where: { token_id: tokenId },
    select: {
      token_id: true,
      superadmin_user_id: true,
      target_user_id: true,
      revoked: true,
    },
  });

  if (!record) {
    return false;
  }

  if (record.superadmin_user_id !== endedBySuperadminUserId) {
    return false;
  }

  if (!record.revoked) {
    await prisma.superadminImpersonationToken.update({
      where: { token_id: tokenId },
      data: {
        revoked: true,
        revoked_at: new Date(),
      },
    });
  }

  await prisma.superadminImpersonationAuditLog.create({
    data: {
      token_id: record.token_id,
      superadmin_user_id: record.superadmin_user_id,
      target_user_id: record.target_user_id,
      action: "ended",
      reason: input.reason?.trim() || null,
      details: JSON.stringify({
        was_already_revoked: record.revoked,
      }),
      ip_address: input.ipAddress?.slice(0, 45) ?? null,
      user_agent: input.userAgent?.slice(0, 512) ?? null,
    },
  });

  return true;
}

export async function revokeSuperadminImpersonationTokenByRawToken(params: {
  rawToken: string;
  endedBySuperadminUserId: number;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<"revoked" | "not_found" | "forbidden"> {
  const tokenHash = hashToken(params.rawToken);

  const record = await prisma.superadminImpersonationToken.findUnique({
    where: { token_hash: tokenHash },
    select: {
      token_id: true,
      superadmin_user_id: true,
    },
  });

  if (!record) {
    return "not_found";
  }

  if (record.superadmin_user_id !== BigInt(params.endedBySuperadminUserId)) {
    return "forbidden";
  }

  await revokeSuperadminImpersonationTokenById({
    tokenId: Number(record.token_id),
    endedBySuperadminUserId: params.endedBySuperadminUserId,
    reason: params.reason,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });

  return "revoked";
}

export function attachImpersonationCookie(
  response: NextResponse,
  rawToken: string,
  expiresAt: Date
): void {
  const maxAgeSeconds = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  response.cookies.set(
    IMPERSONATION_COOKIE_NAME,
    rawToken,
    getImpersonationCookieOptions(maxAgeSeconds)
  );
  response.cookies.set(
    IMPERSONATION_HANDOFF_COOKIE_NAME,
    rawToken,
    getHandoffCookieOptions(maxAgeSeconds)
  );
}

export function clearImpersonationCookie(response: NextResponse): void {
  response.cookies.set(IMPERSONATION_COOKIE_NAME, "", getImpersonationCookieOptions(0));
  response.cookies.set(IMPERSONATION_HANDOFF_COOKIE_NAME, "", getHandoffCookieOptions(0));
}

/** Clear impersonation cookies via Next.js `cookies()` store (logout path). */
export async function clearImpersonationCookiesFromStore(
  cookieStore: Awaited<ReturnType<typeof import("next/headers").cookies>>,
): Promise<void> {
  cookieStore.set(IMPERSONATION_COOKIE_NAME, "", getImpersonationCookieOptions(0));
  cookieStore.set(IMPERSONATION_HANDOFF_COOKIE_NAME, "", getHandoffCookieOptions(0));
}
