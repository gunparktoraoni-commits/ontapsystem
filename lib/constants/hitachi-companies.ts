export const HITACHI_COMPANY_NAMES = [
  "Hitachi Solutions (Thailand) Ltd.",
  "Hitachi Solutions Asia Pacific Pte. Ltd.",
  "Hitachi Solutions Philippines Corporation",
] as const;

export const HITACHI_THEME_SLUG = "hitachi-solutions";
export const HITACHI_EXCLUSIVE_FOR = "company_group:hitachi";
export const HITACHI_THEME_FAMILY_ID = "enterprise/hitachi-solutions";

let cachedHitachiCompanyIds: Set<string> | null = null;

export function normalizeCompanyName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isHitachiCompanyName(name: string): boolean {
  const normalized = normalizeCompanyName(name);
  return HITACHI_COMPANY_NAMES.some((canonical) => normalizeCompanyName(canonical) === normalized);
}

export function setHitachiCompanyIdCache(ids: Iterable<bigint | string>): void {
  cachedHitachiCompanyIds = new Set([...ids].map((id) => id.toString()));
}

export function getHitachiCompanyIdCache(): Set<string> | null {
  return cachedHitachiCompanyIds;
}

export function isHitachiCompanyId(
  companyId: bigint | string | null | undefined,
  knownIds?: Iterable<string>,
): boolean {
  if (companyId == null) return false;
  const id = companyId.toString();
  const pool = knownIds ?? cachedHitachiCompanyIds;
  if (!pool) return false;
  if (pool instanceof Set) return pool.has(id);
  for (const known of pool) {
    if (known === id) return true;
  }
  return false;
}

type CompanyLookupClient = {
  company: {
    findMany: (args: {
      select: { company_id: true; name: true };
    }) => Promise<Array<{ company_id: bigint; name: string }>>;
  };
};

export async function resolveHitachiCompanyIds(client: CompanyLookupClient): Promise<bigint[]> {
  const companies = await client.company.findMany({
    select: { company_id: true, name: true },
  });

  const ids = companies.filter((row) => isHitachiCompanyName(row.name)).map((row) => row.company_id);
  setHitachiCompanyIdCache(ids);
  return ids;
}
