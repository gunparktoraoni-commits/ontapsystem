"use client";

import { Suspense, useEffect, useState } from "react";
import { SectionLoader } from "./Loader";
import InquiryUser from "./InquiryUser";
import InquiryPremiumGate from "./InquiryPremiumGate";
import { getFrontendApiBaseUrl } from "./apiBase";
import { buildImpersonationHeaders } from "@/app/lib/superadminImpersonationHandoff";
import {
  fetchUserBizcardTiers,
  hasPremiumBizcard,
} from "../lib/bizcardTierAccess";

export default function InquiryPageClient() {
  const API = getFrontendApiBaseUrl();
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [isFreeTrial, setIsFreeTrial] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        console.log("[InquiryPageClient] Starting permission checks...");

        // Create individual controllers with timeouts
        const sessionController = new AbortController();
        const sessionTimeout = setTimeout(() => sessionController.abort(), 10000);

        const subscriptionController = new AbortController();
        const subscriptionTimeout = setTimeout(() => subscriptionController.abort(), 10000);

        const cardsController = new AbortController();
        const cardsTimeout = setTimeout(() => cardsController.abort(), 10000);

        try {
          const [sessionRes, subscriptionRes, cards] = await Promise.all([
            fetch(`${API}/api/auth/session`, { 
              credentials: "include", 
              cache: "no-store",
              signal: sessionController.signal,
              headers: buildImpersonationHeaders(),
            }),
            fetch(`${API}/api/user/subscription`, { 
              credentials: "include", 
              cache: "no-store",
              signal: subscriptionController.signal,
              headers: buildImpersonationHeaders(),
            }),
            fetchUserBizcardTiers(API).catch(err => {
              if (err?.name === 'AbortError') throw new Error('Bizcards fetch timeout');
              throw err;
            }),
          ]);

          clearTimeout(sessionTimeout);
          clearTimeout(subscriptionTimeout);
          clearTimeout(cardsTimeout);

          console.log("[InquiryPageClient] Session:", sessionRes.status, "Subscription:", subscriptionRes.status);

          let isDev = false;
          if (sessionRes.ok) {
            const sessionPayload = await sessionRes.json().catch(() => null) as Record<string, unknown> | null;
            const user = sessionPayload?.user as Record<string, unknown> | undefined;
            isDev = String(user?.role ?? "").toLowerCase() === "dev";
            console.log("[InquiryPageClient] User role:", user?.role, "isDev:", isDev);
          }

          let freeTrial = false;
          let premiumBoosted = false;
          if (subscriptionRes.ok) {
            const subPayload = await subscriptionRes.json().catch(() => null) as Record<string, unknown> | null;
            const subData = (subPayload?.data ?? subPayload) as Record<string, unknown> | null;
            const accessReason = String(subData?.access_reason ?? "").toLowerCase();
            const tier = String(subData?.tier ?? "").toLowerCase();
            const isTrial = Boolean(subData?.is_trial);
            freeTrial = isTrial || accessReason === "free_trial" || tier === "free_trial";
            premiumBoosted = tier === "premium" || tier === "enterprise";
            console.log("[InquiryPageClient] Subscription tier:", tier, "isFreeTrial:", freeTrial);
          }

          console.log("[InquiryPageClient] Bizcards count:", cards?.length || 0, "hasPremium:", hasPremiumBizcard(cards));

          if (!cancelled) {
            setIsFreeTrial(freeTrial && !premiumBoosted && !hasPremiumBizcard(cards));
            setAllowed(isDev || premiumBoosted || hasPremiumBizcard(cards));
          }
        } catch (err) {
          clearTimeout(sessionTimeout);
          clearTimeout(subscriptionTimeout);
          clearTimeout(cardsTimeout);

          if (err instanceof Error && err.name === 'AbortError') {
            console.error("[InquiryPageClient] Request timeout - one of the permission checks took too long");
            throw new Error('Permission check timeout - please try again');
          }
          throw err;
        }
      } catch (err) {
        console.error("[InquiryPageClient] Permission check error:", err);
        if (!cancelled) setAllowed(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [API]);

  if (loading) {
    return <SectionLoader text="Loading inquiry permissions..." />;
  }

  if (!allowed) {
    return <InquiryPremiumGate isFreeTrial={isFreeTrial} />;
  }

  return (
    <Suspense fallback={<SectionLoader text="Loading inquiries..." />}>
      <InquiryUser />
    </Suspense>
  );
}
