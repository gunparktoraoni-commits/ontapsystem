'use client';

import { useEffect, useId, useMemo, useRef } from 'react';
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { sanitizePortfolioRichHtml, isRichTextEmpty } from '@/app/lib/richText';
import {
  buildPortfolioMapVisualStyle,
  type PortfolioMapThemeInput,
} from '@/app/lib/portfolioMapTheme';

interface PortfolioLocationMapProps {
  latitude: number;
  longitude: number;
  mini?: boolean;
  zoom?: number;
  /** When false, disables map interaction so parent link receives clicks. */
  interactive?: boolean;
  /** Rich-text landmark shown on pin hover. */
  landmarkHtml?: string | null;
  /** Portfolio template colors used to tint the map preview. */
  theme?: PortfolioMapThemeInput | null;
}

function MapCenter({
  latitude,
  longitude,
  zoom,
}: {
  latitude: number;
  longitude: number;
  zoom: number;
}) {
  const map = useMap();
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      map.setView([latitude, longitude], zoom);
      initialized.current = true;
      return;
    }
    map.flyTo([latitude, longitude], zoom, { duration: 0.5 });
  }, [latitude, longitude, zoom, map]);

  return null;
}

function MapInvalidateSize() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const invalidate = () => {
      map.invalidateSize({ animate: false });
    };

    invalidate();
    const t = window.setTimeout(invalidate, 80);
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            requestAnimationFrame(invalidate);
          })
        : null;
    ro?.observe(container);

    return () => {
      window.clearTimeout(t);
      ro?.disconnect();
    };
  }, [map]);

  return null;
}

function buildThemedMarkerIcon(style: ReturnType<typeof buildPortfolioMapVisualStyle>) {
  const html = `
    <div class="ontap-map-pin" style="
      position: relative;
      width: 28px;
      height: 36px;
      filter: drop-shadow(0 6px 10px ${style.markerGlow});
    ">
      <svg width="28" height="36" viewBox="0 0 28 36" aria-hidden="true">
        <path
          d="M14 1.5c-6.2 0-11.2 5-11.2 11.2 0 8.4 9.4 20.2 10.6 21.6a.8.8 0 0 0 1.2 0c1.2-1.4 10.6-13.2 10.6-21.6C25.2 6.5 20.2 1.5 14 1.5z"
          fill="${style.markerFill}"
          stroke="${style.markerRing}"
          stroke-width="1.5"
        />
        <circle cx="14" cy="12.5" r="4.2" fill="${style.markerRing}" opacity="0.95"/>
        <circle cx="14" cy="12.5" r="2.1" fill="${style.markerFill}"/>
      </svg>
    </div>
  `;

  return L.divIcon({
    className: 'ontap-map-marker-icon',
    html,
    iconSize: [28, 36],
    iconAnchor: [14, 34],
    popupAnchor: [0, -30],
    tooltipAnchor: [0, -32],
  });
}

export default function PortfolioLocationMap({
  latitude,
  longitude,
  mini = false,
  zoom = 15,
  interactive = true,
  landmarkHtml = null,
  theme = null,
}: PortfolioLocationMapProps) {
  const isInteractive = interactive && !mini;
  const landmark = sanitizePortfolioRichHtml(landmarkHtml);
  const showLandmark = !isRichTextEmpty(landmark);
  const reactId = useId().replace(/:/g, '');
  const mapClass = `ontap-portfolio-map-${reactId}`;
  const visual = useMemo(
    () => buildPortfolioMapVisualStyle(theme),
    [theme?.accent, theme?.cardBg, theme?.text, theme?.textMuted, theme?.glass],
  );
  const markerIcon = useMemo(() => buildThemedMarkerIcon(visual), [visual]);

  return (
    <div
      className={`relative w-full overflow-hidden rounded-2xl max-sm:rounded-none max-sm:border-x-0 ${
        showLandmark || isInteractive ? '' : 'pointer-events-none'
      }`}
      style={{
        border: `1px solid ${visual.frameBorder}`,
        boxShadow: visual.frameGlow,
      }}
    >
      <MapContainer
        center={[latitude, longitude]}
        zoom={zoom}
        scrollWheelZoom={isInteractive}
        dragging={isInteractive}
        doubleClickZoom={isInteractive}
        touchZoom={isInteractive}
        zoomControl={isInteractive}
        attributionControl={false}
        className={`ontap-portfolio-map ${mapClass} w-full z-0 ${mini ? 'h-40' : 'h-56 sm:h-80'}`}
        style={{ background: visual.containerBg }}
      >
        <TileLayer
          attribution=""
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapCenter latitude={latitude} longitude={longitude} zoom={zoom} />
        <MapInvalidateSize />
        <Marker position={[latitude, longitude]} icon={markerIcon}>
          {showLandmark && (
            <Tooltip
              direction="top"
              offset={[0, -8]}
              opacity={1}
              sticky
              className="ontap-map-landmark-tooltip"
            >
              <div
                className="max-w-[220px] text-left text-[12px] leading-snug text-gray-900 [&_b]:font-semibold [&_strong]:font-semibold [&_i]:italic [&_em]:italic [&_u]:underline"
                style={{ whiteSpace: 'pre-wrap' }}
                dangerouslySetInnerHTML={{ __html: landmark }}
              />
            </Tooltip>
          )}
        </Marker>
      </MapContainer>

      {/* Accent wash — soft-light keeps streets readable while matching the template. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[400] mix-blend-soft-light"
        style={{ background: visual.overlayGradient }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[401]"
        style={{
          background: visual.isDark
            ? 'radial-gradient(120% 90% at 50% 15%, transparent 35%, rgba(0,0,0,0.38) 100%)'
            : 'radial-gradient(120% 90% at 50% 15%, transparent 40%, rgba(15,23,42,0.10) 100%)',
        }}
      />

      <style>{`
        .${mapClass} .leaflet-control-attribution {
          display: none !important;
        }
        .${mapClass} .leaflet-tile-pane {
          filter: ${visual.tileFilter};
        }
        .${mapClass} .leaflet-container {
          background: ${visual.containerBg};
        }
        .ontap-map-marker-icon {
          background: transparent !important;
          border: none !important;
        }
        .ontap-map-landmark-tooltip {
          border: 1px solid ${visual.frameBorder} !important;
          border-radius: 12px !important;
          box-shadow: ${visual.frameGlow} !important;
          padding: 8px 10px !important;
        }
      `}</style>
    </div>
  );
}
