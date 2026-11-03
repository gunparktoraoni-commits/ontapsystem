import { prisma } from "@/server/lib/prisma";

export async function getAcceptedAssociateIds(userId: bigint): Promise<bigint[]> {
  const rows = await prisma.connection.findMany({
    where: {
      status: "accepted",
      OR: [{ requester_user_id: userId }, { recipient_user_id: userId }],
    },
    select: { requester_user_id: true, recipient_user_id: true },
  });

  return rows.map((row) =>
    row.requester_user_id === userId ? row.recipient_user_id : row.requester_user_id,
  );
}
