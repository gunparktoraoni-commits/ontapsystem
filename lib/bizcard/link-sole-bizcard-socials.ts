import { prisma } from "@/server/lib/prisma";

/**
 * When a user owns exactly one bizcard, attach any unlinked (or mis-linked)
 * Social rows to that card so the editor and portfolio share one source of truth.
 *
 * Returns the sole bizcard_id when linking ran, otherwise null.
 */
export async function linkUserSocialsToSoleBizcard(
  userId: bigint,
): Promise<bigint | null> {
  const bizcards = await prisma.bizcard.findMany({
    where: { user_id: userId },
    select: { bizcard_id: true },
    orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
    take: 2,
  });

  if (bizcards.length !== 1) return null;

  const soleBizcardId = bizcards[0].bizcard_id;

  await prisma.social.updateMany({
    where: {
      user_id: userId,
      deleted_at: null,
      OR: [{ bizcard_id: null }, { NOT: { bizcard_id: soleBizcardId } }],
    },
    data: { bizcard_id: soleBizcardId },
  });

  return soleBizcardId;
}

/**
 * All social rows owned by the user, ordered for the BizCard editor.
 */
export async function findUserSocialsForEditor(userId: bigint) {
  return prisma.social.findMany({
    where: { user_id: userId, deleted_at: null },
    orderBy: [{ display_order: "asc" }, { socials_id: "asc" }],
    select: {
      socials_id: true,
      platform: true,
      url: true,
      display_order: true,
      is_visible: true,
      bizcard_id: true,
    },
  });
}
