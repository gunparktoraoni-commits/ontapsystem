import { NextRequest, NextResponse } from "next/server";
import { getRequestId } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import {
  ClientErrorCode,
  createClientError,
  extractClientErrorCode,
  toClientErrorResponse,
} from "@/lib/errors/client-errors";
import {
  AffiliateMgmtErrorCode,
  createAffiliateMgmtError,
  extractAffiliateMgmtErrorCode,
  toAffiliateMgmtErrorResponse,
} from "@/lib/errors/affiliate-mgmt-errors";
import {
  OrderErrorCode,
  createOrderError,
  extractOrderErrorCode,
  toOrderErrorResponse,
} from "@/lib/errors/order-errors";
import {
  StaffMgmtErrorCode,
  createStaffMgmtError,
  extractStaffMgmtErrorCode,
  toStaffMgmtErrorResponse,
} from "@/lib/errors/staff-mgmt-errors";
import {
  SuperAdminErrorCode,
  createSuperAdminError,
  extractSuperAdminErrorCode,
  toSuperAdminErrorResponse,
} from "@/lib/errors/superadmin-errors";
import { resolveRequestSession } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";

export interface SuperAdminContext {

  user: {
    id: number;
    userId: bigint;
    email: string;
    role: string;
  };
  requestId: string;
}



type NextRouteContext = Record<string, unknown> & {
  params: Promise<Record<string, string | string[]>>;
};



export interface SuperAdminGuardOptions {
  errorMode?: "client" | "superadmin";
}



export interface SuperAdminImpersonationContext {
  tokenId: number;
  superadminUserId: number;
  targetUserId: number;
  sessionId: number | null;
  reason: string | null;
  expiresAt: Date;
  createdAt: Date;
  source: "header" | "cookie";
}

export interface SuperAdminCompanyContext extends SuperAdminContext {
  originalUser: SuperAdminContext["user"];
  effectiveUser: SuperAdminContext["user"];
  impersonation: SuperAdminImpersonationContext | null;
}

type SessionUser = {
  user_id: bigint;
  email: string;
  role: string;
};

async function getSessionUser(userId: number): Promise<SessionUser | null> {
  return prisma.user.findUnique({
    where: { user_id: BigInt(userId) },
    select: {
      user_id: true,
      email: true,
      role: true,
    },
  });
}

function toSuperAdminUser(user: SessionUser): SuperAdminContext["user"] {
  return {
    id: Number(user.user_id),
    userId: user.user_id,
    email: user.email,
    role: user.role,
  };
}


export async function requireSuperAdmin(
  req: NextRequest,
  options: SuperAdminGuardOptions = {}
): Promise<SuperAdminContext> {
  const requestId = getRequestId(req.headers);
  const errorMode = options.errorMode ?? "client";

  const unauthorized = (message: string, details?: Record<string, unknown>): never => {
    if (errorMode === "superadmin") {
      throw createSuperAdminError(
        SuperAdminErrorCode.UNAUTHORIZED_ACCESS,
        message,
        401,
        requestId,
        details
      );
    }

    throw createClientError(ClientErrorCode.UNAUTHORIZED_ACCESS, message, 401, requestId, details);
  };


  const forbidden = (message: string, details?: Record<string, unknown>): never => {
    if (errorMode === "superadmin") {
      throw createSuperAdminError(
        SuperAdminErrorCode.SUPERADMIN_REQUIRED,
        message,
        403,
        requestId,
        details
      );
    }

    throw createClientError(ClientErrorCode.SUPERADMIN_REQUIRED, message, 403, requestId, details);
  };

  const auth = await resolveRequestSession(req, { tryRefresh: true });
  const session = auth.session;
  if (!session) {
    unauthorized("Authentication required");
  }


  const user = await getSessionUser(session!.userId);
  if (!user) {
    unauthorized("Session user not found", { userId: session!.userId });
  }

  if (user!.role !== "super_admin" && user!.role !== "dev") {
    forbidden("SuperAdmin access required", {
      requiredRole: "super_admin",
      currentRole: user!.role,
      userId: user!.user_id.toString(),
    });
  }

  return {
    user: toSuperAdminUser(user!),
    requestId,
  };
}

export function withSuperAdmin<TContext extends NextRouteContext = NextRouteContext>(
  handler: (req: NextRequest, context: TContext & SuperAdminContext) => Promise<Response>,
  options: SuperAdminGuardOptions = {}
) {
  return async (req: NextRequest, context: TContext): Promise<Response> => {
    const startedAt = Date.now();

    try {
      const superAdminContext = await requireSuperAdmin(req, options);
      return await handler(req, {
        ...(context ?? ({} as TContext)),
        ...superAdminContext,
      });
    } catch (error) {
      const responseTime = Date.now() - startedAt;

      if (options.errorMode === "superadmin") {
        if (error instanceof AppError) {
          const requestId = error.requestId ?? getRequestId(req.headers);
          const code = extractSuperAdminErrorCode(error) ?? SuperAdminErrorCode.INTERNAL_ERROR;

          return NextResponse.json(
            toSuperAdminErrorResponse(code, error.message, requestId, error.details, responseTime),
            { status: error.statusCode }
          );
        }

        const requestId = getRequestId(req.headers);
        return NextResponse.json(
          toSuperAdminErrorResponse(
            SuperAdminErrorCode.INTERNAL_ERROR,
            "Internal server error",
            requestId,
            undefined,
            responseTime
          ),
          { status: 500 }
        );
      }

      if (error instanceof AppError) {
        const requestId = error.requestId ?? getRequestId(req.headers);
        const code = extractClientErrorCode(error) ?? ClientErrorCode.UNAUTHORIZED_ACCESS;

        return NextResponse.json(
          toClientErrorResponse(code, error.message, requestId, error.details, responseTime),
          { status: error.statusCode }
        );
      }

      const requestId = getRequestId(req.headers);
      return NextResponse.json(
        toClientErrorResponse(
          ClientErrorCode.UNAUTHORIZED_ACCESS,
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

export async function requireAffiliateSuperAdmin(req: NextRequest): Promise<SuperAdminContext> {
  const requestId = getRequestId(req.headers);

  const auth = await resolveRequestSession(req, { tryRefresh: true });
  const session = auth.session;
  if (!session) {
    throw createAffiliateMgmtError(
      AffiliateMgmtErrorCode.UNAUTHORIZED_ACCESS,
      "Authentication required",
      401,
      requestId
    );
  }

  const user = await getSessionUser(session!.userId);
  if (!user) {
    throw createAffiliateMgmtError(
      AffiliateMgmtErrorCode.UNAUTHORIZED_ACCESS,
      "Session user not found",
      401,
      requestId,
      { userId: session!.userId }
    );
  }

  if (user!.role !== "super_admin") {
    throw createAffiliateMgmtError(
      AffiliateMgmtErrorCode.SUPERADMIN_REQUIRED,
      "SuperAdmin access required for affiliate management",
      403,
      requestId,
      {
        requiredRole: "super_admin",
        currentRole: user!.role,
        userId: user!.user_id.toString(),
      }
    );
  }

  return {
    user: toSuperAdminUser(user!),
    requestId,
  };
}

export function withAffiliateSuperAdmin<TContext extends NextRouteContext = NextRouteContext>(
  handler: (req: NextRequest, context: TContext & SuperAdminContext) => Promise<Response>
) {
  return async (req: NextRequest, context: TContext): Promise<Response> => {
    const startedAt = Date.now();

    try {
      const superAdminContext = await requireAffiliateSuperAdmin(req);
      return await handler(req, {
        ...(context ?? ({} as TContext)),
        ...superAdminContext,
      });
    } catch (error) {
      const responseTime = Date.now() - startedAt;

      if (error instanceof AppError) {
        const requestId = error.requestId ?? getRequestId(req.headers);
        const code =
          extractAffiliateMgmtErrorCode(error) ?? AffiliateMgmtErrorCode.UNAUTHORIZED_ACCESS;

        return NextResponse.json(
          toAffiliateMgmtErrorResponse(code, error.message, requestId, error.details, responseTime),
          { status: error.statusCode }
        );
      }

      const requestId = getRequestId(req.headers);
      return NextResponse.json(
        toAffiliateMgmtErrorResponse(
          AffiliateMgmtErrorCode.UNAUTHORIZED_ACCESS,
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

export async function requireOrderSuperAdmin(req: NextRequest): Promise<SuperAdminContext> {
  const requestId = getRequestId(req.headers);

  const auth = await resolveRequestSession(req, { tryRefresh: true });
  const session = auth.session;
  if (!session) {
    throw createOrderError(
      OrderErrorCode.UNAUTHORIZED_ACCESS,
      "Authentication required",
      401,
      requestId
    );
  }

  const user = await getSessionUser(session!.userId);
  if (!user) {
    throw createOrderError(
      OrderErrorCode.UNAUTHORIZED_ACCESS,
      "Session user not found",
      401,
      requestId,
      { userId: session!.userId }
    );
  }

  if (user!.role !== "super_admin") {
    throw createOrderError(
      OrderErrorCode.SUPERADMIN_REQUIRED,
      "SuperAdmin access required for order management",
      403,
      requestId,
      {
        requiredRole: "super_admin",
        currentRole: user!.role,
        userId: user!.user_id.toString(),
      }
    );
  }

  return {
    user: toSuperAdminUser(user!),
    requestId,
  };
}

export function withOrderSuperAdmin<TContext extends NextRouteContext = NextRouteContext>(
  handler: (req: NextRequest, context: TContext & SuperAdminContext) => Promise<Response>
) {
  return async (req: NextRequest, context: TContext): Promise<Response> => {
    const startedAt = Date.now();

    try {
      const superAdminContext = await requireOrderSuperAdmin(req);
      return await handler(req, {
        ...(context ?? ({} as TContext)),
        ...superAdminContext,
      });
    } catch (error) {
      const responseTime = Date.now() - startedAt;

      if (error instanceof AppError) {
        const requestId = error.requestId ?? getRequestId(req.headers);
        const code = extractOrderErrorCode(error) ?? OrderErrorCode.UNAUTHORIZED_ACCESS;

        return NextResponse.json(
          toOrderErrorResponse(code, error.message, requestId, error.details, responseTime),
          { status: error.statusCode }
        );
      }

      const requestId = getRequestId(req.headers);
      return NextResponse.json(
        toOrderErrorResponse(
          OrderErrorCode.UNAUTHORIZED_ACCESS,
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

export async function requireStaffMgmtSuperAdmin(req: NextRequest): Promise<SuperAdminContext> {
  const requestId = getRequestId(req.headers);

  const auth = await resolveRequestSession(req, { tryRefresh: true });
  const session = auth.session;
  if (!session) {
    throw createStaffMgmtError(
      StaffMgmtErrorCode.UNAUTHORIZED_ACCESS,
      "Authentication required",
      401,
      requestId
    );
  }

  const user = await getSessionUser(session!.userId);
  if (!user) {
    throw createStaffMgmtError(
      StaffMgmtErrorCode.UNAUTHORIZED_ACCESS,
      "Session user not found",
      401,
      requestId,
      { userId: session!.userId }
    );
  }

  if (user!.role !== "super_admin") {
    throw createStaffMgmtError(
      StaffMgmtErrorCode.SUPERADMIN_REQUIRED,
      "SuperAdmin access required for staff management",
      403,
      requestId,
      {
        requiredRole: "super_admin",
        currentRole: user!.role,
        userId: user!.user_id.toString(),
      }
    );
  }

  return {
    user: toSuperAdminUser(user!),
    requestId,
  };
}

export function withStaffMgmtSuperAdmin<TContext extends NextRouteContext = NextRouteContext>(
  handler: (req: NextRequest, context: TContext & SuperAdminContext) => Promise<Response>
) {
  return async (req: NextRequest, context: TContext): Promise<Response> => {
    const startedAt = Date.now();

    try {
      const superAdminContext = await requireStaffMgmtSuperAdmin(req);
      return await handler(req, {
        ...(context ?? ({} as TContext)),
        ...superAdminContext,
      });
    } catch (error) {
      const responseTime = Date.now() - startedAt;

      if (error instanceof AppError) {
        const requestId = error.requestId ?? getRequestId(req.headers);
        const code = extractStaffMgmtErrorCode(error) ?? StaffMgmtErrorCode.UNAUTHORIZED_ACCESS;

        return NextResponse.json(
          toStaffMgmtErrorResponse(code, error.message, requestId, error.details, responseTime),
          { status: error.statusCode }
        );
      }

      const requestId = getRequestId(req.headers);
      return NextResponse.json(
        toStaffMgmtErrorResponse(
          StaffMgmtErrorCode.UNAUTHORIZED_ACCESS,
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

export async function requireDashboardSuperAdmin(req: NextRequest): Promise<SuperAdminContext> {
  const requestId = getRequestId(req.headers);

  const auth = await resolveRequestSession(req, { tryRefresh: true });
  const session = auth.session;
  if (!session) {
    throw createSuperAdminError(
      SuperAdminErrorCode.UNAUTHORIZED_ACCESS,
      "Authentication required",
      401,
      requestId
    );
  }

  const user = await getSessionUser(session!.userId);
  if (!user) {
    throw createSuperAdminError(
      SuperAdminErrorCode.UNAUTHORIZED_ACCESS,
      "Session user not found",
      401,
      requestId,
      { userId: session!.userId }
    );
  }

  if (
    String(user!.role).trim().toLowerCase() !== "super_admin" &&
    String(user!.role).trim().toLowerCase() !== "dev"
  ) {
    throw createSuperAdminError(
      SuperAdminErrorCode.SUPERADMIN_REQUIRED,
      "SuperAdmin access required for dashboard management",
      403,
      requestId,
      {
        requiredRole: "super_admin",
        currentRole: user!.role,
        userId: user!.user_id.toString(),
      }
    );
  }

  return {
    user: toSuperAdminUser(user!),
    requestId,
  };
}

export function withDashboardSuperAdmin<TContext extends NextRouteContext = NextRouteContext>(
  handler: (req: NextRequest, context: TContext & SuperAdminContext) => Promise<Response>
) {
  return async (req: NextRequest, context: TContext): Promise<Response> => {
    const startedAt = Date.now();

    try {
      const superAdminContext = await requireDashboardSuperAdmin(req);
      return await handler(req, {
        ...(context ?? ({} as TContext)),
        ...superAdminContext,
      });
    } catch (error) {
      const responseTime = Date.now() - startedAt;

      if (error instanceof AppError) {
        const requestId = error.requestId ?? getRequestId(req.headers);
        const code = extractSuperAdminErrorCode(error) ?? SuperAdminErrorCode.UNAUTHORIZED_ACCESS;

        return NextResponse.json(
          toSuperAdminErrorResponse(code, error.message, requestId, error.details, responseTime),
          { status: error.statusCode }
        );
      }

      const requestId = getRequestId(req.headers);
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.UNAUTHORIZED_ACCESS,
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

export async function requireCompanySuperAdmin(req: NextRequest): Promise<SuperAdminCompanyContext> {
  const requestId = getRequestId(req.headers);

  const auth = await resolveRequestSession(req, { tryRefresh: true });
  const session = auth.session;
  if (!session) {
    throw createSuperAdminError(
      SuperAdminErrorCode.UNAUTHORIZED_ACCESS,
      "Authentication required",
      401,
      requestId
    );
  }

  const superAdminUser = await getSessionUser(session!.userId);
  if (!superAdminUser) {
    throw createSuperAdminError(
      SuperAdminErrorCode.UNAUTHORIZED_ACCESS,
      "Session user not found",
      401,
      requestId,
      { userId: session!.userId }
    );
  }

  if (superAdminUser!.role !== "super_admin") {
    throw createSuperAdminError(
      SuperAdminErrorCode.SUPERADMIN_REQUIRED,
      "SuperAdmin access required for company management",
      403,
      requestId,
      {
        requiredRole: "super_admin",
        currentRole: superAdminUser!.role,
        userId: superAdminUser!.user_id.toString(),
      }
    );
  }

  const originalUser = toSuperAdminUser(superAdminUser!);
  let effectiveUser = originalUser;
  let impersonation: SuperAdminImpersonationContext | null = null;

  if (auth.impersonation) {
    if (auth.impersonation.superadminUserId !== Number(superAdminUser!.user_id)) {
      throw createSuperAdminError(
        SuperAdminErrorCode.IMPERSONATION_NOT_ALLOWED,
        "Impersonation token does not belong to authenticated superadmin",
        403,
        requestId,
        {
          tokenId: auth.impersonation.tokenId,
          tokenSuperadminUserId: auth.impersonation.superadminUserId,
          authenticatedSuperadminUserId: Number(superAdminUser!.user_id),
        }
      );
    }

    const targetUser = await prisma.user.findUnique({
      where: { user_id: BigInt(auth.impersonation.targetUserId) },
      select: {
        user_id: true,
        email: true,
        role: true,
        deactivated_flag: true,
      },
    });

    if (!targetUser || targetUser.deactivated_flag) {
      throw createSuperAdminError(
        SuperAdminErrorCode.IMPERSONATION_TARGET_NOT_FOUND,
        "Impersonation target user not found or inactive",
        404,
        requestId,
        {
          targetUserId: auth.impersonation.targetUserId,
          tokenId: auth.impersonation.tokenId,
        }
      );
    }

    if (targetUser.role === "super_admin") {
      throw createSuperAdminError(
        SuperAdminErrorCode.IMPERSONATION_NOT_ALLOWED,
        "Impersonating another superadmin is not allowed",
        409,
        requestId,
        {
          targetUserId: Number(targetUser.user_id),
          targetRole: targetUser.role,
        }
      );
    }

    effectiveUser = {
      id: Number(targetUser.user_id),
      userId: targetUser.user_id,
      email: targetUser.email,
      role: targetUser.role,
    };

    impersonation = {
      tokenId: auth.impersonation.tokenId,
      superadminUserId: auth.impersonation.superadminUserId,
      targetUserId: auth.impersonation.targetUserId,
      sessionId: auth.impersonation.sessionId,
      reason: auth.impersonation.reason,
      expiresAt: auth.impersonation.expiresAt,
      createdAt: auth.impersonation.createdAt,
      source: auth.impersonation.source,
    };
  }

  return {
    user: originalUser,
    originalUser,
    effectiveUser,
    impersonation,
    requestId,
  };
}

export function withCompanySuperAdmin<TContext extends NextRouteContext = NextRouteContext>(
  handler: (req: NextRequest, context: TContext & SuperAdminCompanyContext) => Promise<Response>
) {
  return async (req: NextRequest, context: TContext): Promise<Response> => {
    const startedAt = Date.now();

    try {
      const superAdminContext = await requireCompanySuperAdmin(req);
      return await handler(req, {
        ...(context ?? ({} as TContext)),
        ...superAdminContext,
      });
    } catch (error) {
      const responseTime = Date.now() - startedAt;

      if (error instanceof AppError) {
        const requestId = error.requestId ?? getRequestId(req.headers);
        const code = extractSuperAdminErrorCode(error) ?? SuperAdminErrorCode.UNAUTHORIZED_ACCESS;

        return NextResponse.json(
          toSuperAdminErrorResponse(code, error.message, requestId, error.details, responseTime),
          { status: error.statusCode }
        );
      }

      const requestId = getRequestId(req.headers);
      return NextResponse.json(
        toSuperAdminErrorResponse(
          SuperAdminErrorCode.UNAUTHORIZED_ACCESS,
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
