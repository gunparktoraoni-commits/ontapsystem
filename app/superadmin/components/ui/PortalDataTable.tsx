"use client";

import { cn } from "@/lib/utils";
import { SkeletonLoader } from "@/app/components/Loader";
import { PortalEmptyState } from "./PortalEmptyState";

type PortalDataTableProps = {
  children: React.ReactNode;
  className?: string;
  loading?: boolean;
  skeletonRows?: number;
  skeletonCols?: number;
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
};

export function PortalDataTable({
  children,
  className,
  loading = false,
  skeletonRows = 5,
  skeletonCols = 5,
  empty = false,
  emptyTitle = "No records found",
  emptyDescription,
  emptyAction,
}: PortalDataTableProps) {
  if (empty && !loading) {
    return (
      <PortalEmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  return (
    <div className={cn("overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm", className)}>
      <table className="w-full min-w-[640px] text-left text-sm">
        {loading ? (
          <tbody>
            {Array.from({ length: skeletonRows }).map((_, row) => (
              <tr key={`sk-${row}`} className="border-b border-gray-50">
                {Array.from({ length: skeletonCols }).map((__, col) => (
                  <td key={`sk-${row}-${col}`} className="px-4 py-4">
                    <SkeletonLoader height="h-4" className="bg-gray-100" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ) : (
          children
        )}
      </table>
    </div>
  );
}

export function PortalTableHead({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <thead
      className={cn(
        "sticky top-0 z-10 bg-gray-50/95 text-xs uppercase text-gray-400 backdrop-blur-sm",
        className,
      )}
    >
      {children}
    </thead>
  );
}

export function PortalTableBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <tbody className={cn("divide-y divide-gray-50", className)}>{children}</tbody>;
}

export function PortalTableRow({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <tr
      className={cn(
        "transition-colors hover:bg-gray-50/80",
        onClick && "cursor-pointer",
        className,
      )}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

export function PortalTableCell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={cn("px-4 py-3.5 text-gray-700", className)}>{children}</td>;
}

export function PortalTableHeaderCell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={cn("px-4 py-3 font-medium whitespace-nowrap", className)}>
      {children}
    </th>
  );
}
