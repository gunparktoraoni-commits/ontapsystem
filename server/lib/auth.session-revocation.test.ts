import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    session: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    user: { findUnique: vi.fn() },
  },
  cookieStore: { get: vi.fn(), set: vi.fn() },
  sendSecurityAlert: vi.fn(async () => undefined),
  auditCreate: vi.fn(async () => undefined),
}));

vi.mock("./prisma", () => ({ prisma: mocks.prisma }));
vi.mock("./prisma-analytics", () => ({ prismaAnalytics: { auditLog: { create: mocks.auditCreate } } }));
vi.mock("./security-alerts", () => ({ sendSecurityAlert: mocks.sendSecurityAlert }));
vi.mock("next/headers", () => ({ cookies: async () => mocks.cookieStore }));
vi.mock("@/server/lib/superadmin-impersonation", () => ({
  getImpersonationTokenFromRequest: vi.fn(() => ({ token: null, source: null })),
  validateSuperadminImpersonationToken: vi.fn(),
  clearImpersonationCookiesFromStore: vi.fn(async () => undefined),
}));
vi.mock("@/server/lib/company-employee-acting-context", () => ({
  getCompanyActingTokenFromRequest: vi.fn(() => ({ token: null, source: null })),
  validateCompanyActingToken: vi.fn(),
  clearCompanyActingCookiesFromStore: vi.fn(async () => undefined),
}));
vi.mock("@/server/lib/user-presence", () => ({
  recordUserLoginPresence: vi.fn(async () => undefined),
  recordUserLogoutPresence: vi.fn(async () => undefined),
  touchUserPresence: vi.fn(async () => undefined),
}));

import { refreshSession, revokeAllSessions, revokedSessionData } from "./auth";

const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookieStore.get.mockReturnValue(undefined);
  mocks.prisma.session.updateMany.mockResolvedValue({ count: 0 });
});

describe("session revocation vs refresh reuse detection", () => {
  it("clears the refresh hash on every non-rotation revocation", async () => {
    const at = new Date("2026-01-01T00:00:00.000Z");
    expect(revokedSessionData(at)).toEqual({ revoked: true, refresh_hash: null, updated_at: at });

    await revokeAllSessions(42);
    const call = mocks.prisma.session.updateMany.mock.calls[0]![0];
    expect(call.where).toEqual({ user_id: BigInt(42), revoked: false });
    expect(call.data).toMatchObject({ revoked: true, refresh_hash: null });
  });

  it("treats a refresh cookie of a logged-out session as unknown without purging other sessions", async () => {
    mocks.prisma.session.findUnique.mockResolvedValue(null);

    const result = await refreshSession({ refreshToken: "stale-cookie-from-revoked-session" });

    expect(result).toEqual({ success: false, error: "Invalid refresh token." });
    expect(mocks.prisma.session.findUnique.mock.calls[0]![0].where).toEqual({
      refresh_hash: hash("stale-cookie-from-revoked-session"),
    });
    expect(mocks.prisma.session.updateMany).not.toHaveBeenCalled();
    expect(mocks.sendSecurityAlert).not.toHaveBeenCalled();
  });

  it("still purges every session when a rotated-away token is replayed, and burns it", async () => {
    mocks.prisma.session.findUnique.mockResolvedValue({
      id: BigInt(9),
      user_id: BigInt(42),
      remember_me: false,
      refresh_expires_at: new Date(Date.now() + 60_000),
      revoked: true,
      ip_address: "203.0.113.1",
      user_agent: "Browser A",
      updated_at: new Date(Date.now() - 10 * 60_000),
      user: { email: "boss@ontap.test", role: "super_admin", deactivated_flag: false, is_restricted: false, restricted_until: null },
    });

    const result = await refreshSession({
      refreshToken: "rotated-token",
      ip: "198.51.100.7",
      userAgent: "Browser B",
    });

    expect(result.success).toBe(false);
    expect(mocks.prisma.session.updateMany).toHaveBeenCalledTimes(1);
    const call = mocks.prisma.session.updateMany.mock.calls[0]![0];
    expect(call.where).toEqual({ user_id: BigInt(42), OR: [{ revoked: false }, { id: BigInt(9) }] });
    expect(call.data).toMatchObject({ revoked: true, refresh_hash: null });
    expect(mocks.sendSecurityAlert).toHaveBeenCalledTimes(1);
  });

  it("keeps the benign same-device concurrency window", async () => {
    mocks.prisma.session.findUnique.mockResolvedValue({
      id: BigInt(9),
      user_id: BigInt(42),
      remember_me: false,
      refresh_expires_at: new Date(Date.now() + 60_000),
      revoked: true,
      ip_address: "203.0.113.1",
      user_agent: "Browser A",
      updated_at: new Date(Date.now() - 1_000),
      user: { email: "boss@ontap.test", role: "super_admin", deactivated_flag: false, is_restricted: false, restricted_until: null },
    });

    const result = await refreshSession({ refreshToken: "just-rotated", userAgent: "Browser A" });

    expect(result.success).toBe(false);
    expect(mocks.prisma.session.updateMany).not.toHaveBeenCalled();
  });
});
