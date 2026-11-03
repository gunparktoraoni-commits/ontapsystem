import { NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { getRequestId, jsonAppError, jsonSuccess, jsonUnknownError } from "@/lib/errors/http";
import { AppError } from "@/lib/errors/types";
import {
  actorUserIdFromSession,
  ensureCompanyPermission,
  ensureCompanyRole,
  logCompanyAudit,
  resolveCompanyActorContext,
} from "@/server/lib/company";
import { CompanyErrorCode, createCompanyError } from "@/lib/errors/company-errors";
import { uploadToR2 } from "@/server/lib/r2-storage";
import { validateUploadedFile } from "@/server/lib/media";
import {
  invalidateEmployeeProfileCaches,
  parseEmployeeIdParam,
} from "@/server/lib/company-employee-profile";

export const maxDuration = 60;

const MAX_PROFILE_UPLOAD_BYTES = Math.floor(4.5 * 1024 * 1024);

function toEmployeeId(value: string, requestId: string): bigint {
  return parseEmployeeIdParam(value, requestId);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  const requestId = getRequestId(request.headers);
  const startedAt = Date.now();
  const ip = getClientIp(request);

  try {
    const rl = checkRateLimit("company-employee-profile-photo", ip);
    if (!rl.allowed) {
      throw createCompanyError(
        CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
        "Too many requests. Please try again later.",
        429,
        requestId,
        { retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000) },
      );
    }

    const auth = await resolveRequestSession(request, { tryRefresh: true });
    if (!auth.session) {
      throw createCompanyError(
        CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
        "Authentication required.",
        401,
        requestId,
      );
    }

    const context = await resolveCompanyActorContext({
      userId: actorUserIdFromSession(auth),
      requestId,
    });
    ensureCompanyRole(context, ["admin", "manager"], requestId);
    ensureCompanyPermission(context, "manage_employees", requestId);

    const { employeeId } = await params;
    const parsedEmployeeId = toEmployeeId(employeeId, requestId);

    const employee = await prisma.companyEmployee.findFirst({
      where: {
        employee_id: parsedEmployeeId,
        company_id: context.companyId,
      },
      select: {
        employee_id: true,
        user_id: true,
        is_active: true,
      },
    });

    if (!employee) {
      throw createCompanyError(
        CompanyErrorCode.EMPLOYEE_NOT_FOUND,
        "Employee not found.",
        404,
        requestId,
      );
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      throw createCompanyError(
        CompanyErrorCode.INVALID_EMPLOYEE_DATA,
        "Invalid multipart/form-data body.",
        400,
        requestId,
      );
    }

    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      throw createCompanyError(
        CompanyErrorCode.INVALID_EMPLOYEE_DATA,
        "Missing 'file' field. Attach an image file.",
        400,
        requestId,
      );
    }

    const mimeType = file.type.toLowerCase().split(";")[0].trim();
    if (!mimeType.startsWith("image/")) {
      throw createCompanyError(
        CompanyErrorCode.INVALID_EMPLOYEE_DATA,
        "Profile photo must be an image file (JPG, PNG, or WEBP).",
        400,
        requestId,
      );
    }

    if (file.size > MAX_PROFILE_UPLOAD_BYTES) {
      throw createCompanyError(
        CompanyErrorCode.INVALID_EMPLOYEE_DATA,
        "Profile image must be 4.5 MB or smaller.",
        413,
        requestId,
        { maxBytes: MAX_PROFILE_UPLOAD_BYTES },
      );
    }

    const fileValidation = validateUploadedFile(mimeType, file.size, "image", {
      maxBytes: MAX_PROFILE_UPLOAD_BYTES,
    });
    if (!fileValidation.valid) {
      throw createCompanyError(
        CompanyErrorCode.INVALID_EMPLOYEE_DATA,
        fileValidation.error,
        fileValidation.code === "FILE_TOO_LARGE" ? 413 : 400,
        requestId,
        { code: fileValidation.code },
      );
    }

    const targetUserId = employee.user_id;
    const targetUserIdStr = targetUserId.toString();
    const buffer = Buffer.from(await file.arrayBuffer());

    let uploadResult: { key: string; url: string };
    try {
      uploadResult = await uploadToR2(buffer, mimeType, "profile", targetUserIdStr, file.name);
    } catch (uploadError) {
      console.error("[company/employees/profile-photo] R2 upload failed:", {
        requestId,
        error: uploadError,
      });
      throw createCompanyError(
        CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
        "Media upload to storage failed. Please try again.",
        500,
        requestId,
      );
    }

    const { key, url } = uploadResult;
    const now = new Date();

    try {
      const [, mediaRow] = await Promise.all([
        prisma.user.update({
          where: { user_id: targetUserId },
          data: {
            profile_url: url,
            updated_at: now,
          },
        }),
        prisma.media.create({
          data: {
            user_id: targetUserId,
            related_type: "profile",
            related_id: targetUserId,
            file_name: file.name,
            file_url: url,
            mime_type: mimeType,
            size: BigInt(buffer.length),
            storage_provider: "r2",
            metadata: JSON.stringify({
              r2_key: key,
              uploaded_by_company_admin: context.userId.toString(),
            }),
          },
          select: { media_id: true },
        }),
        prisma.bizcard.updateMany({
          where: { user_id: targetUserId },
          data: { profile_img: url, updated_at: now },
        }),
      ]);

      await invalidateEmployeeProfileCaches(targetUserId);

      await logCompanyAudit({
        companyId: context.companyId,
        userId: context.userId,
        action: "employee.profile_photo_updated",
        requestId,
        ipAddress: ip,
        details: {
          employeeId: employee.employee_id.toString(),
          employeeUserId: targetUserIdStr,
          mediaId: mediaRow.media_id.toString(),
        },
      });

      return jsonSuccess(
        {
          profile_image: url,
          employee_id: employee.employee_id.toString(),
          user_id: targetUserIdStr,
          media_id: mediaRow.media_id.toString(),
        },
        { requestId, responseTime: Date.now() - startedAt },
      );
    } catch (dbError) {
      console.error(
        "[company/employees/profile-photo] DB write failed after successful R2 upload:",
        { requestId, error: dbError },
      );
      // File is on R2; return URL so the client is not stuck, matching media/upload 207 behavior.
      return jsonSuccess(
        {
          profile_image: url,
          employee_id: employee.employee_id.toString(),
          user_id: targetUserIdStr,
          warning: "File uploaded to storage but database record could not be saved.",
          code: "DB_WRITE_FAILED",
        },
        { requestId, responseTime: Date.now() - startedAt },
        207,
      );
    }
  } catch (error) {
    if (error instanceof AppError) {
      return jsonAppError(error, Date.now() - startedAt);
    }

    console.error("[api/company/employees/[employeeId]/profile-photo POST] Unexpected error", {
      requestId,
      error,
    });
    return jsonUnknownError(requestId, Date.now() - startedAt);
  }
}
