import Link from "next/link";
import { LuCircleX } from "react-icons/lu";

interface PageProps {
  searchParams: Promise<{ reason?: string }>;
}

export default async function PaymentFailurePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const reason = params.reason || "unknown";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        <LuCircleX className="text-5xl text-red-500 mx-auto mb-4" />
        <h1 className="text-2xl font-bold">Payment Failed</h1>
        <p className="text-gray-600 mt-2">
          {reason === "cancelled"
            ? "You cancelled the payment."
            : "There was an issue processing your payment. Please try again."}
        </p>
        <Link
          href="/cart"
          className="mt-6 inline-block bg-gray-800 text-white px-6 py-2 rounded-xl hover:bg-gray-700 transition"
        >
          Return to Cart
        </Link>
      </div>
    </div>
  );
}