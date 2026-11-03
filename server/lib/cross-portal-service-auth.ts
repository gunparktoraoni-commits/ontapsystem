import crypto from "node:crypto";

const MAX_SKEW_SECONDS = 60;
const NONCE_TTL_MS = 120_000;
const CALLER_ID = "smartpet-admin";

type NonceEntry = { expiresAt: number };

const usedNonces = new Map<string, NonceEntry>();

function pruneNonces(now: number) {
  if (usedNonces.size < 500) return;
  for (const [key, entry] of usedNonces) {
    if (entry.expiresAt <= now) usedNonces.delete(key);
  }
}

export function getCrossPortalServiceSecret(): string {
  const secret = process.env.CROSS_PORTAL_SERVICE_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("CROSS_PORTAL_SERVICE_SECRET is missing or too short");
  }
  return secret;
}

export function isCrossPortalServiceConfigured(): boolean {
  try {
    getCrossPortalServiceSecret();
    return true;
  } catch {
    return false;
  }
}

function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function hashBody(bodyText: string): string {
  return crypto.createHash("sha256").update(bodyText).digest("hex");
}

/**
 * Canonical string for request HMAC:
 * METHOD\\nPATH\\nTIMESTAMP\\nNONCE\\nBODY_SHA256
 */
export function buildCanonicalString(input: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  bodyHash: string;
}): string {
  return [
    input.method.toUpperCase(),
    input.path,
    input.timestamp,
    input.nonce,
    input.bodyHash,
  ].join("\n");
}

export function signCanonical(canonical: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(canonical).digest("hex");
}

export type VerifiedCrossPortalRequest = {
  timestamp: number;
  nonce: string;
  caller: string;
};

/**
 * Verify inbound SmartPet → OnTap service call.
 * Rejects bad signatures, skew, replayed nonces, and unknown callers.
 */
export function verifyCrossPortalServiceRequest(input: {
  method: string;
  path: string;
  bodyText: string;
  headers: Headers;
}): VerifiedCrossPortalRequest {
  const secret = getCrossPortalServiceSecret();
  const timestampHeader = input.headers.get("x-cross-portal-timestamp")?.trim() ?? "";
  const nonce = input.headers.get("x-cross-portal-nonce")?.trim() ?? "";
  const signature = input.headers.get("x-cross-portal-signature")?.trim() ?? "";
  const caller = input.headers.get("x-cross-portal-caller")?.trim() ?? "";

  if (!timestampHeader || !nonce || !signature || caller !== CALLER_ID) {
    throw new Error("CROSS_PORTAL_AUTH_INVALID");
  }

  if (!/^\d+$/.test(timestampHeader) || nonce.length < 16 || nonce.length > 128) {
    throw new Error("CROSS_PORTAL_AUTH_INVALID");
  }

  const timestamp = Number(timestampHeader);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > MAX_SKEW_SECONDS) {
    throw new Error("CROSS_PORTAL_AUTH_SKEW");
  }

  const bodyHash = hashBody(input.bodyText);
  const canonical = buildCanonicalString({
    method: input.method,
    path: input.path,
    timestamp: timestampHeader,
    nonce,
    bodyHash,
  });
  const expected = signCanonical(canonical, secret);

  if (!timingSafeEqualString(signature.toLowerCase(), expected.toLowerCase())) {
    throw new Error("CROSS_PORTAL_AUTH_INVALID");
  }

  const nowMs = Date.now();
  pruneNonces(nowMs);
  if (usedNonces.has(nonce)) {
    throw new Error("CROSS_PORTAL_AUTH_REPLAY");
  }
  usedNonces.set(nonce, { expiresAt: nowMs + NONCE_TTL_MS });

  return { timestamp, nonce, caller };
}
