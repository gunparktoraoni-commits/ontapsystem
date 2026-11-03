import { NextResponse } from "next/server";

export async function DELETE() {
  return NextResponse.json(
    {
      success: false,
      error: "Account deletion scheduling is not configured yet.",
      code: "ACCOUNT_DELETION_NOT_CONFIGURED",
    },
    { status: 501 }
  );
}
