"use client";

import React, { createContext, useContext, useMemo, useState } from "react";
import type { PortfolioData } from "@/app/types";
import { getProfileImageOrNull } from "@/app/lib/portfolioDisplay";
import {
  resolvePortfolioConnectTheme,
  type PortfolioConnectTheme,
} from "./portfolioConnectTheme";

function ownerDisplayName(data?: PortfolioData | null): string {
  if (!data) return "this portfolio owner";
  const name = [data.vcard.firstName, data.vcard.middleName, data.vcard.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (name) return name;
  const cardName = data.bizCard.bizCardName?.trim();
  return cardName || "this portfolio owner";
}

type PortfolioThemeContextValue = {
  themeId: string;
  theme: PortfolioConnectTheme;
  ownerName: string;
  ownerTitle: string;
  ownerImage: string | null;
};

const PortfolioThemeContext = createContext<PortfolioThemeContextValue | null>(null);

function cleanTitle(value: string | null | undefined): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  const lower = normalized.toLowerCase();
  if (lower === "n/a" || lower === "na" || lower === "none") return "";
  return normalized;
}

export function PortfolioThemeProvider({
  themeId,
  data,
  children,
}: {
  themeId?: string | null;
  data?: PortfolioData | null;
  children: React.ReactNode;
}) {
  const value = useMemo<PortfolioThemeContextValue>(() => {
    const resolvedId = String(themeId || data?.selectedTheme || "").trim();
    return {
      themeId: resolvedId,
      theme: resolvePortfolioConnectTheme(resolvedId || data?.selectedTheme),
      ownerName: ownerDisplayName(data),
      ownerTitle:
        (data ? cleanTitle(data.vcard.professionalTitle) : "") ||
        (data ? cleanTitle(data.bizCard.occupation) : ""),
      ownerImage: data ? getProfileImageOrNull(data) : null,
    };
  }, [data, themeId]);

  return (
    <PortfolioThemeContext.Provider value={value}>
      {children}
    </PortfolioThemeContext.Provider>
  );
}

export function usePortfolioTheme(): PortfolioThemeContextValue | null {
  return useContext(PortfolioThemeContext);
}

const ThemePreviewModeContext = createContext(false);

/** Marks live theme mounts that are previews (Choose Theme, Design tab, etc.). */
export function ThemePreviewModeProvider({
  enabled = false,
  children,
}: {
  enabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <ThemePreviewModeContext.Provider value={Boolean(enabled)}>
      {children}
    </ThemePreviewModeContext.Provider>
  );
}

export function useIsThemePreview(): boolean {
  return useContext(ThemePreviewModeContext);
}

const ThemePreviewPortalContext = createContext<HTMLElement | null>(null);

export function useThemePreviewPortal(): HTMLElement | null {
  return useContext(ThemePreviewPortalContext);
}

/**
 * Clips theme-preview modals (services/gallery lightbox, video player) to the
 * visible preview viewport instead of the browser window.
 */
export function ThemePreviewPortalHost({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const [portalEl, setPortalEl] = useState<HTMLDivElement | null>(null);

  return (
    <ThemePreviewPortalContext.Provider value={portalEl}>
      <div className={`relative min-h-0 ${className}`.trim()}>
        {children}
        <div
          ref={setPortalEl}
          className="pointer-events-none absolute inset-0 z-[10100] overflow-hidden [&>*]:pointer-events-auto"
          aria-hidden
        />
      </div>
    </ThemePreviewPortalContext.Provider>
  );
}
