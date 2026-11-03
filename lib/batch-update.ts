import { prisma } from "@/server/lib/prisma";

export async function batchUpdateBizcardThemes(
  updates: Array<{ bizcardId: bigint; themePath: string | null }>
): Promise<void> {
  if (updates.length === 0) return;

  await prisma.$transaction(
    updates.map((entry) =>
      prisma.bizcard.update({
        where: { bizcard_id: entry.bizcardId },
        data: { bizcard_theme: entry.themePath },
      })
    )
  );
}

export async function batchInsertActivityLogs(
  logs: Array<{
    user_id: bigint;
    activity_type: string;
    reference_id?: bigint;
    metadata?: unknown;
  }>
): Promise<void> {
  if (logs.length === 0) return;

  await prisma.activityLog.createMany({
    data: logs.map((log) => ({
      user_id: log.user_id,
      activity_type: log.activity_type,
      reference_id: log.reference_id ?? null,
      meta: log.metadata === undefined ? null : JSON.stringify(log.metadata),
      created_at: new Date(),
    })),
  });
}

export async function batchDeleteUserNotifications(notificationIds: string[], userId: bigint): Promise<number> {
  if (notificationIds.length === 0) return 0;

  const result = await prisma.userNotification.deleteMany({
    where: {
      id: { in: notificationIds },
      user_id: userId,
    },
  });

  return result.count;
}
