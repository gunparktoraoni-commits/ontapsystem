'use client';

import { useEffect, useRef } from 'react';
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const defaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const DEFAULT_CENTER = { latitude: 14.5995, longitude: 120.9842 };

interface AddressMapPickerProps {
  latitude: number | null;
  longitude: number | null;
  /** Map center when no pin is placed (e.g. city-level geocode). */
  viewCenter?: { latitude: number; longitude: number } | null;
  zoom?: number;
  targetZoom?: number | null;
  showPin?: boolean;
}

function MapCenter({
  latitude,
  longitude,
  targetZoom,
  defaultZoom,
}: {
  latitude: number;
  longitude: number;
  targetZoom?: number | null;
  defaultZoom: number;
}) {
  const map = useMap();
  const previous = useRef<{ latitude: number; longitude: number; zoom: number } | null>(null);

  useEffect(() => {
    const zoom = targetZoom ?? defaultZoom;
    const prev = previous.current;
    const moved = !prev || prev.latitude !== latitude || prev.longitude !== longitude;
    const zoomChanged = !prev || prev.zoom !== zoom;

    if (moved || zoomChanged) {
      if (targetZoom != null) {
        map.flyTo([latitude, longitude], zoom, { duration: 0.5 });
      } else {
        map.setView([latitude, longitude], zoom);
      }
      previous.current = { latitude, longitude, zoom };
    }
  }, [latitude, longitude, targetZoom, defaultZoom, map]);

  return null;
}

export default function AddressMapPicker({
  latitude,
  longitude,
  viewCenter = null,
  zoom,
  targetZoom = null,
  showPin = true,
}: AddressMapPickerProps) {
  const hasPin = showPin && latitude !== null && longitude !== null;
  const centerLat = hasPin
    ? latitude!
    : viewCenter?.latitude ?? DEFAULT_CENTER.latitude;
  const centerLng = hasPin
    ? longitude!
    : viewCenter?.longitude ?? DEFAULT_CENTER.longitude;
  const defaultZoom = zoom ?? (hasPin ? 15 : viewCenter ? 11 : 6);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200">
      <MapContainer
        center={[centerLat, centerLng]}
        zoom={defaultZoom}
        scrollWheelZoom
        attributionControl={false}
        className="ontap-address-map-picker h-52 w-full z-0"
      >
        <TileLayer
          attribution=""
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapCenter
          latitude={centerLat}
          longitude={centerLng}
          targetZoom={targetZoom}
          defaultZoom={defaultZoom}
        />
        {hasPin && (
          <Marker
            position={[latitude!, longitude!]}
            icon={defaultIcon}
            draggable={false}
          />
        )}
      </MapContainer>
      <style>{`
        .ontap-address-map-picker .leaflet-control-attribution {
          display: none !important;
        }
      `}</style>
    </div>
  );
}
