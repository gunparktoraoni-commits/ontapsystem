"use client";

import React, { createContext, useContext } from "react";
import {
  usePortalPageAccess,
  type PortalPageAccessItem,
} from "@/app/hooks/usePortalPageAccess";
import type { PortalPageScope } from "@/lib/portal/page-controls";

type PortalPageAccessContextValue = ReturnType<typeof usePortalPageAccess>;

const PortalPageAccessContext = createContext<PortalPageAccessContextValue | null>(
  null,
);

export function PortalPageAccessProvider({
  portal,
  children,
}: {
  portal: PortalPageScope;
  children: React.ReactNode;
}) {
  const value = usePortalPageAccess(portal);
  return (
    <PortalPageAccessContext.Provider value={value}>
      {children}
    </PortalPageAccessContext.Provider>
  );
}

export function usePortalPageAccessContext(): PortalPageAccessContextValue {
  const ctx = useContext(PortalPageAccessContext);
  if (!ctx) {
    throw new Error(
      "usePortalPageAccessContext must be used within PortalPageAccessProvider",
    );
  }
  return ctx;
}

/** Safe variant for optional use (returns null outside provider). */
export function useOptionalPortalPageAccess(): PortalPageAccessContextValue | null {
  return useContext(PortalPageAccessContext);
}

export type { PortalPageAccessItem };
