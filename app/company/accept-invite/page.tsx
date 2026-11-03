"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Mail } from "lucide-react";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import { FullPageLoader, InlineLoader } from "@/app/components/Loader";
import { csrfClient } from "@/lib/csrf-client";

const API_BASE_URL = getFrontendApiBaseUrl();

type InvitePreview = {
  email: string;
  company_name: string;
  role: string;
  expires_at: string;
};

function buildAcceptReturnPath(token: string): string {
  return `/company/accept-invite?token=${encodeURIComponent(token)}`;
}

function AcceptInviteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  const [loadingPreview, setLoadingPreview] = useState(true);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const autoAcceptAttempted = useRef(false);

  const acceptReturnPath = token ? buildAcceptReturnPath(token) : "/company/accept-invite";
  const loginHref = `/?redirect=${encodeURIComponent(acceptReturnPath)}`;
  const signupHref = `/user/signup?redirect=${encodeURIComponent(acceptReturnPath)}`;

  const handleAccept = useCallback(
    async (options?: { silentAuthRedirect?: boolean }) => {
      if (!token) {
        setAcceptError("Missing invitation token.");
        return { ok: false as const, reason: "missing_token" as const };
      }

      setAccepting(true);
      setAcceptError(null);

      try {
        const csrfToken = await csrfClient.getToken();
        const response = await fetch(`${API_BASE_URL}/api/company/invitations/accept`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
          },
          body: JSON.stringify({ token }),
        });

        const payload = await response.json().catch(() => null);

        if (response.status === 401) {
          setNeedsAuth(true);
          if (!options?.silentAuthRedirect) {
            router.push(loginHref);
          }
          return { ok: false as const, reason: "unauthorized" as const };
        }

        if (!response.ok || !payload?.success) {
          const message =
            payload?.error?.message ??
            payload?.message ??
            "Unable to accept this invitation.";
          setAcceptError(message);
          return { ok: false as const, reason: "failed" as const };
        }

        const redirectPath =
          typeof payload.data?.redirect_path === "string"
            ? payload.data.redirect_path
            : "/user/dashboard";

        router.replace(redirectPath);
        return { ok: true as const };
      } catch {
        setAcceptError("Unable to accept this invitation. Please try again.");
        return { ok: false as const, reason: "failed" as const };
      } finally {
        setAccepting(false);
      }
    },
    [loginHref, router, token],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      if (!token) {
        setPreviewError(
          "Missing invitation token. Please use the link from your invitation email.",
        );
        setLoadingPreview(false);
        return;
      }

      setLoadingPreview(true);
      setPreviewError(null);

      try {
        const response = await fetch(
          `${API_BASE_URL}/api/company/invitations/verify?token=${encodeURIComponent(token)}`,
          { credentials: "include", cache: "no-store" },
        );
        const payload = await response.json().catch(() => null);
        if (cancelled) return;

        if (!response.ok || !payload?.success || !payload?.data) {
          const message =
            payload?.error?.message ??
            payload?.message ??
            "This invitation link is invalid or has expired.";
          setPreviewError(message);
          setPreview(null);
          return;
        }

        setPreview(payload.data as InvitePreview);
      } catch {
        if (!cancelled) {
          setPreviewError("Unable to validate your invitation link. Please try again.");
        }
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    }

    void loadPreview();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (loadingPreview || previewError || !preview || !token) return;
    if (autoAcceptAttempted.current) return;
    autoAcceptAttempted.current = true;
    void handleAccept({ silentAuthRedirect: true });
  }, [handleAccept, loadingPreview, preview, previewError, token]);

  return (
    <div className="min-h-screen bg-[#F4F7FC] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-8 shadow-xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#e8f0ff] text-[#2A4792]">
            <Building2 className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Company Invitation</h1>
          <p className="mt-2 text-sm text-gray-500">
            Review and accept your invitation to join a company workspace.
          </p>
        </div>

        {loadingPreview || (accepting && !needsAuth && !acceptError) ? (
          <FullPageLoader
            text={accepting ? "Joining company..." : "Loading invitation..."}
          />
        ) : previewError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {previewError}
          </div>
        ) : preview ? (
          <div className="space-y-5">
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4 space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Company
                </p>
                <p className="text-lg font-bold text-gray-900">{preview.company_name}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Invited email
                </p>
                <p className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <Mail className="h-4 w-4 text-gray-400" />
                  {preview.email}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Role
                </p>
                <p className="text-sm capitalize text-gray-700">{preview.role}</p>
              </div>
            </div>

            {acceptError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {acceptError}
              </div>
            )}

            <button
              type="button"
              onClick={() => void handleAccept()}
              disabled={accepting}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#2A4792] text-sm font-bold text-white transition-colors hover:bg-[#1a3375] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {accepting && <InlineLoader />}
              {needsAuth ? "Sign in to Accept" : "Accept Invitation"}
            </button>

            <p className="text-center text-xs text-gray-500">
              You must sign in with <span className="font-semibold">{preview.email}</span> to
              accept this invitation.
            </p>
            <p className="rounded-xl border border-[#dce8ff] bg-[#f5f8ff] px-3 py-2 text-center text-xs leading-relaxed text-[#2a3c71]">
              After you join, complete your BizCard profile from your dashboard. Your company
              admin can also manage your profile and link a physical NFC card later.
            </p>
            <p className="text-center text-xs text-gray-500">
              No account?{" "}
              <Link href={signupHref} className="font-semibold text-[#2A4792] hover:underline">
                Sign up
              </Link>
              {" · "}
              <Link href={loginHref} className="font-semibold text-[#2A4792] hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function AcceptCompanyInvitePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#F4F7FC] flex items-center justify-center">
          <InlineLoader />
        </div>
      }
    >
      <AcceptInviteContent />
    </Suspense>
  );
}
