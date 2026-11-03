import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp, getUserAgent } from "@/server/lib/auth";
import { withStaffMgmtSuperAdmin } from "@/lib/auth/superadmin-middleware";
import { StaffManagementService } from "@/lib/services/staff-mgmt.service";
import { checkStaffMgmtRateLimit } from "@/lib/rate-limit/staff-mgmt-limits";
import {
  StaffMgmtErrorCode,
  createStaffMgmtError,
  toStaffMgmtErrorResponse,
} from "@/lib/errors/staff-mgmt-errors";
import { toStaffMgmtErrorNextResponse } from "@/lib/errors/staff-mgmt-http";
import { getPublicRequestOrigin } from "@/lib/utils/request-utils";

const roleSchema = z.enum(["web_developer", "sales_rep", "admin", "support_agent", "analyst"]);
const departmentSchema = z.enum(["web_dev", "sales", "admin", "support", "analytics"]);

const permissionSchema = z.object({
  can_create: z.boolean(),
  can_read: z.boolean(),
  can_update: z.boolean(),
  can_delete: z.boolean(),
});

const permissionsSchema = z.record(permissionSchema).optional().default({});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1),
  limit: z.coerce.number().int().min(1).max(100),
  role: roleSchema.optional(),
  department: departmentSchema.optional(),
  search: z.string().trim().min(1).max(255).optional(),
  presence: z.enum(["online", "offline", "recent"]).optional(),
});

const createStaffSchema = z.object({
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().min(1).max(20).optional(),
  role_key: roleSchema,
  department_key: departmentSchema,
  profile_image: z.string().trim().min(1).max(512).optional(),
  permissions: permissionsSchema,
});

function toOptionalString(value: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseListQuery(req: NextRequest, requestId: string) {
  const result = listQuerySchema.safeParse({
    page: req.nextUrl.searchParams.get("page") ?? "1",
    limit: req.nextUrl.searchParams.get("limit") ?? "20",
    role: toOptionalString(req.nextUrl.searchParams.get("role")),
    department: toOptionalString(req.nextUrl.searchParams.get("department")),
    search: toOptionalString(req.nextUrl.searchParams.get("search")),
    presence: toOptionalString(req.nextUrl.searchParams.get("presence")),
  });

  if (!result.success) {
    throw createStaffMgmtError(
      StaffMgmtErrorCode.INVALID_FILTER_TYPE,
      "Invalid staff list query parameters",
      400,
      requestId,
      { issues: result.error.issues }
    );
  }

  return result.data;
}

async function parseCreateBody(req: NextRequest, requestId: string) {
  const body = await req.json().catch(() => null);
  const result = createStaffSchema.safeParse(body);

  if (!result.success) {
    throw createStaffMgmtError(
      StaffMgmtErrorCode.INVALID_FILTER_TYPE,
      "Invalid create staff payload",
      400,
      requestId,
      { issues: result.error.issues }
    );
  }

  return result.data;
}

const getHandler = withStaffMgmtSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkStaffMgmtRateLimit(req, "LIST", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toStaffMgmtErrorResponse(
          StaffMgmtErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many staff list requests. Please try again later.",
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

    const query = parseListQuery(req, requestId);
    const service = new StaffManagementService(requestId);
    const data = await service.getStaffList({
      page: query.page,
      limit: query.limit,
      role: query.role,
      department: query.department,
      search: query.search,
      presence: query.presence,
    });

    return NextResponse.json({
      success: true,
      data,
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
      "Failed to fetch staff list"
    );
  }
});

const postHandler = withStaffMgmtSuperAdmin(async (req: NextRequest, context) => {
  const startedAt = Date.now();
  const { requestId, user } = context;

  try {
    const rateLimit = checkStaffMgmtRateLimit(req, "CREATE", String(user.id));
    if (!rateLimit.success) {
      return NextResponse.json(
        toStaffMgmtErrorResponse(
          StaffMgmtErrorCode.RATE_LIMIT_EXCEEDED,
          "Too many staff create requests. Please try again later.",
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

    const body = await parseCreateBody(req, requestId);
    const service = new StaffManagementService(requestId);
    const data = await service.createStaff(
      {
        first_name: body.first_name,
        last_name: body.last_name,
        email: body.email,
        phone: body.phone,
        role_key: body.role_key,
        department_key: body.department_key,
        profile_image: body.profile_image,
        permissions: body.permissions,
      },
      String(user.id),
      {
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
        requestOrigin: getPublicRequestOrigin(req),
      }
    );

    return NextResponse.json(
      {
        success: true,
        data,
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
      "Failed to create staff member"
    );
  }
});

export async function GET(
  req: NextRequest,
  context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }
): Promise<Response> {
  return getHandler(req, context);
}

export async function POST(
  req: NextRequest,
  context: Record<string, unknown> & { params: Promise<Record<string, string | string[]>> }
): Promise<Response> {
  return postHandler(req, context);
}
