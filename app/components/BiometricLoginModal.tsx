'use client';

import { startAuthentication } from '@simplewebauthn/browser';
import { Fingerprint, X } from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { getFrontendApiBaseUrl } from './apiBase';
import { SectionLoader, InlineLoader } from './Loader';
import { ModalPortal } from './ModalPortal';

const API = getFrontendApiBaseUrl();

const CSRF_COOKIE_NAME = 'csrf-token';

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const pairs = document.cookie.split('; ');
    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) continue;
      const key = decodeURIComponent(pair.slice(0, eqIdx).trim());
      if (key !== CSRF_COOKIE_NAME) continue;
      const val = decodeURIComponent(pair.slice(eqIdx + 1).trim());
      return val || null;
    }
  } catch {
   
    
  }
  return null;
}



async function fetchCsrfToken(): Promise<string | null> {
  try {
    const res = await fetch(`${API}/api/csrf-token`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) return readCsrfCookie();
    const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const bodyToken =
      (payload?.csrfToken && typeof payload.csrfToken === 'string' ? payload.csrfToken : null) ||
      (payload?.token && typeof payload.token === 'string' ? payload.token : null) ||
      null;
    return bodyToken?.trim() || readCsrfCookie();
  } catch {
    return readCsrfCookie();
  }
}

async function buildHeaders(extraHeaders?: Record<string, string>): Promise<Headers> {
  const token = await fetchCsrfToken();
  const headers = new Headers({ 'Content-Type': 'application/json', ...extraHeaders });
  if (token) {
    headers.set('X-CSRF-Token', token);
    headers.set('x-csrf-token', token);
  }
  return headers;
}


interface BiometricLoginModalProps {
  email: string;
  rememberMe: boolean;
  deviceId?: string;
  onSuccess: (userData: Record<string, unknown>) => void;
  onCancel: () => void;
  onError: (errorMessage: string) => void;
}


export default function BiometricLoginModal({
  email,
  rememberMe,
  deviceId,
  onSuccess,
  onCancel,
  onError,
}: BiometricLoginModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const handleBiometricAuth = async () => {
    setError('');
    setLoading(true);

    try {
      // Check if WebAuthn is supported
      if (typeof window === 'undefined' || !window.PublicKeyCredential || !navigator.credentials) {
        throw new Error('UNSUPPORTED');
      }

      // Fetch authentication options from server (no CSRF needed for options)
      const optionsResponse = await fetch(`${API}/api/auth/webauthn/login/options`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!optionsResponse.ok) {
        const optionsData = await optionsResponse.json().catch(() => ({}));
        if (optionsResponse.status === 409) {
          throw new Error('NO_CREDENTIAL');
        }
        throw new Error(optionsData.error ?? 'Unable to start biometric authentication.');
      }

      const optionsData = await optionsResponse.json();

      // Initiate WebAuthn authentication ceremony
      const credential = await startAuthentication(optionsData.options);

      // Build headers with CSRF token for verification
      const verifyHeaders = await buildHeaders();

      // Send credential to server for verification with CSRF token
      const verifyResponse = await fetch(`${API}/api/auth/webauthn/login/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: verifyHeaders,
        body: JSON.stringify({
          credential,
          rememberMe,
          deviceId,
        }),
      });

      if (!verifyResponse.ok) {
        const verifyData = await verifyResponse.json().catch(() => ({}));
        throw new Error(verifyData.error ?? 'Biometric authentication failed.');
      }

      const verifyData = await verifyResponse.json();
      onSuccess(verifyData);
    } catch (err) {
      console.error('Biometric authentication error:', err);

      let errorMessage = 'Biometric authentication failed. Please try again.';

      if (err instanceof Error) {
        if (err.name === 'NotAllowedError') {
          errorMessage = 'Authentication was cancelled.';
        } else if (err.name === 'InvalidStateError') {
          errorMessage = 'Your biometric credential is no longer valid.';
        } else if (err.message === 'UNSUPPORTED') {
          errorMessage = 'Your browser does not support biometric authentication.';
        } else if (err.message === 'NO_CREDENTIAL') {
          errorMessage = 'No biometric credential found for this account.';
        } else if (err.message.length < 100) {
          errorMessage = err.message;
        }
      }

      setError(errorMessage);
      onError(errorMessage);
    } finally {
      setLoading(false);
    }
  };


  useEffect(() => {
    handleBiometricAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading && !error) {
    return <SectionLoader text="Initiating biometric authentication..." />;
  }

  return (
    <ModalPortal isOpen={!loading || !!error} onClose={onCancel}>
      <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl animate-scale-in">
        <div className="flex justify-between items-start mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
              <Fingerprint className="h-6 w-6 text-[#2D3A8C]" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">Verify your identity</h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Cancel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>



        <div className="mb-6">
          <p className="text-gray-600 text-sm mb-4">
            Use your device&apos;s biometric authentication to complete login.
          </p>
          
          {loading && (
            <div className="flex items-center justify-center gap-3 py-6">
              <InlineLoader />
              <span className="text-sm text-gray-600">Waiting for biometric verification...</span>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 mb-4">
              {error}
            </div>
          )}
        </div>



        <div className="space-y-3">
          {!loading && error && (
            <button
              type="button"
              onClick={handleBiometricAuth}
              className="w-full flex items-center justify-center gap-2 bg-[#2D3A8C] hover:bg-[#243080] text-white font-semibold py-3 rounded-xl transition-all duration-300"
            >
              <Fingerprint className="h-5 w-5" />
              Try again
            </button>
          )}

          <button
            type="button"
            onClick={onCancel}
            className="w-full text-gray-600 hover:text-gray-800 font-medium py-2 transition-colors text-sm"
          >
            {error ? 'Use password instead' : 'Cancel'}
          </button>
        </div>

        <div className="mt-6 pt-6 border-t border-gray-100">
          <p className="text-xs text-gray-500 text-center">
            Follow the prompt on your device to authenticate using Face ID, Touch ID, fingerprint, or Windows Hello.
          </p>
        </div>
      </div>
    </ModalPortal>
  );
}
