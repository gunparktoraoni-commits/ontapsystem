"use client";

import { cn } from "@/lib/utils";

type PortalMobileCardProps = {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
};

export function PortalMobileCardList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 md:hidden", className)}>{children}</div>
  );
}

export function PortalMobileCard({
  children,
  className,
  onClick,
}: PortalMobileCardProps) {
  return (
    <article
      className={cn(
        "rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition-shadow hover:shadow-md",
        onClick && "cursor-pointer",
        className,
      )}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") onClick();
            }
          : undefined
      }
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </article>
  );
}

export function PortalMobileCardRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="shrink-0 text-gray-500">{label}</span>
      <span className="text-right font-medium text-gray-900">{value}</span>
    </div>
  );
}
