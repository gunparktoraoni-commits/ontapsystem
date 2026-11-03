import { revokedSessionData } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";

export type UserActiveSession = {
  session_id: string;
  device_type: string | null;
  browser: string | null;
  os: string | null;
  ip_address: string | null;
  location: string | null;
  created_at: Date;
  last_activity: Date | null;
  is_current: boolean;
};

export async function listUserActiveSessions(
  userId: number,
  currentSessionId: string | null,
): Promise<UserActiveSession[]> {
  const sessions = await prisma.activeSession.findMany({
    where: {
      user_id: BigInt(userId),
      OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
    },
    orderBy: { created_at: "desc" },
  });

  const normalizedCurrent = currentSessionId?.trim() ?? null;

  return sessions.map((session) => ({
    session_id: session.session_id,
    device_type: session.device_type,
    browser: session.browser,
    os: session.os,
    ip_address: session.ip_address,
    location: session.location,
    created_at: session.created_at,
    last_activity: session.last_activity,
    is_current: normalizedCurrent ? session.session_id === normalizedCurrent : false,
  }));
}

export class UserSessionError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "UserSessionError";
  }
}

export async function revokeUserSession(
  userId: number,
  sessionId: string,
  currentSessionId: string | null,
): Promise<void> {
  const trimmedSessionId = sessionId.trim();
  if (!trimmedSessionId) {
    throw new UserSessionError("Invalid session ID.", "USER_SESSION_NOT_FOUND", 400);
  }

  if (currentSessionId && trimmedSessionId === currentSessionId) {
    throw new UserSessionError(
      "Cannot revoke your current session from this screen.",
      "USER_SESSION_REVOKE_CURRENT",
      400,
    );
  }

  const session = await prisma.activeSession.findUnique({
    where: { session_id: trimmedSessionId },
    select: { session_id: true, user_id: true },
  });

  if (!session || session.user_id !== BigInt(userId)) {
    throw new UserSessionError("Session not found.", "USER_SESSION_NOT_FOUND", 404);
  }

  await prisma.$transaction(async (tx) => {
    await tx.activeSession.delete({ where: { session_id: trimmedSessionId } });
    await tx.loginHistory.updateMany({
      where: { session_id: trimmedSessionId, is_active: true },
      data: {
        is_active: false,
        logout_time: new Date(),
      },
    });
  });

  if (/^\d+$/.test(trimmedSessionId)) {
    await prisma.session.updateMany({
      where: {
        id: BigInt(trimmedSessionId),
        user_id: BigInt(userId),
      },
      data: revokedSessionData(),
    });
  }
}

export async function revokeAllOtherUserSessions(
  userId: number,
  currentSessionId: string,
): Promise<number> {
  const trimmedCurrent = currentSessionId.trim();
  if (!trimmedCurrent) {
    throw new UserSessionError(
      "Current session could not be determined.",
      "USER_SESSION_REVOKE_FAILED",
      400,
    );
  }

  const deleteResult = await prisma.activeSession.deleteMany({
    where: {
      user_id: BigInt(userId),
      session_id: { not: trimmedCurrent },
    },
  });

  await prisma.loginHistory.updateMany({
    where: {
      user_id: BigInt(userId),
      session_id: { not: trimmedCurrent },
      is_active: true,
    },
    data: {
      is_active: false,
      logout_time: new Date(),
    },
  });

  if (/^\d+$/.test(trimmedCurrent)) {
    await prisma.session.updateMany({
      where: {
        user_id: BigInt(userId),
        revoked: false,
        NOT: { id: BigInt(trimmedCurrent) },
      },
      data: revokedSessionData(),
    });
  }

  return deleteResult.count;
}
