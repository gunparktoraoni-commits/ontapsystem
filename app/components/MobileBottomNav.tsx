"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PortalNavItem } from "../config/portalNavigation";

const MOBILE_NAV_LABELS: Record<string, string> = {
  Dashboard: "Home",
  "My BizCards": "Cards",
  "Affiliate Status": "Affiliate",
  Associate: "Network",
  "E-market": "Market",
  "Generate BizCards": "Generate",
  Companies: "Companies",
  "Recycle Bin": "Recycle",
  Affiliates: "Affiliates",
  "Product Inquiries": "Inquiries",
  "Support Escalations": "Support",
  Subscriptions: "Plans",
  "Promos & Deals": "Promos",
  "Missions & Rewards": "Rewards",
  "Manage Content": "Content",
  "User Experience": "Experience",
  "Feature Requests": "Requests",
  Announcements: "News",
  Staffs: "Staff",
  "Client Orders": "Orders",
  "Theme Requests": "Themes",
  "Jobs & Integrations": "Jobs",
  "Audit Timeline": "Audit",
  "Auth Health": "Auth",
  "System Health": "System",
  "API Explorer": "API",
};

function isNavActive(pathname: string, href: string): boolean {
  const [path] = href.split("?");
  return pathname === path || pathname.startsWith(`${path}/`);
}

export default function MobileBottomNav({
  items,
}: {
  items: PortalNavItem[];
}) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const [scrollMetrics, setScrollMetrics] = useState({
    hasOverflow: false,
    thumbSize: 100,
    thumbPosition: 0,
  });

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const updateScrollMetrics = () => {
      const maxScroll = nav.scrollWidth - nav.clientWidth;
      const hasOverflow = maxScroll > 1;
      const thumbSize = hasOverflow
        ? (nav.clientWidth / nav.scrollWidth) * 100
        : 100;
      const progress = hasOverflow ? nav.scrollLeft / maxScroll : 0;

      setScrollMetrics({
        hasOverflow,
        thumbSize,
        thumbPosition: progress * (100 - thumbSize),
      });
    };

    updateScrollMetrics();
    nav.addEventListener("scroll", updateScrollMetrics, { passive: true });
    window.addEventListener("resize", updateScrollMetrics);
    const resizeObserver = new ResizeObserver(updateScrollMetrics);
    resizeObserver.observe(nav);

    return () => {
      nav.removeEventListener("scroll", updateScrollMetrics);
      window.removeEventListener("resize", updateScrollMetrics);
      resizeObserver.disconnect();
    };
  }, [items.length]);

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[8000] border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_18px_rgba(15,23,42,0.12)] backdrop-blur lg:hidden"
      data-mobile-bottom-nav
    >
      <nav
        ref={navRef}
        aria-label="Portal navigation"
        className="flex w-full overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex w-max min-w-full">
          {items.map((item) => {
            const active = isNavActive(pathname, item.href);
            const label = MOBILE_NAV_LABELS[item.label] ?? item.label;
            return (
              <Link
                key={item.href}
                href={item.href}
                draggable={false}
                aria-current={active ? "page" : undefined}
                title={item.label}
                className={`relative flex h-16 w-[20vw] shrink-0 snap-start flex-col items-center justify-center gap-1 px-1 text-center transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#4785B8] ${
                  active
                    ? "text-[#1a365d]"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {active && (
                  <span
                    className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-[#4785B8]"
                    aria-hidden="true"
                  />
                )}
                <item.icon
                  className={`h-5 w-5 shrink-0 ${
                    active ? "text-[#2A4792]" : "text-current"
                  }`}
                  aria-hidden="true"
                />
                <span className="max-w-full truncate text-[10px] font-medium leading-tight">
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>

      {scrollMetrics.hasOverflow && (
        <div
          className="mx-auto mb-1 mt-0.5 h-0.5 w-12 overflow-hidden rounded-full bg-slate-200"
          aria-hidden="true"
        >
          <span
            className="block h-full rounded-full bg-slate-500 transition-[left,width] duration-100"
            style={{
              left: `${scrollMetrics.thumbPosition}%`,
              position: "relative",
              width: `${scrollMetrics.thumbSize}%`,
            }}
          />
        </div>
      )}
    </div>
  );
}
