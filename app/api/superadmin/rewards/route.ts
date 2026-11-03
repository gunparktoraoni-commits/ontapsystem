import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/lib/prisma";
import {
  type SuperAdminContext,
  withSuperAdmin,
} from "@/lib/auth/superadmin-middleware";
import {
  ALLOWED_REWARD_TYPES,
  REWARD_STATUS_ACTIVE,
  REWARD_STATUS_INACTIVE,
  REWARD_TYPE_FEATURE,
  REWARD_TYPE_PREMIUM,
  REWARD_TYPE_THEME,
} from "@/server/lib/growth-rewards";

const serialize = (obj: unknown): unknown =>
  JSON.parse(
    JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  type: z.enum([
    REWARD_TYPE_PREMIUM,
    REWARD_TYPE_THEME,
    REWARD_TYPE_FEATURE,
  ] as [string, ...string[]]),
  status: z.enum([REWARD_STATUS_ACTIVE, REWARD_STATUS_INACTIVE]).optional(),
  duration_days: z.number().int().positive().optional().nullable(),
  theme_id: z.union([z.string(), z.number()]).optional().nullable(),
  feature_key: z.string().trim().max(100).optional().nullable(),
});

async function validateRewardConfig(input: {
  type: string;
  duration_days?: number | null;
  theme_id?: string | number | null;
  feature_key?: string | null;
}) {
  if (!ALLOWED_REWARD_TYPES.has(input.type)) {
    return { ok: false as const, message: "Unsupported reward type." };
  }

  if (input.type === REWARD_TYPE_PREMIUM) {
    if (!input.duration_days || input.duration_days < 1) {
      return {
        ok: false as const,
        message: "Premium access requires a positive duration_days value.",
      };
    }
  }

  if (input.type === REWARD_TYPE_THEME) {
    if (input.theme_id == null || input.theme_id === "") {
      return {
        ok: false as const,
        message: "Theme access requires a theme_id.",
      };
    }
    const theme = await prisma.theme.findUnique({
      where: { id: BigInt(input.theme_id) },
      select: { id: true, is_active: true },
    });
    if (!theme) {
      return { ok: false as const, message: "Selected theme does not exist." };
    }
  }

  return { ok: true as const };
}

export const GET = withSuperAdmin(
  async (_req: NextRequest, _ctx: SuperAdminContext) => {
    const rewards = await prisma.reward.findMany({
      orderBy: { created_at: "desc" },
      include: {
        theme: { select: { id: true, theme_name: true, theme_path: true } },
        _count: { select: { userRewards: true, missions: true } },
      },
    });

    return NextResponse.json(
      serialize({
        success: true,
        data: {
          rewards: rewards.map((r) => ({
            id: r.id.toString(),
            name: r.name,
            description: r.description,
            type: r.type,
            status: r.status,
            duration_days: r.duration_days,
            theme_id: r.theme_id?.toString() ?? null,
            theme_name: r.theme?.theme_name ?? null,
            theme_path: r.theme?.theme_path ?? null,
            feature_key: r.feature_key,
            unlocked_count: r._count.userRewards,
            mission_count: r._count.missions,
            created_at: r.created_at.toISOString(),
            updated_at: r.updated_at?.toISOString() ?? null,
          })),
        },
      }),
    );
  },
  { errorMode: "superadmin" },
);

export const POST = withSuperAdmin(
  async (req: NextRequest, _ctx: SuperAdminContext) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: { message: "Invalid JSON body." } },
        { status: 400 },
      );
    }

    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            message: parsed.error.issues.map((i) => i.message).join(" "),
          },
        },
        { status: 400 },
      );
    }

    const data = parsed.data;
    const config = await validateRewardConfig(data);
    if (!config.ok) {
      return NextResponse.json(
        { success: false, error: { message: config.message } },
        { status: 400 },
      );
    }

    const created = await prisma.reward.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        type: data.type,
        status: data.status ?? REWARD_STATUS_ACTIVE,
        duration_days:
          data.type === REWARD_TYPE_PREMIUM ? data.duration_days ?? null : null,
        theme_id:
          data.type === REWARD_TYPE_THEME && data.theme_id != null
            ? BigInt(data.theme_id)
            : null,
        feature_key:
          data.type === REWARD_TYPE_FEATURE
            ? data.feature_key?.trim() || null
            : null,
      },
    });

    return NextResponse.json(
      serialize({
        success: true,
        data: { reward: { id: created.id.toString() } },
      }),
      { status: 201 },
    );
  },
  { errorMode: "superadmin" },
);
