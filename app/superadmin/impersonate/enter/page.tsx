"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import {
  buildImpersonationHeaders,
  persistImpersonationHandoff,
  readHandoffTokenFromHash,
  readImpersonationHandoffToken,
} from "@/app/lib/superadminImpersonationHandoff";
import { PortalPageHeader, PortalPanel } from "../../components/ui";
import { SectionLoader } from "@/app/components/Loader";

const API_BASE_URL = getFrontendApiBaseUrl();
const POLL_ATTEMPTS = 25;
const POLL_INTERVAL_MS = 300;

type SessionResponse = {
  authenticated?: boolean;
  user?: {
    userId?: number;
    role?: string;
  };
  impersonation?: {
    active?: boolean;
    target_user_id?: number;
  };
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function resolveHandoffToken(searchParams: URLSearchParams): string | null {
  const fromHash = readHandoffTokenFromHash();
  if (fromHash) return fromHash;

  const fromQuery =
    searchParams.get("handoff")?.trim() ||
    searchParams.get("token")?.trim() ||
    null;
  if (fromQuery) return fromQuery;

  if (typeof window !== "undefined") {
    const fromWindowSearch = new URLSearchParams(window.location.search);
    const fromWindowQuery =
      fromWindowSearch.get("handoff")?.trim() ||
      fromWindowSearch.get("token")?.trim() ||
      null;
    if (fromWindowQuery) return fromWindowQuery;
  }

  return readImpersonationHandoffToken();
}

async function fetchSession(handoffToken: string | null): Promise<SessionResponse | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/session`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: handoffToken ? buildImpersonationHeaders() : {},
    });
    if (!response.ok) return null;
    return (await response.json()) as SessionResponse;
  } catch {
    return null;
  }
}

async function fetchImpersonationStatus(handoffToken: string | null): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/superadmin/companies/impersonation/status`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: handoffToken ? buildImpersonationHeaders() : {},
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { success?: boolean; data?: { active?: boolean } };
    return Boolean(payload.success && payload.data?.active);
  } catch {
    return false;
  }
}

type ImpersonationReadyResult = {
  ready: boolean;
  targetRole: string;
  targetUserId: string | null;
};

async function waitForActiveImpersonation(
  handoffToken: string | null,
): Promise<ImpersonationReadyResult> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const [session, statusActive] = await Promise.all([
      fetchSession(handoffToken),
      fetchImpersonationStatus(handoffToken),
    ]);

    const impersonationReady =
      (session?.authenticated && session.impersonation?.active) || statusActive;

    if (impersonationReady) {
      // session.user.role is the target user's portal role (resolveUserPortalRole).
      // session.user.userId is the effective (impersonated) user's id.
      // session.impersonation.target_user_id is also the target.
      const targetRole = String(session?.user?.role ?? "user").toLowerCase();
      const targetUserId =
        session?.impersonation?.target_user_id != null
          ? String(session.impersonation.target_user_id)
          : session?.user?.userId != null
            ? String(session.user.userId)
            : null;
      return { ready: true, targetRole, targetUserId };
    }

    if (attempt < POLL_ATTEMPTS - 1) {
      await sleep(POLL_INTERVAL_MS);
    }
  }
  return { ready: false, targetRole: "user", targetUserId: null };
}

export default function ImpersonationEnterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const companyId = searchParams.get("companyId");
  const userMode = searchParams.get("userMode") === "true";
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const enterWorkspace = async () => {
      await sleep(50);
      if (cancelled) return;

      const handoffToken = resolveHandoffToken(searchParams);
      if (handoffToken) {
        // Persist token first; userId will be updated once session confirms.
        persistImpersonationHandoff(handoffToken, companyId ?? undefined);
      }

      const { ready, targetRole, targetUserId } = await waitForActiveImpersonation(handoffToken);
      if (cancelled) return;

      if (!ready) {
        setError(
          handoffToken
            ? "Impersonation session was not detected. The handoff timed out before the workspace could be entered."
            : "Impersonation token was not found. Please return to the user list and try again.",
        );
        return;
      }

      // Determine destination:
      // 1. companyId present → /superadmin/company/:companyId (company admin workspace)
      // 2. userMode=true     → /superadmin/user/:userId (user data workspace within superadmin shell)
      // 3. fallback          → /superadmin/company-list
      let destination: string;

      if (companyId) {
        destination = `/superadmin/company/${encodeURIComponent(companyId)}`;
      } else if (userMode) {
        // User-mode impersonation: persist the resolved userId then navigate to
        // /superadmin/user/:userId — mirroring exactly how company impersonation
        // navigates to /superadmin/company/:companyId.
        // This stays WITHIN the superadmin route tree so the superadmin layout
        // remains mounted and stable with no layout switching.
        // The [userId] page verifies the session and renders the user portal
        // content inline — just like CompanyDashboardContent is rendered at
        // /superadmin/company/:companyId.
        if (targetUserId) {
          persistImpersonationHandoff(
            handoffToken ?? "",
            undefined,
            targetUserId,
          );
          destination = `/superadmin/user/${encodeURIComponent(targetUserId)}`;
        } else {
          destination = "/superadmin/client-list";
        }
      } else {
        destination = "/superadmin/company-list";
      }

      window.location.replace(destination);
    };

    void enterWorkspace();

    return () => {
      cancelled = true;
    };
  }, [companyId, userMode, searchParams]);

  return (
    <section className="space-y-5 sm:space-y-6">
      <PortalPageHeader
        title={userMode ? "Entering User Workspace" : "Entering Company Workspace"}
        subtitle={
          userMode
            ? "Confirming impersonation session before opening the user workspace."
            : companyId
            ? `Confirming impersonation session for company ${companyId} before opening the company module.`
            : "Confirming impersonation session before opening the company module."
        }
      />

      <PortalPanel>
        {error ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
            <button
              type="button"
              onClick={() => router.push(userMode ? "/superadmin/client-list" : "/superadmin/company-list")}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-gray-50"
            >
              {userMode ? "Back to User List" : "Back to Company List"}
            </button>
          </div>
        ) : (
          <SectionLoader
            text={userMode ? "Preparing user workspace..." : "Preparing company workspace..."}
            minHeightClass="min-h-40"
          />
        )}
      </PortalPanel>
    </section>
  );
}
