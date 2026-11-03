import { NextRequest, NextResponse } from "next/server";
import { withStaffMgmtSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { StaffManagementService } from "@/lib/services/staff-mgmt.service";
import { checkStaffMgmtRateLimit } from "@/lib/rate-limit/staff-mgmt-limits";
import { StaffMgmtErrorCode, toStaffMgmtErrorResponse } from "@/lib/errors/staff-mgmt-errors";
import { toStaffMgmtErrorNextResponse } from "@/lib/errors/staff-mgmt-http";

const getHandler = withStaffMgmtSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkStaffMgmtRateLimit(req, "ANALYTICS", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toStaffMgmtErrorResponse(
          StaffMgmtErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many staff analytics requests. Please try again later.",
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

    const service = new StaffManagementService(requestId);
    const data = await service.getStaffAnalytics();

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
      "Failed to fetch staff analytics"
    );
  }
});

export async function GET(
  req: NextRequest,
  context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }
): Promise<Response> {
  return getHandler(req, context);
}
