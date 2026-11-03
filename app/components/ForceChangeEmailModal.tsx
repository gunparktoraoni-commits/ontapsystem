"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Mail, ShieldAlert } from "lucide-react";
import { ModalPortal } from "@/app/components/ModalPortal";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import { csrfClient } from "@/lib/csrf-client";

type Step = "email" | "otp" | "success";

type ForceChangeEmailModalProps = {
  open: boolean;
  currentEmail: string;
  onCompleted: (newEmail: string) => void;
};

function apiUrl(path: string): string {
  const base = getFrontendApiBaseUrl().replace(/\/+$/, "");
  const safePath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${safePath}`;
}

async function authPost(path: string, body: Record<string, unknown>) {
  const apiBase = getFrontendApiBaseUrl();
  let csrfToken = await csrfClient.getToken(false, apiBase || undefined);
  if (!csrfToken) {
    csrfToken = await csrfClient.getToken(true, apiBase || undefined);
  }

  const post = async (token: string | null) =>
    fetch(apiUrl(path), {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(token
          ? {
              "X-CSRF-Token": token,
              "x-csrf-token": token,
            }
          : {}),
      },
      body: JSON.stringify(body),
    });

  let response = await post(csrfToken);
  if (response.status === 403) {
    const failed = await response.clone().json().catch(() => null);
    const code = String(failed?.code ?? "").toUpperCase();
    if (code === "CSRF_TOKEN_INVALID") {
      const freshToken = await csrfClient.getToken(true, apiBase || undefined);
      response = await post(freshToken);
    }
  }
  return response;
}

export function ForceChangeEmailModal({
  open,
  currentEmail,
  onCompleted,
}: ForceChangeEmailModalProps) {
  const [step, setStep] = useState<Step>("email");
  const [newEmail, setNewEmail] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [otpDigits, setOtpDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    setStep("email");
    setNewEmail("");
    setMaskedEmail("");
    setOtpDigits(["", "", "", "", "", ""]);
    setError(null);
    setSubmitting(false);
    setResendCooldown(0);
  }, [open, currentEmail]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => setResendCooldown((v) => Math.max(0, v - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  const focusOtp = useCallback((index: number) => {
    inputRefs.current[index]?.focus();
  }, []);

  const requestOtp = async () => {
    setError(null);
    const email = newEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await authPost("/api/user/email/force-change/request", {
        new_email: email,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || "Unable to send verification code.");
      }
      setMaskedEmail(String(payload?.data?.email ?? email));
      setStep("otp");
      setOtpDigits(["", "", "", "", "", ""]);
      setResendCooldown(30);
      window.setTimeout(() => focusOtp(0), 50);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send verification code.");
    } finally {
      setSubmitting(false);
    }
  };

  const confirmOtp = async (codeOverride?: string) => {
    setError(null);
    const code = (codeOverride ?? otpDigits.join("")).trim();
    if (code.length !== 6) {
      setError("Please enter the 6-character verification code.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await authPost("/api/user/email/force-change/confirm", {
        code,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        if (payload?.code === "PENDING_EMAIL_EXPIRED") {
          setStep("email");
        }
        throw new Error(payload?.error || "Unable to verify the code.");
      }
      const confirmedEmail = String(payload?.data?.email ?? newEmail.trim().toLowerCase());
      setNewEmail(confirmedEmail);
      setStep("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to verify the code.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleOtpChange = (index: number, raw: string) => {
    const value = raw.replace(/\s/g, "").slice(-1);
    const next = [...otpDigits];
    next[index] = value;
    setOtpDigits(next);
    setError(null);
    if (value && index < 5) focusOtp(index + 1);
    if (value && index === 5 && next.every((d) => d)) {
      void confirmOtp(next.join(""));
    }
  };

  const handleOtpKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !otpDigits[index] && index > 0) {
      focusOtp(index - 1);
    }
  };

  const handleOtpPaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text").replace(/\s/g, "").slice(0, 6);
    if (!pasted) return;
    const next = ["", "", "", "", "", ""];
    for (let i = 0; i < pasted.length; i += 1) next[i] = pasted[i]!;
    setOtpDigits(next);
    setError(null);
    if (pasted.length === 6) {
      void confirmOtp(pasted);
    } else {
      focusOtp(Math.min(pasted.length, 5));
    }
  };

  if (!open) return null;

  return (
    <ModalPortal isOpen={open}>
      <div
        className="w-[min(100vw-2rem,28rem)] overflow-hidden rounded-3xl border border-white/40 bg-white shadow-2xl shadow-black/20"
        role="dialog"
        aria-modal="true"
        aria-labelledby="force-email-change-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-amber-100 bg-gradient-to-r from-amber-50 to-orange-50 px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              {step === "success" ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              ) : (
                <ShieldAlert className="h-5 w-5" />
              )}
            </div>
            <div>
              <h2 id="force-email-change-title" className="text-lg font-bold text-slate-900">
                {step === "success" ? "Email updated successfully" : "Change your email now"}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {step === "success"
                  ? "Your login email/username has been updated."
                  : "Your account is still using a temporary email. Update it immediately to keep access to your account."}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-5 px-6 py-6">
          {step !== "success" ? (
            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                Current temporary email
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{currentEmail}</p>
            </div>
          ) : null}

          {step === "email" ? (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void requestOtp();
              }}
            >
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  New email address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    autoFocus
                    required
                    autoComplete="email"
                    value={newEmail}
                    onChange={(event) => {
                      setError(null);
                      setNewEmail(event.target.value);
                    }}
                    placeholder="you@company.com"
                    className="w-full rounded-xl border border-slate-200 py-3 pl-10 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  This email will also be your username for future logins.
                </p>
              </div>

              {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}

              <button
                type="submit"
                disabled={submitting || !newEmail.trim()}
                className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:opacity-50"
              >
                {submitting ? "Sending code..." : "Send verification code"}
              </button>
            </form>
          ) : null}

          {step === "otp" ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                Enter the 6-character code we sent to{" "}
                <span className="font-semibold text-slate-800">{maskedEmail || "your new email"}</span>.
              </p>

              <div className="flex justify-between gap-2">
                {otpDigits.map((digit, index) => (
                  <input
                    key={`otp-${index}`}
                    ref={(el) => {
                      inputRefs.current[index] = el;
                    }}
                    type="text"
                    inputMode="text"
                    autoComplete="one-time-code"
                    maxLength={1}
                    value={digit}
                    onChange={(event) => handleOtpChange(index, event.target.value)}
                    onKeyDown={(event) => handleOtpKeyDown(index, event)}
                    onPaste={handleOtpPaste}
                    className="h-12 w-11 rounded-xl border border-slate-200 text-center text-lg font-bold text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                    aria-label={`Digit ${index + 1}`}
                  />
                ))}
              </div>

              {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}

              <button
                type="button"
                disabled={submitting || otpDigits.join("").length !== 6}
                onClick={() => void confirmOtp()}
                className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:opacity-50"
              >
                {submitting ? "Verifying..." : "Verify and update email"}
              </button>

              <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                <button
                  type="button"
                  className="font-semibold text-slate-600 hover:text-slate-900"
                  onClick={() => {
                    setStep("email");
                    setError(null);
                    setOtpDigits(["", "", "", "", "", ""]);
                  }}
                >
                  Change email
                </button>
                <button
                  type="button"
                  disabled={submitting || resendCooldown > 0}
                  className="font-semibold text-primary hover:text-primary-hover disabled:opacity-50"
                  onClick={() => void requestOtp()}
                >
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
                </button>
              </div>
            </div>
          ) : null}

          {step === "success" ? (
            <div className="space-y-5">
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-4">
                <p className="text-sm font-semibold text-emerald-800">
                  You successfully changed your email/username.
                </p>
                <p className="mt-2 text-sm text-emerald-700">
                  Please use{" "}
                  <span className="font-bold">{newEmail}</span> the next time you log in.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onCompleted(newEmail)}
                className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-primary-hover"
              >
                Continue to dashboard
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </ModalPortal>
  );
}
