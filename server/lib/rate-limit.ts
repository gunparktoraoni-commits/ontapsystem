// ──────────────────────────────────────────────────────────────
// Rate Limiter — In-Memory + DB-Backed Brute Force Protection
// ──────────────────────────────────────────────────────────────
// WHY two layers?
//
// 1. In-Memory (Map): Fast, zero-latency check for high-frequency abuse.
//    Resets on cold start (acceptable — Vercel functions live ~5-15 min).
//    Acts as the first line of defense for IP-based rate limiting.
//
// 2. DB-Backed (AccountLockout table): Persistent across cold starts.
//    Tracks per-email failed login attempts with progressive lockout.
//    Survives serverless restarts — cannot be bypassed by forcing cold starts.
//
// Attack Vectors Mitigated:
// - Credential stuffing: IP rate limit caps total requests per IP
// - Password spraying: Per-email lockout detects distributed attacks
// - Brute force: Progressive lockout exponentially increases wait time
// ──────────────────────────────────────────────────────────────

import { prismaAnalytics } from "./prisma-analytics";

// ──────────────────────────────────────────
// In-Memory IP Rate Limiter (Sliding Window)
// ──────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  resetAt: number; // Unix timestamp (ms)
}

// Map key: "action:identifier" (e.g., "login:192.168.1.1")
const rateLimitStore = new Map<string, RateLimitEntry>();

// Configuration per action
interface RateLimitConfig {
  maxAttempts: number;
  windowMs: number;
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  // Login: 10 attempts per 15 minutes per IP
  // WHY 10? Allows legitimate users who mistype, but blocks automated tools
  "login": { maxAttempts: 10, windowMs: 15 * 60 * 1000 },

  // Register: 5 attempts per 15 minutes per IP
  // WHY 5? Registration is rare; high volume = abuse
  "register": { maxAttempts: 5, windowMs: 15 * 60 * 1000 },

  // Forgot password: 5 requests per 15 minutes per IP
  // WHY 5? Prevents email bombing via password reset
  "forgot-password": { maxAttempts: 5, windowMs: 15 * 60 * 1000 },

  // Verify code (password reset): 10 attempts per 15 minutes per IP
  // WHY 10? 6-char alphanumeric = 2.1B possibilities, 10 guesses is safe
  "verify-code": { maxAttempts: 10, windowMs: 15 * 60 * 1000 },

  // Reset password: 5 attempts per 15 minutes per IP
  "reset-password": { maxAttempts: 5, windowMs: 15 * 60 * 1000 },

  // Refresh token: 20 per 15 minutes per IP
  "refresh": { maxAttempts: 20, windowMs: 15 * 60 * 1000 },

  // Admin auth endpoints under /api/auth/admin/*
  "auth-admin-login": { maxAttempts: 10, windowMs: 15 * 60 * 1000 },
  "auth-admin-forgot-password": { maxAttempts: 5, windowMs: 15 * 60 * 1000 },
  "auth-admin-reset-password": { maxAttempts: 5, windowMs: 15 * 60 * 1000 },
  "auth-admin-refresh": { maxAttempts: 20, windowMs: 15 * 60 * 1000 },
  "auth-admin-change-password": { maxAttempts: 5, windowMs: 15 * 60 * 1000 },
  "auth-admin-verify": { maxAttempts: 60, windowMs: 60 * 1000 },
  "auth-admin-logout": { maxAttempts: 30, windowMs: 60 * 1000 },

  // Email OTP verification: 10 per 15 minutes per IP
  // Per-OTP attempt limit (5) is enforced in DB; IP limit is secondary defense
  "verify-email": { maxAttempts: 10, windowMs: 15 * 60 * 1000 },

  // Resend OTP: 3 per 15 minutes per IP — prevents email bombing on registration
  "resend-otp": { maxAttempts: 3, windowMs: 15 * 60 * 1000 },

  // Error log ingestion: 30 per minute per IP
  // Frontend sends errors; bursts possible on flaky connections
  "error-log": { maxAttempts: 30, windowMs: 60 * 1000 },

  // Card scan: 60 per minute per IP
  // Scanning sessions can produce rapid-fire requests from a handheld scanner;
  // 60/min is permissive enough for legitimate use while blocking enumeration.
  "card-scan": { maxAttempts: 60, windowMs: 60 * 1000 },

  // Card bulk assign: 10 per 15 minutes per IP
  // Batch submission is infrequent; a tight limit prevents bulk enumeration
  "card-bulk-assign": { maxAttempts: 10, windowMs: 15 * 60 * 1000 },

  // Roulette spin action: 10 per minute per user
  // Stricter than IP-based to prevent abuse but allows multiple spins
  "user-spin-action": { maxAttempts: 10, windowMs: 60 * 1000 },

  // Roulette spin balance check: 60 per minute per IP
  "user-spin-balance": { maxAttempts: 60, windowMs: 60 * 1000 },

  // Roulette spin history: 60 per minute per IP
  "user-spin-history": { maxAttempts: 60, windowMs: 60 * 1000 },

  // User vouchers: 60 per minute per IP
  "user-vouchers": { maxAttempts: 60, windowMs: 60 * 1000 },

  // Admin order completion: 30 per minute per IP
  "admin-order-complete": { maxAttempts: 30, windowMs: 60 * 1000 },

  // Card assign: 10 per 15 minutes per IP
  // or accidental re-submission hammering.
  "card-assign": { maxAttempts: 10, windowMs: 15 * 60 * 1000 },

  // BizCard public resolution: 60 per minute per IP
  // Public endpoint hit whenever anyone scans a QR/NFC card.
  // 60/min matches the company card-scan limit — generous for real users,
  // tight enough to slow serial ID enumeration.
  "bizcard-resolve": { maxAttempts: 60, windowMs: 60 * 1000 },

  // Public scan redirect endpoint for physical card QR scans.
  "public-scan": { maxAttempts: 120, windowMs: 60 * 1000 },

  // WebAuthn endpoints: Allow reasonable number of biometric authentication attempts
  // Registration options: 10 per 15 minutes per IP
  "webauthn-register-options": { maxAttempts: 10, windowMs: 15 * 60 * 1000 },
  // Registration verify: 10 per 15 minutes per IP
  "webauthn-register-verify": { maxAttempts: 10, windowMs: 15 * 60 * 1000 },
  // Authentication options: 15 per 15 minutes per IP (slightly higher for login flow)
  "webauthn-auth-options": { maxAttempts: 15, windowMs: 15 * 60 * 1000 },
  // Authentication verify: 15 per 15 minutes per IP
  "webauthn-auth-verify": { maxAttempts: 15, windowMs: 15 * 60 * 1000 },
  // Login-specific WebAuthn (biometric after password): 15 per 15 minutes per IP
  "webauthn-login-options": { maxAttempts: 15, windowMs: 15 * 60 * 1000 },
  // Login-specific WebAuthn verify: 15 per 15 minutes per IP
  "webauthn-login-verify": { maxAttempts: 15, windowMs: 15 * 60 * 1000 },
  // Passkey existence check (pre-auth, read-only): 20 per 15 minutes per IP
  // Lightweight DB read called on login page mount to decide whether to
  // show the biometric prompt.  Higher than login-options because it has
  // no side effects (no challenge/cookie mutation).
  "webauthn-passkey-exists": { maxAttempts: 20, windowMs: 15 * 60 * 1000 },

  // Physical card registration is a privileged write path.
  "physical-card-register": { maxAttempts: 30, windowMs: 60 * 60 * 1000 },

  // Authenticated dashboard QR metadata endpoint.
  "dashboard-qr": { maxAttempts: 120, windowMs: 60 * 1000 },

  // Authenticated dashboard QR image download endpoint.
  "dashboard-qr-download": { maxAttempts: 120, windowMs: 60 * 1000 },

  // Regeneration is expensive and should be throttled.
  "dashboard-qr-regenerate": { maxAttempts: 20, windowMs: 60 * 60 * 1000 },

  // Owner/admin QR scan analytics endpoint.
  "bizcard-qr-stats": { maxAttempts: 60, windowMs: 60 * 1000 },

  // Individual card merge: 5 per hour per IP
  // Linking a card to a profile is a rare, deliberate action.
  // Very tight limit — prevents scripted bulk-claiming of card serial IDs.
  "card-merge": { maxAttempts: 5, windowMs: 60 * 60 * 1000 },

  // Authenticated merchandise cart requests are limited per user.
  "cart-get": { maxAttempts: 60, windowMs: 60 * 1000 },
  "cart-add": { maxAttempts: 30, windowMs: 60 * 1000 },
  "cart-update": { maxAttempts: 60, windowMs: 60 * 1000 },
  "cart-remove": { maxAttempts: 30, windowMs: 60 * 1000 },
  "cart-batch-remove": { maxAttempts: 30, windowMs: 60 * 1000 },
  "cart-clear": { maxAttempts: 30, windowMs: 60 * 1000 },

  // Blank bizcard claim probe endpoint: 10 requests per 10 seconds per IP.
  // Dedicated anti-bot limiter for serial scanning bursts.
  "bizcard-claim": { maxAttempts: 10, windowMs: 10 * 1000 },

  // Blank bizcard merge endpoint: 10 requests per 10 seconds per IP.
  // Separate key from card-merge for clearer alerting and tuning.
  "bizcard-merge-sensitive": { maxAttempts: 10, windowMs: 10 * 1000 },

  // Superadmin generation endpoint: high-cost write endpoint (QR + inserts).
  "admin-bizcard-generate": { maxAttempts: 20, windowMs: 60 * 1000 },

  // Superadmin Excel export endpoint: potentially expensive read/serialize.
  "admin-bizcard-download": { maxAttempts: 20, windowMs: 60 * 1000 },

  // Admin link card to employee: 30 per 15 minutes per IP
  // Admins may need to assign many cards in a single session,
  // but one-at-a-time so 30/15 min is plenty for legitimate use.
  "card-link-employee": { maxAttempts: 30, windowMs: 15 * 60 * 1000 },

  // Card status update (activate/deactivate): 20 per hour per IP
  // Changing card status is infrequent; a conservative limit prevents
  // automated toggling attacks.
  "card-status": { maxAttempts: 20, windowMs: 60 * 60 * 1000 },

  // Portfolio view logging: 30 per minute per IP
  // Called on every public portfolio page load by the frontend.
  // 30/min is generous for real browsing while throttling scrapers.
  "portfolio-view": { maxAttempts: 30, windowMs: 60 * 1000 },

  // Anonymous visitor geolocation ping: 20 per minute per IP
  "visitor-location": { maxAttempts: 20, windowMs: 60 * 1000 },

  // Contact save logging: 10 per minute per IP
  // Save/download actions are intentional; tight limit prevents event flooding.
  "contact-save": { maxAttempts: 10, windowMs: 60 * 1000 },

  // Connection request: 10 per hour per IP
  // Sending friend/associate requests is a deliberate, infrequent action.
  // Tight limit prevents spam-request attacks against portfolio owners.
  "connection-request": { maxAttempts: 10, windowMs: 60 * 60 * 1000 },

  // Connection response (accept/decline/block): 30 per hour per IP
  // Processing an inbox of pending requests — higher than sending limit.
  "connection-respond": { maxAttempts: 30, windowMs: 60 * 60 * 1000 },

  // Inquiry submission: 5 per 15 minutes per IP
  // Contact form submissions; very conservative to prevent spam campaigns.
  "inquiry-submit": { maxAttempts: 5, windowMs: 15 * 60 * 1000 },

  // Guest portfolio lead capture (name/phone/email): 5 per 15 minutes per IP
  "visitor-lead-submit": { maxAttempts: 5, windowMs: 15 * 60 * 1000 },

  // Portfolio leads inbox (owner):
  "leads-list": { maxAttempts: 120, windowMs: 60 * 1000 },
  "leads-update": { maxAttempts: 60, windowMs: 60 * 1000 },
  "leads-export": { maxAttempts: 10, windowMs: 15 * 60 * 1000 },

  // Inquiry inbox list: 120 per minute per IP
  // Dashboard polling + pagination browsing for authenticated owners.
  "inquiries-list": { maxAttempts: 120, windowMs: 60 * 1000 },

  // Inquiry detail view: 180 per minute per IP
  // Opening/refreshing detail panels should be responsive in dashboard UI.
  "inquiries-detail": { maxAttempts: 180, windowMs: 60 * 1000 },

  // Inquiry status updates: 60 per minute per IP
  // Covers bulk marking as read/replied while preventing abuse.
  "inquiries-update": { maxAttempts: 60, windowMs: 60 * 1000 },

  // Inquiry soft deletes: 30 per minute per IP
  // Destructive operation — tighter limit than read endpoints.
  "inquiries-delete": { maxAttempts: 30, windowMs: 60 * 1000 },

  // Portfolio analytics retrieval: 60 per minute per IP
  // Authenticated owner-only read endpoint; reasonably generous for dashboards.
  "portfolio-analytics": { maxAttempts: 60, windowMs: 60 * 1000 },

  // Owner analytics dashboard aggregate endpoint: 30 per minute per user/IP
  // Tight enough for burst control while supporting live dashboard refresh.
  "analytics-dashboard": { maxAttempts: 30, windowMs: 60 * 1000 },

  // vCard initial setup: 10 per 15 minutes per IP
  // Setup is a one-time (or infrequent) wizard step; abuse here could
  // claim/overwrite profile data so a conservative limit applies.
  "vcard-setup": { maxAttempts: 10, windowMs: 15 * 60 * 1000 },

  // Address geocode proxy: 30 per 15 minutes per IP
  "geocode": { maxAttempts: 30, windowMs: 15 * 60 * 1000 },

  // Public order feedback form load: 60 per minute per IP
  "order-feedback-read": { maxAttempts: 60, windowMs: 60 * 1000 },

  // Public order feedback submit: 10 per 15 minutes per IP
  "order-feedback-submit": { maxAttempts: 10, windowMs: 15 * 60 * 1000 },

  // vCard profile update: 30 per minute per IP
  // Autosave-style edits can be frequent; 30/min allows rapid saves
  // while still preventing scripted flooding.
  "vcard-update": { maxAttempts: 30, windowMs: 60 * 1000 },

  // Public vCard view: 120 per minute per IP
  // Publicly accessible read-only endpoint; generous limit for real visitors
  // while throttling scrapers.
  "vcard-view": { maxAttempts: 120, windowMs: 60 * 1000 },

  // Authenticated theme update endpoint for vCard design.
  "vcard-theme-update": { maxAttempts: 10, windowMs: 60 * 1000 },

  // Preview calls can be high while users browse templates.
  "vcard-theme-preview": { maxAttempts: 60, windowMs: 60 * 1000 },

  // SSE stream subscriptions for theme live updates.
  "vcard-theme-stream": { maxAttempts: 30, windowMs: 60 * 1000 },

  // Dashboard overview & activity feed: 120 per minute per IP
  // Authenticated owner-only read endpoints; generous for dashboard polling.
  "dashboard": { maxAttempts: 120, windowMs: 60 * 1000 },

  // Bizcard dashboard endpoints
  "user-bizcards-list": { maxAttempts: 60, windowMs: 60 * 1000 },
  "user-bizcard-dashboard": { maxAttempts: 60, windowMs: 60 * 1000 },
  "user-bizcard-dashboard-by-id": { maxAttempts: 120, windowMs: 60 * 1000 },

  // Company creation: 5 per hour per IP
  // Creating a company is a rare, high-value action — very tight limit
  // prevents scripted bulk-creation of placeholder companies.
  "company-create": { maxAttempts: 5, windowMs: 60 * 60 * 1000 },
  "company-my-company": { maxAttempts: 120, windowMs: 60 * 1000 },
  "company-pending-requests": { maxAttempts: 60, windowMs: 60 * 1000 },
  "company-approve": { maxAttempts: 60, windowMs: 60 * 1000 },
  "company-join": { maxAttempts: 5, windowMs: 60 * 60 * 1000 },
  "company-search": { maxAttempts: 30, windowMs: 60 * 1000 },
  "company-employees-list": { maxAttempts: 60, windowMs: 60 * 1000 },
  "company-employee-detail": { maxAttempts: 60, windowMs: 60 * 1000 },
  "company-employee-role-update": { maxAttempts: 30, windowMs: 60 * 1000 },
  "company-employee-restrict": { maxAttempts: 20, windowMs: 60 * 1000 },
  "company-employee-remove": { maxAttempts: 20, windowMs: 60 * 1000 },
  "company-employee-profile-photo": { maxAttempts: 20, windowMs: 10 * 60 * 1000 },
  "company-employee-professional-profile": { maxAttempts: 60, windowMs: 60 * 1000 },
  "company-employee-professional-profile-update": { maxAttempts: 30, windowMs: 60 * 1000 },
  "company-employee-professional-socials": { maxAttempts: 60, windowMs: 60 * 1000 },
  "company-employee-professional-socials-update": { maxAttempts: 30, windowMs: 60 * 1000 },
  "company-employee-professional-services": { maxAttempts: 60, windowMs: 60 * 1000 },
  "company-employee-professional-services-mutate": { maxAttempts: 40, windowMs: 60 * 1000 },
  "company-employee-acting-context": { maxAttempts: 30, windowMs: 60 * 1000 },
  "company-employee-activity-history": { maxAttempts: 60, windowMs: 60 * 1000 },
  "companyadmin-join-requests-list": { maxAttempts: 60, windowMs: 60 * 1000 },
  "companyadmin-join-request-accept": { maxAttempts: 30, windowMs: 60 * 1000 },
  "companyadmin-join-request-decline": { maxAttempts: 30, windowMs: 60 * 1000 },
  "companyadmin-invite-employees": { maxAttempts: 30, windowMs: 60 * 1000 },
  "companyadmin-provision-employee": { maxAttempts: 20, windowMs: 60 * 1000 },
  "company-invite-verify": { maxAttempts: 60, windowMs: 60 * 1000 },
  "company-invite-accept": { maxAttempts: 30, windowMs: 60 * 1000 },
  "company-invite-resend": { maxAttempts: 30, windowMs: 60 * 1000 },
  "company-invite-resend-cooldown": { maxAttempts: 1, windowMs: 60 * 1000 },
  "company-invite-cancel": { maxAttempts: 30, windowMs: 60 * 1000 },
  "companyadmin-employee-export": { maxAttempts: 20, windowMs: 60 * 1000 },
  "company-analytics-ranking": { maxAttempts: 30, windowMs: 60 * 1000 },
  "company-inquiries": { maxAttempts: 60, windowMs: 60 * 1000 },
  "company-employees-activity-summary": { maxAttempts: 30, windowMs: 60 * 1000 },
  "company-security-randomize": { maxAttempts: 5, windowMs: 60 * 60 * 1000 },
  "company-name-change-request": { maxAttempts: 10, windowMs: 60 * 60 * 1000 },
  "company-name-change-pending": { maxAttempts: 60, windowMs: 60 * 1000 },
  "company-name-change-approve": { maxAttempts: 30, windowMs: 60 * 1000 },
  "company-settings-update": { maxAttempts: 20, windowMs: 60 * 60 * 1000 },
  "company-theme-update": { maxAttempts: 20, windowMs: 60 * 60 * 1000 },
  "company-dashboard-summary": { maxAttempts: 30, windowMs: 60 * 1000 },
  "company-dashboard-weekly-trend": { maxAttempts: 30, windowMs: 60 * 1000 },
  "company-dashboard-top-employee": { maxAttempts: 60, windowMs: 60 * 1000 },
  "company-dashboard-time-series": { maxAttempts: 20, windowMs: 60 * 1000 },
  "company-dashboard-employee-rankings": { maxAttempts: 30, windowMs: 60 * 1000 },
  "company-notification-admin-preferences": { maxAttempts: 60, windowMs: 60 * 1000 },
  "company-notification-employee-preferences": { maxAttempts: 120, windowMs: 60 * 1000 },
  "company-notification-logs": { maxAttempts: 60, windowMs: 60 * 1000 },

  // Superadmin client management endpoints.
  "superadmin-clients-summary": { maxAttempts: 30, windowMs: 60 * 1000 },
  "superadmin-clients-list": { maxAttempts: 60, windowMs: 60 * 1000 },
  "superadmin-clients-online": { maxAttempts: 30, windowMs: 60 * 1000 },
  "superadmin-clients-detail": { maxAttempts: 120, windowMs: 60 * 1000 },
  "superadmin-clients-update": { maxAttempts: 30, windowMs: 60 * 1000 },
  "superadmin-clients-restrict": { maxAttempts: 10, windowMs: 60 * 1000 },
  "superadmin-clients-unrestrict": { maxAttempts: 10, windowMs: 60 * 1000 },
  "superadmin-clients-portfolio": { maxAttempts: 30, windowMs: 60 * 1000 },
  "superadmin-clients-export": { maxAttempts: 5, windowMs: 60 * 60 * 1000 },

  // Superadmin affiliate management endpoints.
  "superadmin-affiliates-analytics": { maxAttempts: 30, windowMs: 60 * 1000 },
  "superadmin-affiliates-summary": { maxAttempts: 30, windowMs: 60 * 1000 },
  "superadmin-affiliates-list": { maxAttempts: 60, windowMs: 60 * 1000 },
  "superadmin-affiliates-top-performers": { maxAttempts: 30, windowMs: 60 * 1000 },
  "superadmin-affiliates-recent-referrals": { maxAttempts: 30, windowMs: 60 * 1000 },
  "superadmin-affiliates-detail": { maxAttempts: 120, windowMs: 60 * 1000 },
  "superadmin-affiliates-update": { maxAttempts: 30, windowMs: 60 * 1000 },
  "superadmin-affiliates-update-commission": { maxAttempts: 30, windowMs: 60 * 1000 },
  "superadmin-affiliates-restrict": { maxAttempts: 10, windowMs: 60 * 1000 },
  "superadmin-affiliates-unrestrict": { maxAttempts: 10, windowMs: 60 * 1000 },
  "superadmin-affiliates-performance": { maxAttempts: 60, windowMs: 60 * 1000 },
  "superadmin-affiliates-export": { maxAttempts: 5, windowMs: 60 * 60 * 1000 },

  // Superadmin order management endpoints.
  "superadmin-orders-summary": { maxAttempts: 30, windowMs: 60 * 1000 },
  "superadmin-orders-list": { maxAttempts: 60, windowMs: 60 * 1000 },
  "superadmin-orders-recent": { maxAttempts: 60, windowMs: 60 * 1000 },
  "superadmin-orders-detail": { maxAttempts: 120, windowMs: 60 * 1000 },
  "superadmin-orders-status-update": { maxAttempts: 30, windowMs: 60 * 1000 },
  "superadmin-orders-cancel": { maxAttempts: 30, windowMs: 60 * 1000 },
  "superadmin-orders-timeline": { maxAttempts: 60, windowMs: 60 * 1000 },
  "superadmin-orders-analytics": { maxAttempts: 30, windowMs: 60 * 1000 },
  "superadmin-orders-export": { maxAttempts: 5, windowMs: 60 * 60 * 1000 },
  "superadmin-orders-report-pdf": { maxAttempts: 5, windowMs: 60 * 60 * 1000 },
  "superadmin-orders-stream": { maxAttempts: 30, windowMs: 60 * 1000 },
  "superadmin-orders-bulk-update": { maxAttempts: 10, windowMs: 60 * 1000 },

  // Superadmin product management endpoints.
  "superadmin-products-list": { maxAttempts: 60, windowMs: 60 * 1000 },
  "superadmin-products-detail": { maxAttempts: 120, windowMs: 60 * 1000 },
  "superadmin-products-create": { maxAttempts: 20, windowMs: 60 * 1000 },
  "superadmin-products-update": { maxAttempts: 30, windowMs: 60 * 1000 },
  "superadmin-products-delete": { maxAttempts: 10, windowMs: 60 * 1000 },
  "superadmin-products-upload-images": { maxAttempts: 20, windowMs: 60 * 1000 },

  // Superadmin promo management endpoints.
  "superadmin-promos-list": { maxAttempts: 60, windowMs: 60 * 1000 },
  "superadmin-promos-detail": { maxAttempts: 120, windowMs: 60 * 1000 },
  "superadmin-promos-create": { maxAttempts: 20, windowMs: 60 * 1000 },
  "superadmin-promos-update": { maxAttempts: 30, windowMs: 60 * 1000 },
  "superadmin-promos-delete": { maxAttempts: 10, windowMs: 60 * 1000 },
  "superadmin-promos-toggle": { maxAttempts: 30, windowMs: 60 * 1000 },
  "superadmin-promos-usage": { maxAttempts: 60, windowMs: 60 * 1000 },
  "superadmin-promos-target-groups": { maxAttempts: 30, windowMs: 60 * 1000 },

  // Superadmin dashboard endpoints.
  "superadmin-dashboard-metrics": { maxAttempts: 30, windowMs: 60 * 1000 },
  "superadmin-dashboard-recent-activities": { maxAttempts: 60, windowMs: 60 * 1000 },
  "superadmin-users-list": { maxAttempts: 60, windowMs: 60 * 1000 },
  "superadmin-system-health": { maxAttempts: 30, windowMs: 60 * 1000 },
  "superadmin-staff-activities": { maxAttempts: 30, windowMs: 60 * 1000 },
  "superadmin-recent-orders": { maxAttempts: 60, windowMs: 60 * 1000 },

  // Superadmin staff management endpoints.
  "superadmin-staff-analytics": { maxAttempts: 30, windowMs: 60 * 1000 },
  "superadmin-staff-list": { maxAttempts: 60, windowMs: 60 * 1000 },
  "superadmin-staff-detail": { maxAttempts: 120, windowMs: 60 * 1000 },
  "superadmin-staff-create": { maxAttempts: 10, windowMs: 60 * 1000 },
  "superadmin-staff-update-permissions": { maxAttempts: 20, windowMs: 60 * 1000 },
  "superadmin-staff-update-role": { maxAttempts: 20, windowMs: 60 * 1000 },
  "superadmin-staff-update-status": { maxAttempts: 20, windowMs: 60 * 1000 },
  "superadmin-staff-search": { maxAttempts: 60, windowMs: 60 * 1000 },
  "superadmin-staff-assign": { maxAttempts: 10, windowMs: 60 * 1000 },
  "superadmin-staff-export": { maxAttempts: 5, windowMs: 60 * 60 * 1000 },

  // Superadmin company management endpoints.
  "superadmin-companies-list": { maxAttempts: 60, windowMs: 60 * 1000 },
  "superadmin-companies-detail": { maxAttempts: 120, windowMs: 60 * 1000 },
  "superadmin-companies-export": { maxAttempts: 5, windowMs: 60 * 60 * 1000 },
  "superadmin-companies-pending-requests": { maxAttempts: 60, windowMs: 60 * 1000 },
  "superadmin-companies-approve": { maxAttempts: 30, windowMs: 60 * 1000 },
  "superadmin-companies-name-change-pending": { maxAttempts: 60, windowMs: 60 * 1000 },
  "superadmin-companies-name-change-approve": { maxAttempts: 30, windowMs: 60 * 1000 },
  "superadmin-companies-employees-list": { maxAttempts: 60, windowMs: 60 * 1000 },
  "superadmin-companies-employee-role-update": { maxAttempts: 30, windowMs: 60 * 1000 },
  "superadmin-companies-employee-restrict": { maxAttempts: 20, windowMs: 60 * 1000 },
  "superadmin-companies-settings-update": { maxAttempts: 20, windowMs: 60 * 60 * 1000 },
  "superadmin-companies-theme-update": { maxAttempts: 20, windowMs: 60 * 60 * 1000 },
  "superadmin-companies-impersonation-start": { maxAttempts: 10, windowMs: 60 * 60 * 1000 },
  "superadmin-companies-impersonation-status": { maxAttempts: 120, windowMs: 60 * 1000 },
  "superadmin-companies-impersonation-end": { maxAttempts: 60, windowMs: 60 * 1000 },
  "superadmin-companies-restrict": { maxAttempts: 10, windowMs: 60 * 1000 },

  // Superadmin settings endpoints.
  "superadmin-settings-profile-read": { maxAttempts: 120, windowMs: 60 * 1000 },
  "superadmin-settings-profile-update": { maxAttempts: 20, windowMs: 60 * 60 * 1000 },
  "superadmin-settings-change-password": { maxAttempts: 5, windowMs: 15 * 60 * 1000 },
  "superadmin-settings-security-read": { maxAttempts: 60, windowMs: 60 * 1000 },
  "superadmin-settings-security-update": { maxAttempts: 20, windowMs: 60 * 60 * 1000 },
  "superadmin-settings-2fa-setup": { maxAttempts: 10, windowMs: 60 * 60 * 1000 },
  "superadmin-settings-2fa-enable": { maxAttempts: 10, windowMs: 60 * 60 * 1000 },
  "superadmin-settings-2fa-disable": { maxAttempts: 10, windowMs: 60 * 60 * 1000 },
  "superadmin-settings-login-history-read": { maxAttempts: 60, windowMs: 60 * 1000 },
  "superadmin-settings-login-history-export": { maxAttempts: 5, windowMs: 60 * 60 * 1000 },
  "superadmin-settings-active-sessions-read": { maxAttempts: 60, windowMs: 60 * 1000 },
  "superadmin-settings-session-revoke": { maxAttempts: 30, windowMs: 60 * 1000 },
  "superadmin-settings-session-revoke-all": { maxAttempts: 10, windowMs: 60 * 60 * 1000 },
  "superadmin-settings-notifications-read": { maxAttempts: 120, windowMs: 60 * 1000 },
  "superadmin-settings-notifications-update": { maxAttempts: 20, windowMs: 60 * 60 * 1000 },
  "superadmin-settings-payment-channels-read": { maxAttempts: 60, windowMs: 60 * 1000 },
  "superadmin-settings-payment-channels-create": { maxAttempts: 20, windowMs: 60 * 60 * 1000 },
  "superadmin-settings-payment-channels-update": { maxAttempts: 20, windowMs: 60 * 60 * 1000 },
  "superadmin-settings-payment-channels-delete": { maxAttempts: 20, windowMs: 60 * 60 * 1000 },
  "superadmin-settings-payment-channels-set-default": { maxAttempts: 30, windowMs: 60 * 60 * 1000 },

  // BizCard list (GET /api/bizcards/user): 60 per minute per IP
  // Authenticated read; generous for dashboard page loads and refreshes.
  "bizcards-list": { maxAttempts: 60, windowMs: 60 * 1000 },

  // BizCard detail (GET /api/bizcards/[serialId]): 60 per minute per IP
  "bizcards-detail": { maxAttempts: 60, windowMs: 60 * 1000 },

  // BizCard update (PUT /api/bizcards/[serialId]): 10 per 15 minutes per IP
  // Profile edits are intentional, rare actions; tight limit prevents
  // scripted enumeration via the update endpoint.
  "bizcards-update": { maxAttempts: 10, windowMs: 15 * 60 * 1000 },

  // Owner services list/read in dashboard context.
  "bizcard-services-list": { maxAttempts: 120, windowMs: 60 * 1000 },

  // Service creation is a write-heavy action and should be constrained.
  "bizcard-services-create": { maxAttempts: 50, windowMs: 60 * 60 * 1000 },

  // Service updates/deletes are authenticated owner actions.
  "bizcard-services-update": { maxAttempts: 120, windowMs: 60 * 1000 },
  "bizcard-services-delete": { maxAttempts: 40, windowMs: 60 * 60 * 1000 },

  // Theme management endpoints.
  "bizcard-themes-list": { maxAttempts: 120, windowMs: 60 * 1000 },
  "bizcard-themes-write": { maxAttempts: 30, windowMs: 60 * 60 * 1000 },
  "bizcard-theme-apply": { maxAttempts: 10, windowMs: 60 * 60 * 1000 },

  // Bizcard profile write endpoints.
  "bizcard-create": { maxAttempts: 15, windowMs: 60 * 60 * 1000 },
  "bizcard-update": { maxAttempts: 120, windowMs: 60 * 60 * 1000 },

  // Public portfolio service listing endpoint.
  "public-services": { maxAttempts: 100, windowMs: 60 * 60 * 1000 },

  // Session observability endpoint for authenticated frontends.
  "session-health": { maxAttempts: 120, windowMs: 60 * 1000 },

  // Media proxied upload: 20 per 10 minutes per IP
  // Uploads are heavyweight (network + Cloudinary round-trip). A generous
  // limit for power users while still preventing upload-flood attacks.
  "media-upload": { maxAttempts: 20, windowMs: 10 * 60 * 1000 },

  // Signed upload param generation: 30 per 10 minutes per IP
  // Signing is cheap (CPU only) but issuing too many signatures would
  // let an attacker flood Cloudinary with orphaned direct uploads.
  "media-sign": { maxAttempts: 30, windowMs: 10 * 60 * 1000 },

  // Media registration (save direct-upload URL to DB): 30 per 10 min per IP
  // Should roughly match the sign limit — each sign should produce one register.
  "media-register": { maxAttempts: 30, windowMs: 10 * 60 * 1000 },

  // Bizcard gallery owner endpoints.
  "bizcard-gallery-list": { maxAttempts: 120, windowMs: 60 * 1000 },
  "bizcard-gallery-upload": { maxAttempts: 20, windowMs: 10 * 60 * 1000 },
  "bizcard-gallery-update": { maxAttempts: 120, windowMs: 60 * 1000 },
  "bizcard-gallery-delete": { maxAttempts: 40, windowMs: 60 * 60 * 1000 },
  "public-gallery": { maxAttempts: 120, windowMs: 60 * 1000 },

  // Gallery import (remote URL fetch + Cloudinary re-upload): expensive operation
  // Keep conservative to avoid bandwidth abuse.
  "media-gallery-import": { maxAttempts: 10, windowMs: 10 * 60 * 1000 },

  // Super Admin blank BizCard inventory deletes (Available Cards).
  // Dedicated bucket so list DETAIL hydration cannot block bulk deletes.
  "superadmin-bizcard-delete": { maxAttempts: 300, windowMs: 60 * 1000 },

  // General API: 100 requests per minute per IP
  "general": { maxAttempts: 100, windowMs: 60 * 1000 },

  // Health diagnostics endpoint: 10 requests/minute per IP
  "health": { maxAttempts: 10, windowMs: 60 * 1000 },

  // ── Affiliate dashboard endpoints ──────────────────────────
  // Summary/overview: 30/min — expensive aggregates, keep tight
  "affiliate-dashboard": { maxAttempts: 30, windowMs: 60 * 1000 },

  // Referrals client list: 30/min — paginated but DB-heavy
  "affiliate-referrals": { maxAttempts: 30, windowMs: 60 * 1000 },

  // Earnings breakdown: 30/min — grouped aggregates
  "affiliate-earnings": { maxAttempts: 30, windowMs: 60 * 1000 },

  // Conversion funnel: 30/min — multi-join aggregate
  "affiliate-funnel": { maxAttempts: 30, windowMs: 60 * 1000 },

  // Withdraw balance: 60/min — lightweight balance read
  "affiliate-balance": { maxAttempts: 60, windowMs: 60 * 1000 },

  // Recent activities feed: 60/min — paginated read with live data
  "affiliate-activities": { maxAttempts: 60, windowMs: 60 * 1000 },

  // Withdrawal POST: 5 per hour — financial write, must be very tight
  "affiliate-withdraw": { maxAttempts: 5, windowMs: 60 * 60 * 1000 },

  // Link performance: 30/min — aggregate per-link stats
  "affiliate-links": { maxAttempts: 30, windowMs: 60 * 1000 },

  // Public referral code validation: 60/min
  "affiliate-validate": { maxAttempts: 60, windowMs: 60 * 1000 },

  // ── Connections dashboard endpoints ──────────────────────
  "connections-summary": { maxAttempts: 60, windowMs: 60 * 1000 },
  "connections-list": { maxAttempts: 60, windowMs: 60 * 1000 },
  "connections-requests-received": { maxAttempts: 60, windowMs: 60 * 1000 },
  "connections-requests-sent": { maxAttempts: 60, windowMs: 60 * 1000 },
  "connections-suggestions": { maxAttempts: 30, windowMs: 60 * 1000 },
  "connections-send": { maxAttempts: 50, windowMs: 24 * 60 * 60 * 1000 },
  "connections-respond": { maxAttempts: 100, windowMs: 24 * 60 * 60 * 1000 },
  "connections-request-send": { maxAttempts: 50, windowMs: 24 * 60 * 60 * 1000 },
  "connections-request-respond": { maxAttempts: 100, windowMs: 24 * 60 * 60 * 1000 },
  "connections-remove": { maxAttempts: 50, windowMs: 24 * 60 * 60 * 1000 },
  "connections-block": { maxAttempts: 50, windowMs: 24 * 60 * 60 * 1000 },
  "connections-filter-options": { maxAttempts: 30, windowMs: 60 * 1000 },
  "connections-tags": { maxAttempts: 60, windowMs: 60 * 1000 },
  "connections-online-status": { maxAttempts: 60, windowMs: 60 * 1000 },

  // ── E-Marketplace endpoints ────────────────────────────────
  // Product listing (public): generous limit for browsing/search
  "marketplace-products-list":    { maxAttempts: 120, windowMs: 60 * 1000 },
  // Product detail (public): same as list
  "marketplace-product-detail":   { maxAttempts: 120, windowMs: 60 * 1000 },
  // Template listing: slightly tighter due to ownership check queries
  "marketplace-templates-list":   { maxAttempts: 120, windowMs: 60 * 1000 },
  // Template detail: includes is_owned query
  "marketplace-template-detail":  { maxAttempts: 120, windowMs: 60 * 1000 },
  // Template download: file access with DB increment — tighter
  "marketplace-template-download":{ maxAttempts: 30, windowMs: 60 * 1000 },
  // Subscription plans (public): rarely changes, generous
  "marketplace-plans-list":       { maxAttempts: 60, windowMs: 60 * 1000 },
  // User subscription detail: authenticated read
  "marketplace-user-subscription":{ maxAttempts: 60, windowMs: 60 * 1000 },
  // Subscription upgrade: financial write, very tight
  "marketplace-sub-upgrade":      { maxAttempts: 10, windowMs: 60 * 60 * 1000 },
  // Subscription downgrade: financial write, tight
  "marketplace-sub-downgrade":    { maxAttempts: 10, windowMs: 60 * 60 * 1000 },
  // Subscription cancel: destructive financial action
  "marketplace-sub-cancel":       { maxAttempts: 5, windowMs: 60 * 60 * 1000 },
  // Promotions list (public)
  "marketplace-promotions-list":  { maxAttempts: 120, windowMs: 60 * 1000 },
  // Promotion detail (public)
  "marketplace-promotion-detail": { maxAttempts: 120, windowMs: 60 * 1000 },
  // Promo validation (pre-checkout): 60/min
  "marketplace-promo-validate":   { maxAttempts: 60, windowMs: 60 * 1000 },
  // Cart view: fast read
  "marketplace-cart-view":        { maxAttempts: 120, windowMs: 60 * 1000 },
  // Cart add: write, moderate limit
  "marketplace-cart-add":         { maxAttempts: 60, windowMs: 60 * 1000 },
  // Cart update: write, moderate limit
  "marketplace-cart-update":      { maxAttempts: 60, windowMs: 60 * 1000 },
  // Cart remove: write, moderate limit
  "marketplace-cart-remove":      { maxAttempts: 60, windowMs: 60 * 1000 },
  // Checkout: high-value write — tight to prevent duplicate orders
  "marketplace-checkout":         { maxAttempts: 10, windowMs: 60 * 1000 },
  // Xendit invoice creation: financial write endpoint
  "marketplace-checkout-create-invoice": { maxAttempts: 10, windowMs: 60 * 1000 },
  // Order status polling endpoint
  "marketplace-order-status": { maxAttempts: 60, windowMs: 60 * 1000 },
  // Purchase history: authenticated read
  "marketplace-purchases-list":   { maxAttempts: 60, windowMs: 60 * 1000 },
  // Custom theme design requests (creates support tickets)
  "marketplace-custom-theme-request": { maxAttempts: 8, windowMs: 60 * 60 * 1000 },
  "dev-custom-theme-requests-list": { maxAttempts: 60, windowMs: 60 * 1000 },
  "dev-custom-theme-requests-detail": { maxAttempts: 120, windowMs: 60 * 1000 },
  "dev-custom-theme-requests-update": { maxAttempts: 60, windowMs: 60 * 1000 },
  // Admin analytics: expensive aggregate queries
  "marketplace-admin-analytics":  { maxAttempts: 30, windowMs: 60 * 1000 },
  // Xendit webhook endpoint can receive retries/bursts
  "xendit-webhook": { maxAttempts: 1000, windowMs: 60 * 1000 },

  // ── User Bizcards management endpoints ─────────────────────
  "user-bizcards-search": { maxAttempts: 30, windowMs: 60 * 1000 },
  "user-bizcards-detail": { maxAttempts: 60, windowMs: 60 * 1000 },
  "user-bizcards-create": { maxAttempts: 10, windowMs: 60 * 1000 },
  "user-bizcards-update": { maxAttempts: 30, windowMs: 60 * 1000 },
  "user-bizcards-delete": { maxAttempts: 10, windowMs: 60 * 1000 },
  "user-bizcards-reactivate": { maxAttempts: 15, windowMs: 60 * 1000 },
  "user-bizcards-subscription-limits": { maxAttempts: 60, windowMs: 60 * 1000 },
  "user-bizcards-upgrade-needed": { maxAttempts: 60, windowMs: 60 * 1000 },

  // ── Staff Marketing Dashboard endpoints ─────────────────────
  // Dashboard summary: 30 per minute — aggregated data from multiple tables
  "staff-marketing-dashboard": { maxAttempts: 30, windowMs: 60 * 1000 },
  // Get assigned clients list: 60 per minute — paginated read with search
  "staff-marketing-clients": { maxAttempts: 60, windowMs: 60 * 1000 },
  // Update assigned client: 30 per minute — staff member can modify client info
  "staff-marketing-client-update": { maxAttempts: 30, windowMs: 60 * 1000 },
  // Unassign/drop assigned client: 30 per minute — moderate limit for destructive action
  "staff-marketing-client-unassign": { maxAttempts: 30, windowMs: 60 * 1000 },
  // Get client inquiries: 60 per minute — frequent dashboard access
  "staff-marketing-inquiries": { maxAttempts: 60, windowMs: 60 * 1000 },
  // Get client orders: 60 per minute — dashboard monitoring
  "staff-marketing-orders": { maxAttempts: 60, windowMs: 60 * 1000 },
  // Get messaging clients: 120 per minute — real-time messaging support
  "staff-marketing-messaging-clients": { maxAttempts: 120, windowMs: 60 * 1000 },
  // Mark inquiry as read: 60 per minute — frequent state updates
  "staff-marketing-mark-read": { maxAttempts: 60, windowMs: 60 * 1000 },
  // Reply to inquiry: 30 per minute — write action, moderate limit
  "staff-marketing-reply": { maxAttempts: 30, windowMs: 60 * 1000 },
  // Export clients report: 5 per hour — expensive CSV generation
  "staff-marketing-export": { maxAttempts: 5, windowMs: 60 * 60 * 1000 },

  "support-message-send": { maxAttempts: 30, windowMs: 60 * 1000 },
  "support-escalate": { maxAttempts: 10, windowMs: 60 * 1000 },
  "support-resolve": { maxAttempts: 20, windowMs: 60 * 1000 },
  "support-read": { maxAttempts: 120, windowMs: 60 * 1000 },

  "messaging-send": { maxAttempts: 60, windowMs: 60 * 1000 },
  "messaging-read": { maxAttempts: 180, windowMs: 60 * 1000 },

  "product-inquiry": { maxAttempts: 5, windowMs: 15 * 60 * 1000 },
};

/**
 * Check if an IP is rate-limited for a given action.
 * Uses sliding window counter stored in memory.
 *
 * @returns Object with `allowed` (boolean) and `retryAfterMs` (number)
 */
export function checkRateLimit(
  action: string,
  identifier: string
): { allowed: boolean; retryAfterMs: number; remaining: number } {
  const config = RATE_LIMITS[action] ?? RATE_LIMITS["general"];
  const key = `${action}:${identifier}`;
  const now = Date.now();

  const entry = rateLimitStore.get(key);

  // No previous record or window expired — allow
  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + config.windowMs });
    return { allowed: true, retryAfterMs: 0, remaining: config.maxAttempts - 1 };
  }

  // Window still active
  if (entry.count >= config.maxAttempts) {
    return {
      allowed: false,
      retryAfterMs: entry.resetAt - now,
      remaining: 0,
    };
  }

  entry.count++;
  return {
    allowed: true,
    retryAfterMs: 0,
    remaining: config.maxAttempts - entry.count,
  };
}

// Periodically clean up expired entries to prevent memory leaks
// Runs every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now > entry.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000).unref(); // .unref() prevents the timer from keeping the process alive

// ──────────────────────────────────────────
// DB-Backed Account Lockout (Progressive)
// ──────────────────────────────────────────
// Progressive lockout policy:
//   - 5 failures  → locked for 1 minute
//   - 10 failures → locked for 5 minutes
//   - 15 failures → locked for 15 minutes
//   - 20 failures → locked for 30 minutes
//   - 25+ failures → locked for 1 hour
//
// WHY progressive? A legitimate user might fail a few times.
// An attacker will hit the exponential wall quickly.

const LOCKOUT_THRESHOLDS = [
  { attempts: 5,  lockMinutes: 1 },
  { attempts: 10, lockMinutes: 5 },
  { attempts: 15, lockMinutes: 15 },
  { attempts: 20, lockMinutes: 30 },
  { attempts: 25, lockMinutes: 60 },
];

/**
 * Check if an account (by email) is currently locked out.
 *
 * @returns Object with lockout status and time remaining
 */
export async function checkAccountLockout(
  email: string
): Promise<{ locked: boolean; retryAfterMs: number; failedAttempts: number }> {
  const normalizedEmail = email.toLowerCase().trim();

  try {
    const lockout = await prismaAnalytics.accountLockout.findUnique({
      where: { email: normalizedEmail },
    });

    if (!lockout) {
      return { locked: false, retryAfterMs: 0, failedAttempts: 0 };
    }

    // Check if currently locked
    if (lockout.locked_until && lockout.locked_until > new Date()) {
      const retryAfterMs = lockout.locked_until.getTime() - Date.now();
      return {
        locked: true,
        retryAfterMs,
        failedAttempts: lockout.failed_attempts,
      };
    }

    return {
      locked: false,
      retryAfterMs: 0,
      failedAttempts: lockout.failed_attempts,
    };
  } catch (error) {
    // Analytics engine/DB outage must not block login.
    console.error("[rate-limit] checkAccountLockout failed:", error);
    return { locked: false, retryAfterMs: 0, failedAttempts: 0 };
  }
}

/**
 * Record a failed login attempt and apply progressive lockout if threshold is met.
 */
export async function recordFailedAttempt(email: string, ip: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();

  try {
    // Upsert the lockout record
    const lockout = await prismaAnalytics.accountLockout.upsert({
      where: { email: normalizedEmail },
      create: {
        email: normalizedEmail,
        failed_attempts: 1,
        last_attempt_at: new Date(),
      },
      update: {
        failed_attempts: { increment: 1 },
        last_attempt_at: new Date(),
      },
    });

    if (!lockout) return;

    // Determine if we need to lock
    const attempts = lockout.failed_attempts;
    let lockMinutes = 0;

    for (const threshold of LOCKOUT_THRESHOLDS) {
      if (attempts >= threshold.attempts) {
        lockMinutes = threshold.lockMinutes;
      }
    }

    if (lockMinutes > 0) {
      const lockedUntil = new Date(Date.now() + lockMinutes * 60 * 1000);
      await prismaAnalytics.accountLockout.update({
        where: { email: normalizedEmail },
        data: { locked_until: lockedUntil },
      });
    }

    // Also record in LoginAttempt table for audit trail
    await prismaAnalytics.loginAttempt.create({
      data: {
        email: normalizedEmail,
        ip_address: ip.substring(0, 45),
        success: false,
      },
    });
  } catch (error) {
    console.error("[rate-limit] recordFailedAttempt failed:", error);
  }
}

/**
 * Record a successful login — resets the failed attempt counter.
 */
export async function recordSuccessfulLogin(email: string, ip: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();

  try {
    // Reset lockout
    await prismaAnalytics.accountLockout.upsert({
      where: { email: normalizedEmail },
      create: {
        email: normalizedEmail,
        failed_attempts: 0,
      },
      update: {
        failed_attempts: 0,
        locked_until: null,
      },
    });

    // Record success for audit trail
    await prismaAnalytics.loginAttempt.create({
      data: {
        email: normalizedEmail,
        ip_address: ip.substring(0, 45),
        success: true,
      },
    });
  } catch (error) {
    console.error("[rate-limit] recordSuccessfulLogin failed:", error);
  }
}