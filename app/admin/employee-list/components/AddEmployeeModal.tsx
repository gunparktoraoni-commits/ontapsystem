"use client";

import React, { useState, useCallback } from "react";
import { Eye, EyeOff, Trash2, X } from "lucide-react";
import { ModalPortal } from "../../../components/ModalPortal";
import { InlineLoader } from "../../../components/Loader";
import { showToast } from "../../../components/Toast";
import { getFrontendApiBaseUrl } from "../../../components/apiBase";
import {
	buildCompanyAdminHeaders,
	extractErrorMessage,
} from "../../lib/companyAdminApi";

const API_BASE_URL = getFrontendApiBaseUrl();

function initialsFromName(value: string): string {
	const parts = value.trim().split(/\s+/).filter(Boolean);
	if (!parts.length) return "--";
	const first = parts[0]?.[0] ?? "";
	const second = parts.length > 1 ? parts[1]?.[0] ?? "" : parts[0]?.[1] ?? "";
	return `${first}${second}`.toUpperCase();
}

type InvitedUser = {
	id: string;
	name: string;
	email: string;
	status:
		| "pending"
		| "connected"
		| "failed"
		| "external_invite_queued"
		| "already_invited"
		| "email_failed"
		| "invalid"
		| "already_connected";
	qrCodeUrl?: string;
};

function isValidEmail(value: string): boolean {
	return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
}

type InviteRoleOption = "admin" | "manager" | "employee" | "viewer" | "other";
type AddMode = "invite" | "manual";

const SYSTEM_INVITE_ROLES = new Set(["admin", "manager", "employee", "viewer"]);
const MAX_CUSTOM_ROLE_LENGTH = 20;
const CUSTOM_ROLE_PATTERN = /^[a-z0-9]+(?:[ _-][a-z0-9]+)*$/i;

function resolveInviteRolePayload(
	option: InviteRoleOption,
	customRole: string,
): { ok: true; role: string } | { ok: false; message: string } {
	if (option !== "other") {
		return { ok: true, role: option };
	}
	const custom = customRole.trim().toLowerCase().replace(/\s+/g, " ");
	if (!custom) {
		return { ok: false, message: "Please enter a custom role." };
	}
	if (custom.length > MAX_CUSTOM_ROLE_LENGTH) {
		return {
			ok: false,
			message: `Custom role must be at most ${MAX_CUSTOM_ROLE_LENGTH} characters.`,
		};
	}
	if (!CUSTOM_ROLE_PATTERN.test(custom)) {
		return {
			ok: false,
			message: "Custom role may only contain letters, numbers, spaces, and hyphens.",
		};
	}
	if (SYSTEM_INVITE_ROLES.has(custom)) {
		return { ok: true, role: custom };
	}
	return { ok: true, role: custom };
}

export type ProvisionedEmployeeResult = {
	id: string;
	userId: string;
	name: string;
	email: string;
	profileImage?: string | null;
	role: string;
	status: "Active";
};

export type AddEmployeeSuccessResult =
	| { mode: "invite" }
	| { mode: "provision"; employee: ProvisionedEmployeeResult };

type AddEmployeeModalProps = {
	isOpen: boolean;
	onClose: () => void;
	onSuccess: (result?: AddEmployeeSuccessResult) => void;
};

export default function AddEmployeeModal({ isOpen, onClose, onSuccess }: AddEmployeeModalProps) {
	const [addMode, setAddMode] = useState<AddMode>("invite");
	const [emailInput, setEmailInput] = useState("");
	const [inviteRoleOption, setInviteRoleOption] = useState<InviteRoleOption>("employee");
	const [customRole, setCustomRole] = useState("");
	const [invitedUsers, setInvitedUsers] = useState<InvitedUser[]>([]);
	const [inviteLoading, setInviteLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [manualFirstName, setManualFirstName] = useState("");
	const [manualLastName, setManualLastName] = useState("");
	const [manualPassword, setManualPassword] = useState("");
	const [manualConfirmPassword, setManualConfirmPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [showConfirmPassword, setShowConfirmPassword] = useState(false);
	const [provisionLoading, setProvisionLoading] = useState(false);

	const companyQrUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/user/dashboard`;

	const resetForm = useCallback(() => {
		setAddMode("invite");
		setEmailInput("");
		setInviteRoleOption("employee");
		setCustomRole("");
		setInvitedUsers([]);
		setError(null);
		setManualFirstName("");
		setManualLastName("");
		setManualPassword("");
		setManualConfirmPassword("");
		setShowPassword(false);
		setShowConfirmPassword(false);
	}, []);

	const handleAddEmail = (): InvitedUser | null => {
		const email = emailInput.trim().toLowerCase();
		if (!email) return null;

		if (!isValidEmail(email)) {
			setError("Please enter a valid email address.");
			return null;
		}

		const alreadyInvited = invitedUsers.some((u) => u.email.toLowerCase() === email);
		if (alreadyInvited) {
			setError("This email is already in the invite list.");
			return null;
		}

		const nextUser: InvitedUser = {
			id: `temp_${Date.now()}`,
			name: email.split("@")[0] || "User",
			email,
			status: "pending",
		};
		setInvitedUsers((prev) => [...prev, nextUser]);
		setEmailInput("");
		setError(null);
		return nextUser;
	};

	const handleRemoveUser = (email: string) => {
		setInvitedUsers((prev) => prev.filter((u) => u.email !== email));
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			e.preventDefault();
			if (addMode === "invite") {
				handleAddEmail();
			}
		}
	};

	const handleSendInvites = async () => {
		let recipients = [...invitedUsers];
		const draftEmail = emailInput.trim().toLowerCase();
		if (draftEmail) {
			if (!isValidEmail(draftEmail)) {
				setError("Please enter a valid email address.");
				return;
			}
			const alreadyListed = recipients.some((u) => u.email.toLowerCase() === draftEmail);
			if (!alreadyListed) {
				recipients = [
					...recipients,
					{
						id: `temp_${Date.now()}`,
						name: draftEmail.split("@")[0] || "User",
						email: draftEmail,
						status: "pending" as const,
					},
				];
				setInvitedUsers(recipients);
				setEmailInput("");
			}
		}

		if (recipients.length === 0) {
			setError("Please add at least one email to invite.");
			return;
		}

		const roleResult = resolveInviteRolePayload(inviteRoleOption, customRole);
		if (!roleResult.ok) {
			setError(roleResult.message);
			return;
		}

		setInviteLoading(true);
		setError(null);

		try {
			const headers = await buildCompanyAdminHeaders("POST");
			const response = await fetch(`${API_BASE_URL}/api/company/employees/invite`, {
				method: "POST",
				credentials: "include",
				headers,
				body: JSON.stringify({
					invites: recipients.map((u) => ({ email: u.email, role: roleResult.role })),
				}),
			});

			const payload = await response.json().catch(() => ({}));

			if (!response.ok) {
				throw new Error(extractErrorMessage(payload, "Failed to send invitations."));
			}

			const results = payload?.data?.invites || [];
			setInvitedUsers((prev) =>
				prev.map((user) => {
					const result = results.find(
						(r: { email?: string; status?: string }) =>
							r.email?.toLowerCase() === user.email.toLowerCase(),
					);
					if (result) {
						return {
							...user,
							status: result.status as InvitedUser["status"],
						};
					}
					return user;
				}),
			);

			const hasSuccess = results.some(
				(r: { status?: string }) =>
					r.status === "connected" ||
					r.status === "pending" ||
					r.status === "email_failed",
			);

			const allFailed = results.length > 0 && !hasSuccess;

			if (allFailed) {
				const firstError = results.find(
					(r: { message?: string }) => typeof r.message === "string",
				);
				setError(firstError?.message ?? "Failed to send invitations.");
				return;
			}

			if (hasSuccess) {
				onSuccess({ mode: "invite" });
				setTimeout(() => {
					resetForm();
					onClose();
				}, 1500);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to send invitations.");
		} finally {
			setInviteLoading(false);
		}
	};

	const handleCreateAccount = async () => {
		const email = emailInput.trim().toLowerCase();
		if (!isValidEmail(email)) {
			setError("Please enter a valid email address.");
			return;
		}

		const roleResult = resolveInviteRolePayload(inviteRoleOption, customRole);
		if (!roleResult.ok) {
			setError(roleResult.message);
			return;
		}

		if (!manualPassword) {
			setError("Password is required.");
			return;
		}

		if (manualPassword !== manualConfirmPassword) {
			setError("Passwords do not match.");
			return;
		}

		setProvisionLoading(true);
		setError(null);

		try {
			const headers = await buildCompanyAdminHeaders("POST");
			const response = await fetch(`${API_BASE_URL}/api/company/employees/provision`, {
				method: "POST",
				credentials: "include",
				headers,
				body: JSON.stringify({
					email,
					password: manualPassword,
					role: roleResult.role,
					firstName: manualFirstName.trim() || undefined,
					lastName: manualLastName.trim() || undefined,
				}),
			});

			const payload = await response.json().catch(() => ({}));

			if (!response.ok) {
				throw new Error(extractErrorMessage(payload, "Failed to create employee account."));
			}

			const employee = payload?.data?.employee ?? payload?.employee;
			if (!employee?.employee_id || !employee?.user_id) {
				throw new Error("Account created but employee details were missing from the response.");
			}

			const provisioned: ProvisionedEmployeeResult = {
				id: String(employee.employee_id),
				userId: String(employee.user_id),
				name: String(employee.name ?? email.split("@")[0] ?? "Employee"),
				email: String(employee.email ?? email),
				profileImage: employee.profile_image ?? null,
				role: String(employee.role ?? roleResult.role),
				status: "Active",
			};

			showToast("Employee account created successfully.", "success");
			onSuccess({ mode: "provision", employee: provisioned });
			resetForm();
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create employee account.");
		} finally {
			setProvisionLoading(false);
		}
	};

	const canSendInvites =
		!inviteLoading && !provisionLoading && (invitedUsers.length > 0 || isValidEmail(emailInput));

	const canCreateAccount =
		!provisionLoading &&
		!inviteLoading &&
		isValidEmail(emailInput) &&
		manualPassword.length > 0 &&
		manualConfirmPassword.length > 0;

	const handleClose = () => {
		resetForm();
		onClose();
	};

	const handleModeChange = (mode: AddMode) => {
		setAddMode(mode);
		setError(null);
		if (mode === "manual") {
			setInvitedUsers([]);
		}
	};

	if (!isOpen) return null;

	return (
		<ModalPortal isOpen={isOpen} onClose={handleClose}>
			<div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
				<div className="flex items-center justify-between mb-6">
					<h3 className="text-xl font-bold text-[#2a3c71]">Add New Employee</h3>
					<button
						type="button"
						onClick={handleClose}
						aria-label="Close"
						className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				<div className="space-y-6">
					{/* Email */}
					<div>
						<label className="text-sm font-semibold text-gray-700">Email</label>
						<input
							type="email"
							value={emailInput}
							onChange={(e) => setEmailInput(e.target.value)}
							onKeyDown={handleKeyDown}
							placeholder={
								addMode === "invite"
									? "Enter the user email to invite them"
									: "Employee email address"
							}
							className="mt-1 w-full h-12 px-4 border border-gray-200 rounded-full text-sm focus:outline-none focus:border-[#2a3c71] focus:ring-1 focus:ring-[#2a3c71] transition-colors"
							autoComplete="off"
						/>
						{addMode === "invite" && (
							<p className="mt-1.5 text-xs text-gray-500">
								Press Enter to add multiple emails to the invite list.
							</p>
						)}
					</div>

					{/* Role */}
					<div className="space-y-2">
						<div>
							<label className="text-sm font-semibold text-gray-700">Role</label>
							<select
								value={inviteRoleOption}
								onChange={(event) =>
									setInviteRoleOption(event.target.value as InviteRoleOption)
								}
								className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm"
							>
								<option value="admin">Admin</option>
								<option value="manager">Manager</option>
								<option value="employee">Employee</option>
								<option value="viewer">Viewer</option>
								<option value="other">Other</option>
							</select>
						</div>
						{inviteRoleOption === "other" && (
							<div>
								<label className="text-sm font-semibold text-gray-700">Custom role</label>
								<input
									type="text"
									value={customRole}
									onChange={(event) => setCustomRole(event.target.value)}
									placeholder="e.g. Sales, Support, Staff"
									maxLength={MAX_CUSTOM_ROLE_LENGTH}
									className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm focus:outline-none focus:border-[#2a3c71] focus:ring-1 focus:ring-[#2a3c71]"
								/>
								<p className="mt-1 text-xs text-gray-500">
									Max {MAX_CUSTOM_ROLE_LENGTH} characters. Letters, numbers, spaces, and
									hyphens only.
								</p>
							</div>
						)}
					</div>

					{/* Mode choice */}
					<div className="space-y-2">
						<p className="text-sm font-semibold text-gray-700">
							How would you like to add this employee?
						</p>
						<div className="space-y-2">
							<label
								className={`flex cursor-pointer gap-3 rounded-xl border px-3 py-3 transition-colors ${
									addMode === "invite"
										? "border-[#2a3c71] bg-[#f5f8ff]"
										: "border-gray-200 hover:bg-gray-50"
								}`}
							>
								<input
									type="radio"
									name="add-employee-mode"
									checked={addMode === "invite"}
									onChange={() => handleModeChange("invite")}
									className="mt-1"
								/>
								<span>
									<span className="block text-sm font-semibold text-[#2a3c71]">
										Send Invitation
									</span>
									<span className="mt-0.5 block text-xs leading-relaxed text-gray-600">
										Employee will receive an invitation and complete their account/profile.
									</span>
								</span>
							</label>
							<label
								className={`flex cursor-pointer gap-3 rounded-xl border px-3 py-3 transition-colors ${
									addMode === "manual"
										? "border-[#2a3c71] bg-[#f5f8ff]"
										: "border-gray-200 hover:bg-gray-50"
								}`}
							>
								<input
									type="radio"
									name="add-employee-mode"
									checked={addMode === "manual"}
									onChange={() => handleModeChange("manual")}
									className="mt-1"
								/>
								<span>
									<span className="block text-sm font-semibold text-[#2a3c71]">
										Create Account Manually
									</span>
									<span className="mt-0.5 block text-xs leading-relaxed text-gray-600">
										Company Admin creates the employee account directly. The employee must
										change their password on first login.
									</span>
								</span>
							</label>
						</div>
					</div>

					{addMode === "invite" && (
						<>
							<div className="rounded-xl border border-[#dce8ff] bg-[#f5f8ff] px-3 py-2.5">
								<p className="text-sm font-semibold text-[#2a3c71]">Employee Profile</p>
								<p className="mt-0.5 text-xs leading-relaxed text-gray-600">
									The employee will complete their own profile after accepting the invitation.
									You can view and manage their information from Employee Management once they
									join.
								</p>
							</div>

							<div className="text-center space-y-3">
								<p className="text-sm text-gray-500">
									After they join, link a physical NFC card from Employee Management.
									<br />
									You can also scan or tap a card serial when assigning.
								</p>
								<div className="flex justify-center">
									<div className="p-3 bg-white border-2 border-[#2a3c71] rounded-xl">
										<img
											src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(companyQrUrl)}&color=2a3c71`}
											alt="Company QR Code"
											width={120}
											height={120}
											className="block"
										/>
									</div>
								</div>
							</div>

							{invitedUsers.length > 0 && (
								<div className="border border-gray-200 rounded-xl p-4">
									<h4 className="text-sm font-semibold text-gray-800 mb-3">Invited Account</h4>
									<div className="space-y-3 max-h-48 overflow-y-auto">
										{invitedUsers.map((user) => (
											<div
												key={user.email}
												className="flex items-center justify-between gap-3"
											>
												<div className="flex items-center gap-3 flex-1 min-w-0">
													<div className="h-10 w-10 rounded-full bg-[#2a3c71] flex items-center justify-center text-white text-sm font-bold shrink-0">
														{initialsFromName(user.name)}
													</div>
													<div className="flex-1 min-w-0">
														<p className="text-sm font-semibold text-gray-800 truncate capitalize">
															{user.name}
														</p>
														<p className="text-xs text-gray-500 truncate">{user.email}</p>
													</div>
												</div>
												<div className="flex items-center gap-2">
													{user.status === "connected" && (
														<span className="text-xs text-emerald-600 font-medium">
															Connected
														</span>
													)}
													<button
														type="button"
														onClick={() => handleRemoveUser(user.email)}
														className="p-2 text-gray-400 hover:text-red-500 transition-colors"
													>
														<Trash2 className="h-4 w-4" />
													</button>
												</div>
											</div>
										))}
									</div>
								</div>
							)}
						</>
					)}

					{addMode === "manual" && (
						<div className="space-y-4">
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<div>
									<label className="text-sm font-semibold text-gray-700">
										First name <span className="font-normal text-gray-400">(optional)</span>
									</label>
									<input
										type="text"
										value={manualFirstName}
										onChange={(e) => setManualFirstName(e.target.value)}
										placeholder="First name"
										maxLength={100}
										className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm focus:outline-none focus:border-[#2a3c71] focus:ring-1 focus:ring-[#2a3c71]"
										autoComplete="off"
									/>
								</div>
								<div>
									<label className="text-sm font-semibold text-gray-700">
										Last name <span className="font-normal text-gray-400">(optional)</span>
									</label>
									<input
										type="text"
										value={manualLastName}
										onChange={(e) => setManualLastName(e.target.value)}
										placeholder="Last name"
										maxLength={100}
										className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm focus:outline-none focus:border-[#2a3c71] focus:ring-1 focus:ring-[#2a3c71]"
										autoComplete="off"
									/>
								</div>
							</div>

							<div>
								<label className="text-sm font-semibold text-gray-700">Password</label>
								<div className="relative mt-1">
									<input
										type={showPassword ? "text" : "password"}
										value={manualPassword}
										onChange={(e) => setManualPassword(e.target.value)}
										placeholder="Create a temporary password"
										className="h-10 w-full rounded-lg border border-gray-200 px-3 pr-10 text-sm focus:outline-none focus:border-[#2a3c71] focus:ring-1 focus:ring-[#2a3c71]"
										autoComplete="new-password"
									/>
									<button
										type="button"
										onClick={() => setShowPassword((prev) => !prev)}
										className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-600"
										aria-label={showPassword ? "Hide password" : "Show password"}
									>
										{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
									</button>
								</div>
							</div>

							<div>
								<label className="text-sm font-semibold text-gray-700">Confirm password</label>
								<div className="relative mt-1">
									<input
										type={showConfirmPassword ? "text" : "password"}
										value={manualConfirmPassword}
										onChange={(e) => setManualConfirmPassword(e.target.value)}
										placeholder="Confirm password"
										className="h-10 w-full rounded-lg border border-gray-200 px-3 pr-10 text-sm focus:outline-none focus:border-[#2a3c71] focus:ring-1 focus:ring-[#2a3c71]"
										autoComplete="new-password"
									/>
									<button
										type="button"
										onClick={() => setShowConfirmPassword((prev) => !prev)}
										className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-600"
										aria-label={
											showConfirmPassword ? "Hide confirm password" : "Show confirm password"
										}
									>
										{showConfirmPassword ? (
											<EyeOff className="h-4 w-4" />
										) : (
											<Eye className="h-4 w-4" />
										)}
									</button>
								</div>
								<p className="mt-1.5 text-xs text-gray-500">
									Min 8 characters with uppercase, lowercase, number, and special character. The
									employee must change this password on first login.
								</p>
							</div>

							<div className="rounded-xl border border-[#dce8ff] bg-[#f5f8ff] px-3 py-2.5">
								<p className="text-sm font-semibold text-[#2a3c71]">After creation</p>
								<p className="mt-0.5 text-xs leading-relaxed text-gray-600">
									The employee appears in Employee Management immediately. You can edit their
									professional BizCard details and later link a physical NFC card.
								</p>
							</div>
						</div>
					)}

					{error && <div className="text-sm text-red-600 text-center">{error}</div>}

					<div className="flex items-center justify-end gap-3 pt-2">
						<button
							type="button"
							onClick={handleClose}
							className="px-6 py-2.5 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
						>
							Cancel
						</button>
						{addMode === "invite" ? (
							<button
								type="button"
								onClick={handleSendInvites}
								disabled={!canSendInvites}
								className="px-6 py-2.5 rounded-lg bg-primary text-sm font-semibold text-white hover:bg-[#2a3c71] transition-colors disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
							>
								{inviteLoading && <InlineLoader className="text-white" />}
								Send Invites
							</button>
						) : (
							<button
								type="button"
								onClick={handleCreateAccount}
								disabled={!canCreateAccount}
								className="px-6 py-2.5 rounded-lg bg-primary text-sm font-semibold text-white hover:bg-[#2a3c71] transition-colors disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
							>
								{provisionLoading && <InlineLoader className="text-white" />}
								Create Account
							</button>
						)}
					</div>
				</div>
			</div>
		</ModalPortal>
	);
}
