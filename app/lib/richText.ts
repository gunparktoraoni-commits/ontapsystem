/**
 * Isomorphic rich-text helpers for portfolio "About/Bio" and "Services" fields.
 *
 * These fields accept a constrained subset of formatting so users can keep
 * bold / italic / underline emphasis, along with intentional spaces and line
 * breaks, and have it render back exactly as arranged.
 *
 * The sanitizer runs on BOTH the server (on save) and the client (on render)
 * as defense-in-depth. It is intentionally allowlist-based and regex-driven so
 * it needs no DOM and works in Node and the browser.
 *
 * Allowed inline formatting: <b> <strong> <i> <em> <u>
 * Everything else is stripped. Block/line separators (<br>, <p>, <div>, <li>,
 * headings) are normalized to newlines, and rendered with `white-space: pre-wrap`
 * so both multiple spaces and line breaks are preserved.
 */

import { decodeHtmlEntities, repairMojibake } from "./plainText";

const ALLOWED_INLINE_TAGS = ["b", "strong", "i", "em", "u"] as const;
const ALLOWED_TAG_SET = new Set<string>(ALLOWED_INLINE_TAGS);

const PLACEHOLDER_VALUES = new Set(["n/a", "na", "none"]);

/**
 * Sanitize user-supplied rich text into a safe, constrained HTML string.
 * Preserves bold/italic/underline and line breaks; strips everything else.
 */
export function sanitizePortfolioRichHtml(input?: string | null): string {
  if (input == null) return "";
  let s = String(input);
  if (!s.trim()) return "";

  // 1) Drop dangerous elements together with their content.
  s = s.replace(
    /<(script|style|iframe|object|embed|noscript|template)[\s\S]*?<\/\1>/gi,
    "",
  );

  // 2) Normalize line breaks: <br> and block boundaries become newlines.
  s = s.replace(/<\s*br\s*\/?\s*>/gi, "\n");
  s = s.replace(
    /<\s*\/\s*(p|div|li|ul|ol|h[1-6]|section|article|tr|table|blockquote)\s*>/gi,
    "\n",
  );
  s = s.replace(
    /<\s*(p|div|li|ul|ol|h[1-6]|section|article|tr|table|blockquote)(\s[^>]*)?>/gi,
    "",
  );

  // 3) Keep only allowlisted inline tags, stripped of all attributes; drop the rest.
  s = s.replace(/<\s*(\/?)\s*([a-zA-Z0-9]+)[^>]*?>/g, (_match, slash: string, tag: string) => {
    const t = tag.toLowerCase();
    if (!ALLOWED_TAG_SET.has(t)) return "";
    return `<${slash ? "/" : ""}${t}>`;
  });

  // 4) Escape any stray angle brackets left in the text while preserving our clean tags.
  const stash: string[] = [];
  s = s.replace(/<\/?(?:b|strong|i|em|u)>/g, (m) => {
    stash.push(m);
    return `\uE000${stash.length - 1}\uE001`;
  });
  s = s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  s = s.replace(/\uE000(\d+)\uE001/g, (_m, i: string) => stash[Number(i)] ?? "");

  // 5) Repair encoding artifacts (mojibake) without decoding entities into raw tags.
  s = repairMojibake(s);

  // 6) Collapse runaway blank lines and trim surrounding whitespace/newlines.
  s = s.replace(/\r\n?/g, "\n");
  s = s.replace(/[ \t\f\v]+\n/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  s = s.replace(/^[\s\n]+|[\s\n]+$/g, "");

  // 7) Remove empty formatting wrappers left after stripping (e.g. <b></b>).
  let prev: string;
  do {
    prev = s;
    s = s.replace(/<(b|strong|i|em|u)>\s*<\/\1>/gi, "");
  } while (s !== prev);

  return s;
}

/**
 * Convert sanitized (or raw) rich text into plain text for contexts that must
 * not contain markup — vCard NOTE, SEO meta descriptions, previews, etc.
 */
export function richHtmlToPlainText(input?: string | null): string {
  const clean = sanitizePortfolioRichHtml(input);
  if (!clean) return "";
  let t = clean.replace(/<\/?(?:b|strong|i|em|u)>/gi, "");
  t = decodeHtmlEntities(t);
  return t.trim();
}

/** True when the rich text has no visible content once markup/whitespace is removed. */
export function isRichTextEmpty(input?: string | null): boolean {
  const plain = richHtmlToPlainText(input).replace(/\s+/g, " ").trim();
  if (!plain) return true;
  return PLACEHOLDER_VALUES.has(plain.toLowerCase());
}
