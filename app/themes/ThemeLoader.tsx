'use client';

import dynamic from 'next/dynamic';
import Loader from '../components/Loader';
import type { PortfolioViewProps } from './shared';
import { ThemeTextWrap } from './shared';
import { PortfolioThemeProvider } from './components/PortfolioThemeContext';
import PortfolioVisitorLeadHost from './components/PortfolioVisitorLeadHost';

function ThemeLoading() {
  return (
    <div className="flex items-center justify-center bg-[#141832]" style={{ minHeight: '200px' }}>
      <Loader size="lg" color="text-white/30" />
    </div>
  );
}

/* Each theme is its own dynamic import → separate JS chunk */
const ElegantDark = dynamic(() => import('./basic/elegant-dark'), { loading: ThemeLoading });
const ElegantDarkV2 = dynamic(() => import('./basic/elegant-dark/elegant-dark-v2'), { loading: ThemeLoading });
const ElegantDarkV3 = dynamic(() => import('./basic/elegant-dark/elegant-dark-v3'), { loading: ThemeLoading });
const OceanGradient = dynamic(() => import('./standard/ocean-gradient'), { loading: ThemeLoading });
const OceanGradientV2 = dynamic(() => import('./standard/ocean-gradient/ocean-gradient-v2'), { loading: ThemeLoading });
const OceanGradientV3 = dynamic(() => import('./standard/ocean-gradient/ocean-gradient-v3'), { loading: ThemeLoading });
const RoyalPurple = dynamic(() => import('./standard/royal-purple'), { loading: ThemeLoading });
const RoyalPurpleV2 = dynamic(() => import('./standard/royal-purple/royal-purple-v2'), { loading: ThemeLoading });
const RoyalPurpleV3 = dynamic(() => import('./standard/royal-purple/royal-purple-v3'), { loading: ThemeLoading });
const GreenGold = dynamic(() => import('./basic/simple-classico/green-gold'), { loading: ThemeLoading });
const BlueRed = dynamic(() => import('./basic/simple-classico/blue-red'), { loading: ThemeLoading });
const CharcoalYellow = dynamic(() => import('./basic/modern-minimalist/charcoal-yellow'), { loading: ThemeLoading });
const OceanBlue = dynamic(() => import('./basic/modern-minimalist/ocean-blue'), { loading: ThemeLoading });
const LightBlue = dynamic(() => import('./basic/modern-minimalist/light-blue'), { loading: ThemeLoading });
const CarbonDiamond = dynamic(() => import('./standard/premium-gotham/carbon-diamond'), { loading: ThemeLoading });
const VoidPurple = dynamic(() => import('./standard/premium-gotham/void-purple'), { loading: ThemeLoading });
const TimelessGold = dynamic(() => import('./standard/premium-gotham/timeless-gold'), { loading: ThemeLoading });
const CandyFlush = dynamic(() => import('./premium/floral-madness/rose-bloom'), { loading: ThemeLoading });
const SnowContrast = dynamic(() => import('./premium/floral-madness/jasmine-mist'), { loading: ThemeLoading });
const FierySunset = dynamic(() => import('./premium/floral-madness/hibiscus-dusk'), { loading: ThemeLoading });
const ClassicGold = dynamic(() => import('./premium/luxurious-editorial/classic-gold'), { loading: ThemeLoading });
const OceanBlueGold = dynamic(() => import('./premium/luxurious-editorial/ocean-blue-gold'), { loading: ThemeLoading });
const VioletPink = dynamic(() => import('./premium/luxurious-editorial/violet-pink'), { loading: ThemeLoading });
const PristineGold = dynamic(() => import('./premium/nouveau-riche/pristine-gold'), { loading: ThemeLoading });
const BloodRose = dynamic(() => import('./premium/nouveau-riche/blood-rose'), { loading: ThemeLoading });
const MintyGreen = dynamic(() => import('./premium/nouveau-riche/minty-green'), { loading: ThemeLoading });
const IceVariant = dynamic(() => import('./standard/og-neumorphic/ice-variant'), { loading: ThemeLoading });
const WarmPastel = dynamic(() => import('./standard/og-neumorphic/warm-pastel'), { loading: ThemeLoading });
const MidnightMoon = dynamic(() => import('./standard/og-neumorphic/midnight-moon'), { loading: ThemeLoading });
const HotOrange = dynamic(() => import('./basic/simple-classico/hot-orange'), { loading: ThemeLoading });
const HitachiSolutions = dynamic(() => import('./enterprise/hitachi-solutions'), { loading: ThemeLoading });
const BubbleGem = dynamic(() => import('./paidthemes/bubble-gem'), { loading: ThemeLoading });
const FrostedCrystal = dynamic(() => import('./paidthemes/frosted-crystal'), { loading: ThemeLoading });
const DarkCinematic = dynamic(() => import('./paidthemes/dark-cinematic'), { loading: ThemeLoading });

const TEMPLATE_DEFAULTS: Record<string, string> = {
  'basic/simple-classico': 'green-gold',
  'basic/modern-minimalist': 'charcoal-yellow',
  'premium/luxurious-editorial': 'classic-gold',
  'premium/nouveau-riche': 'pristine-gold',
  'premium/og-neumorphic': 'ice-variant',
  'premium/floral-madness': 'rose-bloom',
  'standard/floral-madness': 'rose-bloom',
  'standard/bubble-glass': 'rose-bloom',
  'standard/premium-gotham': 'carbon-diamond',
  'paidthemes/bubble-gem': 'bubble-gem',
  'paidthemes/frosted-crystal': 'frosted-crystal',
  'paidthemes/dark-cinematic': 'dark-cinematic',
};

/** All portfolio theme identifiers resolved by ThemeLoader (including family keys). */
export const PORTFOLIO_THEME_IDS = new Set<string>([
  ...Object.keys(TEMPLATE_DEFAULTS),
  ...Object.values(TEMPLATE_DEFAULTS),
  'elegant-dark',
  'elegant-dark-v2',
  'elegant-dark-v3',
  'ocean-gradient',
  'ocean-gradient-v2',
  'ocean-gradient-v3',
  'royal-purple',
  'royal-purple-v2',
  'royal-purple-v3',
  'green-gold',
  'blue-red',
  'hot-orange',
  'charcoal-yellow',
  'ocean-blue',
  'light-blue',
  'carbon-diamond',
  'void-purple',
  'timeless-gold',
  'rose-bloom',
  'hibiscus-dusk',
  'jasmine-mist',
  'candy-flush',
  'snow-contrast',
  'fiery-sunset',
  'classic-gold',
  'ocean-blue-gold',
  'violet-pink',
  'pristine-gold',
  'blood-rose',
  'minty-green',
  'ice-variant',
  'warm-pastel',
  'midnight-moon',
  'hitachi-solutions',
  'bubble-gem',
  'frosted-crystal',
  'dark-cinematic',
]);

const LEGACY_THEME_ID_MAP: Record<string, string> = {
  '1': 'elegant-dark',
  '2': 'ocean-gradient',
  '3': 'royal-purple',
  'candy-flush': 'rose-bloom',
  'fiery-sunset': 'hibiscus-dusk',
  'snow-contrast': 'jasmine-mist',
};

/**
 * Normalize any theme token from API/localStorage into a ThemeLoader-compatible id.
 * Returns an empty string when the value cannot be mapped.
 */
export function normalizePortfolioThemeId(value: unknown): string {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';

  if (LEGACY_THEME_ID_MAP[raw]) return LEGACY_THEME_ID_MAP[raw];
  if (PORTFOLIO_THEME_IDS.has(raw)) return raw;

  const slug = raw.replace(/\s+/g, '-');
  if (PORTFOLIO_THEME_IDS.has(slug)) return slug;

  for (const themeId of PORTFOLIO_THEME_IDS) {
    if (raw === themeId || raw.endsWith(`/${themeId}`)) return themeId;
  }

  return '';
}

export function resolvePortfolioThemeId(value: unknown, fallback = 'elegant-dark'): string {
  return normalizePortfolioThemeId(value) || fallback;
}

interface ThemeLoaderProps extends PortfolioViewProps {
  themeId?: string;
}

export default function ThemeLoader({ themeId, ...props }: ThemeLoaderProps) {
  const normalizedThemeId = normalizePortfolioThemeId(themeId) || themeId;
  const resolvedThemeId = TEMPLATE_DEFAULTS[normalizedThemeId ?? ''] ?? normalizedThemeId;

  let theme = <ElegantDark {...props} />;
  if (resolvedThemeId === 'elegant-dark') theme = <ElegantDark {...props} />;
  else if (resolvedThemeId === 'elegant-dark-v2') theme = <ElegantDarkV2 {...props} />;
  else if (resolvedThemeId === 'elegant-dark-v3') theme = <ElegantDarkV3 {...props} />;
  else if (resolvedThemeId === 'ocean-gradient') theme = <OceanGradient {...props} />;
  else if (resolvedThemeId === 'ocean-gradient-v2') theme = <OceanGradientV2 {...props} />;
  else if (resolvedThemeId === 'ocean-gradient-v3') theme = <OceanGradientV3 {...props} />;
  else if (resolvedThemeId === 'royal-purple') theme = <RoyalPurple {...props} />;
  else if (resolvedThemeId === 'royal-purple-v2') theme = <RoyalPurpleV2 {...props} />;
  else if (resolvedThemeId === 'royal-purple-v3') theme = <RoyalPurpleV3 {...props} />;
  else if (resolvedThemeId === 'green-gold') theme = <GreenGold {...props} />;
  else if (resolvedThemeId === 'blue-red') theme = <BlueRed {...props} />;
  else if (resolvedThemeId === 'charcoal-yellow') theme = <CharcoalYellow {...props} />;
  else if (resolvedThemeId === 'ocean-blue') theme = <OceanBlue {...props} />;
  else if (resolvedThemeId === 'light-blue') theme = <LightBlue {...props} />;
  else if (resolvedThemeId === 'carbon-diamond') theme = <CarbonDiamond {...props} />;
  else if (resolvedThemeId === 'void-purple') theme = <VoidPurple {...props} />;
  else if (resolvedThemeId === 'timeless-gold') theme = <TimelessGold {...props} />;
  else if (resolvedThemeId === 'rose-bloom' || resolvedThemeId === 'candy-flush') theme = <CandyFlush {...props} />;
  else if (resolvedThemeId === 'jasmine-mist' || resolvedThemeId === 'snow-contrast') theme = <SnowContrast {...props} />;
  else if (resolvedThemeId === 'hibiscus-dusk' || resolvedThemeId === 'fiery-sunset') theme = <FierySunset {...props} />;
  else if (resolvedThemeId === 'classic-gold') theme = <ClassicGold {...props} />;
  else if (resolvedThemeId === 'ocean-blue-gold') theme = <OceanBlueGold {...props} />;
  else if (resolvedThemeId === 'violet-pink') theme = <VioletPink {...props} />;
  else if (resolvedThemeId === 'pristine-gold') theme = <PristineGold {...props} />;
  else if (resolvedThemeId === 'blood-rose') theme = <BloodRose {...props} />;
  else if (resolvedThemeId === 'minty-green') theme = <MintyGreen {...props} />;
  else if (resolvedThemeId === 'ice-variant') theme = <IceVariant {...props} />;
  else if (resolvedThemeId === 'warm-pastel') theme = <WarmPastel {...props} />;
  else if (resolvedThemeId === 'midnight-moon') theme = <MidnightMoon {...props} />;
  else if (resolvedThemeId === 'hot-orange') theme = <HotOrange {...props} />;
  else if (resolvedThemeId === 'hitachi-solutions') theme = <HitachiSolutions {...props} />;
  else if (resolvedThemeId === 'bubble-gem') theme = <BubbleGem {...props} />;
  else if (resolvedThemeId === 'frosted-crystal') theme = <FrostedCrystal {...props} />;
  else if (resolvedThemeId === 'dark-cinematic') theme = <DarkCinematic {...props} />;

  const leadHost = (
    <PortfolioVisitorLeadHost
      data={props.data}
      themeId={resolvedThemeId}
      mini={props.mini}
    />
  );

  const wrapped = (
    <PortfolioThemeProvider themeId={resolvedThemeId} data={props.data}>
      {theme}
      {leadHost}
    </PortfolioThemeProvider>
  );

  return <ThemeTextWrap>{wrapped}</ThemeTextWrap>;
}
