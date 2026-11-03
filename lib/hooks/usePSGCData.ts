/**
 * usePSGCData Hook
 * 
 * Client-side hook for fetching Philippine geographic data from PSGC Cloud API
 * via backend routes. Provides regions, cities, and barangays with caching.
 */

import { useCallback, useState } from 'react';
import { getFrontendApiBaseUrl } from '@/app/components/apiBase';

export interface PSGCRegion {
  code: string;
  name: string;
}

export interface PSGCCity {
  code: string;
  name: string;
  type: string;
  district?: string;
  zip_code?: string;
}

export interface PSGCBarangay {
  code: string;
  name: string;
  status?: string;
}

interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  tag?: string;
}

const API_BASE = getFrontendApiBaseUrl();

/**
 * Local in-memory cache for region/city/barangay data
 * Caches API responses to reduce unnecessary requests
 */
class PSGCClientCache {
  private regions: PSGCRegion[] | null = null;
  private cities: Map<string, PSGCCity[]> = new Map();
  private barangays: Map<string, PSGCBarangay[]> = new Map();

  setRegions(data: PSGCRegion[]): void {
    this.regions = data;
  }

  getRegions(): PSGCRegion[] | null {
    return this.regions;
  }

  setCities(regionCode: string, data: PSGCCity[]): void {
    this.cities.set(regionCode, data);
  }

  getCities(regionCode: string): PSGCCity[] | null {
    return this.cities.get(regionCode) || null;
  }

  setBarangays(cityCode: string, data: PSGCBarangay[]): void {
    this.barangays.set(cityCode, data);
  }

  getBarangays(cityCode: string): PSGCBarangay[] | null {
    return this.barangays.get(cityCode) || null;
  }

  clear(): void {
    this.regions = null;
    this.cities.clear();
    this.barangays.clear();
  }
}

const clientCache = new PSGCClientCache();

export function usePSGCData() {
  const [regions, setRegions] = useState<PSGCRegion[]>([]);
  const [cities, setCities] = useState<PSGCCity[]>([]);
  const [barangays, setBarangays] = useState<PSGCBarangay[]>([]);

  const [regionsLoading, setRegionsLoading] = useState(false);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const [barangaysLoading, setBarangaysLoading] = useState(false);

  const [regionsError, setRegionsError] = useState<string | null>(null);
  const [citiesError, setCitiesError] = useState<string | null>(null);
  const [barangaysError, setBarangaysError] = useState<string | null>(null);

  /**
   * Fetch all regions
   */
  const fetchRegions = useCallback(async (): Promise<PSGCRegion[]> => {
    // Check cache first
    const cached = clientCache.getRegions();
    if (cached && cached.length > 0) {
      setRegions(cached);
      return cached;
    }

    setRegionsLoading(true);
    setRegionsError(null);

    try {
      const response = await fetch(`${API_BASE}/api/psgc/regions`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({
          error: `HTTP ${response.status}`,
        }))) as Partial<APIResponse<never>>;

        throw new Error(
          errorData.error || `Failed to fetch regions: ${response.status}`
        );
      }

      const data = (await response.json()) as APIResponse<PSGCRegion[]>;

      if (!data.success || !data.data) {
        throw new Error(data.error || 'Invalid response from server');
      }

      clientCache.setRegions(data.data);
      setRegions(data.data);
      return data.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setRegionsError(message);
      console.error('[usePSGCData] Failed to fetch regions:', message);
      return [];
    } finally {
      setRegionsLoading(false);
    }
  }, []);

  /**
   * Fetch cities for a specific region. Returns the loaded list for callers that need it immediately.
   */
  const fetchCities = useCallback(async (regionCode: string): Promise<PSGCCity[]> => {
    if (!regionCode) {
      setCities([]);
      return [];
    }

    const cached = clientCache.getCities(regionCode);
    if (cached) {
      setCities(cached);
      return cached;
    }

    setCitiesLoading(true);
    setCitiesError(null);

    try {
      const params = new URLSearchParams({ regionCode });
      const response = await fetch(`${API_BASE}/api/psgc/cities?${params}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({
          error: `HTTP ${response.status}`,
        }))) as Partial<APIResponse<never>>;

        throw new Error(
          errorData.error || `Failed to fetch cities: ${response.status}`
        );
      }

      const data = (await response.json()) as APIResponse<PSGCCity[]>;

      if (!data.success || !data.data) {
        throw new Error(data.error || 'Invalid response from server');
      }

      clientCache.setCities(regionCode, data.data);
      setCities(data.data);
      return data.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setCitiesError(message);
      console.error('[usePSGCData] Failed to fetch cities:', message);
      setCities([]);
      return [];
    } finally {
      setCitiesLoading(false);
    }
  }, []);

  /**
   * Fetch barangays for a specific city. Returns the loaded list for callers that need it immediately.
   */
  const fetchBarangays = useCallback(async (cityCode: string): Promise<PSGCBarangay[]> => {
    if (!cityCode) {
      setBarangays([]);
      return [];
    }

    const cached = clientCache.getBarangays(cityCode);
    if (cached) {
      setBarangays(cached);
      return cached;
    }

    setBarangaysLoading(true);
    setBarangaysError(null);

    try {
      const params = new URLSearchParams({ cityCode });
      const response = await fetch(`${API_BASE}/api/psgc/barangays?${params}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 500) {
          setBarangays([]);
          return [];
        }

        const errorData = (await response.json().catch(() => ({
          error: `HTTP ${response.status}`,
        }))) as Partial<APIResponse<never>>;

        throw new Error(
          errorData.error || `Failed to fetch barangays: ${response.status}`
        );
      }

      const data = (await response.json()) as APIResponse<PSGCBarangay[]>;

      if (!data.success || !data.data) {
        throw new Error(data.error || 'Invalid response from server');
      }

      clientCache.setBarangays(cityCode, data.data);
      setBarangays(data.data);
      return data.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setBarangaysError(message);
      console.error('[usePSGCData] Failed to fetch barangays:', message);
      setBarangays([]);
      return [];
    } finally {
      setBarangaysLoading(false);
    }
  }, []);

  /**
   * Clear all cached data
   */
  const clearCache = useCallback(() => {
    clientCache.clear();
    setRegions([]);
    setCities([]);
    setBarangays([]);
  }, []);

  return {
    // Data
    regions,
    cities,
    barangays,

    // Loading states
    regionsLoading,
    citiesLoading,
    barangaysLoading,

    // Error states
    regionsError,
    citiesError,
    barangaysError,

    // Actions
    fetchRegions,
    fetchCities,
    fetchBarangays,
    clearCache,
  };
}
