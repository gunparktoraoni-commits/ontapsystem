import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_SUPERADMIN_REDIRECT,
  decodeStateCookie,
  encodeStateCookie,
  generateRandomToken,
  handoffTicketUserAgent,
  hashHandoffTicket,
  hashSsoState,
  isCrossPortalSuperadminRole,
  isTrustedReferrer,
  isValidHandoffTicket,
  isValidSsoState,
  isValidStateHash,
  safeOrigin,
  sanitizeSuperadminRedirect,
} from "./cross-portal-sso-policy";

describe("cross-portal SSO policy", () => {
  it("accepts only superadmin portal roles", () => {
    expect(isCrossPortalSuperadminRole("super_admin")).toBe(true);
    expect(isCrossPortalSuperadminRole(" DEV ")).toBe(true);
    for (const role of ["staff", "admin", "user", "", null, undefined, 1]) {
      expect(isCrossPortalSuperadminRole(role)).toBe(false);
    }
  });

  it("generates high-entropy URL-safe state and tickets", () => {
    const a = generateRandomToken(32);
    const b = generateRandomToken(32);
    expect(a).not.toBe(b);
    expect(isValidSsoState(a)).toBe(true);
    expect(isValidHandoffTicket(b)).toBe(true);
  });

  it("rejects malformed state and tickets", () => {
    for (const value of ["", "short", "a".repeat(42), "a".repeat(129), `${"a".repeat(43)}!`, "a b".repeat(20), null, 42]) {
      expect(isValidSsoState(value)).toBe(false);
      expect(isValidHandoffTicket(value)).toBe(false);
    }
  });

  it("validates state hashes as lowercase sha256 hex", () => {
    expect(isValidStateHash(hashSsoState(generateRandomToken()))).toBe(true);
    expect(isValidStateHash("A".repeat(64))).toBe(false);
    expect(isValidStateHash("a".repeat(63))).toBe(false);
  });

  it("hashes tickets with domain separation so they never match a session token hash", () => {
    const ticket = generateRandomToken();
    const plainSessionHash = crypto.createHash("sha256").update(ticket).digest("hex");
    expect(hashHandoffTicket(ticket)).not.toBe(plainSessionHash);
    expect(hashHandoffTicket(ticket)).toBe(hashHandoffTicket(ticket));
    expect(handoffTicketUserAgent("f".repeat(64)).length).toBeLessThanOrEqual(512);
  });

  it("only allows superadmin portal paths as redirect targets", () => {
    expect(sanitizeSuperadminRedirect("/superadmin/users?page=2")).toBe("/superadmin/users?page=2");
    expect(sanitizeSuperadminRedirect("/dev")).toBe("/dev");
    const rejected = [
      "https://evil.example/superadmin",
      "//evil.example",
      "/\\evil.example",
      "/superadmin/../user",
      "/superadminx",
      "/user/dashboard",
      "javascript:alert(1)",
      "/superadmin/\u0000",
      `/superadmin/${"a".repeat(600)}`,
      "",
      undefined,
    ];
    for (const value of rejected) {
      expect(sanitizeSuperadminRedirect(value)).toBe(DEFAULT_SUPERADMIN_REDIRECT);
    }
  });

  it("round-trips the state cookie and sanitizes a tampered redirect", () => {
    const state = generateRandomToken();
    expect(decodeStateCookie(encodeStateCookie(state, "/superadmin/settings"))).toEqual({
      state,
      redirect: "/superadmin/settings",
    });

    const tampered = `${state}.${Buffer.from("https://evil.example").toString("base64url")}`;
    expect(decodeStateCookie(tampered)).toEqual({ state, redirect: DEFAULT_SUPERADMIN_REDIRECT });
    expect(decodeStateCookie("bad.cookie")).toBeNull();
    expect(decodeStateCookie(undefined)).toBeNull();
  });

  it("trusts only the exact partner origin as referrer", () => {
    const origin = safeOrigin("https://smartpet.ontap.ph/some/path");
    expect(origin).toBe("https://smartpet.ontap.ph");
    expect(isTrustedReferrer("https://smartpet.ontap.ph/admin/login", origin)).toBe(true);
    expect(isTrustedReferrer("https://smartpet.ontap.ph.evil.example/", origin)).toBe(false);
    expect(isTrustedReferrer("https://user:pass@smartpet.ontap.ph/", origin)).toBe(false);
    expect(isTrustedReferrer(null, origin)).toBe(false);
    expect(isTrustedReferrer("https://smartpet.ontap.ph/", null)).toBe(false);
  });
});
