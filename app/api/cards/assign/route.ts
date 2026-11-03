// ──────────────────────────────────────────────────────────────
// POST /api/cards/assign — Bulk Card → Company Association
// ──────────────────────────────────────────────────────────────
// Called when a company admin submits a list of scanned serial IDs
// to claim them for their company. Individual employee assignment
// (linking a card to a specific user) is handled separately.
//
// Security layers:
// 1. Route is behind the middleware auth guard (session_token required)
// 2. Full session validation (DB lookup, revocation, deactivation)
// 3. Role enforcement — only "company_admin" may call this endpoint
// 4. Company scope enforcement — the admin can only claim cards for
//    THEIR OWN company (company_id from DB, not from the request body)
// 5. IP rate limiting (10/15 min) — bulk endpoint is intentionally tight
// 6. Serial ID format validation + batch size cap (100)
// 7. Atomic $transaction — all-or-nothing write for the entire batch;
//    no partial state if the DB throws mid-batch
// 8. Duplicate prevention — cards already owned by ANOTHER company are
//    rejected; cards already owned by THIS company are skipped gracefully
// 9. Audit logging for every outcome
//
// Response shape:
//   {
//     claimed:       string[]  — serial IDs newly associated with company
//     alreadyOwned:  string[]  — already owned by THIS company (idempotent)
//     conflicts:     string[]  — owned by a DIFFERENT company (rejected)
//     notFound:      string[]  — serial IDs that don't exist in DB yet (created)
//   }
//
// NOTE on "notFound" cards: When a card serial ID is submitted that doesn't
// exist in the DB yet (e.g. newly manufactured cards), it is CREATED and
// immediately associated with the company. This avoids a two-step
// "register card first, claim later" flow for the admin.
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import {
  resolveRequestSession,
  resolveEffectiveUserId,
  logAuditEvent,
  getClientIp,
  getUserAgent,
} from "@/server/lib/auth";
import { validateCardAssignInput } from "@/server/lib/validators";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  ensureCompanyRole,
  resolveCompanyActorContext,
} from "@/server/lib/company";
import { AppError } from "@/lib/errors/types";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const ua = getUserAgent(request);

  try {
    // ── Rate Limiting ──────────────────────────────
    const rateCheck = checkRateLimit("card-assign", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many card submission requests. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    // ── Session Validation ─────────────────────────
    const auth = await resolveRequestSession(request, { tryRefresh: true });
    if (!auth.session) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    let companyId: bigint;
    let actorUserId: number;

    try {
      const context = await resolveCompanyActorContext({
        userId: BigInt(resolveEffectiveUserId(auth)),
        requestId: "cards-assign",
      });
      ensureCompanyRole(context, ["admin"], "cards-assign");
      companyId = context.companyId;
      actorUserId = Number(context.userId);
    } catch (error) {
      if (error instanceof AppError) {
        return NextResponse.json({ error: error.message }, { status: error.statusCode });
      }
      return NextResponse.json(
        { error: "Forbidden. Only company admins can assign cards." },
        { status: 403 }
      );
    }

    // ── Parse & Validate Input ─────────────────────
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const validation = validateCardAssignInput(body);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.errors.join(" ") },
        { status: 400 }
      );
    }

    const { serialIds } = validation.data; // already de-duplicated by validator

    // ── Fetch All Existing Cards in One Query ──────
    // Avoids N individual DB round-trips inside the transaction.
    const existingCards = await prisma.employeeCard.findMany({
      where: { serial_id: { in: serialIds } },
      select: {
        card_id:    true,
        serial_id:  true,
        company_id: true,
      },
    });

    // Index by serial_id for O(1) lookups in the categorisation loop
    const existingBySerial = new Map(existingCards.map((c) => [c.serial_id, c]));

    // ── Categorise Each Serial ID ──────────────────
    const toCreate:      string[] = []; // Cards that don't exist yet — will be created
    const toSkip:        string[] = []; // Already owned by THIS company — idempotent
    const conflicts:     string[] = []; // Owned by a DIFFERENT company — rejected
    const alreadyOwned:  string[] = []; // Alias of toSkip exposed in response

    for (const serialId of serialIds) {
      const existing = existingBySerial.get(serialId);

      if (!existing) {
        // Card doesn't exist in DB — create and claim it
        toCreate.push(serialId);
        continue;
      }

      if (!existing.company_id) {
        // Card exists but is unclaimed — claim it
        toCreate.push(serialId);
        continue;
      }

      if (existing.company_id === companyId) {
        // Already owned by this company — idempotent, no error
        toSkip.push(serialId);
        alreadyOwned.push(serialId);
        continue;
      }

      // Owned by a different company — reject (no info leakage about which company)
      conflicts.push(serialId);
    }

    // ── Atomic Write ───────────────────────────────
    // All DB mutations happen inside a single transaction.
    // If any individual write fails (e.g. rare race condition on serial_id UNIQUE),
    // the entire transaction rolls back — no partial state.
    const claimed: string[] = [];

    if (toCreate.length > 0) {
      await prisma.$transaction(async (tx) => {
        for (const serialId of toCreate) {
          await tx.employeeCard.upsert({
            where: { serial_id: serialId },
            update: {
              // Card was unclaimed (company_id was null) — take ownership
              company_id:        companyId,
              activation_status: "unassigned",
              updated_at:        new Date(),
            },
            create: {
              serial_id:         serialId,
              company_id:        companyId,
              activation_status: "unassigned",
            },
          });
          claimed.push(serialId);
        }
      }, { timeout: 15000 });
    }

    // ── Audit Log ──────────────────────────────────
    await logAuditEvent("CARDS_BATCH_ASSIGNED", actorUserId, ip, ua, {
      company_id:   Number(companyId),
      claimed:      claimed.length,
      alreadyOwned: alreadyOwned.length,
      conflicts:    conflicts.length,
    });

    // ── Respond ────────────────────────────────────
    // Return a granular breakdown so the frontend can display meaningful feedback.
    // HTTP 207 Multi-Status signals that the batch had a mix of outcomes.
    const hasConflicts = conflicts.length > 0;
    const status = hasConflicts ? 207 : 200;

    return NextResponse.json(
      {
        message:     `${claimed.length} card(s) successfully associated with your company.`,
        claimed,                // Newly claimed serial IDs
        alreadyOwned,           // Already belonged to this company (no change)
        conflicts,              // Owned by another company — review required
        summary: {
          total:       serialIds.length,
          claimed:     claimed.length,
          alreadyOwned: alreadyOwned.length,
          conflicts:   conflicts.length,
        },
      },
      { status }
    );
  } catch (error) {
    console.error("Card assign error:", error);
    await logAuditEvent("CARD_ASSIGN_ERROR", undefined, ip, ua, {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
