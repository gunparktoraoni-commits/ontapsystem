import { prisma } from "@/server/lib/prisma";
import { prismaAnalytics } from "@/server/lib/prisma-analytics";
import { logAuditEvent, revokedSessionData } from "@/server/lib/auth";

export type AuthDatePreset = "today" | "week" | "month" | "custom";

export type AuthDateRange = {
  preset: AuthDatePreset;
  from: Date;
  to: Date;
};

function startOfLocalDay(date = new Date()): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function resolveAuthDateRange(params: {
  range?: string | null;
  from?: string | null;
  to?: string | null;
}): AuthDateRange {
  const now = new Date();
  const preset = (params.range ?? "today").toLowerCase() as AuthDatePreset;

  if (preset === "custom") {
    const from = params.from ? new Date(params.from) : startOfLocalDay(now);
    const to = params.to ? new Date(params.to) : now;
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new Error("Invalid custom date range.");
    }
    const end = new Date(to);
    // If only a date was provided (midnight), include the full day.
    if (
      end.getHours() === 0 &&
      end.getMinutes() === 0 &&
      end.getSeconds() === 0 &&
      end.getMilliseconds() === 0
    ) {
      end.setHours(23, 59, 59, 999);
    }
    if (from > end) throw new Error("Start date must be before end date.");
    return { preset: "custom", from, to: end };
  }

  if (preset === "week") {
    const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { preset: "week", from, to: now };
  }

  if (preset === "month") {
    const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { preset: "month", from, to: now };
  }

  return { preset: "today", from: startOfLocalDay(now), to: now };
}

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseMetadataEmail(metadata: unknown): string | null {
  if (!metadata) return null;
  try {
    const parsed =
      typeof metadata === "string" ? (JSON.parse(metadata) as unknown) : metadata;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const email = (parsed as Record<string, unknown>).email;
    return typeof email === "string" && email.trim() ? email.trim() : null;
  } catch {
    return null;
  }
}

export async function getAuthHealthDashboard(range: AuthDateRange) {
  const { from, to } = range;

  try {
    const [attempts, auditFailures, loginMapRows, activeSessions] = await Promise.all([
      prismaAnalytics.loginAttempt.findMany({
        where: { created_at: { gte: from, lte: to } },
        select: { success: true, email: true, created_at: true, ip_address: true },
        orderBy: { created_at: "desc" },
        take: 500,
      }),
      prismaAnalytics.auditLog.findMany({
        where: {
          created_at: { gte: from, lte: to },
          action: {
            in: [
              "LOGIN_FAILED",
              "LOGIN_UNVERIFIED_EMAIL",
              "LOGIN_REVERIFICATION_REQUIRED",
              "LOGIN_ACCOUNT_LOCKED",
              "LOGIN_DEACTIVATED_ACCOUNT",
              "LOGIN_RESTRICTED_ACCOUNT",
              "WEBAUTHN_LOGIN_VERIFY_FAILED",
              "WEBAUTHN_LOGIN_VERIFY_ERROR",
              "ADMIN_LOGIN_FAILED",
              "ADMIN_LOGIN_UNVERIFIED_EMAIL",
            ],
          },
        },
        orderBy: { created_at: "desc" },
        take: 300,
        select: { action: true, created_at: true, user_id: true, metadata: true, ip_address: true },
      }),
      prisma.loginHistory.findMany({
        where: {
          login_time: { gte: from, lte: to },
          latitude: { not: null },
          longitude: { not: null },
        },
        orderBy: { login_time: "desc" },
        take: 400,
        select: {
          login_id: true,
          user_id: true,
          login_time: true,
          location: true,
          latitude: true,
          longitude: true,
          ip_address: true,
          device_type: true,
          browser: true,
          user: {
            select: {
              email: true,
              first_name: true,
              last_name: true,
              role: true,
            },
          },
        },
      }),
      prisma.activeSession.findMany({
        where: {
          OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
        },
        orderBy: { last_activity: "desc" },
        take: 300,
        select: {
          session_id: true,
          user_id: true,
          device_type: true,
          browser: true,
          os: true,
          ip_address: true,
          location: true,
          created_at: true,
          last_activity: true,
          expires_at: true,
          user: {
            select: {
              user_id: true,
              email: true,
              first_name: true,
              last_name: true,
              role: true,
              is_restricted: true,
              restricted_until: true,
              company_id: true,
              company: { select: { name: true } },
              companyEmployeeRecords: {
                where: { is_active: true },
                take: 1,
                select: { company: { select: { name: true } } },
              },
              _count: {
                select: {
                  bizcards: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const attemptRows = attempts as Array<{
      success: boolean;
      email: string;
      created_at: Date;
      ip_address: string;
    }>;
    const auditRows = auditFailures as Array<{
      action: string;
      created_at: Date;
      user_id: bigint | null;
      metadata: unknown;
      ip_address: string | null;
    }>;
    const mapRows = loginMapRows as Array<{
      login_id: bigint;
      user_id: bigint;
      login_time: Date;
      location: string | null;
      latitude: unknown;
      longitude: unknown;
      ip_address: string | null;
      device_type: string | null;
      browser: string | null;
      user: { email: string; first_name: string; last_name: string; role: string };
    }>;
    const sessionRows = activeSessions as Array<{
      session_id: string;
      user_id: bigint;
      device_type: string | null;
      browser: string | null;
      os: string | null;
      ip_address: string | null;
      location: string | null;
      created_at: Date;
      last_activity: Date | null;
      expires_at: Date | null;
      user: {
        user_id: bigint;
        email: string;
        first_name: string;
        last_name: string;
        role: string;
        is_restricted: boolean;
        restricted_until: Date | null;
        company_id: bigint | null;
        company: { name: string } | null;
        companyEmployeeRecords: Array<{ company: { name: string } | null }>;
        _count: { bizcards: number };
      };
    }>;

    const successCount = attemptRows.filter((row) => row.success).length;
    const failureAttemptCount = attemptRows.filter((row) => !row.success).length;
    const totalAttempts = attemptRows.length || 1;

    const failureReasonCounts: Record<string, number> = {};
    for (const row of auditRows) {
      failureReasonCounts[row.action] = (failureReasonCounts[row.action] ?? 0) + 1;
    }
    const topFailureReason =
      Object.entries(failureReasonCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "None";

    // Resolve emails for audit failures that only have user_id
    const missingUserIds: string[] = Array.from(
      new Set(
        auditRows
          .filter((row) => !parseMetadataEmail(row.metadata) && row.user_id != null)
          .map((row) => row.user_id!.toString()),
      ),
    );
    const emailByUserId = new Map<string, string>();
    if (missingUserIds.length) {
      const users = await prisma.user.findMany({
        where: { user_id: { in: missingUserIds.map((id) => BigInt(id)) } },
        select: { user_id: true, email: true },
      });
      for (const user of users) {
        emailByUserId.set(user.user_id.toString(), user.email);
      }
    }

    const mapPoints = mapRows
      .map((row) => {
        const lat = toNumber(row.latitude);
        const lng = toNumber(row.longitude);
        if (lat == null || lng == null) return null;
        const name = `${row.user.first_name} ${row.user.last_name}`.trim();
        return {
          id: row.login_id.toString(),
          latitude: lat,
          longitude: lng,
          email: row.user.email,
          name: name || row.user.email,
          role: row.user.role,
          location: row.location,
          ipAddress: row.ip_address,
          device: [row.device_type, row.browser].filter(Boolean).join(" · ") || null,
          loginAt: row.login_time.toISOString(),
        };
      })
      .filter((point): point is NonNullable<typeof point> => point != null);

    const sessions = sessionRows.map((session) => {
      const employeeCompany = session.user.companyEmployeeRecords[0]?.company?.name ?? null;
      const managedCompany = session.user.company?.name ?? null;
      const role = String(session.user.role ?? "").toLowerCase();
      const showCompany =
        role === "admin" ||
        role === "company_admin" ||
        role === "manager" ||
        role === "user" ||
        Boolean(managedCompany || employeeCompany);

      return {
        sessionId: session.session_id,
        userId: session.user.user_id.toString(),
        email: session.user.email,
        name: `${session.user.first_name} ${session.user.last_name}`.trim() || session.user.email,
        role: session.user.role,
        bizcardCount: session.user._count.bizcards,
        companyName: showCompany ? managedCompany || employeeCompany : null,
        isRestricted: Boolean(
          session.user.is_restricted &&
            (session.user.restricted_until == null ||
              session.user.restricted_until.getTime() > Date.now()),
        ),
        deviceType: session.device_type,
        browser: session.browser,
        os: session.os,
        ipAddress: session.ip_address,
        location: session.location,
        createdAt: session.created_at.toISOString(),
        lastActivity: session.last_activity?.toISOString() ?? null,
      };
    });

    return {
      range: {
        preset: range.preset,
        from: from.toISOString(),
        to: to.toISOString(),
      },
      summary: {
        successRate: Math.round((successCount / totalAttempts) * 1000) / 10,
        attempts: attemptRows.length,
        failures: failureAttemptCount,
        auditFailures: auditRows.length,
        activeSessions: sessions.length,
        mappedLogins: mapPoints.length,
        topFailureReason,
      },
      mapPoints,
      failures: auditRows.map((row) => ({
        action: row.action,
        createdAt: row.created_at.toISOString(),
        email:
          parseMetadataEmail(row.metadata) ??
          (row.user_id ? emailByUserId.get(row.user_id.toString()) ?? null : null),
        ipAddress: row.ip_address ?? null,
      })),
      attempts: attemptRows.map((row) => ({
        email: row.email,
        success: row.success,
        ipAddress: row.ip_address,
        createdAt: row.created_at.toISOString(),
      })),
      sessions,
    };
  } catch (error) {
    console.error("[dev] getAuthHealthDashboard failed", error);
    return {
      range: {
        preset: range.preset,
        from: from.toISOString(),
        to: to.toISOString(),
      },
      summary: {
        successRate: 0,
        attempts: 0,
        failures: 0,
        auditFailures: 0,
        activeSessions: 0,
        mappedLogins: 0,
        topFailureReason: "Unavailable",
      },
      mapPoints: [],
      failures: [],
      attempts: [],
      sessions: [],
    };
  }
}

export async function forceLogoutUsers(params: {
  userIds: string[];
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const ids = params.userIds
    .map((id) => {
      try {
        return BigInt(id);
      } catch {
        return null;
      }
    })
    .filter((id): id is bigint => id != null);

  if (!ids.length) throw new Error("Select at least one user.");

  const [activeDeleted, sessionsRevoked] = await prisma.$transaction([
    prisma.activeSession.deleteMany({ where: { user_id: { in: ids } } }),
    prisma.session.updateMany({
      where: { user_id: { in: ids }, revoked: false },
      data: revokedSessionData(),
    }),
    prisma.loginHistory.updateMany({
      where: { user_id: { in: ids }, is_active: true },
      data: { is_active: false, logout_time: new Date() },
    }),
    prisma.user.updateMany({
      where: { user_id: { in: ids } },
      data: { is_online: false },
    }),
  ]);

  await logAuditEvent(
    "DEV_FORCE_LOGOUT_USERS",
    Number(params.actorUserId),
    params.ipAddress ?? undefined,
    params.userAgent ?? undefined,
    { userIds: ids.map((id) => id.toString()), activeDeleted: activeDeleted.count },
  );

  return {
    users: ids.length,
    sessionsRemoved: activeDeleted.count,
    authSessionsRevoked: sessionsRevoked.count,
  };
}

export async function restrictLoginUsers(params: {
  userIds: string[];
  actorUserId: string;
  reason: string;
  durationDays?: number | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const ids = params.userIds
    .map((id) => {
      try {
        return BigInt(id);
      } catch {
        return null;
      }
    })
    .filter((id): id is bigint => id != null);

  if (!ids.length) throw new Error("Select at least one user.");
  const reason = params.reason.trim().slice(0, 500) || "Restricted by developer portal Auth Health";
  const durationDays =
    params.durationDays == null || params.durationDays <= 0
      ? null
      : Math.min(365, Math.max(1, Math.floor(params.durationDays)));

  const restrictedUntil =
    durationDays == null
      ? null
      : (() => {
          const d = new Date();
          d.setDate(d.getDate() + durationDays);
          return d;
        })();

  await prisma.$transaction([
    prisma.user.updateMany({
      where: { user_id: { in: ids } },
      data: {
        is_restricted: true,
        restriction_reason: reason,
        restricted_until: restrictedUntil,
        restricted_by: BigInt(params.actorUserId),
        restricted_at: new Date(),
        is_online: false,
      },
    }),
    prisma.activeSession.deleteMany({ where: { user_id: { in: ids } } }),
    prisma.session.updateMany({
      where: { user_id: { in: ids }, revoked: false },
      data: revokedSessionData(),
    }),
    prisma.loginHistory.updateMany({
      where: { user_id: { in: ids }, is_active: true },
      data: { is_active: false, logout_time: new Date() },
    }),
  ]);

  await logAuditEvent(
    "DEV_RESTRICT_LOGIN_USERS",
    Number(params.actorUserId),
    params.ipAddress ?? undefined,
    params.userAgent ?? undefined,
    {
      userIds: ids.map((id) => id.toString()),
      reason,
      durationDays,
      restrictedUntil: restrictedUntil?.toISOString() ?? null,
    },
  );

  return {
    users: ids.length,
    restrictedUntil: restrictedUntil?.toISOString() ?? null,
    durationDays,
  };
}
