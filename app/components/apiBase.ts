function isLocalDevOrigin(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);
}

export function getFrontendApiBaseUrl(): string {
  const envBase = (
    process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    ''
  ).replace(/\/+$/, '');

  if (typeof window !== 'undefined' && window.location?.origin) {
    const localOrigin = window.location.origin.replace(/\/+$/, '');
    const forceRemoteApi = process.env.NEXT_PUBLIC_USE_REMOTE_API === 'true';

    // Local dev should hit the same-origin API by default so session + CSRF cookies work.
    if (
      !forceRemoteApi &&
      (process.env.NODE_ENV === 'development' || isLocalDevOrigin(localOrigin))
    ) {
      return localOrigin;
    }

    if (envBase) {
      return envBase;
    }

    return localOrigin;
  }

  if (envBase) {
    return envBase;
  }

  return '';
}

export function getFrontendApiUrl(path: string): string {
  const safePath = path.startsWith('/') ? path : `/${path}`;
  const base = getFrontendApiBaseUrl();
  if (!base) return safePath;
  return `${base}${safePath}`;
}