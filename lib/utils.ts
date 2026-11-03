import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * If `isMobile` is true, strip large-screen responsive prefixes so the
 * resulting class string renders as the mobile-first variant.
 */
export function mobileClass(classes: string | undefined, isMobile?: boolean) {
  if (!classes) return '';
  if (!isMobile) return classes;
  // remove md:, lg:, xl:, 2xl: prefixes
  return classes.replace(/\b(?:md|lg|xl|2xl):/g, '');
}









