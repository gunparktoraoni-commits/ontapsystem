import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { validateToken, getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { sanitizeString } from "@/server/lib/validators";
import { buildThemeVisibilityOrFilters } from "@/lib/services/theme-visibility.service";
import { resolveHitachiCompanyIds } from "@/lib/constants/hitachi-companies";
import { resolveCompanyThemePolicyForUser } from "@/server/lib/company";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

function isPrivilegedRole(role: string): boolean {
  return ["admin", "company_admin", "dev", "super_admin"].includes(role);
}

async function getSession(request: NextRequest) {
  const rawToken = request.cookies.get("session_token")?.value;
  if (!rawToken) return null;
  return validateToken(rawToken);
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);

  try {
    const rateCheck = checkRateLimit("bizcard-themes-list", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
      );
    }

    const session = await getSession(request);

    let userCompanyId: bigint | null = null;
    if (session) {
      await resolveHitachiCompanyIds(prisma);
      const policy = await resolveCompanyThemePolicyForUser(BigInt(session.userId));
      userCompanyId = policy.companyId ? BigInt(policy.companyId) : null;
    }

    const visibilityFilters = buildThemeVisibilityOrFilters({
      userId: session ? BigInt(session.userId) : null,
      companyId: userCompanyId,
    });

    const themes = await prisma.theme.findMany({
      where: {
        OR: visibilityFilters,
        is_active: true,
      },
      orderBy: [{ created_at: "desc" }],
      select: {
        id: true,
        theme_name: true,
        theme_path: true,
        css_variables: true,
        preview_image: true,
        is_active: true,
        exclusive_for: true,
        category: true,
        price: true,
        tag: true,
        created_at: true,
        updated_at: true,
      },
    });

    return NextResponse.json(serialize({ success: true, data: themes }), { status: 200 });
  } catch (err) {
    console.error("[bizcard/themes GET] Unhandled error:", err);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  try {
    const rateCheck = checkRateLimit("bizcard-themes-write", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many write attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
      );
    }

    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Authentication required.", requiresAuth: true }, { status: 401 });
    }
    if (!isPrivilegedRole(session.role)) {
      return NextResponse.json({ error: "Admin privileges required." }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const name = sanitizeString(body.name);
    const themePath = sanitizeString(body.theme_path ?? body.themePath)?.toLowerCase();
    const previewImage = sanitizeString(body.preview_image ?? body.previewImage);
    const exclusiveFor = sanitizeString(body.exclusive_for ?? body.exclusiveFor);
    const category = sanitizeString(body.category ?? body.description ?? null);
    const tag = sanitizeString(body.tag ?? null) || "free";
    const priceRaw = body.price ?? 0;
    const price = typeof priceRaw === "string" || typeof priceRaw === "number"
      ? Number(priceRaw)
      : null;
    const cssVariables = typeof body.css_variables === "object" && body.css_variables !== null
      ? JSON.stringify(body.css_variables)
      : null;

    if (!name || name.length > 100) {
      return NextResponse.json({ error: "name is required and must be <= 100 characters." }, { status: 422 });
    }
    if (!themePath || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(themePath)) {
      return NextResponse.json({ error: "theme_path must be 2-64 lowercase chars using letters, digits, and hyphens." }, { status: 422 });
    }
    if (previewImage && previewImage.length > 512) {
      return NextResponse.json({ error: "preview_image must be <= 512 characters." }, { status: 422 });
    }
    if (exclusiveFor && exclusiveFor.length > 191) {
      return NextResponse.json({ error: "exclusive_for must be <= 191 characters." }, { status: 422 });
    }
    if (category && category.length > 100) {
      return NextResponse.json({ error: "category/description must be <= 100 characters." }, { status: 422 });
    }
    if (tag.length > 10) {
      return NextResponse.json({ error: "tag must be <= 10 characters." }, { status: 422 });
    }
    if (price === null || Number.isNaN(price) || price < 0) {
      return NextResponse.json({ error: "price must be a non-negative number." }, { status: 422 });
    }

    const created = await prisma.theme.create({
      data: {
        theme_name: name,
        theme_path: themePath,
        css_variables: cssVariables,
        preview_image: previewImage,
        exclusive_for: exclusiveFor,
        category,
        price,
        tag,
        is_active: body.is_active !== false,
      },
    });

    return NextResponse.json(serialize({ success: true, data: created }), { status: 201 });
  } catch (err) {
    console.error("[bizcard/themes POST] Unhandled error:", err);
    if (typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "Theme name/path already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
