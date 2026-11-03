"use client";

import React from "react";
import { sanitizePortfolioRichHtml } from "@/app/lib/richText";

type RichTextProps = {
  /** Raw or sanitized rich-text HTML (bold/italic/underline + line breaks). */
  html?: string | null;
  className?: string;
  style?: React.CSSProperties;
  /**
   * Element to render. Defaults to an inline "span" so it can safely drop into
   * any existing theme wrapper (<p>, <h2>, flex rows, etc.) without breaking
   * layout. Use "div" for standalone blocks.
   */
  as?: keyof React.JSX.IntrinsicElements;
};

/**
 * Renders portfolio rich text (About/Bio, Services details) exactly as the user
 * arranged it — preserving bold/italic/underline, multiple spaces, and line
 * breaks — while sanitizing away any unsafe markup.
 *
 * Backward compatible: plain-text values render as plain text (with whitespace
 * preserved), so it is safe to swap in anywhere the field was previously shown.
 */
export function RichText({ html, className, style, as = "span" }: RichTextProps) {
  const clean = sanitizePortfolioRichHtml(html);
  if (!clean) return null;

  const Tag = as as React.ElementType;
  return (
    <Tag
      className={className}
      style={{ whiteSpace: "pre-wrap", ...style }}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

export default RichText;
