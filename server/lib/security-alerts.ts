import { prismaAnalytics } from "./prisma-analytics";
import { Prisma } from "@prisma/client";

export type SecurityAlertSeverity = "info" | "warning" | "critical";

type SecurityAlertInput = {
  type: string;
  severity: SecurityAlertSeverity;
  userId?: number;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
};

type SecurityAlertsTableCountRow = {
  table_count: bigint | number;
};

let securityAlertsTableAvailable: boolean | null = null;
let securityAlertsTableCheckedAt = 0;

const SECURITY_ALERTS_TABLE_RECHECK_MS = 5 * 60 * 1000;

function normalizeTableCount(value: bigint | number | undefined): number {
  if (typeof value === "bigint") {
    return Number(value);
  }
  return Number(value ?? 0);
}

async function hasSecurityAlertsTable(): Promise<boolean> {
  const now = Date.now();
  if (
    securityAlertsTableAvailable !== null &&
    now - securityAlertsTableCheckedAt < SECURITY_ALERTS_TABLE_RECHECK_MS
  ) {
    return securityAlertsTableAvailable;
  }

  try {
    const rows = (await prismaAnalytics.$queryRaw(
      Prisma.sql`SELECT COUNT(*) AS table_count
                 FROM information_schema.tables
                 WHERE table_schema = DATABASE()
                   AND table_name = 'security_alerts'`
    )) as SecurityAlertsTableCountRow[];

    securityAlertsTableAvailable = normalizeTableCount(rows[0]?.table_count) > 0;
  } catch {
    // If metadata lookup fails, skip direct writes and use audit log fallback.
    securityAlertsTableAvailable = false;
  }

  securityAlertsTableCheckedAt = now;
  return securityAlertsTableAvailable;
}

function isMissingSecurityAlertsTableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("security_alerts") && error.message.includes("doesn't exist");
}

async function writeSecurityAlertToAuditLog(input: SecurityAlertInput): Promise<void> {
  await prismaAnalytics.auditLog.create({
    data: {
      action: `SEC_ALERT_${input.type}`,
      user_id: input.userId ? BigInt(input.userId) : null,
      ip_address: input.ip?.substring(0, 45),
      user_agent: input.userAgent?.substring(0, 512),
      metadata: {
        severity: input.severity,
        ...(input.metadata ?? {}),
      } as Record<string, string | number | boolean>,
    },
  });
}

export async function sendSecurityAlert(input: SecurityAlertInput): Promise<void> {
  try {
    if (await hasSecurityAlertsTable()) {
      try {
        await prismaAnalytics.$executeRaw(
          Prisma.sql`INSERT INTO security_alerts (
            alert_type,
            severity,
            user_id,
            ip_address,
            user_agent,
            metadata,
            created_at
          ) VALUES (
            ${input.type},
            ${input.severity},
            ${input.userId ? BigInt(input.userId) : null},
            ${input.ip?.substring(0, 45) ?? null},
            ${input.userAgent?.substring(0, 512) ?? null},
            ${JSON.stringify(input.metadata ?? {})},
            ${new Date()}
          )`
        );
      } catch (error) {
        if (isMissingSecurityAlertsTableError(error)) {
          securityAlertsTableAvailable = false;
          securityAlertsTableCheckedAt = Date.now();
        }
        await writeSecurityAlertToAuditLog(input);
      }
    } else {
      await writeSecurityAlertToAuditLog(input);
    }

    if (input.severity === "critical") {
      console.error("[SECURITY_ALERT]", {
        type: input.type,
        userId: input.userId,
        ip: input.ip,
        metadata: input.metadata,
      });
    }
  } catch (error) {
    console.error("Failed to write security alert", error);
  }
}
