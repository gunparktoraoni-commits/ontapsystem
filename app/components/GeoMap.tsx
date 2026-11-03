"use client";

import dynamic from "next/dynamic";
import { MapData, CountryData, CityData } from "@/types/analytics";
import { motion } from "framer-motion";
import { Globe, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

const TrafficHeatmap = dynamic(() => import("./TrafficHeatmap").then((m) => m.TrafficHeatmap), {
  ssr: false,
  loading: () => (
    <div className="flex h-[220px] items-center justify-center rounded-xl bg-[#F4F7FC] text-sm text-gray-400">
      Loading map…
    </div>
  ),
});

interface GeoMapProps {
  mapData: MapData[];
  countries: CountryData[];
  cities: CityData[];
  loading?: boolean;
}

function getFlagEmoji(countryCode: string): string {
  if (!countryCode || countryCode.length !== 2) return "🌍";
  const codePoints = countryCode
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

export function TrafficEngagementCard({
  mapData,
  countries,
  cities,
  loading = false,
}: GeoMapProps) {
  const topCountries = countries.slice(0, 4);
  const topCities = cities.slice(0, 4);
  const maxCountryViews = Math.max(...topCountries.map((c) => c.views), 1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: loading ? 0.72 : 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.03 }}
      className="flex h-full min-h-[320px] flex-col rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Traffic engagement</h3>
          <p className="mt-1 text-sm text-gray-500">Location of connections</p>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#4785B8]/10 text-[#2A4792]">
          <Globe className="h-5 w-5" />
        </div>
      </div>

      <div className={cn("mb-4 overflow-hidden rounded-xl border border-gray-100", loading && "animate-pulse")}>
        {mapData.length > 0 ? (
          <TrafficHeatmap points={mapData} />
        ) : (
          <div className="flex h-[220px] flex-col items-center justify-center bg-[#F4F7FC] text-center">
            <MapPin className="mb-2 h-8 w-8 text-gray-300" />
            <p className="text-sm text-gray-500">No location data for this period</p>
          </div>
        )}
      </div>

      <div className="mt-auto space-y-4">
        {topCountries.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Top countries
            </p>
            <div className="space-y-2">
              {topCountries.map((country) => (
                <div key={country.code} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-gray-700">
                      <span>{getFlagEmoji(country.code)}</span>
                      {country.country}
                    </span>
                    <span className="font-semibold text-gray-900">{country.views}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(country.views / maxCountryViews) * 100}%` }}
                      transition={{ duration: 0.6, delay: 0.1 }}
                      className="h-full rounded-full bg-gradient-to-r from-[#2A4792] to-[#4785B8]"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {topCities.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Top cities
            </p>
            <div className="flex flex-wrap gap-2">
              {topCities.map((city, index) => (
                <span
                  key={`${city.city}-${index}`}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-100 bg-[#F4F7FC] px-3 py-1 text-xs font-medium text-gray-600"
                >
                  <MapPin className="h-3 w-3 text-[#4785B8]" />
                  {city.city}, {city.country}
                  <span className="text-gray-400">· {city.views}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

/** @deprecated Use TrafficEngagementCard */
export function GeoMap(props: GeoMapProps) {
  return <TrafficEngagementCard {...props} />;
}
