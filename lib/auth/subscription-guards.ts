// lib/auth/subscription-guards.ts
import { NextRequest, NextResponse } from "next/server";
import { getRequestId } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import {
  CompanyErrorCode,
  createCompanyError,
  extractCompanyErrorCode,
  toCompanyErrorResponse,
} from "@/lib/errors/company-errors";
import { resolveRequestSession } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";

export interface SubscriptionGuardContext {
  user: {
    id: number;
    userId: bigint;
    email: string;
    role: string;
    canCreateCompany: boolean;
  };
  requestId: string;
}

export async function requireSubscriptionFeature(
  req: NextRequest,
  feature: "can_create_company" | "can_upload_gallery" | "can_manage_inquiries",
  requestId?: string
): Promise<SubscriptionGuardContext> {
  const finalRequestId = requestId || getRequestId(req.headers);

  try {
    const resolved = await resolveRequestSession(req);
    const session = resolved.session;
    if (!session) {
      throw createCompanyError(
        CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
        "Authentication required",
        401,
        finalRequestId
      );
    }

    // Get user with cached flags
    const user = await prisma.user.findUnique({
      where: { user_id: BigInt(session.userId) },
      select: {
        user_id: true,
        email: true,
        role: true,
        can_create_company: true,
      },
    });

    if (!user) {
      throw createCompanyError(
        CompanyErrorCode.COMPANY_NOT_FOUND,
        "User not found",
        404,
        finalRequestId
      );
    }

    // Dev and super_admin permanently receive premium feature access
    const privilegedRole = String(user.role ?? "")
      .trim()
      .toLowerCase();
    if (privilegedRole === "dev" || privilegedRole === "super_admin") {
      return {
        user: {
          id: Number(session.userId),
          userId: BigInt(session.userId),
          email: session.email,
          role: session.role,
          canCreateCompany: true,
        },
        requestId: finalRequestId,
      };
    }

    // Check cached flag for can_create_company
    if (feature === "can_create_company" && !user.can_create_company) {
      throw createCompanyError(
        CompanyErrorCode.SUBSCRIPTION_REQUIRED,
        "Premium subscription required to create a company",
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
        canCreateCompany: user.can_create_company || false,
      },
      requestId: finalRequestId,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw createCompanyError(
      CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
      "Subscription check failed",
      500,
      finalRequestId
    );
  }
}

export function withSubscriptionFeature<T extends { requestId: string }>(
  feature: "can_create_company" | "can_upload_gallery" | "can_manage_inquiries",
  handler: (context: SubscriptionGuardContext, req: NextRequest) => Promise<NextResponse<T>>
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const requestId = getRequestId(req.headers);
    const startTime = Date.now();

    try {
      const context = await requireSubscriptionFeature(req, feature, requestId);
      return await handler(context, req);
    } catch (error) {
      const responseTime = Date.now() - startTime;

      if (error instanceof AppError) {
        const code = extractCompanyErrorCode(error);
        if (code) {
          const resp = toCompanyErrorResponse(code, error.message, requestId, error.details, responseTime);
          const statusCode = (error as unknown as { statusCode?: number }).statusCode ?? 500;
          return NextResponse.json(resp, { status: statusCode });
        }
      }

      // Unknown error
      return NextResponse.json(
        {
          success: false,
          error: {
            code: CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
            message: "Subscription verification failed",
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

export async function updateUserSubscriptionFlags(userId: bigint): Promise<void> {
  const now = new Date();
  const qualifyingBizcard = await prisma.bizcard.findFirst({
    where: {
      user_id: userId,
      deactivated_flag: false,
      subscription_status: "active",
      subscription_expires_at: { gt: now },
      subscription_tier: {
        in: ["standard", "premium", "enterprise", "Standard", "Premium", "Enterprise"],
      },
    },
    select: { bizcard_id: true },
  });

  await prisma.user.update({
    where: { user_id: userId },
    data: {
      can_create_company: !!qualifyingBizcard,
    },
  });
}