import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn() },
    session: {
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
  isReverificationRequired: vi.fn(() => false),
}));

vi.mock("@/server/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/server/lib/auth", () => ({
  isReverificationRequired: mocks.isReverificationRequired,
  revokedSessionData: (revokedAt: Date = new Date()) => ({
    revoked: true,
    refresh_hash: null,
    updated_at: revokedAt,
  }),
}));

import {
  consumeSessionHandoffTicket,
  evaluateSuperadminEligibility,
  hasActiveSuperadminSession,
  issueSessionHandoffTicket,
  revokeAllSuperadminSessions,
  revokeSessionById,
  type SuperadminAccount,
} from "./cross-portal-superadmin";
import {
  HANDOFF_TICKET_USER_AGENT_PREFIX,
  generateRandomToken,
  handoffTicketUserAgent,
  hashHandoffTicket,
  hashSsoState,
} from "./cross-portal-sso-policy";

function account(overrides: Partial<SuperadminAccount> = {}): SuperadminAccount {
  return {
    userId: 42,
    email: "boss@ontap.test",
    firstName: "Ada",
    lastName: "Boss",
    fullName: "Ada Boss",
    role: "super_admin",
    deactivated: false,
    isRestricted: false,
    restrictedUntil: null,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    lastReverificationAt: null,
    emailVerified: true,
    mustChangePassword: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isReverificationRequired.mockReturnValue(false);
});

describe("evaluateSuperadminEligibility", () => {
  it("admits verified super_admin and dev accounts", () => {
    expect(evaluateSuperadminEligibility(account())).toEqual({ ok: true });
    expect(evaluateSuperadminEligibility(account({ role: "dev" }))).toEqual({ ok: true });
  });

  it("applies every OnTap login gate", () => {
    const cases: Array<[SuperadminAccount | null, string]> = [
      [null, "NOT_FOUND"],
      [account({ role: "admin" }), "NOT_SUPERADMIN"],
      [account({ role: "user" }), "NOT_SUPERADMIN"],
      [account({ deactivated: true }), "DEACTIVATED"],
      [account({ isRestricted: true }), "RESTRICTED"],
      [account({ isRestricted: true, restrictedUntil: new Date(Date.now() + 60_000) }), "RESTRICTED"],
      [account({ emailVerified: false }), "EMAIL_NOT_VERIFIED"],
      [account({ mustChangePassword: true }), "PASSWORD_CHANGE_REQUIRED"],
    ];
    for (const [input, reason] of cases) {
      expect(evaluateSuperadminEligibility(input)).toEqual({ ok: false, reason });
    }
  });

  it("lets an expired restriction lapse", () => {
    expect(
      evaluateSuperadminEligibility(
        account({ isRestricted: true, restrictedUntil: new Date(Date.now() - 60_000) }),
      ),
    ).toEqual({ ok: true });
  });

  it("requires pending reverification to be completed on OnTap", () => {
    mocks.isReverificationRequired.mockReturnValue(true);
    expect(evaluateSuperadminEligibility(account())).toEqual({
      ok: false,
      reason: "REVERIFICATION_REQUIRED",
    });
  });
});

describe("hasActiveSuperadminSession", () => {
  it("counts only real, unrevoked, refreshable sessions and ignores handoff tickets", async () => {
    mocks.prisma.session.count.mockResolvedValue(1);
    await expect(hasActiveSuperadminSession(42)).resolves.toBe(true);

    const where = mocks.prisma.session.count.mock.calls[0]![0].where;
    expect(where.user_id).toBe(BigInt(42));
    expect(where.revoked).toBe(false);
    expect(where.refresh_hash).toEqual({ not: null });
    expect(where.NOT).toEqual({ user_agent: { startsWith: HANDOFF_TICKET_USER_AGENT_PREFIX } });

    mocks.prisma.session.count.mockResolvedValue(0);
    await expect(hasActiveSuperadminSession(42)).resolves.toBe(false);
  });
});

describe("revokeAllSuperadminSessions", () => {
  it("revokes every live session of the account", async () => {
    mocks.prisma.session.updateMany.mockResolvedValue({ count: 3 });
    await expect(revokeAllSuperadminSessions(42)).resolves.toBe(3);
    const call = mocks.prisma.session.updateMany.mock.calls[0]![0];
    expect(call.where).toEqual({ user_id: BigInt(42), revoked: false });
    // Stale cookies of these sessions must read as unknown, not as token reuse.
    expect(call.data).toMatchObject({ revoked: true, refresh_hash: null });
  });

  it("clears the refresh hash when revoking a single session", async () => {
    mocks.prisma.session.updateMany.mockResolvedValue({ count: 1 });
    await revokeSessionById(7);
    const call = mocks.prisma.session.updateMany.mock.calls[0]![0];
    expect(call.where).toEqual({ id: BigInt(7), revoked: false });
    expect(call.data).toMatchObject({ revoked: true, refresh_hash: null });
  });
});

describe("session handoff tickets", () => {
  const state = generateRandomToken(32);
  const stateHash = hashSsoState(state);

  it("stores tickets as inert, state-bound rows", async () => {
    mocks.prisma.session.create.mockResolvedValue({});
    const before = Date.now();
    const { ticket, expiresAt } = await issueSessionHandoffTicket({ userId: 42, stateHash });

    const data = mocks.prisma.session.create.mock.calls[0]![0].data;
    expect(data.token_hash).toBe(hashHandoffTicket(ticket));
    expect(data.token_hash).not.toBe(crypto.createHash("sha256").update(ticket).digest("hex"));
    expect(data.refresh_hash).toBeNull();
    expect(data.expires_at.getTime()).toBeLessThan(before);
    expect(data.refresh_expires_at).toEqual(expiresAt);
    expect(expiresAt.getTime() - before).toBeLessThanOrEqual(61_000);
    expect(data.user_agent).toBe(handoffTicketUserAgent(stateHash));
    expect(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toContain(
      ticket,
    );
  });

  it("rejects malformed state hashes", async () => {
    await expect(issueSessionHandoffTicket({ userId: 42, stateHash: "nope" })).rejects.toThrow(
      "INVALID_STATE_HASH",
    );
    expect(mocks.prisma.session.create).not.toHaveBeenCalled();
  });

  it("consumes a ticket exactly once with the matching state", async () => {
    const ticket = generateRandomToken(32);
    mocks.prisma.session.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.prisma.session.findUnique.mockResolvedValue({ user_id: BigInt(42) });

    await expect(consumeSessionHandoffTicket({ ticket, state })).resolves.toBe(42);
    const where = mocks.prisma.session.updateMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({
      token_hash: hashHandoffTicket(ticket),
      revoked: false,
      refresh_hash: null,
      user_agent: handoffTicketUserAgent(stateHash),
    });
    expect(where.refresh_expires_at.gt).toBeInstanceOf(Date);
  });

  it("burns the ticket when presented with another browser's state or after use", async () => {
    const ticket = generateRandomToken(32);
    mocks.prisma.session.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    await expect(
      consumeSessionHandoffTicket({ ticket, state: generateRandomToken(32) }),
    ).resolves.toBeNull();

    expect(mocks.prisma.session.updateMany).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.session.updateMany.mock.calls[1]![0].where).toMatchObject({
      token_hash: hashHandoffTicket(ticket),
      revoked: false,
      refresh_hash: null,
      user_agent: { startsWith: HANDOFF_TICKET_USER_AGENT_PREFIX },
    });
    expect(mocks.prisma.session.findUnique).not.toHaveBeenCalled();
  });

  it("ignores malformed tickets and states without touching the database", async () => {
    await expect(consumeSessionHandoffTicket({ ticket: "short", state })).resolves.toBeNull();
    await expect(
      consumeSessionHandoffTicket({ ticket: generateRandomToken(32), state: "bad state" }),
    ).resolves.toBeNull();
    expect(mocks.prisma.session.updateMany).not.toHaveBeenCalled();
  });
});
