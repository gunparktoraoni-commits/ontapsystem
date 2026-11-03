import { prisma } from "@/server/lib/prisma";

export async function getUserCompanyId(userId: bigint): Promise<bigint | null> {
  const user = await prisma.user.findUnique({
    where: { user_id: userId },
    select: { company_id: true },
  });
  return user?.company_id ?? null;
}

export async function getActiveCompanyMemberUserIds(companyId: bigint): Promise<bigint[]> {
  const [employees, company] = await Promise.all([
    prisma.companyEmployee.findMany({
      where: { company_id: companyId, is_active: true },
      select: { user_id: true },
    }),
    prisma.company.findUnique({
      where: { company_id: companyId },
      select: { admin_id: true, created_by: true },
    }),
  ]);

  const ids = new Set<bigint>();
  for (const row of employees) ids.add(row.user_id);
  if (company?.admin_id) ids.add(company.admin_id);
  if (company?.created_by) ids.add(company.created_by);
  return [...ids];
}

export async function isCompanyCalendarAdmin(userId: bigint): Promise<boolean> {
  const companyId = await getUserCompanyId(userId);
  if (!companyId) return false;

  const company = await prisma.company.findUnique({
    where: { company_id: companyId },
    select: { admin_id: true, created_by: true },
  });
  if (company?.admin_id === userId || company?.created_by === userId) return true;

  const membership = await prisma.companyEmployee.findFirst({
    where: {
      company_id: companyId,
      user_id: userId,
      is_active: true,
      role: { in: ["admin", "manager"] },
    },
    select: { employee_id: true },
  });
  return Boolean(membership);
}

export async function usersShareCompany(
  viewerId: bigint,
  ownerId: bigint,
): Promise<boolean> {
  const [viewerCompanyId, ownerCompanyId] = await Promise.all([
    getUserCompanyId(viewerId),
    getUserCompanyId(ownerId),
  ]);
  return viewerCompanyId !== null && viewerCompanyId === ownerCompanyId;
}

export async function getCompanyNotificationRecipientIds(
  ownerId: bigint,
): Promise<bigint[]> {
  const companyId = await getUserCompanyId(ownerId);
  if (!companyId) return [];
  const memberIds = await getActiveCompanyMemberUserIds(companyId);
  return memberIds.filter((id) => id !== ownerId);
}
