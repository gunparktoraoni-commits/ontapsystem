import { prisma } from "@/server/lib/prisma";
import {
  PORTAL_PAGE_CONTROLS,
  type PortalPageControlDef,
  type PortalPageScope,
} from "@/lib/portal/page-controls";

export type PortalPageControlState = PortalPageControlDef & {
  /** true = page is live / accessible */
  enabled: boolean;
  persisted: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};

async function featureFlagTableExists(): Promise<boolean> {
  const exists = await prisma.$queryRawUnsafe<Array<{ ok: number }>>(
    `
      SELECT 1 AS ok
      FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'DevFeatureFlag'
      LIMIT 1
    `,
  );
  return exists.length > 0;
}

async function loadFlagRows(): Promise<
  Map<
    string,
    {
      flag_key: string;
      label: string;
      description: string | null;
      enabled: number;
      scope: string;
      updated_by: bigint | null;
      updated_at: Date | null;
    }
  >
> {
  if (!(await featureFlagTableExists())) return new Map();

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
  >(
    `SELECT flag_key, label, description, enabled, scope, updated_by, updated_at
     FROM DevFeatureFlag
     WHERE flag_key LIKE 'page.%'
     ORDER BY flag_key ASC`,
  );

  return new Map(rows.map((row) => [row.flag_key, row]));
}

/**
 * Page accessibility controls for the Dev Controls console.
 * Missing DB rows default to enabled (accessible).
 */
export async function getPortalPageControls(): Promise<PortalPageControlState[]> {
  const byKey = await loadFlagRows();

  return PORTAL_PAGE_CONTROLS.map((item) => {
    const row = byKey.get(item.key);
    return {
      ...item,
      // Default ON. Only an explicit persisted `enabled = 0` turns a page off.
      enabled: row ? Boolean(row.enabled) : true,
      persisted: Boolean(row),
      updatedAt: row?.updated_at?.toISOString() ?? null,
      updatedBy: row?.updated_by?.toString() ?? null,
      description: row?.description ?? item.description,
      label: row?.label ?? item.label,
    };
  });
}

export async function getDisabledPortalPages(
  portal?: PortalPageScope,
): Promise<PortalPageControlState[]> {
  const all = await getPortalPageControls();
  return all.filter(
    (item) => !item.enabled && (!portal || item.portal === portal),
  );
}

export function findControlDef(flagKey: string): PortalPageControlDef | undefined {
  return PORTAL_PAGE_CONTROLS.find((item) => item.key === flagKey);
}

export async function featureFlagsAvailable(): Promise<boolean> {
  return featureFlagTableExists();
}
