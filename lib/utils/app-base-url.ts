export type RequestLike = {
  url: string;
  headers?: Headers | { get(name: string): string | null };
};

function readHeader(
  request: RequestLike | undefined,
  name: string,
): string | null {
  if (!request?.headers) return null;
  return request.headers.get(name);
}

function normalizeConfiguredUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname === "0.0.0.0") {
      if (process.env.NODE_ENV === "development") {
        parsed.hostname = "localhost";
        return parsed.origin.replace(/\/$/, "");
      }
      return null;
    }
    return parsed.origin.replace(/\/$/, "");
  } catch {
    return trimmed.replace(/\/$/, "");
  }
}

function resolveFromForwardedHeaders(request?: RequestLike): string | null {
  if (!request) return null;
  const forwardedHost =
    readHeader(request, "x-forwarded-host")?.split(",")[0]?.trim() ??
    readHeader(request, "host")?.split(",")[0]?.trim();
  if (!forwardedHost) return null;
  const forwardedProto =
    readHeader(request, "x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  try {
    const parsed = new URL(`${forwardedProto}://${forwardedHost}`);
    if (parsed.hostname === "0.0.0.0") {
      if (process.env.NODE_ENV === "development") {
        parsed.hostname = "localhost";
        return parsed.origin.replace(/\/$/, "");
      }
      return null;
    }
    return parsed.origin.replace(/\/$/, "");
  } catch {
    return null;
  }
}

function resolveFromRequestOrigin(request?: RequestLike): string | null {
  if (!request?.url) return null;
  try {
    const parsed = new URL(request.url);
    if (parsed.hostname === "0.0.0.0") {
      if (process.env.NODE_ENV === "development") {
        parsed.hostname = "localhost";
        return parsed.origin.replace(/\/$/, "");
      }
      return null;
    }
    return parsed.origin.replace(/\/$/, "");
  } catch {
    return null;
  }
}

/**
 * Resolves the public application base URL for emails, payment redirects, and invite links.
 * Prefers configured env vars over raw request origins to avoid 0.0.0.0 in production.
 */
export function resolveAppBaseUrl(request?: RequestLike): string {
  const configured =
    normalizeConfiguredUrl(process.env.NEXT_PUBLIC_APP_URL) ??
    normalizeConfiguredUrl(process.env.APP_URL) ??
    normalizeConfiguredUrl(process.env.FRONTEND_URL);

  if (configured) return configured;

  const forwarded = resolveFromForwardedHeaders(request);
  if (forwarded) return forwarded;

  const origin = resolveFromRequestOrigin(request);
  if (origin) return origin;

  if (process.env.NODE_ENV === "development") {
    const port = process.env.PORT?.trim() || "3000";
    return `http://localhost:${port}`;
  }

  throw new Error(
    "[APP_BASE_URL] NEXT_PUBLIC_APP_URL is not configured and request origin is unavailable for redirect URLs.",
  );
}

/**
 * Origins allowed for Xendit success/failure redirects (landing storefront + portal).
 * Keep this conservative — only known marketing/app hosts.
 */
function collectAllowedReturnOrigins(): Set<string> {
  const raw = [
    process.env.LANDING_URL,
    process.env.STOREFRONT_URL,
    process.env.FRONTEND_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
    process.env.ALLOWED_ORIGINS,
    "https://ontap.ph",
    "https://www.ontap.ph",
    "https://portal.ontap.ph",
    "https://www.portal.ontap.ph",
  ]
    .filter(Boolean)
    .join(",");

  const allowed = new Set<string>();
  for (const part of raw.split(",")) {
    const origin = normalizeConfiguredUrl(part.trim());
    if (!origin) continue;
    allowed.add(origin);
    try {
      const u = new URL(origin);
      if (u.hostname.startsWith("www.")) {
        allowed.add(`${u.protocol}//${u.hostname.slice(4)}`);
      } else {
        allowed.add(`${u.protocol}//www.${u.hostname}`);
      }
    } catch {
      // ignore
    }
  }

  if (process.env.NODE_ENV !== "production") {
    allowed.add("http://localhost:3000");
    allowed.add("http://localhost:3001");
    allowed.add("http://127.0.0.1:3000");
    allowed.add("http://127.0.0.1:3001");
  }

  return allowed;
}

function isAllowedReturnOrigin(origin: string): boolean {
  const normalized = normalizeConfiguredUrl(origin);
  if (!normalized) return false;
  if (collectAllowedReturnOrigins().has(normalized)) return true;

  try {
    const host = new URL(normalized).hostname.toLowerCase();
    // Subdomains of ontap.ph (landing, portal, www, staging)
    return host === "ontap.ph" || host.endsWith(".ontap.ph");
  } catch {
    return false;
  }
}

/**
 * Prefer an explicit storefront `returnOrigin` / request Origin when allowed,
 * so Xendit can redirect back to the landing page payment result screens.
 * Falls back to the portal app base URL.
 */
export function resolvePaymentReturnBaseUrl(
  request?: RequestLike,
  body?: Record<string, unknown> | null,
): string {
  const candidates: string[] = [];

  if (body && typeof body === "object") {
    const explicit =
      (typeof body.returnOrigin === "string" && body.returnOrigin) ||
      (typeof body.return_origin === "string" && body.return_origin) ||
      (typeof body.success_redirect_url === "string" && body.success_redirect_url) ||
      (typeof body.successRedirectUrl === "string" && body.successRedirectUrl) ||
      null;

    if (explicit) {
      try {
        candidates.push(new URL(explicit).origin);
      } catch {
        const normalized = normalizeConfiguredUrl(explicit);
        if (normalized) candidates.push(normalized);
      }
    }
  }

  const headerOrigin = readHeader(request, "origin");
  if (headerOrigin) candidates.push(headerOrigin);

  for (const candidate of candidates) {
    if (isAllowedReturnOrigin(candidate)) {
      return normalizeConfiguredUrl(candidate) ?? candidate.replace(/\/$/, "");
    }
  }

  return resolveAppBaseUrl(request);
}
