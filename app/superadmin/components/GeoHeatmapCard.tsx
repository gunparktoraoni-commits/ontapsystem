'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  Download,
  Maximize2,
  MoreVertical,
  RefreshCcw,
  Search,
} from 'lucide-react';
import { InlineLoader } from '../../components/Loader';

import type { GeoHeatmapPoint } from './GeoHeatmapMap';
import { fetchSuperAdmin, type DateFilter } from './dashboardApi';
import {
  DASHBOARD_CARD_SHELL,
  DASHBOARD_DARK_PANEL_STYLE,
  DASHBOARD_GLASS_STYLE,
  DASHBOARD_SCROLLBAR_CLASS,
  DASHBOARD_SUBTITLE_CLASS,
} from './ui/portalTokens';

const GeoHeatmapMap = dynamic(
  () => import('./GeoHeatmapMap').then((mod) => mod.GeoHeatmapMap),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex h-[420px] w-full items-center justify-center rounded-2xl text-sm font-semibold"
        style={{ ...DASHBOARD_DARK_PANEL_STYLE, color: '#94a3b8' }}
      >
        <InlineLoader /> Loading map…
      </div>
    ),
  },
);

type LocationView = 'map' | 'cities';
type HeatmapMode = 'last_login' | 'registration';
type PeriodOption = {
  id: DateFilter | 'custom';
  label: string;
};

interface BackendLocation {
  latitude: number | null;
  longitude: number | null;
  country: string | null;
  city: string | null;
  location_string: string | null;
  is_login_location: boolean;
}

interface BackendMapUser {
  user_id: string;
  name: string;
  email: string;
  location: BackendLocation;
  last_active: string | null;
  activity_type: 'login' | 'registration';
}

interface BackendCity {
  city: string | null;
  country: string | null;
  user_count: number;
  percentage: number;
}

interface BackendEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { message?: string } | string;
  message?: string;
}

interface TopCity {
  city: string;
  country: string;
  users: number;
  percentage: number;
}

const POLL_INTERVAL_MS = 30_000;
const MAP_LIMIT = 500;
const CITIES_LIMIT = 25;

const PERIOD_OPTIONS: PeriodOption[] = [
  { id: 'today', label: 'Today' },
  { id: 'this_week', label: 'This Week' },
  { id: 'this_month', label: 'This Month' },
  { id: 'custom', label: 'Custom Date' },
];

const numberFormatter = new Intl.NumberFormat('en-US');

function formatCount(value: number): string {
  return numberFormatter.format(value);
}

function formatLastUpdated(value: string | null): string {
  if (!value) return 'never';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'never';
  return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function getBarWidth(value: number, max: number): string {
  if (value <= 0 || max <= 0) return '8%';
  return `${Math.max(10, Math.round((value / max) * 100))}%`;
}

function mapUserToPoint(user: BackendMapUser): GeoHeatmapPoint | null {
  const loc = user.location;
  if (
    !loc ||
    typeof loc.latitude !== 'number' ||
    typeof loc.longitude !== 'number' ||
    !Number.isFinite(loc.latitude) ||
    !Number.isFinite(loc.longitude)
  ) {
    return null;
  }

  const city = loc.city || 'Unknown';
  const country = loc.country || '';
  const lastSeen = user.last_active || '';

  return {
    id: user.user_id,
    userType: loc.is_login_location ? 'visitor' : 'registered',
    latitude: loc.latitude,
    longitude: loc.longitude,
    city,
    region: country,
    country,
    ipAddress: '',
    firstSeenAt: lastSeen,
    lastSeenAt: lastSeen,
    visitCount: 1,
    label: user.name?.trim() || user.email || 'User',
  };
}

function buildLocationsQuery(params: {
  view: LocationView;
  limit: number;
  mode: HeatmapMode;
  period: DateFilter | 'custom';
  customStart: string;
  customEnd: string;
}): string {
  const search = new URLSearchParams({
    view: params.view,
    limit: String(params.limit),
    activity: params.mode === 'last_login' ? 'login' : 'registration',
    date_filter: params.period === 'custom' ? 'custom' : params.period,
  });

  if (params.period === 'custom' && params.customStart && params.customEnd) {
    search.set('custom_start_date', params.customStart);
    search.set('custom_end_date', params.customEnd);
  }

  return search.toString();
}

export default function GeoHeatmapCard() {
  const [mode, setMode] = useState<HeatmapMode>('last_login');
  const [period, setPeriod] = useState<DateFilter | 'custom'>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [citySearch, setCitySearch] = useState('');

  const [points, setPoints] = useState<GeoHeatmapPoint[]>([]);
  const [topCities, setTopCities] = useState<TopCity[]>([]);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const mapShellRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);

  const periodLabel = PERIOD_OPTIONS.find((option) => option.id === period)?.label ?? 'Today';
  const customReady = period !== 'custom' || (Boolean(customStart) && Boolean(customEnd));

  const fetchHeatmap = useCallback(
    async (silent: boolean) => {
      if (!customReady) return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (silent) setRefreshing(true);
      else setLoading(true);

      try {
        const mapQuery = buildLocationsQuery({
          view: 'map',
          limit: MAP_LIMIT,
          mode,
          period,
          customStart,
          customEnd,
        });
        const citiesQuery = buildLocationsQuery({
          view: 'cities',
          limit: CITIES_LIMIT,
          mode,
          period,
          customStart,
          customEnd,
        });

        const [mapEnvelope, citiesEnvelope] = await Promise.all([
          fetchSuperAdmin<BackendMapUser[]>(
            `/api/superadmin/users/locations?${mapQuery}`,
            undefined,
            controller.signal,
          ) as Promise<BackendEnvelope<BackendMapUser[]>>,
          fetchSuperAdmin<BackendCity[]>(
            `/api/superadmin/users/locations?${citiesQuery}`,
            undefined,
            controller.signal,
          ) as Promise<BackendEnvelope<BackendCity[]>>,
        ]);

        if (controller.signal.aborted) return;

        if (!mapEnvelope?.success || !Array.isArray(mapEnvelope.data)) {
          const errMsg =
            (typeof mapEnvelope?.error === 'string' ? mapEnvelope.error : mapEnvelope?.error?.message) ||
            mapEnvelope?.message ||
            'Failed to fetch user locations.';
          throw new Error(errMsg);
        }

        const mappedPoints = mapEnvelope.data
          .map((user) => mapUserToPoint(user))
          .filter((point): point is GeoHeatmapPoint => point !== null);

        const mappedCities: TopCity[] = Array.isArray(citiesEnvelope?.data)
          ? citiesEnvelope.data
              .filter((city) => city && city.city)
              .map((city) => ({
                city: city.city ?? 'Unknown',
                country: city.country ?? '',
                users: city.user_count ?? 0,
                percentage: city.percentage ?? 0,
              }))
          : [];

        setPoints(mappedPoints);
        setTopCities(mappedCities);
        setRefreshedAt(new Date().toISOString());
        setError('');
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        const message = err instanceof Error ? err.message : 'Unable to load heatmap data.';
        setError(message);
        if (!silent) {
          setPoints([]);
          setTopCities([]);
        }
      } finally {
        inFlightRef.current = false;
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [customEnd, customReady, customStart, mode, period],
  );

  useEffect(() => {
    void fetchHeatmap(false);
    const interval = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void fetchHeatmap(true);
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [fetchHeatmap]);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const totalActiveCities = useMemo(() => {
    const unique = new Set(points.map((point) => `${point.city}|${point.country}`));
    return unique.size;
  }, [points]);

  const filteredCities = useMemo(() => {
    const query = citySearch.trim().toLowerCase();
    if (!query) return topCities.slice(0, 6);
    return topCities
      .filter((city) => `${city.city} ${city.country}`.toLowerCase().includes(query))
      .slice(0, 6);
  }, [citySearch, topCities]);

  const cityPeak = useMemo(
    () => filteredCities.reduce((peak, city) => Math.max(peak, city.users), 0),
    [filteredCities],
  );

  const totalUsersTracked = useMemo(
    () => topCities.reduce((sum, city) => sum + city.users, 0),
    [topCities],
  );

  const toggleFullscreen = useCallback(async () => {
    const el = mapShellRef.current;
    if (!el || typeof document === 'undefined') return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch {
      // Fullscreen may be blocked in iframes — silently ignore.
    }
  }, []);

  const downloadSnapshot = useCallback(() => {
    if (typeof window === 'undefined') return;
    const payload = {
      mode,
      period,
      customStart,
      customEnd,
      refreshedAt,
      pointCount: points.length,
      points,
      topCities,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `geo-heatmap-${mode}-${period}-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [customEnd, customStart, mode, period, points, refreshedAt, topCities]);

  const modeLabel = mode === 'last_login' ? 'LAST LOGIN' : 'REGISTRATIONS';

  return (
    <section className={`${DASHBOARD_CARD_SHELL} overflow-hidden`} style={DASHBOARD_GLASS_STYLE}>
      <div className="relative z-10 flex flex-wrap items-start justify-between gap-3 border-b border-[rgba(42,71,146,0.28)] px-5 py-4 lg:px-6">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-extrabold tracking-tight text-white">Geo Heatmap</h3>
          </div>
          <p className={`mt-0.5 ${DASHBOARD_SUBTITLE_CLASS}`}>
            {mode === 'last_login'
              ? `Users who logged in · ${periodLabel}`
              : `Users who registered · ${periodLabel}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-[rgba(42,71,146,0.4)] bg-[rgba(42,71,146,0.18)] p-1 backdrop-blur-sm">
            <button
              type="button"
              onClick={() => setMode('last_login')}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                mode === 'last_login'
                  ? 'bg-[#2A4792] text-white shadow-sm'
                  : 'text-slate-400 hover:bg-[rgba(42,71,146,0.25)] hover:text-slate-200'
              }`}
            >
              Last Login
            </button>
            <button
              type="button"
              onClick={() => setMode('registration')}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                mode === 'registration'
                  ? 'bg-[#2A4792] text-white shadow-sm'
                  : 'text-slate-400 hover:bg-[rgba(42,71,146,0.25)] hover:text-slate-200'
              }`}
            >
              Registrations
            </button>
          </div>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[rgba(42,71,146,0.45)] bg-[rgba(42,71,146,0.2)] px-2.5 text-xs font-semibold text-slate-200 backdrop-blur-sm transition-colors hover:bg-[rgba(42,71,146,0.32)]"
              aria-label="Date filters"
              title="Date filters"
            >
              <MoreVertical className="h-4 w-4" />
              <CalendarDays className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{periodLabel}</span>
            </button>

            {menuOpen ? (
              <div className="absolute right-0 z-30 mt-2 w-56 overflow-hidden rounded-2xl border border-[rgba(42,71,146,0.4)] bg-[#0d1525]/95 py-1 shadow-xl backdrop-blur-xl">
                <p className="px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                  Date filter
                </p>
                {PERIOD_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      setPeriod(option.id);
                      if (option.id !== 'custom') setMenuOpen(false);
                    }}
                    className={`block w-full px-3 py-2 text-left text-xs font-semibold transition-colors ${
                      period === option.id
                        ? 'bg-[rgba(42,71,146,0.35)] text-[#93c5fd]'
                        : 'text-slate-300 hover:bg-[rgba(42,71,146,0.2)]'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
                {period === 'custom' ? (
                  <div className="space-y-2 border-t border-[rgba(42,71,146,0.25)] px-3 py-3">
                    <label className="block text-[11px] font-semibold text-slate-400">
                      Start
                      <input
                        type="date"
                        value={customStart}
                        onChange={(event) => setCustomStart(event.target.value)}
                        className="mt-1 h-9 w-full rounded-lg border border-[rgba(42,71,146,0.4)] bg-[rgba(17,29,53,0.9)] px-2 text-xs text-slate-200 outline-none focus:border-[#93c5fd]"
                        style={{ colorScheme: 'dark' }}
                      />
                    </label>
                    <label className="block text-[11px] font-semibold text-slate-400">
                      End
                      <input
                        type="date"
                        value={customEnd}
                        onChange={(event) => setCustomEnd(event.target.value)}
                        className="mt-1 h-9 w-full rounded-lg border border-[rgba(42,71,146,0.4)] bg-[rgba(17,29,53,0.9)] px-2 text-xs text-slate-200 outline-none focus:border-[#93c5fd]"
                        style={{ colorScheme: 'dark' }}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={!customReady}
                      onClick={() => {
                        setMenuOpen(false);
                        void fetchHeatmap(false);
                      }}
                      className="h-9 w-full rounded-lg bg-[#2A4792] text-xs font-bold text-white disabled:opacity-50"
                    >
                      Apply range
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {error ? (
        <div className="mx-5 mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 lg:mx-6">
          {error}
        </div>
      ) : null}

      <div className="relative z-10 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="border-b border-[rgba(42,71,146,0.28)] p-4 sm:p-5 xl:border-b-0 xl:border-r xl:border-[rgba(42,71,146,0.28)]">
          <div
            ref={mapShellRef}
            className="relative overflow-hidden rounded-2xl"
            style={DASHBOARD_DARK_PANEL_STYLE}
          >
            {loading ? (
              <div
                className="flex h-[420px] w-full items-center justify-center text-sm font-semibold"
                style={{ color: '#94a3b8' }}
              >
                <InlineLoader /> Loading map data…
              </div>
            ) : (
              <>
                <GeoHeatmapMap points={points} />
                {points.length === 0 ? (
                  <div
                    className="pointer-events-none absolute inset-0 z-[400] flex flex-col items-center justify-center gap-2 px-6 text-center text-sm backdrop-blur-[1px]"
                    style={{ background: 'rgba(8,14,30,0.55)', color: '#94a3b8' }}
                  >
                    <div className="text-base font-bold" style={{ color: '#e2e8f0' }}>
                      No location data for this filter
                    </div>
                    <p className="max-w-xs">
                      No users with{' '}
                      {mode === 'last_login' ? 'login geolocation' : 'registration geolocation'} were
                      recorded in {periodLabel.toLowerCase()}.
                    </p>
                  </div>
                ) : null}
              </>
            )}

            <div
              className="pointer-events-auto absolute right-3 top-3 z-[500] flex flex-col overflow-hidden rounded-xl backdrop-blur"
              style={{
                border: '1px solid rgba(59,87,163,0.35)',
                background: 'rgba(13,21,37,0.92)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              }}
            >
              <button
                type="button"
                onClick={() => void toggleFullscreen()}
                className="inline-flex h-9 w-9 items-center justify-center border-b transition-colors hover:text-[#93c5fd]"
                style={{ borderColor: 'rgba(59,87,163,0.25)', color: '#94a3b8' }}
                title="Toggle fullscreen"
                aria-label="Toggle fullscreen"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => void fetchHeatmap(true)}
                disabled={refreshing}
                className="inline-flex h-9 w-9 items-center justify-center border-b transition-colors hover:text-[#93c5fd] disabled:cursor-not-allowed disabled:opacity-60"
                style={{ borderColor: 'rgba(59,87,163,0.25)', color: '#94a3b8' }}
                title="Refresh data"
                aria-label="Refresh data"
              >
                <RefreshCcw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={downloadSnapshot}
                className="inline-flex h-9 w-9 items-center justify-center transition-colors hover:text-[#93c5fd]"
                style={{ color: '#94a3b8' }}
                title="Download snapshot"
                aria-label="Download snapshot"
              >
                <Download className="h-4 w-4" />
              </button>
            </div>

            <div
              className="pointer-events-none absolute bottom-3 left-3 z-[500] inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold backdrop-blur"
              style={{
                border: '1px solid rgba(59,87,163,0.35)',
                background: 'rgba(13,21,37,0.9)',
                color: '#cbd5e1',
                boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
              }}
            >
              <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: '#2A4792' }} />
              {formatCount(totalActiveCities)} active{' '}
              {totalActiveCities === 1 ? 'city' : 'cities'} · {formatCount(points.length)} users
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-[rgba(42,71,146,0.35)] bg-[rgba(42,71,146,0.16)] px-4 py-3 backdrop-blur-sm">
            <p className="text-[10px] font-bold tracking-[0.14em] text-slate-400">DENSITY SCALE</p>
            <div className="mt-2 grid grid-cols-3 gap-3 text-[11px] font-semibold text-slate-400">
              <div>
                <div className="h-2 rounded-full bg-gradient-to-r from-[#2A4792]/30 to-[#4785B8]/50" />
                <p className="mt-1">Low</p>
              </div>
              <div>
                <div className="h-2 rounded-full bg-gradient-to-r from-[#4785B8]/60 to-[#2A4792]/80" />
                <p className="mt-1">Medium</p>
              </div>
              <div>
                <div className="h-2 rounded-full bg-gradient-to-r from-[#2A4792] to-[#1e3a75]" />
                <p className="mt-1">High</p>
              </div>
            </div>
          </div>
        </div>

        <aside className="flex flex-col p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h4 className="text-2xl font-extrabold tracking-tight text-white">Top Cities</h4>
              <p className={DASHBOARD_SUBTITLE_CLASS}>
                By {modeLabel.toLowerCase()} · {periodLabel}
              </p>
            </div>
          </div>

          <div
            className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl"
            style={DASHBOARD_DARK_PANEL_STYLE}
          >
            {loading && filteredCities.length === 0 ? (
              <div
                className="flex h-full min-h-80 items-center justify-center text-sm"
                style={{ color: '#94a3b8' }}
              >
                <InlineLoader /> Loading cities…
              </div>
            ) : filteredCities.length > 0 ? (
              <div className={`max-h-[340px] flex-1 ${DASHBOARD_SCROLLBAR_CLASS}`}>
                {filteredCities.map((city, index) => (
                  <div
                    key={`${city.city}-${city.country}-${index}`}
                    className="border-b px-4 py-3.5 transition-colors last:border-b-0"
                    style={{
                      borderColor: 'rgba(59,87,163,0.15)',
                      animation: 'geoFadeIn 320ms ease-out both',
                      animationDelay: `${index * 40}ms`,
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold"
                          style={{
                            background: 'rgba(59,87,163,0.15)',
                            color: '#93c5fd',
                          }}
                        >
                          {index + 1}
                        </span>
                        <p className="truncate text-sm font-bold" style={{ color: '#e2e8f0' }}>
                          {city.city}
                        </p>
                      </div>
                      <div className="text-right">
                        <p
                          className="text-[26px] leading-none font-black tracking-tight tabular-nums"
                          style={{ color: '#f1f5f9' }}
                        >
                          {formatCount(city.users)}
                        </p>
                        <p
                          className="mt-1 text-[10px] font-bold tracking-[0.14em]"
                          style={{ color: '#64748b' }}
                        >
                          USERS
                        </p>
                      </div>
                    </div>
                    <p className="mt-0.5 truncate text-xs" style={{ color: '#64748b' }}>
                      {city.country || 'Unknown region'} · {city.percentage.toFixed(1)}%
                    </p>
                    <div
                      className="mt-3 h-1.5 overflow-hidden rounded-full"
                      style={{ background: 'rgba(59,87,163,0.15)' }}
                    >
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#3B57A3] to-[#6366f1] transition-[width] duration-700 ease-out"
                        style={{ width: getBarWidth(city.users, cityPeak) }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div
                className="flex h-full min-h-80 items-center justify-center px-4 text-center text-sm"
                style={{ color: '#94a3b8' }}
              >
                {citySearch ? 'No city matches your search.' : 'No city activity recorded for this filter.'}
              </div>
            )}
          </div>

          <label className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl border border-[#d7e3f3] bg-[#f7fbff] px-3 transition-colors">
            <Search className="h-4 w-4 text-[#64748b]" />
            <input
              type="text"
              value={citySearch}
              onChange={(event) => setCitySearch(event.target.value)}
              placeholder="Search location..."
              className="h-full w-full bg-transparent text-sm text-[#31496f] outline-none placeholder:text-slate-400"
            />
          </label>

          <div className="mt-3 flex items-center justify-between text-[11px] font-semibold text-[#64748b]">
            <span>{formatCount(totalUsersTracked)} users tracked</span>
            <span>Updated {formatLastUpdated(refreshedAt)}</span>
          </div>
        </aside>
      </div>

      <style jsx global>{`
        @keyframes geoFadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </section>
  );
}
