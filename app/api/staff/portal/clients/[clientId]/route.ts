import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withStaffPortal, checkStaffPortalRateLimit } from "@/lib/auth/staff-portal-middleware";
import { StaffMarketingErrorCode, createStaffMarketingError } from "@/lib/errors/staff-marketing-errors";
import { StaffMarketingService } from "@/lib/services/staff-marketing.service";

type RouteParams = {
  params: Promise<{ clientId: string }>;
};

function parseClientId(raw: string, requestId: string): bigint {
  if (!/^[0-9]+$/.test(raw)) {
    throw createStaffMarketingError(
      StaffMarketingErrorCode.INVALID_FILTER_TYPE,
      "Invalid client id path parameter",
      400,
      requestId,
      { clientId: raw }
    );
  }

  const parsed = BigInt(raw);
  if (parsed <= BigInt(0)) {
    throw createStaffMarketingError(
      StaffMarketingErrorCode.INVALID_FILTER_TYPE,
      "Invalid client id path parameter",
      400,
      requestId,
      { clientId: raw }
    );
  }

  return parsed;
}

const updateSchema = z.object({
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  company_id: z.string().regex(/^[0-9]+$/).transform((value) => BigInt(value)).nullable().optional(),
  is_active: z.boolean().optional(),
}).refine((data) => Object.keys(data).some((key) => data[key as keyof typeof data] !== undefined), {
  message: "No valid update fields were provided",
});

export async function PUT(req: NextRequest, { params }: RouteParams) {
  return withStaffPortal(async (context, request) => {
    const startTime = Date.now();
    await checkStaffPortalRateLimit("staff-marketing-client-update", request, context.requestId);

    const { clientId } = await params;
    const parsedClientId = parseClientId(clientId, context.requestId);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw createStaffMarketingError(
        StaffMarketingErrorCode.INVALID_FILTER_TYPE,
        "Invalid JSON body",
        400,
        context.requestId,
      );
    }

    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      throw createStaffMarketingError(
        StaffMarketingErrorCode.INVALID_FILTER_TYPE,
        "Invalid request body",
        400,
        context.requestId,
        parsed.error.flatten(),
      );
    }

    const service = new StaffMarketingService(context.staffId, context.requestId);
    const updatedClient = await service.updateAssignedClient(parsedClientId, parsed.data);

    return NextResponse.json({
      success: true,
      requestId: context.requestId,
      data: updatedClient,
      meta: {
        requestId: context.requestId,
        responseTime: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      },
    });
  })(req);
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  return withStaffPortal(async (context, request) => {
    const startTime = Date.now();
    await checkStaffPortalRateLimit("staff-marketing-client-unassign", request, context.requestId);

    const { clientId } = await params;
    const parsedClientId = parseClientId(clientId, context.requestId);

    const service = new StaffMarketingService(context.staffId, context.requestId);
    await service.unassignClient(parsedClientId);

    return NextResponse.json({
      success: true,
      requestId: context.requestId,
      message: "Client unassigned successfully",
      meta: {
        requestId: context.requestId,
        responseTime: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      },
    });
  })(req);
}
