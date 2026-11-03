"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, ShieldCheck } from "lucide-react";
import { InlineLoader } from "@/app/components/Loader";
import { csrfClient } from "@/lib/csrf-client";

const STAFF_VERIFY_API = "/api/staff/verify";

interface InvitePreview {
  email: string;
  firstName: string;
  lastName: string;
}

function StaffVerifyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  const [loadingPreview, setLoadingPreview] = useState(true);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function validateToken() {
      if (!token) {
        setPreviewError("Missing verification token. Please use the link from your invitation email.");
        setLoadingPreview(false);
        return;
      }

      setLoadingPreview(true);
      setPreviewError(null);
      try {
        const response = await fetch(
          `${STAFF_VERIFY_API}?token=${encodeURIComponent(token)}`,
          { credentials: "include", cache: "no-store" },
        );
        const payload = await response.json().catch(() => null);
        if (cancelled) return;

        if (!response.ok || !payload?.success || !payload?.data) {
          const message =
            payload?.error?.message ??
            payload?.message ??
            "This verification link is invalid or has expired.";
          setPreviewError(message);
          setPreview(null);
          return;
        }

        setPreview(payload.data as InvitePreview);
      } catch {
        if (!cancelled) {
          setPreviewError("Unable to validate your verification link. Please try again.");
        }
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    }

    void validateToken();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);

    if (!token) {
      setSubmitError("Missing verification token.");
      return;
    }

    if (password !== confirmPassword) {
      setSubmitError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const csrfToken = await csrfClient.getToken(false);
      const headers = new Headers({ "Content-Type": "application/json" });
      if (csrfToken) {
        headers.set("X-CSRF-Token", csrfToken);
      }

      const response = await fetch(STAFF_VERIFY_API, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({
          token,
          new_password: password,
          confirm_password: confirmPassword,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          payload?.error?.message ?? payload?.message ?? "Failed to create your password.",
        );
      }

      const user = payload?.data?.user;
      if (user && typeof window !== "undefined") {
        try {
          localStorage.setItem(
            "authUser",
            JSON.stringify({
              userId: user.userId,
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
              role: user.role,
            }),
          );
        } catch {
          // ignore localStorage errors
        }
      }

      router.replace("/staff/dashboard");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to create your password.");
    } finally {
      setSubmitting(false);
    }
  }

  const displayName = preview
    ? [preview.firstName, preview.lastName].filter(Boolean).join(" ").trim() || preview.email
    : "";

  return (
    <div className="min-h-screen bg-[#F4F7FC] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white rounded-3xl border border-gray-100 shadow-xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-11 w-11 rounded-xl bg-[#E8F0FC] flex items-center justify-center">
            <ShieldCheck className="h-5 w-5 text-[#2A4792]" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-gray-900">Verify your account</h1>
            <p className="text-sm text-gray-500">Set your password to activate your staff account.</p>
          </div>
        </div>

        {loadingPreview ? (
          <div className="flex justify-center py-10">
            <InlineLoader />
          </div>
        ) : previewError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {previewError}
          </div>
        ) : (
          <>
            <div className="mb-5 rounded-xl border border-[#D9E6F8] bg-[#F8FAFD] px-4 py-3 text-sm text-[#2A4792]">
              <p className="font-semibold">{displayName}</p>
              <p className="text-[#4785B8] mt-1">{preview?.email}</p>
            </div>

            {submitError && (
              <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {submitError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="password" className="block text-sm font-semibold text-gray-700 mb-1.5">
                  New password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full rounded-xl border border-gray-200 pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#4785B8]/30"
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor="confirmPassword"
                  className="block text-sm font-semibold text-gray-700 mb-1.5"
                >
                  Confirm password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="w-full rounded-xl border border-gray-200 pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#4785B8]/30"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-[#2A4792] py-3 text-sm font-bold text-white hover:bg-[#3B569F] disabled:opacity-60 transition-colors inline-flex items-center justify-center gap-2"
              >
                {submitting ? <InlineLoader /> : null}
                Create password &amp; continue
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function StaffVerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#F4F7FC] flex items-center justify-center">
          <InlineLoader />
        </div>
      }
    >
      <StaffVerifyContent />
    </Suspense>
  );
}
