import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import {
  type SuperAdminContext,
  withSuperAdmin,
} from "@/lib/auth/superadmin-middleware";

const serialize = (obj: unknown): unknown =>
  JSON.parse(
    JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );

export const GET = withSuperAdmin(
  async (_req: NextRequest, _ctx: SuperAdminContext) => {
    const missions = await prisma.mission.findMany({
      orderBy: [{ sort_order: "asc" }, { target: "asc" }],
      include: {
        reward: {
          select: {
            id: true,
            name: true,
            type: true,
            status: true,
          },
        },
        _count: { select: { userRewards: true } },
      },
    });

    return NextResponse.json(
      serialize({
        success: true,
        data: {
          missions: missions.map((m) => ({
            id: m.id.toString(),
            key: m.key,
            title: m.title,
            description: m.description,
            requirement_type: m.requirement_type,
            target: m.target,
            status: m.status,
            sort_order: m.sort_order,
            reward_id: m.reward_id?.toString() ?? null,
            reward: m.reward
              ? {
                  id: m.reward.id.toString(),
                  name: m.reward.name,
                  type: m.reward.type,
                  status: m.reward.status,
                }
              : null,
            unlocked_count: m._count.userRewards,
            created_at: m.created_at.toISOString(),
            updated_at: m.updated_at?.toISOString() ?? null,
          })),
        },
      }),
    );
  },
  { errorMode: "superadmin" },
);
