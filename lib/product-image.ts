import { getFrontendApiBaseUrl } from "@/app/components/apiBase";

export const MAX_PRODUCT_IMAGES = 10;

function isPlaceholdCoHostname(hostname: string): boolean {
  return (
    hostname === "placehold.co" ||
    hostname.endsWith(".placehold.co") ||
    hostname === "via.placeholder.com" ||
    hostname.endsWith(".via.placeholder.com")
  );
}

export function isPlaceholderProductImageUrl(
  url: string | null | undefined,
): boolean {
  const value = typeof url === "string" ? url.trim() : "";
  if (!value) return false;
  if (/placeholder/i.test(value)) return true;

  try {
    const parsed = new URL(value);
    if (isPlaceholdCoHostname(parsed.hostname)) return true;
  } catch {
    // Not an absolute URL — pattern check above is enough.
  }

  return false;
}

export function filterProductImageUrls(
  urls: Array<string | null | undefined>,
): string[] {
  return urls.filter(
    (url): url is string =>
      typeof url === "string" &&
      url.trim().length > 0 &&
      !isPlaceholderProductImageUrl(url),
  );
}

export function uniqueProductImageUrls(
  urls: Array<string | null | undefined>,
): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const url of filterProductImageUrls(urls)) {
    if (seen.has(url)) continue;
    seen.add(url);
    unique.push(url);
  }
  return unique;
}

export function resolveProductImageSrc(
  raw: string | null | undefined,
  fallback: string | null = "/ontapcard.png",
): string | null {
  if (!raw?.trim()) return fallback;
  const value = raw.trim();
  if (isPlaceholderProductImageUrl(value)) return null;

  if (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("blob:") ||
    value.startsWith("data:") ||
    value.startsWith("/")
  ) {
    return value;
  }

  const API = getFrontendApiBaseUrl();
  return `${API}/${value.replace(/^\/+/, "")}`;
}
