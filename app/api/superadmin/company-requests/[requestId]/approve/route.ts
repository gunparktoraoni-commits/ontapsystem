import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withSuperAdmin, SuperAdminContext } from "@/lib/auth/superadmin-middleware";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { prisma } from "@/server/lib/prisma";
import {
  CompanyErrorCode,
  createCompanyError,
} from "@/lib/errors/company-errors";
import { notifySuperadminsCompanyDecision } from "@/lib/services/superadmin-notifications.service";

const ApprovalBodySchema = z.object({
  action: z.enum(["approve", "reject"]),
  rejection_reason: z.string().optional(),
});

function generateSecurityCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function ensureUniqueSlug(baseSlug: string, attempt = 1): Promise<string> {
  const slug = attempt === 1 ? baseSlug : `${baseSlug}-${attempt}`;
  const existing = await prisma.company.findFirst({
    where: { company_slug: slug },
  });
  if (existing) {
    return ensureUniqueSlug(baseSlug, attempt + 1);
  }
  return slug;
}

async function handler(req: NextRequest,
  context: SuperAdminContext & { params: Promise<{ requestId: string }> }) {
  const startTime = Date.now();
  const { requestId: pathRequestId } = await context.params;

  // For POST approval request
  if (req.method === "POST") {
    try {
      // Check rate limit
      const ip = req.headers.get("x-forwarded-for") || "unknown";
      const rateLimit = checkRateLimit("company-approve", ip);
      if (!rateLimit.allowed) {
        throw createCompanyError(
          CompanyErrorCode.RATE_LIMIT_EXCEEDED,
          "Company approval rate limit exceeded",
          429,
          context.requestId,
          { retryAfterMs: rateLimit.retryAfterMs }
        );
      }

      // Parse request body
      const body = await req.json();
      const { action, rejection_reason } = ApprovalBodySchema.parse(body);

      // Get the company (find by status=pending and created_by)
      const company = await prisma.company.findUnique({
        where: { company_id: BigInt(pathRequestId) },
        select: {
          company_id: true,
          name: true,
          status: true,
          created_by: true,
          created_at: true,
        },
      });

      if (!company) {
        throw createCompanyError(
          CompanyErrorCode.COMPANY_NOT_FOUND,
          "Company request not found",
          404,
          context.requestId
        );
      }

      if (company.status !== "pending") {
        throw createCompanyError(
          CompanyErrorCode.COMPANY_ALREADY_EXISTS,
          "This company request has already been processed",
          409,
          context.requestId,
          { currentStatus: company.status }
        );
      }

      if (action === "approve") {
        // Atomic transaction: generate security code, update company, create employee, update user
        const updatedCompany = await prisma.$transaction(async (tx) => {
          const securityCode = generateSecurityCode();

          // Update company to active with security code
          const updated = await tx.company.update({
            where: { company_id: company.company_id },
            data: {
              status: "active",
              security_code: securityCode,
              approval_required: false,
              approved_by: context.user.userId,
              approved_at: new Date(),
            },
          });

          // Add creator as company admin (if created_by exists and not already an employee)
          if (company.created_by) {
            const existingEmployee = await tx.companyEmployee.findFirst({
              where: {
                company_id: company.company_id,
                user_id: company.created_by,
              },
            });

            if (!existingEmployee) {
              await tx.companyEmployee.create({
                data: {
                  company_id: company.company_id,
                  user_id: company.created_by,
                  role: "admin",
                  is_active: true,
                  joined_at: new Date(),
                },
              });
            }

            // Update user: set company_id and role to admin
            await tx.user.update({
              where: { user_id: company.created_by },
              data: {
                company_id: company.company_id,
                role: "admin",
              },
            });
          }

          // Log audit
          await tx.companyAuditLog.create({
            data: {
              company_id: company.company_id,
              user_id: context.user.userId,
              action: "company_created_approved",
              details: JSON.stringify({
                approver_email: context.user.email,
              }),
              ip_address: req.headers.get("x-forwarded-for") || "unknown",
            },
          });

          return updated;
        });

        const responseTime = Date.now() - startTime;

        // ── Notify all superadmins of the approval decision (non-blocking) ──
        void notifySuperadminsCompanyDecision({
          companyId: company.company_id.toString(),
          companyName: company.name,
          action: "approve",
          superadminId: context.user.id,
        });

        return NextResponse.json(
          {
            success: true,
            data: {
              company_id: updatedCompany.company_id.toString(),
              company_name: updatedCompany.name,
              security_code: updatedCompany.security_code,
              message: "Company created and approved successfully",
            },
            meta: {
              requestId: context.requestId,
              responseTime,
              timestamp: new Date().toISOString(),
            },
          },
          { status: 200 }
        );
      }

      // Rejection path
      await prisma.company.update({
        where: { company_id: company.company_id },
        data: {
          status: "rejected",
          rejection_reason,
        },
      });

      // Log audit
      await prisma.companyAuditLog.create({
        data: {
          company_id: company.company_id,
          user_id: context.user.userId,
          action: "company_creation_rejected",
          details: JSON.stringify({
            company_name: company.name,
            reason: rejection_reason,
          }),
          ip_address: req.headers.get("x-forwarded-for") || "unknown",
        },
      });

      const responseTimeReject = Date.now() - startTime;

      // ── Notify all superadmins of the rejection decision (non-blocking) ──
      void notifySuperadminsCompanyDecision({
        companyId: company.company_id.toString(),
        companyName: company.name,
        action: "reject",
        superadminId: context.user.id,
      });

      return NextResponse.json(
        {
          success: true,
          data: {
            message: "Company creation request rejected",
          },
          meta: {
            requestId: context.requestId,
            responseTime: responseTimeReject,
            timestamp: new Date().toISOString(),
          },
        },
        { status: 200 }
      );
    } catch (error) {
      const responseTime = Date.now() - startTime;
      throw error;
    }
  }

  // GET not implemented for this endpoint
  throw createCompanyError(
    CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
    "Method not allowed",
    405,
    context.requestId
  );
}

export const POST = withSuperAdmin(handler, { errorMode: "superadmin" });
