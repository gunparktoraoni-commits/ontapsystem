/**
 * Canonical OnTap merchandise display order for shop/marketplace grids.
 * Matched case-insensitively against product `name`.
 * Unknown products sort after the catalog list, then by name.
 *
 * Actual catalog names (examples):
 * - Polyvinyl / Carbon Fiber / Bamboo … Business Card
 * - Ontap HoloKey
 * - ID TAP
 * - INFOTAP
 * - POP UP Keychain
 * - Pet Badge
 * - QR Standee and Table Tap (single SKU covering standee + tabletap)
 */
export const MERCHANDISE_CATALOG_ORDER = [
  "bizcard",
  "holokey",
  "idtap",
  "infotap",
  "popupkey",
  "petbadge",
  "qrstandee",
  "tabletap",
] as const;

type CatalogKey = (typeof MERCHANDISE_CATALOG_ORDER)[number];

/** Ordered matchers — first match wins. */
const CATALOG_MATCHERS: { key: CatalogKey; test: (compact: string, spaced: string) => boolean }[] = [
  {
    key: "bizcard",
    test: (c, s) =>
      c.includes("bizcard") ||
      s.includes("business card") ||
      c.includes("businesscard"),
  },
  {
    key: "holokey",
    test: (c) => c.includes("holokey"),
  },
  {
    key: "idtap",
    test: (c, s) => c.includes("idtap") || s.includes("id tap"),
  },
  {
    key: "infotap",
    test: (c, s) =>
      c.includes("infotap") ||
      s.includes("info tap") ||
      s.includes("info tag") ||
      c.includes("infotag"),
  },
  {
    key: "popupkey",
    test: (c, s) =>
      c.includes("popupkey") ||
      c.includes("popupkeychain") ||
      (c.includes("popup") && (c.includes("key") || c.includes("keychain"))) ||
      (s.includes("pop up") && (s.includes("key") || s.includes("keychain"))),
  },
  {
    key: "petbadge",
    test: (c, s) => c.includes("petbadge") || s.includes("pet badge"),
  },
  {
    // Combined SKU "QR Standee and Table Tap" ranks with QR Standee
    key: "qrstandee",
    test: (c, s) =>
      c.includes("qrstandee") ||
      s.includes("qr standee") ||
      (c.includes("standee") && c.includes("qr")),
  },
  {
    key: "tabletap",
    test: (c, s) =>
      c.includes("tabletap") ||
      s.includes("table tap") ||
      (c.includes("table") && c.includes("tap") && !c.includes("standee")),
  },
];

function normalizeProductName(name: string): { spaced: string; compact: string } {
  const spaced = String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return {
    spaced,
    compact: spaced.replace(/\s+/g, ""),
  };
}

export function merchandiseCatalogRank(name: string): number {
  const { spaced, compact } = normalizeProductName(name);
  for (let i = 0; i < CATALOG_MATCHERS.length; i += 1) {
    if (CATALOG_MATCHERS[i].test(compact, spaced)) {
      return i;
    }
  }
  return CATALOG_MATCHERS.length;
}

export function sortMerchandiseByCatalogOrder<T extends { name: string }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => {
    const rankDiff =
      merchandiseCatalogRank(a.name) - merchandiseCatalogRank(b.name);
    if (rankDiff !== 0) return rankDiff;
    return String(a.name).localeCompare(String(b.name), undefined, {
      sensitivity: "base",
    });
  });
}
