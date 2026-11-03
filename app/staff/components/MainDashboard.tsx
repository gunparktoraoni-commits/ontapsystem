"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Building2,
  ChevronRight,
  Mail,
  MessageSquare,
  QrCode,
  Users,
} from "lucide-react";
import { SectionLoader, InlineLoader } from "../../components/Loader";
import { getFrontendApiBaseUrl } from "../../components/apiBase";
import { PortalNoticeSurface } from "../../components/PortalNoticeSurface";
import StaffBizCardPanels, {
  TODAY,
  buildAuthHeaders,
  readAuthUserName,
  timeAgo,
  type StaffInquiry,
  type StaffMessage,
  type StaffOrder,
  type StaffPortalStats,
} from "./StaffBizCardPanels";

const API_BASE_URL = getFrontendApiBaseUrl();

interface PortalDashboardPayload {
  stats: StaffPortalStats;
  recent_inquiries: StaffInquiry[];
  recent_orders: StaffOrder[];
  messages: StaffMessage[];
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: typeof Users;
  color: string;
}) {
  return (
    <div className="group bg-white border border-gray-100 rounded-3xl p-5 sm:p-6 shadow-sm hover:shadow-xl hover:shadow-[#4785B8]/5 hover:-translate-y-1 transition-all duration-300">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs sm:text-sm font-bold text-gray-500 group-hover:text-gray-800 transition-colors">
          {label}
        </span>
        <div
          className="h-10 w-10 rounded-xl flex items-center justify-center transition-transform duration-300 group-hover:scale-110"
          style={{ backgroundColor: `${color}14` }}
        >
          <Icon className="h-5 w-5" style={{ color }} />
        </div>
      </div>
      <p className="text-3xl sm:text-4xl font-black text-gray-900 tracking-tight">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      <p className="text-xs font-semibold text-gray-400 mt-1.5">Assigned to you</p>
    </div>
  );
}

function clientName(message: StaffMessage): string {
  const full = [message.first_name, message.last_name].filter(Boolean).join(" ").trim();
  return full || message.email;
}

export default function MainDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PortalDashboardPayload | null>(null);
  const displayName = readAuthUserName() || "Staff Member";

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`${API_BASE_URL}/api/staff/portal/dashboard`, {
          credentials: "include",
          headers: buildAuthHeaders(),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(
            typeof payload?.error?.message === "string"
              ? payload.error.message
              : "Failed to load staff dashboard.",
          );
        }
        if (!cancelled) {
          setData(payload.data as PortalDashboardPayload);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load staff dashboard.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = data?.stats;

  if (loading && !data) {
    return <SectionLoader text="Loading dashboard..." />;
  }

  return (
    <div className="space-y-5 sm:space-y-6 animate-fade-in-up">
      <PortalNoticeSurface portal="staff" placement="global_banner" />
      <PortalNoticeSurface portal="staff" placement="dashboard" />
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 px-1">
        <div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
            Welcome back,{" "}
            <span className="bg-gradient-to-r from-[#2A4792] to-[#4785B8] bg-clip-text text-transparent">
              {displayName}
            </span>
          </h2>
          <p className="text-sm font-medium text-gray-500 mt-1.5">{TODAY}</p>
        </div>
        <button
          type="button"
          className="ml-auto self-start sm:self-auto px-6 py-2.5 rounded-xl text-sm font-bold shadow-sm bg-white border border-gray-200 text-[#2A4792] hover:bg-[#F8FAFC] hover:border-[#4785B8] transition-all"
          onClick={() => window.print()}
        >
          Export
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        {loading ? (
          Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm flex items-center justify-center min-h-[140px]"
            >
              <InlineLoader />
            </div>
          ))
        ) : (
          <>
            <StatCard label="Clients" value={stats?.clients ?? 0} icon={Users} color="#2A4792" />
            <StatCard
              label="Companies"
              value={stats?.companies ?? 0}
              icon={Building2}
              color="#3B569F"
            />
            <StatCard
              label="Unread Messages"
              value={stats?.unread_messages ?? 0}
              icon={Mail}
              color="#4785B8"
            />
            <StatCard
              label="Inquiries"
              value={stats?.inquiries ?? 0}
              icon={QrCode}
              color="#2A4792"
            />
          </>
        )}
      </div>

      <StaffBizCardPanels />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6">
        <div className="bg-white border border-gray-100 rounded-3xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-extrabold text-gray-900">Recent Inquiries</h3>
            <Link href="/staff/inquiry" className="text-sm font-semibold text-[#4785B8] hover:underline">
              View all
            </Link>
          </div>
          {loading ? (
            <div className="flex justify-center py-8">
              <InlineLoader />
            </div>
          ) : !data?.recent_inquiries?.length ? (
            <p className="text-sm text-gray-500 py-6 text-center">No recent inquiries.</p>
          ) : (
            <ul className="space-y-3">
              {data.recent_inquiries.map((inquiry) => (
                <li
                  key={inquiry.inquiry_id}
                  className="flex items-start gap-3 rounded-2xl border border-gray-100 px-4 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="h-10 w-10 rounded-full bg-[#E8F0FC] flex items-center justify-center shrink-0">
                    <MessageSquare className="h-4 w-4 text-[#2A4792]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-gray-900 truncate">
                      {inquiry.visitor_name || inquiry.visitor_email || "New inquiry"}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {inquiry.subject || inquiry.message}
                    </p>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">{timeAgo(inquiry.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white border border-gray-100 rounded-3xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-extrabold text-gray-900">New Client Orders</h3>
            <Link href="/staff/orders" className="text-sm font-semibold text-[#4785B8] hover:underline">
              View all
            </Link>
          </div>
          {loading ? (
            <div className="flex justify-center py-8">
              <InlineLoader />
            </div>
          ) : !data?.recent_orders?.length ? (
            <p className="text-sm text-gray-500 py-6 text-center">No recent client orders.</p>
          ) : (
            <ul className="space-y-3">
              {data.recent_orders.map((order) => (
                <li
                  key={order.shop_order_id}
                  className="flex items-center gap-3 rounded-2xl border border-gray-100 px-4 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="h-10 w-10 rounded-full bg-[#E8F0FC] flex items-center justify-center shrink-0">
                    <Users className="h-4 w-4 text-[#2A4792]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-gray-900">Order #{order.shop_order_id}</p>
                    <p className="text-xs text-gray-500 capitalize">{order.status}</p>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">{timeAgo(order.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-3xl shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-extrabold text-gray-900">Messages</h3>
          <Link href="/staff/messages" className="text-sm font-semibold text-[#4785B8] hover:underline inline-flex items-center gap-1">
            Manage <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
        {loading ? (
          <div className="flex justify-center py-8">
            <InlineLoader />
          </div>
        ) : !data?.messages?.length ? (
          <p className="text-sm text-gray-500 py-6 text-center">No client messages yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {data.messages.map((message) => (
              <li key={message.user_id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="h-10 w-10 rounded-full bg-[#E8F0FC] flex items-center justify-center shrink-0">
                  <Mail className="h-4 w-4 text-[#2A4792]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-gray-900">{clientName(message)}</p>
                  <p className="text-xs text-gray-500">{message.email}</p>
                </div>
                {message.unread_message_count > 0 && (
                  <span className="rounded-full bg-[#2A4792] px-2 py-0.5 text-[10px] font-bold text-white">
                    {message.unread_message_count}
                  </span>
                )}
                <span className="text-xs text-gray-400 shrink-0">{timeAgo(message.last_message_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
