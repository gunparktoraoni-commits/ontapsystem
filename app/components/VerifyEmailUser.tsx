'use client';

import { Mail, ArrowLeft } from 'lucide-react';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { InlineLoader } from './Loader';
import { showToast } from './Toast';
import { getFrontendApiBaseUrl } from './apiBase';
import { markEmailVerified } from '../lib/sessionStorage';

function writeAuthUser(userLike: unknown) {
  if (typeof window === 'undefined') return;
  try {
    const u = userLike && typeof userLike === 'object'
      ? (userLike as Record<string, unknown>)
      : {};
    const first = String(u.firstName ?? u.first_name ?? '').trim();
    const last = String(u.lastName ?? u.last_name ?? '').trim();
    const fullFallback = String(u.fullName ?? u.full_name ?? u.name ?? '').trim();
    const full = [first, last].filter(Boolean).join(' ').trim() || fullFallback;
    localStorage.setItem('authUser', JSON.stringify({
      ...u,
      firstName: first,
      lastName: last,
      fullName: full,
    }));
  } catch {
    // ignore localStorage errors
  }
  window.dispatchEvent(new CustomEvent('ontap:user-sync'));
}

const API = getFrontendApiBaseUrl();

// -- CSRF bootstrap --------------------------------------------------------
async function prewarmCsrfToken(): Promise<void> {
  try {
    const res = await fetch(`${API}/api/csrf-token`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) return;
    await res.json().catch(() => null);
  } catch {
    // Non-fatal
  }
}
// -------------------------------------------------------------------------

interface VerifyEmailUserProps {
  email?: string;
  /** userId is optional - not required in the new deferred-creation flow */
  userId?: number;
  emailSent?: boolean;
  emailError?: string;
  devOtp?: string;
  /** Called after successful verification. Receives the newly created userId. */
  onVerified: (userId?: number) => void;
  onBack?: () => void;
}

const RESEND_COOLDOWN_SECONDS = 60;

const VerifyEmailUser: React.FC<VerifyEmailUserProps> = ({
  email = '',
  userId,
  emailSent = true,
  emailError,
  devOtp,
  onVerified,
  onBack,
}) => {
  const [code, setCode] = useState<string[]>(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  // Resend cooldown timer
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Count down the resend cooldown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((prev) => prev - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleChange = (index: number, value: string) => {
    if (!/^[a-zA-Z0-9]*$/.test(value)) return;
    const newCode = [...code];
    newCode[index] = value.slice(-1);
    setCode(newCode);
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6);
    const newCode = [...code];
    for (let i = 0; i < pasted.length; i++) newCode[i] = pasted[i];
    setCode(newCode);
    inputRefs.current[Math.min(pasted.length, 5)]?.focus();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const otp = code.join('');
    if (otp.length < 6) {
      showToast('Please enter the complete 6-digit code.', 'error');
      return;
    }
    setLoading(true);
    try {
      // Send both email (new flow) and userId (legacy compat) so the
      // verify-email endpoint can handle both cases
      const payload: Record<string, unknown> = { otp };
      if (email) payload.email = email;
      if (userId && userId > 0) payload.userId = userId;

      const res = await fetch(`${API}/api/auth/verify-email`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        // Surface friendly messages for specific OTP error codes
        if (data.code === 'OTP_EXPIRED') {
          showToast('Your verification code has expired. Please click Resend to get a new one.', 'error');
        } else if (data.code === 'OTP_MAX_ATTEMPTS') {
          showToast('Too many incorrect attempts. Please click Resend to get a new code.', 'error');
        } else {
          showToast(data.error ?? data.message ?? 'Invalid code. Please try again.', 'error');
        }
        return;
      }
      // Save user profile so the dashboard/layout can read the real name immediately
      if (data.user) {
        writeAuthUser(data.user);
      }
      // Mark the email as verified in the local setup session
      markEmailVerified();
      // Pre-warm the CSRF token for the first authenticated POST
      await prewarmCsrfToken();
      // Pass the real userId returned from the server (created during OTP verification)
      const verifiedUserId = data.userId ? Number(data.userId) : data.user?.userId ? Number(data.user.userId) : undefined;
      onVerified(verifiedUserId);
    } catch {
      showToast('Unable to connect. Please check your internet connection.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = useCallback(async () => {
    if (resendCooldown > 0) return;
    setResendLoading(true);
    try {
      // Send both email and userId so the resend endpoint can serve both flows
      const payload: Record<string, unknown> = {};
      if (email) payload.email = email;
      if (userId && userId > 0) payload.userId = userId;

      const res = await fetch(`${API}/api/auth/resend-otp`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.code === 'RATE_LIMIT_EXCEEDED' && data.cooldownRemaining) {
          setResendCooldown(Number(data.cooldownRemaining));
          showToast(`Please wait ${data.cooldownRemaining} seconds before requesting another code.`, 'error');
        } else {
          showToast(data.error ?? data.message ?? 'Could not resend code.', 'error');
        }
        return;
      }
      if (data.emailSent === false) {
        showToast('Verification email could not be sent. Check SMTP configuration and try again.', 'error');
        return;
      }
      setCode(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
      showToast('A new code has been sent to your email.', 'success');
      // Start cooldown so the button is disabled for 60 s
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch {
      showToast('Unable to connect. Please check your internet connection.', 'error');
    } finally {
      setResendLoading(false);
    }
  }, [email, userId, resendCooldown]);

  const maskedEmail = email
    ? email.replace(/^(.{2})(.*)(@.*)$/, (_, a, b, c) => a + '*'.repeat(Math.max(1, b.length)) + c)
    : '';

  return (
    <div className="h-full w-full max-w-md rounded-2xl p-8 text-center">
      <div className="flex justify-center mb-6">
        <img src="/ontaplogo.svg" alt="OnTap Logo" width={70} height={70} className="w-17.5 h-auto" draggable={false} decoding="async" />
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-2">Verify your email</h1>
      <p className="text-gray-400 text-sm mb-8">
        {emailSent === false
          ? 'We could not deliver a verification email to your inbox'
          : "We've sent a 6-digit verification code to your email. Enter it below to complete registration."}
      </p>

      {emailSent === false && (
        <div className="mb-4 flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl px-4 py-3 text-left">
          <span className="mt-0.5 shrink-0">&#9888;</span>
          <span>
            Email delivery failed
            {emailError ? `: ${emailError}` : '.'} Use Resend below or fix SMTP settings in
            development.
          </span>
        </div>
      )}

      {devOtp && (
        <div className="mb-4 bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-xl px-4 py-3 text-left">
          <strong>Development only:</strong> verification code is{' '}
          <span className="font-mono font-bold tracking-widest">{devOtp}</span>
        </div>
      )}

      <div className="border border-gray-400 rounded-2xl p-6 mb-6">
        <div className="flex justify-center mb-4">
          <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center">
            <Mail className="h-7 w-7 text-[#2D3A8C]" />
          </div>
        </div>

        <p className="text-sm text-gray-400 mb-6">
          Enter the 6-digit code sent to{' '}
          <span className="font-bold text-gray-700">{maskedEmail || 'your email'}</span>
        </p>

        <form onSubmit={handleSubmit}>
          <div className="flex justify-center gap-2 mb-6">
            {code.map((digit, index) => (
              <input
                key={index}
                ref={(el) => { inputRefs.current[index] = el; }}
                type="text"
                inputMode="text"
                maxLength={1}
                value={digit}
                onChange={(e) => handleChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                onPaste={handlePaste}
                disabled={loading}
                className="w-11 h-11 text-center text-lg font-semibold border border-gray-200 rounded-xl focus:outline-none focus:border-[#2D3A8C] focus:ring-2 focus:ring-blue-100 transition-all disabled:opacity-50"
              />
            ))}
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-[#2D3A8C] hover:bg-[#243080] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-full transition-colors text-base cursor-pointer"
          >
            {loading ? <><InlineLoader /> Verifying...</> : 'Verify Code'}
          </button>
        </form>

        <p className="text-sm text-gray-400 mt-4">
          Didn&apos;t receive the code?{' '}
          {resendCooldown > 0 ? (
            <span className="text-gray-400 font-semibold">
              Resend in {resendCooldown}s
            </span>
          ) : (
            <button
              type="button"
              onClick={handleResend}
              disabled={resendLoading || loading}
              className="text-blue-600 font-semibold hover:underline cursor-pointer disabled:opacity-50"
            >
              {resendLoading ? 'Sending...' : 'Resend'}
            </button>
          )}
        </p>
      </div>

      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-gray-400 text-sm hover:text-gray-600 transition-colors cursor-pointer"
      >
        <ArrowLeft className="h-4 w-4" />
        back to login
      </button>
    </div>
  );
};

export default VerifyEmailUser;
