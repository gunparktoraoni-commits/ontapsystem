import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";
import { syncMemberBizcardsToCompany } from "@/server/lib/company";
import {
  createDatabaseReconcileError,
  DatabaseReconcileErrorCode,
} from "@/lib/errors/database-reconcile-errors";

const DEFAULT_EMPLOYEE_PERMISSIONS = JSON.stringify({
  manage_employees: false,
  view_analytics: false,
  edit_company: false,
  manage_inquiries: false,
});

const MAX_SQL_BYTES = 10 * 1024 * 1024;
const DEFAULT_SAMPLE_SIZE = 25;
const MAX_SAMPLE_SIZE = 200;
const INVALID_COMPANY_TOKENS = new Set(["", "n/a", "na", "-", "unknown", "none", "null"]);

type RawQueryClient = Pick<
  Prisma.TransactionClient,
  "$queryRawUnsafe" | "$executeRawUnsafe"
>;

export interface ComparisonReport {
  source_stats: {
    total_vcards: number;
    vcards_with_company: number;
    unique_company_names: number;
    users_with_vcards: number;
  };
  current_stats: {
    total_users: number;
    users_with_company_id: number;
    companies_in_table: number;
    users_with_serial_id: number;
  };
  gaps: {
    users_missing_company: Array<{
      user_id: number;
      user_name: string;
      email: string;
      vcard_company: string;
      expected_company_name: string;
    }>;
    companies_not_in_table: string[];
    users_with_multiple_company_matches: Array<{
      user_id: number;
      possible_companies: string[];
    }>;
    vcards_without_user: number;
  };
  recommendations: {
    users_to_update: number;
    companies_to_create: string[];
    affected_tables: string[];
  };
}

export interface ReconcileCompareInput {
  sql_file_content?: string;
  max_samples?: number;
}

export interface ReconcileFixInput extends ReconcileCompareInput {
  dry_run?: boolean;
  create_missing_companies?: boolean;
  update_users?: boolean;
  sync_bizcards?: boolean;
  create_company_employees?: boolean;
}

export interface ReconcileCompareResult {
  comparison_report: ComparisonReport;
  sample_missing_users: ComparisonReport["gaps"]["users_missing_company"];
  sample_missing_companies: string[];
  source_mode: "sql" | "staging";
  run_id: string;
}

export interface ReconcileFixResult {
  summary: {
    companies_created: number;
    users_updated: number;
    employees_created: number;
    bizcards_synced: number;
    errors_encountered: number;
    execution_time_ms: number;
    dry_run: boolean;
  };
  details: {
    companies_created_list: Array<{ name: string; id: number }>;
    users_updated_count: number;
    employees_created_count: number;
    bizcards_synced_count: number;
    failed_updates: Array<{ user_id: number; reason: string }>;
  };
  verification: {
    users_now_linked: number;
    percentage_linked: number;
    remaining_unlinked: number;
  };
  comparison_report: ComparisonReport;
  run_id: string;
  source_mode: "sql" | "staging";
}

type LegacyUser = {
  id: number;
  email: string;
  first_name?: string;
  last_name?: string;
  tenant_id: string;
};

type LegacyVcard = {
  id: number;
  tenant_id: string;
  company: string;
};

type SourceDataset = {
  sourceMode: "sql" | "staging";
  users: LegacyUser[];
  vcards: LegacyVcard[];
};

type ExpectedMapping = {
  userEmail: string;
  userName: string;
  userLegacyId?: number;
  vcardId?: number;
  vcardCompany: string;
  normalizedCompany: string;
};

type CurrentUserRow = {
  user_id: bigint;
  first_name: string;
  last_name: string;
  email: string;
  company_id: bigint | null;
};

type CompanyRow = {
  company_id: bigint;
  name: string;
  company_slug: string | null;
};

function toNumber(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeCompanyName(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function sanitizeCompanyName(value: string): string | null {
  const trimmed = normalizeWhitespace(value);
  if (!trimmed) return null;
  if (INVALID_COMPANY_TOKENS.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();

  return base || "company";
}

function buildRunId(prefix: string): string {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}_${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}${String(now.getUTCSeconds()).padStart(2, "0")}`;
  return `${prefix}_${stamp}_${crypto.randomBytes(3).toString("hex")}`;
}

function parseStringValue(raw: string): string | null {
  const value = raw.trim();
  if (/^null$/i.test(value)) return null;
  if (value.startsWith("'") && value.endsWith("'")) {
    const inner = value.slice(1, -1);
    return inner
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, "\\")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t");
  }
  return value;
}

function parseNumericValue(raw: string): number | null {
  const value = raw.trim();
  if (/^null$/i.test(value)) return null;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

function splitColumnNames(columnsText: string): string[] {
  return columnsText
    .split(",")
    .map((col) => col.trim().replace(/^`|`$/g, ""))
    .filter(Boolean);
}

function splitTuples(valuesText: string): string[] {
  const tuples: string[] = [];
  let inString = false;
  let escaped = false;
  let depth = 0;
  let start = -1;

  for (let i = 0; i < valuesText.length; i += 1) {
    const ch = valuesText[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "'") {
        inString = false;
      }
      continue;
    }

    if (ch === "'") {
      inString = true;
      continue;
    }

    if (ch === "(") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }

    if (ch === ")") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        tuples.push(valuesText.slice(start + 1, i));
        start = -1;
      }
    }
  }

  return tuples;
}

function splitTupleValues(tupleText: string): string[] {
  const values: string[] = [];
  let inString = false;
  let escaped = false;
  let current = "";

  for (let i = 0; i < tupleText.length; i += 1) {
    const ch = tupleText[i];

    if (inString) {
      current += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "'") {
        inString = false;
      }
      continue;
    }

    if (ch === "'") {
      inString = true;
      current += ch;
      continue;
    }

    if (ch === ",") {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.length > 0) {
    values.push(current.trim());
  }

  return values;
}

function extractInsertBlocks(sql: string, tableName: string): Array<{ columns: string[]; tuples: string[] }> {
  const escapedTableName = tableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `INSERT\\s+INTO\\s+(?:\`[^\`]+\`\\.)?\`${escapedTableName}\`\\s*\\(([^)]+)\\)\\s*VALUES\\s*([\\s\\S]*?);`,
    "gi"
  );

  const blocks: Array<{ columns: string[]; tuples: string[] }> = [];
  let match: RegExpExecArray | null;

   
  while ((match = pattern.exec(sql)) !== null) {
    const columns = splitColumnNames(match[1]);
    const tuples = splitTuples(match[2]);
    blocks.push({ columns, tuples });
  }

  return blocks;
}

function decodeSqlContent(sqlFileContent: string, requestId: string): string {
  const normalized = sqlFileContent.trim();
  if (!normalized) {
    throw createDatabaseReconcileError(
      DatabaseReconcileErrorCode.INVALID_SQL_FILE,
      "sql_file_content cannot be empty",
      400,
      requestId
    );
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(normalized, "base64");
  } catch {
    throw createDatabaseReconcileError(
      DatabaseReconcileErrorCode.INVALID_SQL_FILE,
      "sql_file_content must be valid base64",
      400,
      requestId
    );
  }

  if (!buffer.length) {
    throw createDatabaseReconcileError(
      DatabaseReconcileErrorCode.INVALID_SQL_FILE,
      "Decoded SQL content is empty",
      400,
      requestId
    );
  }

  if (buffer.length > MAX_SQL_BYTES) {
    throw createDatabaseReconcileError(
      DatabaseReconcileErrorCode.SQL_FILE_TOO_LARGE,
      `SQL file exceeds ${MAX_SQL_BYTES} bytes`,
      413,
      requestId,
      { maxBytes: MAX_SQL_BYTES, receivedBytes: buffer.length }
    );
  }

  return buffer.toString("utf8");
}

export function parsePortalSql(sql: string, requestId: string): SourceDataset {
  const usersBlocks = extractInsertBlocks(sql, "users");
  const vcardsBlocks = extractInsertBlocks(sql, "vcards");

  if (!usersBlocks.length || !vcardsBlocks.length) {
    throw createDatabaseReconcileError(
      DatabaseReconcileErrorCode.SQL_PARSE_FAILED,
      "SQL file does not contain expected users/vcards INSERT statements",
      500,
      requestId
    );
  }

  const users: LegacyUser[] = [];
  for (const block of usersBlocks) {
    const idIdx = block.columns.indexOf("id");
    const emailIdx = block.columns.indexOf("email");
    const tenantIdx = block.columns.indexOf("tenant_id");
    const firstNameIdx = block.columns.indexOf("first_name");
    const lastNameIdx = block.columns.indexOf("last_name");

    if (idIdx < 0 || emailIdx < 0 || tenantIdx < 0) continue;

    for (const tupleText of block.tuples) {
      const values = splitTupleValues(tupleText);
      const email = parseStringValue(values[emailIdx] ?? "");
      const tenantId = parseStringValue(values[tenantIdx] ?? "");
      const id = parseNumericValue(values[idIdx] ?? "");
      if (!email || !tenantId || id == null) continue;

      users.push({
        id,
        email,
        tenant_id: tenantId,
        first_name: parseStringValue(values[firstNameIdx] ?? "") ?? undefined,
        last_name: parseStringValue(values[lastNameIdx] ?? "") ?? undefined,
      });
    }
  }

  const vcards: LegacyVcard[] = [];
  for (const block of vcardsBlocks) {
    const idIdx = block.columns.indexOf("id");
    const tenantIdx = block.columns.indexOf("tenant_id");
    const companyIdx = block.columns.indexOf("company");
    if (idIdx < 0 || tenantIdx < 0 || companyIdx < 0) continue;

    for (const tupleText of block.tuples) {
      const values = splitTupleValues(tupleText);
      const id = parseNumericValue(values[idIdx] ?? "");
      const tenantId = parseStringValue(values[tenantIdx] ?? "");
      const company = parseStringValue(values[companyIdx] ?? "");
      const sanitized = company ? sanitizeCompanyName(company) : null;
      if (id == null || !tenantId || !sanitized) continue;

      vcards.push({
        id,
        tenant_id: tenantId,
        company: sanitized,
      });
    }
  }

  if (!users.length || !vcards.length) {
    throw createDatabaseReconcileError(
      DatabaseReconcileErrorCode.SQL_PARSE_FAILED,
      "Failed to extract usable users/vcards records from SQL",
      500,
      requestId,
      { users: users.length, vcards: vcards.length }
    );
  }

  return {
    sourceMode: "sql",
    users,
    vcards,
  };
}

async function readStagingSource(requestId: string): Promise<SourceDataset> {
  const users = await prisma.$queryRawUnsafe<
    Array<{ id: bigint; email: string; first_name: string | null; last_name: string | null; tenant_id: string }>
  >(`
    SELECT id, email, first_name, last_name, tenant_id
    FROM legacy_portal_users
    WHERE email IS NOT NULL AND TRIM(email) <> ''
  `);

  const vcards = await prisma.$queryRawUnsafe<
    Array<{ id: bigint; tenant_id: string; company: string | null }>
  >(`
    SELECT id, tenant_id, company
    FROM legacy_portal_vcards
    WHERE company IS NOT NULL AND TRIM(company) <> ''
  `);

  const normalizedUsers: LegacyUser[] = users
    .map((u) => ({
      id: toNumber(u.id),
      email: String(u.email),
      first_name: u.first_name ?? undefined,
      last_name: u.last_name ?? undefined,
      tenant_id: String(u.tenant_id).trim(),
    }))
    .filter((u) => u.email.trim().length > 0 && u.tenant_id.length > 0);

  const normalizedVcards: LegacyVcard[] = vcards
    .map((v) => ({
      id: toNumber(v.id),
      tenant_id: String(v.tenant_id).trim(),
      company: v.company ? sanitizeCompanyName(v.company) ?? "" : "",
    }))
    .filter((v) => v.company.length > 0 && v.tenant_id.length > 0);

  if (!normalizedUsers.length || !normalizedVcards.length) {
    throw createDatabaseReconcileError(
      DatabaseReconcileErrorCode.SOURCE_DATA_UNAVAILABLE,
      "Staging source is missing required legacy users/vcards data",
      404,
      requestId,
      {
        users: normalizedUsers.length,
        vcards: normalizedVcards.length,
      }
    );
  }

  return {
    sourceMode: "staging",
    users: normalizedUsers,
    vcards: normalizedVcards,
  };
}

export function buildExpectedMappings(source: SourceDataset): {
  mappings: ExpectedMapping[];
  sourceStats: ComparisonReport["source_stats"];
} {
  const usersByTenant = new Map<string, LegacyUser[]>();
  for (const user of source.users) {
    const email = user.email.trim().toLowerCase();
    if (!email) continue;
    const normalizedUser = { ...user, email };
    const list = usersByTenant.get(user.tenant_id) ?? [];
    list.push(normalizedUser);
    usersByTenant.set(user.tenant_id, list);
  }

  const dedupe = new Set<string>();
  const mappings: ExpectedMapping[] = [];
  const uniqueCompanies = new Set<string>();

  for (const vcard of source.vcards) {
    const companyName = sanitizeCompanyName(vcard.company);
    if (!companyName) continue;

    uniqueCompanies.add(normalizeCompanyName(companyName));
    const tenantUsers = usersByTenant.get(vcard.tenant_id) ?? [];
    for (const user of tenantUsers) {
      const key = `${user.email}|${normalizeCompanyName(companyName)}`;
      if (dedupe.has(key)) continue;
      dedupe.add(key);

      const userName = normalizeWhitespace(`${user.first_name ?? ""} ${user.last_name ?? ""}`) || user.email;
      mappings.push({
        userEmail: user.email,
        userName,
        userLegacyId: user.id,
        vcardId: vcard.id,
        vcardCompany: companyName,
        normalizedCompany: normalizeCompanyName(companyName),
      });
    }
  }

  const usersWithVcards = new Set(mappings.map((m) => m.userEmail));

  return {
    mappings,
    sourceStats: {
      total_vcards: source.vcards.length,
      vcards_with_company: source.vcards.length,
      unique_company_names: uniqueCompanies.size,
      users_with_vcards: usersWithVcards.size,
    },
  };
}

async function loadCurrentState(): Promise<{
  currentStats: ComparisonReport["current_stats"];
  users: CurrentUserRow[];
  companies: CompanyRow[];
}> {
  const [users, companies, currentStatsRows] = await Promise.all([
    prisma.$queryRawUnsafe<CurrentUserRow[]>(`
      SELECT user_id, first_name, last_name, email, company_id
      FROM User
    `),
    prisma.$queryRawUnsafe<CompanyRow[]>(`
      SELECT company_id, name, company_slug
      FROM Company
    `),
    prisma.$queryRawUnsafe<
      Array<{
        total_users: bigint;
        users_with_company_id: bigint;
        companies_in_table: bigint;
        users_with_serial_id: bigint;
      }>
    >(`
      SELECT
        (SELECT COUNT(*) FROM User) AS total_users,
        (SELECT COUNT(*) FROM User WHERE company_id IS NOT NULL) AS users_with_company_id,
        (SELECT COUNT(*) FROM Company) AS companies_in_table,
        (SELECT COUNT(*) FROM User WHERE serial_id IS NOT NULL AND TRIM(serial_id) <> '') AS users_with_serial_id
    `),
  ]);

  const statsRow = currentStatsRows[0];

  return {
    users,
    companies,
    currentStats: {
      total_users: toNumber(statsRow.total_users),
      users_with_company_id: toNumber(statsRow.users_with_company_id),
      companies_in_table: toNumber(statsRow.companies_in_table),
      users_with_serial_id: toNumber(statsRow.users_with_serial_id),
    },
  };
}

function buildComparison(
  mappings: ExpectedMapping[],
  currentState: { users: CurrentUserRow[]; companies: CompanyRow[]; currentStats: ComparisonReport["current_stats"] },
  sourceStats: ComparisonReport["source_stats"],
  sampleSize: number
): ComparisonReport {
  const usersByEmail = new Map<string, CurrentUserRow>();
  for (const user of currentState.users) {
    usersByEmail.set(user.email.trim().toLowerCase(), user);
  }

  const companyByNormalized = new Map<string, CompanyRow[]>();
  for (const company of currentState.companies) {
    const key = normalizeCompanyName(company.name);
    const list = companyByNormalized.get(key) ?? [];
    list.push(company);
    companyByNormalized.set(key, list);
  }

  const usersMissingCompany: ComparisonReport["gaps"]["users_missing_company"] = [];
  const companiesNotInTable = new Set<string>();
  const multipleMatchesMap = new Map<number, Set<string>>();
  let vcardsWithoutUser = 0;

  const updateCandidateUsers = new Set<number>();
  const companiesToCreate = new Set<string>();

  for (const mapping of mappings) {
    const user = usersByEmail.get(mapping.userEmail);
    if (!user) {
      vcardsWithoutUser += 1;
      continue;
    }

    const companies = companyByNormalized.get(mapping.normalizedCompany) ?? [];
    if (companies.length === 0) {
      companiesNotInTable.add(mapping.vcardCompany);
      companiesToCreate.add(mapping.vcardCompany);
      if (user.company_id == null && usersMissingCompany.length < sampleSize) {
        usersMissingCompany.push({
          user_id: toNumber(user.user_id),
          user_name: normalizeWhitespace(`${user.first_name} ${user.last_name}`),
          email: user.email,
          vcard_company: mapping.vcardCompany,
          expected_company_name: mapping.vcardCompany,
        });
      }
      continue;
    }

    if (companies.length > 1) {
      const id = toNumber(user.user_id);
      const set = multipleMatchesMap.get(id) ?? new Set<string>();
      for (const company of companies) {
        set.add(company.name);
      }
      multipleMatchesMap.set(id, set);
      continue;
    }

    const matchedCompany = companies[0];
    const currentCompanyId = user.company_id ? toNumber(user.company_id) : null;
    const matchedCompanyId = toNumber(matchedCompany.company_id);

    if (currentCompanyId == null) {
      updateCandidateUsers.add(toNumber(user.user_id));
      if (usersMissingCompany.length < sampleSize) {
        usersMissingCompany.push({
          user_id: toNumber(user.user_id),
          user_name: normalizeWhitespace(`${user.first_name} ${user.last_name}`),
          email: user.email,
          vcard_company: mapping.vcardCompany,
          expected_company_name: matchedCompany.name,
        });
      }
      continue;
    }

    if (currentCompanyId !== matchedCompanyId && usersMissingCompany.length < sampleSize) {
      usersMissingCompany.push({
        user_id: toNumber(user.user_id),
        user_name: normalizeWhitespace(`${user.first_name} ${user.last_name}`),
        email: user.email,
        vcard_company: mapping.vcardCompany,
        expected_company_name: matchedCompany.name,
      });
    }
  }

  const usersWithMultipleCompanyMatches: ComparisonReport["gaps"]["users_with_multiple_company_matches"] =
    Array.from(multipleMatchesMap.entries())
      .slice(0, sampleSize)
      .map(([userId, possibleCompanies]) => ({
        user_id: userId,
        possible_companies: Array.from(possibleCompanies),
      }));

  return {
    source_stats: sourceStats,
    current_stats: currentState.currentStats,
    gaps: {
      users_missing_company: usersMissingCompany,
      companies_not_in_table: Array.from(companiesNotInTable).slice(0, sampleSize),
      users_with_multiple_company_matches: usersWithMultipleCompanyMatches,
      vcards_without_user: vcardsWithoutUser,
    },
    recommendations: {
      users_to_update: updateCandidateUsers.size,
      companies_to_create: Array.from(companiesToCreate),
      affected_tables: ["User", "Company", "CompanyEmployee", "Bizcard"],
    },
  };
}

function resolveCompanyIdFromMap(
  normalizedCompany: string,
  companyByNormalized: Map<string, CompanyRow[]>
): number | null {
  const companies = companyByNormalized.get(normalizedCompany) ?? [];
  if (companies.length !== 1) return null;
  return toNumber(companies[0].company_id);
}

function buildUsersPlanByNormalizedCompany(
  mappings: ExpectedMapping[],
  userByEmail: Map<string, CurrentUserRow>,
  companyByNormalized: Map<string, CompanyRow[]>,
  userFailures: Array<{ user_id: number; reason: string }>
): Map<number, string> {
  const usersPlanByCompany = new Map<number, string>();

  for (const mapping of mappings) {
    const user = userByEmail.get(mapping.userEmail);
    if (!user) continue;
    const userId = toNumber(user.user_id);

    const companies = companyByNormalized.get(mapping.normalizedCompany) ?? [];
    if (companies.length > 1) {
      if (user.company_id == null) {
        userFailures.push({
          user_id: userId,
          reason: "Multiple company matches detected",
        });
      }
      continue;
    }

    if (companies.length === 0) continue;

    const expectedCompanyId = toNumber(companies[0].company_id);
    const currentCompanyId = user.company_id ? toNumber(user.company_id) : null;

    if (currentCompanyId === expectedCompanyId) continue;

    usersPlanByCompany.set(userId, mapping.normalizedCompany);
  }

  return usersPlanByCompany;
}

function resolveUsersPlanToCompanyIds(
  usersPlanByCompany: Map<number, string>,
  companyByNormalized: Map<string, CompanyRow[]>
): Map<number, number> {
  const usersPlan = new Map<number, number>();

  for (const [userId, normalizedCompany] of usersPlanByCompany.entries()) {
    const companyId = resolveCompanyIdFromMap(normalizedCompany, companyByNormalized);
    if (companyId != null) {
      usersPlan.set(userId, companyId);
    }
  }

  return usersPlan;
}

const USER_UPDATE_BATCH_SIZE = 25;
const TRANSACTION_OPTIONS = { maxWait: 60_000, timeout: 120_000 } as const;

async function syncCompanyEmployeeCounts(
  client: RawQueryClient,
  companyIds: number[]
): Promise<void> {
  if (!companyIds.length) return;

  const placeholders = companyIds.map(() => "?").join(", ");
  await client.$executeRawUnsafe(
    `
      UPDATE Company c
      INNER JOIN (
        SELECT company_id, COUNT(*) AS employee_count
        FROM CompanyEmployee
        WHERE is_active = 1 AND company_id IN (${placeholders})
        GROUP BY company_id
      ) counts ON counts.company_id = c.company_id
      SET c.current_employees = counts.employee_count
      WHERE c.company_id IN (${placeholders})
    `,
    ...companyIds,
    ...companyIds
  );
}

async function createMissingCompaniesInTransaction(
  tx: Prisma.TransactionClient,
  companyPlan: Map<string, { displayName: string; createdBy?: number }>,
  companyByNormalized: Map<string, CompanyRow[]>
): Promise<Array<{ name: string; id: number }>> {
  const createdCompanies: Array<{ name: string; id: number }> = [];
  const existingSlugRows = await tx.$queryRawUnsafe<Array<{ company_slug: string | null }>>(`
    SELECT company_slug FROM Company WHERE company_slug IS NOT NULL
  `);
  const slugSet = new Set(existingSlugRows.map((r) => r.company_slug).filter(Boolean) as string[]);

  for (const [normalized, plan] of companyPlan.entries()) {
    let slug = slugify(plan.displayName);
    let suffix = 2;
    while (slugSet.has(slug)) {
      slug = `${slugify(plan.displayName)}-${suffix}`;
      suffix += 1;
    }
    slugSet.add(slug);

    const created = await tx.company.create({
      data: {
        name: plan.displayName,
        security_key: crypto
          .createHash("sha256")
          .update(`${plan.displayName}|${slug}`)
          .digest("hex")
          .slice(0, 32)
          .toUpperCase(),
        company_slug: slug,
        status: "active",
        created_by: plan.createdBy ? BigInt(plan.createdBy) : null,
      },
      select: {
        company_id: true,
        name: true,
      },
    });

    const createdId = toNumber(created.company_id);
    createdCompanies.push({ name: created.name, id: createdId });
    companyByNormalized.set(normalized, [
      {
        company_id: BigInt(createdId),
        name: created.name,
        company_slug: slug,
      },
    ]);
  }

  return createdCompanies;
}

async function applyUserMembershipBatch(
  tx: Prisma.TransactionClient,
  batch: Array<[number, number]>,
  options: {
    createCompanyEmployees: boolean;
    syncBizcards: boolean;
  }
): Promise<{ updatedUsers: number; employeesCreated: number; bizcardsSynced: number }> {
  let updatedUsers = 0;
  let employeesCreated = 0;
  let bizcardsSynced = 0;

  for (const [userId, companyId] of batch) {
    const existing = await tx.user.findUnique({
      where: { user_id: BigInt(userId) },
      select: { company_id: true },
    });

    if (existing?.company_id === BigInt(companyId)) continue;

    await tx.user.update({
      where: { user_id: BigInt(userId) },
      data: { company_id: BigInt(companyId) },
    });

    updatedUsers += 1;

    if (options.createCompanyEmployees) {
      const existingEmployee = await tx.companyEmployee.findFirst({
        where: {
          company_id: BigInt(companyId),
          user_id: BigInt(userId),
        },
        select: { employee_id: true },
      });

      if (!existingEmployee) {
        await tx.companyEmployee.create({
          data: {
            company_id: BigInt(companyId),
            user_id: BigInt(userId),
            role: "employee",
            permissions: DEFAULT_EMPLOYEE_PERMISSIONS,
          },
        });
        employeesCreated += 1;
      } else {
        await tx.companyEmployee.updateMany({
          where: {
            user_id: BigInt(userId),
            company_id: { not: BigInt(companyId) },
          },
          data: {
            company_id: BigInt(companyId),
          },
        });
      }
    }

    if (options.syncBizcards) {
      await syncMemberBizcardsToCompany(tx, BigInt(userId), BigInt(companyId));
      const bizcardCount = await tx.bizcard.count({
        where: { user_id: BigInt(userId) },
      });
      bizcardsSynced += bizcardCount;
    }
  }

  return { updatedUsers, employeesCreated, bizcardsSynced };
}

function resolveSampleSize(maxSamples: number | undefined): number {
  if (maxSamples == null) return DEFAULT_SAMPLE_SIZE;
  return Math.min(Math.max(maxSamples, 1), MAX_SAMPLE_SIZE);
}

async function ensureAuditTables(client: RawQueryClient): Promise<void> {
  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS db_reconcile_audit_log (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      run_id VARCHAR(80) NOT NULL,
      step_name VARCHAR(120) NOT NULL,
      detail LONGTEXT NULL,
      affected_rows BIGINT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_db_reconcile_audit_run (run_id),
      INDEX idx_db_reconcile_audit_step (step_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS db_reconcile_error_log (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      run_id VARCHAR(80) NOT NULL,
      error_code VARCHAR(32) NOT NULL,
      step_name VARCHAR(120) NOT NULL,
      entity_key VARCHAR(255) NULL,
      error_message TEXT NOT NULL,
      metadata LONGTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_db_reconcile_error_run (run_id),
      INDEX idx_db_reconcile_error_code (error_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function logAudit(
  client: RawQueryClient,
  runId: string,
  stepName: string,
  detail: string,
  affectedRows?: number
): Promise<void> {
  await client.$executeRawUnsafe(
    `
      INSERT INTO db_reconcile_audit_log (run_id, step_name, detail, affected_rows)
      VALUES (?, ?, ?, ?)
    `,
    runId,
    stepName,
    detail,
    affectedRows ?? null
  );
}

async function logError(
  client: RawQueryClient,
  runId: string,
  errorCode: string,
  stepName: string,
  errorMessage: string,
  entityKey?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await client.$executeRawUnsafe(
    `
      INSERT INTO db_reconcile_error_log (run_id, error_code, step_name, entity_key, error_message, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    runId,
    errorCode,
    stepName,
    entityKey ?? null,
    errorMessage,
    metadata ? JSON.stringify(metadata) : null
  );
}

export class DatabaseReconciliationService {
  constructor(private readonly requestId: string) {}

  private async resolveSource(sqlFileContent?: string): Promise<SourceDataset> {
    if (sqlFileContent) {
      const sql = decodeSqlContent(sqlFileContent, this.requestId);
      return parsePortalSql(sql, this.requestId);
    }

    return readStagingSource(this.requestId);
  }

  async compare(input: ReconcileCompareInput): Promise<ReconcileCompareResult> {
    const sampleSize = resolveSampleSize(input.max_samples);
    const runId = buildRunId("reconcile_compare");

    await ensureAuditTables(prisma);
    await logAudit(prisma, runId, "START", "Database reconciliation compare started");

    try {
      const source = await this.resolveSource(input.sql_file_content);
      await logAudit(prisma, runId, "SOURCE_MODE", `Source mode: ${source.sourceMode}`);

      const { mappings, sourceStats } = buildExpectedMappings(source);
      const currentState = await loadCurrentState();
      const report = buildComparison(mappings, currentState, sourceStats, sampleSize);

      await logAudit(prisma, runId, "COMPARE_COMPLETE", "Comparison report generated", mappings.length);
      await logAudit(prisma, runId, "END", "Database reconciliation compare completed");

      return {
        comparison_report: report,
        sample_missing_users: report.gaps.users_missing_company,
        sample_missing_companies: report.gaps.companies_not_in_table,
        source_mode: source.sourceMode,
        run_id: runId,
      };
    } catch (error) {
      await logError(
        prisma,
        runId,
        DatabaseReconcileErrorCode.SQL_PARSE_FAILED,
        "COMPARE_FAILED",
        error instanceof Error ? error.message : "Unknown compare error",
        undefined,
        { requestId: this.requestId }
      );
      await logAudit(prisma, runId, "END", "Database reconciliation compare failed");
      throw error;
    }
  }

  async fix(input: ReconcileFixInput): Promise<ReconcileFixResult> {
    const sampleSize = resolveSampleSize(input.max_samples);
    const dryRun = input.dry_run ?? true;
    const createMissingCompanies = input.create_missing_companies ?? true;
    const updateUsers = input.update_users ?? true;
    const syncBizcards = input.sync_bizcards ?? true;
    const createCompanyEmployees = input.create_company_employees ?? true;
    const startedAt = Date.now();
    const runId = buildRunId("reconcile_fix");

    await ensureAuditTables(prisma);
    await logAudit(prisma, runId, "START", "Database reconciliation fix started");

    const source = await this.resolveSource(input.sql_file_content);
    await logAudit(prisma, runId, "SOURCE_MODE", `Source mode: ${source.sourceMode}`);

    const { mappings, sourceStats } = buildExpectedMappings(source);
    const stateBefore = await loadCurrentState();
    const reportBefore = buildComparison(mappings, stateBefore, sourceStats, sampleSize);

    await logAudit(prisma, runId, "COMPARE_SNAPSHOT", "Generated pre-fix comparison snapshot", mappings.length);

    const companyByNormalized = new Map<string, CompanyRow[]>();
    for (const company of stateBefore.companies) {
      const key = normalizeCompanyName(company.name);
      const list = companyByNormalized.get(key) ?? [];
      list.push(company);
      companyByNormalized.set(key, list);
    }

    const userByEmail = new Map<string, CurrentUserRow>();
    for (const user of stateBefore.users) {
      userByEmail.set(user.email.trim().toLowerCase(), user);
    }

    const companyPlan = new Map<string, { displayName: string; createdBy?: number }>();
    for (const mapping of mappings) {
      const currentCompanies = companyByNormalized.get(mapping.normalizedCompany) ?? [];
      if (currentCompanies.length > 0) continue;
      if (!companyPlan.has(mapping.normalizedCompany)) {
        const currentUser = userByEmail.get(mapping.userEmail);
        companyPlan.set(mapping.normalizedCompany, {
          displayName: mapping.vcardCompany,
          createdBy: currentUser ? toNumber(currentUser.user_id) : undefined,
        });
      }
    }

    const userFailures: Array<{ user_id: number; reason: string }> = [];
    const usersPlanByCompany = buildUsersPlanByNormalizedCompany(
      mappings,
      userByEmail,
      companyByNormalized,
      userFailures
    );

    const createdCompanies: Array<{ name: string; id: number }> = [];
    let updatedUsers = 0;
    let employeesCreated = 0;
    let bizcardsSynced = 0;
    const usersPlan = resolveUsersPlanToCompanyIds(usersPlanByCompany, companyByNormalized);
    const affectedCompanyIds = new Set<number>(usersPlan.values());

    try {
      await ensureAuditTables(prisma);

      if (!dryRun && createMissingCompanies && companyPlan.size > 0) {
        const created = await prisma.$transaction(
          (tx) => createMissingCompaniesInTransaction(tx, companyPlan, companyByNormalized),
          TRANSACTION_OPTIONS
        );
        createdCompanies.push(...created);
      }

      if (!dryRun && updateUsers && usersPlan.size > 0) {
        const userEntries = Array.from(usersPlan.entries());

        for (let offset = 0; offset < userEntries.length; offset += USER_UPDATE_BATCH_SIZE) {
          const batch = userEntries.slice(offset, offset + USER_UPDATE_BATCH_SIZE);
          const batchResult = await prisma.$transaction(
            (tx) =>
              applyUserMembershipBatch(tx, batch, {
                createCompanyEmployees,
                syncBizcards,
              }),
            TRANSACTION_OPTIONS
          );
          updatedUsers += batchResult.updatedUsers;
          employeesCreated += batchResult.employeesCreated;
          bizcardsSynced += batchResult.bizcardsSynced;
        }

        if (createCompanyEmployees && affectedCompanyIds.size > 0) {
          await syncCompanyEmployeeCounts(prisma, Array.from(affectedCompanyIds));
        }
      }

      await logAudit(
        prisma,
        runId,
        "FIX_EXECUTION",
        dryRun ? "Dry-run reconciliation completed" : "Reconciliation changes executed",
        usersPlanByCompany.size
      );
    } catch (error) {
      await logError(
        prisma,
        runId,
        DatabaseReconcileErrorCode.TRANSACTION_FAILED,
        "FIX_EXECUTION",
        error instanceof Error ? error.message : "Transaction failed",
        undefined,
        { dryRun, createMissingCompanies, updateUsers, syncBizcards, createCompanyEmployees }
      );

      throw createDatabaseReconcileError(
        DatabaseReconcileErrorCode.TRANSACTION_FAILED,
        "Reconciliation transaction failed",
        500,
        this.requestId,
        {
          dryRun,
          createMissingCompanies,
          updateUsers,
          syncBizcards,
          createCompanyEmployees,
          reason: error instanceof Error ? error.message : "Unknown transaction error",
        }
      );
    }

    const stateAfter = await loadCurrentState();
    const reportAfter = buildComparison(mappings, stateAfter, sourceStats, sampleSize);

    for (const failure of userFailures.slice(0, 100)) {
      await logError(
        prisma,
        runId,
        DatabaseReconcileErrorCode.REFERENTIAL_INTEGRITY_ERROR,
        "USER_PLAN",
        failure.reason,
        String(failure.user_id)
      );
    }

    await logAudit(
      prisma,
      runId,
      "END",
      dryRun ? "Reconciliation dry-run completed" : "Reconciliation execution completed"
    );

    const usersNowLinked = stateAfter.currentStats.users_with_company_id;
    const totalUsers = Math.max(1, stateAfter.currentStats.total_users);
    const remainingUnlinked = totalUsers - usersNowLinked;

    const plannedUserUpdates = usersPlanByCompany.size;
    const plannedEmployees = createCompanyEmployees ? plannedUserUpdates : 0;
    const plannedBizcards = syncBizcards ? plannedUserUpdates : 0;

    return {
      summary: {
        companies_created: dryRun || !createMissingCompanies ? companyPlan.size : createdCompanies.length,
        users_updated: dryRun || !updateUsers ? plannedUserUpdates : updatedUsers,
        employees_created: dryRun || !createCompanyEmployees ? plannedEmployees : employeesCreated,
        bizcards_synced: dryRun || !syncBizcards ? plannedBizcards : bizcardsSynced,
        errors_encountered: userFailures.length,
        execution_time_ms: Date.now() - startedAt,
        dry_run: dryRun,
      },
      details: {
        companies_created_list: createdCompanies,
        users_updated_count: dryRun || !updateUsers ? plannedUserUpdates : updatedUsers,
        employees_created_count: dryRun || !createCompanyEmployees ? plannedEmployees : employeesCreated,
        bizcards_synced_count: dryRun || !syncBizcards ? plannedBizcards : bizcardsSynced,
        failed_updates: userFailures.slice(0, sampleSize),
      },
      verification: {
        users_now_linked: usersNowLinked,
        percentage_linked: Number(((usersNowLinked * 100) / totalUsers).toFixed(2)),
        remaining_unlinked: remainingUnlinked,
      },
      comparison_report: reportAfter,
      run_id: runId,
      source_mode: source.sourceMode,
    };
  }
}
