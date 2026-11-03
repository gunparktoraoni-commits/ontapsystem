// ──────────────────────────────────────────────────────────────
// Email Service — Nodemailer SMTP Transport
// ──────────────────────────────────────────────────────────────
// Centralized email sending with error handling.
// Configured via environment variables — no secrets in code.
//
// Functions exported:
//  - sendVerificationEmail       → password reset OTP
//  - sendEmailVerificationOtp    → registration email verification OTP
//  - sendEmailMessage            → generic HTML/text send (cron queue)
//  - sendOrderConfirmationEmail  → checkout confirmation
//  - sendSubscriptionConfirmationEmail → plan activation/upgrade
//  - buildEmailShell / escapeEmailHtml → shared branded shell helpers
//  - buildAbandonedCartEmail     → /api/cron/abandoned-cart
//  - buildSubscriptionExpiryEmail → /api/cron/subscription-expiry
//  - buildTrialExperienceFollowupEmail → /api/cron/trial-experience-followup
//  - buildTrialUpgradePromoEmail → /api/cron/trial-upgrade-promo
//  - buildBizcardDailyReportEmail → /api/cron/bizcard-daily-report
// ──────────────────────────────────────────────────────────────

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

/** Official OnTap logo used across transactional + cron emails. */
export const ONTAP_EMAIL_LOGO_URL =
  "https://lightgray-mallard-851601.hostingersite.com/logotap.png";

export type EmailShellVariant =
  | "default"
  | "cart"
  | "expiry"
  | "trial_feedback"
  | "trial_upgrade"
  | "daily_report"
  | "auth"
  | "order"
  | "subscription";

const SHELL_THEMES: Record<
  EmailShellVariant,
  {
    pageBg: string;
    headerBg: string;
    headerAccent: string;
    cardRadius: string;
    footerBg: string;
    footerNote: string;
    eyebrow?: string;
  }
> = {
  default: {
    pageBg: "#eef1f6",
    headerBg: "#2A4792",
    headerAccent: "#4785B8",
    cardRadius: "14px",
    footerBg: "#f7f9fc",
    footerNote: "This message was sent by OnTap regarding your account.",
  },
  cart: {
    pageBg: "#e8f4f2",
    headerBg: "#1f5c57",
    headerAccent: "#2f9e94",
    cardRadius: "16px",
    footerBg: "#f2faf8",
    footerNote: "Cart reminders help you finish checkout when you are ready.",
    eyebrow: "Saved cart",
  },
  expiry: {
    pageBg: "#f7f1e8",
    headerBg: "#8a4b12",
    headerAccent: "#e67700",
    cardRadius: "12px",
    footerBg: "#fff8ef",
    footerNote: "Subscription notices keep your BizCard access uninterrupted.",
    eyebrow: "Subscription notice",
  },
  trial_feedback: {
    pageBg: "#eef0f8",
    headerBg: "#3B569F",
    headerAccent: "#6c7fd1",
    cardRadius: "18px",
    footerBg: "#f5f6fb",
    footerNote: "We only ask for feedback once after your free trial ends.",
    eyebrow: "Trial follow-up",
  },
  trial_upgrade: {
    pageBg: "#e9f5ef",
    headerBg: "#1b6b45",
    headerAccent: "#2f9e44",
    cardRadius: "16px",
    footerBg: "#f3faf6",
    footerNote: "Limited welcome offer for expired free-trial members.",
    eyebrow: "Welcome-back offer",
  },
  daily_report: {
    pageBg: "#eceff3",
    headerBg: "#243447",
    headerAccent: "#4c6ef5",
    cardRadius: "10px",
    footerBg: "#f4f6f8",
    footerNote: "Daily reports are sent only when your BizCard had activity.",
    eyebrow: "Daily activity",
  },
  auth: {
    pageBg: "#edf2ff",
    headerBg: "#2A4792",
    headerAccent: "#339af0",
    cardRadius: "12px",
    footerBg: "#f8f9fa",
    footerNote: "Security codes are single-use and expire automatically.",
    eyebrow: "Account security",
  },
  order: {
    pageBg: "#eef2f7",
    headerBg: "#1c335c",
    headerAccent: "#3B569F",
    cardRadius: "12px",
    footerBg: "#f6f8fb",
    footerNote: "Keep this confirmation for your order records.",
    eyebrow: "Order confirmation",
  },
  subscription: {
    pageBg: "#eef3fb",
    headerBg: "#2A4792",
    headerAccent: "#4785B8",
    cardRadius: "14px",
    footerBg: "#f5f8fd",
    footerNote: "Manage renewals anytime from your subscription page.",
    eyebrow: "Plan update",
  },
};

function getAppBaseUrl(): string {
  return (
    process.env.FRONTEND_URL ||
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    ""
  )
    .trim()
    .replace(/\/$/, "");
}

function appPageUrl(path: string): string {
  const base = getAppBaseUrl();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${normalized}` : normalized;
}

/**
 * Build an absolute URL that lands on login/signup gate with a safe internal redirect.
 * Used by email CTAs so logged-out recipients authenticate, then continue to the intended page/tab.
 */
function appAuthRedirectUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!normalized.startsWith("/") || normalized.startsWith("//")) {
    return appPageUrl("/user/dashboard");
  }
  return appPageUrl(`/?redirect=${encodeURIComponent(normalized)}`);
}

// ──────────────────────────────────────────
// SMTP Transport (lazy singleton)
// ──────────────────────────────────────────
// Created lazily so cold-start time isn't spent on connection setup
// before an email is actually needed.

// On Vercel serverless, function instances can be frozen and thawed between
// invocations. A singleton transporter holds a socket that gets killed when
// the instance is frozen — the next send hits a dead connection and throws
// "Unexpected socket close". Solution: create a fresh transporter per send
// and explicitly close it when done so the TLS socket is torn down cleanly.
function createTransporter(): Transporter {
  const port = Number(process.env.SMTP_PORT) || 587;
  // Port 465 uses implicit TLS (connect over SSL from the start).
  // Port 587/25 use STARTTLS (upgrade after plain-text greeting).
  // Nodemailer requires the right value here — mismatch causes socket close.
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    disableFileAccess: true,
    disableUrlAccess: true,
    connectionTimeout: 10_000, // ms to wait for socket connection
    greetingTimeout:   10_000, // ms to wait for SMTP greeting
    socketTimeout:     30_000, // ms of inactivity before socket is killed
  });
}

// ──────────────────────────────────────────
// Shared HTML Shell
// ──────────────────────────────────────────
// All email templates share the same branded wrapper for consistency.
// Inline CSS is required for email client compatibility (Gmail, Outlook, etc.)

function emailShell(bodyContent: string, variant: EmailShellVariant = "default"): string {
  const appName = process.env.EMAIL_FROM_NAME || "OnTap Team";
  const theme = SHELL_THEMES[variant] ?? SHELL_THEMES.default;
  const settingsUrl = appAuthRedirectUrl("/user/settings");
  const dashboardUrl = appAuthRedirectUrl("/user/dashboard");
  const eyebrow = theme.eyebrow
    ? `<p style="margin:0 0 10px;color:rgba(255,255,255,0.85);font-size:11px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;">${theme.eyebrow}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${appName}</title>
</head>
<body style="margin:0;padding:0;background-color:${theme.pageBg};font-family:Georgia,'Times New Roman',serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:${theme.pageBg};padding:36px 12px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0"
               style="background:#ffffff;border-radius:${theme.cardRadius};overflow:hidden;box-shadow:0 8px 28px rgba(20,35,70,0.10);max-width:600px;width:100%;border:1px solid rgba(42,71,146,0.08);">
          <tr>
            <td style="background:${theme.headerBg};padding:28px 36px 22px;text-align:center;border-bottom:4px solid ${theme.headerAccent};">
              ${eyebrow}
              <img src="${ONTAP_EMAIL_LOGO_URL}" alt="${appName}" width="120" style="height:auto;width:120px;max-width:120px;object-fit:contain;display:inline-block;"/>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 40px;font-family:Arial,Helvetica,sans-serif;">
              ${bodyContent}
            </td>
          </tr>
          <tr>
            <td style="background:${theme.footerBg};padding:22px 36px;border-top:1px solid #e6ebf2;text-align:center;font-family:Arial,Helvetica,sans-serif;">
              <p style="margin:0 0 8px;color:#5c6b7a;font-size:12px;line-height:1.55;">
                ${theme.footerNote}
              </p>
              <p style="margin:0 0 8px;color:#4785B8;font-size:12px;line-height:1.55;">
                <a href="${escapeEmailHtml(settingsUrl)}" style="color:#2A4792;text-decoration:underline;">Account settings</a>
                &nbsp;·&nbsp;
                <a href="${escapeEmailHtml(dashboardUrl)}" style="color:#2A4792;text-decoration:underline;">Dashboard</a>
              </p>
              <p style="margin:0;color:#8a96a3;font-size:11px;line-height:1.5;">
                &copy; ${new Date().getFullYear()} ${appName}. All rights reserved.<br/>
                If you did not expect this email, you can safely ignore it.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Shared branded HTML wrapper for transactional and cron emails. */
export function buildEmailShell(
  bodyContent: string,
  variant: EmailShellVariant = "default",
): string {
  return emailShell(bodyContent, variant);
}

export function escapeEmailHtml(value: unknown): string {
  const s = typeof value === "string" ? value : String(value ?? "");
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const MARKETING_HTML_TAGS = new Set(["p", "br", "div", "span", "strong", "b", "em", "i", "center"]);

/** True when marketing content has no meaningful text (empty tags / &nbsp; count as empty). */
export function isMarketingEmailContentEmpty(content: string | null | undefined): boolean {
  return (
    String(content ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&#160;/gi, " ")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim().length === 0
  );
}

export function looksLikeMarketingHtml(content: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(content);
}

/**
 * Allowlist sanitizer for promotional email body HTML.
 * Keeps bold/italic/center formatting; strips scripts, event handlers, and unsafe attrs.
 */
export function sanitizeMarketingEmailHtml(input: string | null | undefined): string {
  let html = String(input ?? "");
  if (!html.trim()) return "";

  // Drop dangerous blocks entirely (including content).
  html = html.replace(
    /<(script|style|iframe|object|embed|link|meta|base|form|svg|math)(\s[^>]*)?>[\s\S]*?<\/\1\s*>/gi,
    ""
  );
  html = html.replace(
    /<(script|style|iframe|object|embed|link|meta|base|form|svg|math)(\s[^>]*)?\/?>/gi,
    ""
  );
  // Strip HTML comments / conditional comments.
  html = html.replace(/<!--[\s\S]*?-->/g, "");

  html = html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)\/?>/g, (match, rawTag: string, rawAttrs: string) => {
    const tag = rawTag.toLowerCase();
    const isClosing = match.startsWith("</");
    if (!MARKETING_HTML_TAGS.has(tag)) {
      return "";
    }
    if (isClosing) {
      return tag === "br" ? "" : `</${tag}>`;
    }
    if (tag === "br") {
      return "<br>";
    }

    let safeStyle = "";
    const styleMatch = String(rawAttrs ?? "").match(/style\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (styleMatch) {
      const styleValue = styleMatch[1] ?? styleMatch[2] ?? styleMatch[3] ?? "";
      const alignMatch = styleValue.match(/(?:^|;)\s*text-align\s*:\s*(center|left|right)\s*(?:;|$)/i);
      if (alignMatch) {
        safeStyle = `text-align: ${alignMatch[1].toLowerCase()};`;
      }
    }

    // Browsers often emit align="center" via justifyCenter on some engines.
    const alignAttr = String(rawAttrs ?? "").match(/\balign\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!safeStyle && alignAttr) {
      const align = (alignAttr[1] ?? alignAttr[2] ?? alignAttr[3] ?? "").toLowerCase();
      if (align === "center" || align === "left" || align === "right") {
        safeStyle = `text-align: ${align};`;
      }
    }

    if (safeStyle && (tag === "p" || tag === "div" || tag === "span")) {
      return `<${tag} style="${safeStyle}">`;
    }
    return `<${tag}>`;
  });

  return html.trim();
}

function ctaButton(href: string, label: string, color = "#2A4792"): string {
  return `<p style="margin:28px 0 8px;text-align:center;">
  <a href="${escapeEmailHtml(href)}" style="display:inline-block;background:${color};color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;font-family:Arial,Helvetica,sans-serif;">${escapeEmailHtml(label)}</a>
</p>`;
}

export type AbandonedCartEmailItem = {
  name: string;
  quantity: number;
  price?: number;
  variant?: string | null;
};

/** Abandoned-cart reminder used by /api/cron/abandoned-cart. */
export function buildAbandonedCartEmail(params: {
  firstName: string;
  items: AbandonedCartEmailItem[];
  cartUrl: string;
  appName?: string;
}): { subject: string; html: string; text: string } {
  const appName = params.appName || process.env.EMAIL_FROM_NAME || "OnTap";
  const firstName = escapeEmailHtml(params.firstName || "there");
  const cartUrl = params.cartUrl || appAuthRedirectUrl("/user/emarket?tab=cart");
  const itemsHtml = params.items
    .map((item) => {
      const name = escapeEmailHtml(item.name);
      const variant = item.variant ? escapeEmailHtml(item.variant) : null;
      const qty = Number(item.quantity) || 1;
      return `<tr>
        <td style="padding:12px 0;border-bottom:1px solid #e4eeec;color:#334155;">
          <strong style="color:#1f5c57;">${name}</strong>${variant ? `<br/><span style="color:#64748b;font-size:12px;">${variant}</span>` : ""}
        </td>
        <td style="padding:12px 0;border-bottom:1px solid #e4eeec;color:#334155;text-align:center;font-weight:700;">${qty}</td>
      </tr>`;
    })
    .join("");

  const subject = `${appName}: your cart is still saved — finish checkout when ready`;
  const body = `
    <p style="margin:0 0 6px;color:#1f5c57;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Checkout reminder</p>
    <h2 style="margin:0 0 10px;color:#1f5c57;font-size:24px;line-height:1.25;">Still thinking it over, ${firstName}?</h2>
    <p style="color:#475569;line-height:1.65;margin:0 0 16px;">
      You left items in your <strong>${escapeEmailHtml(appName)}</strong> cart. Stock and promo pricing can change,
      so completing checkout now keeps your selections locked in.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;background:#f7fbfa;border:1px solid #d7ebe7;border-radius:12px;padding:4px 14px;">
      <thead>
        <tr>
          <th style="padding:12px 0 8px;text-align:left;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Item</th>
          <th style="padding:12px 0 8px;text-align:center;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Qty</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml || `<tr><td colspan="2" style="padding:12px 0;color:#475569;">Your saved cart items are still available in E-Market.</td></tr>`}
      </tbody>
    </table>
    ${ctaButton(cartUrl, "Return to my cart", "#1f5c57")}
    <p style="text-align:center;margin:6px 0 0;">
      <a href="${escapeEmailHtml(appAuthRedirectUrl("/user/emarket"))}" style="color:#1f5c57;font-size:13px;">Browse more products</a>
    </p>
    <p style="color:#94a3b8;font-size:12px;margin:18px 0 0;line-height:1.55;">
      Already checked out, or this was not you? You can ignore this message — no changes were made to your account.
    </p>`;

  const text =
    `Hi ${params.firstName || "there"},\n\n` +
    `You still have items in your ${appName} cart.\n` +
    `Complete checkout: ${cartUrl}\n` +
    `Browse products: ${appAuthRedirectUrl("/user/emarket")}\n\n` +
    `— The ${appName} Team`;

  return { subject, html: emailShell(body, "cart"), text };
}

/** Subscription expiry / trial reminder used by subscription-expiry cron. */
export function buildSubscriptionExpiryEmail(params: {
  firstName: string;
  title: string;
  message: string;
  renewUrl: string;
  expiresAt: Date;
  planLabel?: string | null;
  bizcardName?: string | null;
  kind?: "trial" | "paid" | "expired" | string;
  appName?: string;
}): { subject: string; html: string; text: string } {
  const appName = params.appName || process.env.EMAIL_FROM_NAME || "OnTap";
  const firstName = escapeEmailHtml(params.firstName || "there");
  const title = escapeEmailHtml(params.title);
  const message = escapeEmailHtml(params.message);
  const plan = params.planLabel ? escapeEmailHtml(params.planLabel) : null;
  const bizcard = params.bizcardName ? escapeEmailHtml(params.bizcardName) : null;
  const expiry = escapeEmailHtml(
    params.expiresAt.toLocaleDateString("en-US", { dateStyle: "long" }),
  );
  const renewUrl = params.renewUrl || appAuthRedirectUrl("/user/emarket?tab=subscription");
  const tone =
    params.kind === "expired"
      ? { bg: "#fff5f5", border: "#ffc9c9", color: "#c92a2a", label: "Access interrupted" }
      : { bg: "#fff8e8", border: "#ffe8a3", color: "#b35c00", label: "Renewal window" };

  const subject = `${appName}: ${params.title}`;
  const body = `
    <p style="margin:0 0 6px;color:#8a4b12;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Subscription update</p>
    <h2 style="margin:0 0 10px;color:#8a4b12;font-size:23px;line-height:1.25;">${title}</h2>
    <p style="color:#475569;line-height:1.65;margin:0 0 12px;">Hi ${firstName},</p>
    <p style="color:#475569;line-height:1.65;margin:0 0 16px;">${message}</p>
    <div style="background:${tone.bg};border:1px solid ${tone.border};border-radius:12px;padding:16px 18px;margin:0 0 18px;">
      <p style="margin:0 0 8px;color:${tone.color};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">${tone.label}</p>
      ${plan ? `<p style="margin:0 0 4px;color:#334155;font-size:14px;"><strong>Plan:</strong> ${plan}</p>` : ""}
      ${bizcard ? `<p style="margin:0 0 4px;color:#334155;font-size:14px;"><strong>BizCard:</strong> ${bizcard}</p>` : ""}
      <p style="margin:0;color:#334155;font-size:14px;"><strong>Expiry date:</strong> ${expiry}</p>
    </div>
    <p style="color:#475569;line-height:1.6;margin:0 0 8px;font-size:14px;">
      Renewing keeps Inquiry, Analytics, and your public portfolio features available without interruption.
    </p>
    ${ctaButton(renewUrl, "Renew or manage subscription", "#8a4b12")}
    <p style="text-align:center;margin:6px 0 0;">
      <a href="${escapeEmailHtml(appAuthRedirectUrl("/user/orders"))}" style="color:#8a4b12;font-size:13px;">View order history</a>
    </p>`;

  const text =
    `${params.title}\n\n` +
    `Hi ${params.firstName || "there"},\n\n` +
    `${params.message}\n` +
    `${params.planLabel ? `Plan: ${params.planLabel}\n` : ""}` +
    `${params.bizcardName ? `BizCard: ${params.bizcardName}\n` : ""}` +
    `Expiry date: ${params.expiresAt.toLocaleDateString()}\n\n` +
    `Renew or manage: ${renewUrl}\n` +
    `Orders: ${appAuthRedirectUrl("/user/orders")}\n\n` +
    `— The ${appName} Team`;

  return { subject, html: emailShell(body, "expiry"), text };
}

/** One-time follow-up after free trial has been expired for 7+ days. */
export function buildTrialExperienceFollowupEmail(params: {
  firstName: string;
  daysExpired: number;
  shopUrl: string;
  feedbackUrl: string;
  appName?: string;
}): { subject: string; html: string; text: string } {
  const appName = params.appName || process.env.EMAIL_FROM_NAME || "OnTap";
  const firstName = escapeEmailHtml(params.firstName || "there");
  const days = Math.max(1, Number(params.daysExpired) || 7);
  const shopUrl = params.shopUrl || appAuthRedirectUrl("/user/emarket");
  const feedbackUrl = params.feedbackUrl || appAuthRedirectUrl("/user/inquiry");
  const subject = `${appName}: how did your free trial go?`;
  const body = `
    <p style="margin:0 0 6px;color:#3B569F;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">After your trial</p>
    <h2 style="margin:0 0 10px;color:#2A4792;font-size:23px;line-height:1.25;">${firstName}, we want your honest take</h2>
    <p style="color:#475569;line-height:1.65;margin:0 0 14px;">
      Your free trial wrapped up about <strong>${days} day${days === 1 ? "" : "s"}</strong> ago.
      Whether you loved a feature, hit a rough edge, or simply got busy — hearing from you helps us ship a better product.
    </p>
    <div style="background:#f5f7fc;border-left:4px solid #3B569F;border-radius:0 12px 12px 0;padding:16px 18px;margin:0 0 16px;">
      <p style="margin:0 0 8px;color:#1e293b;font-weight:700;">What you can do next</p>
      <ul style="margin:0;padding-left:18px;color:#475569;line-height:1.7;">
        <li>Order a physical BizCard and keep networking online + offline</li>
        <li>Compare Basic, Standard, and Premium plans in E-Market</li>
        <li>Tell us what worked (or what did not) from your trial</li>
      </ul>
    </div>
    ${ctaButton(shopUrl, "Browse BizCards & plans", "#3B569F")}
    <p style="text-align:center;margin:8px 0 0;">
      <a href="${escapeEmailHtml(feedbackUrl)}" style="color:#2A4792;font-size:13px;">Share trial feedback</a>
      &nbsp;·&nbsp;
      <a href="${escapeEmailHtml(appAuthRedirectUrl("/user/emarket?tab=subscription"))}" style="color:#2A4792;font-size:13px;">View subscriptions</a>
    </p>
    <p style="color:#94a3b8;font-size:12px;margin:18px 0 0;line-height:1.55;">
      Already upgraded? You can ignore this note. Prefer fewer emails? Update preferences in Settings.
    </p>`;

  const text =
    `Hi ${params.firstName || "there"},\n\n` +
    `Your ${appName} free trial ended about ${days} days ago. We would value your feedback.\n` +
    `Browse BizCards & plans: ${shopUrl}\n` +
    `Share feedback: ${feedbackUrl}\n` +
    `Subscriptions: ${appAuthRedirectUrl("/user/emarket?tab=subscription")}\n\n` +
    `— The ${appName} Team`;

  return { subject, html: emailShell(body, "trial_feedback"), text };
}

/**
 * Expired free-trial promo: Basic/Standard purchase unlocks 1 month of Premium.
 */
export function buildTrialUpgradePromoEmail(params: {
  firstName: string;
  daysExpired: number;
  shopUrl: string;
  plansUrl: string;
  appName?: string;
}): { subject: string; html: string; text: string } {
  const appName = params.appName || process.env.EMAIL_FROM_NAME || "OnTap";
  const firstName = escapeEmailHtml(params.firstName || "there");
  const days = Math.max(0, Number(params.daysExpired) || 0);
  const shopUrl = params.shopUrl || appAuthRedirectUrl("/user/emarket?tab=subscription");
  const plansUrl = params.plansUrl || appAuthRedirectUrl("/user/emarket?tab=subscription&promo=trial-upgrade");
  const dayLabel = days === 0 ? "just ended" : `ended about ${days} day${days === 1 ? "" : "s"} ago`;
  const subject = `${appName}: Basic or Standard unlocks 1 month of Premium`;
  const body = `
    <p style="margin:0 0 6px;color:#1b6b45;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Exclusive return offer</p>
    <h2 style="margin:0 0 10px;color:#1b6b45;font-size:24px;line-height:1.25;">Get Premium for a full month, ${firstName}</h2>
    <p style="color:#475569;line-height:1.65;margin:0 0 14px;">
      Your free trial ${dayLabel}. When you activate a BizCard with a <strong>Basic</strong> or <strong>Standard</strong> plan,
      we will upgrade you to <strong>Premium features for 30 days</strong> — Inquiry inbox, richer analytics, premium themes, and more.
    </p>
    <div style="background:#f1faf4;border:1px solid #bfe5cd;border-radius:14px;padding:18px;margin:0 0 16px;">
      <p style="margin:0 0 10px;color:#14532d;font-weight:700;font-size:15px;">How the offer works</p>
      <ol style="margin:0;padding-left:18px;color:#334155;line-height:1.75;">
        <li>Open E-Market and choose a Basic or Standard BizCard subscription</li>
        <li>Complete checkout / activation for your card</li>
        <li>Premium features unlock automatically for 30 days</li>
        <li>After the month, your plan returns to the Basic or Standard tier you purchased</li>
      </ol>
    </div>
    <p style="color:#475569;line-height:1.6;margin:0 0 8px;font-size:14px;">
      This welcome offer is for former free-trial members who have not already claimed it.
    </p>
    ${ctaButton(plansUrl, "Choose Basic or Standard plan", "#1b6b45")}
    <p style="text-align:center;margin:8px 0 0;">
      <a href="${escapeEmailHtml(shopUrl)}" style="color:#1b6b45;font-size:13px;">Open subscription tab</a>
      &nbsp;·&nbsp;
      <a href="${escapeEmailHtml(appAuthRedirectUrl("/user/dashboard"))}" style="color:#1b6b45;font-size:13px;">Go to dashboard</a>
    </p>`;

  const text =
    `Hi ${params.firstName || "there"},\n\n` +
    `Your ${appName} free trial ${dayLabel}.\n` +
    `Activate a Basic or Standard BizCard and enjoy 1 month of Premium features.\n\n` +
    `Choose a plan: ${plansUrl}\n` +
    `Subscription tab: ${shopUrl}\n` +
    `Dashboard: ${appAuthRedirectUrl("/user/dashboard")}\n\n` +
    `— The ${appName} Team`;

  return { subject, html: emailShell(body, "trial_upgrade"), text };
}

/** Daily BizCard activity summary (only when there was activity). */
export function buildBizcardDailyReportEmail(params: {
  firstName: string;
  reportDate: string;
  profileViews: number;
  contactSaves: number;
  inquiries: number;
  analyticsUrl: string;
  inquiryUrl: string;
  appName?: string;
}): { subject: string; html: string; text: string } {
  const appName = params.appName || process.env.EMAIL_FROM_NAME || "OnTap";
  const firstName = escapeEmailHtml(params.firstName || "there");
  const views = Math.max(0, Number(params.profileViews) || 0);
  const saves = Math.max(0, Number(params.contactSaves) || 0);
  const inquiries = Math.max(0, Number(params.inquiries) || 0);
  const reportDate = escapeEmailHtml(params.reportDate);
  const analyticsUrl = params.analyticsUrl || appAuthRedirectUrl("/user/bizcard-list");
  const inquiryUrl = params.inquiryUrl || appAuthRedirectUrl("/user/inquiry");
  const subject = `${appName} daily BizCard report — ${params.reportDate}`;

  const metric = (label: string, value: number, accent: string) => `<td style="width:33%;padding:6px;">
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-top:3px solid ${accent};border-radius:10px;padding:14px 10px;text-align:center;">
    <p style="margin:0 0 4px;color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;font-family:Arial,Helvetica,sans-serif;">${label}</p>
    <p style="margin:0;color:#243447;font-size:22px;font-weight:700;font-family:Arial,Helvetica,sans-serif;">${value}</p>
  </div>
</td>`;

  const body = `
    <p style="margin:0 0 6px;color:#243447;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Activity digest</p>
    <h2 style="margin:0 0 10px;color:#243447;font-size:22px;line-height:1.25;">BizCard activity for ${reportDate}</h2>
    <p style="color:#475569;line-height:1.65;margin:0 0 16px;">
      Hi ${firstName}, your ${escapeEmailHtml(appName)} BizCard picked up new engagement yesterday. Here is the snapshot:
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
      <tr>
        ${metric("Profile views", views, "#4c6ef5")}
        ${metric("Contact saves", saves, "#2f9e94")}
        ${metric("Inquiries", inquiries, "#e67700")}
      </tr>
    </table>
    <p style="color:#475569;line-height:1.6;margin:0 0 8px;">
      Open Analytics for visitor detail, or jump into Inquiry when someone reaches out.
    </p>
    ${ctaButton(analyticsUrl, "Open BizCard dashboard", "#243447")}
    ${
      inquiries > 0
        ? `<p style="text-align:center;margin:8px 0 0;">
      <a href="${escapeEmailHtml(inquiryUrl)}" style="color:#243447;font-size:13px;">Review ${inquiries} inquir${inquiries === 1 ? "y" : "ies"}</a>
    </p>`
        : `<p style="text-align:center;margin:8px 0 0;">
      <a href="${escapeEmailHtml(appAuthRedirectUrl("/user/dashboard"))}" style="color:#243447;font-size:13px;">Back to dashboard</a>
    </p>`
    }`;

  const text =
    `Hi ${params.firstName || "there"},\n\n` +
    `BizCard daily report for ${params.reportDate}:\n` +
    `Profile views: ${views}\nContact saves: ${saves}\nInquiries: ${inquiries}\n\n` +
    `BizCard dashboard: ${analyticsUrl}\n` +
    (inquiries > 0 ? `Inquiries: ${inquiryUrl}\n` : `Dashboard: ${appAuthRedirectUrl("/user/dashboard")}\n`) +
    `\n— The ${appName} Team`;

  return { subject, html: emailShell(body, "daily_report"), text };
}


// ──────────────────────────────────────────
// OTP Code Block (reusable HTML block)
// ──────────────────────────────────────────
// Renders the prominent OTP code box used in multiple email types.

function otpBlock(otp: string): string {
  // Split OTP into individual characters for visual spacing
  const chars = otp.split("").map(
    (c) => `<span style="display:inline-block;width:40px;height:52px;line-height:52px;
                         text-align:center;font-size:28px;font-weight:700;color:#2A4792;
                         background:#f0f2f5;border-radius:8px;margin:0 4px;">${c}</span>`
  ).join("");

  return `
    <div style="background:#f8f9fa;border:2px dashed #dee2e6;border-radius:12px;
                padding:24px;text-align:center;margin:18px 0;">
      <p style="margin:0 0 12px;color:#6c757d;font-size:13px;text-transform:uppercase;
                letter-spacing:1px;">Your One-Time Code</p>
      <div style="display:inline-block;">${chars}</div>
    </div>`;
}

// ──────────────────────────────────────────
// 1. Password Reset Email
// ──────────────────────────────────────────

/**
 * Send a password reset verification code to the user.
 * Used by the forgot-password → verify-code → reset-password flow.
 *
 * @param to         - Recipient email address
 * @param code       - Plain-text 6-char code (BEFORE hashing)
 * @param expiryMins - Minutes until expiry (shown in email body)
 */
export async function sendVerificationEmail(
  to: string,
  code: string,
  expiryMins: number = 10
): Promise<void> {
  const transport = createTransporter();
  const appName = process.env.EMAIL_FROM_NAME || "OnTap Team";

  const resetUrl = appPageUrl("/user/forgot-password");
  const body = `
    <p style="margin:0 0 6px;color:#2A4792;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Password reset</p>
    <h2 style="margin:0 0 8px;color:#2A4792;font-size:22px;">Reset your ${appName} password</h2>
    <p style="color:#495057;line-height:1.6;margin:0 0 16px;">
      We received a request to reset the password for your <strong>${appName}</strong> account.
      Use the code below on the reset page. This code is valid for <strong>${expiryMins} minutes</strong>.
    </p>
    ${otpBlock(code)}
    <p style="color:#495057;line-height:1.6;margin:16px 0 0;">
      Enter this code on the password reset page. Do <strong>not</strong> share it with anyone.
    </p>
    ${ctaButton(resetUrl, "Open password reset page")}
    <p style="color:#4785B8;font-size:13px;margin:16px 0 0;">
      Didn't request a password reset? No action is needed &mdash; your account remains secure.
    </p>`;

  try {
    await transport.sendMail({
      from: `"${appName}" <${process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to,
      subject: `Your ${appName} Password Reset Code`,
      html: emailShell(body, "auth"),
      text: `Your ${appName} password reset code is: ${code}\n\nThis code expires in ${expiryMins} minutes.\nReset page: ${resetUrl}\n\nIf you did not request this, ignore this email.`,
    });
  } finally {
    transport.close();
  }
}

// ──────────────────────────────────────────
// 2. Registration Email Verification OTP
// ──────────────────────────────────────────

/**
 * Send an email verification OTP after user registration.
 * The user must verify their email before the account is fully activated.
 *
 * @param to         - Recipient email address
 * @param firstName  - User's first name for personalization
 * @param otp        - Plain-text 6-char OTP (BEFORE hashing)
 * @param expiryMins - Minutes until expiry (shown in email body)
 */
export async function sendEmailVerificationOtp(
  to: string,
  firstName: string,
  otp: string,
  expiryMins: number = 10
): Promise<void> {
  const transport = createTransporter();
  const appName = process.env.EMAIL_FROM_NAME || "OnTap Team";

  const verifyUrl = appPageUrl("/user/signup");
  const body = `
    <p style="margin:0 0 6px;color:#2A4792;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Email verification</p>
    <h2 style="margin:0 0 8px;color:#2A4792;font-size:22px;">
      Welcome to ${appName}, ${firstName}!
    </h2>
    <p style="color:#495057;line-height:1.6;margin:0 0 16px;">
      You're almost there! To finish creating your account, verify your email address
      with the code below. This code expires in <strong>${expiryMins} minutes</strong>.
    </p>
    ${otpBlock(otp)}
    <p style="color:#495057;line-height:1.6;margin:16px 0 0;">
      Enter this code on the verification page to activate your account.
      Do <strong>not</strong> share this code with anyone.
    </p>
    ${ctaButton(verifyUrl, "Continue signup / verification")}
    <div style="margin-top:24px;padding:16px;background:#e8f4fd;border-radius:8px;border-left:4px solid #339af0;">
      <p style="margin:0;color:#1971c2;font-size:13px;">
        <strong>Why verify?</strong> Email verification keeps your account secure and ensures
        you can recover access if you ever forget your password.
      </p>
    </div>
    <p style="color:#4785B8;font-size:13px;margin:20px 0 0;">
      Didn't create an account? You can safely ignore this email.
    </p>`;

  try {
    await transport.sendMail({
      from: `"${appName}" <${process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to,
      subject: `Verify your ${appName} email address`,
      html: emailShell(body, "auth"),
      text: `Welcome to ${appName}, ${firstName}!\n\nYour email verification code is: ${otp}\n\nThis code expires in ${expiryMins} minutes.\nContinue: ${verifyUrl}\n\nIf you didn't create this account, ignore this email.`,
    });
  } finally {
    transport.close();
  }
}

export async function sendEmailMessage(params: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}): Promise<void> {
  const transport = createTransporter();
  const appName = process.env.EMAIL_FROM_NAME || "OnTap Team";

  try {
    await transport.sendMail({
      from: `"${appName}" <${process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
      ...(params.replyTo ? { replyTo: params.replyTo } : {}),
    });
  } finally {
    transport.close();
  }
}

// ──────────────────────────────────────────
// 3. Order Confirmation Email
// ──────────────────────────────────────────

export interface OrderEmailItem {
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  type: "merchandise" | "template" | "subscription";
}

export interface OrderEmailData {
  orderNumber: string;
  customerName: string;
  items: OrderEmailItem[];
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  shippingAmount: number;
  totalAmount: number;
  currency: string;
  paymentMethod?: string;
  shippingAddress?: Record<string, unknown> | null;
}

/**
 * Send an order confirmation email after a successful checkout.
 */
export async function sendOrderConfirmationEmail(
  to: string,
  data: OrderEmailData
): Promise<void> {
  const transport = createTransporter();
  const appName = process.env.EMAIL_FROM_NAME || "OnTap Team";
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: data.currency }).format(n);

  const itemRows = data.items
    .map(
      (item) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0f2f5;color:#495057;">
          ${item.name}
          <span style="color:#adb5bd;font-size:12px;margin-left:4px;">(${item.type})</span>
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #f0f2f5;color:#495057;text-align:center;">${item.quantity}</td>
        <td style="padding:10px 0;border-bottom:1px solid #f0f2f5;color:#495057;text-align:right;">${fmt(item.totalPrice)}</td>
      </tr>`
    )
    .join("");

  const discountRow =
    data.discountAmount > 0
      ? `<tr>
          <td colspan="2" style="padding:6px 0;color:#2f9e44;text-align:right;">Discount</td>
          <td style="padding:6px 0;color:#2f9e44;text-align:right;">-${fmt(data.discountAmount)}</td>
        </tr>`
      : "";

  const shippingRow =
    data.shippingAmount > 0
      ? `<tr>
          <td colspan="2" style="padding:6px 0;color:#495057;text-align:right;">Shipping</td>
          <td style="padding:6px 0;color:#495057;text-align:right;">${fmt(data.shippingAmount)}</td>
        </tr>`
      : "";

  const ordersUrl = appAuthRedirectUrl(
    data.orderNumber
      ? `/user/orders/${encodeURIComponent(data.orderNumber)}`
      : "/user/orders",
  );

  const body = `
    <h2 style="margin:0 0 4px;color:#2A4792;font-size:22px;">Order Confirmed!</h2>
    <p style="color:#495057;margin:0 0 20px;">
      Hi ${data.customerName}, your order <strong>${data.orderNumber}</strong> has been received and is being processed.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <thead>
        <tr style="border-bottom:2px solid #dee2e6;">
          <th style="padding:8px 0;text-align:left;color:#6c757d;font-size:12px;text-transform:uppercase;">Item</th>
          <th style="padding:8px 0;text-align:center;color:#6c757d;font-size:12px;text-transform:uppercase;">Qty</th>
          <th style="padding:8px 0;text-align:right;color:#6c757d;font-size:12px;text-transform:uppercase;">Price</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="2" style="padding:6px 0;color:#6c757d;text-align:right;">Subtotal</td>
          <td style="padding:6px 0;color:#6c757d;text-align:right;">${fmt(data.subtotal)}</td>
        </tr>
        ${discountRow}
        <tr>
          <td colspan="2" style="padding:6px 0;color:#495057;text-align:right;">Tax</td>
          <td style="padding:6px 0;color:#495057;text-align:right;">${fmt(data.taxAmount)}</td>
        </tr>
        ${shippingRow}
        <tr style="border-top:2px solid #dee2e6;">
          <td colspan="2" style="padding:10px 0;font-weight:700;color:#2A4792;text-align:right;font-size:16px;">Total</td>
          <td style="padding:10px 0;font-weight:700;color:#2A4792;text-align:right;font-size:16px;">${fmt(data.totalAmount)}</td>
        </tr>
      </tfoot>
    </table>

    <p style="color:#495057;margin:16px 0 4px;font-size:13px;">
      You can view your order and track its status under <strong>Purchases</strong> in your account.
    </p>
    ${ctaButton(ordersUrl, "View order")}
    <p style="color:#4785B8;font-size:13px;margin:8px 0 0;">
      Thank you for shopping with ${appName}!
    </p>`;

  try {
    const ordersNotify =
      process.env.ORDERS_NOTIFY_EMAIL ||
      process.env.BILLING_BUSINESS_EMAIL ||
      "shop.ontap58@gmail.com";
    const bcc =
      ordersNotify &&
      ordersNotify.toLowerCase() !== to.trim().toLowerCase()
        ? ordersNotify
        : undefined;

    await transport.sendMail({
      from: `"${appName}" <${process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to,
      ...(bcc ? { bcc } : {}),
      subject: `Order Confirmed: ${data.orderNumber}`,
      html: emailShell(body, "order"),
      text: `Your order ${data.orderNumber} has been confirmed. Total: ${fmt(data.totalAmount)}. View order: ${ordersUrl}`,
    });
  } finally {
    transport.close();
  }
}

// ──────────────────────────────────────────
// 4. Subscription Confirmation Email
// ──────────────────────────────────────────

/**
 * Notify a user when their subscription is activated, upgraded, or renewed.
 */
export async function sendSubscriptionConfirmationEmail(
  to: string,
  params: {
    customerName: string;
    planName: string;
    billingCycle: "monthly" | "yearly";
    amount: number;
    currency: string;
    expiresAt: Date;
    isUpgrade: boolean;
  }
): Promise<void> {
  const transport = createTransporter();
  const appName = process.env.EMAIL_FROM_NAME || "OnTap Team";
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: params.currency }).format(n);

  const title = params.isUpgrade ? "Subscription Upgraded!" : "Subscription Activated!";
  const action = params.isUpgrade ? "upgraded to" : "subscribed to";
  const manageUrl = appAuthRedirectUrl("/user/emarket?tab=subscription");

  const body = `
    <h2 style="margin:0 0 8px;color:#2A4792;font-size:22px;">${title}</h2>
    <p style="color:#495057;line-height:1.6;margin:0 0 16px;">
      Hi ${params.customerName}, you've successfully ${action} the
      <strong>${params.planName}</strong> plan
      (${params.billingCycle === "yearly" ? "Yearly" : "Monthly"} billing).
    </p>
    <div style="background:#f0f9f0;border:1px solid #a9e34b;border-radius:8px;padding:16px;margin:0 0 16px;">
      <p style="margin:0;color:#2f9e44;font-size:14px;">
        <strong>Amount charged:</strong> ${fmt(params.amount)}<br/>
        <strong>Next billing date:</strong> ${params.expiresAt.toLocaleDateString("en-US", { dateStyle: "long" })}
      </p>
    </div>
    <p style="color:#495057;font-size:13px;margin:0 0 8px;">
      Manage your subscription anytime from the E-Market subscription tab.
    </p>
    ${ctaButton(manageUrl, "Manage subscription")}`;

  try {
    await transport.sendMail({
      from: `"${appName}" <${process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to,
      subject: `${appName} ${title}`,
      html: emailShell(body, "subscription"),
      text: `You've ${action} the ${params.planName} plan. Amount: ${fmt(params.amount)}. Next billing: ${params.expiresAt.toISOString()}. Manage: ${manageUrl}`,
    });
  } finally {
    transport.close();
  }
}