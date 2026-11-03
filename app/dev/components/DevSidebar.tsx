"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, LogOut, Settings, ChevronDown } from "lucide-react";
import { AccountMenuLegalLinks } from "@/app/components/legal/AccountMenuLegalLinks";
import { PhysicalBizCardHelpButton } from "@/app/components/PhysicalBizCardHelp";
import PortalSidebar from "@/app/components/PortalSidebar";
import { DEV_NAV_ITEMS } from "@/app/config/portalNavigation";
import { performLogout } from "@/app/lib/logoutClient";
import type { SupportConversation } from "@/app/lib/supportMessaging";
import { devApiJson } from "@/app/dev/lib/devApi";

const PAGE_TITLES: { prefix: string; title: string }[] = [
  { prefix: "/dev/overview", title: "Overview" },
  { prefix: "/dev/dashboard", title: "Overview" },
  { prefix: "/dev/incidents", title: "Incidents" },
  { prefix: "/dev/error-logs", title: "Incidents" },
  { prefix: "/dev/escalations", title: "Escalations" },
  { prefix: "/dev/concerns", title: "Escalations" },
  { prefix: "/dev/inquiry", title: "Theme Requests" },
  { prefix: "/dev/impact", title: "Impact" },
  { prefix: "/dev/auth-health", title: "Auth Health" },
  { prefix: "/dev/jobs", title: "Jobs & Integrations" },
  { prefix: "/dev/audit", title: "Audit Timeline" },
  { prefix: "/dev/integrity", title: "Auth Health" },
  { prefix: "/dev/controls", title: "Controls" },
  { prefix: "/dev/notice-board", title: "Notice Board" },
  { prefix: "/dev/system-health", title: "System Health" },
  { prefix: "/dev/api-explorer", title: "API Explorer" },
  { prefix: "/dev/clients", title: "Clients" },
  { prefix: "/dev/settings", title: "Settings" },
];

function resolvePageTitle(pathname: string): string {
  const match = PAGE_TITLES.find(
    (item) => pathname === item.prefix || pathname.startsWith(`${item.prefix}/`),
  );
  return match?.title ?? "Developer Portal";
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "DV";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

interface DevSidebarProps {
  children: React.ReactNode;
}

export default function DevSidebar({ children }: DevSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const pageTitle = useMemo(() => resolvePageTitle(pathname), [pathname]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [displayName, setDisplayName] = useState("Dev User");
  const [email, setEmail] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<
    Array<{ id: string; title: string; time: string; unread: boolean; href: string }>
  >([]);
  const avatarRef = useRef<HTMLDivElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);

  const loadIdentity = useCallback(async () => {
    try {
      const result = await devApiJson<Record<string, unknown>>("/api/superadmin/settings/profile", {
        method: "GET",
      });
      if (!result.ok || !result.data) return;
      const data = result.data;
      const name =
        String(data.name ?? "").trim() ||
        `${String(data.first_name ?? "").trim()} ${String(data.last_name ?? "").trim()}`.trim() ||
        "Dev User";
      setDisplayName(name);
      setEmail(String(data.email ?? ""));
    } catch {
      // keep defaults
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      const [escalationsResult, unreadResult] = await Promise.all([
        devApiJson<SupportConversation[]>("/api/superadmin/support/escalations", { method: "GET" }),
        devApiJson<{ count?: number }>("/api/superadmin/support/escalations/unread/count", {
          method: "GET",
        }),
      ]);

      if (unreadResult.ok) {
        setUnreadCount(Number(unreadResult.data?.count ?? 0));
      }

      if (escalationsResult.ok) {
        const list = (escalationsResult.data ?? []) as SupportConversation[];
        const recent = list
          .filter((c) => c.status !== "resolved" && c.status !== "closed")
          .slice(0, 6)
          .map((c) => ({
            id: c.id,
            title: c.lastMessagePreview || `Escalation from ${c.client?.name ?? "client"}`,
            time: relativeTime(c.escalatedAt ?? c.lastMessageAt),
            unread: (c.unreadCount ?? 0) > 0,
            href: "/dev/escalations",
          }));
        setNotifications(recent);
        if (!unreadResult.ok) {
          setUnreadCount(recent.filter((n) => n.unread).length);
        }
      }
    } catch {
      // keep previous
    }
  }, []);

  useEffect(() => {
    void loadIdentity();
    void loadNotifications();
    const id = window.setInterval(() => {
      void loadNotifications();
    }, 30000);
    return () => window.clearInterval(id);
  }, [loadIdentity, loadNotifications]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) {
        setAvatarOpen(false);
      }
      if (notificationRef.current && !notificationRef.current.contains(e.target as Node)) {
        setNotificationOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const initials = initialsFromName(displayName);

  return (
    <div className="bg-[#F4F7FC]">
      <PortalSidebar
        portal="dev"
        navItems={DEV_NAV_ITEMS}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        roleBadge="Developer"
        defaultDisplayName={displayName}
      />

      <div className="lg:ml-55 h-screen overflow-hidden flex flex-col">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 shadow-sm sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="hidden h-6 w-1 shrink-0 rounded-full sm:block"
              style={{ background: "linear-gradient(180deg,#2A4792,#4785B8)" }}
            />
            <h1 className="truncate text-xl font-bold text-gray-900 sm:text-2xl">{pageTitle}</h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="relative" ref={notificationRef}>
              <PhysicalBizCardHelpButton />

              <AnimatePresence>
                {notificationOpen ? (
                  <motion.div
                    key="dev-notifications"
                    initial={{ opacity: 0, y: 6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.98 }}
                    transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                    className="absolute right-0 z-50 mt-2 w-72 origin-top-right rounded-xl border border-gray-100 bg-white py-4 shadow-lg"
                  >
                    <div className="flex items-center justify-between border-b border-gray-100 px-4 pb-2">
                      <p className="text-sm font-semibold text-gray-900">Notifications</p>
                      <span className="text-xs font-semibold text-red-500">
                        {unreadCount} unread
                      </span>
                    </div>

                    {notifications.length === 0 ? (
                      <p className="px-4 py-6 text-center text-sm text-gray-400">
                        No open escalations
                      </p>
                    ) : (
                      notifications.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => {
                            setNotificationOpen(false);
                            router.push(n.href);
                          }}
                          className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 ${
                            n.unread ? "bg-blue-50/40" : ""
                          }`}
                        >
                          {n.unread ? (
                            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                          ) : (
                            <span className="mt-1.5 h-2 w-2 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-gray-800">{n.title}</p>
                            <p className="mt-0.5 text-xs text-gray-400">{n.time}</p>
                          </div>
                        </button>
                      ))
                    )}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>

            <div className="relative" ref={avatarRef}>
              <button
                type="button"
                onClick={() => setAvatarOpen((v) => !v)}
                aria-label="Account menu"
                className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-[#2A4792]/30"
              >
                <div
                  className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                  style={{ background: "linear-gradient(135deg,#2A4792,#4785B8)" }}
                >
                  {initials}
                  {unreadCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white ring-2 ring-white">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </div>
                <span className="hidden max-w-28 truncate text-sm font-semibold text-gray-800 sm:block">
                  {displayName}
                </span>
                <ChevronDown className="hidden h-3.5 w-3.5 text-gray-400 sm:block" />
              </button>

              <AnimatePresence>
                {avatarOpen ? (
                  <motion.div
                    key="dev-avatar-menu"
                    initial={{ opacity: 0, y: 6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.98 }}
                    transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                    className="absolute right-0 z-50 mt-2 w-52 origin-top-right rounded-xl border border-gray-100 bg-white py-1 shadow-lg"
                  >
                    <div className="border-b border-gray-100 px-4 py-3">
                      <p className="truncate text-sm font-semibold text-gray-800">{displayName}</p>
                      <p className="mt-0.5 truncate text-xs text-gray-500">{email || "—"}</p>
                      <span className="mt-1.5 inline-block rounded-full bg-[#EEF2FA] px-2 py-0.5 text-[10px] font-semibold text-[#2A4792]">
                        Developer
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setAvatarOpen(false);
                        setNotificationOpen(true);
                      }}
                      className="flex w-full items-center justify-between gap-2 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      <span className="flex items-center gap-2"><Bell className="h-4 w-4" />Notifications</span>
                      {unreadCount > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600">{unreadCount}</span>}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAvatarOpen(false);
                        router.push("/dev/settings");
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      <Settings className="h-4 w-4" />
                      Settings
                    </button>

                    <AccountMenuLegalLinks onNavigate={() => setAvatarOpen(false)} />

                    <button
                      type="button"
                      onClick={() => {
                        setAvatarOpen(false);
                        void performLogout({ redirectTo: "/" });
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 transition-colors hover:bg-red-50"
                    >
                      <LogOut className="h-4 w-4" />
                      Logout
                    </button>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-[#F4F7FC] p-4 pb-28 sm:p-6 sm:pb-28 lg:p-8 lg:pb-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
