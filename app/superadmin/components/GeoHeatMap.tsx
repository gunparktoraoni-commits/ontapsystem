'use client';

// Thin wrapper preserving the legacy import path used by SuperDashboard.
// The real-time implementation lives in GeoHeatmapCard.
import GeoHeatmapCard from './GeoHeatmapCard';

export default function GeoHeatMap() {
  return <GeoHeatmapCard />;
}
