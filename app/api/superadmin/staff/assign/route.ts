import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp, getUserAgent } from "@/server/lib/auth";
import { withStaffMgmtSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { StaffManagementService } from "@/lib/services/staff-mgmt.service";
import { checkStaffMgmtRateLimit } from "@/lib/rate-limit/staff-mgmt-limits";
import {
  StaffMgmtErrorCode,
  createStaffMgmtError,
  toStaffMgmtErrorResponse,
} from "@/lib/errors/staff-mgmt-errors";
import { toStaffMgmtErrorNextResponse } from "@/lib/errors/staff-mgmt-http";

const permissionSchema = z.object({
  can_create: z.boolean(),
  can_read: z.boolean(),
  can_update: z.boolean(),
  can_delete: z.boolean(),
});

const assignSchema = z.object({
  user_id: z.coerce.number().int().positive(),
  role_key: z.enum(["web_developer", "sales_rep", "admin", "support_agent", "analyst"]),
  department_key: z.enum(["web_dev", "sales", "admin", "support", "analytics"]),
  permissions: z.record(permissionSchema).refine((value) => Object.keys(value).length > 0, {
    message: "permissions must include at least one module",
  }),
});

async function parseBody(req: NextRequest, requestId: string) {
  const body = await req.json().catch(() => null);
  const result = assignSchema.safeParse(body);

  if (!result.success) {
    throw createStaffMgmtError(
      StaffMgmtErrorCode.INVALID_FILTER_TYPE,
      "Invalid staff assignment payload",
      400,
      requestId,
      { issues: result.error.issues }
    );
  }

  return result.data;
}

const postHandler = withStaffMgmtSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkStaffMgmtRateLimit(req, "ASSIGN", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toStaffMgmtErrorResponse(
          StaffMgmtErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many staff assignment requests. Please try again later.",
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

    const body = await parseBody(req, requestId);
    const service = new StaffManagementService(requestId);
    const data = await service.assignStaffToUser(
      body.user_id,
      body.role_key,
      body.department_key,
      body.permissions,
      String(user.id),
      {
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      }
    );

    return NextResponse.json(
      {
        success: true,
        data,
        meta: {
          requestId,
          responseTime: Date.now() - startedAt,
          timestamp: new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return toStaffMgmtErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to assign staff member"
    );
  }
});

export async function POST(
  req: NextRequest,
  context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }
): Promise<Response> {
  return postHandler(req, context);
}
