import { NextRequest, NextResponse } from "next/server";
import { getRequestId } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import {
  StaffMarketingErrorCode,
  createStaffMarketingError,
  extractStaffMarketingErrorCode,
  toStaffMarketingErrorResponse,
} from "@/lib/errors/staff-marketing-errors";
import { resolveRequestSession } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";

export interface StaffPortalContext {
  user: {
    id: number;
    userId: bigint;
    email: string;
    role: string;
  };
  staffId: bigint;
  requestId: string;
}

export async function requireStaffPortal(
  req: NextRequest,
  requestId?: string
): Promise<StaffPortalContext> {
  const finalRequestId = requestId || getRequestId(req.headers);

  try {
    const resolved = await resolveRequestSession(req);
    const session = resolved.session;
    if (!session) {
      throw createStaffMarketingError(
        StaffMarketingErrorCode.STAFF_ROLE_REQUIRED,
        "Authentication required",
        401,
        finalRequestId
      );
    }

    if (session.role !== "staff") {
      throw createStaffMarketingError(
        StaffMarketingErrorCode.STAFF_ROLE_REQUIRED,
        "Only staff members can access this resource",
        403,
        finalRequestId
      );
    }

    return {
      user: {
        id: Number(session.userId),
        userId: BigInt(session.userId),
        email: session.email,
        role: session.role,
      },
      staffId: BigInt(session.userId),
      requestId: finalRequestId,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw createStaffMarketingError(
      StaffMarketingErrorCode.INTERNAL_ERROR,
      "Authentication failed",
      500,
      finalRequestId
    );
  }
}

export function withStaffPortal<T extends { requestId: string }>(
  handler: (context: StaffPortalContext, req: NextRequest) => Promise<NextResponse<T>>
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const requestId = getRequestId(req.headers);
    const startTime = Date.now();

    try {
      const context = await requireStaffPortal(req, requestId);
      return await handler(context, req);
    } catch (error) {
      const responseTime = Date.now() - startTime;

      if (error instanceof AppError) {
        const code = extractStaffMarketingErrorCode(error);
        if (code) {
          const resp = toStaffMarketingErrorResponse(
            code,
            error.message,
            requestId,
            error.details,
            responseTime
          );
          return NextResponse.json(resp, { status: (error as { statusCode?: number }).statusCode ?? 500 });
        }
      }

      return NextResponse.json(
        {
          success: false,
          error: {
            code: StaffMarketingErrorCode.INTERNAL_ERROR,
            message: "Internal server error",
            requestId,
          },
          meta: {
            requestId,
            responseTime,
          },
        },
        { status: 500 }
      );
    }
  };
}

export async function checkStaffPortalRateLimit(
  key: string,
  req: NextRequest,
  requestId?: string
): Promise<{ allowed: boolean; retryAfterMs?: number; remaining?: number }> {
  const finalRequestId = requestId || getRequestId(req.headers);
  const ip = req.headers.get("x-forwarded-for") || "unknown";

  const result = checkRateLimit(key, ip);

  if (!result.allowed) {
    throw createStaffMarketingError(
      StaffMarketingErrorCode.RATE_LIMIT_EXCEEDED,
      "Rate limit exceeded. Please try again later.",
      429,
      finalRequestId,
      { retryAfterMs: result.retryAfterMs }
    );
  }

  return result;
}
