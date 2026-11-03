"use client";

import { motion } from "framer-motion";
import { Minus, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DASHBOARD_ACCENT,
  DASHBOARD_CARD_SHELL,
  DASHBOARD_GLASS_STYLE,
} from "./portalTokens";

type PortalStatCardProps = {
  label: string;
  value: string;
  delta?: string | null;
  icon: LucideIcon | React.ComponentType<{ className?: string }>;
  accent?: string;
  loading?: boolean;
  className?: string;
  onClick?: () => void;
  active?: boolean;
  hint?: string;
};

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "").trim();
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((c) => c + c)
          .join("")
      : normalized.padEnd(6, "0").slice(0, 6);
  return {
    r: Number.parseInt(full.slice(0, 2), 16) || 0,
    g: Number.parseInt(full.slice(2, 4), 16) || 0,
    b: Number.parseInt(full.slice(4, 6), 16) || 0,
  };
}

function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function TrendPill({ delta }: { delta: string | null | undefined }) {
  if (!delta) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400">
        <Minus className="h-3 w-3" />
        No change
      </span>
    );
  }
  const positive = delta.startsWith("+");
  const negative = delta.startsWith("-");
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold backdrop-blur-sm"
      style={{
        background: positive
          ? "rgba(52,211,153,0.18)"
          : negative
            ? "rgba(248,113,113,0.18)"
            : "rgba(148,163,184,0.14)",
        color: positive ? "#6ee7b7" : negative ? "#fca5a5" : "#cbd5e1",
        border: `1px solid ${
          positive
            ? "rgba(52,211,153,0.35)"
            : negative
              ? "rgba(248,113,113,0.35)"
              : "rgba(148,163,184,0.25)"
        }`,
      }}
    >
      {positive ? (
        <TrendingUp className="h-3 w-3" />
      ) : negative ? (
        <TrendingDown className="h-3 w-3" />
      ) : (
        <Minus className="h-3 w-3" />
      )}
      {delta}
    </span>
  );
}

export function PortalStatCard({
  label,
  value,
  delta,
  icon: Icon,
  accent = DASHBOARD_ACCENT,
  loading = false,
  className,
  onClick,
  active = false,
  hint,
}: PortalStatCardProps) {
  const interactive = typeof onClick === "function";

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      whileHover={{ y: -3 }}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? active : undefined}
      title={hint}
      className={cn(
        DASHBOARD_CARD_SHELL,
        "group flex h-full flex-col p-5 sm:p-6",
        "transition-[box-shadow,transform] duration-300",
        "hover:shadow-[0_16px_36px_var(--stat-glow),0_0_0_1px_var(--stat-ring),inset_0_1px_0_rgba(255,255,255,0.12)]",
        interactive && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-white/70",
        active && "ring-2 ring-white/70 ring-offset-2 ring-offset-[#0b1220]",
        className,
      )}
      style={
        {
          ["--stat-glow" as string]: rgba(accent, 0.22),
          ["--stat-ring" as string]: rgba(accent, 0.18),
          ...DASHBOARD_GLASS_STYLE,
          background: `
            linear-gradient(145deg, ${rgba(accent, 0.42)} 0%, ${rgba(accent, 0.12)} 42%, rgba(8,14,30,0.92) 100%),
            linear-gradient(160deg, #0b1220 0%, #0a1324 55%, #07101c 100%)
          `,
          borderColor: active ? rgba(accent, 0.7) : rgba(accent, 0.38),
        } as React.CSSProperties
      }
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full opacity-70 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: rgba(accent, 0.35) }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-12 -left-8 h-24 w-24 rounded-full opacity-40 blur-2xl"
        style={{ background: rgba(accent, 0.2) }}
      />

      <div className="relative z-10 mb-4 flex items-start justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-300/90">
          {label}
        </p>
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-transform duration-300 group-hover:scale-110"
          style={{
            color: accent,
            background: `radial-gradient(circle at 30% 30%, ${rgba(accent, 0.45)} 0%, ${rgba(accent, 0.12)} 70%, transparent 100%)`,
            border: `1px solid ${rgba(accent, 0.45)}`,
            boxShadow: `0 0 18px ${rgba(accent, 0.35)}`,
          }}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>

      <div className="relative z-10 mt-auto space-y-2.5">
        {loading ? (
          <div
            className="h-9 w-24 animate-pulse rounded-lg"
            style={{ background: rgba(accent, 0.22) }}
          />
        ) : (
          <p className="text-3xl font-black tracking-tight text-white tabular-nums sm:text-4xl">
            {value}
          </p>
        )}
        <TrendPill delta={delta} />
      </div>
    </motion.article>
  );
}
