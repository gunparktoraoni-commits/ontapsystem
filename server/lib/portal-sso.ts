import crypto from "crypto";

const SSO_TTL_SECONDS = 90;
const SSO_AUD = "pet-tags-superadmin";
const SSO_ISS = "ontap-portal";

export type PortalSsoClaims = {
  iss: string;
  aud: string;
  email: string;
  fullName: string;
  role: "SUPERADMIN";
  jti: string;
  iat: number;
  exp: number;
  /** Browser-bound SSO state echoed back to SmartPet (silent sign-in only). */
  state?: string;
};

function getSsoSecret(): string {
  const secret = process.env.CROSS_PORTAL_SSO_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("CROSS_PORTAL_SSO_SECRET is missing or too short");
  }
  return secret;
}

/**
 * Origin of the SmartPet (tappetsystem) deployment. SSO tokens are appended to
 * this URL, so it must be a clean http(s) origin — https outside development.
 */
export function getPetTagsAppUrl(): string {
  const raw =
    process.env.PET_TAGS_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_PET_TAGS_APP_URL?.trim() ||
    "";
  if (!raw) {
    throw new Error("PET_TAGS_APP_URL is not configured");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("PET_TAGS_APP_URL is not a valid URL");
  }
  const isLocalHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (
    (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocalHost)) ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("PET_TAGS_APP_URL must be an https origin");
  }
  return parsed.origin;
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signPayload(payloadJson: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payloadJson).digest("base64url");
}

/**
 * Create a short-lived, signed one-time SSO token for SmartPet SUPERADMIN handoff.
 */
export function createPetTagsPortalSwitchToken(input: {
  email: string;
  fullName: string;
  state?: string;
}): { token: string; redirectUrl: string; expiresAt: string } {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new Error("Invalid superadmin email for portal switch");
  }
  if (input.state !== undefined && !/^[A-Za-z0-9_-]{43,128}$/.test(input.state)) {
    throw new Error("Invalid SSO state for portal switch");
  }

  const now = Math.floor(Date.now() / 1000);
  const claims: PortalSsoClaims = {
    iss: SSO_ISS,
    aud: SSO_AUD,
    email,
    fullName: (input.fullName || email.split("@")[0] || "Superadmin").trim().slice(0, 120),
    role: "SUPERADMIN",
    jti: crypto.randomBytes(16).toString("hex"),
    iat: now,
    exp: now + SSO_TTL_SECONDS,
    ...(input.state ? { state: input.state } : {}),
  };

  const payloadJson = JSON.stringify(claims);
  const payloadPart = base64UrlEncode(payloadJson);
  const signature = signPayload(payloadPart, getSsoSecret());
  const token = `${payloadPart}.${signature}`;

  const redirectUrl = input.state
    ? `${getPetTagsAppUrl()}/auth/sso/consume?token=${encodeURIComponent(token)}&state=${encodeURIComponent(input.state)}`
    : `${getPetTagsAppUrl()}/auth/sso/consume?token=${encodeURIComponent(token)}`;

  return {
    token,
    redirectUrl,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  };
}

export function isPortalSwitchConfigured(): boolean {
  try {
    getSsoSecret();
    getPetTagsAppUrl();
    return true;
  } catch {
    return false;
  }
}
