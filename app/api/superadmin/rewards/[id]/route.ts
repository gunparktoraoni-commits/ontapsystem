import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/lib/prisma";
import { withSuperAdmin } from "@/lib/auth/superadmin-middleware";
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

const patchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  type: z
    .enum([
      REWARD_TYPE_PREMIUM,
      REWARD_TYPE_THEME,
      REWARD_TYPE_FEATURE,
    ] as [string, ...string[]])
    .optional(),
  status: z.enum([REWARD_STATUS_ACTIVE, REWARD_STATUS_INACTIVE]).optional(),
  duration_days: z.number().int().positive().optional().nullable(),
  theme_id: z.union([z.string(), z.number()]).optional().nullable(),
  feature_key: z.string().trim().max(100).optional().nullable(),
});

type RouteContext = Record<string, unknown> & { params: Promise<{ id: string }> };

export const GET = withSuperAdmin(
  async (_req: NextRequest, ctx: RouteContext) => {
    const { id } = await ctx.params;
    const rewardId = BigInt(id);
    const reward = await prisma.reward.findUnique({
      where: { id: rewardId },
      include: {
        theme: { select: { id: true, theme_name: true, theme_path: true } },
        _count: { select: { userRewards: true, missions: true } },
      },
    });
    if (!reward) {
      return NextResponse.json(
        { success: false, error: { message: "Reward not found." } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      serialize({
        success: true,
        data: {
          reward: {
            ...reward,
            id: reward.id.toString(),
            theme_id: reward.theme_id?.toString() ?? null,
          },
        },
      }),
    );
  },
  { errorMode: "superadmin" },
);

export const PATCH = withSuperAdmin(
  async (req: NextRequest, ctx: RouteContext) => {
    const { id } = await ctx.params;
    const rewardId = BigInt(id);

    const existing = await prisma.reward.findUnique({
      where: { id: rewardId },
    });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: { message: "Reward not found." } },
        { status: 404 },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: { message: "Invalid JSON body." } },
        { status: 400 },
      );
    }

    const parsed = patchSchema.safeParse(body);
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
    const nextType = data.type ?? existing.type;

    if (data.type && !ALLOWED_REWARD_TYPES.has(data.type)) {
      return NextResponse.json(
        { success: false, error: { message: "Unsupported reward type." } },
        { status: 400 },
      );
    }

    if (nextType === REWARD_TYPE_PREMIUM) {
      const days =
        data.duration_days !== undefined
          ? data.duration_days
          : existing.duration_days;
      if (!days || days < 1) {
        return NextResponse.json(
          {
            success: false,
            error: {
              message: "Premium access requires a positive duration_days value.",
            },
          },
          { status: 400 },
        );
      }
    }

    let nextThemeId =
      data.theme_id !== undefined
        ? data.theme_id == null || data.theme_id === ""
          ? null
          : BigInt(data.theme_id)
        : existing.theme_id;

    if (nextType === REWARD_TYPE_THEME) {
      if (!nextThemeId) {
        return NextResponse.json(
          {
            success: false,
            error: { message: "Theme access requires a theme_id." },
          },
          { status: 400 },
        );
      }
      const theme = await prisma.theme.findUnique({
        where: { id: nextThemeId },
        select: { id: true },
      });
      if (!theme) {
        return NextResponse.json(
          { success: false, error: { message: "Selected theme does not exist." } },
          { status: 400 },
        );
      }
    } else if (data.type && data.type !== REWARD_TYPE_THEME) {
      nextThemeId = null;
    }

    const updated = await prisma.reward.update({
      where: { id: rewardId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        duration_days:
          nextType === REWARD_TYPE_PREMIUM
            ? data.duration_days !== undefined
              ? data.duration_days
              : existing.duration_days
            : null,
        theme_id: nextType === REWARD_TYPE_THEME ? nextThemeId : null,
        feature_key:
          nextType === REWARD_TYPE_FEATURE
            ? data.feature_key !== undefined
              ? data.feature_key?.trim() || null
              : existing.feature_key
            : null,
        updated_at: new Date(),
      },
    });

    return NextResponse.json(
      serialize({
        success: true,
        data: { reward: { id: updated.id.toString(), status: updated.status } },
      }),
    );
  },
  { errorMode: "superadmin" },
);
