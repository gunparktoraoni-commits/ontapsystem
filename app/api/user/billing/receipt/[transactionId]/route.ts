import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getBillingReceipt, parseBillingTransactionId } from "@/server/lib/billing/history";

function serialize(obj: unknown): unknown {
  return JSON.parse(JSON.stringify(obj, (_, value) => (typeof value === "bigint" ? value.toString() : value)));
}

async function requireSession(request: NextRequest) {
  const resolved = await resolveRequestSession(request);
  if (!resolved.session) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Authentication required.", requiresAuth: true }, { status: 401 }),
    };
  }
  return { ok: true as const, session: resolved.session };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ transactionId: string }> }) {
  const ip = getClientIp(request);
  const rl = checkRateLimit("marketplace-purchases-list", ip);
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: "Too many requests." }, { status: 429 });
  }

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const { transactionId } = await params;
  if (!parseBillingTransactionId(transactionId)) {
    return NextResponse.json({ success: false, error: "Invalid transactionId." }, { status: 400 });
  }

  const userId = BigInt(auth.session.userId);

  try {
    const receipt = await getBillingReceipt(userId, transactionId);
    if (!receipt) {
      return NextResponse.json({ success: false, error: "Transaction not found." }, { status: 404 });
    }

    return NextResponse.json(serialize({ success: true, data: receipt.data }));
  } catch (err) {
    console.error("[BILLING_API] BILLING_RECEIPT_FETCH_FAILED", err);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to load billing receipt.",
        code: "BILLING_RECEIPT_FETCH_FAILED",
        tag: "[BILLING_API]",
      },
      { status: 500 },
    );
  }
}
