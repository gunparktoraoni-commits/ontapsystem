"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

export const SUPPORT_POPUP_PENDING_KEY = "ontap:support-popup:pending";
export const SUPPORT_POPUP_DISMISSED_KEY = "ontap:support-popup:dismissed";

export function markSupportPopupPending(): void {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(SUPPORT_POPUP_DISMISSED_KEY) === "1") return;
    window.localStorage.setItem(SUPPORT_POPUP_PENDING_KEY, "1");
  } catch {
    // ignore storage errors
  }
}

function readShouldShowSupportPopup(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.localStorage.getItem(SUPPORT_POPUP_PENDING_KEY) === "1" &&
      window.localStorage.getItem(SUPPORT_POPUP_DISMISSED_KEY) !== "1"
    );
  } catch {
    return false;
  }
}

function persistSupportPopupDismissed(): void {
  try {
    window.localStorage.setItem(SUPPORT_POPUP_DISMISSED_KEY, "1");
    window.localStorage.removeItem(SUPPORT_POPUP_PENDING_KEY);
  } catch {
    // ignore storage errors
  }
}

type SupportPopUpProps = {
  enabled?: boolean;
};

export function SupportPopUp({ enabled = true }: SupportPopUpProps) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setMounted(false);
      setVisible(false);
      return;
    }

    const shouldShow = readShouldShowSupportPopup();
    setMounted(shouldShow);
    if (!shouldShow) {
      setVisible(false);
      return;
    }

    const timer = window.setTimeout(() => setVisible(true), 350);
    return () => window.clearTimeout(timer);
  }, [enabled]);

  const handleDismiss = useCallback(() => {
    setVisible(false);
  }, []);

  const handleExitComplete = useCallback(() => {
    persistSupportPopupDismissed();
    setMounted(false);
  }, []);

  if (!mounted) return null;

  return (
    <AnimatePresence onExitComplete={handleExitComplete}>
      {visible ? (
        <motion.div
          key="support-intro-popup"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 10, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.94 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="pointer-events-auto absolute bottom-[calc(100%+0.75rem)] right-0 z-10 w-[min(calc(100vw-3rem),17rem)] rounded-2xl border border-[#c5d0e0] bg-white p-4 shadow-xl sm:bottom-auto sm:top-1/2 sm:w-[17rem] sm:-translate-y-1/2 sm:right-[calc(100%+0.75rem)]"
        >
          <p className="text-sm font-medium leading-snug text-[#1a365d]">
            Need Help? Contact our support team anytime.
          </p>
          <button
            type="button"
            onClick={handleDismiss}
            className="mt-3 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Got it
          </button>
          <span
            className="absolute -bottom-1.5 right-5 h-3 w-3 rotate-45 border-b border-r border-[#c5d0e0] bg-white sm:-right-1.5 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rotate-[135deg]"
            aria-hidden="true"
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
