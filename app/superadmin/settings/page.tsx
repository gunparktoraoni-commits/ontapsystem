"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Bell,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock,
  Eye,
  Infinity as InfinityIcon,
  KeyRound,
  LogIn,
  Pencil,
  QrCode, 
  Shield,
  SlidersHorizontal,
  User,
  X,
} from 'lucide-react';
import LoginHistoryPanel from './components/LoginHistoryPanel';
import NotificationPreferencesPanel from './components/NotificationPreferencesPanel';
import BroadcastNotificationPanel from './components/BroadcastNotificationPanel';
import { PortalModal } from '../components/ui';
import { toServableMediaSrc } from '@/app/lib/portfolioDisplay';
import { ProfileImageCropModal } from '@/app/components/ProfileImageCropModal';

type SettingsTab = 'profile' | 'security' | 'loginHistory' | 'preferences' | 'paymentChannel' | 'broadcast';
type SuperAdminRole = 'Super Admin' | 'Admin' | 'Support' | 'Sales';

interface SuperAdminProfile {
  fullName: string;
  email: string;
  phoneNumber: string;
  role: SuperAdminRole;
  location: string;
  profileImage: string | null;
  serialId: string | null;
  twoFactorEnabled: boolean;
  startDate: string;
  lastLogin: string;
}

interface ProfileDraft {
  fullName: string;
  email: string;
  phoneNumber: string;
  role: SuperAdminRole;
  location: string;
}


type ProfileErrors = Partial<Record<keyof ProfileDraft, string>>;



interface PasswordErrors {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

function getInitials(value: string): string {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return 'SA';
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? parts[1]?.[0] ?? '' : parts[0]?.[1] ?? '';
  return `${first}${second}`.toUpperCase() || 'SA';
}

function resolveProfileImageSrc(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return toServableMediaSrc(trimmed) || null;
}

function ProfileAvatar({
  name,
  imageUrl,
  serialId,
}: {
  name: string;
  imageUrl: string | null;
  serialId?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(imageUrl) && !failed;
  const serial = typeof serialId === 'string' ? serialId.trim() : '';
  // Prefer a real avatar photo; otherwise show serial/identifier, then name initials.
  const identifier = serial || getInitials(name);
  const identifierClass =
    identifier.length > 4 ? 'text-sm tracking-tight' : identifier.length > 2 ? 'text-lg' : 'text-2xl';

  useEffect(() => {
    setFailed(false);
  }, [imageUrl]);

  return (
    <div
      className={`absolute left-6 top-14 z-10 flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-4 border-white font-bold text-white shadow-[0_18px_46px_rgba(15,23,42,0.14)] ${identifierClass}`}
      style={
        showImage
          ? { backgroundColor: '#EEF2FA' }
          : { background: 'linear-gradient(135deg,#2A4792,#4785B8)' }
      }
    >
      {showImage ? (
        <img
          src={imageUrl!}
          alt={name || 'Profile'}
          className="h-full w-full object-cover"
          draggable={false}
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="px-1 text-center leading-none">{identifier}</span>
      )}
    </div>
  );
}

function isValidPhilippineMobile(value: string): boolean {
  // Strict PH mobile format: +63 then 9 then 9 digits (e.g., +639123456789).
  return /^\+639\d{9}$/.test(value);
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function validatePasswordStrength(value: string): string | null {
  const trimmed = value;
  if (trimmed.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Z]/.test(trimmed)) return 'Password must include at least 1 uppercase letter.';
  if (!/\d/.test(trimmed)) return 'Password must include at least 1 number.';
  if (!/[^A-Za-z0-9]/.test(trimmed)) return 'Password must include at least 1 special character.';
  return null;
}

type TwoFactorMethod = 'authenticator' | 'sms';

const BACKEND_URL = '';
const MAX_PROFILE_UPLOAD_BYTES = Math.floor(4.5 * 1024 * 1024);

const SECURITY_POLICY_ITEMS = [
  {
    id: 'autoLockAfterInactivity',
    title: 'Auto lock after inactivity',
    description: 'Lock session after 15 minutes of inactivity',
  },
  {
    id: 'loginNotificationEmails',
    title: 'Login notifications emails',
    description: 'Get email alerts on new sign-ins',
  },
  {
    id: 'blockSuspiciousIps',
    title: 'Block suspicious IPs',
    description: 'Automatically block logins from flagged IPs',
  },
  {
    id: 'enforcePasswordRotation',
    title: 'Enforce password rotation',
    description: 'Require password change every 90 days',
  },
] as const;

type SecurityPolicyId = (typeof SECURITY_POLICY_ITEMS)[number]['id'];

type SecurityPoliciesState = Record<SecurityPolicyId, boolean>;

const DEFAULT_SECURITY_POLICIES: SecurityPoliciesState = {
  autoLockAfterInactivity: true,
  loginNotificationEmails: true,
  blockSuspiciousIps: true,
  enforcePasswordRotation: false,
};

function generateManualEntryKey(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let result = '';
  for (let index = 0; index < 16; index += 1) {
    result += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return result.match(/.{1,4}/g)?.join(' ') ?? result;
}

function formatDateLabel(value: unknown): string {
  if (typeof value !== 'string' || !value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' });
}

function ToggleSwitch({
  checked,
  onCheckedChange,
  ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onCheckedChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4b74bf] focus-visible:ring-offset-2 ${
        checked ? 'border-primary bg-primary' : 'border-gray-100 bg-[#eef3ff]'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

const TAB_ITEMS: Array<{ id: SettingsTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'loginHistory', label: 'Login History', icon: LogIn },
  { id: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
  { id: 'broadcast', label: 'Broadcast', icon: Bell },
];

function resolveInitialSettingsTab(tabParam: string | null): SettingsTab {
  if (tabParam === 'broadcast') return 'broadcast';
  return 'profile';
}

export default function SuperAdminSettingsPage() {
  const searchParams = useSearchParams();
  const initialTab = useMemo(
    () => resolveInitialSettingsTab(searchParams.get('tab')),
    [searchParams],
  );
  const [profile, setProfile] = useState<SuperAdminProfile>({
    fullName: '',
    email: '',
    phoneNumber: '',
    role: 'Super Admin',
    location: '',
    profileImage: null,
    serialId: null,
    twoFactorEnabled: false,
    startDate: 'N/A',
    lastLogin: 'N/A',
  });

  const [tab, setTab] = useState<SettingsTab>(initialTab);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [draft, setDraft] = useState<ProfileDraft>(() => ({
    fullName: profile.fullName,
    email: profile.email,
    phoneNumber: profile.phoneNumber,
    role: profile.role,
    location: profile.location,
  }));
  const [draftErrors, setDraftErrors] = useState<ProfileErrors>({});
  const [profileSaveError, setProfileSaveError] = useState<string | null>(null);
  const [profileCropFile, setProfileCropFile] = useState<File | null>(null);
  const [profileImageUploading, setProfileImageUploading] = useState(false);
  const [profileImageError, setProfileImageError] = useState<string | null>(null);
  const profileImageInputRef = useRef<HTMLInputElement | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<PasswordErrors>({});

  const [twoFactorMethod, setTwoFactorMethod] = useState<TwoFactorMethod>('authenticator');
  const [isManualKeyVisible, setIsManualKeyVisible] = useState(false);
  const [manualEntryKey, setManualEntryKey] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [securityPolicies, setSecurityPolicies] = useState<SecurityPoliciesState>(DEFAULT_SECURITY_POLICIES);
  const [securitySettingsLoaded, setSecuritySettingsLoaded] = useState(false);
  const [passwordViewMode, setPasswordViewMode] = useState<'one_time' | 'timed' | 'permanent'>('one_time');
  const [passwordViewDurationHours, setPasswordViewDurationHours] = useState(24);
  const [passwordViewGrantLabel, setPasswordViewGrantLabel] = useState<string | null>(null);
  const [passwordViewSaving, setPasswordViewSaving] = useState(false);
  const [passwordViewRevoking, setPasswordViewRevoking] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  const roleBadge = useMemo(() => {
    if (profile.role === 'Super Admin') return 'border-gray-100 bg-primary/10 text-primary';
    return 'border-gray-100 bg-[#fbfdff] text-gray-900';
  }, [profile.role]);
  const twoFactorBadge = useMemo(() => {
    return profile.twoFactorEnabled
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border-amber-200 bg-amber-50 text-amber-800';
  }, [profile.twoFactorEnabled]);

  useEffect(() => {
    if (!isEditOpen) return;
    window.setTimeout(() => firstFieldRef.current?.focus(), 0);
  }, [isEditOpen]);

  useEffect(() => {
    if (!toastMessage) return;
    const timeout = window.setTimeout(() => setToastMessage(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toastMessage]);

  useEffect(() => {
    let isMounted = true;

    async function fetchProfile(): Promise<void> {
      try {
        const response = await fetch(`${BACKEND_URL}/api/superadmin/settings/profile`, {
          method: 'GET',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!response.ok) throw new Error(`Profile fetch failed: ${response.status}`);
        const payload = await response.json();
        const data = payload?.data ?? {};
        const firstName = typeof data.first_name === 'string' ? data.first_name.trim() : '';
        const lastName = typeof data.last_name === 'string' ? data.last_name.trim() : '';
        const fullName = `${firstName} ${lastName}`.trim() || (typeof data.name === 'string' ? data.name : '');

        if (!isMounted) return;
        setProfile((prev) => ({
          ...prev,
          fullName: fullName || prev.fullName,
          email: typeof data.email === 'string' ? data.email : prev.email,
          phoneNumber: typeof data.phone === 'string' ? data.phone : prev.phoneNumber,
          location: typeof data.location === 'string' ? data.location : prev.location,
          profileImage: resolveProfileImageSrc(data.profile_image ?? data.profile_url),
          serialId:
            typeof data.serial_id === 'string' && data.serial_id.trim()
              ? data.serial_id.trim()
              : null,
          twoFactorEnabled: Boolean(data.two_factor_enabled),
          startDate: formatDateLabel(data.created_at),
          lastLogin: formatDateLabel(data.last_login_at),
        }));
      } catch (error) {
        console.error('Failed to fetch superadmin profile:', error);
      }
    }

    void fetchProfile();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (tab !== 'security' || securitySettingsLoaded) return;

    let isMounted = true;
    async function fetchSecurity(): Promise<void> {
      try {
        const [securityResponse, setupResponse, passwordViewResponse] = await Promise.all([
          fetch(`${BACKEND_URL}/api/superadmin/settings/security`, {
            method: 'GET',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
          }),
          fetch(`${BACKEND_URL}/api/superadmin/settings/2fa/setup`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
          }),
          fetch(`${BACKEND_URL}/api/superadmin/settings/password-view`, {
            method: 'GET',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
          }),
        ]);

        if (securityResponse.ok) {
          const securityPayload = await securityResponse.json();
          const data = securityPayload?.data ?? {};
          if (isMounted) {
            setSecurityPolicies({
              autoLockAfterInactivity: typeof data.auto_logout_minutes === 'number' ? data.auto_logout_minutes <= 15 : true,
              loginNotificationEmails: Boolean(data.login_notifications),
              blockSuspiciousIps: Array.isArray(data.suspicious_ips) ? data.suspicious_ips.length > 0 : true,
              enforcePasswordRotation: typeof data.password_rotation_days === 'number' ? data.password_rotation_days > 0 : false,
            });
          }
        }

        if (setupResponse.ok) {
          const setupPayload = await setupResponse.json();
          const setupData = setupPayload?.data ?? {};
          if (isMounted) {
            setManualEntryKey(
              typeof setupData.manual_entry_key === 'string' && setupData.manual_entry_key.trim()
                ? setupData.manual_entry_key
                : generateManualEntryKey()
            );
            setTwoFactorMethod('authenticator');
          }
        }

        if (passwordViewResponse.ok) {
          const passwordViewPayload = await passwordViewResponse.json();
          const data = passwordViewPayload?.data ?? {};
          const preference = data.preference ?? {};
          if (isMounted) {
            if (preference.mode === 'one_time' || preference.mode === 'timed' || preference.mode === 'permanent') {
              setPasswordViewMode(preference.mode);
            }
            if (typeof preference.duration_hours === 'number' && preference.duration_hours > 0) {
              setPasswordViewDurationHours(preference.duration_hours);
            }
            const grant = data.active_grant;
            if (grant?.mode === 'permanent') {
              setPasswordViewGrantLabel('Permanent viewing access is currently active');
            } else if (grant?.mode === 'timed' && grant.expires_at) {
              const remainingMs = new Date(grant.expires_at).getTime() - Date.now();
              if (remainingMs > 0) {
                const hours = Math.ceil(remainingMs / (60 * 60 * 1000));
                setPasswordViewGrantLabel(
                  hours < 48
                    ? `Timed viewing access active · ${hours}h remaining`
                    : `Timed viewing access active · ${Math.ceil(hours / 24)}d remaining`,
                );
              } else {
                setPasswordViewGrantLabel(null);
              }
            } else {
              setPasswordViewGrantLabel(null);
            }
          }
        }
      } catch (error) {
        console.error('Failed to fetch security settings:', error);
      } finally {
        if (isMounted) setSecuritySettingsLoaded(true);
      }
    }
    void fetchSecurity();
    return () => {
      isMounted = false;
    };
  }, [securitySettingsLoaded, tab]);

  const savePasswordViewPreference = async (
    nextMode: 'one_time' | 'timed' | 'permanent',
    nextHours = passwordViewDurationHours,
  ) => {
    setPasswordViewSaving(true);
    setPasswordViewMode(nextMode);
    if (nextMode === 'timed') setPasswordViewDurationHours(nextHours);
    try {
      const response = await fetch(`${BACKEND_URL}/api/superadmin/settings/password-view`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: nextMode,
          duration_hours: nextHours,
        }),
      });
      if (!response.ok) throw new Error('Failed to save preference');
      setToastMessage('Password viewing preference saved.');
    } catch (error) {
      console.error('Failed to save password view preference:', error);
      setToastMessage('Could not save password viewing preference.');
    } finally {
      setPasswordViewSaving(false);
    }
  };

  const revokePasswordViewAccess = async () => {
    setPasswordViewRevoking(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/superadmin/settings/password-view`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to revoke');
      setPasswordViewGrantLabel(null);
      setToastMessage('Password viewing access revoked.');
    } catch (error) {
      console.error('Failed to revoke password view grants:', error);
      setToastMessage('Could not revoke password viewing access.');
    } finally {
      setPasswordViewRevoking(false);
    }
  };

  const openEdit = () => {
    setDraft({
      fullName: profile.fullName,
      email: profile.email,
      phoneNumber: profile.phoneNumber,
      role: profile.role,
      location: profile.location,
    });
    setDraftErrors({});
    setProfileSaveError(null);
    setIsEditOpen(true);
  };

  const closeEdit = () => {
    setIsEditOpen(false);
    setDraftErrors({});
    setProfileSaveError(null);
  };

  const validateDraft = (nextDraft: ProfileDraft): ProfileErrors => {
    const errors: ProfileErrors = {};
    if (!nextDraft.fullName.trim()) {
      errors.fullName = 'Full name is required.';
    }
    if (!isValidPhilippineMobile(nextDraft.phoneNumber)) {
      errors.phoneNumber = 'Phone number must be in the format +639123456789.';
    }
    if (!isValidEmail(nextDraft.email)) {
      errors.email = 'Please enter a valid email address.';
    }
    if (!nextDraft.location.trim()) {
      errors.location = 'Location is required.';
    }
    return errors;
  };

  const onSaveProfile = async () => {
    setProfileSaveError(null);
    const errors = validateDraft(draft);
    setDraftErrors(errors);
    if (Object.keys(errors).length > 0) return;
    const [first_name, ...rest] = draft.fullName.trim().split(' ');
    const last_name = rest.join(' ').trim();

    try {
      const response = await fetch(`${BACKEND_URL}/api/superadmin/settings/profile`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name,
          last_name,
          email: draft.email.trim(),
          phone: draft.phoneNumber,
          location: draft.location.trim(),
        }),
      });
      if (!response.ok) throw new Error(`Profile update failed: ${response.status}`);
      setProfile((prev) => ({
        ...prev,
        fullName: draft.fullName.trim(),
        email: draft.email.trim(),
        phoneNumber: draft.phoneNumber,
        role: draft.role,
        location: draft.location.trim(),
      }));
      setIsEditOpen(false);
      setToastMessage('Profile updated successfully.');
    } catch (error) {
      console.error('Failed to update profile:', error);
      setProfileSaveError(error instanceof Error ? error.message : 'Could not update profile.');
    }
  };

  const uploadProfileImage = async (file: File) => {
    setProfileImageUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('context', 'profile');
      const uploadResponse = await fetch('/api/media/upload', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const uploadPayload = await uploadResponse.json().catch(() => null);
      const imageUrl = typeof uploadPayload?.url === 'string' ? uploadPayload.url.trim() : '';
      if (!uploadResponse.ok || !imageUrl) {
        throw new Error(uploadPayload?.error || 'Unable to upload profile photo.');
      }

      const profileResponse = await fetch(`${BACKEND_URL}/api/superadmin/settings/profile`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_image: imageUrl }),
      });
      const profilePayload = await profileResponse.json().catch(() => null);
      if (!profileResponse.ok || profilePayload?.success === false) {
        throw new Error(profilePayload?.error || 'Photo uploaded but profile could not be updated.');
      }

      setProfile((current) => ({
        ...current,
        profileImage: resolveProfileImageSrc(imageUrl),
      }));
      setProfileImageError(null);
      setToastMessage('Profile photo updated.');
    } finally {
      setProfileImageUploading(false);
    }
  };
  const validatePasswords = (): PasswordErrors => {
    const errors: PasswordErrors = {};
    if (!currentPassword) {
      errors.currentPassword = 'Current password is required.';
    }
    const strengthError = validatePasswordStrength(newPassword);
    if (!newPassword) {
      errors.newPassword = 'New password is required.';
    } else if (strengthError) {
      errors.newPassword = strengthError;
    }

    if (!confirmPassword) {
      errors.confirmPassword = 'Confirm password is required.';
    } else if (newPassword && confirmPassword !== newPassword) {
      errors.confirmPassword = 'Passwords do not match.';
    }

    return errors;
  };

  const onUpdatePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    const errors = validatePasswords();
    setPasswordErrors(errors);
    if (Object.keys(errors).length > 0) return;

    try {
      const response = await fetch(`${BACKEND_URL}/api/superadmin/settings/change-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
          confirm_password: confirmPassword,
        }),
      });
      if (!response.ok) throw new Error(`Password update failed: ${response.status}`);

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordErrors({});
      setToastMessage("You’ve successfully updated your password.");
    } catch (error) {
      console.error('Failed to update password:', error);
    }
  };

  const maskedSmsNumber = useMemo(() => {
    const raw = profile.phoneNumber.trim();
    if (!raw.startsWith('+63')) return '+63*****';
    const digitsOnly = raw.replace(/[^\d]/g, '');
    if (!digitsOnly.startsWith('63') || digitsOnly.length < 7) return '+63*****';
    const last4 = digitsOnly.slice(-4);
    return `+63*****${last4}`;
  }, [profile.phoneNumber]);

  const onVerifyTwoFactor = async () => {
    const normalized = verificationCode.trim();
    if (!/^\d{6}$/.test(normalized)) {
      setVerificationError('Verification code must be a 6-digit number.');
      return;
    }

    try {
      const endpoint = profile.twoFactorEnabled
        ? `${BACKEND_URL}/api/superadmin/settings/2fa/disable`
        : `${BACKEND_URL}/api/superadmin/settings/2fa/enable`;
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: profile.twoFactorEnabled
          ? undefined
          : JSON.stringify({ secret: manualEntryKey.replace(/\s+/g, ''), verification_code: normalized }),
      });
      if (!response.ok) throw new Error(`2FA request failed: ${response.status}`);
      setVerificationCode('');
      setVerificationError(null);
      const nextEnabled = !profile.twoFactorEnabled;
      setProfile((prev) => ({ ...prev, twoFactorEnabled: nextEnabled }));
      setToastMessage(nextEnabled ? 'Two Factor Authentication is now active.' : 'Two Factor Authentication disabled.');
    } catch (error) {
      console.error('Failed to update 2FA:', error);
    }
  };

  const renderPlaceholder = (title: string, description: string) => {
    return (
      <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-gray-900">{title}</h3>
            <p className="text-sm text-gray-500">{description}</p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-gray-100 bg-[#fbfdff] px-3 py-1 text-xs font-semibold text-gray-500">
            Coming Soon
            <ChevronRight className="h-4 w-4" />
          </span>
        </div>
      </section>
    );
  };

  return (
    <section className="space-y-6">
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.18 }}
            className="fixed right-4 top-4 z-50 w-[min(420px,calc(100vw-2rem))] rounded-2xl border border-gray-100 bg-white p-4 shadow-[0_24px_60px_rgba(15,23,42,0.24)]"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                <CheckCircle2 className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900">Success</p>
                <p className="mt-1 text-sm text-gray-500">{toastMessage}</p>
              </div>
              <button
                type="button"
                onClick={() => setToastMessage(null)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-100 bg-white text-gray-500 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4b74bf] focus-visible:ring-offset-2"
                aria-label="Dismiss notification"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-3xl font-bold bg-linear-to-r from-[#1f3f7c] via-[#2f62a9] to-[#4f93c8] bg-clip-text tracking-tight text-transparent">Settings Page</h2>
          <p className="text-sm text-gray-500">Manage your account, security settings, and session</p>
        </div>

        <button
          type="button"
          onClick={openEdit}
          className="inline-flex items-center justify-center gap-2 self-start rounded-xl border border-primary bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#233f7d] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4b74bf] focus-visible:ring-offset-2"
        >
          Edit Profile
        </button>
      </header>

      <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div
          className="flex items-center gap-2 border-b border-[#e8eef8] bg-[#fbfdff] px-3 py-2 sm:px-4"
          role="tablist"
          aria-label="Settings tabs"
        >
          <div className="flex w-full items-center gap-1 overflow-x-auto">
            {TAB_ITEMS.map(({ id, label, icon: Icon }) => {
              const active = id === tab;

              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4b74bf] focus-visible:ring-offset-2 ${
                    active
                      ? 'bg-white text-primary shadow-sm'
                      : 'text-gray-500 hover:bg-white hover:text-gray-900'
                  }`}
                  role="tab"
                  aria-selected={active}
                  aria-controls={`tab-panel-${id}`}
                  id={`tab-${id}`}
                >
                  <Icon className={`h-4 w-4 ${active ? 'text-primary' : 'text-gray-500'}`} />
                  <span className="whitespace-nowrap">{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-4 py-5 sm:px-6">
          {tab === 'profile' && (
            <div
              id="tab-panel-profile"
              role="tabpanel"
              aria-labelledby="tab-profile"
              className="space-y-6"
            >
              <ProfileImageCropModal
                file={profileCropFile}
                title="Crop Administrator Photo"
                onClose={() => setProfileCropFile(null)}
                onApply={uploadProfileImage}
              />
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                  <div className="relative">
                    <div className="h-28 bg-linear-to-r from-[#2a4d98] to-[#2a3c71]" />
                    <ProfileAvatar
                      name={profile.fullName}
                      imageUrl={profile.profileImage}
                      serialId={profile.serialId}
                    />
                  </div>

                  <div className="px-6 pb-6 pt-14">
                    <div className="mb-4 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => profileImageInputRef.current?.click()}
                        disabled={profileImageUploading}
                        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                      >
                        <Camera className="h-4 w-4" />
                        {profileImageUploading ? 'Uploading photo…' : 'Change profile photo'}
                      </button>
                      <input
                        ref={profileImageInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = '';
                          if (!file) return;
                          if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
                            setProfileImageError('Choose a JPG, PNG, or WEBP image.');
                            return;
                          }
                          if (file.size > MAX_PROFILE_UPLOAD_BYTES) {
                            setProfileImageError('Profile photo must be 4.5 MB or smaller.');
                            return;
                          }
                          setProfileImageError(null);
                          setProfileCropFile(file);
                        }}
                      />
                      {profileImageError && (
                        <p className="text-xs text-red-600" role="alert">{profileImageError}</p>
                      )}
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-xl font-bold text-gray-900">{profile.fullName}</h3>
                          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${roleBadge}`}>
                            {profile.role}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${twoFactorBadge}`}
                          >
                            {profile.twoFactorEnabled ? (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            ) : (
                              <AlertTriangle className="h-3.5 w-3.5" />
                            )}
                            {profile.twoFactorEnabled ? '2FA enabled' : '2FA disabled'}
                          </span>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                          <span>Start date: {profile.startDate}</span>
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5 text-gray-400" />
                            Last login: {profile.lastLogin}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={openEdit}
                        className="inline-flex items-center justify-center gap-2 rounded-full border border-gray-100 bg-white px-4 py-2 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4b74bf] focus-visible:ring-offset-2"
                      >
                        <Pencil className="h-4 w-4 text-primary" />
                        edit
                      </button>
                    </div>

                    <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-gray-500">Full Name</label>
                        <input
                          value={profile.fullName}
                          readOnly
                          className="w-full rounded-lg border border-gray-100 bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-gray-500">Phone Number</label>
                        <input
                          value={profile.phoneNumber}
                          readOnly
                          className="w-full rounded-lg border border-gray-100 bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none"
                        />
                      </div>

                      <div className="space-y-1 sm:col-span-2">
                        <label className="text-xs font-semibold text-gray-500">Email</label>
                        <input
                          value={profile.email}
                          readOnly
                          className="w-full rounded-lg border border-gray-100 bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-gray-500">Role</label>
                        <input
                          value={profile.role}
                          readOnly
                          className="w-full rounded-lg border border-gray-100 bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-gray-500">Location</label>
                        <input
                          value={profile.location}
                          readOnly
                          className="w-full rounded-lg border border-gray-100 bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none"
                        />
                      </div>
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        <KeyRound className="h-6 w-6" />
                      </span>
                      <div className="space-y-1">
                        <h3 className="text-lg font-bold text-gray-900">Change Password</h3>
                        <p className="text-sm text-gray-500">
                          Password must be 8+ characters with upper, number, and special character.
                        </p>
                      </div>
                    </div>
                  </div>

                  <form onSubmit={onUpdatePassword} className="mt-5 space-y-4">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-gray-500">Current Password</label>
                      <input
                        type="password"
                        value={currentPassword}
                        onChange={(event) => {
                          setCurrentPassword(event.target.value);
                          setPasswordErrors((prev) => ({ ...prev, currentPassword: undefined }));
                        }}
                        className={`w-full rounded-lg border bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none transition-colors focus:border-[#4b74bf] ${
                          passwordErrors.currentPassword ? 'border-rose-200' : 'border-gray-100'
                        }`}
                      />
                      {passwordErrors.currentPassword && (
                        <p className="text-xs font-semibold text-rose-600">{passwordErrors.currentPassword}</p>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-gray-500">New Password</label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(event) => {
                          setNewPassword(event.target.value);
                          setPasswordErrors((prev) => ({ ...prev, newPassword: undefined }));
                        }}
                        className={`w-full rounded-lg border bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none transition-colors focus:border-[#4b74bf] ${
                          passwordErrors.newPassword ? 'border-rose-200' : 'border-gray-100'
                        }`}
                      />
                      {passwordErrors.newPassword && (
                        <p className="text-xs font-semibold text-rose-600">{passwordErrors.newPassword}</p>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-gray-500">Confirm Password</label>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(event) => {
                          setConfirmPassword(event.target.value);
                          setPasswordErrors((prev) => ({ ...prev, confirmPassword: undefined }));
                        }}
                        className={`w-full rounded-lg border bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none transition-colors focus:border-[#4b74bf] ${
                          passwordErrors.confirmPassword ? 'border-rose-200' : 'border-gray-100'
                        }`}
                      />
                      {passwordErrors.confirmPassword && (
                        <p className="text-xs font-semibold text-rose-600">{passwordErrors.confirmPassword}</p>
                      )}
                    </div>

                    <div className="pt-1">
                      <button
                        type="submit"
                        className="inline-flex w-full items-center justify-center rounded-xl border border-primary bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#233f7d] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4b74bf] focus-visible:ring-offset-2"
                      >
                        Update Password
                      </button>
                    </div>
                  </form>
                </section>
              </div>
            </div>
          )}

          {tab === 'security' && (
            <div id="tab-panel-security" role="tabpanel" aria-labelledby="tab-security">
              <div className="space-y-6">
                <header className="space-y-1">
                  <h3 className="text-xl font-bold text-gray-900">Two Factor Authentication</h3>
                  <p className="text-sm text-gray-500">Protect your superadmin account by enabling authentication.</p>
                </header>

                <section
                  className={`rounded-2xl border px-5 py-4 shadow-sm ${
                    profile.twoFactorEnabled
                      ? 'border-emerald-200 bg-emerald-50'
                      : 'border-amber-200 bg-amber-50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 inline-flex h-11 w-11 items-center justify-center rounded-2xl ${
                        profile.twoFactorEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {profile.twoFactorEnabled ? (
                        <CheckCircle2 className="h-5 w-5" />
                      ) : (
                        <AlertTriangle className="h-5 w-5" />
                      )}
                    </span>

                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">
                        {profile.twoFactorEnabled
                          ? '2FA is active and protecting your account'
                          : '2FA is inactive and not protecting your account'}
                      </p>
                      <p className="mt-1 text-sm text-gray-500">
                        {profile.twoFactorEnabled
                          ? 'You will be asked for a verification code when signing in.'
                          : 'Activate 2FA to add an extra layer of protection for super admin access.'}
                      </p>
                    </div>
                  </div>
                </section>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                    <p className="text-xs font-bold tracking-widest text-gray-500">AUTHENTICATION METHOD</p>

                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-1">
                      <label
                        className={`cursor-pointer rounded-2xl border p-4 transition-colors focus-within:ring-2 focus-within:ring-[#4b74bf] focus-within:ring-offset-2 ${
                          twoFactorMethod === 'authenticator'
                            ? 'border-primary bg-primary/10'
                            : 'border-gray-100 bg-white hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="twoFactorMethod"
                          value="authenticator"
                          checked={twoFactorMethod === 'authenticator'}
                          onChange={() => setTwoFactorMethod('authenticator')}
                          className="sr-only"
                        />

                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-gray-900">Authenticator App</p>
                            <p className="mt-1 text-sm text-gray-500">Use google authenticator</p>
                          </div>

                          <div className="flex items-center gap-2">
                            {twoFactorMethod === 'authenticator' && (
                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                                Active
                              </span>
                            )}
                            <span
                              className={`relative inline-flex h-5 w-5 items-center justify-center rounded-full border ${
                                twoFactorMethod === 'authenticator' ? 'border-primary' : 'border-[#b9c8e8]'
                              }`}
                              aria-hidden="true"
                            >
                              {twoFactorMethod === 'authenticator' && (
                                <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                              )}
                            </span>
                          </div>
                        </div>
                      </label>

                    
                    </div>
                  </section>

                  <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                    <p className="text-xs font-bold tracking-widest text-gray-500">SCAN TO VERIFY</p>
                    <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-start">
                      <div className="flex w-full flex-col items-center sm:w-auto">
                        <div className="flex h-37.5 w-37.5 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-100 bg-[#fbfdff] text-gray-500">
                          <QrCode className="h-8 w-8" />
                          <p className="mt-2 text-xs font-semibold">QR Code Placeholder</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setIsManualKeyVisible((prev) => !prev)}
                          className="mt-3 text-xs font-semibold text-primary underline decoration-[#2a4d98]/40 underline-offset-4 hover:text-[#233f7d]"
                        >
                          Manual entry key
                        </button>
                      </div>

                      <div className="w-full flex-1 space-y-4">
                        {isManualKeyVisible && (
                          <div className="space-y-1">
                            <label className="text-xs font-semibold text-gray-500">Manual setup key</label>
                            <input
                              readOnly
                              value={manualEntryKey}
                              className="w-full rounded-lg border border-gray-100 bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none"
                            />
                          </div>
                        )}

                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-gray-500">Verification Code</label>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <input
                              inputMode="numeric"
                              value={verificationCode}
                              onChange={(event) => {
                                const next = event.target.value.replace(/\D/g, '').slice(0, 6);
                                setVerificationCode(next);
                                setVerificationError(null);
                              }}
                              placeholder="123456"
                              className={`w-full rounded-lg border bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none transition-colors focus:border-[#4b74bf] sm:flex-1 ${
                                verificationError ? 'border-rose-200' : 'border-gray-100'
                              }`}
                            />
                            <button
                              type="button"
                              onClick={onVerifyTwoFactor}
                              className="inline-flex w-full items-center justify-center rounded-xl border border-primary bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#233f7d] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4b74bf] focus-visible:ring-offset-2 sm:w-auto"
                            >
                              {profile.twoFactorEnabled ? 'Verify' : 'Activate'}
                            </button>
                          </div>
                          {verificationError && (
                            <p className="text-xs font-semibold text-rose-600">{verificationError}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </section>
                </div>

                <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs font-bold tracking-widest text-gray-500">USER PASSWORD VIEWING</p>
                      <p className="mt-1 text-sm text-gray-500">
                        Default access window when revealing a user password during impersonation.
                      </p>
                    </div>
                    {passwordViewSaving ? (
                      <span className="text-xs font-semibold text-primary">Saving…</span>
                    ) : null}
                  </div>

                  {passwordViewGrantLabel ? (
                    <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm font-semibold text-amber-900">{passwordViewGrantLabel}</p>
                      <button
                        type="button"
                        onClick={() => void revokePasswordViewAccess()}
                        disabled={passwordViewRevoking}
                        className="inline-flex items-center justify-center rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 disabled:opacity-50"
                      >
                        {passwordViewRevoking ? 'Revoking…' : 'Revoke access'}
                      </button>
                    </div>
                  ) : null}

                  <div className="mt-4 grid gap-2">
                    {(
                      [
                        {
                          id: 'one_time' as const,
                          title: 'One-time only',
                          description: 'Require your password every time you reveal a user password.',
                          icon: Eye,
                        },
                        {
                          id: 'timed' as const,
                          title: 'Time-limited',
                          description: 'Stay unlocked for a chosen duration after you confirm once.',
                          icon: Clock,
                        },
                        {
                          id: 'permanent' as const,
                          title: 'Permanent',
                          description: 'Keep viewing unlocked until you revoke it here.',
                          icon: InfinityIcon,
                        },
                      ] as const
                    ).map((option) => {
                      const Icon = option.icon;
                      const selected = passwordViewMode === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => void savePasswordViewPreference(option.id)}
                          className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                            selected
                              ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                              : 'border-gray-100 bg-[#fbfdff] hover:border-primary/30'
                          }`}
                        >
                          <span
                            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                              selected ? 'bg-primary text-white' : 'bg-[#eef3ff] text-primary'
                            }`}
                          >
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-gray-900">{option.title}</span>
                            <span className="mt-0.5 block text-xs text-gray-500">{option.description}</span>
                          </span>
                          <span
                            className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                              selected ? 'border-primary' : 'border-[#b9c8e8]'
                            }`}
                          >
                            {selected ? <span className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {passwordViewMode === 'timed' ? (
                    <div className="mt-4 rounded-2xl border border-gray-100 bg-[#fbfdff] p-3">
                      <p className="mb-2 text-xs font-semibold text-gray-500">Default duration</p>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { id: '1h', label: '1 hour', hours: 1 },
                          { id: '24h', label: '24 hours', hours: 24 },
                          { id: '7d', label: '7 days', hours: 24 * 7 },
                          { id: '30d', label: '30 days', hours: 24 * 30 },
                        ].map((preset) => {
                          const selected = passwordViewDurationHours === preset.hours;
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => void savePasswordViewPreference('timed', preset.hours)}
                              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                                selected
                                  ? 'bg-primary text-white'
                                  : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:ring-primary/40'
                              }`}
                            >
                              {preset.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </section>

                <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                  <p className="text-xs font-bold tracking-widest text-gray-500">SECURITY POLICIES</p>

                  <div className="mt-4 divide-y divide-[#eef3ff] rounded-2xl border border-[#e8eef8] bg-[#fbfdff]">
                    {SECURITY_POLICY_ITEMS.map((policy) => (
                      <div key={policy.id} className="flex items-center justify-between gap-4 px-4 py-4">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900">{policy.title}</p>
                          <p className="mt-1 text-sm text-gray-500">{policy.description}</p>
                        </div>
                        <ToggleSwitch
                          checked={securityPolicies[policy.id]}
                          ariaLabel={policy.title}
                          onCheckedChange={async (next) => {
                            const nextPolicies = { ...securityPolicies, [policy.id]: next };
                            setSecurityPolicies(nextPolicies);
                            try {
                              await fetch(`${BACKEND_URL}/api/superadmin/settings/security`, {
                                method: 'PUT',
                                credentials: 'include',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  auto_logout_minutes: nextPolicies.autoLockAfterInactivity ? 15 : 60,
                                  login_notifications: nextPolicies.loginNotificationEmails,
                                  password_rotation_days: nextPolicies.enforcePasswordRotation ? 90 : 0,
                                  suspicious_ips: nextPolicies.blockSuspiciousIps ? ['AUTO_BLOCKED'] : [],
                                }),
                              });
                            } catch (error) {
                              console.error('Failed to update security settings:', error);
                            }
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          )}

          {tab === 'loginHistory' && (
            <div id="tab-panel-loginHistory" role="tabpanel" aria-labelledby="tab-loginHistory">
              <LoginHistoryPanel />
            </div>
          )}

          {tab === 'preferences' && (
            <div id="tab-panel-preferences" role="tabpanel" aria-labelledby="tab-preferences">
              <NotificationPreferencesPanel />
            </div>
          )}

          {tab === 'broadcast' && (
            <div id="tab-panel-broadcast" role="tabpanel" aria-labelledby="tab-broadcast">
              <BroadcastNotificationPanel />
            </div>
          )}

          {tab === 'paymentChannel' && (
            <div id="tab-panel-paymentChannel" role="tabpanel" aria-labelledby="tab-paymentChannel">
              {renderPlaceholder('Payment Channel', 'Configure and manage payout channels for platform billing.')}
            </div>
          )}
        </div>
      </section>

      <PortalModal
        open={isEditOpen}
        onClose={closeEdit}
        title="Edit Profile"
        description="Update profile details and save changes."
        size="lg"
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={closeEdit}
              className="inline-flex items-center justify-center rounded-xl border border-gray-100 bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4b74bf] focus-visible:ring-offset-2"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSaveProfile}
              className="inline-flex items-center justify-center rounded-xl border border-primary bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#233f7d] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4b74bf] focus-visible:ring-offset-2"
            >
              Save
            </button>
          </div>
        }
      >
        {profileSaveError && (
          <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {profileSaveError}
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-500">Full Name</label>
                    <input
                      ref={firstFieldRef}
                      type="text"
                      value={draft.fullName}
                      onChange={(event) => {
                        const next = { ...draft, fullName: event.target.value };
                        setDraft(next);
                        setDraftErrors((prev) => ({ ...prev, fullName: undefined }));
                      }}
                      className={`w-full rounded-lg border bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none transition-colors focus:border-[#4b74bf] ${
                        draftErrors.fullName ? 'border-rose-200' : 'border-gray-100'
                      }`}
                    />
                    {draftErrors.fullName && (
                      <p className="text-xs font-semibold text-rose-600">{draftErrors.fullName}</p>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-500">Phone Number</label>
                    <input
                      type="tel"
                      inputMode="tel"
                      value={draft.phoneNumber}
                      onChange={(event) => {
                        const raw = event.target.value;
                        const sanitized = raw.replace(/(?!^)\+/g, '').replace(/[^\d+]/g, '');
                        const next = { ...draft, phoneNumber: sanitized };
                        setDraft(next);
                        setDraftErrors((prev) => ({ ...prev, phoneNumber: undefined }));
                      }}
                      placeholder="+639123456789"
                      className={`w-full rounded-lg border bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none transition-colors focus:border-[#4b74bf] ${
                        draftErrors.phoneNumber ? 'border-rose-200' : 'border-gray-100'
                      }`}
                    />
                    {draftErrors.phoneNumber && (
                      <p className="text-xs font-semibold text-rose-600">{draftErrors.phoneNumber}</p>
                    )}
                  </div>

                  <div className="space-y-1 sm:col-span-2">
                    <label className="text-xs font-semibold text-gray-500">Email</label>
                    <input
                      type="email"
                      value={draft.email}
                      onChange={(event) => {
                        const next = { ...draft, email: event.target.value };
                        setDraft(next);
                        setDraftErrors((prev) => ({ ...prev, email: undefined }));
                      }}
                      className={`w-full rounded-lg border bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none transition-colors focus:border-[#4b74bf] ${
                        draftErrors.email ? 'border-rose-200' : 'border-gray-100'
                      }`}
                    />
                    {draftErrors.email && (
                      <p className="text-xs font-semibold text-rose-600">{draftErrors.email}</p>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-500">Role</label>
                    <select
                      value={draft.role}
                      onChange={(event) => {
                        const next = { ...draft, role: event.target.value as SuperAdminRole };
                        setDraft(next);
                      }}
                      className="w-full rounded-lg border border-gray-100 bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none transition-colors focus:border-[#4b74bf]"
                    >
                      <option value="Super Admin">Super Admin</option>
                      <option value="Admin">Admin</option>
                      <option value="Support">Support</option>
                      <option value="Sales">Sales</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-500">Location</label>
                    <input
                      type="text"
                      value={draft.location}
                      onChange={(event) => {
                        const next = { ...draft, location: event.target.value };
                        setDraft(next);
                        setDraftErrors((prev) => ({ ...prev, location: undefined }));
                      }}
                      className={`w-full rounded-lg border bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 outline-none transition-colors focus:border-[#4b74bf] ${
                        draftErrors.location ? 'border-rose-200' : 'border-gray-100'
                      }`}
                    />
                    {draftErrors.location && (
                      <p className="text-xs font-semibold text-rose-600">{draftErrors.location}</p>
                    )}
                  </div>
        </div>
      </PortalModal>
    </section>
  );
}
