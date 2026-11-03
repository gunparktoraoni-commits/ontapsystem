// src/types/card.ts
import type { ReactNode } from 'react';
import { createElement } from 'react';
import CspStyle from '@/app/components/CspStyle';

export interface BizCardDetails {
  props: {
    /** Display name on the card */
  cardName: string;
  /** Unique serial / reference ID */
  serialID: string;
  /** Date the card was created */
  dateMade: string;
  /** Optional QR code – can be a URL string or a React node (e.g., custom SVG) */
  qrCode?: string | ReactNode;
  /** Theme name – each component will validate against its own allowed themes */
  theme?: string;
  /** Additional CSS class name */
  isActive?: boolean;

  onSideNav?: boolean;
  }
}

export const CARD_TEXT_WRAP_CLASS = 'ontap-theme-text-wrap';
export const CARD_TEXT_WRAP_CSS = `
.${CARD_TEXT_WRAP_CLASS} :is(h1, h2, h3, h4, h5, h6, p, span) {
  overflow-wrap: break-word;
  word-wrap: break-word;
  word-break: normal;
  text-wrap: wrap;
}
`;

/** Inject text-wrap rules for card preview headings / paragraphs / spans. */
export function CardTextWrapStyle() {
  return createElement(CspStyle, {
    dangerouslySetInnerHTML: { __html: CARD_TEXT_WRAP_CSS },
  });
}

/** Shared layout class fragments for full card vs sidebar compact preview. */
export function getCardSideNavClasses(onSideNav: boolean) {
  return {
    outer: `${CARD_TEXT_WRAP_CLASS} ${!onSideNav ? "min-w-xs max-w-xs" : "w-full aspect-video"} flex items-center justify-center relative`,
    group: `group relative h-max ${!onSideNav ? "rounded-xl w-max" : "rounded-md w-full"} flex items-center justify-center`,
    card: `relative w-full aspect-video overflow-hidden ${!onSideNav ? "rounded-xl" : "rounded-md"}`,
    glow: `pointer-events-none absolute inset-0 ${!onSideNav ? "rounded-xl" : "rounded-md"}`,
    content: `relative z-10 h-full ${!onSideNav ? "p-3" : "w-full py-1 px-1.5"}`,
    grid: `grid h-full ${!onSideNav ? "grid-cols-5" : "w-full grid-cols-1"} gap-2`,
    leftCol: onSideNav
      ? " flex h-full w-full flex-col justify-between rounded-lg"
      : "col-span-3 flex h-full flex-col justify-between rounded-lg",
    badge: `${!onSideNav ? "px-3 py-1 gap-3 text-[8px]" : "px-1.5 py-0.5 gap-1.5 text-[7px]"}`,
    sparkles: `${!onSideNav ? "h-4 w-4" : "h-3 w-3"}`,
    title: `${!onSideNav ? "text-2xl" : "text-lg"}`,
    serialRow: onSideNav ? "w-full flex items-center justify-between" : "",
    hash: `${!onSideNav ? "h-3 w-3" : "h-2.5 w-2.5"}`,
    serial: `${onSideNav ? "text-[8px]" : "text-xs"}`,
    calendar: `${onSideNav ? "h-2.5 w-2.5" : "h-3 w-3"}`,
    date: `${onSideNav ? "text-[8px]" : "text-xs"}`,
  };
}