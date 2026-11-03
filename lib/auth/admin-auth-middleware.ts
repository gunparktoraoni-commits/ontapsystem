import { NextRequest, NextResponse } from "next/server";
import { getRequestId } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import {
  AuthErrorCode,
  createAuthError,
  extractAuthErrorCode,
  toAuthErrorResponse,
} from "@/lib/errors/auth-errors";
import { ADMIN_AUTH_ALLOWED_ROLES } from "@/lib/services/auth.service";
import { resolveRequestSession } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";

const ADMIN_ROLE_SET = new Set<string>(ADMIN_AUTH_ALLOWED_ROLES);

export interface AdminAuthContext {
  user: {
    id: number;
    userId: bigint;
    email: string;
    role: string;
    requiresPasswordChange: boolean;
  };
  session: {
    sessionId: number;
    rememberMe: boolean;
    expiresAt: Date;
    refreshed: boolean;
  };
  requestId: string;
}

export async function requireAdminAuth(req: NextRequest): Promise<AdminAuthContext> {
  const requestId = getRequestId(req.headers);

  const auth = await resolveRequestSession(req, { tryRefresh: true });
  if (!auth.session) {
    throw createAuthError(
      AuthErrorCode.UNAUTHORIZED_ACCESS,
      "Authentication required",
      401,
      requestId
    );
  }

  const user = await prisma.user.findUnique({
    where: { user_id: BigInt(auth.session.userId) },
    select: {
      user_id: true,
      email: true,
      role: true,
      deactivated_flag: true,
      credentials: {
        select: {
          must_change_password: true,
        },
      },
    },
  });

  if (!user || user.deactivated_flag) {
    throw createAuthError(
      AuthErrorCode.UNAUTHORIZED_ACCESS,
      "Session user not found",
      401,
      requestId,
      {
        userId: auth.session.userId,
      }
    );
  }

  if (!ADMIN_ROLE_SET.has(user.role.toLowerCase())) {
    throw createAuthError(
      AuthErrorCode.ADMIN_ROLE_REQUIRED,
      "Admin role required for this endpoint",
      403,
      requestId,
      {
        userId: Number(user.user_id),
        currentRole: user.role,
        allowedRoles: ADMIN_AUTH_ALLOWED_ROLES,
      }
    );
  }

  return {
    user: {
      id: Number(user.user_id),
      userId: user.user_id,
      email: user.email,
      role: user.role,
      requiresPasswordChange: user.credentials?.must_change_password === true,
    },
    session: {
      sessionId: auth.session.sessionId,
      rememberMe: auth.session.rememberMe,
      expiresAt: auth.session.expiresAt,
      refreshed: auth.refreshed,
    },
    requestId,
  };
}

type NextRouteContext = Record<string, unknown> & {
  params: Promise<Record<string, string | string[]>>;
};

export function withAdminAuth<TContext extends NextRouteContext = NextRouteContext>(
  handler: (req: NextRequest, context: TContext & AdminAuthContext) => Promise<Response>
) {
  return async (req: NextRequest, context: TContext): Promise<Response> => {
    const startedAt = Date.now();

    try {
      const authContext = await requireAdminAuth(req);
      return await handler(req, {
        ...(context ?? ({} as TContext)),
        ...authContext,
      });
    } catch (error) {
      const responseTime = Date.now() - startedAt;

      if (error instanceof AppError) {
        const requestId = error.requestId ?? getRequestId(req.headers);
        const code = extractAuthErrorCode(error) ?? AuthErrorCode.UNAUTHORIZED_ACCESS;

        return NextResponse.json(
          toAuthErrorResponse(code, error.message, requestId, error.details, responseTime),
          { status: error.statusCode }
        );
      }

      const requestId = getRequestId(req.headers);
      return NextResponse.json(
        toAuthErrorResponse(
          AuthErrorCode.UNAUTHORIZED_ACCESS,
          "Unauthorized",
          requestId,
          undefined,
          responseTime
        ),
        { status: 401 }
      );
    }
  };
}
