"use client";

import { cn } from "@/lib/utils";
import {
  DASHBOARD_CARD_SHELL,
  DASHBOARD_GLASS_STYLE,
  DASHBOARD_TITLE_CLASS,
  PORTAL_PANEL_SHELL,
} from "./portalTokens";

type PortalPanelProps = {
  children: React.ReactNode;
  className?: string;
  title?: string;
  action?: React.ReactNode;
  padding?: "sm" | "md" | "lg";
  /** `glass` applies the dashboard Total Users glassmorphism shell */
  variant?: "default" | "glass";
};

const paddingMap = {
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
};

export function PortalPanel({
  children,
  className,
  title,
  action,
  padding = "md",
  variant = "default",
}: PortalPanelProps) {
  const isGlass = variant === "glass";

  return (
    <section
      className={cn(
        isGlass ? DASHBOARD_CARD_SHELL : PORTAL_PANEL_SHELL,
        "flex flex-col",
        paddingMap[padding],
        className,
      )}
      style={isGlass ? DASHBOARD_GLASS_STYLE : undefined}
    >
      {(title || action) && (
        <div className="relative z-10 mb-4 flex flex-wrap items-center justify-between gap-3">
          {title ? (
            <h3
              className={
                isGlass
                  ? DASHBOARD_TITLE_CLASS
                  : "text-lg font-extrabold tracking-tight text-gray-900"
              }
            >
              {title}
            </h3>
          ) : (
            <span />
          )}
          {action}
        </div>
      )}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}
