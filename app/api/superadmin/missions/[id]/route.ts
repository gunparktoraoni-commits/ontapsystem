import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/lib/prisma";
import { withSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { REWARD_STATUS_ACTIVE } from "@/server/lib/growth-rewards";

const serialize = (obj: unknown): unknown =>
  JSON.parse(
    JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );

const patchSchema = z.object({
  title: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  target: z.number().int().positive().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  sort_order: z.number().int().min(0).optional(),
  reward_id: z.union([z.string(), z.number(), z.null()]).optional(),
});

type RouteContext = Record<string, unknown> & { params: Promise<{ id: string }> };

export const PATCH = withSuperAdmin(
  async (req: NextRequest, ctx: RouteContext) => {
    const { id } = await ctx.params;
    const missionId = BigInt(id);

    const existing = await prisma.mission.findUnique({
      where: { id: missionId },
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
    let nextRewardId =
      data.reward_id === undefined
        ? undefined
        : data.reward_id === null || data.reward_id === ""
          ? null
          : BigInt(data.reward_id);

    if (nextRewardId != null) {
      const reward = await prisma.reward.findUnique({
        where: { id: nextRewardId },
        select: { id: true, status: true },
      });
      if (!reward) {
        return NextResponse.json(
          { success: false, error: { message: "Reward not found." } },
          { status: 400 },
        );
      }
      const isNewAssignment =
        existing.reward_id == null || existing.reward_id !== nextRewardId;
      if (isNewAssignment && reward.status !== REWARD_STATUS_ACTIVE) {
        return NextResponse.json(
          {
            success: false,
            error: {
              message: "Only active rewards can be attached to a mission.",
            },
          },
          { status: 400 },
        );
      }
    }

    const updated = await prisma.mission.update({
      where: { id: missionId },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.target !== undefined ? { target: data.target } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.sort_order !== undefined
          ? { sort_order: data.sort_order }
          : {}),
        ...(nextRewardId !== undefined ? { reward_id: nextRewardId } : {}),
        updated_at: new Date(),
      },
    });

    return NextResponse.json(
      serialize({
        success: true,
        data: {
          mission: {
            id: updated.id.toString(),
            reward_id: updated.reward_id?.toString() ?? null,
            status: updated.status,
          },
        },
      }),
    );
  },
  { errorMode: "superadmin" },
);
