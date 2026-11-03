'use client';

/**
 * OnboardingGate.tsx
 * ──────────────────
 * Rendered by app/page.tsx (the root "/").
 *
 * Decision flow on every visit to "/":
 *
 *   Step 1 — Server session check (always runs first):
 *     • GET /api/auth/session with credentials: 'include'.
 *     • If { authenticated: true }  → redirect to ?redirect=… when safe, else dashboard.
 *     • If not authenticated        → proceed to Step 2.
 *
 *   Step 2 — Decide between tutorial and login form:
 *     • If `ontap:tutorial:seen` === "true" → LoginUser
 *     • Otherwise → OnboardingTutorial
 */

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getFrontendApiBaseUrl } from './apiBase';
import Loader from './Loader';
import { sanitizeInternalRedirectPath, extractClaimSerial, buildBlankCardNextPath } from '@/lib/bizcard/claim-urls';
import { fetchPhysicalCardScan, resolvePortfolioHref } from '@/lib/bizcard/scan-session';

const LoginUser = dynamic(() => import('./LoginUser'), {
  ssr: false,
  loading: () => <div className="min-h-screen bg-[#ECEEF5]" aria-hidden="true" />,
});

const OnboardingTutorial = dynamic(() => import('./OnboardingTutorial'), {
  ssr: false,
  loading: () => (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'linear-gradient(135deg, #0c1847 0%, #162666 40%, #1e2f82 70%, #2A4792 100%)' }}
    >
      <Loader size="xl" color="text-white" text="Preparing your experience..." textColor="text-white/80" />
    </div>
  ),
});

const TUTORIAL_SEEN_KEY = 'ontap:tutorial:seen';

type GateState = 'checking' | 'show-tutorial' | 'show-login';

function hasTutorialBeenSeen(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(TUTORIAL_SEEN_KEY) === 'true';
  } catch {
    return false;
  }
}

export default function OnboardingGate() {
  const [gateState, setGateState] = useState<GateState>('checking');
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = sanitizeInternalRedirectPath(searchParams.get('redirect'));
  const scanSerial = extractClaimSerial(searchParams.get('scan'));

  useEffect(() => {
    const API = getFrontendApiBaseUrl();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

    const resolveGuestView = () => {
      if (scanSerial) {
        setGateState('show-tutorial');
        return;
      }
      // Deep-link / email CTAs should skip the tutorial and go straight to login.
      if (redirectPath) {
        setGateState('show-login');
        return;
      }
      setGateState(hasTutorialBeenSeen() ? 'show-login' : 'show-tutorial');
    };

    fetch(`${API}/api/auth/session`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (res) => {
        clearTimeout(timer);

        if (res.ok) {
          const data = (await res.json().catch(() => null)) as {
            authenticated?: boolean;
            user?: { role?: string };
          } | null;

          if (data?.authenticated === true) {
            if (scanSerial) {
              setGateState('show-tutorial');
              return;
            }
            if (redirectPath) {
              router.replace(redirectPath);
              return;
            }
            const role = String(data.user?.role ?? '').toLowerCase();
            const isAdmin =
              role === 'company_admin' || role === 'admin' || role === 'manager';
            router.replace(isAdmin ? '/admin/dashboard' : '/user/dashboard');
            return;
          }
        }

        resolveGuestView();
      })
      .catch(() => {
        clearTimeout(timer);
        resolveGuestView();
      });

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [router, redirectPath, scanSerial]);

  const handleTutorialComplete = async () => {
    if (!scanSerial) {
      setGateState('show-login');
      return;
    }

    const result = await fetchPhysicalCardScan(scanSerial);
    if (!result.ok) throw new Error(result.message);

    const data = result.data;
    if (data.nextAction === 'show_portfolio' && data.redirectUrl) {
      window.location.replace(resolvePortfolioHref(data.redirectUrl));
      return;
    }
    if (data.status !== 'blank') {
      throw new Error('This card is no longer available for registration. Please scan it again or contact support.');
    }

    const destination = buildBlankCardNextPath(
      scanSerial,
      data.nextAction,
      data.virtualCards[0]?.id,
    );
    if (!destination) {
      throw new Error('Unable to determine the next step for this card. Please try again.');
    }
    router.replace(destination);
  };

  if (gateState === 'checking') {
    return <div className="min-h-screen bg-[#ECEEF5]" aria-hidden="true" />;
  }

  if (gateState === 'show-tutorial') {
    return (
      <OnboardingTutorial
        scanSerial={scanSerial ?? undefined}
        onComplete={handleTutorialComplete}
      />
    );
  }

  return <LoginUser />;
}
