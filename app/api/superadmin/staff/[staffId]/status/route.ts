import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp, getUserAgent } from "@/server/lib/auth";
import {
  withStaffMgmtSuperAdmin,
  type SuperAdminContext,
} from "@/lib/auth/superadmin-middleware";
import { StaffManagementService } from "@/lib/services/staff-mgmt.service";
import { checkStaffMgmtRateLimit } from "@/lib/rate-limit/staff-mgmt-limits";
import {
  StaffMgmtErrorCode,
  createStaffMgmtError,
  toStaffMgmtErrorResponse,
} from "@/lib/errors/staff-mgmt-errors";
import { toStaffMgmtErrorNextResponse } from "@/lib/errors/staff-mgmt-http";

type RouteContext = SuperAdminContext & {
  params: Promise<{ staffId: string }>;
};

type RouteParams = {
  params: Promise<{ staffId: string }>;
};

const staffIdSchema = z.coerce.number().int().positive();
const updateStatusSchema = z.object({
  is_active: z.boolean(),
});

function parseStaffId(raw: string, requestId: string): number {
  const result = staffIdSchema.safeParse(raw);
  if (!result.success) {
    throw createStaffMgmtError(
      StaffMgmtErrorCode.INVALID_FILTER_TYPE,
      "Invalid staffId path parameter",
      400,
      requestId,
      { staffId: raw }
    );
  }
  return result.data;
}

async function parseBody(req: NextRequest, requestId: string) {
  const body = await req.json().catch(() => null);
  const result = updateStatusSchema.safeParse(body);

  if (!result.success) {
    throw createStaffMgmtError(
      StaffMgmtErrorCode.INVALID_FILTER_TYPE,
      "Invalid status update payload",
      400,
      requestId,
      { issues: result.error.issues }
    );
  }

  return result.data;
}

const patchHandler = withStaffMgmtSuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkStaffMgmtRateLimit(req, "UPDATE_STATUS", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toStaffMgmtErrorResponse(
          StaffMgmtErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many staff status update requests. Please try again later.",
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

    const { staffId } = await context.params;
    const parsedStaffId = parseStaffId(staffId, requestId);
    const body = await parseBody(req, requestId);

    const service = new StaffManagementService(requestId);
    const data = await service.toggleStaffStatus(
      parsedStaffId,
      body.is_active,
      String(user.id),
      {
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      }
    );

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
    return toStaffMgmtErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to update staff status"
    );
  }
});

export async function PATCH(req: NextRequest, context: RouteParams): Promise<Response> {
  return patchHandler(req, context);
}
