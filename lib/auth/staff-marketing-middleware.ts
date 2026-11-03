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
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";

export interface StaffMarketingContext {
  user: {
    id: number;
    userId: bigint;
    email: string;
    role: string;
    staffDesignation: string;
  };
  staffId: bigint;
  requestId: string;
}

export async function requireMarketingStaff(
  req: NextRequest,
  requestId?: string
): Promise<StaffMarketingContext> {
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

    // Check if user has staff role
    if (session.role !== "staff") {
      throw createStaffMarketingError(
        StaffMarketingErrorCode.STAFF_ROLE_REQUIRED,
        "Only staff members can access this resource",
        403,
        finalRequestId
      );
    }

    // Get user details to check staff designation
    const user = await prisma.user.findUnique({
      where: { user_id: BigInt(session.userId) },
      select: {
        user_id: true,
        email: true,
        staff_designation: true,
      },
    });

    if (!user) {
      throw createStaffMarketingError(
        StaffMarketingErrorCode.STAFF_PROFILE_NOT_FOUND,
        "Staff profile not found",
        404,
        finalRequestId
      );
    }

    // Check if staff designation is Marketing
    if (!user.staff_designation || user.staff_designation !== "Marketing") {
      throw createStaffMarketingError(
        StaffMarketingErrorCode.MARKETING_DESIGNATION_REQUIRED,
        "Only staff with Marketing designation can access this resource",
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
        staffDesignation: user.staff_designation,
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

export interface StaffMarketingGuardOptions {
  rateLimitKey?: string;
}

export function withMarketingStaff<T extends { requestId: string }>(
  handler: (context: StaffMarketingContext, req: NextRequest) => Promise<NextResponse<T>>
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const requestId = getRequestId(req.headers);
    const startTime = Date.now();

    try {
      const context = await requireMarketingStaff(req, requestId);
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
          return NextResponse.json(resp, { status: (error as any).statusCode ?? 500 });
        }
      }

      // Unknown error
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

export async function checkStaffMarketingRateLimit(
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
