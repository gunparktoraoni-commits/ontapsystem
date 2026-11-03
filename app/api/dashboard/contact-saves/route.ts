import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { prismaAnalytics } from "@/server/lib/prisma-analytics";
import {
  resolveRequestSession,
  resolveEffectiveUserId,
  getClientIp,
} from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { formatTimeAgo } from "@/server/lib/analytics";

const serialize = (obj: unknown): unknown =>
  JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

type ContactSaveRow = {
  id: bigint;
  visitor_user_id: bigint | null;
  save_type: string;
  city: string | null;
  country: string | null;
  created_at: Date;
};

function formatLocation(city?: string | null, country?: string | null): string | null {
  const parts = [city?.trim(), country?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  try {
    const rateCheck = checkRateLimit("dashboard", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    const resolved = await resolveRequestSession(request, { tryRefresh: true });
    if (!resolved.session) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const userId = BigInt(resolveEffectiveUserId(resolved));
    const saves = (await prismaAnalytics.contactSave.findMany({
      where: { portfolio_owner_id: userId },
      orderBy: { created_at: "desc" },
      take: 100,
    })) as ContactSaveRow[];

    const userIds = saves
      .map((row: ContactSaveRow) => row.visitor_user_id)
      .filter((id: bigint | null): id is bigint => id != null);
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { user_id: { in: userIds } },
          select: {
            user_id: true,
            first_name: true,
            last_name: true,
            profile_url: true,
            custom_uri: true,
          },
        })
      : [];
    const userMap = new Map(users.map((user) => [user.user_id.toString(), user]));
    const now = new Date();

    return NextResponse.json(
      serialize({
        items: saves.map((row: ContactSaveRow) => {
          const visitor = row.visitor_user_id
            ? userMap.get(row.visitor_user_id.toString())
            : null;
          const name = visitor
            ? `${visitor.first_name ?? ""} ${visitor.last_name ?? ""}`.trim() || "Associate"
            : "Guest visitor";
          return {
            id: row.id.toString(),
            isAnonymous: !visitor,
            name,
            profileUrl: visitor?.profile_url ?? null,
            customUri: visitor?.custom_uri ?? null,
            saveType: row.save_type,
            location: formatLocation(row.city, row.country),
            createdAt: row.created_at.toISOString(),
            timeAgo: formatTimeAgo(row.created_at, now),
          };
        }),
      }),
    );
  } catch (err) {
    console.error("[dashboard/contact-saves] Unhandled error:", err);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
