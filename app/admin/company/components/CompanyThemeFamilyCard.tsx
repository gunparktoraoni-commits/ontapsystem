"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { Check } from "lucide-react";
import PortfolioPreviewFrame from "@/app/components/PortfolioPreviewFrame";
import { getTheme } from "@/app/components/BizCardPreview";
import { SAMPLE_DATA } from "@/app/themes/shared";
import type { PortfolioData } from "@/app/types";
import {
  prioritizeSelectedThemeIds,
  type ThemeFamilyDef,
} from "@/lib/constants/theme-families";

const PREVIEW_HEIGHT = 520;
const PREVIEW_SCALE = 0.72;
const PREVIEW_INNER_WIDTH = 400;
const PREVIEW_OUTER_SCALE = 0.62;

type CompanyThemeFamilyCardProps = {
  family: ThemeFamilyDef;
  selectedThemeId: string;
  available: boolean;
  isSelected: boolean;
  disabled: boolean;
  companyName?: string | null;
  onSelect: (themeId: string) => void;
};

function buildPreviewData(themeId: string, companyName?: string | null): PortfolioData {
  const name = companyName?.trim() || SAMPLE_DATA.bizCard.bizCardName;
  return {
    ...SAMPLE_DATA,
    selectedTheme: themeId,
    bizCard: {
      ...SAMPLE_DATA.bizCard,
      bizCardName: name,
      description:
        companyName?.trim()
          ? `Preview of the ${name} company portfolio theme`
          : SAMPLE_DATA.bizCard.description,
    },
  };
}

function CompanyThemePreview({
  themeId,
  companyName,
}: {
  themeId: string;
  companyName?: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const dirRef = useRef<1 | -1>(1);

  const previewData = useMemo(
    () => buildPreviewData(themeId, companyName),
    [themeId, companyName],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    dirRef.current = 1;
    el.scrollTop = 0;

    const speed = 0.45;
    const tick = () => {
      if (!el) return;
      el.scrollTop += speed * dirRef.current;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
        dirRef.current = -1;
      }
      if (el.scrollTop <= 0) {
        dirRef.current = 1;
      }
      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [themeId]);

  return (
    <div className="relative flex h-72 sm:h-80 md:h-[22rem] justify-center overflow-hidden rounded-2xl border border-slate-100 bg-slate-50 pointer-events-none">
      <div
        className="shrink-0 origin-top"
        style={{
          transform: `scale(${PREVIEW_OUTER_SCALE})`,
          width: `${PREVIEW_INNER_WIDTH}px`,
          transformOrigin: "top center",
        }}
      >
        <PortfolioPreviewFrame
          data={previewData}
          themeId={themeId}
          height={PREVIEW_HEIGHT}
          scale={PREVIEW_SCALE}
          scrollRef={scrollRef}
          className="rounded-[26px] border-0 shadow-none bg-slate-900"
          scrollClassName="bg-slate-900 [&_*]:!opacity-100"
          isMobile
        />
      </div>
    </div>
  );
}

export default function CompanyThemeFamilyCard({
  family,
  selectedThemeId,
  available,
  isSelected,
  disabled,
  companyName,
  onSelect,
}: CompanyThemeFamilyCardProps) {
  const activeThemeId = family.themeIds.includes(selectedThemeId)
    ? selectedThemeId
    : family.defaultThemeId;
  const activeTheme = getTheme(activeThemeId);
  const isFamilySelected = family.themeIds.includes(selectedThemeId);

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={() => {
        if (!disabled) onSelect(activeThemeId);
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === "Enter" || event.key === " ") onSelect(activeThemeId);
      }}
      className={`group relative rounded-3xl overflow-hidden border text-left transition-all duration-300 ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      } ${
        isSelected
          ? "border-primary ring-2 ring-primary/20 shadow-[0_18px_36px_rgba(42,71,146,0.16)]"
          : "border-gray-100 bg-white hover:border-gray-200 hover:-translate-y-0.5 hover:shadow-md"
      }`}
    >
      <div className="h-2 w-full" style={{ background: activeTheme.gradient }} />

      <div className="bg-white p-4 sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3
              className={`text-base font-bold sm:text-lg ${
                isFamilySelected ? "text-primary" : "text-gray-900"
              }`}
            >
              {family.name}
            </h3>
          </div>
        </div>

        <CompanyThemePreview themeId={activeThemeId} companyName={companyName} />

        <div className="mt-4">
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gray-400">
            Select Palette
          </span>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:gap-3">
            {prioritizeSelectedThemeIds(family.themeIds, selectedThemeId).map((themeId) => {
              const theme = getTheme(themeId);
              const paletteSelected = selectedThemeId === themeId;
              return (
                <button
                  key={themeId}
                  type="button"
                  disabled={disabled}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!disabled) onSelect(themeId);
                  }}
                  aria-label={`Select ${theme.name}`}
                  aria-pressed={paletteSelected}
                  title={theme.name}
                  className={`relative h-10 w-full overflow-hidden rounded-lg border transition-all duration-200 ${
                    paletteSelected
                      ? "border-2 border-primary ring-2 ring-primary/20 shadow-sm"
                      : "border border-gray-200 hover:border-gray-300 hover:-translate-y-0.5"
                  } ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <span
                    className="absolute inset-0 border border-white/80 shadow-inner"
                    style={{ background: theme.gradient }}
                  />
                  {paletteSelected ? (
                    <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white shadow-md">
                      <Check className="h-3 w-3" />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <p className="mt-2 truncate text-center text-[10px] font-medium text-gray-500">
            {activeTheme.name}
          </p>
        </div>
      </div>

      {isFamilySelected && available && (
        <div className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold text-white shadow-md">
          <Check className="h-3 w-3" />
          Selected
        </div>
      )}
    </div>
  );
}
