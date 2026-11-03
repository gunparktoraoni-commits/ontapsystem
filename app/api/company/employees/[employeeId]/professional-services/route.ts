import { NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { CompanyErrorCode, createCompanyError } from "@/lib/errors/company-errors";
import { getClientIp } from "@/server/lib/auth";
import { validateBizcardServiceCreateInput } from "@/server/lib/validators";
import { isOwnR2Url, uploadToR2 } from "@/server/lib/r2-storage";
import { validateUploadedFile } from "@/server/lib/media";
import { logCompanyAudit } from "@/server/lib/company";
import {
  fetchEmployeeServices,
  invalidateEmployeeProfileCaches,
  parseEmployeeIdParam,
  requireManageEmployeesAuth,
  resolveCompanyEmployeeTarget,
} from "@/server/lib/company-employee-profile";

export const maxDuration = 60;

async function parseServiceCreateBody(
  request: NextRequest,
  employeeUserId: bigint,
  requestId: string,
): Promise<{ body: Record<string, unknown>; featuredImageUrl: string | null }> {
  const contentType = request.headers.get("content-type") ?? "";
  let featuredImageUrl: string | null = null;

  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw createCompanyError(
        CompanyErrorCode.INVALID_EMPLOYEE_DATA,
        "Invalid multipart/form-data body.",
        400,
        requestId,
      );
    }

    const body: Record<string, unknown> = {
      name: form.get("name"),
      description: form.get("description") ?? "",
      tagline: form.get("tagline"),
      price: form.get("price"),
      currency: form.get("currency"),
      serviceUrl: form.get("serviceUrl") ?? form.get("service_url"),
      status: form.get("status") ?? "active",
      featured: form.get("featured") === "true",
      isVisible: form.get("isVisible") !== "false",
      isPriceNegotiable: form.get("isPriceNegotiable") === "true",
    };

    const imageFile = form.get("featured_image");
    if (imageFile instanceof File && imageFile.size > 0) {
      const mimeType = imageFile.type.toLowerCase().trim();
      if (!mimeType.startsWith("image/")) {
        throw createCompanyError(
          CompanyErrorCode.INVALID_EMPLOYEE_DATA,
          "featured_image must be an image file (jpg, jpeg, png, webp).",
          400,
          requestId,
        );
      }
      const fileValidation = validateUploadedFile(mimeType, imageFile.size, "image");
      if (!fileValidation.valid) {
        throw createCompanyError(
          CompanyErrorCode.INVALID_EMPLOYEE_DATA,
          fileValidation.error ?? "Invalid featured image.",
          fileValidation.code === "FILE_TOO_LARGE" ? 413 : 400,
          requestId,
        );
      }
      const buffer = Buffer.from(await imageFile.arrayBuffer());
      const result = await uploadToR2(
        buffer,
        mimeType,
        "service",
        employeeUserId.toString(),
        `feat_${employeeUserId.toString()}_${Date.now()}`,
      );
      featuredImageUrl = result.url;
    }

    return { body, featuredImageUrl };
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    throw createCompanyError(
      CompanyErrorCode.INVALID_EMPLOYEE_DATA,
      "Invalid JSON body.",
      400,
      requestId,
    );
  }

  const rawUrl = body.featuredImageUrl ?? body.featured_image_url;
  if (rawUrl !== null && rawUrl !== undefined && rawUrl !== "") {
    if (typeof rawUrl !== "string" || !isOwnR2Url(rawUrl) || rawUrl.length > 512) {
      throw createCompanyError(
        CompanyErrorCode.INVALID_EMPLOYEE_DATA,
        "featuredImageUrl must be a valid R2 media URL.",
        422,
        requestId,
      );
    }
    featuredImageUrl = rawUrl;
  }

  return { body, featuredImageUrl };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rl = checkRateLimit("company-employee-professional-services", ip);
    if (!rl.allowed) {
      throw createCompanyError(
        CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
        "Too many requests. Please try again later.",
        429,
        requestId,
        { retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000) },
      );
    }

    const authCtx = await requireManageEmployeesAuth(request);
    const { employeeId } = await params;
    const parsedEmployeeId = parseEmployeeIdParam(employeeId, authCtx.requestId);
    const employee = await resolveCompanyEmployeeTarget({
      employeeId: parsedEmployeeId,
      companyId: authCtx.context.companyId,
      requestId: authCtx.requestId,
    });

    const services = await fetchEmployeeServices(employee.user_id);

    return jsonSuccess(
      {
        employee_id: employee.employee_id.toString(),
        user_id: employee.user_id.toString(),
        services,
      },
      { requestId: authCtx.requestId, responseTime: Date.now() - authCtx.startedAt },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }
    console.error("[api/company/employees/professional-services GET] Unexpected error", {
      requestId,
      error,
    });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rl = checkRateLimit("company-employee-professional-services-mutate", ip);
    if (!rl.allowed) {
      throw createCompanyError(
        CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
        "Too many requests. Please try again later.",
        429,
        requestId,
        { retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000) },
      );
    }

    const authCtx = await requireManageEmployeesAuth(request);
    const { employeeId } = await params;
    const parsedEmployeeId = parseEmployeeIdParam(employeeId, authCtx.requestId);
    const employee = await resolveCompanyEmployeeTarget({
      employeeId: parsedEmployeeId,
      companyId: authCtx.context.companyId,
      requestId: authCtx.requestId,
    });

    const parsed = await parseServiceCreateBody(
      request,
      employee.user_id,
      authCtx.requestId,
    );
    const { body, featuredImageUrl } = parsed;

    const validation = validateBizcardServiceCreateInput(body);
    if (!validation.valid) {
      throw createCompanyError(
        CompanyErrorCode.INVALID_EMPLOYEE_DATA,
        validation.errors[0] ?? "Validation failed.",
        422,
        authCtx.requestId,
        { details: validation.errors },
      );
    }

    const data = validation.data;

    const duplicate = await prisma.service.findFirst({
      where: { user_id: employee.user_id, name: data.name },
      select: { service_id: true },
    });
    if (duplicate) {
      throw createCompanyError(
        CompanyErrorCode.INVALID_EMPLOYEE_DATA,
        "A service with this name already exists for this employee.",
        409,
        authCtx.requestId,
      );
    }

    const created = await prisma.$transaction(async (tx) => {
      const createdService = await tx.service.create({
        data: {
          user_id: employee.user_id,
          name: data.name,
          description: data.description,
          tagline: data.tagline,
          price: data.price,
          currency_code: data.currency,
          is_price_negotiable: data.isPriceNegotiable,
          featured: data.featured,
          status: data.status,
          service_url: data.serviceUrl,
          is_visible: data.isVisible,
          ...(featuredImageUrl !== null && { featured_image: featuredImageUrl }),
        },
      });

      if (data.media.length > 0) {
        await tx.serviceMedia.createMany({
          data: data.media.map((media, index) => ({
            user_id: employee.user_id,
            service_id: createdService.service_id,
            file_name: media.fileName ?? `service-media-${index + 1}`,
            file_url: media.url,
            mime_type: media.mimeType,
            size: media.bytes !== null ? BigInt(media.bytes) : null,
            storage_provider: "r2",
            display_order: media.displayOrder ?? index,
          })),
        });
      }

      return createdService;
    });

    await invalidateEmployeeProfileCaches(employee.user_id);
    await logCompanyAudit({
      companyId: authCtx.context.companyId,
      userId: authCtx.context.userId,
      action: "employee.services_updated",
      requestId: authCtx.requestId,
      ipAddress: authCtx.ip,
      details: {
        employeeId: employee.employee_id.toString(),
        employeeUserId: employee.user_id.toString(),
        added: [created.service_id.toString()],
        updated: [],
        removed: [],
      },
    });

    const services = await fetchEmployeeServices(employee.user_id);

    return jsonSuccess(
      {
        success: true,
        service_id: created.service_id.toString(),
        employee_id: employee.employee_id.toString(),
        user_id: employee.user_id.toString(),
        services,
      },
      { requestId: authCtx.requestId, responseTime: Date.now() - authCtx.startedAt },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }
    console.error("[api/company/employees/professional-services POST] Unexpected error", {
      requestId,
      error,
    });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
