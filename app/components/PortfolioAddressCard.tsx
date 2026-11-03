'use client';

import dynamic from 'next/dynamic';
import React, { useEffect, useMemo, useState } from 'react';

import type { PortfolioData } from '../types';
import { fetchGeocodeFromApi } from '../lib/addressGeocode';
import {
  cleanDisplayValue,
  extractCoordsFromMapInput,
  hasPortfolioLocation,
  isGoogleMapsUrl,
  parseGoogleMapsLink,
  resolveGoogleMapsHref,
  resolvePortfolioMapCoords,
  resolveStoredPortfolioMapCoords,
  toEmbedMapsSrc,
  type MapCoords,
} from '../lib/portfolioMaps';
import { isRichTextEmpty } from '../lib/richText';
import { buildPortfolioMapVisualStyle } from '../lib/portfolioMapTheme';

const PortfolioLocationMap = dynamic(() => import('./PortfolioLocationMap'), {
  ssr: false,
  loading: () => <div className="h-40 w-full animate-pulse rounded-2xl bg-white/5" />,
});

export interface PortfolioAddressThemeTokens {
  cardBg?: string;
  glass?: string;
  text?: string;
  textMuted?: string;
  accent?: string;
}

export interface PortfolioAddressSectionProps {
  vcard: PortfolioData['vcard'];
  mini?: boolean;
  theme?: PortfolioAddressThemeTokens;
  className?: string;
}

export default function PortfolioAddressCard({
  vcard,
  mini = false,
  theme,
  className = '',
}: PortfolioAddressSectionProps) {
  const mapLink = cleanDisplayValue(vcard.addressMapLink);
  const storedCoords = useMemo(() => resolveStoredPortfolioMapCoords(vcard), [vcard]);
  const syncCoords = useMemo(() => resolvePortfolioMapCoords(vcard), [vcard]);
  const [resolvedCoords, setResolvedCoords] = useState<MapCoords | null>(syncCoords);
  const [resolving, setResolving] = useState(false);
  const googleMapsHref = useMemo(() => resolveGoogleMapsHref(vcard), [vcard]);
  const embedSrc = useMemo(
    () => (mapLink && isGoogleMapsUrl(mapLink) ? toEmbedMapsSrc(mapLink) : ''),
    [mapLink],
  );
  const hasLandmark = !isRichTextEmpty(vcard.addressLandmark);
  const canShow = hasPortfolioLocation(vcard);

  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();

    if (mapLink) {
      const fromLink = extractCoordsFromMapInput(mapLink);
      if (fromLink) {
        setResolvedCoords(fromLink);
        setResolving(false);
        return () => {
          cancelled = true;
          abort.abort();
        };
      }

      const parsed = parseGoogleMapsLink(mapLink);
      if (!parsed.ok || parsed.kind === 'empty') {
        setResolvedCoords(storedCoords);
        setResolving(false);
        return () => {
          cancelled = true;
          abort.abort();
        };
      }

      if (parsed.kind === 'coords') {
        setResolvedCoords({
          latitude: parsed.latitude,
          longitude: parsed.longitude,
        });
        setResolving(false);
        return () => {
          cancelled = true;
          abort.abort();
        };
      }

      // Short links / place URLs: resolve via geocode API. Keep stored pin visible meanwhile.
      setResolvedCoords(storedCoords);
      setResolving(true);
      void (async () => {
        try {
          const geocodeQuery = isGoogleMapsUrl(mapLink) ? mapLink : parsed.query;
          const result = await fetchGeocodeFromApi(
            {},
            { q: geocodeQuery, signal: abort.signal },
          );
          if (cancelled) return;
          if (result) {
            setResolvedCoords({
              latitude: result.latitude,
              longitude: result.longitude,
            });
            return;
          }
          setResolvedCoords(storedCoords);
        } catch {
          if (!cancelled) setResolvedCoords(storedCoords);
        } finally {
          if (!cancelled) setResolving(false);
        }
      })();

      return () => {
        cancelled = true;
        abort.abort();
      };
    }

    setResolvedCoords(storedCoords);
    setResolving(false);
    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [mapLink, storedCoords, vcard]);

  const effectiveCoords = resolvedCoords ?? syncCoords;

  if (!canShow) return null;

  const cardStyle = theme?.cardBg ? { backgroundColor: theme.cardBg } : undefined;
  const textStyle = theme?.text ? { color: theme.text } : undefined;
  const mutedStyle = theme?.textMuted ? { color: theme.textMuted } : undefined;
  const accentStyle = theme?.accent ? { color: theme.accent } : undefined;
  const mapVisual = buildPortfolioMapVisualStyle(theme);
  const sectionPadding = mini ? 'p-3' : 'p-4 sm:p-5';
  const mapHeightClass = mini ? 'h-40' : 'h-56 sm:h-80';

  return (
    <div className={`rounded-2xl border border-white/10 ${sectionPadding} ${className}`} style={cardStyle}>
      <h3
        className={`${mini ? 'text-[10px]' : 'text-base sm:text-lg'} font-bold mb-3 ${mini ? '' : 'text-center'}`}
        style={textStyle}
      >
        Location
      </h3>

      {/* Keep map outside the Google Maps <a> so pin hover/tooltips work. */}
      <div className="relative overflow-hidden rounded-2xl">
        {effectiveCoords ? (
          <PortfolioLocationMap
            latitude={effectiveCoords.latitude}
            longitude={effectiveCoords.longitude}
            mini={mini}
            zoom={mini ? 13 : 15}
            interactive={!mini}
            landmarkHtml={hasLandmark ? vcard.addressLandmark : null}
            theme={theme}
          />
        ) : embedSrc ? (
          <div
            className="relative overflow-hidden rounded-2xl"
            style={{
              background: mapVisual.containerBg,
              border: `1px solid ${mapVisual.frameBorder}`,
              boxShadow: mapVisual.frameGlow,
            }}
          >
            <iframe
              title="Google Maps location preview"
              src={embedSrc}
              className={`w-full border-0 ${mapHeightClass}`}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
              style={{ filter: mapVisual.tileFilter }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 mix-blend-soft-light"
              style={{ background: mapVisual.overlayGradient }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background: mapVisual.isDark
                  ? 'radial-gradient(120% 90% at 50% 15%, transparent 35%, rgba(0,0,0,0.38) 100%)'
                  : 'radial-gradient(120% 90% at 50% 15%, transparent 40%, rgba(15,23,42,0.10) 100%)',
              }}
            />
          </div>
        ) : (
          <div
            className={`flex w-full items-center justify-center rounded-2xl text-center ${mapHeightClass}`}
            style={{
              ...mutedStyle,
              background: mapVisual.containerBg,
              border: `1px solid ${mapVisual.frameBorder}`,
            }}
          >
            <p className={`${mini ? 'text-[10px]' : 'text-xs'} px-4 font-medium opacity-80`}>
              {resolving ? 'Loading map from location link…' : 'Map preview unavailable for this location link.'}
            </p>
          </div>
        )}
      </div>

      {!mini && googleMapsHref !== '#' && (
        <div className="mt-3 text-center">
          <a
            href={googleMapsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex text-xs font-semibold underline underline-offset-2"
            style={accentStyle ?? mutedStyle}
          >
            Open in Google Maps
          </a>
        </div>
      )}
    </div>
  );
}

export function PortfolioAddressSection(props: PortfolioAddressSectionProps) {
  return <PortfolioAddressCard {...props} />;
}
