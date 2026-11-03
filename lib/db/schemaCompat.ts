import { prisma } from "@/server/lib/prisma";

/**
 * Production may ship app code before ALTER TABLE migrations land.
 * Cache whether optional columns exist so profile/public GETs don't 500.
 */
export type SchemaCompat = {
  userTelephone: boolean;
  bizcardTelephone: boolean;
  addressLandmark: boolean;
};

let cached: SchemaCompat | null = null;
let inflight: Promise<SchemaCompat> | null = null;

async function columnExists(table: string, column: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ cnt: bigint | number }>>(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND LOWER(TABLE_NAME) = LOWER(?)
         AND LOWER(COLUMN_NAME) = LOWER(?)`,
      table,
      column
    );
    return Number(rows?.[0]?.cnt ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function getSchemaCompat(): Promise<SchemaCompat> {
  if (cached) return cached;
  if (!inflight) {
    inflight = (async () => {
      const [userTelephone, bizcardTelephone, addressLandmark] = await Promise.all([
        columnExists("User", "telephone"),
        columnExists("Bizcard", "telephone_number"),
        columnExists("Address", "landmark"),
      ]);
      cached = { userTelephone, bizcardTelephone, addressLandmark };
      return cached;
    })().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/** Drop keys that target columns not yet present in the DB. */
export function omitMissingColumns<T extends Record<string, unknown>>(
  data: T,
  compat: SchemaCompat,
  kind: "user" | "bizcard" | "address"
): T {
  const next = { ...data };
  if (kind === "user" && !compat.userTelephone) {
    delete next.telephone;
    delete next.alt_telephone;
  }
  if (kind === "bizcard" && !compat.bizcardTelephone) {
    delete next.telephone_number;
    delete next.alt_telephone_number;
  }
  if (kind === "address" && !compat.addressLandmark) {
    delete next.landmark;
  }
  return next;
}

export function isUnknownColumnError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error ?? "");
  return (
    /Unknown column/i.test(msg) ||
    /does not exist in the current database/i.test(msg) ||
    /P2022/.test(msg)
  );
}
