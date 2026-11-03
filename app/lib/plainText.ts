/**
 * Safe plain-text helpers for portfolio / profile display.
 * Strips HTML (no tag rendering), decodes common entities, and repairs
 * UTF-8 mojibake so ñ, apostrophes, en/em dashes display correctly.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ntilde: "ñ",
  Ntilde: "Ñ",
  aacute: "á",
  Aacute: "Á",
  eacute: "é",
  Eacute: "É",
  iacute: "í",
  Iacute: "Í",
  oacute: "ó",
  Oacute: "Ó",
  uacute: "ú",
  Uacute: "Ú",
  uuml: "ü",
  Uuml: "Ü",
  copy: "©",
  reg: "®",
  trade: "™",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201D",
  ldquo: "\u201C",
  bull: "•",
  middot: "·",
};

/** Common UTF-8 interpreted as Latin-1 (mojibake) sequences. */
const MOJIBAKE_REPLACEMENTS: Array<[string, string]> = [
  ["Ã±", "ñ"],
  ["Ã‘", "Ñ"],
  ["Ã¡", "á"],
  ["Ã©", "é"],
  ["Ã­", "í"],
  ["Ã³", "ó"],
  ["Ãº", "ú"],
  ["Ã¼", "ü"],
  ["Ã\u00a1", "á"],
  ["Ã‰", "É"],
  ["Ã“", "Ó"],
  ["Ãš", "Ú"],
  ["Ãœ", "Ü"],
  ["Â¡", "¡"],
  ["Â¿", "¿"],
  ["Â·", "·"],
  ["Â©", "©"],
  ["Â®", "®"],
  ["Â°", "°"],
  ["â€™", "\u2019"],
  ["â€˜", "\u2018"],
  ["â€œ", "\u201C"],
  ["â€\u009d", "\u201D"],
  ["â€", "\u201D"],
  ["â€“", "–"],
  ["â€”", "—"],
  ["â€¢", "•"],
  ["â€¦", "…"],
];

function decodeNumericEntity(raw: string): string {
  const isHex = raw[0] === "x" || raw[0] === "X";
  const n = isHex ? Number.parseInt(raw.slice(1), 16) : Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return "";
  // Block C0 controls except TAB/LF/CR; block surrogates
  if ((n < 32 && n !== 9 && n !== 10 && n !== 13) || (n >= 0xd800 && n <= 0xdfff)) {
    return "";
  }
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

export function decodeHtmlEntities(input: string): string {
  if (!input || !input.includes("&")) return input;
  return input.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g,
    (full, body: string) => {
      if (body[0] === "#") return decodeNumericEntity(body.slice(1)) || full;
      return NAMED_ENTITIES[body] ?? full;
    },
  );
}

export function repairMojibake(input: string): string {
  if (!input) return input;
  let out = input;
  for (const [bad, good] of MOJIBAKE_REPLACEMENTS) {
    if (out.includes(bad)) out = out.split(bad).join(good);
  }
  return out;
}

/**
 * Convert HTML / rich text to plain text for safe display.
 * Removes all tags (including script/style), decodes entities, repairs mojibake.
 */
export function htmlToPlainText(value: string | null | undefined): string {
  if (value == null) return "";
  let text = String(value);
  if (!text) return "";

  // Drop script/style blocks entirely before tag strip
  text = text.replace(/<(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  // Block-ish tags → linebreak so paragraphs don't run together
  text = text.replace(/<\s*br\s*\/?\s*>/gi, "\n");
  text = text.replace(/<\/\s*(p|div|li|h[1-6]|tr|section|article)\s*>/gi, "\n");
  text = text.replace(/<\s*(p|div|li|h[1-6]|tr|section|article)(\s[^>]*)?>/gi, "\n");
  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, " ");
  text = decodeHtmlEntities(text);
  text = repairMojibake(text);
  // Normalize whitespace (keep intentional newlines collapsed to spaces for about blurbs)
  text = text.replace(/\u00a0/g, " ");
  text = text.replace(/[ \t\f\v]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/ ?\n ?/g, "\n").trim();
  // Prefer single-line paragraphs for about/bio display
  text = text.replace(/\n+/g, " ").replace(/ {2,}/g, " ").trim();
  return text;
}

/**
 * Normalize person/company text fields (names, titles, occupation).
 * Does not invent diacritics; only repairs encoding + entities.
 */
export function normalizeDisplayText(value: string | null | undefined): string {
  if (value == null) return "";
  let text = String(value);
  if (!text) return "";
  // Names should not contain tags
  if (/[<>]/.test(text) || /&[a-zA-Z#]/.test(text)) {
    text = htmlToPlainText(text);
  } else {
    text = repairMojibake(decodeHtmlEntities(text));
    text = text.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
  }
  return text;
}

/** Alias / serial path segment: repair mojibake, keep URL-safe Unicode letters. */
export function normalizeUrlAliasText(value: string | null | undefined): string {
  if (value == null) return "";
  return repairMojibake(String(value).trim());
}
