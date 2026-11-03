"use client";

import { cn } from "@/lib/utils";

export type PortalBadgeVariant =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral"
  | "primary";

const variantClasses: Record<PortalBadgeVariant, string> = {
  success: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warning: "bg-amber-50 text-amber-700 border-amber-200",
  danger: "bg-rose-50 text-rose-700 border-rose-200",
  info: "bg-sky-50 text-sky-700 border-sky-200",
  neutral: "bg-gray-100 text-gray-600 border-gray-200",
  primary: "bg-primary/10 text-primary border-primary/20",
};

type PortalBadgeProps = {
  children: React.ReactNode;
  variant?: PortalBadgeVariant;
  className?: string;
};

export function PortalBadge({
  children,
  variant = "neutral",
  className,
}: PortalBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function statusToBadgeVariant(
  status: string | null | undefined,
): PortalBadgeVariant {
  const s = (status ?? "").toLowerCase();
  if (
    ["active", "completed", "paid", "approved", "confirmed", "settled"].includes(
      s,
    )
  ) {
    return "success";
  }
  if (
    ["pending", "processing", "invited", "draft", "pending_payment"].includes(s)
  ) {
    return "warning";
  }
  if (
    [
      "failed",
      "cancelled",
      "suspended",
      "rejected",
      "inactive",
      "expired",
      "voided",
      "payment_failed",
    ].includes(s)
  ) {
    return s === "inactive" ? "neutral" : "danger";
  }
  return "info";
}
