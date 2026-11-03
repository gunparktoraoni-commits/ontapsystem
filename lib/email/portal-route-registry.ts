import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const APP_ROOT = path.resolve(__dirname, "../../app");

function isRouteGroup(segment: string): boolean {
  return segment.startsWith("(") && segment.endsWith(")");
}

/**
 * Walk `app/` and collect URL paths that have a `page.tsx` or `page.ts`.
 */
export function collectPortalRoutes(appDir = APP_ROOT, segments: string[] = []): string[] {
  const routes: string[] = [];

  if (!statSync(appDir).isDirectory()) return routes;

  const hasPage = readdirSync(appDir).some(
    (name) => name === "page.tsx" || name === "page.ts",
  );
  if (hasPage) {
    const urlSegments = segments.filter((segment) => !isRouteGroup(segment));
    routes.push(`/${urlSegments.join("/")}`.replace(/\/+/g, "/") || "/");
  }

  for (const entry of readdirSync(appDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "api" || entry.name.startsWith("_")) continue;

    const nextSegments = isRouteGroup(entry.name) ? segments : [...segments, entry.name];
    routes.push(...collectPortalRoutes(path.join(appDir, entry.name), nextSegments));
  }

  return [...new Set(routes)].sort();
}

/** Strip query/hash and normalize trailing slashes. */
export function normalizePortalPathname(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("mailto:")) return trimmed;

  let pathname = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      pathname = new URL(trimmed).pathname;
    } catch {
      return trimmed;
    }
  }

  const withoutQuery = pathname.split("?")[0]?.split("#")[0] ?? pathname;
  const normalized = withoutQuery.replace(/\/+$/, "") || "/";
  return normalized;
}

/** Match a pathname against static or dynamic app routes (e.g. `/feedback/[uuid]`). */
export function portalPathExists(pathname: string, routes: string[]): boolean {
  const normalized = normalizePortalPathname(pathname);
  if (!normalized.startsWith("/")) return false;

  return routes.some((route) => {
    if (route === normalized) return true;
    const pattern = `^${route.replace(/\[[^/]+\]/g, "[^/]+")}$`;
    return new RegExp(pattern).test(normalized);
  });
}
