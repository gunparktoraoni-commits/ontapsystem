'use client';

import { useEffect, useMemo } from 'react';
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';

import 'leaflet/dist/leaflet.css';

export type GeoHeatmapPoint = {
  id: string;
  userType: 'registered' | 'visitor';
  latitude: number;
  longitude: number;
  city: string;
  region: string;
  country: string;
  ipAddress: string;
  firstSeenAt: string;
  lastSeenAt: string;
  visitCount: number;
  label: string;
};

interface GeoHeatmapMapProps {
  points: GeoHeatmapPoint[];
}

function FitBounds({ points }: { points: GeoHeatmapPoint[] }) {
  const map = useMap();

  useEffect(() => {
    if (!points.length) {
      map.setView([18, 12], 2);
      return;
    }

    if (points.length === 1) {
      map.setView([points[0].latitude, points[0].longitude], 4);
      return;
    }

    const bounds = L.latLngBounds(points.map((point) => [point.latitude, point.longitude]));
    map.fitBounds(bounds.pad(0.28), { maxZoom: 5 });
  }, [map, points]);
  return null;
}

export function GeoHeatmapMap({ points }: GeoHeatmapMapProps) {
  const heatDots = useMemo(() => points.map((point) => {
    const activityBoost = Math.min(14, Math.max(0, point.visitCount - 1));
    const baseRadius = point.userType === 'visitor' ? 9 : 8;
    const radius = Math.min(22, baseRadius + activityBoost * 0.4);
    const color = point.userType === 'visitor' ? '#2ea6df' : '#4b83d8';

    return {
      ...point,
      radius,
      auraRadius: radius + 6,
      color,
      auraOpacity: point.userType === 'visitor' ? 0.24 : 0.18,
      coreOpacity: point.userType === 'visitor' ? 0.85 : 0.72,
    };
  }), [points]);

  return (
    <div className="geo-heatmap-map relative h-[420px] w-full overflow-hidden bg-[#f3f6fb] sm:h-[460px] md:h-[480px]">
      <MapContainer
        center={[18, 12]}
        zoom={2}
        minZoom={2}
        maxZoom={8}
        zoomControl={false}
        scrollWheelZoom
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {heatDots.map((dot) => (
          <CircleMarker
            key={`aura-${dot.id}`}
            center={[dot.latitude, dot.longitude]}
            radius={dot.auraRadius}
            pathOptions={{
              stroke: false,
              fillColor: dot.color,
              fillOpacity: dot.auraOpacity,
            }}
          />
        ))}

        {heatDots.map((dot) => (
          <CircleMarker
            key={dot.id}
            center={[dot.latitude, dot.longitude]}
            radius={dot.radius}
            pathOptions={{
              stroke: true,
              color: '#ffffff',
              weight: 2,
              fillColor: dot.color,
              fillOpacity: dot.coreOpacity,
            }}
          >
            <Popup closeButton={false} offset={[0, -4]}>
              <div className="min-w-[180px] text-xs leading-5 text-[#51637e]">
                <p className="font-bold text-[#1f2a3d]">{dot.label}</p>
                <p>
                  {dot.city}
                  {dot.region && dot.region !== dot.city ? `, ${dot.region}` : ''}
                </p>
                {dot.country && dot.country !== dot.region ? <p>{dot.country}</p> : null}
                {dot.ipAddress ? <p className="mt-1">IP: {dot.ipAddress}</p> : null}
                {dot.lastSeenAt ? (
                  <p className="mt-1 text-[#8f9bb0]">
                    {new Date(dot.lastSeenAt).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                ) : null}
              </div>
            </Popup>
          </CircleMarker>
        ))}

        <FitBounds points={points} />
      </MapContainer>

      <style jsx global>{`
        .geo-heatmap-map .leaflet-container {
          font-family: inherit;
          background: #f3f6fb;
        }

        .geo-heatmap-map .leaflet-tile {
          filter: saturate(0.55) brightness(1.04) contrast(0.92);
        }

        .geo-heatmap-map .leaflet-control-attribution {
          background: rgba(255, 255, 255, 0.78);
          color: #8f9bb0;
          font-size: 9px;
          padding: 1px 6px;
        }

        .geo-heatmap-map .leaflet-popup-content-wrapper {
          border-radius: 12px;
          border: 1px solid #e4ebf5;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.14);
        }

        .geo-heatmap-map .leaflet-popup-content {
          margin: 10px 12px;
        }

        .geo-heatmap-map .leaflet-popup-tip {
          background: #ffffff;
        }

        .geo-heatmap-map .leaflet-interactive {
          animation: geoMarkerIn 420ms ease-out both;
          transition: fill-opacity 220ms ease;
        }

        @keyframes geoMarkerIn {
          from { opacity: 0; transform: scale(0.6); transform-origin: center; }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
