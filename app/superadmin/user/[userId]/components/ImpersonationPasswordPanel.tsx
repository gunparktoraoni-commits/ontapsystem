"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldCheck,
  Infinity as InfinityIcon,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { PortalModal } from "../../../components/ui";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import { csrfClient } from "@/lib/csrf-client";

type ModalFeedback = {
  type: "success" | "error" | "info";
  message: string;
};

function ModalAlert({ feedback }: { feedback: ModalFeedback }) {
  const styles = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
    error: "border-rose-200 bg-rose-50 text-rose-800",
    info: "border-sky-200 bg-sky-50 text-sky-900",
  } as const;
  const Icon =
    feedback.type === "success"
      ? CheckCircle2
      : feedback.type === "error"
        ? AlertCircle
        : Info;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm font-medium ${styles[feedback.type]}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 leading-snug">{feedback.message}</p>
    </div>
  );
}

function extractServerMessage(json: unknown, fallback: string): string {
  if (!json || typeof json !== "object") return fallback;
  const payload = json as {
    message?: unknown;
    data?: { message?: unknown };
    error?: { message?: unknown };
  };
  const candidates = [
    payload.data?.message,
    payload.message,
    payload.error?.message,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return fallback;
}

function apiUrl(path: string): string {
  const base = getFrontendApiBaseUrl().replace(/\/+$/, "");
  const safePath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${safePath}`;
}

/** Safari < 14 used addListener/removeListener on MediaQueryList. */
function subscribeMediaQuery(media: MediaQueryList, listener: () => void): () => void {
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }
  const legacy = media as MediaQueryList & {
    addListener?: (cb: () => void) => void;
    removeListener?: (cb: () => void) => void;
  };
  legacy.addListener?.(listener);
  return () => legacy.removeListener?.(listener);
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof window === "undefined" || !text) return false;

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy path (permissions / insecure context / older engines).
    }
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.padding = "0";
    textarea.style.border = "none";
    textarea.style.outline = "none";
    textarea.style.boxShadow = "none";
    textarea.style.background = "transparent";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

function validateNewPasswordClient(password: string): string | null {
  if (password.length < 8) return "New password must be at least 8 characters.";
  if (password.length > 128) return "New password must not exceed 128 characters.";
  if (/\s/.test(password)) return "Password must not contain whitespace.";
  if (!/[a-z]/.test(password)) return "Password must contain at least 1 lowercase letter.";
  if (!/[A-Z]/.test(password)) return "Password must contain at least 1 uppercase letter.";
  if (!/[0-9]/.test(password)) return "Password must contain at least 1 digit.";
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password)) {
    return "Password must contain at least 1 special character.";
  }
  return null;
}

async function fetchWithCsrf(
  path: string,
  init: RequestInit,
): Promise<Response> {
  const base = getFrontendApiBaseUrl() || undefined;
  const headers = new Headers(init.headers || {});

  const attachToken = async (force: boolean) => {
    const token = await csrfClient.getToken(force, base);
    if (token) {
      headers.set("X-CSRF-Token", token);
      headers.set("x-csrf-token", token);
      headers.set("X-XSRF-TOKEN", token);
    } else {
      headers.delete("X-CSRF-Token");
      headers.delete("x-csrf-token");
      headers.delete("X-XSRF-TOKEN");
    }
  };

  await attachToken(false);
  let response = await fetch(apiUrl(path), {
    ...init,
    credentials: "include",
    headers,
  });

  // Some browsers race cookie visibility after CSRF mint — retry once with a forced token.
  if (response.status === 403) {
    await attachToken(true);
    response = await fetch(apiUrl(path), {
      ...init,
      credentials: "include",
      headers,
    });
  }

  return response;
}

type PasswordViewMode = "one_time" | "timed" | "permanent";

type PasswordStatus = {
  target: { user_id: number; name: string; email: string };
  vault_available: boolean;
  password_changed_at: string | null;
  must_change_password: boolean;
  preference: { mode: PasswordViewMode; duration_hours: number };
  active_grant: {
    grant_id: number;
    mode: PasswordViewMode;
    duration_hours: number | null;
    expires_at: string | null;
    one_time_consumed: boolean;
    requires_reauth: boolean;
  } | null;
  requires_reauth: boolean;
};

type DurationPreset = { id: string; label: string; hours: number };

const DURATION_PRESETS: DurationPreset[] = [
  { id: "1h", label: "1 hour", hours: 1 },
  { id: "24h", label: "24 hours", hours: 24 },
  { id: "7d", label: "7 days", hours: 24 * 7 },
  { id: "30d", label: "30 days", hours: 24 * 30 },
];

const MODE_OPTIONS: Array<{
  id: PasswordViewMode;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: "one_time",
    title: "One-time only",
    description: "Reveal once, then require your password again.",
    icon: Eye,
  },
  {
    id: "timed",
    title: "Time-limited",
    description: "Stay unlocked for a chosen window without re-entering.",
    icon: Clock,
  },
  {
    id: "permanent",
    title: "Permanent",
    description: "Keep access unlocked until you revoke it in Settings.",
    icon: InfinityIcon,
  },
];

function formatRelativeExpiry(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return "Expired";
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  if (hours < 48) return `${hours}h remaining`;
  const days = Math.ceil(hours / 24);
  return `${days}d remaining`;
}

type ImpersonationPasswordPanelProps = {
  userId: string;
};

export function ImpersonationPasswordPanel({ userId }: ImpersonationPasswordPanelProps) {
  const [status, setStatus] = useState<PasswordStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const [revealOpen, setRevealOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);

  const [saPassword, setSaPassword] = useState("");
  const [showSaPassword, setShowSaPassword] = useState(false);
  const [mode, setMode] = useState<PasswordViewMode>("one_time");
  const [durationHours, setDurationHours] = useState(24);
  const [revealing, setRevealing] = useState(false);
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null);
  const [showRevealed, setShowRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changeSaPassword, setChangeSaPassword] = useState("");
  const [mustChange, setMustChange] = useState(true);
  const [changing, setChanging] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [changeFeedbacks, setChangeFeedbacks] = useState<ModalFeedback[]>([]);
  const [revealFeedback, setRevealFeedback] = useState<ModalFeedback | null>(null);
  const [credentialsExpanded, setCredentialsExpanded] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 639px)");
    const sync = () => setCredentialsExpanded(!media.matches);
    sync();
    return subscribeMediaQuery(media, sync);
  }, []);

  const showToast = useCallback((type: "success" | "error", message: string) => {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        apiUrl(`/api/superadmin/users/${encodeURIComponent(userId)}/password`),
        { credentials: "include", cache: "no-store" },
      );
      const json = (await response.json().catch(() => null)) as {
        success?: boolean;
        data?: PasswordStatus;
        error?: { message?: string };
        message?: string;
      } | null;

      if (!response.ok || !json?.success || !json.data) {
        throw new Error(json?.error?.message || json?.message || "Failed to load password status.");
      }

      setStatus(json.data);
      setMode(json.data.preference.mode);
      setDurationHours(json.data.preference.duration_hours || 24);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load password tools.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const grantLabel = useMemo(() => {
    if (!status?.active_grant) return null;
    if (status.active_grant.mode === "permanent") return "Permanent access active";
    if (status.active_grant.mode === "timed") {
      return formatRelativeExpiry(status.active_grant.expires_at) || "Timed access active";
    }
    return null;
  }, [status]);

  const openReveal = () => {
    setSaPassword("");
    setShowSaPassword(false);
    setRevealFeedback(null);
    setRevealOpen(true);
    if (status?.preference) {
      setMode(status.preference.mode);
      setDurationHours(status.preference.duration_hours || 24);
    }
  };

  const closeReveal = () => {
    setRevealOpen(false);
    setSaPassword("");
    setRevealFeedback(null);
  };

  const handleReveal = async () => {
    setRevealing(true);
    setRevealFeedback(null);
    try {
      const needsPassword = Boolean(status?.requires_reauth);
      const body: Record<string, unknown> = {};
      if (needsPassword) {
        if (!saPassword.trim()) {
          throw new Error("Enter your superadmin password to continue.");
        }
        body.superadmin_password = saPassword.trim();
        body.mode = mode;
        if (mode === "timed") body.duration_hours = durationHours;
      }

      const response = await fetchWithCsrf(
        `/api/superadmin/users/${encodeURIComponent(userId)}/password/reveal`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const json = (await response.json().catch(() => null)) as {
        success?: boolean;
        data?: { password?: string; message?: string };
        error?: { message?: string };
        message?: string;
      } | null;

      if (!response.ok || !json?.success || !json.data?.password) {
        throw new Error(extractServerMessage(json, "Unable to reveal password."));
      }

      setRevealedPassword(json.data.password);
      setShowRevealed(true);
      closeReveal();
      showToast("success", extractServerMessage(json, "Password revealed securely."));
      await loadStatus();
    } catch (revealError) {
      setRevealFeedback({
        type: "error",
        message:
          revealError instanceof Error ? revealError.message : "Unable to reveal password.",
      });
    } finally {
      setRevealing(false);
    }
  };

  const handleCopy = async () => {
    if (!revealedPassword) return;
    const ok = await copyTextToClipboard(revealedPassword);
    if (!ok) {
      showToast("error", "Could not copy password. Select and copy it manually.");
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const handleHide = () => {
    setRevealedPassword(null);
    setShowRevealed(false);
  };

  const openChange = () => {
    setNewPassword("");
    setConfirmPassword("");
    setChangeSaPassword("");
    setMustChange(true);
    setChangeFeedbacks([]);
    setChangeOpen(true);
  };

  const closeChange = () => {
    if (changing) return;
    setChangeOpen(false);
    setChangeFeedbacks([]);
  };

  const handleChangePassword = async () => {
    setChanging(true);
    setChangeFeedbacks([]);
    try {
      if (!changeSaPassword.trim()) {
        throw new Error("Enter your superadmin password to confirm.");
      }
      const passwordError = validateNewPasswordClient(newPassword);
      if (passwordError) {
        throw new Error(passwordError);
      }
      if (newPassword !== confirmPassword) {
        throw new Error("New password and confirmation do not match.");
      }

      const response = await fetchWithCsrf(
        `/api/superadmin/users/${encodeURIComponent(userId)}/password`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            superadmin_password: changeSaPassword.trim(),
            new_password: newPassword,
            confirm_password: confirmPassword,
            must_change_password: mustChange,
          }),
        },
      );
      const json = (await response.json().catch(() => null)) as {
        success?: boolean;
        data?: {
          message?: string;
          must_change_password?: boolean;
          vault_available?: boolean;
        };
        error?: { message?: string };
        message?: string;
      } | null;

      if (!response.ok || !json?.success) {
        throw new Error(extractServerMessage(json, "Unable to change password."));
      }

      const successMessage = extractServerMessage(json, "User password updated successfully.");
      const nextFeedbacks: ModalFeedback[] = [
        { type: "success", message: successMessage },
      ];
      if (json.data?.must_change_password) {
        nextFeedbacks.push({
          type: "info",
          message: "The user will be asked to set a new password on their next login.",
        });
      } else {
        nextFeedbacks.push({
          type: "info",
          message: "Password vault is updated. You can reveal this password from Account Credentials.",
        });
      }

      setChangeFeedbacks(nextFeedbacks);
      setRevealedPassword(null);
      setNewPassword("");
      setConfirmPassword("");
      setChangeSaPassword("");
      await loadStatus();
    } catch (changeError) {
      setChangeFeedbacks([
        {
          type: "error",
          message:
            changeError instanceof Error ? changeError.message : "Unable to change password.",
        },
      ]);
    } finally {
      setChanging(false);
    }
  };

  return (
    <>
      <AnimatePresence>
        {toast ? (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={`fixed right-4 top-20 z-31000 rounded-xl border px-4 py-3 text-sm font-semibold shadow-lg ${
              toast.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-rose-200 bg-rose-50 text-rose-700"
            }`}
          >
            {toast.message}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <section className="mb-4 overflow-hidden rounded-2xl border border-amber-200/80 bg-linear-to-br from-[#fff9f0] via-white to-[#f3f7ff] shadow-sm">
        <div className="flex items-start justify-between gap-3 border-b border-amber-100/80 px-4 py-3.5 sm:px-5 sm:py-4">
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches) {
                setCredentialsExpanded((prev) => !prev);
              }
            }}
            className="flex min-w-0 flex-1 items-start gap-3 text-left sm:cursor-default"
            aria-expanded={credentialsExpanded}
          >
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold tracking-widest text-amber-700/80 sm:text-xs">
                SUPERADMIN ONLY
              </p>
              <h3 className="mt-0.5 text-base font-bold text-gray-900">Account Credentials</h3>
              <p className="mt-1 hidden text-sm text-gray-500 sm:block">
                View or change this user&apos;s password while impersonating. Your own password is required for security.
              </p>
              <p className="mt-1 text-xs text-gray-500 sm:hidden">
                Tap to {credentialsExpanded ? "collapse" : "manage"} password tools
              </p>
            </div>
            <ChevronDown
              className={`mt-2 h-5 w-5 shrink-0 text-gray-400 transition-transform sm:hidden ${
                credentialsExpanded ? "rotate-180" : ""
              }`}
            />
          </button>
          <button
            type="button"
            onClick={() => void loadStatus()}
            className="hidden items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 sm:inline-flex"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        <AnimatePresence initial={false}>
          {credentialsExpanded ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="space-y-4 px-4 py-4 sm:px-5 sm:py-5">
                {loading && !status ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, index) => (
                      <div key={index} className="h-10 animate-pulse rounded-xl bg-primary/5" />
                    ))}
                  </div>
                ) : error ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {error}
                  </div>
                ) : status ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          status.vault_available
                            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                            : "bg-amber-50 text-amber-800 ring-1 ring-amber-200"
                        }`}
                      >
                        {status.vault_available ? "Vault ready" : "Vault unavailable"}
                      </span>
                      {grantLabel ? (
                        <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary ring-1 ring-primary/20">
                          {grantLabel}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-600 ring-1 ring-gray-200">
                          Re-auth required to view
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => void loadStatus()}
                        className="ml-auto inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600 sm:hidden"
                      >
                        <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
                        Refresh
                      </button>
                    </div>

                    {!status.vault_available ? (
                      <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
                        Existing hashed passwords cannot be recovered. Set a new password below to enable secure viewing from then on.
                      </div>
                    ) : null}

                    <div className="rounded-2xl border border-gray-100 bg-white p-3.5 shadow-sm sm:p-4">
                      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Current password
                      </label>
                      <div className="mt-2 flex flex-col gap-2">
                        <div className="relative flex-1">
                          <input
                            readOnly
                            type={showRevealed && revealedPassword ? "text" : "password"}
                            value={revealedPassword ?? "••••••••••••"}
                            className="w-full rounded-xl border border-gray-100 bg-[#fbfdff] px-3 py-2.5 pr-12 font-mono text-sm font-semibold text-gray-900 outline-none"
                          />
                          {revealedPassword ? (
                            <button
                              type="button"
                              onClick={() => setShowRevealed((prev) => !prev)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                              aria-label={showRevealed ? "Hide password" : "Show password"}
                            >
                              {showRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          ) : null}
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                          {!revealedPassword ? (
                            <button
                              type="button"
                              disabled={!status.vault_available || revealing}
                              onClick={() => {
                                if (status.requires_reauth) {
                                  openReveal();
                                } else {
                                  void handleReveal();
                                }
                              }}
                              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-primary bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#233f7d] disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0"
                            >
                              <Eye className="h-4 w-4" />
                              {revealing ? "Revealing..." : "Reveal"}
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleCopy()}
                                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 transition hover:bg-gray-50 sm:min-h-0"
                              >
                                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                                {copied ? "Copied" : "Copy"}
                              </button>
                              <button
                                type="button"
                                onClick={handleHide}
                                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 transition hover:bg-gray-50 sm:min-h-0"
                              >
                                <Lock className="h-4 w-4" />
                                Hide
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={openChange}
                            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-primary transition hover:bg-gray-50 sm:min-h-0 sm:col-span-1"
                          >
                            <KeyRound className="h-4 w-4" />
                            Change password
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </section>

      <PortalModal
        open={revealOpen}
        onClose={closeReveal}
        title="Confirm your identity"
        description="Enter your superadmin password to view this user's credentials."
        size="md"
        preventClose={revealing}
        className="max-sm:max-h-[92vh] max-sm:rounded-t-3xl max-sm:rounded-b-none max-sm:self-end"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={closeReveal}
              disabled={revealing}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-100 bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 transition hover:bg-gray-50 disabled:opacity-50 sm:min-h-0"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleReveal()}
              disabled={revealing || !saPassword.trim()}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#233f7d] disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0"
            >
              {revealing ? "Verifying..." : "Reveal password"}
            </button>
          </div>
        }
      >
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!revealing && saPassword.trim()) void handleReveal();
          }}
        >
          {revealFeedback ? <ModalAlert feedback={revealFeedback} /> : null}

          <div className="space-y-1.5">
            <label htmlFor="impersonation-reveal-sa-password" className="text-xs font-semibold text-gray-500">
              Your superadmin password
            </label>
            <div className="relative">
              <input
                id="impersonation-reveal-sa-password"
                name="superadmin_password"
                type={showSaPassword ? "text" : "password"}
                value={saPassword}
                onChange={(event) => {
                  setSaPassword(event.target.value);
                  if (revealFeedback) setRevealFeedback(null);
                }}
                autoComplete="current-password"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                className="w-full rounded-xl border border-gray-100 bg-white px-3 py-2.5 pr-11 text-sm font-semibold text-gray-900 outline-none transition focus:border-[#4b74bf]"
                placeholder="Enter your password"
              />
              <button
                type="button"
                onClick={() => setShowSaPassword((prev) => !prev)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label={showSaPassword ? "Hide password" : "Show password"}
              >
                {showSaPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <p className="text-xs font-bold tracking-widest text-gray-500">VIEWING ACCESS</p>
              <p className="mt-1 text-sm text-gray-500">
                Choose how long password viewing stays unlocked after this confirmation.
              </p>
            </div>

            <div className="grid gap-2" role="radiogroup" aria-label="Password viewing access mode">
              {MODE_OPTIONS.map((option) => {
                const Icon = option.icon;
                const selected = mode === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setMode(option.id)}
                    className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                      selected
                        ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                        : "border-gray-100 bg-white hover:border-primary/30 hover:bg-[#fbfdff]"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        selected ? "bg-primary text-white" : "bg-[#eef3ff] text-primary"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-gray-900">{option.title}</span>
                      <span className="mt-0.5 block text-xs text-gray-500">{option.description}</span>
                    </span>
                    <span
                      className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                        selected ? "border-primary" : "border-[#b9c8e8]"
                      }`}
                    >
                      {selected ? <span className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}
                    </span>
                  </button>
                );
              })}
            </div>

            <AnimatePresence>
              {mode === "timed" ? (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="rounded-2xl border border-gray-100 bg-[#fbfdff] p-3">
                    <p className="mb-2 text-xs font-semibold text-gray-500">Duration</p>
                    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                      {DURATION_PRESETS.map((preset) => {
                        const selected = durationHours === preset.hours;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => setDurationHours(preset.hours)}
                            className={`min-h-10 rounded-full px-3 py-1.5 text-xs font-semibold transition sm:min-h-0 ${
                              selected
                                ? "bg-primary text-white"
                                : "bg-white text-gray-700 ring-1 ring-gray-200 hover:ring-primary/40"
                            }`}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true">
            Reveal password
          </button>
        </form>
      </PortalModal>

      <PortalModal
        open={changeOpen}
        onClose={closeChange}
        title="Change user password"
        description={`Set a new password for ${status?.target.name || "this user"}.`}
        size="md"
        preventClose={changing}
        className="max-sm:max-h-[92vh] max-sm:rounded-t-3xl max-sm:rounded-b-none max-sm:self-end"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={closeChange}
              disabled={changing}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-100 bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 transition hover:bg-gray-50 disabled:opacity-50 sm:min-h-0"
            >
              {changeFeedbacks.some((item) => item.type === "success") ? "Close" : "Cancel"}
            </button>
            {!changeFeedbacks.some((item) => item.type === "success") ? (
              <button
                type="button"
                onClick={() => void handleChangePassword()}
                disabled={changing}
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#233f7d] disabled:opacity-50 sm:min-h-0"
              >
                {changing ? "Saving..." : "Update password"}
              </button>
            ) : null}
          </div>
        }
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!changing && !changeFeedbacks.some((item) => item.type === "success")) {
              void handleChangePassword();
            }
          }}
        >
          {changeFeedbacks.length > 0 ? (
            <div className="space-y-2">
              {changeFeedbacks.map((feedback, index) => (
                <ModalAlert key={`${feedback.type}-${index}`} feedback={feedback} />
              ))}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label htmlFor="impersonation-change-sa-password" className="text-xs font-semibold text-gray-500">
              Your superadmin password
            </label>
            <input
              id="impersonation-change-sa-password"
              name="superadmin_password"
              type="password"
              value={changeSaPassword}
              onChange={(event) => {
                setChangeSaPassword(event.target.value);
                if (changeFeedbacks.some((item) => item.type === "error")) {
                  setChangeFeedbacks([]);
                }
              }}
              autoComplete="current-password"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="w-full rounded-xl border border-gray-100 bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none transition focus:border-[#4b74bf]"
              placeholder="Confirm it's you"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="impersonation-change-new-password" className="text-xs font-semibold text-gray-500">
              New password
            </label>
            <div className="relative">
              <input
                id="impersonation-change-new-password"
                name="new_password"
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(event) => {
                  setNewPassword(event.target.value);
                  if (changeFeedbacks.some((item) => item.type === "error")) {
                    setChangeFeedbacks([]);
                  }
                }}
                autoComplete="new-password"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="w-full rounded-xl border border-gray-100 bg-white px-3 py-2.5 pr-11 text-sm font-semibold text-gray-900 outline-none transition focus:border-[#4b74bf]"
              />
              <button
                type="button"
                onClick={() => setShowNew((prev) => !prev)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label={showNew ? "Hide new password" : "Show new password"}
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-[11px] leading-relaxed text-gray-500">
              Use 8–128 characters with upper &amp; lowercase letters, a number, and a special character. No spaces.
            </p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="impersonation-change-confirm-password" className="text-xs font-semibold text-gray-500">
              Confirm new password
            </label>
            <input
              id="impersonation-change-confirm-password"
              name="confirm_password"
              type="password"
              value={confirmPassword}
              onChange={(event) => {
                setConfirmPassword(event.target.value);
                if (changeFeedbacks.some((item) => item.type === "error")) {
                  setChangeFeedbacks([]);
                }
              }}
              autoComplete="new-password"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              className="w-full rounded-xl border border-gray-100 bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none transition focus:border-[#4b74bf]"
            />
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-gray-100 bg-[#fbfdff] px-4 py-3">
            <input
              type="checkbox"
              checked={mustChange}
              onChange={(event) => setMustChange(event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <span>
              <span className="block text-sm font-semibold text-gray-900">Require password change on next login</span>
              <span className="mt-0.5 block text-xs text-gray-500">
                Recommended after support resets so the user picks their own password.
              </span>
            </span>
          </label>

          {!changeFeedbacks.some((item) => item.type === "success") ? (
            <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true">
              Update password
            </button>
          ) : null}
        </form>
      </PortalModal>
    </>
  );
}
