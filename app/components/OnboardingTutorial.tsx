'use client';

/**
 * OnboardingTutorial.tsx
 * ──────────────────────
 * An animated onboarding tutorial for first-time visitors and physical-card scans.
 *
 * The root gate checks the live session. A physical-card scan explicitly
 * opens this tutorial regardless of session or the regular tutorial-seen flag.
 *
 * Finishing the regular tutorial opens signup. A physical-card scan instead
 * rechecks the card and account state before routing to signup, registration,
 * or the merge choice.
 *
 * Constraints respected:
 *   • No new dependencies introduced — uses existing framer-motion ^12,
 *     lucide-react, and Tailwind v4 with the project color palette.
 *   • All SVG illustrations are inline (no external assets required).
 */

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  X,
  CheckCircle2,
} from 'lucide-react';

// ── localStorage key written by this component ───────────────────────────────
const TUTORIAL_SEEN_KEY = 'ontap:tutorial:seen'; // read by OnboardingGate on next visit

// ── Helpers ───────────────────────────────────────────────────────────────────

function markTutorialSeen(): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(TUTORIAL_SEEN_KEY, 'true'); } catch { /* ignore */ }
}

// ── Slide content ─────────────────────────────────────────────────────────────

interface SlideData {
  id: number;
  title: string;
  subtitle: string;
  description: string;
  illustration: React.ReactNode;
  accentColor: string;
}

// ── SVG Illustrations ─────────────────────────────────────────────────────────

const IllustrationWelcome = () => (
  <svg viewBox="0 0 320 260" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
    {/* Background circle */}
    <circle cx="160" cy="130" r="110" fill="#EEF2FA" />
    {/* Phone */}
    <rect x="120" y="60" width="80" height="140" rx="12" fill="white" stroke="#2A4792" strokeWidth="2.5"/>
    <rect x="130" y="75" width="60" height="90" rx="6" fill="#EEF2FA"/>
    {/* Screen content lines */}
    <rect x="138" y="85" width="44" height="5" rx="2.5" fill="#2A4792" opacity="0.7"/>
    <rect x="138" y="95" width="32" height="4" rx="2" fill="#4785B8" opacity="0.5"/>
    <rect x="138" y="108" width="44" height="28" rx="4" fill="#D5DDEF"/>
    {/* Card on screen */}
    <rect x="142" y="112" width="36" height="20" rx="3" fill="#2A4792"/>
    <rect x="145" y="116" width="16" height="3" rx="1.5" fill="white" opacity="0.8"/>
    <rect x="145" y="121" width="22" height="2" rx="1" fill="white" opacity="0.5"/>
    {/* QR icon hint */}
    <rect x="138" y="142" width="12" height="12" rx="2" fill="#2A4792" opacity="0.2"/>
    <rect x="139.5" y="143.5" width="4" height="4" rx="0.5" fill="#2A4792" opacity="0.6"/>
    <rect x="144.5" y="143.5" width="4" height="4" rx="0.5" fill="#2A4792" opacity="0.6"/>
    <rect x="139.5" y="148.5" width="4" height="4" rx="0.5" fill="#2A4792" opacity="0.6"/>
    {/* Home indicator */}
    <rect x="148" y="192" width="24" height="3" rx="1.5" fill="#2A4792" opacity="0.2"/>
    {/* Floating badge */}
    <rect x="185" y="90" width="52" height="28" rx="8" fill="#2A4792" opacity="0.9"/>
    <text x="211" y="108" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold">OnTap</text>
    {/* Stars */}
    <circle cx="80" cy="80" r="4" fill="#4785B8" opacity="0.4"/>
    <circle cx="240" cy="70" r="3" fill="#2A4792" opacity="0.3"/>
    <circle cx="250" cy="160" r="5" fill="#4785B8" opacity="0.25"/>
    <circle cx="70" cy="170" r="3.5" fill="#2A4792" opacity="0.3"/>
    {/* NFC wave lines */}
    <path d="M200 130 Q215 120 215 130 Q215 140 200 130" stroke="#4785B8" strokeWidth="1.5" fill="none" opacity="0.6"/>
    <path d="M200 130 Q225 115 225 130 Q225 145 200 130" stroke="#4785B8" strokeWidth="1.5" fill="none" opacity="0.4"/>
  </svg>
);

const IllustrationSignUp = () => (
  <svg viewBox="0 0 320 260" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
    <circle cx="160" cy="130" r="110" fill="#EEF2FA" />
    {/* Form card */}
    <rect x="80" y="55" width="160" height="160" rx="14" fill="white" stroke="#D5DDEF" strokeWidth="1.5"/>
    {/* Header */}
    <rect x="80" y="55" width="160" height="36" rx="14" fill="#2A4792"/>
    <rect x="80" y="75" width="160" height="16" fill="#2A4792"/>
    {/* Avatar circle */}
    <circle cx="160" cy="75" r="18" fill="white"/>
    <circle cx="160" cy="70" r="8" fill="#A8B8D9"/>
    <ellipse cx="160" cy="84" rx="12" ry="7" fill="#A8B8D9"/>
    {/* Form fields */}
    <rect x="96" y="105" width="128" height="10" rx="5" fill="#EEF2FA" stroke="#D5DDEF" strokeWidth="1"/>
    <rect x="96" y="122" width="128" height="10" rx="5" fill="#EEF2FA" stroke="#D5DDEF" strokeWidth="1"/>
    <rect x="96" y="139" width="128" height="10" rx="5" fill="#EEF2FA" stroke="#D5DDEF" strokeWidth="1"/>
    {/* Field labels */}
    <rect x="96" y="100" width="40" height="3" rx="1.5" fill="#A8B8D9"/>
    <rect x="96" y="117" width="30" height="3" rx="1.5" fill="#A8B8D9"/>
    <rect x="96" y="134" width="45" height="3" rx="1.5" fill="#A8B8D9"/>
    {/* Password dots */}
    <circle cx="101" cy="144" r="2" fill="#2A4792" opacity="0.5"/>
    <circle cx="108" cy="144" r="2" fill="#2A4792" opacity="0.5"/>
    <circle cx="115" cy="144" r="2" fill="#2A4792" opacity="0.5"/>
    {/* Submit btn */}
    <rect x="96" y="158" width="128" height="16" rx="8" fill="#2A4792"/>
    <rect x="128" y="163" width="64" height="6" rx="3" fill="white" opacity="0.8"/>
    {/* Check icon */}
    <circle cx="248" cy="165" r="14" fill="#22C55E" opacity="0.9"/>
    <path d="M241 165 L246 170 L255 159" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const IllustrationVerifyEmail = () => (
  <svg viewBox="0 0 320 260" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
    <circle cx="160" cy="130" r="110" fill="#EEF2FA" />
    {/* Envelope body */}
    <rect x="75" y="90" width="170" height="110" rx="12" fill="white" stroke="#2A4792" strokeWidth="2"/>
    {/* Envelope flap */}
    <path d="M75 102 L160 155 L245 102" stroke="#2A4792" strokeWidth="2" fill="none" strokeLinejoin="round"/>
    {/* OTP box */}
    <rect x="105" y="158" width="110" height="32" rx="8" fill="#EEF2FA" stroke="#D5DDEF" strokeWidth="1"/>
    {/* OTP digits */}
    <rect x="112" y="165" width="16" height="18" rx="4" fill="#2A4792"/>
    <text x="120" y="178" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">3</text>
    <rect x="133" y="165" width="16" height="18" rx="4" fill="#2A4792"/>
    <text x="141" y="178" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">7</text>
    <rect x="154" y="165" width="16" height="18" rx="4" fill="#4785B8"/>
    <text x="162" y="178" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">2</text>
    <rect x="175" y="165" width="16" height="18" rx="4" fill="#2A4792"/>
    <text x="183" y="178" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">9</text>
    <rect x="196" y="165" width="16" height="18" rx="4" fill="#A8B8D9"/>
    <rect x="204" y="171" width="1.5" height="8" rx="1" fill="#2A4792"/>
    {/* Shield icon top-right */}
    <circle cx="235" cy="90" r="20" fill="#22C55E" opacity="0.9"/>
    <path d="M227 90 L235 98 L244 82" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    {/* Sparkles */}
    <circle cx="85" cy="75" r="3" fill="#4785B8" opacity="0.4"/>
    <circle cx="245" cy="170" r="4" fill="#2A4792" opacity="0.2"/>
    <circle cx="75" cy="165" r="2.5" fill="#4785B8" opacity="0.3"/>
  </svg>
);

const IllustrationBizCard = () => (
  <svg viewBox="0 0 320 260" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
    <circle cx="160" cy="130" r="110" fill="#EEF2FA" />
    {/* Main BizCard */}
    <rect x="65" y="75" width="190" height="110" rx="14" fill="#2A4792"/>
    {/* Card shine */}
    <rect x="65" y="75" width="190" height="50" rx="14" fill="white" opacity="0.08"/>
    {/* Avatar */}
    <circle cx="100" cy="115" r="22" fill="white" opacity="0.15"/>
    <circle cx="100" cy="110" r="11" fill="white" opacity="0.6"/>
    <ellipse cx="100" cy="128" rx="16" ry="9" fill="white" opacity="0.6"/>
    {/* Name & title */}
    <rect x="128" y="100" width="90" height="7" rx="3.5" fill="white" opacity="0.9"/>
    <rect x="128" y="112" width="70" height="5" rx="2.5" fill="white" opacity="0.5"/>
    {/* Contact row */}
    <rect x="128" y="124" width="55" height="4" rx="2" fill="white" opacity="0.4"/>
    <rect x="128" y="133" width="65" height="4" rx="2" fill="white" opacity="0.4"/>
    {/* QR code bottom-right */}
    <rect x="210" y="145" width="34" height="34" rx="4" fill="white" opacity="0.9"/>
    <rect x="213" y="148" width="8" height="8" rx="1" fill="#2A4792"/>
    <rect x="223" y="148" width="8" height="8" rx="1" fill="#2A4792"/>
    <rect x="213" y="158" width="8" height="8" rx="1" fill="#2A4792"/>
    <rect x="223" y="153" width="3" height="3" rx="0.5" fill="#2A4792"/>
    <rect x="228" y="158" width="3" height="3" rx="0.5" fill="#2A4792"/>
    <rect x="223" y="163" width="8" height="4" rx="1" fill="#2A4792"/>
    {/* Social icons bar */}
    <rect x="75" y="155" width="120" height="22" rx="11" fill="white" opacity="0.12"/>
    <circle cx="98" cy="166" r="7" fill="white" opacity="0.3"/>
    <circle cx="118" cy="166" r="7" fill="white" opacity="0.3"/>
    <circle cx="138" cy="166" r="7" fill="white" opacity="0.3"/>
    <circle cx="158" cy="166" r="7" fill="white" opacity="0.3"/>
    {/* NFC chip */}
    <rect x="75" y="96" width="16" height="11" rx="2" fill="white" opacity="0.2" stroke="white" strokeWidth="0.5"/>
    {/* Floating card (back) */}
    <rect x="185" y="58" width="90" height="56" rx="10" fill="white" stroke="#D5DDEF" strokeWidth="1.5" transform="rotate(-8 185 58)"/>
    <rect x="192" y="66" width="60" height="5" rx="2.5" fill="#A8B8D9" transform="rotate(-8 185 58)"/>
    <rect x="192" y="75" width="40" height="4" rx="2" fill="#D5DDEF" transform="rotate(-8 185 58)"/>
  </svg>
);

const IllustrationDashboard = () => (
  <svg viewBox="0 0 320 260" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
    <circle cx="160" cy="130" r="110" fill="#EEF2FA" />
    {/* Browser chrome */}
    <rect x="60" y="65" width="200" height="145" rx="10" fill="white" stroke="#D5DDEF" strokeWidth="1.5"/>
    {/* Tab bar */}
    <rect x="60" y="65" width="200" height="20" rx="10" fill="#EEF2FA"/>
    <rect x="60" y="75" width="200" height="10" fill="#EEF2FA"/>
    <circle cx="75" cy="75" r="4" fill="#FF6B6B" opacity="0.7"/>
    <circle cx="88" cy="75" r="4" fill="#FFD93D" opacity="0.7"/>
    <circle cx="101" cy="75" r="4" fill="#6BCB77" opacity="0.7"/>
    {/* Sidebar */}
    <rect x="60" y="85" width="48" height="125" rx="0" fill="#2A4792"/>
    <rect x="60" y="185" width="48" height="25" rx="0" fill="#2A4792"/>
    <rect x="60" y="195" width="48" height="15" fill="#162666"/>
    {/* Sidebar items */}
    <rect x="68" y="100" width="28" height="5" rx="2.5" fill="white" opacity="0.6"/>
    <rect x="68" y="113" width="24" height="5" rx="2.5" fill="white" opacity="0.4"/>
    <rect x="68" y="126" width="26" height="5" rx="2.5" fill="white" opacity="0.4"/>
    <rect x="68" y="139" width="22" height="5" rx="2.5" fill="white" opacity="0.4"/>
    <rect x="68" y="152" width="28" height="5" rx="2.5" fill="white" opacity="0.4"/>
    <rect x="68" y="165" width="20" height="5" rx="2.5" fill="white" opacity="0.4"/>
    {/* Sidebar avatar */}
    <circle cx="84" cy="92" r="7" fill="white" opacity="0.2"/>
    {/* Main content area */}
    {/* Stats row */}
    <rect x="116" y="92" width="50" height="32" rx="6" fill="#EEF2FA" stroke="#D5DDEF" strokeWidth="1"/>
    <rect x="173" y="92" width="50" height="32" rx="6" fill="#EEF2FA" stroke="#D5DDEF" strokeWidth="1"/>
    <rect x="116" y="96" width="20" height="4" rx="2" fill="#A8B8D9"/>
    <rect x="116" y="104" width="30" height="8" rx="3" fill="#2A4792" opacity="0.7"/>
    <rect x="173" y="96" width="18" height="4" rx="2" fill="#A8B8D9"/>
    <rect x="173" y="104" width="28" height="8" rx="3" fill="#4785B8" opacity="0.7"/>
    {/* Chart */}
    <rect x="116" y="132" width="107" height="50" rx="6" fill="#EEF2FA" stroke="#D5DDEF" strokeWidth="1"/>
    <rect x="122" y="138" width="30" height="4" rx="2" fill="#A8B8D9"/>
    {/* Bar chart */}
    <rect x="125" y="163" width="8" height="12" rx="2" fill="#2A4792" opacity="0.6"/>
    <rect x="137" y="155" width="8" height="20" rx="2" fill="#2A4792" opacity="0.8"/>
    <rect x="149" y="158" width="8" height="17" rx="2" fill="#4785B8" opacity="0.7"/>
    <rect x="161" y="150" width="8" height="25" rx="2" fill="#2A4792" opacity="0.9"/>
    <rect x="173" y="160" width="8" height="15" rx="2" fill="#4785B8" opacity="0.6"/>
    <rect x="185" y="153" width="8" height="22" rx="2" fill="#2A4792" opacity="0.7"/>
    <rect x="197" y="156" width="8" height="19" rx="2" fill="#4785B8" opacity="0.8"/>
    {/* Notification badge */}
    <circle cx="226" cy="76" r="8" fill="#EF4444" opacity="0.9"/>
    <text x="226" y="80" textAnchor="middle" fill="white" fontSize="7" fontWeight="bold">3</text>
  </svg>
);

const IllustrationReady = () => (
  <svg viewBox="0 0 320 260" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
    <circle cx="160" cy="130" r="110" fill="#EEF2FA"/>
    {/* Big checkmark circle */}
    <circle cx="160" cy="115" r="55" fill="#2A4792" opacity="0.08"/>
    <circle cx="160" cy="115" r="44" fill="#2A4792" opacity="0.12"/>
    <circle cx="160" cy="115" r="34" fill="#2A4792"/>
    <path d="M145 115 L156 126 L176 103" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
    {/* Confetti dots */}
    <circle cx="100" cy="80" r="5" fill="#4785B8" opacity="0.5"/>
    <circle cx="220" cy="75" r="4" fill="#2A4792" opacity="0.4"/>
    <circle cx="85" cy="155" r="4" fill="#4785B8" opacity="0.3"/>
    <circle cx="235" cy="150" r="5" fill="#2A4792" opacity="0.35"/>
    <circle cx="108" cy="60" r="3" fill="#A8B8D9" opacity="0.6"/>
    <circle cx="212" cy="165" r="3" fill="#A8B8D9" opacity="0.5"/>
    <circle cx="240" cy="105" r="3.5" fill="#4785B8" opacity="0.4"/>
    <circle cx="80" cy="115" r="3" fill="#2A4792" opacity="0.3"/>
    {/* Tagline text area */}
    <rect x="95" y="168" width="130" height="8" rx="4" fill="#2A4792" opacity="0.15"/>
    <rect x="115" y="182" width="90" height="6" rx="3" fill="#4785B8" opacity="0.1"/>
    {/* Stars sparkle */}
    <path d="M75 90 L77 83 L79 90 L86 92 L79 94 L77 101 L75 94 L68 92 Z" fill="#4785B8" opacity="0.35"/>
    <path d="M242 130 L244 124 L246 130 L252 132 L246 134 L244 140 L242 134 L236 132 Z" fill="#2A4792" opacity="0.25"/>
  </svg>
);

const IllustrationPhysicalCard = () => (
  <svg viewBox="0 0 320 260" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
    <circle cx="160" cy="130" r="110" fill="#EEF2FA" />
    <rect x="42" y="81" width="104" height="72" rx="12" fill="white" stroke="#2A4792" strokeWidth="3" transform="rotate(-8 42 81)" />
    <rect x="62" y="99" width="32" height="32" rx="4" fill="#EEF2FA" transform="rotate(-8 62 99)" />
    <path d="M68 105h8v8h-8zM82 105h7v7h-7zM68 119h8v8h-8z" fill="#2A4792" transform="rotate(-8 68 105)" />
    <rect x="103" y="105" width="28" height="5" rx="2.5" fill="#A8B8D9" transform="rotate(-8 103 105)" />
    <rect x="105" y="116" width="22" height="4" rx="2" fill="#D5DDEF" transform="rotate(-8 105 116)" />
    <path d="M150 117h28m-8-8 9 8-9 8" stroke="#4785B8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="197" cy="118" r="7" fill="#4785B8" opacity=".2" />
    <path d="M197 126v23m0-1-42 30m42-30 43 30" stroke="#A8B8D9" strokeWidth="2.5" strokeDasharray="4 5" />
    <rect x="117" y="174" width="80" height="46" rx="12" fill="white" stroke="#D5DDEF" strokeWidth="2" />
    <circle cx="137" cy="192" r="8" fill="#2A4792" opacity=".12" />
    <path d="M133 192h8m-4-4v8" stroke="#2A4792" strokeWidth="2" strokeLinecap="round" />
    <rect x="150" y="188" width="34" height="5" rx="2.5" fill="#A8B8D9" />
    <rect x="150" y="198" width="24" height="4" rx="2" fill="#D5DDEF" />
    <rect x="204" y="174" width="80" height="46" rx="12" fill="white" stroke="#D5DDEF" strokeWidth="2" />
    <circle cx="224" cy="192" r="8" fill="#4785B8" opacity=".15" />
    <path d="M221 192h6m-3-3v6" stroke="#4785B8" strokeWidth="2" strokeLinecap="round" />
    <rect x="237" y="188" width="34" height="5" rx="2.5" fill="#A8B8D9" />
    <rect x="237" y="198" width="24" height="4" rx="2" fill="#D5DDEF" />
    <circle cx="197" cy="118" r="14" fill="#2A4792" opacity=".1" />
    <circle cx="197" cy="118" r="5" fill="#2A4792" />
    <path d="M154 71h12m-6-6v12m99 2 2-6 2 6 6 2-6 2-2 6-2-6-6-2z" fill="#4785B8" opacity=".6" />
  </svg>
);

// ── Slide definitions ─────────────────────────────────────────────────────────

const SLIDES: SlideData[] = [
  {
    id: 1,
    title: 'Welcome to OnTap',
    subtitle: 'Your Digital Business Card Platform',
    description:
      'OnTap transforms how you share contact information. Create stunning digital business cards, track who viewed them, and connect with people instantly via QR code or NFC tap — all from one dashboard.',
    illustration: <IllustrationWelcome />,
    accentColor: '#2A4792',
  },
  {
    id: 2,
    title: 'Create Your Account',
    subtitle: 'Quick & Easy Registration',
    description:
      'Sign up in minutes. Enter your name, email, and a secure password. We protect your data with industry-standard encryption.',
    illustration: <IllustrationSignUp />,
    accentColor: '#2A4792',
  },
  {
    id: 3,
    title: 'Verify Your Email',
    subtitle: 'Secure OTP Verification',
    description:
      'After registration, we send a one-time password (OTP) to your email. Enter it to confirm your identity and activate your account. This keeps your profile secure and prevents unauthorized access.',
    illustration: <IllustrationVerifyEmail />,
    accentColor: '#4785B8',
  },
  {
    id: 4,
    title: 'Build Your BizCard',
    subtitle: 'Profile · Contact · Social Links · QR · Themes · Connections',
    description:
      'Upload your photo, add your company details, contact numbers, and social media links. Your personalized Themes Design and NFC QR card are generated instantly — ready to share anywhere.',
    illustration: <IllustrationBizCard />,
    accentColor: '#2A4792',
  },
  {
    id: 5,
    title: 'Explore Your Dashboard',
    subtitle: 'Connections · Settings · Support',
    description:
      'Your dashboard gives you full control: manage connections, Save Contacts, download reports, customize themes, access customer support, and handle notifications — all in one modern interface.',
    illustration: <IllustrationDashboard />,
    accentColor: '#162666',
  },
  {
    id: 6,
    title: 'Bought a physical BizCard?',
    subtitle: 'Scan its QR code to get started',
    description:
      'New to OnTap? Create an account and claim your card. Signed in without a virtual BizCard? Register this card’s details. Already have a virtual BizCard? Choose whether to merge this physical card with it or register the physical card separately.',
    illustration: <IllustrationPhysicalCard />,
    accentColor: '#4785B8',
  },
  {
    id: 7,
    title: "You're All Set!",
    subtitle: 'Choose the next step that fits your account',
    description:
      'Finish this walkthrough to continue. OnTap will check your account and BizCard status, then take you to the right next step.',
    illustration: <IllustrationReady />,
    accentColor: '#2A4792',
  },
];



const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? '100%' : '-100%',
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
    transition: { type: 'spring' as const, stiffness: 320, damping: 32 },
  },
  exit: (direction: number) => ({
    x: direction > 0 ? '-100%' : '100%',
    opacity: 0,
    transition: { duration: 0.22, ease: 'easeIn' as const },
  }),
};

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.45, ease: 'easeOut' as const } },
};

// ── Progress dots ─────────────────────────────────────────────────────────────

interface ProgressDotsProps {
  total: number;
  current: number;
}

function ProgressDots({ total, current }: ProgressDotsProps) {
  return (
    <div className="flex items-center gap-2" role="tablist" aria-label="Tutorial progress">
      {Array.from({ length: total }).map((_, i) => (
        <motion.div
          key={i}
          role="tab"
          aria-selected={i === current}
          aria-label={`Slide ${i + 1} of ${total}`}
          animate={{
            width: i === current ? 24 : 8,
            backgroundColor: i === current ? '#2A4792' : '#D5DDEF',
            opacity: i < current ? 0.6 : 1,
          }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          style={{ height: 8, borderRadius: 4 }}
        />
      ))}
    </div>
  );
}

// ── Feature pill badges used on slide 4 ──────────────────────────────────────

const BIZCARD_FEATURES = ['Profile Photo', 'Company Info', 'Social Links', 'QR Code', 'NFC Card', 'Portfolio'];
const DASHBOARD_FEATURES = ['QR Code', 'Settings', 'Notifications', 'Themes', 'Support', 'Services'];
const SCAN_FEATURES = ['Create account', 'Register card details', 'Merge or register separately'];

function FeaturePills({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-3 justify-center sm:justify-start">
      {items.map((item) => (
        <span
          key={item}
          className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary/8 text-primary text-xs font-medium rounded-full border border-primary/15"
          style={{ backgroundColor: 'rgba(42,71,146,0.07)', color: '#2A4792', borderColor: 'rgba(42,71,146,0.15)' }}
        >
          <CheckCircle2 size={11} style={{ color: '#4785B8' }} />
          {item}
        </span>
      ))}
    </div>
  );
}

interface OnboardingTutorialProps {
  onComplete: () => void | Promise<void>;
  scanSerial?: string;
}

export default function OnboardingTutorial({ onComplete, scanSerial }: OnboardingTutorialProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [isMobile, setIsMobile] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const router = useRouter();
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const slideRefs = React.useRef<(HTMLDivElement | null)[]>([]);

  const isLast = currentIndex === SLIDES.length - 1;
  const slide  = SLIDES[currentIndex];

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Mobile scroll-snap observer
  useEffect(() => {
    if (!isMobile || !scrollContainerRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
            const index = slideRefs.current.indexOf(entry.target as HTMLDivElement);
            if (index !== -1 && index !== currentIndex) {
              setCurrentIndex(index);
              setDirection(index > currentIndex ? 1 : -1);
            }
          }
        });
      },
      {
        root: scrollContainerRef.current,
        threshold: [0.5, 0.75, 1.0],
      }
    );

    slideRefs.current.forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => observer.disconnect();
  }, [isMobile, currentIndex]);

  // Keyboard navigation (desktop only)
  useEffect(() => {
    if (isMobile) return;
    
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') handleNext();
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   handlePrev();
      if (e.key === 'Escape' && !scanSerial) handleFinish();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, isMobile, scanSerial]);

  function handleNext() {
    if (isLast) { handleFinish(); return; }
    setDirection(1);
    setCurrentIndex((p) => p + 1);
  }

  function handlePrev() {
    if (currentIndex === 0) return;
    setDirection(-1);
    setCurrentIndex((p) => p - 1);
  }

  async function handleFinish() {
    if (isCompleting) return;
    setIsCompleting(true);
    setCompletionError(null);
    markTutorialSeen();
    try {
      await onComplete();
      if (!scanSerial) router.push('/user/signup');
    } catch (error) {
      setCompletionError(error instanceof Error ? error.message : 'Unable to continue. Please try again.');
      setIsCompleting(false);
    }
  }

  function handleSkip() {
    markTutorialSeen();
    onComplete();
    // Skip redirects to the root/home page where LoginUser is shown
    router.push('/');
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #0c1847 0%, #162666 40%, #1e2f82 70%, #2A4792 100%)' }}
      role="dialog"
      aria-modal="true"
      aria-label="OnTap onboarding tutorial"
    >
      {/* ── Decorative SVG card background layer ─────────────────────────── */}
      {/* Mimics the reference: multiple cards scattered at varied angles/sizes */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {/* Large card — top-left, tilted left */}
        <img
          src="/ontapontap.png"
          alt=""
          width={340}
          height={214}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="absolute"
          style={{
            width: 'clamp(180px, 26vw, 340px)',
            height: 'auto',
            top: '-6%',
            left: '-8%',
            transform: 'rotate(-22deg)',
            opacity: 0.13,
          }}
        />
        {/* Medium card — top-right, tilted right */}
        <img
          src="/ontapontap.png"
          alt=""
          width={240}
          height={151}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="absolute"
          style={{
            width: 'clamp(130px, 18vw, 240px)',
            height: 'auto',
            top: '2%',
            right: '-4%',
            transform: 'rotate(18deg)',
            opacity: 0.56,
          }}
        />
        {/* Small card — upper-right area */}
        <img
          src="/ontapontap.png"
          alt=""
          width={160}
          height={101}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="absolute"
          style={{
            width: 'clamp(90px, 12vw, 160px)',
            height: 'auto',
            top: '8%',
            right: '12%',
            transform: 'rotate(-8deg)',
            opacity: 0.59,
          }}
        />
        {/* Medium card — left edge, mid-height */}
        <img
          src="/ontapontap.png"
          alt=""
          width={210}
          height={132}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="absolute"
          style={{
            width: 'clamp(120px, 16vw, 210px)',
            height: 'auto',
            top: '28%',
            left: '-5%',
            transform: 'rotate(12deg)',
            opacity: 0.50,
          }}
        />
        {/* Large card — bottom-right, angled */}
        <img
          src="/ontapontap.png"
          alt=""
          width={360}
          height={227}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="absolute"
          style={{
            width: 'clamp(200px, 28vw, 360px)',
            height: 'auto',
            bottom: '-8%',
            right: '-6%',
            transform: 'rotate(-16deg)',
            opacity: 0.64,
          }}
        />
        {/* Small card — bottom-left */}
        <img
          src="/ontapontap.png"
          alt=""
          width={170}
          height={107}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="absolute"
          style={{
            width: 'clamp(100px, 13vw, 170px)',
            height: 'auto',
            bottom: '4%',
            left: '6%',
            transform: 'rotate(20deg)',
            opacity: 0.48,
          }}
        />
        {/* Tiny card — bottom-center-right */}
        <img
          src="/ontapontap.png"
          alt=""
          width={130}
          height={82}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="absolute"
          style={{
            width: 'clamp(80px, 10vw, 130px)',
            height: 'auto',
            bottom: '12%',
            right: '28%',
            transform: 'rotate(6deg)',
            opacity: 0.07,
          }}
        />
      </div>

      {/* Ambient glow blobs */}
      <div
        className="pointer-events-none absolute -top-24 -left-20 w-96 h-96 rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(71,133,184,0.30) 0%, transparent 70%)' }}
      />
      <div
        className="pointer-events-none absolute bottom-0 right-0 w-80 h-80 rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(42,71,146,0.40) 0%, transparent 70%)' }}
      />

     
      {!isLast && !scanSerial && (
        <button
          onClick={handleSkip}
          className="absolute top-4 right-4 sm:top-5 sm:right-5 flex items-center gap-1.5 text-white/80 hover:text-white text-sm sm:text-base font-semibold transition-all z-10 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 backdrop-blur-sm shadow-lg border border-white/20"
          aria-label="Skip tutorial and go to login"
        >
          Skip <X size={16} className="sm:w-[15px] sm:h-[15px]" />
        </button>
      )}

      
      <div
        className="relative w-full max-w-4xl mx-4 rounded-2xl overflow-hidden shadow-2xl bg-white"
        style={{ maxHeight: '90vh' }}
      >
        {/* Logo strip */}
        <div className="flex items-center justify-between px-4 sm:px-8 pt-4 sm:pt-6 pb-0">
          <img src="/ontaplogo.svg" alt="OnTap Logo" width={112} height={28} className="h-6 sm:h-7 w-auto" draggable={false} decoding="async" />
          <span className="text-xs font-medium text-gray-400 tabular-nums">
            {currentIndex + 1} / {SLIDES.length}
          </span>
        </div>

       
        <div
          ref={scrollContainerRef}
          className="relative overflow-y-auto overflow-x-hidden"
          style={{
            maxHeight: 'calc(90vh - 140px)',
            scrollSnapType: isMobile ? 'y mandatory' : 'none',
            scrollBehavior: 'smooth',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {isMobile ? (
            // Mobile: Render all slides for scroll-snap
            <>
              {SLIDES.map((slideData, index) => (
                <div
                  key={slideData.id}
                  ref={(el) => { slideRefs.current[index] = el; }}
                  className="flex flex-col items-center gap-4 px-4 sm:px-6 pt-4 sm:pt-6 pb-4 sm:pb-6"
                  style={{
                    height: 'calc(90vh - 140px)',
                    minHeight: 'calc(90vh - 140px)',
                    maxHeight: 'calc(90vh - 140px)',
                    scrollSnapAlign: 'start',
                    scrollSnapStop: 'always',
                    overflow: 'hidden',
                  }}
                >
                  {/* Illustration */}
                  <div className="w-full flex-shrink-0 flex items-center justify-center" style={{ height: '200px', maxHeight: '200px' }}>
                    <div className="w-full h-full max-w-[240px] sm:max-w-[280px] mx-auto">
                      {slideData.illustration}
                    </div>
                  </div>

                  {/* Text */}
                  <div className="w-full flex-1 flex flex-col items-center text-center overflow-y-auto pb-2 sm:pb-4">
                    {/* Step badge */}
                    <span
                      className="inline-block text-xs font-semibold px-3 py-1 rounded-full mb-2 sm:mb-3 flex-shrink-0"
                      style={{ backgroundColor: 'rgba(42,71,146,0.08)', color: '#2A4792' }}
                    >
                      Step {slideData.id} of {SLIDES.length}
                    </span>

                    <h2 className="text-xl sm:text-2xl font-bold text-gray-900 leading-tight mb-1 flex-shrink-0">
                      {slideData.title}
                    </h2>
                    <p className="text-sm font-semibold mb-2 sm:mb-3 flex-shrink-0" style={{ color: '#4785B8' }}>
                      {slideData.subtitle}
                    </p>
                    <p className="text-sm text-gray-500 leading-relaxed max-w-md px-2 sm:px-0 flex-shrink-0">
                      {slideData.description}
                    </p>

                    {/* Feature pills */}
                    {slideData.id === 4 && <div className="flex-shrink-0"><FeaturePills items={BIZCARD_FEATURES} /></div>}
                    {slideData.id === 5 && <div className="flex-shrink-0"><FeaturePills items={DASHBOARD_FEATURES} /></div>}
                    {slideData.id === 6 && <div className="flex-shrink-0"><FeaturePills items={SCAN_FEATURES} /></div>}

                  </div>
                </div>
              ))}
            </>
          ) : (
            // Desktop: AnimatePresence with slide transitions
            <AnimatePresence initial={false} custom={direction} mode="wait">
              <motion.div
                key={slide.id}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                className="flex flex-col md:flex-row items-center gap-4 md:gap-6 px-4 sm:px-6 md:px-12 pt-4 sm:pt-6 pb-4 sm:pb-6"
              >
                {/* Illustration — top on mobile, left column on md+ */}
                <div className="w-full md:w-[42%] flex-shrink-0 flex items-center justify-center" style={{ minHeight: '180px', maxHeight: '240px' }}>
                  <div className="w-full h-full max-w-[240px] sm:max-w-[280px] mx-auto">
                    {slide.illustration}
                  </div>
                </div>

                {/* Text — bottom on mobile, right column on md+ */}
                <motion.div
                  className="w-full md:flex-1 flex flex-col items-center md:items-start text-center md:text-left pb-2 sm:pb-4"
                  variants={fadeUp}
                  initial="initial"
                  animate="animate"
                >
                  {/* Step badge */}
                  <span
                    className="inline-block text-xs font-semibold px-3 py-1 rounded-full mb-2 sm:mb-3"
                    style={{ backgroundColor: 'rgba(42,71,146,0.08)', color: '#2A4792' }}
                  >
                    Step {slide.id} of {SLIDES.length}
                  </span>

                  <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 leading-tight mb-1">
                    {slide.title}
                  </h2>
                  <p className="text-sm font-semibold mb-2 sm:mb-3" style={{ color: '#4785B8' }}>
                    {slide.subtitle}
                  </p>
                  <p className="text-sm text-gray-500 leading-relaxed max-w-md px-2 sm:px-0">
                    {slide.description}
                  </p>

                  {/* Feature pills on slide 4 (BizCard) and slide 5 (Dashboard) */}
                  {slide.id === 4 && <FeaturePills items={BIZCARD_FEATURES} />}
                  {slide.id === 5 && <FeaturePills items={DASHBOARD_FEATURES} />}

                  {slide.id === 6 && <FeaturePills items={SCAN_FEATURES} />}
                </motion.div>
              </motion.div>
            </AnimatePresence>
          )}
        </div>

        {/* ── Navigation footer ─────────────────────────────────────────── */}
        <div className={`flex items-center px-4 sm:px-8 md:px-12 pb-4 sm:pb-7 pt-3 sm:pt-4 border-t border-gray-100 ${
          isMobile ? 'justify-center' : 'justify-between'
        }`}>
          {/* Back button - hidden on mobile */}
          <button
            onClick={handlePrev}
            disabled={currentIndex === 0}
            className={`flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm font-medium text-gray-500 hover:text-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors min-h-[48px] sm:min-h-0 px-2 sm:px-0 ${
              isMobile ? 'hidden' : ''
            }`}
            aria-label="Previous slide"
          >
            <ChevronLeft size={18} className="w-5 h-5 sm:w-[18px] sm:h-[18px]" /> <span className="hidden xs:inline">Previous</span><span className="inline xs:hidden">Prev</span>
          </button>

          {/* Progress dots - always visible */}
          <ProgressDots total={SLIDES.length} current={currentIndex} />

          {/* Next / Finish button - hidden on mobile */}
          {isLast ? (
            <button
              onClick={handleFinish}
              disabled={isCompleting}
              className="flex items-center gap-1.5 text-sm font-semibold px-5 py-2.5 rounded-xl text-white transition-all min-h-[48px] disabled:cursor-wait disabled:opacity-70"
              style={{ background: '#2A4792' }}
              aria-label="Finish tutorial"
            >
              {isCompleting ? 'Continuing…' : 'Finish'} <CheckCircle2 size={16} />
            </button>
          ) : (
            <button
              onClick={handleNext}
              className={`flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm font-semibold px-3 sm:px-5 py-2 sm:py-2.5 rounded-xl text-white transition-all hover:opacity-90 min-h-[48px] sm:min-h-0 ${
                isMobile ? 'hidden' : ''
              }`}
              style={{ background: '#2A4792' }}
              aria-label="Next slide"
            >
              Next <ChevronRight size={18} className="w-5 h-5 sm:w-[18px] sm:h-[18px]" />
            </button>
          )}
        </div>
        {completionError && (
          <p role="alert" className="px-5 pb-4 text-center text-sm text-red-700">
            {completionError}
          </p>
        )}
      </div>
    </div>
  );
}
