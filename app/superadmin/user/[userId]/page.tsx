"use client";

/**
 * /superadmin/user/[userId]
 *
 * User-mode impersonation workspace — mirrors the company impersonation pattern
 * at /superadmin/company/[companyId]/page.tsx exactly.
 *
 * The Super Admin stays WITHIN the /superadmin/* route tree so the superadmin
 * layout (sidebar, portal header, impersonation banner) remains mounted and
 * stable — no layout switching, no routing loops.
 *
 * After verifying the impersonation session is active, this page renders the
 * user portal content sections as tabs inline, giving the Super Admin full
 * access to every part of the impersonated user's portal:
 *   - Dashboard
 *   - BizCard List
 *   - BizCard Editor (vCard, Design, Services, Social, More Preferences)
 *   - Settings
 *   - Analytics
 *   - Affiliate
 */

import { useCallback, useEffect, useState } from "react";
import type { ComponentType } from "react";
import { useParams, useRouter } from "next/navigation";
import { LayoutDashboard, CreditCard, Pencil, Settings as SettingsIcon } from "lucide-react";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import { SectionLoader, InlineLoader } from "@/app/components/Loader";
import {
  buildImpersonationHeaders,
  readImpersonationUserId,
} from "@/app/lib/superadminImpersonationHandoff";
import { PortalPageHeader, PortalPanel } from "../../components/ui";
import { ImpersonationPasswordPanel } from "./components/ImpersonationPasswordPanel";

// ── User portal content components ───────────────────────────────────────────
// Imported directly — same components the real user portal uses.
// Because the impersonation token is active, every API call they make will
// resolve to the impersonated user's data (the session endpoint returns the
// target user's effective userId).
import DashboardContent from "@/app/components/DashboardContent";
import BizCardList from "@/app/components/BizCardList";
import Settings from "@/app/components/Settings";

const API_BASE_URL = getFrontendApiBaseUrl();

type SessionResponse = {
  authenticated?: boolean;
  user?: { userId?: number; firstName?: string; lastName?: string; email?: string };
  impersonation?: { active?: boolean; target_user_id?: number };
};

type TabId = "dashboard" | "bizcards" | "bizcard" | "settings";

const TABS: {
  id: TabId;
  label: string;
  shortLabel: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { id: "dashboard", label: "Dashboard", shortLabel: "Home", icon: LayoutDashboard },
  { id: "bizcards", label: "BizCard List", shortLabel: "Cards", icon: CreditCard },
  { id: "bizcard", label: "Edit BizCard", shortLabel: "Edit", icon: Pencil },
  { id: "settings", label: "Settings", shortLabel: "Settings", icon: SettingsIcon },
];

export default function SuperadminImpersonatedUserPage() {
  const router = useRouter();
  const params = useParams();
  const routeUserId = String(params.userId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [userName, setUserName] = useState<string>("");
  const [userEmail, setUserEmail] = useState<string>("");

  const verifyImpersonationContext = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReady(false);

    try {
      const sessionRes = await fetch(`${API_BASE_URL}/api/auth/session`, {
        credentials: "include",
        cache: "no-store",
        headers: buildImpersonationHeaders(),
      });

      const session = (await sessionRes.json()) as SessionResponse;

      if (!session.authenticated || !session.impersonation?.active) {
        router.replace("/superadmin/client-list");
        return;
      }

      // Confirm the route userId matches the impersonation target
      const storedUserId = readImpersonationUserId();
      const targetUserId = session.impersonation.target_user_id != null
        ? String(session.impersonation.target_user_id)
        : storedUserId;

      if (routeUserId && targetUserId && routeUserId !== targetUserId) {
        // Mismatch — redirect to correct user route
        router.replace(`/superadmin/user/${encodeURIComponent(targetUserId)}`);
        return;
      }

      // Resolve display name from the session (session returns the target user's data)
      const firstName = String(session.user?.firstName ?? "").trim();
      const lastName = String(session.user?.lastName ?? "").trim();
      const name = [firstName, lastName].filter(Boolean).join(" ") || session.user?.email || "User";
      setUserName(name);
      setUserEmail(String(session.user?.email ?? "").trim());

      setReady(true);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to load impersonated user workspace.",
      );
    } finally {
      setLoading(false);
    }
  }, [routeUserId, router]);

  useEffect(() => {
    void verifyImpersonationContext();
  }, [verifyImpersonationContext]);

  return (
    <section className="flex h-full min-h-0 flex-col space-y-0">
      <div className="mb-3 shrink-0 sm:mb-4">
        <PortalPageHeader
          title={userName ? `Impersonating: ${userName}` : "User Workspace"}
          subtitle={
            userEmail
              ? `${userEmail} · full user portal access`
              : "Super Admin impersonation — full user portal access."
          }
          className="[&_h2]:text-xl sm:[&_h2]:text-3xl"
        />
      </div>

      {loading ? (
        <PortalPanel>
          <SectionLoader text="Loading user workspace..." />
        </PortalPanel>
      ) : error ? (
        <PortalPanel>
          <div className="space-y-4">
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
            <button
              type="button"
              onClick={() => router.push("/superadmin/client-list")}
              className="min-h-11 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-primary hover:bg-gray-50 sm:min-h-0"
            >
              Back to User List
            </button>
          </div>
        </PortalPanel>
      ) : ready ? (
        <div className="flex min-h-0 flex-1 flex-col pb-20 sm:pb-0">
          <ImpersonationPasswordPanel userId={routeUserId} />

          {/* Desktop / tablet tab strip */}
          <div className="mb-4 hidden shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-white sm:block">
            <div className="flex overflow-x-auto" style={{ scrollbarWidth: "none" }}>
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3.5 text-sm font-semibold transition-colors sm:px-6 ${
                    activeTab === tab.id
                      ? "border-primary text-primary"
                      : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                  }`}
                >
                  <tab.icon className="h-4 w-4" />
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tab content */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {activeTab === "dashboard" && <DashboardContent />}
            {activeTab === "bizcards" && (
              <div className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm sm:p-6">
                <BizCardList />
              </div>
            )}
            {activeTab === "bizcard" && (
              <div
                className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm"
                style={{ height: "min(70vh, calc(100vh - 220px))" }}
              >
                <BizCardPageEmbed />
              </div>
            )}
            {activeTab === "settings" && (
              <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                <Settings />
              </div>
            )}
          </div>

          {/* Mobile bottom navigation */}
          <nav
            className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur sm:hidden"
            aria-label="Impersonation sections"
          >
            <div className="grid grid-cols-4 gap-1">
              {TABS.map((tab) => {
                const active = activeTab === tab.id;
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] font-semibold transition ${
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                    }`}
                  >
                    <Icon className="h-4.5 w-4.5" />
                    {tab.shortLabel}
                  </button>
                );
              })}
            </div>
          </nav>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Lazy-loads BizCardPage — it has a large dependency tree (tabs, forms, media
 * upload) so we embed it only when the BizCard tab is active. We cannot import
 * app/user/bizcard/page.tsx directly (it uses useSearchParams which requires
 * Suspense) so we inline it via a dynamic import boundary.
 */
function BizCardPageEmbed() {
  const [BizCardPage, setBizCardPage] = useState<ComponentType | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    import("@/app/user/bizcard/BizCardPage")
      .then((mod) => setBizCardPage(() => mod.BizCardPage as React.ComponentType))
      .catch(() => setLoadError(true));
  }, []);

  if (loadError) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-rose-600">
        Failed to load BizCard editor.
      </div>
    );
  }

  if (!BizCardPage) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
        <InlineLoader /> Loading BizCard editor...
      </div>
    );
  }

  return <BizCardPage />;
}
