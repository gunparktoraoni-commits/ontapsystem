import { NextRequest, NextResponse } from "next/server";

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ methodId: string }> }) {
  const { methodId } = await params;
  return NextResponse.json(
    {
      success: false,
      error: `Deleting payment method (${methodId}) is not configured.`,
      code: "PAYMENT_METHODS_NOT_CONFIGURED",
    },
    { status: 501 }
  );
}
