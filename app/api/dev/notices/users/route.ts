import { NextRequest, NextResponse } from "next/server";
import { withDashboardSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { prisma } from "@/server/lib/prisma";

/** Lightweight user picker for notice targeting. Supports search `q` or batch `ids`. */
export const GET = withDashboardSuperAdmin(async (request: NextRequest) => {
  try {
    const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
    const idsParam = (request.nextUrl.searchParams.get("ids") ?? "").trim();

    if (idsParam) {
      const ids = idsParam
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 500)
        .map((id) => {
          try {
            return BigInt(id);
          } catch {
            return null;
          }
        })
        .filter((id): id is bigint => id != null);

      if (!ids.length) {
        return NextResponse.json({ success: true, data: { users: [] } });
      }

      const users = await prisma.user.findMany({
        where: { user_id: { in: ids } },
        select: {
          user_id: true,
          email: true,
          first_name: true,
          last_name: true,
          role: true,
          serial_id: true,
        },
      });
      const byId = new Map(
        users.map((user) => [
          user.user_id.toString(),
          {
            id: user.user_id.toString(),
            email: user.email,
            name: [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || user.email,
            role: user.role,
            serialId: user.serial_id,
          },
        ]),
      );

      return NextResponse.json({
        success: true,
        data: {
          users: ids
            .map((id) => byId.get(id.toString()))
            .filter((user): user is NonNullable<typeof user> => Boolean(user)),
        },
      });
    }

    if (q.length < 2) {
      return NextResponse.json({ success: true, data: { users: [] } });
    }

    const users = await prisma.user.findMany({
      where: {
        is_active: true,
        deactivated_flag: false,
        deleted_at: null,
        OR: [
          { email: { contains: q } },
          { first_name: { contains: q } },
          { last_name: { contains: q } },
          { serial_id: { contains: q } },
        ],
      },
      select: {
        user_id: true,
        email: true,
        first_name: true,
        last_name: true,
        role: true,
        serial_id: true,
      },
      take: 20,
      orderBy: { updated_at: "desc" },
    });

    return NextResponse.json({
      success: true,
      data: {
        users: users.map((user) => ({
          id: user.user_id.toString(),
          email: user.email,
          name: [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || user.email,
          role: user.role,
          serialId: user.serial_id,
        })),
      },
    });
  } catch (error) {
    console.error("[NOTICE_BOARD_API][dev/notices/users]", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to search users.",
        code: "DEV_NOTICE_USERS_LOOKUP_FAILED",
        tag: "[NOTICE_BOARD_API]",
      },
      { status: 500 },
    );
  }
});
