import { NextRequest, NextResponse } from "next/server";
import { withStaffMgmtSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { prisma } from "@/server/lib/prisma";
import { checkStaffMgmtRateLimit } from "@/lib/rate-limit/staff-mgmt-limits";
import {
  StaffMgmtErrorCode,
  toStaffMgmtErrorResponse,
} from "@/lib/errors/staff-mgmt-errors";
import { toStaffMgmtErrorNextResponse } from "@/lib/errors/staff-mgmt-http";

/**
 * GET /api/superadmin/staff/for-assignment
 *
 * Returns all active staff members with their assigned client count.
 * Used by the Super Admin client-assignment modal to populate the staff list.
 *
 * [STAFF_FOR_ASSIGNMENT_API]
 */
const getHandler = withStaffMgmtSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkStaffMgmtRateLimit(req, "FOR_ASSIGNMENT", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toStaffMgmtErrorResponse(
          StaffMgmtErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many requests. Please try again later.",
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

    // Fetch all active staff profiles with user info
    const staffProfiles = await prisma.staffProfile.findMany({
      where: { is_active: true },
      select: {
        staff_id: true,
        user: {
          select: {
            user_id: true,
            first_name: true,
            last_name: true,
            email: true,
            // Count active client assignments for each staff member
            staffClientAssignmentsStaff: {
              where: { is_active: true },
              select: { assignment_id: true },
            },
          },
        },
        role: {
          select: {
            role_name: true,
            role_key: true,
          },
        },
        department: {
          select: {
            department_name: true,
          },
        },
      },
      orderBy: { joined_at: "asc" },
    });

    const staff = staffProfiles.map((profile) => ({
      staff_id: Number(profile.staff_id),
      user_id: Number(profile.user.user_id),
      name: `${profile.user.first_name} ${profile.user.last_name}`.trim(),
      email: profile.user.email,
      role: profile.role.role_name,
      role_key: profile.role.role_key,
      department: profile.department.department_name,
      assigned_client_count: profile.user.staffClientAssignmentsStaff.length,
    }));

    return NextResponse.json({
      success: true,
      data: { staff },
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
      "Failed to fetch staff for assignment"
    );
  }
});

export async function GET(
  req: NextRequest,
  context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }
): Promise<Response> {
  return getHandler(req, context);
}
