"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatNoticeMessage,
  type NoticeKind,
} from "@/lib/user-notices";

export type ToastType = NoticeKind;
export type ToastPayload = {
  message: string;
  type?: ToastType;
  /** When true (success toasts only), show a depleting duration bar. */
  showProgress?: boolean;
  /** Auto-dismiss duration in ms. Defaults to 4000. */
  duration?: number;
  /** Skip automatic friendly-message formatting (use raw message). */
  raw?: boolean;
};

type ToastItem = ToastPayload & { id: number };

const DEFAULT_TOAST_DURATION_MS = 4000;

/** Highest practical z-index — above all modals and overlays. */
export const TOAST_Z_INDEX = 2147483647;

const TOAST_STYLES: Record<
  ToastType,
  {
    container: string;
    text: string;
    icon: string;
    progress: string;
    Icon: typeof CheckCircle2;
  }
> = {
  success: {
    container: "border-emerald-200 bg-emerald-50/95 backdrop-blur-sm",
    text: "text-emerald-900",
    icon: "text-emerald-600",
    progress: "bg-emerald-500",
    Icon: CheckCircle2,
  },
  error: {
    container: "border-rose-200 bg-rose-50/95 backdrop-blur-sm",
    text: "text-rose-900",
    icon: "text-rose-600",
    progress: "bg-rose-500",
    Icon: XCircle,
  },
  info: {
    container: "border-primary-200 bg-primary-50/95 backdrop-blur-sm",
    text: "text-primary",
    icon: "text-primary-light",
    progress: "bg-primary-light",
    Icon: Info,
  },
};

function normalizePayload(
  next: string | ToastPayload,
  type: ToastType = "info",
): ToastPayload {
  const payload = typeof next === "string" ? { message: next, type } : next;
  const kind = payload.type ?? "info";
  if (payload.raw) return { ...payload, type: kind };
  return {
    ...payload,
    type: kind,
    message: formatNoticeMessage(payload.message, kind),
  };
}

// Dispatchable helper. Accepts either (message, type) or ({ message, type }).
export function showToast(next: string | ToastPayload, type: ToastType = "info") {
  try {
    const payload = normalizePayload(next, type);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("ontap:toast", { detail: payload }));
    }
  } catch {
    // ignore dispatch failures
  }
}

function ToastProgressBar({
  duration,
  className,
  onComplete,
}: {
  duration: number;
  className: string;
  onComplete: () => void;
}) {
  const [width, setWidth] = useState(100);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    let finished = false;

    const tick = (now: number) => {
      const elapsed = now - start;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setWidth(remaining);
      if (remaining <= 0) {
        if (!finished) {
          finished = true;
          onCompleteRef.current();
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      finished = true;
      cancelAnimationFrame(raf);
    };
  }, [duration]);

  return (
    <div className="h-1 w-full overflow-hidden" aria-hidden>
      <div className={cn("h-full transition-none", className)} style={{ width: `${width}%` }} />
    </div>
  );
}

function ToastPortal({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed inset-x-0 top-4 z-[2147483647] flex flex-col items-end gap-2 px-4 sm:inset-x-auto sm:right-4 sm:left-auto sm:px-0"
      style={{ zIndex: TOAST_Z_INDEX }}
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const kind = t.type ?? "info";
          const style = TOAST_STYLES[kind];
          const Icon = style.Icon;
          const showProgress = Boolean(t.showProgress) && kind === "success";
          const duration = t.duration ?? DEFAULT_TOAST_DURATION_MS;

          return (
            <motion.div
              key={t.id}
              layout
              role={kind === "error" ? "alert" : "status"}
              initial={{ opacity: 0, x: 24, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.96 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                "pointer-events-auto flex w-full max-w-sm flex-col overflow-hidden rounded-xl border shadow-lg",
                style.container,
              )}
            >
              <div className="flex items-start gap-3 px-4 py-3.5">
                <Icon
                  aria-hidden
                  className={cn("mt-0.5 h-5 w-5 shrink-0", style.icon)}
                />
                <p
                  className={cn(
                    "min-w-0 flex-1 text-sm font-medium leading-relaxed",
                    style.text,
                  )}
                >
                  {t.message}
                </p>
                <button
                  type="button"
                  aria-label="Dismiss notification"
                  onClick={() => onDismiss(t.id)}
                  className={cn(
                    "shrink-0 rounded-md p-1 opacity-60 transition-opacity hover:opacity-100",
                    style.text,
                  )}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {showProgress ? (
                <ToastProgressBar
                  duration={duration}
                  className={style.progress}
                  onComplete={() => onDismiss(t.id)}
                />
              ) : null}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent<ToastPayload>).detail;
      if (!detail?.message) return;
      const normalized = normalizePayload(detail);
      const id = Date.now() + Math.floor(Math.random() * 1000);
      const kind = normalized.type ?? "info";
      setToasts((prev) => [
        ...prev,
        {
          id,
          message: normalized.message,
          type: kind,
          showProgress: Boolean(normalized.showProgress) && kind === "success",
          duration: normalized.duration ?? DEFAULT_TOAST_DURATION_MS,
        },
      ]);
    }

    window.addEventListener("ontap:toast", handler as EventListener);
    return () => window.removeEventListener("ontap:toast", handler as EventListener);
  }, []);

  useEffect(() => {
    if (!toasts.length) return;
    const next = toasts.find((t) => !t.showProgress);
    if (!next) return;
    const id = window.setTimeout(
      () => setToasts((t) => t.filter((item) => item.id !== next.id)),
      next.duration ?? DEFAULT_TOAST_DURATION_MS,
    );
    return () => window.clearTimeout(id);
  }, [toasts]);

  return (
    <>
      {children}
      <ToastPortal
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />
    </>
  );
}
