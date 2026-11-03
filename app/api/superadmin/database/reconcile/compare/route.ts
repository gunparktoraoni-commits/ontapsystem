import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withSuperAdmin } from "@/lib/auth/superadmin-middleware";
import {
  createDatabaseReconcileError,
  DatabaseReconcileErrorCode,
  toDatabaseReconcileErrorResponse,
} from "@/lib/errors/database-reconcile-errors";
import { toDatabaseReconcileErrorNextResponse } from "@/lib/errors/database-reconcile-http";
import { checkDatabaseReconcileRateLimit } from "@/lib/rate-limit/database-limits";
import { DatabaseReconciliationService } from "@/lib/services/database-reconciliation.service";

const compareBodySchema = z.object({
  sql_file_content: z.string().trim().min(1).optional(),
  max_samples: z.number().int().min(1).max(200).optional(),
});

async function parseCompareBody(req: NextRequest, requestId: string) {
  const body = await req.json().catch(() => ({}));
  const parsed = compareBodySchema.safeParse(body);

  if (!parsed.success) {
    throw createDatabaseReconcileError(
      DatabaseReconcileErrorCode.INVALID_SQL_FILE,
      "Invalid compare payload",
      400,
      requestId,
      { issues: parsed.error.issues }
    );
  }

  return parsed.data;
}

const postHandler = withSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkDatabaseReconcileRateLimit(req, "COMPARE", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toDatabaseReconcileErrorResponse(
          DatabaseReconcileErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many compare requests. Please try again later.",
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

    const body = await parseCompareBody(req, requestId);
    const service = new DatabaseReconciliationService(requestId);
    const data = await service.compare({
      sql_file_content: body.sql_file_content,
      max_samples: body.max_samples,
    });

    return NextResponse.json({
      success: true,
      data,
      meta: {
        requestId,
        responseTime: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return toDatabaseReconcileErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to compare database reconciliation state"
    );
  }
});

export async function POST(
  req: NextRequest,
  context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }
): Promise<Response> {
  return postHandler(req, context);
}
