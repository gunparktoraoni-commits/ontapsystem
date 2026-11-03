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
  title: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  instruction: z.string().trim().max(5000).optional().nullable(),
  target: z.number().int().positive().optional(),
  sort_order: z.number().int().min(0).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  reward_name: z.string().trim().min(2).max(120).optional(),
  reward_description: z.string().trim().max(2000).optional().nullable(),
  reward_type: z
    .enum([
      REWARD_TYPE_PREMIUM,
      REWARD_TYPE_THEME,
      REWARD_TYPE_FEATURE,
    ] as [string, ...string[]])
    .optional(),
  duration_days: z.number().int().positive().optional().nullable(),
  theme_id: z.union([z.string(), z.number()]).optional().nullable(),
  feature_key: z.string().trim().max(100).optional().nullable(),
  reward_status: z
    .enum([REWARD_STATUS_ACTIVE, REWARD_STATUS_INACTIVE])
    .optional(),
});

type RouteContext = Record<string, unknown> & {
  params: Promise<{ missionId: string }>;
};

export const PATCH = withSuperAdmin(
  async (req: NextRequest, ctx: RouteContext) => {
    const { missionId: missionIdParam } = await ctx.params;
    const missionId = BigInt(missionIdParam);

    const existing = await prisma.mission.findUnique({
      where: { id: missionId },
      include: { reward: true },
    });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: { message: "Mission not found." } },
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
    const now = new Date();

    // Activate / deactivate only — skip reward-type field validation.
    const patchKeys = Object.keys(data);
    const isStatusOnly =
      patchKeys.length > 0 &&
      patchKeys.every((key) => key === "status" || key === "reward_status");

    if (isStatusOnly) {
      await prisma.$transaction(async (tx) => {
        if (data.status !== undefined) {
          await tx.mission.update({
            where: { id: missionId },
            data: { status: data.status, updated_at: now },
          });
        }
        if (
          data.reward_status !== undefined &&
          existing.reward_id &&
          existing.reward
        ) {
          await tx.reward.update({
            where: { id: existing.reward_id },
            data: { status: data.reward_status, updated_at: now },
          });
        }
      });

      return NextResponse.json(
        serialize({
          success: true,
          data: { mission_id: missionId.toString() },
        }),
      );
    }

    const nextType = data.reward_type ?? existing.reward?.type ?? REWARD_TYPE_PREMIUM;

    if (data.reward_type && !ALLOWED_REWARD_TYPES.has(data.reward_type)) {
      return NextResponse.json(
        { success: false, error: { message: "Unsupported reward type." } },
        { status: 400 },
      );
    }

    if (nextType === REWARD_TYPE_PREMIUM) {
      const days =
        data.duration_days !== undefined
          ? data.duration_days
          : existing.reward?.duration_days;
      if (!days || days < 1) {
        return NextResponse.json(
          {
            success: false,
            error: { message: "Premium access requires duration_days > 0." },
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
        : existing.reward?.theme_id ?? null;

    if (nextType === REWARD_TYPE_THEME) {
      if (!nextThemeId) {
        return NextResponse.json(
          { success: false, error: { message: "Theme access requires theme_id." } },
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
    } else {
      nextThemeId = null;
    }

    await prisma.$transaction(async (tx) => {
      await tx.mission.update({
        where: { id: missionId },
        data: {
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.description !== undefined
            ? { description: data.description }
            : {}),
          ...(data.instruction !== undefined
            ? { instruction: data.instruction }
            : {}),
          ...(data.target !== undefined ? { target: data.target } : {}),
          ...(data.sort_order !== undefined
            ? { sort_order: data.sort_order }
            : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          updated_at: now,
        },
      });

      const rewardData = {
        ...(data.reward_name !== undefined ? { name: data.reward_name } : {}),
        ...(data.reward_description !== undefined
          ? { description: data.reward_description }
          : {}),
        ...(data.reward_type !== undefined ? { type: data.reward_type } : {}),
        ...(data.reward_status !== undefined
          ? { status: data.reward_status }
          : {}),
        duration_days:
          nextType === REWARD_TYPE_PREMIUM
            ? data.duration_days !== undefined
              ? data.duration_days
              : existing.reward?.duration_days ?? null
            : null,
        theme_id: nextType === REWARD_TYPE_THEME ? nextThemeId : null,
        feature_key:
          nextType === REWARD_TYPE_FEATURE
            ? data.feature_key !== undefined
              ? data.feature_key?.trim() || null
              : existing.reward?.feature_key ?? null
            : null,
        updated_at: now,
      };

      if (existing.reward_id && existing.reward) {
        await tx.reward.update({
          where: { id: existing.reward_id },
          data: rewardData,
        });
      } else if (data.reward_name && data.reward_type) {
        const reward = await tx.reward.create({
          data: {
            name: data.reward_name,
            description: data.reward_description ?? null,
            type: data.reward_type,
            status: data.reward_status ?? REWARD_STATUS_ACTIVE,
            duration_days:
              nextType === REWARD_TYPE_PREMIUM ? data.duration_days ?? null : null,
            theme_id: nextType === REWARD_TYPE_THEME ? nextThemeId : null,
            feature_key:
              nextType === REWARD_TYPE_FEATURE
                ? data.feature_key?.trim() || null
                : null,
          },
        });
        await tx.mission.update({
          where: { id: missionId },
          data: { reward_id: reward.id, updated_at: now },
        });
      }
    });

    return NextResponse.json(
      serialize({
        success: true,
        data: { mission_id: missionId.toString() },
      }),
    );
  },
  { errorMode: "superadmin" },
);
