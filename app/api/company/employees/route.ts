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
	resolveCompanyActorContext,
} from "@/server/lib/company";
import { CompanyErrorCode, createCompanyError } from "@/lib/errors/company-errors";
import { listPendingInvitations } from "@/lib/services/company-employee-invite.service";
import {
	CompanyDashboardService,
	resolveUserProfileImages,
} from "@/lib/services/company-dashboard.service";
import { getDateRange } from "@/lib/utils/date-range";

function parsePositiveInt(value: string | null, fallback: number, min: number, max: number): number {
	const parsed = Number.parseInt(value ?? "", 10);
	if (!Number.isInteger(parsed)) return fallback;
	return Math.min(max, Math.max(min, parsed));
}

function mapInviteToEmployeeRow(invite: {
	invitation_id: string;
	email: string;
	role: string;
	user_id: string | null;
	name: string;
	invited_at: Date;
	is_expired: boolean;
}) {
	return {
		employee_id: `invite_${invite.invitation_id}`,
		invitation_id: invite.invitation_id,
		user_id: invite.user_id,
		name: invite.name,
		email: invite.email,
		profile_image: null,
		role: invite.role,
		is_active: false,
		membership_status: "pending_invite",
		invitation_expired: invite.is_expired,
		joined_at: invite.invited_at,
		restricted_at: null,
		restricted_reason: null,
		last_active: null,
		bizcard_count: 0,
		summary: null,
	};
}

export async function GET(request: NextRequest) {
	const requestId = getRequestId(request.headers);
	const startedAt = Date.now();
	const ip = getClientIp(request);

	try {
		const rl = checkRateLimit("company-employees-list", ip);
		if (!rl.allowed) {
			throw createCompanyError(
				CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION,
				"Too many requests. Please try again later.",
				429,
				requestId,
				{ retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000) }
			);
		}

		const auth = await resolveRequestSession(request, { tryRefresh: true });
		if (!auth.session) {
			throw createCompanyError(CompanyErrorCode.UNAUTHORIZED_COMPANY_ACTION, "Authentication required.", 401, requestId);
		}

		const context = await resolveCompanyActorContext({
			userId: actorUserIdFromSession(auth),
			requestId,
		});
		ensureCompanyRole(context, ["admin", "manager"], requestId);
		ensureCompanyPermission(context, "manage_employees", requestId);

		const params = request.nextUrl.searchParams;
		const page = parsePositiveInt(params.get("page"), 1, 1, 10000);
		const limit = parsePositiveInt(params.get("limit"), 20, 1, 100);
		const search = (params.get("search") ?? "").trim();
		const role = (params.get("role") ?? "").trim().toLowerCase();
		const status = (params.get("status") ?? "all").trim().toLowerCase();
		const includePending = status === "all" || status === "pending_invite";

		const where: Record<string, unknown> = {
			company_id: context.companyId,
			...(role ? { role } : {}),
			...(status === "active" ? { is_active: true } : {}),
			...(status === "restricted" ? { is_active: false } : {}),
			...(search
				? {
						user: {
							OR: [
								{ first_name: { contains: search, mode: "insensitive" } },
								{ last_name: { contains: search, mode: "insensitive" } },
								{ email: { contains: search, mode: "insensitive" } },
							],
						},
					}
				: {}),
		};

		const pendingInvites = includePending
			? (await listPendingInvitations(context.companyId, search)).filter((invite) =>
					role ? invite.role.toLowerCase() === role : true,
				)
			: [];

		if (status === "pending_invite") {
			const skip = (page - 1) * limit;
			const slice = pendingInvites.slice(skip, skip + limit);
			return jsonSuccess(
				{
					employees: slice.map((invite) => mapInviteToEmployeeRow(invite)),
					pagination: {
						page,
						limit,
						total: pendingInvites.length,
						pages: Math.max(1, Math.ceil(pendingInvites.length / limit)),
					},
				},
				{ requestId, responseTime: Date.now() - startedAt },
			);
		}

		const skip = (page - 1) * limit;
		const pendingCount = includePending ? pendingInvites.length : 0;

		let employeeSkip = skip;
		let employeeTake = limit;

		if (includePending && page === 1) {
			employeeTake = Math.max(0, limit - pendingCount);
			employeeSkip = 0;
		} else if (includePending && page > 1) {
			employeeSkip = skip - pendingCount;
			employeeTake = limit;
		}

		const [rows, employeeTotal] = await Promise.all([
			prisma.companyEmployee.findMany({
				where,
				include: {
					user: {
						select: {
							user_id: true,
							first_name: true,
							last_name: true,
							email: true,
							profile_url: true,
							userActivity: {
								select: {
									last_active: true,
								},
							},
						},
					},
					activitySummaries: {
						where: { period: "monthly" },
						orderBy: { calculated_at: "desc" },
						take: 1,
					},
				},
				orderBy: [{ role: "asc" }, { joined_at: "desc" }],
				skip: Math.max(0, employeeSkip),
				take: Math.max(0, employeeTake),
			}),
			prisma.companyEmployee.count({ where }),
		]);

		const userIds = rows.map((row) => row.user.user_id);
		const monthRange = getDateRange("this_month");
		const dashboardService = new CompanyDashboardService(context.companyId, requestId);
		const [bizcardCountRows, profileImages, activityByUser] = await Promise.all([
			// Count by employee user_id (not company_id) so Cards reflects every
			// active BizCard the employee owns — including cards whose company_id
			// was never backfilled after create/merge.
			userIds.length > 0
				? prisma.bizcard.groupBy({
						by: ["user_id"],
						where: {
							user_id: { in: userIds },
							deactivated_flag: false,
						},
						_count: { bizcard_id: true },
					})
				: Promise.resolve([] as Array<{ user_id: bigint | null; _count: { bizcard_id: number } }>),
			resolveUserProfileImages(userIds),
			dashboardService.getActivityMetricsByUser(userIds, monthRange.start, monthRange.end),
		]);
		const bizcardCountMap = new Map(
			bizcardCountRows.map((entry) => [
				entry.user_id?.toString() ?? "",
				entry._count.bizcard_id,
			]),
		);

		const activeEmployees = rows.map((row) => {
			const userKey = row.user.user_id.toString();
			const live = activityByUser.get(userKey);
			const cached = row.activitySummaries[0];
			const profile_views = live?.profile_views ?? cached?.profile_views ?? 0;
			const contact_saves = live?.contact_saves ?? cached?.contact_saves ?? 0;
			const inquiries_count = live?.inquiries_count ?? cached?.inquiries_count ?? 0;
			return {
				employee_id: row.employee_id.toString(),
				user_id: userKey,
				name: `${row.user.first_name} ${row.user.last_name}`.trim(),
				email: row.user.email,
				profile_image: profileImages.get(userKey) ?? row.user.profile_url,
				role: row.role,
				is_active: row.is_active,
				membership_status: "active",
				joined_at: row.joined_at,
				restricted_at: row.restricted_at,
				restricted_reason: row.restricted_reason,
				last_active: row.user.userActivity?.last_active ?? null,
				bizcard_count: bizcardCountMap.get(userKey) ?? 0,
				summary: {
					period: "this_month",
					profile_views,
					contact_saves,
					inquiries_count,
					connections_count: cached?.connections_count ?? 0,
					rank_score: Number(cached?.rank_score ?? 0),
					calculated_at: cached?.calculated_at ?? new Date(),
				},
			};
		});

		const pendingRows =
			includePending && page === 1
				? pendingInvites.map((invite) => mapInviteToEmployeeRow(invite))
				: [];

		const total = employeeTotal + pendingCount;

		return jsonSuccess(
			{
				employees: [...pendingRows, ...activeEmployees],
				pagination: {
					page,
					limit,
					total,
					pages: Math.max(1, Math.ceil(total / limit)),
				},
			},
			{ requestId, responseTime: Date.now() - startedAt },
		);
	} catch (error) {
		if (error instanceof AppError) {
			return jsonAppError(error, Date.now() - startedAt);
		}

		console.error("[api/company/employees GET] Unexpected error", { requestId, error });
		return jsonUnknownError(requestId, Date.now() - startedAt);
	}
}
