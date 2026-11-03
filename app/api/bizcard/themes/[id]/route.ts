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

function parseThemeId(raw: string): bigint | null {
  if (!/^\d{1,20}$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

async function getSession(request: NextRequest) {
  const rawToken = request.cookies.get("session_token")?.value;
  if (!rawToken) return null;
  return validateToken(rawToken);
}

async function canReadTheme(themeId: bigint, sessionUserId: bigint): Promise<boolean> {
  await resolveHitachiCompanyIds(prisma);

  const policy = await resolveCompanyThemePolicyForUser(sessionUserId);
  const companyId = policy.companyId ? BigInt(policy.companyId) : null;

  const visibilityFilters = buildThemeVisibilityOrFilters({
    userId: sessionUserId,
    companyId,
  });

  const allowed = await prisma.theme.findFirst({
    where: {
      id: themeId,
      is_active: true,
      OR: visibilityFilters,
    },
    select: { id: true },
  });
  return Boolean(allowed);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    if (!session) {
      return NextResponse.json({ error: "Authentication required.", requiresAuth: true }, { status: 401 });
    }

    const { id } = await params;
    const themeId = parseThemeId(id);
    if (!themeId) return NextResponse.json({ error: "Invalid theme ID." }, { status: 400 });

    const allowed = await canReadTheme(themeId, BigInt(session.userId));
    if (!allowed) return NextResponse.json({ error: "Theme not found." }, { status: 404 });

    const theme = await prisma.theme.findUnique({ where: { id: themeId } });
    if (!theme) return NextResponse.json({ error: "Theme not found." }, { status: 404 });

    return NextResponse.json(serialize({ success: true, data: theme }), { status: 200 });
  } catch (err) {
    console.error("[bizcard/themes/[id] GET] Unhandled error:", err);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const { id } = await params;
    const themeId = parseThemeId(id);
    if (!themeId) return NextResponse.json({ error: "Invalid theme ID." }, { status: 400 });

    const existing = await prisma.theme.findUnique({ where: { id: themeId } });
    if (!existing) return NextResponse.json({ error: "Theme not found." }, { status: 404 });

    const ownsTheme = existing.exclusive_for === String(session.userId);
    if (!isPrivilegedRole(session.role) && !ownsTheme) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
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
    const tag = sanitizeString(body.tag ?? null);
    const priceRaw = body.price ?? undefined;
    const price = typeof priceRaw === "string" || typeof priceRaw === "number"
      ? Number(priceRaw)
      : undefined;
    const cssVariables = typeof body.css_variables === "object" && body.css_variables !== null
      ? JSON.stringify(body.css_variables)
      : undefined;

    if (name !== null && name.length > 100) {
      return NextResponse.json({ error: "name must be <= 100 characters." }, { status: 422 });
    }
    if (themePath !== null && themePath !== undefined && themePath.length > 64) {
      return NextResponse.json({ error: "theme_path must be <= 64 characters." }, { status: 422 });
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
    if (tag && tag.length > 10) {
      return NextResponse.json({ error: "tag must be <= 10 characters." }, { status: 422 });
    }
    if (price !== undefined && (Number.isNaN(price) || price < 0)) {
      return NextResponse.json({ error: "price must be a non-negative number." }, { status: 422 });
    }

    const updated = await prisma.theme.update({
      where: { id: themeId },
      data: {
        ...(name !== null && name !== undefined && { theme_name: name }),
        ...(themePath !== null && themePath !== undefined && { theme_path: themePath }),
        ...(previewImage !== null && previewImage !== undefined && { preview_image: previewImage }),
        ...(exclusiveFor !== null && exclusiveFor !== undefined && { exclusive_for: exclusiveFor }),
        ...(category !== null && category !== undefined && { category }),
        ...(tag !== null && tag !== undefined && { tag }),
        ...(price !== undefined && { price }),
        ...(cssVariables !== undefined && { css_variables: cssVariables }),
        ...(body.is_active !== undefined && { is_active: body.is_active === true }),
        updated_at: new Date(),
      },
    });

    return NextResponse.json(serialize({ success: true, data: updated }), { status: 200 });
  } catch (err) {
    console.error("[bizcard/themes/[id] PUT] Unhandled error:", err);
    if (typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "Theme name/path already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const { id } = await params;
    const themeId = parseThemeId(id);
    if (!themeId) return NextResponse.json({ error: "Invalid theme ID." }, { status: 400 });

    const themePath = (await prisma.theme.findUnique({ where: { id: themeId }, select: { theme_path: true } }))?.theme_path;
    const inUse = themePath
      ? await prisma.bizcard.count({ where: { bizcard_theme: themePath } })
      : 0;

    if (inUse > 0) {
      return NextResponse.json(
        { error: "Theme is currently in use and cannot be deleted." },
        { status: 409 }
      );
    }

    await prisma.theme.delete({ where: { id: themeId } });
    return NextResponse.json({ success: true, deleted: true }, { status: 200 });
  } catch (err) {
    console.error("[bizcard/themes/[id] DELETE] Unhandled error:", err);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
