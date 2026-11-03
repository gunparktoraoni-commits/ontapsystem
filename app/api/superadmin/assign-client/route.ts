import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withStaffMgmtSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { prisma } from "@/server/lib/prisma";
import { createNotificationFromEvent } from "@/server/lib/notifications";
import { checkStaffMgmtRateLimit } from "@/lib/rate-limit/staff-mgmt-limits";
import { getClientIp } from "@/server/lib/auth";
import {
  StaffMgmtErrorCode,
  createStaffMgmtError,
  toStaffMgmtErrorResponse,
} from "@/lib/errors/staff-mgmt-errors";
import { toStaffMgmtErrorNextResponse } from "@/lib/errors/staff-mgmt-http";
import { SupportMessagingService } from "@/lib/services/support-messaging.service";

// ──────────────────────────────────────────────────────────────
// Request schema
// ──────────────────────────────────────────────────────────────

const assignClientSchema = z.object({
  client_id: z.coerce.number().int().positive({
    message: "client_id must be a positive integer",
  }),
  staff_id: z.coerce.number().int().positive({
    message: "staff_id must be a positive integer",
  }),
  /**
   * When true: if the client is already assigned to a different staff member,
   * the existing active assignment will be deactivated and the new one created.
   * When false (default): returns a 409 conflict error.
   */
  force_reassign: z.boolean().optional().default(false),
});

type AssignClientBody = z.infer<typeof assignClientSchema>;

async function parseBody(req: NextRequest, requestId: string): Promise<AssignClientBody> {
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    throw createStaffMgmtError(
      StaffMgmtErrorCode.INVALID_FILTER_TYPE,
      "Invalid JSON body",
      400,
      requestId
    );
  }

  const result = assignClientSchema.safeParse(rawBody);
  if (!result.success) {
    throw createStaffMgmtError(
      StaffMgmtErrorCode.INVALID_FILTER_TYPE,
      "Invalid assign-client payload",
      400,
      requestId,
      { issues: result.error.issues }
    );
  }

  return result.data;
}

// ──────────────────────────────────────────────────────────────
// POST /api/superadmin/assign-client
// ──────────────────────────────────────────────────────────────

/**
 * Assigns a client (user) to a staff member.
 *
 * Flow:
 * 1. Validate request body (client_id, staff_id, force_reassign)
 * 2. Verify that the client user exists and is not a privileged role
 * 3. Verify that the target staff member is an active staff user
 * 4. Check for an existing active assignment for this client
 *    - If same staff → return 200 (idempotent, already assigned)
 *    - If different staff + force_reassign=false → return 409 with conflict info
 *    - If different staff + force_reassign=true → deactivate old, create new
 * 5. Create/upsert StaffClientAssignment row
 * 6. Fire a client_assigned notification to the target staff member
 * 7. Return success response
 *
 * [ASSIGN_CLIENT_API]
 */
const postHandler = withStaffMgmtSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    // ── Rate limit ───────────────────────────────────────────
    const rateLimit = checkStaffMgmtRateLimit(req, "ASSIGN_CLIENT", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toStaffMgmtErrorResponse(
          StaffMgmtErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many assignment requests. Please try again later.",
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

    // ── Parse body ───────────────────────────────────────────
    const body = await parseBody(req, requestId);
    const clientIdBig = BigInt(body.client_id);
    const staffIdBig = BigInt(body.staff_id);

    // ── Validate client user ─────────────────────────────────
    const clientUser = await prisma.user.findUnique({
      where: { user_id: clientIdBig },
      select: {
        user_id: true,
        first_name: true,
        last_name: true,
        email: true,
        role: true,
        is_active: true,
      },
    });

    if (!clientUser) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.STAFF_NOT_FOUND,
        "Client user not found",
        404,
        requestId,
        { client_id: body.client_id }
      );
    }

    if (clientUser.role === "super_admin" || clientUser.role === "dev") {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.INSUFFICIENT_PERMISSIONS,
        "Cannot assign a privileged account as a client",
        403,
        requestId,
        { client_id: body.client_id, role: clientUser.role }
      );
    }

    // ── Validate staff user ──────────────────────────────────
    const staffUser = await prisma.user.findUnique({
      where: { user_id: staffIdBig },
      select: {
        user_id: true,
        first_name: true,
        last_name: true,
        email: true,
        role: true,
        is_active: true,
        staffProfile: {
          select: { is_active: true },
        },
      },
    });

    if (!staffUser) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.STAFF_NOT_FOUND,
        "Staff member not found",
        404,
        requestId,
        { staff_id: body.staff_id }
      );
    }

    if (staffUser.role !== "staff") {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.INVALID_ROLE,
        "Target user is not a staff member",
        400,
        requestId,
        { staff_id: body.staff_id, role: staffUser.role }
      );
    }

    if (!staffUser.staffProfile?.is_active) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.STAFF_NOT_FOUND,
        "Target staff member is not active",
        400,
        requestId,
        { staff_id: body.staff_id }
      );
    }

    const clientFullName = `${clientUser.first_name} ${clientUser.last_name}`.trim();
    const staffFullName = `${staffUser.first_name} ${staffUser.last_name}`.trim();

    // ── Check for existing active assignment ─────────────────
    const existingAssignment = await prisma.staffClientAssignment.findFirst({
      where: {
        client_user_id: clientIdBig,
        is_active: true,
      },
      select: {
        assignment_id: true,
        staff_id: true,
        staff: {
          select: {
            first_name: true,
            last_name: true,
            email: true,
          },
        },
      },
    });

    if (existingAssignment) {
      // Already assigned to the same staff member — idempotent success
      if (existingAssignment.staff_id === staffIdBig) {
        return NextResponse.json({
          success: true,
          data: {
            already_assigned: true,
            client_id: body.client_id,
            staff_id: body.staff_id,
            client_name: clientFullName,
            staff_name: staffFullName,
            message: `${clientFullName} is already assigned to ${staffFullName}.`,
          },
          meta: {
            requestId,
            responseTime: Date.now() - startedAt,
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Assigned to a different staff — handle conflict
      const currentStaffName = `${existingAssignment.staff.first_name} ${existingAssignment.staff.last_name}`.trim();

      if (!body.force_reassign) {
        // Return 409 with enough context for the frontend to show a reassign confirmation
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "CLIENT_ALREADY_ASSIGNED",
              message: `${clientFullName} is already assigned to ${currentStaffName}. Use force_reassign=true to reassign.`,
              details: {
                client_id: body.client_id,
                client_name: clientFullName,
                current_staff_id: Number(existingAssignment.staff_id),
                current_staff_name: currentStaffName,
                requestId,
              },
            },
            meta: {
              requestId,
              responseTime: Date.now() - startedAt,
              timestamp: new Date().toISOString(),
            },
          },
          { status: 409 }
        );
      }

      // force_reassign=true: deactivate existing assignment in a transaction
      await prisma.$transaction(async (tx) => {
        await tx.staffClientAssignment.update({
          where: { assignment_id: existingAssignment.assignment_id },
          data: { is_active: false },
        });
      });
    }

    // ── Upsert the new assignment ────────────────────────────
    // upsert: if a soft-deleted row for this pair exists, reactivate it;
    // otherwise create fresh.
    const assignment = await prisma.staffClientAssignment.upsert({
      where: {
        // Prisma generates the compound unique key as staff_id_client_user_id
        staff_id_client_user_id: {
          staff_id: staffIdBig,
          client_user_id: clientIdBig,
        },
      },
      create: {
        staff_id: staffIdBig,
        client_user_id: clientIdBig,
        is_active: true,
        is_primary: true,
        assigned_at: new Date(),
        notes: `Assigned by Super Admin (user_id: ${user.id})`,
      },
      update: {
        is_active: true,
        is_primary: true,
        assigned_at: new Date(),
        notes: `Re-assigned by Super Admin (user_id: ${user.id})`,
      },
      select: {
        assignment_id: true,
        assigned_at: true,
      },
    });

    await new SupportMessagingService().synchronizeClientAssignment(
      clientIdBig,
      staffIdBig,
      BigInt(user.id),
    );

    // ── Fire notification to staff member ────────────────────
    // Non-blocking: notification failure must not break the assignment
    void createNotificationFromEvent({
      targetUserId: staffIdBig,
      triggerUserId: BigInt(user.id),
      eventType: "client_assigned",
      priority: "high",
      metadata: {
        client_id: String(body.client_id),
        client_name: clientFullName,
        client_email: clientUser.email,
        assigned_by_id: String(user.id),
        assigned_by_email: user.email,
        assignment_id: Number(assignment.assignment_id),
      },
      needsEmail: true,
    }).catch((error) => {
      console.error(
        "[ASSIGN_CLIENT_API] Failed to send client_assigned notification",
        {
          requestId,
          staffId: body.staff_id,
          clientId: body.client_id,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    });

    const ip = getClientIp(req);
    console.info("[ASSIGN_CLIENT_API] Client assigned successfully", {
      requestId,
      clientId: body.client_id,
      staffId: body.staff_id,
      actorId: user.id,
      ip,
      assignmentId: Number(assignment.assignment_id),
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          assignment_id: Number(assignment.assignment_id),
          client_id: body.client_id,
          staff_id: body.staff_id,
          client_name: clientFullName,
          client_email: clientUser.email,
          staff_name: staffFullName,
          staff_email: staffUser.email,
          assigned_at: assignment.assigned_at.toISOString(),
          message: `${clientFullName} has been successfully assigned to ${staffFullName}.`,
        },
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
      "Failed to assign client to staff member"
    );
  }
});

export async function POST(
  req: NextRequest,
  context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }
): Promise<Response> {
  return postHandler(req, context);
}
