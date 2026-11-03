"use client";

// ──────────────────────────────────────────────────────────────
// BroadcastNotificationPanel
// ──────────────────────────────────────────────────────────────
// SuperAdmin panel that allows sending a system_update notification
// to all active users who have System Updates enabled in their
// notification preferences.
//
// Delivery channels:
//   - In-app  → UserNotification record created immediately
//   - Email   → queued to NotificationEmailQueue; processed by the
//               email-queue cron job (/api/cron/process-email-queue)
//
// Per-user preference gates are enforced server-side:
//   - Users with system_update.in_app = false receive no in-app notification
//   - Users with email master switch off (unsubscribed_at) or
//     system_update.email = false receive no email
//
// The panel deliberately does NOT allow selecting individual users —
// system updates are always platform-wide. For targeted campaigns,
// use the Newsletter Campaigns panel.
// ──────────────────────────────────────────────────────────────

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Bell,
  CheckCircle2,
  Info,
  Send,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { InlineLoader } from "@/app/components/Loader";

import { getFrontendApiBaseUrl } from '@/app/components/apiBase';
const BACKEND_URL = '';
function getSettingsApiBase(): string { return getFrontendApiBaseUrl() || BACKEND_URL; }

const MAX_TITLE = 200;
const MAX_MESSAGE = 1000;
const MAX_ACTION_URL = 512;

type BroadcastResult = {
  total_users_scanned: number;
  in_app_delivered: number;
  email_queued: number;
  skipped: number;
  response_time_ms: number;
};

type ToastVariant = "success" | "error" | "info";

interface ToastItem {
  id: number;
  variant: ToastVariant;
  title: string;
  body: string;
}

let _toastSeq = 0;
function nextToastId() {
  return ++_toastSeq;
}

// ── Inline toast stack (same pattern as PromosManagementPanel) ──
function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  const ICON: Record<ToastVariant, React.ReactNode> = {
    success: (
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
        <CheckCircle2 className="h-5 w-5" />
      </span>
    ),
    error: (
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
        <AlertCircle className="h-5 w-5" />
      </span>
    ),
    info: (
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
        <Info className="h-5 w-5" />
      </span>
    ),
  };

  return (
    <div
      aria-live="polite"
      className="fixed right-4 top-4 z-50 flex flex-col gap-2"
    >
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: -14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -14, scale: 0.96 }}
            transition={{ duration: 0.18 }}
            className="w-[min(420px,calc(100vw-2rem))] rounded-2xl border border-gray-100 bg-white p-4 shadow-[0_24px_60px_rgba(15,23,42,0.2)]"
          >
            <div className="flex items-start gap-3">
              {ICON[t.variant]}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900">{t.title}</p>
                <p className="mt-0.5 text-sm text-gray-500">{t.body}</p>
              </div>
              <button
                type="button"
                onClick={() => onDismiss(t.id)}
                aria-label="Dismiss"
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-gray-100 text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ── Field character counter ──
function CharCount({
  value,
  max,
}: {
  value: string;
  max: number;
}) {
  const remaining = max - value.length;
  return (
    <span
      className={`text-[11px] font-medium ${
        remaining <= 20 ? "text-amber-500" : "text-gray-400"
      }`}
    >
      {value.length}/{max}
    </span>
  );
}

// ── Result summary card shown after a successful broadcast ──
function ResultCard({ result }: { result: BroadcastResult }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-5"
    >
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
        <p className="text-sm font-bold text-emerald-800">Broadcast sent successfully</p>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <p className="text-xs text-gray-500">Users scanned</p>
          <p className="font-semibold text-gray-900">{result.total_users_scanned.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">In-app delivered</p>
          <p className="font-semibold text-emerald-700">{result.in_app_delivered.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Emails queued</p>
          <p className="font-semibold text-[#2D3A8C]">{result.email_queued.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Skipped (pref off)</p>
          <p className="font-semibold text-gray-500">{result.skipped.toLocaleString()}</p>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-gray-400">
        Processed in {result.response_time_ms} ms. Queued emails will be delivered by the next
        email-queue cron run.
      </p>
    </motion.div>
  );
}

// ── Main panel ──
export default function BroadcastNotificationPanel() {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [actionUrl, setActionUrl] = useState("");
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<BroadcastResult | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const titleRef = useRef<HTMLInputElement>(null);

  // Auto-dismiss toasts after 5 s
  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.slice(1));
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [toasts]);

  function pushToast(variant: ToastVariant, title: string, body: string) {
    setToasts((prev) => [...prev, { id: nextToastId(), variant, title, body }]);
  }

  function dismissToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  const handleSend = async () => {
    const trimTitle = title.trim();
    const trimMessage = message.trim();
    const trimUrl = actionUrl.trim();

    if (!trimTitle) {
      pushToast("error", "Validation error", "Title is required.");
      titleRef.current?.focus();
      return;
    }
    if (!trimMessage) {
      pushToast("error", "Validation error", "Message body is required.");
      return;
    }

    setSending(true);
    setLastResult(null);

    try {
      const res = await fetch(
        `${getSettingsApiBase()}/api/superadmin/system/broadcast-notification`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: trimTitle,
            message: trimMessage,
            ...(trimUrl ? { action_url: trimUrl } : {}),
          }),
        }
      );

      const payload = (await res.json().catch(() => null)) as {
        success?: boolean;
        data?: BroadcastResult;
        error?: string;
      } | null;

      if (!res.ok || !payload?.success) {
        throw new Error(
          payload?.error ?? `Server returned ${res.status}`
        );
      }

      const result = payload.data!;
      setLastResult(result);

      pushToast(
        "success",
        "Broadcast complete",
        `${result.in_app_delivered} in-app · ${result.email_queued} emails queued`
      );

      // Reset form after success
      setTitle("");
      setMessage("");
      setActionUrl("");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Broadcast failed. Please try again.";
      pushToast("error", "Broadcast failed", msg);
    } finally {
      setSending(false);
    }
  };

  const isDisabled = sending || title.trim().length === 0 || message.trim().length === 0;

  return (
    <section className="space-y-4">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
        {/* Header */}
        <div className="flex items-start gap-3 mb-5">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#2D3A8C]/10">
            <Bell className="h-5 w-5 text-[#2D3A8C]" />
          </span>
          <div>
            <h3 className="text-base font-bold text-gray-900">
              Broadcast System Notification
            </h3>
            <p className="mt-0.5 text-sm text-gray-500">
              Send a platform-wide system update to all active users. Each user's
              notification preferences are respected — users with{" "}
              <em>System Updates</em> disabled will be skipped.
            </p>
          </div>
        </div>

        {/* Info banner */}
        <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-700">
          <strong>Delivery rules:</strong> In-app notifications are created immediately.
          Email notifications are queued and processed by the{" "}
          <code className="rounded bg-blue-100 px-1 py-px font-mono">
            /api/cron/process-email-queue
          </code>{" "}
          cron job. Only users with an active subscription and System Updates enabled
          (and email master switch on) will receive an email.
        </div>

        {/* Form */}
        <div className="space-y-4">
          {/* Title */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="broadcast-title"
                className="text-xs font-semibold text-gray-600"
              >
                Title <span className="text-red-500">*</span>
              </label>
              <CharCount value={title} max={MAX_TITLE} />
            </div>
            <input
              ref={titleRef}
              id="broadcast-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))}
              placeholder="e.g. New feature available: QR Code regeneration"
              disabled={sending}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#4b74bf] focus:outline-none focus:ring-2 focus:ring-[#4b74bf]/20 disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>

          {/* Message */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="broadcast-message"
                className="text-xs font-semibold text-gray-600"
              >
                Message <span className="text-red-500">*</span>
              </label>
              <CharCount value={message} max={MAX_MESSAGE} />
            </div>
            <textarea
              id="broadcast-message"
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE))}
              rows={4}
              placeholder="Describe the update, maintenance window, or new feature in plain language…"
              disabled={sending}
              className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#4b74bf] focus:outline-none focus:ring-2 focus:ring-[#4b74bf]/20 disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>

          {/* Action URL (optional) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="broadcast-url"
                className="text-xs font-semibold text-gray-600"
              >
                Action URL{" "}
                <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <CharCount value={actionUrl} max={MAX_ACTION_URL} />
            </div>
            <input
              id="broadcast-url"
              type="text"
              value={actionUrl}
              onChange={(e) => setActionUrl(e.target.value.slice(0, MAX_ACTION_URL))}
              placeholder="/user/dashboard  or  https://docs.example.com/release-notes"
              disabled={sending}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#4b74bf] focus:outline-none focus:ring-2 focus:ring-[#4b74bf]/20 disabled:bg-gray-50 disabled:text-gray-400"
            />
            <p className="mt-1 text-[11px] text-gray-400">
              Shown as "View Update" deep-link in the notification bell and email CTA. Defaults to{" "}
              <code className="rounded bg-gray-100 px-1 font-mono">/user/dashboard</code>{" "}
              if left blank.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-5 flex flex-col gap-3 border-t border-[#e8eef8] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-gray-500">
            This action cannot be undone. Notifications will be delivered to
            all eligible users immediately.
          </p>
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={isDisabled}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#2D3A8C] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#233070] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4b74bf] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? (
              <>
                <InlineLoader />
                Sending…
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Send Broadcast
              </>
            )}
          </button>
        </div>
      </section>

      {/* Last result */}
      <AnimatePresence>
        {lastResult && <ResultCard result={lastResult} />}
      </AnimatePresence>
    </section>
  );
}
