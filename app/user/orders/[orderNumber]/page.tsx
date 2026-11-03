"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import OrderReceiptView from "../../../components/orders/OrderReceiptView";

function OrderReceiptPageContent() {
  const params = useParams<{ orderNumber: string }>();
  const searchParams = useSearchParams();
  const orderNumber = decodeURIComponent(String(params.orderNumber ?? ""));
  const fromPayment = searchParams.get("from") === "payment";

  if (!orderNumber) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
        Invalid order reference.
      </div>
    );
  }

  return (
    <div className="w-full min-h-full rounded-2xl border border-[#d8deee] bg-white p-4 sm:p-6 lg:p-7 shadow-sm">
      <OrderReceiptView orderNumber={orderNumber} fromPayment={fromPayment} />
    </div>
  );
}

export default function UserOrderReceiptPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[320px] flex items-center justify-center">
          Loading receipt...
        </div>
      }
    >
      <OrderReceiptPageContent />
    </Suspense>
  );
}
