import { NextRequest, NextResponse } from "next/server";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ transactionId: string }> }) {
  const { transactionId } = await params;
  return NextResponse.json(
    {
      success: false,
      error: `Invoice PDF generation is not configured for transaction ${transactionId}.`,
      code: "INVOICE_PDF_NOT_CONFIGURED",
    },
    { status: 501 }
  );
}
