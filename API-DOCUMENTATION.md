# API Documentation — New ONTAP Authentication Backend

> **Base URL (Production):** `https://your-vercel-domain.vercel.app`
>
> **Base URL (Development):** `http://localhost:3000`

---
## Table of Contents
1. [Overview](#overview)
2. [Authentication Model](#authentication-model)
3. [CORS & Cross-Origin Setup](#cors--cross-origin-setup)
4. [Error Response Format](#error-response-format)
5. [Rate Limiting](#rate-limiting)
6. [API Endpoints](#api-endpoints)
  - [Login](#1-login)
  - [Register](#2-register)
  - [Get Session](#3-get-session)
  - [Logout](#4-logout)
  - [Refresh Session](#5-refresh-session)
  - [Forgot Password](#6-forgot-password)
  - [Verify Code](#7-verify-code)  
  - [Reset Password](#8-reset-password)
  - [Cron Cleanup](#9-cron-cleanup-internal)
  - [Verify Email Code](#10-verify-email-code)
  - [Resend Verification Code](#11-resend-verification-code)
  - [Report Client Error](#12-report-client-error-monitoring)
  - [Employee Card Scan](#13-employee-card-scan)
  - [Employee Card Assign (Bulk)](#14-employee-card-assign-bulk)
  - [vCard Setup](#15-vcard-setup)
  - [Get Own vCard Profile](#16-get-own-vcard-profile)
  - [Update vCard Profile](#17-update-vcard-profile)
  - [Public vCard Profile](#18-public-vcard-profile)
  - [Deployment Health Check](#19-deployment-health-check)
  - [Track Portfolio View](#20-track-portfolio-view)
  - [Record Contact Save](#21-record-contact-save)
  - [Send Connection Request](#22-send-connection-request)
  - [Submit Visitor Inquiry](#23-submit-visitor-inquiry)
  - [Portfolio Analytics](#24-portfolio-analytics)
  - [Dashboard Overview](#25-dashboard-overview)
  - [Activity Feed](#26-activity-feed)
  - [Profile Views List (Who Viewed Your Profile)](#profile-views-list-who-viewed-your-profile)
  - [vCard Completion Score](#27-vcard-completion-score)
  - [Create Company](#28-create-company)
  - [List User BizCards](#29-list-user-bizcards)
  - [BizCard Detail](#30-bizcard-detail)
  - [Edit BizCard](#31-edit-bizcard)
  - [Upload Media (Proxied)](#32-upload-media-proxied)
  - [Request Signed Upload Params](#33-request-signed-upload-params)
  - [Register Direct Upload](#34-register-direct-upload)
  - [Import Gallery Media (Hostinger to Cloudinary)](#34a-import-gallery-media-hostinger-to-cloudinary)
  - [Portfolio URI Resolver (Serial-First)](#35-portfolio-uri-resolver-serial-first)
  - [Dashboard Analytics Metrics](#36-dashboard-analytics-metrics)
  - [Download vCard (VCF)](#37-download-vcard-vcf)
  - [Inquiry Inbox](#38-inquiry-inbox)
  - [Inquiry Detail, Status Update, Delete](#39-inquiry-detail-status-update-delete)
  - [Session Health](#40-session-health)
  - [Public Portfolio Services](#41-public-portfolio-services)
  - [BizCard Services (List/Create)](#42-bizcard-services-listcreate)
  - [BizCard Service Item (Update/Delete)](#43-bizcard-service-item-updatedelete)
  - [BizCard Themes (List/Create)](#44-bizcard-themes-listcreate)
  - [BizCard Theme Item](#45-bizcard-theme-item)
  - [Apply User Theme](#46-apply-user-theme)
  - [Owner Analytics Dashboard](#47-owner-analytics-dashboard)
  - [Affiliate Dashboard Summary](#48-affiliate-dashboard-summary)
  - [Affiliate Referral Clients](#49-affiliate-referral-clients)
  - [Affiliate Earnings Breakdown](#50-affiliate-earnings-breakdown)
  - [Affiliate Conversion Funnel](#51-affiliate-conversion-funnel)
  - [Affiliate Withdraw Balance](#52-affiliate-withdraw-balance)
  - [Affiliate Recent Activities](#53-affiliate-recent-activities)
  - [Affiliate Withdrawal Request](#54-affiliate-withdrawal-request)
  - [Affiliate Links Performance](#55-affiliate-links-performance)
  - [E-Marketplace APIs](#56-e-marketplace-apis)
  - [Company Management APIs](#57-company-management-apis)
  - [SuperAdmin Company Management API](#57b-superadmin-company-management-api)
  - [Client Management API (SuperAdmin)](#58-client-management-api-superadmin)
  - [Affiliate Management API (SuperAdmin)](#59-affiliate-management-api-superadmin)
  - [Order Management API (SuperAdmin)](#60-order-management-api-superadmin)
  - [SuperAdmin Dashboard API](#61-superadmin-dashboard-api)
  - [Staff Management API (SuperAdmin)](#62-staff-management-api-superadmin)
  - [Staff Marketing - Client Assignment API](#staff-marketing---client-assignment-api)
  - [Customer Support Messenger API](#customer-support-messenger-api)
  - [SuperAdmin Notifications API](#superadmin-notifications-api)
  - [SuperAdmin BizCard Management API](#superadmin-bizcard-management-api)
  - [Bizcard Management API (SuperAdmin)](#64-bizcard-management-api-superadmin)
  - [Admin Authentication API](#63-admin-authentication-api)
  - [Notification System — User Module](#notification-system--user-module)

---

## Affiliate System: Commission & Referral Notes

1. ShopCommission model

- New table: `ShopCommission` stores computed commission rows for `ShopOrder` entities. Each commission row is idempotent per order+affiliate (unique constraint `uq_shop_commission_order_affiliate`). Fields include: `shop_commission_id`, `shop_order_id`, `affiliate_user_id`, `referred_user_id`, `affiliate_code`, `commission_rate`, `discount_amount`, `commission_amount`, `commission_type`, `status`, `metadata`.

2. Checkout snapshotting

- During checkout we snapshot affiliate metadata into `CheckoutSession.line_items` so webhook processing can create `ShopCommission` and `Referral` records without requiring additional request state. The snapshot includes `affiliate_user_id`, `affiliate_code`, `commission_rate`, `discount_percent`, and `discount_amount`.

3. Automatic affiliate enrollment

- New user registration attempts to create affiliate settings and assign an `affiliate_code` asynchronously so users get a referral link immediately after registering. This is best-effort and non-blocking for the registration flow.

4. Backfill script

- `scripts/backfill-affiliates.js` will generate unique 12-character affiliate codes and create `AffiliateSettings` (commission_rate default 5.0) for users missing `affiliate_code`. Run it with:

```
npm run backfill:affiliates
```

5. Commission creation and idempotency

- The webhook that converts invoices to `ShopOrder` now attempts to create a `ShopCommission` record using the snapshot. If the row already exists (unique constraint), the error is logged and processing continues — ensuring idempotent commission recording.

6. Referral & Self-Referral

- Self-referrals are prevented: the checkout flow ignores affiliate codes that belong to the purchasing user and referral record creation also guards against affiliate_user_id === referred_user_id.


---
## Frontend Integration Notes (Subscription and Theme)

### Canonical Frontend Subscription Source

- Primary endpoint: `GET /api/user/access-status`
- Fallback endpoint (when needed for details): `GET /api/user/subscription`
- Exclusive free-trial Premium offer: `GET|POST /api/user/premium-experience-offer`

Expected frontend access fields:

```json
{
  "hasAccess": true,
  "reason": "free_trial",
  "expiresAt": "2026-06-03T12:00:00.000Z",
  "daysRemaining": 2,
  "highestTier": "premium",
  "premiumBoostActive": true,
  "premiumBoostUntil": "2026-06-17T12:00:00.000Z",
  "premiumBoostSource": "exclusive_2w"
}
```

`reason` values:

| Value | Meaning |
|-------|---------|
| `free_trial` | Active user-level free trial |
| `active_subscription` | Active paid (or bizcard-level) subscription |
| `trial_expired` | User free trial ended, no active paid access |
| `subscription_expired` | Paid subscription ended (trial not the cause) |
| `none` | Never had trial or subscription |

Legacy `expired` may still appear briefly; infer trial vs subscription from the `expiration` block or `free_trial` / `bizcard_subscription` sub-objects.

`GET /api/user/access-status` also returns an `expiration` block:

```json
{
  "expiration": {
    "kind": "free_trial",
    "expired": true,
    "expires_at": "2026-06-03T12:00:00.000Z",
    "days_remaining": 0
  }
}
```

`GET /api/user/subscription` adds aligned classification fields:

```json
{
  "access_reason": "trial_expired",
  "trial_expired": true,
  "subscription_expired": false,
  "expiration_kind": "free_trial"
}
```

### Redirect Contract for Expired Access

When a paid subscription has expired, frontend routes the user to:

- `/user/emarket?tab=subscription&reason=expired`

When a free trial has ended, frontend routes with:

- `/user/emarket?tab=subscription&reason=trial`

When the user has no prior trial or subscription:

- `/user/emarket?tab=subscription&reason=no-access`

Login responses use the same redirect targets via `redirectUrl` when `requiresUpgrade` is true.

Marketplace tab parsing uses `tab=subscription` as the canonical deep-link trigger.

### Exclusive Premium Experience Offer (Free Trial Only)

New free-trial users (no active Basic/Standard/Premium bizcard) may receive a one-time interactive modal offering **3 days of Premium features**.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/user/premium-experience-offer` | Session | Returns eligibility + boost status. Marks offer `pending` when first shown. |
| `POST` | `/api/user/premium-experience-offer` | Session + CSRF | Body `{ "decision": "accept" \| "decline" }`. Accept grants 3-day premium overlay. |

**Eligibility rules**

- Active free trial (`is_trial_used` + `trial_end` in the future)
- No active paid bizcard (`basic` / `standard` / `premium` / `enterprise`)
- Offer not already `accepted`, `declined`, or `expired`

Users who registered directly onto Basic/Standard/Premium never see this modal.

**Accept side effects**

- `User.exclusive_premium_offer_status = accepted`
- `User.premium_feature_boost_until = now + 3 days`
- `User.premium_feature_boost_source = exclusive_2w`
- User bizcards temporarily set to `subscription_tier=premium` (prior tiers stored in `premium_feature_boost_restore_json`)

**Error tags:** `[PREMIUM_EXPERIENCE_API]` · codes `PREMIUM_OFFER_STATUS_FAILED`, `INVALID_DECISION`, `PREMIUM_OFFER_INELIGIBLE`, `PREMIUM_OFFER_RESPOND_FAILED`

**Related cron**

- `GET /api/cron/trial-upgrade-promo` — expired free-trial email (Basic/Standard → 1 month Premium)
- `GET /api/cron/premium-boost-expiry` — restore tiers when boosts end

### Premium Trial Recap (after exclusive 3-day Premium ends)

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/user/premium-trial-recap` | Session | Returns eligibility + activity summary (company, affiliates, associates, engagement). |
| `POST` | `/api/user/premium-trial-recap` | Session | Body `{ "action": "dismiss" }` — permanently dismiss recap modal. |

Shown in the user portal when: user accepted the exclusive 3-day Premium trial, that window has ended, free trial is expired, no paid bizcard exists, and recap not yet dismissed.

**Error tags:** `[PREMIUM_TRIAL_RECAP_API]`

### User Experience Survey (User Portal)

One-time modal shown after new users enter the user portal (post-registration). Collects a 1–5 experience rating, optional written feedback, and optional feature suggestions. Responses are stored per user for future SuperAdmin review.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/user/experience-survey` | Session | Returns `{ eligible, reason, status }`. Eligible when the user has not submitted or permanently dismissed the survey. |
| `POST` | `/api/user/experience-survey` | Session + CSRF | Submit or dismiss. |

**POST body — submit**

```json
{
  "action": "submit",
  "rating": 4,
  "feedback": "Optional experience feedback",
  "feature_suggestion": "Optional feature idea"
}
```

- `rating` (required): integer `1`–`5`
- `feedback` (optional): max 2000 characters
- `feature_suggestion` (optional): max 2000 characters

**POST body — dismiss**

```json
{ "action": "dismiss" }
```

Permanently records a dismissed survey for the user so the modal is not shown on future logins.

**Eligibility (client + server)**

- Triggered after account creation when the user reaches the portal (`localStorage` pending flag set during signup completion).
- Modal opens after a short delay once the portal layout is ready.
- Not shown on auth/setup pages or during impersonation.
- Session dismiss (`sessionStorage`) prevents repeat prompts during the same browser session before the dismiss API completes.

**Error tags:** `[EXPERIENCE_SURVEY_API]` · codes `EXPERIENCE_SURVEY_STATUS_FAILED`, `EXPERIENCE_SURVEY_SAVE_FAILED`, `EXPERIENCE_SURVEY_ALREADY_SUBMITTED`, `INVALID_ACTION`, `VALIDATION_ERROR`, `RATE_LIMITED`

### Theme Apply Endpoint Contract

- Canonical endpoint: `PUT /api/vcard/design/theme`
- Compatibility fallback: `POST /api/bizcard/theme`

Frontend attempts canonical endpoint first, and falls back to compatibility endpoint only when canonical returns `404`.

### Gallery Endpoint Contract (Owner)

- Required route: `GET /api/bizcard/{bizcardId}/gallery`
- The route `/api/bizcard/gallery` is invalid and should not be used.
- Frontend should ensure a valid `bizcardId` exists before sending owner gallery requests.

### Frontend Error Tags

Frontend logs and user-facing error wrappers may include these tags:

```ts
export enum FrontendSubscriptionError {
  SUBSCRIPTION_EXPIRED = 'FE_SUB_60000',
  FREE_TRIAL_EXPIRED = 'FE_SUB_60001',
  THEME_APPLY_FAILED = 'FE_THEME_60002',
  GALLERY_SSL_ERROR = 'FE_GALLERY_60003',
  THEME_API_NOT_FOUND = 'FE_THEME_API_60004'
}
```

When available, include `requestId` from API `meta.requestId` for debugging and correlation.
7. [Registration & Email Verification Flow](#registration--email-verification-flow-step-by-step)
8. [Password Reset Flow (Step-by-Step)](#password-reset-flow-step-by-step)
9. [vCard Profile Flow](#vcard-profile-flow)
10. [Session Lifecycle & Token Rotation](#session-lifecycle--token-rotation)
11. [Cookie Reference](#cookie-reference)
12. [Frontend Integration Guide](#frontend-integration-guide)
13. [Product SQL Importer](#product-sql-importer)

---
## Performance Optimizations

### Batch Processing Strategy

List and dashboard endpoints now use batched data enrichment and grouped queries to reduce round trips and eliminate N+1 patterns.
| Endpoint | Before Pattern | After Pattern | Expected Query Reduction |
|----------|----------------|---------------|--------------------------|
| `GET /api/user/bizcards` | Base list + ad hoc aggregate counters | Base list + batch service/social counts + grouped analytics counts | ~50-75% fewer follow-up queries |
| `GET /api/connections/requests/received` | Per-row mutual count query (N+1) | Single accepted-connection batch query | O(n) to O(1) query fanout |
| `GET /api/company/employees` | Heavy list computation every request | Shared cached list payload (company+query scoped) | Significant repeat-request reduction |
| `GET /api/company/analytics/ranking` | Recomputed ranking query on each request | Shared cached ranking payload by company+period+limit | Lower repeated dashboard query cost |
| `GET /api/affiliate/dashboard/summary` | In-memory route cache only | Shared cache + parallel aggregate execution | Lower p95 and better cache reuse |
| `GET /api/public/:alias/services` | Direct DB read every request | Shared cached payload by username | Reduced repeat public profile load |
| `POST /api/marketplace/cart/checkout` | Per-item sequential writes in transaction | Batched `createMany` + grouped stock updates | Lower checkout transaction fanout |
### Caching Strategy
| Cache Type | TTL | Endpoints |
|------------|-----|-----------|
| User Bizcards | 60s | `GET /api/user/bizcards` |
| Public Profile | 60s | `GET /api/public/:alias` |
| Public Services | 300s | `GET /api/public/:alias/services` |
| Affiliate Summary | 120s | `GET /api/affiliate/dashboard/summary` |
| Company Employees | 60s | `GET /api/company/employees` |
| Company Analytics Ranking | 60s | `GET /api/company/analytics/ranking` |
| Theme Catalog | 3600s | Theme and color-way listing endpoints |
### Response Optimization
- BigInt response values are serialized safely.
- Serializer supports field selection and null/undefined omission.
- Paginated responses can be generated with consistent metadata wrappers.
### Connection Pooling
- Prisma singleton remains globalized for serverless reuse.
- DB pool URL params are now environment-aware (`production` default limit: `5`, `development` default limit: `10`).
- Pool, connect, and idle timeouts are configurable via env vars:
  - `DB_CONNECTION_LIMIT`
  - `DB_POOL_TIMEOUT`
  - `DB_CONNECT_TIMEOUT`
  - `DB_IDLE_CONNECTION_TIMEOUT`
### Benchmarking
- New script: `npm run benchmark:api`
- Script file: `scripts/performance-benchmark.ts`
- Supports optional baseline input via `PERF_BASELINE` and target host via `PERF_BASE_URL`.
- Auth benchmark modes:
  - Provide `PERF_AUTH_COOKIE` directly, or
  - Provide `PERF_LOGIN_EMAIL` + `PERF_LOGIN_PASSWORD` for auto-login cookie capture.
---
## 56. E-Marketplace APIs

All marketplace endpoints are under:

```
/api/marketplace/*
```

### Products

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| `GET` | `/api/marketplace/products` | Optional | List active merchandise with search, category, pagination. Each product `price` is the resolved display/base amount from the database (`custom_price_value` when set, otherwise `price`). |
| `GET` | `/api/marketplace/products/:id` | Optional | Merchandise detail with related items. `price` uses the same database-resolved base amount. |
| `GET` | `/api/marketplace/products/:id/quote` | Optional | Authoritative unit-price quote for merchandise options. Query: `subscriptionTier` (`basic|standard|premium`), `logoType` (`default|custom`), optional `variant`. Returns `unitPrice` and `breakdown` (`basePrice`, `subscriptionAddon`, `logoAddon`, `variantAddon`). |

### Templates

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| `GET` | `/api/marketplace/templates` | Optional | List template marketplace items with ownership flags. Authenticated cookie/session users receive `isOwned`/`canDownload` and `themePath`. Includes paid catalog themes such as BubbleGem (`theme_path=bubble-gem`, `tag=premium`, `price=99`, `category=customize-templates`). |
| `GET` | `/api/marketplace/templates/:id` | Optional | Template detail with `isOwned`/`canDownload`. |
| `GET` | `/api/marketplace/templates/download/:templateId` | Required | Validates entitlement and returns downloadable template payload. |

### Custom Theme Requests

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| `POST` | `/api/marketplace/custom-theme-request` | Required | Submit a structured custom theme brief from E-Market. Requires `referenceImageUrls` (1–8 https image URLs). Persists `CustomThemeRequest`, mirrors the brief into Support Messaging, and **escalates the conversation to Development**. |
| `GET` | `/api/dev/custom-theme-requests` | Required (`dev` / `super_admin`) | Paginated Theme Requests inbox (formerly Inquiry). Query: `status`, `q`, `page`, `pageSize`. |
| `GET` | `/api/dev/custom-theme-requests/:id` | Required (`dev` / `super_admin`) | Full request detail; first open marks `pending` → `reviewing`. |
| `PATCH` | `/api/dev/custom-theme-requests/:id` | Required (`dev` / `super_admin`) + CSRF | Update `status`, `staffNotes`, and/or `assignToSelf`. |

##### `POST /api/marketplace/custom-theme-request`

**Required fields:** `projectName`, `themeStyles` (≥1), `mood`, `typography.headingStyle`, `typography.bodyStyle`, `moreDetails` (≥20 chars), `contactPreference`, `referenceImageUrls` (≥1 https URL).

**Optional:** audience/project fields, color way, layout/sections, brand personality, brand assets, deliverable scope, inspiration URLs, avoid/competitor notes. Removed from the product UI (still accepted if sent): imagery style, shape language, motion preference, device priority, accessibility notes, budget range, timeline.

**Error codes / tags:**
- `THEME_REQUEST_RATE_LIMITED` · `[THEME_REQUEST_API]`
- `THEME_REQUEST_UNAUTHORIZED` · `[THEME_REQUEST_API]`
- `THEME_REQUEST_INVALID_JSON` · `[THEME_REQUEST_API]`
- `THEME_REQUEST_VALIDATION_FAILED` · `[THEME_REQUEST_API]`
- `THEME_REQUEST_CREATE_FAILED` · `[THEME_REQUEST_API]`

**Example request body:**

```json
{
  "projectName": "Acme Studio",
  "themeStyles": ["minimal", "corporate"],
  "mood": "light",
  "colorWay": {
    "primary": "#1e3a8a",
    "secondary": null,
    "accent": "#0ea5e9",
    "background": "#f8fafc",
    "notes": null
  },
  "typography": {
    "headingStyle": "Modern sans (clean, geometric)",
    "bodyStyle": "Highly readable sans",
    "tone": "Friendly",
    "preferredFonts": null,
    "notes": null
  },
  "primaryGoals": [],
  "layoutPreferences": [],
  "mustHaveSections": [],
  "brandPersonality": [],
  "referenceImageUrls": ["https://cdn.example.com/theme-ref-1.png"],
  "moreDetails": "I want a clean light portfolio with strong CTA focus on booking calls.",
  "contactPreference": "support_chat"
}
```

**Example success response (`201`):**

```json
{
  "success": true,
  "data": {
    "request": { "id": "12", "referenceNumber": "CTR-20260907-AB12C", "status": "pending" },
    "conversationId": "45",
    "escalated": true,
    "summary": {
      "projectName": "Acme Studio",
      "themeStyles": ["minimal", "corporate"],
      "mood": "light",
      "referenceNumber": "CTR-20260907-AB12C",
      "referenceImageCount": 1
    }
  },
  "message": "Your custom theme request was submitted and escalated to our design team. A developer will follow up in Support Chat."
}
```

Dev portal UI: `/dev/inquiry` is labeled **Theme Requests**. Devs message the requester via the linked escalated support conversation (`GET/POST /api/superadmin/support/conversations/:id/messages`).

### Subscription Plans

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| `GET` | `/api/marketplace/subscriptions/plans` | Optional | List active plans and current user subscription (if logged in). |
| `GET` | `/api/marketplace/user/subscription` | Required | Current subscription state and recent subscription logs. |
| `POST` | `/api/marketplace/subscription/upgrade` | Required | Create or upgrade subscription with optional proration/payment intent. |
| `POST` | `/api/marketplace/subscriptions/upgrade` | Required | Upgrade subscription using Xendit-linked payment method reference. |
| `POST` | `/api/marketplace/subscription/downgrade` | Required | Schedule downgrade at period end. |
| `POST` | `/api/marketplace/subscription/cancel` | Required | Cancel auto-renew at period end and store cancellation feedback. |

### Promotions

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| `GET` | `/api/marketplace/promotions` | Optional | List active promotions and usage info for current user (if logged in). |
| `GET` | `/api/marketplace/promotions/:id` | Optional | Promotion detail and per-user eligibility diagnostics. |
| `POST` | `/api/marketplace/promotions/validate` | Required | Validate a promo code against subtotal and usage limits. |

### Cart & Checkout

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| `GET` | `/api/marketplace/cart` | Required | List cart items with resolved names/prices and availability flags. |
| `POST` | `/api/marketplace/cart/add` | Required | Add or increment cart item (`merchandise` or `template`). For `itemType=template`, requires an active paid plan (`basic`/`standard`/`premium`); Free Trial receives `403 TEMPLATE_SUBSCRIPTION_REQUIRED`. Template price is resolved from `Theme.price`; quantity is fixed to 1. |
| `PUT` | `/api/marketplace/cart/update/:itemId` | Required | Update quantity/custom metadata on a cart item. |
| `DELETE` | `/api/marketplace/cart/remove/:itemId` | Required | Remove a cart item. |
| `POST` | `/api/marketplace/cart/checkout` | Required | Create order, order items, purchase logs, template grants, and optional payment intent. |
| `POST` | `/api/marketplace/checkout` | Required | E-Market checkout used by `CheckoutTab`; creates `ShopOrder` and Xendit invoice. Accepts optional `referral_code` (first order only — user must have zero `ShopOrder` rows). Affiliate discount is combined with promo/voucher discount before `calculatePriceBreakdown`. |
| `POST` | `/api/marketplace/checkout/create-invoice` | Required | Recalculate cart server-side and create a Xendit invoice for checkout. |

### Xendit payment redirect URLs

After payment on Xendit Checkout/Invoice, the payer is redirected back to the app using **absolute** URLs (required — relative paths resolve on `checkout-staging.xendit.co` and 404).

| Flow | Success redirect | Failure redirect | Status polling |
| ---- | ---------------- | ---------------- | -------------- |
| `POST /api/marketplace/checkout` | `/payment/success?order={orderNumber}` | `/payment/failure?order={orderNumber}` | `GET /api/marketplace/orders/:orderId/status` |
| `POST /api/marketplace/cart/checkout` | `/payment/success?session_id={uuid}` | `/payment/failure?session_id={uuid}` | `GET /api/marketplace/checkout/session/:sessionId` |

After payment is confirmed, `/payment/success` redirects the user to `/user/orders/{orderNumber}?from=payment` (order receipt with PDF/image download). The receipt page auto-redirects to `/user/orders` after 10 seconds unless the user clicks **Back to Orders** sooner.

Base URL resolution (`lib/utils/app-base-url.ts`): `NEXT_PUBLIC_APP_URL` → `APP_URL` → `FRONTEND_URL` → `x-forwarded-proto` + (`x-forwarded-host` or `host`) → request origin. Invalid hosts such as `0.0.0.0` are rejected in production. Company invite/resend routes pass the full incoming request (including proxy headers) into this resolver. Set `NEXT_PUBLIC_APP_URL=https://your-production-domain` on Hostinger at **build and runtime** (e.g. `https://darkgreen-kudu-889297.hostingersite.com`).

Legacy aliases `/order/success` and `/order/failed` redirect to the `/payment/*` pages.

## Cart API

All endpoints under `/api/cart` require an authenticated user session. The backend resolves the current user from the session cookie via `resolveRequestSession()` and rejects unauthenticated requests with `401` and `CART_24000`.

### Endpoints

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| `GET` | `/api/cart` | Required | Return the current user's merchandise cart, item details, and summary totals. |
| `POST` | `/api/cart/items` | Required | Add a merchandise item or increment quantity if the same product/variant already exists. |
| `PUT` | `/api/cart/items/:itemId` | Required | Update a cart item's quantity. |
| `DELETE` | `/api/cart/items/:itemId` | Required | Remove one cart item. |
| `DELETE` | `/api/cart/items` | Required | Batch delete by item IDs. |
| `POST` | `/api/cart/clear` | Required | Remove all merchandise items from the current cart. |

### Response Shape

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "123",
        "productId": "1",
        "name": "Premium Bizcard - Carbon Fiber",
        "price": 1299,
        "quantity": 1,
        "image": "/images/premium-bizcard.png",
        "category": "Premium",
        "isSelected": true,
        "variant": "Carbon Black"
      }
    ],
    "summary": {
      "totalItems": 1,
      "subtotal": 1299,
      "selectedItemsCount": 1,
      "selectedSubtotal": 1299
    }
  },
  "meta": { "requestId": "...", "responseTime": 45 }
}
```

### Add Item Request

```json
{
  "productId": 1,
  "quantity": 1,
  "variant": "Carbon Black",
  "customData": null
}
```

### Error Codes

| Code | Meaning |
| ---- | ------- |
| `CART_24000` | Authentication required. |
| `CART_24001` | User not found. |
| `CART_24100` | Product not found. |
| `CART_24101` | Product out of stock. |
| `CART_24102` | Invalid quantity. |
| `CART_24200` | Cart not found. |
| `CART_24201` | Item not in cart. |
| `CART_24202` | Item already in cart. |
| `CART_24203` | Cart is empty. |
| `CART_24300` | Email send failed. |
| `CART_24400` | Rate limit exceeded. |

### Rate Limits

| Endpoint | Limit | Window |
| -------- | ----- | ------ |
| `GET /api/cart` | 60 | 1 minute |
| `POST /api/cart/items` | 30 | 1 minute |
| `PUT /api/cart/items/:itemId` | 60 | 1 minute |
| `DELETE /api/cart/items/:itemId` | 30 | 1 minute |
| `DELETE /api/cart/items` | 30 | 1 minute |
| `POST /api/cart/clear` | 30 | 1 minute |
### Abandoned Cart Cron
`POST /api/cron/abandoned-cart` requires cron secret auth (`Authorization: Bearer <CRON_SECRET>` or `x-cron-secret`). It selects carts updated 3-7 days ago, excludes recent checkout activity, and sends a reminder email with a persistent login redirect link:
```text
/login?redirect=/cart
```

Use `?dryRun=true` or `CART_CRON_DRY_RUN=true` to verify selection without sending mail.
### Orders
| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| `GET` | `/api/marketplace/orders` | Required | List owned marketplace orders with pagination (`page`, `limit`, optional `status`). |
| `GET` | `/api/marketplace/orders/:orderId/status` | Required | Poll order payment state by numeric id or `order_number`. When the order is not terminal, syncs with Xendit (`getXenditInvoice`) and fulfills paid orders (cart clear, purchase grants) if the invoice is `PAID`/`SETTLED`. |
| `GET` | `/api/marketplace/orders/:orderId/receipt` | Required | Receipt JSON for an owned order (line items, totals, customer, business). |
| `GET` | `/api/marketplace/orders/:orderId/receipt/pdf` | Required | Downloadable PDF receipt (`Content-Disposition: attachment`). |
| `GET` | `/api/feedback/:uuid` | Public | Load post-purchase feedback invitation (order summary + submit eligibility). |
| `POST` | `/api/feedback/:uuid` | Public | Submit one-time order feedback (`overall_rating` 1–5 required; optional product/delivery ratings, recommend, message). |
| `GET` | `/api/cron/order-feedback-requests` | Cron secret | Queue one-time feedback-request emails for completed/delivered orders. |

##### `GET /api/marketplace/orders/:orderId/status`

`:orderId` accepts either the internal numeric `ShopOrder.id` or public `order_number` (e.g. `ORD-20260622-0LQZA`).

**Reconciliation (redirect-time fulfillment):** For orders in `pending_payment` (or other non-terminal states) with a stored `xendit_invoice_id`, this endpoint calls the Xendit Invoice API before responding. If the invoice is `PAID`/`SETTLED` and the amount matches the order total, the server runs the same fulfillment path as `POST /api/xendit/webhook` (order → `completed`, cart items removed via `origin_cart_item_id`, purchase logs / template grants). This allows local/staging checkout to complete after redirect when webhooks cannot reach `localhost`. Pass `?reconcile=0` to skip the Xendit API call (read DB state only).

`reconcile_result` in the response: `unchanged` | `completed` | `already_completed` | `failed` | `pending` | `amount_mismatch` | `invoice_not_found` | `reconcile_unavailable`.

When Xendit credentials are missing or the reconcile call fails, the endpoint still returns **200** with the current database order state and `reconcile_unavailable` so payment success polling can fall back to `?reconcile=0` after repeated failures.

Success response:

```json
{
  "success": true,
  "data": {
    "order_id": "42",
    "order_number": "ORD-20260622-0LQZA",
    "status": "completed",
    "xendit_status": "PAID",
    "reconcile_result": "completed",
    "items": []
  },
  "meta": { "requestId": "...", "responseTime": 12 }
}
```

Error tags: `[MARKETPLACE_ORDER_STATUS]` — codes `MARKETPLACE_ORDER_STATUS_INVALID` (400), `MARKETPLACE_ORDER_NOT_FOUND` (404), `MARKETPLACE_ORDER_STATUS_FAILED` (500).

#### User checkout eligibility & sessions

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| `GET` | `/api/user/checkout/eligibility` | Required | `{ affiliate_eligible, has_any_order }` — affiliate input is shown only when `affiliate_eligible` is true (no prior `ShopOrder` for the user, any status). |
| `GET` | `/api/user/sessions` | Required | List active sessions for the current user; marks the caller's session with `is_current: true`. Tag: `[USER_SESSIONS_API]`. |
| `DELETE` | `/api/user/sessions/:sessionId` | Required | Revoke one session (cannot revoke current session). Codes: `USER_SESSION_NOT_FOUND`, `USER_SESSION_REVOKE_CURRENT`. |
| `POST` | `/api/user/sessions/revoke-others` | Required | Revoke all sessions except the current one. Returns `{ revoked_count }`. |

#### Service / gallery video limits

Bizcard service and gallery **video** uploads: max **30 MB**, max **15 seconds** duration (client validation). Files larger than ~4 MB use signed R2 upload (`POST /api/media/sign` → direct PUT to R2 → attach `publicUrl` on service save) to avoid server body limits on Hostinger.

##### `GET /api/marketplace/orders/:orderId/receipt`

Returns receipt payload used by `/user/orders/:orderNumber`.

##### `GET /api/marketplace/orders/:orderId/receipt/pdf`

Returns `application/pdf` attachment named `receipt-{order_number}.pdf`.

Error tags: `[MARKETPLACE_ORDER_RECEIPT]` — codes `MARKETPLACE_ORDER_RECEIPT_INVALID` (400), `MARKETPLACE_ORDER_NOT_FOUND` (404), `MARKETPLACE_ORDER_RECEIPT_FAILED` (500), `MARKETPLACE_ORDER_RECEIPT_PDF_FAILED` (500).

### Post-purchase order feedback

After a `ShopOrder` is tagged `completed` or `delivered`, cron `GET /api/cron/order-feedback-requests` creates one `OrderFeedback` row per order (unique on `order_id`), queues template `order-feedback-request` once (`email_sent_at`), and emails a public link to `/feedback/{uuid}`.

| Table | Notes |
| ----- | ----- |
| `OrderFeedback` | `uuid` (public token), `order_id`, `user_id`, `status` (`pending` / `emailed` / `submitted` / `expired`), `overall_rating`, `product_rating`, `delivery_rating`, `recommend`, `message`, `email_sent_at`, `submitted_at`, `expires_at` (30 days) |

| Method | Path | Auth | Body / notes |
| ------ | ---- | ---- | ------------ |
| `GET` | `/api/feedback/:uuid` | Public | Preview invitation + order items; rate limit `order-feedback-read`. |
| `POST` | `/api/feedback/:uuid` | Public | `{ overall_rating: 1-5, product_rating?, delivery_rating?, recommend?, message? }` — one submit; rate limit `order-feedback-submit`. |
| `GET` | `/api/cron/order-feedback-requests` | Cron secret | Optional `?dryRun=true&limit=40`. Requires `process-email-queue` to deliver. |

Migration: `prisma/migrations/20260723_add_order_feedback/migration.sql`.

### User Purchases
| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| `GET` | `/api/marketplace/user/purchases` | Required | Paginated purchase history with template download actions when available. |
### Admin & Webhooks
| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| `GET` | `/api/marketplace/admin/analytics` | Required (`admin`/`company_admin`) | Revenue, orders, subscriptions, top products/templates/promotions analytics. |
| `POST` | `/api/xendit/webhook` | Xendit callback token | Verifies `x-callback-token`, validates amount/external id, and fulfills paid orders idempotently. Primary webhook URL for E-Market checkout. |

### Xendit Webhook Security Notes

- **Webhook URL:** `https://{your-domain}/api/xendit/webhook` (register in Xendit dashboard)
- Required header: `x-callback-token` (must match `XENDIT_WEBHOOK_TOKEN` in server env)
- Invoice `external_id` on E-Market checkout equals `ShopOrder.order_number` (`ORD-...`)
- Payment confirmation: webhook payload status (`PAID`/`SETTLED`) **or** redirect-time reconciliation on `GET /api/marketplace/orders/:orderId/status` when webhooks are unavailable (e.g. local dev without a tunnel)
- Amount validation: webhook/reconcile `paid_amount`/`amount` must match stored order total; set `XENDIT_USE_MINOR_UNITS=true` only if Xendit amounts are sent in minor units (centavos)
- Duplicate safety: already-completed orders are treated as idempotent replays and not re-fulfilled
- **Local development:** use ngrok (or similar) so Xendit can POST to your machine, **or** rely on payment-success polling (reconciliation) after redirect from Xendit staging

### Common Marketplace Response Envelope

```json
{
  "success": true,
  "data": {}
}
```

Error shape:

```json
{
  "success": false,
  "error": "Human-readable message"
}
``
---
## 57. Company Management APIs
All company management endpoints are under:


```

/api/company/*

```
### Approval-First Lifecycle

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| `POST` | `/api/company/create` | Required | Submit a new company application in `pending` state. Eligibility requires an active Standard, Premium, or Enterprise bizcard subscription on the user account (no `bizcard_id` in request). |

##### `POST /api/company/create`


Create a company application. The server derives subscription tier from the user's highest eligible active bizcard.


Request body:

```json
{
  "company_name": "Acme Corp",
  "description": "Optional description",
  "logo_url": "https://example.com/logo.png"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `company_name` | Yes | Display name for the company |
| `description` | No | Short company description |
| `logo_url` | No | Public URL for company logo |

Eligibility:

- User must own at least one **active** bizcard with `subscription_tier` in `standard`, `premium`, or `enterprise` (and not expired).
- `bizcard_id` is **not** required (legacy clients may send it; it is ignored).
- `max_employees` defaults to `null` (unlimited) on create.

| `invite_emails` | No | Up to 50 valid emails stored as `pending_invite_emails` in company settings; invitations are sent after superadmin approval |

Response includes `company_id`, `status: pending`, and derived `subscription_tier`.

Error `SUBSCRIPTION_REQUIRED` (403) when the user has no qualifying subscription — includes upgrade redirect metadata.
| `GET` | `/api/company/pending-requests` | Required (`dev`/`super_admin`) | List pending company applications. |
| `POST` | `/api/company/approve` | Required (`dev`/`super_admin`) | Approve/reject pending company applications. |
| `GET` | `/api/company/my-company` | Required | Get caller company profile + effective role/permissions. |
| `POST` | `/api/company/join` | Required | Join company by `company_id` or `company_name`. Private companies require `security_code`; public companies (`is_public: true`) do not. |
| `GET` | `/api/company/search` | Required | Search active companies by name (debounced client-side). Never returns security codes. |
| `POST` | `/api/company/join-requests/approve` | Required (`admin`/`manager` + `manage_employees`) | Approve or reject a pending employee join request. |

#### Company Search and Join

##### `GET /api/company/search`

Search active companies by partial name match.

- Authentication: Required (session)
- Rate limit: `company-search` — 30 requests/minute per IP
- Query params:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | Yes | Search term (min 2, max 100 characters) |
| `limit` | number | No | Max results (1–20, default 10) |

Response example:

```json
{
  "success": true,
  "data": {
    "companies": [
      {
        "company_id": "12",
        "name": "Acme Corp",
        "is_public": false,
        "logo_url": null,
        "description": "Digital agency"
      }
    ]
  }
}
```

Security: `security_code` and `security_key` are never returned.

Error tag on failure: `[COMPANY_API] COMPANY_SEARCH_FAILED`

##### `POST /api/company/join`

Join a company using search selection or legacy exact name lookup.

Request body:

```json
{
  "company_id": "12",
  "security_code": "ABC12345"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `company_id` | One of `company_id` or `company_name` | Preferred when using search UI |
| `company_name` | One of `company_id` or `company_name` | Legacy exact-name lookup |
| `security_code` | Required for private companies | Optional when `is_public` is `true` |

Outcomes:

- `approval_required: true` → creates pending join request (`status: pending`)
- `approval_required: false` → auto-joins user as employee

On successful join (auto-join or approved request), all of the member's bizcards are updated with `company_id` and `bizcard_theme` set to the company's `company_theme` (same behavior as admin invite).

##### `POST /api/company/join-requests/approve`

Review a pending join request.

```json
{
  "request_id": "45",
  "action": "approve",
  "rejection_reason": "Optional when action is reject"
}
```

##### Company visibility (`is_public`)

- `GET /api/company/my-company` includes `is_public`
- `PUT /api/company/settings` accepts optional `is_public: boolean` (admin/manager with `edit_company`)
- Default: `false` (private — security code required to join)

##### `GET /api/company/my-company`

Returns the authenticated user's company profile, role, and permissions.

Additional profile fields:

| Field | Type | Description |
|-------|------|-------------|
| `email` | string \| null | Company contact email (column) |
| `industry` | string \| null | Industry (stored in `settings` JSON) |
| `phone` | string \| null | Phone (stored in `settings` JSON) |
| `address` | string \| null | Address (stored in `settings` JSON) |
| `pending_name_change` | string \| null | Requested name awaiting superadmin approval |
| `is_primary_admin` | boolean | Whether caller is the primary company administrator |
| `has_company` | boolean | `true` when the caller has an active company membership |
| `joined_at` | string \| null | ISO date when the caller joined the company (date-only in UI; no time required) |
| `my_permissions` | string[] | Enabled co-admin permission keys |

Response example (partial):

```json
{
  "success": true,
  "data": {
    "company_id": "12",
    "company_name": "Acme Corp",
    "description": "Digital agency",
    "email": "hello@acme.com",
    "industry": "Technology",
    "phone": "+1 555 123 4567",
    "address": "123 Main St",
    "logo_url": "https://cdn.example.com/logo.png",
    "pending_name_change": null,
    "approval_required": true,
    "is_public": false,
    "is_primary_admin": true,
    "has_company": true,
    "joined_at": "2024-03-15T00:00:00.000Z",
    "my_permissions": ["manage_employees", "edit_company"]
  }
}
```

##### `PUT /api/company/settings`

Update company profile fields and governance flags. Requires `admin` or `manager` role with `edit_company` permission (primary admin bypasses permission checks).

- Rate limit: `company-settings-update`
- **Do not** send `company_name` or a raw `settings` object — name changes use `POST /api/company/name-change/request`
- Server merges `industry`, `phone`, and `address` into existing `settings` JSON (preserves keys such as `allow_employee_invites` and `notification_policy`)

Request body (at least one field required):

```json
{
  "description": "Updated company description",
  "email": "hello@acme.com",
  "logo_url": "https://cdn.example.com/logo.png",
  "industry": "Technology",
  "phone": "+1 555 123 4567",
  "address": "123 Main St, City",
  "approval_required": true,
  "is_public": false
}
```

| Field | Storage | Validation |
|-------|---------|------------|
| `description` | `Company.description` column | Max 2000 chars; empty → `null` |
| `email` | `Company.email` column | Valid email, max 191; must be unique across companies |
| `logo_url` | `Company.logo_url` column | Must start with `http://` or `https://`, max 512 |
| `industry` | `settings.industry` | Max 100 chars |
| `phone` | `settings.phone` | Max 50 chars; digits and basic phone punctuation |
| `address` | `settings.address` | Max 500 chars |
| `approval_required` | column | Boolean |
| `is_public` | column | Boolean |

Response includes updated profile slice: `description`, `email`, `logo_url`, `industry`, `phone`, `address`, `approval_required`, `is_public`.

Audit action: `company.settings.updated`

Error codes: `COMPANY_3001` (duplicate email), `EMPLOYEE_3204` (missing permission), validation errors return `400`.

##### `POST /api/company/name-change/request`

Request a company name change. **Primary administrator only** (`is_primary_admin`). Requires superadmin approval; subject to 90-day cooldown between requests.

Request body:

```json
{
  "requested_name": "New Company Name",
  "reason": "Optional reason for the change"
}
```

On success, sets `pending_name_change` on the company until approved or rejected.

### Employee Management

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| `GET` | `/api/company/employees` | Required (`admin`/`manager`) | List company employees and pending email invitations. Active rows use `membership_status: "active"`; pending invites use `membership_status: "pending_invite"` and synthetic `employee_id` values like `invite_{invitation_id}`. |
| `POST` | `/api/company/employees/invite` | Required (`admin`/`manager` + `manage_employees`) | Send company employee email invitations. Creates `CompanyEmployeeInvitation` records, sends invitation email, and notifies existing users in-app. |
| `GET` | `/api/company/invitations/verify` | Public (token query) | Validate an invitation token and return company/email/role preview. |
| `POST` | `/api/company/invitations/accept` | Required | Accept a company invitation using the email token. Returns `redirect_path` based on assigned role. |
| `POST` | `/api/company/invitations/resend` | Required (`admin`/`manager` + `manage_employees`) | Resend (re-invite) a pending or expired company employee invitation. Refreshes token/expiry and sends a new email. |
| `DELETE` | `/api/company/invitations/:invitationId` | Required (`admin`/`manager` + `manage_employees`) | Permanently delete a pending company employee invitation. |
| `GET` | `/api/company/employees/:employeeId` | Required (`admin`/`manager`) | Employee detail, `bizcard_count`, and activity history. |
| `PUT` | `/api/company/employees/:employeeId/role` | Required (`admin`/`manager` + `manage_employees`) | Update employee role (`admin`/`manager`/`employee`/`viewer`). |
| `POST` | `/api/company/employees/:employeeId/restrict` | Required (`admin`/`manager` + `manage_employees`) | Restrict or unrestrict employee access. |
| `POST` | `/api/company/employees/:employeeId/restriction-request` | Required (`admin`/`manager` + `manage_employees`) | Submit account restriction review request with audit log + notification. |

##### `POST /api/company/employees/invite`

Send one or more company employee invitations by email or serial ID.

- Authentication: Required (`admin`/`manager` + `manage_employees`)
- Rate limit: `companyadmin-invite-employees` — 30 requests/minute per IP
- Error tag on failure: `[COMPANY_INVITE_API]`

Request body:

```json
{
  "invites": [
    { "email": "employee@example.com", "role": "employee" },
    { "serial_id": "CARD-123" }
  ]
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `invites` | Yes | Array of 1–50 items |
| `email` | Per item | Valid email address |
| `serial_id` | Per item | Bizcard serial invite (unchanged legacy path) |
| `role` | No | `admin`, `manager`, `employee`, or `viewer` (default `employee`) for email invites |

Per-invite email statuses:

| Status | Meaning |
|--------|---------|
| `pending` | Invitation email sent; invitee must accept via link |
| `already_invited` | Pending invitation already exists for this email |
| `already_connected` | User is already a company member |
| `invalid` | User belongs to another company or email is invalid |
| `failed` | Company employee limit reached |
| `email_failed` | Invitation saved but email delivery failed |

**Production invite link URL (Hostinger):** Set `NEXT_PUBLIC_APP_URL` (or `APP_URL` / `FRONTEND_URL`) to your public site origin at **build and runtime**. If unset, the API resolves the base URL from reverse-proxy headers on the incoming request (`x-forwarded-host` / `x-forwarded-proto`, then `host`). Do **not** use `NEXT_PUBLIC_API_BASE_URL` for invite links.

##### `GET /api/company/invitations/verify`

Validate an invitation token from the email acceptance link.

- Authentication: Not required
- Rate limit: `company-invite-verify` — 60 requests/minute per IP
- Query: `token` (required)

Response example:

```json
{
  "success": true,
  "data": {
    "email": "employee@example.com",
    "company_name": "Acme Corp",
    "role": "employee",
    "expires_at": "2026-07-06T12:00:00.000Z"
  }
}
```

##### `POST /api/company/invitations/accept`

Accept a pending company invitation.

- Authentication: Required (session user email must match invitation email)
- Rate limit: `company-invite-accept` — 30 requests/minute per IP

Request body:

```json
{
  "token": "plain-token-from-email-link"
}
```

Response example:

```json
{
  "success": true,
  "data": {
    "company_id": "12",
    "role": "employee",
    "redirect_path": "/user/dashboard",
    "message": "Invitation accepted successfully."
  }
}
```

Redirect paths: `admin`/`manager` → `/admin/dashboard`; `employee`/`viewer` → `/user/dashboard`.

##### `POST /api/company/invitations/resend`

Resend a company employee invitation (Re-invite). Refreshes the invitation token and expiry, then sends a new email. Use for pending or expired invitations without creating a duplicate employee entry.

- Authentication: Required (`admin`/`manager` + `manage_employees`)
- Rate limit: `company-invite-resend` — 30 requests/minute per IP
- Error tag on failure: `[COMPANY_INVITE_API]`
- Invite link base URL: resolved via `resolveAppBaseUrl(request)` using env vars (`NEXT_PUBLIC_APP_URL`, `APP_URL`, `FRONTEND_URL`) or reverse-proxy headers on the incoming request. Returns `502` with a delivery error when email cannot be sent.
- Resend cooldown: 60 seconds per invitation (`company-invite-resend-cooldown`). Returns `429` when triggered too soon.

Request body:

```json
{
  "invitation_id": "42"
}
```

Response example:

```json
{
  "success": true,
  "data": {
    "invitation_id": "42",
    "email": "employee@example.com",
    "email_sent": true,
    "expires_at": "2026-07-06T12:00:00.000Z",
    "message": "Invitation resent successfully."
  }
}
```

##### `DELETE /api/company/invitations/:invitationId`

Permanently delete a pending company employee invitation. Use from Team Members / Employee Management when cancelling an invite that was not accepted.

- Authentication: Required (`admin`/`manager` + `manage_employees`)
- Rate limit: `company-invite-cancel` — 30 requests/minute per IP
- Error tag on failure: `[COMPANY_INVITE_API]`

Response example:

```json
{
  "success": true,
  "data": {
    "invitation_id": "42",
    "email": "employee@example.com",
    "message": "Invitation deleted successfully."
  }
}
```

##### `GET /api/company/employees` — pending invite rows

When `status=all` (default), pending invitations are merged into the employee list with:

- `membership_status`: `"pending_invite"`
- `invitation_expired`: `true` when the invite link has expired (admin can use Re-invite)
- `employee_id`: `invite_{invitation_id}`
- `is_active`: `false`
- `summary`: `null`

Use `status=pending_invite` to list only pending invitations.

##### `POST /api/company/employees/:employeeId/restriction-request`

Submit a company admin request to review restricting an employee account.

- Authentication: Required (`admin`/`manager` + `manage_employees`)
- Body:

```json
{
  "message": "Repeated policy violations reported by team lead."
}
```

- Response:

```json
{
  "success": true,
  "data": {
    "success": true,
    "request_id": "uuid",
    "subject": "Account Restriction Request — Jane Doe (Acme Corp)",
    "message": "Restriction request submitted successfully."
  }
}
```

- Audit action: `employee.restriction.requested`
- Error tag: `[COMPANY_EMPLOYEE_API]`

##### `GET /api/company/employees/:employeeId` — `bizcard_count`

Employee detail responses include `employee.bizcard_count` (integer) — total bizcards owned by the employee within the company.

### Company Analytics and Inquiries

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| `GET` | `/api/company/analytics/ranking` | Required (`admin`/`manager`/`employee`) | Employee ranking snapshots from activity summary cache. |
| `GET` | `/api/company/employees/activity/summary` | Required (`admin`/`manager`/`employee`) | Company-level monthly activity totals and top employees. |
| `GET` | `/api/company/inquiries` | Required (`admin`/`manager`/`employee`) | Company-scoped inquiry inbox with pagination/filter. |
### Company Dashboard API
#### Error Codes Reference
| Code | HTTP Status | Description |
|------|-------------|-------------|
| `DASHBOARD_6000` | 401 | Unauthorized access |
| `DASHBOARD_6001` | 403 | Not a company admin |
| `DASHBOARD_6002` | 404 | Company not found |
| `DASHBOARD_6100` | 400 | Invalid date range |
| `DASHBOARD_6101` | 400 | Invalid filter type |
| `DASHBOARD_6102` | 400 | Date range too large (>90 days) |
| `DASHBOARD_6103` | 400 | Invalid timezone |
| `DASHBOARD_6200` | 500 | Analytics data unavailable |
| `DASHBOARD_6300` | 429 | Rate limit exceeded |

#### Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| `GET /api/company/dashboard/summary` | 30 | 1 minute |
| `GET /api/company/dashboard/weekly-trend` | 30 | 1 minute |
| `GET /api/company/dashboard/top-employee/today` | 60 | 1 minute |
| `GET /api/company/dashboard/time-series` | 20 | 1 minute |
| `GET /api/company/dashboard/employee-rankings` | 30 | 1 minute |

#### Endpoints

##### `GET /api/company/dashboard/summary`

Get company summary metrics and period-over-period comparisons.

- Authentication: Required (`admin`/`manager`)
- Query params:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filter` | string | No | `today`, `last_7_days`, `last_30_days`, `this_week`, `this_month`, `last_month`, `custom` |
| `start_date` | date | If `filter=custom` | Start date (`YYYY-MM-DD`) |
| `end_date` | date | If `filter=custom` | End date (`YYYY-MM-DD`) |
| `timezone` | string | No | IANA timezone (default `UTC`) |

##### `GET /api/company/dashboard/weekly-trend`

Get current-week line-chart dataset (Mon-Sun) for profile views, leads, and inquiries.

- Authentication: Required (`admin`/`manager`)
- Query params:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `timezone` | string | No | IANA timezone (default `UTC`) |

##### `GET /api/company/dashboard/top-employee/today`

Get the most-viewed company employee for the current day.

- Authentication: Required (`admin`/`manager`)
- Query params:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `timezone` | string | No | IANA timezone (default `UTC`) |

Returns `data: null` when no profile views are recorded in the current day.

##### `GET /api/company/dashboard/time-series`

Get custom-range daily time-series data.

- Authentication: Required (`admin`/`manager`)
- Query params:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `start_date` | string | Yes | Start date (`YYYY-MM-DD`) |
| `end_date` | string | Yes | End date (`YYYY-MM-DD`) |
| `timezone` | string | No | IANA timezone (default `UTC`) |

Constraints: maximum date span is 90 days.

##### `GET /api/company/dashboard/employee-rankings`

Get ranked employee performance leaderboard.

- Authentication: Required (`admin`/`manager`)
- Query params:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filter` | string | No | `today`, `last_7_days`, `last_30_days`, `this_week`, `this_month`, `last_month`, `custom` |
| `start_date` | date | If `filter=custom` | Start date (`YYYY-MM-DD`) |
| `end_date` | date | If `filter=custom` | End date (`YYYY-MM-DD`) |
| `metric` | string | No | `profile_views`, `leads`, `inquiries` |
| `limit` | number | No | Max `20` (default `5`) |
| `timezone` | string | No | IANA timezone (default `UTC`) |

### Company Notification API

#### Error Codes Reference

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `NOTIFICATION_3600` | 401 | Authentication required |
| `NOTIFICATION_3601` | 403 | Insufficient company role |
| `NOTIFICATION_3602` | 400/422 | Invalid payload |
| `NOTIFICATION_3603` | 422 | Invalid digest schedule |
| `NOTIFICATION_3604` | 422 | Invalid digest time format |
| `NOTIFICATION_3605` | 422 | Invalid timezone |
| `NOTIFICATION_3606` | 422 | Invalid quiet-hours payload |
| `NOTIFICATION_3608` | 429 | Rate limit exceeded |
| `NOTIFICATION_3609` | 404 | Company not found |
| `NOTIFICATION_3610` | 500 | Notification delivery unavailable |

#### Endpoints

##### `GET /api/company/notifications/preferences/admin`

Fetch company-level notification policy and recipient readiness metrics.

- Authentication: Required (`admin`/`manager`)

##### `PUT /api/company/notifications/preferences/admin`

Update company-level notification policy settings.

- Authentication: Required (`admin`/`manager` + `edit_company`)
- Accepted fields:

**Administrators & Co-Admins**

| Field | Type | Description |
|-------|------|-------------|
| `join_request_enabled` | boolean | Notify admins/co-admins when a new join request is submitted |
| `company_details_changed_enabled` | boolean | Notify admins/co-admins when company profile or governance settings change |
| `co_admin_changes_enabled` | boolean | Notify admins/co-admins when co-admins are assigned, demoted, or ownership is transferred |
| `employee_management_enabled` | boolean | Notify admins/co-admins for invites, restrictions, removals, and role changes |
| `daily_summary_enabled` | boolean | Enable/disable company daily summary emails |
| `weekly_summary_enabled` | boolean | Enable/disable company weekly summary emails |
| `top_performer_alert_enabled` | boolean | Enable/disable top-performer alerts for admins/co-admins |
| `top_performer_alert_time` | string | HH:MM local send time for top performer alerts |
| `timezone` | string | IANA timezone for company-level alert schedule |

**Employees & Other Roles**

| Field | Type | Description |
|-------|------|-------------|
| `employee_daily_statistics_enabled` | boolean | Notify employees about daily performance statistics |
| `employee_weekly_statistics_enabled` | boolean | Notify employees about weekly performance statistics |
| `employee_top_performer_enabled` | boolean | Notify the top-performing employee when they lead the company |

##### `GET /api/company/notifications/preferences/employee`

Fetch the authenticated employee's notification preferences within company scope.

- Authentication: Required (`admin`/`manager`/`employee`)

##### `PUT /api/company/notifications/preferences/employee`

Update the authenticated employee's notification preferences.

- Authentication: Required (`admin`/`manager`/`employee`)
- Accepted fields:

| Field | Type | Description |
|-------|------|-------------|
| `digest_schedule` | string | `daily`, `weekly`, or `never` |
| `digest_time` | string | HH:MM |
| `timezone` | string | IANA timezone |
| `quiet_hours` | object | Optional quiet-hours config (`enabled`, `start`, `end`, `timezone`) |
| `preferences` | object | Per-event channel/priority patch map |

##### `GET /api/company/notifications/logs`

Query company-scoped email queue delivery logs.

- Authentication: Required (`admin`/`manager`)
- Query params: `page`, `limit`, `status`, `email_type`, `user_id`

#### Company Notification Cron Endpoints

All cron endpoints require cron secret auth (`Authorization: Bearer <secret>` or `x-cron-secret`).

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/cron/company-daily-summary` | Queue daily summary emails for eligible company admin/manager recipients. |
| `GET` | `/api/cron/company-weekly-summary` | Queue weekly summary emails for eligible company admin/manager recipients. |
| `GET` | `/api/cron/company-top-performer-alert` | Queue daily top-performer alert emails by company policy schedule. |

### Governance and Security

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| `POST` | `/api/company/name-change/request` | Required (primary admin + `edit_company`) | Request company name update with 90-day cooldown enforcement. |
| `GET` | `/api/company/name-change/pending` | Required (`dev`/`super_admin`) | List pending company name change requests. |
| `POST` | `/api/company/name-change/approve` | Required (`dev`/`super_admin`) | Approve/reject name change requests. |
| `POST` | `/api/company/security/randomize-code` | Required (`admin`/`manager` + `edit_company`) | Rotate company join security code. |
| `PUT` | `/api/company/settings` | Required (`admin`/`manager` + `edit_company`) | Update company profile fields and governance flags (`approval_required`, `is_public`). |
| `GET` | `/api/company/theme` | Required (`admin`/`manager` + `edit_company`) | Fetch company theme, primary-admin subscription tier, and available theme families. |
| `PUT` | `/api/company/theme` | Required (`admin`/`manager` + `edit_company`) | Update company theme and bulk-sync all active member BizCards. Theme availability is gated by the primary admin's active subscription tier. |
| `GET` | `/api/company/audit-logs` | Required (primary admin only) | Paginated audit trail for actions performed by company members. Query: `page`, `limit`, `user_id`, `action`, `from`, `to`. |
| `POST` | `/api/company/admin/transfer` | Required (primary admin only) | Transfer primary admin ownership to another active employee. Outgoing admin becomes co-admin if under the co-admin limit (3), otherwise employee. Body: `{ target_employee_id, reason? }`. |

##### `GET /api/company/theme`

Returns:

```json
{
  "company_theme": "elegant-dark",
  "current_theme_id": "elegant-dark",
  "subscription_tier": "standard",
  "available_themes": []
}
```

##### `PUT /api/company/theme`

Request:

```json
{ "company_theme": "ocean-gradient" }
```

Response includes `bizcards_updated` count for bulk member sync.

Bulk sync updates **all** bizcards owned by:
- active `companyEmployee` rows for the company
- users with `company_id` set to the company
- the company's primary admin (`admin_id`)

Members (employees, co-admins, and primary admin) cannot change their own `bizcard_theme` via Design tab or `PUT /api/bizcard/update` / `PUT /api/vcard/profile` (`themePath`). Use this endpoint instead.

Audit action: `company.theme.updated`

##### `GET /api/company/audit-logs`

Primary admin only. Returns paginated `CompanyAuditLog` entries for company members (excludes `superadmin.*` actions).

##### `POST /api/company/admin/transfer`

Audit action: `company.admin.transferred`

Error tag: `[COMPANY_ADMIN_TRANSFER]`

### Company Error Namespace

| Code | Meaning |
| ---- | ------- |
| `COMPANY_3000` | Company not found |
| `COMPANY_3002` | Company pending approval |
| `COMPANY_3005` | Name change request already pending |
| `COMPANY_3006` | Name change cooldown still active |
| `COMPANY_3008` | Invalid company theme or tier insufficient |
| `COMPANY_3009` | Admin transfer failed |
| `COMPANY_3010` | Portfolio theme is company-managed; member cannot change `bizcard_theme` individually |
| `SUBSCRIPTION_3100` | Active premium/enterprise subscription required |
| `EMPLOYEE_3200` | Employee not found |
| `EMPLOYEE_3203` | Employee restricted |
| `EMPLOYEE_3206` | Invalid employee payload |
| `EMPLOYEE_3207` | Co-admin limit reached (max 3) |
| `JOIN_3301` | Join request already pending |
| `JOIN_3303` | Invalid company security code |
| `AUTH_3402` | Elevated approver role required (`dev` or `super_admin`) |

### Company Rate Limit Keys

The following limiter keys protect company-management endpoints: `company-create`, `company-pending-requests`, `company-approve`, `company-join`, `company-my-company`, `company-employees-list`, `company-employee-detail`, `company-employee-role-update`, `company-employee-restrict`, `company-analytics-ranking`, `company-inquiries`, `company-employees-activity-summary`, `company-name-change-request`, `company-name-change-pending`, `company-name-change-approve`, `company-security-randomize`, `company-settings-update`, `company-theme-update`, `company-audit-logs`, `company-admin-transfer`, `company-dashboard-summary`, `company-dashboard-weekly-trend`, `company-dashboard-top-employee`, `company-dashboard-time-series`, `company-dashboard-employee-rankings`, `company-notification-admin-preferences`, `company-notification-employee-preferences`, and `company-notification-logs`.

---

## Gallery Media API

### Error Codes Reference

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `MEDIA_2000` | 404 | Media not found |
| `MEDIA_2001` | 500 | Media upload failed |
| `MEDIA_2002` | 500 | Media delete failed |
| `MEDIA_2003` | 400 | Invalid media type |
| `MEDIA_2004` | 400/413 | File too large |
| `MEDIA_2007` | 400 | No file provided |
| `MEDIA_2008` | 400 | Invalid bizcard ID |
| `CLOUDINARY_2100` | 500 | Cloudinary upload failed |
| `CLOUDINARY_2101` | 500 | Cloudinary delete failed |
| `GALLERY_2200` | 403 | Access denied |
| `GALLERY_2203` | 404 | Bizcard not found |
| `AUTH_1300` | 401 | Authentication required |
| `SYSTEM_1502` | 429 | Rate limit exceeded |
| `SYSTEM_1503` | 500 | Internal server error |

### Endpoints

#### `POST /api/bizcard/[bizcardId]/gallery`

Upload media to bizcard gallery (R2 storage). Filename format:

`{bizcardName}_{fileType}_{YYYYMMDD_HHMMSS}.{extension}`

- Authentication: Required (session cookie). Ownership and writes use the **effective user id** (`resolveEffectiveUserId`) so Super Admin impersonation targets the impersonated user’s bizcard.
- Content-Type: `multipart/form-data`
- Rate Limit: Uses `bizcard-gallery-upload` limiter

Form fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | file | Yes | Image or video file |
| `alt_text` | string | No | Alternative text (UI/client only on create; not a `Media` column) |
| `title` | string | No | Media title |
| `description` | string | No | Media description |
| `category` | string | No | File category (default `gallery`) |
| `is_featured` | boolean | No | Set as featured media |

---

#### `GET /api/bizcard/[bizcardId]/gallery`

Get gallery media for owner editing.

- Authentication: Required (effective/impersonated user id)
- Response: ordered media list + total

---

#### `PUT /api/bizcard/[bizcardId]/gallery/[mediaId]`

Update media metadata and optionally replace the image/video binary.

- Authentication: Required (effective/impersonated user id)
- Content types:
  - `application/json` — metadata only
  - `multipart/form-data` — metadata + optional replacement `file`
- JSON body fields: `alt_text`, `title`, `description`, `display_order`, `is_featured`
- Multipart fields: `file` (optional image/video), `title`, `description`, `alt_text`
- Note: `Media` has no `alt_text` column. When `alt_text` is provided it is stored under `Media.metadata` JSON (`metadata.alt_text`). `title` / `description` update dedicated columns.
- When `file` is provided: validates MIME/size, uploads to R2, updates `file_url` / storage keys, and best-effort deletes the previous R2 object.
- Response: updated media object including the new `url` when a replacement file was uploaded.

---

#### `DELETE /api/bizcard/[bizcardId]/gallery/[mediaId]`

Delete media (soft or permanent). Permanent delete attempts R2 object removal.

- Authentication: Required (effective/impersonated user id)
- Query params: `permanent=true|false`

---

#### `GET /api/public/[alias]/gallery`

Get public gallery for portfolio display (safe fields only).

- Authentication: Not required
- Tier gate: returns `403` when `subscription_tier` is not `standard` or `premium` (includes `basic`, `null`, and free-trial states)
- Response: `{ success: true, data: { gallery: [], videos: [], ... } }`

---

## Overview

This API provides a secure, production-grade authentication backend built with **Next.js App Router** and **Prisma** (MySQL). It is designed for a cross-origin architecture where the **frontend is hosted on Hostinger** and the **backend is deployed on Vercel**.

All authentication state is managed through **httpOnly cookies** — the frontend never handles raw tokens directly. The browser automatically sends and receives cookies on every request as long as `credentials: "include"` is set in fetch calls.

### Key Security Features

- **DB-backed sessions** — Tokens are SHA-256 hashed before database storage; sessions can be instantly revoked server-side.
- **Refresh token rotation** — Each refresh request issues new tokens and revokes old ones. Reuse of a revoked token triggers theft detection and revokes **all** user sessions.
- **Progressive account lockout** — Repeated failed login attempts lock the account with escalating cooldown periods.
- **IP-based rate limiting** — All public endpoints are rate-limited per IP address.
- **Distributed rate limiting for critical flows** — Login, registration, and health checks apply global throttling with server-side fallback when Redis is unavailable.
- **OWASP-compliant** — Timing-safe credential checks, no email enumeration, secure cookie flags, CSRF-safe `SameSite` policy, and security headers on all responses.

### Additional Security Controls (March 2026)

- **CSRF enforcement on state-changing API routes**
  - Methods: `POST`, `PUT`, `PATCH`, `DELETE`
  - Required header on protected routes: `X-CSRF-Token`
  - Exemptions: public endpoints, cron endpoints, provider webhook endpoints
- **Health endpoint auth hardening**
  - `/api/health` accepts only `Authorization: Bearer <HEALTH_CHECK_SECRET>`
  - Query-string auth (`?key=...`, `?token=...`) is rejected with `401`
- **Global transport/browser hardening headers**
  - `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`
- **Nonce-based Content Security Policy (CSP)**
  - Generated per request in `proxy.ts` via `lib/security/content-security-policy.ts`
  - `script-src`: `'self' 'nonce-{nonce}' 'strict-dynamic'` — no `'unsafe-inline'`; `'unsafe-eval'` only in development
  - `style-src-elem`: `'self' 'nonce-{nonce}' https://fonts.googleapis.com` — nonce-protected `<style>` elements
  - `style-src-attr`: `'unsafe-inline'` — allows React `style={{}}` attribute bindings while script-src remains strict
  - `object-src`: `'none'`
  - Nonce forwarded to Next.js SSR through `x-nonce` and `Content-Security-Policy` request headers for hydration script injection

### Frontend CSRF Integration

For mutating authenticated API calls, include the CSRF header:

```ts
await fetch("/api/user/profile", {
  method: "PUT",
  credentials: "include",
  headers: {
    "Content-Type": "application/json",
    "X-CSRF-Token": csrfToken,
  },
  body: JSON.stringify(payload),
});
```

---

## Authentication Model

This backend uses **opaque session tokens** stored in httpOnly cookies. There are two cookies:

| Cookie           | Purpose                                        | Lifetime (Default) | Lifetime (Remember Me) |
| ---------------- | ---------------------------------------------- | ------------------- | ---------------------- |
| `session_token`  | Access token — used for authenticating requests | 1 hour              | 24 hours               |
| `refresh_token`  | Refresh token — used to get new access tokens   | 7 days              | 30 days                |

Both cookies are set with:
- `httpOnly: true` — JavaScript cannot read them
- `secure: true` — Only sent over HTTPS
- `sameSite: "none"` — Required for cross-origin requests (frontend on different domain)
- `path: /` — Available to all routes

### How It Works

1. User logs in → Server creates a DB session and sets both cookies.
2. Frontend makes requests → Browser automatically sends `session_token` cookie.
3. Access token expires → Frontend calls `/api/auth/refresh` → Server validates `refresh_token`, rotates both tokens, sets new cookies.
4. Refresh token expires → User must log in again.

---

## CORS & Cross-Origin Setup

Since the frontend and backend are on different domains, every API request must include credentials:

```javascript
fetch("https://your-vercel-domain.vercel.app/api/auth/login", {
  method: "POST",
  credentials: "include",       // REQUIRED — sends and receives cookies
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ email: "user@example.com", password: "secret" }),
});
```

---

## 57. Performance Optimization & Observability

### 57.1 Audited Critical Endpoints

The following routes were audited and included in this optimization pass:

- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/auth/session`
- `POST /api/auth/logout`
- `POST /api/user/password/reset` (maps from requested `POST /api/auth/password/reset`)
- `POST /api/user/password/change` (maps from requested `POST /api/auth/password/change`)
- `GET /api/user/profile`
- `PUT /api/user/profile`
- `GET /api/user/bizcards`
- `GET /api/user/bizcards/search`
- `GET /api/user/bizcards/[bizcardId]` (maps from requested `[id]`)
- `GET /api/user/bizcards/[bizcardId]/qr-code/download`
- `POST /api/user/bizcards`
- `PUT /api/user/bizcards/[bizcardId]`
- `GET /api/vcard/details`
- `GET /api/vcard/design`
- `GET /api/vcard/services`
- `GET /api/vcard/social`
- `GET /api/public/[alias]`
- `GET /api/user/billing/transactions`
- `GET /api/user/billing/current-plan`
- `GET /api/affiliate/dashboard/summary`
- `GET /api/affiliate/earnings/breakdown` (maps from requested `GET /api/affiliate/earnings`)

### 57.2 Baseline Audit (Code-Path Analysis)

`CURRENT LATENCY` below is a code-audit estimate based on DB round trips and query shapes before optimization. Use `npm run test:performance` with production-like data for measured baselines.

| Endpoint | Current Latency (Estimated) | Database Queries | Cache Status |
| --- | ---: | ---: | --- |
| `POST /api/auth/login` | 250-450ms | 3-6 | No shared cache |
| `GET /api/auth/session` | 90-180ms | 1-2 | No shared cache |
| `GET /api/user/bizcards` | 220-380ms | 5 | No distributed cache |
| `GET /api/vcard/details` | 180-320ms | 3-5 | CDN cache only |
| `GET /api/public/[alias]` | 300-450ms | 6+ | Header cache only |
| `POST /api/user/bizcards` | 260-420ms | 4-8 | N/A |
| `GET /api/affiliate/dashboard/summary` | 380-620ms | 10+ | In-memory only |

### 57.3 Key Bottlenecks Found

- Heavy multi-query fan-out in public/profile and affiliate summary paths.
- No shared distributed cache abstraction across route groups.
- Missing composite indexes for common filtered+sorted list patterns.
- Inconsistent request tracing headers across endpoints.
- Non-standardized error code taxonomy in many handlers.

### 57.4 Implemented Improvements

#### Caching

- Added unified distributed cache service: `lib/cache.ts`.
- Supports Upstash Redis with safe in-memory fallback.
- Added key generator, typed read-through caching, and pattern invalidation.
- Added TTL strategy constants:
  - `PUBLIC_PROFILE=60s`
  - `USER_SESSION=30s`
  - `USER_BIZCARDS=60s`
  - `BIZCARD_DETAIL=300s`
  - `TEMPLATES_LIST=3600s`
  - `SUBSCRIPTION_PLANS=3600s`
  - `AFFILIATE_SUMMARY=120s`

#### Query Optimization

- Added reusable optimized query helpers: `lib/db/queries.ts`.
- Refactored `GET /api/public/[alias]` to consolidated query utility + cache.
- Refactored `GET /api/user/bizcards` to optimized list query + cache.

#### Indexing

- Added composite/index improvements in `prisma/schema.prisma` for these hot paths:
  - user role lookups
  - user bizcard list filters/sorts
  - service/social visibility lookups by bizcard
  - transaction/purchase timeline lookups
  - affiliate summary/breakdown aggregates
  - session latest-activity lookups

#### Compression and Payload Shaping

- Enabled compression in `next.config.ts` via `compress: true`.
- Added API cache-control headers for `api/public/*` and `api/vcard/*`.
- Added response optimizer utility `lib/serializer.ts` for safe payload shaping.

#### Tracing and Monitoring

- Added request performance middleware utilities: `middleware/performance.ts`.
- Added request tracing in critical routes:
  - `auth/login`, `auth/session`
  - `vcard/details`, `vcard/design`, `vcard/services`, `vcard/social`
  - `affiliate/dashboard/summary`, `affiliate/earnings/breakdown`
  - `user/billing/transactions`, `user/billing/current-plan`
  - `user/bizcards`, `public/[alias]`
- Added global request ID propagation in edge middleware: `middleware.ts`.
- Added admin monitoring endpoint: `GET /api/admin/performance`.

### 57.5 Performance Headers

All optimized/traced endpoints now include:

- `X-Request-ID`: unique identifier per request for end-to-end traceability.
- `X-Response-Time`: server-side processing duration (ms).
- `X-Cache`: `HIT` or `MISS` where route-level caching is applied.

### 57.6 Error Code Reference (Standardized)

Implemented in `lib/api-handler.ts`:

- Auth: `AUTH_UNAUTHORIZED`, `AUTH_INVALID_SESSION`, `AUTH_TOKEN_EXPIRED`, `AUTH_INVALID_CREDENTIALS`
- Validation: `VALIDATION_ERROR`, `VALIDATION_MISSING_FIELDS`, `VALIDATION_INVALID_FORMAT`
- Resource: `RESOURCE_NOT_FOUND`, `RESOURCE_ALREADY_EXISTS`, `RESOURCE_LIMIT_EXCEEDED`
- Permission: `PERMISSION_FORBIDDEN`, `PERMISSION_INSUFFICIENT_ROLE`
- Business: `BIZCARD_LIMIT_EXCEEDED`, `INSUFFICIENT_FUNDS`, `PAYMENT_FAILED`
- System: `SYSTEM_DATABASE_ERROR`, `SYSTEM_CACHE_ERROR`, `SYSTEM_RATE_LIMIT_EXCEEDED`, `SYSTEM_INTERNAL_ERROR`

### 57.7 Performance Test Harness

- Added script: `scripts/performance-test.ts`
- Added package command: `npm run test:performance`

Required env for testing:

- `PERF_BASE_URL` (e.g. production preview URL)
- `PERF_ITERATIONS` (optional, default 30)

### 57.8 Monitoring Dashboard Inputs

For dashboards (Datadog/New Relic/OpenTelemetry), use:

- `requestId`
- `method`
- `path`
- `status`
- `durationMs`
- `cached`
- `error` / `errorCode`

Recommended SLO targets:

- Authenticated reads: p95 `< 100ms`
- Writes: p95 `< 300ms`
- Public profile cache hit rate: `>= 90%`

### 57.9 Verification Workflow

1. Deploy with Upstash env vars configured.
2. Run `npm run test:performance` against deployed environment.
3. Compare before/after p50/p95 by endpoint.
4. Validate cache hit ratio from `X-Cache` and tracing logs.
5. Confirm no regression in auth/session and billing routes.

### Server-Side CORS Configuration

The backend reads allowed origins from the `ALLOWED_ORIGINS` environment variable (comma-separated):

```
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

Only requests from these origins will receive proper CORS headers. Requests from unknown origins on credentialed endpoints are rejected with `403 Forbidden`.

In development, `localhost:*` and `127.0.0.1:*` are automatically allowed.

---

## Staff Marketing - Client Assignment API

All endpoints in this section require:
- `staff` role
- `staff_designation = 'Marketing'`

### Client Lists

| List Type | Description |
|-----------|-------------|
| Unassigned Clients | Users not assigned to any active staff assignment |
| Assigned Clients | Users assigned to the authenticated Marketing staff member |

### Messaging Routing

- Assigned clients route to the active assigned staff member.
- Unassigned inquiries route to the first active `dev` or `super_admin` account found by creation time.
- If no fallback staff account exists, the inquiry remains unassigned for manual review.
### Pagination
- Default page size: 50 records
- Maximum page size: 100 records
- Batch assignment/unassignment maximum: 100 user IDs per request
### Endpoints
#### Staff Portal (all staff roles)
These endpoints are available to any authenticated user with role `staff`. They power the Staff Portal dashboard, clients, orders, and messages views.

##### `GET /api/staff/portal/dashboard`
Returns staff dashboard stats, recent inquiries, recent client orders, and messaging clients.

Authentication: required (`staff` role)

**Inquiry isolation (`recent_inquiries` and `stats.inquiries` / summary unread counts):**
- Only inquiries where `assigned_to_staff_id` equals the authenticated staff member’s user id.
- AND the inquiry is tied to an actively assigned client: portfolio owner (`user_id`) or sender (`sender_user_id`) is in that staff member’s active `staffClientAssignment` set.
- Load-balanced inquiries assigned to the staff but unrelated to their clients are excluded.
- If the staff member has no active assigned clients, `recent_inquiries` is an empty array and inquiry counts are `0`.
- Sorted by `created_at` descending (newest first). Dashboard returns at most **5** recent inquiries (`page: 1`, `limit: 5`).

Response `data` shape:
```json
{
  "stats": {
    "clients": 12,
    "companies": 3,
    "unread_messages": 4,
    "inquiries": 7
  },
  "summary": {},
  "recent_inquiries": [],
  "recent_orders": [],
  "messages": []
}
```

##### `GET /api/staff/portal/clients`
Returns paginated clients assigned to the authenticated staff member.

Query parameters:
- `page` - optional page number
- `limit` - optional page size
- `search` - optional name/email search
- `status` - `all`, `active`, or `inactive`

##### `GET /api/staff/portal/orders`
Returns paginated shop orders for clients assigned to the authenticated staff member.

Authentication: required (`staff` role)

Query parameters:
- `page` - optional page number
- `limit` - optional page size (max 100)
- `search` - optional search across order number, client name/email, and item names
- `status` - `all`, `pending`, `processed`, `ready_for_pickup`, `completed`, or `cancelled`

Response `data` shape:
```json
{
  "orders": [
    {
      "shop_order_id": "101",
      "order_number": "ORD-2026-0001",
      "user_id": "55",
      "company_id": null,
      "client_name": "Juan Dela Cruz",
      "transaction": "Subscription | Premium",
      "quantity": 1,
      "total_amount": "1499.00",
      "status": "pending",
      "created_at": "2026-06-25T10:00:00.000Z",
      "updated_at": null
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 50,
  "totalPages": 1,
  "status_counts": {
    "pending": 1,
    "processed": 0,
    "ready_for_pickup": 0,
    "completed": 0,
    "cancelled": 0
  }
}
```

##### `PATCH /api/staff/portal/orders/[orderId]/status`
Updates the status of an assigned client order. Staff workflow supports `ready_for_pickup` as a distinct status.

Authentication: required (`staff` role)

Request body:
```json
{
  "status": "processed",
  "reason": "Optional note"
}
```

Allowed `status` values: `pending`, `processed`, `ready_for_pickup`, `completed`, `cancelled`

##### `GET /api/staff/notifications`
Returns in-app notifications filtered to staff-relevant event types for the authenticated staff user.

Authentication: required (`staff` role)

Query parameters:
- `page` - optional page number (default `1`)
- `limit` - optional page size (default `10`, max `100`)

Staff event types include: `support_message_received`, `support_escalated`, `support_resolved`, `inquiry_sent`, `client_order_placed`

##### `GET /api/staff/notifications/unread/count`
Returns unread staff notification count for the authenticated staff user.

Authentication: required (`staff` role)

Response `data` shape:
```json
{
  "unreadCount": 3,
  "highPriorityCount": 0
}
```

##### `GET /api/staff/portal/messages`
Returns clients with unread inquiry/message counts for the authenticated staff member.

##### `GET /api/staff/verify?token=...`
Validates a staff invitation verification token from the email link.

Authentication: not required

The invitation email links to the **page route** `/staff/verify?token=...`. That page calls this API on the same origin to load the invite preview before showing the password form.

Response when valid:
```json
{
  "success": true,
  "data": {
    "email": "staff@example.com",
    "firstName": "Jane",
    "lastName": "Smith"
  }
}

```

##### `POST /api/staff/verify`
Completes staff account verification, sets the password, activates the account, and creates a session.

Authentication: not required (CSRF header required)

Request body:
```json
{
  "token": "hex-verification-token-from-email-link",
  "new_password": "SecurePass123!",
  "confirm_password": "SecurePass123!"
}
```

##### `POST /api/staff/setup-password`
Legacy endpoint for session-based password setup. New staff invitations should use `POST /api/staff/verify` instead.

#### `GET /api/staff/marketing/clients/unassigned`
Returns paginated users that do not have an active staff assignment.

Query parameters:
- `page` - page number, default `1`
- `limit` - page size, default `50`, max `100`
- `search` - search by first name, last name, or email
- `role` - optional role filter
- `has_company` - `all`, `yes`, or `no`
- `status` - `all`, `active`, or `inactive`
- `date_filter` - `today`, `yesterday`, `this_week`, `this_month`, or `custom`
- `custom_start_date` / `custom_end_date` - required when `date_filter=custom`

#### `GET /api/staff/marketing/clients/assigned`
Returns paginated users assigned to the authenticated Marketing staff member.

#### `POST /api/staff/marketing/clients/assign`
Assigns one or more users to the authenticated Marketing staff member.

Request body:
```json
{
  "user_ids": [12345, 12346, 12347]
}
```

#### `POST /api/staff/marketing/clients/unassign`
Soft-deactivates one or more active assignments for the authenticated Marketing staff member.

Request body:
```json
{
  "user_ids": [12345, 12346]
}
```

#### `GET /api/staff/marketing/clients/filter-options`
Returns dropdown data for the client assignment UI.

#### `GET /api/staff/marketing/clients/export`
Exports assigned clients as CSV by default.

Query parameters:
- `format` - `csv` or `json`
- `date_filter`, `custom_start_date`, `custom_end_date`
- `search`, `role`, `has_company`, `status`

### Error Codes

| Code | Meaning |
|------|---------|
| `STAFF_CLIENT_33000` | Authentication required |
| `STAFF_CLIENT_33001` | Marketing staff access required |
| `STAFF_CLIENT_33002` | Client not found |
| `STAFF_CLIENT_33003` | Client is already assigned |
| `STAFF_CLIENT_33004` | Assignment not found |
| `STAFF_CLIENT_33005` | Batch size exceeds the limit |
| `STAFF_CLIENT_33006` | Export generation failed |
| `STAFF_CLIENT_33007` | Rate limit exceeded |
| `STAFF_CLIENT_33008` | Invalid date range |
| `STAFF_CLIENT_33009` | Invalid pagination parameters |
| `STAFF_CLIENT_33010` | Invalid filter parameters |
| `STAFF_CLIENT_33011` | Inquiry routing failed |

### Rate Limits

| Endpoint | Max Requests | Window |
|----------|--------------|--------|
| Unassigned clients | 60 | 1 minute |
| Assigned clients | 60 | 1 minute |
| Assign | 20 | 1 minute |
| Unassign | 20 | 1 minute |
| Filter options | 30 | 1 minute |
| Export | 5 | 1 hour |

### Response Shape

All successful responses follow the standard JSON envelope:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "requestId": "uuid",
    "responseTime": 123,
    "timestamp": "2026-05-12T10:30:00.000Z"
  }
}
```

### Audit Logging

- Assignment actions write a `client_assigned` activity entry.
- Unassignment actions write a `client_unassigned` activity entry.
- Export actions write a `client_export` activity entry.
- Routed inquiries write an `INQUIRY_ROUTED` activity entry to the assigned fallback staff member.

---

## Connection Direct Messaging API

Peer-to-peer messaging between users with an **accepted** Associate/Connection. Uses HTTP polling (no WebSocket), matching the Customer Support Messenger pattern. Conversation list includes all accepted connections (empty threads show `"No messages yet"`). Sorted by most recent message first.

### Auth & Access

| Requirement | Detail |
|-------------|--------|
| Session | Authenticated cookie session (`resolveRequestSession`) |
| Graph | Accepted `Connection` between sender and peer |
| Blocks | Blocked either direction → `CONN_MSG_1009` |
| CSRF | Required on `POST` message send |

### At-rest encryption

Message text is encrypted **server-side** (AES-256-GCM) before write to `direct_messages.body` and `direct_conversations.last_message_preview`. Authorized API responses return decrypted plaintext. Ciphertext format: `enc:v1:{ivHex}:{authTagHex}:{ciphertextHex}`.

| Env var | Requirement |
|---------|-------------|
| `MESSAGE_ENCRYPTION_KEY` (preferred), else `ENCRYPTION_KEY`, else `SETTINGS_ENCRYPTION_KEY`, else `AFFILIATE_ENCRYPTION_KEY` | 64-character hex string (32 bytes). Required for send; missing/invalid key → `CONN_MSG_1012` (never stores plaintext). |

Legacy rows without the `enc:v1:` prefix are treated as plaintext (Option A). Corrupt ciphertext decrypts to `"[Encrypted message]"` on read.

### Error Tags

All direct messaging errors use tag `[CONN_MSG_API]` and codes `CONN_MSG_1000`–`CONN_MSG_1013`.

| HTTP | Code | When |
|------|------|------|
| `401` | `CONN_MSG_1000` | Missing/invalid session |
| `403` | `CONN_MSG_1008` | Not an accepted connection |
| `403` | `CONN_MSG_1009` | Users blocked |
| `400` | `CONN_MSG_1004` | Invalid payload / peer id / cursor |
| `400` | `CONN_MSG_1005` | Message body too long (>4000) |
| `400` | `CONN_MSG_1006` | Too many attachments (>5) |
| `400` | `CONN_MSG_1007` | Invalid attachment type/URL |
| `429` | `CONN_MSG_1010` | Rate limited |
| `503` | `CONN_MSG_1011` | Tables not migrated |
| `500` | `CONN_MSG_1012` | Message encryption key missing/invalid |
| `500` | `CONN_MSG_1013` | Message encrypt/decrypt failure |

Apply migrations `prisma/migrations/20260723_direct_messaging` and `prisma/migrations/20260729_direct_message_unsend_hide` before using these endpoints.

### Rate Limits

| Key | Max Requests | Window | Applies to |
|-----|--------------|--------|------------|
| `messaging-send` | 60 | 1 minute | POST message |
| `messaging-read` | 180 | 1 minute | GET conversations/messages/presence |

### Media Attachments

Use media upload with `context: "messaging"`:

- `POST /api/media/upload` (preferred proxied R2 upload)
- Proxied serve path: `GET /api/media/file/...` (includes `messaging/` keys)

Allowed MIME: `image/jpeg`, `image/png`, `image/gif`, `video/mp4`, `video/webm`. Registered `Media` rows use `related_type = messaging_attachment`. Max **5** attachments per message.

### Endpoints

#### `GET /api/messaging/conversations`

Lists accepted connections as conversation rows (lazy — empty until first open/send still appear).

**Response `data.conversations[]`:** `conversationId`, `peerUserId`, `peer` (name, avatar, jobPosition, `isOnline`, `lastActiveLabel`), `lastMessagePreview`, `lastMessageAt`, `unreadCount`, `hasMessages`.

#### `GET /api/messaging/conversations/[peerUserId]`

Get-or-create conversation with an accepted peer.

#### `GET /api/messaging/conversations/[peerUserId]/messages`

Query: `before` (message cursor ID). Returns `{ conversationId, messages }` oldest-first. Marks thread read for the viewer.

#### `POST /api/messaging/conversations/[peerUserId]/messages`

**Body:**

```json
{
  "body": "Hello!",
  "attachments": [
    {
      "mediaUrl": "https://...",
      "mimeType": "image/jpeg",
      "mediaKind": "image",
      "fileName": "photo.jpg",
      "fileSize": 12345
    }
  ]
}
```

Creates message (encrypts `body` at rest), updates encrypted preview, notifies peer with event `direct_message_received`. Response `body` is decrypted plaintext for the authenticated sender. Response includes `unsent` (false) and `seen` (false until peer reads).

#### `POST /api/messaging/conversations/[peerUserId]/messages/[messageId]/unsend`

Sender-only. Clears message body/attachments, sets `unsent_at`, returns tombstone (`unsent: true`). Both participants see the unsent placeholder on next poll.

#### `POST /api/messaging/conversations/[peerUserId]/messages/[messageId]/hide`

Delete-for-me. Inserts a per-user hide row so the message is omitted from the caller's thread only. Peer still sees it.

### Seen indicator

`GET .../messages` marks the viewer's read cursor (`direct_participant_read_states`). Each outbound message in the response includes `seen: true` when the peer's `last_read_message_id >= message_id`. The client shows **Seen** on the latest own message that the peer has read (polling ~5s).

#### `GET /api/messaging/unread/count`

Returns `{ count }` of unread direct messages across conversations. Unauthenticated → `0`.

#### `GET /api/messaging/peers/presence?ids=1,2` / `POST /api/messaging/peers/presence`

Batch online / last-active labels for accepted peers. POST body: `{ "user_ids": ["1","2"] }`.

### Realtime / Client polling

Recommended client intervals (implemented in `useConnectionMessaging`):

- Active thread messages: **5s**
- Conversation list + presence: **15s**
- Notification bell (connection accepted): **10s** in user layout; toast on new `friend_request_accepted`

### Notification events

| Event | Recipient | action_url |
|-------|-----------|------------|
| `direct_message_received` | Peer | `/user/associate` |
| `friend_request_accepted` | Requester | `/user/associate` |
| `connection_added` | Both parties | `/user/associate` |

---

## Customer Support Messenger API

Threaded customer support messaging between portal users, marketing staff, and dev/super admin escalation handlers. Uses polling (no WebSocket). Unassigned users enter a **general marketing support pool**; the first marketing staff reply **claims** the thread.

### Auth & Roles

| Actor | Requirement | Access |
|-------|-------------|--------|
| User | Authenticated session (`user`, `admin`, etc.) | Own conversation only |
| Marketing staff | `role = staff` + `staff_designation = Marketing` | Assigned clients + pooled (`staff_id IS NULL`) |
| Dev | `role = dev` | Escalated threads with `escalation_level = dev` |
| Super admin | `role = super_admin` | Escalated threads (`dev` and `super_admin` levels) |

### Error Tags

All support messaging errors use tag `[SUPPORT_MSG]` and codes `SUPPORT_MSG_1000`–`SUPPORT_MSG_1012` (e.g. `SUPPORT_MSG_1002` conversation not found, `SUPPORT_MSG_1008` conversation closed).

| HTTP | Code | When |
|------|------|------|
| `400` | `SUPPORT_MSG_1004` | Invalid request payload (e.g. malformed `before` cursor on `GET /api/support/messages`) |
| `503` | `SUPPORT_MSG_1012` | Support tables not migrated — message: *"Support messaging is not initialized. Run database migration."* |

Apply migration `prisma/migrations/20260624_support_messaging` (or `npx prisma migrate deploy` / `npx prisma db push` in local dev) before using these endpoints.

### Rate Limits

| Key | Max Requests | Window | Applies to |
|-----|--------------|--------|------------|
| `support-message-send` | 30 | 1 minute | POST message endpoints |
| `support-escalate` | 10 | 1 minute | Staff escalate |
| `support-resolve` | 20 | 1 minute | Admin resolve |
| `support-read` | 120 | 1 minute | GET list/message endpoints |

### Media Attachments

Use the existing media upload flow with `context: "support"` on:

- `POST /api/media/sign`
- `POST /api/media/upload` (proxied)
- `POST /api/media/register`

Cloudinary folder: `ontap/support/{userId}`. Registered `Media` rows use `related_type = support_attachment`. Attach up to **5** image/video files per message; URLs must be from the caller's own support upload session.

### User Endpoints

#### `GET /api/support/conversation`

Returns the authenticated user's support conversation (creates one if missing). Includes assigned/pooled staff summary (`StaffProfile.is_active`).

**Response `data`:** conversation object with `id`, `status`, `escalationLevel`, `staff`, `isPooled`, `lastMessagePreview`, etc.

#### `GET /api/support/messages`

Query: `q` (search body), `before` (message cursor ID — must be a valid integer string).

**Response `data`:** `{ conversation, messages }` — messages oldest-first.

**Errors:** `400` / `SUPPORT_MSG_1004` if `before` is not a valid cursor ID.

#### `POST /api/support/messages`

**Body:**

```json
{
  "body": "Hello, I need help",
  "attachments": [
    {
      "mediaUrl": "https://res.cloudinary.com/...",
      "mimeType": "image/jpeg",
      "mediaKind": "image",
      "fileName": "screenshot.jpg",
      "fileSize": 12345
    }
  ]
}
```

`body` max 4000 characters (HTML stripped server-side). At least one of `body` or `attachments` required.

#### `GET /api/support/unread/count`

**Response `data`:** `{ "count": 0 }`

### Marketing Staff Endpoints

All require staff portal middleware (`withStaffPortal`) — any authenticated active staff member (not limited to Marketing designation).

#### `GET /api/staff/support/conversations`

List assigned + pooled client threads with `unreadCount`, `client`, `lastMessagePreview`, `isPooled`.

**`client` object fields (staff list/detail):**
| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Client user ID |
| `name` | `string` | Display name |
| `email` | `string` | Client email |
| `profileUrl` | `string \| null` | Profile image URL |
| `phone` | `string \| null` | Primary contact number |
| `jobPosition` | `string \| null` | Job title / position |
| `companyName` | `string \| null` | Associated company name |
| `isOnline` | `boolean` | `true` if `is_online` flag set or `last_active` within 5 minutes |
| `lastActive` | `string \| null` | ISO timestamp of last activity |

#### `POST /api/staff/support/conversations/start`

Get or create a support conversation for a specific client. Used by Staff → Clients Message and staff user search.

**Auth:** Staff portal session (`withStaffPortal`). CSRF required
**Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `clientUserId` | `string` | Yes | Numeric client user ID (digits only) |




**Example request:**



```json
{
  "clientUserId": "42"
}
```

**Response `data`:** Support conversation object (same shape as list/detail items), including `id`, `clientUserId`, `client`, `unreadCount`, etc.

**Behavior:** Returns the existing thread for that client if one exists; otherwise creates a new conversation and returns it.

**Errors:**

| Status | Notes |
|--------|--------|
| `400` | Invalid JSON body or `clientUserId` not a numeric string (`SUPPORT_MSG` / `INVALID_PAYLOAD`) |
| `401` / `403` | Staff portal auth failure |
| `429` | Staff portal write rate limit |

#### `GET /api/staff/support/conversations/[id]`

Full conversation metadata for an accessible thread (same shape as list items, including enriched `client` and `unreadCount`).

#### `GET /api/staff/support/conversations/[id]/messages`

Query: `q`, `before`, `limit`. Returns message array (marks thread read for staff).

#### `POST /api/staff/support/conversations/[id]/messages`

Same body as user send. **First reply to a pooled thread claims it** (`staff_id`, `claimed_at` set).

**After escalation:** Returns `403` with error code `SUPPORT_MSG_1001` (`[SUPPORT_MSG]`) if `escalation_level !== "none"`. Staff may still read the thread via GET.

#### `POST /api/staff/support/conversations/[id]/escalate`

**Body:** `{ "target": "dev" | "super_admin" }`

Inserts system escalation notice; notifies dev/super admin and client.

#### `GET /api/staff/support/unread/count`

**Response `data`:** `{ "count": 0 }` — sum of unread across accessible conversations.

### Dev / Super Admin Endpoints

Require `withDashboardSuperAdmin` (dev or super_admin session).

#### `GET /api/superadmin/support/escalations`

Escalated conversations visible to the actor's role.

#### `GET /api/superadmin/support/escalations/unread/count`

**Response `data`:** `{ "count": 0 }`

#### `GET /api/superadmin/support/conversations/[id]/messages`

Thread view for an escalated conversation (same query params as staff: `q`, `before`, `limit`). Marks thread read for the admin actor.

#### `POST /api/superadmin/support/conversations/[id]/messages`

Send a reply in an escalated conversation. Requires dev or super_admin session; conversation must be escalated and not resolved/closed.

**Body:**

```json
{
  "body": "optional text",
  "attachments": [
    {
      "mediaUrl": "https://...",
      "mimeType": "image/jpeg",
      "mediaKind": "image",
      "fileName": "photo.jpg",
      "fileSize": 12345
    }
  ]
}
```

At least one of `body` or `attachments` is required.

**Response `201`:** `{ "success": true, "data": { ...SupportMessage }, "requestId": "..." }`

**Errors:** `401` unauthorized, `403` not escalated / wrong role (`SUPPORT_MSG_1001`), `400` closed or invalid payload (`SUPPORT_MSG_1008`, `SUPPORT_MSG_1004`), `429` rate limited.

#### `POST /api/superadmin/support/conversations/[id]/resolve`

**Body:** `{ "note": "optional resolution summary" }`

Marks conversation `resolved`, inserts resolution notice, notifies client and assigned staff.

### Developer Portal Endpoints

Require `withDashboardSuperAdmin` (dev or super_admin session). Responses use `{ success, data }` on success and `{ success: false, error, code?, tag? }` on failure.

#### `GET /api/dev/system-health`

Aggregated System Health Center payload. Historical counters (DB errors, failed logins, security alerts) respect the date filter. Live connectivity latency and privileged sessions are always current.

**Query params:**

| Param | Type | Description |
|-------|------|-------------|
| `range` | `today` \| `week` \| `month` \| `custom` | Date preset (default `today`) |
| `from` | ISO / `YYYY-MM-DD` | Required when `range=custom` (start) |
| `to` | ISO / `YYYY-MM-DD` | Required when `range=custom` (end; full day included if date-only) |

**Example request:** `GET /api/dev/system-health?range=week`

**Response `data` (shape):**

```json
{
  "range": { "preset": "week", "from": "...", "to": "...", "label": "last 7 days" },
  "summary": {
    "overallStatus": "healthy",
    "databaseStatus": "healthy",
    "securityStatus": "warning",
    "openAlerts": 2,
    "criticalAlerts": 0,
    "mainDbLatencyMs": 12,
    "analyticsDbLatencyMs": 18
  },
  "database": { "overallStatus": "healthy", "services": [], "findings": [], "recentErrors": [] },
  "security": {
    "overallStatus": "warning",
    "failedLogins": 14,
    "uniqueFailedLoginIps": 3,
    "devSessions": 1,
    "superAdminSessions": 2,
    "findings": []
  },
  
  "alerts": [
    {
      "id": "security-42",
      "type": "brute_force",
      "severity": "warning",
      "title": "Brute Force",
      "message": "...",
      "createdAt": "...",
      "source": "security_alerts",
      "actionUrl": "/dev/audit?event=security-42"
    }
  ],
  "recommendations": []
}

```

**Errors:**

| Status | Code | Tag | When |
|--------|------|-----|------|
| `422` | `DEV_SYSTEM_HEALTH_LOAD_FAILED` | `[SYSTEM_HEALTH_API]` | Invalid custom date range |
| `500` | `DEV_SYSTEM_HEALTH_LOAD_FAILED` | `[SYSTEM_HEALTH_API]` | Unexpected failure |

Security alert cards deep-link to Audit Timeline via `actionUrl` (`/dev/audit?event=security-{id}` or `/dev/audit?event=secaudit-{id}`).
#### `POST /api/dev/notices`
Create a notice. When `targetUserIds` are present and a notify channel (`email` / `in_app`) is enabled, selected users are notified immediately (email is queued and SMTP-sent now). Draft/scheduled notices are promoted to `published` when that fan-out runs.

**Body:** notice fields plus optional `notify` (default `true`).

**Response `data`:** notice DTO (includes `targetUsers`) plus nested `delivery: { inApp, email, skipped } | null`.

#### `PATCH /api/dev/notices/[noticeId]`

Update a notice. When the payload includes selected `targetUserIds` and a notify channel is enabled, the selected users are emailed (and notified in-app if that channel is enabled). Draft/scheduled notices are promoted to `published` when selected-user notification runs. Emails are sent immediately (not cron-only).

**Body (partial fields supported):** notice fields plus optional `notify` (default `true`).

**Response `data`:** notice DTO (includes `targetUsers: [{ id, name, email, role, serialId }]`) plus nested `delivery: { inApp, email, skipped } | null`.

**Errors:** `400` `DEV_NOTICE_UPDATE_FAILED` `[NOTICE_BOARD_API]`

#### `GET /api/dev/notices/users`

User picker for notice targeting.

**Query:** `q` (min 2 chars) **or** `ids` (comma-separated user ids for batch name/email resolve).

**Response `data`:** `{ users: [{ id, name, email, role, serialId }] }`

#### `GET /api/dev/audit/timeline`

Merged audit feed for the Developer Portal, including security alerts from `SecurityAlert` and analytics `AuditLog` rows with `SEC_ALERT_*` actions.

**Query params:**

| Param | Type | Description |
|-------|------|-------------|
| `limit` | number | 5–80 (default 20) |
| `event` | string | Optional focus id (`security-{id}` or `secaudit-{id}`); ensures that record is included and returned as `focusedEventId` |

**Example request:** `GET /api/dev/audit/timeline?limit=40&event=security-42`

**Response `data`:**

```json
{
  "items": [
    {
      "id": "security-42",
      "type": "security_alert",
      "label": "Brute Force",
      "target": "Too many failed attempts",
      "detail": "Severity: warning · IP: 1.2.3.4",
      "severity": "warning",
      "actorUserId": null,
      "createdAt": "...",
      "source": "security_alerts"
    }
  ],
  "focusedEventId": "security-42"
}
```

**Errors:**

| Status | Code | Tag | When |
|--------|------|-----|------|
| `500` | `DEV_AUDIT_TIMELINE_LOAD_FAILED` | `[AUDIT_TIMELINE_API]` | Unexpected failure |

### Notifications

Event types: `support_message_received`, `support_escalated`, `support_resolved`.
---
## Error Response Format
All error responses follow a consistent JSON format:
```json
{
  "error": "Human-readable error message."
}

```
Some validation errors include additional detail:

```json
{
  "error": "Password does not meet requirements.",
  "details": [
    "Must contain at least 1 uppercase letter.",
    "Must contain at least 1 special character."
  ]
}

```
**Common HTTP Status Codes:**

| Code  | Meaning                                                      |
| ----- | ------------------------------------------------------------ |
| `200` | Success                                                      |
| `201` | Created (registration)                                       |
| `400` | Bad request — missing or invalid fields                      |
| `401` | Unauthorized — invalid/missing session or token              |
| `403` | Forbidden — account deactivated or CORS rejection            |
| `404` | Not found — resource does not exist                          |
| `409` | Conflict — duplicate resource (e.g., email or URI already taken) |
| `422` | Unprocessable entity — input failed server-side validation   |
| `429` | Too many requests — rate limit or account lockout triggered  |
| `500` | Internal server error                                        |

---

## Rate Limiting

All public endpoints enforce IP-based rate limiting using an in-memory sliding 
window. Some endpoints also enforce DB-backed account lockout.

| Endpoint              | Max Requests | Window   | Additional                             |
| --------------------- | ------------ | -------- | -------------------------------------- |
| Login                 | 10           | 15 min   | + Progressive account lockout (below)  |
| Register              | 5            | 15 min   | —                                      |
| Forgot Password       | 5            | 15 min   | —                                      |
| Verify Code           | 10           | 15 min   | —                                      |
| Reset Password        | 5            | 15 min   | —                                      |
| Refresh               | 20           | 15 min   | —                                      |
| Verify Email Code     | 10           | 15 min   | + Per-code max-attempt lock in DB      |
| Resend Verification   | 3            | 1 hour   | + 60-second per-account cooldown        |
| Report Client Error   | 30           | 1 min    | —                                      |
| Card Scan             | 60           | 1 min    | —                                      |
| Card Assign (Bulk)    | 10           | 15 min   | —                                      |
| vCard Setup           | 10           | 15 min   | —                                      |
| vCard Update          | 30           | 1 min    | —                                      |
| vCard Public View     | 120          | 1 min    | —                                      |
| Portfolio View        | 30           | 1 min    | —                                      |
| Contact Save          | 30           | 1 min    | —                                      |
| Connection Request    | 5            | 15 min   | —                                      |
| Inquiry Submit        | 5            | 15 min   | —                                      |
| Portfolio Analytics   | 60           | 1 min    | —                                      |
| Analytics Dashboard   | 30           | 1 min    | Owner aggregate analytics endpoint      |
| Dashboard             | 120          | 1 min    | Shared with Activity + vCard Completion |
| Inquiry Inbox List    | 120          | 1 min    | —                                      |
| Inquiry Detail        | 180          | 1 min    | —                                      |
| Inquiry Update        | 60           | 1 min    | —                                      |

---

## Settings API (User Namespace)

All settings endpoints are now available under `/api/user/*`.

### Personal Information

- `GET /api/user/profile` (auth required; unauthenticated returns empty profile payload for signup layout safety)
  - Returns profile fields for settings / landing profile UI (no sensitive hashes).
  - Includes: `first_name`, `last_name`, `middle_name`, `email`, `alternative_email`, `phone_number`, `job_position`, `about`, `location`, `profile_image`, `cover_image`, `bizcard_count`, `email_verified`, `phone_verified` (currently static false), `member_since`, `last_login`.
  - `bizcard_count` counts non-deleted, non-deactivated owned bizcards.
  - Uses 1-minute in-memory cache.
  - Error tag for failures: `[PROFILE_API]`.

- `PUT /api/user/profile` (auth required)
  - Supports partial updates. Updatable fields: `first_name`, `last_name`, `email`, `middle_name`, `alternative_email`, `phone_number`, `job_position` (alias `title`), `about`, `location`.
  - At least one updatable field is required per request. Omitted fields keep existing values; empty string/null clears nullable fields when provided.
  - When `first_name` / `last_name` / `email` are present, they are validated (names: 2–50 chars, Latin letters with spaces/hyphens/apostrophes; email format). When omitted (e.g. email-only Change Email), name checks are skipped and existing names are preserved.
  - Email uniqueness excludes the current user (`user_id: { not: currentUser }`). Conflict returns `409` / `USER_PROFILE_EMAIL_CONFLICT`.
  - Validates optional phone (E.164 or PH `09XXXXXXXXX` / `639XXXXXXXXX` normalized server-side) and text length limits (`job_position` ≤100, `location` ≤255, `about` ≤2000, `middle_name` ≤50) only when those fields are provided.
  - If primary email changes, marks credential email as unverified and sends verification OTP.
  - Emits audit event and clears profile cache.
  - Error codes: `USER_PROFILE_VALIDATION_FAILED`, `USER_PROFILE_EMAIL_CONFLICT`, `USER_PROFILE_NOT_FOUND`, `USER_PROFILE_UPDATE_FAILED`. Tag: `[PROFILE_API]`.
  - Settings UI **Change Email Address** sends `{ "email": "<new>" }` only so name validation is not required for email changes.
  - Landing storefront `/profile` uses the same endpoint for editable personal information, cover/profile display fields, and bizcard count.

Profile / cover image binary uploads continue to use `POST /api/media/upload` with `context=profile|cover` (session + CSRF required).

### Password Management

- `POST /api/user/password/change` (auth required)
  - Verifies current password with bcrypt compare.
  - Enforces password policy from auth validator.
  - Revokes other sessions and recreates current session.

- `POST /api/user/password/forgot`
  - Enumeration-safe response message.
  - Sends reset code email if account exists.

- `POST /api/user/password/reset`
  - Primary flow now uses opaque reset tokens persisted in `PasswordResetToken`.
  - Legacy compatibility token format `"<userId>:<code>"` remains accepted temporarily.
  - Verifies token, resets password, revokes sessions, and invalidates remaining active reset tokens.

### Email Verification

- `POST /api/user/verify-email/send` (auth required)
  - Sends OTP to current or requested valid email.

- `POST /api/user/verify-email/confirm` (auth required)
  - Accepts `code` or `token` (OTP value) and verifies against latest email OTP for the logged-in user.

### Phone Verification

- `POST /api/user/verify-phone/send`
- `POST /api/user/verify-phone/confirm`
  - Return `501 SMS_NOT_CONFIGURED` until SMS provider + verification storage is configured.

### Company Theme Policy

- `GET /api/user/company-theme-policy` (auth optional; unauthenticated returns unmanaged defaults)
  - Returns whether the current user's portfolio theme is managed by their company.
  - Uses the **effective** user id when Super Admin impersonation is active.
  - Under active impersonation, `managed_by_company` is forced to `false` so the Design tab stays editable (Super Admin full authority). `impersonation_theme_override: true` is included in that case.
  - Used by the BizCard Design tab to lock theme selection for company members.

Response:

```json
{
  "managed_by_company": true,
  "company_id": "42",
  "company_theme": "elegant-dark",
  "is_hitachi_company": false,
  "is_hitachi_company_admin": false,
  "impersonation_theme_override": false
}
```

When `managed_by_company` is `true`, theme changes must go through `PUT /api/company/theme` (company admin/manager). Individual theme updates return `403` with `COMPANY_3010`. Under Super Admin impersonation, `PUT /api/vcard/profile` and `PUT /api/bizcard/update` bypass this company-theme lock.

`is_hitachi_company` is `true` when the user's company matches one of the canonical Hitachi Solutions company names. `is_hitachi_company_admin` is `true` when the user is both in a Hitachi company AND has company admin role (primary admin or admin role). The BizCard Design tab and onboarding theme picker use the `is_hitachi_company_admin` flag to expose the exclusive `enterprise/hitachi-solutions` theme family only to company admins.

### Hitachi Maintenance Scripts

One-time operational scripts (dry-run by default; pass `--apply` to commit):

| Script | Purpose |
| ------ | ------- |
| `npx tsx scripts/maintenance/reassign-hitachi-company-admins.mts` | Set `Company.admin_id` for canonical Hitachi companies using job-title hierarchy. |
| `npx tsx scripts/maintenance/seed-hitachi-theme.mts` | Upsert `Theme` row (`theme_path=hitachi-solutions`, `exclusive_for=company_group:hitachi`) and set `company_theme` on Hitachi companies. |
| `npx tsx scripts/maintenance/seed-bubble-gem-theme.mts` | Upsert marketplace `Theme` row for BubbleGem (`theme_path=bubble-gem`, `tag=premium`, `price=99`, `category=customize-templates`, `is_active=true`). |
| `npx tsx scripts/maintenance/remove-single-member-companies.mts` | Delete companies with ≤1 member; unlink users (`company_id = null`) without deleting user/bizcard rows. Canonical Hitachi companies are excluded. |

## Billing API (User Namespace)

### Read Endpoints

- `GET /api/user/billing/current-plan` (auth required)
  - Uses `UserSubscription` + `SubscriptionPlan` + current usage counts.

- `GET /api/user/billing/transactions` (auth required)
  - Returns a merged, paginated billing timeline from `PurchaseLog` and `SubscriptionUpgradeLog` (scoped to the authenticated user's bizcards).
  - Currency uses `MARKETPLACE_CURRENCY` (default `PHP`), or `ShopOrder.currency` when an order is linked.
  - Query params:
    - `page` (default `1`)
    - `limit` (default `20`, max `100`)
    - `type`: `all` | `subscription` | `physical_card` | `theme` | `promo` | `subscription_change`
    - `status`: `all` | `completed` | `pending` | `failed` | `refunded` | `scheduled` | `cancelled`
    - `from_date`, `to_date` (ISO date strings)
  - Transaction `id` prefixes:
    - `txn_{purchaseLogId}` — product, theme, or cart subscription purchases
    - `sub_{subscriptionUpgradeLogId}` — upgrades, downgrades, cancellations, plan changes
  - Example response:

```json
{
  "success": true,
  "data": {
    "transactions": [
      {
        "id": "txn_42",
        "source": "purchase_log",
        "type": "theme",
        "description": "Ocean Gradient Theme",
        "amount": 499,
        "currency": "PHP",
        "formatted_amount": "₱499.00",
        "status": "completed",
        "payment_method": { "type": "xendit" },
        "date": "2026-06-18T10:30:00.000Z",
        "receipt_url": "/api/user/billing/receipt/txn_42",
        "items": [{ "description": "Ocean Gradient Theme", "amount": 499, "quantity": 1 }],
        "metadata": { "order_number": "ORD-2026-001" }
      },
      {
        "id": "sub_17",
        "source": "subscription_log",
        "type": "subscription_change",
        "description": "Downgrade scheduled: Pro → Basic",
        "amount": 0,
        "currency": "PHP",
        "formatted_amount": "₱0.00",
        "status": "scheduled",
        "payment_method": { "type": "xendit" },
        "date": "2026-06-17T08:00:00.000Z",
        "receipt_url": "/api/user/billing/receipt/sub_17",
        "items": [{ "description": "Downgrade scheduled: Pro → Basic", "amount": 0, "quantity": 1 }],
        "metadata": {
          "upgrade_type": "downgrade_scheduled",
          "bizcard_serial": "BC-1001",
          "from_plan": "Pro",
          "to_plan": "Basic"
        }
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 2, "pages": 1 },
    "summary": {
      "total_spent": 499,
      "total_spent_formatted": "₱499.00",
      "by_type": { "subscription": 0, "physical_card": 0, "theme": 499, "promo": 0, "subscription_change": 0 },
      "by_status": { "completed": 1, "failed": 0, "pending": 0, "refunded": 0, "scheduled": 1, "cancelled": 0 },
      "average_transaction": 499,
      "last_transaction_date": "2026-06-18T10:30:00.000Z"
    }
  }
}
```

- `GET /api/user/billing/upcoming` (auth required)
  - Uses subscription expiration and billing cycle to compute next billing snapshot.

- `GET /api/user/billing/receipt/[transactionId]` (auth required)
  - Returns structured JSON receipt/detail for a billing transaction.
  - Accepts `txn_{id}`, `sub_{id}`, or plain numeric purchase-log ID (legacy).
  - Purchase receipts include linked `ShopOrder` line items, tax, shipping, and discount when available.
  - Subscription receipts include plan change metadata (`from_plan`, `to_plan`, `bizcard_serial`, `effective_date`, `event_type`).
  - Errors:
    - `400` invalid transaction ID format
    - `404` transaction not found or not owned by user
    - `500` `BILLING_RECEIPT_FETCH_FAILED` (`[BILLING_API]`)

### Payment Method Endpoints

- `GET /api/user/billing/payment-methods` returns currently attached method reference when present.
- `POST /api/user/billing/payment-methods` returns `501 PAYMENT_METHODS_NOT_CONFIGURED`.
- `PUT /api/user/billing/payment-methods/[methodId]/default` returns `501 PAYMENT_METHODS_NOT_CONFIGURED`.
- `DELETE /api/user/billing/payment-methods/[methodId]` returns `501 PAYMENT_METHODS_NOT_CONFIGURED`.
- `GET /api/user/billing/payment-methods/setup-intent` returns `501 SETUP_INTENT_NOT_CONFIGURED`.

### Invoice Endpoint

- `GET /api/user/billing/invoice/[transactionId]` currently returns `501 INVOICE_PDF_NOT_CONFIGURED`.

### Account Management

- `DELETE /api/user/account` returns `501 ACCOUNT_DELETION_NOT_CONFIGURED`.
- `POST /api/user/account/cancel-deletion` returns `501 ACCOUNT_DELETION_NOT_CONFIGURED`.
| Inquiry Delete        | 30           | 1 min    | —                                      |
| Company Create        | 5            | 1 hour   | —                                      |
| BizCard List          | 60           | 1 min    | —                                      |
| BizCard Detail        | 60           | 1 min    | —                                      |
| BizCard Update        | 10           | 15 min   | —                                      |
| BizCard Services List | 120          | 1 min    | —                                      |
| BizCard Services Create | 50         | 1 hour   | —                                      |
| BizCard Services Update | 120        | 1 min    | —                                      |
| BizCard Services Delete | 40         | 1 hour   | —                                      |
| BizCard Themes List   | 120          | 1 min    | —                                      |
| BizCard Themes Write  | 30           | 1 hour   | Create/Update/Delete                   |
| Apply Theme           | 10           | 1 hour   | User theme apply endpoint              |
| Public Services       | 100          | 1 hour   | Public read endpoint                   |
| Session Health        | 120          | 1 min    | Authenticated session-check endpoint   |
| Affiliate Dashboard Summary | 30     | 1 min    | Affiliate-only; 2-min response cache   |
| Affiliate Referral Clients  | 30     | 1 min    | Affiliate-only; 5-min response cache   |
| Affiliate Earnings Breakdown| 30     | 1 min    | Affiliate-only; 5-min response cache   |
| Affiliate Conversion Funnel | 30     | 1 min    | Affiliate-only; 5-min response cache   |
| Affiliate Withdraw Balance  | 60     | 1 min    | Affiliate-only; 1-min response cache   |
| Affiliate Recent Activities | 60     | 1 min    | Near-live activity feed; 30-sec cache  |
| Affiliate Withdrawal (POST) | 5      | 1 hour   | Financial write; idempotent            |
| Affiliate Links Performance | 30     | 1 min    | Affiliate-only; 5-min response cache   |

### Progressive Account Lockout (Login Only)

After repeated failed login attempts **on the same email address**, the account is temporarily locked:

| Failed Attempts | Lockout Duration |
| --------------- | ---------------- |
| 5               | 1 minute         |
| 10              | 5 minutes        |
| 15              | 15 minutes       |
| 20              | 30 minutes       |
| 25+             | 1 hour           |

Lockout is **DB-backed** and survives server restarts. A successful login or password reset clears the lockout counter.

### Rate Limit Response

When rate limited, the response includes a `Retry-After` header:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 54
X-RateLimit-Remaining: 0
Content-Type: application/json

{
  "error": "Too many login attempts. Please try again later."
}
```

---

## API Endpoints

---

### 1. Login

Authenticates a user with email and password. On success, sets session cookies and returns user data.

```
POST /api/auth/login
```

**Authentication:** None (public endpoint)

#### Request Body

```json
{
  "email": "user@example.com",
  "password": "MySecureP@ss1",
  "rememberMe": true
}
```

| Field        | Type      | Required | Description                                                            |
| ------------ | --------- | -------- | ---------------------------------------------------------------------- |
| `email`      | `string`  | Yes      | User's email address.                                                  |
| `password`   | `string`  | Yes      | User's password in plain text. Transmitted over HTTPS.                 |
| `rememberMe` | `boolean` | No       | If `true`, extends session to 24h and refresh token to 30 days. Default: `false`. |

#### Success Response

```
HTTP/1.1 200 OK
Set-Cookie: session_token=<token>; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=3600
Set-Cookie: refresh_token=<token>; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=604800
```

```json
{
  "message": "Login successful.",
  "user": {
    "userId": 1,
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "user",
    "customUri": "john-doe-a1b2c3"
  }
}
```

#### Error Responses

| Status | Condition                     | Response Body                                                                  |
| ------ | ----------------------------- | ------------------------------------------------------------------------------ |
| `400`  | Missing or malformed body     | `{ "error": "Invalid request body." }`                                         |
| `400`  | Invalid email format          | `{ "error": "Please provide a valid email address." }`                         |
| `401`  | Wrong email or password       | `{ "error": "Invalid email or password." }`                                    |
| `403`  | Account deactivated           | `{ "error": "This account has been deactivated." }`                            |
| `403`  | Email not verified            | `{ "error": "Please verify your email address before logging in. A new verification code has been sent.", "code": "EMAIL_NOT_VERIFIED", "userId": 1 }` |
| `429`  | IP rate limit exceeded        | `{ "error": "Too many login attempts. Please try again later." }`              |
| `429`  | Account locked (many fails)   | `{ "error": "Account temporarily locked due to too many failed attempts. Please try again later." }` |
| `500`  | Internal error                | `{ "error": "An unexpected error occurred. Please try again." }`               |

> **Auto-OTP on unverified email:** When login returns `403` with `code: "EMAIL_NOT_VERIFIED"`, the server automatically generates and emails a fresh OTP to the user. The frontend should read `userId` from the response and immediately show the OTP verification screen — **no separate call to `/api/auth/resend-otp` is needed.**

> **Migrated-user alias lock:** On successful login (password or WebAuthn) or successful reauth (OTP / WebAuthn reauth — used when login returns `REVERIFICATION_REQUIRED`), the server stamps `bizcard.last_url_alias_changed_at = now` for non-placeholder bizcards owned by the user where either (1) that field is still `null`, or (2) it was backfilled to equal `created_at` and the 90-day window from `created_at` has already expired (incorrectly unlocked after the `last_url_alias_changed_at` column migration). This starts the same 90-day URL alias lock used for newly registered users. The operation is idempotent and non-fatal (login/reauth succeeds even if the stamp fails). Blank/unclaimed placeholders are skipped so new users remain editable until first real alias claim.

#### Example (JavaScript/Fetch)

```javascript
const response = await fetch("https://your-api.vercel.app/api/auth/login", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: "user@example.com",
    password: "MySecureP@ss1",
    rememberMe: false,
  }),
});

const data = await response.json();

if (response.ok) {
  // Login successful — cookies are automatically stored by the browser
  console.log("Welcome,", data.user.firstName);
  // Redirect to dashboard
} else if (response.status === 403 && data.code === "EMAIL_NOT_VERIFIED") {
  // A fresh OTP was automatically sent — go straight to the OTP screen
  sessionStorage.setItem("pendingUserId", data.userId);
  window.location.href = "/verify-email";
} else {
  // Show error to user
  console.error(data.error);
}
```

---

### 2. Register

**OTP-First / Deferred-Creation flow.** Validates registration data, stores a temporary `PendingRegistration` record, and emails a 6-digit OTP to the user. **The real `User` row is NOT created at this stage** — it is created atomically inside `POST /api/auth/verify-email` only after the OTP is verified.

This means:
- If the user closes the page or never enters the OTP, **no orphaned account exists** and the same email address can be re-used to register at any time.
- A re-submission with the same email before verification simply overwrites the pending record with a fresh OTP (no `409` error).
- **No session cookies are set at this stage.**

```
POST /api/auth/register
```

**Authentication:** None (public endpoint)

#### Registration Flow (deferred-creation)

```
User submits form
  → POST /api/auth/register
      ↳ Validates input
      ↳ Hashes password
      ↳ Upserts PendingRegistration row (expires in 15 min)
      ↳ Generates & emails 6-digit OTP
      ↳ Returns 200 { pending: true, email, emailSent }
  → Frontend shows OTP input
  → User enters OTP
  → POST /api/auth/verify-email  { email, otp }
      ↳ Validates OTP against PendingRegistration
      ↳ Creates real User row + Credential + AffiliateSettings + BizCard
      ↳ Deletes PendingRegistration row
      ↳ Creates session (sets cookies)
      ↳ Returns 200 { userId, user, ... }
  → Frontend redirects to BizCard setup
```

#### Request Body

```json
{
  "registrationType": "individual",
  "email": "newuser@example.com",
  "password": "SecureP@ssw0rd",
  "confirmPassword": "SecureP@ssw0rd",
  "firstName": "Jane",
  "lastName": "Smith",
  "middleName": "Marie",
  "contact": "+1234567890"
}
```

> For company registration, set `registrationType: "company"` and include `companyName`:
>
> ```json
> {
>   "registrationType": "company",
>   "email": "admin@acme.com",
>   "password": "SecureP@ssw0rd",
>   "confirmPassword": "SecureP@ssw0rd",
>   "firstName": "Jane",
>   "lastName": "Smith",
>   "companyName": "Acme Corp"
> }
> ```

| Field                    | Type      | Required    | Description                                                                 |
| ------------------------ | --------- | ----------- | --------------------------------------------------------------------------- |
| `registrationType`       | `string`  | No          | `"individual"` (default) or `"company"`. Determines the account type.       |
| `email`                  | `string`  | Yes         | Must be a valid email format.                                               |
| `password`               | `string`  | Yes         | Must meet password requirements (see below).                                |
| `confirmPassword`        | `string`  | Yes         | Must exactly match `password`.                                              |
| `firstName`              | `string`  | Yes         | Max 100 characters.                                                         |
| `lastName`               | `string`  | Yes         | Max 100 characters.                                                         |
| `middleName`             | `string`  | No          | Max 100 characters.                                                         |
| `contact`                | `string`  | No          | Max 20 characters.                                                          |
| `companyName`            | `string`  | Conditional | Required when `registrationType === "company"`. Max 255 characters.         |
| `promotionalEmailOptIn`  | `boolean` | No          | When `true`, opts the user into promotional emails after account creation.  |

> **Security note:** The `role` field is never accepted from the client. It is assigned server-side from `registrationType` (`"individual"` → `"user"`, `"company"` → `"company_admin"`) to prevent privilege escalation.

#### Password Requirements

All of the following must be met:

- Minimum **8** characters, maximum **128** characters
- At least **1 lowercase** letter (`a-z`)
- At least **1 uppercase** letter (`A-Z`)
- At least **1 digit** (`0-9`)
- At least **1 special character** (`` !@#$%^&*()_+-=[]{}|;':\",./<>?`~ ``)
- **No whitespace** characters
- **No null bytes** or control characters

#### Success Response

```
HTTP/1.1 200 OK
```

```json
{
  "message": "We've sent a 6-digit verification code to your email. Please enter it to complete registration.",
  "pending": true,
  "email": "newuser@example.com",
  "emailVerificationRequired": true,
  "emailSent": true
}
```

> **Important:** No `userId` is returned because no `User` row exists yet. The frontend identifies the pending registration by `email` and passes it to `POST /api/auth/verify-email`.

When SMTP delivery fails, `emailSent` is `false` but the pending registration is still created. The user can trigger a resend via `POST /api/auth/resend-otp`.

**Development-only fields** (`NODE_ENV !== "production"`):

| Field        | Type     | Description                                                                 |
| ------------ | -------- | --------------------------------------------------------------------------- |
| `emailError` | `string` | Present when `emailSent` is `false`; safe SMTP/provider error message.      |
| `devOtp`     | `string` | Plain-text 6-digit OTP for local testing when email delivery is unreliable. |

```json
{
  "message": "Registration initiated, but the verification email could not be sent. Please use Resend or contact support.",
  "pending": true,
  "email": "newuser@example.com",
  "emailVerificationRequired": true,
  "emailSent": false,
  "emailError": "Connection timeout",
  "devOtp": "482910"
}
```

> **Required SMTP env vars for email delivery:** `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`. Recommended: `SMTP_PORT`, `SMTP_SECURE`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`. Optional: `EMAIL_PROVIDER` (`smtp` default, or `resend` with `RESEND_API_KEY`).

#### Error Responses

| Status | Condition                                      | Response Body                                                                    |
| ------ | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `400`  | Missing or malformed body                      | `{ "error": "Invalid request body." }`                                           |
| `400`  | Missing required field                         | `{ "error": "Email is required." }` (or firstName, lastName, etc.)               |
| `400`  | Passwords don't match                          | `{ "error": "Passwords do not match." }`                                         |
| `400`  | Weak password                                  | `{ "error": "Password does not meet requirements.", "details": ["..."] }`        |
| `400`  | Invalid email format                           | `{ "error": "Please provide a valid email address." }`                           |
| `409`  | Verified account already exists for this email | `{ "error": "An account with this email already exists." }`                      |
| `429`  | IP rate limit exceeded                         | `{ "error": "Too many registration attempts. Please try again later." }`         |
| `500`  | Internal error                                 | `{ "error": "Internal server error." }`                                          |

> **Note:** Submitting the same email while a pending (unverified) registration already exists does **not** return a `409`. The pending record is silently overwritten with fresh registration data and a new OTP.

#### Example (JavaScript/Fetch)

```javascript
const response = await fetch("https://your-api.vercel.app/api/auth/register", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: "newuser@example.com",
    password: "SecureP@ssw0rd",
    confirmPassword: "SecureP@ssw0rd",
    firstName: "Jane",
    lastName: "Smith",
  }),
});

const data = await response.json();

if (response.ok) {
  // OTP sent — no account exists yet, navigate to verification screen
  // Identify the pending registration by email (no userId at this stage)
  sessionStorage.setItem("pendingEmail", data.email);
  window.location.href = "/verify-email";
} else if (response.status === 409) {
  console.error("A verified account with this email already exists.");
} else {
  console.error(data.error);
  if (data.details) {
    data.details.forEach((msg) => console.error(" -", msg));
  }
}
```

---

### 3. Get Session

Returns the current authenticated user's session information. Use this to check if the user is logged in and to retrieve their profile data.

```
GET /api/auth/session
```

**Authentication:** Required — `session_token` cookie must be present and valid.

#### Request Body

None. This is a `GET` request.

#### Success Response

```
HTTP/1.1 200 OK
```

```json
{
  "authenticated": true,
  "user": {
    "userId": 1,
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "user",
    "customUri": "john-doe-a1b2c3",
    "profileUrl": "/profile-image.jpg"
  },
  "expiresAt": "2026-03-06T15:30:00.000Z",
  "rememberMe": false
}
```

#### Error Responses

| Status | Condition                              | Response Body                                       |
| ------ | -------------------------------------- | --------------------------------------------------- |
| `401`  | Missing, expired, or revoked session   | `{ "authenticated": false, "user": null }`          |
| `401`  | User account has been deactivated      | `{ "authenticated": false, "user": null }`          |
| `500`  | Internal error                         | `{ "error": "Internal server error." }`             |

#### Example (JavaScript/Fetch)

```javascript
const response = await fetch("https://your-api.vercel.app/api/auth/session", {
  method: "GET",
  credentials: "include",  // sends session_token cookie
});

const data = await response.json();

if (data.authenticated) {
  console.log("Logged in as:", data.user.email);
  console.log("Role:", data.user.role);
  console.log("Session expires at:", data.expiresAt);
} else {
  // User is not logged in — redirect to login page
  window.location.href = "/login";
}
```

#### Typical Usage

Call this endpoint on page load or app initialization to determine if the user has an active session:

```javascript
// In a React component or layout
useEffect(() => {
  async function checkSession() {
    const res = await fetch("/api/auth/session", { credentials: "include" });
    const data = await res.json();
    if (data.authenticated) {
      setUser(data.user);
    } else {
      router.push("/login");
    }
  }
  checkSession();
}, []);
```

---

### 4. Logout

Destroys the current session (revokes it server-side) and clears all auth cookies
(`session_token`, `refresh_token`, `reauth_state`, CSRF, impersonation handoff).
Revokes by access-token hash and, when present, by refresh-token hash so a refresh-only
cookie cannot revive the session. Client portals then wipe localStorage/sessionStorage
auth caches via `performLogout()` / `clearClientAuthCache()`.

```
POST /api/auth/logout
```

**Authentication:** Optional — if the session cookie is present, the session is revoked. If not, logout still succeeds (idempotent). Proxy allows this path without a session cookie, but **CSRF is still required**.

#### Request Headers

| Header | Required | Notes |
| ------ | -------- | ----- |
| `X-CSRF-Token` | Yes | Must match `csrf-token` cookie (fetch from `GET /api/csrf-token` first). |
| `Content-Type` | Recommended | `application/json` |

#### Request Body

None (empty JSON `{}` is accepted).

#### Success Response

```
HTTP/1.1 200 OK
Set-Cookie: session_token=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0
Set-Cookie: refresh_token=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0
Set-Cookie: reauth_state=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0
```

```json
{
  "message": "Logged out successfully."
}
```

#### Error Responses

| Status | Condition      | Response Body                                          |
| ------ | -------------- | ------------------------------------------------------ |
| `403`  | Missing/invalid CSRF | `{ "error": "Invalid CSRF token.", "code": "CSRF_TOKEN_INVALID" }` |
| `500`  | Internal error | `{ "error": "Internal server error." }`         |

#### Example (JavaScript/Fetch)

```javascript
const csrfRes = await fetch("https://your-api.vercel.app/api/csrf-token", {
  credentials: "include",
});
const { csrfToken } = await csrfRes.json();

const response = await fetch("https://your-api.vercel.app/api/auth/logout", {
  method: "POST",
  credentials: "include",
  headers: {
    "Content-Type": "application/json",
    "X-CSRF-Token": csrfToken,
  },
  body: "{}",
});

if (response.ok) {
  // Cookies are cleared by Set-Cookie; also clear client auth caches.
  console.log("Logged out.");
  window.location.href = "/login";
}
```

> **Note:** Even if the browser fails to clear cookies (unlikely), the session is marked as **revoked** in the database and cannot be used again.

---

### 5. Refresh Session

Exchanges a valid refresh token for new session and refresh tokens. This is used to silently extend a user's session without requiring them to log in again.

```
POST /api/auth/refresh
```

**Authentication:** Requires `refresh_token` cookie.

#### Request Body

None. The refresh token is read from the `refresh_token` cookie automatically.

#### Success Response

```
HTTP/1.1 200 OK
Set-Cookie: session_token=<new_token>; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=...
Set-Cookie: refresh_token=<new_token>; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=...
```

```json
{
  "message": "Session refreshed successfully."
}
```

#### Error Responses

| Status | Condition                           | Response Body                                                        |
| ------ | ----------------------------------- | -------------------------------------------------------------------- |
| `401`  | No refresh token cookie             | `{ "error": "No refresh token provided." }`                         |
| `401`  | Invalid or expired refresh token    | `{ "error": "Invalid refresh token." }`                             |
| `401`  | Token reuse detected (theft)        | `{ "error": "Session compromised. All sessions revoked." }`         |
| `401`  | Account deactivated                 | `{ "error": "Account deactivated." }`                               |
| `429`  | IP rate limit exceeded              | `{ "error": "Too many refresh attempts. Please try again later." }` |
| `500`  | Internal error                      | `{ "error": "An unexpected error occurred." }`                      |

#### Example (JavaScript/Fetch)

```javascript
async function refreshSession() {
  const response = await fetch("https://your-api.vercel.app/api/auth/refresh", {
    method: "POST",
    credentials: "include",  // sends refresh_token cookie
  });

  if (response.ok) {
    // New cookies are automatically set by the browser
    return true;
  }

  if (response.status === 401) {
    // Refresh token expired or compromised — force re-login
    window.location.href = "/login";
    return false;
  }

  return false;
}
```

#### Recommended Integration Pattern

Wrap your API calls with automatic refresh on `401`:

```javascript
async function authenticatedFetch(url, options = {}) {
  let response = await fetch(url, { ...options, credentials: "include" });

  // If access token expired, try refreshing
  if (response.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed) {
      // Retry the original request with new cookies
      response = await fetch(url, { ...options, credentials: "include" });
    }
  }

  return response;
}
```

#### Security: Token Theft Detection

If a refresh token that was already **revoked** (used previously) is presented again, the server assumes the token was stolen and immediately revokes **all sessions** for that user. This forces re-authentication on every device.

---

### 6. Forgot Password

Initiates the password reset flow by sending a 6-digit verification code to the user's email address.

```
POST /api/auth/forgot-password
```

**Authentication:** None (public endpoint)

#### Request Body

```json
{
  "email": "user@example.com"
}
```

| Field   | Type     | Required | Description                               |
| ------- | -------- | -------- | ----------------------------------------- |
| `email` | `string` | Yes      | The email address associated with the account. |

#### Success Response

```
HTTP/1.1 200 OK
```

```json
{
  "message": "If an account with that email exists, a verification code has been sent.",
  "userId": 1
}
```

> **Important:** The success message is intentionally vague to prevent email enumeration. The same message is returned whether the email exists in the system or not. However, `userId` is only included if the account was found (use its presence to proceed to verification).

#### Error Responses

| Status | Condition                     | Response Body                                                          |
| ------ | ----------------------------- | ---------------------------------------------------------------------- |
| `400`  | Missing or malformed body     | `{ "error": "Invalid request body." }`                                 |
| `400`  | Missing email field           | `{ "error": "Email is required." }`                                    |
| `400`  | Invalid email format          | `{ "error": "Please provide a valid email address." }`                 |
| `429`  | IP rate limit exceeded        | `{ "error": "Too many requests. Please try again later." }`           |
| `500`  | Internal error                | `{ "error": "An unexpected error occurred. Please try again." }`       |

#### Example (JavaScript/Fetch)

```javascript
const response = await fetch("https://your-api.vercel.app/api/auth/forgot-password", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "user@example.com" }),
});

const data = await response.json();

if (response.ok) {
  if (data.userId) {
    // Store userId for the next steps
    console.log("Verification code sent. Check your email.");
    // Navigate to verify-code page, passing userId
    navigateToVerifyCode(data.userId);
  } else {
    // Email not found, but we show the same message
    console.log(data.message);
  }
} else {
  console.error(data.error);
}
```

#### Verification Code Details

- **Format:** 6-character **uppercase** alphanumeric code (e.g., `A3FK29`)
- **Character set:** `A–Z` (excluding `I`, `O`) + digits `2–9` — 32 characters total with no ambiguous characters and zero modular bias
- **Expiry:** 10 minutes from creation
- **Case-insensitive:** Submissions are normalized to uppercase before comparison
- **Single-use:** Once verified, the code cannot be used again
- **Previous codes:** All unused codes for the same user are invalidated when a new code is generated

---

### 7. Verify Code

Validates the 6-digit verification code that was sent to the user's email. This is the second step of the password reset flow.

```
POST /api/auth/verify-code
```

**Authentication:** None (public endpoint)

#### Request Body

```json
{
  "userId": 1,
  "code": "A3F8K2"
}
```

| Field    | Type     | Required | Description                                                     |
| -------- | -------- | -------- | --------------------------------------------------------------- |
| `userId` | `number` | Yes      | The user ID returned from the `forgot-password` endpoint.       |
| `code`   | `string` | Yes      | The 6-character verification code from the email. Case-insensitive. |

#### Success Response

```
HTTP/1.1 200 OK
```

```json
{
  "message": "Code verified successfully. You may now reset your password.",
  "verified": true
}
```

#### Error Responses

| Status | Condition                     | Response Body                                                       |
| ------ | ----------------------------- | ------------------------------------------------------------------- |
| `400`  | Missing or malformed body     | `{ "error": "Invalid request body." }`                              |
| `400`  | Missing/invalid userId        | `{ "error": "Valid user ID is required." }`                         |
| `400`  | Code wrong length             | `{ "error": "Verification code must be exactly 6 characters." }`   |
| `400`  | Wrong or expired code         | `{ "error": "Invalid or expired verification code." }`             |
| `429`  | IP rate limit exceeded        | `{ "error": "Too many attempts. Please try again later." }`        |
| `500`  | Internal error                | `{ "error": "An unexpected error occurred. Please try again." }`   |

#### Example (JavaScript/Fetch)

```javascript
const response = await fetch("https://your-api.vercel.app/api/auth/verify-code", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    userId: storedUserId,      // from forgot-password response
    code: userEnteredCode,     // from input field (e.g., "A3F8K2")
  }),
});

const data = await response.json();

if (response.ok && data.verified) {
  // Code is valid — navigate to reset password page
  navigateToResetPassword(storedUserId);
} else {
  console.error(data.error);  // "Invalid or expired verification code."
}
```

> **Note:** The code comparison is **case-insensitive** — `a3f8k2` and `A3F8K2` are both accepted.

---

### 8. Reset Password

Sets a new password for the user. This is the final step of the password reset flow. It revokes all existing sessions for the user, requiring them to log in again with the new password.

```
POST /api/auth/reset-password
```

**Authentication:** None (public endpoint, but only succeeds after a valid `verify-code` call)

#### Request Body

```json
{
  "userId": 1,
  "password": "NewSecureP@ss1",
  "confirmPassword": "NewSecureP@ss1"
}
```

| Field             | Type     | Required | Description                                                  |
| ----------------- | -------- | -------- | ------------------------------------------------------------ |
| `userId`          | `number` | Yes      | The user ID from the `forgot-password` response.             |
| `password`        | `string` | Yes      | New password. Must meet all [password requirements](#password-requirements). |
| `confirmPassword` | `string` | Yes      | Must exactly match `password`.                               |

#### Success Response

```
HTTP/1.1 200 OK
```

```json
{
  "message": "Password updated successfully. Please log in with your new password."
}
```

#### Error Responses

| Status | Condition                     | Response Body                                                                     |
| ------ | ----------------------------- | --------------------------------------------------------------------------------- |
| `400`  | Missing or malformed body     | `{ "error": "Invalid request body." }`                                            |
| `400`  | Missing/invalid userId        | `{ "error": "Valid user ID is required." }`                                       |
| `400`  | Missing password              | `{ "error": "Password is required." }`                                            |
| `400`  | Missing confirmPassword       | `{ "error": "Confirm password is required." }`                                    |
| `400`  | Passwords don't match         | `{ "error": "Passwords do not match." }`                                          |
| `400`  | Weak password                 | `{ "error": "Password does not meet requirements.", "details": ["..."] }`         |
| `404`  | User not found                | `{ "error": "User not found." }`                                                 |
| `429`  | IP rate limit exceeded        | `{ "error": "Too many attempts. Please try again later." }`                       |
| `500`  | Internal error                | `{ "error": "An unexpected error occurred. Please try again." }`                  |

#### Example (JavaScript/Fetch)

```javascript
const response = await fetch("https://your-api.vercel.app/api/auth/reset-password", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    userId: storedUserId,
    password: "NewSecureP@ss1",
    confirmPassword: "NewSecureP@ss1",
  }),
});

const data = await response.json();

if (response.ok) {
  console.log("Password updated. Please log in again.");
  window.location.href = "/login";
} else {
  console.error(data.error);
  if (data.details) {
    data.details.forEach((msg) => console.error(" -", msg));
  }
}
```

#### Security Notes

- **All existing sessions are revoked** — the user (and any attacker) must re-authenticate on all devices.
- **Account lockout is cleared** — the failed attempt counter resets so the user can log in immediately with the new password.

---

### 9. Cron Cleanup (Internal)

Cleans up expired sessions, old login attempt records, and old audit logs. Triggered by an external cron scheduler (e.g. [cron-job.org](https://cron-job.org)).

```
GET /api/cron/cleanup
```

**Authentication:** Required — must provide `Authorization: Bearer <CRON_SECRET>` header.

#### Request Headers

```
Authorization: Bearer your-cron-secret-value
```

#### Success Response

```
HTTP/1.1 200 OK
```

```json
{
  "message": "Cleanup completed.",
  "sessionsDeleted": 42,
  "loginAttemptsDeleted": 150,
  "auditLogsDeleted": 300
}
```

#### Error Responses

| Status | Condition                        | Response Body                    |
| ------ | -------------------------------- | -------------------------------- |
| `401`  | Missing or invalid CRON_SECRET   | `{ "error": "Unauthorized." }`   |

#### Cleanup Rules

| Data               | Deleted When                                     |
| ------------------ | ------------------------------------------------ |
| Sessions           | Revoked or expired, older than 7 days            |
| Login Attempts     | Older than 30 days                               |
| Audit Logs         | Older than 90 days                               |

#### Vercel Cron Configuration

This endpoint runs automatically via `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/cleanup",
      "schedule": "0 3 * * *"
    }
  ]
}
```

Runs daily at **3:00 AM UTC**.

---

### 10. Verify Email OTP + Account Creation

**Primary registration verification endpoint.** Validates the 6-digit OTP submitted by the user against the `PendingRegistration` record. On success, the real `User` account is atomically created in the database, the `PendingRegistration` row is deleted, and a session is established.

This endpoint also supports the legacy path (existing unverified `User` rows created before the deferred-creation flow was deployed), maintaining full backwards compatibility.

```
POST /api/auth/verify-email
```

**Authentication:** None (public endpoint — session cookies are **set** by this endpoint on success)

#### Request Body — Deferred-Creation Flow (current)

```json
{
  "email": "newuser@example.com",
  "otp": "482910"
}
```

#### Request Body — Legacy Flow (backwards compatible)

```json
{
  "userId": 5,
  "otp": "482910"
}
```

Both `email` and `userId` may be supplied simultaneously; `email` takes priority for the deferred path.

| Field    | Type     | Required              | Description                                               |
| -------- | -------- | --------------------- | --------------------------------------------------------- |
| `email`  | `string` | Yes (deferred flow)   | Email used during registration.                           |
| `userId` | `number` | Yes (legacy flow)     | Integer user ID returned by the old register endpoint.    |
| `otp`    | `string` | Yes                   | Exactly 6-character code from the verification email.     |

#### Success Response

```
HTTP/1.1 200 OK
Set-Cookie: session_token=...; HttpOnly; Secure; SameSite=None; Path=/
Set-Cookie: refresh_token=...; HttpOnly; Secure; SameSite=None; Path=/
```

```json
{
  "message": "Email verified successfully. Your account has been created.",
  "userId": 5,
  "user": {
    "userId": 5,
    "email": "newuser@example.com",
    "firstName": "Jane",
    "lastName": "Smith",
    "role": "user",
    "customUri": "jane-smith-a1b2c3"
  }
}
```

For company registrations, `companyId` is also returned at the top level:

```json
{
  "message": "Email verified successfully. Your account has been created.",
  "userId": 5,
  "companyId": 2,
  "user": { ... }
}
```

> **What happens on success:**
> 1. `User` + `Credential` (with `email_verified: true`) + `AffiliateSettings` + placeholder `Bizcard` are created in a single atomic transaction.
> 2. The `PendingRegistration` row is deleted in the same transaction.
> 3. Free trial is initialized (individual accounts).
> 4. Affiliate enrollment is applied.
> 5. Promotional email preference is saved if the user opted in.
> 6. Session cookies are set — the user is immediately logged in.

#### Error Responses

| Status | Code               | Condition                                                               |
| ------ | ------------------ | ----------------------------------------------------------------------- |
| `400`  | —                  | Missing or malformed body                                               |
| `400`  | —                  | OTP not 6 characters, or contains invalid characters                   |
| `400`  | —                  | Neither `email` nor valid `userId` supplied                             |
| `400`  | `OTP_EXPIRED`      | OTP has passed its 15-minute expiry — user must click Resend           |
| `400`  | `OTP_INVALID`      | Incorrect OTP — remaining attempts shown implicitly                     |
| `404`  | `NOT_FOUND`        | No pending registration found for this email                            |
| `429`  | `OTP_MAX_ATTEMPTS` | 5 failed attempts — user must click Resend to get a new code           |
| `429`  | —                  | IP rate limit exceeded (10 attempts per 15 min)                         |
| `500`  | —                  | Internal error                                                          |

#### Example (JavaScript/Fetch)

```javascript
const response = await fetch("https://your-api.vercel.app/api/auth/verify-email", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: sessionStorage.getItem("pendingEmail"),
    otp: otpInputValue,
  }),
});

const data = await response.json();

if (response.ok) {
  // Account is now created and session is active
  console.log("Logged in as userId:", data.userId);
  window.location.href = "/user/setup/bizcard";
} else if (data.code === "OTP_EXPIRED") {
  showError("Code expired — please request a new one.");
} else if (data.code === "OTP_MAX_ATTEMPTS") {
  showError("Too many attempts — please request a new code.");
} else {
  showError(data.error);
}
```

---

### 10a. Verify Email Code (standalone / non-registration)

Validates a 6-digit code for an already-registered email address. Does **not** create accounts or open sessions — used for flows outside the main registration path (e.g. re-verification prompts).

```
POST /api/auth/verify
```

**Authentication:** None (public endpoint)

#### Request Body

```json
{
  "email": "newuser@example.com",
  "code": "123456"
}
```

| Field   | Type     | Required | Description                               |
| ------- | -------- | -------- | ----------------------------------------- |
| `email` | `string` | Yes      | Account email to verify.                  |
| `code`  | `string` | Yes      | Exactly 6 digits from verification email. |

#### Success Response

```json
{
  "success": true,
  "message": "Email verified successfully",
  "data": {
    "email": "newuser@example.com",
    "verifiedAt": "2026-03-27T10:00:00.000Z"
  }
}
```

#### Error Responses

| Status | Code                     | Condition                              |
| ------ | ------------------------ | -------------------------------------- |
| `400`  | `MISSING_FIELDS`         | Missing `email` or `code`              |
| `400`  | `INVALID_EMAIL`          | Invalid email format                   |
| `400`  | `INVALID_CODE_FORMAT`    | Code not 6 digits                      |
| `400`  | `ALREADY_VERIFIED`       | Account already verified               |
| `401`  | `INVALID_CODE`           | Code mismatch                          |
| `404`  | `NO_ACTIVE_VERIFICATION` | No active/valid code found             |
| `404`  | `USER_NOT_FOUND`         | Email does not exist                   |
| `429`  | `MAX_ATTEMPTS_EXCEEDED`  | Too many failures for the current code |
| `500`  | `SERVER_ERROR`           | Internal error                         |

---

### 11. Resend Verification OTP

Issues a fresh 6-digit OTP and emails it to the user. Supports both the deferred-creation flow (`PendingRegistration` exists, no `User` row yet) and the legacy flow (unverified `User` row).

- **Deferred flow:** Looks up `PendingRegistration` by `email`. Generates a new OTP, updates the row, sends the email.
- **Legacy flow:** Falls back to `User` table lookup by `userId` or `email`. Delegates to `VerificationService.resendVerification`.

```
POST /api/auth/resend-otp
```

**Authentication:** None (public endpoint)

#### Request Body

```json
{
  "email": "newuser@example.com"
}
```

Or with userId for legacy compatibility:

```json
{
  "userId": 5,
  "email": "newuser@example.com"
}
```

| Field    | Type     | Required              | Description                                           |
| -------- | -------- | --------------------- | ----------------------------------------------------- |
| `email`  | `string` | Yes (deferred flow)   | Email used during registration. Takes priority.       |
| `userId` | `number` | Yes (legacy flow)     | Integer user ID if `email` is not available.          |

#### Success Response

```json
{
  "message": "If your registration is pending, a new code has been sent to your email.",
  "emailSent": true
}
```

> The generic message is intentional — it prevents email enumeration (determining whether an address has a pending registration).

#### Error Responses

| Status | Code                  | Condition                                                        |
| ------ | --------------------- | ---------------------------------------------------------------- |
| `400`  | —                     | Neither `email` nor valid `userId` provided                      |
| `429`  | `RATE_LIMIT_EXCEEDED` | IP-level limit (3 per 15 min) or 60-second per-email cooldown   |
| `502`  | `EMAIL_SEND_FAILED`   | SMTP/provider failed to deliver                                  |
| `500`  | —                     | Internal error                                                   |

When the rate limit is a per-email cooldown:

```json
{
  "error": "Please wait 47 seconds before requesting another code.",
  "code": "RATE_LIMIT_EXCEEDED",
  "cooldownRemaining": 47
}
```

When SMTP send fails:

```json
{
  "error": "Failed to send verification email. Please try again later.",
  "code": "EMAIL_SEND_FAILED",
  "emailSent": false
}
```

---

### 12. Report Client Error (Monitoring)

Accepts a frontend runtime error report and stores it in the database with automatic severity classification. Designed to be called from a global `window.onerror` / `window.onunhandledrejection` handler.

```
POST /api/monitoring/error-log
```

**Authentication:** None (public endpoint — session cookie is read if present to associate the error with a user, but is not required)

#### Request Body

```json
{
  "errorMessage": "Cannot read properties of null (reading 'id')",
  "stackTrace": "TypeError: ...\n    at handleClick (main.js:42:8)",
  "fileName": "main.js",
  "lineNumber": 42,
  "colNumber": 8,
  "pageUrl": "https://yoursite.com/dashboard",
  "browserInfo": "Mozilla/5.0 ...",
  "deviceInfo": "Win32",
  "sessionId": "abc123",
  "severity": "medium"
}
```

| Field          | Type     | Required | Description                                                                         |
| -------------- | -------- | -------- | ----------------------------------------------------------------------------------- |
| `errorMessage` | `string` | Yes      | Error message text. Truncated at 2000 characters.                                   |
| `stackTrace`   | `string` | No       | Full stack trace. Truncated at 10 000 characters.                                   |
| `fileName`     | `string` | No       | Source file where the error occurred. Truncated at 500 characters.                  |
| `lineNumber`   | `number` | No       | Line number of the error.                                                            |
| `colNumber`    | `number` | No       | Column number of the error.                                                          |
| `pageUrl`      | `string` | No       | Full URL of the page where the error occurred. Truncated at 2048 characters.        |
| `browserInfo`  | `string` | No       | User agent string. Truncated at 512 characters.                                     |
| `deviceInfo`   | `string` | No       | Platform/device descriptor. Truncated at 255 characters.                            |
| `sessionId`    | `string` | No       | Client-side session identifier for correlating multiple errors. Truncated at 255 chars. |
| `severity`     | `string` | No       | One of `"low"`, `"medium"`, `"high"`, `"critical"`. Defaults to `"low"`. The server may **upgrade** the severity based on error content pattern matching. |

#### Success Response

```
HTTP/1.1 204 No Content
```

(Empty body — intentionally silent to avoid leaking internal status to attackers.)

#### Error Responses

| Status | Condition                         | Response Body              |
| ------ | --------------------------------- | -------------------------- |
| `400`  | Missing or malformed body         | `{ "error": "..." }`       |
| `429`  | Rate limit exceeded (30/min)      | `{ "error": "..." }`       |
| `500`  | Internal error                    | `{ "error": "..." }`       |

#### Severity Classification

The server auto-classifies severity based on error message and stack trace content:

| Level      | Triggered By                                                                    |
| ---------- | ------------------------------------------------------------------------------- |
| `critical` | Security errors, CORS failures, authentication failures, CSP violations         |
| `high`     | Network errors, syntax errors, reference errors, chunk load failures            |
| `medium`   | Type errors, range errors, URI errors, JSON parse failures                      |
| `low`      | Everything else                                                                 |

The final stored severity is the **maximum** of the client-supplied value and the server-classified value.

#### Frontend Integration Example

Add this script to your frontend's `<head>` or main entry file to automatically capture all unhandled errors:

```javascript
(function setupErrorReporting() {
  const API = "https://your-api.vercel.app";
  function report(payload) {
    navigator.sendBeacon(
      `${API}/api/monitoring/error-log`,
      new Blob([JSON.stringify(payload)], { type: "application/json" })
    );
  }
  window.onerror = function (message, source, lineno, colno, error) {
    report({
      errorMessage: String(message).slice(0, 2000),
      stackTrace: error?.stack?.slice(0, 10000),
      fileName: source,
      lineNumber: lineno,
      colNumber: colno,
      pageUrl: location.href,
      browserInfo: navigator.userAgent,
      deviceInfo: navigator.platform,
      severity: "medium",
    });
  };
  window.onunhandledrejection = function (event) {
    const err = event.reason;
    report({
      errorMessage: (err?.message || String(err)).slice(0, 2000),
      stackTrace: err?.stack?.slice(0, 10000),
      pageUrl: location.href,
      browserInfo: navigator.userAgent,
      deviceInfo: navigator.platform,
      severity: "medium",
    });
  };
}());
```
> `navigator.sendBeacon` is used so the request is sent even when the user navigates away immediately after an error.
---
## Registration & Email Verification Flow (Step-by-Step)
Registration is a **two-step process**: account creation followed by email-code verification. The login endpoint also participates in this flow when an unverified user tries to log in.
```
Step 1: POST /api/auth/register
  ↓  (account created, verification code email sent)
Step 2: POST /api/auth/verify
  ↓  (code validated, account marked verified)
  → Continue to login/session flow
[If unverified user tries to log in]
POST /api/auth/login  →  403 EMAIL_NOT_VERIFIED
  ↓  (fresh verification code automatically sent)
  → Show verification screen with user email
[Only needed when code expires or max attempts reached]
POST /api/auth/resend-verification
  ↑  (generates a fresh code and resends verification email)
```
### Complete Frontend Example

```javascript
// ── STEP 1: Create account ──
async function handleRegister(formData) {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(formData),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error);

  // No session yet — store email and redirect to verification screen
  sessionStorage.setItem("pendingEmail", formData.email.toLowerCase());
  window.location.href = "/verify-email";
}

// ── STEP 2: Submit the verification code ──
async function handleVerifyOtp(otpCode) {
  const email = sessionStorage.getItem("pendingEmail");

  const res = await fetch("/api/auth/verify", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code: otpCode }),
  });

  const data = await res.json();
  if (!res.ok) {
    if (data.error?.code === "NO_ACTIVE_VERIFICATION" || data.error?.code === "MAX_ATTEMPTS_EXCEEDED") {
      // Show resend button — user must request a fresh code
    }
    throw new Error(data.error?.message || "Verification failed");
  }

  sessionStorage.removeItem("pendingEmail");
  // Verification succeeded; continue to login flow.
  window.location.href = "/login";
}

// ── Handling EMAIL_NOT_VERIFIED on login ──
// The login endpoint automatically sends a fresh verification code.
// Redirect to the verification screen using the same email.
async function handleLogin(email, password) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json();
  if (res.ok) {
    window.location.href = "/dashboard";
  } else if (res.status === 403 && data.code === "EMAIL_NOT_VERIFIED") {
    sessionStorage.setItem("pendingEmail", email.toLowerCase());
    window.location.href = "/verify-email";
  } else {
    showError(data.error);
  }
}

// ── Only if code expired or max attempts hit: Resend code ──
async function handleResendOtp() {
  const email = sessionStorage.getItem("pendingEmail");

  const res = await fetch("/api/auth/resend-verification", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

  const data = await res.json();
  showMessage(data.message || data.error?.message);
}
```

---

## Password Reset Flow (Step-by-Step)

The password reset process consists of three sequential API calls:

```
Step 1: POST /api/auth/forgot-password
   ↓  (user receives email with 6-digit code)
Step 2: POST /api/auth/verify-code
   ↓  (code is validated, marked as used)
Step 3: POST /api/auth/reset-password
   ↓  (password is changed, all sessions revoked)
   → Redirect user to login page
```

### Complete Frontend Example

```javascript
// ── STEP 1: Request a verification code ──
async function handleForgotPassword(email) {
  const res = await fetch("/api/auth/forgot-password", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error);

  // Store userId for subsequent steps
  return data.userId;  // may be undefined if email not found
}

// ── STEP 2: Verify the code the user received ──
async function handleVerifyCode(userId, code) {
  const res = await fetch("/api/auth/verify-code", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, code }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error);

  return data.verified;  // true
}

// ── STEP 3: Set the new password ──
async function handleResetPassword(userId, password, confirmPassword) {
  const res = await fetch("/api/auth/reset-password", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, password, confirmPassword }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error);

  // Password changed successfully — redirect to login
  window.location.href = "/login";
}
```

---

## Cookie Preferences API

### GET /api/user/cookie-preferences

Retrieves the current user's cookie preferences with **30-day persistence**. Authentication is optional:

- If authenticated, preferences are returned for the logged-in user.
- If not authenticated, preferences are returned for a guest profile linked by a **secure, HTTP-only** backend cookie.

**Authentication:** Optional

**Response (example):**

```json
{
  "success": true,
  "data": {
    "preferences": {
      "essential": true,
      "analytics": false,
      "marketing": false,
      "preferences": true,
      "system_health": false
    },
    "consent_given": true,
    "consent_version": "1.0",
    "expires_at": "2026-06-08T10:35:00.000Z",
    "days_remaining": 30
  },
  "meta": {
    "requestId": "req_abc123",
    "responseTime": 45,
    "timestamp": "2026-05-09T10:35:00.000Z"
  }
}
```

---

### PUT /api/user/cookie-preferences

Saves or updates cookie preferences persisted for **30 days**.

**Authentication:** Optional

**CSRF:** Required (send `X-CSRF-Token` header; bootstrap via `GET /api/csrf-token`)

**Request body (example):**

```json
{
  "preferences": {
    "essential": true,
    "analytics": true,
    "marketing": false,
    "preferences": true,
    "system_health": true
  },
  "consent_version": "1.0"
}
```

**Response (example):**

```json
{
  "success": true,
  "message": "Cookie preferences saved successfully",
  "data": {
    "preferences": {
      "essential": true,
      "analytics": true,
      "marketing": false,
      "preferences": true,
      "system_health": true
    },
    "expires_at": "2026-06-08T10:35:00.000Z",
    "expires_in_days": 30
  },
  "meta": {
    "requestId": "req_abc123",
    "responseTime": 78,
    "timestamp": "2026-05-09T10:35:00.000Z"
  }
}
```

---

## System Health Analysis API (SuperAdmin Only)

### GET /api/admin/system/health/analysis

Provides system health analysis including cookie preference statistics.

**Authentication:** Required (SuperAdmin only)

## Session Lifecycle & Token Rotation

### Normal Flow

```
1. Login
   └─ Server creates session in DB
   └─ Sets session_token (24h) and refresh_token (7d) cookies

2. Authenticated Request
   └─ Browser auto-sends session_token cookie
   └─ Server validates token hash in DB
   └─ Returns data if valid

3. Access Token Expires (after 24h)
   └─ Server returns 401
   └─ Frontend calls POST /api/auth/refresh
   └─ Server validates refresh_token, generates new tokens
   └─ Old tokens are revoked, new cookies are set
   └─ Frontend retries the original request

4. Refresh Token Expires (after 7d)
   └─ POST /api/auth/refresh returns 401
   └─ User must log in again
```

### Token Theft Detection

```
1. User logs in on Device A → gets refresh_token_v1
2. Attacker steals refresh_token_v1
3. User refreshes on Device A → gets refresh_token_v2 (v1 is revoked)
4. Attacker tries refresh_token_v1 → SERVER DETECTS REUSE OF REVOKED TOKEN
5. Server revokes ALL sessions for this user
6. Both user and attacker must re-authenticate
```

---

## Cookie Reference

| Cookie Name      | Type     | Flags                                             | Path | Cleared On     |
| ---------------- | -------- | ------------------------------------------------- | ---- | -------------- |
| `session_token`  | Access   | `HttpOnly`, `Secure`, `SameSite=None`             | `/`  | Logout, Expiry |
| `refresh_token`  | Refresh  | `HttpOnly`, `Secure`, `SameSite=None`             | `/`  | Logout, Expiry |
| `ontap_cookie_pref_session` | GuestPref | `HttpOnly`, `Secure`, `SameSite=None`   | `/`  | Expiry |

- **HttpOnly** — Cannot be read by JavaScript (prevents XSS token theft)
- **Secure** — Only transmitted over HTTPS
- **SameSite=None** — Required for cross-origin requests (frontend on Hostinger, backend on Vercel)

---

## Frontend Integration Guide

---

## Product SQL Importer

The repository now includes a standalone importer for the phpMyAdmin dump at [products.sql](products.sql). It parses the SQL file directly, validates each row, and upserts into `Merchandise` by `name`.

### Schema Preparation

Before running the importer, apply the schema change that adds the import fields to `Merchandise`:

```bash
npx prisma migrate dev --name add_product_image_fields
npx prisma generate
```

The migration also adds a unique constraint on `Merchandise.name` so repeated imports stay idempotent.

### Script Usage

```bash
npx tsx scripts/upload-products.ts
npx tsx scripts/upload-products.ts --file ./data/products.sql
npx tsx scripts/upload-products.ts --dry-run
npx tsx scripts/upload-products.ts --verbose
npx tsx scripts/upload-products.ts --continue-on-error
```

### Behavior

- Parses `INSERT INTO products ... VALUES ...` rows from the SQL dump.
- Supports quoted strings, escaped quotes, `NULL`, empty strings, integers, floats, and millisecond timestamps.
- Maps SQL fields to `Merchandise` fields, including `front_img`, `back_img`, `variable_front_img`, `variable_back_img`, `custom_price_value`, and `date_added`.
- Uses `name` as the idempotency key and updates existing rows instead of creating duplicates.
- Preserves the existing boolean `custom_price` flag and sets it when a numeric custom price is present.
- Logs per-row progress and a final insert/update/skip/fail summary.

### Operational Notes

- Dry-run mode validates and parses without writing to the database.
- Validation failures always continue to the next product and include the product name plus the raw SQL row.
- Database errors stop the run unless `--continue-on-error` is supplied.
- The script uses `DATABASE_URL` through Prisma and disconnects cleanly after execution.

### 1. API Utility Function

Create a reusable fetch wrapper for all API calls:

```javascript
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://your-api.vercel.app";

async function apiFetch(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    credentials: "include",  // ALWAYS include this
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  return response;
}
```

### 2. Auto-Refresh on 401

```javascript
async function authenticatedFetch(endpoint, options = {}) {
  let response = await apiFetch(endpoint, options);

  if (response.status === 401) {
    // Try refreshing the session
    const refreshRes = await apiFetch("/api/auth/refresh", { method: "POST" });

    if (refreshRes.ok) {
      // Retry original request with new session
      response = await apiFetch(endpoint, options);
    } else {
      // Refresh failed — redirect to login
      window.location.href = "/login";
    }
  }

  return response;
}
```

### 3. Session Check on Page Load

```javascript
async function getCurrentUser() {
  const res = await apiFetch("/api/auth/session");
  const data = await res.json();

  if (data.authenticated) {
    return data.user;
  }

  // Try refreshing before giving up
  const refreshRes = await apiFetch("/api/auth/refresh", { method: "POST" });
  if (refreshRes.ok) {
    const retryRes = await apiFetch("/api/auth/session");
    const retryData = await retryRes.json();
    if (retryData.authenticated) return retryData.user;
  }

  return null;  // Not authenticated
}
```

### 4. Handle Rate Limiting

```javascript
async function handleApiResponse(response) {
  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After");
    const seconds = parseInt(retryAfter || "60", 10);
    alert(`Too many attempts. Please try again in ${seconds} seconds.`);
    return null;
  }

  return response.json();
}
```

### 5. Environment Variables

Set the backend URL in your frontend's `.env`:

```env
NEXT_PUBLIC_API_URL=https://your-api.vercel.app
```

### 6. Important Reminders

- **Always use `credentials: "include"`** on every fetch call — this is required for cookies to be sent and received cross-origin.
- **Never store tokens in localStorage or sessionStorage** — cookies handle everything automatically.
- **Don't manually parse cookies** — the server manages cookie creation, rotation, and deletion.
- **Handle 429 responses gracefully** — show the user a wait message and use the `Retry-After` header to determine when to allow retrying.
- **Implement auto-refresh** — when a `401` is received, call `/api/auth/refresh` before redirecting to login. This provides seamless session extension.

---

## Employee Card APIs

---

### 13. Employee Card Scan

Looks up an employee card by its serial ID (extracted from a QR code or NFC tap). Returns the card status and, if assigned, the linked employee's profile.

```
POST /api/cards/scan
```

**Authentication:** Required — `session_token` cookie. **Role:** company primary admin (`admin` company role). Supports superadmin impersonation via `superadmin_impersonation_token` cookie or `x-impersonation-token` header (effective user is resolved to the impersonated company admin).

#### Request Body

```json
{
  "serialId": "W3aFXi"
}
```

| Field      | Type     | Required | Description                                                                  |
| ---------- | -------- | -------- | ---------------------------------------------------------------------------- |
| `serialId` | `string` | Yes      | 4–64 characters. URL-safe charset: `A-Z`, `a-z`, `0-9`, `-`, `_`.           |

#### Success Response

```
HTTP/1.1 200 OK
```

```json
{ "status": "not_found" }
```
```json
{ "status": "unassigned", "serialId": "W3aFXi" }
```
```json
{
  "status": "assigned",
  "serialId": "W3aFXi",
  "user": {
    "userId": 12,
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "jobPosition": "Engineer",
    "profileUrl": "https://cdn.example.com/profiles/john.jpg"
  }
}
```

| `status`      | Meaning                                               |
| ------------- | ----------------------------------------------------- |
| `not_found`   | Serial ID does not exist in the database.             |
| `unassigned`  | Card exists but no employee is linked yet.            |
| `assigned`    | Card is linked to the employee in the `user` field.   |

#### Error Responses

| Status | Condition                         | Response Body                                                  |
| ------ | --------------------------------- | -------------------------------------------------------------- |
| `400`  | Missing or invalid serialId       | `{ "error": "..." }`                                           |
| `401`  | Missing or invalid session        | `{ "error": "Unauthorized." }`                                 |
| `403`  | Role is not `company_admin`       | `{ "error": "Forbidden. Only company admins can scan cards." }` |
| `429`  | Rate limit exceeded (60/min)      | `{ "error": "Too many scan requests. Please slow down." }`     |
| `500`  | Internal error                    | `{ "error": "An unexpected error occurred." }`                 |

#### Example (JavaScript/Fetch)

```javascript
const response = await fetch("https://your-api.vercel.app/api/cards/scan", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ serialId: "W3aFXi" }),
});

const data = await response.json();

if (response.ok) {
  if (data.status === "assigned") {
    console.log("Card belongs to:", data.user.firstName, data.user.lastName);
  } else if (data.status === "unassigned") {
    console.log("Card is unassigned — claim it for a company first.");
  } else {
    console.log("Card not found in the system.");
  }
}
```

---

### 14. Employee Card Assign (Bulk)

Associates one or more card serial IDs with the authenticated admin's company. Cards not yet in the database are created and immediately claimed. Fully atomic — the entire batch succeeds or fails together.

```
POST /api/cards/assign
```

**Authentication:** Required — `session_token` cookie. **Role:** company primary admin (`admin` company role). Supports superadmin impersonation via `superadmin_impersonation_token` cookie or `x-impersonation-token` header (effective user is resolved to the impersonated company admin).

#### Request Body

```json
{
  "serialIds": ["W3aFXi", "K9bQmZ", "A1cDef"]
}
```

| Field       | Type       | Required | Description                                                         |
| ----------- | ---------- | -------- | ------------------------------------------------------------------- |
| `serialIds` | `string[]` | Yes      | Array of 1–100 serial IDs. Each ID: 4–64 URL-safe characters.      |

Duplicate entries within the batch are silently de-duplicated.

#### Success Response

```
HTTP/1.1 200 OK
```

```json
{
  "message": "3 card(s) processed.",
  "claimed": ["A1cDef"],
  "alreadyOwned": ["W3aFXi"],
  "conflicts": [],
  "notFound": ["K9bQmZ"]
}
```

| Field          | Meaning                                                                         |
| -------------- | ------------------------------------------------------------------------------- |
| `claimed`      | Newly associated with this company.                                             |
| `alreadyOwned` | Already owned by this company (idempotent — not an error).                     |
| `conflicts`    | Owned by a **different** company — rejected.                                   |
| `notFound`     | Did not exist in the database — were **created** and claimed in the same step. |

#### Error Responses

| Status | Condition                             | Response Body                                                              |
| ------ | ------------------------------------- | -------------------------------------------------------------------------- |
| `400`  | `serialIds` is not an array           | `{ "error": "serialIds must be an array." }`                               |
| `400`  | Empty array                           | `{ "error": "serialIds must contain at least one entry." }`                |
| `400`  | Batch exceeds 100 IDs                 | `{ "error": "A maximum of 100 serial IDs may be submitted at once." }`     |
| `400`  | One or more IDs has invalid format    | `{ "error": "The following serial IDs are invalid: ...", "details": [...] }` |
| `401`  | Missing or invalid session            | `{ "error": "Unauthorized." }`                                             |
| `403`  | Role is not `company_admin`           | `{ "error": "Forbidden. Only company admins can assign cards." }`          |
| `403`  | Admin has no associated company       | `{ "error": "Your account is not associated with a company." }`            |
| `429`  | Rate limit exceeded (10/15 min)       | `{ "error": "Too many card submission requests. Please try again later." }` |
| `500`  | Internal error                        | `{ "error": "An unexpected error occurred." }`                             |

#### Example (JavaScript/Fetch)

```javascript
const response = await fetch("https://your-api.vercel.app/api/cards/assign", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ serialIds: ["W3aFXi", "K9bQmZ", "A1cDef"] }),
});

const data = await response.json();

if (response.ok) {
  console.log(`Claimed: ${data.claimed.length}`);
  if (data.conflicts.length > 0) {
    console.warn("Conflicting cards (owned by others):", data.conflicts);
  }
}
```

---

## vCard APIs

These endpoints manage a user's publicly shareable digital business card (vCard). Every authenticated user can configure and publish their own vCard page, which is accessible at `/api/vcard/<custom_uri>`.

**File uploads:** Vercel serverless functions cannot store binary files. Upload media (profile photo, cover image, service images) directly to your CDN (Cloudinary, S3, etc.) from the frontend, then pass the resulting URL to the API. For services, keep the hero image URL in `featured_image` and attach gallery assets through `media[]` (stored in `Media` table with `related_type = "service_gallery"`).

---

### 15. vCard Setup

Performs the initial vCard profile configuration. Replaces existing social links and services entirely. Use `PUT /api/vcard/profile` for subsequent partial updates.

```
POST /api/vcard/setup
```

**Authentication:** Required — any authenticated user (`user` or `company_admin`).

#### Request Body

All fields are optional. Fields that are omitted retain their current values.

```json
{
  "customUri": "jane-smith",
  "vcardName": "Jane Smith",
  "vcardDescription": "Full-stack engineer & coffee enthusiast.",
  "firstName": "Jane",
  "lastName": "Smith",
  "middleName": "Marie",
  "profTitle": "Engr.",
  "postNominal": "MSEE",
  "suffix": "Jr.",
  "jobPosition": "Software Engineer",
  "about": "I build things for the web.",
  "languages": "English, Filipino",
  "contact": "+1234567890",
  "altContact": "+0987654321",
  "altEmail": "jane.work@example.com",
  "profileUrl": "https://cdn.example.com/profiles/jane.jpg",
  "coverUrl": "https://cdn.example.com/covers/jane-cover.jpg",
  "coverImagePosition": "center top",
  "themePath": "ocean-gradient",
  "publishNow": true,
  "socials": [
    { "platform": "linkedin", "url": "https://linkedin.com/in/jane-smith", "displayOrder": 0, "isVisible": true },
    { "platform": "github",   "url": "https://github.com/janesmith",       "displayOrder": 1, "isVisible": true }
  ],
  "services": [
    {
      "name": "Web Development",
      "tagline": "Ship faster with modern stacks",
      "description": "Full-stack web applications with React and Node.js.",
      "serviceUrl": "https://jane.dev/services",
      "featured_image": "https://res.cloudinary.com/your-cloud/image/upload/v1/services/hero.jpg",
      "displayOrder": 0,
      "isVisible": true,
      "media": [
        {
          "url": "https://res.cloudinary.com/your-cloud/image/upload/v1/services/gallery-1.jpg",
          "mimeType": "image/jpeg",
          "fileName": "gallery-1.jpg",
          "displayOrder": 0
        }
      ]
    }
  ],
  "address": {
    "area": "123 Main St",
    "brgy": "Barangay 1",
    "city": "Makati",
    "region": "Metro Manila",
    "zipcode": "1200",
    "plusCode": "7GP4+52",
    "mapLink": "https://www.openstreetmap.org/?mlat=14.5547&mlon=121.0244",
    "latitude": 14.5547,
    "longitude": 121.0244
  }
}
```

**Top-level fields:**

| Field              | Type      | Description                                                                        |
| ------------------ | --------- | ---------------------------------------------------------------------------------- |
| `customUri`        | `string`  | Public URL slug. 3–64 chars, lowercase letters/digits/hyphens only. Must be unique. |
| `vcardName`        | `string`  | Display name shown on the public vCard (e.g., `"Jane Smith, Engr."`). Max 255 chars. |
| `vcardDescription` | `string`  | Short bio / tagline shown below the name.                                          |
| `firstName`        | `string`  | Max 100 chars.                                                                     |
| `lastName`         | `string`  | Max 100 chars.                                                                     |
| `middleName`       | `string`  | Max 100 chars.                                                                     |
| `profTitle`        | `string`  | Prefix title (e.g., `"Dr."`, `"Engr."`). Max 20 chars.                            |
| `postNominal`      | `string`  | Post-nominal letters (e.g., `"MD"`, `"PhD"`). Max 20 chars.                       |
| `suffix`           | `string`  | Name suffix (e.g., `"Jr."`, `"III"`). Max 10 chars.                               |
| `jobPosition`      | `string`  | Job title / position. Max 100 chars.                                               |
| `about`            | `string`  | Long bio / about section.                                                          |
| `languages`        | `string`  | Comma-separated spoken languages (e.g. `"English, Filipino"`). Max 500 chars. Stored on `Bizcard.languages`. |
| `contact`          | `string`  | Primary phone. Max 20 chars.                                                       |
| `altContact`       | `string`  | Secondary phone. Max 20 chars.                                                     |
| `altEmail`         | `string`  | Alternate email address.                                                           |
| `profileUrl`       | `string`  | Pre-uploaded profile photo URL. Must start with `http://` or `https://`.           |
| `coverUrl`         | `string`  | Pre-uploaded cover image URL. Must start with `http://` or `https://`.             |
| `coverImagePosition` | `string` | CSS `object-position` for cover image (`center top`, `center center`, `center bottom`). |
| `themePath`        | `string`  | Frontend filesystem theme slug/path (for example: `"ocean-gradient"`). Must match an existing directory in `app/themes`. |
| `publishNow`       | `boolean` | If `true`, makes the vCard publicly accessible immediately. Default: `false`.      |
| `socials`          | `array`   | Full replacement of all social links (see below). Omit to keep existing.           |
| `services`         | `array`   | Full replacement of all services (see below). Omit to keep existing.               |
| `address`          | `object`  | Address object (see below). Omit to keep existing.                                 |

**Social link object (`socials[]`):**

| Field          | Type      | Required | Description                                                                         |
| -------------- | --------- | -------- | ----------------------------------------------------------------------------------- |
| `platform`     | `string`  | Yes      | Canonical values: `facebook`, `twitter`, `instagram`, `linkedin`, `youtube`, `tiktok`, `github`, `website`, `whatsapp`, `telegram`, `snapchat`, `pinterest`, `other`. Display names and common aliases (e.g. `x`→`twitter`, `fb`→`facebook`, `ig`/`instagram_page`→`instagram`, `email`/`phone`→`other`) are accepted. Unknown/legacy platform strings from migrated data are coerced to `other` so existing social links can be saved without a 422. Empty `platform` is rejected. |
| `url`          | `string`  | Yes      | Full URL starting with `http://` or `https://`. Max 512 chars.                     |
| `displayOrder` | `number`  | No       | Ascending sort order on the public card. Default: `0`.                             |
| `isVisible`    | `boolean` | No       | If `false`, the link is stored but hidden on the public page. Default: `true`.     |

**Service object (`services[]`):**

| Field          | Type      | Required | Description                                                        |
| -------------- | --------- | -------- | ------------------------------------------------------------------ |
| `name`         | `string`  | Yes      | Service name. Max 255 chars.                                       |
| `tagline`      | `string`  | No       | Short catchy phrase shown on portfolio themes. Max 255 chars. Stored in `Service.tagline`. |
| `description`  | `string`  | Yes      | Service description.                                               |
| `serviceUrl`   | `string`  | No       | Optional external link for this service. Max 512 chars.            |
| `featured_image` | `string` | No      | Optional Cloudinary URL for the service hero image, stored in `Service.featured_image`. |
| `displayOrder` | `number`  | No       | Sort order. Default: `0`.                                          |
| `isVisible`    | `boolean` | No       | If `false`, hidden on the public page. Default: `true`.            |
| `media`        | `array`   | No       | Optional service gallery list. Each item is saved in `Media` table with `related_type = "service_gallery"` and `related_id = service_id`. |

**Address object (`address`):**

When any address field is provided, `city` is required. All other address fields are optional.

| Field      | Type     | Description                                  |
| ---------- | -------- | -------------------------------------------- |
| `area`     | `string` | Street / address line. Max 255 chars. Optional. |
| `brgy`     | `string` | Barangay / neighborhood. Max 255 chars. Optional. |
| `city`     | `string` | City. **Required** when address object is sent. Max 255 chars. |
| `region`   | `string` | State / province / region. Max 255 chars. Optional. |
| `zipcode`  | `string` | Postal code. Max 20 chars. Optional. |
| `plusCode` | `string` | Google Plus Code. Max 255 chars. Optional. |
| `mapLink`  | `string` | Map URL (`http://` or `https://`). Max 512 chars. Optional. |
| `latitude` | `number` | Latitude (-90 to 90). Optional. |
| `longitude` | `number` | Longitude (-180 to 180). Optional. |

**URL alias behavior on setup:** Completing setup claims placeholder bizcards (`is_blank: true`) and sets `last_url_alias_changed_at` when the user chooses their first non-placeholder `customUri`. Placeholder aliases matching `user-{id}` are exempt from the 90-day lock until replaced. Supports superadmin impersonation — writes use the **effective** (impersonated) user id.

**Superadmin notification:** On the first successful setup (`VCardSetup.setup_completed` transitioning to true), superadmins with `user_activity.new_registration` enabled receive a `sa_new_user_registration` notification. Email verification alone does not trigger this. Subsequent setup or profile saves do not notify again.

#### Success Response

```
HTTP/1.1 200 OK
```

```json
{
  "message": "vCard profile saved successfully.",
  "portfolioUrl": "https://www.portal.ontap.ph/jane-smith",
  "qrCode": "https://res.cloudinary.com/your-cloud/image/upload/v1/ontap/qrcodes/123/qr_code_123.png",
  "profile": {
    "user_id": "5",
    "bizcard_id": "12345",
    "first_name": "Jane",
    "last_name": "Smith",
    "email": "jane@example.com",
    "custom_uri": "jane-smith",
    "vcard_name": "Jane Smith",
    "vcard_published": true,
    "address": { "city": "Makati", "region": "Metro Manila", "..." : "..." },
    "vcardSetup": { "is_published": true, "setup_completed": true, "setup_completed_at": "2026-03-07T..." }
  }
}
```

| Field          | Description                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------- |
| `portfolioUrl` | Canonical public portfolio URL, or `null` if `customUri` / `NEXT_PUBLIC_APP_URL` is unavailable. |
| `qrCode`       | Cloudinary URL (or data URL fallback) of the **offline vCard QR** image, or `null` on failure.   |
| `profile`      | Saved user, address, socials, services, and vCard setup fields. Includes `bizcard_id` of the primary BizCard so QR signup can call `POST /api/bizcard/merge`. |

After a successful setup, the server:

1. Syncs the user profile to the primary `bizcard` row.
2. Builds vCard (VCF) contact content from bizcard fields.
3. Generates a QR code encoding that VCF payload.
4. Uploads the PNG to Cloudinary (`ontap/qrcodes/{bizcardId}`).
5. Persists the URL to `bizcard.qr_code_url` and mirrors it to `VCardSetup.qr_code`.
6. When setup was started from a Super Admin QR (`/user/signup?ref={SERIAL}`), the client must then call `POST /api/bizcard/merge` with that `profile.bizcard_id` and the scanned serial.

#### Error Responses

| Status | Condition                            | Response Body                                                                 |
| ------ | ------------------------------------ | ----------------------------------------------------------------------------- |
| `400`  | Invalid JSON body                    | `{ "error": "Invalid JSON body." }`                                           |
| `401`  | Missing or invalid session           | `{ "error": "Unauthorized." }`                                                |
| `409`  | `customUri` already taken            | `{ "error": "That custom URI is already taken. Please choose a different one." }` |
| `422`  | Input validation failed              | `{ "error": "Validation failed.", "details": ["customUri must be 3-64 characters...", "..."] }` |
| `429`  | Rate limit exceeded (10/15 min)      | `{ "error": "Too many setup requests. Please try again later." }`             |
| `500`  | Internal error                       | `{ "error": "An unexpected error occurred. Please try again." }`              |

---

### 16. Get Own vCard Profile

Returns the authenticated user's full vCard data — including hidden socials and services, all address fields, and setup status. Intended for the dashboard / profile edit view.

```
GET /api/vcard/profile
```

**Authentication:** Required — any authenticated user.

#### Request Body

None.

#### Success Response

```
HTTP/1.1 200 OK
```

```json
{
  "portfolioUrl": "https://www.portal.ontap.ph/jane-smith",
  "qrCode": "data:image/svg+xml;base64,...",
  "profile": {
    "user_id": "5",
    "first_name": "Jane",
    "last_name": "Smith",
    "email": "jane@example.com",
    "custom_uri": "jane-smith",
    "vcard_name": "Jane Smith",
    "vcard_description": "Full-stack engineer.",
    "vcard_published": true,
    "prof_title": "Engr.",
    "post_nominal": "MSEE",
    "suffix": null,
    "job_position": "Software Engineer",
    "about": "I build things for the web.",
    "contact": "+1234567890",
    "alt_contact": null,
    "alt_email": null,
    "profile_url": "https://cdn.example.com/profiles/jane.jpg",
    "cover_url": null,
    "theme_path": "ocean-gradient",
    "registration_type": "individual",
    "socials": [
      { "socials_id": "1", "platform": "linkedin", "url": "https://linkedin.com/in/jane-smith", "display_order": 0, "is_visible": true }
    ],
    "services": [
      {
        "service_id": "3",
        "name": "Web Development",
        "description": "...",
        "service_url": null,
        "display_order": 0,
        "is_visible": true,
        "serviceMedia": []
      }
    ],
    "addresses": [
      { "address_id": "2", "area": "123 Main St", "brgy": "Barangay 1", "city": "Makati", "region": "Metro Manila", "zipcode": "1200", "plus_code": null }
    ],
    "vcardSetup": { "id": "1", "is_published": true, "setup_completed": true, "setup_completed_at": "2026-03-07T..." }
  }
}
```

> **Note:** All `BigInt` values are returned as **strings** (e.g., `"5"` instead of `5`). Parse them with `BigInt()` or use them as strings for display.

#### Error Responses

| Status | Condition                   | Response Body                    |
| ------ | --------------------------- | -------------------------------- |
| `401`  | Missing or invalid session  | `{ "error": "Unauthorized." }`   |
| `404`  | User not found (edge case)  | `{ "error": "Profile not found." }` |
| `429`  | Rate limit exceeded         | `{ "error": "Too many requests. Please slow down." }` |
| `500`  | Internal error              | `{ "error": "An unexpected error occurred." }` |

#### Example (JavaScript/Fetch)

```javascript
const response = await fetch("https://your-api.vercel.app/api/vcard/profile", {
  method: "GET",
  credentials: "include",
});

const { profile } = await response.json();
console.log("My vCard:", profile.vcard_name, profile.custom_uri);
console.log("Socials:", profile.socials);
```

---

### 17. Update vCard Profile

Partially updates the authenticated user's vCard. Only fields present in the request body are modified. Providing `socials` or `services` arrays replaces the entire existing set atomically; omitting them leaves them unchanged.

**Migrated / legacy social platforms:** When `socials` is sent, unknown platform values (and known aliases such as `email`, `phone`, `instagram_page`) are coerced to an allow-listed slug (typically `other`) instead of failing validation. This allows existing users from the old database to Save Changes without a `422` platform allow-list error. URL format rules still apply.

```
PUT /api/vcard/profile
```

**Authentication:** Required — any authenticated user. Supports superadmin impersonation via `superadmin_impersonation_token` cookie or `x-impersonation-token` header; writes target the **effective** (impersonated) user.

#### Request Body

Same shape as `POST /api/vcard/setup` — all fields optional. Include only what you want to change.

```json
{
  "vcardDescription": "Updated bio.",
  "publishNow": true
}
```

```json
{
  "themePath": "charcoal-yellow"
}
```

When `themePath` is included, the server immediately invalidates the public profile cache keys (`public:profile:{alias}`) for the user's `custom_uri`, `url_alias`, and `serial_id`, so `GET /api/public/[alias]` reflects the new theme without waiting for the 60-second TTL.

**Public cache invalidation:** Every successful `PUT /api/vcard/profile` (including name-only, socials-only, and theme updates) invalidates `public:profile:{alias}` for the owner's `custom_uri`, `url_alias`, and `serial_id`, so public portfolio reads reflect profile changes across devices without waiting for the 60-second Redis/CDN TTL.

```json
{
  "socials": [
    { "platform": "github", "url": "https://github.com/janesmith", "displayOrder": 0, "isVisible": true }
  ]
}
```

> Sending `"socials": []` is valid and will **delete all social links**.

**URL alias (`customUri`) behavior on update:**
- If `customUri` is omitted, or matches the user's existing alias (case-insensitive), format validation and the 90-day lock are **not** applied. This allows profile/design saves when a legacy stored alias would not pass the current format regex.
- If `customUri` is a **new** value, format validation (3–64 chars, lowercase letters/digits/hyphens) and uniqueness still apply.
- Normal users remain subject to the 90-day lock (`403` / `URL_ALIAS_LOCKED`) when changing the alias.
- Under active Super Admin impersonation, the 90-day lock is bypassed (full authority); format and uniqueness checks still apply.
- Audit metadata includes `effective_user_id` and, when impersonating, `impersonation_token_id` / `impersonation_target_user_id`.

#### Success Response

```
HTTP/1.1 200 OK
```

```json
{
  "message": "Profile updated successfully.",
  "profile": { "...full profile object (same shape as GET /api/vcard/profile)..." }
}
```

#### Error Responses

| Status | Condition                        | Response Body                                                                 |
| ------ | -------------------------------- | ----------------------------------------------------------------------------- |
| `400`  | Invalid JSON body                | `{ "error": "Invalid JSON body." }`                                           |
| `401`  | Missing or invalid session       | `{ "error": "Unauthorized." }`                                                |
| `403`  | URL alias locked (90-day rule)   | `{ "error": "URL alias can be changed again in N days.", "code": "URL_ALIAS_LOCKED", ... }` |
| `409`  | `customUri` already taken        | `{ "error": "That custom URI is already taken. Please choose a different one." }` |
| `422`  | Input validation failed          | `{ "error": "Validation failed.", "details": ["..."] }`                       |
| `429`  | Rate limit exceeded (30/min)     | `{ "error": "Too many update requests. Please slow down." }`                  |
| `500`  | Internal error                   | `{ "error": "An unexpected error occurred. Please try again." }`              |

#### Example (JavaScript/Fetch)

```javascript
// Toggle publish status
const response = await fetch("https://your-api.vercel.app/api/vcard/profile", {
  method: "PUT",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ publishNow: true }),
});

const { profile } = await response.json();
console.log("Published:", profile.vcard_published);
```

---

### 18. Public vCard Profile

Returns a published user's public vCard data using **serial-first URI resolution**.

Resolution priority:
1. Try `[uri]` as `serial_id`.
2. If serial exists and linked user has `custom_uri`, respond with `308` redirect to the canonical custom URI URL.
3. If serial does not exist, treat `[uri]` as `custom_uri` and return the public profile payload.

```
GET /api/vcard/[uri]
```

**Authentication:** None (public endpoint).

#### URL Parameters

| Parameter | Description                                                                 |
| --------- | --------------------------------------------------------------------------- |
| `uri`     | Can be a BizCard `serial_id` (e.g., `x3ERqY`) or a `custom_uri` (e.g., `jane-smith`). |

#### Example Requests

```
GET /api/vcard/x3ERqY
GET /api/vcard/jane-smith
```

#### Canonical Redirect Response (Serial ID Hit)

```
HTTP/1.1 308 Permanent Redirect
Location: https://www.portal.ontap.ph/jane-smith
```

#### Success Response

```
HTTP/1.1 200 OK
```

```json
{
  "profile": {
    "user_id": "5",
    "first_name": "Jane",
    "last_name": "Smith",
    "middle_name": null,
    "custom_uri": "jane-smith",
    "vcard_name": "Jane Smith",
    "vcard_description": "Full-stack engineer.",
    "prof_title": "Engr.",
    "post_nominal": "MSEE",
    "suffix": null,
    "job_position": "Software Engineer",
    "about": "I build things for the web.",
    "contact": "+1234567890",
    "alt_contact": null,
    "alt_email": null,
    "profile_url": "https://cdn.example.com/profiles/jane.jpg",
    "cover_url": null,
    "registration_type": "individual",
    "theme_path": "ocean-gradient",
    "socials": [
      { "socials_id": "1", "platform": "linkedin", "url": "https://linkedin.com/in/jane-smith", "display_order": 0 }
    ],
    "services": [
      {
        "service_id": "3",
        "name": "Web Development",
        "description": "Full-stack web applications.",
        "service_url": null,
        "display_order": 0,
        "serviceMedia": []
      }
    ],
    "addresses": [
      { "area": "123 Main St", "brgy": "Barangay 1", "city": "Makati", "region": "Metro Manila", "zipcode": "1200", "plus_code": null }
    ]
  }
}
```

| Field         | Description                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------- |
| `portfolioUrl`| Canonical public portfolio URL for the profile, or `null` if app URL is not configured.         |
| `qrCode`      | Base64 SVG data URL of the profile's QR code, or `null` when unavailable.                        |
| `profile`     | Public profile payload for rendering the portfolio page.                                          |

**Privacy rules applied automatically:**
- Profiles where `vcard_published = false` return `404`
- Inactive accounts (`is_active = false`) return `404`
- Social links with `is_visible = false` are excluded
- Services with `is_visible = false` are excluded
- Serial IDs are canonicalized to custom URI via `308` redirect when available
- A `source: "vcard_view"` analytics record is created (non-blocking, fire-and-forget)

#### Error Responses

| Status | Condition                                               | Response Body                       |
| ------ | ------------------------------------------------------- | ----------------------------------- |
| `308`  | URI matched a serial ID with a canonical custom URI     | Redirect to `https://www.portal.ontap.ph/{custom_uri}` |
| `404`  | URI not found, profile unpublished, inactive, or deactivated card | `{ "error": "Profile not found." }` |
| `429`  | Rate limit exceeded (120/min)                           | `{ "error": "Too many requests. Please slow down." }` |
| `500`  | Internal error                                          | `{ "error": "An unexpected error occurred. Please try again." }` |

> Both "not found" and "unpublished" conditions return the same `404` response to prevent leaking whether a given URI belongs to a registered user.

#### Example (JavaScript/Fetch)

```javascript
const uri = "x3ERqY"; // can be serial_id or custom_uri
const response = await fetch(`https://your-api.vercel.app/api/vcard/${uri}`, {
  redirect: "follow",
});

if (response.ok) {
  const { profile } = await response.json();
  renderVCard(profile);
} else if (response.status === 404) {
  show404Page();
}
```

---

### 19. Deployment Health Check

Returns a full diagnostic snapshot of the deployed server — environment variables, database connectivity, runtime info, and CORS configuration. Use this to verify a deployment is healthy or to debug infrastructure issues.

```
GET /api/health
```

**Authentication:** Required — `Authorization: Bearer <HEALTH_CHECK_SECRET>` or `Authorization: Bearer <ONTAP_API_KEY>`. Query-string credentials (`?key=`, `?token=`) are rejected with `401`.

> This endpoint is **never called by the frontend application**. It is used post-deployment by developers and CI pipelines.

#### Request Headers

```
Authorization: Bearer <HEALTH_CHECK_SECRET>
```

#### Success Response (all systems operational)

```
HTTP/1.1 200 OK
```

```json
{
  "status": "ok",
  "timestamp": "2026-03-10T10:00:00.000Z",
  "checks": {
    "runtime": {
      "nodeVersion": "v20.9.0",
      "nodeEnv": "production",
      "platform": "linux",
      "region": "iad1",
      "vercelEnv": "production",
      "deploymentUrl": "ontap-server-xyz.vercel.app"
    },
    "envVars": {
      "DATABASE_URL":        { "present": true,  "critical": true,  "value": "mysql://u517833616_ontapdevs:***@153.92.15.17:3306/u517833616_newontap" },
      "JWT_SECRET":          { "present": true,  "critical": true,  "value": "***configured***" },
      "ALLOWED_ORIGINS":     { "present": true,  "critical": true,  "value": "https://yourdomain.com,..." },
      "SMTP_HOST":           { "present": true,  "critical": false, "value": "smtp.gmail.com" },
      "SMTP_PORT":           { "present": true,  "critical": false, "value": "465" },
      "SMTP_USER":           { "present": true,  "critical": false, "value": "ontap.productinquiry@gmail.com" },
      "SMTP_PASS":           { "present": true,  "critical": false, "value": "***configured***" },
      "SMTP_FROM":           { "present": true,  "critical": false, "value": "ontap.productinquiry@gmail.com" },
      "EMAIL_FROM_ADDRESS":  { "present": true,  "critical": false, "value": "ontap.productinquiry@gmail.com" },
      "EMAIL_FROM_NAME":     { "present": true,  "critical": false, "value": "OnTap Team" },
      "EMAIL_PROVIDER":      { "present": true,  "critical": false, "value": "smtp" },
      "NEXT_PUBLIC_APP_URL": { "present": true,  "critical": false, "value": "http://localhost:3000" },
      "NODE_ENV":            { "present": true,  "critical": false, "value": "production" },
      "ONTAP_API_KEY":       { "present": true,  "critical": false, "value": "***configured***" }
    },
    "database": {
      "connected": true,
      "latencyMs": 42
    },
    "cors": {
      "allowedOrigins": [
        "https://yourdomain.com",
        "https://www.yourdomain.com",
        "http://localhost:3000"
      ]
    },
    "smtp": {
      "provider": "smtp",
      "configured": true,
      "connected": true,
      "host": "smtp.gmail.com",
      "port": 465,
      "secure": true,
      "fromAddress": "ontap.productinquiry@gmail.com",
      "latencyMs": 42
    }
  }
}
```

When SMTP credentials are incomplete or `verify()` fails, `checks.smtp.connected` is `false` and `errorMessage` contains a safe provider error string.

#### Degraded Response (database unreachable)

```
HTTP/1.1 503 Service Unavailable
```

```json
{
  "status": "degraded",
  "timestamp": "2026-03-10T10:00:00.000Z",
  "checks": {
    "database": {
      "connected": false,
      "errorType": "PrismaClientInitializationError",
      "errorMessage": "Can't reach database server at 153.92.15.17:3306",
      "errorCode": "P1001",
      "prismaCode": "6.8.2"
    }
  }
}
```

#### Error Responses

| Status | Condition                          | Response Body                                              |
| ------ | ---------------------------------- | ---------------------------------------------------------- |
| `401`  | Missing or incorrect API key       | `{ "error": "Unauthorized. Provide a valid API key." }`    |
| `503`  | Any critical check failed          | Full diagnostic JSON (same shape as 200, `status: "degraded"`) |

#### Overall Status Logic

| `status`    | Meaning                                                                       |
| ----------- | ----------------------------------------------------------------------------- |
| `"ok"`      | All critical env vars are set **and** database is connected.                  |
| `"degraded"`| At least one critical env var is missing **or** the database is unreachable.  |

#### Deployment Test Script

Run this from the terminal after every deployment to validate the full stack:

```cmd
set TEST_BASE_URL=https://ontap-server.vercel.app&&set ONTAP_API_KEY=<your-key>&&npm run test:deployment
```

The test script (`tests/deployment.test.ts`) checks the health endpoint, runs login smoke tests, and verifies CORS headers. Exit code `1` means at least one check failed.

#### Hostinger Deployment Stability (Chunk Load Recovery)

After redeploying to Hostinger, browsers may briefly reference stale `/_next/static/chunks/*.js` files from a previous build. Missing chunks return `404` with `text/plain`, which triggers `ChunkLoadError` and can make the dashboard appear down until a full refresh.

**hPanel Node.js Web App settings:**

| Setting | Required value |
| ------- | -------------- |
| Branch | `full-build` (or your production branch) |
| Node version | 20.x LTS |
| Build command | `npm run build` |
| Start command | `npm run start` |
| Application root | Repository root (where `package.json` lives) |
| `NODE_ENV` | `production` (set in hPanel env vars, not `development` from `.env`) |

Use **`npm run build`**, not bare `next build`. The build script runs `scripts/production-build.mjs`, which forces `NODE_ENV=production`, wipes `.next` before building, and runs `scripts/verify-next-build.mjs` after a successful build.

**Post-build verification (`scripts/verify-next-build.mjs`):**

Expected log output on success:

```
[HOSTINGER_BUILD] BUILD_ID=<hash>
[HOSTINGER_BUILD] Found N chunk file(s) in .next/static/chunks/
[HOSTINGER_BUILD] Sampled 5 chunk file(s) — all present and non-empty.
[HOSTINGER_BUILD] Build verification passed.
```

If verification fails, the build exits non-zero so Hostinger does not mark a broken deploy as healthy.

**Built-in recovery (frontend):**

- `lib/chunk-reload.ts` — shared cache-bust reload helper (`?v=<timestamp>`).
- `app/components/ChunkLoadRecovery.tsx` listens for `ChunkLoadError` and failed `/_next/static/chunks/` script loads.
- On detection, the app performs **one** guarded cache-busting reload per browser session (`sessionStorage` key: `ontap:chunk-reload`).
- `app/global-error.tsx` shows **Refresh page** for chunk-related failures and uses the same cache-bust reload.

**Cache headers (`next.config.ts`):**

| Route | `Cache-Control` | Purpose |
| ----- | --------------- | ------- |
| `/_next/static/:path*` | `public, max-age=31536000, immutable` | Content-hashed chunks are safe to cache long-term |
| App HTML routes | `no-store, must-revalidate` | Avoid caching HTML that references outdated chunk hashes |

**Atomic Hostinger redeploy procedure (hPanel Git deploy):**

1. In hPanel: clear build cache / redeploy from scratch.
2. Confirm build log shows `npm run build` completing with `[HOSTINGER_BUILD] Build verification passed.`
3. Confirm start command is `npm run start` (binds to Hostinger `PORT`, default `3000`).
4. Verify a chunk URL returns `200` with `Content-Type: application/javascript`:
   `curl -I https://<your-hostinger-domain>/_next/static/chunks/<chunk-from-build>.js`

**Atomic Hostinger redeploy procedure (manual SFTP + PM2):**

1. Build locally: `npm run build` (cleans `.next` before building via `scripts/production-build.mjs`).
2. On server: `pm2 stop ontap`.
3. Delete the remote `.next` directory entirely, then upload the new `.next` folder in one pass (do not merge incrementally).
4. Restart: `pm2 restart ontap`.
5. Verify a chunk URL returns `200` with `Content-Type: application/javascript`:
   `curl -I https://<your-hostinger-domain>/_next/static/chunks/<chunk-from-build>.js`

**Apache `.htaccess` requirements (`public/.htaccess`):**

- Proxy non-file requests to `http://127.0.0.1:3000` (see `LOCAL_API_TUTORIAL.md`).
- Pass through `/_next/` routes to Node (do not answer missing chunks with a filesystem 404 page).
- Do **not** use `ErrorDocument 404 /index.html` — serving HTML for missing `.js` files causes MIME type errors and `ChunkLoadError`.

**Troubleshooting:**

| Symptom | Likely cause | Fix |
| ------- | ------------ | --- |
| `404` + `text/plain` on `/_next/static/chunks/*.js` | Missing chunk or Apache 404 page | Atomic redeploy; ensure `public/.htaccess` proxies to Node |
| `ChunkLoadError` immediately after deploy | Stale cached HTML | Hard refresh; recovery reload runs once per session |
| Build passes but site is blank | Wrong start command or `PORT` | Use `npm run start`; set `NODE_ENV=production` in hPanel |
| `[HOSTINGER_BUILD]` verification fails | Incomplete `.next` output | Clear build cache; use `npm run build` not `next build` |

**Error monitoring:** Client chunk failures are classified as `high` severity when reported to `POST /api/monitoring/error-log` (see [Client Error Logging](#client-error-logging)).

---

## vCard Profile Flow

```
Step 1: POST /api/vcard/setup
   ↓  (full profile configured, sets setup_completed = true)

Step 2: PUT /api/vcard/profile   ← repeat as needed for edits
   ↓  (partial updates; use publishNow: true to go live)

Step 3: GET /api/vcard/<custom_uri>  ← public visitors
   ↓  (public read, no auth, only available when vcard_published = true)
```

### File Upload Flow

Because the backend runs on Vercel serverless (no disk storage), media files must be uploaded to a CDN before calling the vCard APIs:

```
1. Frontend calls your CDN's upload API (Cloudinary, S3, etc.)
   ↓  (get back a secure URL, e.g. "https://res.cloudinary.com/demo/image/upload/v1/profile.jpg")

2. Frontend calls POST /api/vcard/setup or PUT /api/vcard/profile
   with { "profileUrl": "https://res.cloudinary.com/..." }
   ↓  (API validates URL format and stores it)

3. Public vCard page loads the image directly from the CDN URL
```

### Complete Frontend Example

```javascript
// ── Initial setup (wizard) ──
async function handleVCardSetup(formData, profileFile) {
  // Step 1: Upload photo to Cloudinary (or S3)
  let profileUrl = null;
  if (profileFile) {
    const upload = await uploadToCDN(profileFile);
    profileUrl = upload.secure_url;
  }

  // Step 2: POST setup with all profile data + CDN URL
  const res = await fetch("/api/vcard/setup", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...formData,
      profileUrl,
      publishNow: false,   // save as draft first
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    if (res.status === 422) {
      // Show validation errors
      data.details.forEach((err) => console.error(err));
    }
    throw new Error(data.error);
  }

  console.log("Profile saved. Custom URI:", data.profile.custom_uri);
}

// ── Publish / unpublish toggle ──
async function togglePublish(publish) {
  const res = await fetch("/api/vcard/profile", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publishNow: publish }),
  });
  const data = await res.json();
  console.log("Published:", data.profile.vcard_published);
}

// ── Load public vCard (for visitors) ──
async function loadPublicVCard(uri) {
  const res = await fetch(`/api/vcard/${uri}`);
  if (!res.ok) return null;
  const { profile } = await res.json();
  return profile;
}
```

---

## Portfolio Interaction APIs

These endpoints power public engagement on a user's portfolio page — views, contact saves, connection requests, inquiries, and owner analytics. Most are public (no auth required) but support optional authentication to enrich analytics.

---

### 20. Track Portfolio View

Records a page-view event for a published portfolio. Called by the frontend immediately after rendering a public portfolio page. Anonymous and authenticated visits are both recorded, with deduplication to prevent inflation.

```
POST /api/portfolio/[uri]/view
```

**Authentication:** None (public endpoint). Optional — if a valid `session_token` cookie is present the visitor's `user_id` is stored for richer owner analytics.

#### URL Parameters

| Parameter | Description                                             |
| --------- | ------------------------------------------------------- |
| `uri`     | The portfolio owner's `custom_uri` slug (e.g., `jane-smith`). |

#### Request Body

All fields are optional. An empty body is valid.

```json
{
  "sessionId":  "550e8400-e29b-41d4-a716-446655440000",
  "deviceType": "mobile",
  "browser":    "Chrome",
  "os":         "Android",
  "referrer":   "https://www.google.com/"
}
```

| Field        | Type     | Description                                                                         |
| ------------ | -------- | ----------------------------------------------------------------------------------- |
| `sessionId`  | `string` | A UUID v4 generated once and persisted in `localStorage`. Used for anonymous deduplication. |
| `deviceType` | `string` | Parsed from `navigator.userAgent`. Max 50 chars.                                    |
| `browser`    | `string` | Browser name. Max 100 chars.                                                        |
| `os`         | `string` | OS name. Max 100 chars.                                                             |
| `referrer`   | `string` | `window.document.referrer`. Max 512 chars.                                          |

Server also enriches analytics from request headers when available (`user-agent`, `x-vercel-ip-country`, `x-vercel-ip-city`, `x-vercel-ip-latitude`, `x-vercel-ip-longitude`).

#### Deduplication Rules

Views are suppressed (not recorded) when any of the following is true within a **30-minute window**:

1. Same logged-in user already viewed the same portfolio in the last 30 minutes.
2. Same `sessionId` already viewed the same portfolio in the last 30 minutes.

#### IP Privacy

The raw client IP is never persisted as-is. The API stores:

- A keyed HMAC-SHA256 hash (`visitor_ip_hash`) for secure dedup logic.
- An anonymized network prefix (`visitor_ip_prefix`) for coarse unique-visitor counting and analytics grouping.

#### Success Response

```
HTTP/1.1 200 OK
```

```json
{ "tracked": true }
```

or (when deduplicated):

```json
{ "tracked": false, "reason": "duplicate" }
```

or (when portfolio is not published/found):

```json
{ "tracked": false, "reason": "not_found" }
```

| `tracked` | `reason`     | Meaning                                                              |
| --------- | ------------ | -------------------------------------------------------------------- |
| `true`    | —            | View was recorded.                                                   |
| `false`   | `duplicate`  | Suppressed — same visitor already counted in the dedup window.      |
| `false`   | `not_found`  | Portfolio does not exist, is unpublished, or account is inactive.   |

#### Error Responses

| Status | Condition                         | Response Body                                      |
| ------ | --------------------------------- | -------------------------------------------------- |
| `429`  | Rate limit exceeded (30/min)      | `{ "error": "Too many requests. Please slow down." }` |
| `500`  | Internal error                    | `{ "error": "An unexpected error occurred." }`     |

#### Example (JavaScript/Fetch)

```javascript
// Call this on mount of the public portfolio page component
async function trackPortfolioView(uri) {
  let sessionId = localStorage.getItem("ontap_session_id");
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem("ontap_session_id", sessionId);
  }

  await fetch(`/api/portfolio/${uri}/view`, {
    method:      "POST",
    credentials: "include",                          // sends session cookie if logged in
    headers:     { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      deviceType: /Mobi|Android/i.test(navigator.userAgent) ? "mobile" : "desktop",
      referrer:   document.referrer.slice(0, 512),
    }),
  });
  // Fire-and-forget — never block page render on this call
}
```

#### Frontend Integration

| Consumer | Location | Behavior |
| -------- | -------- | -------- |
| Public portfolio page | `app/[alias]/AliasPageClient.tsx` | Calls `trackPortfolioView(alias)` on mount via `app/themes/shared.tsx` when the resolved alias is ready. |
| Shared helper | `app/themes/shared.tsx` | Persists `ontap_session_id` in `localStorage`, sends optional `deviceType`, `browser`, `os`, and `referrer`. Fire-and-forget; never blocks render. |

Increments `metrics.totalViews` on `GET /api/dashboard` for the portfolio owner.

**Implementation note:** Analytics writes use columns present in the live `PortfolioView` table (`portfolio_owner_id`-scoped). The Prisma analytics schema is kept aligned with the deployed analytics database (no `bizcard_id` column on legacy tables).

---

### 21. Record Contact Save

Records a contact-save event when a visitor clicks "Save Contact", downloads the `.vcf` file, or taps "Add to Contacts". Contributes to the portfolio owner's analytics.

```
POST /api/portfolio/[uri]/save-contact
```

**Authentication:** None (public endpoint). Optional — session cookie enriches analytics.

#### URL Parameters

| Parameter | Description                                    |
| --------- | ---------------------------------------------- |
| `uri`     | The portfolio owner's `custom_uri` slug.       |

#### Request Body

```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "saveType":  "vcf",
  "deviceType": "mobile",
  "browser": "Chrome",
  "os": "Android",
  "referrer": "https://www.google.com/"
}
```

| Field       | Type     | Description                                                                    |
| ----------- | -------- | ------------------------------------------------------------------------------ |
| `sessionId` | `string` | Optional. Same UUID used for view tracking. Used for dedup.                    |
| `saveType`  | `string` | `"vcf"` (default) — `.vcf` download. `"phone"` — added via phone UI prompt.   |
| `deviceType` | `string` | Optional visitor device type. Max 50 chars.                                      |
| `browser`    | `string` | Optional browser name. Max 100 chars.                                             |
| `os`         | `string` | Optional OS name. Max 100 chars.                                                  |
| `referrer`   | `string` | Optional referrer URL. Max 512 chars.                                             |

Server also enriches analytics from request headers when available (`user-agent`, `x-vercel-ip-country`, `x-vercel-ip-city`, `x-vercel-ip-latitude`, `x-vercel-ip-longitude`) and stores an anonymized `visitor_ip_prefix`.

#### Deduplication

The same visitor (by `user_id` or `sessionId`) saving the same contact within a **24-hour window** is recorded only once.

#### Success Response

```
HTTP/1.1 200 OK
```

```json
{ "recorded": true }
```

or:

```json
{ "recorded": false, "reason": "duplicate" }
```

```json
{ "recorded": false, "reason": "not_found" }
```

#### Error Responses

| Status | Condition                    | Response Body                                         |
| ------ | ---------------------------- | ----------------------------------------------------- |
| `429`  | Rate limit exceeded (30/min) | `{ "error": "Too many requests. Please slow down." }` |
| `500`  | Internal error               | `{ "error": "An unexpected error occurred." }`        |

#### Frontend Integration

| Consumer | Location | Behavior |
| -------- | -------- | -------- |
| Save Contact buttons | All portfolio themes via `downloadVCard()` in `app/themes/shared.tsx` | After generating the `.vcf` download, calls `recordContactSave(urlAlias, "vcf")` → `POST /api/portfolio/[uri]/save-contact`. |
| Shared helper | `app/themes/shared.tsx` | Reuses the same `ontap_session_id` as view tracking for deduplication. Fire-and-forget. |

Increments `metrics.totalContactSaves` on `GET /api/dashboard` for the portfolio owner.

---

### 22. Send Connection Request

Sends a connection request from the authenticated user to the portfolio owner. Requires the visitor to be logged in.

```
POST /api/portfolio/[uri]/connect
```

**Authentication:** Required — `session_token` cookie.

#### URL Parameters

| Parameter | Description                              |
| --------- | ---------------------------------------- |
| `uri`     | The recipient's `custom_uri` slug.       |

#### Request Body

```json
{
  "relationshipType": "associate"
}
```

| Field              | Type     | Required | Description                                                         |
| ------------------ | -------- | -------- | ------------------------------------------------------------------- |
| `relationshipType` | `string` | No       | `"friend"` (default) or `"associate"`.                              |

#### Business Rules

- A user cannot connect with themselves.
- Only one active request is allowed per requester–recipient pair, regardless of direction.
- A `"blocked"` status from the recipient prevents new requests from the same sender.
- Declined requests can be re-requested (the old declined record is replaced with a new `pending` one).
- `"accepted"` connections cannot be re-requested — the users are already connected.

#### Success Response

```
HTTP/1.1 201 Created
```

```json
{
  "connectionId":     "42",
  "status":           "pending",
  "message":          "Connection request sent."
}
```

> `connectionId` is a BigInt serialized as a string.

#### Error Responses

| Status | Condition                                                | Response Body                                                        |
| ------ | -------------------------------------------------------- | -------------------------------------------------------------------- |
| `401`  | Not authenticated                                        | `{ "error": "You must be logged in to connect with someone.", "requiresAuth": true }` |
| `404`  | Portfolio not found / not published                      | `{ "error": "Portfolio not found." }`                                |
| `409`  | Connection already exists (pending, accepted, or blocked)| `{ "error": "A connection already exists between you and this user." }` |
| `422`  | Attempted to connect with yourself                       | `{ "error": "You cannot send a connection request to yourself." }`   |
| `429`  | Rate limit exceeded (5/15 min)                           | `{ "error": "Too many connection requests. Please try again later." }` |
| `500`  | Internal error                                           | `{ "error": "An unexpected error occurred." }`                       |

#### Side Effects

On successful creation or re-request (`201`):

- Invalidates in-memory connection list/summary caches for both requester and recipient.
- Dispatches an in-app notification (`friend_request_sent`) and immediate email to the portfolio owner (parity with `POST /api/connections/request/send`).
- Writes a dashboard activity log entry (`NEW_CONNECTION`) for the portfolio owner.

#### Example (JavaScript/Fetch)

```javascript
const response = await fetch(`/api/portfolio/${uri}/connect`, {
  method:      "POST",
  credentials: "include",
  headers:     { "Content-Type": "application/json" },
  body: JSON.stringify({ relationshipType: "associate" }),
});

const data = await response.json();

if (response.status === 201) {
  showToast("Connection request sent!");
} else if (response.status === 401 && data.requiresAuth) {
  redirectToLogin();
} else if (response.status === 409) {
  showToast("You already have a connection with this person.");
}
```

---

### 23. Submit Visitor Inquiry

Sends a contact message from a visitor to the portfolio owner. Works for both anonymous and authenticated visitors.

```
POST /api/portfolio/[uri]/inquire
```

**Authentication:** None (public endpoint). Optional — session cookie enriches analytics.

#### URL Parameters

| Parameter | Description                              |
| --------- | ---------------------------------------- |
| `uri`     | The recipient's `custom_uri` slug.       |

#### Request Body

```json
{
  "name":      "Maria Santos",
  "email":     "maria@example.com",
  "message":   "Hi, I'd love to discuss a potential project with you.",
  "subject":   "Project Inquiry",
  "phone":     "+63 912 345 6789",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

| Field       | Type     | Required | Description                                                           |
| ----------- | -------- | -------- | --------------------------------------------------------------------- |
| `name`      | `string` | Yes      | Sender's name. Max 255 chars.                                         |
| `email`     | `string` | Yes      | Sender's email address. Max 191 chars.                                |
| `message`   | `string` | Yes      | Message body. Min 10 chars, max 5000 chars. HTML is stripped server-side. |
| `subject`   | `string` | No       | Inquiry subject line. Max 255 chars.                                  |
| `phone`     | `string` | No       | Sender's phone number. Max 50 chars.                                  |
| `sessionId` | `string` | No       | For analytics correlation. Same UUID used in view tracking.           |

#### Success Response

```
HTTP/1.1 201 Created
```

```json
{
  "inquiryId": "17",
  "message":   "Your inquiry has been sent. The portfolio owner will reach out to you.",
  "linkedAccount": true
}
```

| Field           | Type      | Description |
| --------------- | --------- | ----------- |
| `inquiryId`     | `string`  | Created inquiry ID (BigInt serialized as string). |
| `message`       | `string`  | Human-readable success message for visitor UI. |
| `linkedAccount` | `boolean` | `true` when the visitor had an active session and `sender_user_id` was linked. |

New inquiries are stored with workflow status `new` (and `read_flag: false`) for owner inbox prioritization.

> `inquiryId` is a BigInt serialized as a string.

> **Session linking:** Send requests with `credentials: "include"` so the `session_token` cookie is included. When present, the inquiry is linked to the visitor's account via `sender_user_id`, allowing the portfolio owner to view registered sender details in their inbox.

> **Frontend integration:** Portfolio themes use the global `showToast()` helper from `ToastProvider` (mounted in `app/layout.tsx`) to display a success popup after `201 Created`.

#### Error Responses

| Status | Condition                               | Response Body                                                               |
| ------ | --------------------------------------- | --------------------------------------------------------------------------- |
| `400`  | No request body provided                | `{ "error": "Request body is required." }`                                  |
| `404`  | Portfolio not found / not published     | `{ "error": "Portfolio not found." }`                                       |
| `422`  | Validation failed                       | `{ "error": "...", "errors": ["Name is required.", "..."] }`                |
| `429`  | Rate limit exceeded (5/15 min)          | `{ "error": "Too many messages sent. Please wait before trying again." }`   |
| `500`  | Internal error                          | `{ "error": "An unexpected error occurred." }`                              |

> The rate limit is deliberately tight (5 per 15 minutes) to deter spam campaigns.

#### Example (JavaScript/Fetch)

```javascript
const response = await fetch(`/api/portfolio/${uri}/inquire`, {
  method:      "POST",
  credentials: "include",
  headers:     { "Content-Type": "application/json" },
  body: JSON.stringify({
    name:    "Maria Santos",
    email:   "maria@example.com",
    message: "Hi, I'd love to discuss a project with you.",
    subject: "Project Inquiry",
  }),
});

const data = await response.json();

if (response.status === 201) {
  showToast({ message: data.message || "Message sent! The owner will be in touch.", type: "success" });
} else if (response.status === 422) {
  data.errors.forEach((e) => showFieldError(e));
}
```

---

### 24. Portfolio Analytics

Returns aggregated engagement statistics for the authenticated user's own portfolio. Scoped strictly to the calling user — one user cannot read another's analytics.

```
GET /api/portfolio/[uri]/analytics
```

**Authentication:** Required — `session_token` cookie.

> **IDOR protection:** The server verifies that the URI in the path belongs to the authenticated user. If the URI exists but belongs to a different user, the response is `403 Forbidden`.

#### URL Parameters

| Parameter | Description                              |
| --------- | ---------------------------------------- |
| `uri`     | Must match the authenticated user's own `custom_uri`. |

#### Success Response

```
HTTP/1.1 200 OK
```

```json
{
  "overview": {
    "totalViews":           1024,
    "uniqueVisitors":       312,
    "contactsSaved":        88,
    "connectionRequests":   45,
    "acceptedConnections":  30,
    "pendingConnections":   5,
    "totalInquiries":       22,
    "unreadInquiries":      3
  },
  "viewsByDay": [
    { "date": "2026-02-10", "count": 14 },
    { "date": "2026-02-11", "count": 20 }
  ],
  "deviceBreakdown": [
    { "device": "mobile",  "count": 680 },
    { "device": "desktop", "count": 344 }
  ],
  "browserBreakdown": [
    { "browser": "Chrome",  "count": 500 },
    { "browser": "Safari",  "count": 300 }
  ],
  "recentVisitors": [
    {
      "userId":     "8",
      "firstName":  "Ana",
      "lastName":   "Reyes",
      "profileUrl": "https://cdn.example.com/profiles/ana.jpg",
      "customUri":  "ana-reyes",
      "viewedAt":   "2026-03-10T08:32:00.000Z"
    }
  ],
  "contactSavesByType": [
    { "saveType": "vcf",   "count": 72 },
    { "saveType": "phone", "count": 16 }
  ]
}
```

| Field               | Description                                                                     |
| ------------------- | ------------------------------------------------------------------------------- |
| `overview`          | All-time aggregate counters.                                                    |
| `viewsByDay`        | Daily view counts for the last 30 days.                                         |
| `deviceBreakdown`   | View counts grouped by device type.                                             |
| `browserBreakdown`  | View counts grouped by browser.                                                 |
| `recentVisitors`    | Last 20 distinct logged-in visitors. Anonymous visitors are excluded for privacy. |
| `contactSavesByType`| Contact save events grouped by save type.                                       |

#### Error Responses

| Status | Condition                                      | Response Body                                                             |
| ------ | ---------------------------------------------- | ------------------------------------------------------------------------- |
| `401`  | Missing or invalid session                     | `{ "error": "Unauthorized." }`                                            |
| `403`  | URI belongs to a different user                | `{ "error": "You are not authorized to view this portfolio's analytics." }` |
| `404`  | Invalid URI format                             | `{ "error": "Portfolio not found." }`                                     |
| `429`  | Rate limit exceeded (60/min)                   | `{ "error": "Too many requests. Please slow down." }`                     |
| `500`  | Internal error                                 | `{ "error": "An unexpected error occurred." }`                            |

---

## Dashboard APIs

---

### 25. Dashboard Overview

Returns summary metrics and widgets for the authenticated user's personal dashboard — the "at a glance" home screen. All DB queries run in parallel for minimal latency.

```
GET /api/dashboard
```

**Authentication:** Required — `session_token` cookie.

#### Success Response

```
HTTP/1.1 200 OK
```

```json
{
  "metrics": {
    "totalViews":        1024,
    "totalConnections":  30,
    "totalInquiries":    22,
    "unreadInquiries":   3,
    "totalContactSaves": 88
  },
  "recentInquiries": [
    {
      "inquiryId":   "17",
      "visitorName": "Maria Santos",
      "subject":     "Project Inquiry",
      "createdAt":   "2026-03-10T09:00:00.000Z"
    }
  ],
  "qrCode":       "data:image/svg+xml;base64,...",
  "portfolioUrl": "https://www.portal.ontap.ph/jane-smith",
  "hasCompany":   false
}
```

| Field              | Description                                                                           |
| ------------------ | ------------------------------------------------------------------------------------- |
| `metrics`          | All-time aggregate counters for the user's portfolio.                                 |
| `recentInquiries`  | The 5 most recent **unread** inquiries for the inbox widget.                          |
| `qrCode`           | Base64 SVG data URL of the user's portfolio QR code, or `null` if not set up yet.    |
| `portfolioUrl`     | Full public URL to the user's portfolio, or `null` if no `custom_uri` set.            |
| `hasCompany`       | Whether the user is associated with a company.                                        |

#### Frontend Integration

| Consumer | Location | Behavior |
| -------- | -------- | -------- |
| Owner dashboard | `app/components/DashboardContent.tsx` | Initial full load on mount; silent metrics re-fetch on `window.focus` and `document.visibilitychange` (when tab becomes visible) so Profile Views, Contact Saves, Associates, and Inquiries update without a manual refresh. Full reload still runs on `ontap:user-sync`. |

| Metric | Source |
| ------ | ------ |
| `totalViews` | `portfolioView` analytics table (via `POST /api/portfolio/[uri]/view`) |
| `totalContactSaves` | `contactSave` analytics table (via `POST /api/portfolio/[uri]/save-contact`) |
| `totalConnections` | Accepted `connection` records |
| `totalInquiries` | `inquiry` records for the owner |

#### Error Responses

| Status | Condition                   | Response Body                                                             |
| ------ | --------------------------- | ------------------------------------------------------------------------- |
| `401`  | Missing or invalid session  | `{ "error": "Authentication required.", "requiresAuth": true }`           |
| `429`  | Rate limit exceeded (120/min)| `{ "error": "Too many requests. Please slow down." }`                    |
| `500`  | Internal error              | `{ "error": "An unexpected error occurred." }`                            |

#### Example (JavaScript/Fetch)

```javascript
const res = await fetch("/api/dashboard", { credentials: "include" });
const data = await res.json();

if (res.ok) {
  console.log("Total views:", data.metrics.totalViews);
  console.log("Portfolio URL:", data.portfolioUrl);
  console.log("Unread inquiries:", data.metrics.unreadInquiries);
}
```

---

### 26. Bizcard Dashboard

Returns a bizcard-specific dashboard payload for the authenticated user's selected bizcard. This includes profile and activity metrics, premium-gated inquiry details, a public portfolio link, and setup checklist completion state.

```
GET /api/user/bizcard/{bizcardId}/dashboard
```

**Authentication:** Required — `session_token` cookie.

#### Success Response

```
HTTP/1.1 200 OK
```

```json
{
  "success": true,
  "data": {
    "bizcard_id": "475",
    "bizcard_name": "Jane Smith",
    "url_alias": "jane-smith",
    "portfolioUrl": "https://www.portal.ontap.ph/jane-smith",
    "metrics": {
      "totalViews": 420,
      "totalConnections": 18,
      "totalInquiries": 6,
      "totalContactSaves": 31
    },
    "is_premium": true,
    "subscription_tier": "premium",
    "inquiries_list": [
      {
        "id": "12",
        "name": "Maria Santos",
        "email": "maria@example.com",
        "message": "I’m interested in your services.",
        "createdAt": "2026-03-10T09:00:00.000Z"
      }
    ],
    "recent_activities": [
      {
        "id": "view_101",
        "type": "profile_view",
        "description": "Profile viewed",
        "source": "Google Chrome",
        "timestamp": "2026-03-10T09:05:00.000Z",
        "time_ago": "2 hours ago"
      }
    ],
    "checklist": [
      { "field": "Profile Image", "is_filled": true },
      { "field": "Bio", "is_filled": false },
      { "field": "Email", "is_filled": true }
    ]
  }
}
```

| Field             | Description |
| ----------------- | ----------- |
| `bizcard_id`      | Internal bizcard identifier. |
| `bizcard_name`    | Display name for the bizcard. |
| `url_alias`       | Public alias used for the portfolio link. |
| `portfolioUrl`    | Full public portfolio URL. |
| `metrics`         | Cumulative dashboard counts for the selected bizcard. |
| `is_premium`      | Whether the bizcard is on a premium tier. |
| `subscription_tier` | The current subscription tier, if any. |
| `inquiries_list`  | Recent inquiry details, returned only for premium users. |
| `recent_activities` | Latest activity feed items. |
| `checklist`       | Checklist status for key bizcard setup fields. |

#### Error Responses

| Status | Condition | Response Body |
| ------ | --------- | ------------- |
| `401` | Missing or invalid session | `{ "error": "Authentication required.", "requiresAuth": true }` |
| `403` | Bizcard does not belong to authenticated user | `{ "error": "You are not authorized to view this bizcard." }` |
| `404` | Bizcard not found | `{ "error": "Bizcard not found." }` |
| `429` | Rate limit exceeded | `{ "error": "Too many requests. Please slow down." }` |
| `500` | Internal error | `{ "error": "An unexpected error occurred." }` |

---

### 27. Activity Feed

Returns a paginated, filterable list of the authenticated user's recent portfolio activity events — views, connections, inquiries, contact saves, and card scans.

```
GET /api/dashboard/activity
```

**Authentication:** Required — `session_token` cookie.

#### Query Parameters

| Parameter | Default | Description                                                                           |
| --------- | ------- | ------------------------------------------------------------------------------------- |
| `page`    | `1`     | 1-based page number.                                                                  |
| `limit`   | `20`    | Items per page. Min `1`, max `50`.                                                    |
| `type`    | —       | Filter by activity type. Allowed values: `PROFILE_VIEW`, `NEW_CONNECTION`, `NEW_SCAN`, `NEW_INQUIRY`, `CONTACT_SAVED`. |

#### Example Requests

```
GET /api/dashboard/activity
GET /api/dashboard/activity?type=NEW_INQUIRY&page=2&limit=10
```

#### Success Response

```
HTTP/1.1 200 OK
```

```json
{
  "items": [
    {
      "id":           "101",
      "activityType": "NEW_INQUIRY",
      "referenceId":  "17",
      "meta":         { "senderName": "Maria Santos" },
      "createdAt":    "2026-03-10T09:00:00.000Z"
    },
    {
      "id":           "100",
      "activityType": "PROFILE_VIEW",
      "referenceId":  null,
      "meta":         { "device": "mobile", "browser": "Chrome" },
      "createdAt":    "2026-03-10T08:55:00.000Z"
    }
  ],
  "pagination": {
    "page":       1,
    "limit":      20,
    "totalItems": 58,
    "totalPages": 3
  }
}
```

| `activityType`    | Triggered by                                                           |
| ----------------- | ---------------------------------------------------------------------- |
| `PROFILE_VIEW`    | A view event was recorded on the user's portfolio.                     |
| `NEW_CONNECTION`  | A connection request was received by the user.                         |
| `NEW_SCAN`        | A BizCard assigned to the user was scanned / resolved.                 |
| `NEW_INQUIRY`     | A visitor submitted an inquiry to the user's portfolio.                |
| `CONTACT_SAVED`   | A visitor saved the user's contact information.                        |

#### Error Responses

| Status | Condition                    | Response Body                                                             |
| ------ | ---------------------------- | ------------------------------------------------------------------------- |
| `401`  | Missing or invalid session   | `{ "error": "Authentication required.", "requiresAuth": true }`           |
| `429`  | Rate limit exceeded          | `{ "error": "Too many requests. Please slow down." }`                     |
| `500`  | Internal error               | `{ "error": "An unexpected error occurred." }`                            |

---

### Profile Views List (Who Viewed Your Profile)

Returns a paginated list of distinct logged-in users who viewed the authenticated owner's portfolio, ordered by most recent view first. Used by the dashboard Profile Views modal. Anonymous visitors are excluded for privacy (same model as `recentVisitors` on portfolio analytics).

```
GET /api/dashboard/profile-views
```

**Authentication:** Required — `session_token` cookie. Results are always scoped to the effective session user (supports superadmin impersonation). Owner-only by construction; no `userId` / alias query parameters are accepted.

**Error tag:** `[dashboard/profile-views]`

#### Query Parameters

| Parameter | Default | Description                        |
| --------- | ------- | ---------------------------------- |
| `page`    | `1`     | 1-based page number.               |
| `limit`   | `20`    | Items per page. Min `1`, max `50`. |

#### Example Requests

```
GET /api/dashboard/profile-views
GET /api/dashboard/profile-views?page=1&limit=20
```

#### Success Response

```
HTTP/1.1 200 OK
```

```json
{
  "viewers": [
    {
      "viewerId":   "123",
      "firstName":  "Jane",
      "lastName":   "Doe",
      "profileUrl": "https://example.com/avatars/jane.jpg",
      "customUri":  "jane-doe",
      "viewedAt":   "2026-07-27T03:00:00.000Z",
      "timeAgo":    "2 minutes ago"
    }
  ],
  "pagination": {
    "page":       1,
    "limit":      20,
    "totalItems": 12,
    "totalPages": 1
  }
}
```

| Field         | Description                                                                 |
| ------------- | --------------------------------------------------------------------------- |
| `viewers`     | Distinct logged-in visitors (one entry per user, most recent view retained). |
| `viewerId`    | Viewer `user_id` (stringified BigInt).                                      |
| `firstName`   | Viewer first name.                                                          |
| `lastName`    | Viewer last name.                                                           |
| `profileUrl`  | Viewer profile image URL, or `null`.                                        |
| `customUri`   | Viewer public portfolio URI, or `null`.                                     |
| `viewedAt`    | ISO timestamp of the viewer's most recent view.                             |
| `timeAgo`     | Relative label derived from `viewedAt` (e.g. `"2 minutes ago"`).            |
| `pagination`  | Standard page metadata for the distinct-viewer list.                        |

#### Error Responses

| Status | Condition                  | Response Body                                                   |
| ------ | -------------------------- | --------------------------------------------------------------- |
| `401`  | Missing or invalid session | `{ "error": "Authentication required.", "requiresAuth": true }` |
| `429`  | Rate limit exceeded        | `{ "error": "Too many requests. Please slow down." }`           |
| `500`  | Internal error             | `{ "error": "An unexpected error occurred." }`                  |

---

### 27. vCard Completion Score

Returns the authenticated user's vCard profile completeness as a percentage, along with a per-field breakdown to drive "complete your profile" prompts on the dashboard.

```
GET /api/dashboard/vcard-completion
```

**Authentication:** Required — `session_token` cookie.

#### Success Response

```
HTTP/1.1 200 OK
```

```json
{
  "percentage": 69,
  "completed":  9,
  "total":      13,
  "fields": {
    "profilePhoto": true,
    "coverPhoto":   false,
    "profTitle":    true,
    "about":        true,
    "jobPosition":  true,
    "email":        true,
    "phone":        true,
    "address":      false,
    "firstName":    true,
    "lastName":     true,
    "socials":      true,
    "services":     false,
    "products":     false
  }
}
```

| Group    | Fields Scored                                       |
| -------- | --------------------------------------------------- |
| Basic    | `profilePhoto`, `coverPhoto`, `profTitle`, `about`, `jobPosition` |
| Contact  | `email` (always true), `phone`, `address` (≥1 row)  |
| Identity | `firstName` (always true), `lastName` (always true) |
| Content  | `socials` (≥1 visible), `services` (≥1 row), `products` (≥1 row) |

> `email`, `firstName`, and `lastName` are always `true` because they are required fields captured at registration.

#### Error Responses

| Status | Condition                   | Response Body                                                             |
| ------ | --------------------------- | ------------------------------------------------------------------------- |
| `401`  | Missing or invalid session  | `{ "error": "Authentication required.", "requiresAuth": true }`           |
| `429`  | Rate limit exceeded         | `{ "error": "Too many requests. Please slow down." }`                     |
| `500`  | Internal error              | `{ "error": "An unexpected error occurred." }`                            |

#### Example (JavaScript/Fetch)

```javascript
const res  = await fetch("/api/dashboard/vcard-completion", { credentials: "include" });
const data = await res.json();

console.log(`Profile ${data.percentage}% complete (${data.completed}/${data.total})`);

// Show individual prompts for incomplete fields
if (!data.fields.profilePhoto) showPrompt("Add a profile photo");
if (!data.fields.socials)      showPrompt("Add at least one social link");
```

---

## Company APIs

---

### 28. Create Company

Allows an authenticated individual user to create a company and become its admin. This is the **in-app upgrade path** — distinct from the company registration flow (`POST /api/auth/register`).

```
POST /api/company
```

**Authentication:** Required — `session_token` cookie.

> The calling user must **not** already belong to a company. After this call succeeds, the user's `role` becomes `"company_admin"` and their `company_id` is set.

#### Request Body

```json
{
  "name":        "Acme Corp",
  "description": "We make everything.",
  "email":       "hello@acme.ph",
  "logoUrl":     "https://cdn.example.com/logos/acme.png"
}
```

| Field         | Type     | Required | Description                                                        |
| ------------- | -------- | -------- | ------------------------------------------------------------------ |
| `name`        | `string` | Yes      | Company name. 1–255 characters.                                    |
| `description` | `string` | No       | Short company description. Max 2000 characters.                    |
| `email`       | `string` | No       | Company contact email. Must be a valid email. Max 191 characters.  |
| `logoUrl`     | `string` | No       | Company logo URL (pre-uploaded to CDN). Max 512 characters.        |

#### Success Response

```
HTTP/1.1 201 Created
```

```json
{
  "companyId": "5",
  "name":      "Acme Corp",
  "message":   "Company created successfully. You are now a company administrator."
}
```

> `companyId` is a BigInt serialized as a string.

#### Error Responses

| Status | Condition                                 | Response Body                                                                 |
| ------ | ----------------------------------------- | ----------------------------------------------------------------------------- |
| `400`  | Missing or malformed body                 | `{ "error": "Invalid JSON body." }`                                           |
| `401`  | Missing or invalid session                | `{ "error": "Authentication required.", "requiresAuth": true }`               |
| `409`  | User already belongs to a company         | `{ "error": "You are already associated with a company." }`                   |
| `422`  | Validation failed                         | `{ "error": "Validation failed.", "details": ["..."] }`                       |
| `429`  | Rate limit exceeded (5/hr)                | `{ "error": "Too many company creation attempts. Please try again later." }`  |
| `500`  | Internal error                            | `{ "error": "An unexpected error occurred." }`                                |

#### Example (JavaScript/Fetch)

```javascript
const response = await fetch("/api/company", {
  method:      "POST",
  credentials: "include",
  headers:     { "Content-Type": "application/json" },
  body: JSON.stringify({
    name:        "Acme Corp",
    description: "We make everything.",
    email:       "hello@acme.ph",
  }),
});

const data = await response.json();

if (response.status === 201) {
  console.log("Company created:", data.companyId);
  // User is now company_admin — refresh session to pick up new role
  window.location.href = "/dashboard";
} else if (response.status === 409) {
  alert("You are already part of a company.");
}
```

---

## BizCard Management APIs

These endpoints manage the physical BizCards (NFC/QR-embedded employee cards) issued within the ONTAP system. A BizCard is an `EmployeeCard` row that links a physical card serial ID to a user's digital vCard profile.

**Authorization model** (applies to all `[serialId]` endpoints):

| Role | Access |
| --- | --- |
| Assigned user (`card.assigned_user_id === userId`) | Full read + edit; can set status to `active` or `inactive` only |
| Company admin (`role === "company_admin"` AND `card.company_id === user.company_id`) | Full read + edit; can also set status to `revoked` |
| Anyone else | `404 Not Found` (existence is not leaked) |

---

### 29. List User BizCards

---

**Superadmin Manage Content (Products, Subscriptions, Offers, Newsletter)**

UI route: `/superadmin/manage-content` (legacy `/superadmin/product` redirects here).

This section documents Superadmin content management APIs. Product and promo routes use `withSuperAdmin` for writes; product list GET allows any authenticated user. Newsletter and subscription-plan routes require super admin.

Base paths:

- Products: `/api/superadmin/products`
- Promos: `/api/superadmin/promos`
- Subscription plans: `/api/superadmin/subscription-plans`
- Newsletter: `/api/superadmin/newsletter`

**Products**

- `GET /api/superadmin/products` — List products (**super_admin** session required). Query: `page`, `limit`, `category`, `search`, `sort_by`, `sort_dir`, `include_inactive` (optional; default false).
- Soft-deleted products (`is_active=false`) are excluded from `GET /api/products` (portal/web marketplace) but visible to superadmin when `include_inactive=true`.
- `POST /api/superadmin/products` — Create a product (uses `Merchandise` as canonical source)
- `GET /api/superadmin/products/:productId` — Get product detail
- `PUT /api/superadmin/products/:productId` — Update product
- `DELETE /api/superadmin/products/:productId` — Delete product
- `POST /api/superadmin/products/upload-images` — Upload product images (multipart/form-data, proxied to Cloudinary)

- `GET /api/superadmin/promos` — List promotions
- `POST /api/superadmin/promos` — Create a promotion
- `GET /api/superadmin/promos/:promoId` — Get promotion detail
- `PUT /api/superadmin/promos/:promoId` — Update promotion
- `DELETE /api/superadmin/promos/:promoId` — Delete promotion
- `PATCH /api/superadmin/promos/:promoId/toggle` — Toggle active/paused
- `GET /api/superadmin/promos/:promoId/usage` — Promotion usage audit (paged)
- `GET /api/superadmin/promos/target-groups` — Catalog of available target groups & tags (includes `subscription_basic`, `subscription_standard`, `subscription_premium`, `free_trial_users`, `company_admins`, `new_users`, `all_users`)

Promo types: `discount`, `buy_one_get_one`, `free_shipping`, `fixed_amount`, `percentage`, `free_merch`.

**Subscription plans** (`/api/superadmin/subscription-plans`)

- `GET /api/superadmin/subscription-plans` — List tiers (`include_inactive` query)
- `POST /api/superadmin/subscription-plans` — Create (`name`, `tier_code`, `price_monthly`, `price_yearly`, `features[]`, `place_before_plan_id`)
- `GET /api/superadmin/subscription-plans/:planId` — Detail
- `PUT /api/superadmin/subscription-plans/:planId` — Update
- `DELETE /api/superadmin/subscription-plans/:planId` — Soft-delete

**Newsletter** (`/api/superadmin/newsletter`)

- `GET /api/superadmin/newsletter/subscribers` — Opted-in users (`page`, `limit`, `search`)
- `GET|POST /api/superadmin/newsletter/campaigns` — List / create campaigns
- `GET|PUT|DELETE /api/superadmin/newsletter/campaigns/:campaignId` — Campaign CRUD
- `POST /api/superadmin/newsletter/campaigns/:campaignId/send` — Queue delivery

Audience segments: `basic`, `standard`, `premium`, `company_admins`, `free_trial`, `custom`.

Auth & security

- All endpoints: require server session and `role === "super_admin"` (see `lib/auth/superadmin-middleware.ts`).
- Rate limiter keys: `superadmin-products-list`, `superadmin-products-write`, `superadmin-promos-list`, `superadmin-promos-write`, etc.

Error codes (product/promo namespace)

- Codes reserved in the `21000-21699` range. Examples:
  - `PRODUCT_PROMO_21000` — Validation error creating product
  - `PRODUCT_PROMO_21010` — Product not found
  - `PRODUCT_PROMO_21100` — Promotion validation error
  - `PRODUCT_PROMO_21110` — Promotion not found
  - `PRODUCT_PROMO_21200` — Promo apply limit reached

Rate-limits

- Superadmin routes use admin-scoped rate limits (low traffic expected):
  - list/read: 60 requests / minute
  - write (create/update/delete): 30 requests / minute

Cron endpoint (promo lifecycle)

- `POST /api/cron/promos/update-status` — Called by cron to auto-activate or expire promotions based on `starts_at` / `ends_at`. Requires `Authorization: Bearer <CRON_SECRET>` or header `x-cron-secret` (see server env `CRON_SECRET`).

Database / migration

### 64. Bizcard Management API (SuperAdmin)

This section documents the SuperAdmin-only Bizcard APIs. All routes require the `withSuperAdmin` guard and reject non-superadmin users with `403 Forbidden`.

Base path:

- `/api/superadmin/bizcard`

Endpoints (summary)

- `POST /api/superadmin/bizcard/generate` — Generate blank bizcards in bulk
- `GET /api/superadmin/bizcard/download` — Export blank bizcards as CSV
- `GET /api/superadmin/bizcard/:serialId` — Inspect a blank bizcard by serial ID
- `PATCH /api/superadmin/bizcard/:serialId` — Update subscription tier of a blank bizcard
- `DELETE /api/superadmin/bizcard/:serialId` — Permanently delete a blank, unclaimed bizcard
- `PUT /api/superadmin/bizcard/:serialId/mark-distributed` — Manually mark a blank card as physically distributed (Assigned / Pending Registration)
- `PUT /api/superadmin/bizcard/mark-distributed-all` — Atomically mark ALL available (Unclaimed) blank cards as physically distributed

Auth & security

- All endpoints: require server session and `role === "super_admin"` via `withSuperAdmin` in [`lib/auth/superadmin-middleware.ts`](lib/auth/superadmin-middleware.ts).
- Responses include `requestId` and `timestamp` in the JSON `meta` payload; the download endpoint also sets `X-Request-Id`, `X-Response-Time`, and `X-Response-Timestamp` headers.
- Rate limiter keys: `superadmin-bizcard-generate`, `superadmin-bizcard-download`, `superadmin-bizcard-detail`, `superadmin-bizcard-mark-distributed`, `superadmin-bizcard-mark-distributed-all`.

Error codes (bizcard namespace)

- Codes reserved in the `11600-11611` range.
  - `SUPERADMIN_11600` — Blank bizcard not found
  - `SUPERADMIN_11601` — Invalid bizcard payload or query data
  - `SUPERADMIN_11602` — Bizcard generation failed
  - `SUPERADMIN_11603` — Bizcard update failed
  - `SUPERADMIN_11604` — Bizcard delete failed
  - `SUPERADMIN_11605` — Bizcard export failed
  - `SUPERADMIN_11606` — Invalid serial ID format
  - `SUPERADMIN_11607` — Bizcard access denied
  - `SUPERADMIN_11608` — Bizcard detail lookup failed
  - `SUPERADMIN_11609` — Mark-distributed operation failed
  - `SUPERADMIN_11610` — Card already claimed by a registered user
  - `SUPERADMIN_11611` — Mark-distributed-all (batch) operation failed

Rate-limits

- `POST /api/superadmin/bizcard/generate` — 20 requests / minute
- `GET /api/superadmin/bizcard/download` — 20 requests / minute
- `GET /api/superadmin/bizcard/:serialId` — 120 requests / minute
- `PATCH /api/superadmin/bizcard/:serialId` — 120 requests / minute (shared DETAIL bucket)
- `DELETE /api/superadmin/bizcard/:serialId` — 300 requests / minute (dedicated delete bucket)
- `PUT /api/superadmin/bizcard/:serialId/mark-distributed` — 30 requests / minute
- `PUT /api/superadmin/bizcard/mark-distributed-all` — 5 requests / minute

#### `POST /api/superadmin/bizcard/generate`

Generate blank physical bizcards in bulk. Each card is created with `is_blank: true` and a unique `serial_id`.

**Portfolio URL behavior**

- Each generated card's `portfolioUrl` is built as `{APP_BASE}/{serialId}` (e.g. `https://app.example.com/CXVCG`).
- `APP_BASE` resolves from `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_BASE_URL`, `FRONTEND_URL`, or `VERCEL_URL`.
- If no base URL is configured server-side, a relative path `/{serialId}` is stored and the Super Admin UI resolves it against the current app origin.
- URLs never include an `undefined` path segment.

**Request body**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `count` | integer | yes | — | Number of cards to generate (1–10000) |
| `subscription_tier` | string | no | `basic` | Tier assigned at generation: `basic`, `standard`, or `premium` |
| `subscriptionTier` | string | no | `basic` | camelCase alias for `subscription_tier` |

**Example request**

```json
{
  "count": 5,
  "subscription_tier": "standard"
}
```

**Example success response** (`201`)

```json
{
  "success": true,
  "data": {
    "count": 5,
    "cards": [
      {
        "id": "12345",
        "serialId": "ABC123",
        "qrCodeUrl": null,
        "portfolioUrl": "https://app.example.com/ABC123",
        "bizcard_style": "polyvinyl",
        "subscriptionTier": "standard"
      }
    ]
  },
  "meta": {
    "requestId": "req_abc123",
    "responseTime": 42,
    "timestamp": "2026-04-29T12:00:00.000Z"
  }
}
```

**Validation errors**

- Invalid `count` → `SUPERADMIN_11601` (`400`)
- Invalid `subscription_tier` (not `basic`/`standard`/`premium`) → `SUPERADMIN_11601` (`400`)

#### `GET /api/superadmin/bizcard/download`

Export physical BizCard inventory as CSV. Includes:

- blank stock rows (`is_blank: true`, `deactivated_flag: false`)
- merged claims (`is_merged: true` with a non-null `serial_id`, `deactivated_flag: false`)

After a user completes QR signup and `POST /api/bizcard/merge`, the blank inventory row is deleted and the serial moves onto the virtual card. Those merged rows appear here as **Claimed** so Super Admin Distributed lists stay accurate via polling.

**Query parameters**

| Param | Allowed values | Default | Description |
|-------|----------------|---------|-------------|
| `status` | `all`, `unclaimed`, `claimed` | `all` | Filter by claim status |
| `tier` | `all`, `basic`, `standard`, `premium` | `all` | Filter by `subscription_tier` |
| `from` | ISO date string | — | `generated_at` on or after this date |
| `to` | ISO date string | — | `generated_at` on or before this date |

**Example**

`GET /api/superadmin/bizcard/download?status=unclaimed&tier=basic&from=2026-01-01&to=2026-06-30`

**CSV columns** (in order)

1. Bizcard ID
2. Serial ID
3. Subscription Tier
4. Generated At
5. Status (`Unclaimed`, `Assigned`, or `Claimed`)
6. Claimed At
7. Claimed By Email
8. Claimed By Name
9. Generated By
10. Manually Distributed At

Legacy cards without a tier export an empty Subscription Tier cell. Legacy cards without a `manually_distributed_at` value export an empty cell in column 10.

**Response**

- `200` — `text/csv` attachment
- Invalid `status`, `tier`, `from`, or `to` → `SUPERADMIN_11601` (`400`)

#### `GET /api/superadmin/bizcard/:serialId`

Returns bizcard detail by serial ID for blank inventory rows **or** merged claims (`is_blank: true` OR `is_merged: true`). Includes `subscription_tier` when set. `status` is `claimed` when `is_merged` is true or `user_id` is set; otherwise `unclaimed`. `claimed_at` falls back to `merged_at` for merged cards.

Response examples

```json
{
  "success": true,
  "data": { "count": 2, "cards": [] },
  "meta": {
    "requestId": "req_abc123",
    "responseTime": 42,
    "timestamp": "2026-04-29T12:00:00.000Z"
  }
}
```

Error example

```json
{
  "success": false,
  "error": {
    "code": "SUPERADMIN_11606",
    "message": "Invalid serial ID format.",
    "requestId": "req_abc123",
    "timestamp": "2026-04-29T12:00:00.000Z"
  },
  "meta": {
    "requestId": "req_abc123",
    "responseTime": 11
  }
}
```

#### `PATCH /api/superadmin/bizcard/:serialId`

Updates the `subscription_tier` of a blank bizcard. Portfolio URL cannot be changed through this endpoint (it is derived from the user's URL alias).

**Auth** — requires `withSuperAdmin` middleware (`super_admin` or `dev` role).

**Request body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `subscription_tier` | string | yes | New tier: `basic`, `standard`, or `premium` |

**Example request**

```json
{ "subscription_tier": "premium" }
```

**Example success response** (`200`)

```json
{
  "success": true,
  "data": {
    "bizcard_id": "9001",
    "serial_id": "ABC123",
    "subscription_tier": "premium",
    "is_blank": true,
    "user_id": null,
    "status": "unclaimed"
  },
  "meta": {
    "requestId": "req_abc123",
    "responseTime": 18,
    "timestamp": "2026-07-19T10:00:00.000Z"
  }
}
```

**Error codes**

| Code | Status | Meaning |
|------|--------|---------|
| `SUPERADMIN_11606` | `400` | Invalid serial ID format |
| `SUPERADMIN_11601` | `400` | Invalid or missing `subscription_tier`, or attempt to change `portfolio_url` |
| `SUPERADMIN_11600` | `404` | Blank bizcard not found |
| `SUPERADMIN_11603` | `500` | Update failed |

#### `DELETE /api/superadmin/bizcard/:serialId`

Permanently removes a blank, unclaimed bizcard from the system. Only blank cards that have **not** been claimed by a user (`user_id = null`, `claimed_at = null`) may be deleted.

**Auth** — requires `withSuperAdmin` middleware (`super_admin` or `dev` role).

**No request body required.**

**Deletion behavior**

1. Serial ID format is validated.
2. Card is confirmed to exist with `is_blank = true`.
3. Card is confirmed to be unclaimed (`user_id = null`, `claimed_at = null`). Claimed cards return `409`.
4. A Prisma transaction is executed:
   - Any `QRCodeScan` rows referencing the card have `bizcard_id` nullified (nullable FK, no cascade in schema).
   - The `Bizcard` row is deleted. Child rows with `onDelete: Cascade` (`BizcardMergeHistory`, `BizcardSubscription`) are automatically removed by the database.
5. Optimistic UI removal: the frontend removes the row immediately and restores it only if the API returns an error.

**Example success response** (`200`)

```json
{
  "success": true,
  "data": { "serialId": "ABC123", "deleted": true },
  "meta": {
    "requestId": "req_abc123",
    "responseTime": 22,
    "timestamp": "2026-07-19T10:00:00.000Z"
  }
}
```

**Error codes**

| Code | Status | Meaning |
|------|--------|---------|
| `SUPERADMIN_11300` | `429` | Rate limit exceeded |
| `SUPERADMIN_11606` | `400` | Invalid serial ID format |
| `SUPERADMIN_11600` | `404` | Blank bizcard not found |
| `SUPERADMIN_11607` | `409` | Card has already been claimed by a user — cannot delete |
| `SUPERADMIN_11604` | `500` | Deletion failed (database error) |

#### `PUT /api/superadmin/bizcard/:serialId/mark-distributed`

Manually marks a blank (Available) BizCard as **Assigned / Pending Registration** — indicating that the physical card has been physically handed to a person before they have registered on the platform.

**Business rules**

- Card must be blank (`is_blank = true`) and unclaimed (`user_id = null`).
- If the card was already manually distributed the endpoint is **idempotent** (returns `200` without updating).
- If the card was already claimed by a registered user, returns `409 Conflict`.
- After marking, the card:
  - **disappears** from the Available Cards list (status changes from `Unclaimed` to `Assigned`).
  - **appears** in the Distributed Cards list with status badge "Assigned / Pending Registration".
- When the user later registers using the card's QR code (via `/user/signup?ref=SERIALID` → `/api/bizcard/merge`), the merge service **deletes the blank inventory row** and attaches `serial_id` / QR fields onto the user's virtual BizCard (`is_merged: true`). It also **copies and activates** the blank card's `subscription_tier` on the virtual card (`subscription_status: active`, yearly `subscription_expires_at`, and a matching `BizcardSubscription` row when a plan exists). Inventory export then lists that serial as **Claimed** (via the merged virtual row) and populates the user's details in the Distributed Cards list.
- This endpoint does **not** trigger registration or send any notification — it is an administrative bookkeeping action only.

**Auth**

- Requires `withSuperAdmin` middleware (role `super_admin` or `dev`).

**Rate limit**

- 30 requests / minute (`superadmin-bizcard-mark-distributed`).

**Error codes**

| Code | Status | Meaning |
|------|--------|---------|
| `SUPERADMIN_11300` | `429` | Rate limit exceeded |
| `SUPERADMIN_11606` | `400` | Invalid serial ID format |
| `SUPERADMIN_11600` | `404` | Blank bizcard not found |
| `SUPERADMIN_11610` | `409` | Card already claimed by a registered user |
| `SUPERADMIN_11609` | `500` | Internal failure while marking distributed |

**No request body required.**

**Example success response** (`200`)

```json
{
  "success": true,
  "data": {
    "serialId": "ABC123",
    "manuallyDistributedAt": "2026-07-06T10:00:00.000Z",
    "status": "assigned"
  },
  "meta": {
    "requestId": "req_abc123",
    "responseTime": 18,
    "timestamp": "2026-07-06T10:00:00.000Z"
  }
}
```

**Example idempotent response** (`200` — already marked)

```json
{
  "success": true,
  "data": {
    "serialId": "ABC123",
    "manuallyDistributedAt": "2026-07-06T09:00:00.000Z",
    "status": "assigned",
    "message": "Card was already marked as distributed."
  },
  "meta": { ... }
}
```

**Example conflict response** (`409`)

```json
{
  "success": false,
  "error": {
    "code": "SUPERADMIN_11610",
    "message": "This card has already been claimed by a registered user and cannot be manually marked as distributed.",
    "details": { "serialId": "ABC123", "status": "claimed" },
    "requestId": "req_abc123",
    "timestamp": "2026-07-06T10:00:00.000Z"
  }
}
```

**Database changes**

This endpoint sets two nullable columns added by migration `20260706_add_manual_distribution_fields`:

| Column | Type | Description |
|--------|------|-------------|
| `manually_distributed_at` | `DATETIME(3) NULL` | Timestamp of manual distribution |
| `manually_distributed_by` | `BIGINT NULL` | User ID of the SuperAdmin who performed the action |

**CSV export changes**

The `GET /api/superadmin/bizcard/download` endpoint now includes a tenth column **"Manually Distributed At"** and derives three possible status values:

| Status value in CSV | Meaning |
|--------------------|---------|
| `Unclaimed` | Available — blank card not yet distributed or claimed |
| `Assigned` | Manually distributed but user has not registered yet |
| `Claimed` | User has registered and claimed the card (merged serial on virtual BizCard, or `user_id` set) |

The frontend `Available Cards` list filters on `Unclaimed` only; `Assigned` and `Claimed` cards appear in the `Distributed Cards` list.

#### `PUT /api/superadmin/bizcard/mark-distributed-all`

Atomically marks **all** available (Unclaimed) blank BizCards as **Assigned / Pending Registration** — the batch equivalent of `PUT /api/superadmin/bizcard/:serialId/mark-distributed`.

**Eligibility** (same derivation as Available Cards / Unclaimed CSV status)

- `is_blank = true`
- `user_id IS NULL`
- `manually_distributed_at IS NULL`

**Atomicity**

- Eligible cards are discovered and updated inside a **single Prisma interactive transaction** (`findMany` + `updateMany`).
- If the update count does not match the discovered set (concurrent claim/distribute race), the transaction aborts and **no** cards are distributed.
- On any failure the transaction rolls back so either every eligible card is distributed or none are.

**Auth**

- Requires `withSuperAdmin` middleware (role `super_admin` or `dev`).

**Rate limit**

- 5 requests / minute (`superadmin-bizcard-mark-distributed-all`).

**Error codes**

| Code | Status | Meaning |
|------|--------|---------|
| `SUPERADMIN_11300` | `429` | Rate limit exceeded |
| `SUPERADMIN_11611` | `500` | Internal failure while batch-marking distributed |

**No request body required.**

**Example success response** (`200` — cards distributed)

```json
{
  "success": true,
  "data": {
    "count": 3,
    "serialIds": ["ABC123", "DEF456", "GHI789"],
    "manuallyDistributedAt": "2026-07-23T07:00:00.000Z",
    "status": "assigned"
  },
  "meta": {
    "requestId": "req_abc123",
    "responseTime": 42,
    "timestamp": "2026-07-23T07:00:00.000Z"
  }
}
```

**Example success response** (`200` — nothing to distribute)

```json
{
  "success": true,
  "data": {
    "count": 0,
    "serialIds": [],
    "manuallyDistributedAt": null,
    "status": "assigned"
  },
  "meta": { "...": "..." }
}
```

**Frontend**

- Triggered by the **Distribute All Cards** button beside **Download All Cards** in the Available Cards panel (`BizcardManagement`).
- Confirmation dialog required before the PUT is sent.
- On success the UI calls `loadBizcards(false)` so Available and Distributed lists refresh without a full page reload.

- Implementation extended the existing `Promotion` model and added `PromoUsage` to track per-user usage. Run Prisma client generation after applying the migration and deploy DB migration to staging before production rollout.

Examples

Create product (superadmin):

Request: `POST /api/superadmin/products`

```json
{
  "name": "Deluxe BizCard Template",
  "sku": "BIZ-DLX-001",
  "price": 499.00,
  "currency": "PHP",
  "description": "Premium customizable bizcard template.",
  "metadata": { "category": "templates", "inventory": 100 }
}
```

Success response (201):

```json
{ "success": true, "productId": "123", "message": "Product created." }
```

Create promotion (superadmin):

Request: `POST /api/superadmin/promos`

```json
{
  "code": "SPRING2026",
  "discount_percentage": 15,
  "starts_at": "2026-05-01T00:00:00Z",
  "ends_at": "2026-05-10T23:59:59Z",
  "target_groups": { "min_order_count": 1 },
  "applicable_products": [123, 124],
  "tags": ["seasonal", "marketing"]
}
```

Success response (201):

```json
{ "success": true, "promoId": "9001", "message": "Promotion created." }
```

Notes & next steps

- Run the migration in staging and verify `PromoUsage` writes when applying promos.
- Integration tests recommended: promo eligibility rules, apply flow, and Cloudinary image upload flow for product media.

---

**Product & Promo Error Codes (21000–21699)**

The product/promo domain uses a dedicated error namespace. Error responses include an `code` field alongside the HTTP status and human message.

| Code | HTTP Status | Meaning |
|------|-------------|---------|
| `PRODUCT_PROMO_21000` | `400` | Invalid product payload / validation error |
| `PRODUCT_PROMO_21001` | `409` | Product SKU already exists |
| `PRODUCT_PROMO_21010` | `404` | Product not found |
| `PRODUCT_PROMO_21020` | `422` | Product image validation failed |
| `PRODUCT_PROMO_21100` | `400` | Invalid promotion payload / validation error |
| `PRODUCT_PROMO_21101` | `409` | Promotion code already exists |
| `PRODUCT_PROMO_21110` | `404` | Promotion not found |
| `PRODUCT_PROMO_21120` | `409` | Promotion overlap / conflicting rules |
| `PRODUCT_PROMO_21200` | `429` | Promo usage limit reached for this user/order |
| `PRODUCT_PROMO_21210` | `422` | Promo not applicable to selected products or target group |
| `PRODUCT_PROMO_21300` | `500` | Internal service error (database/cloudinary/audit) |

Include the `code` in client-side error handling to display actionable messages and to classify telemetry events.

**Rate-limit mapping (superadmin product/promo)**

| Endpoint | Limiter key | Limit |
|----------|-------------|-------|
| `GET /api/superadmin/products` | `superadmin-products-list` | 60/min |
| `GET /api/superadmin/products/:id` | `superadmin-products-list` | 60/min |
| `POST /api/superadmin/products` | `superadmin-products-write` | 30/min |
| `PUT /api/superadmin/products/:id` | `superadmin-products-write` | 30/min |
| `DELETE /api/superadmin/products/:id` | `superadmin-products-write` | 30/min |
| `POST /api/superadmin/products/upload-images` | `media-upload` / `superadmin-products-write` | 15/min |
| `GET /api/superadmin/promos` | `superadmin-promos-list` | 60/min |
| `GET /api/superadmin/promos/:id` | `superadmin-promos-list` | 60/min |
| `POST /api/superadmin/promos` | `superadmin-promos-write` | 30/min |
| `PUT /api/superadmin/promos/:id` | `superadmin-promos-write` | 30/min |
| `DELETE /api/superadmin/promos/:id` | `superadmin-promos-write` | 30/min |
| `PATCH /api/superadmin/promos/:id/toggle` | `superadmin-promos-write` | 30/min |
| `GET /api/superadmin/promos/:id/usage` | `superadmin-promos-list` | 60/min |

**Expanded examples**

Validate promo (marketplace usage example):

Request: `POST /api/marketplace/promotions/validate`

```json
{
  "code": "SPRING2026",
  "subtotal": 1200.00,
  "productIds": [123, 124],
  "userId": 42
}
```

Possible responses:

- `200` — valid and applicable

```json
{
  "success": true,
  "promoId": "9001",
  "discountAmount": 180.0,
  "appliedTo": [123],
  "message": "Promo applied."
}
```

- `422` — not applicable

```json
{
  "success": false,
  "code": "PRODUCT_PROMO_21210",
  "error": "Promo does not apply to selected products or user target group."
}
```

Promo usage audit example (admin):

Request: `GET /api/superadmin/promos/9001/usage?page=1&limit=25`

Response (200):

```json
{
  "items": [
    { "usage_id": "1", "promo_id": "9001", "user_id": "42", "order_id": "5001", "discount_amount": 180.0, "used_at": "2026-05-02T12:00:00Z" }
  ],
  "pagination": { "page": 1, "limit": 25, "total": 5 }
}
```

Done — expanding examples and adding a rollout checklist below.

---

**Additional Sample Request/Response Examples**

Product image upload (superadmin):

Request: `POST /api/superadmin/products/upload-images`
- Content-Type: `multipart/form-data`
- Form fields: `file` (image), `productId` (optional), `alt_text` (optional)

Response (201):

```json
{
  "success": true,
  "images": [
    { "url": "https://res.cloudinary.com/your-cloud/image/upload/v1/products/abc.jpg", "public_id": "products/abc", "width": 1200, "height": 800 }
  ]
}
```

Promo apply in checkout (marketplace flow):

Request: `POST /api/marketplace/checkout/validate-promo`

```json
{
  "promoCode": "SPRING2026",
  "cart": [ { "productId": 123, "qty": 1, "price": 499 }, { "productId": 124, "qty": 2, "price": 350 } ],
  "userId": 42
}
```

Success (200) — promo applied partially to eligible items:

```json
{
  "success": true,
  "originalTotal": 1199.0,
  "discount": 179.85,
  "newTotal": 1019.15,
  "appliedItems": [123,124],
  "promoId": "9001"
}
```

Failure (422) — user exceeded per-user usage limit:

```json
{
  "success": false,
  "code": "PRODUCT_PROMO_21200",
  "error": "Promo usage limit reached for this account."
}
```

Cron invocation example (run manually or via Vercel Cron):

```http
POST /api/cron/promos/update-status
Authorization: Bearer <CRON_SECRET>

Response 200:
{
  "updated": { "activated": 3, "expired": 5 }
}
```

**Rollout Checklist — DB Migration & Testing (recommended)**

1. Create and review migration
   - Confirm `prisma/schema.prisma` includes new `Promotion` fields and `PromoUsage` model.
   - Commit schema changes and the generated migration SQL to a branch.

2. Apply migration in staging

```bash
# generate migration (local dev)
npx prisma migrate dev --name superadmin-product-promo

# or for CI/staging (push)
npx prisma migrate deploy

# regenerate client
npx prisma generate
```

3. Smoke tests in staging
   - Run server and exercise: create promo, toggle promo, create product, upload image, validate promo in checkout, and inspect `PromoUsage` rows.
   - Verify Cloudinary uploads work and `adminAuditLog` entries are recorded.

4. Integration tests (CI)
   - Add tests covering: promo eligibility, promo apply flow (discount math and usage writes), promo usage limits, product image uploads (mock Cloudinary or use test bucket), and cron endpoint behavior.

5. Rollout to production
   - Run `npx prisma migrate deploy` in production environment.
   - Regenerate Prisma client on the server build step (`npx prisma generate`).
   - Monitor `PromoUsage` writes, API errors (PRODUCT_PROMO_*), and rate-limit telemetry for admin keys.

6. Post-deploy verification
   - Execute a small promo create + apply scenario in production with a test promo (short lifetime) and confirm correct activation/expiration by cron.
   - Verify Cloudinary image delivery and that public marketplace promo validations return expected responses.

If you'd like, I can scaffold integration-test templates under `tests/` for promo eligibility and apply flows next.

---

### 64b. User BizCards API (SuperAdmin)

Provides paginated access to all **claimed** bizcards across the platform, with status filtering, full-text search, and system-wide metric summary counts. Used by the SuperAdmin > User BizCards panel.

Base path: `/api/superadmin/bizcards`

**Auth** — requires `withSuperAdmin` middleware (`super_admin` or `dev` role).

**Rate limit** — `superadmin-user-bizcards`, 60 requests / minute.

---

#### `GET /api/superadmin/bizcards`

Returns a paginated list of claimed bizcards. Only bizcards where `is_blank = false` and `user_id IS NOT NULL` are returned.

**Query parameters**

| Param | Allowed values | Default | Description |
|-------|----------------|---------|-------------|
| `page` | integer ≥ 1 | `1` | Page number |
| `limit` | integer 1–100 | `20` | Rows per page |
| `status` | `all`, `active`, `restricted` | `all` | Status filter. `active` maps to `deactivated_flag = false`; `restricted` maps to `deactivated_flag = true` |
| `search` | string | — | Full-text search across `serial_id`, `bizcard_name`, `first_name`, `last_name`, `url_alias`, `email`, and associated `user.email` |

**Example request**

```
GET /api/superadmin/bizcards?page=1&limit=20&status=all
GET /api/superadmin/bizcards?page=2&limit=20&status=restricted&search=john
```

**Example success response** (`200`)

```json
{
  "success": true,
  "data": {
    "rows": [
      {
        "bizcard_id": "12345",
        "user_id": "67890",
        "user_email": "john@example.com",
        "serial_id": "ABC123",
        "name": "John Doe",
        "subscription_tier": "standard",
        "subscription_plan_name": "Standard Plan",
        "subscription_status": "active",
        "qr_code_url": "https://cdn.example.com/qr/ABC123.png",
        "portfolio_url": "https://app.example.com/ABC123",
        "restricted": false,
        "created_at": "2026-01-15T10:00:00.000Z",
        "owner_is_online": true,
        "owner_last_active": "2026-07-19T08:30:00.000Z",
        "owner_session_status": "online"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 142,
      "pages": 8,
      "has_next": true,
      "has_previous": false
    },
    "summary": {
      "total_active": 128,
      "total_restricted": 14
    }
  },
  "meta": {
    "requestId": "req_abc123",
    "responseTime": 38,
    "timestamp": "2026-07-19T10:00:00.000Z"
  }
}
```

**`data.summary` field — metric semantics**

The `summary` object is always present in the response and reflects **global system-wide counts**, computed independently of the current `status` filter and `search` query. This is what the SuperAdmin metric cards must use:

| Field | Description |
|-------|-------------|
| `summary.total_active` | Total claimed bizcards in the system with `deactivated_flag = false`. Not affected by any filter or search. |
| `summary.total_restricted` | Total claimed bizcards in the system with `deactivated_flag = true`. Not affected by any filter or search. |

**Frontend metric card behavior (driven by `summary`)**

| Metric card | Data source | When it updates |
|-------------|-------------|-----------------|
| Visible Rows | `data.rows.length` | Updates on every page/filter/search change |
| Active | `data.summary.total_active` | Reflects global total — constant across all filter/page changes |
| Restricted | `data.summary.total_restricted` | Reflects global total — constant across all filter/page changes |

**Error codes**

| Code | HTTP status | Meaning |
|------|-------------|---------|
| `SUPERADMIN_BIZCARDS_RATE_LIMITED` | `429` | Rate limit exceeded |
| `SUPERADMIN_BIZCARDS_INVALID_STATUS` | `400` | Invalid `status` parameter value |
| `SUPERADMIN_BIZCARDS_FETCH_FAILED` | `500` | Database query failed |

---

#### `GET /api/superadmin/bizcards/:bizcardId`

Returns full detail for a single claimed bizcard. Used by the Edit BizCard modal.

**Path parameter:** `bizcardId` — numeric string, the bizcard's primary key.

**Example success response** (`200`)

```json
{
  "success": true,
  "data": {
    "bizcard_id": "12345",
    "user_id": "67890",
    "user_email": "john@example.com",
    "serial_id": "ABC123",
    "name": "John Doe",
    "subscription_tier": "standard",
    "subscription_plan_name": "Standard Plan",
    "subscription_status": "active",
    "qr_code_url": "https://cdn.example.com/qr/ABC123.png",
    "portfolio_url": "https://app.example.com/ABC123",
    "restricted": false,
    "created_at": "2026-01-15T10:00:00.000Z",
    "url_alias": "john-doe",
    "portfolio_url_editable": false,
    "owner_is_online": true,
    "owner_last_active": "2026-07-19T08:30:00.000Z",
    "owner_session_status": "online"
  },
  "meta": { "requestId": "req_abc123", "responseTime": 14 }
}
```

---

#### `PATCH /api/superadmin/bizcards/:bizcardId`

Updates the subscription tier and/or portfolio URL of a claimed bizcard. If the bizcard has a `url_alias`, the portfolio URL is locked and cannot be changed.

**Auth** — requires `withSuperAdmin` middleware + valid CSRF token.

**Request body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `subscription_tier` | string | yes* | New tier: `basic`, `standard`, or `premium`. Required unless only updating portfolio. |
| `portfolio_url` | string | no | New portfolio URL. Only valid if `portfolio_url_editable = true`. Triggers QR regeneration. |

\* At least one of `subscription_tier` or `portfolio_url` must be provided.

**Example success response** (`200`) — returns the updated bizcard detail (same shape as the detail endpoint).

---

#### `PATCH /api/superadmin/bizcards/:bizcardId/restrict`

Toggles the `restricted` (deactivated) state of a claimed bizcard.

**Auth** — requires `withSuperAdmin` middleware + valid CSRF token.

**Request body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `restricted` | boolean | yes | `true` to restrict, `false` to unrestrict |
| `reason` | string | no | Human-readable reason for the change (stored in audit log) |

**Example request**

```json
{ "restricted": true, "reason": "Restricted by super admin" }
```

**Example success response** (`200`)

```json
{
  "success": true,
  "data": {
    "bizcard_id": "12345",
    "restricted": true,
    "user_id": "67890",
    "serial_id": "ABC123"
  },
  "meta": { "requestId": "req_abc123", "responseTime": 12 }
}
```

---

#### `DELETE /api/superadmin/bizcards/:bizcardId`

Soft-deletes a user account and their claimed BizCard(s) into the **Recycle Bin**. Related data (services, socials, media, etc.) remains intact via foreign keys and is restored together when the user is restored. This is **not** a permanent delete.

**Auth** — requires `withSuperAdmin` middleware (`super_admin` role) + valid CSRF token (`x-csrf-token` header).

**Path parameter:** `bizcardId` — numeric string, the bizcard's primary key.

**Soft-delete behavior (within a single transaction)**

1. Set `User.deleted_at` to now and `User.is_active = false`.
2. Set `Bizcard.deleted_at` on all claimed (non-blank) bizcards owned by that user.
3. Revoke all active sessions for the user.
4. Does **not** modify `deactivated_flag` / `is_restricted` (restrict state is preserved for restore).

Soft-deleted users are excluded from User BizCards and Users/client lists, cannot log in, and cannot be impersonated. Permanent deletion is only available from the Recycle Bin APIs.

**No request body required.**

**Example request**

```
DELETE /api/superadmin/bizcards/12345
x-csrf-token: <csrf_token>
```

**Example success response** (`200`)

```json
{
  "success": true,
  "message": "User moved to Recycle Bin successfully.",
  "data": {
    "bizcard_id": "12345",
    "user_id": "67890",
    "serial_id": "ABC123"
  },
  "meta": {
    "requestId": "req_abc123",
    "responseTime": 94,
    "timestamp": "2026-07-20T10:00:00.000Z"
  }
}
```

**Audit log** — a `superadmin_user_soft_delete` event is written on every successful soft-delete, capturing: `deletedBizcardId`, `deletedUserId`, `serialId`, `userEmail`, requester IP, and User-Agent.

**Error codes**

| Code | HTTP status | Meaning |
|------|-------------|---------|
| `SUPERADMIN_BIZCARDS_RATE_LIMITED` | `429` | Rate limit exceeded |
| `SUPERADMIN_BIZCARDS_INVALID_ID` | `400` | `bizcardId` path parameter is not a valid positive integer |
| `SUPERADMIN_BIZCARDS_NOT_FOUND` | `404` | Bizcard not found or already in Recycle Bin |
| `SUPERADMIN_BIZCARDS_DELETE_FAILED` | `500` | Transaction failed — no data was modified |

---

#### `GET /api/superadmin/recycle-bin`

Lists soft-deleted claimed bizcards in the Super Admin Recycle Bin.

**Auth** — requires `withSuperAdmin` middleware (`super_admin` role).

**Query parameters**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `page` | `1` | 1-based page number |
| `limit` | `20` | Page size (max `100`) |
| `search` | — | Optional search across serial ID, name, email, alias |

**Example success response** (`200`)

```json
{
  "success": true,
  "data": {
    "rows": [
      {
        "bizcard_id": "12345",
        "user_id": "67890",
        "user_email": "john@example.com",
        "serial_id": "ABC123",
        "name": "John Doe",
        "subscription_tier": "standard",
        "subscription_plan_name": "Standard Plan",
        "deleted_at": "2026-07-21T10:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "pages": 1,
      "has_next": false,
      "has_previous": false
    }
  },
  "meta": { "requestId": "req_abc123", "responseTime": 18 }
}
```

**Error codes:** `SUPERADMIN_RECYCLE_BIN_RATE_LIMITED` (`429`), `SUPERADMIN_RECYCLE_BIN_FETCH_FAILED` (`500`).

---

#### `POST /api/superadmin/recycle-bin/:bizcardId/restore`

Restores a soft-deleted user and their claimed BizCard(s) from the Recycle Bin. Clears `deleted_at`, sets `User.is_active = true`, and leaves `deactivated_flag` / `is_restricted` unchanged.

**Auth** — requires `withSuperAdmin` + valid CSRF token (`x-csrf-token` header).

**Example request**

```
POST /api/superadmin/recycle-bin/12345/restore
x-csrf-token: <csrf_token>
```

**Example success response** (`200`)

```json
{
  "success": true,
  "message": "User restored successfully.",
  "data": {
    "bizcard_id": "12345",
    "user_id": "67890",
    "serial_id": "ABC123"
  },
  "meta": { "requestId": "req_abc123", "responseTime": 42 }
}
```

**Audit log** — `superadmin_user_restore`.

**Error codes:** `SUPERADMIN_RECYCLE_BIN_RATE_LIMITED` (`429`), `SUPERADMIN_RECYCLE_BIN_INVALID_ID` (`400`), `SUPERADMIN_RECYCLE_BIN_NOT_FOUND` (`404`), `SUPERADMIN_RECYCLE_BIN_RESTORE_FAILED` (`500`).

---

#### `DELETE /api/superadmin/recycle-bin/:bizcardId`

Permanently deletes a soft-deleted user and **all associated data**. Only allowed for entries already in the Recycle Bin (`deleted_at` set). Uses the hard-delete transaction (null FK children → delete bizcards → delete user + cascades).

**Auth** — requires `withSuperAdmin` + valid CSRF token (`x-csrf-token` header).

**Example request**

```
DELETE /api/superadmin/recycle-bin/12345
x-csrf-token: <csrf_token>
```

**Example success response** (`200`)

```json
{
  "success": true,
  "message": "User and all associated data permanently deleted.",
  "data": {
    "bizcard_id": "12345",
    "user_id": "67890",
    "serial_id": "ABC123"
  },
  "meta": { "requestId": "req_abc123", "responseTime": 110 }
}
```

**Audit log** — `superadmin_user_permanent_delete`.

**Error codes:** `SUPERADMIN_RECYCLE_BIN_RATE_LIMITED` (`429`), `SUPERADMIN_RECYCLE_BIN_INVALID_ID` (`400`), `SUPERADMIN_RECYCLE_BIN_NOT_FOUND` (`404`), `SUPERADMIN_RECYCLE_BIN_PURGE_FAILED` (`500`).

---

Returns all BizCards associated with the authenticated user. Regular users see only their own card. Company admins additionally see all cards belonging to their company (assigned and unassigned).

```
GET /api/bizcards/user
```

**Authentication:** Required — `session_token` cookie.

#### Query Parameters

| Parameter | Default        | Description                                                                   |
| --------- | -------------- | ----------------------------------------------------------------------------- |
| `page`    | `1`            | 1-based page number.                                                          |
| `limit`   | `20`           | Items per page. Min `1`, max `50`.                                            |
| `sortBy`  | `created_at`   | Sort field. Allowed: `created_at`, `serial_id`, `activation_status`.          |
| `sortDir` | `desc`         | Sort direction. `asc` or `desc`.                                              |

#### Success Response

```
HTTP/1.1 200 OK
```

```json
{
  "cards": [
    {
      "cardId":           "12",
      "serialId":         "W3aFXi",
      "cardType":         "employee",
      "activationStatus": "active",
      "companyId":        "3",
      "companyName":      "Acme Corp",
      "assignedUser": {
        "userId":    "7",
        "firstName": "John",
        "lastName":  "Doe",
        "customUri": "john-doe"
      },
      "qrCode":       "data:image/svg+xml;base64,...",
      "portfolioUrl": "https://www.portal.ontap.ph/john-doe",
      "connectedAt":  "2026-02-01T10:00:00.000Z",
      "scanCount":    14
    }
  ],
  "pagination": {
    "page":       1,
    "limit":      20,
    "totalItems": 1,
    "totalPages": 1
  }
}
```

| Field              | Description                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `cardId`           | BigInt serialized as string.                                                              |
| `serialId`         | The physical card's unique serial ID (NFC-embedded). Never editable.                     |
| `cardType`         | `"employee"` (issued by company) or `"individual"` (self-registered).                    |
| `activationStatus` | `"unassigned"` → `"active"` → `"inactive"` → `"revoked"`.                                |
| `qrCode`           | Base64 SVG data URL of the portfolio QR code, or `null` if vCard is not set up.          |
| `portfolioUrl`     | Full public URL to the assigned user's portfolio, or `null`.                              |
| `scanCount`        | Total number of times this card has been scanned.                                         |

#### Error Responses

| Status | Condition                    | Response Body                                                             |
| ------ | ---------------------------- | ------------------------------------------------------------------------- |
| `401`  | Missing or invalid session   | `{ "error": "Authentication required.", "requiresAuth": true }`           |
| `429`  | Rate limit exceeded (60/min) | `{ "error": "Too many requests. Please slow down." }`                     |
| `500`  | Internal error               | `{ "error": "An unexpected error occurred." }`                            |

#### Example (JavaScript/Fetch)

```javascript
const res  = await fetch("/api/bizcards/user?page=1&limit=20", { credentials: "include" });
const data = await res.json();

data.cards.forEach((card) => {
  console.log(`Card ${card.serialId} — ${card.activationStatus} — ${card.scanCount} scans`);
});
```

---

### 30. BizCard Detail

Returns the complete information for a single BizCard — including the full linked vCard profile, scan statistics, and recent scan history.

```
GET /api/bizcards/[serialId]
```

**Authentication:** Required — `session_token` cookie.

#### URL Parameters

| Parameter  | Description                                                    |
| ---------- | -------------------------------------------------------------- |
| `serialId` | The physical card's serial ID. 4–64 URL-safe characters.       |

#### Success Response

```
HTTP/1.1 200 OK
```

```json
{
  "card": {
    "cardId":           "12",
    "serialId":         "W3aFXi",
    "cardType":         "employee",
    "activationStatus": "active",
    "activatedAt":      "2026-02-01T10:00:00.000Z",
    "createdAt":        "2026-01-15T08:30:00.000Z",
    "company": {
      "companyId": "3",
      "name":      "Acme Corp"
    }
  },
  "vcard": {
    "userId":           "7",
    "firstName":        "John",
    "lastName":         "Doe",
    "middleName":       null,
    "profTitle":        "Engr.",
    "postNominal":      null,
    "vcardName":        "John Doe",
    "vcardDescription": "Software engineer at Acme Corp.",
    "jobPosition":      "Backend Engineer",
    "about":            "I build reliable systems.",
    "email":            "john@acme.ph",
    "contact":          "+63 912 345 6789",
    "altContact":       null,
    "altEmail":         null,
    "customUri":        "john-doe",
    "profileUrl":       "https://cdn.example.com/profiles/john.jpg",
    "coverUrl":         null,
    "isPublished":      true,
    "socials": [
      { "platform": "linkedin", "url": "https://linkedin.com/in/john-doe", "isVisible": true }
    ],
    "services": [
      { "name": "API Development", "description": "...", "serviceUrl": null, "isVisible": true }
    ],
    "products": [
      { "name": "Starter Kit", "description": "...", "productUrl": null, "price": "499.00", "currencyCode": "PHP" }
    ],
    "addresses": [
      { "area": "5th Floor, Tower 1", "brgy": "Ayala", "city": "Makati", "region": "Metro Manila", "zipcode": "1226", "plusCode": null }
    ]
  },
  "qrCode":       "data:image/svg+xml;base64,...",
  "portfolioUrl": "https://www.portal.ontap.ph/john-doe",
  "scanStats": {
    "totalScans": 14,
    "recentScans": [
      {
        "scannedAt":  "2026-03-10T07:22:00.000Z",
        "deviceType": "mobile",
        "browser":    "Safari",
        "os":         "iOS"
      }
    ]
  }
}
```

> `vcard` is `null` if no user is assigned to the card yet.

> `recentScans` contains the last 10 scan events (most recent first).

#### Error Responses

| Status | Condition                                          | Response Body                             |
| ------ | -------------------------------------------------- | ----------------------------------------- |
| `401`  | Missing or invalid session                         | `{ "error": "Authentication required.", "requiresAuth": true }` |
| `404`  | Card not found **or** caller not authorized        | `{ "error": "Card not found." }`           |
| `429`  | Rate limit exceeded (60/min)                       | `{ "error": "Too many requests. Please slow down." }` |
| `500`  | Internal error                                     | `{ "error": "An unexpected error occurred." }` |

> Both "not found" and "unauthorized" return the same `404` to prevent leaking card existence.

---

### 31. Edit BizCard

Updates the vCard profile data and/or activation status for a BizCard. Only the fields present in the request body are changed.

```
PUT /api/bizcards/[serialId]
```

**Authentication:** Required — `session_token` cookie.

#### URL Parameters

| Parameter  | Description                                                    |
| ---------- | -------------------------------------------------------------- |
| `serialId` | The physical card's serial ID. **Never editable itself.**      |

#### Request Body

All fields are optional. Provide only what you want to change. At least one field must be present.

```json
{
  "customUri":        "john-doe-v2",
  "vcardName":        "John A. Doe",
  "profTitle":        "Engr.",
  "jobPosition":      "Lead Backend Engineer",
  "about":            "Building the future, one API at a time.",
  "contact":          "+63 912 345 6789",
  "altContact":       "+63 998 765 4321",
  "altEmail":         "john.alt@example.com",
  "activationStatus": "inactive"
}
```

| Field              | Type     | Description                                                                             |
| ------------------ | -------- | --------------------------------------------------------------------------------------- |
| `customUri`        | `string` | New portfolio URL slug. Must be unique. Triggers QR code regeneration. Max 64 chars.   |
| `vcardName`        | `string` | Display name on the public vCard. Max 255 chars.                                        |
| `profTitle`        | `string` | Prefix title (e.g., `"Dr."`, `"Engr."`). Max 20 chars.                                 |
| `jobPosition`      | `string` | Job title. Max 100 chars.                                                               |
| `about`            | `string` | Bio / about section.                                                                    |
| `contact`          | `string` | Primary phone. Max 20 chars.                                                            |
| `altContact`       | `string` | Secondary phone. Max 20 chars.                                                          |
| `altEmail`         | `string` | Alternate email address.                                                                |
| `activationStatus` | `string` | `"active"` or `"inactive"` (any caller). `"revoked"` (company admin only).             |

> **Note:** `serialId` is never editable — it is encoded in the physical NFC chip and QR code.

#### URI Change Behaviour

When `customUri` is updated:

1. Server checks uniqueness against all other users' `custom_uri`.
2. If taken → `409 Conflict`.
3. If available → regenerates QR code → updates `User.custom_uri` and `VCardSetup.qr_code` atomically.

#### Success Response

```
HTTP/1.1 200 OK
```

```json
{
  "message": "BizCard updated successfully.",
  "card": {
    "cardId":           "12",
    "serialId":         "W3aFXi",
    "activationStatus": "inactive",
    "portfolioUrl":     "https://www.portal.ontap.ph/john-doe-v2",
    "qrCode":           "data:image/svg+xml;base64,..."
  }
}
```

> `qrCode` in the response is the newly regenerated code if `customUri` changed, or the existing code otherwise.

#### Error Responses

| Status | Condition                                               | Response Body                                                                    |
| ------ | ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `400`  | Invalid JSON body                                       | `{ "error": "Invalid JSON body." }`                                              |
| `400`  | No changes provided                                     | `{ "error": "No changes provided." }`                                            |
| `401`  | Missing or invalid session                              | `{ "error": "Authentication required.", "requiresAuth": true }`                  |
| `403`  | Non-admin attempted to set `"revoked"` status           | `{ "error": "Only a company administrator can revoke a card." }`                 |
| `404`  | Card not found **or** caller not authorized             | `{ "error": "Card not found." }`                                                 |
| `409`  | `customUri` already taken by another user               | `{ "error": "That portfolio URL is already taken. Please choose another." }`    |
| `422`  | Validation failed                                       | `{ "error": "Validation failed.", "details": ["..."] }`                          |
| `429`  | Rate limit exceeded (10/15 min)                         | `{ "error": "Too many requests. Please slow down." }`                            |
| `500`  | Internal error                                          | `{ "error": "An unexpected error occurred." }`                                   |

#### Example (JavaScript/Fetch)

```javascript
// Deactivate a card
const res = await fetch(`/api/bizcards/${serialId}`, {
  method:      "PUT",
  credentials: "include",
  headers:     { "Content-Type": "application/json" },
  body: JSON.stringify({ activationStatus: "inactive" }),
});

const data = await res.json();

if (res.ok) {
  console.log("Card status updated:", data.card.activationStatus);
}

// Update portfolio URI (triggers QR regen)
await fetch(`/api/bizcards/${serialId}`, {
  method:      "PUT",
  credentials: "include",
  headers:     { "Content-Type": "application/json" },
  body: JSON.stringify({ customUri: "john-doe-v2" }),
});
```

---

### 32. Upload Media (Proxied)

Uploads a binary file from the frontend to Cloudflare R2 via the backend, then saves the resulting URL to the database.

> Private R2 S3 endpoint URLs cannot be loaded directly in `<img>` / `<video>`. When `R2_PUBLIC_URL` is configured, this endpoint returns a browser-loadable proxy URL: `{R2_PUBLIC_URL}/api/media/file/{key}`. Consumers that still receive legacy `*.r2.cloudflarestorage.com` URLs must rewrite them with `toServableMediaSrc` or `GET /api/media/file/[...key]`.

> ⚠️ **Vercel payload limit: ≈ 4.5 MB.** Use this route for small images (profile photo, cover photo). For videos or files larger than ~4 MB, use the [signed upload flow](#33-request-signed-upload-params) instead — the backend will return a `413` with a `signEndpoint` hint.

```
POST /api/media/upload
```

**Authentication:** Required — `session_token` cookie.

**Content-Type:** `multipart/form-data`

#### Form Fields

| Field        | Type     | Required | Description                                                                    |
| ------------ | -------- | -------- | ------------------------------------------------------------------------------ |
| `file`       | `File`   | Yes      | The binary to upload.                                                          |
| `context`    | `string` | Yes      | `"profile"` · `"cover"` · `"service"` · `"portfolio"` · `"support"`                         |
| `service_id` | `string` | Cond.    | Required when `context = "service"`. The `service_id` the media belongs to.   |

#### Upload Contexts & DB Effects

| Context       | DB Effect                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `"profile"`   | Updates `User.profile_url` + all owned `Bizcard.profile_img` + inserts `Media` (`related_type = "profile"`). Invalidates public profile cache aliases. Uses **effective user id** (impersonation-aware). |
| `"cover"`     | Updates `User.cover_url` + all owned `Bizcard.cover_img` + inserts `Media` (`related_type = "cover"`). Invalidates public profile cache aliases. Uses **effective user id** (impersonation-aware). |
| `"service"`   | Inserts `Media` record with `related_type = "service_gallery"` and `related_id = service_id` (appended display order stored in `metadata.display_order`) |
| `"portfolio"` | Inserts `Media` record (`related_type = "portfolio"`)                                          |

> **Profile / cover image coalesce (dashboard + public):** reads prefer `User.profile_url` / `User.cover_url`. Profile may fall back to `Bizcard.profile_img` when User has none. Cover does **not** fall back to a stale `Bizcard.cover_img` when `User.cover_url` is empty (matches the dashboard CSS gradient empty state).
>
> **Public alias resolution:** `GET /api/public/[alias]` prefers the User whose `custom_uri` matches the alias over a conflicting `Bizcard.url_alias` owned by a different account. If that User has no bizcard, `syncUserProfileToBizcard` reclaims a stolen alias (when the conflict owner’s `custom_uri` is not that alias) and syncs images from the User record.

#### Allowed File Types

| Kind    | MIME Types                              | Max Size |
| ------- | --------------------------------------- | -------- |
| Image   | `image/jpeg`, `image/jpg`, `image/png`, `image/webp` | 10 MB    |
| Video   | `video/mp4`, `video/quicktime`, `video/webm`         | 50 MB    |

> Profile and cover slots accept **images only**.

#### Success Response

```
HTTP/1.1 200 OK
```

```json
{
  "url":         "https://www.portal.ontap.ph/api/media/file/profiles/42/1710000000-profile.jpg",
  "key":         "profiles/42/1710000000-profile.jpg",
  "mediaId":     "17",
  "contentType": "image/jpeg",
  "size":        204800
}
```

> When `R2_PUBLIC_URL` is unset, `url` falls back to the path-style R2 S3 endpoint (`https://{account}.r2.cloudflarestorage.com/{bucket}/{key}`), which is not directly loadable in browsers — use `GET /api/media/file/[...key]`.
> All IDs are BigInt serialized as strings.

#### Partial Success (207)

Returned when the R2 upload succeeded but the database record could not be saved. The `url` is usable — use [POST /api/media/register](#34-register-direct-upload) to persist the record.

```json
{
  "url":     "https://www.portal.ontap.ph/api/media/file/profiles/42/1710000000-profile.jpg",
  "key":     "profiles/42/1710000000-profile.jpg",
  "warning": "File uploaded to storage but database record could not be saved.",
  "code":    "DB_WRITE_FAILED"
}
```

#### Error Responses

| Status | Condition                                                              | Response Body                                                                                |
| ------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `400`  | Missing `file` field                                                   | `{ "error": "Missing 'file' field." }`                                                       |
| `400`  | Invalid or missing `context`                                           | `{ "error": "Invalid or missing 'context' field.", "details": "Must be one of: ..." }`        |
| `400`  | Missing `service_id` when `context = "service"`                        | `{ "error": "Missing 'service_id'." }`                                                       |
| `400`  | Unsupported MIME type                                                  | `{ "error": "Unsupported file type ...", "code": "INVALID_TYPE" }`                           |
| `401`  | Missing or invalid session                                             | `{ "error": "Unauthorized." }`                                                               |
| `403`  | `service_id` not owned by caller                                       | `{ "error": "Service not found or access denied." }`                                         |
| `413`  | File exceeds Vercel payload limit or size limit                        | `{ "error": "File exceeds allowed upload size. Please provide a hosted media URL instead.", "code": "USE_SIGNED_UPLOAD", "signEndpoint": "/api/media/sign" }` |
| `429`  | Rate limit exceeded (20 / 10 min)                                      | `{ "error": "Too many upload requests. Please try again later." }`                           |
| `500`  | R2 or DB failure                                                       | `{ "error": "Media upload to storage failed. Please try again." }`                           |

#### Example (JavaScript/Fetch)

```javascript
const formData = new FormData();
formData.append("file",    fileInput.files[0]);
formData.append("context", "profile");

const res = await fetch("/api/media/upload", {
  method:      "POST",
  credentials: "include",
  body:        formData,   // no Content-Type header — browser sets boundary automatically
});

if (res.status === 413) {
  const data = await res.json();
  // Switch to signed upload flow for large files
  startSignedUpload(data.signEndpoint);
} else if (res.ok) {
  const { url } = await res.json();
  displayAvatar(url);
}
```

---

### 33. Request Signed Upload Params

Generates a time-limited R2 presigned URL so the browser can upload a file **directly** to Cloudflare R2, bypassing Vercel's ≈ 4.5 MB serverless payload limit. Required for videos and large images.

**Required environment variables:** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET_NAME`. Returns `500` if any are missing.

> **CORS note:** Direct browser `PUT` to the presigned `uploadUrl` only works after the R2 bucket CORS policy allows your app origin (e.g. `http://localhost:3000` and production domain) with methods `PUT`, `GET`, `HEAD` and headers `Content-Type`. Without that, the Network tab shows a **CORS error** / preflight **403** even when `POST /api/media/sign` returns **200**. BizCard Services uploads use `POST /api/media/upload` (server-proxied) to avoid this requirement.

```
POST /api/media/sign
```

**Authentication:** Required — `session_token` cookie (except unauthenticated `context: "cover"` during signup).

**Content-Type:** `application/json`

#### Signed Upload Flow

```
1. POST /api/media/sign       → receive { uploadUrl, key, publicUrl, expiresIn }
2. PUT uploadUrl              → browser sends file directly to R2
3. POST /api/bizcard/services → attach publicUrl in service media array (or POST /api/media/register for profile/cover)
```

#### Request Body

```json
{
  "context":    "service",
  "file_name":  "service-media-1.jpg",
  "service_id": "99"
}
```

| Field        | Type     | Required | Description                                                                    |
| ------------ | -------- | -------- | ------------------------------------------------------------------------------ |
| `context`    | `string` | Yes      | `"profile"` · `"cover"` · `"service"` · `"portfolio"` · `"support"`          |
| `file_name`  | `string` | Yes      | Original filename including extension (used for R2 key generation).            |
| `service_id` | `string` | Cond.    | Required when `context = "service"`.                                           |

#### Success Response

```
HTTP/1.1 200 OK
```

```json
{
  "uploadUrl":  "https://xxx.r2.cloudflarestorage.com/bucket/services/42/1710000000-media.jpg?X-Amz-...",
  "key":        "services/42/1710000000-media.jpg",
  "publicUrl":  "https://xxx.r2.cloudflarestorage.com/bucket/services/42/1710000000-media.jpg",
  "expiresIn":  3600
}
```

> The presigned URL expires in **1 hour** (`expiresIn: 3600`). Use `publicUrl` when persisting the uploaded asset (e.g. in BizCard service `media` arrays).

#### How to Complete the Upload (Browser → R2)

```javascript
const signRes = await fetch("/api/media/sign", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
  body: JSON.stringify({
    context: "portfolio",       // use "service" + service_id when editing an existing service
    file_name: file.name,
  }),
});
const signData = await signRes.json();

const uploadRes = await fetch(signData.uploadUrl, {
  method: "PUT",
  headers: { "Content-Type": file.type },
  body: file,
});
// Use signData.publicUrl when saving to POST/PUT /api/bizcard/services media array
```

#### Error Responses

| Status | Condition                                                | Response Body                                                                    |
| ------ | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `400`  | Invalid or missing `context`                             | `{ "error": "Invalid or missing 'context'.", "details": "..." }`                 |
| `400`  | Missing or invalid `file_name`                           | `{ "error": "Missing or invalid 'file_name'." }`                                 |
| `400`  | Missing `service_id` when `context = "service"`          | `{ "error": "Missing 'service_id'. Required when context is 'service'." }`       |
| `401`  | Missing or invalid session                               | `{ "error": "Unauthorized." }`                                                   |
| `403`  | `service_id` not owned by caller                         | `{ "error": "Service not found or access denied." }`                             |
| `429`  | Rate limit exceeded (30 / 10 min)                        | `{ "error": "Too many signing requests. Please try again later." }`              |
| `500`  | R2 credentials missing or presigned URL generation failed | `{ "error": "Server configuration error...", "details": [...] }` (dev only)   |

---

### 34. Register Direct Upload

Saves a Cloudinary URL (from a completed direct upload) to the database. This is step 3 of the [signed upload flow](#33-request-signed-upload-params). Also used to recover from a `207` response on [POST /api/media/upload](#32-upload-media-proxied).

```
POST /api/media/register
```

**Authentication:** Required — `session_token` cookie.

**Content-Type:** `application/json`

#### Request Body

```json
{
  "context":       "service",
  "secure_url":    "https://res.cloudinary.com/dggt915hu/video/upload/v1710000000/ontap/services/s99_u42.mp4",
  "public_id":     "ontap/services/s99_u42",
  "resource_type": "video",
  "format":        "mp4",
  "bytes":         15728640,
  "mime_type":     "video/mp4",
  "service_id":    "99",
  "width":         1920,
  "height":        1080,
  "duration":      45.2
}
```

| Field           | Type     | Required | Description                                                                      |
| --------------- | -------- | -------- | -------------------------------------------------------------------------------- |
| `context`       | `string` | Yes      | `"profile"` · `"cover"` · `"service"` · `"portfolio"` · `"support"`                           |
| `secure_url`    | `string` | Yes      | The `https://` Cloudinary URL from the upload response.                          |
| `public_id`     | `string` | Yes      | Cloudinary `public_id` from the upload response.                                 |
| `resource_type` | `string` | Yes      | `"image"` or `"video"`.                                                          |
| `format`        | `string` | Yes      | File extension, e.g. `"jpg"`, `"mp4"`.                                           |
| `bytes`         | `number` | Yes      | File size in bytes.                                                              |
| `mime_type`     | `string` | Yes      | MIME type of the uploaded file.                                                  |
| `service_id`    | `string` | Cond.    | Required when `context = "service"`.                                             |
| `width`         | `number` | No       | Image/video width in pixels.                                                     |
| `height`        | `number` | No       | Image/video height in pixels.                                                    |
| `duration`      | `number` | No       | Video duration in seconds.                                                       |

> **Security:** The `secure_url` is validated to confirm it belongs to this application's Cloudinary account. Arbitrary external URLs are rejected with `400 INVALID_URL_ORIGIN`.

#### DB Effects (same as proxied upload)

| Context       | DB Effect                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `"profile"`   | Updates `User.profile_url` + inserts `Media` record                                            |
| `"cover"`     | Updates `User.cover_url` + inserts `Media` record                                              |
| `"service"`   | Inserts `Media` record with `related_type = "service_gallery"` and `related_id = service_id` |
| `"portfolio"` | Inserts `Media` record (`related_type = "portfolio"`)                                          |

#### Success Response

```
HTTP/1.1 200 OK
```

```json
{
  "mediaId": "51",
  "url":     "https://res.cloudinary.com/dggt915hu/video/upload/v1710000000/ontap/services/s99_u42.mp4"
}
```

#### Error Responses

| Status | Condition                                                       | Response Body                                                                                         |
| ------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `400`  | Invalid or missing `context`                                    | `{ "error": "Invalid or missing 'context'." }`                                                        |
| `400`  | Missing `secure_url`                                            | `{ "error": "Missing 'secure_url'." }`                                                                |
| `400`  | URL does not belong to this app's Cloudinary account            | `{ "error": "The provided URL is not a valid asset from this application's media storage.", "code": "INVALID_URL_ORIGIN" }` |
| `400`  | Missing `public_id`, `format`, or `mime_type`                   | `{ "error": "Missing 'public_id'." }` (etc.)                                                          |
| `400`  | Missing `service_id` when `context = "service"`                 | `{ "error": "Missing 'service_id'." }`                                                                |
| `401`  | Missing or invalid session                                      | `{ "error": "Unauthorized." }`                                                                        |
| `403`  | `service_id` not owned by caller                                | `{ "error": "Service not found or access denied." }`                                                  |
| `429`  | Rate limit exceeded (30 / 10 min)                               | `{ "error": "Too many requests. Please try again later." }`                                           |
| `500`  | DB write failed                                                 | `{ "error": "Failed to save media record. Please try again." }`                                       |

#### Full Signed Upload Flow Example (JavaScript)

```javascript
// ── Step 1: Get signature ──────────────────────────────────────
const signRes = await fetch("/api/media/sign", {
  method:      "POST",
  credentials: "include",
  headers:     { "Content-Type": "application/json" },
  body: JSON.stringify({
    context:    "service",
    mime_type:  videoFile.type,
    service_id: "99",
  }),
});
const signData = await signRes.json();  // { signature, timestamp, api_key, upload_url, ... }

// ── Step 2: Upload directly to Cloudinary ─────────────────────
const cloudForm = new FormData();
cloudForm.append("file",      videoFile);
cloudForm.append("api_key",   signData.api_key);
cloudForm.append("timestamp", signData.timestamp);
cloudForm.append("signature", signData.signature);
cloudForm.append("folder",    signData.folder);
cloudForm.append("public_id", signData.public_id);
cloudForm.append("overwrite", "1");

const uploadRes  = await fetch(signData.upload_url, { method: "POST", body: cloudForm });
const uploadData = await uploadRes.json();
// { secure_url, public_id, resource_type, format, bytes, width, height, duration }

// ── Step 3: Register the URL in the database ──────────────────
const regRes = await fetch("/api/media/register", {
  method:      "POST",
  credentials: "include",
  headers:     { "Content-Type": "application/json" },
  body: JSON.stringify({
    context:       "service",
    service_id:    "99",
    secure_url:    uploadData.secure_url,
    public_id:     uploadData.public_id,
    resource_type: uploadData.resource_type,
    format:        uploadData.format,
    bytes:         uploadData.bytes,
    mime_type:     videoFile.type,
    width:         uploadData.width,
    height:        uploadData.height,
    duration:      uploadData.duration,
  }),
});
const { mediaId, url } = await regRes.json();
console.log("Saved:", mediaId, url);
```

---

### 34A. Import Gallery Media (Hostinger to Cloudinary)

Bulk-imports submitted gallery media URLs (images/videos), uploads each file to Cloudinary, then saves the resulting Cloudinary URL in the `Media` table.

This endpoint is useful when your frontend (Hostinger) already has submitted media URLs and you want to migrate them into your backend-managed Cloudinary storage.

```
POST /api/media/gallery/import
```

**Authentication:** Required — `session_token` cookie.

**Content-Type:** `application/json`

#### Request Body

```json
{
  "items": [
    {
      "source_url": "https://your-hostinger-site.com/uploads/gallery/photo-1.jpg",
      "file_name": "photo-1.jpg",
      "mime_type": "image/jpeg",
      "related_type": "portfolio",
      "related_id": null
    },
    {
      "source_url": "https://your-hostinger-site.com/uploads/gallery/clip-1.mp4",
      "mime_type": "video/mp4"
    }
  ]
}
```

| Field               | Type     | Required | Description |
| ------------------- | -------- | -------- | ----------- |
| `items`             | `array`  | Yes      | Up to 50 media items per request. |
| `items[].source_url`| `string` | Yes      | Public HTTPS URL of submitted media to fetch and migrate. |
| `items[].file_name` | `string` | No       | Optional filename to store in `Media.file_name`. |
| `items[].mime_type` | `string` | No       | Optional MIME hint (`image/jpeg`, `video/mp4`, etc.). |
| `items[].related_type` | `string` | No    | Defaults to `"portfolio"`. |
| `items[].related_id` | `string \| number \| null` | No | Optional related entity ID to store in `Media.related_id`. |

#### Behavior

1. Validates each `source_url`.
2. Fetches the source media file server-side.
3. Validates media type (images/videos only) and size limits.
4. Uploads to Cloudinary.
5. Creates one `Media` row per successful import with:
   - `file_url` = Cloudinary secure URL
   - `storage_provider` = `"cloudinary"`
   - `metadata` including original `source_url` and Cloudinary metadata

#### Success Response (`200`)

Returned when all items are imported successfully.

```json
{
  "success": true,
  "summary": {
    "requested": 2,
    "imported": 2,
    "failed": 0
  },
  "imported": [
    {
      "index": 0,
      "media_id": "201",
      "file_url": "https://res.cloudinary.com/.../image/upload/...jpg",
      "mime_type": "image/jpeg"
    }
  ],
  "failed": []
}
```

#### Partial Success (`207`)

Returned when some items succeed and some fail.

```json
{
  "success": false,
  "summary": {
    "requested": 3,
    "imported": 2,
    "failed": 1
  },
  "imported": [
    {
      "index": 0,
      "media_id": "201",
      "file_url": "https://res.cloudinary.com/...",
      "mime_type": "image/jpeg"
    }
  ],
  "failed": [
    {
      "index": 2,
      "source_url": "https://...",
      "error": "Unsupported media type \"application/pdf\"."
    }
  ]
}
```

#### Error Responses

| Status | Condition | Response Body |
| ------ | --------- | ------------- |
| `400` | Invalid JSON or missing `items` | `{ "error": "Invalid JSON body." }` / `{ "error": "items must be a non-empty array." }` |
| `401` | Missing or invalid session | `{ "error": "Unauthorized." }` |
| `422` | Too many items in one request | `{ "error": "items must not exceed 50 per request." }` |
| `429` | Rate limit exceeded (10 / 10 min) | `{ "error": "Too many import requests. Please try again later." }` |

---

## Gallery Media API with Title & Description

### Enhanced Features

The gallery media API now supports **title** and **description** fields for each uploaded media item. All text fields are sanitized to prevent XSS attacks and HTML injection.

### Request Body for POST `/api/bizcard/[bizcardId]/gallery`

**Content-Type:** `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | File | Yes | Image or video file |
| `title` | string | No | User-provided title (max 255 chars, sanitized) |
| `description` | string | No | User-provided description (max 65535 chars, sanitized) |
| `alt_text` | string | No | Alternative text for accessibility (max 500 chars) |
| `is_featured` | boolean | No | Set as featured media (default: false) |
| `category` | string | No | File category (default: "gallery") |

### File Naming Convention

Uploaded files are renamed using the format:
{bizcardId}{sanitizedTitle}{timestamp}.{extension}

text

Example: `12345_my_cool_photo_1704067200000.jpg`

### Response for POST

```json
{
  "success": true,
  "data": {
    "id": 456,
    "url": "https://res.cloudinary.com/.../my_cool_photo.jpg",
    "title": "My Cool Photo",
    "description": "This is a description of my cool photo",
    "alt_text": "A beautiful landscape",
    "type": "image",
    "mime_type": "image/jpeg",
    "size": 2048576,
    "width": 1920,
    "height": 1080,
    "display_order": 0,
    "is_featured": false,
    "created_at": "2024-01-01T00:00:00.000Z"
  },
  "meta": { "requestId": "...", "responseTime": 123 }
}
Update Media Metadata / Replace File - PUT /api/bizcard/[bizcardId]/gallery/[mediaId]

JSON metadata-only request body:

json
{
  "title": "Updated Title",
  "description": "Updated description text",
  "alt_text": "Updated alt text",
  "display_order": 2,
  "is_featured": true
}

Multipart replacement (optional `file` plus metadata fields):

- `file`: image/video binary
- `title`, `description`, `alt_text`: optional text fields

Input Validation
Field	Validation Rules
title	Max 255 chars, HTML/special chars stripped, XSS sanitized
description	Max 65535 chars, HTML/special chars stripped, XSS sanitized
alt_text	Max 500 chars, HTML/special chars stripped
file	MIME/size validated via validateUploadedFile when present
Security Features
XSS Protection: All text fields are stripped of HTML tags and dangerous characters

SQL Injection Prevention: Inputs are parameterized and sanitized

File Validation: MIME types and sizes are validated before upload

Ownership Check: Users can only modify their own media

text

## 5. Migration SQL Script

```sql
-- Add title, description, and alt_text columns to Media table
ALTER TABLE `Media` 
ADD COLUMN `title` VARCHAR(255) NULL AFTER `cloudinary_public_id`,
ADD COLUMN `description` TEXT NULL AFTER `title`,
ADD COLUMN `alt_text` VARCHAR(500) NULL AFTER `description`;

-- Add indexes for better query performance
CREATE INDEX idx_media_title ON `Media`(`title`);
CREATE INDEX idx_media_description ON `Media`(`description`(100));

-- Update existing records to have empty strings instead of NULL (optional)
UPDATE `Media` SET `title` = '' WHERE `title` IS NULL;
UPDATE `Media` SET `description` = '' WHERE `description` IS NULL;
UPDATE `Media` SET `alt_text` = '' WHERE `alt_text` IS NULL;

### 35. Portfolio URI Resolver (Serial-First)

Dedicated public URI resolver endpoint with the same serial-first logic. Designed for frontend redirect orchestration and deep-link handling.

```
GET /api/portfolio/resolve/[uri]
```

**Authentication:** None (public endpoint).

#### Behavior

1. Tries `[uri]` as `serial_id` first.
2. If a linked, published, active user exists and has `custom_uri`, responds with `308` redirect to canonical URL.
3. If serial is not found, treats `[uri]` as `custom_uri` and resolves that URL.
4. Optional `?format=json` returns a JSON resolver payload instead of redirect.

#### Query Parameters

| Parameter | Type     | Description |
| --------- | -------- | ----------- |
| `format`  | `string` | If `json`, returns JSON payload (`shouldRedirect`, `portfolioUrl`, `qrCode`, `resolvedBy`) instead of HTTP redirect. |

#### Example Requests

```
GET /api/portfolio/resolve/x3ERqY
GET /api/portfolio/resolve/jane-smith
GET /api/portfolio/resolve/x3ERqY?format=json
```

#### JSON Success Example (`?format=json`)

```json
{
  "resolvedBy": "serial_id",
  "serialId": "x3ERqY",
  "customUri": "jane-smith",
  "portfolioUrl": "https://www.portal.ontap.ph/jane-smith",
  "qrCode": "data:image/svg+xml;base64,...",
  "shouldRedirect": true
}
```

| Field         | Description                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------- |
| `resolvedBy`  | Indicates resolver path: `serial_id` or `custom_uri`.                                      |
| `serialId`    | Included for serial-based hits (JSON mode), when applicable.                               |
| `customUri`   | Canonical public URI slug for the resolved profile.                                         |
| `portfolioUrl`| Canonical full URL to the public profile.                                                   |
| `qrCode`      | Base64 SVG portfolio QR code from `VCardSetup.qr_code`; generated on-the-fly when missing. |
| `shouldRedirect` | `true` when serial resolution canonicalizes to custom URI, otherwise `false`.          |

#### Error Responses

| Status | Condition | Response Body |
| ------ | --------- | ------------- |
| `404`  | No matching serial/custom URI, or profile unavailable | `{ "error": "Portfolio not found." }` |
| `429`  | Rate limit exceeded | `{ "error": "Too many requests. Please slow down." }` |
| `500`  | Internal error | `{ "error": "An unexpected error occurred." }` |

---

### 35a. Public Serial Path Canonicalization (Page Route)

Public portfolio pages are served at `/{alias}` (`app/[alias]/page.tsx`). Serial IDs are also accepted as an alternative public entry point.

**Public paths:**
- `GET /{customUri}` — loads the portfolio directly (e.g. `/jane-smith`).
- `GET /{serialId}` — server resolves the serial; if a distinct `url_alias` / `custom_uri` exists, responds with a **308** permanent redirect to `/{alias}` (no intermediate loading HTML).
- `GET /serial/{serialId}` — convenience path that redirects to `/{serialId}` (temporary redirect via `next.config`), then follows the same server resolution.

**Resolution outcomes (server):**
1. Distinct alias found → `308` to `/{alias}` (immediate, no spinner).
2. Legacy row where `url_alias` equals the serial (or no distinct alias) → render portfolio **in place** at `/{serialId}` (no self-redirect loop).
3. Blank / unclaimed / deactivated card → defer to existing client scan / claim flow.
4. Unknown serial (and not a genuine alias) → HTTP `404` Not Found.

API contracts (`GET /api/public/:alias`, `GET /api/portfolio/resolve/[uri]`, `GET /api/bizcard/scan/[serialId]`) are unchanged; they already support alias and serial fallbacks.

---

### 36. Dashboard Analytics Metrics

Returns the core dashboard counters required for the user/employee home analytics widgets.

```
GET /api/dashboard/analytics
```

**Authentication:** Required — `session_token` cookie.

#### Success Response

```
HTTP/1.1 200 OK
```

```json
{
  "profileViews": 1024,
  "associates": 30,
  "inquiries": 22,
  "contactSaves": 88,
  "publicPortfolioUrl": "https://www.portal.ontap.ph/jane-smith"
}
```

| Field | Description |
| ----- | ----------- |
| `profileViews` | Total portfolio views (`PortfolioView`). |
| `associates` | Total accepted connections involving the user. |
| `inquiries` | Total inquiries received by the user. |
| `contactSaves` | Total VCF/save-contact events (`ContactSave`). |
| `publicPortfolioUrl` | Canonical public portfolio URL for "View Public Portfolio" action, or `null` if no `custom_uri`. |

#### Error Responses

| Status | Condition | Response Body |
| ------ | --------- | ------------- |
| `401`  | Missing or invalid session | `{ "error": "Authentication required.", "requiresAuth": true }` or `{ "error": "Session expired. Please log in again.", "requiresAuth": true }` |
| `429`  | Rate limit exceeded | `{ "error": "Too many requests. Please slow down." }` |
| `500`  | Internal error | `{ "error": "An unexpected error occurred." }` |

---

### 37. Download vCard (VCF)

Generates a downloadable `.vcf` file for a published portfolio owner and records a contact-save event for analytics.

```
GET /api/vcard/download/[user_id]
```

**Authentication:** None required. Optional session cookie is used to enrich analytics with `visitor_user_id`.

#### URL Parameters

| Parameter | Description |
| --------- | ----------- |
| `user_id` | Portfolio owner user ID (numeric string). |

#### Query Parameters

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| `sessionId` | `string` | Optional anonymous session ID for deduped contact-save tracking. |

#### Response

Returns raw VCF content as a file download:

```
HTTP/1.1 200 OK
Content-Type: text/vcard; charset=utf-8
Content-Disposition: attachment; filename="jane-smith.vcf"
```

VCF includes:
- Full name
- Organization/company
- Job title
- Primary and secondary phone
- Email and alternate email
- Address (street/city/region/postal/country)
- Profile photo URL
- Portfolio URL
- Social links (`X-SOCIALPROFILE` lines)

#### Analytics Tracking

- Records into `ContactSave` on successful download.
- Deduplicates by visitor identity within a 24-hour window:
  - logged-in visitor: `visitor_user_id`
  - anonymous visitor: `anonymous_session_id`

#### Error Responses

| Status | Condition | Response Body |
| ------ | --------- | ------------- |
| `404`  | Invalid user id, unpublished profile, or inactive account | `{ "error": "Profile not found." }` |
| `429`  | Rate limit exceeded | `{ "error": "Too many requests. Please slow down." }` |
| `500`  | Internal error | `{ "error": "An unexpected error occurred." }` |

---

### 38. Inquiry Inbox

Returns the authenticated owner's inquiry inbox with status filter, search, date filter, pagination, and unread counters.

```
GET /api/inquiries
```

**Authentication:** Required — `session_token` cookie.

#### Query Parameters

| Parameter   | Default | Description |
| ----------- | ------- | ----------- |
| `status`    | —       | Optional: `new`, `unread`, `read`, `replied`. |
| `search`    | —       | Optional search against `subject`, `visitor_name`, `visitor_email` (max 100 chars). |
| `date_from` | —       | Optional start date (`YYYY-MM-DD`). |
| `date_to`   | —       | Optional end date (`YYYY-MM-DD`). |
| `page`      | `1`     | 1-based page number. |
| `limit`     | `10`    | Page size, max `100`. |

#### Sorting Behavior

Results are ordered by:

1. Newest day first (`DATE(created_at)` descending)
2. Within the same day: `new/unread` first, then `read`, then `replied`
3. Newest timestamp first

#### Success Response

```json
{
  "inquiries": [
    {
      "inquiry_id": "17",
      "sender_user_id": "42",
      "visitor_name": "Maria Santos",
      "visitor_email": "maria@example.com",
      "visitor_phone": "+63 912 345 6789",
      "subject": "Project Inquiry",
      "message": "Hi, I'd love to discuss your services.",
      "status": "new",
      "read_flag": false,
      "created_at": "2026-03-16T03:20:00.000Z",
      "updated_at": null,
      "sender": {
        "user_id": "42",
        "is_registered": true,
        "name": "Maria Santos",
        "email": "maria@example.com",
        "portfolio_alias": "maria-santos"
      }
    }
  ],
  "total": 22,
  "page": 1,
  "limit": 10,
  "totalPages": 3,
  "unreadCount": 5,
  "filters": {
    "status": "new",
    "search": null,
    "date_from": null,
    "date_to": null
  }
}
```

Each inquiry includes a `sender` object for recipient visibility:

| Field             | Type      | Description |
| ----------------- | --------- | ----------- |
| `user_id`         | `string`  | Linked account ID when visitor was logged in; otherwise `null`. |
| `is_registered`   | `boolean` | `true` when inquiry was sent by a logged-in OnTap user. |
| `name`            | `string`  | Registered user's name if linked; otherwise `visitor_name`. |
| `email`           | `string`  | Registered user's email if linked; otherwise `visitor_email`. |
| `portfolio_alias` | `string`  | Sender's primary portfolio alias when available; `null` for anonymous visitors. |

#### Error Responses

| Status | Condition | Response Body |
| ------ | --------- | ------------- |
| `401`  | Missing or invalid session | `{ "error": "Authentication required.", "requiresAuth": true }` |
| `422`  | Invalid `status` or invalid date range | `{ "error": "Invalid status. Allowed: new, unread, read, replied." }` |
| `429`  | Rate limit exceeded (120/min) | `{ "error": "Too many requests. Please slow down." }` |
| `500`  | Internal error | `{ "error": "An unexpected error occurred." }` |

---

### 39. Inquiry Detail, Status Update, Delete

Owner-scoped endpoint for reading a single inquiry, changing status, and soft-delete with ledger snapshot.

```
GET    /api/inquiries/[id]
PATCH  /api/inquiries/[id]
DELETE /api/inquiries/[id]
```

**Authentication:** Required — `session_token` cookie.

#### URL Parameters

| Parameter | Description |
| --------- | ----------- |
| `id`      | Inquiry ID (numeric string, up to 20 digits). |

#### GET Success Response

```json
{
  "inquiry": {
    "inquiry_id": "17",
    "user_id": "5",
    "sender_user_id": "42",
    "visitor_name": "Maria Santos",
    "visitor_email": "maria@example.com",
    "visitor_phone": "+63 912 345 6789",
    "subject": "Project Inquiry",
    "message": "Hi, I'd love to discuss your services.",
    "status": "new",
    "read_flag": false,
    "created_at": "2026-03-16T03:20:00.000Z",
    "updated_at": null,
    "sender": {
      "user_id": "42",
      "is_registered": true,
      "name": "Maria Santos",
      "email": "maria@example.com",
      "portfolio_alias": "maria-santos"
    }
  }
}
```

#### PATCH Request Body

```json
{
  "status": "read"
}
```

Allowed status values: `new`, `unread`, `read`, `replied`.

#### PATCH Success Response

```json
{
  "inquiryId": "17",
  "status": "read"
}
```

#### DELETE Success Response

```json
{
  "deleted": true,
  "inquiryId": "17"
}
```

#### Error Responses

| Status | Condition | Response Body |
| ------ | --------- | ------------- |
| `400`  | Invalid inquiry id / invalid patch body | `{ "error": "Invalid inquiry ID." }` |
| `401`  | Missing or invalid session | `{ "error": "Authentication required.", "requiresAuth": true }` |
| `404`  | Inquiry not found (or not owned by caller) | `{ "error": "Inquiry not found." }` |
| `429`  | Rate limit exceeded | `{ "error": "Too many requests. Please slow down." }` |

---

### 40. vCard Profile API (Modular)

The vCard profile API is now modularized into focused endpoints for parallel loading, cache isolation, and resilient UI rendering.

Current schema mapping note:
- Theme selection is stored in `User.theme_path` (resolved from `Theme.id`), not `bizcards.theme_id`.
- Core profile/contact fields are on `User` + `Address` + `Social` + `Service` (+ `Media`/`ServiceMedia`).

Deprecated (kept for backward compatibility during migration):
- `GET /api/vcard/profile`
- `PUT /api/vcard/profile`

#### GET /api/vcard/details

Fetches basic vCard details and profile information.

**Authentication:** Optional (public read, owner context if session exists)

**Query Parameters:**

| Parameter | Type | Required | Description |
| --------- | ---- | -------- | ----------- |
| `username` | string | Conditionally | Public profile key (`custom_uri` or serial). Required when `userId` is not sent. |
| `userId` | string | Conditionally | Owner lookup (requires matching authenticated session). |

**Cache:** `s-maxage=300` on public reads.

**Response Example:**

```json
{
  "success": true,
  "data": {
    "custom_uri": "johndoe",
    "bizcard_name": "John Doe",
    "description": "Connect with me digitally",
    "first_name": "John",
    "last_name": "Doe",
    "professional_title": "Software Engineer",
    "post_nominal": "M.Sc., PMP",
    "suffix": null,
    "company": "Tech Innovations Inc.",
    "address": "123 Main St, New York, NY 10001",
    "bio": "Full-stack developer...",
    "email_address": null,
    "phone_number": null,
    "alternative_email": null,
    "alternative_number": null,
    "default_language": "en",
    "is_public": true,
    "last_updated": "2026-03-18T14:20:11.000Z",
    "visibility": {
      "email_address": false,
      "phone_number": false,
      "alternative_email": false,
      "alternative_number": false
    }
  }
}
```

---

#### GET /api/vcard/design

Fetches current theme and available theme options.

**Authentication:** Optional

**Query Parameters:**

| Parameter | Type | Required | Description |
| --------- | ---- | -------- | ----------- |
| `username` | string | Conditionally | Public profile key (`custom_uri` or serial). |
| `userId` | string | Conditionally | Owner lookup (requires matching authenticated session). |

**Cache:**
- Current user/theme payload: `s-maxage=300` on public reads.
- Available theme catalog: in-memory cache up to 1 hour.

**Response Example:**

```json
{
  "success": true,
  "data": {
    "current_theme": {
      "id": "123",
      "name": "Modern Dark",
      "preview_image": "https://res.cloudinary.com/.../theme-preview.jpg",
      "is_premium": false,
      "price": 0,
      "css_variables": {
        "--primary-color": "#3498db",
        "--background-color": "#1a1a1a"
      },
      "fonts": [],
      "layout": "standard"
    },
    "available_themes": [
      {
        "id": "123",
        "name": "Modern Dark",
        "preview_image": "...",
        "is_premium": false,
        "price": 0,
        "is_selected": true,
        "is_owned": false
      }
    ],
    "customizations": {
      "accent_color": null,
      "background_image": null,
      "logo_position": "top",
      "show_qr_code": true
    }
  }
}
```

---

#### GET /api/vcard/services

Fetches services for a profile. Top-level `gallery` and `videos` arrays are always empty — service media is not projected into the portfolio gallery. Use dedicated gallery endpoints instead:

- Owner: `GET /api/bizcard/{bizcardId}/gallery`
- Public: `GET /api/public/[alias]/gallery`

Each service includes `icon` (featured image URL) for service card display.

**Authentication:** Optional

**Query Parameters:**

| Parameter | Type | Required | Description |
| --------- | ---- | -------- | ----------- |
| `username` | string | Conditionally | Public profile key (`custom_uri` or serial). |
| `userId` | string | Conditionally | Owner lookup (requires matching authenticated session). |
| `type` | string | No | `all`, `services`, `gallery`, `videos` (default `all`). When `gallery` or `videos`, `services` is empty; `gallery`/`videos` remain empty arrays. |

**Response `data` shape:**

| Field | Type | Description |
| ----- | ---- | ----------- |
| `services` | `array` | Service rows (`id`, `name`, `description`, `tagline`, `price`, `currency`, `price_display`, `is_price_negotiable`, `featured`, `icon`, `order`). Empty when `type` is `gallery` or `videos`. |
| `gallery` | `array` | Always `[]`. Portfolio gallery is not served from this endpoint. |
| `videos` | `array` | Always `[]`. Portfolio videos are not served from this endpoint. |
| `last_updated` | `string \| null` | ISO timestamp of the latest service update. |

**Cache:** `private, no-store` on authenticated/owner reads.

---

#### GET /api/vcard/social

Fetches social media links sorted by `display_order`.

**Authentication:** Optional

**Query Parameters:**

| Parameter | Type | Required | Description |
| --------- | ---- | -------- | ----------- |
| `username` | string | Conditionally | Public profile key (`custom_uri` or serial). |
| `userId` | string | Conditionally | Owner lookup (requires matching authenticated session). |
| `include_inactive` | boolean | No | Owner-only option to include hidden social links. |

**Cache:** `s-maxage=300` on public reads.

---

### User Theme Selection (Canonical)

#### PUT /api/vcard/design/theme

Updates the authenticated user's selected theme.

**Authentication:** Required (session cookie)

**Request Body:**

```json
{
  "theme_id": 123,
  "preview_only": false
}
```

Notes:
- `themeId` is also accepted for compatibility.
- `preview_only` defaults to `false`.

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "theme": {
      "id": 123,
      "name": "Dark Mode",
      "slug": "dark-mode",
      "config": {
        "--brand-color": "#111111"
      }
    },
    "preview_url": "/api/theme/preview?theme=123",
    "applied_at": "2026-03-27T10:00:00.000Z",
    "expires_at": null
  }
}
```

**Error Response:**

| Status Code | Error Code | Description |
| ----------- | ---------- | ----------- |
| `401` | `UNAUTHORIZED` | Missing or invalid session. |
| `402` | `PREMIUM_REQUIRED` | Marketplace purchase required for paid themes (`tag != free` and `price > 0`). Active subscription alone does not unlock these themes. |
| `403` | `THEME_NOT_ACCESSIBLE` | Theme is restricted to other users/companies or inactive. |
| `404` | `THEME_NOT_FOUND` | Theme ID does not exist. |
| `429` | `RATE_LIMIT_EXCEEDED` | Too many requests. |

**Behavior:**
- Validates session ownership.
- Validates theme visibility (`exclusive_for`, including `company_group:hitachi`) and active status.
- Applies purchase gating for paid marketplace themes (`tag != free` and `price > 0`) in non-preview mode via `TemplatePurchase`. Subscription alone does not grant apply rights for those themes (e.g. BubbleGem).
- `preview_only=true`: does not persist DB changes.
- Publishes `theme_updated` payload over the design stream channel.
- Invalidates vCard theme/design cache keys.
- Invalidates public profile cache keys (`public:profile:{alias}`) for the owner's `custom_uri`, `url_alias`, and `serial_id`, so public portfolio reads return the updated theme immediately.

**Source of Truth:**
- The selected theme is persisted in the `bizcard.bizcard_theme` field for the user's vCard record.
- The public design endpoint reads from this same field.

---

#### GET /api/vcard/design/preview

Returns preview payload for a selected theme without saving.

**Authentication:** Optional

**Query Parameters:**

| Parameter | Type | Required | Description |
| --------- | ---- | -------- | ----------- |
| `username` | string | Yes | Target profile key. |
| `theme_id` | string | Yes | Theme ID to preview. |
| `session_id` | string | No | Client preview session key (generated if omitted). |

**Preview lifetime:** 15 minutes.

---

#### GET /api/vcard/design/stream

Server-Sent Events endpoint for real-time theme updates.

**Authentication:** Optional public stream

**Query Parameters:**

| Parameter | Type | Required | Description |
| --------- | ---- | -------- | ----------- |
| `username` | string | Yes | Target profile key for stream channel. |

**Events:**
- `theme`: initial payload + each update
- `ping`: heartbeat every 30 seconds

**Response Headers:**
- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `Connection: keep-alive`

---

### Frontend Integration Example

```javascript
import { useEffect, useState } from "react";

export function useVCardData(username) {
  const [details, setDetails] = useState(null);
  const [design, setDesign] = useState(null);
  const [services, setServices] = useState(null);
  const [social, setSocial] = useState(null);

  useEffect(() => {
    const run = async () => {
      const [d, de, s, so] = await Promise.all([
        fetch(`/api/vcard/details?username=${username}`).then((r) => r.json()),
        fetch(`/api/vcard/design?username=${username}`).then((r) => r.json()),
        fetch(`/api/vcard/services?username=${username}`).then((r) => r.json()),
        fetch(`/api/vcard/social?username=${username}`).then((r) => r.json()),
      ]);

      setDetails(d.data);
      setDesign(de.data);
      setServices(s.data);
      setSocial(so.data);
    };

    run();
  }, [username]);

  return { details, design, services, social };
}
```

---

### Performance Benefits (Target/Measured Mix)

| Metric | Monolithic (baseline docs) | Modular (targeted) | Result |
| ------ | -------------------------- | ------------------ | ------ |
| Initial load | 350 ms | ~100 ms parallel target | Improved with parallel fetch model |
| Payload | ~45 KB single response | Sectioned responses | Smaller per-request payload |
| Cache efficiency | Global | Per-module TTL | Better invalidation granularity |
| Error blast radius | Whole profile fails | Section-level failure isolation | More resilient rendering |

### Verification Notes

-- Added modular endpoint unit coverage bundle: `npm run test:vcard:modular`
- Added SSE stream endpoint for live theme updates.
- Added new rate-limit buckets for theme update/preview/stream.
- Added media composite index in Prisma schema to accelerate service media fetches:

```prisma
@@index([user_id, related_type, related_id, created_at])
```

| `500`  | Internal error | `{ "error": "An unexpected error occurred." }` |

> `DELETE` writes a full inquiry snapshot to `DeletedRecord` inside the same transaction before removing the source row.

---

### 40. Session Health

Lightweight session check endpoint for frontend guards and periodic heartbeat checks. If a valid refresh token is present but the access token has expired, the backend silently rotates the session and returns a healthy response.

```
GET /api/auth/session-health
```

**Authentication:** Not strictly required. Returns the current session state when authenticated, otherwise reports `authenticated: false` with `200 OK`.

#### Success Response

```json
{
  "authenticated": true,
  "valid": true,
  "refreshed": false,
  "session": {
    "userId": 5,
    "email": "user@example.com",
    "role": "user",
    "sessionId": "abc123",
    "rememberMe": false,
    "expiresAt": "2026-03-16T10:00:00.000Z"
  }
}
```

#### Unauthenticated Response

```json
{
  "authenticated": false,
  "valid": false,
  "refreshed": false,
  "requiresAuth": true,
  "error": "No active session."
}
```

#### Error Responses

| Status | Condition | Response Body |
| ------ | --------- | ------------- |
| `429`  | Rate limit exceeded (120/min) | `{ "error": "Too many session checks. Please slow down." }` |
| `500`  | Internal error | `{ "error": "An unexpected error occurred." }` |

---

### 41. Public Portfolio Services

Public endpoint for rendering services on a published portfolio profile.

```
GET /api/public/[alias]/services
```

**Authentication:** None (public endpoint).

#### URL Parameters

| Parameter | Description |
| --------- | ----------- |
| `username` | Public profile identifier. Matches `custom_uri` or fallback `serial_id`. |

#### Success Response

```json
{
  "success": true,
  "data": {
    "username": "jane-smith",
    "display_name": "Jane Smith",
    "services": [
      {
        "id": "91",
        "name": "API Development",
        "description": "REST and backend platform work",
        "price": "1500.00",
        "currency": "USD",
        "price_display": "Starting at $1,500.00",
        "is_price_negotiable": false,
        "featured": true
      }
    ],
    "meta": {
      "total_services": 1,
      "last_updated": "2026-03-15T22:00:00.000Z"
    }
  }
}
```

Only `is_visible = true` and `status = "active"` services are returned.

#### Error Responses

| Status | Condition | Response Body |
| ------ | --------- | ------------- |
| `404`  | Portfolio not found / not published / inactive user | `{ "success": false, "error": "Portfolio not found." }` |
| `429`  | Rate limit exceeded (100/hr) | `{ "error": "Too many requests. Please try again later." }` |
| `500`  | Internal error | `{ "success": false, "error": "An unexpected error occurred." }` |

---

### 42. BizCard Services (List/Create)

Owner-managed service catalog endpoints used by dashboard/service management screens.

```
GET  /api/bizcard/services
POST /api/bizcard/services
```

**Authentication:** Required — `session_token` cookie.

> If the access token has expired but a valid `refresh_token` cookie is still present, the route silently refreshes the session before resolving the request.

#### GET Query Parameters

| Parameter | Default | Description |
| --------- | ------- | ----------- |
| `dashboard` | `false` | Optional flag echoed as `dashboard` in response. |
| `page`    | `1`     | 1-based page number. |
| `limit`   | `20`    | Page size, max `100`. |
| `sort`    | `created_at` | Allowed: `created_at`, `name`, `updated_at`. |
| `order`   | `desc`  | `asc` or `desc`. |
| `status`  | —       | Optional status filter (e.g. `active`, `draft`, `archived`). |

#### GET Success Response

```json
{
  "success": true,
  "dashboard": true,
  "data": [
    {
      "id": "91",
      "name": "API Development",
      "tagline": "Ship faster with modern stacks",
      "description": "REST and backend platform work",
      "price": "1500.00",
      "currency": "USD",
      "serviceUrl": "https://example.com/service",
      "isPriceNegotiable": false,
      "featured": true,
      "status": "active",
      "isVisible": true,
      "displayOrder": 0,
      "media": [
        {
          "id": "301",
          "url": "https://res.cloudinary.com/dggt915hu/image/upload/v1710000000/ontap/services/s91_u42.jpg",
          "fileName": "cover-shot.jpg",
          "mimeType": "image/jpeg",
          "bytes": "204800",
          "displayOrder": 0
        }
      ],
      "featuredImage": "https://res.cloudinary.com/dggt915hu/image/upload/v1710000000/ontap/services/feat_91.jpg",
      "usageCount": 1,
      "createdAt": "2026-03-10T10:00:00.000Z",
      "updatedAt": "2026-03-15T10:00:00.000Z"
    }
  ],
  "meta": {
    "total": 1,
    "page": 1,
    "limit": 20,
    "totalPages": 1,
    "sort": "created_at",
    "order": "desc",
    "status": null
  }
}
```

#### POST Content-Type Modes

This endpoint accepts two content-type modes:

| Mode | `Content-Type` | Use when |
| ---- | -------------- | -------- |
| **File upload** | `multipart/form-data` | Attaching a featured image file directly at service creation |
| **JSON** | `application/json` | No file upload; optionally pass a pre-uploaded R2 or legacy Cloudinary URL |

> **GET media source:** Service gallery items are read from the `ServiceMedia` table, with legacy `Media` rows (`related_type = service_gallery`) merged as fallback for older records.

> **Media URL validation:** Each `media[].url` must belong to this application's R2 bucket or legacy Cloudinary account. R2 URLs are returned as `publicUrl` from `POST /api/media/sign`.

#### POST Request Body — `application/json`

```json
{
  "name": "API Development",
  "tagline": "Ship faster with modern stacks",
  "description": "REST and backend platform work",
  "price": 1500,
  "currency": "USD",
  "serviceUrl": "https://example.com/service",
  "featured": true,
  "isVisible": true,
  "isPriceNegotiable": false,
  "status": "active",
  "featuredImageUrl": "https://res.cloudinary.com/dggt915hu/image/upload/v1710000000/ontap/services/feat_42_1710000000000.jpg",
  "media": [
    {
      "url": "https://res.cloudinary.com/dggt915hu/image/upload/v1710000000/ontap/services/tmp-service-1.jpg",
      "mimeType": "image/jpeg",
      "fileName": "hero-image.jpg",
      "bytes": 204800,
      "displayOrder": 0
    }
  ]
}
```

## Theme Management API

### Error Codes Reference

| Code | HTTP Status | Description |
| ---- | ----------- | ----------- |
| `THEME_1000` | `404` | Theme not found |
| `THEME_1001` | `409` | Theme slug already taken |
| `THEME_1002` | `403` | Theme is inactive |
| `THEME_1003` | `403` | Premium subscription or purchase required |
| `COLOR_WAY_1100` | `404` | Color way not found |
| `SELECTION_1200` | `404` | Theme selection not found |
| `SELECTION_1202` | `403` | Permission denied to modify selection |
| `SELECTION_1203` | `404` | Bizcard not found |
| `AUTH_1300` | `401` | Authentication required |
| `SYSTEM_1502` | `429` | Rate limit exceeded |

### Response Format

All endpoints return a consistent contract:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "requestId": "uuid",
    "responseTime": 123,
    "timestamp": "2026-03-25T00:00:00.000Z"
  }
}
```

Error response contract:

```json
{
  "success": false,
  "error": {
    "code": "THEME_1000",
    "message": "Theme with identifier '123' not found",
    "details": { "themeId": 123 },
    "requestId": "uuid",
    "timestamp": "2026-03-25T00:00:00.000Z"
  },
  "meta": {
    "requestId": "uuid",
    "responseTime": 45
  }
}
```

### Rate Limits

| Endpoint | Limit | Window |
| -------- | ----- | ------ |
| `GET /api/themes` | `120` | `1 minute` |
| `GET /api/themes/[themeId]` | `120` | `1 minute` |
| `POST /api/bizcard/theme` | `10` | `1 hour` |
| `POST /api/bizcard/theme/preview` | `60` | `1 minute` |
| `GET /api/admin/themes/analytics` | `30` | `1 minute` |

### Endpoints

#### `GET /api/themes`

Returns active themes with all color ways.

#### `GET /api/themes/[themeId]`

Returns one active theme and all color ways by theme ID.

#### `POST /api/bizcard/theme`

Saves or updates theme selection for a bizcard (authenticated owner).

Deprecated:
- `POST /api/bizcard/theme` is deprecated. Please migrate to `PUT /api/vcard/design/theme`.
- The endpoint returns `Deprecation: true` and a `Sunset` header.

Request body:

```json
{
  "bizcardId": 123456,
  "themeId": 1,
  "colorWayId": 2
}
```

#### `POST /api/bizcard/theme/preview`

Creates a preview token/session without permanently applying style.

Request body:

```json
{
  "bizcardId": 123456,
  "themeId": 1,
  "colorWayId": 2
}
```

#### `GET /api/bizcard/[bizcardId]/theme`

Returns current theme + color-way selection for a specific bizcard.

#### `GET /api/admin/themes/analytics`

Returns theme analytics summary and detail rows (admin/super_admin only).

`featuredImageUrl` is optional. If provided, it **must** be an `https://res.cloudinary.com/` URL. Omit the field (or set it to `null`) to create the service without a featured image.

#### POST Request Body — `multipart/form-data`

All text fields are sent as form fields (string values). The file is sent as a separate part:

| Form field | Type | Description |
| ---------- | ---- | ----------- |
| `name` | string | Required. Service name. |
| `description` | string | Optional. |
| `price` | string | Optional. Numeric string (e.g. `"1500"`). |
| `currency` | string | Optional. Default `"USD"`. |
| `serviceUrl` | string | Optional. |
| `featured` | string | Optional. `"true"` or `"false"`. |
| `isVisible` | string | Optional. `"true"` or `"false"`. |
| `isPriceNegotiable` | string | Optional. `"true"` or `"false"`. |
| `status` | string | Optional. `"active"`, `"draft"`, or `"archived"`. |
| `media` | string | Optional. JSON-stringified array of media objects (same structure as JSON mode). |
| `featured_image` | **File** | Optional. Image file to upload to Cloudinary. Allowed MIME types: `image/jpeg`, `image/png`, `image/webp`. Max **4 MB**. |

The uploaded image is stored in Cloudinary under `ontap/services/`. The resulting URL is stored as `featured_image` on the service row and returned as `featuredImage` in the response.

> **Note:** The Vercel serverless function limit is approximately 4.5 MB total payload. Keep `featured_image` files under 4 MB. The route exports `maxDuration = 60` to accommodate upload latency.

#### Service Media Rules

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| `media` | `array` | No | Array of pre-uploaded Cloudinary assets to attach to the service during create/update. |
| `media[].url` | `string` | Yes | Must be an HTTPS URL from this application's Cloudinary account. |
| `media[].mimeType` | `string` | Yes | Allowed: `image/jpeg`, `image/jpg`, `image/png`, `image/webp`, `video/mp4`, `video/quicktime`, `video/webm`. |
| `media[].fileName` | `string` | No | Optional original filename, max 255 chars. |
| `media[].bytes` | `number` | No | Optional non-negative file size in bytes. |
| `media[].displayOrder` | `number` | No | Optional zero-based ordering for the service gallery. |

#### POST Success Response

`201 Created` with created service payload in `data`. The `featuredImage` field contains the Cloudinary URL or `null`.

```json
{
  "success": true,
  "data": {
    "id": "91",
    "name": "API Development",
    "featuredImage": "https://res.cloudinary.com/dggt915hu/image/upload/v1710000000/ontap/services/feat_42_1710000000000.jpg",
    "..."
  }
}
```

#### Error Responses

| Status | Condition | Response Body |
| ------ | --------- | ------------- |
| `400`  | Invalid JSON body | `{ "error": "Invalid JSON body." }` |
| `401`  | Missing or invalid session | `{ "error": "Authentication required.", "requiresAuth": true }` |
| `409`  | Duplicate service name for same owner | `{ "error": "A service with this name already exists for your profile.", "code": "DUPLICATE_SERVICE_NAME" }` |
| `422`  | Validation failed | `{ "error": "Validation failed.", "details": ["..."] }` |
| `429`  | Rate limit exceeded | `{ "error": "Too many create attempts. Please try again later." }` |
| `500`  | Internal error | `{ "error": "An unexpected error occurred." }` |

---

### 43. BizCard Service Item (Update/Delete)

Owner-scoped update/delete endpoints for a specific service row.

```
PUT    /api/bizcard/services/[id]
DELETE /api/bizcard/services/[id]
```

**Authentication:** Required — `session_token` cookie.

#### URL Parameters

| Parameter | Description |
| --------- | ----------- |
| `id`      | Service ID (numeric string). |

#### PUT Content-Type Modes

The same two content-type modes from section 42 apply here. Only the fields you include are updated (partial update).

#### PUT Featured Image — `multipart/form-data`

| Form field | Type | Description |
| ---------- | ---- | ----------- |
| `featured_image` | **File** | New image file to upload and replace the current featured image. Uploaded with a stable public ID (`feat_{serviceId}`) so the CDN asset is overwritten in-place with no orphaned assets. |
| `remove_featured_image` | string | Set to `"true"` to explicitly remove the current featured image (sets `featured_image` to `null`). |

#### PUT Featured Image — `application/json`

| Field | Type | Description |
| ----- | ---- | ----------- |
| `featuredImageUrl` | `string` | New pre-uploaded Cloudinary URL to set as featured image. |
| `featuredImageUrl` | `null` or `""` | Explicitly removes the current featured image. |

If `featuredImageUrl` is **omitted entirely** from the JSON body, the existing featured image is left unchanged.

#### PUT Request Body — example (`application/json`)

```json
{
  "name": "API Development v2",
  "featuredImageUrl": "https://res.cloudinary.com/dggt915hu/image/upload/v1710000000/ontap/services/feat_91.jpg"
}
```

To remove: `{ "featuredImageUrl": null }`

Any subset of supported fields from section 42 can be provided.

If `media` is included on `PUT`, the existing service gallery media list is replaced with the provided array in display-order order (persisted in `Media` table with `related_type = "service_gallery"`).

#### Key Business Rules

- Name must remain unique per owner.
- If user has an active BizCard linked, service cannot be archived/hidden/deleted.

#### Success Responses

- `PUT`: `200 OK` with updated service in `data`, including `featuredImage: string | null`.
- `DELETE`: `200 OK` with `{ "success": true, "deleted": true, "serviceId": "..." }`.

#### Error Responses

| Status | Condition | Response Body |
| ------ | --------- | ------------- |
| `400`  | Invalid ID or invalid JSON body | `{ "error": "Invalid service ID." }` |
| `401`  | Missing or invalid session | `{ "error": "Authentication required.", "requiresAuth": true }` |
| `404`  | Service not found (or not owned by caller) | `{ "error": "Service not found." }` |
| `409`  | Duplicate name or active-BizCard constraint | `{ "error": "Cannot delete service while an active BizCard is linked to your profile." }` |
| `422`  | Validation failed (`PUT`) | `{ "error": "Validation failed.", "details": ["..."] }` |
| `429`  | Rate limit exceeded | `{ "error": "Too many update attempts. Please slow down." }` |
| `500`  | Internal error | `{ "error": "An unexpected error occurred." }` |

---

### 44. BizCard Themes (List/Create)

Theme catalog API with access filtering via `exclusive_for` and admin-only creation.

```
GET  /api/bizcard/themes
POST /api/bizcard/themes
```

#### GET Authentication

- Optional. Without session: returns only globally available active themes.
- With session: also returns themes exclusive to the user (`exclusive_for = userId`), user's company (`exclusive_for = company:<companyId>`), or Hitachi company group (`exclusive_for = company_group:hitachi` when the user belongs to a canonical Hitachi Solutions company).

#### POST Authentication

- Required; caller must be `admin` or `company_admin`.

#### POST Request Body

```json
{
  "name": "Ocean",
  "theme_path": "ocean",
  "css_variables": {
    "--primary": "#0ea5e9",
    "--background": "#f0f9ff"
  },
  "preview_image": "https://cdn.example.com/themes/ocean.png",
  "exclusive_for": null,
  "is_active": true
}
```

#### Success Responses

- `GET`: `200 OK` with `data` array of theme rows.
- `POST`: `201 Created` with created theme in `data`.

#### Error Responses

| Status | Condition | Response Body |
| ------ | --------- | ------------- |
| `401`  | Missing/invalid session (`POST`) | `{ "error": "Authentication required.", "requiresAuth": true }` |
| `403`  | Caller not admin (`POST`) | `{ "error": "Admin privileges required." }` |
| `409`  | Duplicate name/path (`POST`) | `{ "error": "Theme name/path already exists." }` |
| `422`  | Validation failed (`POST`) | `{ "error": "name is required and must be <= 100 characters." }` |
| `429`  | Rate limit exceeded | `{ "error": "Too many requests. Please slow down." }` |
| `500`  | Internal error | `{ "error": "An unexpected error occurred." }` |

---

### 45. BizCard Theme Item

Read/update/delete operations for a single theme.

```
GET    /api/bizcard/themes/[id]
PUT    /api/bizcard/themes/[id]
DELETE /api/bizcard/themes/[id]
```

**Authentication:** Required for all methods.

#### Access Rules

- `GET`: admin or theme-visible user.
- `PUT`: admin or direct owner (`exclusive_for === userId`).
- `DELETE`: admin only, and theme must not be in use by any user.

#### Error Responses

| Status | Condition | Response Body |
| ------ | --------- | ------------- |
| `400`  | Invalid theme ID | `{ "error": "Invalid theme ID." }` |
| `401`  | Missing/invalid session | `{ "error": "Authentication required.", "requiresAuth": true }` |
| `403`  | Forbidden action | `{ "error": "Forbidden." }` |
| `404`  | Theme not found/not accessible | `{ "error": "Theme not found." }` |
| `409`  | Duplicate path/name or theme in active use | `{ "error": "Theme is currently in use and cannot be deleted." }` |
| `429`  | Rate limit exceeded | `{ "error": "Too many write attempts. Please try again later." }` |
| `500`  | Internal error | `{ "error": "An unexpected error occurred." }` |

---

### 46. Apply User Theme

Applies an accessible theme to the authenticated user's profile.

```
PATCH /api/bizcard/user/theme
```

**Authentication:** Required — `session_token` cookie.

#### Request Body

```json
{
  "theme_id": "12"
}
```

`theme_id` can also be sent as `themeId`.

#### Success Response

```json
{
  "success": true,
  "data": {
    "user_id": "5",
    "theme_path": "ocean",
    "updated_at": "2026-03-16T09:00:00.000Z"
  },
  "cacheCleared": true
}
```

#### Error Responses

| Status | Condition | Response Body |
| ------ | --------- | ------------- |
| `400`  | Invalid JSON body | `{ "error": "Invalid JSON body." }` |
| `401`  | Missing or invalid session | `{ "error": "Authentication required.", "requiresAuth": true }` |
| `404`  | Theme not accessible for this user | `{ "error": "Theme not found or not accessible." }` |
| `422`  | Validation failed | `{ "error": "Validation failed.", "details": ["..."] }` |
| `429`  | Rate limit exceeded (10/hr) | `{ "error": "Too many theme changes. Please try again later." }` |
| `500`  | Internal error | `{ "error": "An unexpected error occurred." }` |

---

### 47. Owner Analytics Dashboard

Comprehensive owner analytics endpoint with date-range filters, summary KPIs, trend charts, location breakdown, and paginated recent activities.

```
GET /api/analytics
```

**Authentication:** Required — `session_token` cookie.

#### Query Parameters

| Parameter   | Default         | Description |
| ----------- | --------------- | ----------- |
| `filter`    | `last_30_days`  | One of: `today`, `yesterday`, `last_7_days`, `last_30_days`, `this_month`, `last_month`, `custom`. |
| `startDate` | —               | Required when `filter=custom`, format `YYYY-MM-DD`. |
| `endDate`   | —               | Required when `filter=custom`, format `YYYY-MM-DD`. |
| `page`      | `1`             | Pagination page for recent activity feed. |
| `limit`     | `20`            | Activity page size, max `100`. |

#### Success Response

```json
{
  "success": true,
  "data": {
    "summary": {
      "total_views": 1024,
      "unique_visitors": 312,
      "total_saves": 88,
      "unique_savers": 76,
      "conversion_rate": 8.6,
      "comparison": {
        "views_change": "+12.4%",
        "saves_change": "+8.1%"
      }
    },
    "charts": {
      "views_over_time": [
        { "date": "2026-03-10", "views": 44, "unique": 20 }
      ],
      "saves_over_time": [
        { "date": "2026-03-10", "saves": 5, "unique": 4 }
      ]
    },
    "locations": {
      "countries": [
        { "country": "Philippines", "code": "PH", "views": 400, "unique": 180 }
      ],
      "cities": [
        { "city": "Makati", "country": "PH", "views": 120, "unique": 65 }
      ],
      "map_data": [
        { "lat": 14.5547, "lng": 121.0244, "count": 120, "city": "Makati" }
      ]
    },
    "recent_activities": {
      "items": [
        {
          "id": "view-801",
          "type": "profile_view",
          "description": "Profile viewed from Makati, PH",
          "timestamp": "2026-03-16T08:55:00.000Z",
          "time_ago": "3 minutes ago",
          "location": "Makati, PH",
          "device": "mobile / Chrome"
        }
      ],
      "pagination": {
        "page": 1,
        "limit": 20,
        "total": 1112,
        "pages": 56
      }
    },
    "date_range": {
      "filter": "last_30_days",
      "start": "2026-02-16T00:00:00.000Z",
      "end": "2026-03-16T23:59:59.999Z"
    }
  },
  "meta": {
    "generated_at": "2026-03-16T09:00:00.000Z",
    "response_time_ms": 38,
    "cached": true,
    "requester_ip": "203.0.113.10"
  }
}
```

#### Caching Behavior

- Aggregate blocks (`summary`, `charts`, `locations`) are cached in-memory for 5 minutes per owner + date-range key.
- `recent_activities` is always queried live.

#### Error Responses

| Status | Condition | Response Body |
| ------ | --------- | ------------- |
| `401`  | Missing or invalid session | `{ "error": "Authentication required.", "requiresAuth": true }` |
| `422`  | Invalid filter/date params | `{ "error": "startDate and endDate are required when filter=custom." }` |
| `429`  | Rate limit exceeded (30/min) | `{ "error": "Too many analytics requests. Please slow down." }` |
| `500`  | Internal error | `{ "success": false, "error": "An unexpected error occurred." }` |

---

### 48. Affiliate Dashboard Summary

Aggregated KPI snapshot for an affiliate's dashboard landing page. Returns lifetime and period earnings, pending clients, conversion rate, total referral count, and the current withdrawable balance. Supports an optional previous-period comparison object for delta indicators.

```
GET /api/affiliate/dashboard/summary
```

**Authentication:** Required — `session_token` cookie. User must be an active affiliate (an `AffiliateSettings` record must exist for the user).

#### Query Parameters

| Parameter            | Default | Description |
| -------------------- | ------- | ----------- |
| `timeframe`          | `month` | One of: `month`, `quarter`, `year`, `all`. Selects the period window. |
| `include_comparison` | `true`  | When `true`, adds a `comparison` block with previous-period values and percent changes. |

#### Success Response

```json
{
  "success": true,
  "data": {
    "total_earnings_lifetime": "1250.00",
    "total_earnings_this_period": "320.00",
    "total_earnings_pending": "80.00",
    "pending_clients_count": 3,
    "conversion_rate": 24.50,
    "total_referrals_count": 12,
    "withdrawable_amount": "170.00",
    "currency": "USD",
    "timeframe": "month",
    "period_label": "Jan 2026",
    "comparison": {
      "total_earnings_this_period": "280.00",
      "total_referrals_count": 10,
      "conversion_rate": 20.00,
      "earnings_change": "+14.29%",
      "referrals_change": "+20.00%",
      "conversion_change": "+4.50%"
    }
  },
  "meta": {
    "generated_at": "2026-03-16T09:00:00.000Z",
    "cached": false
  }
}
```

#### Error Responses

| Status | Condition | Response Body |
| ------ | --------- | ------------- |
| `401`  | Missing or invalid session | `{ "error": "Authentication required.", "requiresAuth": true }` |
| `403`  | User is not an active affiliate | `{ "success": false, "error": "...", "code": "AFFILIATE_NOT_ACTIVE" }` |
| `429`  | Rate limit exceeded (30/min) | `{ "error": "Too many requests." }` |
| `500`  | Internal error | `{ "success": false, "error": "An unexpected error occurred." }` |

**Caching:** Responses are cached server-side for **2 minutes** per `userId:timeframe:includeComparison` key.

---

### 49. Affiliate Referral Clients

Paginated list of all clients referred by the affiliate, including anonymized email, referral status, lifetime order value, and order count. Supports filtering by status.

```
GET /api/affiliate/referrals/clients
```

**Authentication:** Required — active affiliate.

#### Query Parameters

| Parameter | Default | Description |
| --------- | ------- | ----------- |
| `status`  | (all)   | Filter by referral status: `pending`, `active`, or `churned`. Omit for all. |
| `page`    | `1`     | Page number (1-based). |
| `limit`   | `20`    | Page size (max 100). |

#### Success Response

```json
{
  "success": true,
  "data": {
    "total_clients": 12,
    "active_clients": 9,
    "clients_by_status": {
      "pending": 3,
      "active": 9,
      "churned": 0
    },
    "avg_order_value": "85.00",
    "lifetime_value_total": "1020.00",
    "client_list": [
      {
        "referral_id": 7,
        "email": "j***@example.com",
        "status": "active",
        "joined_at": "2026-01-10T14:22:00.000Z",
        "order_count": 3,
        "lifetime_value": "255.00",
        "commission_earned": "25.50"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 12,
      "pages": 1
    }
  },
  "meta": { "generated_at": "2026-03-16T09:00:00.000Z", "cached": false }
}
```

#### Error Responses

| Status | Condition | Response Body |
| ------ | --------- | ------------- |
| `401`  | Missing or invalid session | `{ "error": "Authentication required.", "requiresAuth": true }` |
| `403`  | Not an active affiliate | `{ "success": false, "error": "...", "code": "AFFILIATE_NOT_ACTIVE" }` |
| `429`  | Rate limit exceeded (30/min) | `{ "error": "Too many requests." }` |
| `500`  | Internal error | `{ "success": false, "error": "An unexpected error occurred." }` |

**Caching:** Responses are cached server-side for **5 minutes** per `userId:status:page:limit` key. Client emails are anonymized before caching.

---

### 50. Affiliate Earnings Breakdown

Detailed earnings breakdown by time period and by referral source (link slug). Also returns pending commissions with expected clearance dates (order date + 14 days).

```
GET /api/affiliate/earnings/breakdown
```

**Authentication:** Required — active affiliate.

#### Query Parameters

| Parameter     | Default | Description |
| ------------- | ------- | ----------- |
| `filter`      | `month` | Date range: `month`, `quarter`, `year`, `all`. |
| `granularity` | `month` | Grouping: `day` or `month`. |
| `page`        | `1`     | Page for pending_earnings list. |
| `limit`       | `20`    | Pending items page size (max 100). |

#### Success Response

```json
{
  "success": true,
  "data": {
    "earnings_by_period": [
      { "period": "2026-03", "total_earnings": "320.00", "commission_count": 4 }
    ],
    "earnings_by_source": [
      { "link_slug": "twitter-bio", "label": "Twitter Bio", "total_earnings": "180.00", "count": 2 },
      { "link_slug": null, "label": "Direct / Unknown", "total_earnings": "140.00", "count": 2 }
    ],
    "pending_earnings": {
      "items": [
        {
          "commission_id": 15,
          "amount": "20.00",
          "order_date": "2026-03-10T10:00:00.000Z",
          "expected_clearance_date": "2026-03-24T10:00:00.000Z",
          "referral_email": "j***@example.com",
          "commission_type": "one-time"
        }
      ],
      "pagination": { "page": 1, "limit": 20, "total": 4, "pages": 1 }
    }
  },
  "meta": { "generated_at": "2026-03-16T09:00:00.000Z", "cached": false }
}
```

#### Error Responses

| Status | Condition | Response Body |
| ------ | --------- | ------------- |
| `401`  | Missing or invalid session | `{ "error": "Authentication required.", "requiresAuth": true }` |
| `403`  | Not an active affiliate | `{ "success": false, "error": "...", "code": "AFFILIATE_NOT_ACTIVE" }` |
| `429`  | Rate limit exceeded (30/min) | `{ "error": "Too many requests." }` |
| `500`  | Internal error | `{ "success": false, "error": "An unexpected error occurred." }` |

**Caching:** 5-minute server-side cache per `userId:filter:granularity:page:limit`.

**Clearance window:** Commissions clear 14 days after the originating order date and become eligible for withdrawal.

---

### 51. Affiliate Conversion Funnel

Three-stage funnel metrics (clicks → signups → orders) with period-over-period comparison and day-level historical trend.

```
GET /api/affiliate/conversion/funnel
```

**Authentication:** Required — active affiliate.

#### Query Parameters

| Parameter   | Default | Description |
| ----------- | ------- | ----------- |
| `timeframe` | `month` | One of: `month`, `quarter`, `year`, `all`. |

#### Success Response

```json
{
  "success": true,
  "data": {
    "funnel_metrics": {
      "total_clicks": 250,
      "unique_clicks": 180,
      "signups": 44,
      "orders": 12,
      "total_revenue": "1020.00"
    },
    "conversion_rates": {
      "click_to_signup": 24.44,
      "signup_to_order": 27.27,
      "overall_click_to_order": 6.67
    },
    "historical_trend": [
      { "date": "2026-03-10", "clicks": 18, "signups": 4, "orders": 1 }
    ],
    "comparison_to_previous": {
      "clicks_change": "+12.50%",
      "signups_change": "+10.00%",
      "orders_change": "+20.00%",
      "revenue_change": "+15.25%"
    },
    "timeframe": "month",
    "period_label": "Jan 2026"
  },
  "meta": { "generated_at": "2026-03-16T09:00:00.000Z", "cached": false }
}
```

#### Error Responses

| Status | Condition | Response Body |
| ------ | --------- | ------------- |
| `401`  | Missing or invalid session | `{ "error": "Authentication required.", "requiresAuth": true }` |
| `403`  | Not an active affiliate | `{ "success": false, "error": "...", "code": "AFFILIATE_NOT_ACTIVE" }` |
| `429`  | Rate limit exceeded (30/min) | `{ "error": "Too many requests." }` |
| `500`  | Internal error | `{ "success": false, "error": "An unexpected error occurred." }` |

**Caching:** 5-minute server-side cache per `userId:timeframe`.

---

### 52. Affiliate Withdraw Balance

Returns the affiliate's real-time withdrawable balance, pending clearance amount, minimum withdrawal threshold, and the last 10 withdrawal transactions.

```
GET /api/affiliate/withdraw/balance
```

**Authentication:** Required — active affiliate.

#### Query Parameters

None.

#### Success Response

```json
{
  "success": true,
  "data": {
    "available_balance": "170.00",
    "pending_clearance": "80.00",
    "minimum_withdrawal": "50.00",
    "meets_threshold": true,
    "currency": "USD",
    "next_payout_date": "2026-04-01",
    "withdrawal_methods": [
      { "id": "paypal",        "label": "PayPal",        "processing_days": "1–3" },
      { "id": "bank_transfer", "label": "Bank Transfer", "processing_days": "3–5" },
      { "id": "gcash",         "label": "GCash",         "processing_days": "1–2" }
    ],
    "recent_withdrawals": [
      {
        "id": 3,
        "amount": "100.00",
        "method": "paypal",
        "status": "completed",
        "created_at": "2026-02-28T12:00:00.000Z",
        "reference_masked": "****b2f9"
      }
    ]
  },
  "meta": { "generated_at": "2026-03-16T09:01:00.000Z", "cached": false }
}
```

#### Balance Formula

```
available_balance = SUM(Commission WHERE status = 'approved')
                  - SUM(Withdrawal WHERE status IN ('requested', 'processing'))
```

#### Error Responses

| Status | Condition | Response Body |
| ------ | --------- | ------------- |
| `401`  | Missing or invalid session | `{ "error": "Authentication required.", "requiresAuth": true }` |
| `403`  | Not an active affiliate | `{ "success": false, "error": "...", "code": "AFFILIATE_NOT_ACTIVE" }` |
| `429`  | Rate limit exceeded (60/min) | `{ "error": "Too many requests." }` |
| `500`  | Internal error | `{ "success": false, "error": "An unexpected error occurred." }` |

**Caching:** 1-minute server-side cache per `userId` (shorter TTL because balance is financial).

---

### 53. Affiliate Recent Activities

Unified chronological activity feed merging click events, new referral signups, commission status changes, and withdrawal status changes. Intended for the affiliate's notification/activity panel.

```
GET /api/affiliate/activities/recent
```

**Authentication:** Required — active affiliate.

#### Query Parameters

| Parameter | Default | Description |
| --------- | ------- | ----------- |
| `page`    | `1`     | Page number (1-based). |
| `limit`   | `20`    | Page size (max 100). |

#### Success Response

```json
{
  "success": true,
  "data": {
    "activities": [
      {
        "type": "commission_approved",
        "summary": "Commission approved — $20.00",
        "amount": "20.00",
        "timestamp": "2026-03-16T08:45:00.000Z",
        "time_ago": "15 minutes ago"
      },
      {
        "type": "new_referral",
        "summary": "New referral signed up: j***@example.com",
        "email": "j***@example.com",
        "timestamp": "2026-03-16T07:30:00.000Z",
        "time_ago": "1 hour ago"
      },
      {
        "type": "link_click",
        "summary": "Click on link 'twitter-bio'",
        "link_slug": "twitter-bio",
        "converted": false,
        "timestamp": "2026-03-16T06:00:00.000Z",
        "time_ago": "3 hours ago"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "has_more": true
    }
  },
  "meta": { "generated_at": "2026-03-16T09:01:00.000Z", "cached": false }
}
```

#### Activity Types

| Type | Source Table | Description |
| ---- | ------------ | ----------- |
| `link_click` | `AffiliateClick` | A tracked link was clicked. |
| `new_referral` | `Referral` | A referred user completed registration. |
| `commission_approved` | `Commission` | A pending commission was approved. |
| `commission_paid` | `Commission` | An approved commission was marked paid. |
| `withdrawal_requested` | `Withdrawal` | Withdrawal request submitted. |
| `withdrawal_completed` | `Withdrawal` | Withdrawal processed successfully. |
| `withdrawal_rejected` | `Withdrawal` | Withdrawal was rejected. |

#### Error Responses

| Status | Condition | Response Body |
| ------ | --------- | ------------- |
| `401`  | Missing or invalid session | `{ "error": "Authentication required.", "requiresAuth": true }` |
| `403`  | Not an active affiliate | `{ "success": false, "error": "...", "code": "AFFILIATE_NOT_ACTIVE" }` |
| `429`  | Rate limit exceeded (60/min) | `{ "error": "Too many requests." }` |
| `500`  | Internal error | `{ "success": false, "error": "An unexpected error occurred." }` |

**Caching:** 30-second server-side cache per `userId:page:limit` (near-live feed).

---

### 54. Affiliate Withdrawal Request

Submits a new withdrawal request. Enforces minimum threshold, balance check, and per-minute idempotency to prevent duplicate submissions. Account details are encrypted server-side with AES-256-GCM before storage.

```
POST /api/affiliate/withdraw/request
```

**Authentication:** Required — active affiliate.

#### Request Body

```json
{
  "amount": 100.00,
  "method": "paypal",
  "account_details": {
    "email": "affiliate@example.com"
  },
  "notes": "Monthly withdrawal"
}
```

| Field             | Type   | Required | Description |
| ----------------- | ------ | -------- | ----------- |
| `amount`          | number | Yes      | Withdrawal amount in USD. Must be a positive finite number. |
| `method`          | string | Yes      | One of: `paypal`, `bank_transfer`, `gcash`. |
| `account_details` | object | Yes      | Payment destination details (method-specific fields). Encrypted before storage. |
| `notes`           | string | No       | Free-text note (max 500 characters). |

#### Success Response

```json
{
  "success": true,
  "data": {
    "withdrawal_id": "wd_7",
    "status": "requested",
    "amount": "100.00",
    "method": "paypal",
    "estimated_processing_date": "2026-03-19",
    "message": "Your withdrawal request has been submitted and is under review."
  }
}
```

#### Duplicate Detection Response (HTTP 200)

When the exact same request (same user, amount, method) is submitted within the same clock minute, the existing withdrawal is returned with `duplicate: true`:

```json
{
  "success": true,
  "data": {
    "withdrawal_id": "wd_7",
    "status": "requested",
    "amount": "100.00",
    "method": "paypal",
    "estimated_processing_date": "2026-03-19",
    "duplicate": true,
    "message": "Duplicate request detected — returning existing withdrawal."
  }
}
```

#### Error Responses

| Status | Code | Condition |
| ------ | ---- | --------- |
| `401`  | — | Missing or invalid session. |
| `403`  | `AFFILIATE_NOT_ACTIVE` | User is not an active affiliate. |
| `402`  | `INSUFFICIENT_BALANCE` | Requested amount exceeds available balance. |
| `400`  | `WITHDRAWAL_MINIMUM_NOT_MET` | Amount is below the affiliate's configured payment threshold. |
| `400`  | `INVALID_WITHDRAWAL_METHOD` | `method` is not one of the accepted values. |
| `409`  | `DUPLICATE_WITHDRAWAL_REQUEST` | Race-condition duplicate caught at DB unique constraint level. |
| `429`  | — | Rate limit exceeded (5 requests / hour). Extremely tight limit for financial writes. |
| `500`  | — | Internal error. |

**Idempotency key:** SHA-256 of `{userId}:{amount.toFixed(2)}:{method}:{minuteBucket}` stored as a `UNIQUE` column. Duplicate submissions within the same clock minute return the existing record rather than creating a new one.

**Encryption:** `account_details` is serialized to JSON and encrypted with AES-256-GCM using the `AFFILIATE_ENCRYPTION_KEY` environment variable (64-char hex / 32 bytes). The stored format is `<iv_hex>:<authTag_hex>:<ciphertext_hex>`.

---

### 55. Affiliate Links Performance

Per-link click and conversion statistics for all affiliate tracking links, with a day-level performance trend, a top-5 by revenue leaderboard, and an aggregate source breakdown.

```
GET /api/affiliate/links/performance
```

**Authentication:** Required — active affiliate.

#### Query Parameters

| Parameter   | Default | Description |
| ----------- | ------- | ----------- |
| `timeframe` | `month` | One of: `month`, `quarter`, `year`, `all`. |

#### Success Response

```json
{
  "success": true,
  "data": {
    "links": [
      {
        "id": 2,
        "slug": "twitter-bio",
        "label": "Twitter Bio",
        "full_url": "https://ontap.cards/ref/johndoe?via=twitter-bio",
        "created_at": "2026-01-05T10:00:00.000Z",
        "total_clicks": 140,
        "unique_clicks": 102,
        "conversions": 8,
        "revenue": "170.00",
        "conversion_rate": 7.84,
        "performance_trend": [
          { "date": "2026-03-10", "clicks": 12, "conversions": 1 }
        ]
      }
    ],
    "top_performing": [
      {
        "slug": "twitter-bio",
        "label": "Twitter Bio",
        "revenue": "170.00",
        "conversions": 8
      }
    ],
    "source_breakdown": {
      "total_clicks": 250,
      "total_unique_clicks": 180,
      "total_conversions": 12,
      "total_revenue": "1020.00"
    },
    "timeframe": "month"
  },
  "meta": { "generated_at": "2026-03-16T09:00:00.000Z", "cached": false }
}
```

#### Error Responses

| Status | Condition | Response Body |
| ------ | --------- | ------------- |
| `401`  | Missing or invalid session | `{ "error": "Authentication required.", "requiresAuth": true }` |
| `403`  | Not an active affiliate | `{ "success": false, "error": "...", "code": "AFFILIATE_NOT_ACTIVE" }` |
| `429`  | Rate limit exceeded (30/min) | `{ "error": "Too many requests." }` |
| `500`  | Internal error | `{ "success": false, "error": "An unexpected error occurred." }` |

**Caching:** 5-minute server-side cache per `userId:timeframe`.

---

### Environment Variables Required for Affiliate Features

| Variable | Format | Description |
| -------- | ------ | ----------- |
| `AFFILIATE_ENCRYPTION_KEY` | 64-char hex string (32 bytes) | AES-256-GCM key for encrypting withdrawal account details. Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

---

### 56. Connections Summary

```
GET /api/connections/summary
```

Returns high-level metrics for the authenticated user: total accepted connections, online-now count, pending incoming/outgoing counts, and recently added count.

---

### 57. Connections List

```
GET /api/connections/list
```

Paginated accepted connections list with search, sort, online-only filtering, and optional tag filtering.

Query parameters: `page`, `limit`, `cursor`, `search`, `online_only`, `tag`, `sort_by`, `sort_dir`.

---

### 58. Received Requests

```
GET /api/connections/requests/received
```

Returns pending requests received by the authenticated user.

---

### 59. Sent Requests

```
GET /api/connections/requests/sent
```

Returns connection requests sent by the authenticated user, with optional status filter.

---

### 60. Send Request

```
POST /api/connections/request/send
```

Creates or re-sends a pending request.

Body:

```json
{
  "receiver_id": "123",
  "relationship_type": "friend"
}
```

---

### 61. Respond to Request

```
POST /api/connections/request/respond
```

Responds to a pending request using `accept`, `decline`, or `block`.

Body:

```json
{
  "request_id": "456",
  "action": "accept"
}
```

---

### 62. Remove Connection

```
DELETE /api/connections/remove
```

Deletes an existing accepted (or pending) connection edge by connection id. Used by the Associates **Unconnect** action after viewing a connected user’s portfolio modal.

**Authentication:** Required (session). Caller must be the requester or recipient of the connection.

**Request body:**

```json
{
  "connection_id": "123"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `connection_id` | string (digits) | Yes | `connect_id` of the connection edge to remove |

**Success response (`200`):**

```json
{
  "success": true,
  "message": "Connection removed successfully",
  "removed_user_id": "456"
}
```

| Field | Type | Description |
|---|---|---|
| `success` | boolean | Always `true` on success |
| `message` | string | Human-readable confirmation |
| `removed_user_id` | string | The other party’s user id |

**Side effects:**
- Hard-deletes the `Connection` row
- Clears list/summary caches for both parties so subsequent `GET /api/connections/list` and `GET /api/connections/summary` reflect the removal

**Error responses:**

| Status | Condition |
|---|---|
| `400` | Invalid JSON body, or missing/`connection_id` not digits |
| `401`/`403` | Not authenticated, or caller is not a party on the connection |
| `404` | Connection not found |
| `429` | Rate limited (`Retry-After` header set) |

**Client notes (Associates UI):**
- After success, the actor’s Associates list updates immediately (optimistic filter + refetch) and dispatches `ontap:connections-changed`
- Peer clients on the Associates page refresh via focus/visibility handlers and a 10s visibility-aware poll

---

### 63. Block User

```
POST /api/connections/block
```

Adds a directional block record and marks matching connection edges as blocked.

---

### 64. Filter Options

```
GET /api/connections/filter-options
```

Returns available connection filters (relationship types, tags, statuses, and sort options).

---

### 65. Tags Management

```
GET    /api/connections/tags
POST   /api/connections/tags
DELETE /api/connections/tags?id=<tagId>
```

Manages user-owned tags for accepted connections.

---

### 66. Suggestions

```
GET /api/connections/suggestions
```

Returns suggested users excluding self, existing accepted connections, and blocked users.

---

### 67. Online Status

```
GET /api/connections/online/status
```

Returns currently-online accepted connections based on `UserActivity.last_active` and the configured online timeout window.

---

### 68. Notification Event Ingest

```
POST /api/notifications/event
```

Internal-only notification creation endpoint. Requires `x-internal-notification-token` matching `NOTIFICATION_INTERNAL_TOKEN`.

Accepted fields: `trigger_user_id`, `target_user_id`, `event_type`, `priority`, `metadata`, `needs_email`, `email_priority`.

Behavior:

- validates target user and event type
- suppresses blocked-user delivery
- applies per-user notification preferences
- creates the in-app notification record
- queues email when allowed and verified

---

### 69. Notification Feed

```
GET /api/notifications
```

Authenticated paginated notification list with filtering by event type, read status, priority, date range, and search string. Includes unread summary and badge metadata. Recommended response cache window: 30 seconds.

Query params: `page`, `limit`, `type`, `status`, `priority`, `from_date`, `to_date`, `search`.

---

### 70. Mark Single Notification Read

```
PATCH /api/notifications/[id]/read
```

Marks one owned notification as read and returns the updated unread count.

---

### 71. Mark All Notifications Read

```
POST /api/notifications/mark-all-read
```

Marks every unread notification for the authenticated user as read.

---

### 72. Delete Notification

```
DELETE /api/notifications/[id]
```

Deletes a single owned notification.

---

### 73. Clear Old Notifications

```
DELETE /api/notifications/clear-all
```

Bulk-clears old notifications. Supports `older_than` and `include_unread` query params.

---

### 74. Notification Preferences

```
GET /api/user/notifications/preferences
PUT /api/user/notifications/preferences
```

Retrieves and updates notification channel settings, digest schedule, digest time, timezone, quiet hours, global email opt-out, and daily email frequency counters.

**Authentication:** Session required.

#### GET response (`data`)

| Field | Type | Description |
|---|---|---|
| `preferences` | object | Per-event channel flags (`in_app`, `email`, `digest`, `push`, `priority`) |
| `email_notifications_enabled` | boolean | `true` when `unsubscribed_at` is null |
| `unsubscribed_at` | string \| null | ISO timestamp when user opted out of notification emails |
| `email_verified` | boolean | Whether notification email delivery is verified |
| `digest_schedule` | string | `daily`, `weekly`, or `never` |
| `digest_time` | string | `HH:mm` |
| `timezone` | string | IANA timezone |
| `quiet_hours` | object | `{ enabled, start, end }` |
| `email_frequency` | object | Daily email send limits |

Supported preference event keys include: `profile_view`, `inquiry_sent`, `system_update`, `promotional`, and other values from `NOTIFICATION_EVENT_TYPES`.

#### PUT body

```json
{
  "email_notifications_enabled": true,
  "preferences": {
    "inquiry_sent": { "in_app": true, "email": true, "digest": false, "push": false },
    "profile_view": { "in_app": true, "email": false, "digest": false, "push": false },
    "system_update": { "in_app": true, "email": true, "digest": false, "push": false },
    "promotional": { "in_app": false, "email": false, "digest": false, "push": false }
  }
}
```

- `email_notifications_enabled`: `true` clears `unsubscribed_at`; `false` sets opt-out timestamp.
- `preferences`: partial per-event patches are merged with stored values.
- Event types may be fully opted out (all channels `false`).

Validation rules:

- `digest_schedule`: `daily`, `weekly`, `never`
- `digest_time`: `HH:mm`
- `timezone`: valid IANA timezone

**Error tag:** `[USER_NOTIFICATIONS_PREFERENCES]`

---

### 75. Verify Notification Email

```
POST /api/notifications/verify-email
```

Sends a verification OTP for notification email delivery and stores the hashed code in `EmailOtp`.

---

### 76. Unread Count

```
GET /api/notifications/unread/count
```

Lightweight badge endpoint returning total unread notifications and per-priority counts.

---

### 77. Notification Stream

```
GET /api/notifications/stream
```

Server-Sent Events endpoint for live updates.

Behavior:

- session-authenticated
- enforces `SSE_MAX_CONNECTIONS_PER_USER`
- sends a heartbeat every 30 seconds
- closes after 1 hour
- emits `connected`, `notification`, `count_update`, `ping`, and `error`

---

### 78. Test Notification

```
POST /api/notifications/test
```

Development/admin-only helper for manual notification testing.

---

### 79. Notification Stats

```
GET /api/notifications/stats
```

Admin-only endpoint returning totals, delivery counts, grouped type metrics, and event timeline output.

---

### 80. Global Unsubscribe

```
POST /api/notifications/unsubscribe
```

Validates a signed unsubscribe token and disables future notification emails for the matching user.

---

### 81. Notification Health

```
GET /api/notifications/health
```

Authenticated notification subsystem health endpoint returning queue depth, failed deliveries, last-hour volume, and per-user SSE connection count.

---

### 82. Notification Cron Jobs

See **[Cron Jobs (cron-job.org Setup)](#cron-jobs-cron-joborg-setup)** below for the full endpoint list, schedules, and external scheduler instructions.

Core notification/email cron routes:

```
GET /api/cron/process-email-queue
GET /api/cron/send-daily-digests
GET /api/cron/send-weekly-digests
GET /api/cron/cleanup-notifications
GET /api/cron/retry-failed-emails
GET /api/cron/reset-email-counts
GET /api/cron/send-scheduled-newsletters
```

All cron routes require:

- `Authorization: Bearer <CRON_SECRET>` **or** header `x-cron-secret: <CRON_SECRET>`
- Optional second secret: `CRON_JOB_SECRET`
- Optional user-agent lockdown: `CRON_ALLOWED_USER_AGENTS=cron-job.org`

---

## Cron Jobs (cron-job.org Setup)

All `/api/cron/*` endpoints are internal scheduler routes. They are exempt from session cookies and CSRF in `proxy.ts`. Every route uses `requireCronAuth()` from `server/lib/notification-cron.ts`.

### Prerequisites (Hostinger / production env)

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `CRON_SECRET` | Yes | Long random string sent as `Authorization: Bearer <value>` or `x-cron-secret` |
| `CRON_JOB_SECRET` | No | Optional second accepted secret |
| `CRON_ALLOWED_USER_AGENTS` | No | Comma-separated substrings (e.g. `cron-job.org`) |
| `FRONTEND_URL` / `APP_URL` | Recommended | Base URL for email links |
| `EMAIL_QUEUE_BATCH_SIZE` | No | Max emails per `process-email-queue` run (default 100, cap 100) |
| `EMAIL_DAILY_LIMIT_PER_USER` | No | Per-user daily send cap (default 10) |

### How to configure on cron-job.org

1. Create a free account at [https://cron-job.org](https://cron-job.org).
2. Click **Create cronjob**.
3. Set **URL** to `https://YOUR_DOMAIN/api/cron/<endpoint>` (replace with your production domain).
4. Set **Request method** to `GET` or `POST` as listed in the schedule table below.
5. Under **Headers**, add:
   - `Authorization: Bearer YOUR_CRON_SECRET`
   - Or: `x-cron-secret: YOUR_CRON_SECRET`
6. Enable **Save responses** while testing so you can inspect JSON output.
7. Set the schedule (cron expression or cron-job.org UI picker).
8. Save and run once manually to confirm `200` + `"success": true`.

**Example curl test:**

```bash
curl -s -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://YOUR_DOMAIN/api/cron/process-email-queue
```

**Unauthorized response (401):**

```json
{ "error": "Unauthorized." }
```

### Full cron endpoint schedule table

| Job | Path | Method | Recommended schedule |
| --- | ---- | ------ | -------------------- |
| Process email queue | `/api/cron/process-email-queue` | GET | Every 5 minutes |
| Retry failed emails | `/api/cron/retry-failed-emails` | GET | Every 15 minutes |
| Daily digests | `/api/cron/send-daily-digests` | GET | Every hour |
| Weekly digests | `/api/cron/send-weekly-digests` | GET | Every hour (Mondays) |
| Scheduled newsletters | `/api/cron/send-scheduled-newsletters` | GET | Every 15 minutes |
| Company daily summary | `/api/cron/company-daily-summary` | GET | Daily 08:00 |
| Company weekly summary | `/api/cron/company-weekly-summary` | GET | Monday 08:00 |
| Top performer alert | `/api/cron/company-top-performer-alert` | GET | Daily 09:00 |
| Abandoned cart reminders | `/api/cron/abandoned-cart` | POST | Daily 10:00 |
| Trial upgrade promo (expired free trial) | `/api/cron/trial-upgrade-promo` | GET | Daily 09:30 |
| Trial experience follow-up | `/api/cron/trial-experience-followup` | GET | Daily 10:10 |
| Premium boost expiry restore | `/api/cron/premium-boost-expiry` | GET | Hourly (:20) |
| Order feedback requests | `/api/cron/order-feedback-requests` | GET | Daily 11:00 |
| Promo status update | `/api/cron/promos/update-status` | POST | Every hour |
| Subscription expiry reminders | `/api/cron/subscription-expiry` | GET | Daily 07:00 |
| QR queue flush | `/api/cron/process-qr-queue` | GET | Every 2 minutes |
| Reset email counts | `/api/cron/reset-email-counts` | GET | Daily 00:05 |
| Cleanup notifications | `/api/cron/cleanup-notifications` | GET | Daily 02:00 |
| Cleanup sessions/audit | `/api/cron/cleanup` | GET | Daily 03:00 |
| Cleanup checkout sessions | `/api/cron/cleanup-checkout-sessions` | GET | Daily 04:00 |
| Cleanup webhook events | `/api/cron/cleanup-webhook-events` | GET | Weekly (Sunday 05:00) |
| Init subscription tiers | `/api/cron/init-subscription-system` | GET | **One-time only** after deploy |

### Endpoint notes

- **`process-email-queue`** — Drains `NotificationEmailQueue` (notifications, marketing campaigns, digests). Batch size controlled by `EMAIL_QUEUE_BATCH_SIZE`.
- **`send-scheduled-newsletters`** — Auto-sends `MarketingEmailCampaign` rows with `status=draft` and `scheduled_at <= now`.
- **`abandoned-cart`** — Skips users who received an `abandoned_cart` email in the last 7 days. Supports `?dryRun=true`.
- **`trial-upgrade-promo`** — Emails expired free-trial users (within 21 days of `trial_end`) that purchasing **Basic** or **Standard** unlocks **1 month of Premium** features. Dedup via `NotificationEmailQueue.email_type=trial_upg_promo` and `User.trial_upgrade_promo_status`. On later Basic/Standard activation (checkout fulfillment or bizcard activate), `maybeApplyTrialUpgradePremiumBoost` grants a 30-day premium overlay. Supports `?dryRun=true&limit=`.
- **`premium-boost-expiry`** — Restores prior bizcard tiers when `User.premium_feature_boost_until` has passed (exclusive 3-day offer or trial-upgrade month). Supports `?dryRun=true&limit=`.
- **`trial-experience-followup`** — Separate feedback email for trials expired 7–90 days (does not grant Premium).
- **`order-feedback-requests`** — For shop orders with status `completed` or `delivered` (after a 1-hour delay), creates an `OrderFeedback` invitation (if missing), queues a one-time appreciation email with a link to `/feedback/{uuid}`, and sets `email_sent_at` so the email is never sent twice. Supports `?dryRun=true` and `?limit=` (default 40, max 100). Actual delivery is drained by `process-email-queue`.
- **`cleanup-webhook-events`** — Deletes `WebhookEvent` rows older than 30 days via `cleanupOldWebhookEvents()`.
- **`subscription-expiry`** — Daily reminder job (`lib/services/subscription-expiry-reminder.service.ts`). Detects:
  - Free trial users with **1 day** remaining (`User.trial_end`) who have no active paid bizcard
  - Paid bizcard subscriptions (`basic` / `standard` / `premium` / `enterprise`) with **3 or 1** day(s) remaining (not limited to `auto_renew`)
  - Trial or paid subscriptions that **expired today**
  
  For each match (once per user per `reminder_key` per day): creates an in-app `UserNotification` with `event_type: subscription_expiring` and sends email via `sendEmailMessage` with renew link `/user/emarket?tab=subscription`. Dedup uses notification metadata `reminder_key`. Renewal/upgrade archives pending `subscription_expiring` notifications.

  **Success response example:**

  ```json
  {
    "success": true,
    "message": "Processed 12 candidates; notified 8; emails 8; deduped 3.",
    "data": {
      "processed": 12,
      "notified": 8,
      "emailsSent": 8,
      "skippedDeduped": 3,
      "skippedNoEmail": 1,
      "errors": 0
    }
  }
  ```

- **`init-subscription-system`** — Seeds subscription tiers. Run once manually after deployment; do **not** schedule recurringly.

### Error tags (cron failures)

| Tag | Endpoint |
| --- | -------- |
| `[CRON_EMAIL_QUEUE]` | `process-email-queue` |
| `[CRON_DAILY_DIGEST]` | `send-daily-digests` |
| `[CRON_WEEKLY_DIGEST]` | `send-weekly-digests` |
| `[CRON_RETRY_EMAILS]` | `retry-failed-emails` |
| `[CRON_RESET_EMAIL_COUNTS]` | `reset-email-counts` |
| `[CRON_ABANDONED_CART]` | `abandoned-cart` |
| `[CRON_ORDER_FEEDBACK]` | `order-feedback-requests` |
| `[CRON_SUBSCRIPTION_EXPIRY]` | `subscription-expiry` |
| `[CRON_WEBHOOK_CLEANUP]` | `cleanup-webhook-events` |
| `[CRON_SCHEDULED_NEWSLETTERS]` | `send-scheduled-newsletters` |

---

### Notification Deployment Checklist

- Set `NOTIFICATION_INTERNAL_TOKEN`, `UNSUBSCRIBE_TOKEN_SECRET`, and `CRON_SECRET`.
- Verify SMTP credentials and sender-domain deliverability.
- Apply Prisma schema changes before enabling cron jobs.
- Ensure Hostinger MySQL remote access is enabled for Vercel.
- Monitor queue growth, failed delivery count, and SSE connection churn.
- Keep `EMAIL_DAILY_LIMIT_PER_USER` aligned with provider send limits.
- Validate unsubscribe links in all outbound notification templates.


---

## Physical Card & QR Code API (Phase Start)

This phase introduces additive endpoints for physical-card scan handling and dashboard QR lifecycle management while keeping existing routes operational.

### Error Codes Reference

| Code | HTTP Status | Description |
| ---- | ----------- | ----------- |
| `QR_5000` | 500 | QR code generation failed |
| `QR_5001` | 404 | QR code or bizcard not found |
| `QR_5003` | 400 | Invalid QR source URL |
| `PHYSICAL_5100` | 404 | Physical card not found |
| `PHYSICAL_5101` | 409 | Physical card already linked or already exists |
| `PHYSICAL_5104` | 409 | Physical card exists but not linked to a user |
| `SERIAL_5200` | 400 | serial_id required |
| `SERIAL_5201` | 400 | Invalid serial_id format |
| `MERGE_5300` | 404 | Virtual card not found for merge |
| `MERGE_5301` | 409 | Virtual card already merged |

### Serial ID Rules Enforced

- Virtual cards not merged: `serial_id = NULL`
- Virtual cards merged: `serial_id IS NOT NULL`
- Physical cards: `serial_id IS NOT NULL`
- `serial_id` remains unique when present

### New Additive Endpoints

#### `GET /api/bizcard/scan/[serialId]`

Resolves a physical card scan from a portfolio URL (`https://{APP_URL}/{SERIAL_ID}`).

- Authentication: Optional (session-aware routing; expired access tokens are refreshed via `refresh_token` when present — important for iOS Safari scan flows)
- Query params:
  - `redirect=true` — perform HTTP redirect to the resolved `redirectUrl`
- Response `data` fields:
  - `status`: `linked | blank | not_found | deactivated`
  - `isPlaceholder`: whether the DB row still has factory placeholder content
  - `nextAction`: `show_portfolio | signup | merge_choice | manual_register`
  - `redirectUrl`: browser destination for the current session state
  - `virtualCards`: unlinked virtual cards eligible for merge (authenticated users only)
- Error tag: `[BIZCARD_SCAN_API]`

Example:

```json
{
  "success": true,
  "data": {
    "serialId": "A3F8K2",
    "status": "blank",
    "isPlaceholder": true,
    "nextAction": "merge_choice",
    "portfolioUrl": "https://portal.ontap.ph/A3F8K2",
    "redirectUrl": "https://portal.ontap.ph/scan/A3F8K2/merge?virtualId=42",
    "virtualCards": [
      {
        "id": "42",
        "name": "My Virtual Card",
        "title": "Consultant",
        "fullName": "Jane Doe",
        "createdAt": "2026-06-22T10:00:00.000Z"
      }
    ]
  }
}
```

#### `GET /api/public/scan/[serialId]`

Public scan entrypoint for physical card QR redirection.

- Authentication: Not required
- Behavior: Resolves serial ID and redirects to `/{url_alias}` on success
- Error mode: Returns user-friendly HTML error page for not found / unavailable cards

#### `POST /api/physical-cards/register`

Registers a new physical card record.

- Authentication: Required (`super_admin` or `dev`)
- Request body:

```json
{
  "serial_id": "PHYSCARD001"
}
```

#### `POST /api/bizcard/[bizcardId]/merge`

Merges a user-owned virtual bizcard with a physical serial.

- Authentication: Required
- Request body:

```json
{
  "serial_id": "PHYSCARD001"
}
```

#### `GET /api/user/dashboard/qr-code`

Returns QR metadata for the authenticated user's primary active bizcard and lazily generates one if missing.

#### `GET /api/user/dashboard/qr-code/download`

Downloads the **offline vCard QR** as a PNG for the authenticated user's primary active bizcard. The PNG encodes vCard (VCF) contact data (name, phone, email, org/title, portfolio URL, and social profile URLs as `X-SOCIALPROFILE`), not the portfolio URL alone.

#### `GET /api/user/bizcards/[bizcardId]/qr-code/download`

Downloads the offline vCard QR as a PNG for a specific owned bizcard.

- **Authentication:** Required (session)
- **Authorization:** Bizcard must belong to the authenticated user
- **Response:** `image/png` with `Content-Disposition: attachment; filename="bizcard-{bizcardId}-offline-qr.png"`

**Frontend Share Card UI (bizcard detail):** `/user/bizcard/{bizcardId}` displays two labeled QR codes — **Portfolio Link** (URL-encoded) and **VCard Details** (offline vCard QR built from live contact fields including social profile URLs as `X-SOCIALPROFILE` lines; persisted `qr_code_url` is regenerated after social updates). Contact phone, email, and location render below when present.

**Bizcard editor deep link:** `/user/bizcard?bizcardId={bizcardId}` loads the editor for a specific owned card via `GET /api/user/bizcards/[bizcardId]`. Admin portal re-exports the same editor at `/admin/bizcard?bizcardId={bizcardId}`.

**`GET /api/user/bizcards/[bizcardId]` service/social shapes:** `services[]` includes `tagline`, `featured_image`, `display_order`, `is_visible`, and `status`. `social_links[]` includes all platforms saved for the user, scoped by `bizcard_id` when present (legacy rows without `bizcard_id` fall back to `user_id`). `languages` is returned as a string array parsed from `Bizcard.languages`.

#### `POST /api/user/dashboard/qr-code/regenerate`

Regenerates and persists QR/VCF assets for the authenticated user's primary active bizcard.

- **Authentication:** Required (session)
- **Behavior:** Uploads a downloadable `.vcf` file to Cloudinary (`Bizcard.vcf_file_url`), generates a **portfolio URL QR** (`Bizcard.portfolio_qr_code_url`), and a **VCF-content QR** (`Bizcard.qr_code_url`). Updates `Bizcard.portfolio_url` and `Bizcard.qr_code_generated_at`.
- **Cloudinary paths:**
  - VCF file (raw): `ontap/vcf/{bizcardId}/{url_alias}.vcf`
  - Portfolio QR (image): `ontap/qrcodes/{bizcardId}/portfolio_qr_{bizcardId}`
  - VCF QR (image): `ontap/qrcodes/{bizcardId}/qr_code_{bizcardId}`

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "qr_code_url": "https://res.cloudinary.com/.../qr_code_123.png",
    "portfolio_qr_code_url": "https://res.cloudinary.com/.../portfolio_qr_123.png",
    "vcf_file_url": "https://res.cloudinary.com/.../contact.vcf",
    "portfolio_url": "https://ontap.portal.ph/my-alias",
    "qr_code_generated_at": "2026-06-25T12:00:00.000Z",
    "message": "QR codes and VCF file regenerated successfully. Previous assets may be cached briefly."
  }
}
```

**Error tags:** `QR_ALIAS_MISSING` (409), `QR_CODE_INVALID_URL`, `QR_CODE_GENERATION_FAILED`, `MIGRATE_QR_VCF_REGEN_FAILED`, `MIGRATE_VCF_UPLOAD_FAILED`, `MIGRATE_PORTFOLIO_QR_FAILED`

#### `GET /api/bizcard/[bizcardId]/qr-code-stats`

Returns scan analytics (`total_scans`, `scans_today`, `unique_ips`, top locations, timeline) from `qr_code_scans`.

- Authentication: Required
- Authorization: bizcard owner, super admin/dev, or company admin in same company

---

## Bizcard API

The Bizcard API provides access to digital business card information. vCard profile payloads now support bizcard-backed resolution while keeping backward-compatible user_id behavior during transition.

### Data Model

The bizcard table contains profile information including:
- Personal details (name, occupation, title)
- Contact information (email, phone)
- Location details (address, city, region)
- Media (profile image, cover image)
- Theme and design preferences
- Status flags (merged, deactivated)

### Endpoints

#### GET /api/vcard/details
Fetches basic bizcard details and profile information.

Parameters:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| username | string | Yes* | URL alias of the bizcard |
| userId | string | Yes* | User ID (for authenticated user's own data) |

Either username or userId must be provided.

**Migrated / dual-source names:** When the resolved bizcard has blank `first_name` / `last_name` / title / bio fields (common after legacy migration), the API blank-coalesces those fields from the linked `User` record so public and owner views show the same identity. Blank placeholder cards (`is_blank: true`) are excluded from alias resolution.

Response example:
```json
{
  "success": true,
  "data": {
    "bizcard_id": "1024",
    "custom_uri": "jane-smith",
    "bizcard_name": "Jane Smith",
    "description": "Founder profile",
    "first_name": "Jane",
    "last_name": "Smith",
    "professional_title": "Founder",
    "company": "Acme Corp",
    "address": "Makati, NCR, 1200",
    "bio": "Building products",
    "email_address": null,
    "phone_number": null,
    "is_public": true
  }
}
```

#### GET /api/vcard/design
Fetches theme and design settings.

Parameters:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| username | string | Yes* | URL alias of the bizcard |
| userId | string | Yes* | User ID for owner context |

Response includes `current_theme`, `available_themes`, and `customizations` (including profile/cover images).

#### GET /api/vcard/services
Fetches services for a profile. Top-level `gallery` and `videos` are always empty (service media is not projected as portfolio gallery). Use `GET /api/bizcard/{bizcardId}/gallery` or `GET /api/public/[alias]/gallery` for portfolio media. Service featured images are returned on each service as `icon`.

Parameters:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| username | string | Yes* | URL alias of the bizcard |
| userId | string | Yes* | Owner user ID |
| type | string | No | all, services, gallery, videos (default: all) |

#### GET /api/vcard/social
Fetches social links.

Parameters:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| username | string | Yes* | URL alias of the bizcard |
| userId | string | Yes* | Owner user ID |

#### GET /api/public/[alias]
Complete public portfolio view with bizcard data and related sections.

Parameters:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| username | string | Yes | URL alias in path |

**Name / identity fields (migration-tolerant):** Presentation names prefer non-blank Bizcard values and fall back to the linked User when Bizcard `first_name` / `last_name` / title / bio are empty or whitespace-only. Blank cards (`is_blank: true`) are not served. Response includes:

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Composed display name from coalesced first/last |
| `first_name` | `string` | Coalesced first name |
| `last_name` | `string` | Coalesced last name |
| `middle_name` | `string \| null` | Coalesced middle name when available |
| `bizcard_name` | `string \| null` | Card display name (falls back to composed name) |

Response includes subscription feature flags used by portfolio themes:

| Field | Type | Description |
|-------|------|-------------|
| `subscription_tier` | `string \| null` | Owner tier: `basic`, `standard`, `premium`, or `null` (free trial / unset) |
| `gallery_available` | `boolean` | `true` only when tier is `standard` or `premium` |
| `inquiry_enabled` | `boolean` | `true` only when tier is `premium` |

When `gallery_available` is `false`, `gallery` and `videos` arrays are empty in the response. Portfolio UIs should hide gallery and inquiry sections based on these flags.

The `address` object may include coordinates for map rendering:

| Field | Type | Description |
|-------|------|-------------|
| `latitude` | `number \| null` | WGS84 latitude from stored address or server-side geocode fallback |
| `longitude` | `number \| null` | WGS84 longitude from stored address or server-side geocode fallback |
| `map_link` | `string \| null` | Google Maps / plus-code link when provided |
| `plus_code` | `string \| null` | Open Location Code when stored |

Portfolio Location sections use `address.latitude` and `address.longitude` from the **Address** table (not `bizcard.address_link`) to render an embedded Leaflet map pin. Coordinates are read from the user's most recently updated address row; if missing, the server may geocode from that address row's text fields only.

Cache: `public, s-maxage=60, stale-while-revalidate=120`

#### GET /api/geocode
Server-side geocoding proxy (OpenStreetMap Nominatim) for authenticated setup flows.

Used by bizcard setup (`VCardDetails`) and edit (`BizCardVcardTab`) address fields (`AddressLocationFields`) to:
- Progressively zoom the live map as the user types city / barangay / street (leading street tokens are stripped until a match is found)
- Prioritize plus codes and Google Maps URLs when provided
- Reverse-geocode device coordinates to autofill region, city, barangay, street, and zip

Authentication: Required (`session_token` cookie).

Rate limit: `30` requests per `15` minutes per IP (`geocode` bucket).

##### Forward mode (address / plus code / map query)

Query parameters (at least `city`, composed `q`, plus code, or coordinates string required):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | No* | Full address, plus code, or map query string |
| `area` | string | No | House no. / street / subdivision |
| `brgy` | string | No | Barangay |
| `city` | string | No* | City / municipality |
| `region` | string | No | Region |
| `zipcode` | string | No | Postal code |

Forward responses:

| Status | Body |
|--------|------|
| `200` | `{ "latitude": number, "longitude": number, "displayName": string, "zipcode": string \| null, "mode": "forward" }` |
| `404` | `{ "error": "...", "code": "GEOCODE_NOT_FOUND", "tag": "[GEOCODE_API]" }` |
| `401` | `{ "error": "...", "code": "GEOCODE_UNAUTHORIZED", "tag": "[GEOCODE_API]" }` |
| `422` | `{ "error": "...", "code": "GEOCODE_INVALID_QUERY" \| "GEOCODE_CITY_REQUIRED", "tag": "[GEOCODE_API]" }` |
| `429` | `{ "error": "...", "code": "GEOCODE_RATE_LIMITED", "tag": "[GEOCODE_API]" }` |
| `502` | `{ "error": "...", "code": "GEOCODE_SERVICE_ERROR", "tag": "[GEOCODE_API]" }` |

##### Reverse mode (device coordinates)

Query parameters:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `lat` | number | Yes | Latitude (`-90` to `90`) |
| `lng` | number | Yes* | Longitude (`-180` to `180`). Aliases: `lon`, `longitude` |

Reverse responses:

| Status | Body |
|--------|------|
| `200` | `{ "latitude": number, "longitude": number, "displayName": string, "region": string \| null, "city": string \| null, "barangay": string \| null, "suburb": string \| null, "area": string \| null, "houseNumber": string \| null, "zipcode": string \| null, "mode": "reverse" }` |
| `404` | `{ "error": "...", "code": "GEOCODE_REVERSE_NOT_FOUND", "tag": "[GEOCODE_API]" }` |
| `422` | `{ "error": "...", "code": "GEOCODE_INVALID_COORDINATES", "tag": "[GEOCODE_API]" }` |
| `502` | `{ "error": "...", "code": "GEOCODE_REVERSE_SERVICE_ERROR", "tag": "[GEOCODE_API]" }` |

Example reverse request:

```http
GET /api/geocode?lat=14.4081&lng=121.0415
Cookie: session_token=...
```

#### GET /api/psgc/regions
Proxy to PSGC Cloud regions catalog used by cascading address selectors.

Authentication: Not required (public reference data).

Response `200`:

```json
{
  "success": true,
  "data": [
    { "code": "1300000000", "name": "National Capital Region (NCR)" }
  ]
}
```

Error tags: `[PSGC_REGIONS_API]` (`REGIONS_FETCH_FAILED`, `REGIONS_TIMEOUT`, `REGIONS_NETWORK_ERROR`).

Cache: `public, max-age=86400`

#### GET /api/psgc/cities
Fetch cities and municipalities for a region (PSGC v2 hierarchy with legacy fallback + region-prefix filter).

Authentication: Not required.

Query parameters:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `regionCode` | string | Yes | 10-digit PSGC region code |

Response `200`:

```json
{
  "success": true,
  "data": [
    {
      "code": "1380800000",
      "name": "City of Muntinlupa",
      "type": "City",
      "district": "Lone",
      "zip_code": "1770"
    }
  ]
}
```

Error codes/tags: `[PSGC_CITIES_API]` (`MISSING_REGION_CODE`, `INVALID_REGION_CODE_FORMAT`, `CITIES_FETCH_FAILED`, `CITIES_TIMEOUT`).

Cache: `public, max-age=86400`

#### GET /api/psgc/barangays
Fetch barangays for a city or municipality via PSGC hierarchy endpoints (`/cities/{code}/barangays`, then `/municipalities/{code}/barangays`).

Authentication: Not required.

Query parameters:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cityCode` | string | Yes | 10-digit PSGC city/municipality code |

Response `200`:

```json
{
  "success": true,
  "data": [
    { "code": "1380800001", "name": "Alabang", "status": "71075" }
  ]
}
```

Error codes/tags: `[PSGC_BARANGAYS_API]` (`MISSING_CITY_CODE`, `INVALID_CITY_CODE_FORMAT`, `BARANGAYS_FETCH_FAILED`, `BARANGAYS_TIMEOUT`). Incomplete upstream data returns an empty `data` array instead of failing the UI.

Cache: `public, max-age=86400`

#### POST /api/bizcard/create
Creates a new bizcard row for the authenticated user. If fields are omitted, legacy user profile fields are used as defaults.

Authentication: Required (`session_token` cookie).

Notes:
- Validates required fields: `bizcard_name`, `first_name`, `last_name`, `email`, `contact_number`.
- Enforces unique `url_alias` and `serial_id`.
- Supports `bizcard_type` (`virtual` or `physical`, default `virtual`).

#### PUT /api/bizcard/update
Updates an existing bizcard for the authenticated user.

Authentication: Required (`session_token` cookie). Supports superadmin impersonation via `superadmin_impersonation_token` cookie or `x-impersonation-token` header; updates target the **effective** (impersonated) user.

Parameters/body:
- Optional `bizcard_id` to target a specific card.
- If omitted, the most recently updated card owned by the user is updated.
- Supports partial updates; unchanged fields are preserved.
- Enforces unique `url_alias` and `serial_id`.
- Rejects `bizcard_theme` updates for company-managed members (`403`, `COMPANY_3010`), except when Super Admin impersonation is active (full authority override). Company admins must use `PUT /api/company/theme` for normal member updates.
- Theme-only updates (`bizcard_theme` / `bizcardTheme`) immediately invalidate public profile cache keys (`public:profile:{alias}`) for the user's `custom_uri`, `url_alias`, and `serial_id`, so `GET /api/public/[alias]` reflects the new theme without waiting for the 60-second TTL.
- Full / partial profile field updates (including name fields) also invalidate the same `public:profile:{alias}` keys so public portfolios stay consistent across devices after save.

### Database Schema Changes

Users table transition plan keeps auth and account-level data in `User`, while profile and presentation fields move to `bizcard`.

Bizcard table fields include:
- `bizcard_id`, `user_id`, `bizcard_name`, `serial_id`, `url_alias`
- Professional fields (`occupation`, `professional_title`, `post_nominal`, `suffix`)
- Address fields (`area`, `baranggay`, `city`, `zip_code`, `region`, `address_link`)
- Contact/media (`email`, `contact_number`, `alt_email`, `alt_contact_number`, `profile_img`, `cover_img`)
- Status fields (`linked_account`, `is_merged`, `deactivated_flag`, `merged_at`)

### Relationships

- `Product.bizcard_id` -> `bizcard.bizcard_id`
- `Service.bizcard_id` -> `bizcard.bizcard_id`
- `Social.bizcard_id` -> `bizcard.bizcard_id`
- `Blog.bizcard_id` -> `bizcard.bizcard_id`
- `Address.bizcard_id` -> `bizcard.bizcard_id`

Existing `user_id` references are preserved during transition for backward compatibility.

### Migration Notes

- Existing users are backfilled into `bizcard` via `database/migrations/migrate_vcard_data.sql`.
- Mapping table `user_bizcard_mapping` is used to bridge old user-linked rows to `bizcard_id`.
- Cutover for replacing `User` with `User_new` is explicitly staged and should be done only after dependent FK and API migration is complete.

### Production Verification Checklist

- Run `database/migrations/verification_checklist.sql` after migration deployment.
- Capture outputs for: row counts, bridge completeness, FK orphan checks, and duplicate alias/serial checks.
- Only proceed to hard cutover when all readiness criteria in the checklist are satisfied.

---

## Bizcard Management API

The Bizcard Management API allows authenticated users to create and manage multiple bizcards while enforcing subscription-tier limits.

### Subscription Limits

| Tier | Max Bizcards | Features |
|------|--------------|----------|
| Free | 1 | Basic features |
| Basic | 5 | Multi-bizcard support |
| Premium | Unlimited | All features |
| Enterprise | Unlimited | Custom solutions |

### Endpoints

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| `GET` | `/api/user/bizcards` | Required | List owned bizcards with pagination, sorting, status filter, and subscription info. |
| `GET` | `/api/user/bizcards/search` | Required | Search owned bizcards with match scoring and highlights. |
| `GET` | `/api/user/bizcards/:bizcardId` | Required | Get one owned bizcard with details, relations, and stats. |
| `POST` | `/api/user/bizcards` | Required | Create bizcard with pre-check against subscription limits. |
| `PUT` | `/api/user/bizcards/:bizcardId` | Required | Partial update for one owned bizcard. |
| `DELETE` | `/api/user/bizcards/:bizcardId` | Required | Soft delete by default. Permanent delete requires premium tier. |
| `POST` | `/api/user/bizcards/:bizcardId/reactivate` | Required | Reactivate a deactivated bizcard and return post-reactivation limit warning if needed. |
| `GET` | `/api/user/bizcards/subscription/limits` | Required | Return current tier, limits, usage, and next-tier recommendation. |
| `GET` | `/api/user/bizcards/subscription/upgrade-needed` | Required | Return boolean upgrade recommendation and checkout options. |

### Query Parameters

#### `GET /api/user/bizcards`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `limit` | number | 10 | Items per page (max 50) |
| `sort_by` | string | `created_at` | `created_at`, `updated_at`, `bizcard_name` |
| `sort_dir` | string | `desc` | `asc`, `desc` |
| `status` | string | `active` | `active`, `deactivated`, `all` |

#### `GET /api/user/bizcards/search`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | Yes | Search query |
| `page` | number | No | Page number |
| `limit` | number | No | Items per page (max 50) |
| `search_in` | string | No | `name`, `first_name`, `last_name`, `all` |

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `BIZCARD_LIMIT_EXCEEDED` | 403 | Subscription limit reached for current tier. |
| `BIZCARD_NOT_FOUND` | 404 | Bizcard was not found or not owned by caller. |
| `BIZCARD_ACCESS_DENIED` | 403 | Action blocked by plan restrictions or ownership rules. |
| `URL_ALIAS_TAKEN` | 409 | Requested `url_alias` is already used by another bizcard. |

### Rate Limits

| Endpoint | Rate Limit |
|----------|------------|
| `GET /api/user/bizcards` | 60/minute |
| `GET /api/user/bizcards/search` | 30/minute |
| `GET /api/user/bizcards/:bizcardId` | 60/minute |
| `POST /api/user/bizcards` | 10/minute |
| `PUT /api/user/bizcards/:bizcardId` | 30/minute |
| `DELETE /api/user/bizcards/:bizcardId` | 10/minute |
| `POST /api/user/bizcards/:bizcardId/reactivate` | 15/minute |

### Notes

- Subscription checks are enforced before bizcard creation.
- All detail/update/delete/reactivate actions are ownership-scoped (`user_id` + `bizcard_id`).
- Search sanitizes query input and scopes results to owned records only.
- `deactivated_flag` is used for soft delete/archive behavior.

---

## Superadmin Blank Bizcard APIs

These endpoints provide secure generation, export, and claim/merge orchestration for blank physical bizcards.

### User BizCard Registry

These endpoints power the Super Admin registry for claimed user bizcards and are separate from blank-card generation.

#### `GET /api/superadmin/bizcards`
- Returns claimed, non-blank bizcards across the platform.
- Supports:
  - `page`
  - `limit`
  - `search` (serial ID, card name, first/last name, alias, email)
  - `status` (`all|active|restricted`)
- Each row includes:
  - `bizcard_id`
  - `user_id`
  - `user_email`
  - `serial_id`
  - display `name`
  - `subscription_tier`
  - `subscription_plan_name`
  - `subscription_status`
  - `qr_code_url`
  - `portfolio_url`
  - `restricted`
  - `owner_is_online` — derived owner session presence (activity within last 5 minutes)
  - `owner_last_active` — ISO timestamp of the owner's last platform activity
  - `owner_session_status` — `online` | `offline`

#### `PATCH /api/superadmin/bizcards/:bizcardId/restrict`
- Toggles `Bizcard.deactivated_flag` for a claimed bizcard.
- Request body:

```json
{
  "restricted": true,
  "reason": "Policy review"
}
```

- `restricted` is required.
- `reason` is optional and stored in audit metadata when provided.

### Authentication and Authorization

- Superadmin endpoints require a valid `session_token` cookie.
- Required role: `super_admin` (or `dev` for elevated internal operations).
- Privileged actions are written to `AdminAuditLog`.

### Rate Limits

- `POST /api/admin/bizcard/generate`: `admin-bizcard-generate` (20/minute per actor + IP)
- `GET /api/admin/bizcard/download`: `admin-bizcard-download` (20/minute per actor + IP)
- `POST /api/bizcard/claim`: `bizcard-claim` (10 requests / 10 seconds per IP)
- `POST /api/bizcard/merge`: `bizcard-merge-sensitive` (10 requests / 10 seconds per IP)

### 1) Generate Blank Cards

`POST /api/admin/bizcard/generate`

Request body:

```json
{
  "count": 50
}
```

Rules:

- `count` must be between `1` and `1000`.
- Serial IDs are cryptographically generated (`XXXX-XXXX-XXXX`) with DB uniqueness checks.
- Records are created as `Bizcard.is_blank = true` with generated QR + portfolio resolver URL.

Success response:

```json
{
  "success": true,
  "data": {
    "count": 50,
    "cards": [
      {
        "id": "12345",
        "serialId": "ABCD-EFGH-JKLM",
        "qrCodeUrl": "data:image/svg+xml;base64,...",
        "portfolioUrl": "https://your-app.com/api/portfolio/resolve/ABCD-EFGH-JKLM",
        "createdAt": "2026-03-27T12:34:56.000Z"
      }
    ]
  }
}
```

### 2) Export Blank Cards to Excel

`GET /api/admin/bizcard/download`

Query parameters:

- `status`: `all | claimed | unclaimed`
- `from`: ISO date/time
- `to`: ISO date/time

Response:

- MIME: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- Sheets:
  - `Blank Bizcards`
  - `Summary`

### 3) Claim Flow Decision Endpoint

`POST /api/bizcard/claim`

Request body:

```json
{
  "serialId": "ABCD-EFGH-JKLM"
}
```

Possible outcomes:

- `requiresMerge: true` when authenticated user has virtual cards with `bizcard_type=virtual` and `serial_id IS NULL`.
- `requiresProfileCreate: true` when authenticated user has no eligible virtual cards — redirects to `/user/bizcard/create-new?serial={serialId}`.
- `requiresRegistration: true` when caller is unauthenticated — redirects to `/user/signup?ref={serialId}`.

This endpoint is a **decision / pre-check only**. It does **not** attach `serial_id` to a user BizCard or mark the blank card as claimed. Actual linking is performed by `POST /api/bizcard/merge`.

After Super Admin QR signup (`/user/signup?ref={SERIAL}`) completes BizCard setup, the signup finish flow calls `POST /api/bizcard/merge` with `{ serialId, virtualCardId }` (same as `/user/bizcard/create-new?serial=`). Only then is the blank row consumed, `serial_id` appears on the user's BizCard Overview, and subsequent scans resolve to `/{url_alias}`. Do **not** treat `POST /api/bizcard/claim` HTTP 200 as a successful link — claim is decision-only.

`POST /api/bizcard/claim` also returns `subscriptionTier` (`basic` | `standard` | `premium` | `null`) from the blank inventory row so signup `ChooseTheme` can unlock the correct themes before merge.

NFC/QR encoding for blank physical cards should use the portfolio entry URL:

`https://{NEXT_PUBLIC_APP_URL}/{SERIAL_ID}`

`GET /{SERIAL_ID}` (App Router `[alias]` page) server-resolves physical serials via `resolvePhysicalCardScan`:

- Blank / unclaimed → redirect to `/user/signup?ref={SERIAL_ID}` (standard multi-step registration)
- Linked / merged → redirect to `/{url_alias}` (or portfolio URL)
- `not_found` → fall through to normal alias portfolio rendering

### 4) Merge Physical Blank Card with Existing Virtual Card

`POST /api/bizcard/merge`

Request body:

```json
{
  "serialId": "ABCD-EFGH-JKLM",
  "virtualCardId": "12345"
}
```

Behavior:

- Requires authenticated session.
- Validates ownership of `virtualCardId`.
- Executes merge atomically:
  - Writes `BizcardMergeHistory`
  - Deletes consumed blank card row
  - Updates selected virtual card with serial/QR/portfolio data
  - Copies blank `subscription_tier` onto the virtual card and activates it (`subscription_status: active`, `subscription_started_at`, yearly `subscription_expires_at`)
  - Upserts `BizcardSubscription` when a matching `SubscriptionPlan.tier_code` exists

Success response includes `data.bizcard.urlAlias` and `data.bizcard.portfolioUrl` for client redirect.

After merge, the scan UI redirects to `/scan/{serialId}/merge/success?alias={urlAlias}` which auto-redirects to the merged portfolio after 3 seconds (user can navigate away sooner).

### Client scan session compatibility (iOS Safari)

Physical card scan flows call `GET /api/auth/session-health` with `credentials: include` before `GET /api/bizcard/scan/[serialId]` so expired `session_token` cookies can be rotated via `refresh_token`. Without this, logged-in iOS users could be misrouted to signup when scanning blank cards.

### Public Resolver Behavior for Blank Cards

`GET /api/portfolio/resolve/:uri`

- Serial-first resolution is preserved.
- If serial resolves to an unclaimed blank bizcard, response redirects to registration:
  - Browser redirect: `/user/signup?ref={serialId}`
  - JSON mode (`?format=json`): `requiresRegistration: true` with `redirectUrl` pointing at `/user/signup?ref={serialId}`

---

## Bizcard Media Management API

Bizcard Media Management provides a bizcard-scoped gallery system with full audit logging (`MediaAuditLog`), soft-delete semantics, and strict ownership controls.

### Endpoints

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| `GET` | `/api/bizcard/:bizcardId/media` | Required | List owned, non-deleted media entries for a bizcard. |
| `POST` | `/api/bizcard/:bizcardId/media` | Required | Register a Cloudinary media asset to a bizcard gallery. |
| `PATCH` | `/api/bizcard/:bizcardId/media/:mediaId` | Required | Update media metadata and flags (`altText`, `caption`, `tags`, visibility, featured, order). |
| `DELETE` | `/api/bizcard/:bizcardId/media/:mediaId` | Required | Soft-delete media and attempt Cloudinary asset deletion. |
| `POST` | `/api/bizcard/:bizcardId/media/reorder` | Required | Reorder all current media items in one atomic request. |
| `GET` | `/api/public/:alias/gallery` | Public | Fetch public gallery and videos for a profile. |

### `POST /api/bizcard/:bizcardId/media`

#### Request Body

```json
{
  "secureUrl": "https://res.cloudinary.com/<cloud>/image/upload/v123/ontap/portfolio/sample.jpg",
  "cloudinaryPublicId": "ontap/portfolio/sample",
  "mediaType": "image",
  "resourceType": "image",
  "mimeType": "image/jpeg",
  "fileName": "sample.jpg",
  "width": 1200,
  "height": 900,
  "sizeBytes": 345678,
  "altText": "Office team photo",
  "caption": "Our team at the regional event",
  "tags": ["team", "event"],
  "isFeatured": false,
  "isVisible": true
}
```

#### Notes

- `secureUrl` must belong to the configured Cloudinary account.
- `mediaType` supports `image` and `video`.
- A `MEDIA_CREATED` row is written to `MediaAuditLog`.

### `PATCH /api/bizcard/:bizcardId/media/:mediaId`

#### Request Body (partial)

```json
{
  "caption": "Updated caption",
  "altText": "Updated alt text",
  "tags": ["updated", "portfolio"],
  "sortOrder": 2,
  "isFeatured": true,
  "isVisible": true
}
```

### `POST /api/bizcard/:bizcardId/media/reorder`

#### Request Body

```json
{
  "orderedMediaIds": [102, 99, 105, 98]
}
```

The reorder payload must contain every existing, non-deleted media ID exactly once.

### Public Gallery Response

`GET /api/public/:alias/gallery`

**Subscription requirement:** Gallery media is served only for `standard` and `premium` tiers. All other tiers receive `403` with message `Gallery is not available for this portfolio tier.`

```json
{
  "success": true,
  "data": {
    "username": "jane-smith",
    "bizcard_id": "123",
    "gallery": [
      {
        "id": "501",
        "url": "https://res.cloudinary.com/...",
        "alt_text": "Team at expo",
        "caption": "Regional expo",
        "sort_order": 0,
        "featured": true
      }
    ],
    "videos": [],
    "total_gallery_items": 1,
    "total_videos": 0
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
| ---- | ----------- | ----------- |
| `MEDIA_1600` | 404 | Media entry not found. |
| `MEDIA_1601` | 404/403 | Bizcard not found or ownership denied. |
| `MEDIA_1602` | 400/422 | Invalid payload values (URL, dimensions, IDs, etc.). |
| `MEDIA_1603` | 422 | Unsupported media type. |
| `MEDIA_1604` | 422 | Reorder payload is incomplete or inconsistent. |

### Audit Trail

Each mutating endpoint writes to `MediaAuditLog` with:

- action (`MEDIA_CREATED`, `MEDIA_UPDATED`, `MEDIA_DELETED`, `MEDIA_REORDERED`)
- actor (`user_id`)
- scope (`bizcard_id`, `media_id`)
- request metadata (`ip_address`, `user_agent`)
- before/after snapshots (`before_data`, `after_data`)

---

## 57B. SuperAdmin Company Management API

All superadmin company endpoints are under:

```
/api/superadmin/companies/*
```

### Role Requirements

- Requires authenticated `super_admin` session.
- Impersonation-aware mutation routes record `effective_user_id` and `impersonation_token_id` in audit metadata when an impersonation cookie/header is present.

### Rate Limits

| Endpoint key | Limit | Window |
|---|---|---|
| `superadmin-companies-list` | 60 | 1 minute |
| `superadmin-companies-detail` | 120 | 1 minute |
| `superadmin-companies-restrict` | 10 | 1 minute |
| `superadmin-companies-impersonation-start` | 10 | 1 hour |
| `superadmin-companies-impersonation-end` | 60 | 1 minute |
| `superadmin-companies-impersonation-status` | 120 | 1 minute |

### Endpoints

#### `GET /api/superadmin/companies`
- Paginated company list for the superadmin company list UI.
- Query params:
  - `page`, `limit`
  - `search` (name, email, slug, description)
  - `status` (`all|pending|active|rejected|restricted`)
  - `subscription_tier` (`all|basic|premium|enterprise`)
  - `sort_by` (`created_at|company_name|current_employees|status`)
  - `sort_dir` (`asc|desc`)
- Response includes `logo_url` per company and `summary.status_breakdown` with `restricted` count.

#### `GET /api/superadmin/companies/:companyId`
- Returns full company profile, metrics, and recent audit logs for impersonation review modals.

#### `POST /api/superadmin/companies/:companyId/restrict`
- Permanently restricts a company and suspends all associated accounts.
- Effects (single transaction):
  - Sets `Company.status = "restricted"`
  - Sets `User.is_restricted = true` with `restricted_until = null` for admin, employees, and users linked via `company_id`
  - Deactivates all `CompanyEmployee` rows (`is_active = false`)
  - Revokes all active `Session` rows for affected users (`sessions_revoked` in response)
  - Writes `company.restricted` company audit log
- Success response `data` includes:
  - `company_id`, `status`, `users_suspended`, `employees_deactivated`, `sessions_revoked`
- Restricted users are blocked on subsequent session validation (`validateToken` / refresh) until manually unrestricted.
- Error codes:
  - `SUPERADMIN_11700` (`COMPANY_ALREADY_RESTRICTED`) — 409 when already restricted
  - `SUPERADMIN_11701` (`COMPANY_RESTRICT_FAILED`) — reserved for restrict failures

#### `POST /api/superadmin/companies/impersonation/start`
- Starts superadmin impersonation of a target user (primary company admin from company detail modal or directly from the Client List Edit icon).
- **CSRF:** Required — include `X-CSRF-Token` header matching the `csrf-token` cookie (enforced by edge proxy on all state-changing `/api/*` requests).
- **Authentication:** Required — `session_token` cookie (or refreshable via `refresh_token`). **Role:** `super_admin`.
- Request body:

```json
{
  "target_user_id": 123,
  "reason": "Superadmin company impersonation from company detail",
  "ttl_minutes": 120
}
```

- Sets `superadmin_impersonation_token` httpOnly cookie.
- **Frontend handoff:** After a successful start, the Super Admin UI stores the returned `impersonation_token` in `sessionStorage`, then navigates to `/superadmin/impersonate/enter`. That page polls until `impersonation.active` is true, then redirects to `/superadmin/company/{companyId}` (Super Admin namespace). **End impersonation** is handled via the persistent dark-navy impersonation indicator bar shown across all impersonated pages; clicking "Exit" calls `POST /impersonation/end` with `X-CSRF-Token` and optional `{ "token": "..." }` body, then clears handoff storage. Company-mode exit returns to `/superadmin/dashboard`; user-mode exit returns to `/superadmin/client-list`.
- **Client List Edit icon (user-mode impersonation — `app/superadmin/client-list/page.tsx`):** Clicking the Edit (Pencil) icon in the Client List table immediately calls `/api/superadmin/clients/:clientId/impersonate` (not this endpoint) with the selected client's ID. A per-row spinner is shown on the button while the request is in flight. On success the token is persisted via `persistImpersonationHandoff` and the Super Admin is redirected to `/superadmin/impersonate/enter?userMode=true`. The target does **not** need to be a company primary admin — any active non-superadmin user can be impersonated via that endpoint. The enter page then redirects to `/superadmin/user/:userId`. On failure a notice banner is shown.
- **User-mode portal workspace (`app/superadmin/user/[userId]/page.tsx`):** After landing at `/superadmin/user/:userId`, the page immediately redirects to `/user/dashboard` via `window.location.replace`. The Super Admin then has full, unrestricted access to the entire user portal — Dashboard, My BizCards, Edit BizCard (vCard Details, Card Design, Services, Social Links, More Preferences), Inquiry, Analytics, Affiliate, E-Market, and Settings — navigated using the standard user sidebar. The `/user/*` routes are fully accessible because the `user/layout.tsx` auth guard explicitly allows `super_admin` impersonation sessions. All edits made on those pages (profile data, theme selection, services, social links, preferences) are saved directly to the impersonated user's account. The impersonation indicator bar (`"Impersonation Mode"` badge + `"You are impersonating: [Name]"` + `"Exit"` button) remains visible on every page within the `/user/*` routes for the duration of the session.
- **Company List Edit (Pencil) icon (new behaviour — `app/superadmin/company-list/page.tsx`):** Clicking the Edit (Pencil) icon button in the Company List table now immediately calls **this endpoint** (`POST /api/superadmin/companies/impersonation/start`) using the company row's `admin.user_id` as `target_user_id`, bypassing the `CompanyImpersonateModal` entirely. The button is disabled for non-active companies or companies with no assigned admin. A per-row spinner replaces the Pencil icon while the request is in flight. On success the token and `companyId` are persisted via `persistImpersonationHandoff` and the Super Admin is navigated to `/superadmin/impersonate/enter?companyId={id}`. On failure a top-level error banner is shown. The target must be the primary admin of an **active** company.
  - Function added: `directImpersonateCompany(company: ApiCompany)` in `app/superadmin/company-list/page.tsx`
  - State added: `directImpersonatingCompanyId: string | null` — tracks which company row is currently being impersonated to drive the per-row spinner and `disabled` state.
- **Company List row/name click (existing, unchanged):** Clicking a company name in the Company List still opens the `CompanyImpersonateModal` detail view first, then calls this endpoint on the "Start Impersonation" confirmation button. That flow remains unmodified.
- Guards:
  - Target must be primary admin of an **active** company
  - Rejects restricted, pending, or non-active companies
  - Rejects superadmin targets and self-impersonation

#### `POST /api/superadmin/companies/impersonation/end`
- Ends the active impersonation token for the authenticated superadmin.
- **CSRF:** Required — include `X-CSRF-Token` header matching the `csrf-token` cookie.
- Optional body: `{ "token": "<impersonation_token>", "reason": "..." }` when ending via header/body transport.

#### `GET /api/superadmin/companies/impersonation/status`
- Returns active impersonation context (`original_user`, `effective_user`, token metadata).

### Session Impersonation Bridge

`GET /api/auth/session` returns impersonation metadata when a valid superadmin impersonation token is present:

```json
{
  "authenticated": true,
  "user": {
    "userId": 456,
    "role": "company_admin",
    "appRole": "super_admin"
  },
  "impersonation": {
    "active": true,
    "target_user_id": 456,
    "expires_at": "2026-06-22T12:00:00.000Z"
  }
}
```

While impersonation is active, `/api/company/*` routes resolve the **effective** impersonated user id so the company admin portal operates with full admin authority. Similarly, `/user/*` portal routes (dashboard, bizcard editor, settings, inquiry, affiliate, e-market) resolve the impersonated user's data because the `user/layout.tsx` auth guard permits `super_admin` impersonation sessions on those routes. The `GET /api/auth/session` endpoint returns `user.*` fields for the **effective** (impersonated) user (first name, last name, email, role, custom URI) so the user portal renders exactly as it would for the real user.

**Impersonated write paths:** `PUT /api/vcard/profile`, `POST /api/vcard/setup`, and `PUT /api/bizcard/update` also resolve the effective user id so Save Changes / theme persistence update the impersonated account (not the superadmin). Unchanged `customUri` values are stripped before format validation so legacy aliases do not block unrelated field saves. When changing `customUri` under impersonation, the 90-day alias lock is bypassed; format and uniqueness checks still apply.

### Impersonation Indicator

When impersonation is active a persistent dark-navy bar is shown below the top header on **every page** within the impersonation flow (both `/superadmin/*` and `/user/*` routes). The bar has three parts:

- **Left:** amber `"Impersonation Mode ⓘ"` pill badge — clearly labels the current state.
- **Center:** `"You are impersonating: {Full Name}"` — shows the impersonated user's full name resolved from `GET /api/auth/session` (`user.firstName + user.lastName`). Falls back to email when name fields are empty.
- **Right:** `"Exit"` button — calls `POST /api/superadmin/companies/impersonation/end` with `X-CSRF-Token` and optionally `{ "token": "<handoff_token>" }`, clears all sessionStorage handoff keys (`superadmin_impersonation_handoff_token`, `superadmin_impersonation_company_id`, `superadmin_impersonation_user_id`) and the `superadmin_impersonation_handoff` cookie, then redirects to `/superadmin/client-list` (user-mode) or `/superadmin/dashboard` (company-mode).

The bar is rendered by:
- `app/superadmin/layout.tsx` — visible during company-mode impersonation on `/superadmin/company/:companyId` routes. Uses `userName` state (the target user's display name from the session).
- `app/user/layout.tsx` — visible during user-mode impersonation on all `/user/*` routes. Uses `impersonatedName` state (the target user's display name from the session, derived from `data.user.firstName + data.user.lastName`).

Both renderings use `role="alert" aria-live="polite"` for accessibility. The `"Exit"` button in the superadmin layout also carries `disabled` and `"Exiting…"` loading state while the API call is in flight.

---

## 58. Client Management API (SuperAdmin)

All client management endpoints are under:

```
/api/superadmin/clients/*
```

### Role Requirements

All endpoints in this section require the `super_admin` role.

- Allowed: `super_admin`
- Denied: `admin`, `user`, `company_admin`, `dev` (for this route group)

### Error Codes Reference

Error responses keep existing `CLIENT_*` values in `error.code` and now also include `error.alias_code` with `CLIENT_MGMT_*` for compatibility.

| Code | Alias Code | HTTP Status | Description |
|------|------------|-------------|-------------|
| `CLIENT_8000` | `CLIENT_MGMT_13000` | 401 | Unauthorized access |
| `CLIENT_8001` | `CLIENT_MGMT_13001` | 403 | SuperAdmin role required |
| `CLIENT_8100` | `CLIENT_MGMT_13100` | 404 | Client not found |
| `CLIENT_8101` | `CLIENT_MGMT_13101` | 409 | Client already restricted |
| `CLIENT_8102` | `CLIENT_MGMT_13102` | 409 | Client not restricted |
| `CLIENT_8103` | `CLIENT_MGMT_13103` | 400 | Invalid restriction duration |
| `CLIENT_8200` | `CLIENT_MGMT_13200` | 500 | Export generation failed |
| `CLIENT_8201` | `CLIENT_MGMT_13201` | 413 | Export too large |
| `CLIENT_8300` | `CLIENT_MGMT_13300` | 400 | Invalid pagination/filter payload |
| `CLIENT_8301` | `CLIENT_MGMT_13301` | 400 | Batch limit exceeded (max 100) |
| `CLIENT_8400` | `CLIENT_MGMT_13400` | 429 | Rate limit exceeded |

### Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| `GET /api/superadmin/clients/summary` | 30 | 1 minute |
| `GET /api/superadmin/clients` | 60 | 1 minute |
| `GET /api/superadmin/clients/online` | 30 | 1 minute |
| `GET /api/superadmin/clients/:clientId` | 120 | 1 minute |
| `PUT /api/superadmin/clients/:clientId` | 30 | 1 minute |
| `POST /api/superadmin/clients/:clientId/restrict` | 10 | 1 minute |
| `POST /api/superadmin/clients/:clientId/unrestrict` | 10 | 1 minute |
| `GET /api/superadmin/clients/:clientId/portfolio` | 30 | 1 minute |
| `GET /api/superadmin/clients/export` | 5 | 1 hour |

### Endpoints

#### `GET /api/superadmin/clients/summary`
- Returns dashboard summary counts for all role=`user` clients.
- Includes `total_clients` (all-time), `total_online` (users with session activity within the last 5 minutes), newly added clients (last 30 days), and subscription distribution.
- `total_active` remains the count of non-restricted accounts; use `total_online` for live session presence.

#### `GET /api/superadmin/clients`
- Returns paginated clients list.
- Each client item includes `bizcard_count` (non-deactivated bizcards owned by the user), `joined_at` (account creation date, `User.created_at`), `is_online` (derived session presence), and `last_active`.
- **Record limit:** raised from `100` → `10000` so the Super Admin Users feature can retrieve the entire client dataset in a single request. The `client-list` page now sends `?page=1&limit=10000`, allowing the client-side search and pagination to operate over the full dataset.
- Query params:
  - `page` (default `1`)
  - `limit` (default `20`, max `10000`) — **updated from 100 to 10000**
  - `search` (name/email — applied server-side before returning results)
  - `status` (`all|active|restricted`)
  - `subscription_type` (`all|free|basic|premium|enterprise`)
  - `sort_by` (`created_at|last_active|name|email`)
  - `sort_dir` (`asc|desc`)

#### `GET /api/superadmin/clients/online`
- Returns paginated online clients.
- Online cutoff: activity within the last 5 minutes.
- Query params: `page`, `limit` (max `50`), `sort_dir`.

#### `GET /api/superadmin/clients/:clientId`
- Returns detailed client profile including company summary and recent bizcards.
- **Used by:** Super Admin Client Management — View Profile modal. Opens when the Eye (👁) icon is clicked in the Users/Client list, fetching fresh detail data for the selected client.

#### `PUT /api/superadmin/clients/:clientId`
- Updates supported fields: `first_name`, `last_name`, `email`, `alt_email`, `phone` (or `contact` alias), `subscription_tier`.
- **Used by:** Super Admin Client Management — Edit Profile modal. Opens when the Pencil (✏) icon is clicked. Pre-fills form with current client data fetched via `GET /api/superadmin/clients/:clientId`, then submits changes.
- Validation notes:
  - `alt_email` must be a valid email format and at most 191 characters (`""` clears value).
  - `phone`/`contact` must be at most 20 characters and may only contain digits, spaces, and `+ - ( ) .` (`""` clears value).
- Writes audit trail to `ClientAuditLog`.
- On success: local client list row is updated in place, and a success toast is shown. Modal closes automatically.

#### `POST /api/superadmin/clients/:clientId/restrict`
- Restricts a client account for `duration_days` with `reason`.
- **Used by:** Super Admin Client Management (`app/superadmin/client-list/page.tsx`) — Suspend (Ban) icon in the Actions column. Opens a confirmation dialog ("Do you want to suspend this account?"). On Confirm, calls this endpoint. On success, the row status badge updates to `Suspended` in real time (no page refresh) and a success notice is shown.
- Default payload from Client Management UI:

```json
{
  "duration_days": 365,
  "reason": "Suspended by super admin from Client Management"
}
```

- Request body (general):

```json
{
  "duration_days": 30,
  "reason": "Violation of terms of service"
}
```

- Validation: `duration_days` must be an integer between 1 and 365; `reason` is required (max 500 characters).
- Note: Indefinite suspend is not supported by this endpoint; 365 days is the maximum duration.

#### `POST /api/superadmin/clients/:clientId/unrestrict`
- Removes active restriction and clears restriction metadata.
- **Used by:** Super Admin Client Management — when a user row already shows `Suspended`, the Actions column shows a Check (reactivate) icon. Confirmation dialog asks to reactivate; on Confirm, calls this endpoint and updates the row status to `Offline` in real time.

#### Client Management Delete flow (Suspend/Delete Actions)

- **UI:** Super Admin Client Management table Delete (Trash) icon opens a confirmation dialog: "Are you sure you want to move this user to the Recycle Bin?" Cancel aborts; Confirm proceeds.
- **Lookup:** `GET /api/superadmin/clients/:clientId` is used to resolve the user's claimed `bizcards[0].bizcard_id` (list API does not return bizcard IDs).
- **Delete:** `DELETE /api/superadmin/bizcards/:bizcardId` soft-deletes the user into the Recycle Bin via `softDeleteUserAndBizcard()` (sets `deleted_at`, deactivates account, revokes sessions; related data preserved).
- On success: the client row is removed from the local table state immediately and a success notice is shown ("User moved to Recycle Bin successfully.").
- If the user has no claimed BizCard, the UI shows an error notice and does not call delete.
- **Restore / permanent purge:** Super Admin Recycle Bin (`/superadmin/recycle-bin`) uses `POST /api/superadmin/recycle-bin/:bizcardId/restore` and `DELETE /api/superadmin/recycle-bin/:bizcardId`.

#### `GET /api/superadmin/clients/:clientId/portfolio`
- Returns the public portfolio URL and display metadata for quick superadmin review.

#### `GET /api/superadmin/clients/export`
- Exports filtered clients list.
- Query params:
  - `format` (`csv` default, or `xlsx`)
  - `search`
  - `filter` (alias search input for compatibility)
  - `client_name` (alias search input for compatibility)
  - `status`
  - `subscription_type`
  - `date_filter` (`all|today|this_week|this_month|last_month|custom`, default `all`)
  - `start_date` (required when `date_filter=custom`)
  - `end_date` (required when `date_filter=custom`)

### Public Portfolio Restriction Enforcement

The public profile endpoint now checks client restriction status before serving profile payload.

- Endpoint: `GET /api/public/:alias`
- Behavior:
  - returns `403` with `ACCOUNT_RESTRICTED` when the owner account is actively restricted
  - returns `404` when profile is not found or owner account is inactive

---

## 59. Affiliate Management API (SuperAdmin)

All affiliate management endpoints are under:

```
/api/superadmin/affiliates/*
```

### Role Requirements

All endpoints in this section require the `super_admin` role.

- Allowed: `super_admin`
- Denied: `admin`, `user`, `company_admin`, `dev` (for this route group)

### Error Codes Reference

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `AFFILIATE_MGMT_14000` | 401 | Unauthorized access |
| `AFFILIATE_MGMT_14001` | 403 | SuperAdmin role required |
| `AFFILIATE_MGMT_14100` | 404 | Affiliate not found |
| `AFFILIATE_MGMT_14101` | 409 | Affiliate already restricted |
| `AFFILIATE_MGMT_14102` | 409 | Affiliate is not restricted |
| `AFFILIATE_MGMT_14103` | 400 | Invalid commission rate payload |
| `AFFILIATE_MGMT_14104` | 400 | Invalid affiliate payload |
| `AFFILIATE_MGMT_14300` | 500 | Export generation failed |
| `AFFILIATE_MGMT_14301` | 413 | Export row count too large |
| `AFFILIATE_MGMT_14400` | 400 | Invalid filter/date/path payload |
| `AFFILIATE_MGMT_14500` | 429 | Rate limit exceeded |

### Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| `GET /api/superadmin/affiliates/analytics` | 30 | 1 minute |
| `GET /api/superadmin/affiliates/summary` | 30 | 1 minute |
| `GET /api/superadmin/affiliates` | 60 | 1 minute |
| `GET /api/superadmin/affiliates/top-performers` | 30 | 1 minute |
| `GET /api/superadmin/affiliates/recent-referrals` | 30 | 1 minute |
| `GET /api/superadmin/affiliates/commissions` | 60 | 1 minute |
| `GET /api/superadmin/affiliates/:affiliateId` | 120 | 1 minute |
| `PUT /api/superadmin/affiliates/:affiliateId` | 30 | 1 minute |
| `PUT /api/superadmin/affiliates/:affiliateId/commission-rate` | 30 | 1 minute |
| `DELETE /api/superadmin/affiliates/commissions/:commissionId` | 30 | 1 minute |
| `POST /api/superadmin/affiliates/:affiliateId/restrict` | 10 | 1 minute |
| `POST /api/superadmin/affiliates/:affiliateId/unrestrict` | 10 | 1 minute |
| `GET /api/superadmin/affiliates/:affiliateId/performance` | 60 | 1 minute |
| `GET /api/superadmin/affiliates/export` | 5 | 1 hour |

### Endpoints

#### `GET /api/superadmin/affiliates/analytics`
- Returns core affiliate analytics:
  - `total_referral_count`
  - `conversion_rate`
  - `total_paidouts`
  - `total_paid_affiliates`
  - `pending_payouts`
  - `average_commission_rate`

#### `GET /api/superadmin/affiliates/summary`
- Legacy compatibility endpoint for existing dashboard consumers.
- Returns global affiliate dashboard summary:
  - `total_referral_count`
  - `conversion_rate`
  - `total_paidout`
  - `total_paid`
  - `pending_payout`

#### `GET /api/superadmin/affiliates`
- Returns paginated affiliate list in leaderboard order by successful referrals.
- Main list route is `/api/superadmin/affiliates` (not `/api/superadmin/affiliate`).
- Query params:
  - `page` (default `1`)
  - `limit` (default `20`, max `100`)
  - `search` (name/email/affiliate code)
  - `status` (`all|active|restricted`)
  - `sort_by` (`total_earnings|total_referrals|conversion_rate|joined_at`)
  - `sort_dir` (`asc|desc`)
  - `period` (`today|yesterday|this_week|this_month|last_month|custom`)
  - `start_date` (required when `period=custom`)
  - `end_date` (required when `period=custom`)

#### `GET /api/superadmin/affiliates/top-performers`
- Returns ranked affiliates based on earnings/referral performance.
- Query params:
  - `limit` (default `10`, max `50`)

#### `GET /api/superadmin/affiliates/recent-referrals`
- Returns latest referral events across affiliates.
- Query params:
  - `limit` (default `20`, max `100`)

#### `GET /api/superadmin/affiliates/commissions`
- Returns paginated commission-oriented rows for the Super Admin affiliate table.
- Query params:
  - `page` (default `1`)
  - `limit` (default `20`, max `100`)
  - `search` (affiliate code, order number, email, status)
  - `status` (`all|pending|approved|paid|voided`)
- Response rows include:
  - `commission_id`
  - `product_id`
  - `affiliate_code`
  - `affiliate_user_id`
  - `commission_rate`
  - `commission_amount`
  - `order_total`
  - `order_number`
  - `status`
  - `created_at`
- When no `ShopCommission` rows exist yet, the endpoint falls back to registered affiliate users with zero commission totals so the table remains populated.

#### `GET /api/superadmin/affiliates/:affiliateId`
- Returns affiliate profile details including referral/commission breakdown and monthly earnings.

#### `PUT /api/superadmin/affiliates/:affiliateId`
- Updates affiliate profile and commission configuration.
- Request body:

```json
{
  "first_name": "Jonathan",
  "last_name": "Doe",
  "email": "jonathan@example.com",
  "commission_rate": 20
}
```

- `commission_rate` must be between `0` and `100`.
- `email` must be unique.

#### `PUT /api/superadmin/affiliates/:affiliateId/commission-rate`
- Compatibility endpoint for commission-only updates.
- Updates affiliate commission rate and writes an audit log entry.
- Request body:

```json
{
  "commission_rate": 12.5
}
```

Constraints:
- `commission_rate` must be numeric and between `0` and `100`.

#### `POST /api/superadmin/affiliates/:affiliateId/restrict`
- Restricts affiliate access for a bounded number of days and records reason.
- Request body:

```json
{
  "duration_days": 30,
  "reason": "Fraud investigation"
}
```

Constraints:
- `duration_days` must be an integer between `1` and `365`.
- `reason` is required and max length `500`.

#### `POST /api/superadmin/affiliates/:affiliateId/unrestrict`
- Removes active affiliate restriction and clears restriction metadata.

#### `GET /api/superadmin/affiliates/:affiliateId/performance`
- Returns period-scoped affiliate performance metrics (`referrals`, `conversions`, `conversion_rate`, `commission_earned`, `payout_received`).
- Query params:
  - `period` (`today|this_week|this_month|last_month|custom`, default `this_month`)
  - `start_date` (required when `period=custom`)
  - `end_date` (required when `period=custom`)

#### `GET /api/superadmin/affiliates/export`
- Exports affiliates as CSV download (`text/csv`).
- Query params:
  - `format` (`csv` only)
  - `filter` (`all|specific`)
  - `affiliate_name` (required when `filter=specific`)
  - `search` (legacy compatibility)
  - `status` (`all|active|restricted`)
  - `date_filter` (`today|yesterday|this_week|this_month|last_month|custom`)
  - `period` (legacy compatibility)
  - `start_date` (required when `period=custom`)
  - `end_date` (required when `period=custom`)

#### `DELETE /api/superadmin/affiliates/commissions/:commissionId`
- Soft-removes a commission row by setting its status to `voided`.
- The record is preserved for auditability; this is not a hard delete.

### Response Envelope

All JSON responses in this section follow:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "requestId": "uuid",
    "responseTime": 12,
    "timestamp": "2026-04-07T00:00:00.000Z"
  }
}
```

Error responses use affiliate-management codes from `AFFILIATE_MGMT_14000` to `AFFILIATE_MGMT_14599`.

---

## Superadmin Subscription Transactions API

#### `GET /api/superadmin/subscription-transactions`
- Returns a newest-first merged timeline built from `SubscriptionUpgradeLog` and `SubscriptionRenewalHistory`.
- Query params:
  - `page`
  - `limit`
  - `type` (`all|renewal|upgrade|downgrade|cancellation`)
  - `search`
  - `from`
  - `to`
- Response rows include:
  - `transaction_id`
  - `type`
  - `user_id`
  - `user_email`
  - `bizcard_id`
  - `bizcard_serial`
  - `from_plan`
  - `to_plan`
  - `amount`
  - `status`
  - `effective_date`
  - `created_at`
  - `order_number`

---

## 60. Order Management API (SuperAdmin)

All order management endpoints are under:

```
/api/superadmin/orders/*
```

### Role Requirements

All endpoints in this section require the `super_admin` role.

- Allowed: `super_admin`
- Denied: `admin`, `user`, `company_admin`, `dev` (for this route group)

### V2 Status Lifecycle

Canonical V2 statuses:

- `pending`
- `processed`
- `completed`
- `cancelled`

Legacy inputs are still accepted and normalized for compatibility:

- `pending_payment` -> `pending`
- `processing`/`shipped`/`delivered` -> `processed`
- `payment_failed` -> `cancelled`
- `refunded` -> `completed`
- `canceled` -> `cancelled`

### V2 Primary Contract (7 Endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/superadmin/orders/recent` | Recent orders window (default `days=14`) with pagination/filtering. |
| `GET` | `/api/superadmin/orders/:orderId` | Full order detail (numeric id or `order_number`). |
| `PUT` | `/api/superadmin/orders/:orderId/status` | Status mutation with optional tracking metadata + audit/cache sync. |
| `POST` | `/api/superadmin/orders/:orderId/cancel` | Explicit cancellation flow. |
| `GET` | `/api/superadmin/orders/analytics` | Aggregates by canonical V2 statuses + payment/customer/trend data. |
| `GET` | `/api/superadmin/orders/export` | Filtered export (`csv` or `xlsx`). |
| `GET` | `/api/superadmin/orders/report/pdf` | PDF report (summary KPIs + filtered table). |

### Legacy Compatibility Endpoints (Still Available)

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/superadmin/orders/summary` | Preserved for existing consumers. |
| `GET` | `/api/superadmin/orders` | Preserved list endpoint; now returns canonical status values. |
| `GET` | `/api/superadmin/orders/:orderId/timeline` | Preserved audit timeline endpoint. |
| `GET` | `/api/superadmin/orders/stream` | Preserved SSE endpoint with canonical status output. |
| `POST` | `/api/superadmin/orders/bulk/status` | Preserved bulk mutation endpoint. |

### Error Codes Reference

V2/newly-updated order-management surfaces return `ORDER_MGMT_15000` to `ORDER_MGMT_15599`.

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `ORDER_MGMT_15000` | 401 | Unauthorized access |
| `ORDER_MGMT_15001` | 403 | SuperAdmin role required |
| `ORDER_MGMT_15100` | 404 | Order not found |
| `ORDER_MGMT_15101` | 409 | Invalid status transition |
| `ORDER_MGMT_15102` | 409 | Order already in requested status |
| `ORDER_MGMT_15103` | 409 | Order finalized for transition |
| `ORDER_MGMT_15200` | 400 | Invalid order path identifier |
| `ORDER_MGMT_15201` | 400 | Invalid status payload |
| `ORDER_MGMT_15202` | 400 | Invalid date range |
| `ORDER_MGMT_15203` | 400 | Invalid pagination payload |
| `ORDER_MGMT_15204` | 400 | Invalid filter payload |
| `ORDER_MGMT_15205` | 400 | Invalid request body |
| `ORDER_MGMT_15300` | 500 | Export generation failed |
| `ORDER_MGMT_15301` | 413 | Export exceeds max rows |
| `ORDER_MGMT_15302` | 500 | Stream subscription failed |
| `ORDER_MGMT_15303` | 500 | PDF report generation failed |
| `ORDER_MGMT_15304` | 413 | PDF report exceeds max rows |
| `ORDER_MGMT_15400` | 500 | Audit log write failed |
| `ORDER_MGMT_15401` | 500 | Status cache write failed |
| `ORDER_MGMT_15500` | 429 | Rate limit exceeded |
| `ORDER_MGMT_15501` | 500 | Internal order-management error |

Backward compatibility note:

- Legacy order surfaces continue to use `ORDER_10000` to `ORDER_10599` where applicable.

### Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| `GET /api/superadmin/orders/summary` | 30 | 1 minute |
| `GET /api/superadmin/orders` | 60 | 1 minute |
| `GET /api/superadmin/orders/recent` | 60 | 1 minute |
| `GET /api/superadmin/orders/:orderId` | 120 | 1 minute |
| `PUT /api/superadmin/orders/:orderId/status` | 30 | 1 minute |
| `POST /api/superadmin/orders/:orderId/cancel` | 30 | 1 minute |
| `GET /api/superadmin/orders/:orderId/timeline` | 60 | 1 minute |
| `GET /api/superadmin/orders/analytics` | 30 | 1 minute |
| `GET /api/superadmin/orders/export` | 5 | 1 hour |
| `GET /api/superadmin/orders/report/pdf` | 5 | 1 hour |
| `GET /api/superadmin/orders/stream` | 30 | 1 minute |
| `POST /api/superadmin/orders/bulk/status` | 10 | 1 minute |

### Endpoints

#### `GET /api/superadmin/orders/recent`

- Returns recent orders scoped by a rolling day window.
- Query params:
  - `page` (default `1`)
  - `limit` (default `15`, max `100`)
  - `days` (default `14`, max `90`)
  - `search`
  - `status` (`all|pending|processed|completed|cancelled`, legacy values accepted)
  - `payment_method`

#### `GET /api/superadmin/orders/:orderId`

- Returns full order detail including items, addresses, payment metadata, and shipment fields.
- `:orderId` accepts numeric ID or `order_number`.

#### `PUT /api/superadmin/orders/:orderId/status`

- Updates canonical order status with optional reason/tracking metadata.
- Writes `OrderStatusAuditLog` and syncs `OrderStatusCache`.
- Request body:

```json
{
  "status": "processed",
  "reason": "Packed and ready for courier handoff",
  "tracking_number": "TRK-2026-0001",
  "tracking_carrier": "DHL",
  "tracking_url": "https://tracking.example.com/TRK-2026-0001"
}
```

#### `POST /api/superadmin/orders/:orderId/cancel`

- Cancels an order using the explicit cancel workflow.
- Request body:

```json
{
  "reason": "Customer requested cancellation"
}
```

#### `GET /api/superadmin/orders/analytics`

- Returns aggregate analytics including totals, canonical status breakdown, payment breakdown, top customers, and daily trend.
- Query params:
  - `start_date`, `end_date`
  - `status` (optional canonical or legacy alias)

#### `GET /api/superadmin/orders/export`

- Exports filtered orders as `csv` or `xlsx`.
- Query params:
  - `format` (`csv|xlsx`)
  - `search`
  - `status`
  - `payment_method`
  - `sort_by` (`placed_at|total_amount|status_changed_at|order_number`)
  - `sort_dir` (`asc|desc`)
  - `start_date`, `end_date`

#### `GET /api/superadmin/orders/report/pdf`

- Returns a downloadable PDF report with summary KPIs and a filtered order table.
- Response headers:
  - `Content-Type: application/pdf`
  - `Content-Disposition: attachment; filename="orders_report_YYYYMMDD.pdf"`
  - `Content-Length`
  - `X-Request-Id`
- Query params:
  - `search`
  - `status`
  - `payment_method`
  - `start_date`, `end_date`

### Legacy Endpoint Notes

#### `GET /api/superadmin/orders/summary`

- Returns aggregated order totals and revenue by status.
- Query params:
  - `start_date` (optional ISO date)
  - `end_date` (optional ISO date)

#### `GET /api/superadmin/orders`

- Returns paginated order list with user and item-count metadata.
- Query params:
  - `page` (default `1`)
  - `limit` (default `15`, max `100`)
  - `search`
  - `status` (`all|pending|processed|completed|cancelled`, legacy values accepted)
  - `payment_method`
  - `sort_by` (`placed_at|total_amount|status_changed_at|order_number`)
  - `sort_dir` (`asc|desc`)
  - `start_date`, `end_date`

#### `GET /api/superadmin/orders/:orderId/timeline`

- Returns timeline view of order lifecycle and status transition audit events.

#### `GET /api/superadmin/orders/stream`

- Server-Sent Events stream for live order status updates.
- Sends initial `snapshot` event, `order-status` updates, and `ping` heartbeat.
- Query params:
  - `status` (optional filter)
  - `order_id` (optional exact filter)
  - `order_number` (optional exact filter)

#### `POST /api/superadmin/orders/bulk/status`

- Applies status update payload to multiple orders and returns per-order success/failure results.
- Request body:

```json
{
  "order_ids": ["1001", "ONTP-20260408-0001"],
  "status": "processed",
  "reason": "Batch dispatched",
  "tracking_carrier": "J&T Express"
}
```

### Status Transition Rules

- `pending` -> `processed|completed|cancelled`
- `processed` -> `completed|cancelled`
- `completed` is terminal
- `cancelled` is terminal

### Response Envelope

All JSON responses in this section follow:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "requestId": "uuid",
    "responseTime": 12,
    "timestamp": "2026-04-08T00:00:00.000Z"
  }
}
```

Error responses for V2/newly-updated surfaces use `ORDER_MGMT_15000` to `ORDER_MGMT_15599`.

Legacy surfaces continue to return `ORDER_10000` to `ORDER_10599` for backward compatibility.

Binary endpoints (`export`, `report/pdf`) return file attachments rather than JSON success envelopes.

---

## 61. SuperAdmin Dashboard API

All dashboard endpoints are under:

```
/api/superadmin/*
```

### Role Requirements

All endpoints in this section require the `super_admin` role.

- Allowed: `super_admin`
- Denied: `admin`, `user`, `company_admin`, `dev` (for this route group)

### Error Codes Reference

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `DASHBOARD_28000` | 401 | Unauthorized access |
| `DASHBOARD_28001` | 403 | SuperAdmin role required |
| `DASHBOARD_28002` | 401 | Invalid session provided |
| `DASHBOARD_28003` | 401 | Session has expired |
| `DASHBOARD_28004` | 403 | Insufficient permissions |
| `DASHBOARD_28100` | 400 | Invalid date range provided |
| `DASHBOARD_28101` | 400 | Invalid filter type specified |
| `DASHBOARD_28102` | 400 | Date range exceeds maximum allowed period |
| `DASHBOARD_28103` | 400 | Invalid timezone specified |
| `DASHBOARD_28104` | 400 | Start date cannot be after end date |
| `DASHBOARD_28105` | 400 | Invalid date format provided |
| `DASHBOARD_28200` | 404 | Requested data not found |
| `DASHBOARD_28201` | 404 | Requested metric is not available |
| `DASHBOARD_28300` | 500 | Failed to fetch geolocation data |
| `DASHBOARD_28301` | 500 | IP geolocation service unavailable |
| `DASHBOARD_28302` | 400 | Invalid IP address provided |
| `DASHBOARD_28303` | 429 | Geolocation service rate limit exceeded |
| `DASHBOARD_28304` | 500 | Geolocation service request timeout |
| `DASHBOARD_28400` | 400 | Invalid pagination parameters |
| `DASHBOARD_28401` | 400 | Page limit exceeded |
| `DASHBOARD_28402` | 400 | Invalid sort field specified |
| `DASHBOARD_28403` | 400 | Invalid sort direction specified |
| `DASHBOARD_28404` | 400 | Batch size exceeds maximum allowed |
| `DASHBOARD_28500` | 429 | Rate limit exceeded |
| `DASHBOARD_28501` | 429 | Quota exceeded |
| `DASHBOARD_28502` | 429 | Temporary block due to suspicious activity |
| `DASHBOARD_28503` | 429 | Suspicious activity detected |
| `DASHBOARD_28600` | 500 | Database operation failed |
| `DASHBOARD_28601` | 500 | External service error |
| `DASHBOARD_28602` | 500 | Cache operation failed |
| `DASHBOARD_28603` | 500 | Report generation failed |
| `DASHBOARD_28604` | 500 | Data export failed |

### Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| `GET /api/superadmin/dashboard/metrics` | 30 | 1 minute |
| `GET /api/superadmin/users` | 60 | 1 minute |
| `GET /api/superadmin/system/health` | 20 | 1 minute |
| `GET /api/superadmin/staff/activities` | 60 | 1 minute |
| `GET /api/superadmin/orders/recent` | 60 | 1 minute |
| `GET /api/superadmin/users/locations` | 30 | 1 minute |

### Shared Date Filter Contract

Date-aware endpoints in this section accept:

- `date_filter`: `today|yesterday|this_week|this_month|custom`
- `custom_start_date`, `custom_end_date`: required when `date_filter=custom`, format `YYYY-MM-DD`
- `timezone`: optional IANA timezone (default `UTC`)

Rules:

- Max date window is 90 days
- Each response includes `meta.date_range` for current and previous windows
- Comparison metrics use period-over-period percentage change (`meta.comparison`)

### Endpoints

#### `GET /api/superadmin/dashboard/metrics`
- Returns global superadmin dashboard totals and trend comparisons.
- Main data points:
  - users, orders, revenue, companies, affiliates, pending company requests
- `data.totals.total_users` is the **all-time** registered user count (not limited to the selected date window).
- `data.user_tier_trend` — array of four bar-chart buckets for the selected date window vs the previous period:
  - `new_users` — user registrations in range
  - `basic` — active basic-tier subscriptions in range
  - `standard` — active standard/free-trial-tier subscriptions in range
  - `premium` — active premium/enterprise-tier subscriptions in range
- Each trend item shape:
```json
{
  "key": "basic",
  "label": "Basic Accounts",
  "current": 42,
  "previous": 38,
  "change": 4,
  "percentage_change": 10.5
}
```
- Query params: shared date filter contract (`date_filter`, `start_date`, `end_date` for custom)

#### `GET /api/superadmin/dashboard/recent-activities`
- Returns a paginated unified recent-activity feed built from audit trails.
- Query params:
  - `page` (default `1`)
  - `limit` (default `20`, max `100`)
  - `activity_type` (optional text filter)
  - shared date filter contract

#### `GET /api/superadmin/users`
- Returns paginated users with company, subscription, and order summary data.
- Each user includes `is_online` and `session_status` (`online` | `offline`) derived from login/logout events and recent activity (5-minute cutoff).
- **Record limit:** raised from `100` → `10000` to allow full-dataset retrieval for the Super Admin Users feature.
- Query params:
  - `page`, `limit` (max `10000`) — **updated from 100 to 10000**
  - `search` (name/email — applied server-side before pagination)
  - `status` (`all|active|restricted`)
  - `role` (`all|user|admin|super_admin|company_admin|dev`)
  - `subscription_type` (`all|free|basic|premium|enterprise`)
  - `sort_by` (`created_at|last_active|name|email`)
  - `sort_dir` (`asc|desc`)
  - shared date filter contract (optional)

#### `GET /api/superadmin/system-health`
- Returns API/database health snapshot with performance and security indicators.
- Includes:
  - API request/latency summary
  - error rate indicators
  - security alert counts
  - main and analytics DB availability/latency

#### `GET /api/superadmin/staff/activities`
- Returns paginated superadmin staff actions aggregated from audit/event tables.
- Query params:
  - `page`, `limit`
  - `search` (staff/action/source text)
  - shared date filter contract

#### `GET /api/superadmin/orders/recent`
- Returns paginated recent orders with transaction type and status filtering.
- Query params:
  - `page`, `limit`
  - `search` (order number, customer name/email)
  - `transaction_type` (`all|physical_card|subscription|theme`)
  - `status` (`all|new|pending|shipped|cancelled|completed`)
  - `sort_by` (`created_at|amount|customer_name|order_number|transaction_type`)
  - `sort_dir` (`asc|desc`)

#### `GET /api/superadmin/users/locations`
- Provides geolocation analytics and map data for user tracking.
- Auth: `withDashboardSuperAdmin` (same session contract as other dashboard routes).
- Query params:
  - `view` (`map|countries|cities`) - Type of location data to return
  - `limit` (default `100`, max `1000`) - Maximum records to return
- Returns:
  - Map view: User list with coordinates and location details (`user_id` as string, `latitude`/`longitude` as numbers)
  - Countries view: User count breakdown by country with percentages
  - Cities view: User count breakdown by city with country and percentages
- Map item example:
```json
{
  "user_id": "123",
  "name": "Jane Doe",
  "email": "jane@example.com",
  "location": {
    "latitude": 14.5995,
    "longitude": 120.9842,
    "country": "Philippines",
    "city": "Manila",
    "location_string": "Manila, Philippines",
    "is_login_location": true
  },
  "last_active": "2026-06-22T10:00:00.000Z",
  "activity_type": "login"
}
```
- Error tag: `[USER_LOCATIONS_API]`

#### `GET /api/superadmin/recent-orders`
- Returns paginated order stream with summary and period comparisons.
- Query params:
  - `page`, `limit`
  - `search` (order number, payment ID, customer fields)
  - `status` supports canonical and alias values:
    - canonical: `pending|pending_payment|processing|shipped|delivered|completed|payment_failed|cancelled|refunded`
    - aliases: `paid|in_progress|awaiting_payment|failed|canceled`
  - shared date filter contract

### Response Envelope

All JSON responses in this section follow:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "requestId": "uuid",
    "responseTime": 12,
    "timestamp": "2026-04-14T00:00:00.000Z"
  }
}
```

List endpoints include `meta.pagination` and date-aware endpoints include `meta.date_range` and `meta.comparison`.

---

## 62. Staff Management API (SuperAdmin)

All staff management endpoints are under:

```
/api/superadmin/staff/*
```

### Role Requirements

All endpoints in this section require the `super_admin` role.

- Allowed: `super_admin`
- Denied: `admin`, `user`, `company_admin`, `dev` (for this route group)

### Permission Modules

The following modules are available for granular permission assignment:

| Module Key | Display Name | Description |
|------------|--------------|-------------|
| `clients` | Client Page | Manage client accounts |
| `companies` | Company List | Manage company records |
| `affiliates` | Affiliate Page | Manage affiliates |
| `orders` | Order Page | Manage orders |
| `inquiries` | Inquiries Page | Manage customer inquiries |
| `analytics` | Web Analytics | View analytics data |
| `support` | Customer Support | Handle support tickets |
| `company_requests` | Company Requests | Approve/reject company requests |
| `web_management` | Web Management | Manage website content |
| `staff` | Staff Page | Manage staff records |

### Permission Actions

| Action | Description |
|--------|-------------|
| `create` | Ability to create new records |
| `read` | Ability to view records |
| `update` | Ability to edit existing records |
| `delete` | Ability to delete records |

### Error Codes Reference

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `STAFF_MGMT_16000` | 401 | Unauthorized access |
| `STAFF_MGMT_16001` | 403 | SuperAdmin role required |
| `STAFF_MGMT_16002` | 403 | Insufficient permissions |
| `STAFF_MGMT_16100` | 404 | Staff not found |
| `STAFF_MGMT_16101` | 409 | Staff already exists |
| `STAFF_MGMT_16102` | 400 | Invalid role |
| `STAFF_MGMT_16103` | 400 | Invalid department |
| `STAFF_MGMT_16104` | 409 | Staff email exists/conflicts |
| `STAFF_MGMT_16200` | 400 | Permission module not found |
| `STAFF_MGMT_16201` | 400 | Invalid permission config |
| `STAFF_MGMT_16202` | 500 | Permission update failed |
| `STAFF_MGMT_16300` | 500 | Export generation failed |
| `STAFF_MGMT_16301` | 413 | Export exceeds max rows |
| `STAFF_MGMT_16400` | 400 | Invalid date range |
| `STAFF_MGMT_16401` | 400 | Invalid filter payload |
| `STAFF_MGMT_16500` | 429 | Rate limit exceeded |
| `STAFF_MGMT_16501` | 500 | Internal staff-management error |

### Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| `GET /api/superadmin/staff/analytics` | 30 | 1 minute |
| `GET /api/superadmin/staff` | 60 | 1 minute |
| `GET /api/superadmin/staff/:staffId` | 120 | 1 minute |
| `POST /api/superadmin/staff` | 10 | 1 minute |
| `PUT /api/superadmin/staff/:staffId/permissions` | 20 | 1 minute |
| `PUT /api/superadmin/staff/:staffId/role` | 20 | 1 minute |
| `PATCH /api/superadmin/staff/:staffId/status` | 20 | 1 minute |
| `DELETE /api/superadmin/staff/:staffId` | 10 | 1 minute |
| `GET /api/superadmin/staff/search` | 60 | 1 minute |
| `POST /api/superadmin/staff/assign` | 10 | 1 minute |
| `GET /api/superadmin/staff/export` | 5 | 1 hour |

### Endpoints

#### `GET /api/superadmin/staff/analytics`
- Returns staff analytics summary:
  - `total_staff`, `web_developers`, `sales_representatives`, `admin_count`, `support_agents`, `analysts`, `active_staff`, `inactive_staff`

#### `GET /api/superadmin/staff`
- Returns paginated staff list with role, department, permissions, and activity metadata.
- Query params:
  - `page` (default `1`)
  - `limit` (default `20`, max `100`)
  - `role` (`web_developer|sales_rep|admin|support_agent|analyst`)
  - `department` (`web_dev|sales|admin|support|analytics`)
  - `search` (name/email/role/department text)
- Response includes:
  - `staff_id`, `user_id`, `name`, `email`, `phone`
  - `role`, `role_key`, `department`, `department_key`
  - `is_active`, `invitation_status` (`invited`, `active`, `inactive`)
  - `joined_at`: timestamp when the staff profile was created (from `staff_profiles.joined_at`)
  - `last_login_at`: timestamp of the most recent successful login (from `users.last_login_at`, updated on each login)
  - `profile_image`, `permissions` (module CRUD map)
- Example response:

```json
{
  "success": true,
  "data": {
    "staff": [
      {
        "staff_id": 12,
        "user_id": 1011,
        "name": "Jane Smith",
        "email": "jane.smith@example.com",
        "phone": "+1-555-987-6543",
        "role": "Web Developer",
        "role_key": "web_developer",
        "department": "Web Development",
        "department_key": "web_dev",
        "is_active": true,
        "invitation_status": "active",
        "joined_at": "2025-01-15T10:30:00.000Z",
        "last_login_at": "2025-07-14T02:15:00.000Z",
        "profile_image": "https://cdn.example.com/jane.png",
        "permissions": {
          "clients": { "can_create": true, "can_read": true, "can_update": true, "can_delete": false }
        }
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 45,
      "pages": 3,
      "has_next": true,
      "has_previous": false
    }
  },
  "meta": {
    "requestId": "req_...",
    "responseTime": 42,
    "timestamp": "2026-07-14T12:00:00.000Z"
  }
}
```

#### `GET /api/superadmin/staff/:staffId`
- Returns full staff detail including:
  - role metadata,
  - department metadata,
  - module CRUD permission map,
  - latest activity log entries.

#### `DELETE /api/superadmin/staff/:staffId`
- Permanently deletes a staff member and linked staff user account.
- Authentication: SuperAdmin bearer token + CSRF token.
- Path params:
  - `staffId` (required positive integer staff profile ID)
- Behavior:
  - Clears `updated_by` references on other staff profiles.
  - Clears inquiry assignments for the staff user.
  - Deletes `StaffProfile` (cascades permissions and staff activity logs).
  - Deletes linked `User` record (cascades credentials, sessions, and related staff assignments).
  - Blocks deletion of `super_admin` and `dev` accounts (`403`).
- Success response (`200`):

```json
{
  "success": true,
  "data": {
    "staff_id": 12,
    "message": "Staff member deleted successfully"
  },
  "meta": {
    "requestId": "req_...",
    "responseTime": 42,
    "timestamp": "2026-06-24T12:00:00.000Z"
  }
}
```

- Error tags: `[STAFF_MGMT_API]`, codes `STAFF_MGMT_16100` (not found), `STAFF_MGMT_16401` (invalid staffId), `STAFF_MGMT_16500` (rate limit).

#### `POST /api/superadmin/staff`
- Creates a new staff member in **invited** state and sends a verification email.
- Behavior:
  - If email is new: creates `User` (`is_active=false`), `Credential` (`email_verified=false`, `must_change_password=true`), `StaffProfile` (`is_active=false`), and permissions.
  - If email exists on eligible user: upgrades to `role=staff`, resets verification flags, and creates staff profile.
  - Sends a staff invitation email with a **Verify Account** button linking to `/staff/verify?token=...` when email delivery is configured.
  - Response includes `email_sent` (boolean) and `email_error` (string \| null) so superadmins can detect delivery failures without rolling back the created staff record.
  - Persists an `EmailVerificationToken` even if outbound email is unavailable; the API still returns `201` after the staff record is created.
  - Writes `STAFF_CREATED` activity log details as a JSON string in `staff_activity_logs.details`.
  - Invitee opens the link, sets a password on `/staff/verify`, and is logged into the Staff Portal.
- **Production email prerequisites (Hostinger):**
  - **Base URL** (for verification links): set at least one of `NEXT_PUBLIC_APP_URL`, `APP_URL`, or `FRONTEND_URL` to your public site origin (e.g. `https://your-domain.com`). Do **not** use `NEXT_PUBLIC_API_BASE_URL` for invite links — that variable is for API calls only. If unset, the API falls back to the public request origin (`x-forwarded-host` / `x-forwarded-proto`, then `host`, then request URL origin).
  - **Outbound email:** `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` (default `EMAIL_PROVIDER=smtp`), or `EMAIL_PROVIDER=resend` with `RESEND_API_KEY`. Recommended: `SMTP_PORT` (`587` or `465`), `SMTP_SECURE` (`true` for port `465`), `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`.
  - Use `GET /api/health` (with `Authorization: Bearer <HEALTH_CHECK_SECRET>`) to verify SMTP connectivity on production.
  - Invite links open the page route `/staff/verify?token=...` (not `/api/staff/verify`). The page calls `/api/staff/verify` on the same origin to validate the token and submit the new password.
- `permissions` is optional; when omitted, default read-only permissions are applied for all staff modules.
- Request body:

```json
{
  "first_name": "Jane",
  "last_name": "Smith",
  "email": "jane.smith@example.com",
  "phone": "+1-555-987-6543",
  "role_key": "web_developer",
  "department_key": "web_dev",
  "profile_image": "https://cdn.example.com/jane.png",
  "permissions": {
    "clients": { "can_create": true, "can_read": true, "can_update": true, "can_delete": false },
    "orders": { "can_create": false, "can_read": true, "can_update": false, "can_delete": false }
  }
}
```

- Success response (`201`):

```json
{
  "success": true,
  "data": {
    "staff_id": 12,
    "user_id": 1011,
    "name": "Jane Smith",
    "email": "jane.smith@example.com",
    "role": "web_developer",
    "department": "web_dev",
    "email_sent": true,
    "email_error": null,
    "message": "Staff invitation sent successfully. The invitee must use the verification link to set their password."
  },
  "meta": {
    "requestId": "req_...",
    "responseTime": 84,
    "timestamp": "2026-06-24T12:00:00.000Z"
  }
}
```

- Validation failures return `400` with `STAFF_MGMT_16401`.
- Duplicate staff email returns `409` with `STAFF_MGMT_16101` (already staff) or `STAFF_MGMT_16104` (privileged email).

#### `PUT /api/superadmin/staff/:staffId/permissions`
- Updates module-level CRUD permissions for a staff member.
- Request body:

```json
{
  "permissions": {
    "clients": { "can_create": true, "can_read": true, "can_update": true, "can_delete": false },
    "analytics": { "can_create": false, "can_read": true, "can_update": false, "can_delete": false },
    "staff": { "can_create": false, "can_read": false, "can_update": false, "can_delete": false }
  }
}
```

#### `PUT /api/superadmin/staff/:staffId/role`
- Updates staff role and department.
- Request body:

```json
{
  "role_key": "admin",
  "department_key": "admin"
}
```

#### `PATCH /api/superadmin/staff/:staffId/status`
- Activates/deactivates staff member.
- Request body:

```json
{
  "is_active": false
}
```

#### `GET /api/superadmin/staff/search`
- Searches assignable users (non-staff user accounts).
- Query params:
  - `q` (required search text)

#### `POST /api/superadmin/staff/assign`
- Assigns staff role to existing user account.
- Request body:

```json
{
  "user_id": 101,
  "role_key": "web_developer",
  "department_key": "web_dev",
  "permissions": {
    "clients": { "can_create": true, "can_read": true, "can_update": true, "can_delete": false },
    "support": { "can_create": true, "can_read": true, "can_update": true, "can_delete": false }
  }
}
```

#### `GET /api/superadmin/staff/export`
- Exports staff records as `csv` or `xlsx`.
- Query params:
  - `format` (`csv|xlsx`, default `csv`)
  - `filter` (`all|specific`)
  - `staff_info` (required if `filter=specific`)
  - `role` (`all|web_developer|sales_rep|admin|support_agent|analyst`)
  - `department` (`all|web_dev|sales|admin|support|analytics`)
  - `date_filter` (`all|today|yesterday|this_week|this_month|custom`)
  - `start_date`, `end_date` (`YYYY-MM-DD`, required for `custom`)

Response headers:

- `Content-Type`: `text/csv; charset=utf-8` or `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- `Content-Disposition`: `attachment; filename="staff_export_YYYYMMDD.<ext>"`
- `Content-Length`
- `X-Request-Id`

### Response Envelope

All JSON responses in this section follow:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "requestId": "uuid",
    "responseTime": 12,
    "timestamp": "2026-04-16T00:00:00.000Z"
  }
}
```

Error responses use `STAFF_MGMT_16000` to `STAFF_MGMT_16599`.

Binary export responses return file attachments instead of JSON success envelopes.

---

## 63. Admin Authentication API

All admin-auth endpoints are under:

```
/api/auth/admin/*
```

### Role Requirements

- Allowed: `super_admin`, `staff`, `dev`
- Denied: `user`, `company_admin`, and all other non-admin roles

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/admin/login` | Admin login with role allow-list, lockout checks, and secure session cookies. |
| `POST` | `/api/auth/admin/refresh` | Refreshes admin session via secure refresh token rotation. |
| `POST` | `/api/auth/admin/logout` | Revokes current admin session and clears auth cookies. |
| `POST` | `/api/auth/admin/forgot-password` | Creates admin reset token flow with enumeration-safe response. |
| `POST` | `/api/auth/admin/reset-password` | Resets password from opaque token; revokes all sessions. |
| `POST` | `/api/auth/admin/change-password` | Authenticated password change with current-password verification. |
| `GET` | `/api/auth/admin/verify` | Returns current authenticated admin identity/session metadata. |

### Error Codes Reference

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `AUTH_17000` | 401 | Unauthorized access |
| `AUTH_17001` | 403 | Admin role required |
| `AUTH_17002` | 401 | Invalid credentials |
| `AUTH_17003` | 429 | Account lockout active |
| `AUTH_17004` | 403 | Account deactivated |
| `AUTH_17005` | 403 | Email not verified |
| `AUTH_17006` | 401/404 | Session user/credential not found |
| `AUTH_17007` | 401 | Invalid refresh token |
| `AUTH_17101` | 400 | Invalid reset token |
| `AUTH_17102` | 400 | Expired reset token |
| `AUTH_17104` | 422 | Password policy violation |
| `AUTH_17105` | 422 | Password mismatch |
| `AUTH_17106` | 401 | Current password invalid |
| `AUTH_17107` | 409 | Password reuse not allowed |
| `AUTH_17200` | 400/422 | Invalid payload |
| `AUTH_17400` | 429 | Rate limit exceeded |
| `AUTH_17401` | 429 | Lockout active |
| `AUTH_17500` | 500 | Internal auth error |

### Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| `POST /api/auth/admin/login` | 10 | 15 minutes |
| `POST /api/auth/admin/forgot-password` | 5 | 15 minutes |
| `POST /api/auth/admin/reset-password` | 5 | 15 minutes |
| `POST /api/auth/admin/refresh` | 20 | 15 minutes |
| `POST /api/auth/admin/change-password` | 5 | 15 minutes |
| `GET /api/auth/admin/verify` | 60 | 1 minute |
| `POST /api/auth/admin/logout` | 30 | 1 minute |

### Request Notes

- `POST /api/auth/admin/login`
  - Body: `{ email, password, rememberMe? }`
- `POST /api/auth/admin/forgot-password`
  - Body: `{ email }`
  - Response is intentionally generic to reduce account enumeration risk.
- `POST /api/auth/admin/reset-password`
  - Body: `{ token, new_password, confirm_password }`
- `POST /api/auth/admin/change-password`
  - Body: `{ current_password, new_password, confirm_password }`
  - Requires valid session + CSRF token.

### Security Behaviors

- Login enforces distributed and local rate limiting, progressive lockout checks, timing-safe password verification, and role allow-list filtering.
- Password reset and password change revoke all active sessions after success.
- Reset tokens are single-use and expiry-bound (`PasswordResetToken`).
- Audit logging is recorded for success/failure paths in analytics and admin audit logs.

### Response Envelope

All JSON responses in this section follow:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "requestId": "uuid",
    "responseTime": 12,
    "timestamp": "2026-04-16T00:00:00.000Z"
  }
}
```

Error responses use `AUTH_17000` to `AUTH_17599`.

---

## 64. Database Reconciliation API (SuperAdmin Only)

All reconciliation endpoints are under:

```
/api/superadmin/database/reconcile/*
```

### Role Requirements

- Required role: `super_admin`
- Denied: all non-superadmin roles

### Purpose

These APIs compare current database relationships against legacy reference mappings and optionally fix missing `User.company_id` links.

Input source mode is hybrid:

- Preferred: `sql_file_content` (base64 SQL payload containing legacy `users` and `vcards` INSERT statements)
- Fallback: existing staging tables (`legacy_portal_users`, `legacy_portal_vcards`) when `sql_file_content` is omitted

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/superadmin/database/reconcile/compare` | Compare-only analysis, no data modifications. |
| `POST` | `/api/superadmin/database/reconcile/fix` | Optional write flow with dry-run support and separate toggles for create/update actions. |

### Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| `POST /api/superadmin/database/reconcile/compare` | 5 | 1 hour |
| `POST /api/superadmin/database/reconcile/fix` | 2 | 1 hour |

### Error Codes Reference

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `RECONCILE_22000` | 400 | Invalid SQL file or request payload |
| `RECONCILE_22001` | 413 | SQL file too large (max 10MB decoded) |
| `RECONCILE_22002` | 500 | SQL parsing failed |
| `RECONCILE_22100` | 404 | Expected user not found |
| `RECONCILE_22101` | 500 | Company creation failed |
| `RECONCILE_22102` | 500 | User update failed |
| `RECONCILE_22103` | 409/500 | Referential integrity conflict |
| `RECONCILE_22104` | 404 | Source data unavailable (staging fallback empty/missing) |
| `RECONCILE_22200` | 500 | Transaction failed |
| `RECONCILE_22201` | 500 | Rollback executed |
| `RECONCILE_22300` | 429 | Rate limit exceeded |
| `RECONCILE_22500` | 500 | Internal reconciliation error |

### Compare Request

`POST /api/superadmin/database/reconcile/compare`

```json
{
  "sql_file_content": "base64_encoded_sql_file_content",
  "max_samples": 25
}
```

Notes:

- `sql_file_content` is optional. If omitted, staging fallback is used.
- `max_samples` controls sampled details in mismatch arrays (1-200).

### Fix Request

`POST /api/superadmin/database/reconcile/fix`

```json
{
  "sql_file_content": "base64_encoded_sql_file_content",
  "dry_run": true,
  "create_missing_companies": true,
  "update_users": true,
  "sync_bizcards": true,
  "create_company_employees": true,
  "max_samples": 25
}
```

Notes:

- `dry_run` defaults to `true`.
- `create_missing_companies` and `update_users` are independent toggles.
- `sync_bizcards` defaults to `true` and updates all bizcards for each linked user via `syncMemberBizcardsToCompany`.
- `create_company_employees` defaults to `true` and creates `CompanyEmployee` rows plus increments `Company.current_employees`.
- At least one of `create_missing_companies` or `update_users` must be enabled.
- Affected tables: `User`, `Company`, `CompanyEmployee`, `Bizcard`.

### Response Envelope

All JSON responses in this section follow:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "requestId": "uuid",
    "responseTime": 12,
    "timestamp": "2026-04-25T00:00:00.000Z"
  }
}
```

Fix responses include:

- `summary` (companies created, users updated, employees created, bizcards synced, errors encountered, execution time, dry_run)
- `details` (created company list, updated users count, employees created count, bizcards synced count, failed updates sample)
- `verification` (linked users and remaining unlinked)
- `comparison_report` and `run_id` for audit traceability

### Audit Logging

- Writes to `db_reconcile_audit_log` for lifecycle steps (`START`, `SOURCE_MODE`, `COMPARE_SNAPSHOT`, `FIX_EXECUTION`, `END`)
- Writes to `db_reconcile_error_log` for conflicts and execution failures with `RECONCILE_*` error codes

83. QR Code Generation & Management APIs
All QR code endpoints are now fully integrated with vCard generation and Cloudinary storage.

Error Codes Reference
Code	HTTP Status	Description
QR_5000	500	QR code generation failed
QR_5001	404	QR code or bizcard not found
QR_5002	400	Invalid QR code options
QR_5003	400	Invalid QR source URL
QR_5004	409	QR code already exists
QR_5005	500	Cloudinary upload failed

QR Code Format
All generated QR codes contain vCard (VCF) content with the following format:

text
BEGIN:VCARD
VERSION:3.0
FN:User Full Name
TEL:+639XXXXXXXXX
EMAIL:user@example.com
URL:https://ontap.portal.ph/username
END:VCARD
Endpoints
GET /api/public/[alias] (Modified)
Returns the complete public portfolio profile including QR code.

Authentication: None (public endpoint)

URL Parameters:

Parameter	Type	Required	Description
alias	string	Yes	URL alias of the bizcard (custom_uri or serial_id)
Query Parameters:

Parameter	Type	Default	Description
qr_quality	string	standard	Set to high for 800px high-quality QR code (for print)
Response Example:

json
{
  "success": true,
  "data": {
    "bizcard_id": "12345",
    "name": "John Doe",
    "professional_title": "Software Engineer",
    "occupation": "Backend Developer",
    "company": "Tech Corp",
    "email": "john@example.com",
    "phone": "+639123456789",
    "profile_image": "https://res.cloudinary.com/.../profile.jpg",
    "cover_image": "https://res.cloudinary.com/.../cover.jpg",
    "portfolio_url": "https://ontap.portal.ph/john-doe",
    "qr_code": "data:image/png;base64,...",
    "subscription_tier": "premium",
    "gallery_available": true,
    "inquiry_enabled": true,
    "gallery": [],
    "videos": []
  }
}

Subscription feature flags:

| Field | Type | Description |
|-------|------|-------------|
| `subscription_tier` | `string \| null` | `basic`, `standard`, `premium`, or `null` |
| `gallery_available` | `boolean` | `true` for `standard` and `premium` only |
| `inquiry_enabled` | `boolean` | `true` for `premium` only |

QR Code Response Fields:

Field	Type	Description
qr_code	string	Cloudinary URL or data URL of the offline vCard QR image (VCF-encoded)
portfolio_url	string	Full URL to the public portfolio (included in the VCF `URL:` field)
POST /api/public/[alias] (New)
Performs QR code operations on a published portfolio.

Authentication: None (public endpoint)

URL Parameters:

Parameter	Type	Required	Description
alias	string	Yes	URL alias of the bizcard
Request Body:

json
{
  "action": "regenerate_qr | download_vcard",
  "high_quality": false
}
Actions:

Action	Description
regenerate_qr	Force regenerate the QR code (returns new QR code data URL)
download_vcard	Download the vCard (.vcf) file directly
Success Response (regenerate_qr):

json
{
  "success": true,
  "data": {
    "qr_code": "data:image/png;base64,...",
    "generated_at": "2026-04-28T10:00:00.000Z"
  }
}
Success Response (download_vcard):

Returns raw VCF content as a file download:

text
HTTP/1.1 200 OK
Content-Type: text/vcard; charset=utf-8
Content-Disposition: attachment; filename="john-doe.vcf"
Error Responses:

Status	Condition	Response Body
404	Profile not found	{ "error": "Profile not found." }
400	Invalid action	{ "error": "Invalid action. Use 'regenerate_qr' or 'download_vcard'." }
500	QR generation failed	{ "error": "Failed to regenerate QR code." }
GET /api/portfolio/resolve/[uri] (Modified)
Public URI resolver with serial-first resolution and QR code support.

Authentication: None (public endpoint)

URL Parameters:

Parameter	Type	Required	Description
uri	string	Yes	Can be serial_id (6 chars) or custom_uri
Query Parameters:

Parameter	Type	Default	Description
format	string	redirect	Set to json to receive JSON payload instead of redirect
Success Response (JSON format):

json
{
  "resolvedBy": "serial_id",
  "serialId": "A3F8K2",
  "customUri": "john-doe",
  "portfolioUrl": "https://ontap.portal.ph/john-doe",
  "qrCode": "data:image/svg+xml;base64,...",
  "shouldRedirect": true
}
Blank Card Response (JSON format):

json
{
  "resolvedBy": "serial_id",
  "serialId": "A3F8K2",
  "requiresRegistration": true,
  "redirectUrl": "/register?serial=A3F8K2",
  "shouldRedirect": true,
  "message": "This physical card needs to be claimed. Please register or log in."
}

84. Batch QR Code Generation Script
Overview
A command-line script that generates QR codes for all users in bulk, uploads them to Cloudinary, and updates the database.

Script Location
text
scripts/generate-all-qr-codes.ts
Usage
bash
# Generate QR codes for all users without QR codes
npm run qr:generate

# Dry run (no database or Cloudinary changes)
npm run qr:generate -- --dry-run

# Generate for a specific user
npm run qr:generate -- --user-id=123456

# With custom batch size (default: 50, max: 10000)
npm run qr:generate -- --batch-size=100
Command Line Arguments
Argument	Type	Default	Description
--batch-size	number	50	Number of users to process per batch (1-10000)
--dry-run	flag	false	Simulate execution without making changes
--user-id	string	null	Process only a specific user by ID
Environment Variables Required
Variable	Description
DATABASE_URL	MySQL connection string
CLOUDINARY_CLOUD_NAME	Cloudinary cloud name (optional, falls back to data URLs)
CLOUDINARY_API_KEY	Cloudinary API key
CLOUDINARY_API_SECRET	Cloudinary API secret
NEXT_PUBLIC_APP_URL	Application base URL for portfolio links
Output
The script generates:

Console Output: Progress tracking and summary report

Local Files: PNG files in generated-qr-codes/ directory

Cloudinary: Uploads to ontap/qrcodes/ folder

Database: Updates bizcard.qr_code_url and qr_code_generated_at

Summary Report Example
text
============================================================
📊 QR CODE GENERATION SUMMARY
============================================================
⏱️  Duration: 45.23 seconds
📋 Total users processed: 150
✅ Successfully generated: 148
❌ Failed: 2
⏭️  Skipped (already had QR): 50
============================================================

📝 Generated QR codes for:
   - User 1001: john-doe
   - User 1002: jane-smith

⚠️  Failed users:
   - User 1005: Invalid email format
85. QR Code Service API (Internal)
QRCodeService Class
The QRCodeService class provides programmatic QR code generation and management.

File Location: lib/services/qr-code.service.ts

Constructor
typescript
const qrService = new QRCodeService(requestId: string);
Parameter	Type	Description
requestId	string	Unique identifier for request tracing
Methods
generateQRCode(bizcardId: bigint, url: string): Promise<QRCodeData>
Generates a QR code for a given URL and bizcard ID.

Parameter	Type	Description
bizcardId	bigint	The bizcard ID for file naming
url	string	The URL to encode in the QR code
Returns: QRCodeData object with QR code URL and generation timestamp.

regenerateQRCode(bizcardId: bigint, urlAlias: string): Promise<QRCodeData>
Force regenerates a QR code, overwriting any existing one.

Parameter	Type	Description
bizcardId	bigint	The bizcard ID
urlAlias	string	The URL alias for the portfolio
Returns: QRCodeData object with new QR code URL.

getOrGenerateQRCode(bizcardId: bigint, urlAlias: string): Promise<QRCodeData>
Retrieves an existing QR code or generates a new one if missing.

Parameter	Type	Description
bizcardId	bigint	The bizcard ID
urlAlias	string	The URL alias for the portfolio
Returns: QRCodeData object with QR code URL.

QRCodeData Interface
typescript
interface QRCodeData {
  qr_code_url: string;
  qr_code_public_id?: string;
  generated_at: Date;
}
Utility Functions
generateQRCodeForBizcard(bizcardId: bigint, portfolioUrl: string): Promise<QRGenerationResult>
Generates a QR code with caching support (1-hour TTL).

Parameter	Type	Description
bizcardId	bigint	The bizcard ID
portfolioUrl	string	The portfolio URL to encode
Returns: QRGenerationResult with success status and QR code URL.

persistQRCodeToBizcard(bizcardId: bigint, qrCodeUrl: string, portfolioUrl: string): Promise<void>
Persists a generated QR code to the database.

Parameter	Type	Description
bizcardId	bigint	The bizcard ID to update
qrCodeUrl	string	The generated QR code URL
portfolioUrl	string	The portfolio URL (for reference)
generateQRCodesBatch()
Batch generates QR codes for multiple bizcards.

Parameter	Type	Description
items	Array	Array of objects with bizcardId and portfolioUrl
progressCallback	Function	Optional callback for progress tracking
86. Rate Limits for QR Endpoints
Endpoint	Limit	Window	Notes
GET /api/public/[alias]	60	1 minute	Shared with public profile
POST /api/public/[alias] (regenerate)	10	15 minutes	Heavy operation
POST /api/public/[alias] (download)	30	1 minute	Lightweight
GET /api/portfolio/resolve/[uri]	60	1 minute	Shared with resolver
87. Migration Notes
For Existing Deployments
Database Schema: Ensure bizcard table has columns:

qr_code_url (VARCHAR 1024)

qr_code_generated_at (DATETIME)

portfolio_url (VARCHAR 512)

Backfill Existing Users:

bash
bun run scripts/generate-all-qr-codes.ts --batch-size=50
Cloudinary Setup (Recommended):

Add Cloudinary credentials to environment variables

Fallback data URLs used if Cloudinary not configured

Environment Variables Checklist
Variable	Required	Purpose
DATABASE_URL	Yes	Database connection
NEXT_PUBLIC_APP_URL	Yes	Base URL for portfolio links
CLOUDINARY_CLOUD_NAME	No	Cloudinary storage
CLOUDINARY_API_KEY	No	Cloudinary authentication
CLOUDINARY_API_SECRET	No	Cloudinary authentication
Testing Checklist
QR code appears in public portfolio response

QR code scans correctly with vCard data

Download vCard action returns valid .vcf file

Regenerate QR action creates new QR code

Serial-first resolution redirects to custom URI

Blank card resolution redirects to registration

88. Changelog
Date	Version	Changes
2026-04-28	1.0.0	Initial QR code integration
2026-04-28	1.0.0	Added batch generation script
2026-04-28	1.0.0	Added POST /api/public/[alias] endpoint
2026-04-28	1.0.0	Integrated QR code with public portfolio
2026-04-28	1.0.0	Added vCard generation for QR codes
2026-04-28	1.0.0	Added Cloudinary upload support
2026-04-28	1.0.0	Updated serial ID format to 6 characters

---

## Developer Tools — Test Account CLI

Local/CI-only script for creating and removing QA accounts. **Not exposed over HTTP.**

### Command

```bash
npm run test-accounts -- <command> [options]
```

### Commands

| Command | Description |
|---------|-------------|
| `create` | Create default pair: `user` + `super_admin` (tier defaults to `free_trial`) |
| `create --role <role>` | Create one role (`user`, `superadmin`, `company_admin`, `dev`, `staff`, `admin`, `manager`) |
| `create --role all` | Create all supported roles |
| `create --tier <tier>` | Set subscription tier: `free_trial`, `basic`, `standard`, or `premium` |
| `create --role user --tier premium` | Create user with active premium bizcard subscription |
| `list` | List accounts whose email ends with `@ontap.test` (includes tier and bizcard id) |
| `remove --email <email>` | Remove one test account (must be `@ontap.test`) |
| `remove --all` | Remove all `@ontap.test` accounts |

### Subscription tiers

Default tier when `--tier` is omitted: **`free_trial`** (user-level trial only, **no bizcard**).

| Tier | User free trial | Bizcard |
|------|-----------------|---------|
| `free_trial` (default) | Yes (`initializeFreeTrial`) | None |
| `basic` / `standard` / `premium` | No | One dummy virtual bizcard with `subscription_status=active` |

Examples:

```bash
npm run test-accounts -- create
npm run test-accounts -- create --tier premium
npm run test-accounts -- create --role user --tier basic
```

### Default credentials

- **Email:** `test.{roleKey}@ontap.test` (e.g. `test.user@ontap.test`, `test.super_admin@ontap.test`)
- **Password:** `TEST_ACCOUNT_PASSWORD` env var, or a random password printed once to stdout

### Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `NEWDATABASE_URL` | Yes | Database connection |
| `TEST_ACCOUNT_PASSWORD` | No | Fixed password for created accounts (min 8 chars) |
| `TEST_ACCOUNT_SUBSCRIPTION_TIER` | No | Default tier when `--tier` omitted (`free_trial`, `basic`, `standard`, `premium`) |
| `TEST_ACCOUNT_SUBSCRIPTION_DAYS` | No | Paid-tier bizcard expiry length in days (default: `365`) |
| `ALLOW_TEST_ACCOUNT_MANAGEMENT` | In production | Must be `true` when `NODE_ENV=production` |

### Safety rules

1. Create/remove only affects emails ending with `@ontap.test`.
2. In production, script exits unless `ALLOW_TEST_ACCOUNT_MANAGEMENT=true`.
3. Passwords are printed to stdout only — never written to the repo or this doc.
4. Re-running `create` upserts by email (resets password, reactivates account).

### Supported roles

| CLI alias | DB `User.role` | Portal |
|-----------|----------------|--------|
| `user` | `user` | `/user` |
| `superadmin` | `super_admin` | `/superadmin` |
| `company_admin` | `company_admin` | `/admin` |
| `dev` | `dev` | user + superadmin |
| `staff` | `staff` | `/staff` |
| `admin` | `admin` | `/admin` |
| `manager` | `manager` | `/admin` |

---

## New Database Migration Runbook

Migrate legacy Portal SQL into new Hostinger databases (`NEWDATABASE_URL`, `NEWANALYTICS_DATABASE_URL`), then overlay current production dumps so live data wins on conflicts.

### Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `NEWDATABASE_URL` | Yes | Primary production main database (Prisma schema + app runtime) |
| `NEWANALYTICS_DATABASE_URL` | Yes | Primary production analytics database |
| `DATABASE_URL` | No (deprecated) | Legacy fallback if `NEWDATABASE_URL` unset |
| `ANALYTICS_DATABASE_URL` | No (deprecated) | Legacy fallback if `NEWANALYTICS_DATABASE_URL` unset |

Add these to `.env` locally; never commit credentials.

### Source files

| File | Role |
|------|------|
| `databases/u517833616_Portal (1).sql` | Legacy Portal — ETL selected tables only |
| `databases/u517833616_newontap.sql` | Production main snapshot — direct overlay |
| `databases/u517833616_statsandbackup.sql` | Production analytics snapshot — direct overlay |

### Conflict policy

1. **Phase A (Portal ETL)** loads first into empty Prisma-schemas.
2. **Phase B/C (overlay)** uses `REPLACE INTO` so **newontap / statsandbackup win** on duplicate primary keys.
3. Portal-only legacy rows remain when not present in production dumps.

### npm scripts

```bash
# Apply full Prisma schema to both new DBs (db push — required for empty DBs; incremental migrations only)
npm run migrate:new:schema

# Phase A: Portal ETL (main + analytics)
npm run migrate:new:portal

# Phase B: Overlay production main dump
npm run migrate:new:overlay-main

# Phase C: Overlay production analytics dump
npm run migrate:new:overlay-analytics

# Verification checks
npm run migrate:new:verify

# Full pipeline (portal → overlays → verify)
npm run migrate:new:all

# Portal-first merge (preserved IDs + additive snapshot merge; no overlay-main)
npm run migrate:new:portal-merge
npm run migrate:new:portal-merge -- --apply --confirm-clear
```

### Portal merge pipeline (`migrate:new:portal-merge`)

Use when media migration fails due to Portal folder IDs not matching `NEWDATABASE_URL` user/bizcard primary keys.

**Flow:** snapshot portfolio tables → clear portfolio scope → Portal ETL with `preservePortalIds` → additive merge from snapshot → verify.

| Step | Action |
|------|--------|
| 1 | Export `User`, `Credential`, `Bizcard`, `Address`, `Social`, `Service`, `ServiceMedia`, `Media`, `BizcardSubscription` to `migration-system/backups/portal-merge-{timestamp}/` |
| 2 | Delete portfolio-scope rows (FK-safe, `FOREIGN_KEY_CHECKS=0`) |
| 3 | Import **only** Portal SQL `users` + `vcards` (bizcards) with preserved Portal IDs; duplicate emails are skipped (logged) instead of failing |
| 4 | INSERT snapshot rows that do not exist after Portal import; snapshot-only users/bizcards (no Portal SQL match) are appended at the end with new `user_id` / `bizcard_id` values (`MAX(id)+1`) |
| 5 | Verification + comparison manifest |

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--apply` | off | Execute writes (default is dry-run) |
| `--confirm-clear` | off | Required with `--apply` to delete portfolio-scope rows |
| `--include-test-data` | off | Import Portal test/smoke emails |
| `--timestamp=YYYYMMDD_HHMMSS` | now | Snapshot/manifest timestamp |

**Comparison manifest:** `migration-system/manifests/portal-merge-{timestamp}.comparison.json` includes `snapshot_counts`, `live_counts_after_portal`, `inserted_from_snapshot`, `skipped_conflicts`, `id_alignment_sample`.

**Merge error codes:**

| Code | Meaning |
|------|---------|
| `MERGE_USER_EMAIL_CONFLICT` | Snapshot user email belongs to a different live `user_id` |
| `MERGE_FK_ORPHAN` | Snapshot row references missing parent user/bizcard |
| `MERGE_UNIQUE_VIOLATION` | Insert failed on unique constraint (`serial_id`, `url_alias`, etc.) |

**Recommended order for media migration:**

1. `npm run migrate:new:portal-merge -- --apply --confirm-clear`
2. `MEDIA_MIGRATION_SKIP_PURGE=1 npm run migration:migrate`

Do **not** run `migrate:new:overlay-main` after portal-merge unless you intend production dump IDs to replace Portal-aligned IDs.

### CLI flags

| Flag | Default | Description |
|------|---------|-------------|
| `--phase portal\|overlay-main\|overlay-analytics\|verify\|all` | `all` | Run specific phase |
| `--dry-run` | off | Log transforms without writing |
| `--exclude-test-data` | on | Skip `@example.com`, `smoke_*`, `test_*` emails |
| `--include-test-data` | — | Import test/smoke accounts |

### Portal tables included (main ETL)

`users`, `vcards`, `vcard_services`, `social_links`, `galleries`, `media`, `enquiries`, `contact_requests`, `affiliate_users`, `subscriptions`, `tenants` (mapping only).

### Portal tables excluded

Geo reference (`cities`, `states`, `countries`, `currencies`, `languages`), Laravel infra, CMS/marketing, old billing, appointments, NFC, and other unused features (see migration plan).

### Idempotency & audit

- Re-runs skip entities already logged in `portal_migration_audit_log` by `(source, entity_type, entity_key)`.
- Errors go to `portal_migration_error_log` with `[MIGRATE_DB]` tags (no connection strings in output).

### Verification checklist

After `migrate:new:verify`:

- User and Bizcard counts > 0
- No orphan `Bizcard.user_id` references
- Active users have `Credential` rows
- Analytics row count reported
- Manual smoke: login, bizcard editor, portfolio view write

### Rollback

Restore Hostinger DB snapshot taken before migration if needed. Production uses `NEWDATABASE_URL` / `NEWANALYTICS_DATABASE_URL` as primary connections.

---

## Media Migration System (Cloudinary + QR/VCF)

CLI entry point (from `ontapnewsystem` project root):

```bash
npm run migration:dry-run
export MEDIA_MIGRATION_CONFIRM_CLOUDINARY_PURGE=DELETE_ALL
npm run migration:migrate -- --confirm-purge
```

### Resume after interruption

If a run fails due to network issues or a partial phase, **do not** re-run with `--confirm-purge` (that purges Cloudinary again while the upload checkpoint still marks files as uploaded).

```bash
# Resume pending uploads, placements, and QR/VCF work
npm run migration:migrate -- --resume

# Equivalent purge skip
MEDIA_MIGRATION_SKIP_PURGE=1 npm run migration:migrate
```

| Flag | Description |
|------|-------------|
| `--resume` | Explicit resume mode; also auto-detected when `state/upload-checkpoint.json` has entries or `state/migration-progress.json` is incomplete |
| `--force-purge` | Purge Cloudinary even in resume mode (requires `--confirm-purge` + `MEDIA_MIGRATION_CONFIRM_CLOUDINARY_PURGE=DELETE_ALL`) |
| `--reset-checkpoint` | Clear upload/placement checkpoints and progress before run (use with `--confirm-purge` for a fresh start) |

Optional env for resume runs:

| Env | Description |
|-----|-------------|
| `MEDIA_MIGRATION_SKIP_PURGE=1` | Skip Cloudinary purge (same effect as resume purge guard) |
| `MEDIA_MIGRATION_SKIP_BACKUP=1` | Skip DB backup on resume runs |

State files (under `migration-system/state/`):

| File | Purpose |
|------|---------|
| `upload-checkpoint.json` | Successful/failed Cloudinary uploads keyed by `hash:relativePath` |
| `placement-checkpoint.json` | Successful/failed DB placement writes per target record |
| `migration-progress.json` | Last completed pipeline phase (`clearUrls`, `upload`, `placement`, `qrVcf`, …) |

On resume, the uploader validates checkpoint URLs against Cloudinary before skipping uploads. Missing assets are re-queued automatically.

### Database target

All media migration DB writes (placements, `vcf_file_url`, `portfolio_qr_code_url`, legacy URL swaps) use **`NEWDATABASE_URL`** via `migration-system/lib/prisma.ts`. Run `npm run migration:status` to confirm the target host/database and count bizcards missing QR/VCF URLs.

| Variable | Required | Purpose |
|----------|----------|---------|
| `NEWDATABASE_URL` | Yes | Target database for all migration placement and QR/VCF writes |

### Pipeline steps (`[0/9]` … `[8/9]`)

| Step | Action |
|------|--------|
| 0 | Purge **all** Cloudinary images/videos/raw assets (requires `--confirm-purge` + env confirm) |
| 1 | Backup media-related DB tables |
| 2 | Index Portal + newontap SQL ownership (id+email) and classify `public/client-images` paths |
| 3 | **Clear stale Cloudinary URLs** from `NEWDATABASE_URL` (matched records nulled for replacement; unmatched nulled permanently; Bizcard QR/VCF fields cleared for regen). Runs only when step 0 purge completed. Local `client-images` URLs are untouched. |
| 4 | Upload media to Cloudinary (`ontap/profiles`, `ontap/covers`, `ontap/portfolio`, `ontap/services`, …) |
| 5 | Write placements to `User`, `Bizcard`, `Media`, `Service`, `Merchandise` (replaces cleared URLs for matched records) |
| 6 | **Regenerate VCF files + dual QR codes** for every active bizcard with `url_alias` |
| 7 | Swap legacy `client-images` URL references |
| 8 | Write manifests + report |

**URL cleanup manifest:** `migration-system/manifests/{timestamp}.url-cleanup.json` includes `clearedMatched`, `clearedUnmatched`, `clearedQrVcf`, and sample keys.

### New `Bizcard` fields

| Column | Description |
|--------|-------------|
| `vcf_file_url` | Cloudinary raw URL for downloadable `.vcf` contact file |
| `portfolio_qr_code_url` | Cloudinary image URL for QR encoding the portfolio URL |
| `qr_code_url` | Cloudinary image URL for QR encoding VCF contact content (unchanged semantics) |

Static `vcards/qrlogo/` files are **skipped** during file migration; QR images are generated programmatically in step 5.

### Source paths and Portal SQL gate

Default local scan folder: `public/client-images` (`CLIENT_IMAGES_PATH`). Files are served by Next.js at `/client-images/...`; step 7 legacy URL swap maps those DB references to Cloudinary.

Only these upload prefixes are classified:

| Local path prefix | Portal `media.collection_name` | DB targets |
|-------------------|-------------------------------|------------|
| `profile/{id}/` | `profile` | `User.profile_url`, `Media` (`related_type=profile`) |
| `vcards/profiles/{id}/` | `vcards/profiles` | `Bizcard.profile_img`, `Media` (`profile`) |
| `vcards/covers/{id}/` | `vcards/covers` | `Bizcard.cover_img`, `Media` (`cover`) |
| `vcards/services/{id}/` | `vcards/services` | `Service.featured_image`, `Media` (`service_gallery`) |
| `vcards/gallery/{id}/` | `vcards/gallery` | `Media` (`related_type=gallery`, `related_id=bizcard_id`) |
| `vcards/products/{id}/` | `vcards/products` | `Media` (`related_type=portfolio`, `related_id=bizcard_id`) |

Each ready file must match a row in Portal SQL (`PORTAL_SQL_PATH`, default `databases/u517833616_Portal (1).sql`) by **`collection_name` + `file_name`**.

### Ownership and placement rules

1. **`model_type`** (Portal `media.model_type`) determines placement kind (`User`, `Vcard`, `VcardService`, `Gallery`, `Product`).
2. **`model_id`** resolves the owning Portal user when it exists in Portal `users`, or via entity chains (`vcard → tenant → user`, `gallery → vcard`, `product → vcard`, `service → vcard`).
3. **Dual id+email verification (mandatory):** Portal ownership must resolve a `users.id` **and** matching `users.email` pair from Portal SQL. The same id+email pair must exist in the newontap snapshot (`MAIN_SQL_PATH`) and in live `NEWDATABASE_URL` before any placement write proceeds.
4. **Folder `{id}` segments** are used to resolve NEWDATABASE records (`Bizcard`, `Service`, etc.). Email-only user fallback is **not** used when a Portal user id is known but does not match the verified email.
5. Gallery media uses `related_type=gallery` (not `portfolio`) so public portfolio APIs resolve correctly.

Optional env:

| Env | Default | Purpose |
|-----|---------|---------|
| `CLIENT_IMAGES_PATH` | `public/client-images` | Local folder to scan (images and videos) |
| `PORTAL_SQL_PATH` | `databases/u517833616_Portal (1).sql` | Portal ownership index |
| `MAIN_SQL_PATH` | `databases/u517833616_newontap.sql` | newontap snapshot cross-check for id+email ownership |

### Error tags

- `MIGRATE_QR_VCF_REGEN_FAILED` — bizcard QR/VCF batch step failed for a record
- `MIGRATE_VCF_UPLOAD_FAILED` — Cloudinary raw VCF upload failed
- `MIGRATE_PORTFOLIO_QR_FAILED` — portfolio QR PNG upload failed
- `MIGRATE_MEDIA_UNCLASSIFIED_PATH` — file path outside allowed prefixes (`icon/`, `vcards/blogs/`, …)
- `MIGRATE_MEDIA_NO_PORTAL_ROW` — no Portal `media` row for `collection_name` + `file_name`
- `MIGRATE_MEDIA_NO_PORTAL_USER` — could not resolve owning Portal user from SQL + path
- `MIGRATE_MEDIA_OWNERSHIP_CONFLICT` — path-derived owner disagrees with Portal SQL owner
- `MIGRATE_MEDIA_ID_RESOLVE_FAILED` — Portal owner resolved but NEWDATABASE target row/user not found
- `MIGRATE_MEDIA_COLLECTION_MISMATCH` — Portal row collection does not match classified path
- `MIGRATE_MEDIA_PORTAL_USER_MISSING_EMAIL` — Portal user id resolved but no email in Portal `users`
- `MIGRATE_MEDIA_PORTAL_ID_EMAIL_MISMATCH` — Portal identity signals disagree or email maps to multiple ids
- `MIGRATE_MEDIA_VCARD_OWNER_MISMATCH` — Portal vcard not owned by resolved Portal user
- `MIGRATE_MEDIA_VCARD_EMAIL_MISMATCH` — Portal vcard email differs from owning Portal user email
- `MIGRATE_MEDIA_TARGET_USER_NOT_FOUND` — newontap/live DB has no user row for verified Portal id+email
- `MIGRATE_MEDIA_TARGET_USER_ID_EMAIL_MISMATCH` — user id exists in newontap but email differs from Portal
- `MIGRATE_MEDIA_BIZCARD_OWNERSHIP_MISMATCH` — Bizcard user_id/email does not match verified Portal owner
- `MIGRATE_MEDIA_SERVICE_OWNERSHIP_MISMATCH` — Service not owned by verified Portal user
- `MIGRATE_MEDIA_LIVE_DB_VERIFICATION_FAILED` — Live NEWDATABASE row fails final id+email check
- `MIGRATE_MEDIA_INVALID_IMAGE` — file extension does not match real image bytes (Cloudinary would reject)
- `MIGRATE_MEDIA_INVALID_VIDEO` — file extension does not match real video bytes
- `MIGRATE_MEDIA_SECURITY_REJECTED` — script/suspicious content detected (e.g. `.php.jpg` disguised payload)
- `MIGRATE_MEDIA_URL_CLEANUP_FAILED` — post-purge Cloudinary URL cleanup step failed



---

## Bug-Fix Release Notes — CSRF & Session Security (July 2026)

### Problem Summary

Some users on **iPhone / Safari mobile** were experiencing two related issues:

1. **Premature session logout** — Users were logged out before the 90-day re-verification window expired.
2. **Invalid CSRF token error** — After the forced logout, the re-verification screen (`/api/auth/reauth/otp/verify`, `/api/auth/webauthn/auth/options`, `/api/auth/webauthn/auth/verify`) returned `{ "error": "Invalid CSRF token.", "code": "CSRF_TOKEN_INVALID" }`.

---

### Root Causes Identified

#### 1. Missing CSRF token in `ReverificationChallengeUser.tsx` (Primary Cause)

All reauth POST requests (`/api/auth/reauth/otp/verify`, `/api/auth/reauth/otp/send`, `/api/auth/webauthn/auth/options`, `/api/auth/webauthn/auth/verify`, `/api/auth/webauthn/register/options`, `/api/auth/webauthn/register/verify`) were sent **without an `X-CSRF-Token` header**.

The `proxy.ts` CSRF guard (`validateCsrfToken`) returns `false` when **both** the cookie token and the header token are missing. On Safari/iOS, Safari's **Intelligent Tracking Prevention (ITP)** blocks cross-origin `SameSite=None` cookies in third-party contexts, which means the `csrf-token` cookie was silently dropped. With no cookie and no header, the guard rejected all reauth POST requests with `403 Invalid CSRF token`.

**Fix:** `ReverificationChallengeUser.tsx` now calls `GET /api/csrf-token` before every state-changing request and reads the token from the **response body** (not the cookie), making the CSRF handshake completely immune to Safari ITP cookie partitioning.

#### 2. `NODE_ENV=development` in production `.env` (Root cause of `SameSite=Lax` cookies)

The `.env` file had `NODE_ENV="development"` even on the live Hostinger server. All cookie configurations in `server/lib/auth.ts` and `lib/csrf.ts` used `process.env.NODE_ENV === "production"` to decide `SameSite`. With `NODE_ENV=development`, all auth cookies (`session_token`, `refresh_token`, `reauth_state`, `csrf-token`) were set with `SameSite=Lax` instead of `SameSite=None; Secure`. Safari on iOS enforces `SameSite=Lax` strictly — it will not send `Lax` cookies on cross-origin POST requests, causing the `reauth_state` cookie to be absent on all reauth API calls, which returns `401 Verification required`.

**Fix:** Added `COOKIE_SECURE=true` to `.env`. All cookie helper functions (`isProductionDeployment()`) now check `COOKIE_SECURE` first, then `NODE_ENV`, then inspect whether `NEXT_PUBLIC_APP_URL` starts with `https://`. This makes production detection independent of `NODE_ENV`.

#### 3. Reauth routes not in `PUBLIC_PREFIX_PATHS` (Auth guard 401 before CSRF check)

`/api/auth/reauth` and `/api/auth/webauthn/auth` were not in the public path list. The `proxy.ts` auth guard checks for `session_token` or `refresh_token` cookies before forwarding to route handlers. During the reauth flow, all existing sessions are **revoked** (by design), so neither cookie is present. This caused a `401 Unauthorized` before the route handler could validate the `reauth_state` cookie.

**Fix:** Both prefixes added to `PUBLIC_PREFIX_PATHS`. Critically, the `skipCsrf` logic was updated with a `reauthRequiresCsrf` flag so these paths still go through CSRF validation — they are exempt only from the session-cookie auth guard, not from CSRF protection.

#### 4. `refreshSession` did not check 90-day reverification policy

`validateToken()` correctly rejects sessions when `isReverificationRequired()` returns `true`. However, `refreshSession()` — invoked when the access token expires and the client retries with the refresh token — did **not** check reverification status. This created an inconsistency: the refresh would succeed and issue a new access token, but every subsequent call to `validateToken()` would immediately reject it, causing an infinite refresh loop that appeared as a session that "keeps logging out."

**Fix:** `refreshSession()` in `server/lib/auth.ts` now queries `last_reverification_at` / `created_at` for the user and calls `isReverificationRequired()`. If the window has lapsed, refresh returns `{ success: false, error: "Reverification required." }` and no new tokens are issued.

---

### Files Modified

| File | Change |
|---|---|
| `app/components/ReverificationChallengeUser.tsx` | Added `fetchCsrfToken()` / `buildReauthHeaders()` helpers. All 6 reauth POST calls now fetch a fresh CSRF token from the response body before sending, making them Safari/ITP-safe. |
| `lib/csrf.ts` | Added `isProductionDeployment()` helper. `setCsrfCookie()` and `shouldUsePartitionedCookies()` now use it instead of `process.env.NODE_ENV === "production"`. |
| `server/lib/auth.ts` | Added `isProductionDeployment()` and `getReauthStateCookieOptions()` export. `getCookieOptions()` and `shouldUsePartitionedCookies()` now use `isProductionDeployment()`. `refreshSession()` now checks `isReverificationRequired()` before issuing new tokens. |
| `proxy.ts` | Added `/api/auth/reauth` and `/api/auth/webauthn/auth` to `PUBLIC_PREFIX_PATHS` (session-cookie auth guard bypass). Added `reauthRequiresCsrf` flag so these paths still go through CSRF validation. Updated `skipCsrf` logic accordingly. |
| `app/api/auth/login/route.ts` | `reauth_state` cookie now set via `getReauthStateCookieOptions()`. |
| `app/api/auth/reauth/otp/verify/route.ts` | `reauth_state` clear cookie now set via `getReauthStateCookieOptions(0)`. |
| `app/api/auth/webauthn/auth/options/route.ts` | `reauth_state` cookie now set via `getReauthStateCookieOptions()`. |
| `app/api/auth/webauthn/auth/verify/route.ts` | `reauth_state` clear cookie now set via `getReauthStateCookieOptions(0)`. |
| `app/api/auth/webauthn/register/options/route.ts` | `reauth_state` cookie now set via `getReauthStateCookieOptions()`. |
| `app/api/auth/webauthn/register/verify/route.ts` | `reauth_state` clear cookie now set via `getReauthStateCookieOptions(0)`. |
| `.env` | Added `COOKIE_SECURE="true"` to force production cookie mode independent of `NODE_ENV`. |

---

### Biometric Login Flow Fix — Server-Side Passkey Check + Cross-Browser Compatibility

**Problem:** The previous implementation relied on `localStorage` alone to determine whether the biometric prompt and manual button should be shown. Privacy-focused browsers (Brave, Safari with ITP, Firefox with Enhanced Tracking Protection, Edge with tracking prevention) clear `localStorage` periodically, causing:
1. The "Login with Biometrics" button to disappear for returning users even though their passkey is still enrolled.
2. The mobile auto-prompt to silently skip even for users who registered a passkey on their phone.
3. The reverse problem: stale `localStorage` entries (passkey deleted via Settings) still triggering the flow.

**Root fix:** A new pre-authentication endpoint `GET /api/auth/webauthn/passkey-exists` performs a lightweight database credential count query. This is now the authoritative source of truth for both the mobile auto-prompt and the manual button visibility check.

**Flow after fix:**
1. Login page mounts → `checkBiometricCapability()` reads `lastPasskeyUser` from localStorage as a fast hint (to avoid network call when no email is stored), then calls `GET /api/auth/webauthn/passkey-exists?email=<email>`.
2. If server returns `hasPasskey: true` → show "Login with Biometrics" button (mobile + desktop).
3. If server returns `hasPasskey: false` → hide button, clear stale localStorage entry.
4. For mobile devices that also pass the conditional mediation check → auto-prompt fires automatically using the server-confirmed email.

**Password login is fully independent** — `handleSubmit` only calls `POST /api/auth/login` and never touches any WebAuthn API.

### Files Modified

| File | Change |
|---|---|
| `app/api/auth/webauthn/passkey-exists/route.ts` | **NEW** — `GET /api/auth/webauthn/passkey-exists` endpoint. Lightweight pre-auth DB credential count query. Returns `{ hasPasskey: boolean }`. No challenge generated, no cookies set. |
| `server/lib/rate-limit.ts` | Added `"webauthn-passkey-exists"` rate limit config (20 requests per 15 minutes per IP). |
| `proxy.ts` | Added `/api/auth/webauthn/passkey-exists` to `PUBLIC_PREFIX_PATHS` (session auth guard bypass; CORS and rate limiting still apply). |
| `app/components/LoginUser.tsx` | Added `checkPasskeyExistsOnServer()` helper (calls new endpoint). Updated `checkBiometricCapability()` to perform server-side DB check before showing manual button. Updated auto-prompt Guard 5 to call server-side check before initiating full WebAuthn options flow. Added `API_BASE_URL` constant before the new helper function. |
| `API-DOCUMENTATION.md` | Added `GET /api/auth/webauthn/passkey-exists` endpoint documentation. Updated Auto-Prompt Behavior section to reflect server-side check. Added Manual Biometric Button cross-browser notes. Added this change entry. |

**Problem 1 — Password login triggered biometric modal:**
`handleSubmit` in `LoginUser.tsx` was blocking the redirect after successful password authentication whenever `data.biometric.hasCredential` was true, forcing the user through `BiometricLoginModal` regardless of whether they wanted to use biometrics. This made password login and biometric login tightly coupled.

**Problem 2 — Auto-prompt fired on desktop:**
The `attemptAutoPasskeyAuth` useEffect had no device-type check, so it fired on any browser that supported conditional mediation and had a stored `lastPasskeyUser` — including macOS Safari, Chrome desktop, and Windows Edge.

**Root fixes applied:**

1. `handleSubmit` no longer sets `showBiometricModal = true` or references `BiometricLoginModal` in any way. After password login succeeds, the frontend writes the user to localStorage, handles `rememberMe`, and redirects to the dashboard immediately. If the user has no enrolled passkey yet, the optional `PasskeyPrompt` enrollment modal is shown; otherwise a direct redirect occurs. The `BiometricLoginModal` can only be activated by the separate manual "Login with Biometrics" button.

2. A `isMobileDevice()` utility function was added to `LoginUser.tsx`. It evaluates three signals: `window.matchMedia('(pointer: coarse)')`, `window.innerWidth < 768`, and a mobile UA token regex. The auto-prompt fires only when ≥2 of 3 signals match (conservative to avoid false-positives on desktop touchscreens).

3. The manual "Login with Biometrics" button visibility check was simplified — it now shows the button on any device (mobile or desktop) that has WebAuthn support AND a stored `lastPasskeyUser`. The button uses `startAuthentication` without `useBrowserAutofill`, which requires an explicit click (works on all platforms). Conditional mediation is no longer required for the manual button.

### Files Modified

| File | Change |
|---|---|
| `app/components/LoginUser.tsx` | Added `isMobileDevice()` function with 3-signal mobile detection. Auto-prompt useEffect now gates on `isMobileDevice()` as the first check. `handleSubmit` completely decoupled from biometric flow — never sets `showBiometricModal = true`, always redirects on password success. Manual biometric button visibility simplified to `WebAuthn support + lastPasskeyUser stored` (no longer requires conditional mediation). |
| `API-DOCUMENTATION.md` | Updated auto-prompt behavior docs to reflect mobile-only restriction and password/biometric independence. Added this change entry. |

---

### Re-verification API Reference

#### `POST /api/auth/reauth/otp/verify`

Verifies a 6-character OTP during the 90-day re-verification challenge.

- **Authentication:** `reauth_state` HttpOnly cookie (set by login when `REVERIFICATION_REQUIRED`)
- **CSRF:** Required — include `X-CSRF-Token` header. Fetch token from `GET /api/csrf-token` response body (use body, not cookie, for Safari/ITP compatibility).
- **Request body:**
```json
{ "code": "AB3F9K" }
```
- **Success response (200):**
```json
{
  "message": "Verification successful.",
  "user": {
    "userId": 42,
    "email": "user@example.com",
    "firstName": "Jane",
    "lastName": "Doe",
    "role": "user"
  }
}


```

- **Error codes:**
  - `400` — Invalid or expired code
  - `401` — Missing or expired `reauth_state` cookie
  - `403` — CSRF token invalid (`code: "CSRF_TOKEN_INVALID"`)
  - `429` — Rate limit exceeded

#### `POST /api/auth/reauth/otp/send`

Resends the OTP for the re-verification challenge.

- **Authentication:** `reauth_state` HttpOnly cookie
- **CSRF:** Required — `X-CSRF-Token` header
- **Request body:** `{}` (empty or `{ "userId": 42, "email": "user@example.com" }`)
- **Success response (200):**
```json
{ "message": "Verification code sent.", "email": "us*****@example.com" }
```

#### `POST /api/auth/webauthn/auth/options`

Generates a WebAuthn authentication challenge for the re-verification flow.

- **Authentication:** `reauth_state` cookie with `purpose: "otp_reauth"`
- **CSRF:** Required — `X-CSRF-Token` header
- **Request body:** `{ "userId": 42, "email": "user@example.com" }`
- **Success response (200):** Returns `options` (WebAuthn PublicKeyCredentialRequestOptions) and `webauthnAvailable: true`
- **Error `409`:** `{ "code": "NO_WEBAUTHN_CREDENTIAL" }` — no passkey registered; fall back to OTP

#### `POST /api/auth/webauthn/auth/verify`

Verifies the WebAuthn assertion for the re-verification flow.

- **Authentication:** `reauth_state` cookie with `purpose: "webauthn_auth"`
- **CSRF:** Required — `X-CSRF-Token` header
- **Request body:** `{ "credential": <WebAuthn AuthenticationResponseJSON> }`
- **Success response (200):** Same shape as `reauth/otp/verify`

#### `POST /api/auth/webauthn/login/options`

Generates a WebAuthn authentication challenge for biometric login (after successful password verification).

- **Authentication:** None required (pre-session)
- **Rate limit:** 15 requests per 15 minutes per IP
- **Request body:** `{ "email": "user@example.com" }`
- **Success response (200):**
```json
{
  "options": {
    "challenge": "...",
    "allowCredentials": [...],
    "rpId": "yourdomain.com",
    "userVerification": "required",
    "timeout": 60000
  },
  "webauthnAvailable": true,
  "user": {
    "userId": 42,
    "email": "user@example.com",
    "firstName": "John"
  }
}
```
- **Error `404`:** Generic error to prevent email enumeration
- **Error `409` with `code: "NO_WEBAUTHN_CREDENTIAL"`:** No passkey enrolled; user should complete password login
- **Error `403`:** Account deactivated

**Cookie set:** `reauth_state` with `purpose: "webauthn_login"` and challenge (expires in 15 minutes)

**Auto-Prompt Behavior (Client-Side — Mobile Only):**
- On the login page, if a user previously logged in with a passkey on the current device, their email is stored in `localStorage` under `lastPasskeyUser`.
- On page load, the frontend runs a mobile-device check (`isMobileDevice()`) using three combined signals: `window.matchMedia('(pointer: coarse)')`, `window.innerWidth < 768`, and a mobile UA regex. The auto-prompt fires only when at least two of the three signals are true (i.e. the device is a mobile phone or tablet — iPhone, Android, iPad, etc.).
- If the device is confirmed mobile, the frontend performs a **server-side passkey existence check** via `GET /api/auth/webauthn/passkey-exists?email=<stored-email>` to confirm the passkey is still enrolled in the database. This is the authoritative source of truth — it handles privacy browsers (Brave, Safari ITP, Firefox ETP) that clear localStorage, and stale entries pointing to passkeys deleted via Settings.
- If the server confirms `hasPasskey: true`, the frontend then checks `PublicKeyCredential.isConditionalMediationAvailable()`. If supported, it automatically calls `POST /api/auth/webauthn/login/options` and triggers `startAuthentication({ useBrowserAutofill: true })` to show the native platform authenticator (Face ID, Touch ID, fingerprint) without requiring any user gesture.
- **Desktop users are never auto-prompted.** They must click the manual "Login with Biometrics" button instead.
- If the user has no stored `lastPasskeyUser` email, or the server returns `hasPasskey: false`, no auto-prompt is shown and the password form remains the default. The stale localStorage entry is cleared automatically.
- If the auto-prompt is cancelled or fails (user dismisses, biometric fails, network error), the error is swallowed silently and the password form remains usable — the user is never locked out.
- This creates a GCash-like experience where biometric authentication appears automatically on mobile page load for returning passkey users.

**Password Login Independence:**
- The regular "Log in" button (form submit) performs **only** email/password authentication via `POST /api/auth/login`. It never calls any WebAuthn API and never triggers the biometric modal.
- After successful password login the server session is immediately valid. The frontend redirects to the dashboard without any biometric gate.
- If the user has no enrolled passkey, a passkey enrollment prompt (`PasskeyPrompt`) is offered post-login as an optional step (skippable).
- If the user already has an enrolled passkey, they are redirected directly to the dashboard after password login.
- The `BiometricLoginModal` component is rendered in the JSX but can only be activated by the dedicated "Login with Biometrics" manual button — it is never triggered from the password login flow.

**Manual Biometric Button (cross-browser fallback):**
- The "Login with Biometrics" button is shown on any device (mobile or desktop) that has WebAuthn support AND the server confirms a passkey is enrolled for the stored `lastPasskeyUser` email.
- The button performs the same server-side passkey existence check (`GET /api/auth/webauthn/passkey-exists`) on page mount. If the server returns `hasPasskey: false`, the button is hidden and the stale localStorage entry is cleared.
- This ensures the button appears correctly in Brave, Edge, Chrome, Safari, and Firefox regardless of whether localStorage has been cleared by privacy protections.
- When clicked, it uses `startAuthentication` with a required user gesture (no `useBrowserAutofill`), which works on all WebAuthn-capable platforms.

#### `POST /api/auth/webauthn/login/verify`

Verifies the WebAuthn assertion and completes biometric login.

- **Authentication:** `reauth_state` cookie with `purpose: "webauthn_login"`
- **Rate limit:** 15 requests per 15 minutes per IP
- **Request body:**
```json
{
  "credential": {
    "id": "...",
    "rawId": "...",
    "response": {
      "authenticatorData": "...",
      "clientDataJSON": "...",
      "signature": "...",
      "userHandle": "..."
    },
    "type": "public-key"
  },
  "rememberMe": false,
  "deviceId": "optional-device-fingerprint"
}
```
- **Success response (200):**
```json
{
  "message": "Biometric authentication successful.",
  "user": {
    "userId": 42,
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "client",
    "customUri": "john-doe"
  },
  "session": {
    "sessionId": "...",
    "expiresAt": "2026-..."
  },
  "biometric": {
    "authenticated": true,
    "method": "webauthn"
  },
  "accessStatus": { ... }
}

```
- **Error `401`:** Authentication failed or invalid credential
- **Error `403`:** Account deactivated
**Cookies set:** `session_token` (httpOnly), `refresh_token` (httpOnly, duration based on `rememberMe`)  
**Cookie cleared:** `reauth_state`
**Post-authentication actions:**
- Updates credential counter and last_used_at
- Records successful login in rate limit store
- Updates user's last login metadata (IP, location, geolocation)
- Links device if deviceId provided
- Tracks superadmin login if role is super_admin
- Checks subscription access status

#### `POST /api/auth/webauthn/register/options`

Generates a WebAuthn registration challenge for enrolling a new passkey.

- **Authentication:** Active session required
- **Rate limit:** 10 requests per 15 minutes per IP
- **Request body:** None (user ID extracted from session)
- **Success response (200):**
```json
{
  "options": {
    "challenge": "...",
    "rp": { "name": "OnTap", "id": "yourdomain.com" },
    "user": {
      "id": "...",
      "name": "user@example.com",
      "displayName": "John Doe"
    },
    "pubKeyCredParams": [...],
    "timeout": 60000,
    "excludeCredentials": [...],
    "authenticatorSelection": {
      "residentKey": "preferred",
      "userVerification": "required"
    }
  },
  "user": {
    "userId": 42,
    "email": "user@example.com",
    "firstName": "John"
  }
}
```
- **Error `401`:** No active session

**Cookie set:** `reauth_state` with `purpose: "webauthn_register"` and challenge (expires in 15 minutes)
#### `POST /api/auth/webauthn/register/verify`
Verifies the WebAuthn attestation and stores the new credential.

- **Authentication:** Active session required
- **Rate limit:** 10 requests per 15 minutes per IP
- **Request body:**
```json
{
  "credential": {
    "id": "...",
    "rawId": "...",
    "response": {
      "attestationObject": "...",
      "clientDataJSON": "...",
      "transports": ["usb", "nfc"]
    },
    "type": "public-key"
  }
}


```


- **Success response (200):**
```json
{
  "message": "Passkey registered successfully.",
  "session": { ... }
}


```


- **Error `400`:** Registration failed (invalid attestation)
- **Error `401`:** Invalid or expired challenge

**Cookie cleared:** `reauth_state`

**Database actions:**
- Creates new `WebAuthnCredential` record with credential ID, public key, counter, transports, device type
- Updates user's `last_reverification_at` timestamp

---

#### `GET /api/auth/webauthn/passkey-exists`

Lightweight pre-authentication endpoint that checks whether a given email address has any enrolled WebAuthn credentials in the database. Called on login page mount to determine whether to show the biometric prompt or the manual "Login with Biometrics" button.

This endpoint is intentionally minimal — it only performs a credential count check. No challenge is generated and no cookies are mutated. The full authentication options request (`POST /api/auth/webauthn/login/options`) is only made when the user actually attempts biometric authentication.

- **Authentication:** None required (pre-login)
- **CSRF:** Not required (GET, read-only)
- **Rate limit:** 20 requests per 15 minutes per IP (`webauthn-passkey-exists`)
- **Query parameter:** `email` (required) — the user's email address, URL-encoded

**Request example:**
```
GET /api/auth/webauthn/passkey-exists?email=user%40example.com
```

**Success response (200) — passkey exists:**
```json
{ "hasPasskey": true }
```

**Success response (200) — no passkey (or unknown/deactivated user):**
```json
{ "hasPasskey": false }
```

**Error responses:**
| Status | Condition |
|--------|-----------|
| `400` | `email` query parameter missing or malformed |
| `429` | Rate limit exceeded |
| `200` | Internal error (degrades gracefully — returns `{ "hasPasskey": false }` so the login page never crashes) |

**Security notes:**
- Returns `{ hasPasskey: false }` for unknown email addresses — no user-existence enumeration possible.
- Returns `{ hasPasskey: false }` for deactivated accounts — mirrors the login and options endpoints.
- Only a credential count is queried; no password hash, session data, or personal information is returned.
- The endpoint is in `PUBLIC_PREFIX_PATHS` (session-cookie auth guard bypassed) but still subject to CORS and IP rate limiting.

**Frontend usage in `LoginUser.tsx`:**
- Called from `checkBiometricCapability()` (on mount) to decide whether to show the "Login with Biometrics" button — on both mobile and desktop. If the server returns `false`, the stale `lastPasskeyUser` localStorage entry is cleared.
- Called from `attemptAutoPasskeyAuth()` (auto-prompt useEffect, mobile only) as Guard 5 before initiating the full WebAuthn options flow. Ensures the auto-prompt is only triggered if the credential actually exists in the DB, regardless of localStorage state.

**Error tag:** `[WEBAUTHN_PASSKEY_EXISTS_ERROR]`
---
#### `GET /api/user/passkeys`
Lists all passkeys (WebAuthn credentials) enrolled for the authenticated user.
- **Authentication:** Active session required (`session_token` cookie)
- **CSRF:** Not required (read-only)
- **Rate limit:** Standard per-IP limit
**Success response (200):**
```json

{
  "success": true,
  "data": {
    "credentials": [
      {
        "id": 1,
        "credentialId": "abc123...",
        "credentialName": "Passkey 2026-07-03",
        "deviceType": "singleDevice",
        "backedUp": false,
        "transports": ["internal"],
        "lastUsedAt": "2026-07-03T10:00:00.000Z",
        "createdAt": "2026-07-03T09:00:00.000Z"
      }
    ]
  }
}

```
- **Error `401`:** Not authenticated

---

#### `DELETE /api/user/passkeys/[id]`

Removes a specific passkey from the authenticated user's account by credential ID.

- **Authentication:** Active session required
- **CSRF:** Required — `X-CSRF-Token` header (DELETE is a mutating method, handled via `authFetch`)
- **Rate limit:** Standard per-IP limit
- **Path parameter:** `id` — URL-encoded `credential_id` string


**Success response (200):**
```json
{
  "success": true,
  "message": "Passkey removed successfully."
}

```

- **Error `400` with `code: "LAST_AUTH_METHOD"`:** Cannot delete — this is the user's only authentication method (no password set, no other passkeys)
- **Error `401`:** Not authenticated
- **Error `404`:** Passkey not found or does not belong to the current user
- **Error `429`:** Rate limited

**Audit log:** `PASSKEY_DELETED` — records `credentialId` and `credentialName`

---

### Safari / iOS Compatibility Notes

Assigns a client (user) to a specific staff member. Creates or reactivates a `StaffClientAssignment` row, then fires a real-time `client_assigned` notification to the target staff member.

**Authentication:** Super Admin session (httpOnly cookie).  
**Authorization:** `role === 'super_admin'` required.  
**CSRF:** `X-CSRF-Token` header required (double-submit pattern).  
**Rate limit key:** `superadmin-staff-assign-client` — 30 req / 60 s per actor.


#### Request Body (JSON)

```json
{
  "client_id": 42,
  "staff_id": 3,
  "force_reassign": false
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `client_id` | integer | Yes | User ID of the client to assign |
| `staff_id` | integer | Yes | User ID of the target staff member |
| `force_reassign` | boolean | No (default: `false`) | When `true`, deactivates any existing assignment to a different staff member and creates the new one |

#### Successful Response — `201 Created`

```json
{
  "success": true,
  "data": {
    "assignment_id": 17,
    "client_id": 42,
    "staff_id": 3,
    "client_name": "Juan dela Cruz",
    "client_email": "juan@example.com",
    "staff_name": "Maria Santos",
    "staff_email": "maria@example.com",
    "assigned_at": "2026-07-02T10:05:00.000Z",
    "message": "Juan dela Cruz has been successfully assigned to Maria Santos."
  },
  "meta": {
    "requestId": "req_xyz789",
    "responseTime": 85,
    "timestamp": "2026-07-02T10:05:00.000Z"
  }
}

```
#### Idempotent Response — `200 OK` (client already assigned to same staff)
```json
{
  "success": true,
  "data": {
    "already_assigned": true,
    "client_id": 42,
    "staff_id": 3,
    "client_name": "Juan dela Cruz",
    "staff_name": "Maria Santos",
    "message": "Juan dela Cruz is already assigned to Maria Santos."
  }
}
```
#### Conflict Response — `409 Conflict` (client assigned to different staff, `force_reassign=false`)
```json
{
  "success": false,
  "error": {
    "code": "CLIENT_ALREADY_ASSIGNED",
    "message": "Juan dela Cruz is already assigned to Pedro Reyes. Use force_reassign=true to reassign.",
    "details": {
      "client_id": 42,
      "client_name": "Juan dela Cruz",
      "current_staff_id": 7,
      "current_staff_name": "Pedro Reyes",
      "requestId": "req_xyz789"
    }
  }
}

```

#### Error Responses

| Status | Code | Description |
|---|---|---|
| 400 | `STAFF_MGMT_16401` | Invalid payload (missing/invalid `client_id` or `staff_id`) |
| 401 | `STAFF_MGMT_16000` | Authentication required |
| 403 | `STAFF_MGMT_16001` | Super Admin access required |
| 403 | `STAFF_MGMT_16002` | Attempting to assign a privileged account as a client |
| 404 | `STAFF_MGMT_16100` | Client user or staff member not found |
| 400 | `STAFF_MGMT_16102` | Target user is not a staff member |
| 409 | `CLIENT_ALREADY_ASSIGNED` | Client is already assigned to a different staff (use `force_reassign=true`) |
| 429 | `STAFF_MGMT_16500` | Rate limit exceeded |
| 500 | `STAFF_MGMT_16501` | Internal error |

#### Real-time Notification

After a successful assignment, a `UserNotification` record of type `client_assigned` is created for the target staff member with:


```json

{
  "event_type": "client_assigned",
  "priority": "high",
  "title": "New client assigned",
  "message": "Super Admin assigned Juan dela Cruz to you.",
  "action_url": "/staff/clients",
  "action_text": "View Clients",
  "metadata": {
    "client_id": "42",
    "client_name": "Juan dela Cruz",
    "client_email": "juan@example.com",
    "assigned_by_id": "1",
    "assigned_by_email": "superadmin@example.com",
    "assignment_id": 17
  }
}
```

The staff portal header polls `GET /api/staff/notifications/unread/count` every 10 seconds. The `client_assigned` event is included in `STAFF_NOTIFICATION_EVENT_TYPES`, so the unread badge increments immediately on the next poll. Opening the notification bell reveals the notification with a direct link to `/staff/clients`.

#### Staff Portal Auto-update

Once assigned:
- **`GET /api/staff/portal/clients`** returns the new client immediately (`StaffMarketingService.getAssignedClients()` queries `StaffClientAssignment WHERE staff_id = X AND is_active = true`).
- **`GET /api/staff/portal/messages`** returns the client as a messaging contact once they have an inquiry assigned to that staff member.
- The staff member's Clients page and Client Messages page both update on the next data fetch (the pages re-fetch on mount and on notification interaction).


---

## Sidebar Promos API

### New Field: `redirect_path` on Promotions

The `Promotion` database model now includes a `redirect_path` field (`VARCHAR 512`, nullable). This field stores the internal path where users are sent when they click a promo slide in the sidebar.

**Migration SQL (apply when DB is accessible):**
```sql
ALTER TABLE Promotion ADD COLUMN redirect_path VARCHAR(512) NULL AFTER description;
```

---

### Public Sidebar Promos Endpoint

#### `GET /api/public/sidebar-promos`

Lightweight public endpoint used by the PortalSidebar to render the promo carousel. Returns only the minimal fields needed to display slides.

- **Authentication:** None (public)
- **Rate limit:** 60 req/min per IP
- **Cache:** `public, s-maxage=60, stale-while-revalidate=30`

**Response Example (200):**
```json
{
  "success": true,
  "data": {
    "slides": [
      {
        "id": "12",
        "name": "Summer Sale",
        "description": "Get 20% off all physical bizcards this summer.",
        "promoImg": "https://res.cloudinary.com/.../summer-promo.jpg",
        "redirectPath": "/user/emarket",
        "promoType": "percentage",
        "discountValue": null,
        "discountPercentage": 20,
        "expiresAt": "2026-08-31T23:59:59.000Z",
        "badge": "20% OFF"
      }
    ],
    "count": 1
  }
}
```

**Badge values by promo type:**

| `promoType` | `badge` format |
|---|---|
| `percentage` | `{n}% OFF` |
| `fixed_amount` / `discount` | `₱{n} OFF` |
| `buy_one_get_one` | `BOGO` |
| `free_shipping` | `FREE SHIPPING` |
| `free_merch` | `FREE MERCH` |

**Error Responses:**

| Status | Condition |
|---|---|
| 429 | Rate limit exceeded |
| 500 | Internal server error |

---

### Updated Superadmin Promo APIs

The following existing endpoints now accept and return `promo_img` and `redirect_path`:

#### `POST /api/superadmin/promos` — Create Promo

**Additional accepted fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `promo_img` | string | No | URL to a promo banner image displayed on the sidebar slide |
| `redirect_path` | string | No | App path/URL where users are redirected when clicking the slide (e.g. `/user/emarket`) |

#### `PUT /api/superadmin/promos/:promoId` — Update Promo

Same additional fields: `promo_img` (string, nullable), `redirect_path` (string, nullable).
---
### New: Toggle Promo Status
#### `PATCH /api/superadmin/promos/:promoId/toggle`
Toggles the `is_active` flag on a promotion. Used by the Promos & Deals management panel.

- **Authentication:** Superadmin session required
- **Rate limit:** `superadmin-promos-write` — 30 req/min

**Request Body:**
```json
{
  "is_active": false
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "promo_id": 12,
    "is_active": false,
    "message": "Promo deactivated successfully"
  },
  "meta": {
    "requestId": "...",
    "responseTime": 18,
    "timestamp": "2026-07-02T10:00:00.000Z"
  }
}
```

**Error Responses:**

| Status | Code | Description |
|---|---|---|
| 400 | `PROMO_UPDATE_FAILED` | Body must include `is_active` (boolean) |
| 404 | `PROMO_NOT_FOUND` | Promo not found |
| 429 | `RATE_LIMIT_EXCEEDED` | Rate limit exceeded |
| 500 | — | Internal error |

---

### Updated Marketplace Promotions Endpoint

#### `GET /api/marketplace/promotions`

Response now includes `promoImg` and `redirectPath` alongside existing fields:

```json
{
  "id": "12",
  "name": "Summer Sale",
  "description": "20% off all physical bizcards.",
  "promoImg": "https://res.cloudinary.com/.../summer-promo.jpg",
  "redirectPath": "/user/emarket",
  "code": "SUMMER20",
  "discountType": "percentage",
  "discountValue": 0,
  "...": "..."
}
```

---

### Superadmin Promos Management Page

A new superadmin page is available at `/superadmin/promos` ("Promos & Deals"). It provides:

- Paginated list of all promotions with status badges, type labels, image thumbnails, redirect path display, and usage counters
- Search and status filter (All / Active / Inactive)
- Create new promo via modal with all fields including `promo_img` and `redirect_path`
- Edit existing promo with same modal pre-filled
- Toggle active/inactive per promo
- Delete promo with confirmation modal

The page is accessible from the superadmin sidebar under the "Promos & Deals" navigation item.

- All session cookies (`session_token`, `refresh_token`, `reauth_state`) use `SameSite=None; Secure` in production (controlled by `COOKIE_SECURE=true` or `NEXT_PUBLIC_APP_URL` starting with `https://`).
- The `csrf-token` cookie uses `SameSite=None; Secure; Partitioned` in production. However, clients **must not** rely on being able to read this cookie via `document.cookie` on Safari — always fetch `GET /api/csrf-token` and use the **response body** token (`csrfToken` field) as the `X-CSRF-Token` header value.
- WebAuthn (`startAuthentication`, `startRegistration`) requires `rpId` to exactly match the hostname returned by `resolveWebAuthnConfig()`. Ensure `NEXT_PUBLIC_APP_URL` is set to the correct HTTPS production URL in `.env`.


---

## Notification System — User Module

This section documents all endpoints related to the real-time notification system in the User module, including preference management, in-app delivery, email delivery, and the SuperAdmin broadcast capability.

---

### Architecture Overview

| Layer | Mechanism | Notes |
|-------|-----------|-------|
| In-app delivery | `UserNotification` DB records | Polled every 30 s from `app/user/layout.tsx` |
| Email delivery | `NotificationEmailQueue` → cron | Processed by `GET /api/cron/process-email-queue` |
| Preference gate | `NotificationPreference.preferences` JSON | Per-event `in_app`, `email`, `digest` flags |
| Master email switch | `NotificationPreference.unsubscribed_at` | `null` = subscribed; date = unsubscribed |
| Real-time update | 30 s polling via `setInterval` in user layout | Fetches `GET /api/notifications/unread/count` |

---

### Notification Preference Keys

Each user has a `NotificationPreference` row. The `preferences` JSON column stores per-event-type objects:

```json
{
  "profile_view":   { "in_app": true,  "email": false, "digest": true,  "priority": "medium" },
  "inquiry_sent":   { "in_app": true,  "email": true,  "digest": false, "priority": "high"   },
  "system_update":  { "in_app": true,  "email": true,  "digest": false, "priority": "medium" },
  "promotional":    { "in_app": false, "email": false, "digest": false, "priority": "low"    }
}
```

The Settings page in the User module maps these keys as follows:

| Settings toggle | Preference key(s) | Channel |
|----------------|-------------------|---------|
| Email Notifications (master) | `email_notifications_enabled` / `unsubscribed_at` | Email master switch |
| QR Scan Alerts | `profile_view` | In-app + email (if master on) |
| Inquiry Alerts | `inquiry_sent` | In-app + email (if master on) |
| System Updates | `system_update` | In-app + email (if master on) |
| Promotional Emails | `promotional` | Email only |

---

### `GET /api/user/notifications/preferences`

Retrieve the authenticated user's full notification preferences.

- **Auth:** Required (session cookie)
- **Rate limit:** `general` — 60 req/min per IP

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "user_id": "12345",
    "email": "user@example.com",
    "email_verified": true,
    "digest_schedule": "daily",
    "digest_time": "08:00",
    "timezone": "Asia/Manila",
    "quiet_hours": {
      "enabled": false,
      "start": "22:00",
      "end": "08:00"
    },
    "preferences": {
      "profile_view":  { "in_app": true,  "email": false, "digest": true,  "priority": "medium" },
      "inquiry_sent":  { "in_app": true,  "email": true,  "digest": false, "priority": "high"   },
      "system_update": { "in_app": true,  "email": true,  "digest": false, "priority": "medium" },
      "promotional":   { "in_app": false, "email": false, "digest": false, "priority": "low"    }
    },
    "unsubscribed_at": null,
    "email_notifications_enabled": true,
    "email_frequency": {
      "max_per_day": 10,
      "remaining_today": 8,
      "reset_time": "2026-07-04T00:00:00.000Z"
    }
  }
}
```

---

### `PUT /api/user/notifications/preferences`

Update notification preferences. Supports partial merge — only the fields you send are changed.

- **Auth:** Required (session cookie)
- **Rate limit:** `general` — 60 req/min per IP

**Request body (all fields optional):**

```json
{
  "email_notifications_enabled": true,
  "preferences": {
    "profile_view":  { "in_app": true, "email": false },
    "inquiry_sent":  { "in_app": true, "email": true  },
    "system_update": { "in_app": true, "email": true  },
    "promotional":   { "email": true                  }
  },
  "digest_schedule": "daily",
  "digest_time": "08:00",
  "timezone": "Asia/Manila",
  "quiet_hours": { "enabled": false, "start": "22:00", "end": "08:00" }
}
```

Setting `email_notifications_enabled: false` sets `unsubscribed_at` to the current timestamp (master email off).  
Setting `email_notifications_enabled: true` clears `unsubscribed_at` (master email on).

**Response `200`:**

```json
{
  "success": true,
  "message": "Notification preferences updated",
  "data": {
    "updated_fields": ["email_notifications_enabled", "preferences.profile_view", "preferences.inquiry_sent"],
    "email_notifications_enabled": true,
    "unsubscribed_at": null
  }
}
```

**Validation errors `422`:**

| Condition | Error message |
|-----------|---------------|
| Invalid `digest_schedule` | `"Invalid digest_schedule."` |
| Invalid time format | `"Invalid digest_time. Use HH:MM."` |
| Invalid IANA timezone | `"Invalid timezone."` |
| Invalid `quiet_hours.start` | `"Invalid quiet_hours.start."` |

---

### `GET /api/notifications`

Retrieve the authenticated user's in-app notifications.

- **Auth:** Required
- **Query params:** `limit` (1–100, default 10), `page` (default 1)

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "notifications": [
      {
        "id": "notif_abc123",
        "user_id": "12345",
        "event_type": "inquiry_sent",
        "priority": "high",
        "title": "New inquiry",
        "message": "You received a new message inquiry",
        "metadata": { "sender_name": "Jane Doe", "subject": "Partnership opportunity" },
        "action_url": "/dashboard/inquiries",
        "action_text": "Open Inquiry",
        "is_read": false,
        "read_at": null,
        "created_at": "2026-07-04T10:30:00.000Z"
      }
    ]
  }
}
```

---

### `GET /api/notifications/unread/count`

Returns the count of unread notifications for the badge in the notification bell.

- **Auth:** Required
- **Polling interval:** The user layout polls this endpoint every **30 seconds**

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "unreadCount": 3,
    "highPriorityCount": 1
  }
}
```

---

### `PATCH /api/notifications/:id/read`

Mark a single notification as read.

- **Auth:** Required

**Response `200`:**

```json
{ "success": true }
```

**Response `404`:** Notification not found or does not belong to the authenticated user.

---

### `POST /api/notifications/mark-all-read`

Mark all of the authenticated user's unread notifications as read.

- **Auth:** Required

**Response `200`:**

```json
{ "success": true }
```

---

### `POST /api/notifications/event` *(Internal)*

Internal-only endpoint for creating notifications from server-side events. Requires the `x-internal-notification-token` header matching `NOTIFICATION_INTERNAL_TOKEN` env var.

- **Auth:** Internal token only (not user session)
- **Rate limit:** `notification-event`

**Request body:**

```json
{
  "target_user_id": "12345",
  "trigger_user_id": "67890",
  "event_type": "profile_view",
  "priority": "medium",
  "metadata": { "viewer_name": "A registered visitor", "location": "Manila, PH" },
  "needs_email": false,
  "email_priority": "batch"
}
```

Respects the target user's `NotificationPreference` before creating any records.

---

### Notification Event Types

| Event type | Triggered by | Default channels |
|------------|-------------|------------------|
| `profile_view` | `POST /api/portfolio/:uri/view` | In-app |
| `inquiry_sent` | `POST /api/portfolio/:uri/inquire` | In-app + Email |
| `system_update` | SuperAdmin broadcast | In-app + Email |
| `promotional` | Newsletter campaign send | Email only |
| `achievement` | Company top-performer cron | In-app |
| `friend_request_sent` | Connection request | In-app + Email |
| `contact_download` | vCard/contact save | In-app + Email |
| `support_message_received` | Support messenger | In-app + Email |

---

### Notification Delivery Flow

```
Event occurs (QR scan / inquiry / system update)
        │
        ▼
createNotificationFromEvent()   ← server/lib/notifications.ts
        │
        ├── Check NotificationPreference.preferences[eventType].in_app
        │       └── true → create UserNotification record
        │
        ├── Check unsubscribed_at + email_verified + preferences[eventType].email
        │       └── all true → create NotificationEmailQueue record
        │
        └── clearNotificationCachePrefix()  (invalidates unread count cache)

                        (async — 30 s later)
                                │
                                ▼
               GET /api/notifications/unread/count
                   (polled by user layout)
                                │
                                ▼
              Badge updates in notification bell UI

                        (cron: /api/cron/process-email-queue)
                                │
                                ▼
              renderNotificationTemplate() → sendEmailMessage()
```

---

### `POST /api/superadmin/system/broadcast-notification` *(SuperAdmin)*

Broadcast a `system_update` notification to **all active users** who have System Updates enabled in their notification preferences.

- **Auth:** Required — `super_admin` role
- **Rate limit:** Standard superadmin middleware

**Delivery rules:**
- In-app notification created immediately for users with `system_update.in_app: true`
- Email queued for users with `system_update.email: true` **and** `unsubscribed_at IS NULL` **and** `email_verified: true`
- Users with System Updates disabled in preferences are silently skipped
- Processes in cursor-paginated batches of 100 to avoid memory pressure on large user bases

**Request body:**

```json
{
  "title": "New feature: QR Code regeneration is now available",
  "message": "You can now regenerate your BizCard QR code from the BizCard editor. Head to your BizCard list to try it out.",
  "action_url": "/user/bizcard-list"
}
```

| Field | Required | Max length | Notes |
|-------|----------|-----------|-------|
| `title` | Yes | 200 chars | Shown as notification title and email subject |
| `message` | Yes | 1000 chars | Notification body / email content |
| `action_url` | No | 512 chars | Deep-link shown as "View Update". Defaults to `/dashboard` |

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "total_users_scanned": 1842,
    "in_app_delivered": 1654,
    "email_queued": 1201,
    "skipped": 188,
    "response_time_ms": 4320
  },
  "meta": {
    "requestId": "req_abc123",
    "timestamp": "2026-07-04T12:00:00.000Z"
  }
}
```

| Field | Description |
|-------|-------------|
| `total_users_scanned` | All active non-superadmin users checked |
| `in_app_delivered` | Users who received an in-app `UserNotification` |
| `email_queued` | Users whose emails were queued in `NotificationEmailQueue` |
| `skipped` | Users skipped due to preferences or DB errors |
| `response_time_ms` | Total processing time in milliseconds |

**Error responses:**

| Status | Condition |
|--------|-----------|
| `401` | Not authenticated |
| `403` | Role is not `super_admin` |
| `422` | `title` or `message` missing / empty |

**Error tags:** `[BROADCAST_NOTIFICATION_API]`

**SuperAdmin UI:** Available in the SuperAdmin Settings page under the **Broadcast** tab (`/superadmin/settings` → Broadcast tab → `BroadcastNotificationPanel`).

---

### Settings Page — Notification Toggles (User Module)

Located in `app/components/Settings.tsx`, the **Notifications** section within the Account tab.

**Per-toggle auto-save behavior (implemented):**

Each toggle fires an immediate `PUT /api/user/notifications/preferences` request on change. Changes are debounced 350 ms to coalesce rapid successive toggles into a single API call. A "Saving…" indicator appears in the Notifications section header while the request is in-flight. The preference takes effect on the server immediately — no page refresh required.

| Toggle | Key sent to API | Immediate effect |
|--------|----------------|-----------------|
| Email notifications (master) | `email_notifications_enabled` | Enables/disables all email delivery |
| QR Scan Alerts | `preferences.profile_view` | Enables/disables in-app + email for portfolio views |
| Inquiry Alerts | `preferences.inquiry_sent` | Enables/disables in-app + email for new inquiries |
| Promotional Emails | `preferences.promotional` | Enables/disables promotional campaign emails |
| System Updates | `preferences.system_update` | Enables/disables in-app + email for platform updates |

The **Save Changes** button still handles profile field and password updates. Notification preferences saved via per-toggle auto-save are already committed to the DB before Save Changes is clicked — the button skips notifications if `notificationsDirty` is already false.

---

### Newsletter / Promotional Email Campaigns

Promotional emails are sent only to users who have `preferences.promotional.email: true` AND `unsubscribed_at IS NULL`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/superadmin/newsletter/campaigns` | SuperAdmin | List all marketing campaigns |
| `POST` | `/api/superadmin/newsletter/campaigns` | SuperAdmin | Create a new draft campaign |
| `GET` | `/api/superadmin/newsletter/campaigns/:id` | SuperAdmin | Get campaign detail |
| `PUT` | `/api/superadmin/newsletter/campaigns/:id` | SuperAdmin | Update draft campaign |
| `DELETE` | `/api/superadmin/newsletter/campaigns/:id` | SuperAdmin | Delete campaign |
| `POST` | `/api/superadmin/newsletter/campaigns/:id/send` | SuperAdmin | Send or queue campaign immediately |
| `GET` | `/api/superadmin/newsletter/subscribers` | SuperAdmin | List opted-in subscribers |

Campaign send flow:
1. `resolveAudienceUserIds()` filters users by audience segment and checks `promotional.email === true`
2. Creates `NotificationEmailQueue` rows with `template_name: "marketing_campaign"`
3. Sets campaign `status` to `"queued"` and records `recipient_count`
4. `GET /api/cron/process-email-queue` processes the queue and sends via SMTP/Resend

Audience segments: `basic`, `standard`, `premium`, `company_admins`, `free_trial`, `custom`

---

### Email Queue Processing Cron

`GET /api/cron/process-email-queue`

- **Auth:** `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret` header
- **Batch size:** Configurable via `EMAIL_QUEUE_BATCH_SIZE` (default 100, max 100)
- **Daily limit:** `EMAIL_DAILY_LIMIT_PER_USER` per user (default 10)
- Processes `NotificationEmailQueue` rows with `status: "queued"`, ordered by `priority DESC, created_at ASC`
- Renders template via `renderNotificationTemplate(templateName, templateData)`
- Sends via `sendEmailMessage()` (SMTP/Nodemailer)
- Updates delivery status in `NotificationDelivery` and increments `emails_sent_today` counter

**Response:**

```json
{
  "success": true,
  "processed": 87,
  "sent": 82,
  "failed": 3,
  "deferred": 2
}
```

---

## Authentication Graceful Handling for Signup Flows

The following APIs have been updated to gracefully handle unauthenticated requests during signup and bizcard setup flows (when users haven't yet verified their email):

### `/api/media/sign` — Cover Upload During Signup

**Authentication:** 
- **Authenticated requests:** Requires valid session cookie
- **Unauthenticated requests:** Allowed **only** when `context: "cover"` (signup bizcard cover upload)
- **Other contexts** (profile, service, portfolio): Still require authentication

**Behavior:**
- Unauthenticated cover uploads use `userId=0` as a placeholder identifier
- The signed upload works normally with Cloudinary
- Once user completes signup/verification, uploads are associated with their actual user ID
- Service ownership checks are skipped for signup flow uploads

### `/api/notifications/unread/count` — Notification Badge During Signup

**Authentication:** 
- Returns `200 OK` with `{ success: true, data: { unreadCount: 0, highPriorityCount: 0 } }` when unauthenticated
- Previously: Returned `401 Unauthorized`

**Impact:**
- Layout/header can safely poll this endpoint during signup without displaying errors
- Badge shows zero during signup flow (expected behavior)

### `/api/support/unread/count` — Support Badge During Signup  

**Authentication:**
- Returns `200 OK` with `{ success: true, data: { count: 0 } }` when unauthenticated
- Previously: Threw `401 Unauthorized` error

**Impact:**
- Layout can safely poll support unread count during signup
- Badge shows zero during signup flow (expected behavior)

### `GET /api/user/profile` — Profile Fetch During Signup

**Authentication:**
- Returns `200 OK` with empty profile data when unauthenticated:
  ```json
  {
    "success": true,
    "data": {
      "user_id": null,
      "first_name": null,
      "last_name": null,
      "email": null,
      "alternative_email": null,
      "phone_number": null,
      "profile_image": null,
      "email_verified": false,
      "phone_verified": false,
      "member_since": null,
      "last_login": null
    }
  }
  ```
- Previously: Returned `401 Unauthorized`
- `PUT /api/user/profile` still requires authentication (mutations must be protected)

**Impact:**
- Layout can safely fetch profile to hydrate user name during signup
- Will display empty name until user logs in after verification

### Why These Changes?

The signup flow (`/user/signup`) is on the excluded auth pages list. During this flow:
1. User hasn't verified their email yet
2. User doesn't have a valid session cookie
3. Layout components attempt to fetch user data, notifications, and media signing
4. Previously, these requests returned `401` errors cluttering the browser console
5. Now, they gracefully return sensible defaults or empty data

This allows the signup UX to progress smoothly without authentication errors.


---

## SuperAdmin Notification Bell System

### Overview

The SuperAdmin notification bell is a polling-based in-app notification feed for the Super Admin portal. It stores notifications in the existing `UserNotification` table and polls every 10 seconds from the `PortalHeader` component.

Four preference-driven notification types are supported under the **User Activity** tab of Notification Preferences:

| Toggle | Preference Key | Trigger |
|--------|---------------|---------|
| New User Registration | `user_activity.new_registration` | `POST /api/vcard/setup` (first time `VCardSetup.setup_completed` becomes true) |
| User Report Summary | `user_activity.user_report_frequency` | `GET /api/cron/superadmin-user-report` |
| Inactive Users | `user_activity.inactive_users` | `GET /api/cron/superadmin-inactive-users` |
| Company Creation Requests | `user_activity.company_requests` | `POST /api/company/create` |

Preferences are stored via the existing `PUT /api/superadmin/settings/notifications` endpoint.

---

### GET /api/superadmin/notifications

Returns in-app notifications for the authenticated superadmin. Used by the notification bell via 10-second polling.

**Authentication:** Required (`super_admin` role)

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | `20` | Max records (1–50) |
| `unread` | `"true"` | — | If set, returns only unread notifications |

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "unread_count": 3,
    "notifications": [
      {
        "id": "sanotif_a1b2c3d4",
        "event_type": "sa_new_user_registration",
        "priority": "medium",
        "title": "New User Registered",
        "message": "Jane Doe (Individual) just created an account.",
        "metadata": {
          "new_user_id": "42",
          "full_name": "Jane Doe",
          "email": "jane@example.com",
          "registration_type": "individual"
        },
        "action_url": "/superadmin/client-list",
        "action_text": "View Users",
        "is_read": false,
        "created_at": "2026-07-10T08:00:00.000Z"
      }
    ]
  },
  "meta": { "requestId": "req_xxx", "responseTime": 12, "timestamp": "2026-07-10T08:00:00.000Z" }
}
```

**Error Tags:** `[SA_NOTIFICATIONS_READ]`

---

### PATCH /api/superadmin/notifications/[id]/read

Marks a single notification as read. Scoped to the authenticated superadmin.

**Authentication:** Required (`super_admin` role)

**Path Parameter:** `id` — notification string ID

**Success Response (200):**

```json
{
  "success": true,
  "data": { "id": "sanotif_a1b2c3d4", "is_read": true },
  "meta": { "requestId": "...", "responseTime": 8, "timestamp": "..." }
}
```

**Error Responses:**

| Status | Code | Reason |
|--------|------|--------|
| 400 | — | `id` parameter missing |
| 401 | `UNAUTHORIZED_ACCESS` | Not authenticated |
| 403 | `SUPERADMIN_REQUIRED` | Insufficient role |
| 404 | — | Notification not found or belongs to another user |

---

### POST /api/superadmin/notifications/mark-all-read

Marks all unread notifications for the authenticated superadmin as read.

**Authentication:** Required (`super_admin` role)

**Success Response (200):**

```json
{
  "success": true,
  "data": { "updated_count": 5 },
  "meta": { "requestId": "...", "responseTime": 14, "timestamp": "..." }
}
```

---

### GET /api/cron/superadmin-user-report

Cron endpoint: generates User Report Summary notifications for superadmins with `user_report_frequency` configured.

**Authentication:** `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret` header

**Scheduling Recommendation:**

| Frequency | Cron Schedule |
|-----------|--------------|
| `daily` | `0 8 * * *` |
| `weekly` | `0 8 * * 1` |
| `semi_monthly` | `0 8 1,15 * *` |
| `monthly` | `0 8 1 * *` |

The cron job may be called on any of these schedules — it will deliver a report to each superadmin based on their personal frequency setting.

**Success Response (200):**

```json
{
  "success": true,
  "notified": 1,
  "tag": "[CRON_SA_USER_REPORT]"
}
```

**Notification Message Format:**

```
User Report Summary (This Week): 10 new registrations, 234 active users, 12 inactive users. Total: 246 users.
```

**Look-back Windows by Frequency:**

| Frequency | Look-back |
|-----------|-----------|
| `daily` | Last 24 hours |
| `weekly` | Last 7 days |
| `semi_monthly` | Last 14 days |
| `monthly` | Last 30 days |

---

### GET /api/cron/superadmin-inactive-users

Cron endpoint: detects inactive users and notifies superadmins with `inactive_users: true` preference.

**Authentication:** `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret` header

**Scheduling Recommendation:** `0 9 * * *` (daily at 09:00)

**Inactivity Definition:**
- `is_active: false` (deactivated accounts), OR
- `is_active: true` with `last_active < 30 days ago` (dormant accounts)

Superadmin role users are excluded from the count.

**Success Response (200):**

```json
{
  "success": true,
  "notified": 1,
  "total_inactive": 15,
  "tag": "[CRON_SA_INACTIVE_USERS]"
}
```

**Notification Message Format:**

```
Inactive Users Alert: 15 inactive users detected — 3 deactivated, 12 dormant (no activity in 30+ days). Review and consider outreach or cleanup.
```

**No-op Response (when no inactive users found):**

```json
{
  "success": true,
  "notified": 0,
  "reason": "no_inactive_users",
  "tag": "[CRON_SA_INACTIVE_USERS]"
}
```

---

## SuperAdmin Notification Event Types

Custom event types used exclusively for superadmin bell notifications (stored in `UserNotification.event_type`):

| Event Type | Description |
|-----------|-------------|
| `sa_new_user_registration` | A new user completed vCard setup (`VCardSetup.setup_completed`) |
| `sa_user_report_summary` | Periodic user activity metrics summary |
| `sa_inactive_users` | Inactive user detection alert |
| `sa_company_creation_request` | A user submitted a company creation request (includes inline Approve/Reject UI) |
| `sa_company_request_approved` | A company request was approved |
| `sa_company_request_rejected` | A company request was rejected |

### Company Creation Notification Metadata

The `sa_company_creation_request` notification carries the following `metadata` fields that the frontend uses to render inline approve/reject buttons:

```json
{
  "company_id": "123",
  "company_name": "Acme Corp",
  "requesting_user_id": "42",
  "requesting_user_name": "John Smith",
  "request_id": "123",
  "requires_action": true
}
```

When `requires_action: true`, the PortalHeader renders Approve and Reject buttons inside the notification item. Clicking either button calls `POST /api/superadmin/company-requests/:id/approve` with `{ action: "approve" | "reject" }`, then marks the notification read and removes the action buttons.

---

## Implementation Notes

### Preference Storage

All four toggles are stored in the existing `NotificationPreference.preferences` JSON blob under:

```json
{
  "superadmin_settings": {
    "user_activity": {
      "new_registration": true,
      "user_report_frequency": "weekly",
      "inactive_users": true,
      "company_requests": true
    }
  }
}
```

These are read/written by `SuperadminSettingsService.getNotificationPreferences()` / `updateNotificationPreferences()` via `PUT /api/superadmin/settings/notifications`.

### Real-time Delivery

The system uses polling (no WebSocket/SSE). `PortalHeader.tsx` polls `GET /api/superadmin/notifications?limit=20` every **10 seconds**. The unread badge updates on every poll cycle.

### Non-blocking Fire-and-forget Pattern

Notification creation after user registration and company creation is wrapped with `void` (fire-and-forget). Registration and company creation flows are **never blocked** by notification failures.

### Security

- All bell API routes use `withDashboardSuperAdmin` middleware (requires `super_admin` role).
- Notifications are scoped to `user_id = authenticated superadmin` — cross-user reads are impossible.
- Cron endpoints require `Authorization: Bearer <CRON_SECRET>` (timing-safe comparison).
- Company approve/reject inline action reuses the existing `POST /api/superadmin/company-requests/:id/approve` endpoint — no new approval logic was introduced.


---

## Onboarding Tutorial — Account and Physical BizCard Scan Flow

The root onboarding tutorial is a seven-slide, client-rendered experience.
Normal first-time visitors see it before signup. A scan of a blank physical
BizCard also opens the tutorial, including for an authenticated user or a
browser that has already completed the regular tutorial.

### Physical-card scan routing

Physical BizCard QR codes open `/{SERIAL_ID}`. The portfolio route checks the
card; if its status is `blank`, it redirects to `/?scan={SERIAL_ID}` instead
of sending the visitor directly to signup or registration. A linked card
continues to its portfolio as before.

The tutorial keeps the serial in the URL, then checks the live card/account
state again when the user finishes. It uses the existing session-aware
`GET /api/bizcard/scan/{serialId}` flow:

| State after Finish | Destination |
|---|---|
| No active account (`signup`) | `/user/signup?ref={SERIAL}` to create an account and claim the card |
| Signed in, no eligible virtual BizCard (`manual_register`) | `/user/bizcard/create-new?serial={SERIAL}` to register this physical card |
| Signed in, at least one eligible virtual BizCard (`merge_choice`) | `/scan/{SERIAL}/merge` to select a card and confirm the merge |
| Card is already linked (`show_portfolio`) | The linked public portfolio |

The merge page lets the user link the physical serial to an eligible virtual
BizCard. Choosing “Create a separate BizCard” instead opens the physical-card
registration form. Eligible virtual BizCards are checked before falling back
to separate registration.

The scan tutorial takes precedence over the ordinary tutorial-seen flag and
over the root page's usual active-session dashboard redirect. Thus a blank
card scan always gets the explanation first. The serial is validated using
the existing claim-URL helper; routing is decided from the live scan response,
not stale browser state. If the scan cannot be rechecked, the tutorial shows
an error and allows retry rather than guessing a destination.

### Regular root visit

`GET /api/auth/session` continues to route authenticated users to their role
dashboard. A guest with a safe deep-link redirect goes to login. Other guests
see the tutorial unless `ontap:tutorial:seen` is already `"true"`, in which
case the login form is shown. Finishing the regular tutorial opens
`/user/signup`; skipping opens the root login view.

### Tutorial slides and controls

| Slide | Topic |
|---|---|
| 1 | OnTap introduction and QR/NFC sharing |
| 2 | Account creation |
| 3 | Email verification |
| 4 | Building a BizCard |
| 5 | Dashboard features |
| 6 | Physical BizCard scan: create an account, register a card, or merge |
| 7 | Finish and continue to the appropriate next step |

The tutorial uses animated transitions, progress indicators, and inline
illustrations. On the physical-card slide, a branching card-scan illustration
and labels show the three possible user paths. The former “Start Creating
Your Account” button is removed; Finish is the only completion action and is
available on the final slide on mobile and desktop. Skip remains available
for the regular tutorial and is hidden in scan mode so the card flow reaches
its conditional destination.


---

### Security Notes

- The tutorial is **purely client-rendered** — it exposes no new API surface.
- The `ontap:tutorial:seen` flag is write-only after the first visit; it is never sent to the server.
- The `GET /api/auth/session` call is the same endpoint used by all user/admin layouts — no new auth surface.
- All existing security headers (`X-Frame-Options: DENY`, CSP, HSTS) remain in effect.
- No user PII is read or written by the tutorial flow.


---

## SuperAdmin Notifications API

All notification endpoints for the Super Admin panel are under:

```
/api/superadmin/notifications/*
```

### Role Requirements

All endpoints require the `super_admin` role enforced by `withDashboardSuperAdmin` middleware.

### How Notifications Work

Notifications use the existing `UserNotification` database model (no new table). The service layer (`lib/services/superadmin-notifications.service.ts`) fans out a separate `UserNotification` row for **every active super_admin user** each time a notifiable event occurs. This means every superadmin account receives and owns its own copy of each notification, allowing independent read/unread state per account.

**Broadcast functions (called from event sources):**
- `notifySuperadminsNewUserRegistration` — called from `POST /api/vcard/setup` after the first successful setup completion (`VCardSetup.setup_completed`). Email verification does not trigger this.
- `notifySuperadminsCompanyCreation` — called from `POST /api/company/create` after a company request is submitted
- `notifySuperadminsCompanyDecision` — called from the company approval/rejection endpoint

### Registration Account Mode (Subscription Tier Display)

For `sa_new_user_registration` events, the subscription display label is stored in `metadata.account_mode` and embedded in `message` (e.g. `Jane Doe (Premium) just created an account.`).

**Resolution order** (paid Bizcard tier wins over an overlapping free trial — required for Premium QR merges):

1. Highest **active paid** Bizcard tier (`subscription_status: "active"`, unexpired, `serial_id` present) → `Basic` | `Standard` | `Premium`
2. Else active User free trial (`is_trial_used` + `trial_end` in the future) → `Free Trial`
3. Else → `Basic`

`notifySuperadminsNewUserRegistration` always resolves this from live user/subscription data at notification time (caller-supplied labels are ignored).

`GET /api/superadmin/notifications` **enriches** `message` and `metadata.account_mode` for registration events from the same live resolution on every poll. Stored `UserNotification` rows are **not** mutated, so after a QR merge or subscription upgrade the bell shows the current correct tier (e.g. `Premium`) without rewriting historical DB records.

### Notification Preference Defaults (Bug Fix — July 2026)

**Previous behaviour (defective):** `getSuperadminUserActivityPrefs` returned `{ new_registration: false, company_requests: false }` when no preference row existed. Any superadmin account that had never saved notification settings silently received no notifications, which caused the symptom of "only one superadmin receives notifications."

**Fixed behaviour:** Defaults are now `{ new_registration: true, company_requests: true }`. Every active superadmin receives `new_registration` and `company_requests` notifications out-of-the-box. A superadmin can explicitly opt out via `PUT /api/superadmin/settings/notifications`. Existing saved preferences are honoured unchanged.

### Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| `GET /api/superadmin/notifications` | 60 | 1 minute |
| `PATCH /api/superadmin/notifications/:id/read` | 120 | 1 minute |
| `POST /api/superadmin/notifications/mark-all-read` | 30 | 1 minute |

### Endpoints

#### `GET /api/superadmin/notifications`

Returns in-app notifications for the authenticated superadmin. Polled every 10 seconds by `PortalHeader`.

For `sa_new_user_registration` rows, the response enriches `message` and `metadata.account_mode` from the registered user's current subscription / trial status (see **Registration Account Mode** above).

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | `20` | Number of records to return (min 1, max 50) |
| `unread` | `"true"` | — | When present, returns only unread notifications |

**Response:**

```json
{
  "success": true,
  "data": {
    "notifications": [
      {
        "id": "sanotif_a1b2c3d4e5f6",
        "event_type": "sa_new_user_registration",
        "priority": "medium",
        "title": "New User Registered",
        "message": "Jane Doe (Premium) just created an account.",
        "metadata": {
          "new_user_id": "1042",
          "full_name": "Jane Doe",
          "email": "jane@example.com",
          "registration_type": "individual",
          "account_mode": "Premium"
        },
        "action_url": "/superadmin/client-list?viewUserId=1042",
        "action_text": "View Profile",
        "is_read": false,
        "created_at": "2026-07-19T08:00:00.000Z"
      }
    ],
    "unread_count": 3
  },
  "meta": {
    "requestId": "req_abc123",
    "responseTime": 12,
    "timestamp": "2026-07-19T08:00:01.000Z"
  }
}
```

**Event Types:**

| `event_type` | Trigger | Priority |
|---|---|---|
| `sa_new_user_registration` | New user completes vCard setup (`VCardSetup.setup_completed`) | `medium` |
| `sa_company_creation_request` | User submits a company application | `high` |
| `sa_company_request_approved` | A company request is approved | `medium` |
| `sa_company_request_rejected` | A company request is rejected | `medium` |

**Company Creation Notifications** carry inline action metadata:

```json
{
  "metadata": {
    "company_id": "42",
    "company_name": "Acme Corp",
    "requesting_user_id": "17",
    "requesting_user_name": "John Smith",
    "request_id": "42",
    "requires_action": true
  }
}
```

When `requires_action: true`, `PortalHeader` renders inline **Approve** / **Reject** buttons inside the notification item.

---

#### `PATCH /api/superadmin/notifications/:id/read`

Marks a single notification as read. Scoped to the authenticated superadmin — cannot mark another user's notification.

**URL Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Notification ID (e.g. `sanotif_a1b2c3d4e5f6`) |

**Response:**

```json
{
  "success": true,
  "data": { "id": "sanotif_a1b2c3d4e5f6", "is_read": true },
  "meta": { "requestId": "...", "responseTime": 5, "timestamp": "..." }
}
```

**Error Responses:**

| HTTP | Condition |
|------|-----------|
| `400` | Missing or empty notification ID |
| `404` | Notification not found or belongs to a different superadmin |

---

#### `POST /api/superadmin/notifications/mark-all-read`

Marks all unread notifications for the authenticated superadmin as read.

**Request Body:** none

**Response:**

```json
{
  "success": true,
  "data": { "updated_count": 5 },
  "meta": { "requestId": "...", "responseTime": 8, "timestamp": "..." }
}
```

---

## SuperAdmin BizCard Management API

All blank-card management endpoints are under:

```
/api/superadmin/bizcard/*
```

### Role Requirements

All endpoints require the `super_admin` role enforced by `withSuperAdmin` middleware.

### Card Status Definitions

| Status | Condition |
|--------|-----------|
| `Unclaimed` | Blank stock (`is_blank: true`) with `user_id IS NULL` and `manually_distributed_at IS NULL` — card is in the Available pool |
| `Assigned` | Blank stock with `user_id IS NULL` and `manually_distributed_at IS NOT NULL` — superadmin has physically handed out the card but user has not registered yet |
| `Claimed` | Merged physical claim (`is_merged: true` with `serial_id`) **or** `user_id IS NOT NULL` — user registered via QR and merge completed |

### Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| `POST /api/superadmin/bizcard/generate` | 20 | 1 minute |
| `GET /api/superadmin/bizcard/download` | 30 | 1 minute |
| `GET /api/superadmin/bizcard/:serialId` | 120 | 1 minute |
| `PATCH /api/superadmin/bizcard/:serialId` | 60 | 1 minute |
| `DELETE /api/superadmin/bizcard/:serialId` | 300 | 1 minute |
| `PUT /api/superadmin/bizcard/:serialId/mark-distributed` | 30 | 1 minute |
| `PUT /api/superadmin/bizcard/mark-distributed-all` | 5 | 1 minute |

### Endpoints

#### `POST /api/superadmin/bizcard/generate`

Generates blank physical bizcards with unique serial IDs and enqueues QR code generation.

**Request Body:**

```json
{
  "count": 10,
  "subscription_tier": "basic"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `count` | integer | yes | Number of cards to generate (1–10,000) |
| `subscription_tier` | string | yes | `basic`, `standard`, or `premium` |

**Response `201`:**

```json
{
  "success": true,
  "data": {
    "count": 10,
    "cards": [
      {
        "id": "1001",
        "serialId": "AB3X7Q",
        "qrCodeUrl": null,
        "portfolioUrl": "https://app.ontap.ph/AB3X7Q",
        "bizcard_style": "polyvinyl",
        "subscriptionTier": "basic"
      }
    ]
  }
}
```

`qrCodeUrl` is `null` immediately after generation and is populated asynchronously by the QR generation queue.

---

#### `GET /api/superadmin/bizcard/download`

Exports physical BizCard inventory as a CSV file (blank stock **and** merged claimed serials). Also used internally by `BizcardManagement` to load all card data on page load.

**Inventory scope**

- `is_blank: true` and `deactivated_flag: false`, or
- `is_merged: true` with non-null `serial_id` and `deactivated_flag: false`

**Status filter semantics**

- `claimed` — `is_merged: true` OR `user_id IS NOT NULL`
- `unclaimed` — blank stock with `user_id IS NULL` and `is_merged: false` (includes Assigned)
- `all` — full inventory scope

**Claimed At** uses `claimed_at`, falling back to `merged_at` for merged rows.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | string | `all` | `all`, `claimed`, or `unclaimed` |
| `tier` | string | `all` | `all`, `basic`, `standard`, or `premium` |
| `from` | ISO date string | — | Filter by `generated_at ≥ from` |
| `to` | ISO date string | — | Filter by `generated_at ≤ to` |

**Response:** `text/csv` file with columns:

```
Bizcard ID, Serial ID, Subscription Tier, Generated At, Status,
Claimed At, Claimed By Email, Claimed By Name, Generated By, Manually Distributed At
```

---

#### `GET /api/superadmin/bizcard/:serialId`

Returns full detail for a single card by serial ID (blank inventory **or** merged claim).

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "bizcard_id": "1001",
    "serial_id": "AB3X7Q",
    "is_blank": true,
    "user_id": null,
    "status": "unclaimed",
    "claimed_at": null,
    "generated_at": "2026-07-19T08:00:00.000Z",
    "portfolio_url": "https://app.ontap.ph/AB3X7Q",
    "qr_code_url": "https://cdn.ontap.ph/qr/AB3X7Q.png",
    "subscription_tier": "basic",
    "user": null
  }
}
```

---

#### `PATCH /api/superadmin/bizcard/:serialId`

Updates the `subscription_tier` of a blank card.

**Request Body:**

```json
{
  "subscription_tier": "premium"
}
```

`portfolio_url` is read-only via this endpoint (derived from the user's URL alias).

---

#### `DELETE /api/superadmin/bizcard/:serialId`

Permanently deletes an unclaimed blank card. Returns `409` if the card has already been claimed by a user.

---

#### `PUT /api/superadmin/bizcard/:serialId/mark-distributed`

Marks a card as physically distributed (`Assigned` status) before the user registers. Sets `manually_distributed_at` and `manually_distributed_by`. Returns `409` if the card has already been claimed by a registered user.

---

#### `PUT /api/superadmin/bizcard/mark-distributed-all`

Atomically marks all available (Unclaimed) blank cards as physically distributed. Runs `findMany` + `updateMany` in a single Prisma transaction. Returns `{ count, serialIds, manuallyDistributedAt, status: "assigned" }`. Error code on failure: `SUPERADMIN_11611`.

---

### Frontend: Download All Available Cards (New — July 2026)

**Location:** `BizcardManagement` component — "Available Cards" panel header

**Trigger:** "Download All Cards" button in the top-right of the Available Cards panel

**Behaviour:**

1. Disabled when no available (Unclaimed) cards exist, or while the card list is loading.
2. Shows a "Preparing ZIP…" loading state with spinner while running.
3. Renders QR PNG images client-side using the `qrcode` npm package (no server round-trip, no new dependencies).
4. Assembles a ZIP file entirely in the browser using an inline STORED-compression ZIP builder (no jszip dependency required).
5. Triggers an immediate browser download named `available-cards-{YYYY-MM-DD}.zip`.

**ZIP contents:**

| File | Description |
|------|-------------|
| `serial-ids.csv` | Serial ID, Portfolio URL, Subscription Tier, Generated At — one row per card |
| `qr-{serialId}.png` | 512 × 512 QR code PNG with serial ID label (white background, 68 px label area below QR) |
| `README.txt` | Export timestamp, total count, content summary |

**Error handling:**

- If `availableCards.length === 0`: shows toast "No available cards to download." and does not proceed.
- If canvas or blob generation fails for a card: that card is skipped; remaining cards are included.
- If the overall process throws: shows toast "Bulk download failed. Please try again."

**Related state:**

| State | Type | Purpose |
|-------|------|---------|
| `isDownloadingAll` | `boolean` | Controls button loading state and disabled flag |

**No API endpoint is involved.** The feature reads from the already-loaded `availableCards` state derived from `GET /api/superadmin/bizcard/download?status=all&tier=all`.

---

### Frontend: Distribute All Cards (New — July 2026)

**Location:** `BizcardManagement` component — "Available Cards" panel header (beside Download All Cards)

**Trigger:** "Distribute All Cards" button → confirmation modal → Confirm

**Behaviour:**

1. Disabled when no available cards exist, while loading, or while a batch distribute is in progress.
2. Confirmation copy: "Are you sure you want to distribute all available cards? This action cannot be undone."
3. On Confirm, calls `PUT /api/superadmin/bizcard/mark-distributed-all`.
4. On success, shows a success toast and refreshes both lists via `loadBizcards(false)` (no full page reload).
5. On failure, shows an error toast; lists remain at last successful load (no optimistic partial moves).

**Related state:**

| State | Type | Purpose |
|-------|------|---------|
| `isDistributeAllOpen` | `boolean` | Controls confirmation modal visibility |
| `isDistributingAll` | `boolean` | Controls busy / preventClose / button loading |

---

### Frontend: Download All Distributed Cards (New — July 2026)

**Location:** `BizcardManagement` component — "Distributed Cards" panel header

**Trigger:** "Download All Distributed Cards" button

**Behaviour:**

1. Disabled when no distributed cards exist, or while the card list is loading.
2. Shows a "Preparing ZIP…" loading state with spinner while running.
3. Reuses the same client-side QR + STORED ZIP helpers as Available Cards download.
4. Triggers an immediate browser download named `distributed-cards-{YYYY-MM-DD}.zip`.

**ZIP contents:**

| File | Description |
|------|-------------|
| `serial-ids.csv` | Serial ID, User Name, Portfolio URL, Subscription Tier, Status, Generated At |
| `qr-{serialId}.png` | 512 × 512 QR code PNG with serial ID label |
| `README.txt` | Export timestamp, total count, content summary |

**User Name column:** uses owner/claimed name when present; for `Assigned` cards without a name, writes `Pending Registration`.

**Related state:**

| State | Type | Purpose |
|-------|------|---------|
| `isDownloadingAllDistributed` | `boolean` | Controls button loading state and disabled flag |

**No API endpoint is involved.** The feature reads from the already-loaded `distributedCards` state (Claimed + Assigned, including local cache merge).
