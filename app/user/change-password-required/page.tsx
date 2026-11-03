"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock, ShieldCheck } from "lucide-react";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import { FullPageLoader } from "@/app/components/Loader";
import { csrfClient } from "@/lib/csrf-client";

const POST_CHANGE_REDIRECT_KEY = "post_password_change_redirect";

function apiUrl(path: string): string {
  const base = getFrontendApiBaseUrl().replace(/\/+$/, "");
  const safePath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${safePath}`;
}

function validatePasswordClient(value: string): string | null {
  if (value.length < 8) return "Password must be at least 8 characters.";
  if (!/[a-z]/.test(value)) return "Include at least one lowercase letter.";
  if (!/[A-Z]/.test(value)) return "Include at least one uppercase letter.";
  if (!/[0-9]/.test(value)) return "Include at least one number.";
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(value)) {
    return "Include at least one special character.";
  }
  return null;
}

export default function ChangePasswordRequiredPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const strengthHint = useMemo(() => validatePasswordClient(newPassword), [newPassword]);

  useEffect(() => {
    let cancelled = false;
    async function ensureRequired() {
      try {
        // Warm CSRF cookie early so submit does not race token issuance.
        void csrfClient.getToken(false, getFrontendApiBaseUrl() || undefined);

        const res = await fetch(apiUrl("/api/auth/session"), {
          credentials: "include",
          cache: "no-store",
        });
        const data = await res.json().catch(() => null);
        if (cancelled) return;

        if (!res.ok || !data?.authenticated) {
          router.replace("/");
          return;
        }

        if (!data.user?.requiresPasswordChange) {
          const role = String(data.user?.role ?? "user").toLowerCase();
          const fallback =
            role === "company_admin" || role === "admin" || role === "manager"
              ? "/admin/dashboard"
              : "/user/dashboard";
          router.replace(fallback);
          return;
        }

        setEmail(String(data.user?.email ?? ""));
        setChecking(false);
      } catch {
        if (!cancelled) router.replace("/");
      }
    }
    void ensureRequired();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const policyError = validatePasswordClient(newPassword);
    if (policyError) {
      setError(policyError);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Password confirmation does not match.");
      return;
    }

    setSubmitting(true);
    try {
      const apiBase = getFrontendApiBaseUrl();
      let csrfToken = await csrfClient.getToken(false, apiBase || undefined);
      if (!csrfToken) {
        csrfToken = await csrfClient.getToken(true, apiBase || undefined);
      }

      const postForceChange = async (token: string | null) =>
        fetch(apiUrl("/api/user/password/force-change"), {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(token
              ? {
                  "X-CSRF-Token": token,
                  "x-csrf-token": token,
                }
              : {}),
          },
          body: JSON.stringify({
            new_password: newPassword,
            confirm_password: confirmPassword,
          }),
        });

      let response = await postForceChange(csrfToken);
      if (response.status === 403) {
        const failed = await response.clone().json().catch(() => null);
        const code = String(failed?.code ?? "").toUpperCase();
        if (code === "CSRF_TOKEN_INVALID") {
          const freshToken = await csrfClient.getToken(true, apiBase || undefined);
          response = await postForceChange(freshToken);
        }
      }

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        const details = Array.isArray(payload?.details) ? payload.details.join(" ") : "";
        throw new Error(payload?.error || details || "Unable to update password.");
      }

      const storedRedirect =
        typeof window !== "undefined"
          ? sessionStorage.getItem(POST_CHANGE_REDIRECT_KEY) ||
            sessionStorage.getItem("post_login_redirect")
          : null;
      sessionStorage.removeItem(POST_CHANGE_REDIRECT_KEY);
      sessionStorage.removeItem("post_login_redirect");

      router.replace(storedRedirect || "/user/dashboard");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to update password.");
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-[#F4F7FC]">
        <FullPageLoader text="Preparing secure password update..." />
      </div>
    );
  }

  return (
    <main className="min-h-screen w-full bg-[#F4F7FC] px-4 py-10 flex items-center justify-center">
      <div className="w-full max-w-md rounded-3xl border border-gray-100 bg-white p-6 sm:p-8 shadow-xl shadow-black/5">
        <div className="mb-6 flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Set a new password</h1>
            <p className="mt-1 text-sm text-gray-500">
              Your account password was reset by support. Choose a new password before continuing
              {email ? (
                <>
                  {" "}
                  for <span className="font-semibold text-gray-700">{email}</span>
                </>
              ) : null}
              .
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-semibold text-gray-700">New password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <input
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(event) => {
                  setError(null);
                  setNewPassword(event.target.value);
                }}
                className="w-full rounded-xl border border-gray-300 py-3 pl-11 pr-11 text-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowNew((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label={showNew ? "Hide password" : "Show password"}
              >
                {showNew ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
            {newPassword && strengthHint ? (
              <p className="mt-1.5 text-xs font-medium text-amber-700">{strengthHint}</p>
            ) : null}
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-gray-700">Confirm password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <input
                type={showConfirm ? "text" : "password"}
                value={confirmPassword}
                onChange={(event) => {
                  setError(null);
                  setConfirmPassword(event.target.value);
                }}
                className="w-full rounded-xl border border-gray-300 py-3 pl-11 pr-11 text-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirm((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label={showConfirm ? "Hide password" : "Show password"}
              >
                {showConfirm ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>

          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex w-full items-center justify-center rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#233f7d] disabled:opacity-60"
          >
            {submitting ? "Saving..." : "Save password & continue"}
          </button>
        </form>

        <p className="mt-4 text-xs text-gray-500">
          Use at least 8 characters with upper and lowercase letters, a number, and a special character.
        </p>
      </div>
    </main>
  );
}
