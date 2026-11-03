"use client";

import React, { useMemo } from "react";
import { Lock, Palette } from "lucide-react";
import CompanyThemeFamilyCard from "./CompanyThemeFamilyCard";
import {
  getAvailableThemeFamilies,
  getThemeFamily,
  isThemeFamilyAvailableForTier,
  normalizeThemeTier,
  prioritizeSelectedThemeFamily,
  THEME_FAMILIES,
  type SubscriptionThemeTier,
} from "@/lib/constants/theme-families";
import { HITACHI_THEME_FAMILY_ID, isHitachiCompanyName } from "@/lib/constants/hitachi-companies";

type Props = {
  selectedThemeId: string;
  subscriptionTier: SubscriptionThemeTier | string | null;
  onSelect: (themeId: string) => void;
  disabled?: boolean;
  companyName?: string | null;
};

export default function CompanyThemePicker({
  selectedThemeId,
  subscriptionTier,
  onSelect,
  disabled = false,
  companyName = null,
}: Props) {
  const tier = normalizeThemeTier(String(subscriptionTier ?? ""));
  const companyIsHitachi = isHitachiCompanyName(companyName ?? "");

  const companyFamilies = useMemo(
    () =>
      prioritizeSelectedThemeFamily(
        THEME_FAMILIES.filter(
          (family) =>
            !family.id.startsWith("paidthemes/") &&
            (family.id !== HITACHI_THEME_FAMILY_ID || companyIsHitachi),
        ),
        selectedThemeId,
      ),
    [companyIsHitachi, selectedThemeId],
  );

  const visibleFamilies = useMemo(
    () =>
      prioritizeSelectedThemeFamily(
        getAvailableThemeFamilies(tier).filter(
          (family) =>
            !family.id.startsWith("paidthemes/") &&
            (family.id !== HITACHI_THEME_FAMILY_ID || companyIsHitachi),
        ),
        selectedThemeId,
      ),
    [companyIsHitachi, selectedThemeId, tier],
  );

  const selectedFamily = getThemeFamily(selectedThemeId);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <div className="flex items-start gap-2">
          <Palette className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Theme availability is based on the primary administrator&apos;s subscription tier ({tier}
            ). Saving applies the theme to all active company member BizCards.
          </p>
        </div>
      </div>

      {companyFamilies.length > visibleFamilies.length && (
        <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Upgrade the primary admin subscription to unlock additional theme families.
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {companyFamilies.map((family) => {
          const available = isThemeFamilyAvailableForTier(family.id, tier);
          const isSelected = selectedFamily.id === family.id;
          return (
            <CompanyThemeFamilyCard
              key={family.id}
              family={family}
              selectedThemeId={selectedThemeId}
              available={available}
              isSelected={isSelected}
              disabled={disabled || !available}
              companyName={companyName}
              onSelect={onSelect}
            />
          );
        })}
      </div>

      {!disabled && visibleFamilies.length < companyFamilies.length && (
        <p className="flex items-center gap-2 text-xs text-gray-500">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          Locked themes require a higher subscription tier.
        </p>
      )}
    </div>
  );
}
