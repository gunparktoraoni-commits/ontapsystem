import { prisma } from "@/server/lib/prisma";
import { generateBizcardSerialId, normalizeUrlAlias, generateUrlAlias } from "@/lib/bizcard/generator";

export { normalizeUrlAlias, generateUrlAlias };

export async function generateUniqueSerialId(userId: bigint): Promise<string> {
  for (let i = 0; i < 10; i += 1) {
    const serial = generateBizcardSerialId();
    const existing = await prisma.bizcard.findUnique({
      where: { serial_id: serial },
      select: { bizcard_id: true },
    });
    if (!existing) return serial;
  }

  return `${generateBizcardSerialId()}`;
}

export async function generateUniqueUrlAlias(params: {
  requestedAlias: string | null;
  firstName: string;
  lastName: string;
  userId: bigint;
  excludeBizcardId?: bigint;
}): Promise<string> {
  const base = params.requestedAlias
    ? normalizeUrlAlias(params.requestedAlias)
    : generateUrlAlias(params.firstName, params.lastName, params.userId);

  const root = base || `profile-${params.userId.toString()}`;
  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;

    const existing = await prisma.bizcard.findFirst({
      where: {
        url_alias: candidate,
        ...(params.excludeBizcardId ? { bizcard_id: { not: params.excludeBizcardId } } : {}),
      },
      select: { bizcard_id: true },
    });

    if (!existing) return candidate;
  }

  return `${root}-${Date.now().toString(36)}`;
}
