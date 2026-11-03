import { prisma } from "@/server/lib/prisma";

const prismaAny = prisma as any;

export async function logAdminAudit(input: {
  adminUserId: bigint;
  adminEmail: string;
  action: string;
  details?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  try {
    await prismaAny.adminAuditLog.create({
      data: {
        admin_user_id: input.adminUserId,
        admin_email: input.adminEmail,
        action: input.action,
        details: input.details ? JSON.stringify(input.details) : null,
        ip_address: input.ipAddress || null,
        user_agent: input.userAgent || null,
      },
    });
  } catch {
    // Best-effort logging to avoid blocking primary API flows.
  }
}
