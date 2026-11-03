"use client";

import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type AuthLoginMapPoint = {
  id: string;
  latitude: number;
  longitude: number;
  email: string;
  name: string;
  role: string;
  location: string | null;
  ipAddress: string | null;
  device: string | null;
  loginAt: string;
};

function FitBounds({ points }: { points: AuthLoginMapPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) {
      map.setView([12.5, 122], 5);
      return;
    }
    if (points.length === 1) {
      map.setView([points[0].latitude, points[0].longitude], 6);
      return;
    }
    const bounds = L.latLngBounds(points.map((point) => [point.latitude, point.longitude]));
    map.fitBounds(bounds.pad(0.25), { maxZoom: 7 });
  }, [map, points]);
  return null;
}

export function AuthLoginMap({ points }: { points: AuthLoginMapPoint[] }) {
  const markers = useMemo(() => points, [points]);

  return (
    <div className="relative h-[360px] w-full overflow-hidden rounded-2xl bg-[#eef2f8] sm:h-[420px]">
      <MapContainer
        center={[12.5, 122]}
        zoom={5}
        minZoom={2}
        maxZoom={12}
        scrollWheelZoom
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors &copy; CARTO'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          subdomains={["a", "b", "c", "d"]}
        />
        <FitBounds points={markers} />
        {markers.map((point) => (
          <CircleMarker
            key={point.id}
            center={[point.latitude, point.longitude]}
            radius={8}
            pathOptions={{
              color: "#2A4792",
              fillColor: "#4785B8",
              fillOpacity: 0.85,
              weight: 1.5,
            }}
          >
            <Popup>
              <div className="space-y-1 text-xs">
                <p className="font-semibold text-slate-900">{point.name}</p>
                <p className="text-slate-600">{point.email}</p>
                <p className="text-slate-500">{point.location || "Unknown location"}</p>
                <p className="text-slate-500">{new Date(point.loginAt).toLocaleString()}</p>
                {point.ipAddress ? <p className="text-slate-400">IP {point.ipAddress}</p> : null}
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
      {!markers.length ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/55">
          <p className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm">
            No geolocated logins in this range
          </p>
        </div>
      ) : null}
    </div>
  );
}
