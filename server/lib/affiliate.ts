// ──────────────────────────────────────────────────────────────
// Affiliate System Helpers
// ──────────────────────────────────────────────────────────────
// Centralizes:
//   • Affiliate status verification (gate for all affiliate routes)
//   • Payment-details encryption / decryption (AES-256-GCM)
//   • Email anonymization (PII reduction in activity feeds)
//   • Balance calculation helpers
//   • Idempotency key generation for withdrawal requests
//   • Date-range resolution (reuses analytics helper)
//
// Security notes:
//   - Payment details are encrypted at rest with AES-256-GCM.
//     The encryption key MUST be stored in the AFFILIATE_ENCRYPTION_KEY
//     environment variable (32-byte hex = 64 chars).
//   - We never log decrypted payment details.
//   - Visitor IDs in click tracking are HMAC-SHA256 hashes of IP+UA,
//     never storing raw PII.
// ──────────────────────────────────────────────────────────────

import crypto from "crypto";
import type { NextRequest } from "next/server";
import { prisma } from "./prisma";
import { prismaAnalytics } from "./prisma-analytics";
import { formatTimeAgo } from "./analytics";
import { logAuditEvent, resolveRequestSession } from "./auth";
import { sendSecurityAlert } from "./security-alerts";

export { formatTimeAgo };

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

export interface AffiliateSummaryData {
  userId: number;
  commissionRate: number;
  affiliateLevel: string;
  paymentThreshold: number;
  autoWithdrawal: boolean;
}

export type AffiliateActivityType =
  | "click"
  | "signup"
  | "order"
  | "commission_approved"
  | "withdrawal_requested"
  | "withdrawal_completed";

interface AffiliateEnrollmentSignals {
  hasAffiliateCode: boolean;
  hasLegacyAffiliate: boolean;
  hasLink: boolean;
  hasReferral: boolean;
  hasCommission: boolean;
  hasWithdrawal: boolean;
}

function hasExplicitAffiliateEnrollment(signals: AffiliateEnrollmentSignals): boolean {
  return (
    signals.hasAffiliateCode ||
    signals.hasLegacyAffiliate ||
    signals.hasLink ||
    signals.hasReferral ||
    signals.hasCommission ||
    signals.hasWithdrawal
  );
}

// ──────────────────────────────────────────
// Affiliate Status Check
// ──────────────────────────────────────────

/**
 * Verify that a user is an active affiliate.
 * Primary source is AffiliateSettings.
 *
 * Backward compatibility:
 * Some legacy affiliates predate AffiliateSettings rows. For those users,
 * we lazily create settings when we detect clear affiliate enrollment/history.
 * Returns the settings record on success, null on failure.
 */
export async function getAffiliateSettings(userId: number) {
  const uid = BigInt(userId);

  const existing = await prisma.affiliateSettings.findUnique({
    where: { user_id: uid },
  });
  if (existing) return existing;

  const [user, legacyAffiliate, hasLink, hasReferral, hasCommission, hasWithdrawal] = await Promise.all([
    prisma.user.findUnique({
      where: { user_id: uid },
      select: { affiliate_code: true },
    }),
    prisma.affiliate.findFirst({
      where: { user_id: uid },
      select: { affiliates_id: true },
    }),
    prisma.affiliateLink.findFirst({
      where: { affiliate_user_id: uid },
      select: { id: true },
    }),
    prisma.referral.findFirst({
      where: { affiliate_user_id: uid },
      select: { id: true },
    }),
    prisma.commission.findFirst({
      where: { affiliate_user_id: uid },
      select: { id: true },
    }),
    prisma.withdrawal.findFirst({
      where: { affiliate_user_id: uid },
      select: { id: true },
    }),
  ]);

  const signals: AffiliateEnrollmentSignals = {
    hasAffiliateCode: typeof user?.affiliate_code === "string" && user.affiliate_code.trim() !== "",
    hasLegacyAffiliate: Boolean(legacyAffiliate),
    hasLink: Boolean(hasLink),
    hasReferral: Boolean(hasReferral),
    hasCommission: Boolean(hasCommission),
    hasWithdrawal: Boolean(hasWithdrawal),
  };

  const hasEnrollmentSignal = hasExplicitAffiliateEnrollment(signals);

  if (!hasEnrollmentSignal) {
    await logAuditEvent("AFFILIATE_ACCESS_DENIED", userId, undefined, undefined, {
      source: "getAffiliateSettings:no-enrollment",
    });

    const recentDenied = await prismaAnalytics.auditLog.count({
      where: {
        user_id: BigInt(userId),
        action: "AFFILIATE_ACCESS_DENIED",
        created_at: { gte: new Date(Date.now() - 15 * 60 * 1000) },
      },
    });

    if (recentDenied >= 5) {
      await sendSecurityAlert({
        type: "AFFILIATE_ACCESS_ANOMALY",
        severity: "warning",
        userId,
        metadata: {
          recentDenied,
          windowMinutes: 15,
        },
      });
    }

    return null;
  }

  const createdSettings = await prisma.affiliateSettings.upsert({
    where: { user_id: uid },
    create: { user_id: uid },
    update: {},
  });

  await logAuditEvent("AFFILIATE_SETTINGS_CREATED", userId, undefined, undefined, {
    source: "getAffiliateSettings:auto-create",
    ...signals,
  });

  const recentCreations = await prismaAnalytics.auditLog.count({
    where: {
      user_id: BigInt(userId),
      action: "AFFILIATE_SETTINGS_CREATED",
      created_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  });

  if (recentCreations > 1) {
    await sendSecurityAlert({
      type: "AFFILIATE_CREATION_ANOMALY",
      severity: "warning",
      userId,
      metadata: {
        recentCreations,
        source: "getAffiliateSettings:auto-create",
      },
    });
  }

  return createdSettings;
}

/**
 * Get or create AffiliateSettings for a user.
 * Used during affiliate onboarding flows.
 */
export async function ensureAffiliateSettings(userId: number | bigint) {
  const uid = BigInt(userId);
  return prisma.affiliateSettings.upsert({
    where: { user_id: uid },
    create: { user_id: uid },
    update: {},
  });
}

const AFFILIATE_CODE_LENGTH = 12;
const AFFILIATE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function normalizeAffiliateCode(code: string): string {
  return code.trim().toUpperCase();
}

export function resolveStorefrontBaseUrl(): string {
  const candidates = [
    process.env.LANDING_URL,
    process.env.STOREFRONT_URL,
    process.env.NEXT_PUBLIC_LANDING_URL,
    "https://ontap.ph",
  ];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim().replace(/\/$/, "");
    if (!trimmed) continue;
    try {
      return new URL(trimmed).origin;
    } catch {
      continue;
    }
  }
  return "https://ontap.ph";
}

function buildGuestAffiliateDestination(referralCode?: string, portalFallbackUrl?: URL): URL {
  const storefront = resolveStorefrontBaseUrl();
  try {
    const url = new URL("/products", storefront);
    if (referralCode) url.searchParams.set("ref", referralCode);
    return url;
  } catch {
    const url = portalFallbackUrl ?? new URL("/user/emarket", "https://portal.ontap.ph");
    if (referralCode) url.searchParams.set("ref", referralCode);
    return url;
  }
}

async function buildPortalAffiliateDestination(
  request: NextRequest,
  userId: number,
  referralCode?: string,
): Promise<URL> {
  const itemCount = await prisma.cartItem.count({
    where: { user_id: BigInt(userId) },
  });

  const url = new URL("/user/emarket", request.url);
  if (itemCount > 0) {
    url.searchParams.set("tab", "cart");
  }
  if (referralCode) {
    url.searchParams.set("ref", referralCode);
  }
  return url;
}

/**
 * Resolve where an affiliate link should land.
 * Authenticated users stay in the portal (cart when items exist, otherwise e-market).
 * Guests are sent to the public storefront with the referral query preserved.
 */
export async function resolveAffiliateLinkDestination(
  request: NextRequest,
  referralCode?: string,
): Promise<URL> {
  const normalizedCode = referralCode?.trim().toUpperCase() ?? "";
  const portalFallback = new URL("/user/emarket", request.url);
  const sessionResult = await resolveRequestSession(request);

  if (sessionResult.session) {
    return buildPortalAffiliateDestination(
      request,
      sessionResult.session.userId,
      normalizedCode || undefined,
    );
  }

  return buildGuestAffiliateDestination(normalizedCode || undefined, portalFallback);
}

export function generateAffiliateCode(): string {
  const bytes = crypto.randomBytes(AFFILIATE_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < AFFILIATE_CODE_LENGTH; i += 1) {
    code += AFFILIATE_CODE_ALPHABET[bytes[i] % AFFILIATE_CODE_ALPHABET.length];
  }
  return code;
}

export enum AffiliateLinkErrorCode {
  REFERRAL_LINK_GENERATION_FAILED = "REFERRAL_LINK_GENERATION_FAILED",
}

export async function getOrGenerateAffiliateCode(userId: number | bigint) {
  const uid = BigInt(userId);

  const existing = await prisma.user.findUnique({
    where: { user_id: uid },
    select: { affiliate_code: true },
  });
  if (existing?.affiliate_code) {
    return existing.affiliate_code;
  }

  await ensureAffiliateSettings(uid);
  const affiliateJoinedAt = new Date();

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const affiliateCode = generateAffiliateCode();
    const conflict = await prisma.user.findFirst({
      where: { affiliate_code: affiliateCode },
      select: { user_id: true },
    });
    if (conflict) continue;

    const updateResult = await prisma.user.updateMany({
      where: { user_id: uid, affiliate_code: null },
      data: {
        affiliate_code: affiliateCode,
        is_affiliate: true,
        affiliate_joined_at: affiliateJoinedAt,
      },
    });

    if (updateResult.count === 1) {
      return affiliateCode;
    }

    const refreshed = await prisma.user.findUnique({
      where: { user_id: uid },
      select: { affiliate_code: true },
    });
    if (refreshed?.affiliate_code) {
      return refreshed.affiliate_code;
    }
  }

  throw new Error("Unable to generate a unique affiliate code.");
}

export async function ensureAffiliateEnrollment(userId: number | bigint) {
  await ensureAffiliateSettings(userId);
  await getOrGenerateAffiliateCode(userId);

  const uid = BigInt(userId);
  const existing = await prisma.user.findUnique({
    where: { user_id: uid },
    select: { affiliate_joined_at: true },
  });

  await prisma.user.update({
    where: { user_id: uid },
    data: {
      is_affiliate: true,
      affiliate_joined_at: existing?.affiliate_joined_at ?? new Date(),
    },
  });
}

export function buildReferralUrl(affiliateCode: string, appUrl?: string) {
  const storefront = resolveStorefrontBaseUrl();
  const base =
    storefront ||
    appUrl?.trim().replace(/\/$/, "") ||
    "https://ontap.ph";
  const normalizedCode = encodeURIComponent(normalizeAffiliateCode(affiliateCode));
  // Prefer public storefront entry; portal /user/emarket?ref= remains supported.
  return `${base}/?ref=${normalizedCode}`;
}

export function buildTrackedReferralUrl(affiliateCode: string, portalAppUrl?: string) {
  const portalBase =
    portalAppUrl?.trim().replace(/\/$/, "") ||
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ||
    process.env.APP_URL?.trim().replace(/\/$/, "") ||
    "https://portal.ontap.ph";
  const normalizedCode = encodeURIComponent(normalizeAffiliateCode(affiliateCode));
  return `${portalBase}/api/affiliate/link-redirect?ref=${normalizedCode}`;
}

export type ShopAffiliateMeta = {
  affiliate_user_id: string;
  affiliate_code: string;
  commission_rate: number;
  discount_percent?: number;
  discount_amount?: number;
  attribution_source?: string;
  order_total?: number;
};

/**
 * Idempotently record shop-order affiliate attribution after payment succeeds.
 * Creates ShopCommission, ensures Referral row for first referrer, marks clicks converted.
 */
export async function recordShopOrderAffiliateAttribution(params: {
  shopOrderId: bigint | number;
  referredUserId: bigint | number;
  affiliateMeta: ShopAffiliateMeta | Record<string, unknown> | null | undefined;
  orderTotal?: number;
}): Promise<void> {
  const meta = params.affiliateMeta;
  if (!meta || typeof meta !== "object") return;

  const affiliateUserIdRaw =
    (meta as Record<string, unknown>).affiliate_user_id ??
    (meta as Record<string, unknown>).affiliateUserId;
  const affiliateCodeRaw =
    (meta as Record<string, unknown>).affiliate_code ??
    (meta as Record<string, unknown>).affiliateCode;
  if (affiliateUserIdRaw == null) return;

  const affiliateUserId = BigInt(String(affiliateUserIdRaw));
  const referredUserId = BigInt(params.referredUserId);
  const shopOrderId = BigInt(params.shopOrderId);
  if (affiliateUserId === referredUserId) return;

  const affiliateCode =
    typeof affiliateCodeRaw === "string"
      ? normalizeAffiliateCode(affiliateCodeRaw)
      : null;
  const commissionRate = Number(
    (meta as Record<string, unknown>).commission_rate ??
      (meta as Record<string, unknown>).commissionRate ??
      5,
  );
  const discountAmount = Number(
    (meta as Record<string, unknown>).discount_amount ??
      (meta as Record<string, unknown>).discountAmount ??
      0,
  );
  const orderTotal = Number(
    params.orderTotal ??
      (meta as Record<string, unknown>).order_total ??
      (meta as Record<string, unknown>).orderTotal ??
      0,
  );
  // Commission is rate% of paid order total (buyer discount is separate and usually 0).
  const rate = Number.isFinite(commissionRate) && commissionRate > 0 ? commissionRate : 5;
  const commissionBase = Number.isFinite(orderTotal) && orderTotal > 0 ? orderTotal : 0;
  const commissionAmount =
    Math.round(((commissionBase * rate) / 100) * 100) / 100;

  let createdCommission = false;
  try {
    await prisma.shopCommission.create({
      data: {
        shop_order_id: shopOrderId,
        affiliate_user_id: affiliateUserId,
        referred_user_id: referredUserId,
        affiliate_code: affiliateCode,
        commission_rate: rate,
        discount_amount: discountAmount,
        commission_amount: commissionAmount,
        commission_type: "one_time",
        status: "pending",
        metadata: JSON.stringify({
          ...meta,
          order_total: commissionBase,
          commission_rate: rate,
          commission_amount: commissionAmount,
        }),
      },
    });
    createdCommission = true;
  } catch (error: unknown) {
    // Unique constraint = already recorded (idempotent)
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code)
        : "";
    if (code !== "P2002") {
      console.error("[affiliate] ShopCommission create failed:", error);
      throw error;
    }
    return;
  }

  if (!createdCommission) return;

  let countedNewReferral = false;
  try {
    const existing = await prisma.referral.findUnique({
      where: { referred_user_id: referredUserId },
      select: { id: true, affiliate_user_id: true },
    });
    if (!existing) {
      await prisma.referral.create({
        data: {
          affiliate_user_id: affiliateUserId,
          referred_user_id: referredUserId,
          status: "converted",
          conversion_date: new Date(),
          qualification_source: "shop_order",
          lifetime_value: commissionBase || discountAmount,
        },
      });
      countedNewReferral = true;
    } else {
      await prisma.referral.update({
        where: { referred_user_id: referredUserId },
        data: {
          status: "converted",
          conversion_date: new Date(),
          updated_at: new Date(),
        },
      });
    }
  } catch (error) {
    console.warn("[affiliate] Referral upsert skipped:", error);
  }

  try {
    await prisma.affiliateClick.updateMany({
      where: {
        affiliate_user_id: affiliateUserId,
        converted: false,
      },
      data: {
        converted: true,
        conversion_user_id: referredUserId,
      },
    });
  } catch (error) {
    console.warn("[affiliate] AffiliateClick conversion update skipped:", error);
  }

  try {
    await prisma.user.update({
      where: { user_id: affiliateUserId },
      data: {
        ...(countedNewReferral
          ? { total_successful_referrals: { increment: 1 } }
          : {}),
        total_affiliate_earnings: { increment: commissionAmount },
      },
    });
  } catch (error) {
    console.warn("[affiliate] affiliate earnings counter update skipped:", error);
  }
}

export async function validateAffiliateCode(code: string) {
  const normalized = normalizeAffiliateCode(code);
  if (!normalized) return null;

  return prisma.user.findFirst({
    where: {
      affiliate_code: normalized,
      is_affiliate_restricted: false,
      is_active: true,
      OR: [
        { is_affiliate: true },
        {
          role: "staff",
          staffProfile: { is_active: true },
        },
      ],
    },
    select: {
      user_id: true,
      affiliate_code: true,
      is_affiliate: true,
      is_affiliate_restricted: true,
      role: true,
    },
  });
}

export async function recordAffiliateClick(
  affiliateUserId: bigint | number,
  ip?: string,
  userAgent?: string,
) {
  return prisma.affiliateClick.create({
    data: {
      affiliate_user_id: BigInt(affiliateUserId),
      visitor_id: ip ? buildVisitorId(ip, userAgent ?? "") : null,
      ip_prefix: ip ? buildAnonymizedIpPrefix(ip) : null,
      user_agent: userAgent?.slice(0, 512) ?? null,
      source: "affiliate-redirect",
      converted: false,
    },
  });
}

// ──────────────────────────────────────────
// PII Helpers
// ──────────────────────────────────────────

/**
 * Anonymize an email address for display in activity feeds.
 * john.doe@example.com → j***@example.com
 * Short local parts (1 char) are left as-is: a@b.com → a***@b.com
 */
export function anonymizeEmail(email: string): string {
  const atIdx = email.indexOf("@");
  if (atIdx <= 0) return "***";
  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx); // includes @
  const visible = local.slice(0, 1);
  return `${visible}***${domain}`;
}

/**
 * Build an anonymized IP prefix: "192.168.x.x"
 * Works for both IPv4 and IPv6 (shows first two segments).
 */
export function buildAnonymizedIpPrefix(ip: string): string {
  if (!ip || ip === "unknown") return "unknown";
  const parts = ip.includes(":") ? ip.split(":") : ip.split(".");
  const sep = ip.includes(":") ? ":" : ".";
  const first2 = parts.slice(0, 2).join(sep);
  return `${first2}${sep}x${sep}x`;
}

/**
 * Build a visitor ID by HMAC-SHA256 hashing IP + user-agent.
 * This de-duplicates visitors without storing raw PII.
 */
export function buildVisitorId(ip: string, userAgent: string): string {
  const secret = process.env.AFFILIATE_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("AFFILIATE_ENCRYPTION_KEY must be set for visitor hashing.");
  }
  return crypto
    .createHmac("sha256", secret)
    .update(`${ip}|${userAgent}`)
    .digest("hex");
}

// ──────────────────────────────────────────
// AES-256-GCM Encryption for Payment Details
// ──────────────────────────────────────────
// Why GCM?
//   - Authenticated encryption: protects against ciphertext tampering
//   - Built-in integrity check (auth tag) — no separate HMAC needed
//   - Random IV per encrypt call: same plaintext → different ciphertext
//
// Storage format: <iv_hex>:<authTag_hex>:<ciphertext_hex>
// If AFFILIATE_ENCRYPTION_KEY is missing, encryption is disabled and
// an error is thrown to prevent storing plaintext payment data.

const ALGO = "aes-256-gcm";
const KEY_HEX_LENGTH = 64; // 32 bytes → 64 hex chars

function getEncryptionKey(): Buffer {
  const raw = process.env.AFFILIATE_ENCRYPTION_KEY ?? "";
  if (raw.length !== KEY_HEX_LENGTH) {
    throw new Error(
      "AFFILIATE_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)."
    );
  }
  return Buffer.from(raw, "hex");
}

/**
 * Encrypt an arbitrary object as JSON using AES-256-GCM.
 * Returns a compact string: <iv>:<authTag>:<ciphertext> (all hex).
 */
export function encryptPaymentDetails(data: Record<string, unknown>): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // 96-bit nonce for GCM
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const plaintext = JSON.stringify(data);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

/**
 * Decrypt a payment details string produced by encryptPaymentDetails.
 * Returns the parsed object, or null if decryption fails (tampered data, wrong key).
 */
export function decryptPaymentDetails(
  ciphertext: string
): Record<string, unknown> | null {
  try {
    const key = getEncryptionKey();
    const parts = ciphertext.split(":");
    if (parts.length !== 3) return null;
    const [ivHex, authTagHex, encHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const encrypted = Buffer.from(encHex, "hex");
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────
// Balance Calculation
// ──────────────────────────────────────────

/**
 * Compute available_balance from first principles:
 *   approved_commissions  (cleared, not yet paid)
 *   - pending_withdrawals (requested + processing — not yet completed)
 *
 * This is more accurate than the cached AffiliateSettings.available_balance
 * and should be used for the withdraw-balance endpoint.
 */
export async function computeAvailableBalance(userId: number): Promise<number> {
  const uid = BigInt(userId);

  const [approvedResult, pendingWithdrawResult] = await Promise.all([
    prisma.commission.aggregate({
      where: { affiliate_user_id: uid, status: "approved" },
      _sum: { amount: true },
    }),
    prisma.withdrawal.aggregate({
      where: {
        affiliate_user_id: uid,
        status: { in: ["requested", "processing"] },
      },
      _sum: { amount: true },
    }),
  ]);

  const approved = Number(approvedResult._sum.amount ?? 0);
  const pendingOut = Number(pendingWithdrawResult._sum.amount ?? 0);
  return Math.max(0, approved - pendingOut);
}

/**
 * Compute pending_clearance: commissions in "pending" status.
 * These are commissions from orders within the reversal window.
 */
export async function computePendingClearance(userId: number): Promise<number> {
  const result = await prisma.commission.aggregate({
    where: { affiliate_user_id: BigInt(userId), status: "pending" },
    _sum: { amount: true },
  });
  return Number(result._sum.amount ?? 0);
}

// ──────────────────────────────────────────
// Withdrawal Idempotency
// ──────────────────────────────────────────

/**
 * Generate a time-bucketed idempotency key:
 *   SHA-256( userId + amountStr + method + minuteBucket )
 * Two requests with identical parameters within the same clock-minute
 * get the same key — the duplicate is rejected by the UNIQUE constraint.
 */
export function buildWithdrawalIdempotencyKey(
  userId: number,
  amount: number,
  method: string
): string {
  const minuteBucket = Math.floor(Date.now() / 60_000);
  const data = `${userId}:${amount.toFixed(2)}:${method}:${minuteBucket}`;
  return crypto.createHash("sha256").update(data).digest("hex");
}

// ──────────────────────────────────────────
// Conversion Rate Helpers
// ──────────────────────────────────────────

/**
 * Safe percentage calculation: avoids divide-by-zero.
 * Returns a number rounded to 2 decimal places.
 */
export function safePercent(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

export function resolveCommissionRate(
  userCommissionRate: number | null,
  settingsCommissionRate: number | null,
): number {
  return Number(userCommissionRate ?? settingsCommissionRate ?? 5);
}

export function referralDiscountFromCommission(commissionRate: number): number {
  return Math.min(Math.max(commissionRate, 0), 100);
}

export function computeDiscountAmount(subtotal: number, discountPercent: number): number {
  const discount = (subtotal * discountPercent) / 100;
  return Math.round(discount * 100) / 100;
}

// ──────────────────────────────────────────
// Date Range Helpers
// ──────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

export type AffiliateTimeframe = "month" | "quarter" | "year" | "all";

export interface AffiliateDateRange {
  start: Date;
  end: Date;
  prevStart: Date;
  prevEnd: Date;
  label: string;
}

/**
 * Resolve a pre-set timeframe into absolute UTC date boundaries.
 * Also returns the previous period for comparison calculations.
 */
export function resolveAffiliateDateRange(
  timeframe: string | null
): AffiliateDateRange {
  const now = new Date();
  const todayEnd = new Date(now);
  todayEnd.setUTCHours(23, 59, 59, 999);

  switch (timeframe) {
    case "quarter": {
      const qStart = new Date(
        Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1)
      );
      const prevQStart = new Date(qStart.getTime() - 91 * DAY_MS);
      prevQStart.setUTCDate(1); // normalize to month start
      return {
        start: qStart,
        end: todayEnd,
        prevStart: prevQStart,
        prevEnd: new Date(qStart.getTime() - 1),
        label: "quarter",
      };
    }
    case "year": {
      const yStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      const prevYStart = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
      return {
        start: yStart,
        end: todayEnd,
        prevStart: prevYStart,
        prevEnd: new Date(yStart.getTime() - 1),
        label: "year",
      };
    }
    case "all": {
      return {
        start: new Date(0),
        end: todayEnd,
        prevStart: new Date(0),
        prevEnd: new Date(0),
        label: "all",
      };
    }
    case "month":
    default: {
      const mStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
      );
      const prevMStart = new Date(
        Date.UTC(
          now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear(),
          now.getUTCMonth() === 0 ? 11 : now.getUTCMonth() - 1,
          1
        )
      );
      return {
        start: mStart,
        end: todayEnd,
        prevStart: prevMStart,
        prevEnd: new Date(mStart.getTime() - 1),
        label: "month",
      };
    }
  }
}

// ──────────────────────────────────────────
// Formatting
// ──────────────────────────────────────────

/**
 * Build a signed percentage-change string: "+12.50%", "-3.25%", "0.00%".
 */
export function formatPctChange(current: number, previous: number): string {
  if (!previous) return current > 0 ? "+100.00%" : "0.00%";
  const change = ((current - previous) / previous) * 100;
  const sign = change >= 0 ? "+" : "";
  return `${sign}${change.toFixed(2)}%`;
}
