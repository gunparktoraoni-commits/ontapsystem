import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: "Phone verification is not configured. SMS provider integration is required.",
      code: "SMS_NOT_CONFIGURED",
    },
    { status: 501 }
  );
}
