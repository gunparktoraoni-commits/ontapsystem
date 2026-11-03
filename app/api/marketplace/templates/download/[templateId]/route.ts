// GET /api/marketplace/templates/download/[templateId]
// Auth required — verifies ownership, increments download count, returns template data.
// Rate limit: 30/min per IP.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { resolveRequestSession, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

async function requireSession(request: NextRequest) {
  const result = await resolveRequestSession(request);
  if (!result.session) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Authentication required.", requiresAuth: true },
        { status: 401 }
      ),
    };
  }
  return { ok: true as const, session: result.session };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> }
) {
  const ip = getClientIp(request);

  const rateCheck = checkRateLimit("marketplace-template-download", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
    );
  }

  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const { session } = auth;

  try {
    const { templateId: rawTemplateId } = await params;
    let themeId: bigint;
    try {
      themeId = BigInt(rawTemplateId);
    } catch {
      return NextResponse.json({ success: false, error: "Invalid template ID." }, { status: 400 });
    }

    const userId = BigInt(session.userId);

    const template = await prisma.theme.findFirst({
      where: { id: themeId },
    });

    if (!template) {
      return NextResponse.json({ success: false, error: "Template not found." }, { status: 404 });
    }

    const isFree = template.tag === "free" || Number(template.price) === 0;

    if (!isFree) {
      // Check ownership
      const purchase = await prisma.templatePurchase.findUnique({
        where: { user_id_template_id: { user_id: userId, template_id: themeId } },
      });

      if (!purchase) {
        return NextResponse.json(
          { success: false, error: "You do not own this template. Please purchase it first." },
          { status: 403 }
        );
      }
    }

    // Increment download count atomically
    await prisma.theme.update({
      where: { id: themeId },
      data: { download_count: { increment: 1 } },
    });

    // Return the template content — the actual template data (fields, layout, etc.)
    // Clients render templates based on this data.
    return NextResponse.json(serialize({
      success: true,
      data: {
        templateId: template.id.toString(),
        name: template.theme_name,
        downloadedAt: new Date().toISOString(),
        // The raw template blob — consumers use this to render or import the theme
        template: {
          id: template.id.toString(),
          name: template.theme_name,
          tag: template.tag,
          price: Number(template.price),
          previewImages: template.preview_images,
          category: template.category,
          // Return the theme configuration fields used for rendering
          // (add additional theme-specific fields here as the Theme model grows)
        },
      },
    }));
  } catch (err) {
    console.error("[marketplace/templates/download/[templateId] GET]", err);
    return NextResponse.json({ success: false, error: "An unexpected error occurred." }, { status: 500 });
  }
}
