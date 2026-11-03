import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  if (!sessionId) {
    return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
  }

  const session = await prisma.checkoutSession.findUnique({
    where: { session_id: sessionId },
    include: { order: true },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  return NextResponse.json({
    status: session.status,
    order_number: session.order?.order_number || null,
    total_amount: session.total_amount,
    currency: session.currency,
  });
}