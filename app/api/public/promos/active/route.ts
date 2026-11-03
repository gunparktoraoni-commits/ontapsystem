import { NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";

export async function GET() {
  try {
    const now = new Date();
    const promos = await prisma.promotion.findMany({
      where: {
        is_active: true,
        starts_at: { lte: now },
        expires_at: { gte: now },
      },
      orderBy: { starts_at: "asc" },
      select: {
        id: true,
        promo_name: true,
        description: true,
        promo_img: true,
        promo_type: true,
        code: true,
      },
    });

    return NextResponse.json({ promos });
  } catch (err) {
    console.error("[api/public/promos/active] error", err);
    return NextResponse.json({ promos: [] }, { status: 500 });
  }
}
