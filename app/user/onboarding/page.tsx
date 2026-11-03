'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowRight, QrCode, ShieldCheck, Sparkles } from 'lucide-react';
import { buildClaimSignupPath } from '@/lib/bizcard/claim-urls';
import { isValidSerialId, normalizeSerialId } from '@/lib/bizcard/serial-id-format';

function readRefFromLocation(): string {
  if (typeof window === 'undefined') return '';
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = normalizeSerialId(params.get('ref') ?? params.get('serial') ?? '');
    if (raw && isValidSerialId(raw)) return raw;
    // Allow slightly looser client-side capture; server still validates on claim/merge.
    if (raw && /^[A-Z0-9]{4,12}$/.test(raw)) return raw;
    return '';
  } catch {
    return '';
  }
}

export default function BizcardScanOnboardingPage() {
  const router = useRouter();
  const [serialId, setSerialId] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const ref = readRefFromLocation();
    setSerialId(ref);
    setReady(true);
  }, []);

  const continueHref = useMemo(() => {
    if (!serialId) return '/user/signup';
    return buildClaimSignupPath(serialId);
  }, [serialId]);

  const handleContinue = () => {
    const target = continueHref.startsWith('http')
      ? continueHref
      : continueHref;
    if (target.startsWith('http')) {
      window.location.assign(target);
      return;
    }
    router.push(target);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#EEF2FA] text-slate-900">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(42,71,146,0.18), transparent 55%), radial-gradient(ellipse 60% 40% at 100% 100%, rgba(71,133,184,0.16), transparent 50%)',
        }}
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          className="rounded-3xl border border-white/70 bg-white/90 p-8 shadow-[0_24px_60px_-28px_rgba(42,71,146,0.45)] backdrop-blur"
        >
          <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#2A4792] text-white shadow-lg shadow-[#2A4792]/30">
            <QrCode className="h-7 w-7" aria-hidden />
          </div>

          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#4785B8]">
            OnTap BizCard
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-[#2A4792]">
            Welcome
          </h1>
          <p className="mt-3 text-base leading-relaxed text-slate-600">
            You scanned a physical BizCard. Continue to create your account and claim
            this card so your public profile stays linked to the QR code.
          </p>

          {ready && serialId ? (
            <div className="mt-5 rounded-2xl border border-[#D5DDEF] bg-[#F7F9FC] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Card serial
              </p>
              <p className="mt-1 font-mono text-lg font-semibold tracking-wider text-slate-900">
                {serialId}
              </p>
            </div>
          ) : null}

          {ready && !serialId ? (
            <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              No valid card reference was found in this link. You can still continue to
              registration, or scan the QR code again.
            </p>
          ) : null}

          <ul className="mt-6 space-y-3 text-sm text-slate-600">
            <li className="flex items-start gap-3">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#2A4792]" aria-hidden />
              <span>Set up your digital profile and custom portfolio URL.</span>
            </li>
            <li className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#2A4792]" aria-hidden />
              <span>Claim this BizCard so future scans open your public page.</span>
            </li>
          </ul>

          <motion.button
            type="button"
            whileTap={{ scale: 0.98 }}
            onClick={handleContinue}
            className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#2A4792] px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[#2A4792]/25 transition hover:bg-[#243d7d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2A4792]"
          >
            Get Started
            <ArrowRight className="h-4 w-4" aria-hidden />
          </motion.button>

          <p className="mt-4 text-center text-xs text-slate-500">
            Next: create your account and finish BizCard setup.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
