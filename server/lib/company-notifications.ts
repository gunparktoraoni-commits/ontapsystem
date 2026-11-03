import { prisma } from "@/server/lib/prisma";
import {
  maybeQueueEmailForCreatedNotification,
  randomId,
} from "@/server/lib/notifications";
import {
  CompanyNotificationService,
  type CompanyNotificationPolicy,
} from "@/lib/services/company-notification.service";

export type AdminNotificationPolicyKey =
  | "join_request_enabled"
  | "company_details_changed_enabled"
  | "co_admin_changes_enabled"
  | "employee_management_enabled";

export type EmployeeNotificationPolicyKey =
  | "employee_daily_statistics_enabled"
  | "employee_weekly_statistics_enabled"
  | "employee_top_performer_enabled";

export async function fetchCompanyNotificationPolicy(companyId: bigint): Promise<CompanyNotificationPolicy> {
  const service = new CompanyNotificationService("policy-read");
  const result = await service.getCompanyNotificationPolicy(companyId);
  return result.policy;
}

interface NotifyParams {
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  actionUrl?: string;
  actionText?: string;
  triggerUserId?: bigint;
  eventType?: "system_update" | "achievement";
  priority?: "low" | "medium" | "high" | "critical";
}

async function listCompanyAdminUserIds(companyId: bigint): Promise<bigint[]> {
  const company = await prisma.company.findUnique({
    where: { company_id: companyId },
    select: { admin_id: true, created_by: true },
  });

  const primaryAdminId = company?.admin_id ?? company?.created_by ?? null;

  const admins = await prisma.companyEmployee.findMany({
    where: {
      company_id: companyId,
      is_active: true,
      role: "admin",
    },
    select: { user_id: true },
  });

  const userIds = new Set<bigint>();
  for (const admin of admins) {
    userIds.add(admin.user_id);
  }
  if (primaryAdminId) {
    userIds.add(primaryAdminId);
  }

  return Array.from(userIds);
}

async function listCompanyEmployeeUserIds(companyId: bigint): Promise<bigint[]> {
  const company = await prisma.company.findUnique({
    where: { company_id: companyId },
    select: { admin_id: true, created_by: true },
  });

  const primaryAdminId = company?.admin_id ?? company?.created_by ?? null;

  const members = await prisma.companyEmployee.findMany({
    where: {
      company_id: companyId,
      is_active: true,
      role: { in: ["employee", "manager", "viewer"] },
    },
    select: { user_id: true },
  });

  return members
    .map((member) => member.user_id)
    .filter((userId) => primaryAdminId === null || userId !== primaryAdminId);
}

async function createInAppNotification(userId: bigint, params: NotifyParams): Promise<void> {
  const notificationId = randomId("notif");
  const eventType = params.eventType ?? "system_update";
  await prisma.userNotification.create({
    data: {
      id: notificationId,
      user_id: userId,
      trigger_user_id: params.triggerUserId ?? null,
      event_type: eventType,
      priority: params.priority ?? "medium",
      title: params.title,
      message: params.message,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      action_url: params.actionUrl ?? null,
      action_text: params.actionText ?? null,
    },
  });

  await maybeQueueEmailForCreatedNotification({
    userId,
    notificationId,
    eventType,
    title: params.title,
    message: params.message,
    actionUrl: params.actionUrl,
    actionText: params.actionText,
    metadata: params.metadata,
  }).catch((error) => {
    console.error("[company-notifications] Failed to queue email:", error);
  });
}

export async function notifyCompanyAdmins(
  companyId: bigint,
  policyKey: AdminNotificationPolicyKey,
  params: NotifyParams,
): Promise<number> {
  const policy = await fetchCompanyNotificationPolicy(companyId);
  if (policy[policyKey] !== true) return 0;

  const userIds = await listCompanyAdminUserIds(companyId);
  let sent = 0;

  for (const userId of userIds) {
    await createInAppNotification(userId, params);
    sent += 1;
  }

  return sent;
}

export async function notifyCompanyEmployees(
  companyId: bigint,
  policyKey: EmployeeNotificationPolicyKey,
  params: NotifyParams,
): Promise<number> {
  const policy = await fetchCompanyNotificationPolicy(companyId);
  if (policy[policyKey] !== true) return 0;

  const userIds = await listCompanyEmployeeUserIds(companyId);
  let sent = 0;

  for (const userId of userIds) {
    await createInAppNotification(userId, params);
    sent += 1;
  }

  return sent;
}

export async function notifySingleUser(userId: bigint, params: NotifyParams): Promise<void> {
  await createInAppNotification(userId, params);
}
