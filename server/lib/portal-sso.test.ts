import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createPetTagsPortalSwitchToken,
  getPetTagsAppUrl,
  isPortalSwitchConfigured,
} from "./portal-sso";

const SECRET = "portal-sso-test-secret-with-at-least-32-chars";
const saved = { ...process.env };

beforeEach(() => {
  process.env.CROSS_PORTAL_SSO_SECRET = SECRET;
  process.env.PET_TAGS_APP_URL = "https://smartpet.ontap.ph/";
  delete process.env.NEXT_PUBLIC_PET_TAGS_APP_URL;
});

afterEach(() => {
  process.env = { ...saved };
});

describe("portal switch to SmartPet", () => {
  it("redirects to the SmartPet SSO consume page with a signed one-time token", () => {
    const { redirectUrl, token } = createPetTagsPortalSwitchToken({
      email: "Boss@OnTap.PH",
      fullName: "Ada Boss",
    });

    const url = new URL(redirectUrl);
    expect(url.origin).toBe("https://smartpet.ontap.ph");
    expect(url.pathname).toBe("/auth/sso/consume");
    expect(url.searchParams.get("token")).toBe(token);
    expect(url.searchParams.has("state")).toBe(false);

    const [payloadPart, signature] = token.split(".");
    expect(signature).toBe(crypto.createHmac("sha256", SECRET).update(payloadPart).digest("base64url"));
    const claims = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
    expect(claims).toMatchObject({
      iss: "ontap-portal",
      aud: "pet-tags-superadmin",
      email: "boss@ontap.ph",
      role: "SUPERADMIN",
    });
    expect(claims.exp - claims.iat).toBe(90);
    expect(claims.jti).toMatch(/^[a-f0-9]{32}$/);
  });

  it("uses only the configured origin", () => {
    process.env.PET_TAGS_APP_URL = "https://smartpet.ontap.ph/some/path?x=1";
    expect(getPetTagsAppUrl()).toBe("https://smartpet.ontap.ph");
  });

  it("refuses misconfigured SmartPet URLs instead of redirecting somewhere unexpected", () => {
    for (const bad of [
      "smartpet.ontap.ph",
      "http://smartpet.ontap.ph",
      "https://user:pass@smartpet.ontap.ph",
      "javascript:alert(1)",
    ]) {
      process.env.PET_TAGS_APP_URL = bad;
      expect(() => getPetTagsAppUrl()).toThrow();
      expect(isPortalSwitchConfigured()).toBe(false);
    }
    process.env.PET_TAGS_APP_URL = "http://localhost:3000";
    expect(getPetTagsAppUrl()).toBe("http://localhost:3000");
  });

  it("is unavailable without a strong signing secret", () => {
    process.env.CROSS_PORTAL_SSO_SECRET = "short";
    expect(isPortalSwitchConfigured()).toBe(false);
    expect(() => createPetTagsPortalSwitchToken({ email: "boss@ontap.ph", fullName: "" })).toThrow();
  });
});
