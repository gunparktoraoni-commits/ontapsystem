import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRequestId } from "@/lib/errors/http";
import {
  withStaffPortal,
  checkStaffPortalRateLimit,
} from "@/lib/auth/staff-portal-middleware";
import { supportErrorResponse } from "@/lib/api/support-route-utils";
import {
  SupportMessagingErrorCode,
  createSupportMessagingError,
} from "@/lib/errors/support-messaging-errors";
import { prisma } from "@/server/lib/prisma";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const MAX_RESULTS_PER_TYPE = 10; // 10 users + 10 companies = 20 max

// ─────────────────────────────────────────────────────────────
// Input validation
// ─────────────────────────────────────────────────────────────

const querySchema = z.object({
  q: z
    .string()
    .trim()
    .min(1, "Search query must not be empty")
    .max(100, "Search query too long"),
});

// ─────────────────────────────────────────────────────────────
// Response types
// ─────────────────────────────────────────────────────────────

export type StaffSearchUserResult = {
  type: "user";
  id: string;
  name: string;
  email: string;
  role: string;
  companyName: string | null;
  profileUrl: string | null;
  /** Existing conversation ID if one already exists with this user, else null */
  conversationId: string | null;
};

export type StaffSearchCompanyResult = {
  type: "company";
  id: string;
  name: string;
  email: string | null;
  status: string;
  userCount: number;
  adminId: string | null;
  adminName: string | null;
};

export type StaffSearchResults = {
  users: StaffSearchUserResult[];
  companies: StaffSearchCompanyResult[];
  query: string;
};

// ─────────────────────────────────────────────────────────────
// GET /api/staff/support/search?q=<term>
// ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  return withStaffPortal(async (context, request) => {
    const requestId = context.requestId || getRequestId(request.headers);

    try {
      await checkStaffPortalRateLimit(
        "staff-portal-support-search",
        request,
        requestId,
      );

      // ── 1. Validate query param ──────────────────────────────
      const raw = request.nextUrl.searchParams.get("q") ?? "";
      const parsed = querySchema.safeParse({ q: raw });

      if (!parsed.success) {
        throw createSupportMessagingError(
          SupportMessagingErrorCode.INVALID_PAYLOAD,
          parsed.error.errors[0]?.message ?? "Invalid search query",
          400,
        );
      }

      const { q } = parsed.data;

      // ── 2. Run user and company searches in parallel ─────────
      const [users, companies] = await Promise.all([
        searchUsers(q),
        searchCompanies(q),
      ]);

      // ── 3. For matched users, resolve existing conversation IDs
      const userIds = users.map((u) => u.user_id);
      const existingConversations =
        userIds.length > 0
          ? await prisma.supportConversation.findMany({
              where: { client_user_id: { in: userIds } },
              select: {
                conversation_id: true,
                client_user_id: true,
              },
            })
          : [];

      const convMap = new Map(
        existingConversations.map((c) => [
          c.client_user_id.toString(),
          c.conversation_id.toString(),
        ]),
      );

      // ── 4. Serialize results ─────────────────────────────────
      const userResults: StaffSearchUserResult[] = users.map((u) => {
        const fullName =
          `${u.first_name} ${u.last_name}`.trim() || u.email;
        return {
          type: "user",
          id: u.user_id.toString(),
          name: fullName,
          email: u.email,
          role: u.role,
          companyName: u.company?.name ?? null,
          profileUrl: u.profile_url ?? null,
          conversationId: convMap.get(u.user_id.toString()) ?? null,
        };
      });

      const companyResults: StaffSearchCompanyResult[] = companies.map((c) => {
        const adminName = c.admin
          ? `${c.admin.first_name} ${c.admin.last_name}`.trim() ||
            c.admin.email
          : null;
        return {
          type: "company",
          id: c.company_id.toString(),
          name: c.name,
          email: c.email ?? null,
          status: c.status,
          userCount: c._count.users,
          adminId: c.admin_id?.toString() ?? null,
          adminName,
        };
      });

      const data: StaffSearchResults = {
        users: userResults,
        companies: companyResults,
        query: q,
      };

      return NextResponse.json({ success: true, data, requestId });
    } catch (error) {
      return supportErrorResponse(error, requestId);
    }
  })(req);
}

// ─────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────

async function searchUsers(q: string) {
  return prisma.user.findMany({
    where: {
      is_active: true,
      // Exclude staff/dev/super_admin roles — they are operators, not clients;
      // however per requirement we must include ALL roles so staff can find anyone.
      // No role exclusion applied per specification.
      OR: [
        { first_name: { contains: q } },
        { last_name: { contains: q } },
        { email: { contains: q } },
      ],
    },
    select: {
      user_id: true,
      first_name: true,
      last_name: true,
      email: true,
      role: true,
      profile_url: true,
      company: {
        select: { name: true },
      },
    },
    orderBy: [{ first_name: "asc" }, { last_name: "asc" }],
    take: MAX_RESULTS_PER_TYPE,
  });
}

async function searchCompanies(q: string) {
  return prisma.company.findMany({
    where: {
      name: { contains: q },
    },
    select: {
      company_id: true,
      name: true,
      email: true,
      status: true,
      admin_id: true,
      admin: {
        select: {
          first_name: true,
          last_name: true,
          email: true,
        },
      },
      _count: {
        select: { users: true },
      },
    },
    orderBy: { name: "asc" },
    take: MAX_RESULTS_PER_TYPE,
  });
}
