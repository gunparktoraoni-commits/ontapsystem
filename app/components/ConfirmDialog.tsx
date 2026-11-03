"use client";

import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Info, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { InlineLoader } from "./Loader";

/**
 * Rendered inside the ModalProvider root (`#__modal-root__`, z-index 2147483647),
 * so this only has to beat sibling ModalPortal backdrops (z-index 80). Rendering
 * on document.body instead would place it behind every open modal.
 */
export const CONFIRM_DIALOG_Z_INDEX = 2147483640;
const MODAL_ROOT_ID = "__modal-root__";

export type ConfirmDialogVariant = "danger" | "primary" | "warning";

export type ConfirmDialogOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmDialogVariant;
  /** When true, only shows a single confirm button (replaces window.alert). */
  alertOnly?: boolean;
};

type PendingConfirm = ConfirmDialogOptions & {
  id: number;
  resolve: (confirmed: boolean) => void;
};

const EVENT_NAME = "ontap:confirm";

export function showConfirmDialog(
  options: ConfirmDialogOptions,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve(false);
      return;
    }
    window.dispatchEvent(
      new CustomEvent(EVENT_NAME, {
        detail: {
          ...options,
          id: Date.now() + Math.floor(Math.random() * 1000),
          resolve,
        } satisfies PendingConfirm,
      }),
    );
  });
}

/** Single-button notice — use instead of window.alert. */
export function showAlertDialog(options: {
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: ConfirmDialogVariant;
}): Promise<void> {
  return showConfirmDialog({
    ...options,
    alertOnly: true,
    confirmLabel: options.confirmLabel ?? "OK",
  }).then(() => undefined);
}

const VARIANT_STYLES: Record<
  ConfirmDialogVariant,
  { icon: typeof AlertTriangle; iconWrap: string; button: string }
> = {
  danger: {
    icon: AlertTriangle,
    iconWrap: "bg-rose-50 text-rose-600",
    button: "bg-rose-600 hover:bg-rose-700 text-white",
  },
  warning: {
    icon: AlertTriangle,
    iconWrap: "bg-amber-50 text-amber-600",
    button: "bg-amber-600 hover:bg-amber-700 text-white",
  },
  primary: {
    icon: Info,
    iconWrap: "bg-primary-50 text-primary",
    button: "bg-primary hover:bg-primary-hover text-white",
  },
};

function ConfirmDialogLayer({
  pending,
  onClose,
  busy,
  setBusy,
}: {
  pending: PendingConfirm | null;
  onClose: (confirmed: boolean) => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !pending) return null;

  const variant = pending.variant ?? (pending.alertOnly ? "primary" : "danger");
  const styles = VARIANT_STYLES[variant];
  const Icon = styles.icon;

  const handleConfirm = async () => {
    setBusy(true);
    try {
      onClose(true);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <AnimatePresence>
      {pending ? (
        <motion.div
          key={pending.id}
          className="fixed inset-0 flex items-center justify-center bg-black/50 p-4"
          style={{ zIndex: CONFIRM_DIALOG_Z_INDEX, pointerEvents: "auto" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) onClose(false);
          }}
          role="presentation"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`confirm-title-${pending.id}`}
            aria-describedby={`confirm-message-${pending.id}`}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${styles.iconWrap}`}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0">
                  <h3
                    id={`confirm-title-${pending.id}`}
                    className="text-lg font-bold text-gray-900"
                  >
                    {pending.title}
                  </h3>
                  <p
                    id={`confirm-message-${pending.id}`}
                    className="mt-2 text-sm leading-relaxed text-gray-600"
                  >
                    {pending.message}
                  </p>
                </div>
              </div>
              {!pending.alertOnly ? (
                <button
                  type="button"
                  onClick={() => onClose(false)}
                  disabled={busy}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-60"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              {!pending.alertOnly ? (
                <button
                  type="button"
                  onClick={() => onClose(false)}
                  disabled={busy}
                  className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  {pending.cancelLabel ?? "Cancel"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={busy}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-60 ${styles.button}`}
              >
                {busy ? (
                  <InlineLoader className="text-white" />
                ) : (
                  pending.confirmLabel ??
                  (pending.alertOnly ? "OK" : "Confirm")
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.getElementById(MODAL_ROOT_ID) ?? document.body,
  );
}

export default function ConfirmDialogProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent<PendingConfirm>).detail;
      if (!detail?.title || !detail.message) return;
      setPending(detail);
    }
    window.addEventListener(EVENT_NAME, handler as EventListener);
    return () => window.removeEventListener(EVENT_NAME, handler as EventListener);
  }, []);

  const close = useCallback(
    (confirmed: boolean) => {
      if (!pending) return;
      const resolve = pending.resolve;
      setPending(null);
      resolve(confirmed);
    },
    [pending],
  );

  return (
    <>
      {children}
      <ConfirmDialogLayer
        pending={pending}
        onClose={close}
        busy={busy}
        setBusy={setBusy}
      />
    </>
  );
}
