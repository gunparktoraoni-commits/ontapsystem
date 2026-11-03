import Link from "next/link";
import UserOrdersPanel from "../../components/orders/UserOrdersPanel";
import { LuChevronLeft } from "react-icons/lu";

export default function UserOrdersPage() {
  return (
    <div className="w-full min-h-full rounded-2xl border border-[#d8deee] bg-white p-4 sm:p-6 lg:p-7 shadow-sm">
      <div className="mb-6">
        <span className="flex items-center gap-3">
          <Link 
          href="emarket"
          className="text-3xl text-primary-light hover:text-primary transition-all duration-200">
            <LuChevronLeft />
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">My Orders</h1>
        </span>
        <p className="mt-1 text-sm text-gray-500">
          View your marketplace orders and download receipts.
        </p>
      </div>
      <UserOrdersPanel />
    </div>
  );
}
