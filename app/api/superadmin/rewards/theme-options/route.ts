import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import {
  type SuperAdminContext,
  withSuperAdmin,
} from "@/lib/auth/superadmin-middleware";
import { THEME_FAMILIES } from "@/lib/constants/theme-families";

const serialize = (obj: unknown): unknown =>
  JSON.parse(
    JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );

const SELECTABLE_TIERS = new Set(["basic", "standard", "premium"]);

function tagForTier(tier: string): string {
  if (tier === "premium") return "premium";
  if (tier === "standard") return "standard";
  return "free";
}

/**
 * Ensure Theme catalog rows exist for every Basic / Standard / Premium family
 * (default colorway). Mission Theme Access rewards require Theme.id FKs.
 */
async function ensureSelectableThemeCatalog() {
  const families = THEME_FAMILIES.filter((f) => SELECTABLE_TIERS.has(f.tier));

  for (const family of families) {
    const themePath = family.defaultThemeId;
    const existing = await prisma.theme.findUnique({
      where: { theme_path: themePath },
      select: { id: true, theme_name: true },
    });

    if (existing) {
      await prisma.theme.update({
        where: { id: existing.id },
        data: {
          is_active: true,
          category: family.tier,
        },
      });
      continue;
    }

    // theme_name is unique — fall back if the display name is already taken.
    let themeName = family.name;
    const nameTaken = await prisma.theme.findUnique({
      where: { theme_name: themeName },
      select: { id: true },
    });
    if (nameTaken) {
      themeName = `${family.name} (${themePath})`;
    }

    await prisma.theme.create({
      data: {
        theme_name: themeName,
        theme_path: themePath,
        tag: tagForTier(family.tier),
        category: family.tier,
        price: 0,
        is_active: true,
      },
    });
  }
}

export const GET = withSuperAdmin(
  async (_req: NextRequest, _ctx: SuperAdminContext) => {
    await ensureSelectableThemeCatalog();

    const familyByDefaultId = new Map(
      THEME_FAMILIES.filter((f) => SELECTABLE_TIERS.has(f.tier)).map((f) => [
        f.defaultThemeId,
        f,
      ]),
    );

    const themes = await prisma.theme.findMany({
      where: {
        is_active: true,
        // Paid marketplace SKUs only — free / standard / premium stay selectable.
        NOT: { tag: { equals: "paid" } },
        theme_path: {
          in: Array.from(familyByDefaultId.keys()),
        },
      },
      orderBy: [{ category: "asc" }, { theme_name: "asc" }],
      select: {
        id: true,
        theme_name: true,
        theme_path: true,
        tag: true,
        price: true,
        preview_image: true,
        preview_images: true,
        category: true,
      },
    });

    const parsePreviewImages = (raw: string | null): string[] => {
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
      } catch {
        return [];
      }
    };

    return NextResponse.json(
      serialize({
        success: true,
        data: {
          themes: themes.map((t) => {
            const family = familyByDefaultId.get(t.theme_path);
            const gallery = parsePreviewImages(t.preview_images);
            const previewImage = t.preview_image || gallery[0] || null;
            return {
              id: t.id.toString(),
              theme_name: family?.name ?? t.theme_name,
              theme_path: t.theme_path,
              tag: t.tag,
              tier: family?.tier ?? t.category ?? t.tag,
              price: Number(t.price),
              preview_image: previewImage,
              description: family?.description ?? null,
            };
          }),
        },
      }),
    );
  },
  { errorMode: "superadmin" },
);
