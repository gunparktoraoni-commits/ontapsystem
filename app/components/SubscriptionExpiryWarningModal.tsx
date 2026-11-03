"use client";

import Link from "next/link";
import { AlertTriangle, X } from "lucide-react";
import { ModalPortal } from "@/app/components/ModalPortal";

const RENEW_HREF = "/user/emarket?tab=subscription";

export type SubscriptionExpiryWarningModalProps = {
  open: boolean;
  title: string;
  message: string;
  onDismiss: () => void;
};

export function SubscriptionExpiryWarningModal({
  open,
  title,
  message,
  onDismiss,
}: SubscriptionExpiryWarningModalProps) {
  return (
    <ModalPortal isOpen={open} onClose={onDismiss}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="subscription-expiry-warning-title"
        className="relative mx-4 w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
      >
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss subscription warning"
          className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-start gap-3 border-b border-slate-100 px-6 py-5 pr-12">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2
              id="subscription-expiry-warning-title"
              className="text-lg font-bold text-slate-900"
            >
              {title}
            </h2>
            <p className="mt-1 text-sm text-slate-600">{message}</p>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 px-6 py-5 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Dismiss
          </button>
          <Link
            href={RENEW_HREF}
            onClick={onDismiss}
            className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-hover"
          >
            Renew Now
          </Link>
        </div>
      </div>
    </ModalPortal>
  );
}
