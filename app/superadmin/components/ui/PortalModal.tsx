"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

type PortalModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  headerClassName?: string;
  /** Optional classes for the scrollable body region (e.g. overflow-hidden for split panes). */
  bodyClassName?: string;
  /** When true, Escape and overlay clicks do not close the modal. */
  preventClose?: boolean;
};

const sizeMap = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-5xl",
};

export function PortalModal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  className,
  headerClassName,
  bodyClassName,
  preventClose = false,
}: PortalModalProps) {
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  // Keep latest onClose without re-running open/focus lock when callers pass an inline callback.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    previouslyFocusedRef.current =
      typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;

    const body = document.body;
    const html = document.documentElement;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const previous = {
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyWidth: body.style.width,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      htmlOverflow: html.style.overflow,
      bodyPaddingRight: body.style.paddingRight,
    };

    // iOS Safari ignores overflow:hidden alone — lock with position:fixed.
    const scrollbarGap = Math.max(0, window.innerWidth - html.clientWidth);
    body.style.overflow = "hidden";
    html.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    if (scrollbarGap > 0) {
      body.style.paddingRight = `${scrollbarGap}px`;
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !preventClose) {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);

    // Focus first focusable control for keyboard / VoiceOver / TalkBack.
    const focusTimer = window.setTimeout(() => {
      const root = panelRef.current;
      if (!root) return;
      const focusable = root.querySelector<HTMLElement>(
        'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    }, 30);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKey);
      body.style.overflow = previous.bodyOverflow;
      body.style.position = previous.bodyPosition;
      body.style.top = previous.bodyTop;
      body.style.width = previous.bodyWidth;
      body.style.left = previous.bodyLeft;
      body.style.right = previous.bodyRight;
      body.style.paddingRight = previous.bodyPaddingRight;
      html.style.overflow = previous.htmlOverflow;
      window.scrollTo(0, scrollY);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open, preventClose]);

  if (!mounted || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[30000] flex items-end justify-center p-0 sm:items-center sm:p-6">
          <motion.button
            type="button"
            aria-label="Close modal overlay"
            className="absolute inset-0 bg-slate-900/70 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={preventClose ? undefined : onClose}
            disabled={preventClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className={cn(
              "relative z-10 flex max-h-[min(90vh,920px)] w-full flex-col overflow-hidden rounded-t-3xl border border-gray-100 bg-white shadow-2xl shadow-black/20 sm:rounded-3xl",
              "max-sm:max-h-[min(94dvh,920px)]",
              sizeMap[size],
              className,
            )}
          >
            <div
              className={cn(
                "flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-4 py-4 sm:gap-4 sm:px-6 sm:py-5",
                headerClassName,
              )}
            >
              <div className="min-w-0">
                <h2
                  id={titleId}
                  className="text-base font-bold text-gray-900 sm:text-lg"
                >
                  {title}
                </h2>
                {description ? (
                  <p id={descriptionId} className="mt-1 text-sm text-gray-500">
                    {description}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={preventClose}
                className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div
              className={cn(
                "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5 [-webkit-overflow-scrolling:touch]",
                bodyClassName,
              )}
            >
              {children}
            </div>
            {footer ? (
              <div className="shrink-0 border-t border-gray-100 bg-gray-50/80 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
                {footer}
              </div>
            ) : (
              <div className="pb-[env(safe-area-inset-bottom)] sm:pb-0" />
            )}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
