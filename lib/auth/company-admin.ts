import { NextRequest, NextResponse } from "next/server";
import { resolveRequestSession, resolveEffectiveUserId } from "@/server/lib/auth";
import { resolveCompanyActorContext } from "@/server/lib/company";
import { getRequestId } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import {
  DashboardErrorCode,
  createDashboardError,
  extractDashboardErrorCode,
  toDashboardErrorResponse,
} from "@/lib/errors/dashboard-errors";

export interface CompanyAdminContext {
  user: {
    id: number;
    email: string;
    role: string;
  };
  companyId: bigint;
  requestId: string;
}

function normalizeCompanyError(error: AppError, requestId: string): AppError {
  const code = String(error.code);

  if (code === "COMPANY_3000") {
    return createDashboardError(
      DashboardErrorCode.COMPANY_NOT_FOUND,
      "Company not found",
      404,
      requestId,
      error.details
    );
  }

  if (code === "AUTH_3400" || code === "EMPLOYEE_3203") {
    return createDashboardError(
      DashboardErrorCode.NOT_COMPANY_ADMIN,
      "User does not have admin permissions for this company",
      403,
      requestId,
      error.details
    );
  }

  return error;
}

/**
 * Validate authenticated company-admin access and return scoped dashboard context.
 */
export async function requireCompanyAdmin(
  req: NextRequest,
  companyId?: string
): Promise<CompanyAdminContext> {
  const requestId = getRequestId(req.headers);

  const auth = await resolveRequestSession(req, { tryRefresh: true });
  if (!auth.session) {
    throw createDashboardError(
      DashboardErrorCode.UNAUTHORIZED_ACCESS,
      "Authentication required",
      401,
      requestId
    );
  }

  let scopedCompanyId: bigint | undefined;
  if (companyId !== undefined) {
    try {
      scopedCompanyId = BigInt(companyId);
    } catch {
      throw createDashboardError(
        DashboardErrorCode.COMPANY_NOT_FOUND,
        "Invalid company id",
        404,
        requestId,
        { companyId }
      );
    }
  }

  let actorContext;
  try {
    const effectiveUserId = BigInt(resolveEffectiveUserId(auth));
    actorContext = await resolveCompanyActorContext({
      userId: effectiveUserId,
      requestId,
      ...(scopedCompanyId !== undefined ? { companyId: scopedCompanyId } : {}),
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw normalizeCompanyError(error, requestId);
    }
    throw error;
  }

  if (actorContext.role !== "admin" && actorContext.role !== "manager") {
    throw createDashboardError(
      DashboardErrorCode.NOT_COMPANY_ADMIN,
      "User does not have admin permissions for this company",
      403,
      requestId,
      { role: actorContext.role }
    );
  }

  return {
    user: {
      id: Number(resolveEffectiveUserId(auth)),
      email: auth.session.email,
      role: auth.session.role,
    },
    companyId: actorContext.companyId,
    requestId,
  };
}

type NextRouteContext = Record<string, unknown> & {
  params: Promise<Record<string, string | string[]>>;
};

/**
 * Higher-order route wrapper that injects company-admin context and normalizes auth errors.
 */
export function withCompanyAdmin<TContext extends NextRouteContext = NextRouteContext>(
  handler: (req: NextRequest, context: TContext & CompanyAdminContext) => Promise<Response>
) {
  return async (req: NextRequest, context: TContext) => {
    const startedAt = Date.now();

    try {
      const params = await context.params;
      const rawCompanyId = params?.companyId;
      const companyId = Array.isArray(rawCompanyId) ? rawCompanyId[0] : rawCompanyId;
      const adminContext = await requireCompanyAdmin(req, companyId);

      return await handler(req, {
        ...(context ?? ({} as TContext)),
        ...adminContext,
      });
    } catch (error) {
      const responseTime = Date.now() - startedAt;

      if (error instanceof AppError) {
        const requestId = error.requestId ?? getRequestId(req.headers);
        const dashboardCode =
          extractDashboardErrorCode(error) ?? DashboardErrorCode.UNAUTHORIZED_ACCESS;

        return NextResponse.json(
          toDashboardErrorResponse(
            dashboardCode,
            error.message,
            requestId,
            error.details,
            responseTime
          ),
          { status: error.statusCode }
        );
      }

      const fallbackRequestId = getRequestId(req.headers);
      return NextResponse.json(
        toDashboardErrorResponse(
          DashboardErrorCode.UNAUTHORIZED_ACCESS,
          "Unauthorized",
          fallbackRequestId,
          undefined,
          responseTime
        ),
        { status: 401 }
      );
    }
  };
}
