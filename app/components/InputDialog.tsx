"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Pencil, X } from "lucide-react";
import { InlineLoader } from "./Loader";

/** Above ModalProvider — same tier as ConfirmDialog */
const INPUT_DIALOG_Z_INDEX = 2147483641;

const EVENT_NAME = "ontap:input-dialog";

export type InputDialogField = {
  key: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  /** 'text' | 'textarea' — defaults to 'text' */
  type?: "text" | "textarea";
};

export type InputDialogOptions = {
  title: string;
  description?: string;
  fields: InputDialogField[];
  submitLabel?: string;
  cancelLabel?: string;
};

type PendingInput = InputDialogOptions & {
  id: number;
  resolve: (values: Record<string, string> | null) => void;
};

/**
 * Show a modal with one or more text fields.
 * Returns an object of field values on confirm, or null on cancel/dismiss.
 */
export function showInputDialog(
  options: InputDialogOptions,
): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve(null);
      return;
    }
    window.dispatchEvent(
      new CustomEvent(EVENT_NAME, {
        detail: {
          ...options,
          id: Date.now() + Math.floor(Math.random() * 1000),
          resolve,
        } satisfies PendingInput,
      }),
    );
  });
}

function InputDialogLayer({
  pending,
  onClose,
}: {
  pending: PendingInput | null;
  onClose: (values: Record<string, string> | null) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const firstRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset state whenever a new dialog opens
  useEffect(() => {
    if (!pending) return;
    const initial: Record<string, string> = {};
    for (const f of pending.fields) {
      initial[f.key] = f.defaultValue ?? "";
    }
    setValues(initial);
    setErrors({});
    setBusy(false);
    // Auto-focus first field after paint
    const id = window.setTimeout(() => firstRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [pending?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = () => {
    if (!pending) return;
    const newErrors: Record<string, string> = {};
    for (const f of pending.fields) {
      if (f.required && !values[f.key]?.trim()) {
        newErrors[f.key] = `${f.label} is required.`;
      }
    }
    if (Object.keys(newErrors).length) {
      setErrors(newErrors);
      return;
    }
    setBusy(true);
    onClose(values);
    setBusy(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") onClose(null);
  };

  if (!mounted || !pending) return null;

  return createPortal(
    <AnimatePresence>
      {pending ? (
        <motion.div
          key={pending.id}
          className="fixed inset-0 flex items-center justify-center bg-black/50 p-4"
          style={{ zIndex: INPUT_DIALOG_Z_INDEX }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) onClose(null);
          }}
          role="presentation"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`input-dialog-title-${pending.id}`}
            className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleKeyDown}
          >
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-gray-100 px-6 py-5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary">
                <Pencil className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <h3
                  id={`input-dialog-title-${pending.id}`}
                  className="text-base font-bold text-gray-900"
                >
                  {pending.title}
                </h3>
                {pending.description ? (
                  <p className="mt-0.5 text-xs text-gray-500">
                    {pending.description}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => onClose(null)}
                disabled={busy}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-60"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Fields */}
            <div className="space-y-4 px-6 py-5">
              {pending.fields.map((field, i) => (
                <div key={field.key}>
                  <label
                    htmlFor={`input-dialog-field-${pending.id}-${field.key}`}
                    className="mb-1.5 block text-sm font-medium text-gray-700"
                  >
                    {field.label}
                    {field.required ? (
                      <span className="ml-0.5 text-rose-500" aria-hidden>
                        *
                      </span>
                    ) : null}
                  </label>
                  {field.type === "textarea" ? (
                    <textarea
                      id={`input-dialog-field-${pending.id}-${field.key}`}
                      ref={
                        i === 0
                          ? (el) => {
                              firstRef.current = el;
                            }
                          : undefined
                      }
                      rows={3}
                      placeholder={field.placeholder ?? ""}
                      value={values[field.key] ?? ""}
                      onChange={(e) => {
                        setValues((v) => ({ ...v, [field.key]: e.target.value }));
                        if (errors[field.key])
                          setErrors((er) => {
                            const next = { ...er };
                            delete next[field.key];
                            return next;
                          });
                      }}
                      className={`w-full resize-none rounded-xl border px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                        errors[field.key]
                          ? "border-rose-300 bg-rose-50"
                          : "border-gray-200 bg-white hover:border-gray-300"
                      }`}
                    />
                  ) : (
                    <input
                      type="text"
                      id={`input-dialog-field-${pending.id}-${field.key}`}
                      ref={
                        i === 0
                          ? (el) => {
                              firstRef.current = el;
                            }
                          : undefined
                      }
                      placeholder={field.placeholder ?? ""}
                      value={values[field.key] ?? ""}
                      onChange={(e) => {
                        setValues((v) => ({ ...v, [field.key]: e.target.value }));
                        if (errors[field.key])
                          setErrors((er) => {
                            const next = { ...er };
                            delete next[field.key];
                            return next;
                          });
                      }}
                      className={`w-full rounded-xl border px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                        errors[field.key]
                          ? "border-rose-300 bg-rose-50"
                          : "border-gray-200 bg-white hover:border-gray-300"
                      }`}
                    />
                  )}
                  {errors[field.key] ? (
                    <p className="mt-1 text-xs text-rose-600">
                      {errors[field.key]}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
              <button
                type="button"
                onClick={() => onClose(null)}
                disabled={busy}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {pending.cancelLabel ?? "Cancel"}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
              >
                {busy ? <InlineLoader className="text-white" /> : null}
                {pending.submitLabel ?? "Save"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

export default function InputDialogProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [pending, setPending] = useState<PendingInput | null>(null);

  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent<PendingInput>).detail;
      if (!detail?.title || !detail.fields?.length) return;
      setPending(detail);
    }
    window.addEventListener(EVENT_NAME, handler as EventListener);
    return () => window.removeEventListener(EVENT_NAME, handler as EventListener);
  }, []);

  const close = useCallback(
    (values: Record<string, string> | null) => {
      if (!pending) return;
      const resolve = pending.resolve;
      setPending(null);
      resolve(values);
    },
    [pending],
  );

  return (
    <>
      {children}
      <InputDialogLayer pending={pending} onClose={close} />
    </>
  );
}
