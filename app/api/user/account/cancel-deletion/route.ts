import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: "Account deletion cancellation is not configured yet.",
      code: "ACCOUNT_DELETION_NOT_CONFIGURED",
    },
    { status: 501 }
  );
}
