"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { LuCircleCheck, LuCircleX } from "react-icons/lu";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import { InlineLoader } from "@/app/components/Loader";
import { hasActivePremiumPlan } from "@/app/components/subscriptionAccess";
import { clearPendingPremiumUpgrade } from "@/app/components/premium/PremiumUpgradeExperience";

type PaymentStatus = "loading" | "confirmed" | "failed";

const PAID_XENDIT_STATUSES = new Set(["PAID", "SETTLED"]);
const FAILED_XENDIT_STATUSES = new Set(["FAILED", "EXPIRED", "VOIDED"]);
const MAX_POLL_ATTEMPTS = 40;
const POLL_INTERVAL_MS = 3000;
const RECONCILE_FALLBACK_AFTER = 3;
const PLAN_CHANGE_MAX_ATTEMPTS = 20;

function signalCartRefresh() {
  try {
    localStorage.setItem("cart_refresh_ts", String(Date.now()));
  } catch {
    // ignore storage errors
  }
  window.dispatchEvent(new CustomEvent("cart:refresh"));
}

// Any order status at or beyond "paid" means the payment has been confirmed.
const PAYMENT_CONFIRMED_ORDER_STATUSES = new Set([
  "paid",
  "processing",
  "processed",
  "shipped",
  "delivered",
  "completed",
]);

function isOrderPaymentConfirmed(
  orderStatus: string | undefined,
  xenditStatus: string | undefined,
): boolean {
  if (orderStatus && PAYMENT_CONFIRMED_ORDER_STATUSES.has(orderStatus)) return true;
  if (xenditStatus && PAID_XENDIT_STATUSES.has(xenditStatus)) return true;
  return false;
}

function isOrderPaymentFailed(
  orderStatus: string | undefined,
  xenditStatus: string | undefined,
): boolean {
  if (
    orderStatus === "failed" ||
    orderStatus === "cancelled" ||
    orderStatus === "payment_failed"
  ) {
    return true;
  }
  if (xenditStatus && FAILED_XENDIT_STATUSES.has(xenditStatus)) return true;
  return false;
}

function PlanChangeSuccessContent({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<PaymentStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pollAttemptsRef = useRef(0);
  const redirectedRef = useRef(false);

  useEffect(() => {
    const apiBase = getFrontendApiBaseUrl();
    let interval: ReturnType<typeof setInterval> | undefined;

    const poll = async () => {
      pollAttemptsRef.current += 1;
      try {
        const res = await fetch(`${apiBase}/api/user/subscription`, {
          credentials: "include",
          cache: "no-store",
        });
        if (res.ok) {
          const payload = await res.json().catch(() => null);
          const data =
            payload?.data && typeof payload.data === "object"
              ? (payload.data as Record<string, unknown>)
              : null;
          const premium = hasActivePremiumPlan({
            tier: data?.tier != null ? String(data.tier) : null,
            accessReason:
              data?.access_reason != null ? String(data.access_reason) : null,
            isTrial: Boolean(data?.is_trial),
            status: data?.status != null ? String(data.status) : null,
            isExpired: Boolean(data?.is_expired),
          });
          if (premium && !redirectedRef.current) {
            redirectedRef.current = true;
            setStatus("confirmed");
            clearPendingPremiumUpgrade();
            window.dispatchEvent(new CustomEvent("ontap:user-sync"));
            if (interval) clearInterval(interval);
            router.replace("/user/dashboard?premium_welcome=1");
            return;
          }
        }
        if (pollAttemptsRef.current >= PLAN_CHANGE_MAX_ATTEMPTS) {
          setStatus("failed");
          setErrorMessage(
            "Payment may have succeeded — Premium activation can take a moment. Return to your dashboard and refresh shortly.",
          );
          if (interval) clearInterval(interval);
        }
      } catch {
        if (pollAttemptsRef.current >= PLAN_CHANGE_MAX_ATTEMPTS) {
          setStatus("failed");
          setErrorMessage(
            "Unable to confirm Premium activation. Please check your dashboard shortly.",
          );
          if (interval) clearInterval(interval);
        }
      }
    };

    void poll();
    interval = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [router, sessionId]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        {status === "loading" && (
          <>
            <div className="text-5xl text-primary mx-auto mb-4">
              <InlineLoader />
            </div>
            <h1 className="text-2xl font-bold">Activating Premium...</h1>
            <p className="text-gray-600 mt-2">
              Please wait while we confirm your subscription upgrade.
            </p>
          </>
        )}
        {status === "confirmed" && (
          <>
            <LuCircleCheck className="text-5xl text-green-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold">Welcome to Premium!</h1>
            <p className="text-gray-600 mt-2">Redirecting to your dashboard...</p>
            <div className="text-2xl text-primary mx-auto mt-4">
              <InlineLoader />
            </div>
          </>
        )}
        {status === "failed" && (
          <>
            <LuCircleX className="text-5xl text-red-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold">Confirmation delayed</h1>
            <p className="text-gray-600 mt-2">
              {errorMessage ??
                "We couldn't confirm Premium activation yet. Please check your dashboard."}
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <Link
                href="/user/dashboard?premium_welcome=1"
                className="inline-block bg-primary text-white px-6 py-2 rounded-xl hover:bg-primary-light transition"
              >
                Go to Dashboard
              </Link>
              <Link
                href="/user/emarket?tab=subscription"
                className="inline-block bg-gray-800 text-white px-6 py-2 rounded-xl hover:bg-gray-700 transition"
              >
                View Subscription
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PaymentSuccessContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const orderNumber = searchParams.get("order");

  if (sessionId?.startsWith("plan_change_")) {
    return <PlanChangeSuccessContent sessionId={sessionId} />;
  }

  return (
    <ShopPaymentSuccessContent
      sessionId={sessionId}
      orderNumber={orderNumber}
    />
  );
}

function ShopPaymentSuccessContent({
  sessionId,
  orderNumber,
}: {
  sessionId: string | null;
  orderNumber: string | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<PaymentStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pollAttemptsRef = useRef(0);
  const order500CountRef = useRef(0);
  const useDbOnlyRef = useRef(false);
  const redirectedRef = useRef(false);

  const redirectToReceipt = useCallback(
    (resolvedOrder: string) => {
      if (redirectedRef.current) return;
      redirectedRef.current = true;
      signalCartRefresh();
      router.replace(
        `/user/orders/${encodeURIComponent(resolvedOrder)}?from=payment`,
      );
    },
    [router],
  );

  useEffect(() => {
    if (!sessionId && !orderNumber) {
      setStatus("failed");
      setErrorMessage("Missing payment reference. Please check your orders or contact support.");
      return;
    }

    const apiBase = getFrontendApiBaseUrl();
    let interval: ReturnType<typeof setInterval> | undefined;

    const checkSession = async (): Promise<boolean> => {
      const res = await fetch(
        `${apiBase}/api/marketplace/checkout/session/${encodeURIComponent(sessionId!)}`,
        { credentials: "include", cache: "no-store" },
      );
      if (!res.ok) return false;
      const data = await res.json();
      const resolvedOrder = data.order_number as string | null;
      if (data.status === "completed" && resolvedOrder) {
        setStatus("confirmed");
        redirectToReceipt(resolvedOrder);
        return true;
      }
      if (data.status === "failed") {
        setStatus("failed");
        setErrorMessage("Payment was not completed.");
        return true;
      }
      return false;
    };

    const checkOrder = async (): Promise<boolean> => {
      const reconcileQuery = useDbOnlyRef.current ? "?reconcile=0" : "";
      const res = await fetch(
        `${apiBase}/api/marketplace/orders/${encodeURIComponent(orderNumber!)}/status${reconcileQuery}`,
        { credentials: "include", cache: "no-store" },
      );

      if (res.status === 401) {
        setStatus("failed");
        setErrorMessage("Please sign in to confirm your payment.");
        return true;
      }

      if (!res.ok) {
        if (res.status >= 500) {
          order500CountRef.current += 1;
          if (order500CountRef.current >= RECONCILE_FALLBACK_AFTER) {
            useDbOnlyRef.current = true;
          }
        }
        if (pollAttemptsRef.current >= MAX_POLL_ATTEMPTS) {
          setStatus("failed");
          setErrorMessage("We could not confirm your payment. Check your orders shortly.");
          return true;
        }
        return false;
      }

      order500CountRef.current = 0;

      const payload = await res.json();
      const orderStatus = payload?.data?.status as string | undefined;
      const xenditStatus = payload?.data?.xendit_status as string | undefined;
      const resolvedOrder =
        (payload?.data?.order_number as string | undefined) ?? orderNumber!;

      if (isOrderPaymentConfirmed(orderStatus, xenditStatus)) {
        setStatus("confirmed");
        redirectToReceipt(resolvedOrder);
        return true;
      }

      if (isOrderPaymentFailed(orderStatus, xenditStatus)) {
        setStatus("failed");
        setErrorMessage("Payment was not completed.");
        return true;
      }

      if (pollAttemptsRef.current >= MAX_POLL_ATTEMPTS) {
        setStatus("failed");
        setErrorMessage(
          "Payment received — confirmation may take a moment. View your orders for updates.",
        );
        return true;
      }

      return false;
    };

    const poll = async () => {
      pollAttemptsRef.current += 1;
      try {
        const done = sessionId ? await checkSession() : await checkOrder();
        if (done && interval) clearInterval(interval);
      } catch (err) {
        console.error("Failed to check payment status", err);
        if (pollAttemptsRef.current >= MAX_POLL_ATTEMPTS) {
          setStatus("failed");
          setErrorMessage("Unable to verify payment status. Please check your orders.");
          if (interval) clearInterval(interval);
        }
      }
    };

    void poll();
    interval = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [sessionId, orderNumber, redirectToReceipt]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        {status === "loading" && (
          <>
            <div className="text-5xl text-primary mx-auto mb-4">
              <InlineLoader />
            </div>
            <h1 className="text-2xl font-bold">Processing your payment...</h1>
            <p className="text-gray-600 mt-2">Please wait while we confirm your order.</p>
          </>
        )}
        {status === "confirmed" && (
          <>
            <LuCircleCheck className="text-5xl text-green-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold">Payment Successful!</h1>
            <p className="text-gray-600 mt-2">Redirecting to your order receipt...</p>
            <div className="text-2xl text-primary mx-auto mt-4">
              <InlineLoader />
            </div>
          </>
        )}
        {status === "failed" && (
          <>
            <LuCircleX className="text-5xl text-red-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold">Payment Failed</h1>
            <p className="text-gray-600 mt-2">
              {errorMessage ??
                "We couldn't confirm your payment. Please try again or contact support."}
            </p>
            <div className="mt-6 flex flex-col gap-2">
              {orderNumber ? (
                <Link
                  href={`/user/orders/${encodeURIComponent(orderNumber)}`}
                  className="inline-block bg-primary text-white px-6 py-2 rounded-xl hover:bg-primary-light transition"
                >
                  View Order
                </Link>
              ) : null}
              <Link
                href="/user/orders"
                className="inline-block bg-gray-800 text-white px-6 py-2 rounded-xl hover:bg-gray-700 transition"
              >
                Go to Orders
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">Loading...</div>
      }
    >
      <PaymentSuccessContent />
    </Suspense>
  );
}
