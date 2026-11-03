import { Prisma } from "@prisma/client";
import {
  HITACHI_EXCLUSIVE_FOR,
  isHitachiCompanyId,
} from "@/lib/constants/hitachi-companies";

export function isThemeVisibleToUser(
  exclusiveFor: string | null,
  userId: bigint,
  companyId: bigint | null,
  privileged = false,
): boolean {
  if (privileged) return true;
  if (exclusiveFor === null) return true;
  if (exclusiveFor === userId.toString()) return true;

  if (exclusiveFor.startsWith("company:")) {
    const targetId = exclusiveFor.slice("company:".length);
    return companyId !== null && companyId.toString() === targetId;
  }

  if (exclusiveFor === HITACHI_EXCLUSIVE_FOR) {
    return isHitachiCompanyId(companyId);
  }

  return false;
}

export function buildThemeVisibilityOrFilters(params: {
  userId?: bigint | null;
  companyId?: bigint | null;
  includePublic?: boolean;
  privileged?: boolean;
}): Prisma.ThemeWhereInput[] {
  if (params.privileged) return [];

  const filters: Prisma.ThemeWhereInput[] = [];

  if (params.includePublic !== false) {
    filters.push({ exclusive_for: null });
  }

  if (params.userId != null) {
    filters.push({ exclusive_for: params.userId.toString() });
  }

  if (params.companyId != null) {
    filters.push({ exclusive_for: `company:${params.companyId.toString()}` });
    if (isHitachiCompanyId(params.companyId)) {
      filters.push({ exclusive_for: HITACHI_EXCLUSIVE_FOR });
    }
  }

  return filters;
}
