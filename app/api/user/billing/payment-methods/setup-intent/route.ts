import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      success: false,
      error: "Setup intent is not configured. Stripe setup-intent server integration is required.",
      code: "SETUP_INTENT_NOT_CONFIGURED",
    },
    { status: 501 }
  );
}
