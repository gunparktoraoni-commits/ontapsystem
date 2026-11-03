// ──────────────────────────────────────────────────────────────
// Analytics Prisma Client Singleton (lazy import with graceful fallback)
// ──────────────────────────────────────────────────────────────
// The analytics database is optional in some environments. If the generated
// Prisma client / query engine is missing (common on Hostinger when the
// debian-openssl-1.1.x binary was not generated), the app must keep working
// instead of crashing login with a 500.

const globalForAnalytics = globalThis as unknown as {
  prismaAnalytics?: any;
};

let loggedLegacyAnalyticsUrl = false;
let loggedMissingAnalyticsClient = false;
let loggedEngineFallback = false;

function buildAnalyticsUrl(): string {
  const newUrl = process.env.NEWANALYTICS_DATABASE_URL;
  const legacyUrl = process.env.ANALYTICS_DATABASE_URL ?? "";
  const base = newUrl || legacyUrl;

  if (!newUrl && legacyUrl && process.env.NODE_ENV !== "production" && !loggedLegacyAnalyticsUrl) {
    loggedLegacyAnalyticsUrl = true;
    console.warn(
      "[prisma-analytics] NEWANALYTICS_DATABASE_URL is not set — falling back to ANALYTICS_DATABASE_URL.",
    );
  }

  if (!base) {
    return "";
  }

  const params = new URLSearchParams();
  params.set("connection_limit", "3");
  params.set("pool_timeout", "20");
  params.set("connect_timeout", "10");
  params.set("idle_connection_timeout", "20");
  const separator = base.includes("?") ? "&" : "?";
  const existing = base.includes("?") ? base.split("?")[1] : "";
  const existingKeys = new Set(existing.split("&").map((p) => p.split("=")[0]));
  const additions: string[] = [];
  params.forEach((val, key) => {
    if (!existingKeys.has(key)) additions.push(`${key}=${val}`);
  });

  return additions.length > 0 ? `${base}${separator}${additions.join("&")}` : base;
}

function createNoopModel() {
  const noop = async () => null;
  return {
    create: noop,
    update: noop,
    upsert: noop,
    deleteMany: noop,
    findUnique: noop,
    findFirst: noop,
    findMany: noop,
    count: async () => 0,
    aggregate: async () => ({ _count: { _all: 0 } }),
    groupBy: async () => [],
  };
}

function createNoopAnalyticsClient() {
  const model = createNoopModel();
  return new Proxy(
    {
      $queryRaw: async () => [],
      $executeRaw: async () => 0,
      $disconnect: async () => undefined,
      auditLog: model,
      accountLockout: model,
      loginAttempt: model,
      portfolioView: model,
      contactSave: model,
      systemErrorLog: model,
      Analytics: model,
      Session: model,
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop as keyof typeof target];
        if (typeof prop === "string") return model;
        return undefined;
      },
    },
  );
}

function isAnalyticsSchemaMismatchError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const message = String((error as { message?: string }).message ?? "");
  const code = String((error as { code?: string }).code ?? "");
  return (
    code === "P2022" ||
    code === "P2021" ||
    code === "P2010" ||
    message.includes("Unknown column") ||
    message.includes("does not exist in the current database") ||
    message.includes("database schema is not in sync") ||
    message.includes("Query Engine") ||
    message.includes("libquery_engine") ||
    message.includes("engine-not-found") ||
    message.includes("could not connect to the database")
  );
}

function getAnalyticsClientCtor(): any {
  try {
    // Lazy require so missing generated client does not crash at import time.
    const module = require("@prisma/analytics-client");
    return module?.PrismaClient ?? module?.default?.PrismaClient ?? null;
  } catch (error) {
    if (!loggedMissingAnalyticsClient) {
      loggedMissingAnalyticsClient = true;
      console.warn(
        "[prisma-analytics] Optional analytics client not generated; using no-op fallback.",
        error,
      );
    }
    return null;
  }
}

/**
 * Wrap a live Prisma client so a missing Hostinger query-engine binary
 * permanently switches to the no-op client instead of 500ing every request.
 */
function wrapWithEngineFallback(client: any): any {
  let active: any = client;
  const noop = createNoopAnalyticsClient();

  const switchToNoop = (error: unknown) => {
    if (!loggedEngineFallback) {
      loggedEngineFallback = true;
      console.error(
        "[prisma-analytics] Query engine unavailable; analytics disabled for this process.",
        error instanceof Error ? error.message : error,
      );
    }
    active = noop;
    globalForAnalytics.prismaAnalytics = noop;
  };

  return new Proxy(client, {
    get(_target, prop) {
      const current = active;
      const value = current[prop as string];

      if (value && typeof value === "object") {
        return new Proxy(value, {
          get(modelTarget, modelProp) {
            const method = (modelTarget as any)[modelProp as string];
            if (typeof method !== "function") return method;
            return async (...args: unknown[]) => {
              try {
                return await method.apply(modelTarget, args);
              } catch (error) {
                if (isAnalyticsSchemaMismatchError(error)) {
                  switchToNoop(error);
                  const noopModel = active[prop as string];
                  const noopMethod = noopModel?.[modelProp as string];
                  if (typeof noopMethod === "function") {
                    return noopMethod.apply(noopModel, args);
                  }
                  return null;
                }
                throw error;
              }
            };
          },
        });
      }

      if (typeof value === "function") {
        return async (...args: unknown[]) => {
          try {
            return await value.apply(current, args);
          } catch (error) {
            if (isAnalyticsSchemaMismatchError(error)) {
              switchToNoop(error);
              const noopFn = active[prop as string];
              if (typeof noopFn === "function") {
                return noopFn.apply(active, args);
              }
              return null;
            }
            throw error;
          }
        };
      }

      return value;
    },
  });
}

function createAnalyticsClient(): any {
  const url = buildAnalyticsUrl();
  if (!url) {
    if (!loggedMissingAnalyticsClient) {
      loggedMissingAnalyticsClient = true;
      console.warn(
        "[prisma-analytics] No analytics database URL configured; using no-op fallback.",
      );
    }
    return createNoopAnalyticsClient();
  }

  const PrismaAnalyticsClientCtor = getAnalyticsClientCtor();
  if (!PrismaAnalyticsClientCtor) {
    return createNoopAnalyticsClient();
  }

  const client = new PrismaAnalyticsClientCtor({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
    datasources: {
      db: { url },
    },
  });

  return wrapWithEngineFallback(client);
}

export const prismaAnalytics =
  globalForAnalytics.prismaAnalytics ?? createAnalyticsClient();

globalForAnalytics.prismaAnalytics = prismaAnalytics;
