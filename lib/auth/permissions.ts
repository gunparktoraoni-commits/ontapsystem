import { NextRequest } from "next/server";
import { resolveRequestSession } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";
import { createStaffMgmtError, StaffMgmtErrorCode } from "@/lib/errors/staff-mgmt-errors";

export type PermissionAction = "create" | "read" | "update" | "delete";

function toBoolean(value: unknown): boolean {
  return value === true;
}

/**
 * Checks if a user has permission for a specific module and action.
 * Super admins are always allowed.
 */
export async function hasPermission(
  userId: string,
  module: string,
  action: PermissionAction
): Promise<boolean> {
  const parsedUserId = userId.trim();
  if (!/^\d+$/.test(parsedUserId)) {
    return false;
  }

  const user = await prisma.user.findUnique({
    where: { user_id: BigInt(parsedUserId) },
    select: { role: true },
  });

  if (user?.role === "super_admin") {
    return true;
  }

  const staffProfile = await prisma.staffProfile.findUnique({
    where: { user_id: BigInt(parsedUserId) },
    select: {
      is_active: true,
      permissions: {
        where: { module },
        select: {
          can_create: true,
          can_read: true,
          can_update: true,
          can_delete: true,
        },
        take: 1,
      },
    },
  });

  if (!staffProfile || !staffProfile.is_active) {
    return false;
  }

  const permission = staffProfile.permissions[0];
  if (!permission) {
    return false;
  }

  switch (action) {
    case "create":
      return toBoolean(permission.can_create);
    case "read":
      return toBoolean(permission.can_read);
    case "update":
      return toBoolean(permission.can_update);
    case "delete":
      return toBoolean(permission.can_delete);
    default:
      return false;
  }
}

/**
 * Guard helper for module-level permissions.
 * Throws AppError on failure so route wrappers can normalize responses.
 */
export function requirePermission(module: string, action: PermissionAction) {
  return async (req: NextRequest, requestId: string): Promise<void> => {
    const auth = await resolveRequestSession(req, { tryRefresh: true });
    if (!auth.session) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.UNAUTHORIZED_ACCESS,
        "Authentication required",
        401,
        requestId
      );
    }

    const allowed = await hasPermission(String(auth.session.userId), module, action);
    if (!allowed) {
      throw createStaffMgmtError(
        StaffMgmtErrorCode.INSUFFICIENT_PERMISSIONS,
        `Insufficient permissions for ${action} on ${module}`,
        403,
        requestId,
        {
          module,
          action,
          userId: auth.session.userId,
        }
      );
    }
  };
}
