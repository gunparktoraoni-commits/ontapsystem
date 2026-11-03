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

const fixBodySchema = z.object({
  sql_file_content: z.string().trim().min(1).optional(),
  dry_run: z.boolean().optional().default(true),
  create_missing_companies: z.boolean().optional().default(true),
  update_users: z.boolean().optional().default(true),
  sync_bizcards: z.boolean().optional().default(true),
  create_company_employees: z.boolean().optional().default(true),
  max_samples: z.number().int().min(1).max(200).optional(),
});

async function parseFixBody(req: NextRequest, requestId: string) {
  const body = await req.json().catch(() => null);
  const parsed = fixBodySchema.safeParse(body ?? {});

  if (!parsed.success) {
    throw createDatabaseReconcileError(
      DatabaseReconcileErrorCode.INVALID_SQL_FILE,
      "Invalid fix payload",
      400,
      requestId,
      { issues: parsed.error.issues }
    );
  }

  if (!parsed.data.create_missing_companies && !parsed.data.update_users) {
    throw createDatabaseReconcileError(
      DatabaseReconcileErrorCode.INVALID_SQL_FILE,
      "At least one operation must be enabled",
      400,
      requestId,
      {
        create_missing_companies: parsed.data.create_missing_companies,
        update_users: parsed.data.update_users,
      }
    );
  }

  return parsed.data;
}

const postHandler = withSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkDatabaseReconcileRateLimit(req, "FIX", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toDatabaseReconcileErrorResponse(
          DatabaseReconcileErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many fix requests. Please try again later.",
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

    const body = await parseFixBody(req, requestId);
    const service = new DatabaseReconciliationService(requestId);
    const data = await service.fix({
      sql_file_content: body.sql_file_content,
      dry_run: body.dry_run,
      create_missing_companies: body.create_missing_companies,
      update_users: body.update_users,
      sync_bizcards: body.sync_bizcards,
      create_company_employees: body.create_company_employees,
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
      "Failed to execute database reconciliation"
    );
  }
});

export async function POST(
  req: NextRequest,
  context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }
): Promise<Response> {
  return postHandler(req, context);
}
