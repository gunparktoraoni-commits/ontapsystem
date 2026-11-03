'use client';

import { Eye, EyeOff, Lock, User, CheckCircle, Shield } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { getFrontendApiBaseUrl } from './apiBase';
import { InlineLoader } from './Loader';
import { showToast } from './Toast';
import { LegalPolicyModal } from './legal/LegalPolicyModal';
import type { LegalPolicyId } from '@/app/lib/legal';
import {
  createSetupSession,
  saveSetupSession,
} from '../lib/sessionStorage';
import { buildClaimLoginPath, buildLoginHrefWithRedirect, extractClaimSerial, persistClaimSerial } from '@/lib/bizcard/claim-urls';

const API = getFrontendApiBaseUrl();

interface RegisterUserProps {
  onNext: (
    userId: number,
    email: string,
    meta?: { emailSent?: boolean; emailError?: string; devOtp?: string }
  ) => void;
  /** Physical card serial from NFC/QR (`?ref=` / `?serial=`) — kept on Sign in. */
  serialId?: string;
  /** Growth missions invite code from `/user/signup?invite=CODE` (not BizCard serial). */
  inviteCode?: string;
  /** Post-auth destination from email CTAs / invite links (`?redirect=`). */
  redirectPath?: string | null;
}
const RegisterUser: React.FC<RegisterUserProps> = ({ onNext, serialId, inviteCode, redirectPath }) => {
  const claimSerial = extractClaimSerial(serialId ?? '') ?? '';
  const signInHref = claimSerial
    ? buildClaimLoginPath(claimSerial)
    : buildLoginHrefWithRedirect(redirectPath);
  const resolvedInvite = (inviteCode ?? '').trim();

  useEffect(() => {
    if (claimSerial) persistClaimSerial(claimSerial);
  }, [claimSerial]);

  useEffect(() => {
    if (!resolvedInvite || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('affiliate_referral_code', resolvedInvite);
    } catch {
      // ignore storage failures
    }
  }, [resolvedInvite]);
  const [accountType, setAccountType] = useState<'individual' | 'company'>('individual');  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [promotionalEmailOptIn, setPromotionalEmailOptIn] = useState(false);
  const [legalPolicy, setLegalPolicy] = useState<LegalPolicyId | null>(null);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
    companyName: '',
  });

  const passwordRequirements = useMemo(() => {
    const p = formData.password;
    return {
      length: p.length >= 8 && p.length <= 128,
      lowercase: /[a-z]/.test(p),
      uppercase: /[A-Z]/.test(p),
      special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(p),
      noWhitespace: p.length > 0 && !/\s/.test(p),
    };
  }, [formData.password]);

  const passwordsMatch = formData.password.length > 0 && formData.password === formData.confirmPassword;

  const strengthScore = useMemo(() => {
    return Object.values(passwordRequirements).filter(Boolean).length;
  }, [passwordRequirements]);

  const strengthLabel = strengthScore <= 2 ? 'Weak' : strengthScore <= 3 ? 'Medium' : 'Strong';
  const strengthColor = strengthScore <= 2 ? 'bg-red-400' : strengthScore <= 3 ? 'bg-yellow-400' : 'bg-green-500';

  // Client‑side input sanitisation to strip obviously malicious characters
  const sanitizeInput = (value: string): string => {
    if (typeof value !== 'string') return value;
    return value
      .trim()
      .replace(/"/g, '')   // remove double quotes
      .replace(/</g, '')    // remove opening angle brackets
      .replace(/>/g, '');   // remove closing angle brackets
   
      
  };
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreedToTerms) {
      showToast('You must agree to the Privacy Policy and User Agreement.', 'error');
      return;
    }
    // Check password match first
    if (!passwordsMatch) {
      showToast('Passwords do not match.', 'error');
      return;
    }

    // Enforce password requirements strictly
    const p = formData.password;
    const reqs = {
      length: p.length >= 8 && p.length <= 128,
      lowercase: /[a-z]/.test(p),
      uppercase: /[A-Z]/.test(p),
      special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(p),
      noWhitespace: p.length > 0 && !/\s/.test(p),
    };

    const allMet = Object.values(reqs).every(Boolean);
    if (!allMet) {
      const missing: string[] = [];
      if (!reqs.length) missing.push('at least 8 characters');
      if (!reqs.lowercase) missing.push('one lowercase letter');
      if (!reqs.uppercase) missing.push('one uppercase letter');
      if (!reqs.special) missing.push('one special character');
      if (!reqs.noWhitespace) missing.push('no spaces');
      showToast(`Password does not meet requirements: ${missing.join(', ')}.`, 'error');
      return;
    }

    setLoading(true);

    try {
      const body: Record<string, string | boolean> = {
        registrationType: accountType,
        email: sanitizeInput(formData.email).toLowerCase(),
        password: formData.password,
        confirmPassword: formData.confirmPassword,
        firstName: sanitizeInput(formData.firstName),
        lastName: sanitizeInput(formData.lastName),
        promotionalEmailOptIn,
      };
      if (accountType === 'company') {
        body.companyName = sanitizeInput(formData.companyName);
      }
      const storedInvite =
        resolvedInvite ||
        (typeof window !== 'undefined'
          ? window.localStorage.getItem('affiliate_referral_code')?.trim() ?? ''
          : '');
      if (storedInvite) {
        body.referral_code = storedInvite;
      }

      console.log('[Register] Sending body:', JSON.stringify({ ...body, password: '***', confirmPassword: '***' }));

      const res = await fetch(`${API}/api/auth/register`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const rawText = await res.text();
      console.log('[Register] Response status:', res.status);

      let data: {
        error?: string;
        details?: string[];
        // New deferred flow: no userId on success — identified by email
        pending?: boolean;
        email?: string;
        emailSent?: boolean;
        emailError?: string;
        devOtp?: string;
        // Legacy flow: userId was returned
        userId?: number;
      } = {};
      try {
        data = JSON.parse(rawText);
      } catch {
        // non-JSON response (e.g. server error page)
      }

      if (!res.ok) {
        if (res.status === 500) {
          const serverMsg = data.error ?? rawText.slice(0, 300);
          showToast(`Server error: ${serverMsg}`, 'error');
        } else if (data.details && Array.isArray(data.details)) {
          showToast(data.details.join(' '), 'error');
        } else {
          showToast(data.error ?? 'Registration failed. Please try again.', 'error');
        }
        return;
      }

      // ── Success: OTP sent — navigate to verification step ──
      // Under the new deferred-creation flow the server returns 200 with
      // pending: true and the email. No userId exists yet (no User row was created).
      // We create a local setup session keyed to the email.
      const email = sanitizeInput(formData.email).toLowerCase();

      // Create a setup session with no userId — account is not created yet
      const session = createSetupSession(email, undefined);
      saveSetupSession(session);

      // Pass 0 as userId sentinel — the verify step uses email directly
      onNext(0, email, {
        emailSent: data.emailSent,
        emailError: data.emailError,
        devOtp: data.devOtp,
      });
    } catch {
      showToast('Unable to connect. Please check your internet connection.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      <div className="mb-6 flex justify-center">
        <img src="/ontaplogo.svg" alt="OnTap Logo" width={70} height={70} className="w-17.5 h-auto" draggable={false} decoding="async" />
      </div>
      <h1 className="text-2xl font-bold text-gray-900 text-center mb-1">Create Account</h1>
      <p className="text-gray-400 text-sm text-center mb-6">Fill out this form to create your account details</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        {accountType === 'individual' ? (
          <>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">First Name</label>
              <input
                type="text"
                placeholder="Your first name"
                value={formData.firstName}
                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Last Name</label>
              <input
                type="text"
                placeholder="Your last name"
                value={formData.lastName}
                onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                required
              />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">First Name</label>
              <input
                type="text"
                placeholder="Your first name"
                value={formData.firstName}
                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Last Name</label>
              <input
                type="text"
                placeholder="Your last name"
                value={formData.lastName}
                onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Company Name</label>
              <input
                type="text"
                placeholder="Your company name"
                value={formData.companyName}
                onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                required
              />
            </div>
          </>
        )}

        {/* Email */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Email Address</label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="email"
              placeholder="Your email address"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full pl-11 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              required
            />
          </div>
        </div>

        {/* New Password */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">New Password</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Your password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="w-full pl-11 pr-11 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {/* Confirm Password */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-semibold text-gray-700">Confirm Password</label>
            {formData.confirmPassword.length > 0 && (
              <span className={`text-xs font-medium ${passwordsMatch ? 'text-green-600' : 'text-red-500'}`}>
                {passwordsMatch ? 'Password Match' : 'Password Mismatch'}
              </span>
            )}
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type={showConfirm ? 'text' : 'password'}
              placeholder="Confirm your password"
              value={formData.confirmPassword}
              onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
              className={`w-full pl-11 pr-11 py-3 border rounded-xl text-sm focus:outline-none focus:ring-1 transition-colors ${
                formData.confirmPassword.length > 0
                  ? passwordsMatch
                    ? 'border-green-400 focus:border-green-500 focus:ring-green-500'
                    : 'border-red-400 focus:border-red-500 focus:ring-red-500'
                  : 'border-gray-200 focus:border-blue-500 focus:ring-blue-500'
              }`}
              required
            />
            {formData.confirmPassword.length > 0 && passwordsMatch && (
              <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-green-500" />
            )}
            {formData.confirmPassword.length > 0 && !passwordsMatch && (
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showConfirm ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            )}
          </div>
        </div>

        {/* Password Strength Bar */}
        {formData.password.length > 0 && (
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i <= strengthScore ? strengthColor : 'bg-gray-200'
                }`}
              />
            ))}
          </div>
        )}

        {/* Password Requirements */}
        {formData.password.length > 0 && (
          <div className="bg-gray-50 rounded-xl p-4 space-y-2">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Password Requirements</h3>
            {[
              { met: passwordRequirements.length, text: 'At least 8 characters long' },
              { met: passwordRequirements.lowercase, text: 'One lowercase letter (a-z)' },
              { met: passwordRequirements.uppercase, text: 'One uppercase letter (A-Z)' },
              { met: passwordRequirements.special, text: 'One special character (!@#$%^&)' },
              { met: passwordRequirements.noWhitespace, text: 'No spaces or whitespace' },
            ].map((req, i) => (
              <div key={i} className="flex items-center gap-2">
                <CheckCircle className={`h-4 w-4 ${req.met ? 'text-green-500' : 'text-gray-300'}`} />
                <span className={`text-xs ${req.met ? 'text-gray-700' : 'text-gray-400'}`}>{req.text}</span>
              </div>
            ))}
            <div className={`inline-block mt-2 px-3 py-1 rounded-full text-xs font-medium ${
              strengthScore <= 1 ? 'bg-red-100 text-red-600' : strengthScore <= 3 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'
            }`}>
              Security level: {strengthLabel}
            </div>
          </div>
        )}

        {/* Privacy Notice */}
        <div className="bg-blue-50 rounded-xl p-4 flex gap-3">
          <Shield className="h-8 w-8 text-[#2D3A8C] shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-semibold text-gray-900 mb-1">Privacy First</h4>
            <p className="text-xs text-gray-500 leading-relaxed">
              your data is encrypted and secure. We will never share your professional information without your explicit consent. By continuing, you agree to our data privacy terms.
            </p>
          </div>
        </div>

        {/* Terms Checkbox */}
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={agreedToTerms}
            onChange={(e) => setAgreedToTerms(e.target.checked)}
            className="w-4 h-4 mt-0.5 border border-gray-300 rounded accent-blue-600"
          />
          <span className="text-sm text-gray-600">
            I agree to the{' '}
            <button
              type="button"
              className="text-blue-600 underline cursor-pointer"
              onClick={() => setLegalPolicy('privacy')}
            >
              Privacy Policy
            </button>{' '}
            and{' '}
            <button
              type="button"
              className="text-blue-600 underline cursor-pointer"
              onClick={() => setLegalPolicy('terms')}
            >
              Terms &amp; Conditions
            </button>
          </span>
        </label>

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={promotionalEmailOptIn}
            onChange={(e) => setPromotionalEmailOptIn(e.target.checked)}
            className="w-4 h-4 mt-0.5 border border-gray-300 rounded accent-blue-600"
          />
          <span className="text-sm text-gray-600">
            Keep me updated with OnTap news and promos (optional)
          </span>
        </label>

        {/* Submit Button */}
        <div className='flex flex-col items-center justify-center'>
        <button
          type="submit"
          disabled={loading || !agreedToTerms}
          className="w-full bg-[#2D3A8C] hover:bg-[#243080] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-full transition-colors text-base cursor-pointer flex items-center justify-center gap-2"
        >
          {loading && <InlineLoader />}
          {loading ? 'Creating Account…' : 'Create Account'}
        </button>
        <span className='text-gray-600 font-medium text-sm items-center justify-center text-center'>have an account? <a href={signInHref} className='text-primary'>Sign in</a></span>

        </div>

      </form>
      <LegalPolicyModal
        open={Boolean(legalPolicy)}
        policy={legalPolicy}
        onClose={() => setLegalPolicy(null)}
        onPolicyChange={setLegalPolicy}
      />
    </div>
  );
};

export default RegisterUser;