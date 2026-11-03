import { NextRequest, NextResponse } from "next/server";
import {
  validateCsrfToken,
} from "./lib/csrf";
import {
  buildContentSecurityPolicy,
  generateCspNonce,
} from "./lib/security/content-security-policy";

const DEV_LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);


interface WildcardOriginRule {
  protocol: "http:" | "https:";
  baseDomain: string;
  port: string;
}
// this is the function this is the function 
function parseOriginCandidates(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, "").trim())
    .filter(Boolean);
}

// this the isIppv4Host

function isIpv4Host(host: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
}

function expandWwwOriginVariants(origin: string): string[] {
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    const port = url.port ? `:${url.port}` : "";
    const protocol = url.protocol.toLowerCase();

    if (DEV_LOCALHOST_HOSTS.has(host) || isIpv4Host(host)) {
      return [`${protocol}//${host}${port}`];
    }


    const hosts = new Set<string>([host]);
    if (host.startsWith("www.")) {
      const withoutWww = host.slice(4);
      if (withoutWww) {
        hosts.add(withoutWww);
      }
    } else {
      hosts.add(`www.${host}`);
    }
    return Array.from(hosts).map((variantHost) => `${protocol}//${variantHost}${port}`);
  } catch {
    return [origin];
  }
}

function normalizeOrigin(origin: string | null): string | null {
  if (!origin) return null;
  const trimmed = origin.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    const protocol = url.protocol.toLowerCase();
    const hostname = url.hostname.toLowerCase();
    const port = url.port ? `:${url.port}` : "";
    return `${protocol}//${hostname}${port}`;
  } catch {
    return null;
  }
}

function parseWildcardOrigin(origin: string): WildcardOriginRule | null {
  const trimmed = origin.trim().replace(/\/+$/, "");
  const match = trimmed.match(/^(https?):\/\/\*\.(.+?)(?::(\d+))?$/i);
  if (!match) return null;

  return {
    protocol: `${match[1].toLowerCase()}:` as "http:" | "https:",
    baseDomain: match[2].toLowerCase(),
    port: match[3] ? `:${match[3]}` : "",
  };
}

const ALLOWED_ORIGIN_CANDIDATES = [
  ...parseOriginCandidates(process.env.ALLOWED_ORIGINS),
  ...parseOriginCandidates(process.env.FRONTEND_URL),
  ...parseOriginCandidates(process.env.NEXT_PUBLIC_APP_URL),
];

const ALLOWED_EXACT_ORIGINS = new Set(
  ALLOWED_ORIGIN_CANDIDATES
    .filter((entry) => !entry.includes("*"))
    .map((entry) => normalizeOrigin(entry))
    .filter((entry): entry is string => Boolean(entry))
    .flatMap((entry) => expandWwwOriginVariants(entry))
);

const ALLOWED_WILDCARD_ORIGINS = ALLOWED_ORIGIN_CANDIDATES
  .map((entry) => parseWildcardOrigin(entry))
  .filter((entry): entry is WildcardOriginRule => Boolean(entry));

// Self-origin: the app's own URL so same-origin requests are always allowed
// even if ALLOWED_ORIGINS hasn't been updated for the current deployment.
const SELF_ORIGIN: string | null = (() => {
  const candidate = process.env.NEXT_PUBLIC_APP_URL || process.env.FRONTEND_URL || null;
  return candidate ? normalizeOrigin(candidate) : null;
})();

function isStagingDeployment(): boolean {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.BACKEND_URL,
    process.env.FRONTEND_URL,
    process.env.VERCEL_URL,
  ];
  return candidates.some((value) => /hostingersite\.com/i.test(value ?? ""));
}

function isOriginAllowed(origin: string | null): boolean {
  // Reject sandboxed/null origins — never valid for credentialed API access.
  if (!origin || origin.trim().toLowerCase() === "null") return false;

  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return false;

  let url: URL;
  try {
    url = new URL(normalizedOrigin);
  } catch {
    return false;
  }

  // Allow loopback origins only in development so local smoke tests work.
  const isLocalHost = DEV_LOCALHOST_HOSTS.has(url.hostname.toLowerCase());
  if (
    isLocalHost &&
    process.env.NODE_ENV !== "production" &&
    (url.protocol === "http:" || url.protocol === "https:")
  ) {
    return true;
  }

  // Staging deployments: allow local dev frontends to call the remote API.
  if (isLocalHost && isStagingDeployment() && url.protocol === "http:") {
    return true;
  }

  // Always allow same-origin requests: if the request Origin matches the
  // app's own URL, it's a same-origin fetch (e.g. Hostinger frontend → same Hostinger API).
  // This covers deployments where ALLOWED_ORIGINS hasn't been updated yet.
  if (SELF_ORIGIN && normalizedOrigin === SELF_ORIGIN) {
    return true;
  }

  if (ALLOWED_EXACT_ORIGINS.has(normalizedOrigin)) {
    return true;
  }

  const host = url.hostname.toLowerCase();
  const port = url.port ? `:${url.port}` : "";

  return ALLOWED_WILDCARD_ORIGINS.some((rule) => {
    if (url.protocol !== rule.protocol) return false;
    if (port !== rule.port) return false;
    if (!host.endsWith(`.${rule.baseDomain}`)) return false;
    // Subdomains only (exclude the base domain itself).
    return host.length > rule.baseDomain.length + 1;
  });
}

function corsHeaders(origin: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Requested-With, X-CSRF-Token, csrf-token, X-XSRF-TOKEN",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400", // cache preflight for 24 h
    Vary: "Origin",
  };
}

/**
 * Security response headers applied to every API response.
 * WHY each header:
 * - X-Content-Type-Options: Prevents MIME type sniffing
 * - X-Frame-Options: Prevents clickjacking
 * - X-XSS-Protection: Legacy XSS filter (for older browsers)
 * - Referrer-Policy: Prevents leaking URLs to third parties
 * - Permissions-Policy: Disables unnecessary browser features
 */
function securityHeaders(): Record<string, string> {
  return {
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}

// Routes that do NOT require authentication
const PUBLIC_PREFIX_PATHS = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/forgot-password",
  "/api/auth/session",
  "/api/auth/session-health",
  "/api/auth/verify-code",
  "/api/auth/reset-password",
  "/api/auth/refresh",       // Refresh uses its own token validation
  "/api/auth/admin/login",
  "/api/auth/admin/refresh",
  "/api/auth/admin/forgot-password",
  "/api/auth/admin/reset-password",
  "/api/auth/verify-email",  // OTP verification during registration
  "/api/auth/resend-otp",    // Resend OTP for unverified accounts
  "/api/auth/reauth/otp/verify", // Reverification OTP submit — authenticated by reauth_state cookie, not session
  "/api/auth/reauth/otp/send",   // Reverification OTP resend — same pre-session state
  "/api/auth/webauthn/login/options",  // WebAuthn login options — pre-auth (no session required)
  "/api/auth/webauthn/login/verify",   // WebAuthn login verification — authenticated by reauth_state cookie
  "/api/auth/webauthn/passkey-exists", // Passkey existence check — pre-auth, read-only DB query (no challenge/state mutation)
  "/api/staff/verify",       // Staff invite link validation and password setup
  "/api/company/invitations/verify", // Company employee invite token preview
  "/api/user/cookie-preferences", // Cookie preferences (auth optional; CSRF still required for writes)
  "/api/user/profile",       // User profile — gracefully handles unauthenticated requests during signup
  "/api/notifications/unread/count", // Notification count — gracefully handles unauthenticated requests during signup
  "/api/support/unread/count", // Support unread count — gracefully handles unauthenticated requests during signup
  "/api/media/sign",         // Media signing for authenticated users; allows 'cover' context for signup flow
  "/api/media/file",         // Public R2 media proxy — private bucket objects cannot be loaded directly in <img>
  "/api/csrf-token",         // CSRF bootstrap endpoint for public clients
  "/api/monitoring/error-log", // Client error reporting (no auth required)
  "/api/health",             // Deployment diagnostics (self-authenticated via API key)
  "/api/cards/resolve",      // Public BizCard scan resolution — no auth required so any scanner can check a card
  "/api/bizcard/claim",      // Public claim pre-check endpoint for scanned blank cards
  "/api/bizcard/scan",       // Public scan resolution for NFC/QR portfolio URLs
  "/api/products",           // Public product listing and detail endpoints
  "/api/contact",            // Public landing-page contact form (emails COMPANY_INQUIRY_EMAIL)
  "/api/feedback",           // Public order feedback form (tokenized UUID links from email)
  "/api/portfolio/resolve",  // Public URI resolver for serial/custom portfolio entry URLs
  "/api/public",             // Public portfolio-facing endpoints (read-only)
  "/api/track",              // Anonymous visitor analytics (no auth; CSRF skipped)
  "/api/cron",               // Cron routes are authenticated with shared secret header, not session cookies
  "/api/xendit/webhook",     // Xendit webhook endpoint validates x-callback-token instead of cookies
  "/api/affiliate/validate", // Public referral-code validation (no PII)
  "/api/affiliate/link-redirect", // Public affiliate click tracking + redirect
  "/api/internal/cross-portal", // SmartPet ↔ OnTap HMAC service calls (no session cookie)
  "/api/auth/cross-portal",  // Superadmin SSO redirects (GET only; state cookie + single-use tickets)
];

const PUBLIC_EXACT_PATHS = new Set([
  "/api/vcard/details",
  "/api/vcard/design",
  "/api/vcard/services",
  "/api/vcard/social",
  "/api/vcard/design/preview",
  "/api/vcard/design/stream",
]);

// Portfolio public interaction sub-routes — matched by suffix because the [uri]
// dynamic segment makes prefix-only matching too broad (it would catch /connect
// and /analytics which ARE protected).
const PUBLIC_PORTFOLIO_SUFFIXES = [
  "/view",               // POST /api/portfolio/[uri]/view
  "/save-contact",       // POST /api/portfolio/[uri]/save-contact
  "/inquire",            // POST /api/portfolio/[uri]/inquire
  "/visitor-lead",       // POST /api/portfolio/[uri]/visitor-lead (guest contact capture)
  "/connection-status",  // GET  /api/portfolio/[uri]/connection-status
];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT_PATHS.has(pathname)) return true;
  if (PUBLIC_PREFIX_PATHS.some((p) => pathname.startsWith(p))) return true;
  // Portfolio interaction routes: /api/portfolio/[uri]/view | /save-contact | /inquire
  // Match by suffix to avoid accidentally bypassing auth on /connect and /analytics.
  if (pathname.startsWith("/api/portfolio/")) {
    return PUBLIC_PORTFOLIO_SUFFIXES.some((s) => pathname.endsWith(s));
  }
  return false;
}

// ──────────────────────────────────────────────────────────────
// Page Route Protection — Auth Guard for Frontend Pages
// ──────────────────────────────────────────────────────────────
// Checks for session_token cookie on protected page routes.
// If missing, redirects to the login page immediately.
// Full session validation (DB, expiry, revocation) is handled
// by the client-side auth guard in layout components.
// ──────────────────────────────────────────────────────────────

// Protected page route groups — any path starting with these requires auth
const PROTECTED_PAGE_GROUPS = [
  "/user",
  "/admin",
  "/superadmin",
  "/staff",
  "/dev",
];

// Public pages within protected groups that should NOT require auth
const PUBLIC_PAGE_ROUTES = [
  "/",
  "/user/signup",
  "/user/onboarding",
  "/user/forgot-password",
  "/user/verify-email",
  "/super-login",
  "/staff/verify",
  "/staff/verify-email",
  "/staff/setup-password",
  "/company/accept-invite",
  "/feedback",
];

function isPublicPagePath(pathname: string): boolean {
  if (PUBLIC_PAGE_ROUTES.some((route) => pathname === route || pathname.startsWith(route + "/"))) {
    return true;
  }
  if (/^\/scan\/[^/]+(\/merge(\/success)?)?$/.test(pathname)) {
    return true;
  }
  return false;
}

function isProtectedPageRoute(pathname: string): boolean {
  if (isPublicPagePath(pathname)) {
    return false;
  }
  // Then check if it falls under any protected group
  return PROTECTED_PAGE_GROUPS.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/")
  );
}

function getPageLoginUrl(pathname: string, request: NextRequest): URL {
  // Preserve query string (e.g. /user/bizcard/create-new?serial=ABC123) and
  // surface serial on the login URL for NFC/QR claim continuity.
  const search = request.nextUrl.search || "";
  const redirectTarget = `${pathname}${search}`;
  const serial =
    request.nextUrl.searchParams.get("serial")?.trim() ||
    request.nextUrl.searchParams.get("ref")?.trim() ||
    "";

  if (
    pathname.startsWith("/superadmin") ||
    pathname.startsWith("/staff") ||
    pathname.startsWith("/dev")
  ) {
    const loginUrl = new URL("/super-login", request.url);
    loginUrl.searchParams.set("redirect", redirectTarget);
    return loginUrl;
  }
  const loginUrl = new URL("/", request.url);
  loginUrl.searchParams.set("redirect", redirectTarget);
  if (serial) {
    loginUrl.searchParams.set("serial", serial.toUpperCase());
  }
  return loginUrl;
}

function handlePageRouteProtection(
  request: NextRequest,
  pathname: string,
  enrichedRequestHeaders: Headers,
): NextResponse {
  // Skip Next.js internals (matcher already excludes static assets)
  if (pathname.startsWith("/_next/") || pathname.startsWith("/static/")) {
    return NextResponse.next({ request: { headers: enrichedRequestHeaders } });
  }

  if (!isProtectedPageRoute(pathname)) {
    return NextResponse.next({ request: { headers: enrichedRequestHeaders } });
  }

  const sessionToken = request.cookies.get("session_token")?.value;
  if (!sessionToken || sessionToken.trim() === "") {
    const loginUrl = getPageLoginUrl(pathname, request);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next({ request: { headers: enrichedRequestHeaders } });
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const origin = request.headers.get("origin");
  const isStateChanging = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method);
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  const nonce = generateCspNonce();
  const csp = buildContentSecurityPolicy({
    nonce,
    isDev: process.env.NODE_ENV !== "production",
  });

  const enrichedRequestHeaders = new Headers(request.headers);
  enrichedRequestHeaders.set("x-request-id", requestId);
  enrichedRequestHeaders.set("x-nonce", nonce);
  enrichedRequestHeaders.set("Content-Security-Policy", csp);

  function applySecurityResponse(response: NextResponse): NextResponse {
    response.headers.set("Content-Security-Policy", csp);
    response.headers.set("X-Request-ID", requestId);
    Object.entries(securityHeaders()).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  }

  // ── Page Route Auth Guard ─────────────────
  // Protect frontend page routes by checking session cookie presence.
  // If no session cookie exists, redirect to the login page.
  if (!pathname.startsWith("/api")) {
    return applySecurityResponse(
      handlePageRouteProtection(request, pathname, enrichedRequestHeaders),
    );
  }

  // For same-origin deployments (e.g. Hostinger where frontend and API share
  // the same host), the browser sends an Origin header that matches the
  // request URL's own origin. Always allow this — it's not cross-origin.
  const requestOrigin = request.nextUrl.origin;
  const isSameOrigin = origin ? normalizeOrigin(origin) === normalizeOrigin(requestOrigin) : false;
  const allowed = isSameOrigin || isOriginAllowed(origin);

  // Cron + provider webhooks are server-to-server (shared-secret auth).
  // Schedulers like cron-job.org may send an Origin header that is not in
  // ALLOWED_ORIGINS; rejecting them with CORS 403 blocks legitimate jobs.
  const isServerToServerPath =
    pathname.startsWith("/api/cron") ||
    pathname.startsWith("/api/xendit/webhook") ||
    pathname.startsWith("/api/marketplace/webhooks/") ||
    pathname.startsWith("/api/internal/cross-portal");

  // ── CORS: Reject unknown origins on credentialed requests ──
  // WHY: Prevents unauthorized sites from making API calls
  if (origin && !allowed && !isServerToServerPath) {
    return applySecurityResponse(new NextResponse(
      JSON.stringify({ error: "CORS: Origin not allowed." }),
      {
        status: 403,
        headers: {
          "Content-Type": "application/json",
        },
      },
    ));
  }

  // ── Handle preflight (OPTIONS) ────────────
  if (request.method === "OPTIONS") {
    if (allowed && origin) {
      const preflight = new NextResponse(null, { status: 204 });
      Object.entries(corsHeaders(origin)).forEach(([key, value]) => {
        preflight.headers.set(key, value);
      });
      return applySecurityResponse(preflight);
    }
    return applySecurityResponse(new NextResponse(null, { status: 204 }));
  }

  // ── CSRF guard for state-changing API routes ─────────────
  // Skip CSRF for explicitly public routes, cron jobs, and provider webhooks
  // that authenticate via shared secrets/signatures.
  //
  // WebAuthn login flow:
  // - /api/auth/webauthn/login/options  → skips CSRF (challenge generation only, no session mutation)
  // - /api/auth/webauthn/login/verify   → requires CSRF (creates a session — state-changing)
  //
  // Reverification:
  // - /api/auth/reauth/* → requires CSRF (state-changing, no session cookie)
  const webauthnVerifyRequiresCsrf =
    pathname === "/api/auth/webauthn/login/verify";

  const reauthRequiresCsrf =
    pathname.startsWith("/api/auth/reauth");

  const skipCsrf =
    (!webauthnVerifyRequiresCsrf && !reauthRequiresCsrf && isPublicPath(pathname) && pathname !== "/api/user/cookie-preferences") ||
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/api/xendit/webhook") ||
    pathname.startsWith("/api/marketplace/webhooks/") ||
    pathname.startsWith("/api/internal/cross-portal") ||
    pathname === "/api/csrf-token";

  if (isStateChanging && pathname.startsWith("/api") && !skipCsrf) {
    const csrfValid = await validateCsrfToken(request);
    if (!csrfValid) {
      const res = NextResponse.json(
        {
          error: "Invalid CSRF token.",
          code: "CSRF_TOKEN_INVALID",
        },
        { status: 403 }
      );
      if (allowed && origin) {
        Object.entries(corsHeaders(origin)).forEach(([k, v]) =>
          res.headers.set(k, v)
        );
      }
      return applySecurityResponse(res);
    }
  }

  // ── Auth guard for protected routes ───────
  // Logout must remain reachable without cookies (idempotent cleanup) while
  // still requiring CSRF for state-changing POSTs below.
  const isLogoutPath =
    pathname === "/api/auth/logout" || pathname === "/api/auth/admin/logout";

  if (!isPublicPath(pathname) && !isLogoutPath) {
    const token = request.cookies.get("session_token")?.value ?? request.cookies.get("refresh_token")?.value;
    if (!token) {
      const res = NextResponse.json(
        { error: "Unauthorized." },
        { status: 401 }
      );
      if (allowed && origin) {
        Object.entries(corsHeaders(origin)).forEach(([k, v]) =>
          res.headers.set(k, v)
        );
      }
      return applySecurityResponse(res);
    }
    // NOTE: Full session validation (DB lookup, revocation check) happens
    // in the route handler. The middleware only checks cookie presence
    // because edge runtime cannot run Prisma queries.
  }

  // ── Attach CORS + Security headers to the response ───
  const response = NextResponse.next({ request: { headers: enrichedRequestHeaders } });

  // CSRF cookies are issued only by GET /api/csrf-token to avoid conflicting tokens
  // from parallel bootstrap Set-Cookie headers on other GET responses.

  if (allowed && origin) {
    Object.entries(corsHeaders(origin)).forEach(([k, v]) =>
      response.headers.set(k, v)
    );
  }

  return applySecurityResponse(response);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)  
     * - Static assets with file extensions (svg, png, jpg, etc.)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|eot)$).*)",
  ],
};
