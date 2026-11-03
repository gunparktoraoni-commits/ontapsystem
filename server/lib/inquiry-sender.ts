import { prisma } from "@/server/lib/prisma";

export type InquirySenderProfile = {
  user_id: string | null;
  is_registered: boolean;
  name: string | null;
  email: string | null;
  portfolio_alias: string | null;
};

type InquirySenderSource = {
  sender_user_id: bigint | null | string;
  visitor_name: string | null;
  visitor_email: string | null;
};

function formatUserName(firstName: string | null, lastName: string | null): string | null {
  const name = `${firstName ?? ""} ${lastName ?? ""}`.trim();
  return name || null;
}

function toSenderUserIdKey(senderUserId: bigint | null | string): string | null {
  if (senderUserId === null || senderUserId === undefined) return null;
  return typeof senderUserId === "bigint" ? senderUserId.toString() : String(senderUserId);
}

/** Batch-load registered sender profiles for inquiry rows. */
export async function loadInquirySenderProfiles(
  inquiries: InquirySenderSource[]
): Promise<Map<string, InquirySenderProfile>> {
  const senderIds = [
    ...new Set(
      inquiries
        .map((inq) => toSenderUserIdKey(inq.sender_user_id))
        .filter((id): id is string => id !== null)
    ),
  ];

  if (senderIds.length === 0) {
    return new Map();
  }

  const senderIdBigInts = senderIds.map((id) => BigInt(id));

  const [users, bizcards] = await Promise.all([
    prisma.user.findMany({
      where: { user_id: { in: senderIdBigInts } },
      select: {
        user_id: true,
        first_name: true,
        last_name: true,
        email: true,
      },
    }),
    prisma.bizcard.findMany({
      where: {
        user_id: { in: senderIdBigInts },
        deactivated_flag: false,
        url_alias: { not: null },
      },
      select: {
        user_id: true,
        url_alias: true,
        created_at: true,
      },
      orderBy: { created_at: "asc" },
    }),
  ]);

  const aliasByUserId = new Map<string, string>();
  for (const card of bizcards) {
    const key = card.user_id!.toString();
    if (!aliasByUserId.has(key) && card.url_alias) {
      aliasByUserId.set(key, card.url_alias);
    }
  }

  const profileMap = new Map<string, InquirySenderProfile>();
  for (const user of users) {
    const key = user.user_id.toString();
    profileMap.set(key, {
      user_id: key,
      is_registered: true,
      name: formatUserName(user.first_name, user.last_name),
      email: user.email,
      portfolio_alias: aliasByUserId.get(key) ?? null,
    });
  }

  return profileMap;
}

export function buildInquirySenderProfile(
  inquiry: InquirySenderSource,
  profileMap: Map<string, InquirySenderProfile>
): InquirySenderProfile {
  const senderKey = toSenderUserIdKey(inquiry.sender_user_id);
  const linked = senderKey ? profileMap.get(senderKey) : undefined;

  if (linked) {
    return linked;
  }

  return {
    user_id: senderKey,
    is_registered: false,
    name: inquiry.visitor_name,
    email: inquiry.visitor_email,
    portfolio_alias: null,
  };
}

export function enrichInquiriesWithSender<T extends InquirySenderSource>(
  inquiries: T[],
  profileMap: Map<string, InquirySenderProfile>
): Array<T & { sender: InquirySenderProfile }> {
  return inquiries.map((inquiry) => ({
    ...inquiry,
    sender: buildInquirySenderProfile(inquiry, profileMap),
  }));
}
