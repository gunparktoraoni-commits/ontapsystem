"use client";

import React, { useMemo, useState } from "react";
import { CreditCard, X } from "lucide-react";
import { ModalPortal } from "../../../components/ModalPortal";
import { InlineLoader } from "../../../components/Loader";
import { showToast } from "../../../components/Toast";
import { getFrontendApiBaseUrl } from "../../../components/apiBase";
import {
	buildCompanyAdminHeaders,
	companyAdminApiRequest,
	extractErrorMessage,
} from "../../lib/companyAdminApi";

type Props = {
	isOpen: boolean;
	employeeName: string;
	employeeUserId: string;
	onClose: () => void;
	onSuccess: () => void;
};

/** Pull a serial from a pasted URL path or raw serial text. */
function extractSerialInput(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed) return "";

	try {
		const asUrl = new URL(trimmed);
		const last = asUrl.pathname.split("/").filter(Boolean).pop() ?? "";
		if (last) return last.trim().toUpperCase();
	} catch {
		const pathMatch = trimmed.match(/\/([A-Za-z0-9_-]{4,64})\/?$/);
		if (pathMatch?.[1]) return pathMatch[1].toUpperCase();
	}

	return trimmed.toUpperCase();
}

const SERIAL_PREVIEW_REGEX = /^[A-Za-z0-9_-]{4,64}$/;
const API_BASE_URL = getFrontendApiBaseUrl();

export default function LinkPhysicalCardModal({
	isOpen,
	employeeName,
	employeeUserId,
	onClose,
	onSuccess,
}: Props) {
	const [serialInput, setSerialInput] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [scanHint, setScanHint] = useState<string | null>(null);

	const serialId = useMemo(() => extractSerialInput(serialInput), [serialInput]);
	const serialLooksValid = SERIAL_PREVIEW_REGEX.test(serialId);

	const resetAndClose = () => {
		setSerialInput("");
		setError(null);
		setScanHint(null);
		setLoading(false);
		onClose();
	};

	const handleVerify = async () => {
		setError(null);
		setScanHint(null);

		if (!serialLooksValid) {
			setError("Enter a valid card serial ID (or paste the card URL).");
			return;
		}

		setLoading(true);
		try {
			const headers = await buildCompanyAdminHeaders("POST");
			const response = await fetch(`${API_BASE_URL}/api/cards/scan`, {
				method: "POST",
				credentials: "include",
				headers,
				body: JSON.stringify({ serialId }),
			});
			const payload = (await response.json().catch(() => ({}))) as {
				status?: string;
				error?: string;
				user?: { email?: string };
			};

			// API returns 404 with { status: "not_found" } for unknown serials.
			if (response.status === 404 || payload.status === "not_found") {
				setScanHint(
					"Serial not in company inventory yet. Linking will claim it for your company first.",
				);
				return;
			}

			if (!response.ok) {
				throw new Error(extractErrorMessage(payload, "Unable to verify this card."));
			}

			if (payload.status === "unassigned") {
				setScanHint("Card is available and ready to assign to this employee.");
			} else if (payload.status === "assigned") {
				const assignedEmail = payload.user?.email;
				setScanHint(
					assignedEmail
						? `This card is already assigned to ${assignedEmail}.`
						: "This card is already assigned to another employee.",
				);
			} else {
				setScanHint("Card checked. You can proceed to link.");
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unable to verify this card.");
		} finally {
			setLoading(false);
		}
	};

	const handleLink = async () => {
		setError(null);

		if (!serialLooksValid) {
			setError("Enter a valid card serial ID (or paste the card URL).");
			return;
		}

		const userId = Number(employeeUserId);
		if (!Number.isFinite(userId) || userId <= 0) {
			setError("Invalid employee account. Refresh the page and try again.");
			return;
		}

		setLoading(true);
		try {
			// Claim serial into company inventory when needed (idempotent for already-owned).
			const assignPayload = (await companyAdminApiRequest("/api/cards/assign", {
				method: "POST",
				body: JSON.stringify({ serialIds: [serialId] }),
			})) as {
				claimed?: string[];
				alreadyOwned?: string[];
				conflicts?: string[];
			};

			const conflicts = Array.isArray(assignPayload.conflicts)
				? assignPayload.conflicts
				: [];
			if (conflicts.some((id) => id.toUpperCase() === serialId)) {
				throw new Error(
					"This card belongs to another company and cannot be linked.",
				);
			}

			const owned =
				(assignPayload.claimed ?? []).some((id) => id.toUpperCase() === serialId) ||
				(assignPayload.alreadyOwned ?? []).some((id) => id.toUpperCase() === serialId);

			if (!owned && conflicts.length === 0) {
				// Defensive: unexpected empty assign result
				throw new Error("Unable to claim this card for your company.");
			}

			await companyAdminApiRequest("/api/cards/link-employee", {
				method: "POST",
				body: JSON.stringify({ serialId, userId }),
			});

			showToast(`Physical card ${serialId} linked to ${employeeName}.`, "success");
			setSerialInput("");
			setScanHint(null);
			onSuccess();
			onClose();
		} catch (err) {
			const message =
				err instanceof Error
					? err.message
					: extractErrorMessage(err, "Failed to link physical card.");
			setError(message);
		} finally {
			setLoading(false);
		}
	};

	if (!isOpen) return null;

	return (
		<ModalPortal isOpen={isOpen} onClose={resetAndClose}>
			<div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
				<div className="flex items-start justify-between gap-3">
					<div className="flex items-start gap-3">
						<div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#e8f0ff] text-[#2a4792]">
							<CreditCard className="h-5 w-5" />
						</div>
						<div>
							<h3 className="text-lg font-bold text-gray-900">Link Physical Card</h3>
							<p className="mt-1 text-sm text-gray-500">
								Assign an NFC/QR card to{" "}
								<span className="font-semibold text-gray-800">{employeeName}</span>.
								The account must already exist before linking.
							</p>
						</div>
					</div>
					<button
						type="button"
						onClick={resetAndClose}
						aria-label="Close"
						className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				<label className="mt-5 block text-sm font-semibold text-gray-700">
					Card serial or URL
					<input
						type="text"
						value={serialInput}
						onChange={(e) => {
							setSerialInput(e.target.value);
							setError(null);
							setScanHint(null);
						}}
						placeholder="e.g. A3F8K2 or https://portal.ontap.ph/A3F8K2"
						className="mt-1 h-11 w-full rounded-lg border border-gray-200 px-3 text-sm focus:border-[#2a3c71] focus:outline-none focus:ring-1 focus:ring-[#2a3c71]"
						disabled={loading}
					/>
				</label>

				{serialId && serialLooksValid && (
					<p className="mt-2 text-xs text-gray-500">
						Resolved serial: <span className="font-semibold text-gray-700">{serialId}</span>
					</p>
				)}

				{scanHint && (
					<div className="mt-3 rounded-xl border border-[#dce8ff] bg-[#f5f8ff] px-3 py-2 text-xs text-[#2a3c71]">
						{scanHint}
					</div>
				)}

				{error && (
					<div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
						{error}
					</div>
				)}

				<div className="mt-6 flex items-center justify-end gap-2">
					<button
						type="button"
						onClick={resetAndClose}
						disabled={loading}
						className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 disabled:opacity-60"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={() => void handleVerify()}
						disabled={loading || !serialLooksValid}
						className="inline-flex items-center gap-2 rounded-lg border border-[#2a4792]/30 bg-[#e8f0ff] px-4 py-2 text-sm font-semibold text-[#2a4792] disabled:cursor-not-allowed disabled:opacity-60"
					>
						{loading ? <InlineLoader /> : null}
						Verify
					</button>
					<button
						type="button"
						onClick={() => void handleLink()}
						disabled={loading || !serialLooksValid}
						className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-[#2a3c71] disabled:cursor-not-allowed disabled:opacity-60"
					>
						{loading ? <InlineLoader className="text-white" /> : null}
						Link Card
					</button>
				</div>
			</div>
		</ModalPortal>
	);
}
