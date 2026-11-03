import { getFrontendApiBaseUrl } from '../components/apiBase';

const API = getFrontendApiBaseUrl();

export interface AddressGeocodeInput {
  addressArea?: string;
  addressBrgy?: string;
  addressCity?: string;
  addressRegion?: string;
  addressZipcode?: string;
}

export interface GeocodeApiResult {
  latitude: number;
  longitude: number;
  displayName: string;
  zipcode?: string;
  mode?: 'forward' | 'reverse';
}

export interface ReverseGeocodeApiResult extends GeocodeApiResult {
  region?: string;
  city?: string;
  barangay?: string;
  suburb?: string;
  area?: string;
  houseNumber?: string;
}

export function buildAddressSearchQuery(values: AddressGeocodeInput): string {
  return [
    values.addressArea?.trim(),
    values.addressBrgy?.trim(),
    values.addressCity?.trim(),
    values.addressRegion?.trim(),
    values.addressZipcode?.trim(),
  ]
    .filter(Boolean)
    .join(', ');
}

export async function fetchGeocodeFromApi(
  values: AddressGeocodeInput,
  options?: { signal?: AbortSignal; q?: string }
): Promise<GeocodeApiResult | null> {
  const city = values.addressCity?.trim() ?? '';
  const query = (options?.q?.trim() || buildAddressSearchQuery(values)).trim();
  if ((!city && query.length < 3) || (city && query.length < 3 && !options?.q)) return null;

  const params = new URLSearchParams({
    area: values.addressArea?.trim() ?? '',
    brgy: values.addressBrgy?.trim() ?? '',
    city,
    region: values.addressRegion?.trim() ?? '',
    zipcode: values.addressZipcode?.trim() ?? '',
    q: options?.q?.trim() || query,
  });

  const res = await fetch(`${API}/api/geocode?${params.toString()}`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal: options?.signal,
  });

  if (!res.ok) return null;

  const payload = (await res.json()) as Partial<GeocodeApiResult>;
  const latitude = Number(payload.latitude);
  const longitude = Number(payload.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    latitude,
    longitude,
    displayName: String(payload.displayName ?? query),
    zipcode: typeof payload.zipcode === 'string' && payload.zipcode ? payload.zipcode : undefined,
    mode: payload.mode === 'reverse' ? 'reverse' : 'forward',
  };
}

export async function fetchReverseGeocodeFromApi(
  latitude: number,
  longitude: number,
  options?: { signal?: AbortSignal }
): Promise<ReverseGeocodeApiResult | null> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const params = new URLSearchParams({
    lat: String(latitude),
    lng: String(longitude),
  });

  const res = await fetch(`${API}/api/geocode?${params.toString()}`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal: options?.signal,
  });

  if (!res.ok) return null;

  const payload = (await res.json()) as Partial<ReverseGeocodeApiResult>;
  const lat = Number(payload.latitude);
  const lng = Number(payload.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    latitude: lat,
    longitude: lng,
    displayName: String(payload.displayName ?? `${lat},${lng}`),
    region: typeof payload.region === 'string' ? payload.region : undefined,
    city: typeof payload.city === 'string' ? payload.city : undefined,
    barangay: typeof payload.barangay === 'string' ? payload.barangay : undefined,
    suburb: typeof payload.suburb === 'string' ? payload.suburb : undefined,
    area: typeof payload.area === 'string' ? payload.area : undefined,
    houseNumber: typeof payload.houseNumber === 'string' ? payload.houseNumber : undefined,
    zipcode: typeof payload.zipcode === 'string' && payload.zipcode ? payload.zipcode : undefined,
    mode: 'reverse',
  };
}
