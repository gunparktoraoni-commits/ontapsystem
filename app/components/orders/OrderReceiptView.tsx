//app/components/orders/OrderReceiptView.tsx

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  FileImage,
  FileText,
} from "lucide-react";
import { getFrontendApiBaseUrl } from "../apiBase";
import {
  formatOrderDate,
  formatOrderMoney,
  orderStatusClasses,
  orderStatusLabel,
  type OrderReceiptData,
} from "../../lib/orderReceipt";
import { SectionLoader, InlineLoader } from "../Loader"; // <-- added import

const API = getFrontendApiBaseUrl();
const AUTO_REDIRECT_SECONDS = 10;

type OrderReceiptViewProps = {
  orderNumber: string;
  fromPayment?: boolean;
};

export default function OrderReceiptView({
  orderNumber,
  fromPayment = false,
}: OrderReceiptViewProps) {
  const router = useRouter();
  const receiptRef = useRef<HTMLDivElement>(null);
  const [receipt, setReceipt] = useState<OrderReceiptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingImage, setDownloadingImage] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(AUTO_REDIRECT_SECONDS);

  const loadReceipt = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API}/api/marketplace/orders/${encodeURIComponent(orderNumber)}/receipt`,
        { credentials: "include", cache: "no-store" },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          (payload?.error as string) || "Unable to load order receipt.",
        );
      }
      setReceipt(payload.data as OrderReceiptData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load order receipt.");
    } finally {
      setLoading(false);
    }
  }, [orderNumber]);

  useEffect(() => {
    void loadReceipt();
  }, [loadReceipt]);

  useEffect(() => {
    if (!fromPayment) return;

    const countdown = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(countdown);
          router.push("/user/orders");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(countdown);
  }, [fromPayment, router]);

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      const res = await fetch(
        `${API}/api/marketplace/orders/${encodeURIComponent(orderNumber)}/receipt/pdf`,
        { credentials: "include", cache: "no-store" },
      );
      if (!res.ok) {
        throw new Error("Failed to download PDF receipt.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `receipt-${orderNumber}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download PDF.");
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleDownloadImage = async () => {
    setDownloadingImage(true);
    try {
      const res = await fetch(
        `${API}/api/marketplace/orders/${encodeURIComponent(orderNumber)}/receipt/image`,
        { credentials: "include", cache: "no-store" },
      );
      if (!res.ok) {
        throw new Error("Failed to download image receipt.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `receipt-${orderNumber}.png`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download image.");
    } finally {
      setDownloadingImage(false);
    }
  };

  // ------------------------------------------------------------------
  // Loading: show full‑page overlay
  // ------------------------------------------------------------------
  // if (loading) {
  //   return (
  //     <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-white/80 backdrop-blur-sm">
  //       <SectionLoader text="Loading receipt..." />
  //     </div>
  //   );
  // }

  if (error && !receipt) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-sm text-red-700">{error}</p>
        <button
          type="button"
          onClick={() => void loadReceipt()}
          className="mt-4 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!receipt) return null;

  return (
    <div className="space-y-5 relative">
      {loading && 
        <div className="absolute inset-0 z-[9999] flex items-center justify-center bg-white">
          <SectionLoader text="Loading receipt..." />
        </div>
      }
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/user/orders"
          className="inline-flex items-center gap-2 rounded-xl border border-[#d8deee] bg-white px-4 py-2 text-sm font-semibold text-[#2D3A8C] transition hover:bg-gray-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Orders
        </Link>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleDownloadPdf()}
            disabled={downloadingPdf}
            className="inline-flex items-center gap-2 rounded-xl bg-[#2D3A8C] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#243074] disabled:opacity-60"
          >
            {downloadingPdf ? (
              <InlineLoader />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            Download PDF
          </button>
          <button
            type="button"
            onClick={() => void handleDownloadImage()}
            disabled={downloadingImage}
            className="inline-flex items-center gap-2 rounded-xl border border-[#d8deee] bg-white px-4 py-2 text-sm font-semibold text-[#2D3A8C] transition hover:bg-gray-50 disabled:opacity-60"
          >
            {downloadingImage ? (
              <InlineLoader />
            ) : (
              <FileImage className="h-4 w-4" />
            )}
            Download Image
          </button>
        </div>
      </div>

      {fromPayment ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Payment successful. Returning to orders in {secondsLeft}s, or use Back to
          Orders now.
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      ) : null}

      <div
        ref={receiptRef}
        className="rounded-2xl border border-[#d8deee] bg-white p-10 shadow-sm"
        style={{
          fontFamily: "Arial, Helvetica, sans-serif",
          color: "#111827",
          backgroundColor: "#ffffff",
          maxWidth: "900px",
        }}
      >
        {/* Primary Header Bar */}
        <div className="mb-8 border-b-4 border-[#2D3A8C] pb-6">
          <h1 className="mb-4 text-3xl font-bold text-[#2D3A8C]">
            {receipt.business.name}
          </h1>
          <div className="space-y-1 text-sm text-gray-600">
            <p>{receipt.business.email}</p>
            {receipt.business.phone ? <p>{receipt.business.phone}</p> : null}
            {receipt.business.address ? <p>{receipt.business.address}</p> : null}
          </div>
        </div>

        {/* Invoice Title and Number */}
        <div className="mb-8 flex items-baseline justify-between">
          <h2 className="text-3xl font-bold text-gray-900">INVOICE</h2>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-600">
              Invoice Number
            </p>
            <p className="text-2xl font-bold text-[#2D3A8C]">
              {receipt.invoice_number}
            </p>
          </div>
        </div>

        {/* Bill To & Order Details Grid */}
        <div className="mb-8 grid grid-cols-2 gap-8">
          {/* Left Column: Bill To */}
          <div>
            <p className="mb-4 text-xs font-bold uppercase tracking-widest text-gray-500">
              Bill To
            </p>
            <div className="space-y-2">
              <p className="text-lg font-bold text-gray-900">
                {receipt.customer.name}
              </p>
              <p className="text-sm text-gray-600">{receipt.customer.email}</p>
            </div>
          </div>

          {/* Right Column: Order Details */}
          <div>
            <div className="mb-6">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-500">
                Order #
              </p>
              <p className="text-xl font-bold text-gray-900">
                {receipt.order_number}
              </p>
            </div>
            <div className="mb-6">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-500">
                Date
              </p>
              <p className="text-sm text-gray-900">
                {formatOrderDate(receipt.date)}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-gray-500">
                Status
              </p>
              <span
                className={`inline-flex rounded-full border px-4 py-2 text-xs font-bold uppercase tracking-wide ${orderStatusClasses(receipt.status)}`}
              >
                {orderStatusLabel(receipt.status)}
              </span>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="mb-8 border-t-2 border-gray-300" />

        {/* Items Table */}
        <div className="mb-8">
          <h3 className="mb-6 text-xs font-bold uppercase tracking-widest text-gray-600">
            Items Ordered
          </h3>
          <div className="overflow-hidden rounded-lg border-2 border-gray-200">
            <table className="w-full">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wide text-gray-700">
                    Item Description
                  </th>
                  <th className="px-6 py-4 text-center text-xs font-bold uppercase tracking-wide text-gray-700">
                    Qty
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-bold uppercase tracking-wide text-gray-700">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {receipt.items.map((item, index) => (
                  <tr key={`${item.description}-${index}`} className={index % 2 === 0 ? "bg-blue-50" : "bg-white"}>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">
                      {item.description}
                    </td>
                    <td className="px-6 py-4 text-center text-sm text-gray-700">
                      {item.quantity}
                    </td>
                    <td className="px-6 py-4 text-right text-sm font-semibold text-gray-900">
                      {formatOrderMoney(item.amount, receipt.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Divider */}
        <div className="mb-8 border-t-2 border-gray-300" />

        {/* Totals Section */}
        <div className="mb-8 flex justify-end">
          <div className="w-80 space-y-3">
            {/* Subtotal */}
            <div className="flex justify-between text-sm">
              <span className="text-gray-700">Subtotal:</span>
              <span className="font-medium text-gray-900">
                {formatOrderMoney(receipt.subtotal, receipt.currency)}
              </span>
            </div>

            {/* Discount */}
            {receipt.discount > 0 ? (
              <div className="flex justify-between text-sm">
                <span className="text-gray-700">Discount:</span>
                <span className="font-medium text-green-600">
                  -{formatOrderMoney(receipt.discount, receipt.currency)}
                </span>
              </div>
            ) : null}

            {/* Shipping */}
            {receipt.shipping > 0 ? (
              <div className="flex justify-between text-sm">
                <span className="text-gray-700">Shipping:</span>
                <span className="font-medium text-gray-900">
                  {formatOrderMoney(receipt.shipping, receipt.currency)}
                </span>
              </div>
            ) : null}

            {/* Tax */}
            <div className="flex justify-between text-sm">
              <span className="text-gray-700">Tax:</span>
              <span className="font-medium text-gray-900">
                {formatOrderMoney(receipt.tax, receipt.currency)}
              </span>
            </div>

            {/* Divider */}
            <div className="my-3 border-t-2 border-[#2D3A8C]" />

            {/* Grand Total Box */}
            <div className="flex justify-between rounded-lg border-2 border-[#2D3A8C] bg-gradient-to-r from-blue-50 to-indigo-50 p-4">
              <span className="text-lg font-bold text-[#2D3A8C]">TOTAL:</span>
              <span className="text-lg font-bold text-[#2D3A8C]">
                {receipt.formatted_total}
              </span>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="mb-8 border-t border-gray-300" />

        {/* Payment Method */}
        <div className="mb-8">
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-gray-600">
            Payment Method
          </p>
          <p className="text-sm font-semibold text-gray-900">
            {receipt.payment_method.type}
            {receipt.payment_method.brand ? ` (${receipt.payment_method.brand})` : ""}
          </p>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-300 pt-6 text-center">
          <p className="mb-2 text-sm font-bold text-[#2D3A8C]">
            Thank you for your business!
          </p>
          <p className="text-xs text-gray-500">
            For inquiries, please contact us at {receipt.business.email}
          </p>
          <p className="mt-3 text-xs text-gray-400">
            Invoice {receipt.invoice_number} | {formatOrderDate(receipt.date)}
          </p>
        </div>
      </div>

      <div className="flex justify-center">
        <Link
          href="/user/orders"
          className="inline-flex items-center gap-2 text-sm font-semibold text-[#2D3A8C] hover:underline"
        >
          View all orders
        </Link>
      </div>
    </div>
  );
}