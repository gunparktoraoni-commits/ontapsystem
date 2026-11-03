export type LastAccessedBizcard = {
  bizcard_id: string;
  serial_id: string;
  bizcard_name: string;
  bizcard_theme: string;
  created_at?: string;
  accessed_at: string;
  /** Owning account — used to prevent cross-user sidebar name leaks. */
  owner_user_id?: string;
};

const STORAGE_KEY = "ontap:last-accessed-bizcards";
const MAX_ENTRIES = 5;

function parseEntries(raw: string | null): LastAccessedBizcard[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is LastAccessedBizcard => {
        if (!entry || typeof entry !== "object") return false;
        const row = entry as Record<string, unknown>;
        return (
          typeof row.bizcard_id === "string" &&
          typeof row.serial_id === "string"
        );
      })
      .slice(0, MAX_ENTRIES * 3);
  } catch {
    return [];
  }
}

/** Resolve the signed-in user id from local auth cache. */
export function getAuthUserIdFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("authUser");
    if (!raw) return null;
    const user = JSON.parse(raw) as Record<string, unknown>;
    const id = user.id ?? user.userId ?? user.user_id;
    if (id === null || id === undefined || id === "") return null;
    return String(id);
  } catch {
    return null;
  }
}

function readAllEntries(): LastAccessedBizcard[] {
  if (typeof window === "undefined") return [];
  return parseEntries(window.localStorage.getItem(STORAGE_KEY));
}

/** Prefer person name (first + last) over card label. */
export function resolveBizcardDisplayName(card: {
  first_name?: unknown;
  last_name?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  bizcard_name?: unknown;
  bizCardName?: unknown;
}): string {
  const first = String(card.first_name ?? card.firstName ?? "").trim();
  const last = String(card.last_name ?? card.lastName ?? "").trim();
  const person = [first, last].filter(Boolean).join(" ").trim();
  if (person) return person;
  return String(card.bizcard_name ?? card.bizCardName ?? "").trim();
}

/**
 * Recently accessed cards for the current signed-in user only.
 * Entries without owner_user_id are treated as stale and ignored.
 */
export function getLastAccessedBizcards(): LastAccessedBizcard[] {
  const userId = getAuthUserIdFromStorage();
  if (!userId) return [];
  return readAllEntries()
    .filter((entry) => entry.owner_user_id === userId)
    .slice(0, MAX_ENTRIES);
}

export function recordLastAccessedBizcard(
  card: Omit<LastAccessedBizcard, "accessed_at" | "owner_user_id"> & {
    accessed_at?: string;
    owner_user_id?: string;
  },
): void {
  if (typeof window === "undefined") return;
  const userId = card.owner_user_id ?? getAuthUserIdFromStorage();
  if (!userId) return;

  const now = card.accessed_at ?? new Date().toISOString();
  const nextEntry: LastAccessedBizcard = {
    bizcard_id: String(card.bizcard_id),
    serial_id: String(card.serial_id),
    bizcard_name: String(card.bizcard_name ?? ""),
    bizcard_theme: String(card.bizcard_theme ?? "elegant-dark"),
    created_at: card.created_at ? String(card.created_at) : undefined,
    accessed_at: now,
    owner_user_id: userId,
  };

  const existing = readAllEntries().filter(
    (entry) =>
      entry.bizcard_id !== nextEntry.bizcard_id &&
      entry.owner_user_id === userId,
  );
  const merged = [nextEntry, ...existing].slice(0, MAX_ENTRIES);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    window.dispatchEvent(new CustomEvent("ontap:bizcard-accessed"));
  } catch {
    // ignore storage errors
  }
}

export function clearLastAccessedBizcards(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export const BIZCARD_ACCESSED_EVENT = "ontap:bizcard-accessed";
