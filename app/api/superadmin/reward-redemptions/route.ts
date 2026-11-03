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
  async (req: NextRequest, _ctx: SuperAdminContext) => {
    const page = Math.max(
      1,
      Number(req.nextUrl.searchParams.get("page") ?? "1") || 1,
    );
    const limit = Math.min(
      100,
      Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? "20") || 20),
    );
    const skip = (page - 1) * limit;

    const [total, rows] = await Promise.all([
      prisma.userReward.count(),
      prisma.userReward.findMany({
        orderBy: { unlocked_at: "desc" },
        skip,
        take: limit,
        include: {
          user: {
            select: {
              user_id: true,
              first_name: true,
              last_name: true,
              email: true,
            },
          },
          reward: { select: { id: true, name: true, type: true } },
          mission: { select: { id: true, key: true, title: true } },
        },
      }),
    ]);

    return NextResponse.json(
      serialize({
        success: true,
        data: {
          redemptions: rows.map((row) => ({
            id: row.id.toString(),
            status: row.status,
            unlocked_at: row.unlocked_at.toISOString(),
            claimed_at: row.claimed_at?.toISOString() ?? null,
            user: {
              id: row.user.user_id.toString(),
              name: [row.user.first_name, row.user.last_name]
                .filter(Boolean)
                .join(" ")
                .trim(),
              email: row.user.email,
            },
            reward: {
              id: row.reward.id.toString(),
              name: row.reward.name,
              type: row.reward.type,
            },
            mission: row.mission
              ? {
                  id: row.mission.id.toString(),
                  key: row.mission.key,
                  title: row.mission.title,
                }
              : null,
          })),
          pagination: {
            page,
            limit,
            total,
            pages: Math.max(1, Math.ceil(total / limit)),
          },
        },
      }),
    );
  },
  { errorMode: "superadmin" },
);
