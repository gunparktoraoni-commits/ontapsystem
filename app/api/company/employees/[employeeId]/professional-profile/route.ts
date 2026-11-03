import { NextRequest } from "next/server";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import { CompanyErrorCode, createCompanyError } from "@/lib/errors/company-errors";
import { getClientIp } from "@/server/lib/auth";
import {
  fetchProfessionalDetails,
  parseEmployeeIdParam,
  requireManageEmployeesAuth,
  resolveCompanyEmployeeTarget,
  updateProfessionalDetails,
  validateProfessionalDetailsInput,
  type ProfessionalDetailsUpdateInput,
} from "@/server/lib/company-employee-profile";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rl = checkRateLimit("company-employee-professional-profile", ip);
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

    const profile = await fetchProfessionalDetails(employee.user_id, authCtx.requestId);

    return jsonSuccess(
      {
        employee_id: employee.employee_id.toString(),
        user_id: employee.user_id.toString(),
        profile,
      },
      { requestId: authCtx.requestId, responseTime: Date.now() - authCtx.startedAt },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }
    console.error("[api/company/employees/professional-profile GET] Unexpected error", {
      requestId,
      error,
    });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rl = checkRateLimit("company-employee-professional-profile-update", ip);
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

    let body: Record<string, unknown>;
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

    const input: ProfessionalDetailsUpdateInput = {};
    if ("firstName" in body) input.firstName = String(body.firstName ?? "");
    if ("lastName" in body) input.lastName = String(body.lastName ?? "");
    if ("suffix" in body) input.suffix = String(body.suffix ?? "N/A");
    if ("occupation" in body) input.occupation = String(body.occupation ?? "");
    if ("about" in body) input.about = String(body.about ?? "");
    if ("bizCardName" in body) input.bizCardName = String(body.bizCardName ?? "");
    if ("description" in body) input.description = String(body.description ?? "");
    if ("contactEmail" in body) {
      input.contactEmail =
        body.contactEmail === null || body.contactEmail === ""
          ? null
          : String(body.contactEmail);
    }
    if ("alternativeEmail" in body) {
      input.alternativeEmail =
        body.alternativeEmail === null || body.alternativeEmail === ""
          ? null
          : String(body.alternativeEmail);
    }
    if ("contactNumber" in body) {
      input.contactNumber =
        body.contactNumber === null || body.contactNumber === ""
          ? null
          : String(body.contactNumber);
    }
    if ("secondaryNumber" in body) {
      input.secondaryNumber =
        body.secondaryNumber === null || body.secondaryNumber === ""
          ? null
          : String(body.secondaryNumber);
    }
    if ("telephoneNumber" in body) {
      input.telephoneNumber =
        body.telephoneNumber === null || body.telephoneNumber === ""
          ? null
          : String(body.telephoneNumber);
    }
    if ("altTelephoneNumber" in body) {
      input.altTelephoneNumber =
        body.altTelephoneNumber === null || body.altTelephoneNumber === ""
          ? null
          : String(body.altTelephoneNumber);
    }
    if ("address" in body) {
      if (body.address === null) {
        input.address = null;
      } else if (body.address && typeof body.address === "object" && !Array.isArray(body.address)) {
        const raw = body.address as Record<string, unknown>;
        input.address = {
          area: raw.area == null ? null : String(raw.area),
          brgy: raw.brgy == null ? null : String(raw.brgy),
          city: raw.city == null ? null : String(raw.city),
          region: raw.region == null ? null : String(raw.region),
          zipcode: raw.zipcode == null ? null : String(raw.zipcode),
          plusCode: raw.plusCode == null ? null : String(raw.plusCode),
          mapLink: raw.mapLink == null ? null : String(raw.mapLink),
          landmark: raw.landmark == null ? null : String(raw.landmark),
          latitude:
            raw.latitude === null || raw.latitude === undefined || raw.latitude === ""
              ? null
              : Number.isFinite(Number(raw.latitude))
                ? Number(raw.latitude)
                : null,
          longitude:
            raw.longitude === null || raw.longitude === undefined || raw.longitude === ""
              ? null
              : Number.isFinite(Number(raw.longitude))
                ? Number(raw.longitude)
                : null,
        };
      }
    }

    const detailValidation = validateProfessionalDetailsInput(input);
    if (!detailValidation.valid) {
      throw createCompanyError(
        CompanyErrorCode.INVALID_EMPLOYEE_DATA,
        `Missing required employee details: ${detailValidation.missingFields.join(", ")}.`,
        422,
        authCtx.requestId,
        { missingFields: detailValidation.missingFields },
      );
    }

    const result = await updateProfessionalDetails({
      userId: employee.user_id,
      employeeId: employee.employee_id,
      companyId: authCtx.context.companyId,
      actorUserId: authCtx.context.userId,
      input,
      requestId: authCtx.requestId,
      ip: authCtx.ip,
    });

    const profile = await fetchProfessionalDetails(employee.user_id, authCtx.requestId);

    return jsonSuccess(
      {
        success: true,
        changedFields: result.changedFields,
        employee_id: employee.employee_id.toString(),
        user_id: employee.user_id.toString(),
        profile,
      },
      { requestId: authCtx.requestId, responseTime: Date.now() - authCtx.startedAt },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }
    console.error("[api/company/employees/professional-profile PUT] Unexpected error", {
      requestId,
      error,
    });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
