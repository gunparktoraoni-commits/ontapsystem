"use client";

import { cn } from "@/lib/utils";

type PortalPageHeaderProps = {
  title: string;
  titleClassName?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
};

export function PortalPageHeader({
  title,
  titleClassName,
  subtitle,
  actions,
  className,
}: PortalPageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div>
        <h2
          className={cn(
            "text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl",
            titleClassName,
          )}
        >
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-1 text-sm font-medium text-gray-500">{subtitle}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
