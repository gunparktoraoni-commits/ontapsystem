'use client'

import { useEffect, useId, useState, type FocusEvent, type FormEvent, type ReactNode } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { MdAdminPanelSettings } from "react-icons/md";
import { InlineLoader } from '../../components/Loader'
import { getFrontendApiBaseUrl } from '@/app/components/apiBase'

// ── System-blue premium animations (aligned with OnTap palette) ───────────────
const premiumStyles = `
  @keyframes glow-pulse {
    0%, 100% { opacity: 0.35; }
    50% { opacity: 0.85; }
  }

  @keyframes float-up {
    0% { transform: translateY(16px); opacity: 0; }
    100% { transform: translateY(0); opacity: 1; }
  }

  @keyframes shimmer {
    0% { background-position: -1000px 0; }
    100% { background-position: 1000px 0; }
  }

  @keyframes blue-glow {
    0%, 100% { box-shadow: 0 0 18px rgba(42, 71, 146, 0.28), inset 0 0 12px rgba(71, 133, 184, 0.12); }
    50% { box-shadow: 0 0 28px rgba(42, 71, 146, 0.42), inset 0 0 18px rgba(71, 133, 184, 0.18); }
  }

  @keyframes border-glow {
    0%, 100% { border-color: rgba(71, 133, 184, 0.25); box-shadow: 0 0 8px rgba(42, 71, 146, 0.12); }
    50% { border-color: rgba(71, 133, 184, 0.55); box-shadow: 0 0 16px rgba(42, 71, 146, 0.22); }
  }

  @keyframes dust-drift {
    0% { transform: translate3d(0, 0, 0); }
    50% { transform: translate3d(12px, -18px, 0); }
    100% { transform: translate3d(0, 0, 0); }
  }

  @keyframes dust-drift-alt {
    0% { transform: translate3d(0, 0, 0); }
    50% { transform: translate3d(-16px, 10px, 0); }
    100% { transform: translate3d(0, 0, 0); }
  }

  .premium-glow {
    animation: glow-pulse 4s ease-in-out infinite;
  }

  .premium-float {
    animation: float-up 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  }

  .premium-card {
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    border: 1px solid rgba(168, 184, 217, 0.55);
  }

  .premium-input {
    background: #ffffff;
    border: 1.5px solid #d5ddef;
    transition: all 0.25s ease;
  }

  .premium-input:focus {
    background: #ffffff;
    border-color: #2A4792;
    box-shadow: 0 0 0 3px rgba(42, 71, 146, 0.16);
  }

  .premium-button {
    position: relative;
    overflow: hidden;
    transition: all 0.25s ease;
  }

  .premium-button::before {
    content: '';
    position: absolute;
    top: -50%;
    left: -50%;
    width: 200%;
    height: 200%;
    background: linear-gradient(45deg, transparent, rgba(255, 255, 255, 0.18), transparent);
    transform: rotate(45deg);
    animation: shimmer 3.5s infinite;
  }

  .premium-badge {
    position: relative;
    animation: blue-glow 3.5s ease-in-out infinite;
  }

  .premium-divider {
    background: linear-gradient(90deg, transparent, rgba(71, 133, 184, 0.55), transparent);
    animation: border-glow 3.5s ease-in-out infinite;
  }

  .superlogin-dust-layer {
    animation: dust-drift 22s ease-in-out infinite;
  }

  .superlogin-dust-layer-alt {
    animation: dust-drift-alt 28s ease-in-out infinite;
  }
`

// ── Inject premium styles ────────────────────────────────────────────────────
if (typeof document !== 'undefined' && !document.getElementById('premium-admin-styles')) {
  const style = document.createElement('style')
  style.id = 'premium-admin-styles'
  style.textContent = premiumStyles
  document.head.appendChild(style)
}

const SAVED_CREDENTIALS_KEY = 'superadmin_savedCredentials'
const CROSS_PORTAL_SSO_ATTEMPT_KEY = 'superadmin_cross_portal_sso_attempt'
const CROSS_PORTAL_SSO_RETRY_MS = 60_000

// Only the email is remembered — passwords must never be persisted in the browser.
function loadSavedEmail(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(SAVED_CREDENTIALS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { email?: unknown; password?: unknown } | null
    if (!parsed || typeof parsed.email !== 'string') return null
    if ('password' in parsed) {
      localStorage.setItem(SAVED_CREDENTIALS_KEY, JSON.stringify({ email: parsed.email }))
    }
    return parsed.email
  } catch {
    return null
  }
}

function persistSavedEmail(email: string) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(SAVED_CREDENTIALS_KEY, JSON.stringify({ email }))
  } catch {
    // ignore localStorage errors
  }
}

/**
 * Try a silent sign-in from an active SmartPet superadmin session at most once
 * per minute per tab, and never right after an explicit logout or failure.
 */
function shouldAttemptCrossPortalSso(params: URLSearchParams): boolean {
  if (params.get('token') || params.get('sso') || params.get('logged_out')) return false
  try {
    const last = Number(sessionStorage.getItem(CROSS_PORTAL_SSO_ATTEMPT_KEY) ?? '0')
    if (Number.isFinite(last) && Date.now() - last < CROSS_PORTAL_SSO_RETRY_MS) return false
    sessionStorage.setItem(CROSS_PORTAL_SSO_ATTEMPT_KEY, String(Date.now()))
    return true
  } catch {
    return false
  }
}

function clearSavedCredentials() {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(SAVED_CREDENTIALS_KEY)
  } catch {
    // ignore localStorage errors
  }
}

type AuthView = 'login' | 'forgot-email' | 'forgot-sent' | 'reset' | 'reset-done'

// ── Color tokens (system blue palette from globals.css) ───────────────────────
const C = {
  dark:    '#0c1847',
  darkMid: '#162666',
  mid:     '#1e2f82',
  light:   '#2A4792',
  accent:  '#2A4792',
  accentLight: '#4785B8',
  accentDark: '#243080',
  primaryHover: '#3B569F',
  primary50: '#EEF2FA',
  primary100: '#D5DDEF',
  primary200: '#A8B8D9',
  panelBg: 'linear-gradient(145deg, #0c1847 0%, #162666 30%, #1e2f82 60%, #2A4792 85%, #3a5fa8 100%)',
  btnBg:   'linear-gradient(135deg, #2A4792 0%, #3B569F 55%, #2A4792 100%)',
  btnHover: 'linear-gradient(135deg, #243080 0%, #2A4792 55%, #3B569F 100%)',
  accentBg: 'linear-gradient(135deg, #2A4792 0%, #3B569F 50%, #4785B8 100%)',
  chipBg:  'linear-gradient(135deg, #3B569F 0%, #4785B8 45%, #2A4792 100%)',
  glassLight: 'rgba(255, 255, 255, 0.72)',
  glassMid: 'rgba(42, 71, 146, 0.10)',
}


function getBackendUrl(): string {
  // Local dev must use same-origin so session cookies + CORS work.
  return getFrontendApiBaseUrl()
}

const IconMail = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" />
  </svg>
)
const IconLock = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
)
const IconEyeOn = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
  </svg>
)
const IconEyeOff = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
)

function applyFieldFocus(target: HTMLInputElement) {
  target.style.borderColor = C.accent
  target.style.background = '#ffffff'
  target.style.boxShadow = '0 0 0 3px rgba(42, 71, 146, 0.16)'
}

function clearFieldFocus(target: HTMLInputElement) {
  target.style.borderColor = C.primary100
  target.style.background = '#ffffff'
  target.style.boxShadow = 'none'
}

type TextFieldProps = {
  id: string
  label: string
  type: string
  autoComplete?: string
  placeholder?: string
  value: string
  onChange: (nextValue: string) => void
  leftIcon?: ReactNode
  rightElement?: ReactNode
  required?: boolean
  error?: string
}

const TextField = ({
  id,
  label,
  type,
  autoComplete,
  placeholder,
  value,
  onChange,
  leftIcon,
  rightElement,
  required,
  error,
}: TextFieldProps) => {
  const handleFocus = (event: FocusEvent<HTMLInputElement>) => applyFieldFocus(event.currentTarget)
  const handleBlur = (event: FocusEvent<HTMLInputElement>) => clearFieldFocus(event.currentTarget)

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold tracking-wide" style={{ color: '#475569' }}>
        {label}
      </label>
      <div className="relative">
        {leftIcon ? (
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2">{leftIcon}</span>
        ) : null}
        <input
          id={id}
          type={type}
          required={required}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`premium-input h-12 w-full rounded-xl text-sm text-slate-800 placeholder-slate-400 outline-none transition-all duration-300 ${
            leftIcon ? 'pl-10' : 'pl-4'
          } ${rightElement ? 'pr-12' : 'pr-4'} ${
            error ? 'border-red-400 bg-red-50' : ''
          }`}
          style={{
            background: error ? '#fef2f2' : '#ffffff',
            border: error ? '1.5px solid #f87171' : `1.5px solid ${C.primary100}`,
          }}
          onFocus={handleFocus}
          onBlur={handleBlur}
        />
        {rightElement}
      </div>
      {error && (
        <p className="text-xs text-red-500 mt-0.5">{error}</p>
      )}
    </div>
  )
}

// ── Validation helpers ────────────────────────────────────────────────────────
function validateEmail(email: string): string | null {
  if (!email.trim()) return 'Email is required.'
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) return 'Please enter a valid email address.'
  return null
}

/**
 * Validates a password for NEW password creation (reset / change flows only).
 * Enforces the minimum-length policy because these are new passwords being set.
 * NOT used during login — the backend handles credential verification.
 */
function validatePassword(password: string): string | null {
  if (!password) return 'Password is required.'
  if (password.length < 8) return 'Password must be at least 8 characters.'
  return null
}


const SuperAdminLogin = () => {
  const router = useRouter()

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [showPass, setShowPass] = useState(false)

  const [authView, setAuthView] = useState<AuthView>('login')
  const [forgotEmail, setForgotEmail] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPass, setShowNewPass] = useState(false)
  const [showConfirmPass, setShowConfirmPass] = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotError, setForgotError] = useState<string | null>(null)
  const [resetError, setResetError] = useState<string | null>(null)
  const [forgotSuccessMsg, setForgotSuccessMsg] = useState('')

  const [isLoading, setIsLoading] = useState(false)
  const [ssoChecking, setSsoChecking] = useState(false)
  const [apiError, setApiError]   = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({})

  const emailId = useId()
  const passwordId = useId()
  const forgotEmailId = useId()
  const resetTokenId = useId()
  const newPasswordId = useId()
  const confirmPasswordId = useId()

  useEffect(() => {
    const savedEmail = loadSavedEmail()
    if (savedEmail) {
      setEmail(savedEmail)
      setRemember(true)
    }

    const params = new URLSearchParams(window.location.search)
    const tokenFromUrl = params.get('token')?.trim()
    if (tokenFromUrl) {
      setResetToken(tokenFromUrl)
      setAuthView('reset')
      return
    }

    if (params.get('sso') === 'failed') {
      setApiError('Could not continue your SmartPet session. Please sign in.')
    }

    if (shouldAttemptCrossPortalSso(params)) {
      setSsoChecking(true)
      const redirect = params.get('redirect')?.trim() ?? ''
      const query = redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''
      window.location.replace(`${getBackendUrl()}/api/auth/cross-portal/start${query}`)
    }
  }, [])

  const backToLogin = () => {
    setAuthView('login')
    setForgotEmail('')
    setResetToken('')
    setNewPassword('')
    setConfirmPassword('')
    setForgotError(null)
    setResetError(null)
    setForgotSuccessMsg('')
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname)
    }
  }

  const goToForgotPassword = () => {
    setForgotEmail(email.trim())
    setForgotError(null)
    setResetError(null)
    setForgotSuccessMsg('')
    setAuthView('forgot-email')
  }
  const handleForgotSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setForgotError(null)
    const emailError = validateEmail(forgotEmail)
    if (emailError) {
      setForgotError(emailError)
      return
    }

    setForgotLoading(true)
    try {
      const response = await fetch(`${getBackendUrl()}/api/auth/admin/forgot-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail.trim() }),
      })

      const data = await response.json()

      if (!response.ok) {
        const errorMessage =
          data?.error?.message || data?.message || data?.error || 'Failed to send reset instructions.'
        setForgotError(errorMessage)
        return
      }

      const message =
        data?.data?.message ||
        'If an eligible admin account exists, password reset instructions have been sent.'
      setForgotSuccessMsg(message)
      setAuthView('forgot-sent')
    } catch {
      setForgotError('Unable to connect to the server. Please check your connection and try again.')
    } finally {
      setForgotLoading(false)
    }
  }

  const handleResetSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setResetError(null)

    if (!resetToken.trim()) {
      setResetError('Reset code is required.')
      return
    }

    const passwordError = validatePassword(newPassword)
    if (passwordError) {
      setResetError(passwordError)
      return
    }

    if (newPassword !== confirmPassword) {
      setResetError('Passwords do not match.')
      return
    }

    setForgotLoading(true)
    try {
      const response = await fetch(`${getBackendUrl()}/api/auth/admin/reset-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: resetToken.trim(),
          new_password: newPassword,
          confirm_password: confirmPassword,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        const errorCode = data?.error?.code || data?.code
        const errorMessage =
          data?.error?.message || data?.message || data?.error || 'Failed to reset password.'
        switch (errorCode) {
          case 'AUTH_17101':
          case 'AUTH_17102':
            setResetError('Invalid or expired reset code. Please request a new one.')
            break
          case 'AUTH_17104':
            setResetError(errorMessage || 'Password does not meet security requirements.')
            break
          case 'AUTH_17105':
            setResetError('Passwords do not match.')
            break
          case 'AUTH_17400':
            setResetError('Too many reset attempts. Please try again later.')
            break
          default:
            setResetError(errorMessage)
        }
        return
      }
      clearSavedCredentials()
      setAuthView('reset-done')
    } catch {
      setResetError('Unable to connect to the server. Please check your connection and try again.')
    } finally {
      setForgotLoading(false)
    }
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setApiError(null)
    setFieldErrors({})
    const emailError = validateEmail(email)
    const passwordError: string | null = !password ? 'Password is required.' : null
    if (emailError || passwordError) {
      setFieldErrors({
        email: emailError || undefined,
        password: passwordError || undefined,
      })
      return
    }
    setIsLoading(true)
    try {
      const response = await fetch(`${getBackendUrl()}/api/auth/admin/login`, {
        method: 'POST',
        credentials: 'include', 
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email.trim(),
          password,
          rememberMe: remember,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        const errorCode = data?.error?.code || data?.code
        const errorMessage = data?.error?.message || data?.message || data?.error || 'Invalid email or password.'
 
        switch (errorCode) {
          case 'AUTH_17002':
            setApiError('Invalid email or password. Please try again.')
            break
          case 'AUTH_17003':
            setApiError('Account temporarily locked due to too many failed attempts. Please try again later.')
            break
          case 'AUTH_17004':
            setApiError('This account has been deactivated. Please contact support.')
            break
          case 'AUTH_17005':
            setApiError('Please verify your account first.')
            break
          case 'AUTH_17001':
            setApiError('You do not have Super Admin access.')
            break
          case 'AUTH_17400':
            setApiError('Too many login attempts. Please try again later.')
            break
          default:
            setApiError(errorMessage)
        }
        return
      }
      
      const { data: responseData, success } = data
      if (success && responseData) {
        const adminProfile = {
          userId: responseData.user?.userId || responseData.user?.id,
          email: responseData.user?.email || email,
          firstName: responseData.user?.firstName || responseData.user?.first_name || 'Super',
          lastName: responseData.user?.lastName || responseData.user?.last_name || 'Admin',
          role: responseData.user?.role || 'super_admin',
        }
        localStorage.setItem('superadmin_profile', JSON.stringify(adminProfile))
        if (remember) {
          localStorage.setItem('superadmin_remember', 'true')
          persistSavedEmail(email.trim())
        } else {
          sessionStorage.setItem('superadmin_session', 'true')
          clearSavedCredentials()
        }
        window.dispatchEvent(new CustomEvent('superadmin-login', { 
          detail: adminProfile 
        }))

        const role = String(responseData.user?.role ?? adminProfile.role ?? "").toLowerCase()
        if (responseData.user?.requiresPasswordChange) {
          if (role === "staff") {
            router.push('/staff/setup-password')
          } else {
            router.push('/superadmin/settings')
          }
          return
        }
        if (role === "staff") {
          localStorage.setItem('authUser', JSON.stringify(adminProfile))
          router.push('/staff/dashboard')
          return
        }
        router.push('/superadmin/dashboard')
      }
    } catch (error) {
      // Network error or unexpected failure
      console.error('Super Admin login error:', error)
      setApiError('Unable to connect to the server. Please check your connection and try again.')
    } finally {
      setIsLoading(false)
    }
  }
  return (
    <div
      className="relative flex min-h-screen items-start justify-center overflow-hidden px-4 py-6 md:items-center sm:p-8"
      style={{
        background: [
          'radial-gradient(ellipse 80% 60% at 12% 18%, rgba(71,133,184,0.22) 0%, transparent 55%)',
          'radial-gradient(ellipse 70% 50% at 88% 12%, rgba(42,71,146,0.16) 0%, transparent 50%)',
          'radial-gradient(ellipse 60% 45% at 70% 88%, rgba(71,133,184,0.14) 0%, transparent 55%)',
          'linear-gradient(165deg, rgba(236,238,245,0.92) 0%, rgba(238,242,250,0.88) 42%, rgba(213,221,239,0.82) 100%)',
        ].join(', '),
      }}
    >
      {/* Dusty / particle atmosphere behind the form */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div
          className="superlogin-dust-layer absolute inset-[-10%] opacity-[0.45]"
          style={{
            backgroundImage: [
              'radial-gradient(circle, rgba(42,71,146,0.55) 0.7px, transparent 0.8px)',
              'radial-gradient(circle, rgba(71,133,184,0.35) 0.5px, transparent 0.6px)',
            ].join(', '),
            backgroundSize: '28px 28px, 17px 17px',
            backgroundPosition: '0 0, 9px 13px',
            maskImage: 'radial-gradient(ellipse 75% 70% at 50% 45%, black 20%, transparent 78%)',
            WebkitMaskImage: 'radial-gradient(ellipse 75% 70% at 50% 45%, black 20%, transparent 78%)',
          }}
        />
        <div
          className="superlogin-dust-layer-alt absolute inset-[-8%] opacity-[0.28]"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.85) 0.6px, transparent 0.7px)',
            backgroundSize: '42px 42px',
            backgroundPosition: '14px 8px',
          }}
        />
        <div
          className="absolute -top-32 -right-24 h-[28rem] w-[28rem] rounded-full premium-glow"
          style={{ background: 'radial-gradient(circle, rgba(71,133,184,0.22) 0%, transparent 70%)' }}
        />
        <div
          className="absolute -bottom-36 -left-28 h-[26rem] w-[26rem] rounded-full premium-glow"
          style={{ background: 'radial-gradient(circle, rgba(42,71,146,0.18) 0%, transparent 70%)', animationDelay: '1.2s' }}
        />
        <div
          className="absolute top-1/3 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full premium-glow"
          style={{ background: 'radial-gradient(circle, rgba(168,184,217,0.35) 0%, transparent 70%)', animationDelay: '2.1s' }}
        />
      </div>

      <div
        className="relative z-10 flex w-full max-w-5xl flex-col overflow-hidden rounded-3xl lg:flex-row premium-card premium-float"
        style={{
          background: 'rgba(255,255,255,0.88)',
          boxShadow: '0 24px 80px rgba(42,71,146,0.18), 0 8px 28px rgba(12,24,71,0.10), inset 0 1px 0 rgba(255,255,255,0.75)',
        }}
      >
        {/* ── LEFT: Form ──────────────────────────────────────────────── */}
        <div className="relative flex flex-1 flex-col justify-center px-6 py-10 sm:px-10 sm:py-12 lg:basis-0 lg:px-12">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: [
                'radial-gradient(circle at top left, rgba(71,133,184,0.12) 0%, transparent 36%)',
                'radial-gradient(circle at 90% 12%, rgba(42,71,146,0.08) 0%, transparent 28%)',
                'linear-gradient(180deg, rgba(247,249,254,0.55) 0%, rgba(238,242,250,0.35) 45%, rgba(255,255,255,0.2) 100%)',
              ].join(', '),
            }}
          />

          {/* Logo */}
          <div className="relative z-10 mb-10 flex items-center gap-2.5 premium-float" style={{ animationDelay: '0.1s' }}>
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary-200/70"
              style={{
                boxShadow: '0 0 16px rgba(42,71,146,0.18), inset 0 0 8px rgba(71,133,184,0.08)',
                background: 'linear-gradient(135deg, rgba(42,71,146,0.10) 0%, rgba(71,133,184,0.06) 100%)',
              }}
            >
              <img src="/logotap.png" alt="OnTap" className="h-6 w-6" />
            </div>
            <div className="flex flex-col gap-0">
              <span className="text-xs font-bold uppercase tracking-widest text-slate-400">
                Executive Portal
              </span>
            </div>
          </div>

          {/* Heading + form (switches by authView) */}
          {authView === 'login' && (
            <>
              <div className="relative z-10 mt-6 text-center">
                <div className="mb-4 flex items-center justify-center gap-2 premium-float" style={{ animationDelay: '0.2s' }}>
                  <div
                    className="group relative overflow-hidden rounded-full px-4 py-2 text-xs font-bold uppercase tracking-widest text-white premium-badge"
                    style={{
                      background: C.accentBg,
                      boxShadow: '0 8px 24px rgba(42,71,146,0.35), inset 0 0 12px rgba(255,255,255,0.18)',
                    }}
                  >
                    <span className="relative z-10 flex items-center gap-2">
                      <span className="text-lg"><MdAdminPanelSettings /></span>
                      ADMIN PORTAL
                    </span>
                    <div
                      className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                      style={{
                        background: 'linear-gradient(45deg, transparent, rgba(255,255,255,0.28), transparent)',
                      }}
                    />
                  </div>
                </div>

                <div className="my-5 h-px premium-divider" />

                <p className="mb-8 text-sm font-medium leading-relaxed text-slate-500 premium-float" style={{ animationDelay: '0.4s' }}>
                  <span className="text-slate-400">For Authorized Administrators Only</span>
                </p>
              </div>

              {ssoChecking && (
                <div className="mb-5 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600" role="status">
                  <InlineLoader className="text-current" />
                  <span>Checking for an active SmartPet session…</span>
                </div>
              )}

              {apiError && (
                <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <div className="flex items-center gap-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span>{apiError}</span>
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                <TextField
                  id={emailId}
                  label="Email Address"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="admin@company.com"
                  value={email}
                  onChange={(value) => {
                    setEmail(value)
                    if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: undefined }))
                  }}
                  leftIcon={<IconMail />}
                  error={fieldErrors.email}
                />

                <TextField
                  id={passwordId}
                  label="Password"
                  type={showPass ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(value) => {
                    setPassword(value)
                    if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: undefined }))
                  }}
                  leftIcon={<IconLock />}
                  error={fieldErrors.password}
                  rightElement={
                    <button
                      type="button"
                      aria-label={showPass ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPass((v) => !v)}
                      className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg transition hover:bg-slate-200/60 hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                    >
                      {showPass ? <IconEyeOff /> : <IconEyeOn />}
                    </button>
                  }
                />

                <div className="flex items-center justify-between pt-2">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => {
                        setRemember(e.target.checked)
                        if (!e.target.checked) clearSavedCredentials()
                      }}
                      className="w-4 h-4 rounded cursor-pointer transition-all"
                      style={{ accentColor: C.accent }}
                    />
                    <span className="select-none text-sm font-medium text-slate-400 group-hover:text-slate-500 transition-colors">Keep me signed in</span>
                  </label>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      goToForgotPassword()
                    }}
                    className="text-sm font-semibold transition-all duration-200 hover:text-transparent relative"
                    style={{ color: C.accent }}
                    onMouseEnter={(e) => {
                      const btn = e.currentTarget as HTMLButtonElement
                      btn.style.color = C.accentLight
                    }}
                    onMouseLeave={(e) => {
                      const btn = e.currentTarget as HTMLButtonElement
                      btn.style.color = C.accent
                    }}
                  >
                    Recover Access
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="premium-button group relative flex h-12 w-full items-center justify-center gap-3 overflow-hidden rounded-xl text-sm font-bold uppercase tracking-widest text-white transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0"
                  style={{
                    background: C.btnBg,
                    boxShadow: '0 12px 32px rgba(42, 71, 146, 0.35), 0 0 0 1px rgba(42, 71, 146, 0.12)',
                    backgroundSize: '200% auto',
                  }}
                  onMouseEnter={(e) => {
                    const btn = e.currentTarget as HTMLButtonElement
                    btn.style.background = C.btnHover
                    btn.style.boxShadow = '0 16px 40px rgba(42, 71, 146, 0.45), 0 0 0 1px rgba(42, 71, 146, 0.18)'
                  }}
                  onMouseLeave={(e) => {
                    const btn = e.currentTarget as HTMLButtonElement
                    btn.style.background = C.btnBg
                    btn.style.boxShadow = '0 12px 32px rgba(42, 71, 146, 0.35), 0 0 0 1px rgba(42, 71, 146, 0.12)'
                  }}
                >
                  <div
                    className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                    style={{
                      background: 'linear-gradient(45deg, transparent, rgba(255,255,255,0.22), transparent)',
                      animation: 'shimmer 2.4s infinite',
                    }}
                  />
                  <span className="relative z-10 flex items-center justify-center gap-3">
                    {isLoading ? (
                      <>
                        <InlineLoader className="text-current" />
                        <span>Authenticating...</span>
                      </>
                    ) : (
                      <span>Sign In</span>
                    )}
                  </span>
                </button>
              </form>
            </>
          )}

          {authView === 'forgot-email' && (
            <>
              <div className="text-center mt-6">
                <h1 className="text-[30px] text-nowrap sm:text-[34px] font-extrabold text-slate-900 tracking-tight leading-tight mb-2 text-center">
                  Forgot Password?
                </h1>
                <p className="text-sm text-slate-400 mb-8 leading-relaxed">
                  Enter your admin email and we&apos;ll send reset instructions if the account exists.
                </p>
              </div>

              {forgotError && (
                <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {forgotError}
                </div>
              )}

              <form onSubmit={handleForgotSubmit} className="flex flex-col gap-5">
                <TextField
                  id={forgotEmailId}
                  label="Email Address"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="admin@company.com"
                  value={forgotEmail}
                  onChange={(value) => {
                    setForgotEmail(value)
                    if (forgotError) setForgotError(null)
                  }}
                  leftIcon={<IconMail />}
                />

                <button
                  type="submit"
                  disabled={forgotLoading}
                  className="w-full h-12 rounded-xl text-white text-sm font-bold tracking-wide transition-all duration-200 hover:opacity-90 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:translate-y-0 flex items-center justify-center gap-2"
                  style={{
                    background: C.btnBg,
                    boxShadow: `0 8px 24px rgba(42, 71, 146, 0.28)`,
                  }}
                >
                  {forgotLoading ? (
                    <>
                      <InlineLoader className="text-white" />
                      <span>Sending...</span>
                    </>
                  ) : (
                    'Reset password'
                  )}
                </button>
              </form>

              <button
                type="button"
                onClick={backToLogin}
                className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-400 transition hover:text-slate-600"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12" />
                  <polyline points="12 19 5 12 12 5" />
                </svg>
                Back to sign in
              </button>
            </>
          )}

          {authView === 'forgot-sent' && (
            <>
              <div className="text-center mt-6">
                <h1 className="text-[30px] text-nowrap sm:text-[34px] font-extrabold text-slate-900 tracking-tight leading-tight mb-2 text-center">
                  Check Your Email
                </h1>
                <p className="text-sm text-slate-400 mb-4 leading-relaxed">
                  {forgotSuccessMsg}
                </p>
                <p className="text-sm text-slate-500 mb-8 leading-relaxed">
                  If you received a reset code, enter it on the next step to set a new password.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setResetError(null)
                  setAuthView('reset')
                }}
                className="w-full h-12 rounded-xl text-white text-sm font-bold tracking-wide transition-all duration-200 hover:opacity-90 hover:-translate-y-0.5 active:translate-y-0 flex items-center justify-center"
                style={{
                  background: C.btnBg,
                  boxShadow: '0 8px 24px rgba(42, 71, 146, 0.28)',
                }}
              >
                Enter Reset Code
              </button>

              <button
                type="button"
                onClick={backToLogin}
                className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-400 transition hover:text-slate-600"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12" />
                  <polyline points="12 19 5 12 12 5" />
                </svg>
                Back to sign in
              </button>
            </>
          )}

          {authView === 'reset' && (
            <>
              <div className="text-center mt-6">
                <h1 className="text-[30px] text-nowrap sm:text-[34px] font-extrabold text-slate-900 tracking-tight leading-tight mb-2 text-center">
                  Reset Password
                </h1>
                <p className="text-sm text-slate-400 mb-8 leading-relaxed">
                  Enter the reset code from your email and choose a new password.
                </p>
              </div>

              {resetError && (
                <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {resetError}
                </div>
              )}

              <form onSubmit={handleResetSubmit} className="flex flex-col gap-5">
                <TextField
                  id={resetTokenId}
                  label="Reset Code"
                  type="text"
                  required
                  autoComplete="one-time-code"
                  placeholder="Paste code from email"
                  value={resetToken}
                  onChange={(value) => {
                    setResetToken(value)
                    if (resetError) setResetError(null)
                  }}
                  leftIcon={<IconLock />}
                />

                <TextField
                  id={newPasswordId}
                  label="New Password"
                  type={showNewPass ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  placeholder="Enter new password"
                  value={newPassword}
                  onChange={(value) => {
                    setNewPassword(value)
                    if (resetError) setResetError(null)
                  }}
                  leftIcon={<IconLock />}
                  rightElement={
                    <button
                      type="button"
                      aria-label={showNewPass ? 'Hide password' : 'Show password'}
                      onClick={() => setShowNewPass((v) => !v)}
                      className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg transition hover:bg-slate-200/60 hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                    >
                      {showNewPass ? <IconEyeOff /> : <IconEyeOn />}
                    </button>
                  }
                />

                <TextField
                  id={confirmPasswordId}
                  label="Confirm Password"
                  type={showConfirmPass ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  placeholder="Re-enter new password"
                  value={confirmPassword}
                  onChange={(value) => {
                    setConfirmPassword(value)
                    if (resetError) setResetError(null)
                  }}
                  leftIcon={<IconLock />}
                  rightElement={
                    <button
                      type="button"
                      aria-label={showConfirmPass ? 'Hide password' : 'Show password'}
                      onClick={() => setShowConfirmPass((v) => !v)}
                      className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg transition hover:bg-slate-200/60 hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                    >
                      {showConfirmPass ? <IconEyeOff /> : <IconEyeOn />}
                    </button>
                  }
                />

                <button
                  type="submit"
                  disabled={forgotLoading}
                  className="w-full h-12 rounded-xl text-white text-sm font-bold tracking-wide transition-all duration-200 hover:opacity-90 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:translate-y-0 flex items-center justify-center gap-2"
                  style={{
                    background: C.btnBg,
                    boxShadow: `0 8px 24px rgba(42, 71, 146, 0.28)`,
                  }}
                >
                  {forgotLoading ? (
                    <>
                      <InlineLoader className="text-white" />
                      <span>Resetting...</span>
                    </>
                  ) : (
                    'Reset Password'
                  )}
                </button>
              </form>

              <button
                type="button"
                onClick={backToLogin}
                className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-400 transition hover:text-slate-600"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12" />
                  <polyline points="12 19 5 12 12 5" />
                </svg>
                Back to sign in
              </button>
            </>
          )}

          {authView === 'reset-done' && (
            <>
              <div className="text-center mt-6">
                <h1 className="text-[30px] text-nowrap sm:text-[34px] font-extrabold text-slate-900 tracking-tight leading-tight mb-2 text-center">
                  Password Reset!
                </h1>
                <p className="text-sm text-slate-400 mb-8 leading-relaxed">
                  Your password has been updated successfully. You can now sign in with your new password.
                </p>
              </div>

              <button
                type="button"
                onClick={backToLogin}
                className="w-full h-12 rounded-xl text-white text-sm font-bold tracking-wide transition-all duration-200 hover:opacity-90 hover:-translate-y-0.5 active:translate-y-0 flex items-center justify-center"
                style={{
                  background: C.btnBg,
                  boxShadow: '0 8px 24px rgba(42, 71, 146, 0.28)',
                }}
              >
                Back to Sign In
              </button>
            </>
          )}
        </div>
        {/* ── RIGHT: Super Admin visual ─────────────────────────────────── */}
        <div
          className="relative hidden min-h-72 overflow-hidden md:flex md:min-h-95 lg:min-h-0 lg:flex-1 lg:basis-0"
          style={{
            background: [
              'radial-gradient(ellipse 70% 55% at 50% 42%, rgba(71,133,184,0.28) 0%, transparent 62%)',
              'linear-gradient(165deg, #e8eef8 0%, #d7e3f4 48%, #c5d4eb 100%)',
            ].join(', '),
          }}
        >
          <div
            className="animate-blob pointer-events-none absolute -right-10 -top-14 h-72 w-72 rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(71,133,184,0.28) 0%, transparent 70%)' }}
          />
          <div
            className="animate-blob-d3 pointer-events-none absolute -left-12 bottom-16 h-64 w-64 rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(42,71,146,0.18) 0%, transparent 70%)' }}
          />
          <Image
            src="/superlogin.jpg"
            alt="OnTap Super Admin dashboard"
            fill
            priority
            sizes="(max-width: 768px) 0px, 50vw"
            className="animate-phone-glow pointer-events-none select-none object-cover object-center"
            style={{ zIndex: 8 }}
            draggable={false}
          />
        </div>
      </div>
    </div>
  )
}


export default SuperAdminLogin