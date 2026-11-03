// ──────────────────────────────────────────────────────────────
// Browser Geolocation Helper
// ──────────────────────────────────────────────────────────────
// Provides client-side geolocation functionality
// Privacy-compliant implementation with fallback to IP-based geolocation
// ──────────────────────────────────────────────────────────────

export interface BrowserLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude?: number;
  altitudeAccuracy?: number;
  heading?: number;
  speed?: number;
  timestamp: number;
}

export interface LocationPermission {
  granted: boolean;
  state: 'granted' | 'denied' | 'prompt' | 'unsupported';
}

export interface GeolocationOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
}

/**
 * Check if browser supports geolocation
 */
export function isGeolocationSupported(): boolean {
  return 'geolocation' in navigator;
}

/**
 * Get current location permission status
 */
export function getLocationPermission(): LocationPermission {
  if (!isGeolocationSupported()) {
    return { granted: false, state: 'unsupported' };
  }

  // Check for Permissions API (modern browsers)
  if ('permissions' in navigator) {
    navigator.permissions.query({ name: 'geolocation' }).then((result) => {
      return {
        granted: result.state === 'granted',
        state: result.state as 'granted' | 'denied' | 'prompt'
      };
    });
  }

  // Fallback - assume permission is unknown
  return { granted: false, state: 'prompt' };
}

/**
 * Request geolocation permission
 */
export async function requestLocationPermission(): Promise<LocationPermission> {
  if (!isGeolocationSupported()) {
    return { granted: false, state: 'unsupported' };
  }

  try {
    const position = await getCurrentPosition({ timeout: 5000 });
    return { granted: true, state: 'granted' };
  } catch (error) {
    if (error instanceof GeolocationPositionError) {
      if (error.code === 1) { // PERMISSION_DENIED
        return { granted: false, state: 'denied' };
      }
    }
    return { granted: false, state: 'prompt' };
  }
}

/**
 * Get current browser position
 */
export async function getCurrentPosition(
  options: GeolocationOptions = {}
): Promise<BrowserLocation> {
  return new Promise((resolve, reject) => {
    if (!isGeolocationSupported()) {
      reject(new Error('Geolocation is not supported by this browser'));
      return;
    }

    const defaultOptions: GeolocationOptions = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 300000, // 5 minutes
    };

    const finalOptions = { ...defaultOptions, ...options };

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          altitude: position.coords.altitude || undefined,
          altitudeAccuracy: position.coords.altitudeAccuracy || undefined,
          heading: position.coords.heading || undefined,
          speed: position.coords.speed || undefined,
          timestamp: position.timestamp
        });
      },
      (error) => {
        reject(new CustomGeolocationPositionError(error));
      },
      finalOptions
    );
  });
}

/**
 * Watch position changes
 */
export function watchPosition(
  callback: (position: BrowserLocation) => void,
  options: GeolocationOptions = {}
): number {
  if (!isGeolocationSupported()) {
    throw new Error('Geolocation is not supported by this browser');
  }

  const defaultOptions: GeolocationOptions = {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 300000
  };

  const finalOptions = { ...defaultOptions, ...options };

  return navigator.geolocation.watchPosition(
    (position) => {
      callback({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        altitude: position.coords.altitude || undefined,
        altitudeAccuracy: position.coords.altitudeAccuracy || undefined,
        heading: position.coords.heading || undefined,
        speed: position.coords.speed || undefined,
        timestamp: position.timestamp
      });
    },
    (error) => {
      throw new CustomGeolocationPositionError(error);
    },
    finalOptions
  );
}

/**
 * Stop watching position changes
 */
export function clearWatch(watchId: number): void {
  if (isGeolocationSupported() && watchId) {
    navigator.geolocation.clearWatch(watchId);
  }
}

/**
 * Calculate distance between two coordinates (Haversine formula)
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Format location for display
 */
export function formatLocation(location: BrowserLocation): string {
  return `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`;
}

/**
 * Get location accuracy description
 */
export function getAccuracyDescription(accuracy: number): string {
  if (accuracy < 10) return 'Excellent (within 10m)';
  if (accuracy < 50) return 'Good (within 50m)';
  if (accuracy < 100) return 'Fair (within 100m)';
  return 'Poor (over 100m)';
}

/**
 * Check if location is reasonably accurate
 */
export function isReasonablyAccurate(location: BrowserLocation): boolean {
  return location.accuracy <= 100; // Within 100 meters
}

/**
 * Geolocation position error wrapper
 */
class CustomGeolocationPositionError extends Error {
  public readonly code: number;
  public readonly message: string;

  constructor(error: GeolocationPositionError) {
    super(error.message);
    this.name = 'CustomGeolocationPositionError';
    this.code = error.code;
    this.message = this.getErrorMessage(error.code);
  }

  private getErrorMessage(code: number): string {
    switch (code) {
      case 1:
        return 'Location permission denied by user';
      case 2:
        return 'Location position unavailable';
      case 3:
        return 'Location request timed out';
      default:
        return 'Unknown location error';
    }
  }
}

/**
 * Convert degrees to radians
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Get location with fallback to IP-based geolocation
 */
export async function getLocationWithFallback(): Promise<BrowserLocation | null> {
  try {
    // Try browser geolocation first
    const location = await getCurrentPosition({ timeout: 5000 });
    
    // Check if location is reasonably accurate
    if (isReasonablyAccurate(location)) {
      return location;
    }
  } catch (error) {
    console.warn('Browser geolocation failed:', error);
  }

  // Fallback to IP-based geolocation (server-side)
  try {
    const response = await fetch('/api/geolocation/ip-lookup');
    if (response.ok) {
      const data = await response.json();
      if (data.latitude && data.longitude) {
        return {
          latitude: data.latitude,
          longitude: data.longitude,
          accuracy: 1000, // IP-based is less accurate
          timestamp: Date.now()
        };
      }
    }
  } catch (error) {
    console.warn('IP-based geolocation fallback failed:', error);
  }

  return null;
}

/**
 * Create location tracking session
 */
export class LocationTracker {
  private watchId: number | null = null;
  private callbacks: ((location: BrowserLocation) => void)[] = [];
  private isTracking = false;

  /**
   * Start tracking location changes
   */
  async startTracking(
    callback: (location: BrowserLocation) => void,
    options?: GeolocationOptions
  ): Promise<void> {
    if (!isGeolocationSupported()) {
      throw new Error('Geolocation is not supported');
    }

    this.callbacks.push(callback);

    if (!this.isTracking) {
      this.isTracking = true;
      this.watchId = watchPosition((location) => {
        this.callbacks.forEach(cb => cb(location));
      }, options);
    }
  }

  /**
   * Stop tracking location changes
   */
  stopTracking(): void {
    if (this.watchId !== null) {
      clearWatch(this.watchId);
      this.watchId = null;
      this.isTracking = false;
      this.callbacks = [];
    }
  }

  /**
   * Check if currently tracking
   */
  isCurrentlyTracking(): boolean {
    return this.isTracking;
  }
}
