// ──────────────────────────────────────────────────────────────
// GET /api/health — Deployment Diagnostic Endpoint
// ──────────────────────────────────────────────────────────────
// Checks environment variables, database connectivity, and
// runtime configuration. Used to diagnose deployment issues.
//
// SECURITY: Protected by HEALTH_CHECK_SECRET / ONTAP_API_KEY.
// Pass it as: Authorization: Bearer <secret>
// Query-string credentials are rejected.
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { prisma } from "@/server/lib/prisma";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { checkDistributedRateLimit } from "@/server/lib/rate-limit-distributed";
import { safeCompareEdge } from "@/lib/timing-safe-edge";

// Required env vars and whether their absence is critical
const ENV_CHECKS: { key: string; critical: boolean }[] = [
  { key: "NEWDATABASE_URL",          critical: true  },
  { key: "NEWANALYTICS_DATABASE_URL", critical: false },
  { key: "DATABASE_URL",              critical: false },
  { key: "ANALYTICS_DATABASE_URL",    critical: false },
  { key: "JWT_SECRET",            critical: true  },
  { key: "ALLOWED_ORIGINS",       critical: true  },
  { key: "SMTP_HOST",             critical: false },
  { key: "SMTP_PORT",             critical: false },
  { key: "SMTP_USER",             critical: false },
  { key: "SMTP_PASS",             critical: false },
  { key: "SMTP_FROM",             critical: false },
  { key: "EMAIL_FROM_ADDRESS",    critical: false },
  { key: "EMAIL_FROM_NAME",       critical: false },
  { key: "EMAIL_PROVIDER",        critical: false },
  { key: "RESEND_API_KEY",        critical: false },
  { key: "NEXT_PUBLIC_APP_URL",   critical: false },
  { key: "APP_URL",               critical: false },
  { key: "FRONTEND_URL",          critical: false },
  { key: "NODE_ENV",              critical: false },
  { key: "ONTAP_API_KEY",         critical: false },
];

const SECRET_ENV_KEYS = new Set([
  "JWT_SECRET",
  "SMTP_PASS",
  "RESEND_API_KEY",
  "ONTAP_API_KEY",
  "OPENROUTER_API_KEY",
  "NEXTAUTH_SECRET",
  "HEALTH_CHECK_SECRET",
  "AFFILIATE_HMAC_SECRET",
  "AFFILIATE_ENCRYPTION_KEY",
  "NOTIFICATION_INTERNAL_TOKEN",
  "CRON_JOB_SECRET",
  "UNSUBSCRIBE_TOKEN_SECRET",
  "IP_HASH_SECRET",
  "UPSTASH_REDIS_REST_TOKEN",
  "UPSTASH_REDIS_TOKEN",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "XENDIT_SECRET_KEY",
  "XENDIT_WEBHOOK_TOKEN",
  "CLOUDINARY_API_SECRET",
]);

function maskValue(key: string, val: string): string {
  if (["NEWDATABASE_URL", "NEWANALYTICS_DATABASE_URL", "DATABASE_URL", "ANALYTICS_DATABASE_URL"].includes(key)) {
    try {
      const url = new URL(val);
      return `${url.protocol}//${url.username}:***@${url.hostname}:${url.port}${url.pathname}`;
    } catch {
      return "***set (unparseable)***";
    }
  }
  if (SECRET_ENV_KEYS.has(key)) {
    return "***configured***";
  }
  return val;
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const globalRate = await checkDistributedRateLimit(ip, "health");
  if (!globalRate.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(globalRate.retryAfterMs / 1000)) } }
    );
  }

  const rl = checkRateLimit("health", ip);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  // ── Auth check ──
  const authHeader = request.headers.get("authorization") ?? "";
  const hasQueryAuth = request.nextUrl.searchParams.has("key") || request.nextUrl.searchParams.has("token");
  if (hasQueryAuth) {
    return NextResponse.json(
      { error: "Invalid authentication method." },
      { status: 401 }
    );
  }

  const apiKey = process.env.HEALTH_CHECK_SECRET ?? process.env.ONTAP_API_KEY ?? "";
  if (!apiKey) {
    return NextResponse.json(
      { error: "Health check secret is not configured." },
      { status: 503 }
    );
  }

  if (!authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Unauthorized. Provide a valid API key." },
      { status: 401 }
    );
  }

  const provided = authHeader.slice(7).trim();

  if (!safeCompareEdge(provided, apiKey)) {
    return NextResponse.json(
      { error: "Unauthorized. Provide a valid API key." },
      { status: 401 }
    );
  }

  const results: Record<string, unknown> = {};

  // ── 1. Runtime info ──
  results.runtime = {
    nodeVersion:   process.version,
    nodeEnv:       process.env.NODE_ENV ?? "not set",
    platform:      process.platform,
    region:        process.env.VERCEL_REGION ?? process.env.AWS_REGION ?? "unknown",
    vercelEnv:     process.env.VERCEL_ENV ?? "not vercel",
    deploymentUrl: process.env.VERCEL_URL ?? "N/A",
  };

  // ── 2. Environment variable checks ──
  const envResults: Record<string, { present: boolean; critical: boolean; value?: string }> = {};
  let missingCritical = false;

  for (const { key, critical } of ENV_CHECKS) {
    const val = process.env[key];
    if (!val) {
      envResults[key] = { present: false, critical };
      if (critical) missingCritical = true;
    } else {
      envResults[key] = { present: true, critical, value: maskValue(key, val) };
    }
  }
  results.envVars = envResults;

  // ── 2b. Xendit mode (test vs live) — determined solely by secret key prefix ──
  {
    const xenditKey = (process.env.XENDIT_SECRET_KEY ?? "").trim();
    const webhookTokenConfigured = Boolean((process.env.XENDIT_WEBHOOK_TOKEN ?? "").trim());
    let mode: "production" | "development" | "missing" | "invalid" = "missing";
    if (xenditKey.startsWith("xnd_production_")) mode = "production";
    else if (xenditKey.startsWith("xnd_development_")) mode = "development";
    else if (xenditKey) mode = "invalid";

    let apiReachable: boolean | null = null;
    let apiErrorCode: string | null = null;
    let apiNote: string | null = null;

    if (xenditKey && (mode === "production" || mode === "development")) {
      try {
        const auth = `Basic ${Buffer.from(`${xenditKey}:`).toString("base64")}`;
        const balanceProbe = await fetch("https://api.xendit.co/balance", {
          method: "GET",
          headers: { Authorization: auth },
          cache: "no-store",
        });
        const createProbe = await fetch("https://api.xendit.co/v2/invoices", {
          method: "POST",
          headers: {
            Authorization: auth,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            external_id: `healthcheck-${Date.now()}`,
            amount: 100,
            description: "Health check probe — expire immediately",
            currency: "PHP",
            invoice_duration: 60,
          }),
          cache: "no-store",
        });
        const createBody = (await createProbe.json().catch(() => ({}))) as {
          id?: string;
          error_code?: string;
          message?: string;
        };

        if (createProbe.ok && createBody.id) {
          apiReachable = true;
          // Clean up probe invoice
          void fetch(`https://api.xendit.co/invoices/${createBody.id}/expire!`, {
            method: "POST",
            headers: { Authorization: auth },
          }).catch(() => undefined);
        } else {
          apiReachable = false;
          apiErrorCode = createBody.error_code ?? `HTTP_${createProbe.status}`;
          if (balanceProbe.ok && createProbe.status === 403) {
            apiNote =
              "Secret key authenticates and can READ invoices, but CREATE (POST /v2/invoices) is forbidden. Generate a NEW Live secret key with Money-in = Write, replace XENDIT_SECRET_KEY in portal hosting env, redeploy. Editing an old key's UI toggle is not enough if the app still uses a different key string.";
          } else {
            apiNote =
              createBody.message ??
              "Xendit API rejected invoice creation with the configured secret key.";
          }
        }
      } catch (err) {
        apiReachable = false;
        apiErrorCode = "NETWORK_ERROR";
        apiNote = err instanceof Error ? err.message : "Failed to reach Xendit API";
      }
    }

    results.xendit = {
      mode,
      keyConfigured: Boolean(xenditKey),
      webhookTokenConfigured,
      apiReachable,
      apiErrorCode,
      note:
        apiNote ??
        (mode === "production"
          ? "Live payments. Checkout should not show TEST MODE."
          : mode === "development"
            ? "Test/sandbox payments. Checkout shows TEST MODE. Replace XENDIT_SECRET_KEY with xnd_production_… and use Live Mode webhook token from Xendit Dashboard."
            : "XENDIT_SECRET_KEY is missing or not a recognized Xendit secret key."),
    };
  }

  // ── 3. Database connectivity ──
  let dbStatus: Record<string, unknown> = { connected: false };

  const mainDbUrl = process.env.NEWDATABASE_URL ?? process.env.DATABASE_URL;

  if (!mainDbUrl) {
    dbStatus.error = "NEWDATABASE_URL is not set (DATABASE_URL legacy fallback also missing)";
  } else {
    try {
      const start = Date.now();
      await prisma.$queryRaw`SELECT 1 AS ping`;
      dbStatus = {
        connected: true,
        latencyMs: Date.now() - start,
      };
    } catch (err: unknown) {
      const e = err as Error & { code?: string; errorCode?: string };
      dbStatus = {
        connected:    false,
        errorType:    e.constructor?.name ?? "Unknown",
        errorMessage: e.message ?? "Unknown error",
        errorCode:    e.code ?? e.errorCode ?? "N/A",
        // Prisma-specific: surfaced for easier triage
        prismaCode:   (e as unknown as Record<string, unknown>)["clientVersion"] ?? undefined,
      };
    }
  }
  results.database = dbStatus;

  // ── 4. CORS config ──
  const rawOrigins = process.env.ALLOWED_ORIGINS ?? "";
  results.cors = {
    allowedOrigins: rawOrigins
      ? rawOrigins.split(",").map((o) => o.trim()).filter(Boolean)
      : [],
  };

  // ── 5. SMTP connectivity (when configured for SMTP provider) ──
  const emailProvider = (process.env.EMAIL_PROVIDER || "smtp").toLowerCase();
  let smtpStatus: Record<string, unknown> = {
    provider: emailProvider,
    configured: false,
    connected: false,
  };

  if (emailProvider === "resend") {
    smtpStatus = {
      ...smtpStatus,
      configured: Boolean(process.env.RESEND_API_KEY),
      connected: null,
      note: "Resend provider selected; use send test separately.",
    };
  } else if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const port = Number(process.env.SMTP_PORT || "587");
    const secure = process.env.SMTP_SECURE === "true" || port === 465;
    smtpStatus = {
      ...smtpStatus,
      configured: true,
      host: process.env.SMTP_HOST,
      port,
      secure,
      fromAddress:
        process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_FROM || process.env.SMTP_USER,
    };

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });

    try {
      const start = Date.now();
      await transporter.verify();
      smtpStatus.connected = true;
      smtpStatus.latencyMs = Date.now() - start;
    } catch (err: unknown) {
      const e = err as Error;
      smtpStatus.connected = false;
      smtpStatus.errorMessage = e.message ?? "SMTP verify failed";
    } finally {
      transporter.close();
    }
  } else {
    smtpStatus.note = "SMTP credentials incomplete (SMTP_HOST, SMTP_USER, SMTP_PASS required).";
  }

  results.smtp = smtpStatus;

  // ── Overall health ──
  const healthy =
    !missingCritical &&
    (dbStatus as { connected?: boolean }).connected === true;

  return NextResponse.json(
    {
      status:    healthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      checks:    results,
    },
    { status: healthy ? 200 : 503 }
  );
}
