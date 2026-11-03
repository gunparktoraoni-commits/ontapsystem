// GET /api/marketplace/templates/[id]
// Optional-auth endpoint — returns template detail with ownership and download eligibility.
// Rate limit: 120/min per IP.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { validateToken, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);

  const rateCheck = checkRateLimit("marketplace-template-detail", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  try {
    const { id: rawId } = await params;
    let themeId: bigint;
    try {
      themeId = BigInt(rawId);
    } catch {
      return NextResponse.json({ success: false, error: "Invalid template ID." }, { status: 400 });
    }

    // Optional auth
    let userId: bigint | null = null;
    const authHeader = request.headers.get("authorization");
    const rawToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (rawToken) {
      const payload = await validateToken(rawToken);
      if (payload?.userId) userId = BigInt(payload.userId);
    }

    const template = await prisma.theme.findFirst({
      where: { id: themeId },
    });

    if (!template) {
      return NextResponse.json({ success: false, error: "Template not found." }, { status: 404 });
    }

    // Ownership check
    let isOwned = false;
    if (userId) {
      const purchase = await prisma.templatePurchase.findUnique({
        where: { user_id_template_id: { user_id: userId, template_id: themeId } },
      });
      isOwned = purchase !== null;
    }

    const isFree = template.tag === "free" || Number(template.price) === 0;
    const canDownload = isFree || isOwned;

    return NextResponse.json(serialize({
      success: true,
      data: {
        template: {
          id: template.id.toString(),
          name: template.theme_name,
          tag: template.tag,
          price: Number(template.price),
          previewImages: template.preview_images,
          category: template.category,
          downloadCount: template.download_count,
          isFree,
          isOwned,
          canDownload,
          createdAt: template.created_at,
          updatedAt: template.updated_at,
        },
      },
    }));
  } catch (err) {
    console.error("[marketplace/templates/[id] GET]", err);
    return NextResponse.json({ success: false, error: "An unexpected error occurred." }, { status: 500 });
  }
}
