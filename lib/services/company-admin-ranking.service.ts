import { prisma } from "@/server/lib/prisma";
import { logCompanyAudit } from "@/server/lib/company";
import { isHitachiCompanyName, resolveHitachiCompanyIds } from "@/lib/constants/hitachi-companies";

const TITLE_RANK_PATTERNS: Array<{ tier: number; pattern: RegExp }> = [
  { tier: 100, pattern: /chief executive|ceo|president|managing director|country manager|general manager/i },
  { tier: 90, pattern: /\b(cfo|cto|coo|cio|cmo)\b|chief /i },
  { tier: 80, pattern: /executive director|senior director|director|vp|vice president|head of/i },
  { tier: 70, pattern: /manager|lead|supervisor|team lead/i },
  { tier: 60, pattern: /senior|sr\.|principal/i },
  { tier: 50, pattern: /specialist|consultant|engineer|analyst/i },
  { tier: 10, pattern: /./ },
];

export interface AdminCandidate {
  userId: bigint;
  title: string;
  titleTier: number;
  joinedAt: Date;
  firstName: string;
  lastName: string;
}

export function scoreTitle(rawTitle: string | null | undefined): { title: string; tier: number } {
  const title = String(rawTitle ?? "").trim();
  if (!title) return { title: "", tier: 0 };

  for (const { tier, pattern } of TITLE_RANK_PATTERNS) {
    if (pattern.test(title)) {
      return { title, tier };
    }
  }

  return { title, tier: 0 };
}

export async function collectCompanyAdminCandidates(companyId: bigint): Promise<AdminCandidate[]> {
  const [users, employees, bizcardLinks] = await Promise.all([
    prisma.user.findMany({
      where: { company_id: companyId, deactivated_flag: false },
      select: {
        user_id: true,
        first_name: true,
        last_name: true,
        job_position: true,
        created_at: true,
        deactivated_flag: true,
      },
    }),
    prisma.companyEmployee.findMany({
      where: { company_id: companyId, is_active: true },
      select: {
        user_id: true,
        joined_at: true,
        user: {
          select: {
            user_id: true,
            first_name: true,
            last_name: true,
            job_position: true,
            deactivated_flag: true,
          },
        },
      },
    }),
    prisma.bizcard.findMany({
      where: { company_id: companyId, deactivated_flag: false, user_id: { not: null } },
      select: { user_id: true, created_at: true },
    }),
  ]);

  const candidateMap = new Map<string, AdminCandidate>();

  async function upsertCandidate(userId: bigint, joinedAt: Date): Promise<void> {
    const user =
      users.find((row) => row.user_id === userId) ??
      employees.find((row) => row.user_id === userId)?.user;
    if (!user || user.deactivated_flag) return;

    const bizcard = await prisma.bizcard.findFirst({
      where: { user_id: userId, deactivated_flag: false },
      orderBy: { updated_at: "desc" },
      select: { professional_title: true, occupation: true },
    });

    const titleSource =
      user.job_position?.trim() ||
      bizcard?.professional_title?.trim() ||
      bizcard?.occupation?.trim() ||
      "";
    const scored = scoreTitle(titleSource);

    const key = userId.toString();
    const existing = candidateMap.get(key);
    const next: AdminCandidate = {
      userId,
      title: scored.title,
      titleTier: scored.tier,
      joinedAt,
      firstName: user.first_name,
      lastName: user.last_name,
    };

    if (!existing || existing.titleTier < next.titleTier) {
      candidateMap.set(key, next);
      return;
    }

    if (existing.titleTier === next.titleTier && existing.joinedAt > joinedAt) {
      candidateMap.set(key, next);
    }
  }

  for (const user of users) {
    await upsertCandidate(user.user_id, user.created_at);
  }

  for (const employee of employees) {
    if (!employee.user || employee.user.deactivated_flag) continue;
    await upsertCandidate(employee.user_id, employee.joined_at);
  }

  for (const bizcard of bizcardLinks) {
    if (!bizcard.user_id) continue;
    await upsertCandidate(bizcard.user_id, bizcard.created_at);
  }

  return [...candidateMap.values()];
}

export function pickHighestRankedAdmin(candidates: AdminCandidate[]): AdminCandidate | null {
  if (!candidates.length) return null;

  return [...candidates].sort((a, b) => {
    if (b.titleTier !== a.titleTier) return b.titleTier - a.titleTier;
    if (a.joinedAt.getTime() !== b.joinedAt.getTime()) {
      return a.joinedAt.getTime() - b.joinedAt.getTime();
    }
    return Number(a.userId - b.userId);
  })[0];
}

export interface ReassignCompanyAdminResult {
  companyId: bigint;
  companyName: string;
  previousAdminId: bigint | null;
  newAdminId: bigint | null;
  newAdminTitle: string;
  applied: boolean;
}

export async function reassignCompanyAdminByTitleRank(
  companyId: bigint,
  options?: { apply?: boolean; requestId?: string },
): Promise<ReassignCompanyAdminResult> {
  const company = await prisma.company.findUnique({
    where: { company_id: companyId },
    select: { company_id: true, name: true, admin_id: true },
  });

  if (!company) {
    throw new Error(`Company ${companyId.toString()} not found`);
  }

  const candidates = await collectCompanyAdminCandidates(companyId);
  let winner = pickHighestRankedAdmin(candidates);

  if (!winner) {
    const fallbackCompany = await prisma.company.findUnique({
      where: { company_id: companyId },
      select: { created_by: true, admin_id: true },
    });
    if (fallbackCompany?.created_by) {
      const fallbackUser = await prisma.user.findUnique({
        where: { user_id: fallbackCompany.created_by },
        select: {
          user_id: true,
          first_name: true,
          last_name: true,
          job_position: true,
          created_at: true,
          deactivated_flag: true,
        },
      });
      if (fallbackUser && !fallbackUser.deactivated_flag) {
        const scored = scoreTitle(fallbackUser.job_position);
        winner = {
          userId: fallbackUser.user_id,
          title: scored.title,
          titleTier: scored.tier,
          joinedAt: fallbackUser.created_at,
          firstName: fallbackUser.first_name,
          lastName: fallbackUser.last_name,
        };
      }
    }
  }

  const result: ReassignCompanyAdminResult = {
    companyId: company.company_id,
    companyName: company.name,
    previousAdminId: company.admin_id,
    newAdminId: winner?.userId ?? null,
    newAdminTitle: winner?.title ?? "",
    applied: false,
  };

  if (!winner || !options?.apply) {
    return result;
  }

  if (company.admin_id === winner.userId) {
    result.applied = true;
    return result;
  }

  await prisma.$transaction(async (tx) => {
    await tx.company.update({
      where: { company_id: companyId },
      data: { admin_id: winner.userId, updated_at: new Date() },
    });

    await tx.user.update({
      where: { user_id: winner.userId },
      data: { role: "company_admin" },
    });

    if (company.admin_id != null && company.admin_id !== winner.userId) {
      const stillAdminElsewhere = await tx.company.count({
        where: { admin_id: company.admin_id, company_id: { not: companyId } },
      });
      if (stillAdminElsewhere === 0) {
        await tx.user.updateMany({
          where: { user_id: company.admin_id, role: "company_admin" },
          data: { role: "user" },
        });
      }
    }
  });

  await logCompanyAudit({
    companyId,
    userId: winner.userId,
    action: "company_admin_reassigned_by_title_rank",
    requestId: options.requestId,
    details: {
      previous_admin_id: company.admin_id?.toString() ?? null,
      new_admin_id: winner.userId.toString(),
      title: winner.title,
      title_tier: winner.titleTier,
    },
  });

  result.applied = true;
  return result;
}

export async function reassignHitachiCompanyAdmins(options?: {
  apply?: boolean;
  requestId?: string;
}): Promise<ReassignCompanyAdminResult[]> {
  await resolveHitachiCompanyIds(prisma);

  const companies = await prisma.company.findMany({
    select: { company_id: true, name: true },
  });

  const hitachiCompanies = companies.filter((row) => isHitachiCompanyName(row.name));
  const results: ReassignCompanyAdminResult[] = [];

  for (const company of hitachiCompanies) {
    results.push(await reassignCompanyAdminByTitleRank(company.company_id, options));
  }

  return results;
}
