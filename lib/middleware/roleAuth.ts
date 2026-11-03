import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";

const prismaAny = prisma as any;

export type AuthorizedActor = {
  userId: bigint;
  email: string;
  role: string;
};

export type RoleAuthResult =
  | { ok: true; actor: AuthorizedActor }
  | { ok: false; response: NextResponse };

export async function requireRole(
  request: NextRequest,
  roles: string | string[]
): Promise<RoleAuthResult> {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];
  const allowed = new Set(allowedRoles.map((role) => role.toLowerCase()));

  const resolved = await resolveRequestSession(request, { tryRefresh: true });
  if (!resolved.session) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication required",
          },
        },
        { status: 401 }
      ),
    };
  }

  const user = await prisma.user.findUnique({
    where: { user_id: BigInt(resolved.session.userId) },
    select: {
      user_id: true,
      email: true,
      role: true,
    },
  });

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Session user not found",
          },
        },
        { status: 401 }
      ),
    };
  }

  const role = (user.role || "user").toLowerCase();
  if (!allowed.has(role)) {
    try {
      await prismaAny.adminAuditLog.create({
        data: {
          admin_user_id: user.user_id,
          admin_email: user.email,
          action: "UNAUTHORIZED_ACCESS_ATTEMPT",
          details: JSON.stringify({
            path: request.nextUrl.pathname,
            requiredRole: allowedRoles,
            userRole: user.role,
            attemptedAt: new Date().toISOString(),
          }),
          ip_address: request.headers.get("x-forwarded-for") || null,
          user_agent: request.headers.get("user-agent") || null,
        },
      });
    } catch {
      // Audit write is best-effort; auth should still fail safely.
    }

    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "Insufficient permissions",
          },
        },
        { status: 403 }
      ),
    };
  }

  return {
    ok: true,
    actor: {
      userId: user.user_id,
      email: user.email,
      role: user.role,
    },
  };
}
