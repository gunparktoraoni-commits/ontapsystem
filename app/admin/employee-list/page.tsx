"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
	Search,
	Filter,
	Download,
	Plus,
	X,
	Pencil,
	Trash2,
	ChevronDown,
	ArrowLeft,
	Mail,
	CreditCard,
	Ban,
	UserCheck,
} from "lucide-react";
import { InlineLoader, SectionLoader } from "../../components/Loader";
import { ModalPortal } from "../../components/ModalPortal";
import { showToast } from "../../components/Toast";
import { toServableMediaSrc } from "@/app/lib/portfolioDisplay";
import AddEmployeeModal, {
	type AddEmployeeSuccessResult,
} from "./components/AddEmployeeModal";
import EditEmployeeModal from "./components/EditEmployeeModal";
import LinkPhysicalCardModal from "./components/LinkPhysicalCardModal";
import {
	companyAdminApiRequest,
	getInviteResendCooldownRemaining,
	initialsFromName,
	mapEmployeeRow,
	normalizeResponseData,
	readStoredUserId,
	setInviteResendCooldown,
	syncInviteResendCooldownFromError,
} from "../lib/companyAdminApi";

function mapTeam(role: string): string {
	const normalized = role.toLowerCase();
	if (normalized === "admin" || normalized === "manager") return "Management";
	if (normalized === "viewer") return "Support";
	return "Sales";
}

type EmployeeRow = {
	id: string;
	userId: string;
	name: string;
	email: string;
	profileImage?: string | null;
	role: string;
	team: string;
	cards: number;
	status: "Active" | "Suspended" | "Pending Invite" | "Invite Expired";
	membershipStatus: "active" | "pending_invite";
	invitationId: string | null;
	rank: number;
	joinedAt: string | null;
	activity: {
		views: number;
		leads: number;
		inquiries: number;
	};
};

type EmployeesResponseData = {
	employees?: Array<Record<string, unknown>>;
	pagination?: { pages?: number; total?: number };
	summary?: { total_employees?: number };
};

type EmployeesResponse = { data?: EmployeesResponseData } & EmployeesResponseData;

export default function EmployeeListPage() {
	const [employees, setEmployees] = useState<EmployeeRow[]>([]);
	const [page, setPage] = useState(1);
	const [limit, setLimit] = useState(10);
	const [totalPages, setTotalPages] = useState(1);
	const [searchInput, setSearchInput] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [statusFilter, setStatusFilter] = useState<"all" | "active" | "restricted" | "pending_invite">("all");
	const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "manager" | "employee" | "viewer">("all");
	const [teamFilter, setTeamFilter] = useState<"all" | "Management" | "Sales" | "Support">("all");
	const [sortBy, setSortBy] = useState<"rank_score" | "name" | "role" | "joined_at">("rank_score");
	const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
	const [loading, setLoading] = useState(true);

	const [summaryTotals, setSummaryTotals] = useState({
		totalEmployees: 0,
		leads: 0,
	});

	const [filterOpen, setFilterOpen] = useState(false);
	const [exportOpen, setExportOpen] = useState(false);

	const [showAddModal, setShowAddModal] = useState(false);
	const [currentUserId, setCurrentUserId] = useState("");

	const [editEmployee, setEditEmployee] = useState<EmployeeRow | null>(null);
	const [linkCardEmployee, setLinkCardEmployee] = useState<EmployeeRow | null>(null);
	const [resendState, setResendState] = useState<Record<string, boolean>>({});
	const [deleteTarget, setDeleteTarget] = useState<EmployeeRow | null>(null);
	const [deleteLoading, setDeleteLoading] = useState(false);
	const [suspendTarget, setSuspendTarget] = useState<EmployeeRow | null>(null);
	const [suspendLoading, setSuspendLoading] = useState(false);
	const [cooldownNow, setCooldownNow] = useState(() => Date.now());

	const apiRequest = useCallback(
		(path: string, init?: RequestInit) => companyAdminApiRequest(path, init),
		[],
	);

	const fetchEmployees = useCallback(async (options?: { silent?: boolean }) => {
		if (!options?.silent) setLoading(true);
		try {
			const params = new URLSearchParams({
				page: String(page),
				limit: String(limit),
				sort_by: sortBy,
				sort_dir: sortDir,
			});
			if (statusFilter !== "all") params.set("status", statusFilter);
			if (roleFilter !== "all") params.set("role", roleFilter);
			if (debouncedSearch) params.set("search", debouncedSearch);

			const payload = (await apiRequest(`/api/company/employees?${params.toString()}`)) as EmployeesResponse;
			const data = normalizeResponseData<EmployeesResponseData>(payload);
			const rows = Array.isArray(data.employees) ? data.employees : [];

			const mapped: EmployeeRow[] = rows.map((row: Record<string, unknown>) => {
				const preview = mapEmployeeRow(row);
				return {
					id: preview.id,
					userId: preview.userId,
					name: preview.name,
					email: preview.email,
					profileImage: preview.profileImage,
					role: preview.role,
					team: mapTeam(preview.role),
					cards: preview.bizcardCount,
					status: preview.status,
					membershipStatus: preview.membershipStatus,
					invitationId: preview.invitationId,
					rank: preview.activity.rank,
					joinedAt: preview.joinedAt,
					activity: preview.activity,
				};
			});

			const teamFiltered = teamFilter === "all"
				? mapped
				: mapped.filter((entry) => entry.team === teamFilter);

			setEmployees(teamFiltered);
			setTotalPages(Math.max(1, data.pagination?.pages ?? 1));
			setSummaryTotals((prev) => ({
				...prev,
				totalEmployees: data.summary?.total_employees ?? prev.totalEmployees,
			}));
		} catch (error) {
			if (!options?.silent) {
				setEmployees([]);
				setTotalPages(1);
			}
			showToast(
				error instanceof Error ? error.message : "Failed to load employees.",
				"error"
			);
		} finally {
			if (!options?.silent) setLoading(false);
		}
	}, [apiRequest, page, limit, sortBy, sortDir, statusFilter, debouncedSearch, roleFilter, teamFilter]);

	const fetchSummary = useCallback(async () => {
		try {
			const payload = (await apiRequest(`/api/company/employees/activity/summary`)) as {
				data?: { totals?: { employees_total?: number; contact_saves?: number } };
			};
			const totals = payload.data?.totals;
			if (totals) {
				setSummaryTotals((prev) => ({
					...prev,
					totalEmployees: totals.employees_total ?? prev.totalEmployees,
					leads: totals.contact_saves ?? prev.leads,
				}));
			}
		} catch {
			// ignore summary errors
		}
	}, [apiRequest]);

	useEffect(() => {
		const storedUserId = readStoredUserId();
		if (storedUserId) {
			setCurrentUserId(storedUserId);
			return;
		}

		void (async () => {
			try {
				const payload = (await apiRequest("/api/auth/session")) as {
					data?: { user_id?: string; userId?: string; id?: string };
					user_id?: string;
					userId?: string;
					id?: string;
				};
				const data = payload.data ?? payload;
				const resolved = String(data.user_id ?? data.userId ?? data.id ?? "").trim();
				if (resolved) setCurrentUserId(resolved);
			} catch {
				// ignore session lookup errors
			}
		})();
	}, [apiRequest]);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			setDebouncedSearch(searchInput.trim());
			setPage(1);
		}, 400);
		return () => window.clearTimeout(timer);
	}, [searchInput]);

	useEffect(() => {
		void fetchSummary();
		void fetchEmployees();
		const interval = window.setInterval(() => {
			void fetchEmployees({ silent: true });
			void fetchSummary();
		}, 15_000);

		const handleFocusRefresh = () => {
			void fetchEmployees({ silent: true });
			void fetchSummary();
		};
		const handleVisibility = () => {
			if (document.visibilityState === "visible") handleFocusRefresh();
		};

		window.addEventListener("focus", handleFocusRefresh);
		document.addEventListener("visibilitychange", handleVisibility);

		return () => {
			window.clearInterval(interval);
			window.removeEventListener("focus", handleFocusRefresh);
			document.removeEventListener("visibilitychange", handleVisibility);
		};
	}, [fetchEmployees, fetchSummary]);

	useEffect(() => {
		const timer = window.setInterval(() => setCooldownNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, []);

	const handleSort = (nextSort: typeof sortBy) => {
		if (sortBy === nextSort) {
			setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
			return;
		}
		setSortBy(nextSort);
		setSortDir("desc");
	};

	const handleInviteSuccess = async (result?: AddEmployeeSuccessResult) => {
		if (result?.mode === "provision") {
			await fetchEmployees();
			void fetchSummary();
			setEditEmployee({
				id: result.employee.id,
				userId: result.employee.userId,
				name: result.employee.name,
				email: result.employee.email,
				profileImage: result.employee.profileImage ?? null,
				role: result.employee.role,
				team: mapTeam(result.employee.role),
				cards: 0,
				status: "Active",
				membershipStatus: "active",
				invitationId: null,
				rank: 0,
				joinedAt: new Date().toISOString(),
				activity: { views: 0, leads: 0, inquiries: 0 },
			});
			return;
		}

		showToast("Invitation sent successfully.", "success");
		await fetchEmployees();
		void fetchSummary();
	};

	const handleReinvite = async (employee: EmployeeRow) => {
		const invitationId = employee.invitationId;
		if (!invitationId) {
			showToast("Invitation ID is missing for this user.", "error");
			return;
		}

		const cooldownRemaining = getInviteResendCooldownRemaining(employee.id, cooldownNow);
		if (cooldownRemaining > 0) {
			showToast(
				`Please wait ${Math.ceil(cooldownRemaining / 1000)} seconds before resending.`,
				"error"
			);
			return;
		}

		setResendState((prev) => ({ ...prev, [employee.id]: true }));
		try {
			await apiRequest("/api/company/invitations/resend", {
				method: "POST",
				body: JSON.stringify({ invitation_id: invitationId }),
			});
			setInviteResendCooldown(employee.id);
			showToast(
				`Invitation resent to ${employee.email}.`,
				"success"
			);
			await fetchEmployees({ silent: true });
		} catch (error) {
			syncInviteResendCooldownFromError(employee.id, error);
			showToast(
				error instanceof Error ? error.message : "Failed to resend invitation.",
				"error"
			);
		} finally {
			setResendState((prev) => ({ ...prev, [employee.id]: false }));
		}
	};

	const handleConfirmDelete = async () => {
		if (!deleteTarget) return;
		setDeleteLoading(true);
		try {
			if (deleteTarget.membershipStatus === "pending_invite") {
				const invitationId = deleteTarget.invitationId;
				if (!invitationId) {
					throw new Error("Invitation ID is missing for this user.");
				}
				await apiRequest(`/api/company/invitations/${invitationId}`, {
					method: "DELETE",
				});
				setEmployees((prev) => prev.filter((row) => row.id !== deleteTarget.id));
				showToast(
					`Invitation for ${deleteTarget.email} was deleted.`,
					"success"
				);
			} else {
				await apiRequest(`/api/company/employees/${deleteTarget.id}`, {
					method: "DELETE",
				});
				setEmployees((prev) => prev.filter((row) => row.id !== deleteTarget.id));
				showToast(`${deleteTarget.name} was removed from the company.`, "success");
			}
			setDeleteTarget(null);
			void fetchEmployees({ silent: true });
			void fetchSummary();
		} catch (error) {
			showToast(
				error instanceof Error ? error.message : "Failed to delete employee.",
				"error"
			);
		} finally {
			setDeleteLoading(false);
		}
	};

	const handleConfirmSuspend = async () => {
		if (!suspendTarget) return;
		const isSuspended = suspendTarget.status === "Suspended";
		setSuspendLoading(true);
		try {
			await apiRequest(`/api/company/employees/${suspendTarget.id}/restrict`, {
				method: "POST",
				body: JSON.stringify({
					action: isSuspended ? "unrestrict" : "restrict",
					reason: isSuspended ? "Reactivated by company admin" : "Suspended by company admin",
				}),
			});
			setEmployees((prev) =>
				prev.map((row) =>
					row.id === suspendTarget.id
						? { ...row, status: isSuspended ? "Active" : "Suspended" }
						: row
				)
			);
			showToast(
				isSuspended
					? `${suspendTarget.name} was reactivated.`
					: `${suspendTarget.name} was suspended.`,
				"success"
			);
			setSuspendTarget(null);
			void fetchEmployees({ silent: true });
			void fetchSummary();
		} catch (error) {
			showToast(
				error instanceof Error ? error.message : "Failed to update employee status.",
				"error"
			);
		} finally {
			setSuspendLoading(false);
		}
	};

	const handleEditEmployee = (employee: EmployeeRow) => {
		if (employee.membershipStatus === "pending_invite") return;
		setEditEmployee(employee);
	};
	const handleDeleteEmployee = (employee: EmployeeRow) => {
		setDeleteTarget(employee);
	};
	const exportEmployees = (format: "csv" | "xlsx") => {
		const header = ["Rank", "Name", "Email", "Team", "Role", "Cards", "Status"];
		const rows = employees.map((row) => [
			row.rank,
			row.name,
			row.email,
			row.team,
			row.role,
			row.cards,
			row.status,
		]);
		const csvContent = [header, ...rows]
			.map((line) => line.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
			.join("\n");
		const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
		const url = window.URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = `employees_export.${format}`;
		anchor.click();
		window.URL.revokeObjectURL(url);
	};
	const summaryCards = useMemo(() => [
		{ label: "Total Employees", value: summaryTotals.totalEmployees },
		{ label: "Leads Made", value: summaryTotals.leads },
	], [summaryTotals]);

	if (loading) {
		return <SectionLoader text="Loading employees..." />;
	}

	return (
		<section className="space-y-6">
			<Link
				href="/admin/company"
				className="inline-flex items-center gap-1.5 text-sm font-medium text-[#6f7fa8] hover:text-primary transition-colors"
			>
				<ArrowLeft className="h-4 w-4" />
				Company
			</Link>
			<div className="flex flex-col gap-2">
				<h2 className="text-3xl font-bold text-[#2a3c71]">Employee Management</h2>
				<p className="text-sm text-[#6f7fa8]">Track your team performance and manage access.</p>
			</div>
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
				{summaryCards.map((card) => (
					<div key={card.label} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
						<p className="text-xs font-semibold text-gray-500">{card.label}</p>
						<p className="mt-2 text-2xl font-bold text-gray-900">{card.value.toLocaleString()}</p>
					</div>
				))}
			</div>
			<div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
				<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
					<div className="relative flex-1">
						<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
						<input
							type="text"
							value={searchInput}
							onChange={(event) => setSearchInput(event.target.value)}
							placeholder="Search employees by name, role or email..."
							className="h-11 w-full rounded-lg border border-gray-200 pl-10 pr-3 text-sm text-gray-700 outline-none transition-colors focus:border-primary"
						/>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<div className="relative">
							<button
								type="button"
								onClick={() => setFilterOpen((prev) => !prev)}
								className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700"
							>
								<Filter className="h-4 w-4" />
								Filter
							</button>
							{filterOpen && (
								<div className="absolute right-0 mt-2 w-64 rounded-xl border border-gray-200 bg-white p-4 shadow-lg z-10">
									<div className="space-y-3">
										<div>
											<label className="text-xs font-semibold text-gray-500">Status</label>
											<select
												value={statusFilter}
												onChange={(event) => {
													setStatusFilter(event.target.value as typeof statusFilter);
													setPage(1);
												}}
												className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-2 text-sm"
											>
												<option value="all">All</option>
												<option value="active">Active</option>
												<option value="pending_invite">Pending Invite</option>
												<option value="restricted">Suspended</option>
											</select>
										</div>
										<div>
											<label className="text-xs font-semibold text-gray-500">Role</label>
											<select
												value={roleFilter}
												onChange={(event) => {
													setRoleFilter(event.target.value as typeof roleFilter);
													setPage(1);
												}}
												className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-2 text-sm"
											>
												<option value="all">All</option>
												<option value="admin">Admin</option>
												<option value="manager">Manager</option>
												<option value="employee">Employee</option>
												<option value="viewer">Viewer</option>
											</select>
										</div>
										<div>
											<label className="text-xs font-semibold text-gray-500">Team</label>
											<select
												value={teamFilter}
												onChange={(event) => {
													setTeamFilter(event.target.value as typeof teamFilter);
													setPage(1);
												}}
												className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-2 text-sm"
											>
												<option value="all">All</option>
												<option value="Management">Management</option>
												<option value="Sales">Sales</option>
												<option value="Support">Support</option>
											</select>
										</div>
									</div>
								</div>
							)}

						</div>
						<div className="relative">
							<button
								type="button"
								onClick={() => setExportOpen((prev) => !prev)}
								className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700"
							>
								<Download className="h-4 w-4" />
								Export
							</button>
							{exportOpen && (
								<div className="absolute right-0 mt-2 w-36 rounded-xl border border-gray-200 bg-white shadow-lg z-10">
									<button
										type="button"
										onClick={() => {
											exportEmployees("csv");
											setExportOpen(false);
										}}
										className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50"
									>
										CSV
									</button>
									<button
										type="button"
										onClick={() => {
											exportEmployees("xlsx");
											setExportOpen(false);
										}}
										className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50"
									>
										Excel
									</button>
								</div>
							)}
						</div>
						<button
							type="button"
							onClick={() => setShowAddModal(true)}
							className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
						>
							<Plus className="h-4 w-4" />
							Add New Employee
						</button>
					</div>
				</div>
				<div className="mt-6 overflow-x-auto">
					<table className="w-full text-left text-sm">
						<thead className="text-xs uppercase text-gray-400">
							<tr>
								<th className="px-3 py-2">Rank</th>
								<th className="px-3 py-2">
									<button type="button" onClick={() => handleSort("name")} className="inline-flex items-center gap-1">
										Employee
										<ChevronDown className={`h-3 w-3 ${sortBy === "name" && sortDir === "asc" ? "-rotate-180" : ""}`} />
									</button>
								</th>
								<th className="px-3 py-2">Team</th>
								<th className="px-3 py-2">
									<button type="button" onClick={() => handleSort("role")} className="inline-flex items-center gap-1">
										Role
										<ChevronDown className={`h-3 w-3 ${sortBy === "role" && sortDir === "asc" ? "-rotate-180" : ""}`} />
									</button>
								</th>
								<th className="px-3 py-2">Cards</th>
								<th className="px-3 py-2">Status</th>
								<th className="px-3 py-2 text-right">Actions</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-gray-100">
							{loading ? (
								<tr>
									<td colSpan={7} className="py-10 text-center text-sm text-gray-400">
										<InlineLoader /> Loading employees...
									</td>
								</tr>
							) : employees.length === 0 ? (
								<tr>
									<td colSpan={7} className="py-10 text-center text-sm text-gray-400">
										No employees found.
									</td>
								</tr>
							) : (
								employees.map((employee) => {
									const isCurrentUser =
										currentUserId !== "" && employee.userId === currentUserId;
									return (
									<tr key={employee.id} className="hover:bg-gray-50">
										<td className="px-3 py-3 font-semibold text-gray-600">{employee.rank || "-"}</td>
										<td className="px-3 py-3">
											<div className="flex items-center gap-3">
												<div className="h-9 w-9 rounded-full bg-[#e8f0ff] flex items-center justify-center text-xs font-bold text-[#2a3c71] overflow-hidden">
													{employee.profileImage ? (
														<img
															src={toServableMediaSrc(employee.profileImage)}
															alt=""
															className="h-full w-full rounded-full object-cover"
														/>
													) : (
														initialsFromName(isCurrentUser ? "Me" : employee.name)
													)}
												</div>
												<div>
													<div className="flex items-center gap-2">
														<p className="font-semibold text-gray-800">
															{isCurrentUser ? "Me" : employee.name}
														</p>
														{isCurrentUser && (
															<span className="text-xs bg-[#e8f0ff] text-[#2a4792] rounded-full px-2 font-semibold">
																You
															</span>
														)}
													</div>
													<p className="text-xs text-gray-500">{employee.email}</p>
												</div>
											</div>
										</td>
										<td className="px-3 py-3 text-gray-600">{employee.team}</td>
										<td className="px-3 py-3 capitalize text-gray-600">{employee.role}</td>
										<td className="px-3 py-3 text-gray-600">{employee.cards}</td>
										<td className="px-3 py-3">
											<span
												className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
													employee.status === "Active"
														? "bg-emerald-50 text-emerald-700"
														: employee.status === "Pending Invite"
															? "bg-amber-50 text-amber-700"
															: employee.status === "Invite Expired"
																? "bg-orange-50 text-orange-700"
																: "bg-rose-50 text-rose-700"
												}`}
											>
												{employee.status}
											</span>
										</td>
										<td className="px-3 py-3 text-right">
											{employee.membershipStatus === "pending_invite" ? (
												<div className="inline-flex items-center justify-end gap-2">
													{(() => {
														const cooldownRemaining = getInviteResendCooldownRemaining(
															employee.id,
															cooldownNow,
														);
														const cooldownSeconds = Math.ceil(cooldownRemaining / 1000);
														const isResending = Boolean(resendState[employee.id]);
														const isCooldownActive = cooldownRemaining > 0;
														return (
															<button
																type="button"
																onClick={() => void handleReinvite(employee)}
																disabled={isResending || isCooldownActive}
																className="inline-flex items-center gap-1.5 rounded-lg border border-[#2a4792]/20 bg-[#e8f0ff] px-3 py-1.5 text-xs font-semibold text-[#2a4792] hover:bg-[#dce8ff] disabled:cursor-not-allowed disabled:opacity-60"
															>
																{isResending ? (
																	<InlineLoader />
																) : (
																	<Mail className="h-3.5 w-3.5" />
																)}
																{isCooldownActive
																	? `Resend in ${cooldownSeconds}s`
																	: "Re-invite"}
															</button>
														);
													})()}
													<button
														type="button"
														onClick={() => handleDeleteEmployee(employee)}
														className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:text-rose-600"
														aria-label={`Delete invitation for ${employee.name}`}
													>
														<Trash2 className="h-4 w-4" />
													</button>
												</div>
											) : (
											<div className="inline-flex items-center gap-2">
												<button
													type="button"
													onClick={() => setLinkCardEmployee(employee)}
													className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:text-[#2a4792]"
													aria-label={`Link physical card for ${employee.name}`}
													title="Link physical card"
												>
													<CreditCard className="h-4 w-4" />
												</button>
												<button
													type="button"
													onClick={() => handleEditEmployee(employee)}
													className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:text-gray-700"
													aria-label={`Edit ${employee.name}`}
												>
													<Pencil className="h-4 w-4" />
												</button>
												<button
													type="button"
													onClick={() => setSuspendTarget(employee)}
													className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 ${
														employee.status === "Suspended"
															? "hover:text-emerald-600"
															: "hover:text-amber-600"
													}`}
													aria-label={
														employee.status === "Suspended"
															? `Reactivate ${employee.name}`
															: `Suspend ${employee.name}`
													}
													title={employee.status === "Suspended" ? "Reactivate" : "Suspend"}
												>
													{employee.status === "Suspended" ? (
														<UserCheck className="h-4 w-4" />
													) : (
														<Ban className="h-4 w-4" />
													)}
												</button>
												<button
													type="button"
													onClick={() => handleDeleteEmployee(employee)}
													className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:text-rose-600"
													aria-label={`Remove ${employee.name}`}
												>
													<Trash2 className="h-4 w-4" />
												</button>
											</div>
											)}
										</td>
									</tr>
									);
								})
							)}
						</tbody>
					</table>
				</div>

				<div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm text-gray-500">
					<span>
						Page {page} of {totalPages}
					</span>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => setPage((prev) => Math.max(1, prev - 1))}
							disabled={page <= 1}
							className="rounded-lg border border-gray-200 px-3 py-1 text-sm disabled:opacity-50"
						>
							Previous
						</button>
						<button
							type="button"
							onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
							disabled={page >= totalPages}
							className="rounded-lg border border-gray-200 px-3 py-1 text-sm disabled:opacity-50"
						>
							Next
						</button>
						<select
							value={limit}
							onChange={(event) => {
								setLimit(Number(event.target.value));
								setPage(1);
							}}
							className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
						>
							{[10, 20, 50].map((size) => (
								<option key={size} value={size}>
									{size} / page
								</option>
							))}
						</select>
					</div>
				</div>
			</div>

			<AddEmployeeModal
				isOpen={showAddModal}
				onClose={() => setShowAddModal(false)}
				onSuccess={(result) => {
					void handleInviteSuccess(result);
				}}
			/>

			{editEmployee && (
				<EditEmployeeModal
					employee={editEmployee}
					onClose={() => setEditEmployee(null)}
					onSaved={async () => {
						await fetchEmployees();
						void fetchSummary();
					}}
				/>
			)}

			{linkCardEmployee && (
				<LinkPhysicalCardModal
					isOpen={!!linkCardEmployee}
					employeeName={linkCardEmployee.name}
					employeeUserId={linkCardEmployee.userId}
					onClose={() => setLinkCardEmployee(null)}
					onSuccess={async () => {
						await fetchEmployees();
						void fetchSummary();
					}}
				/>
			)}

			{deleteTarget && (
				<ModalPortal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
					<div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
						<div className="flex items-center justify-between">
							<h3 className="text-lg font-bold text-gray-900">
								{deleteTarget.membershipStatus === "pending_invite"
									? "Delete Invitation"
									: "Remove Employee"}
							</h3>
							<button
								type="button"
								onClick={() => setDeleteTarget(null)}
								aria-label="Close"
								className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200"
							>
								<X className="h-4 w-4" />
							</button>
						</div>
						<p className="mt-3 text-sm text-gray-600">
							{deleteTarget.membershipStatus === "pending_invite" ? (
								<>
									Are you sure you want to permanently delete the invitation for{" "}
									<span className="font-semibold text-gray-900">{deleteTarget.email}</span>?
									This action cannot be undone.
								</>
							) : (
								<>
									Are you sure you want to permanently remove{" "}
									<span className="font-semibold text-gray-900">{deleteTarget.name}</span> from
									your company? This action cannot be undone.
								</>
							)}
						</p>
						<div className="mt-6 flex items-center justify-end gap-2">
							<button
								type="button"
								onClick={() => setDeleteTarget(null)}
								className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={() => void handleConfirmDelete()}
								disabled={deleteLoading}
								className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
							>
								{deleteLoading ? <InlineLoader /> : "Delete"}
							</button>
						</div>
					</div>
				</ModalPortal>
			)}

			{suspendTarget && (
				<ModalPortal isOpen={!!suspendTarget} onClose={() => setSuspendTarget(null)}>
					<div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
						<div className="flex items-center justify-between">
							<h3 className="text-lg font-bold text-gray-900">
								{suspendTarget.status === "Suspended" ? "Reactivate Employee" : "Suspend Employee"}
							</h3>
							<button
								type="button"
								onClick={() => setSuspendTarget(null)}
								aria-label="Close"
								className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200"
							>
								<X className="h-4 w-4" />
							</button>
						</div>
						<p className="mt-3 text-sm text-gray-600">
							{suspendTarget.status === "Suspended" ? (
								<>
									Restore company access for{" "}
									<span className="font-semibold text-gray-900">{suspendTarget.name}</span>?
								</>
							) : (
								<>
									Suspend{" "}
									<span className="font-semibold text-gray-900">{suspendTarget.name}</span>?
									They will stay in your employee list but lose company access until reactivated.
								</>
							)}
						</p>
						<div className="mt-6 flex items-center justify-end gap-2">
							<button
								type="button"
								onClick={() => setSuspendTarget(null)}
								className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={() => void handleConfirmSuspend()}
								disabled={suspendLoading}
								className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
									suspendTarget.status === "Suspended" ? "bg-emerald-600" : "bg-amber-600"
								}`}
							>
								{suspendLoading ? (
									<InlineLoader />
								) : suspendTarget.status === "Suspended" ? (
									"Reactivate"
								) : (
									"Suspend"
								)}
							</button>
						</div>
					</div>
				</ModalPortal>
			)}

		</section>
	);
}
