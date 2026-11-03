import { prisma } from "@/server/lib/prisma";

/** Minutes without activity before a user is considered offline. */
export const USER_ONLINE_CUTOFF_MINUTES = 5;

const PRESENCE_TOUCH_INTERVAL_MS = 60 * 1000;
const lastPresenceTouch = new Map<string, number>();

function parseDeviceInfo(userAgent: string | null | undefined): {
  deviceType: string;
  browser: string;
  os: string;
} {
  const ua = (userAgent ?? "").toLowerCase();

  let deviceType = "desktop";
  if (/(iphone|ipad|android|mobile)/.test(ua)) {
    deviceType = "mobile";
  } else if (/(tablet)/.test(ua)) {
    deviceType = "tablet";
  }

  let browser = "Unknown";
  if (ua.includes("edg/")) browser = "Edge";
  else if (ua.includes("chrome/")) browser = "Chrome";
  else if (ua.includes("safari/") && !ua.includes("chrome/")) browser = "Safari";
  else if (ua.includes("firefox/")) browser = "Firefox";

  let os = "Unknown";
  if (ua.includes("windows")) os = "Windows";
  else if (ua.includes("mac os")) os = "macOS";
  else if (ua.includes("android")) os = "Android";
  else if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ios")) os = "iOS";
  else if (ua.includes("linux")) os = "Linux";

  return { deviceType, browser, os };
}

export function getOnlineCutoffDate(now = new Date()): Date {
  return new Date(now.getTime() - USER_ONLINE_CUTOFF_MINUTES * 60 * 1000);
}

export function isUserCurrentlyOnline(input: {
  is_online?: boolean | null;
  last_active?: Date | string | null;
}, now = new Date()): boolean {
  const lastActiveAt =
    input.last_active instanceof Date
      ? input.last_active
      : typeof input.last_active === "string" && input.last_active.trim()
        ? new Date(input.last_active)
        : null;

  // Freshness of last_active is the sole source of truth. Stale is_online flags
  // must never keep a user marked online after the activity cutoff.
  if (!lastActiveAt || Number.isNaN(lastActiveAt.getTime())) {
    return false;
  }

  return lastActiveAt.getTime() >= getOnlineCutoffDate(now).getTime();
}

export async function syncUserActivityPresence(params: {
  userId: bigint | number;
  sessionId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<void> {
  const now = params.now ?? new Date();
  const userId = typeof params.userId === "bigint" ? params.userId : BigInt(params.userId);
  const sessionIdRaw = params.sessionId?.trim() ?? "";
  let currentSessionId: bigint | null = null;
  if (/^\d+$/.test(sessionIdRaw)) {
    try {
      currentSessionId = BigInt(sessionIdRaw);
    } catch {
      currentSessionId = null;
    }
  }

  const ip = params.ipAddress?.trim() ?? "";
  const ipPrefix = (() => {
    if (!ip || ip === "unknown") return "unknown";
    if (ip.includes(".")) {
      const parts = ip.split(".");
      return parts.length >= 2 ? `${parts[0]}.${parts[1]}.x.x` : "unknown";
    }
    if (ip.includes(":")) {
      const parts = ip.split(":").filter(Boolean);
      return parts.length >= 2 ? `${parts[0]}:${parts[1]}:x:x` : "unknown";
    }
    return "unknown";
  })();

  await prisma.userActivity.upsert({
    where: { user_id: userId },
    create: {
      user_id: userId,
      last_active: now,
      current_session_id: currentSessionId,
      ip_prefix: ipPrefix,
      user_agent: (params.userAgent ?? "").slice(0, 512) || null,
      updated_at: now,
    },
    update: {
      last_active: now,
      current_session_id: currentSessionId,
      ip_prefix: ipPrefix,
      user_agent: (params.userAgent ?? "").slice(0, 512) || null,
      updated_at: now,
    },
  });
}

export async function recordUserLoginPresence(params: {
  userId: number;
  sessionId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  location?: string | null;
}): Promise<void> {
  const sessionId = params.sessionId.trim();
  if (!sessionId) return;

  const now = new Date();
  const { deviceType, browser, os } = parseDeviceInfo(params.userAgent);
  const ip = params.ipAddress?.trim().slice(0, 45) ?? null;
  const location = params.location?.trim().slice(0, 255) ?? null;

  await prisma.$transaction([
    prisma.user.update({
      where: { user_id: BigInt(params.userId) },
      data: {
        is_online: true,
        last_active: now,
      },
    }),
    prisma.activeSession.upsert({
      where: { session_id: sessionId },
      update: {
        device_type: deviceType,
        browser,
        os,
        ip_address: ip,
        location,
        last_activity: now,
      },
      create: {
        session_id: sessionId,
        user_id: BigInt(params.userId),
        device_type: deviceType,
        browser,
        os,
        ip_address: ip,
        location,
        created_at: now,
        last_activity: now,
      },
    }),
  ]);

  await syncUserActivityPresence({
    userId: params.userId,
    sessionId,
    ipAddress: ip,
    userAgent: params.userAgent,
    now,
  });
}

export async function touchUserPresence(userId: number, sessionId: string): Promise<void> {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) return;

  const throttleKey = `${userId}:${normalizedSessionId}`;
  const nowMs = Date.now();
  const lastTouch = lastPresenceTouch.get(throttleKey) ?? 0;
  if (nowMs - lastTouch < PRESENCE_TOUCH_INTERVAL_MS) {
    return;
  }
  lastPresenceTouch.set(throttleKey, nowMs);

  const now = new Date();
  const cutoff = getOnlineCutoffDate(now);

  await prisma.$transaction([
    prisma.user.update({
      where: { user_id: BigInt(userId) },
      data: {
        is_online: true,
        last_active: now,
      },
    }),
    prisma.activeSession.upsert({
      where: { session_id: normalizedSessionId },
      update: {
        user_id: BigInt(userId),
        last_activity: now,
      },
      create: {
        session_id: normalizedSessionId,
        user_id: BigInt(userId),
        device_type: "unknown",
        browser: "Unknown",
        os: "Unknown",
        created_at: now,
        last_activity: now,
      },
    }),
  ]);

  await syncUserActivityPresence({
    userId,
    sessionId: normalizedSessionId,
    now,
  });

  // Mark stale sessions offline when they exceed the activity cutoff.
  await prisma.activeSession.deleteMany({
    where: {
      user_id: BigInt(userId),
      last_activity: { lt: cutoff },
    },
  });

  await reconcileUserOnlineStatus(BigInt(userId), now);
}

export async function recordUserLogoutPresence(sessionId: string): Promise<void> {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) return;

  const session = await prisma.activeSession.findUnique({
    where: { session_id: normalizedSessionId },
    select: { user_id: true },
  });

  await prisma.$transaction([
    prisma.activeSession.deleteMany({
      where: { session_id: normalizedSessionId },
    }),
    prisma.loginHistory.updateMany({
      where: { session_id: normalizedSessionId, is_active: true },
      data: {
        is_active: false,
        logout_time: new Date(),
      },
    }),
  ]);

  if (session?.user_id) {
    await reconcileUserOnlineStatus(session.user_id);
  }
}

export async function reconcileUserOnlineStatus(userId: bigint, now = new Date()): Promise<void> {
  const cutoff = getOnlineCutoffDate(now);

  const [activeSessionCount, user] = await Promise.all([
    prisma.activeSession.count({
      where: {
        user_id: userId,
        OR: [{ expires_at: null }, { expires_at: { gt: now } }],
        AND: [
          {
            OR: [
              { last_activity: { gte: cutoff } },
              { last_activity: null, created_at: { gte: cutoff } },
            ],
          },
        ],
      },
    }),
    prisma.user.findUnique({
      where: { user_id: userId },
      select: { last_active: true },
    }),
  ]);

  const isOnline =
    activeSessionCount > 0 ||
    isUserCurrentlyOnline({ is_online: true, last_active: user?.last_active ?? null }, now);

  await prisma.user.update({
    where: { user_id: userId },
    data: { is_online: isOnline },
  });
}
