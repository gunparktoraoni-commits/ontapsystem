import { NextRequest, NextResponse } from "next/server";
import { getClientIp, getUserAgent } from "@/server/lib/auth";
import { withSuperAdmin, type SuperAdminContext } from "@/lib/auth/superadmin-middleware";
import { ClientManagementService } from "@/lib/services/client-management.service";
import { checkClientRateLimit } from "@/lib/rate-limit/client-limits";
import { ClientErrorCode, createClientError, toClientErrorResponse } from "@/lib/errors/client-errors";
import { toClientErrorNextResponse } from "@/lib/errors/client-http";

type RouteContext = SuperAdminContext & {
  params: Promise<{ clientId: string }>;
};

function parseClientId(raw: string, requestId: string): number {
  if (!/^\d+$/.test(raw)) {
    throw createClientError(
      ClientErrorCode.INVALID_PAGINATION,
      "Invalid clientId path parameter",
      400,
      requestId,
      { clientId: raw }
    );
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw createClientError(
      ClientErrorCode.INVALID_PAGINATION,
      "Invalid clientId path parameter",
      400,
      requestId,
      { clientId: raw }
    );
  }

  return parsed;
}

async function parseUpdateBody(req: NextRequest, requestId: string): Promise<{
  first_name?: string;
  last_name?: string;
  email?: string;
  alt_email?: string;
  phone?: string;
  subscription_tier?: string;
  password?: string;
}> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw createClientError(
      ClientErrorCode.INVALID_PAGINATION,
      "Request body must be valid JSON",
      400,
      requestId
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw createClientError(
      ClientErrorCode.INVALID_PAGINATION,
      "Request body must be an object",
      400,
      requestId
    );
  }

  const payload = body as Record<string, unknown>;
  const updates: {
    first_name?: string;
    last_name?: string;
    email?: string;
    alt_email?: string;
    phone?: string;
    subscription_tier?: string;
    password?: string;
  } = {};

  if (typeof payload.first_name === "string") updates.first_name = payload.first_name;
  if (typeof payload.last_name === "string") updates.last_name = payload.last_name;
  if (typeof payload.email === "string") updates.email = payload.email;
  if (typeof payload.alt_email === "string") updates.alt_email = payload.alt_email;
  if (typeof payload.phone === "string") updates.phone = payload.phone;
  if (typeof payload.contact === "string" && typeof updates.phone !== "string") updates.phone = payload.contact;
  if (typeof payload.subscription_tier === "string") updates.subscription_tier = payload.subscription_tier;
  if (typeof payload.password === "string") updates.password = payload.password;

  if (Object.keys(updates).length === 0) {
    throw createClientError(
      ClientErrorCode.INVALID_PAGINATION,
      "No valid update fields were provided",
      400,
      requestId
    );
  }

  return updates;
}

export const GET = withSuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkClientRateLimit(req, "DETAIL", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toClientErrorResponse(
          ClientErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many client detail requests. Please try again later.",
          requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt
        ),
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfter ?? 1),
          },
        }
      );
    }

    const { clientId } = await context.params;
    const parsedClientId = parseClientId(clientId, requestId);

    const service = new ClientManagementService(requestId);
    const detail = await service.getClientById(parsedClientId);

    return NextResponse.json({
      success: true,
      data: detail,
      meta: {
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return toClientErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to fetch client details"
    );
  }
});

export const PUT = withSuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkClientRateLimit(req, "UPDATE", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toClientErrorResponse(
          ClientErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many client update requests. Please try again later.",
          requestId,
          { retryAfter: rateLimit.retryAfter },
          Date.now() - startedAt
        ),
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfter ?? 1),
          },
        }
      );
    }

    const { clientId } = await context.params;
    const parsedClientId = parseClientId(clientId, requestId);
    const updates = await parseUpdateBody(req, requestId);

    const service = new ClientManagementService(requestId);
    const updated = await service.updateClient(parsedClientId, updates, String(user.id), {
      ipAddress: getClientIp(req),
      userAgent: getUserAgent(req),
    });

    return NextResponse.json({
      success: true,
      message: "Client information updated successfully",
      data: updated,
      meta: {
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return toClientErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to update client"
    );
  }
});
