"use client";

import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import type { MapData } from "@/types/analytics";

import "leaflet/dist/leaflet.css";

interface TrafficHeatmapProps {
  points: MapData[];
}

function FitBounds({ points }: { points: MapData[] }) {
  const map = useMap();

  useEffect(() => {
    if (!points.length) {
      map.setView([20, 0], 2);
      return;
    }

    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 5);
      return;
    }

    const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lng]));
    map.fitBounds(bounds.pad(0.3), { maxZoom: 6 });
  }, [map, points]);

  return null;
}

export function TrafficHeatmap({ points }: TrafficHeatmapProps) {
  const heatDots = useMemo(
    () =>
      points.map((point) => {
        const activityBoost = Math.min(12, Math.max(0, point.count - 1));
        const radius = Math.min(20, 8 + activityBoost * 0.5);

        return {
          ...point,
          radius,
          auraRadius: radius + 5,
        };
      }),
    [points],
  );

  return (
    <div className="analytics-traffic-map relative h-[220px] w-full overflow-hidden bg-[#F4F7FC] sm:h-[240px]">
      <MapContainer
        center={[20, 0]}
        zoom={2}
        minZoom={2}
        maxZoom={8}
        zoomControl={false}
        scrollWheelZoom={false}
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; OpenStreetMap &copy; CARTO'
          url="https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png"
          subdomains={["a", "b", "c", "d"]}
        />

        {heatDots.map((dot) => (
          <CircleMarker
            key={`aura-${dot.lat}-${dot.lng}-${dot.city}`}
            center={[dot.lat, dot.lng]}
            radius={dot.auraRadius}
            pathOptions={{
              stroke: false,
              fillColor: "#4785B8",
              fillOpacity: 0.2,
            }}
          />
        ))}

        {heatDots.map((dot) => (
          <CircleMarker
            key={`${dot.lat}-${dot.lng}-${dot.city}`}
            center={[dot.lat, dot.lng]}
            radius={dot.radius}
            pathOptions={{
              stroke: true,
              color: "#ffffff",
              weight: 2,
              fillColor: "#2A4792",
              fillOpacity: 0.82,
            }}
          >
            <Popup closeButton={false} offset={[0, -4]}>
              <div className="min-w-[160px] text-xs leading-5 text-gray-600">
                <p className="font-bold text-gray-900">
                  {dot.city || "Unknown city"}
                </p>
                {dot.country && <p>{dot.country}</p>}
                <p className="mt-1 font-semibold text-[#2A4792]">
                  {dot.count} {dot.count === 1 ? "view" : "views"}
                </p>
              </div>
            </Popup>
          </CircleMarker>
        ))}

        <FitBounds points={points} />
      </MapContainer>

      <style jsx global>{`
        .analytics-traffic-map .leaflet-container {
          font-family: inherit;
          background: #f4f7fc;
        }

        .analytics-traffic-map .leaflet-tile {
          filter: saturate(0.55) brightness(1.04) contrast(0.92);
        }

        .analytics-traffic-map .leaflet-control-attribution {
          background: rgba(255, 255, 255, 0.78);
          color: #94a3b8;
          font-size: 9px;
          padding: 1px 6px;
        }

        .analytics-traffic-map .leaflet-popup-content-wrapper {
          border-radius: 12px;
          border: 1px solid #e5e7eb;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12);
        }

        .analytics-traffic-map .leaflet-popup-content {
          margin: 10px 12px;
        }
      `}</style>
    </div>
  );
}
