"use client";

import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

type PortalEmptyStateProps = {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  className?: string;
};

export function PortalEmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  className,
}: PortalEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-12 text-center shadow-sm",
        className,
      )}
    >
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Icon className="h-7 w-7" />
      </div>
      <h3 className="text-base font-bold text-gray-900">{title}</h3>
      {description ? (
        <p className="mt-2 max-w-sm text-sm text-gray-500">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
