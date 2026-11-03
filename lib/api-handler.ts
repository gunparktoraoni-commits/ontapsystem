import { NextRequest, NextResponse } from "next/server";
import { getCached, generateCacheKey, invalidateCacheBatch } from "@/lib/cache";
import { withPerformanceTracking } from "@/middleware/performance";
import { resolveRequestSession } from "@/server/lib/auth";

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    pages?: number;
    cached?: boolean;
    responseTime?: number;
  };
}

export enum ApiErrorCode {
  UNAUTHORIZED = "AUTH_UNAUTHORIZED",
  INVALID_SESSION = "AUTH_INVALID_SESSION",
  TOKEN_EXPIRED = "AUTH_TOKEN_EXPIRED",
  INVALID_CREDENTIALS = "AUTH_INVALID_CREDENTIALS",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  MISSING_FIELDS = "VALIDATION_MISSING_FIELDS",
  INVALID_FORMAT = "VALIDATION_INVALID_FORMAT",
  NOT_FOUND = "RESOURCE_NOT_FOUND",
  ALREADY_EXISTS = "RESOURCE_ALREADY_EXISTS",
  LIMIT_EXCEEDED = "RESOURCE_LIMIT_EXCEEDED",
  FORBIDDEN = "PERMISSION_FORBIDDEN",
  INSUFFICIENT_ROLE = "PERMISSION_INSUFFICIENT_ROLE",
  BIZCARD_LIMIT_EXCEEDED = "BIZCARD_LIMIT_EXCEEDED",
  INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS",
  PAYMENT_FAILED = "PAYMENT_FAILED",
  DATABASE_ERROR = "SYSTEM_DATABASE_ERROR",
  CACHE_ERROR = "SYSTEM_CACHE_ERROR",
  RATE_LIMIT_EXCEEDED = "SYSTEM_RATE_LIMIT_EXCEEDED",
  INTERNAL_ERROR = "SYSTEM_INTERNAL_ERROR",
}

type Role = "user" | "admin" | "super_admin" | "company_admin";

interface ApiHandlerOptions<T> {
  requireAuth?: boolean;
  requireRole?: Role[];
  cache?: {
    ttl: number;
    key?: string | ((req: NextRequest, context?: unknown) => string);
    invalidateOnSuccess?: boolean;
    invalidatePatterns?: string[];
  };
  validate?: (body: unknown) => { valid: boolean; errors?: unknown };
  handler: (req: NextRequest, context?: unknown, session?: unknown) => Promise<ApiResponse<T>>;
}

export function createApiHandler<T = unknown>(options: ApiHandlerOptions<T>) {
  return async function apiHandler(req: NextRequest, context?: unknown): Promise<NextResponse> {
    return withPerformanceTracking(req, async (requestId) => {
      const startedAt = Date.now();
      let session: unknown = null;

      try {
        if (options.requireAuth) {
          const resolved = await resolveRequestSession(req, { tryRefresh: true });
          if (!resolved.session) {
            return toJson(
              {
                success: false,
                error: {
                  code: ApiErrorCode.UNAUTHORIZED,
                  message: "Authentication required.",
                  requestId,
                },
              },
              401
            );
          }

          session = resolved.session;
          const role = String(resolved.session.role ?? "").toLowerCase() as Role;

          if (options.requireRole && options.requireRole.length > 0 && !options.requireRole.includes(role)) {
            return toJson(
              {
                success: false,
                error: {
                  code: ApiErrorCode.FORBIDDEN,
                  message: "Insufficient permissions.",
                  requestId,
                },
              },
              403
            );
          }
        }

        if (options.validate && req.method !== "GET") {
          let body: unknown;
          try {
            body = await req.json();
          } catch {
            body = {};
          }

          const result = options.validate(body);
          if (!result.valid) {
            return toJson(
              {
                success: false,
                error: {
                  code: ApiErrorCode.VALIDATION_ERROR,
                  message: "Validation failed.",
                  details: result.errors,
                  requestId,
                },
              },
              400
            );
          }
        }

        if (options.cache && req.method === "GET") {
          const cacheKey =
            typeof options.cache.key === "function"
              ? options.cache.key(req, context)
              : options.cache.key ?? generateCacheKey(req.nextUrl.pathname, req.nextUrl.search);

          const { data, cached } = await getCached(cacheKey, async () => {
            const result = await options.handler(req, context, session);
            return result;
          }, options.cache.ttl);

          const payload = data as ApiResponse<T>;
          payload.meta = {
            ...(payload.meta ?? {}),
            cached,
            responseTime: Date.now() - startedAt,
          };

          const response = toJson(payload, payload.success ? 200 : 400);
          response.headers.set("X-Cache", cached ? "HIT" : "MISS");
          return response;
        }

        const result = await options.handler(req, context, session);

        if (options.cache?.invalidateOnSuccess && result.success && req.method !== "GET") {
          await invalidateCacheBatch(options.cache.invalidatePatterns ?? []);
        }

        result.meta = {
          ...(result.meta ?? {}),
          responseTime: Date.now() - startedAt,
        };

        const statusCode = mapStatusCode(result);
        return toJson(result, statusCode);
      } catch (error) {
        console.error("[api-handler] unhandled error", {
          method: req.method,
          path: req.nextUrl.pathname,
          requestId,
          error,
        });

        return toJson(
          {
            success: false,
            error: {
              code: ApiErrorCode.INTERNAL_ERROR,
              message: error instanceof Error ? error.message : "Internal server error.",
              requestId,
            },
            meta: {
              responseTime: Date.now() - startedAt,
            },
          },
          500
        );
      }
    });
  };
}

function mapStatusCode<T>(result: ApiResponse<T>): number {
  if (result.success) return 200;

  const code = result.error?.code;
  if (code === ApiErrorCode.UNAUTHORIZED || code === ApiErrorCode.INVALID_SESSION || code === ApiErrorCode.TOKEN_EXPIRED)
    return 401;
  if (code === ApiErrorCode.FORBIDDEN || code === ApiErrorCode.INSUFFICIENT_ROLE) return 403;
  if (code === ApiErrorCode.NOT_FOUND) return 404;
  if (code === ApiErrorCode.ALREADY_EXISTS) return 409;
  if (code === ApiErrorCode.RATE_LIMIT_EXCEEDED) return 429;
  return 400;
}

function toJson<T>(body: ApiResponse<T>, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-cache, must-revalidate",
    },
  });
}
