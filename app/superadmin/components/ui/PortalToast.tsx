"use client";

import { useCallback } from "react";
import { showToast, type ToastType } from "@/app/components/Toast";

export type PortalToastItem = {
  id: number;
  type: "success" | "error" | "warning";
  message: string;
};

/** @deprecated Renders nothing — toasts use the global ToastProvider. */
export function PortalToastStack(_props: {
  toasts: PortalToastItem[];
  onDismiss: (id: number) => void;
  autoDismissMs?: number;
}) {
  return null;
}

export function usePortalToasts() {
  const push = useCallback(
    (type: PortalToastItem["type"], message: string) => {
      const toastType: ToastType =
        type === "warning" ? "info" : type;
      showToast(message, toastType);
      return Date.now();
    },
    [],
  );

  const dismiss = useCallback((_id: number) => {
    // Global toasts auto-dismiss; no-op for API compatibility.
  }, []);

  return { toasts: [] as PortalToastItem[], push, dismiss };
}
