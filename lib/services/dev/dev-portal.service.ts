import { createHash } from "crypto";
import { prisma } from "@/server/lib/prisma";
import { prismaAnalytics } from "@/server/lib/prisma-analytics";
import { randomId } from "@/server/lib/notifications";
import {
  getAuthHealthDashboard,
  resolveAuthDateRange,
} from "@/lib/services/dev/auth-health.service";

type IncidentSeverity = "critical" | "high" | "medium" | "low";
type IncidentStatus = "open" | "investigating" | "monitoring" | "resolved";

type RawErrorLog = {
  id: bigint;
  user_id: bigint | null;
  error_message: string;
  file_name: string | null;
  page_url: string | null;
  stack_trace: string | null;
  severity_level: string;
  created_at: Date;
};

type AuthLoginAttemptRow = {
  success: boolean;
  email: string | null;
  created_at: Date;
  ip_address: string | null;
};

type AuthLoginAttemptSummaryRow = {
  success: boolean;
};

type AuthAuditFailureRow = {
  action: string;
  created_at: Date;
  user_id: bigint | null;
  metadata: unknown;
};

type SimpleErrorLogRow = {
  id?: bigint;
  error_message: string;
  file_name: string | null;
  severity_level?: string;
  created_at: Date;
};

type PrivilegedSessionRow = {
  session_id: string;
  user_id: bigint;
  last_activity: Date | null;
  user: { role: string };
};

type SecurityAlertFeedRow = {
  id: bigint;
  alert_type: string;
  severity: string;
  metadata: string | null;
  created_at: Date;
};

type AuditSecurityAlertRow = {
  id: bigint;
  action: string;
  metadata: unknown;
  created_at: Date;
  user_id: bigint | null;
  ip_address: string | null;
};

export type DevIncidentListItem = {
  id: string;
  title: string;
  severity: "Critical" | "High" | "Medium" | "Low";
  status: IncidentStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: number;
  affectedUsers: number;
  affectedCompanies: number;
  owner: { userId: number | null; name: string | null };
  sourceType: string;
  routeKey: string | null;
};

function titleCaseSeverity(severity: string): "Critical" | "High" | "Medium" | "Low" {
  const value = String(severity).trim().toLowerCase();
  if (value === "critical") return "Critical";
  if (value === "high") return "High";
  if (value === "medium") return "Medium";
  return "Low";
}

function rankSeverity(severity: string): number {
  const value = String(severity).trim().toLowerCase();
  if (value === "critical") return 4;
  if (value === "high") return 3;
  if (value === "medium") return 2;
  return 1;
}

function normalizeMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":uuid")
    .replace(/\/\d{2,}/g, "/:id")
    .replace(/\b\d{3,}\b/g, ":n")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePath(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, "https://ontap.local");
    return url.pathname.replace(/\/\d{2,}/g, "/:id");
  } catch {
    return raw.replace(/\?.*$/, "").replace(/\/\d{2,}/g, "/:id");
  }
}

function makeFingerprint(log: RawErrorLog): string {
  const normalized = [
    normalizeMessage(log.error_message),
    String(log.file_name ?? "").toLowerCase().trim(),
    normalizePath(log.page_url) ?? "",
  ].join("|");
  return createHash("sha1").update(normalized).digest("hex");
}

function inferSourceType(log: RawErrorLog): string {
  const source = `${log.file_name ?? ""} ${log.page_url ?? ""}`.toLowerCase();
  if (source.includes("/api/auth") || source.includes("auth")) return "auth";
  if (source.includes("webhook")) return "webhook";
  if (source.includes("cron")) return "cron";
  if (source.includes("cloudinary") || source.includes("upload")) return "media";
  if (source.includes("/api/")) return "api";
  return "ui";
}

function toIncidentId(fingerprint: string): string {
  return `INC-${fingerprint.slice(0, 10).toUpperCase()}`;
}

async function readPersistedIncidents(incidentIds: string[]) {
  const empty = new Map<string, { status: IncidentStatus; owner_user_id: bigint | null }>();
  if (incidentIds.length === 0) return empty;

  try {
    const rows = await prisma.devIncident.findMany({
      where: { incident_key: { in: incidentIds } },
      select: { incident_key: true, status: true, owner_user_id: true },
    });
    return new Map(
      rows.map((row) => [
        row.incident_key,
        {
          status: row.status as IncidentStatus,
          owner_user_id: row.owner_user_id,
        },
      ]),
    );
  } catch (error) {
    // Table may be missing on older deployments; never hard-fail the portal.
    console.warn("[dev] readPersistedIncidents failed", error);
    return empty;
  }
}

async function fetchErrorLogs(params: {
  limit?: number;
  severity?: string;
  search?: string;
}): Promise<RawErrorLog[]> {
  const where: Record<string, unknown> = {};
  const severity = params.severity?.trim().toLowerCase();
  if (severity && severity !== "all") {
    where.severity_level = severity;
  }

  const search = params.search?.trim();
  if (search) {
    where.OR = [
      { error_message: { contains: search } },
      { file_name: { contains: search } },
      { page_url: { contains: search } },
    ];
  }

  try {
    const rows = await prismaAnalytics.systemErrorLog.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: Math.min(1000, Math.max(50, params.limit ?? 500)),
      select: {
        id: true,
        user_id: true,
        error_message: true,
        file_name: true,
        page_url: true,
        stack_trace: true,
        severity_level: true,
        created_at: true,
      },
    });
    return rows as RawErrorLog[];
  } catch (error) {
    // Analytics DB outages / missing tables should degrade to empty incidents, not 500s.
    console.error("[dev] fetchErrorLogs failed", error);
    return [];
  }
}

export async function listGroupedIncidents(params: {
  severity?: string;
  search?: string;
  status?: string;
}): Promise<{
  items: DevIncidentListItem[];
  summary: { total: number; critical: number; high: number; medium: number; low: number };
}> {
  const logs = await fetchErrorLogs({ limit: 800, severity: params.severity, search: params.search });
  const grouped = new Map<
    string,
    {
      id: string;
      title: string;
      severity: IncidentSeverity;
      firstSeenAt: Date;
      lastSeenAt: Date;
      occurrences: number;
      userIds: Set<string>;
      routeKey: string | null;
      sourceType: string;
    }
  >();

  for (const log of logs) {
    const fingerprint = makeFingerprint(log);
    const incidentId = toIncidentId(fingerprint);
    const existing = grouped.get(incidentId);
    const severity = String(log.severity_level).toLowerCase() as IncidentSeverity;
    const routeKey = normalizePath(log.page_url);
    if (!existing) {
      grouped.set(incidentId, {
        id: incidentId,
        title: log.error_message,
        severity,
        firstSeenAt: log.created_at,
        lastSeenAt: log.created_at,
        occurrences: 1,
        userIds: new Set(log.user_id != null ? [log.user_id.toString()] : []),
        routeKey,
        sourceType: inferSourceType(log),
      });
      continue;
    }
    existing.occurrences += 1;
    if (log.created_at < existing.firstSeenAt) existing.firstSeenAt = log.created_at;
    if (log.created_at > existing.lastSeenAt) existing.lastSeenAt = log.created_at;
    if (rankSeverity(severity) > rankSeverity(existing.severity)) existing.severity = severity;
    if (log.user_id != null) existing.userIds.add(log.user_id.toString());
  }

  const incidentIds = Array.from(grouped.keys());
  const persisted = await readPersistedIncidents(incidentIds);

  const allUserIds = Array.from(
    new Set(Array.from(grouped.values()).flatMap((item) => Array.from(item.userIds))),
  );
  const users =
    allUserIds.length > 0
      ? await prisma.user.findMany({
          where: { user_id: { in: allUserIds.map((id) => BigInt(id)) } },
          select: { user_id: true, company_id: true },
        })
      : [];
  const companyByUser = new Map(users.map((user) => [user.user_id.toString(), user.company_id?.toString() ?? null]));

  const items = Array.from(grouped.values())
    .map<DevIncidentListItem>((item) => {
      const linkedCompanies = new Set(
        Array.from(item.userIds)
          .map((userId) => companyByUser.get(userId))
          .filter(Boolean) as string[],
      );
      const persistedRow = persisted.get(item.id);
      return {
        id: item.id,
        title: item.title,
        severity: titleCaseSeverity(item.severity),
        status: persistedRow?.status ?? "open",
        firstSeenAt: item.firstSeenAt.toISOString(),
        lastSeenAt: item.lastSeenAt.toISOString(),
        occurrences: item.occurrences,
        affectedUsers: item.userIds.size,
        affectedCompanies: linkedCompanies.size,
        owner: {
          userId: persistedRow?.owner_user_id != null ? Number(persistedRow.owner_user_id) : null,
          name: null,
        },
        sourceType: item.sourceType,
        routeKey: item.routeKey,
      };
    })
    .filter((item) => {
      const wantedStatus = params.status?.trim().toLowerCase();
      return !wantedStatus || wantedStatus === "all" || item.status === wantedStatus;
    })
    .sort((a, b) => {
      const severityDiff = rankSeverity(b.severity) - rankSeverity(a.severity);
      if (severityDiff !== 0) return severityDiff;
      return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
    });

  return {
    items,
    summary: {
      total: items.length,
      critical: items.filter((item) => item.severity === "Critical").length,
      high: items.filter((item) => item.severity === "High").length,
      medium: items.filter((item) => item.severity === "Medium").length,
      low: items.filter((item) => item.severity === "Low").length,
    },
  };
}

export async function getIncidentDetail(incidentId: string) {
  const logs = await fetchErrorLogs({ limit: 1000 });
  const matching = logs.filter((log) => toIncidentId(makeFingerprint(log)) === incidentId);
  if (matching.length === 0) return null;

  const summary = await listGroupedIncidents({});
  const incident = summary.items.find((item) => item.id === incidentId) ?? null;
  const userIds = Array.from(
    new Set(
      matching
        .map((log) => (log.user_id != null ? log.user_id.toString() : null))
        .filter(Boolean) as string[],
    ),
  );

  const relatedUsers =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { user_id: { in: userIds.map((id) => BigInt(id)) } },
          select: {
            user_id: true,
            first_name: true,
            last_name: true,
            email: true,
            company_id: true,
          },
        })
      : [];

  const relatedEscalations =
    userIds.length > 0
      ? await prisma.supportConversation.findMany({
          where: { client_user_id: { in: userIds.map((id) => BigInt(id)) } },
          orderBy: { escalated_at: "desc" },
          take: 8,
          select: {
            conversation_id: true,
            status: true,
            escalation_level: true,
            escalated_at: true,
            last_message_preview: true,
          },
        })
      : [];

  return {
    incident,
    samples: matching.slice(0, 12).map((log) => ({
      id: `ERR-${log.id.toString()}`,
      message: log.error_message,
      source: log.file_name || log.page_url || "unknown",
      pageUrl: log.page_url,
      stackTrace: log.stack_trace,
      severity: titleCaseSeverity(log.severity_level),
      createdAt: log.created_at.toISOString(),
      userId: log.user_id?.toString() ?? null,
    })),
    relatedUsers: relatedUsers.map((user) => ({
      userId: user.user_id.toString(),
      name: `${user.first_name} ${user.last_name}`.trim(),
      email: user.email,
      companyId: user.company_id?.toString() ?? null,
    })),
    relatedEscalations: relatedEscalations.map((row) => ({
      id: row.conversation_id.toString(),
      status: row.status,
      escalationLevel: row.escalation_level,
      escalatedAt: row.escalated_at?.toISOString() ?? null,
      preview: row.last_message_preview,
    })),
  };
}

export async function saveIncidentState(
  incidentId: string,
  input: { status?: IncidentStatus; ownerUserId?: number | null; resolutionNote?: string | null },
) {
  const now = new Date();
  await prisma.devIncident.upsert({
    where: { incident_key: incidentId },
    create: {
      incident_key: incidentId,
      title: incidentId,
      status: input.status ?? "open",
      severity: "medium",
      first_seen_at: now,
      last_seen_at: now,
      occurrence_count: 0,
      affected_users_count: 0,
      affected_companies_count: 0,
      owner_user_id: input.ownerUserId != null ? BigInt(input.ownerUserId) : null,
      resolution_note: input.resolutionNote ?? null,
      resolved_at: input.status === "resolved" ? now : null,
    },
    update: {
      status: input.status ?? "open",
      owner_user_id: input.ownerUserId != null ? BigInt(input.ownerUserId) : null,
      resolution_note: input.resolutionNote ?? null,
      resolved_at: input.status === "resolved" ? now : null,
    },
  });
}

export async function getOverviewData() {
  const emptyIncidents = {
    items: [] as DevIncidentListItem[],
    summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
  };
  const emptyAuth = {
    summary: {
      successRate24h: 0,
      attempts24h: 0,
      failures24h: 0,
      attempts7d: 0,
      activeSessions: 0,
      loginHistory24h: 0,
      topFailureReason: "None",
    },
  };
  const emptyJobs = {
    summary: {
      queuedEmails: 0,
      failedEmails: 0,
      failedJobs24h: 0,
      failures: { webhook: 0, cron: 0, media: 0, otp: 0, email: 0 },
    },
  };
  const emptyTimeline = { items: [] as Array<{ id: string; label: string; target: string; createdAt: string }> };

  const [incidentsResult, escalationsResult, clientSummaryResult, authResult, jobsResult, auditResult] =
    await Promise.allSettled([
      listGroupedIncidents({}),
      prisma.supportConversation.findMany({
        where: { escalation_level: { not: "none" } },
        orderBy: { escalated_at: "desc" },
        take: 5,
        select: {
          conversation_id: true,
          status: true,
          last_message_preview: true,
          escalated_at: true,
          client: { select: { first_name: true, last_name: true, email: true } },
        },
      }),
      prisma.user.count({ where: { role: "user", is_active: true, deleted_at: null } }),
      getAuthHealthSummary(),
      getJobsSummary(),
      getAuditTimeline({ limit: 10 }),
    ]);

  if (incidentsResult.status === "rejected") console.error("[dev/overview] incidents failed", incidentsResult.reason);
  if (escalationsResult.status === "rejected") console.error("[dev/overview] escalations failed", escalationsResult.reason);
  if (clientSummaryResult.status === "rejected") console.error("[dev/overview] clients failed", clientSummaryResult.reason);
  if (authResult.status === "rejected") console.error("[dev/overview] auth failed", authResult.reason);
  if (jobsResult.status === "rejected") console.error("[dev/overview] jobs failed", jobsResult.reason);
  if (auditResult.status === "rejected") console.error("[dev/overview] audit failed", auditResult.reason);

  const incidents = incidentsResult.status === "fulfilled" ? incidentsResult.value : emptyIncidents;
  const escalations = escalationsResult.status === "fulfilled" ? escalationsResult.value : [];
  const clientSummary = clientSummaryResult.status === "fulfilled" ? clientSummaryResult.value : 0;
  const authSummary = authResult.status === "fulfilled" ? authResult.value : emptyAuth;
  const jobsSummary = jobsResult.status === "fulfilled" ? jobsResult.value : emptyJobs;
  const auditTimeline = auditResult.status === "fulfilled" ? auditResult.value : emptyTimeline;

  const openEscalations = escalations.filter(
    (row) => row.status !== "resolved" && row.status !== "closed",
  );

  return {
    summary: {
      openIncidents: incidents.items.filter((item) => item.status !== "resolved").length,
      criticalIncidents: incidents.summary.critical,
      openEscalations: openEscalations.length,
      affectedUsers24h: incidents.items.reduce((sum, item) => sum + item.affectedUsers, 0),
      authSuccessRate24h: authSummary.summary.successRate24h,
      failedJobs24h: jobsSummary.summary.failedJobs24h,
      activeUsers: clientSummary,
    },
    incidents: incidents.items.slice(0, 5),
    escalations: escalations.map((row) => ({
      id: row.conversation_id.toString(),
      clientName: `${row.client?.first_name ?? ""} ${row.client?.last_name ?? ""}`.trim() || "Client",
      email: row.client?.email ?? "—",
      status: row.status,
      preview: row.last_message_preview,
      escalatedAt: row.escalated_at?.toISOString() ?? null,
    })),
    auth: authSummary.summary,
    jobs: jobsSummary.summary,
    timeline: auditTimeline.items,
  };
}

export async function getAuthHealthSummary() {
  const range = resolveAuthDateRange({ range: "today" });
  const dashboard = await getAuthHealthDashboard(range);
  return {
    summary: {
      successRate24h: dashboard.summary.successRate,
      attempts24h: dashboard.summary.attempts,
      failures24h: dashboard.summary.failures,
      attempts7d: dashboard.summary.attempts,
      activeSessions: dashboard.summary.activeSessions,
      loginHistory24h: dashboard.summary.mappedLogins,
      topFailureReason: dashboard.summary.topFailureReason,
    },
    failures: dashboard.failures.map((row: { action: string; createdAt: string; email: string | null }) => ({
      action: row.action,
      createdAt: row.createdAt,
      userId: null as string | null,
      email: row.email,
      metadata: null,
    })),
  };
}

export async function getJobsSummary() {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  try {
    const [queuedEmails, failedEmails, errorLogs] = await Promise.all([
      prisma.notificationEmailQueue.count({
        where: { created_at: { gte: dayAgo }, status: { in: ["queued", "retrying"] } },
      }),
      prisma.notificationEmailQueue.count({
        where: { created_at: { gte: dayAgo }, status: "failed" },
      }),
      prismaAnalytics.systemErrorLog
        .findMany({
          where: { created_at: { gte: dayAgo } },
          select: { error_message: true, file_name: true, created_at: true },
          take: 400,
          orderBy: { created_at: "desc" },
        })
        .catch((error: unknown) => {
          console.error("[dev] getJobsSummary analytics fetch failed", error);
          return [] as Array<{ error_message: string; file_name: string | null; created_at: Date }>;
        }),
    ]);

    const failures = {
      webhook: 0,
      cron: 0,
      media: 0,
      otp: 0,
      email: failedEmails,
    };

    for (const log of errorLogs) {
      const text = `${log.error_message} ${log.file_name ?? ""}`.toLowerCase();
      if (text.includes("webhook")) failures.webhook += 1;
      if (text.includes("cron")) failures.cron += 1;
      if (text.includes("cloudinary") || text.includes("upload")) failures.media += 1;
      if (text.includes("otp") || text.includes("verify")) failures.otp += 1;
      if (text.includes("smtp") || text.includes("mail")) failures.email += 1;
    }

    return {
      summary: {
        queuedEmails,
        failedEmails,
        failedJobs24h:
          failures.webhook + failures.cron + failures.media + failures.otp + failures.email,
        failures,
      },
    };
  } catch (error) {
    console.error("[dev] getJobsSummary failed", error);
    return {
      summary: {
        queuedEmails: 0,
        failedEmails: 0,
        failedJobs24h: 0,
        failures: { webhook: 0, cron: 0, media: 0, otp: 0, email: 0 },
      },
    };
  }
}

export async function getJobFailures(type: string) {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const normalized = type.trim().toLowerCase();
  if (normalized === "email") {
    const rows = await prisma.notificationEmailQueue.findMany({
      where: { created_at: { gte: dayAgo }, status: { in: ["failed", "retrying", "queued"] } },
      orderBy: { created_at: "desc" },
      take: 50,
      select: {
        id: true,
        email_type: true,
        recipient_email: true,
        status: true,
        error_message: true,
        created_at: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      label: row.email_type,
      target: row.recipient_email,
      status: row.status,
      error: row.error_message,
      createdAt: row.created_at.toISOString(),
    }));
  }

  const rows = (await prismaAnalytics.systemErrorLog.findMany({
    where: { created_at: { gte: dayAgo } },
    orderBy: { created_at: "desc" },
    take: 100,
    select: {
      id: true,
      error_message: true,
      file_name: true,
      severity_level: true,
      created_at: true,
    },
  })) as SimpleErrorLogRow[];
  return rows
    .filter((row: SimpleErrorLogRow) => `${row.error_message} ${row.file_name ?? ""}`.toLowerCase().includes(normalized))
    .map((row: SimpleErrorLogRow) => ({
      id: `ERR-${row.id?.toString() ?? "unknown"}`,
      label: row.file_name ?? "unknown",
      target: normalized,
      status: row.severity_level,
      error: row.error_message,
      createdAt: row.created_at.toISOString(),
    }));
}

export type AuditTimelineItem = {
  id: string;
  type: string;
  label: string;
  target: string;
  detail: string | null;
  severity: string | null;
  actorUserId: string | null;
  createdAt: string;
  source: string;
};

function toTitleCaseAlertType(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^sec_alert_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

async function resolveFocusedAuditEvent(eventId: string): Promise<AuditTimelineItem | null> {
  if (eventId.startsWith("security-")) {
    const rawId = eventId.slice("security-".length);
    if (!/^\d+$/.test(rawId)) return null;
    const row = await prisma.securityAlert.findUnique({
      where: { id: BigInt(rawId) },
      select: {
        id: true,
        alert_type: true,
        severity: true,
        metadata: true,
        created_at: true,
        user_id: true,
        ip_address: true,
      },
    });
    if (!row) return null;
    const metadata = parseJsonRecord(row.metadata);
    const message = String(metadata.reason ?? metadata.path ?? "Security event detected.");
    return {
      id: `security-${row.id.toString()}`,
      type: "security_alert",
      label: toTitleCaseAlertType(row.alert_type),
      target: message,
      detail: [
        `Severity: ${row.severity}`,
        row.ip_address ? `IP: ${row.ip_address}` : null,
        row.user_id ? `User: ${row.user_id.toString()}` : null,
        Object.keys(metadata).length > 0 ? `Metadata: ${JSON.stringify(metadata)}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      severity: row.severity,
      actorUserId: row.user_id?.toString() ?? null,
      createdAt: row.created_at.toISOString(),
      source: "security_alerts",
    };
  }

  if (eventId.startsWith("secaudit-")) {
    const rawId = eventId.slice("secaudit-".length);
    if (!/^\d+$/.test(rawId)) return null;
    const row = await prismaAnalytics.auditLog.findUnique({
      where: { id: BigInt(rawId) },
      select: {
        id: true,
        action: true,
        metadata: true,
        created_at: true,
        user_id: true,
        ip_address: true,
      },
    });
    if (!row || !row.action.startsWith("SEC_ALERT_")) return null;
    const metadata = normalizeMetadataRecord(row.metadata);
    const message = String(metadata.reason ?? metadata.path ?? "Security audit event detected.");
    return {
      id: `secaudit-${row.id.toString()}`,
      type: "security_audit",
      label: toTitleCaseAlertType(row.action),
      target: message,
      detail: [
        metadata.severity ? `Severity: ${String(metadata.severity)}` : null,
        row.ip_address ? `IP: ${row.ip_address}` : null,
        row.user_id ? `User: ${row.user_id.toString()}` : null,
        Object.keys(metadata).length > 0 ? `Metadata: ${JSON.stringify(metadata)}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      severity: String(metadata.severity ?? "warning"),
      actorUserId: row.user_id?.toString() ?? null,
      createdAt: row.created_at.toISOString(),
      source: "audit_log",
    };
  }

  return null;
}

export async function getAuditTimeline(params: {
  limit?: number;
  focusEventId?: string | null;
}) {
  const limit = Math.min(80, Math.max(5, params.limit ?? 20));
  const focusEventId = params.focusEventId?.trim() || null;

  const [company, client, profile, admin, mergeHistory, orderAudit, securityAlerts, securityAudits, focused] =
    await Promise.all([
      prisma.companyAuditLog.findMany({
        orderBy: { created_at: "desc" },
        take: limit,
        select: { log_id: true, company_id: true, action: true, created_at: true, user_id: true },
      }),
      prisma.clientAuditLog.findMany({
        orderBy: { created_at: "desc" },
        take: limit,
        select: { log_id: true, client_user_id: true, action: true, created_at: true, performed_by: true },
      }),
      prisma.userProfileAudit.findMany({
        orderBy: { created_at: "desc" },
        take: limit,
        select: { id: true, user_id: true, action: true, created_at: true, actor_user_id: true },
      }),
      prisma.adminAuditLog.findMany({
        orderBy: { created_at: "desc" },
        take: limit,
        select: { id: true, admin_user_id: true, action: true, created_at: true },
      }),
      prisma.bizcardMergeHistory.findMany({
        orderBy: { merged_at: "desc" },
        take: limit,
        select: { id: true, user_id: true, blank_serial_id: true, merged_at: true },
      }),
      prisma.orderStatusAuditLog.findMany({
        orderBy: { changed_at: "desc" },
        take: limit,
        select: { log_id: true, order_id: true, next_status: true, changed_at: true, changed_by: true },
      }),
      prisma.securityAlert.findMany({
        orderBy: { created_at: "desc" },
        take: limit,
        select: {
          id: true,
          alert_type: true,
          severity: true,
          metadata: true,
          created_at: true,
          user_id: true,
          ip_address: true,
        },
      }),
      prismaAnalytics.auditLog.findMany({
        where: { action: { startsWith: "SEC_ALERT_" } },
        orderBy: { created_at: "desc" },
        take: limit,
        select: {
          id: true,
          action: true,
          metadata: true,
          created_at: true,
          user_id: true,
          ip_address: true,
        },
      }),
      focusEventId ? resolveFocusedAuditEvent(focusEventId) : Promise.resolve(null),
    ]);

  const items: AuditTimelineItem[] = [
    ...company.map((row: (typeof company)[number]) => ({
      id: `company-${row.log_id.toString()}`,
      type: "company_audit",
      label: row.action,
      target: `Company ${row.company_id.toString()}`,
      detail: null,
      severity: null,
      actorUserId: row.user_id.toString(),
      createdAt: row.created_at.toISOString(),
      source: "company_audit_log",
    })),
    ...client.map((row: (typeof client)[number]) => ({
      id: `client-${row.log_id.toString()}`,
      type: "client_audit",
      label: row.action,
      target: `User ${row.client_user_id.toString()}`,
      detail: null,
      severity: null,
      actorUserId: row.performed_by.toString(),
      createdAt: row.created_at.toISOString(),
      source: "client_audit_log",
    })),
    ...profile.map((row: (typeof profile)[number]) => ({
      id: `profile-${row.id.toString()}`,
      type: "profile_audit",
      label: row.action,
      target: `User ${row.user_id.toString()}`,
      detail: null,
      severity: null,
      actorUserId: row.actor_user_id?.toString() ?? null,
      createdAt: row.created_at.toISOString(),
      source: "user_profile_audit",
    })),
    ...admin.map((row: (typeof admin)[number]) => ({
      id: `admin-${row.id.toString()}`,
      type: "admin_audit",
      label: row.action,
      target: `Admin ${row.admin_user_id.toString()}`,
      detail: null,
      severity: null,
      actorUserId: row.admin_user_id.toString(),
      createdAt: row.created_at.toISOString(),
      source: "admin_audit_log",
    })),
    ...mergeHistory.map((row: (typeof mergeHistory)[number]) => ({
      id: `merge-${row.id.toString()}`,
      type: "bizcard_merge",
      label: "Bizcard merged",
      target: `Serial ${row.blank_serial_id}`,
      detail: null,
      severity: null,
      actorUserId: row.user_id.toString(),
      createdAt: row.merged_at.toISOString(),
      source: "bizcard_merge_history",
    })),
    ...orderAudit.map((row: (typeof orderAudit)[number]) => ({
      id: `order-${row.log_id.toString()}`,
      type: "order_audit",
      label: `Order status -> ${row.next_status}`,
      target: `Order ${row.order_id.toString()}`,
      detail: null,
      severity: null,
      actorUserId: row.changed_by.toString(),
      createdAt: row.changed_at.toISOString(),
      source: "order_status_audit_log",
    })),
    ...securityAlerts.map((row: (typeof securityAlerts)[number]) => {
      const metadata = parseJsonRecord(row.metadata);
      const message = String(metadata.reason ?? metadata.path ?? "Security event detected.");
      return {
        id: `security-${row.id.toString()}`,
        type: "security_alert",
        label: toTitleCaseAlertType(row.alert_type),
        target: message,
        detail: [
          `Severity: ${row.severity}`,
          row.ip_address ? `IP: ${row.ip_address}` : null,
          row.user_id ? `User: ${row.user_id.toString()}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        severity: row.severity,
        actorUserId: row.user_id?.toString() ?? null,
        createdAt: row.created_at.toISOString(),
        source: "security_alerts",
      };
    }),
    ...securityAudits.map((row: {
      id: bigint;
      action: string;
      metadata: unknown;
      created_at: Date;
      user_id: bigint | null;
      ip_address: string | null;
    }) => {
      const metadata = normalizeMetadataRecord(row.metadata);
      const message = String(metadata.reason ?? metadata.path ?? "Security audit event detected.");
      return {
        id: `secaudit-${row.id.toString()}`,
        type: "security_audit",
        label: toTitleCaseAlertType(row.action),
        target: message,
        detail: [
          metadata.severity ? `Severity: ${String(metadata.severity)}` : null,
          row.ip_address ? `IP: ${row.ip_address}` : null,
          row.user_id ? `User: ${row.user_id.toString()}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        severity: String(metadata.severity ?? "warning"),
        actorUserId: row.user_id?.toString() ?? null,
        createdAt: row.created_at.toISOString(),
        source: "audit_log",
      };
    }),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);

  if (focused && !items.some((item) => item.id === focused.id)) {
    items.unshift(focused);
    if (items.length > limit) items.pop();
  }

  return {
    items,
    focusedEventId: focused?.id ?? (focusEventId && items.some((i) => i.id === focusEventId) ? focusEventId : null),
  };
}

export async function getIntegrityChecks() {
  const [missingCredentials, orphanedSessions, aliasConflicts, supportAnomalies, orphanedEmployeeRows] =
    await Promise.all([
      prisma.user.count({
        where: { deleted_at: null, credentials: null },
      }),
      prisma.activeSession.count({
        where: {
          user: {
            OR: [{ deleted_at: { not: null } }, { is_active: false }],
          },
        },
      }),
      prisma.user.groupBy({
        by: ["custom_uri"],
        where: { custom_uri: { not: null } },
        _count: { custom_uri: true },
        having: { custom_uri: { _count: { gt: 1 } } },
      }),
      prisma.supportConversation.count({
        where: {
          OR: [
            { escalation_level: { not: "none" }, escalated_at: null },
            { status: "resolved", resolved_at: null },
          ],
        },
      }),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `
          SELECT COUNT(*) AS count
          FROM CompanyEmployee ce
          LEFT JOIN User u ON u.user_id = ce.user_id
          LEFT JOIN Company c ON c.company_id = ce.company_id
          WHERE u.user_id IS NULL OR c.company_id IS NULL
        `,
      ),
    ]);
  const orphanedEmployees = Number(orphanedEmployeeRows[0]?.count ?? 0);

  return {
    checks: [
      {
        key: "users-missing-credentials",
        label: "Users missing credentials",
        status: missingCredentials > 0 ? "error" : "ok",
        issueCount: missingCredentials,
      },
      {
        key: "orphaned-sessions",
        label: "Sessions tied to inactive users",
        status: orphanedSessions > 0 ? "warning" : "ok",
        issueCount: orphanedSessions,
      },
      {
        key: "invalid-company-employees",
        label: "Company employees with invalid links",
        status: orphanedEmployees > 0 ? "error" : "ok",
        issueCount: orphanedEmployees,
      },
      {
        key: "duplicate-aliases",
        label: "Duplicate custom URI aliases",
        status: aliasConflicts.length > 0 ? "error" : "ok",
        issueCount: aliasConflicts.length,
      },
      {
        key: "support-state-anomalies",
        label: "Support conversations with invalid state",
        status: supportAnomalies > 0 ? "warning" : "ok",
        issueCount: supportAnomalies,
      },
    ],
  };
}

export async function getIntegrityCheckDetail(checkKey: string) {
  switch (checkKey) {
    case "users-missing-credentials": {
      const rows = await prisma.user.findMany({
        where: { deleted_at: null, credentials: null },
        select: { user_id: true, email: true, first_name: true, last_name: true },
        take: 50,
      });
      return rows.map((row) => ({
        id: row.user_id.toString(),
        label: `${row.first_name} ${row.last_name}`.trim() || row.email,
        detail: row.email,
      }));
    }
    case "orphaned-sessions": {
      const rows = await prisma.activeSession.findMany({
        where: {
          user: { OR: [{ deleted_at: { not: null } }, { is_active: false }] },
        },
        select: { session_id: true, user_id: true, last_activity: true },
        take: 50,
      });
      return rows.map((row) => ({
        id: row.session_id,
        label: `User ${row.user_id.toString()}`,
        detail: row.last_activity?.toISOString() ?? "No activity timestamp",
      }));
    }
    case "invalid-company-employees": {
      const rawRows = await prisma.$queryRawUnsafe<
        Array<{ employee_id: bigint; company_id: bigint; user_id: bigint; role: string }>
      >(
        `
          SELECT ce.employee_id, ce.company_id, ce.user_id, ce.role
          FROM CompanyEmployee ce
          LEFT JOIN User u ON u.user_id = ce.user_id
          LEFT JOIN Company c ON c.company_id = ce.company_id
          WHERE u.user_id IS NULL OR c.company_id IS NULL
          LIMIT 50
        `,
      );
      return rawRows.map((row) => ({
        id: row.employee_id.toString(),
        label: `Company ${row.company_id.toString()} / User ${row.user_id.toString()}`,
        detail: row.role,
      }));
    }
    case "support-state-anomalies": {
      const rows = await prisma.supportConversation.findMany({
        where: {
          OR: [
            { escalation_level: { not: "none" }, escalated_at: null },
            { status: "resolved", resolved_at: null },
          ],
        },
        select: { conversation_id: true, status: true, escalation_level: true },
        take: 50,
      });
      return rows.map((row) => ({
        id: row.conversation_id.toString(),
        label: `Conversation ${row.conversation_id.toString()}`,
        detail: `${row.status} / escalation=${row.escalation_level}`,
      }));
    }
    default:
      return [];
  }
}

const DEFAULT_CONTROLS = [
  {
    key: "disable_passkey_login",
    label: "Disable passkey login",
    description: "Temporarily disable biometric / passkey login while auth issues are investigated.",
    enabled: false,
    scope: "auth",
  },
  {
    key: "disable_media_uploads",
    label: "Disable media uploads",
    description: "Stop new upload activity during a media pipeline incident.",
    enabled: false,
    scope: "integration",
  },
  {
    key: "disable_company_invites",
    label: "Disable company invites",
    description: "Pause employee and company invite flows.",
    enabled: false,
    scope: "portal",
  },
  {
    key: "support_read_only_mode",
    label: "Support read-only mode",
    description: "Freeze support writes while preserving message visibility.",
    enabled: false,
    scope: "api",
  },
];

export async function getControls() {
  const exists = await prisma.$queryRawUnsafe<Array<{ ok: number }>>(
    `
      SELECT 1 AS ok
      FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'DevFeatureFlag'
      LIMIT 1
    `,
  );
  if (exists.length === 0) {
    return DEFAULT_CONTROLS.map((item) => ({ ...item, persisted: false, updatedAt: null, updatedBy: null }));
  }

  const rows = await prisma.$queryRawUnsafe<
    Array<{
      flag_key: string;
      label: string;
      description: string | null;
      enabled: number;
      scope: string;
      updated_by: bigint | null;
      updated_at: Date | null;
    }>
  >(`SELECT flag_key, label, description, enabled, scope, updated_by, updated_at FROM DevFeatureFlag ORDER BY flag_key ASC`);

  const byKey = new Map(rows.map((row) => [row.flag_key, row]));
  return DEFAULT_CONTROLS.map((item) => {
    const row = byKey.get(item.key);
    return {
      key: item.key,
      label: row?.label ?? item.label,
      description: row?.description ?? item.description,
      enabled: row ? Boolean(row.enabled) : item.enabled,
      scope: row?.scope ?? item.scope,
      persisted: Boolean(row),
      updatedAt: row?.updated_at?.toISOString() ?? null,
      updatedBy: row?.updated_by?.toString() ?? null,
    };
  });
}

type HealthLevel = "healthy" | "warning" | "critical";
type AlertSeverity = "warning" | "critical";

type HealthFinding = {
  key: string;
  area: "database" | "security";
  label: string;
  status: "ok" | "warning" | "error";
  value: string | number;
  detail: string;
  actionUrl?: string;
  alertSeverity?: AlertSeverity;
};

type HealthAlertRow = {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  createdAt: string;
  source: "security_alerts" | "audit_log";
  actionUrl?: string;
};

function summarizeOverallStatus(levels: HealthLevel[]): HealthLevel {
  if (levels.includes("critical")) return "critical";
  if (levels.includes("warning")) return "warning";
  return "healthy";
}

function parseJsonRecord(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore bad metadata
  }
  return {};
}

function normalizeMetadataRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") return parseJsonRecord(value);
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

async function measureQueryLatency(kind: "main" | "analytics") {
  const startedAt = Date.now();
  try {
    if (kind === "main") {
      await prisma.$queryRawUnsafe("SELECT 1 AS ok");
    } else {
      await prismaAnalytics.$queryRawUnsafe("SELECT 1 AS ok");
    }
    return { healthy: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      healthy: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Query failed.",
    };
  }
}

async function getPrivilegedRecipientIds(): Promise<bigint[]> {
  const rows = await prisma.user.findMany({
    where: {
      role: { in: ["dev", "super_admin"] },
      is_active: true,
      deleted_at: null,
    },
    select: { user_id: true },
  });
  return rows.map((row) => row.user_id);
}

async function notifyPrivilegedHealthAlert(params: {
  fingerprint: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
}) {
  const recipients = await getPrivilegedRecipientIds();
  if (recipients.length === 0) return;

  const cooldownSince = new Date(Date.now() - 30 * 60 * 1000);
  await Promise.all(
    recipients.map(async (userId) => {
      const existing = await prisma.userNotification.findFirst({
        where: {
          user_id: userId,
          event_type: "dev_system_health_alert",
          created_at: { gte: cooldownSince },
          metadata: { contains: `"fingerprint":"${params.fingerprint}"` },
        },
        select: { id: true },
      });
      if (existing) return;

      await prisma.userNotification.create({
        data: {
          id: randomId("devhlth"),
          user_id: userId,
          trigger_user_id: null,
          event_type: "dev_system_health_alert",
          priority: params.severity === "critical" ? "critical" : "high",
          title: params.title,
          message: params.message,
          metadata: JSON.stringify({
            fingerprint: params.fingerprint,
            source: "system_health",
            severity: params.severity,
            ...(params.metadata ?? {}),
          }),
          action_url: params.actionUrl ?? "/dev/system-health",
          action_text: "Open Health Center",
          is_read: false,
          is_archived: false,
        },
      });
    }),
  );
}

async function maybeRaiseHealthAlerts(findings: HealthFinding[]) {
  const actionable = findings.filter((item) => item.alertSeverity);
  await Promise.all(
    actionable.map((item) =>
      notifyPrivilegedHealthAlert({
        fingerprint: item.key,
        severity: item.alertSeverity!,
        title: item.area === "database" ? `Database Alert: ${item.label}` : `Security Alert: ${item.label}`,
        message: item.detail,
        actionUrl: item.actionUrl ?? "/dev/system-health",
        metadata: {
          area: item.area,
          label: item.label,
          value: item.value,
          status: item.status,
        },
      }),
    ),
  );
}

export async function getSystemHealthSummary(
  range = resolveAuthDateRange({ range: "today" }),
) {
  const { from, to, preset } = range;
  const rangeLabel =
    preset === "today"
      ? "today"
      : preset === "week"
        ? "last 7 days"
        : preset === "month"
          ? "last 30 days"
          : "selected range";

  const [mainDb, analyticsDb, dbErrorLogs, failedLoginAttempts, privilegedSessions, securityAlerts, auditSecurityAlerts, integrity] =
    (await Promise.all([
      measureQueryLatency("main"),
      measureQueryLatency("analytics"),
      prismaAnalytics.systemErrorLog.findMany({
        where: {
          created_at: { gte: from, lte: to },
          OR: [
            { error_message: { contains: "mysql" } },
            { error_message: { contains: "database" } },
            { error_message: { contains: "connection" } },
            { error_message: { contains: "timeout" } },
            { error_message: { contains: "deadlock" } },
            { error_message: { contains: "prisma" } },
            { file_name: { contains: "prisma" } },
          ],
        },
        orderBy: { created_at: "desc" },
        take: 50,
        select: {
          id: true,
          error_message: true,
          file_name: true,
          created_at: true,
          severity_level: true,
        },
      }) as Promise<SimpleErrorLogRow[]>,
      prismaAnalytics.loginAttempt.findMany({
        where: { created_at: { gte: from, lte: to }, success: false },
        orderBy: { created_at: "desc" },
        take: 500,
        select: { email: true, ip_address: true, created_at: true },
      }) as Promise<AuthLoginAttemptRow[]>,
      prisma.activeSession.findMany({
        where: { user: { role: { in: ["dev", "super_admin"] } } },
        select: { session_id: true, user_id: true, last_activity: true, user: { select: { role: true } } },
        take: 100,
      }) as Promise<PrivilegedSessionRow[]>,
      prisma.securityAlert.findMany({
        where: { created_at: { gte: from, lte: to } },
        orderBy: { created_at: "desc" },
        take: 20,
        select: { id: true, alert_type: true, severity: true, metadata: true, created_at: true },
      }) as Promise<SecurityAlertFeedRow[]>,
      prismaAnalytics.auditLog.findMany({
        where: { created_at: { gte: from, lte: to }, action: { startsWith: "SEC_ALERT_" } },
        orderBy: { created_at: "desc" },
        take: 20,
        select: {
          id: true,
          action: true,
          metadata: true,
          created_at: true,
          user_id: true,
          ip_address: true,
        },
      }) as Promise<AuditSecurityAlertRow[]>,
      getIntegrityChecks(),
    ])) as [
      { healthy: boolean; latencyMs: number; error?: string },
      { healthy: boolean; latencyMs: number; error?: string },
      SimpleErrorLogRow[],
      AuthLoginAttemptRow[],
      PrivilegedSessionRow[],
      SecurityAlertFeedRow[],
      AuditSecurityAlertRow[],
      Awaited<ReturnType<typeof getIntegrityChecks>>,
    ];

  const dbIssueCount = dbErrorLogs.length;
  const failedLoginCount = failedLoginAttempts.length;
  const uniqueFailedLoginIps = new Set(
    failedLoginAttempts
      .map((item: AuthLoginAttemptRow) => item.ip_address?.trim())
      .filter((value): value is string => Boolean(value)),
  ).size;
  const criticalSecurityAlerts = securityAlerts.filter((row) => row.severity === "critical").length;
  const warningSecurityAlerts = securityAlerts.filter((row) => row.severity !== "critical").length;
  const devSessions = privilegedSessions.filter((row) => row.user.role === "dev").length;
  const superAdminSessions = privilegedSessions.filter((row) => row.user.role === "super_admin").length;
  const integrityErrors = integrity.checks.filter((item) => item.status === "error");
  const integrityWarnings = integrity.checks.filter((item) => item.status === "warning");

  const databaseFindings: HealthFinding[] = [
    {
      key: "db-main-connectivity",
      area: "database",
      label: "Main database latency",
      status: !mainDb.healthy || mainDb.latencyMs > 700 ? "error" : mainDb.latencyMs > 300 ? "warning" : "ok",
      value: `${mainDb.latencyMs} ms`,
      detail: !mainDb.healthy
        ? `Main database ping failed: ${mainDb.error ?? "unknown error"}`
        : `Live ping: ${mainDb.latencyMs} ms`,
      actionUrl: "/dev/system-health",
      alertSeverity: !mainDb.healthy || mainDb.latencyMs > 700 ? "critical" : mainDb.latencyMs > 300 ? "warning" : undefined,
    },
    {
      key: "db-analytics-connectivity",
      area: "database",
      label: "Analytics database latency",
      status: !analyticsDb.healthy || analyticsDb.latencyMs > 700 ? "error" : analyticsDb.latencyMs > 300 ? "warning" : "ok",
      value: `${analyticsDb.latencyMs} ms`,
      detail: !analyticsDb.healthy
        ? `Analytics database ping failed: ${analyticsDb.error ?? "unknown error"}`
        : `Live ping: ${analyticsDb.latencyMs} ms`,
      actionUrl: "/dev/system-health",
      alertSeverity:
        !analyticsDb.healthy || analyticsDb.latencyMs > 700
          ? "critical"
          : analyticsDb.latencyMs > 300
            ? "warning"
            : undefined,
    },
    {
      key: "db-errors-range",
      area: "database",
      label: `Database-related errors (${rangeLabel})`,
      status: dbIssueCount > 10 ? "error" : dbIssueCount > 0 ? "warning" : "ok",
      value: dbIssueCount,
      detail:
        dbIssueCount > 0
          ? `${dbIssueCount} database or Prisma-related errors were logged in the ${rangeLabel}.`
          : `No database or Prisma-related errors were logged in the ${rangeLabel}.`,
      actionUrl: "/dev/error-logs",
      alertSeverity: dbIssueCount > 10 ? "critical" : dbIssueCount > 0 ? "warning" : undefined,
    },
    {
      key: "db-integrity-risks",
      area: "database",
      label: "Data integrity risks",
      status: integrityErrors.length > 0 ? "error" : integrityWarnings.length > 0 ? "warning" : "ok",
      value: integrityErrors.length + integrityWarnings.length,
      detail:
        integrityErrors.length > 0 || integrityWarnings.length > 0
          ? `${integrityErrors.length} critical and ${integrityWarnings.length} warning integrity checks currently need attention.`
          : "All integrity checks are passing.",
      actionUrl: "/dev/auth-health?section=integrity",
      alertSeverity: integrityErrors.length > 0 ? "critical" : integrityWarnings.length > 0 ? "warning" : undefined,
    },
  ];

  const securityFindings: HealthFinding[] = [
    {
      key: "security-active-alerts",
      area: "security",
      label: `Security alerts (${rangeLabel})`,
      status: criticalSecurityAlerts > 0 ? "error" : warningSecurityAlerts > 0 ? "warning" : "ok",
      value: securityAlerts.length,
      detail:
        securityAlerts.length > 0
          ? `${criticalSecurityAlerts} critical and ${warningSecurityAlerts} non-critical alerts in the ${rangeLabel}.`
          : `No security alerts were recorded in the ${rangeLabel}.`,
      actionUrl: "/dev/audit",
      alertSeverity: criticalSecurityAlerts > 0 ? "critical" : warningSecurityAlerts > 0 ? "warning" : undefined,
    },
    {
      key: "security-failed-logins",
      area: "security",
      label: `Failed logins (${rangeLabel})`,
      status: failedLoginCount > 40 || uniqueFailedLoginIps > 15 ? "error" : failedLoginCount > 10 ? "warning" : "ok",
      value: failedLoginCount,
      detail:
        failedLoginCount > 0
          ? `${failedLoginCount} failed login attempts from ${uniqueFailedLoginIps} unique IPs in the ${rangeLabel}.`
          : `No failed login activity was recorded in the ${rangeLabel}.`,
      actionUrl: "/dev/auth-health",
      alertSeverity:
        failedLoginCount > 40 || uniqueFailedLoginIps > 15 ? "critical" : failedLoginCount > 10 ? "warning" : undefined,
    },
    {
      key: "security-privileged-sessions",
      area: "security",
      label: "Privileged sessions (current)",
      status: superAdminSessions + devSessions > 25 ? "warning" : "ok",
      value: superAdminSessions + devSessions,
      detail: `${devSessions} dev sessions and ${superAdminSessions} super admin sessions are currently active.`,
      actionUrl: "/dev/auth-health",
      alertSeverity: superAdminSessions + devSessions > 25 ? "warning" : undefined,
    },
  ];

  const databaseStatus = summarizeOverallStatus(
    databaseFindings.map((item) =>
      item.status === "error" ? "critical" : item.status === "warning" ? "warning" : "healthy",
    ),
  );
  const securityStatus = summarizeOverallStatus(
    securityFindings.map((item) =>
      item.status === "error" ? "critical" : item.status === "warning" ? "warning" : "healthy",
    ),
  );
  const overallStatus = summarizeOverallStatus([databaseStatus, securityStatus]);

  const recentAlerts: HealthAlertRow[] = [
    ...securityAlerts.map((row) => {
      const metadata = parseJsonRecord(row.metadata);
      const eventId = `security-${row.id.toString()}`;
      return {
        id: eventId,
        type: row.alert_type,
        severity: (row.severity as "warning" | "critical") ?? "warning",
        title: toTitleCaseAlertType(row.alert_type),
        message: String(metadata.reason ?? metadata.path ?? "Security event detected."),
        createdAt: row.created_at.toISOString(),
        source: "security_alerts" as const,
        actionUrl: `/dev/audit?event=${encodeURIComponent(eventId)}`,
      };
    }),
    ...auditSecurityAlerts.map((row: AuditSecurityAlertRow) => {
      const metadata = normalizeMetadataRecord(row.metadata);
      const eventId = `secaudit-${row.id.toString()}`;
      return {
        id: eventId,
        type: row.action,
        severity: (String(metadata.severity ?? "warning") === "critical"
          ? "critical"
          : "warning") as "warning" | "critical",
        title: toTitleCaseAlertType(row.action),
        message: String(metadata.reason ?? metadata.path ?? "Security audit event detected."),
        createdAt: row.created_at.toISOString(),
        source: "audit_log" as const,
        actionUrl: `/dev/audit?event=${encodeURIComponent(eventId)}`,
      };
    }),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8);

  const recommendations = [
    ...databaseFindings
      .filter((item) => item.status !== "ok")
      .map((item) => `Database: ${item.detail}`),
    ...securityFindings
      .filter((item) => item.status !== "ok")
      .map((item) => `Security: ${item.detail}`),
  ].slice(0, 6);

  await maybeRaiseHealthAlerts([...databaseFindings, ...securityFindings]);

  return {
    range: {
      preset,
      from: from.toISOString(),
      to: to.toISOString(),
      label: rangeLabel,
    },
    summary: {
      overallStatus,
      databaseStatus,
      securityStatus,
      openAlerts: recentAlerts.length,
      criticalAlerts: recentAlerts.filter((item) => item.severity === "critical").length,
      mainDbLatencyMs: mainDb.latencyMs,
      analyticsDbLatencyMs: analyticsDb.latencyMs,
    },
    database: {
      overallStatus: databaseStatus,
      services: [
        {
          key: "main",
          label: "Main database",
          status: !mainDb.healthy ? "error" : mainDb.latencyMs > 300 ? "warning" : "ok",
          latencyMs: mainDb.latencyMs,
          detail: mainDb.healthy ? "Primary transactional database is reachable." : mainDb.error ?? "Connection failed.",
        },
        {
          key: "analytics",
          label: "Analytics database",
          status: !analyticsDb.healthy ? "error" : analyticsDb.latencyMs > 300 ? "warning" : "ok",
          latencyMs: analyticsDb.latencyMs,
          detail: analyticsDb.healthy ? "Analytics database is reachable." : analyticsDb.error ?? "Connection failed.",
        },
      ],
      findings: databaseFindings,
      recentErrors: dbErrorLogs.slice(0, 8).map((row: SimpleErrorLogRow) => ({
        id: `dberr-${row.id?.toString() ?? "unknown"}`,
        severity: row.severity_level,
        message: row.error_message,
        source: row.file_name ?? "unknown",
        createdAt: row.created_at.toISOString(),
      })),
    },
    security: {
      overallStatus: securityStatus,
      failedLogins: failedLoginCount,
      uniqueFailedLoginIps,
      failedLogins24h: failedLoginCount,
      uniqueFailedLoginIps24h: uniqueFailedLoginIps,
      devSessions,
      superAdminSessions,
      findings: securityFindings,
    },
    alerts: recentAlerts,
    recommendations,
  };
}


