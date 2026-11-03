// lib/philippines-address-data.ts

// Dynamically import psgc; fallback if not installed.
let psgc: any;
try {
  psgc = require('psgc');
} catch {
  psgc = null;
}

export interface Barangay {
  name: string;
  code?: string;
}

export interface City {
  name: string;
  code?: string;
  barangays: Barangay[];
}

export interface Region {
  name: string;
  code?: string;
  cities: City[];
}

/**
 * Get all region names.
 */
export function getRegionNames(): string[] {
  if (psgc) {
    // Cast to any to bypass strict type checking.
    return (psgc.regions.all() as any[]).map((r: any) => r.name);
  }
  // Minimal fallback list (in case package is missing)
  return [
    "NCR",
    "Region 1 (Ilocos Region)",
    "Region 2 (Cagayan Valley)",
    "Region 3 (Central Luzon)",
    "Region 4A (Calabarzon)",
    "Region 4B (Mimaropa)",
    "Region 5 (Bicol Region)",
    "Region 6 (Western Visayas)",
    "Region 7 (Central Visayas)",
    "Region 8 (Eastern Visayas)",
    "Region 9 (Zamboanga Peninsula)",
    "Region 10 (Northern Mindanao)",
    "Region 11 (Davao Region)",
    "Region 12 (Soccsksargen)",
    "Region 13 (Caraga)",
    "CAR",
    "BARMM",
  ];
}

/**
 * Get cities/municipalities of a given region.
 */
export function getCitiesByRegion(regionName: string): City[] {
  if (psgc) {
    const region = psgc.regions.find(regionName) as any;
    if (!region) return [];
    const allMunicipalities = psgc.municipalities.all() as any[];
    const regionMunicipalities = allMunicipalities.filter(
      (m: any) => m.region_code === region.code
    );
    return regionMunicipalities.map((m: any) => ({
      name: m.name,
      code: m.code,
      barangays: [],
    }));
  }
  return [];
}

/**
 * Get barangays of a given city/municipality.
 */
export function getBarangaysByCity(regionName: string, cityName: string): Barangay[] {
  if (psgc) {
    const region = psgc.regions.find(regionName) as any;
    if (!region) return [];
    const allMunicipalities = psgc.municipalities.all() as any[];
    const municipality = allMunicipalities.find(
      (m: any) => m.name === cityName && m.region_code === region.code
    );
    if (!municipality) return [];
    const allBarangays = psgc.barangays.all() as any[];
    const cityBarangays = allBarangays.filter(
      (b: any) => b.municipality_code === municipality.code
    );
    return cityBarangays.map((b: any) => ({
      name: b.name,
      code: b.code,
    }));
  }
  return [];
}

/**
 * Fuzzy search – uses psgc's built-in filter if available.
 */
export function fuzzyFindName(
  query: string,
  candidates: string[],
  threshold = 2
): string | null {
  if (!query || query.length < 2) return null;

  // Use psgc's fuzzy search on regions
  if (psgc) {
    const results = psgc.regions.filter(query) as any[];
    if (results.length > 0) return results[0].name;
  }

  // Fallback manual Levenshtein
  const lowerQuery = query.toLowerCase();
  let best = null;
  let bestDist = Infinity;
  for (const candidate of candidates) {
    const lowerCandidate = candidate.toLowerCase();
    const dist = levenshteinDistance(lowerQuery, lowerCandidate);
    if (dist < bestDist && dist <= threshold) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

/**
 * Levenshtein distance for fallback fuzzy matching.
 */
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}