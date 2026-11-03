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

const getHandler = withStaffMgmtSuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkStaffMgmtRateLimit(req, "DETAIL", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toStaffMgmtErrorResponse(
          StaffMgmtErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many staff detail requests. Please try again later.",
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

    const service = new StaffManagementService(requestId);
    const data = await service.getStaffDetails(parsedStaffId);

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
      "Failed to fetch staff details"
    );
  }
});

export async function GET(req: NextRequest, context: RouteParams): Promise<Response> {
  return getHandler(req, context);
}

const deleteHandler = withStaffMgmtSuperAdmin(async (req: NextRequest, context: RouteContext) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkStaffMgmtRateLimit(req, "DELETE", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toStaffMgmtErrorResponse(
          StaffMgmtErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many staff delete requests. Please try again later.",
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

    const service = new StaffManagementService(requestId);
    const data = await service.deleteStaff(parsedStaffId, String(user.id), {
      ipAddress: getClientIp(req),
      userAgent: getUserAgent(req),
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
    return toStaffMgmtErrorNextResponse(
      error,
      requestId,
      Date.now() - startedAt,
      "Failed to delete staff member"
    );
  }
});

export async function DELETE(req: NextRequest, context: RouteParams): Promise<Response> {
  return deleteHandler(req, context);
}
