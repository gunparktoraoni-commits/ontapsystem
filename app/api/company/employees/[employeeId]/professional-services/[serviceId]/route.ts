import { NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { CompanyErrorCode, createCompanyError } from "@/lib/errors/company-errors";
import { getClientIp } from "@/server/lib/auth";
import { validateBizcardServiceUpdateInput } from "@/server/lib/validators";
import { isOwnR2Url, uploadToR2 } from "@/server/lib/r2-storage";
import { validateUploadedFile } from "@/server/lib/media";
import { logCompanyAudit } from "@/server/lib/company";
import {
  fetchEmployeeServices,
  hasActiveEmployeeCard,
  invalidateEmployeeProfileCaches,
  parseEmployeeIdParam,
  requireManageEmployeesAuth,
  resolveCompanyEmployeeTarget,
} from "@/server/lib/company-employee-profile";

export const maxDuration = 60;

function parseServiceId(raw: string, requestId: string): bigint {
  if (!/^\d{1,20}$/.test(raw)) {
    throw createCompanyError(
      CompanyErrorCode.INVALID_EMPLOYEE_DATA,
      "Invalid service id.",
      400,
      requestId,
    );
  }
  return BigInt(raw);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ employeeId: string; serviceId: string }> },
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
    const { employeeId, serviceId: serviceIdRaw } = await params;
    const parsedEmployeeId = parseEmployeeIdParam(employeeId, authCtx.requestId);
    const serviceId = parseServiceId(serviceIdRaw, authCtx.requestId);
    const employee = await resolveCompanyEmployeeTarget({
      employeeId: parsedEmployeeId,
      companyId: authCtx.context.companyId,
      requestId: authCtx.requestId,
    });

    let body: Record<string, unknown>;
    let newFeaturedImageUrl: string | null | undefined = undefined;
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        throw createCompanyError(
          CompanyErrorCode.INVALID_EMPLOYEE_DATA,
          "Invalid multipart/form-data body.",
          400,
          authCtx.requestId,
        );
      }

      body = {};
      if (form.has("name")) body.name = form.get("name");
      if (form.has("description")) body.description = form.get("description");
      if (form.has("tagline")) body.tagline = form.get("tagline");
      if (form.has("price")) body.price = form.get("price");
      if (form.has("currency")) body.currency = form.get("currency");
      if (form.has("serviceUrl") || form.has("service_url")) {
        body.serviceUrl = form.get("serviceUrl") ?? form.get("service_url");
      }
      if (form.has("featured")) body.featured = form.get("featured") === "true";
      if (form.has("isVisible")) body.isVisible = form.get("isVisible") !== "false";
      if (form.has("isPriceNegotiable")) {
        body.isPriceNegotiable = form.get("isPriceNegotiable") === "true";
      }
      if (form.has("status")) body.status = form.get("status");

      const imageFile = form.get("featured_image");
      if (imageFile instanceof File && imageFile.size > 0) {
        const mimeType = imageFile.type.toLowerCase().trim();
        if (!mimeType.startsWith("image/")) {
          throw createCompanyError(
            CompanyErrorCode.INVALID_EMPLOYEE_DATA,
            "featured_image must be an image file (jpg, jpeg, png, webp).",
            400,
            authCtx.requestId,
          );
        }
        const fileValidation = validateUploadedFile(mimeType, imageFile.size, "image");
        if (!fileValidation.valid) {
          throw createCompanyError(
            CompanyErrorCode.INVALID_EMPLOYEE_DATA,
            fileValidation.error ?? "Invalid featured image.",
            fileValidation.code === "FILE_TOO_LARGE" ? 413 : 400,
            authCtx.requestId,
          );
        }
        const buffer = Buffer.from(await imageFile.arrayBuffer());
        const result = await uploadToR2(
          buffer,
          mimeType,
          "service",
          employee.user_id.toString(),
          `feat_${serviceId.toString()}`,
        );
        newFeaturedImageUrl = result.url;
      } else if (form.get("remove_featured_image") === "true") {
        newFeaturedImageUrl = null;
      }
    } else {
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        throw createCompanyError(
          CompanyErrorCode.INVALID_EMPLOYEE_DATA,
          "Invalid JSON body.",
          400,
          authCtx.requestId,
        );
      }

      if ("featuredImageUrl" in body || "featured_image_url" in body) {
        const rawUrl = body.featuredImageUrl ?? body.featured_image_url;
        if (rawUrl === null || rawUrl === "") {
          newFeaturedImageUrl = null;
        } else if (typeof rawUrl !== "string" || !isOwnR2Url(rawUrl) || rawUrl.length > 512) {
          throw createCompanyError(
            CompanyErrorCode.INVALID_EMPLOYEE_DATA,
            "featuredImageUrl must be a valid R2 media URL.",
            422,
            authCtx.requestId,
          );
        } else {
          newFeaturedImageUrl = rawUrl;
        }
      }
    }

    const validation = validateBizcardServiceUpdateInput(body);
    if (!validation.valid) {
      throw createCompanyError(
        CompanyErrorCode.INVALID_EMPLOYEE_DATA,
        validation.errors[0] ?? "Validation failed.",
        422,
        authCtx.requestId,
        { details: validation.errors },
      );
    }

    const existing = await prisma.service.findFirst({
      where: { service_id: serviceId, user_id: employee.user_id },
      select: { service_id: true, name: true },
    });
    if (!existing) {
      throw createCompanyError(
        CompanyErrorCode.EMPLOYEE_NOT_FOUND,
        "Service not found.",
        404,
        authCtx.requestId,
      );
    }

    const patch = validation.data;

    if (patch.name) {
      const duplicate = await prisma.service.findFirst({
        where: {
          user_id: employee.user_id,
          name: patch.name,
          service_id: { not: serviceId },
        },
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
    }

    const activeCard = await hasActiveEmployeeCard(employee.user_id);
    if (activeCard && (patch.isVisible === false || patch.status === "archived")) {
      throw createCompanyError(
        CompanyErrorCode.INVALID_EMPLOYEE_DATA,
        "Cannot archive/hide this service while an active BizCard is linked to the employee profile.",
        409,
        authCtx.requestId,
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.service.update({
        where: { service_id: serviceId },
        data: {
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.description !== undefined && { description: patch.description }),
          ...(patch.tagline !== undefined && { tagline: patch.tagline }),
          ...(patch.price !== undefined && { price: patch.price }),
          ...(patch.currency !== undefined && { currency_code: patch.currency }),
          ...(patch.serviceUrl !== undefined && { service_url: patch.serviceUrl }),
          ...(patch.featured !== undefined && { featured: patch.featured }),
          ...(patch.isVisible !== undefined && { is_visible: patch.isVisible }),
          ...(patch.isPriceNegotiable !== undefined && {
            is_price_negotiable: patch.isPriceNegotiable,
          }),
          ...(patch.status !== undefined && { status: patch.status }),
          ...(newFeaturedImageUrl !== undefined && { featured_image: newFeaturedImageUrl }),
          updated_at: new Date(),
        },
      });

      if (patch.media !== undefined) {
        await tx.serviceMedia.deleteMany({ where: { service_id: serviceId } });
        if (patch.media.length > 0) {
          await tx.serviceMedia.createMany({
            data: patch.media.map((media, index) => ({
              user_id: employee.user_id,
              service_id: serviceId,
              file_name: media.fileName ?? `service-media-${index + 1}`,
              file_url: media.url,
              mime_type: media.mimeType,
              size: media.bytes !== null ? BigInt(media.bytes) : null,
              storage_provider: "r2",
              display_order: media.displayOrder ?? index,
            })),
          });
        }
      }
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
        added: [],
        updated: [serviceId.toString()],
        removed: [],
      },
    });

    const services = await fetchEmployeeServices(employee.user_id);

    return jsonSuccess(
      {
        success: true,
        service_id: serviceId.toString(),
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
    console.error("[api/company/employees/professional-services/[serviceId] PUT] Unexpected error", {
      requestId,
      error,
    });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ employeeId: string; serviceId: string }> },
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
    const { employeeId, serviceId: serviceIdRaw } = await params;
    const parsedEmployeeId = parseEmployeeIdParam(employeeId, authCtx.requestId);
    const serviceId = parseServiceId(serviceIdRaw, authCtx.requestId);
    const employee = await resolveCompanyEmployeeTarget({
      employeeId: parsedEmployeeId,
      companyId: authCtx.context.companyId,
      requestId: authCtx.requestId,
    });

    const existing = await prisma.service.findFirst({
      where: { service_id: serviceId, user_id: employee.user_id },
      select: { service_id: true },
    });
    if (!existing) {
      throw createCompanyError(
        CompanyErrorCode.EMPLOYEE_NOT_FOUND,
        "Service not found.",
        404,
        authCtx.requestId,
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.serviceMedia.deleteMany({ where: { service_id: serviceId } });
      await tx.service.delete({ where: { service_id: serviceId } });
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
        added: [],
        updated: [],
        removed: [serviceId.toString()],
      },
    });

    const services = await fetchEmployeeServices(employee.user_id);

    return jsonSuccess(
      {
        success: true,
        service_id: serviceId.toString(),
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
    console.error(
      "[api/company/employees/professional-services/[serviceId] DELETE] Unexpected error",
      { requestId, error },
    );
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
