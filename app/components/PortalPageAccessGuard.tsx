"use client";

import React, { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Construction, X } from "lucide-react";
import { ModalPortal } from "@/app/components/ModalPortal";
import { SectionLoader } from "@/app/components/Loader";
import { usePortalPageAccessContext } from "@/app/components/PortalPageAccessProvider";
import type { PortalPageScope } from "@/lib/portal/page-controls";
import { PORTAL_PAGE_SCOPE_LABELS } from "@/lib/portal/page-controls";

type PortalPageAccessGuardProps = {
  portal: PortalPageScope;
  children: React.ReactNode;
  fallbackHref?: string;
};

/**
 * Blocks access to portal pages toggled off in Dev Controls and shows
 * a maintenance modal. Must sit under PortalPageAccessProvider.
 */
export function PortalPageAccessGuard({
  portal,
  children,
  fallbackHref,
}: PortalPageAccessGuardProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { getBlockedPage, firstAccessibleHref, loading } =
    usePortalPageAccessContext();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  const blocked = useMemo(() => {
    if (loading) return null;
    return getBlockedPage(pathname);
  }, [getBlockedPage, loading, pathname]);

  useEffect(() => {
    setDismissedKey(null);
  }, [pathname]);

  const showModal = Boolean(blocked) && blocked?.key !== dismissedKey;
  const safeHref =
    firstAccessibleHref && firstAccessibleHref !== blocked?.href
      ? firstAccessibleHref
      : (fallbackHref ?? null);

  const leavePage = () => {
    if (safeHref) {
      router.replace(safeHref);
      return;
    }
    router.replace("/");
  };

  return (
    <>
      {loading ? (
        <SectionLoader text="Checking page access..." />
      ) : blocked ? (
        <div className="flex min-h-[50vh] flex-col items-center justify-center px-6 py-16 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
            <Construction className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Under maintenance</h1>
          <p className="mt-2 max-w-md text-sm text-gray-600">
            <span className="font-semibold text-gray-800">{blocked.label}</span> in the{" "}
            {PORTAL_PAGE_SCOPE_LABELS[portal].toLowerCase()} is temporarily unavailable.
          </p>
          <p className="mt-2 max-w-md text-sm text-gray-500">{blocked.description}</p>
          {safeHref ? (
            <button
              type="button"
              onClick={leavePage}
              className="mt-6 rounded-xl bg-[#2A4792] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#243f82]"
            >
              Go to an available page
            </button>
          ) : null}
        </div>
      ) : (
        children
      )}

      <ModalPortal isOpen={showModal} onClose={() => setDismissedKey(blocked?.key ?? null)}>
        <div className="mx-4 w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl animate-fade-in-up">
          <div className="flex items-center gap-2.5 border-b border-gray-100 px-6 pt-5 pb-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500">
              <Construction className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-gray-900">Page under maintenance</h2>
              <p className="truncate text-xs text-gray-500">{blocked?.label}</p>
            </div>
            <button
              type="button"
              onClick={() => setDismissedKey(blocked?.key ?? null)}
              className="ml-auto flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-3 px-6 py-5">
            <p className="text-sm text-gray-700">
              <span className="font-semibold">{blocked?.label}</span> is currently turned off
              for the {PORTAL_PAGE_SCOPE_LABELS[portal].toLowerCase()}. Please try again later.
            </p>
            {blocked?.description ? (
              <p className="text-sm text-gray-500">{blocked.description}</p>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-gray-100 bg-gray-50/50 px-6 py-4">
            <button
              type="button"
              onClick={() => setDismissedKey(blocked?.key ?? null)}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-100"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={leavePage}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors"
              style={{ background: "linear-gradient(135deg,#2A4792,#4785B8)" }}
            >
              {safeHref ? "Go elsewhere" : "Leave portal"}
            </button>
          </div>
        </div>
      </ModalPortal>
    </>
  );
}
