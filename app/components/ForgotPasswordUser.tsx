'use client';

import { Mail, ArrowLeft, CheckCircle, KeyRound, Eye, EyeOff, Send } from 'lucide-react';
import Link from 'next/link';
import React, { useState, useRef } from 'react';
import { getFrontendApiBaseUrl } from './apiBase';
import { InlineLoader } from './Loader';
import { showToast } from './Toast';

const API = getFrontendApiBaseUrl();

type Step = 'email' | 'verify' | 'reset' | 'success';

const ForgotPasswordUser = () => {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [userId, setUserId] = useState<number | null>(null);
  const [code, setCode] = useState<string[]>(['', '', '', '', '', '']);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const maskedEmail = email
    ? email.replace(/^(.{2})(.*)(@.*)$/, (_, a, b, c) => a + '*'.repeat(Math.max(1, b.length)) + c)
    : '';
  // --- OTP handlers (alphanumeric: A-Z, a-z, 0-9) ---
  const handleOtpChange = (index: number, value: string) => {
    if (!/^[a-zA-Z0-9]*$/.test(value)) return;
    const next = [...code];
    next[index] = value.slice(-1);
    setCode(next);
    if (value && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6);
    const next = [...code];
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setCode(next);
    inputRefs.current[Math.min(pasted.length, 5)]?.focus();
  };
  // ============================
  // STEP 1 — Enter Email
  // ============================
  if (step === 'email') {
    const handleSendEmail = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email.trim()) { showToast('Please enter your email address.', 'error'); return; }
      setLoading(true);
      try {
        const res = await fetch(`${API}/api/auth/forgot-password`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim() }),
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.error || 'Failed to send reset code. Please try again.', 'error'); return; }
        if (data.userId) {
          setUserId(data.userId);
          setStep('verify');
        } else {
          // Email not in system — show generic message per API spec
          showToast('If an account with that email exists, a code has been sent.', 'info');
        }
      } catch {
        showToast('Network error. Please check your connection and try again.', 'error');
      } finally {
        setLoading(false);
      }
    };
    return (
      <div className="w-full max-w-md bg-white rounded-2xl p-8 text-center animate-fade-in-up">
        <div className="flex justify-center mb-6">
          <img src="/ontaplogo.svg" alt="OnTap Logo" width={70} height={70} className="w-17.5 h-auto" draggable={false} decoding="async" />
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">Forgot Password?</h1>
        <p className="text-gray-400 text-sm mb-8">
          Enter your email and we&apos;ll send a reset code
        </p>

        <form onSubmit={handleSendEmail}>
          <div className="border border-gray-200 rounded-2xl p-6 mb-6">
            <div className="text-left mb-4">
              <label className="block text-sm font-semibold text-gray-700 mb-2">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  type="email"
                  placeholder="email@gmail.com"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); }}
                  className="w-full pl-11 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all duration-300"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#2D3A8C] hover:bg-[#243080] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-full transition-all duration-200 text-sm cursor-pointer flex items-center justify-center gap-2 active:scale-[0.98]"
            >
              {loading ? <InlineLoader /> : <Send className="h-4 w-4" />}
              {loading ? 'Sending...' : 'Send Reset Code'}
            </button>
          </div>
        </form>

        <Link
          href="/"
          className="inline-flex items-center gap-2 text-gray-400 text-sm hover:text-gray-600 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          back to login
        </Link>
      </div>
    );
  }

  // ============================
  // STEP 2 — Verify OTP
  // ============================
  if (step === 'verify') {
    const handleVerify = async (e: React.FormEvent) => {
      e.preventDefault();
      const otp = code.join('');
      if (otp.length < 6) { showToast('Please enter the full 6-character code.', 'error'); return; }
      setLoading(true);
      try {
        const res = await fetch(`${API}/api/auth/verify-code`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, code: otp }),
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.error || 'Invalid or expired code. Please try again.', 'error'); return; }
        if (data.verified) {
          setStep('reset');
        } else {
          showToast('Verification failed. Please try again.', 'error');
        }
      } catch {
        showToast('Network error. Please check your connection and try again.', 'error');
      } finally {
        setLoading(false);
      }
    };

    const handleResend = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API}/api/auth/forgot-password`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();
        if (res.ok && data.userId) {
          setUserId(data.userId);
          setCode(['', '', '', '', '', '']);
          showToast('A new code has been sent to your email.', 'success');
        } else {
          showToast(data.error || 'Could not resend code. Please try again.', 'error');
        }
      } catch {
        showToast('Network error. Please try again.', 'error');
      } finally {
        setLoading(false);
      }
    };

  

    return (
      <div className="w-full max-w-md bg-white rounded-2xl p-8 text-center animate-fade-in-up">
        <div className="flex justify-center mb-6">
          <img src="/ontaplogo.svg" alt="OnTap Logo" width={70} height={70} className="w-17.5 h-auto" draggable={false} decoding="async" />
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">Verify your email</h1>
        <p className="text-gray-400 text-sm mb-8">
          We&apos;ve sent a 6-character code to your email
        </p>

        <div className="border border-gray-200 rounded-2xl p-6 mb-6">
          <div className="flex justify-center mb-4">
            <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center">
              <Mail className="h-7 w-7 text-[#2D3A8C]" />
            </div>
          </div>

          <p className="text-sm text-gray-400 mb-6">
            Enter the 6-character code sent to{' '}
            <span className="font-bold text-gray-700">{maskedEmail}</span>
          </p>

          <form onSubmit={handleVerify}>
            <div className="flex justify-center gap-2 mb-6">
              {code.map((char, i) => (
                <input
                  key={i}
                  ref={(el) => { inputRefs.current[i] = el; }}
                  type="text"
                  inputMode="text"
                  maxLength={1}
                  value={char}
                  onChange={(e) => handleOtpChange(i, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(i, e)}
                  onPaste={handleOtpPaste}
                  className="w-11 h-11 text-center text-lg font-semibold uppercase border border-gray-200 rounded-xl focus:outline-none focus:border-[#2D3A8C] focus:ring-2 focus:ring-blue-100 transition-colors"
                />
              ))}
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#2D3A8C] hover:bg-[#243080] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-full transition-all duration-200 text-base cursor-pointer flex items-center justify-center gap-2 active:scale-[0.98]"
            >
              {loading && <InlineLoader />}
              {loading ? 'Verifying...' : 'Verify Code'}
            </button>
          </form>

          <p className="text-sm text-gray-400 mt-4">
            Didn&apos;t receive the code?{' '}
            <button
              type="button"
              onClick={handleResend}
              disabled={loading}
              className="text-blue-600 font-semibold hover:underline cursor-pointer transition-colors duration-200 disabled:opacity-50"
            >
              Resend
            </button>
          </p>
        </div>

        <button
          type="button"
          onClick={() => { setStep('email'); setCode(['', '', '', '', '', '']); }}
          className="inline-flex items-center gap-2 text-gray-400 text-sm hover:text-gray-600 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          back
        </button>
      </div>
    );
  }

  // ============================
  // STEP 3 — Reset Password
  // ============================
  if (step === 'reset') {
    const handleReset = async (e: React.FormEvent) => {
      e.preventDefault();
      if (newPassword !== confirmPassword) { showToast('Passwords do not match.', 'error'); return; }
      setLoading(true);
      try {
        const res = await fetch(`${API}/api/auth/reset-password`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, password: newPassword, confirmPassword }),
        });
        const data = await res.json();
        if (!res.ok) {
          const detail = data.details?.length ? ` ${data.details.join(' ')}` : '';
          showToast((data.error || 'Failed to reset password.') + detail, 'error');
          return;
        }
        setStep('success');
      } catch {
        showToast('Network error. Please check your connection and try again.', 'error');
      } finally {
        setLoading(false);
      }
    };

    return (
      <div className="w-full max-w-md bg-white rounded-2xl p-8 text-center animate-fade-in-up">
        <div className="flex justify-center mb-6">
          <img src="/ontaplogo.svg" alt="OnTap Logo" width={70} height={70} className="w-17.5 h-auto" draggable={false} decoding="async" />
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">Reset Password</h1>
        <p className="text-gray-400 text-sm mb-8">
          Create a new secure password for your account
        </p>

        <div className="border border-gray-200 rounded-2xl p-6 mb-6">
          <div className="flex justify-center mb-6">
            <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center">
              <KeyRound className="h-7 w-7 text-[#2D3A8C]" />
            </div>
          </div>

          <form onSubmit={handleReset} className="space-y-4 text-left">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">New Password</label>
              <div className="relative">
                <input
                  type={showNew ? 'text' : 'password'}
                  placeholder="Min. 8 chars, uppercase, number, symbol"
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); }}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all duration-300"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Confirm Password</label>
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="Re-enter your new password"
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); }}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all duration-300"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#2D3A8C] hover:bg-[#243080] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-full transition-all duration-200 text-base cursor-pointer flex items-center justify-center gap-2 active:scale-[0.98]"
            >
              {loading && <InlineLoader />}
              {loading ? 'Resetting...' : 'Reset Password'}
            </button>
          </form>
        </div>

        <Link
          href="/"
          className="inline-flex items-center gap-2 text-gray-400 text-sm hover:text-gray-600 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          back to login
        </Link>
      </div>
    );
  }

  // ============================
  // STEP 4 — Success
  // ============================
  return (
    <div className="w-full max-w-md bg-white rounded-2xl p-8 text-center animate-fade-in-up">
      <div className="flex justify-center mb-4">
        <img src="/ontaplogo.svg" alt="OnTap Logo" width={70} height={70} className="w-17.5 h-auto" draggable={false} decoding="async" />
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-2">Password Reset!</h1>
      <p className="text-gray-400 text-sm mb-8">
        Your password has been successfully updated.
      </p>

      <div className="border border-gray-200 rounded-2xl p-6">
        <div className="flex justify-center mb-4">
          <div className="w-14 h-14 bg-green-50 rounded-full flex items-center justify-center">
            <CheckCircle className="h-8 w-8 text-green-500" />
          </div>
        </div>

        <p className="text-sm text-gray-400 mb-6 leading-relaxed">
          Your password has been updated. You can now log in with your new password.
        </p>

        <Link
          href="/"
          className="w-full bg-[#2D3A8C] hover:bg-[#243080] text-white font-semibold py-3.5 rounded-full transition-all duration-200 text-sm cursor-pointer flex items-center justify-center gap-2 active:scale-[0.98]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to login
        </Link>
      </div>
    </div>
  );
};

export default ForgotPasswordUser;
