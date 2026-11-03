import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  countAcceptedConnections,
  formatAssociateCountLabel,
  listMutualAssociates,
} from "@/server/lib/connections";

function normalizeAlias(raw: string): string {
  return decodeURIComponent(raw).trim().replace(/^\/+/, "").toLowerCase();
}
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ uri: string }> },
) {
  const ip = getClientIp(request);
  const rate = checkRateLimit("connections-summary", ip);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  const { uri } = await context.params;

  const alias = normalizeAlias(uri);

  if (!alias) {

    return NextResponse.json({ error: "Invalid portfolio." }, { status: 400 });
  }
  const bizcard = await prisma.bizcard.findFirst({
    where: {
      is_blank: false,
      deactivated_flag: false,
      OR: [
        { url_alias: alias },
        { user: { is: { custom_uri: alias } } },
      ],
    },
    orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
    select: {
      user_id: true,
      show_associate_count: true,
      show_mutual_associates: true,
    },
  });
  if (!bizcard?.user_id) {
    return NextResponse.json({ error: "Portfolio not found." }, { status: 404 });
  }

  const showAssociateCount = bizcard.show_associate_count === true;
  const showMutualAssociates = bizcard.show_mutual_associates === true;
  let associateCount: number | null = null;
  let associateCountLabel: string | null = null;
  if (showAssociateCount) {
    associateCount = await countAcceptedConnections(bizcard.user_id);
    associateCountLabel = formatAssociateCountLabel(associateCount);
  }

  let mutuals: Awaited<ReturnType<typeof listMutualAssociates>> = [];
  let viewerAuthenticated = false;
  let isOwner = false;
  if (showMutualAssociates) {
    const resolved = await resolveRequestSession(request, { tryRefresh: true });
    viewerAuthenticated = Boolean(resolved.session);
    if (resolved.session) {
      const viewerId = BigInt(resolved.session.userId);
      isOwner = viewerId === bizcard.user_id;
      if (!isOwner) {
        mutuals = await listMutualAssociates(viewerId, bizcard.user_id);
      }
    }
  }
  return NextResponse.json({
    success: true,
    data: {
      showAssociateCount,
      showMutualAssociates,
      associateCount,
      associateCountLabel,
      viewerAuthenticated,
      isOwner,
      mutuals,
    },
  });
}
