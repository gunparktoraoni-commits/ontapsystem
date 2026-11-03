import crypto from "node:crypto";

import { prisma } from "@/server/lib/prisma";
import { isReverificationRequired, revokedSessionData } from "@/server/lib/auth";
import {
  HANDOFF_TICKET_TTL_SECONDS,
  HANDOFF_TICKET_USER_AGENT_PREFIX,
  generateRandomToken,
  handoffTicketUserAgent,
  hashHandoffTicket,
  hashSsoState,
  isCrossPortalSuperadminRole,
  isValidHandoffTicket,
  isValidSsoState,
  isValidStateHash,
} from "@/server/lib/cross-portal-sso-policy";

const superadminAccountSelect = {
  user_id: true,
  email: true,
  first_name: true,
  last_name: true,
  role: true,
  deactivated_flag: true,
  is_restricted: true,
  restricted_until: true,
  created_at: true,
  last_reverification_at: true,
  credentials: {
    select: {
      email_verified: true,
      must_change_password: true,
    },
  },
} as const;

export type SuperadminAccount = {
  userId: number;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  role: string;
  deactivated: boolean;
  isRestricted: boolean;
  restrictedUntil: Date | null;
  createdAt: Date;
  lastReverificationAt: Date | null;
  emailVerified: boolean;
  mustChangePassword: boolean;
};

export type SuperadminIneligibleReason =
  | "NOT_FOUND"
  | "NOT_SUPERADMIN"
  | "DEACTIVATED"
  | "RESTRICTED"
  | "EMAIL_NOT_VERIFIED"
  | "PASSWORD_CHANGE_REQUIRED"
  | "REVERIFICATION_REQUIRED"
  | "NO_ACTIVE_SESSION";

type RawAccount = {
  user_id: bigint;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  deactivated_flag: boolean;
  is_restricted: boolean;
  restricted_until: Date | null;
  created_at: Date;
  last_reverification_at: Date | null;
  credentials: { email_verified: boolean; must_change_password: boolean } | null;
};

function toAccount(raw: RawAccount): SuperadminAccount {
  const firstName = raw.first_name?.trim() ?? "";
  const lastName = raw.last_name?.trim() ?? "";
  return {
    userId: Number(raw.user_id),
    email: raw.email.trim().toLowerCase(),
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim() || raw.email.split("@")[0] || "Superadmin",
    role: String(raw.role ?? "").trim().toLowerCase(),
    deactivated: raw.deactivated_flag,
    isRestricted: raw.is_restricted,
    restrictedUntil: raw.restricted_until,
    createdAt: raw.created_at,
    lastReverificationAt: raw.last_reverification_at,
    emailVerified: raw.credentials?.email_verified === true,
    mustChangePassword: raw.credentials?.must_change_password === true,
  };
}

export function normalizeSuperadminEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function loadSuperadminAccountByEmail(email: string): Promise<SuperadminAccount | null> {
  const normalized = normalizeSuperadminEmail(email);
  if (!normalized) return null;
  const raw = await prisma.user.findUnique({
    where: { email: normalized },
    select: superadminAccountSelect,
  });
  return raw ? toAccount(raw) : null;
}

export async function loadSuperadminAccountById(userId: number): Promise<SuperadminAccount | null> {
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;
  const raw = await prisma.user.findUnique({
    where: { user_id: BigInt(userId) },
    select: superadminAccountSelect,
  });
  return raw ? toAccount(raw) : null;
}

/**
 * Same gates the OnTap superadmin login and session validation enforce, so a
 * cross-portal hop can never grant access OnTap itself would refuse.
 */
export function evaluateSuperadminEligibility(
  account: SuperadminAccount | null,
): { ok: true } | { ok: false; reason: SuperadminIneligibleReason } {
  if (!account) return { ok: false, reason: "NOT_FOUND" };
  if (!isCrossPortalSuperadminRole(account.role)) return { ok: false, reason: "NOT_SUPERADMIN" };
  if (account.deactivated) return { ok: false, reason: "DEACTIVATED" };
  if (
    account.isRestricted &&
    (account.restrictedUntil === null || account.restrictedUntil.getTime() > Date.now())
  ) {
    return { ok: false, reason: "RESTRICTED" };
  }
  if (!account.emailVerified) return { ok: false, reason: "EMAIL_NOT_VERIFIED" };
  if (account.mustChangePassword) return { ok: false, reason: "PASSWORD_CHANGE_REQUIRED" };
  if (
    isReverificationRequired({
      created_at: account.createdAt,
      last_reverification_at: account.lastReverificationAt,
    })
  ) {
    return { ok: false, reason: "REVERIFICATION_REQUIRED" };
  }
  return { ok: true };
}

/**
 * A superadmin is "signed in" across both portals while at least one real
 * OnTap session (not a handoff ticket) is still usable or refreshable.
 */
export async function hasActiveSuperadminSession(userId: number): Promise<boolean> {
  const now = new Date();
  const count = await prisma.session.count({
    where: {
      user_id: BigInt(userId),
      revoked: false,
      refresh_hash: { not: null },
      NOT: { user_agent: { startsWith: HANDOFF_TICKET_USER_AGENT_PREFIX } },
      OR: [{ expires_at: { gt: now } }, { refresh_expires_at: { gt: now } }],
    },
  });
  return count > 0;
}

/**
 * Replace the token hashes of a freshly created session with hashes of values
 * nobody knows. Used when a session is created on behalf of SmartPet so the
 * Set-Cookie emitted by createSession() can never be replayed.
 */
export async function neutralizeSessionTokens(sessionId: number): Promise<void> {
  await prisma.session.update({
    where: { id: BigInt(sessionId) },
    data: {
      token_hash: crypto.createHash("sha256").update(generateRandomToken(32)).digest("hex"),
      refresh_hash: crypto.createHash("sha256").update(generateRandomToken(32)).digest("hex"),
      updated_at: new Date(),
    },
  });
}

export async function revokeSessionById(sessionId: number): Promise<void> {
  await prisma.session.updateMany({
    where: { id: BigInt(sessionId), revoked: false },
    data: revokedSessionData(),
  });
}

export async function revokeAllSuperadminSessions(userId: number): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { user_id: BigInt(userId), revoked: false },
    data: revokedSessionData(),
  });
  return result.count;
}

/**
 * Single-use handoff ticket stored as an inert Session row:
 *  - token_hash is domain-separated, so the ticket is never a valid cookie
 *  - expires_at is already in the past, so validateToken() rejects it
 *  - refresh_hash is null, so refresh can never find it
 *  - refresh_expires_at carries the ticket expiry
 *  - user_agent binds it to the browser's SSO state (hash only)
 */
export async function issueSessionHandoffTicket(input: {
  userId: number;
  stateHash: string;
  ipAddress?: string | null;
}): Promise<{ ticket: string; expiresAt: Date }> {
  if (!isValidStateHash(input.stateHash)) {
    throw new Error("INVALID_STATE_HASH");
  }

  const ticket = generateRandomToken(32);
  const now = Date.now();
  const expiresAt = new Date(now + HANDOFF_TICKET_TTL_SECONDS * 1000);

  await prisma.session.create({
    data: {
      user_id: BigInt(input.userId),
      token_hash: hashHandoffTicket(ticket),
      refresh_hash: null,
      expires_at: new Date(now - 1000),
      refresh_expires_at: expiresAt,
      ip_address: input.ipAddress?.substring(0, 45) ?? null,
      user_agent: handoffTicketUserAgent(input.stateHash),
      remember_me: false,
      revoked: false,
    },
  });

  return { ticket, expiresAt };
}

/**
 * Atomically consume a ticket. The conditional update guarantees exactly one
 * winner even across server instances. A ticket presented with the wrong
 * state is burned so it cannot be retried from another browser.
 */
export async function consumeSessionHandoffTicket(input: {
  ticket: string;
  state: string;
}): Promise<number | null> {
  if (!isValidHandoffTicket(input.ticket) || !isValidSsoState(input.state)) {
    return null;
  }

  const tokenHash = hashHandoffTicket(input.ticket);
  const now = new Date();

  const consumed = await prisma.session.updateMany({
    where: {
      token_hash: tokenHash,
      revoked: false,
      refresh_hash: null,
      user_agent: handoffTicketUserAgent(hashSsoState(input.state)),
      refresh_expires_at: { gt: now },
    },
    data: { revoked: true, updated_at: now },
  });

  if (consumed.count !== 1) {
    await prisma.session.updateMany({
      where: {
        token_hash: tokenHash,
        revoked: false,
        refresh_hash: null,
        user_agent: { startsWith: HANDOFF_TICKET_USER_AGENT_PREFIX },
      },
      data: { revoked: true, updated_at: now },
    });
    return null;
  }

  const row = await prisma.session.findUnique({
    where: { token_hash: tokenHash },
    select: { user_id: true },
  });
  return row ? Number(row.user_id) : null;
}
