# OnTap New System — Feature Integration Recommendations

**Document version:** 1.0  
**Date:** September 2, 2026  
**Scope:** `ontapnewsystem` (portal) and related surfaces (`new-ontap-landing-page`, physical NFC/QR cards)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current System Overview](#2-current-system-overview)
3. [System Flow (As-Is)](#3-system-flow-as-is)
4. [Cross-Cutting Architecture](#4-cross-cutting-architecture)
5. [Feature Recommendations](#5-feature-recommendations)
   - [5.1 Membership & Membership Renewals](#51-membership--membership-renewals)
   - [5.2 Attendance at Event Monitoring](#52-attendance-at-event-monitoring)
   - [5.3 Food at Token Claiming](#53-food-at-token-claiming)
   - [5.4 Voting System / Loyalty Card](#54-voting-system--loyalty-card)
   - [5.5 Networking Profiles for Members](#55-networking-profiles-for-members)
   - [5.6 NFC/QR Membership IDs with Free Lifetime Platform Access](#56-nfcqr-membership-ids-with-free-lifetime-platform-access)
6. [Unified Data Model (Proposed)](#6-unified-data-model-proposed)
7. [API Surface (Proposed)](#7-api-surface-proposed)
8. [UI & Portal Integration](#8-ui--portal-integration)
9. [Phased Rollout Plan](#9-phased-rollout-plan)
10. [Risks, Dependencies & Open Questions](#10-risks-dependencies--open-questions)

---

## 1. Executive Summary

`ontapnewsystem` is a mature **BizCard-centric membership platform** with marketplace subscriptions (Xendit), associate networking, affiliate growth missions, calendar RSVP, NFC/QR physical card claiming, and extensive notification/cron infrastructure (~534 API routes, dual Prisma DBs).

| Requested Feature | Current State | Recommendation |
|---|---|---|
| **Membership & renewals** | Partial — BizCard subscription tiers, Xendit recurring, manual renew API, expiry crons | Unify under a `Membership` layer; tie renewals to payment + lifetime cards |
| **Event attendance monitoring** | Partial — RSVP only (`CalendarEventAttendance`) | Extend calendar with on-site QR/NFC check-in + staff scanner |
| **Food token claiming** | Missing | New `EventToken` module linked to events and membership |
| **Voting / loyalty card** | Missing (missions exist for referral growth only) | New `LoyaltyProgram` + `Vote` modules; reuse `Reward` patterns |
| **Member networking profiles** | Partial — BizCard portfolios + `Connection` associates | Add `MemberProfile` layer + directory; keep BizCard as public face |
| **NFC/QR lifetime access IDs** | Partial — serial IDs exist; access expires with subscription | Add `access_type: lifetime` flag on membership-linked cards |

**Strategic approach:** Do not bolt six unrelated products onto BizCard. Introduce a thin **`Membership` domain** that sits above `User` and links to `Bizcard`, `CalendarEvent`, tokens, loyalty, and physical cards. Reuse existing scan routing, notifications, Xendit, and cron patterns.

---

## 2. Current System Overview

### 2.1 Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 App Router, React 19, Tailwind 4 |
| Backend | Next.js Route Handlers (`app/api/**`) |
| Database | MySQL via Prisma 6 (main + analytics DB) |
| Auth | DB sessions, CSRF, WebAuthn, impersonation (superadmin) |
| Payments | Xendit (invoices, subscriptions, webhooks) |
| Email | Nodemailer + `NotificationEmailQueue` |
| Edge | `proxy.ts` — auth guard, CORS, CSP |

### 2.2 Role-Based Portals

| Role | Portal | Primary use |
|---|---|---|
| `user` | `/user/*` | Individual members |
| `company_admin` / `admin` | `/admin/*` | Company admins |
| `staff` | `/staff/*` | Support/marketing with module permissions |
| `super_admin` | `/superadmin/*` | Platform operations |
| `dev` | `/dev/*` | Internal ops/monitoring |

Company RBAC is separate via `CompanyEmployee` (`admin` / `employee`).

### 2.3 Core Domain Models (Relevant)

```
User
 ├── Bizcard (subscription_tier, subscription_status, subscription_expires_at, serial_id)
 │    ├── BizcardSubscription (Xendit recurring)
 │    ├── QRCodeScan, portfolio themes
 │    └── Connection (associates)
 ├── CompanyEmployee → Company
 ├── CalendarEvent → CalendarEventAttendance (RSVP "going")
 ├── Mission → UserReward → Reward (referral growth perks)
 ├── Affiliate, Promotion, SpinHistory (discount vouchers)
 └── EmployeeCard (company NFC, separate from BizCard)
```

### 2.4 Key Existing Services & Files

| Domain | Key paths |
|---|---|
| Subscription access | `lib/services/subscription-access.service.ts` |
| Product subscription | `lib/services/product-subscription.service.ts` |
| Calendar | `lib/services/calendar-event.service.ts`, `app/api/calendar/**` |
| NFC/QR scan | `lib/bizcard/scan-routing.ts`, `app/api/public/scan/[serialId]` |
| Physical cards | `lib/services/physical-card.service.ts`, `lib/services/serialIdService.ts` |
| Growth rewards | `server/lib/growth-referral.ts`, `server/lib/growth-rewards.ts` |
| Payments | `server/lib/xendit.ts`, `app/api/xendit/webhook/route.ts` |
| Notifications | `server/lib/notifications.ts`, `app/api/cron/**` (27 crons) |
| Portal nav | `app/config/portalNavigation.ts` |

---

## 3. System Flow (As-Is)

### 3.1 Member Onboarding & Access

```
Physical NFC/QR tap
    → GET /api/public/scan/[serialId]
    → scan-routing.ts classifies: linked | blank | deactivated
    → blank → signup (/user/signup?ref=SERIAL) or merge (/scan/[serialId]/merge)
    → User created → Bizcard claimed/merged
    → Free trial (30 days) OR product purchase activates subscription
    → subscription-access.service gates premium features & portfolio visibility
```

### 3.2 Subscription & Renewal (Current)

```
Path A — Marketplace recurring:
  Cart → CheckoutSession → Xendit Invoice → Webhook
    → BizcardSubscription activated/renewed

Path B — Product-tied bizcard:
  Merchandise purchase → product-subscription.service.activateBizcardSubscription()
    → Bizcard.subscription_* fields updated

Path C — Manual renew:
  POST /api/bizcard/[bizcardId]/subscription/renew
    → extends expiry +365 days, writes SubscriptionRenewalHistory
    (no payment gate today)

Reminders:
  cron/subscription-expiry → email + in-app at 3/1 days before expiry
```

### 3.3 Networking (Current)

```
User A views User B portfolio → Connect request
    → Connection (pending → accepted), relationship_type: friend | associate
    → DirectConversation messaging between accepted connections
    → No separate "member profile" — identity is BizCard-centric
```

### 3.4 Events (Current)

```
Premium user creates CalendarEvent (private | public | custom | company)
    → Invites via CalendarEventInvite
    → Attendees RSVP via POST .../attend → CalendarEventAttendance status "going"
    → Reminders via cron/calendar-reminders
    → NO on-site check-in, NO tokens, NO voting
```

---

## 4. Cross-Cutting Architecture

### 4.1 Recommended New Domain Layer

Introduce **`Membership`** as the unifying concept for org/event features:

```
Membership
  ├── user_id, org_id (optional Company)
  ├── membership_tier (e.g. basic_member, premium_member, lifetime)
  ├── status (active | expired | suspended | lifetime)
  ├── valid_from, valid_until (null = lifetime)
  ├── source (purchase | event | admin_grant | physical_card)
  ├── linked_bizcard_id, linked_serial_id
  └── renewals → MembershipRenewal
```

**Why:** Today, "membership" is implicit in `Bizcard.subscription_*`. Event tokens, voting eligibility, and lifetime NFC access need a user-level record that survives BizCard changes and supports non-BizCard members.

### 4.2 Reuse Patterns (Do Not Reinvent)

| Pattern | Reuse for |
|---|---|
| `scan-routing.ts` + `serialIdService` | Event check-in QR, membership card tap, food token redemption |
| `NotificationEmailQueue` + event types | Renewal reminders, token issued, vote opened, check-in confirmation |
| `Promotion` + `PromoUsage` | Discounted renewals; adapt for single-use food tokens |
| `Mission` + `UserReward` | Loyalty milestones; extend `requirement_type` |
| `requireCronAuth()` crons | Token expiry, membership expiry, vote close |
| `subscription-access.service` | Extend `AccessReason` with `lifetime_membership` |
| Staff module permissions | Event scanner role, token redemption booth |

### 4.3 Access Control Extension

Extend `AccessStatus` in `subscription-access.service.ts`:

```typescript
type AccessReason =
  | "free_trial"
  | "active_subscription"
  | "lifetime_membership"   // NEW
  | "event_sponsored_access" // NEW (optional time-boxed)
  | "trial_expired"
  | "subscription_expired"
  | "none";
```

Lifetime NFC cards should short-circuit expiry checks before BizCard `subscription_expires_at`.

---

## 5. Feature Recommendations

### 5.1 Membership & Membership Renewals

#### Current State

- **Bizcard-level:** `subscription_tier`, `subscription_status`, `subscription_expires_at`, `auto_renewal_enabled`
- **Recurring:** `BizcardSubscription` + Xendit (`xendit_customer_id`, `xendit_subscription_id`)
- **Plans catalog:** `SubscriptionPlan` (tier limits: cards, themes, associates, analytics)
- **User trial:** `is_trial_used`, `trial_start`, `trial_end` (30-day free trial)
- **Renewal APIs:** manual renew, auto-renew toggle, marketplace upgrade/downgrade/cancel
- **Crons:** `subscription-expiry`, trial promos, premium boost expiry

#### Gaps

1. No first-class **Membership** entity — renewal is per-BizCard, not per-member
2. Manual renew API does not require payment confirmation
3. No org-wide company membership (company has `subscription_tier` but billing is per-employee BizCard)
4. No grace period, dunning, or failed-payment retry workflow
5. Renewal history exists (`SubscriptionRenewalHistory`) but is not surfaced in member UI

#### Recommended Implementation

**Phase 1 — Consolidate (low risk)**

1. Add `Membership` table (see [Section 6](#6-unified-data-model-proposed))
2. **Backfill migration:** For each active `Bizcard` with `subscription_status = active`, create `Membership` row
3. Create `lib/services/membership.service.ts`:
   - `getActiveMembership(userId)` — single source of truth
   - `isRenewalDue(membership)` — uses `valid_until`
   - `renewMembership(membershipId, paymentRef)` — requires Xendit confirmation
4. **Deprecate** unguarded manual renew; route through Xendit invoice or admin override with audit log
5. Member UI: new `/user/membership` page showing status, renewal date, history, upgrade CTA

**Phase 2 — Renewal automation**

1. Xendit recurring for all membership tiers (not only marketplace `BizcardSubscription`)
2. Cron `membership-renewal-reminders` (reuse `subscription-expiry` logic, 30/7/3/1 day windows)
3. Failed payment: status → `past_due`, grace period (e.g. 7 days), then `expired`
4. Email templates: `membership_renewal_reminder`, `membership_renewed`, `membership_expired`

**Phase 3 — Company membership (optional)**

1. `CompanyMembership` plan: N seats, admin assigns seats to employees
2. Integrate with `CompanyEmployee` invite flow
3. Admin dashboard: seat usage, renewal billing

#### Integration Points

| Existing | Change |
|---|---|
| `app/api/xendit/webhook/route.ts` | On `INVOICE_PAID` for membership SKU → `renewMembership()` |
| `lib/services/subscription-access.service.ts` | Check `Membership` before BizCard expiry |
| `app/api/bizcard/[bizcardId]/subscription/renew` | Require payment or superadmin audit |
| `app/user/emarket?tab=subscription` | Add membership-centric view |
| `server/lib/notification-templates.ts` | New renewal email types |

---

### 5.2 Attendance at Event Monitoring

#### Current State

- `CalendarEvent` with `starts_at`, `ends_at`, `place`, `publicity`
- `CalendarEventAttendance` — self-service RSVP (`status: "going"`)
- `POST /api/calendar/events/[eventId]/attend` — premium-gated
- `cron/calendar-reminders` — upcoming/day-before reminders
- **No** on-site verification, staff scanner, or check-in timestamp separate from RSVP

#### Gaps

1. RSVP ≠ physical attendance
2. No QR/NFC check-in at venue
3. No staff/booth scanner mode
4. No walk-in registration at event
5. No attendance export for organizers

#### Recommended Implementation

**Extend `CalendarEvent`:**

```prisma
model CalendarEvent {
  // existing fields...
  check_in_enabled     Boolean   @default(false)
  check_in_opens_at    DateTime?
  check_in_closes_at   DateTime?
  check_in_token       String?   @unique  // event-level QR secret
  require_membership   Boolean   @default(false)
}
```

**New model `EventCheckIn`:**

```prisma
model EventCheckIn {
  id           BigInt   @id @default(autoincrement())
  event_id     BigInt
  user_id      BigInt
  method       String   // rsvp | qr_scan | nfc_scan | manual_staff
  checked_in_at DateTime @default(now())
  checked_in_by BigInt? // staff user_id for manual
  device_meta  String?  @db.Text  // JSON: IP, UA
  @@unique([event_id, user_id])
}
```

**Check-in flows:**

| Flow | Actor | Endpoint |
|---|---|---|
| Member self check-in | Attendee | `POST /api/events/[eventId]/check-in` with event QR payload |
| Staff scanner | Staff/organizer | `POST /api/events/[eventId]/check-in/scan` with member serial/QR |
| NFC tap | Attendee | `GET /api/public/scan/event/[checkInToken]` → auth → record check-in |
| Manual override | Organizer | `POST /api/events/[eventId]/check-in/manual` |

**Event QR format:**

```
https://portal.ontap.ph/check-in/{eventId}?t={signedToken}
```

Use HMAC-signed token (event_id + expiry) to prevent forgery. Reuse patterns from `scan-routing.ts`.

**Staff scanner UI:**

- New page: `/staff/events/scanner` or `/admin/events/[eventId]/scanner`
- Mobile-first: camera QR scan + manual serial ID entry
- Real-time attendee count vs RSVP count

**Analytics:**

- Dashboard widget: RSVP vs checked-in
- Export CSV: name, email, check-in time, method
- Tie to `EmployeeActivitySummary` for company events

#### Integration Points

| Existing | Change |
|---|---|
| `CalendarEventAttendance` | Keep RSVP; add `checked_in` boolean or link to `EventCheckIn` |
| `lib/services/calendar-event.service.ts` | `checkInAttendee()`, `getAttendanceReport()` |
| `lib/bizcard/scan-routing.ts` | New resolver branch for event check-in URLs |
| `calendar-notification.service` | Notify organizer on check-in milestones |
| Premium guard | Event creation stays premium; check-in can be free for attendees |

---

### 5.3 Food at Token Claiming

#### Current State

- **Nothing** for event food/meal tokens
- Closest analog: `SpinHistory.voucher_code` → `Promotion` (marketplace discount)
- `PromoUsage` tracks redemption count per user

#### Gaps

Entire feature is net-new: issuance, wallet, redemption at booth, anti-fraud, dietary flags.

#### Recommended Implementation

**New models:**

```prisma
model EventTokenBatch {
  id          BigInt   @id @default(autoincrement())
  event_id    BigInt
  name        String   // "Lunch Day 1", "VIP Dinner"
  token_type  String   // food | drink | merch
  quantity_per_member Int @default(1)
  valid_from  DateTime
  valid_until DateTime
  status      String   @default("active")
}

model MemberEventToken {
  id          BigInt   @id @default(autoincrement())
  batch_id    BigInt
  user_id     BigInt
  event_id    BigInt
  token_code  String   @unique  // QR payload
  status      String   @default("issued")  // issued | claimed | expired | void
  issued_at   DateTime @default(now())
  claimed_at  DateTime?
  claimed_by_staff_id BigInt?
  @@unique([batch_id, user_id])  // one per batch per user
}
```

**Issuance rules:**

| Trigger | Rule |
|---|---|
| Event RSVP "going" | Auto-issue tokens when batch is linked to event |
| On-site check-in | Issue tokens if not already issued (walk-ins) |
| Membership tier | VIP batch gets extra tokens |
| Manual | Organizer bulk-issue to attendee list |

**Claiming flow (at food booth):**

```
Attendee shows token QR (MemberEventToken.token_code)
    → Staff scans: POST /api/events/tokens/claim
    → Validates: not expired, not already claimed, event matches
    → status → claimed, timestamp + staff_id recorded
    → Optional: print receipt / show "Claimed ✓" on attendee phone
```

**Member wallet UI:**

- `/user/events/[eventId]/tokens` — list of tokens with QR codes
- Push notification when tokens are issued
- Offline-friendly: render QR client-side from `token_code`

**Anti-fraud:**

- Single-use tokens (status transition is atomic)
- Rate limit claim endpoint
- Staff must be assigned to event (`EventStaffAssignment`)
- Optional: geofence validation (compare booth IP to event venue — soft check)

#### Integration Points

| Existing | Change |
|---|---|
| `CalendarEvent` | Link `EventTokenBatch` |
| `EventCheckIn` | Trigger token issuance on check-in |
| `Promotion` pattern | Adapt validation logic for single-use tokens |
| `NotificationEmailQueue` | `event_token_issued`, `event_token_claimed` |
| Superadmin | Token batch CRUD, void/refund tokens |

---

### 5.4 Voting System / Loyalty Card

These are related but distinct. Recommend **two modules** that share a points ledger.

#### 5.4.A Voting System

**Current state:** No voting/polling anywhere in codebase.

**Recommended implementation:**

```prisma
model Vote {
  id            BigInt   @id @default(autoincrement())
  event_id      BigInt?  // optional — event-scoped vote
  org_id        BigInt?  // company-scoped
  title         String
  description   String?  @db.Text
  vote_type     String   // single_choice | multiple_choice | ranked
  opens_at      DateTime
  closes_at     DateTime
  eligibility   String   // all_members | checked_in | tier_premium
  status        String   @default("draft")  // draft | open | closed
}

model VoteOption {
  id       BigInt @id @default(autoincrement())
  vote_id  BigInt
  label    String
  sort_order Int
}

model VoteBallot {
  id        BigInt   @id @default(autoincrement())
  vote_id   BigInt
  user_id   BigInt
  selections String  @db.Text  // JSON: option_ids
  cast_at   DateTime @default(now())
  @@unique([vote_id, user_id])
}
```

**Flows:**

1. Organizer creates vote (staff/superadmin/company admin)
2. Eligibility engine checks: active membership, event check-in, one ballot per user
3. Member votes via `/user/votes/[voteId]` or event page embed
4. Results: real-time for organizers; delayed/public after `closes_at`
5. Cron `close-expired-votes` flips status

**UI surfaces:**

- Event detail page: "Cast your vote" tab
- Admin: vote builder with options, schedule, eligibility
- Results dashboard with charts (reuse analytics components)

#### 5.4.B Loyalty Card

**Current state:**

- `Mission` / `UserReward` / `Reward` — referral-growth perks only (`qualified_referrals`)
- No points, stamps, or tiered loyalty

**Recommended implementation:**

```prisma
model LoyaltyProgram {
  id          BigInt @id @default(autoincrement())
  name        String
  org_id      BigInt?  // null = platform-wide
  points_per_action String @db.Text  // JSON rules
  status      String @default("active")
}

model LoyaltyAccount {
  id          BigInt @id @default(autoincrement())
  user_id     BigInt
  program_id  BigInt
  points_balance Int @default(0)
  tier        String @default("bronze")  // bronze | silver | gold
  @@unique([user_id, program_id])
}

model LoyaltyTransaction {
  id          BigInt @id @default(autoincrement())
  account_id  BigInt
  delta       Int
  reason      String  // event_check_in | referral | purchase | vote_participation | redemption
  reference_id String?  // event_id, order_id, etc.
  created_at  DateTime @default(now())
}
```

**Earn rules (examples):**

| Action | Points |
|---|---|
| Event check-in | +10 |
| Referral qualified | +50 (extend existing `growth-referral.ts`) |
| Vote participation | +5 |
| Membership renewal | +100 |
| BizCard scan received | +1 |

**Redeem rules:**

- Extend `Reward` model: add `type: "loyalty_points"`, `points_cost`
- Redeem via `/user/loyalty` → deduct points → create `UserReward`
- Physical loyalty card: NFC tap shows points balance + QR for redemption

**Reuse existing growth system:**

- Add `requirement_type: "loyalty_points"` to `Mission`
- Add `requirement_type: "event_attendance_count"` for "Attend 5 events" missions
- Keep referral missions; loyalty becomes the points engine underneath

#### Integration Points

| Existing | Change |
|---|---|
| `server/lib/growth-rewards.ts` | Hook loyalty credit on mission unlock |
| `EventCheckIn` | Credit points on check-in |
| `VoteBallot` | Credit points on vote cast |
| `UserReward` | Support loyalty redemption source |
| Portal nav | Add "Loyalty" under Growth group |

---

### 5.5 Networking Profiles for Members

#### Current State

- **Public identity:** `Bizcard` + portfolio themes (`app/themes/`, `app/api/portfolio/[uri]/**`)
- **Connections:** `Connection` (friend/associate), `ConnectionTag`, `BlockedUser`
- **Messaging:** `DirectConversation`, `DirectMessage`
- **Company:** `CompanyEmployee`, join requests, admin dashboard
- **No** dedicated member directory, org chart, or profile separate from BizCard

#### Gaps

1. BizCard is a *marketing* profile, not a *member networking* profile
2. No cross-company member search/directory
3. No event-context networking (who else is here?)
4. No skills/interests/tags for matchmaking
5. Associates are 1:1 connections, not a browsable network

#### Recommended Implementation

**Option A (Recommended): Extend User + lightweight MemberProfile**

Add `MemberProfile` without replacing BizCard:

```prisma
model MemberProfile {
  user_id           BigInt   @id
  headline          String?  @db.VarChar(200)
  industry          String?  @db.VarChar(100)
  skills            String?  @db.Text  // JSON array
  interests         String?  @db.Text  // JSON array
  networking_visibility String @default("members_only")  // public | members_only | connections_only
  open_to_connect   Boolean  @default(true)
  linkedin_url      String?  @db.VarChar(512)
  updated_at        DateTime?
  user              User     @relation(...)
}
```

**Public vs private layers:**

| Layer | Purpose | Visibility |
|---|---|---|
| BizCard / Portfolio | Business marketing, products, services | Public web |
| MemberProfile | Networking: skills, interests, headline | Members only |
| Connection graph | Trusted network | Connections only |

**New features:**

1. **Member Directory** — `/user/network/directory`
   - Search by name, industry, skills, company
   - Filter: same event, same company, open to connect
   - Requires active membership

2. **Event Networking** — `/user/events/[eventId]/attendees`
   - Visible to checked-in or RSVP'd members
   - "People you may know" — mutual connections
   - Quick connect button (reuses `Connection` API)

3. **Profile page** — `/user/network/profile` and `/user/network/[userId]`
   - Edit headline, skills, interests
   - Show primary BizCard link ("View my BizCard")
   - Connection status + message CTA

4. **Match suggestions cron** — weekly digest of suggested connections

**Option B (Not recommended):** Replace BizCard as identity — too disruptive.

#### Integration Points

| Existing | Change |
|---|---|
| `app/api/connections/**` | Unchanged; directory feeds into connect flow |
| `app/api/portfolio/[uri]/connect` | Keep public portfolio connect |
| `ConnectionTag` | Allow tagging from directory |
| `lib/services/connection-messaging.service.ts` | Unchanged |
| Landing page | Optional public "Members" section (gated) |

---

### 5.6 NFC/QR Membership IDs with Free Lifetime Platform Access

#### Current State

- `Bizcard.serial_id` — unique physical/virtual card identifier
- `EmployeeCard.serial_id` — company employee cards (separate model)
- Scan flow: `lib/bizcard/scan-routing.ts` → portfolio | signup | merge
- Access: `subscription-access.service` — trial or paid subscription; **no lifetime flag**
- Superadmin: generate/distribute blank cards, `manually_distributed_at`
- QR generation: async queue (`cron/process-qr-queue`)

#### Gaps

1. No `lifetime` or `complimentary` access type
2. Physical card = BizCard product, not "membership ID" SKU
3. Lifetime access not decoupled from subscription expiry
4. No membership card visual/badge distinct from BizCard branding

#### Recommended Implementation

**1. Membership card product type**

Extend `Merchandise` or add `MembershipCardSku`:

```prisma
// On Bizcard or new MembershipCard table
access_type       String?  // subscription | lifetime | event_only
membership_tier   String?  // maps to Membership.membership_tier
lifetime_granted_at DateTime?
lifetime_granted_by BigInt?  // superadmin user_id
```

**2. Lifetime access logic**

In `subscription-access.service.ts`:

```typescript
async function resolveAccess(userId: bigint): Promise<AccessStatus> {
  const lifetime = await prisma.membership.findFirst({
    where: { user_id: userId, status: "lifetime" },
  });
  if (lifetime) {
    return { hasAccess: true, reason: "lifetime_membership", expiresAt: null };
  }
  // existing trial/subscription checks...
}
```

**3. NFC/QR encoding**

Lifetime membership cards encode the same URL pattern:

```
https://portal.ontap.ph/{SERIAL_ID}
```

On scan:
1. Resolve serial → `Bizcard` or `MembershipCard`
2. If `access_type = lifetime` → grant platform access regardless of `subscription_expires_at`
3. Show membership badge on portfolio: "Lifetime Member"
4. Blank lifetime card → signup flow with `ref=SERIAL` + auto-grant lifetime on claim

**4. Issuance workflow**

| Step | Actor | Action |
|---|---|---|
| 1 | Superadmin | Generate batch of lifetime serial IDs (`card_type: membership_lifetime`) |
| 2 | Superadmin | Mark distributed (existing `manually_distributed_at` pattern) |
| 3 | Member | Tap NFC / scan QR → onboarding → claim |
| 4 | System | Create `Membership { status: lifetime }`, set `Bizcard.access_type = lifetime` |
| 5 | Member | Full platform access, no renewal prompts |

**5. QR code content**

Reuse existing QR pipeline. Membership card QR should resolve to:
- **Claimed:** portfolio URL with lifetime badge
- **Unclaimed:** onboarding with "Lifetime Access" messaging

**6. Prevent abuse**

- Serial batch tracking with `max_activations = 1`
- Superadmin audit log for lifetime grants
- Optional: require email verification before lifetime activation
- Rate limit claim endpoint per serial

#### Integration Points

| Existing | Change |
|---|---|
| `lib/bizcard/scan-routing.ts` | Recognize `membership_lifetime` card type |
| `lib/services/physical-card.service.ts` | New card type in generation |
| `app/api/bizcard/claim` | Grant lifetime membership on claim |
| `app/api/xendit/webhook` | Skip invoice for lifetime cards |
| `cron/subscription-expiry` | Exclude lifetime members from expiry emails |
| `app/user/emarket` | Hide subscription CTA for lifetime members |
| Superadmin bizcard management | Filter/batch generate lifetime cards |

---

## 6. Unified Data Model (Proposed)

New tables (additive — no breaking changes to existing BizCard schema):

```
Membership
MembershipRenewal
MemberProfile
EventCheckIn
EventTokenBatch
MemberEventToken
EventStaffAssignment
Vote / VoteOption / VoteBallot
LoyaltyProgram / LoyaltyAccount / LoyaltyTransaction
```

**Entity relationship (simplified):**

```
User
 ├── Membership ──► MembershipRenewal[]
 ├── MemberProfile
 ├── LoyaltyAccount ──► LoyaltyTransaction[]
 ├── Bizcard (serial_id, access_type)
 ├── CalendarEvent
 │    ├── CalendarEventAttendance (RSVP)
 │    ├── EventCheckIn (on-site)
 │    ├── EventTokenBatch ──► MemberEventToken[]
 │    └── Vote ──► VoteOption[], VoteBallot[]
 └── Connection (existing)
```

---

## 7. API Surface (Proposed)

### Membership

| Method | Route | Description |
|---|---|---|
| GET | `/api/user/membership` | Current membership status + history |
| POST | `/api/user/membership/renew` | Initiate Xendit renewal invoice |
| GET | `/api/admin/company/membership` | Company seat usage |

### Events & Attendance

| Method | Route | Description |
|---|---|---|
| POST | `/api/events/[eventId]/check-in` | Self check-in (signed QR) |
| POST | `/api/events/[eventId]/check-in/scan` | Staff scan member serial |
| GET | `/api/events/[eventId]/attendance` | Organizer report |
| GET | `/api/public/check-in/[token]` | NFC/QR redirect + check-in |

### Food Tokens

| Method | Route | Description |
|---|---|---|
| GET | `/api/user/events/[eventId]/tokens` | Member token wallet |
| POST | `/api/events/tokens/claim` | Staff redeems token |
| POST | `/api/admin/events/[eventId]/token-batches` | Create batch |

### Voting

| Method | Route | Description |
|---|---|---|
| GET | `/api/votes/[voteId]` | Vote detail + options |
| POST | `/api/votes/[voteId]/ballot` | Cast vote |
| GET | `/api/admin/votes/[voteId]/results` | Results (organizer) |

### Loyalty

| Method | Route | Description |
|---|---|---|
| GET | `/api/user/loyalty` | Points balance + history |
| POST | `/api/user/loyalty/redeem` | Redeem reward |

### Networking

| Method | Route | Description |
|---|---|---|
| GET | `/api/network/directory` | Search members |
| GET/PUT | `/api/network/profile` | Member profile CRUD |
| GET | `/api/events/[eventId]/attendees` | Event networking list |

### Lifetime Cards

| Method | Route | Description |
|---|---|---|
| POST | `/api/superadmin/membership-cards/generate` | Batch generate lifetime serials |
| POST | `/api/bizcard/claim` | *(extend)* Grant lifetime on claim |

---

## 8. UI & Portal Integration

### New navigation entries (`portalNavigation.ts`)

**User portal:**

```
Events (new group)
  ├── My Events        /user/events
  ├── My Tokens        /user/events/tokens
  └── My Votes         /user/votes

Network (new group)
  ├── Directory        /user/network/directory
  └── My Profile       /user/network/profile

Growth (extend)
  ├── Missions         /user/missions (existing)
  └── Loyalty Card     /user/loyalty (new)

Membership           /user/membership (new)
```

**Admin portal:**

```
Events
  ├── Manage Events    /admin/events
  ├── Scanner          /admin/events/scanner
  ├── Token Batches    /admin/events/tokens
  └── Votes            /admin/votes
```

**Staff portal:**

```
Event Scanner          /staff/events/scanner
Token Redemption       /staff/events/tokens
```

**Superadmin:**

```
Membership Cards       /superadmin/membership-cards
Lifetime Grants        /superadmin/lifetime-access
```

### Mobile-first surfaces

Priority mobile UIs (events are on-site use cases):

1. Staff scanner (check-in + token claim) — single page app feel
2. Member token wallet — full-screen QR
3. Self check-in — one tap after scan

---

## 9. Phased Rollout Plan

### Phase 0 — Foundation (2–3 weeks)

- [ ] `Membership` model + backfill from active BizCards
- [ ] Extend `subscription-access.service` with `lifetime_membership`
- [ ] `/user/membership` page (read-only status)
- [ ] Secure manual renew API (payment or admin audit)

**Deliverable:** Single membership source of truth.

### Phase 1 — Lifetime NFC/QR Cards (2–3 weeks)

- [ ] `access_type` on Bizcard + lifetime grant on claim
- [ ] Superadmin batch generation for lifetime cards
- [ ] Scan routing recognizes lifetime cards
- [ ] Suppress renewal emails/CTAs for lifetime members

**Deliverable:** Physical lifetime membership cards work end-to-end.

### Phase 2 — Event Check-In (3–4 weeks)

- [ ] `EventCheckIn` model + signed QR tokens
- [ ] Staff scanner UI
- [ ] Attendance report + export
- [ ] RSVP vs check-in dashboard

**Deliverable:** On-site attendance monitoring at events.

### Phase 3 — Food Tokens (2–3 weeks)

- [ ] `EventTokenBatch` + `MemberEventToken`
- [ ] Auto-issue on check-in/RSVP
- [ ] Member wallet + staff claim scanner

**Deliverable:** Food token claiming at events.

### Phase 4 — Member Networking (3–4 weeks)

- [ ] `MemberProfile` model + edit UI
- [ ] Member directory with search
- [ ] Event attendee networking view

**Deliverable:** Networking profiles for members.

### Phase 5 — Loyalty & Voting (4–5 weeks)

- [ ] `LoyaltyProgram` + points ledger
- [ ] Integrate earn rules (check-in, referral, renewal)
- [ ] `Vote` module + ballot UI
- [ ] Loyalty redemption via extended `Reward`

**Deliverable:** Voting system and loyalty card.

### Phase 6 — Polish & Automation (ongoing)

- [ ] Xendit auto-renewal for all membership tiers
- [ ] Company membership seats
- [ ] Analytics dashboards
- [ ] Landing page integration (`new-ontap-landing-page`)

---

## 10. Risks, Dependencies & Open Questions

### Risks

| Risk | Mitigation |
|---|---|
| Membership vs BizCard subscription drift | `Membership` is canonical; sync BizCard fields via service layer |
| Manual renew API abuse | Require payment ref or superadmin audit |
| Token fraud (screenshot sharing) | Single-use + staff scan + optional rotating QR |
| Lifetime card serial leakage | Batch tracking, one-time activation, audit logs |
| Feature creep | Strict phased rollout; MVP per phase |

### Dependencies

- Xendit recurring billing configuration for membership SKUs
- Physical card printing pipeline (existing superadmin generation)
- Staff devices for event scanner (mobile web sufficient)
- Cron scheduler for token/vote expiry (existing `requireCronAuth` pattern)
- Email templates (extend `notification-templates.ts`)

### Open Questions for Stakeholders

1. **Membership tiers:** Are org membership tiers the same as BizCard tiers (basic/standard/premium) or a separate taxonomy?
2. **Lifetime scope:** Does lifetime = all premium features, or a specific "member" tier with limited features?
3. **Company vs individual:** Should company admins buy membership seats, or is membership always per-user?
4. **Food tokens:** Per-event flat allocation, or tier-based (VIP gets more)?
5. **Voting:** Anonymous ballots or attributed? Public results or organizer-only?
6. **Loyalty:** Platform-wide program or per-company programs?
7. **Networking visibility:** Default public, members-only, or opt-in?
8. **Offline events:** Required offline check-in/token claim, or online-only acceptable?
9. **Landing page:** Should member directory or event features appear on `new-ontap-landing-page`?
10. **NfcCardAuthi:** Is there a separate NFC auth project to integrate, or is scan-routing sufficient?

---

## Appendix A — Existing Assets to Reuse

| Asset | Location | Reuse for |
|---|---|---|
| Scan routing | `lib/bizcard/scan-routing.ts` | Event check-in, lifetime card claim |
| Serial ID service | `lib/services/serialIdService.ts` | Membership card generation |
| Subscription access | `lib/services/subscription-access.service.ts` | Lifetime access gate |
| Calendar service | `lib/services/calendar-event.service.ts` | Event base for attendance/tokens/votes |
| Growth rewards | `server/lib/growth-rewards.ts` | Loyalty milestone pattern |
| Promotion redemption | `Promotion`, `PromoUsage` | Token validation pattern |
| Notification queue | `NotificationEmailQueue` | All new email types |
| Xendit webhook | `app/api/xendit/webhook/route.ts` | Membership renewal payment |
| Portal navigation | `app/config/portalNavigation.ts` | New menu entries |
| Staff permissions | `StaffModule`, `StaffPermission` | Scanner and token roles |

---

## Appendix B — Suggested Notification Event Types

| Event type | Trigger |
|---|---|
| `membership_renewal_reminder` | Cron: 30/7/3/1 days before expiry |
| `membership_renewed` | Xendit payment success |
| `membership_expired` | Status → expired |
| `lifetime_membership_activated` | Card claim with lifetime |
| `event_check_in_confirmed` | Successful check-in |
| `event_token_issued` | Token batch issued to member |
| `event_token_claimed` | Staff redeems token |
| `vote_opened` | Vote status → open |
| `vote_reminder` | Vote closing soon |
| `loyalty_points_earned` | Points credited |
| `loyalty_tier_upgraded` | Tier threshold crossed |
| `network_connection_suggestion` | Weekly digest |

---

*End of document.*
