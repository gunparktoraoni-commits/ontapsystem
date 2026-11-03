'use client';

import Link from "next/link";
import { Gem, MessageSquare } from "lucide-react";
import { PortalPanel } from "@/app/superadmin/components/ui/PortalPanel";

export default function InquiryPremiumGate({
  isFreeTrial = false,
}: {
  isFreeTrial?: boolean;
}) {
  const upgradeHref = isFreeTrial
    ? "/user/emarket?tab=purchase"
    : "/user/emarket?tab=subscription";

  const ctaLabel = isFreeTrial ? "Browse Products" : "View Subscriptions";

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 py-6">
      <PortalPanel padding="lg" className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#e8f0ff]">
          <MessageSquare className="h-7 w-7 text-[#2A4792]" />
        </div>
        <h2 className="text-xl font-extrabold tracking-tight text-gray-900">
          Premium BizCard required
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-500">
          Portfolio inquiries are available on a Premium BizCard subscription. Upgrade to receive
          and manage visitor messages from your public portfolio.
        </p>
        <Link
          href={upgradeHref}
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#2A4792] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1a3375]"
        >
          <Gem className="h-4 w-4" />
          {ctaLabel}
        </Link>
      </PortalPanel>
    </div>
  );
}
