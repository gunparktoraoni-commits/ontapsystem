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
  MISSION_REQUIREMENT_QUALIFIED,
  ensureUniqueMissionKey,
  slugifyMissionKey,
} from "@/server/lib/growth-rewards";

const serialize = (obj: unknown): unknown =>
  JSON.parse(
    JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );

const createSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  instruction: z.string().trim().max(5000).optional().nullable(),
  requirement_type: z.literal(MISSION_REQUIREMENT_QUALIFIED).optional(),
  target: z.number().int().positive(),
  sort_order: z.number().int().min(0).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  reward_name: z.string().trim().min(2).max(120),
  reward_description: z.string().trim().max(2000).optional().nullable(),
  reward_type: z.enum([
    REWARD_TYPE_PREMIUM,
    REWARD_TYPE_THEME,
    REWARD_TYPE_FEATURE,
  ] as [string, ...string[]]),
  duration_days: z.number().int().positive().optional().nullable(),
  theme_id: z.union([z.string(), z.number()]).optional().nullable(),
  feature_key: z.string().trim().max(100).optional().nullable(),
  reward_status: z.enum([REWARD_STATUS_ACTIVE, REWARD_STATUS_INACTIVE]).optional(),
});

export const GET = withSuperAdmin(
  async (_req: NextRequest, _ctx: SuperAdminContext) => {
    const missions = await prisma.mission.findMany({
      orderBy: [{ sort_order: "asc" }, { target: "asc" }],
      include: {
        reward: {
          include: {
            theme: {
              select: {
                id: true,
                theme_name: true,
                theme_path: true,
                preview_image: true,
                tag: true,
              },
            },
          },
        },
        _count: { select: { userRewards: true } },
      },
    });

    return NextResponse.json(
      serialize({
        success: true,
        data: {
          mission_rewards: missions.map((m) => ({
            id: m.id.toString(),
            key: m.key,
            title: m.title,
            description: m.description,
            instruction: m.instruction,
            requirement_type: m.requirement_type,
            target: m.target,
            status: m.status,
            sort_order: m.sort_order,
            unlocked_count: m._count.userRewards,
            reward: m.reward
              ? {
                  id: m.reward.id.toString(),
                  name: m.reward.name,
                  description: m.reward.description,
                  type: m.reward.type,
                  status: m.reward.status,
                  duration_days: m.reward.duration_days,
                  theme_id: m.reward.theme_id?.toString() ?? null,
                  theme_name: m.reward.theme?.theme_name ?? null,
                  theme_path: m.reward.theme?.theme_path ?? null,
                  theme_preview_image: m.reward.theme?.preview_image ?? null,
                  theme_tag: m.reward.theme?.tag ?? null,
                  feature_key: m.reward.feature_key,
                }
              : null,
            created_at: m.created_at.toISOString(),
            updated_at: m.updated_at?.toISOString() ?? null,
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
    if (!ALLOWED_REWARD_TYPES.has(data.reward_type)) {
      return NextResponse.json(
        { success: false, error: { message: "Unsupported reward type." } },
        { status: 400 },
      );
    }

    if (data.reward_type === REWARD_TYPE_PREMIUM) {
      if (!data.duration_days || data.duration_days < 1) {
        return NextResponse.json(
          {
            success: false,
            error: { message: "Premium access requires duration_days > 0." },
          },
          { status: 400 },
        );
      }
    }

    let themeId: bigint | null = null;
    if (data.reward_type === REWARD_TYPE_THEME) {
      if (data.theme_id == null || data.theme_id === "") {
        return NextResponse.json(
          { success: false, error: { message: "Theme access requires theme_id." } },
          { status: 400 },
        );
      }
      themeId = BigInt(data.theme_id);
      const theme = await prisma.theme.findUnique({
        where: { id: themeId },
        select: { id: true },
      });
      if (!theme) {
        return NextResponse.json(
          { success: false, error: { message: "Selected theme does not exist." } },
          { status: 400 },
        );
      }
    }

    const key = await ensureUniqueMissionKey(slugifyMissionKey(data.title));
    const missionStatus = data.status ?? "active";
    const rewardStatus = data.reward_status ?? REWARD_STATUS_ACTIVE;

    const created = await prisma.$transaction(async (tx) => {
      const reward = await tx.reward.create({
        data: {
          name: data.reward_name,
          description: data.reward_description ?? null,
          type: data.reward_type,
          status: rewardStatus,
          duration_days:
            data.reward_type === REWARD_TYPE_PREMIUM
              ? data.duration_days ?? null
              : null,
          theme_id: data.reward_type === REWARD_TYPE_THEME ? themeId : null,
          feature_key:
            data.reward_type === REWARD_TYPE_FEATURE
              ? data.feature_key?.trim() || null
              : null,
        },
      });

      const mission = await tx.mission.create({
        data: {
          key,
          title: data.title,
          description: data.description ?? null,
          instruction: data.instruction ?? null,
          requirement_type:
            data.requirement_type ?? MISSION_REQUIREMENT_QUALIFIED,
          target: data.target,
          status: missionStatus,
          sort_order: data.sort_order ?? data.target,
          reward_id: reward.id,
        },
      });

      return { mission, reward };
    });

    return NextResponse.json(
      serialize({
        success: true,
        data: {
          mission_id: created.mission.id.toString(),
          reward_id: created.reward.id.toString(),
          key: created.mission.key,
        },
      }),
      { status: 201 },
    );
  },
  { errorMode: "superadmin" },
);
