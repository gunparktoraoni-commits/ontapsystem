'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { Check } from 'lucide-react';
import { SectionLoader } from './Loader';
import StepIndicator from './StepIndicator';
import { THEME_FAMILIES, getTheme, type ThemeFamilyDef } from './BizCardPreview';
import { ScaledThemePreview } from './PortfolioPreviewFrame';

import type { PortfolioData } from '../types';
import { HITACHI_THEME_FAMILY_ID } from '@/lib/constants/hitachi-companies';
import {
  normalizeThemeId,
  prioritizeSelectedThemeFamily,
  prioritizeSelectedThemeIds,
} from '@/lib/constants/theme-families';
import { getFrontendApiBaseUrl } from './apiBase';
import { buildImpersonationHeaders } from '@/app/lib/superadminImpersonationHandoff';

const API = getFrontendApiBaseUrl();

async function fetchOwnedPaidThemePaths(): Promise<Set<string>> {
  try {
    const response = await fetch(
      `${API}/api/marketplace/templates?owned_only=true&category=customize-templates&limit=50`,
      { credentials: 'include', cache: 'no-store', headers: buildImpersonationHeaders() },
    );
    if (!response.ok) return new Set();
    const payload = await response.json().catch(() => null);
    const templates = Array.isArray(payload?.data?.templates)
      ? (payload.data.templates as Array<Record<string, unknown>>)
      : [];
    return new Set(
      templates
        .map((template) => String(template.themePath ?? template.theme_path ?? '').trim())
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

interface ChooseThemeProps {
  onContinue: (theme: string) => void;
  onBack: () => void;
  currentStep: number;
  totalSteps: number;
  initialTheme?: string;
  subscriptionTier?: string;
  previewData?: PortfolioData;
}

type SubscriptionTier = 'basic' | 'standard' | 'premium';

function normalizeSubscriptionTier(value: unknown): SubscriptionTier {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'premium') return 'premium';
  if (raw === 'standard') return 'standard';
  return 'basic';
}

const getTierLabel = (tier: string): string => {
  switch (tier) {
    case 'premium':
      return 'Premium';
    case 'standard':
      return 'Standard';
    case 'enterprise':
      return 'Enterprise';
    case 'basic':
    default:
      return 'Basic';
  }
};

const getTierBadgeColor = (tier: string): string => {
  switch (tier) {
    case 'premium':
      return 'bg-purple-100 text-purple-700';
    case 'standard':
      return 'bg-blue-100 text-blue-700';
    case 'enterprise':
      return 'bg-red-100 text-red-700';
    case 'basic':
    default:
      return 'bg-slate-100 text-slate-700';
  }
};

const ChooseTheme: React.FC<ChooseThemeProps> = ({
  onContinue,
  onBack,
  currentStep,
  totalSteps,
  initialTheme,
  subscriptionTier,
  previewData,
}) => {
  const [selectedTheme, setSelectedTheme] = useState<string | null>(initialTheme ?? null);
  const [isHitachiCompany, setIsHitachiCompany] = useState(false);
  const [ownedPaidThemePaths, setOwnedPaidThemePaths] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetch(`${API}/api/user/company-theme-policy`, {
        credentials: 'include',
        cache: 'no-store',
        headers: buildImpersonationHeaders(),
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload) => {
          if (cancelled || !payload) return;
          const data = (payload?.data ?? payload) as Record<string, unknown>;
          setIsHitachiCompany(data.is_hitachi_company === true);
        })
        .catch(() => {
          if (!cancelled) setIsHitachiCompany(false);
        }),
      fetchOwnedPaidThemePaths().then((owned) => {
        if (!cancelled) setOwnedPaidThemePaths(owned);
      }),
    ]).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Must be declared before any early returns — Rules of Hooks
  useEffect(() => {
    if (initialTheme) {
      setSelectedTheme(initialTheme);
    }
  }, [initialTheme]);

  // All useMemo hooks must also be above any early return
  const selectedThemeDef = useMemo(() => getTheme(selectedTheme ?? undefined), [selectedTheme]);
  const effectiveSubscriptionTier = useMemo(
    () => normalizeSubscriptionTier(subscriptionTier),
    [subscriptionTier]
  );

   

  const visibleThemeFamilies = useMemo(() => {
    let base: ThemeFamilyDef[] = [];

    if (effectiveSubscriptionTier === 'premium') {
      // Premium gets all basic + standard + premium
      base = THEME_FAMILIES.filter(
        (family) =>
          (family.tier === 'basic' || family.tier === 'standard' || family.tier === 'premium') &&
          family.id !== HITACHI_THEME_FAMILY_ID &&
          !family.id.startsWith('paidthemes/')
      );
    } else if (effectiveSubscriptionTier === 'standard') {
      // Standard gets basic + standard only
      base = THEME_FAMILIES.filter(
        (family) =>
          (family.tier === 'basic' || family.tier === 'standard') &&
          family.id !== HITACHI_THEME_FAMILY_ID &&
          !family.id.startsWith('paidthemes/')
      );
    } else {
      // Basic gets basic tier only
      base = THEME_FAMILIES.filter(
        (family) =>
          family.tier === 'basic' &&
          family.id !== HITACHI_THEME_FAMILY_ID &&
          !family.id.startsWith('paidthemes/')
      );
    }

    // Purchased E-Market templates unlock into Choose Theme regardless of subscription tier.
    const ownedPaidFamilies = THEME_FAMILIES.filter(
      (family) =>
        family.id.startsWith('paidthemes/') &&
        family.themeIds.some((themeId) => ownedPaidThemePaths.has(themeId)),
    );
    if (ownedPaidFamilies.length > 0) {
      const existing = new Set(base.map((family) => family.id));
      base = [
        ...base,
        ...ownedPaidFamilies.filter((family) => !existing.has(family.id)),
      ];
    }

    if (!isHitachiCompany) {
      return base;
    }

    const hitachiFamily = THEME_FAMILIES.find((family) => family.id === HITACHI_THEME_FAMILY_ID);
    if (!hitachiFamily || base.some((family) => family.id === HITACHI_THEME_FAMILY_ID)) {
      return base;
    }
    return [...base, hitachiFamily];
  }, [effectiveSubscriptionTier, isHitachiCompany, ownedPaidThemePaths]);

  const orderedThemeFamilies = useMemo(
    () => prioritizeSelectedThemeFamily(visibleThemeFamilies, selectedTheme),
    [selectedTheme, visibleThemeFamilies],
  );
  const selectedThemeFamily = useMemo(
    () =>
      selectedTheme
        ? visibleThemeFamilies.find((family) => family.themeIds.includes(normalizeThemeId(selectedTheme))) ?? null
        : null,
    [selectedTheme, visibleThemeFamilies],
  );

  // Group families by tier for display
  const groupedFamilies = useMemo(() => {
    const groups: Record<string, ThemeFamilyDef[]> = {
      basic: [],
      standard: [],
      premium: [],
      enterprise: [],
    };

    orderedThemeFamilies
      .filter((family) => family.id !== selectedThemeFamily?.id)
      .forEach((family) => {
      if (groups[family.tier]) {
        groups[family.tier].push(family);
      }
    });

    return groups;
  }, [orderedThemeFamilies, selectedThemeFamily]);

  if (loading) {
    return <SectionLoader text="Loading themes..." />;
  }

  const handleSelectTheme = (themeId: string) => {
    setSelectedTheme(themeId);
  };
  const handleSelectFamily = (family: ThemeFamilyDef) => {
    handleSelectTheme(family.defaultThemeId);
  };
  const handleContinue = () => {
    if (selectedTheme) onContinue(selectedTheme);
  };
  return (
    <div className="relative left-1/2 w-[min(100vw-2rem,64rem)] max-w-5xl -translate-x-1/2 bg-white rounded-3xl p-6 sm:p-8 shadow-[0_24px_80px_rgba(15,23,42,0.08)] border border-slate-100">
      <StepIndicator currentStep={currentStep} totalSteps={totalSteps} />

      <div className="text-center mb-7">
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900 mb-1">Choose Your Portfolio Theme</h1>
        <p className="text-slate-500 text-sm sm:text-base">Select one template card, then choose a color palette inside it.</p>
      </div>

      <div className="space-y-10">
        {selectedThemeFamily ? (
          <div>
            <h2 className="mb-4 pl-1 text-xs font-black uppercase tracking-[0.16em] text-slate-500">
              Currently Selected
            </h2>
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:gap-6 lg:gap-8 md:grid-cols-2 xl:grid-cols-3">
              <TemplateThemeCard
                family={selectedThemeFamily}
                selectedTheme={selectedTheme}
                previewData={previewData}
                onSelectFamily={handleSelectFamily}
                onSelectTheme={handleSelectTheme}
              />
            </div>
          </div>
        ) : null}
        {/* BASIC TIER */}
        {groupedFamilies.basic.length > 0 && (
          <div>
            <h2 className="text-xs font-black tracking-[0.16em] uppercase text-slate-500 mb-4 pl-1">Basic Templates</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6 lg:gap-8 min-w-0">
              {groupedFamilies.basic.map((family) => (
                <TemplateThemeCard
                  key={family.id}
                  family={family}
                  selectedTheme={selectedTheme}
                  previewData={previewData}
                  onSelectFamily={handleSelectFamily}
                  onSelectTheme={handleSelectTheme}
                />
              ))}
            </div>
          </div>
        )}

        {/* STANDARD TIER */}
        {groupedFamilies.standard.length > 0 && (
          <div>
            <h2 className="text-xs font-black tracking-[0.16em] uppercase text-slate-500 mb-4 pl-1">Standard Templates</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6 lg:gap-8 min-w-0">
              {groupedFamilies.standard.map((family) => (
                <TemplateThemeCard
                  key={family.id}
                  family={family}
                  selectedTheme={selectedTheme}
                  previewData={previewData}
                  onSelectFamily={handleSelectFamily}
                  onSelectTheme={handleSelectTheme}
                />
              ))}
            </div>
          </div>
        )}

        {/* PREMIUM TIER */}
        {groupedFamilies.premium.length > 0 && (
          <div>
            <h2 className="text-xs font-black tracking-[0.16em] uppercase text-slate-500 mb-4 pl-1">Premium Templates</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6 lg:gap-8 min-w-0">
              {groupedFamilies.premium.map((family) => (
                <TemplateThemeCard
                  key={family.id}
                  family={family}
                  selectedTheme={selectedTheme}
                  previewData={previewData}
                  onSelectFamily={handleSelectFamily}
                  onSelectTheme={handleSelectTheme}
                />
              ))}
            </div>
          </div>
        )}

        {/* ENTERPRISE TIER */}
        {groupedFamilies.enterprise.length > 0 && (
          <div>
            <h2 className="text-xs font-black tracking-[0.16em] uppercase text-slate-500 mb-4 pl-1">Enterprise Templates</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6 lg:gap-8 min-w-0">
              {groupedFamilies.enterprise.map((family) => (
                <TemplateThemeCard
                  key={family.id}
                  family={family}
                  selectedTheme={selectedTheme}
                  previewData={previewData}
                  onSelectFamily={handleSelectFamily}
                  onSelectTheme={handleSelectTheme}
                />
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex-1 border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold py-3 rounded-xl transition-colors text-sm cursor-pointer"
          >
            Back
          </button>
          <button
            type="button"
            onClick={handleContinue}
            disabled={!selectedTheme}
            className="flex-1 bg-[#1e3a8a] hover:bg-[#1d2f75] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors text-sm cursor-pointer"
          >
            Continue with {selectedTheme ? selectedThemeDef.name : 'selected theme'}
          </button>
        </div>
      </div>
    </div>
  );
};

interface TemplateThemeCardProps {
  family: ThemeFamilyDef;
  selectedTheme: string | null;
  previewData?: PortfolioData;
  onSelectFamily: (family: ThemeFamilyDef) => void;
  onSelectTheme: (themeId: string) => void;
}

function TemplateThemeCard({ family, selectedTheme, previewData, onSelectFamily, onSelectTheme }: TemplateThemeCardProps) {
  const activeThemeId = family.themeIds.includes(selectedTheme ?? '') ? (selectedTheme as string) : family.defaultThemeId;
  const activeTheme = getTheme(activeThemeId);
  const isSelectedFamily = family.themeIds.includes(selectedTheme ?? '');

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelectFamily(family)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onSelectFamily(family);
      }}
      className={`group relative w-full min-w-0 h-full rounded-3xl overflow-hidden border text-left transition-all duration-300 cursor-pointer ${
        isSelectedFamily
          ? 'border-[#1e3a8a] ring-2 ring-blue-200/70 shadow-[0_18px_36px_rgba(30,58,138,0.16)]'
          : 'border-slate-200 hover:border-slate-300 hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(15,23,42,0.12)]'
      }`}
    >
      {/* Gradient Bar */}
      <div className="h-3 w-full" style={{ background: activeTheme.gradient }} />

      <div className="p-4 sm:p-5 bg-white">
        {/* Tier Badge + Template Name */}
        <div className="min-w-0 flex-1 mb-4">
          <span className={`inline-block text-[9px] font-bold tracking-[0.24em] uppercase px-2.5 py-1 rounded-full mb-2 ${getTierBadgeColor(family.tier)}`}>
            {getTierLabel(family.tier)}
          </span>
          <h3 className={`text-lg font-black ${isSelectedFamily ? 'text-[#1e3a8a]' : 'text-slate-900'}`}>
            {family.name}
          </h3>
        </div>

        {/* Preview */}
        <ScaledThemePreview
          data={previewData}
          themeId={activeThemeId}
          className="h-64 sm:h-72 bg-slate-100/80"
        />

        {/* Color Palette Selector */}
        <div className="mt-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between mb-3">
            <span className="text-[10px] tracking-[0.22em] uppercase text-slate-400 font-semibold">Color Palette</span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-slate-400 shrink-0">Select a swatch</span>
          </div>
          <div className="flex flex-wrap gap-2 sm:gap-2.5">
            {prioritizeSelectedThemeIds(family.themeIds, selectedTheme).map((themeId) => {
              const theme = getTheme(themeId);
              const isSelected = selectedTheme === themeId;
              return (
                <button
                  key={themeId}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectTheme(themeId);
                  }}
                  aria-label={`Select ${theme.name}`}
                  className={`h-10 px-3 rounded-full border transition-all duration-200 flex items-center gap-2 relative ${
                    isSelected
                      ? 'border-[#1e3a8a] ring-2 ring-blue-200/70 bg-blue-50 text-[#1e3a8a] shadow-sm'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:-translate-y-0.5'
                  }`}
                >
                  <span className="h-4 w-4 rounded-full border border-white shadow-sm" style={{ background: theme.gradient }} />
                  <span className="text-[11px] font-semibold whitespace-nowrap">{theme.name}</span>
                  {isSelected ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#1e3a8a] text-white text-[9px] font-bold px-1.5 py-0.5">
                      <Check className="h-3 w-3" /> Selected
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {isSelectedFamily && (
        <div className="absolute top-4 right-4 rounded-full bg-[#1e3a8a] text-white text-[10px] font-bold px-2.5 py-1 shadow-md inline-flex items-center gap-1">
          <Check className="h-3 w-3" /> Selected
        </div>
      )}
    </div>
  );
}

export default ChooseTheme;
