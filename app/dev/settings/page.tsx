"use client";

import React, { useEffect, useRef, useState } from "react";
import { User, Bell, Shield, Monitor, Save, Eye, EyeOff, Camera } from "lucide-react";
import {  InlineLoader, SectionLoader } from "@/app/components/Loader";
import { showToast } from "@/app/components/Toast";
import { devApiFetch, devApiJson } from "@/app/dev/lib/devApi";
import { ProfileImageCropModal } from "@/app/components/ProfileImageCropModal";

const APPEARANCE_KEY = "ontap.dev.appearance";
const MAX_PROFILE_UPLOAD_BYTES = Math.floor(4.5 * 1024 * 1024);

type Tab = "profile" | "notifications" | "security" | "appearance";

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
        <span
          className="inline-block h-4 w-1 rounded-full shrink-0"
          style={{ background: "linear-gradient(180deg,#2A4792,#4785B8)" }}
        />
        <h2 className="text-sm font-semibold text-gray-800 tracking-wide uppercase">{title}</h2>
      </div>
      <div className="px-5 py-5 space-y-5">{children}</div>
    </div>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      {children}
      {hint ? <p className="text-xs text-gray-400">{hint}</p> : null}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {description ? <p className="text-xs text-gray-400 mt-0.5">{description}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#2A4792]/30 ${
          checked ? "bg-[#2A4792]" : "bg-gray-200"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 mt-0.5 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function ProfileTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [role, setRole] = useState("Developer");
  const [profileImage, setProfileImage] = useState("");
  const [profileCropFile, setProfileCropFile] = useState<File | null>(null);
  const [profileImageError, setProfileImageError] = useState<string | null>(null);
  const profileImageInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await devApiJson<Record<string, unknown>>("/api/superadmin/settings/profile", {
          method: "GET",
        });
        if (!result.ok || !result.data) throw new Error(result.error ?? "Failed to load profile");
        const data = result.data;
        if (cancelled) return;
        setFirstName(String(data.first_name ?? ""));
        setLastName(String(data.last_name ?? ""));
        setEmail(String(data.email ?? ""));
        setPhone(String(data.phone ?? ""));
        setLocation(String(data.location ?? ""));
        setRole(String(data.role ?? "dev"));
        setProfileImage(String(data.profile_image ?? data.profile_url ?? ""));
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Failed to load profile", "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSave = async () => {
    setSaving(true);
    try {
      const result = await devApiJson("/api/superadmin/settings/profile", {
        method: "PUT",
        body: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          location: location.trim(),
        },
      });
      if (!result.ok) throw new Error(result.error ?? "Failed to save profile");
      showToast("Profile updated", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to save profile", "error");
    } finally {
      setSaving(false);
    }
  };

  const uploadProfileImage = async (file: File) => {
    setProfileImageError(null);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("context", "profile");
    const uploadResponse = await devApiFetch("/api/media/upload", {
      method: "POST",
      body: formData,
    });
    const uploadPayload = await uploadResponse.json().catch(() => null);
    const imageUrl = typeof uploadPayload?.url === "string" ? uploadPayload.url.trim() : "";
    if (!uploadResponse.ok || !imageUrl) {
      throw new Error(uploadPayload?.error || "Unable to upload profile photo.");
    }

    const saveResult = await devApiJson("/api/superadmin/settings/profile", {
      method: "PUT",
      body: { profile_image: imageUrl },
    });
    if (!saveResult.ok) {
      throw new Error(saveResult.error ?? "Photo uploaded but profile could not be updated.");
    }
    setProfileImage(imageUrl);
    showToast("Profile photo updated", "success");
  };

  if (loading) {
    return (
      <SectionCard title="Profile Information">
        <div className="flex justify-center py-8">
          <InlineLoader />
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Profile Information">
      <ProfileImageCropModal
        file={profileCropFile}
        title="Crop Developer Photo"
        onClose={() => setProfileCropFile(null)}
        onApply={uploadProfileImage}
      />
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-[#EEF2FA] text-lg font-semibold text-[#2A4792] ring-2 ring-white shadow-sm">
          {profileImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profileImage} alt="Developer profile" className="h-full w-full object-cover" />
          ) : (
            `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase() || "DV"
          )}
        </div>
        <div>
          <button
            type="button"
            onClick={() => profileImageInputRef.current?.click()}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
          >
            <Camera className="h-4 w-4" /> Change profile photo
          </button>
          <input
            ref={profileImageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
                setProfileImageError("Choose a JPG, PNG, or WEBP image.");
                return;
              }
              if (file.size > MAX_PROFILE_UPLOAD_BYTES) {
                setProfileImageError("Profile photo must be 4.5 MB or smaller.");
                return;
              }
              setProfileImageError(null);
              setProfileCropFile(file);
            }}
          />
          <p className="mt-1 text-xs text-gray-400">JPG, PNG, or WEBP up to 4.5 MB. Crop before saving.</p>
          {profileImageError && <p className="mt-1 text-xs text-red-600" role="alert">{profileImageError}</p>}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Field label="First Name">
          <input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:border-[#2A4792]/40 focus:outline-none focus:ring-2 focus:ring-[#2A4792]/20"
          />
        </Field>
        <Field label="Last Name">
          <input
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:border-[#2A4792]/40 focus:outline-none focus:ring-2 focus:ring-[#2A4792]/20"
          />
        </Field>
        <Field label="Email Address">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:border-[#2A4792]/40 focus:outline-none focus:ring-2 focus:ring-[#2A4792]/20"
          />
        </Field>
        <Field label="Phone Number">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:border-[#2A4792]/40 focus:outline-none focus:ring-2 focus:ring-[#2A4792]/20"
          />
        </Field>
        <Field label="Location">
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:border-[#2A4792]/40 focus:outline-none focus:ring-2 focus:ring-[#2A4792]/20"
          />
        </Field>
        <Field label="Role" hint="Managed by account permissions.">
          <input
            type="text"
            value={role}
            disabled
            className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500"
          />
        </Field>
      </div>
      <div className="pt-2 flex justify-end">
        <button
          type="button"
          disabled={saving}
          onClick={() => void onSave()}
          className="inline-flex items-center gap-2 rounded-lg bg-[#2A4792] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1e3578] disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </SectionCard>
  );
}

function NotificationsTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [errorAlerts, setErrorAlerts] = useState(true);
  const [concernAlerts, setConcernAlerts] = useState(true);
  const [weeklyDigest, setWeeklyDigest] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await devApiJson<Record<string, unknown>>(
          "/api/superadmin/settings/notifications",
          { method: "GET" },
        );
        if (!result.ok || !result.data) {
          throw new Error(result.error ?? "Failed to load notification preferences");
        }
        const data = result.data as Record<string, any>;
        if (cancelled) return;
        setEmailAlerts(Boolean(data.user_activity?.new_registration ?? true));
        setErrorAlerts(Boolean(data.system_health?.high_error_rates ?? true));
        setConcernAlerts(Boolean(data.user_activity?.company_requests ?? true));
        setWeeklyDigest(
          String(data.system_health?.system_health_report_frequency ?? "weekly") === "weekly",
        );
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Failed to load preferences", "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSave = async () => {
    setSaving(true);
    try {
      const result = await devApiJson("/api/superadmin/settings/notifications", {
        method: "PUT",
        body: {
          user_activity: {
            new_registration: emailAlerts,
            company_requests: concernAlerts,
          },
          system_health: {
            high_error_rates: errorAlerts,
            system_health_report_frequency: weeklyDigest ? "weekly" : "monthly",
          },
        },
      });
      if (!result.ok) throw new Error(result.error ?? "Failed to save preferences");
      showToast("Notification preferences saved", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to save preferences", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SectionCard title="Notification Preferences">
        <div className="flex justify-center py-8">
          <InlineLoader />
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Notification Preferences">
      <div className="space-y-5">
        <Toggle
          checked={emailAlerts}
          onChange={setEmailAlerts}
          label="Email Notifications"
          description="Receive important alerts via email."
        />
        <Toggle
          checked={errorAlerts}
          onChange={setErrorAlerts}
          label="System Error Alerts"
          description="Get notified when a critical or high severity error is logged."
        />
        <Toggle
          checked={concernAlerts}
          onChange={setConcernAlerts}
          label="New Concern Submitted"
          description="Get notified when a new user concern is raised."
        />
        <Toggle
          checked={weeklyDigest}
          onChange={setWeeklyDigest}
          label="Weekly Summary Digest"
          description="A weekly email summarising concerns, errors, and client activity."
        />
      </div>
      <div className="pt-2 flex justify-end">
        <button
          type="button"
          disabled={saving}
          onClick={() => void onSave()}
          className="inline-flex items-center gap-2 rounded-lg bg-[#2A4792] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1e3578] disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {saving ? "Saving…" : "Save Preferences"}
        </button>
      </div>
    </SectionCard>
  );
}

function SecurityTab() {
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [twoFactor, setTwoFactor] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await devApiJson<Record<string, unknown>>("/api/superadmin/settings/security", {
          method: "GET",
        });
        if (!result.ok || !result.data) return;
        if (cancelled) return;
        const data = result.data;
        setTwoFactor(Boolean(data.two_factor_enabled ?? data.twoFactorEnabled));
      } catch {
        // optional
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const onUpdatePassword = async () => {
    if (!currentPw || !newPw || newPw !== confirmPw) {
      showToast("Check password fields and try again", "error");
      return;
    }
    setSaving(true);
    try {
      const result = await devApiJson("/api/superadmin/settings/change-password", {
        method: "POST",
        body: {
          current_password: currentPw,
          new_password: newPw,
          confirm_password: confirmPw,
        },
      });
      if (!result.ok) throw new Error(result.error ?? "Failed to update password");
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      showToast("Password updated", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to update password", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionCard title="Change Password">
        <Field label="Current Password">
          <input
            type="password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            placeholder="Enter current password"
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:border-[#2A4792]/40 focus:outline-none focus:ring-2 focus:ring-[#2A4792]/20"
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field label="New Password">
            <div className="relative">
              <input
                type={showNew ? "text" : "password"}
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="New password"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 pr-9 text-sm text-gray-700 focus:border-[#2A4792]/40 focus:outline-none focus:ring-2 focus:ring-[#2A4792]/20"
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label={showNew ? "Hide password" : "Show password"}
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
          <Field label="Confirm New Password">
            <div className="relative">
              <input
                type={showConfirm ? "text" : "password"}
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                placeholder="Confirm password"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 pr-9 text-sm text-gray-700 focus:border-[#2A4792]/40 focus:outline-none focus:ring-2 focus:ring-[#2A4792]/20"
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label={showConfirm ? "Hide password" : "Show password"}
              >
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
        </div>
        <div className="pt-2 flex justify-end">
          <button
            type="button"
            disabled={saving}
            onClick={() => void onUpdatePassword()}
            className="inline-flex items-center gap-2 rounded-lg bg-[#2A4792] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1e3578] disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? "Updating…" : "Update Password"}
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Security Options">
        <Toggle
          checked={twoFactor}
          onChange={() => {
            showToast("Manage 2FA from the security API flows in Settings → Security", "info");
          }}
          label="Two-Factor Authentication"
          description={
            twoFactor
              ? "2FA is currently enabled on your account."
              : "Add an extra layer of protection to your account."
          }
        />
      </SectionCard>
    </div>
  );
}

function AppearanceTab() {
  const [compactMode, setCompactMode] = useState(false);
  const [animations, setAnimations] = useState(true);
  const [stickyHeader, setStickyHeader] = useState(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(APPEARANCE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      setCompactMode(Boolean(parsed.compactMode));
      setAnimations(parsed.animations !== false);
      setStickyHeader(parsed.stickyHeader !== false);
    } catch {
      // ignore
    }
  }, []);

  const onSave = () => {
    localStorage.setItem(
      APPEARANCE_KEY,
      JSON.stringify({ compactMode, animations, stickyHeader }),
    );
    showToast("Appearance preferences saved on this device", "success");
  };

  return (
    <SectionCard title="Appearance & Display">
      <Toggle
        checked={compactMode}
        onChange={setCompactMode}
        label="Compact Mode"
        description="Reduce padding and spacing across the Developer Portal UI."
      />
      <Toggle
        checked={animations}
        onChange={setAnimations}
        label="Enable Animations"
        description="Show page transition animations and interactive motion effects."
      />
      <Toggle
        checked={stickyHeader}
        onChange={setStickyHeader}
        label="Sticky Header"
        description="Keep the top navigation bar fixed when scrolling."
      />
      <div className="pt-2 flex justify-end">
        <button
          type="button"
          onClick={onSave}
          className="inline-flex items-center gap-2 rounded-lg bg-[#2A4792] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1e3578]"
        >
          <Save className="h-4 w-4" />
          Save Appearance
        </button>
      </div>
    </SectionCard>
  );
}

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "profile", label: "Profile", icon: User },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "security", label: "Security", icon: Shield },
  { key: "appearance", label: "Appearance", icon: Monitor },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("profile");

  return (
    <div className="space-y-6">
      <div className="flex gap-1 rounded-xl bg-white border border-gray-100 shadow-sm p-1 overflow-x-auto">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === key
                ? "bg-[#2A4792] text-white shadow-sm"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </button>
        ))}
      </div>

      {activeTab === "profile" && <ProfileTab />}
      {activeTab === "notifications" && <NotificationsTab />}
      {activeTab === "security" && <SecurityTab />}
      {activeTab === "appearance" && <AppearanceTab />}
    </div>
  );
}
