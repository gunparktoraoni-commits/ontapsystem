"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ModalPortal } from "@/app/components/ModalPortal";
import { showToast } from "@/app/components/Toast";
import { showConfirmDialog } from "@/app/components/ConfirmDialog";
import { InlineLoader } from "@/app/components/Loader";
import {
  Bell,
  Building2,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  ImagePlus,
  Palette,
  RefreshCw,
  ScrollText,
  Shield,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  ADMIN_NOTIFICATION_OPTIONS,
  companyAdminApiRequest,
  buildAuthHeaders,
  ensureCsrfToken,
  extractErrorMessage,
  EMPLOYEE_NOTIFICATION_OPTIONS,
  type CompanyNotificationPolicy,
  type CompanyProfile,
} from "../../lib/companyAdminApi";
import { getFrontendApiBaseUrl } from "../../../components/apiBase";
import { toServableMediaSrc } from "@/app/lib/portfolioDisplay";
import { uploadCompanyLogoImage } from "@/app/lib/companyLogoUpload";
import CompanyThemePicker from "./CompanyThemePicker";
import CompanyActivityLogsPanel from "./CompanyActivityLogsPanel";
import { resolveThemeIdFromCompanyTheme } from "@/lib/constants/theme-families";
import { USER_SYNC_EVENT } from "@/app/lib/bizcardThemeSync";

type Tab = "details" | "theme" | "notifications" | "security" | "activity";

type Props = {
  isOpen: boolean;
  company: CompanyProfile | null;
  canEdit: boolean;
  isPrimaryAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
};

type TabMeta = {
  id: Tab;
  label: string;
  description: string;
  icon: LucideIcon;
};

const TAB_META: TabMeta[] = [
  {
    id: "details",
    label: "Company Details",
    description: "Profile, contact, visibility",
    icon: Building2,
  },
  {
    id: "theme",
    label: "Theme",
    description: "Portfolio theme for all members",
    icon: Palette,
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "Admin and employee alerts",
    icon: Bell,
  },
  {
    id: "security",
    label: "Security",
    description: "Join code management",
    icon: Shield,
  },
  {
    id: "activity",
    label: "Activity",
    description: "Audit trail and performance",
    icon: ScrollText,
  },
];

const DEFAULT_POLICY: CompanyNotificationPolicy = {
  join_request_enabled: true,
  company_details_changed_enabled: true,
  co_admin_changes_enabled: true,
  employee_management_enabled: true,
  daily_summary_enabled: true,
  weekly_summary_enabled: true,
  top_performer_alert_enabled: true,
  top_performer_alert_time: "17:00",
  employee_daily_statistics_enabled: true,
  employee_weekly_statistics_enabled: true,
  employee_top_performer_enabled: true,
  timezone: "UTC",
};

const inputClass =
  "mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-50 disabled:cursor-not-allowed focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30";

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isValidPhone(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^[\d\s+\-().]+$/.test(trimmed) && trimmed.replace(/\D/g, "").length >= 7;
}

function isValidLogoUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return /^https?:\/\/.{3,}/i.test(trimmed) && trimmed.length <= 512;
}

function SettingsToggle({
  enabled,
  onChange,
  label,
  subLabel,
  disabled = false,
}: {
  enabled: boolean;
  onChange: (value: boolean) => void;
  label: string;
  subLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-gray-100 bg-gray-50/80 p-4">
      <div className="min-w-0">
        <h4 className="text-sm font-medium text-gray-800">{label}</h4>
        <p className="mt-0.5 text-xs text-gray-500">{subLabel}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!enabled)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50 ${
          enabled ? "bg-primary" : "bg-gray-300"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h4 className="text-sm font-bold text-gray-900">{title}</h4>
        {description ? (
          <p className="mt-1 text-xs text-gray-500">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function TabContentHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mb-6">
      <h3 className="text-lg font-bold text-gray-900">{title}</h3>
      <p className="mt-1 text-sm text-gray-500">{description}</p>
    </div>
  );
}

function NotificationOptionRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors ${
        checked
          ? "border-primary/30 bg-primary/5"
          : "border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50/50"
      } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/30"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-gray-800">{label}</span>
        <span className="block text-xs text-gray-500">{description}</span>
      </span>
    </label>
  );
}

export default function CompanySettingsPanel({
  isOpen,
  company,
  canEdit,
  isPrimaryAdmin,
  onClose,
  onSaved,
}: Props) {
  const [tab, setTab] = useState<Tab>("details");
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoPreviewError, setLogoPreviewError] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [description, setDescription] = useState("");
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [pendingNameChange, setPendingNameChange] = useState<string | null>(null);
  const [securityCode, setSecurityCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [notificationPolicy, setNotificationPolicy] =
    useState<CompanyNotificationPolicy>(DEFAULT_POLICY);
  const [selectedThemeId, setSelectedThemeId] = useState("elegant-dark");
  const [themeSubscriptionTier, setThemeSubscriptionTier] = useState<string>("free");
  const [saving, setSaving] = useState(false);
  const [loadingPrefs, setLoadingPrefs] = useState(false);
  const [loadingTheme, setLoadingTheme] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [themeSavedModalOpen, setThemeSavedModalOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const visibleTabs = TAB_META.filter(
    (item) => item.id !== "activity" || isPrimaryAdmin,
  );
  const activeTabMeta = TAB_META.find((item) => item.id === tab) ?? TAB_META[0];

  useEffect(() => {
    if (!company || !isOpen) return;
    setCompanyName(company.company_name ?? "");
    setIndustry(company.industry ?? "");
    setEmail(company.email ?? "");
    setPhone(company.phone ?? "");
    setAddress(company.address ?? "");
    setLogoUrl(company.logo_url ?? "");
    setLogoPreviewError(false);
    setDescription(company.description ?? "");
    setApprovalRequired(Boolean(company.approval_required));
    setIsPublic(Boolean(company.is_public));
    setPendingNameChange(company.pending_name_change ?? null);
    setSecurityCode(company.security_code ?? "");
    setSelectedThemeId(resolveThemeIdFromCompanyTheme(company.company_theme));
    setFieldErrors({});
  }, [company, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    closeButtonRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) setThemeSavedModalOpen(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (themeSavedModalOpen) {
        setThemeSavedModalOpen(false);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, themeSavedModalOpen]);

  const loadNotificationPrefs = useCallback(async () => {
    setLoadingPrefs(true);
    try {
      const payload = (await companyAdminApiRequest(
        "/api/company/notifications/preferences/admin",
      )) as { data?: { policy?: CompanyNotificationPolicy } };
      const data = payload.data ?? payload;
      const policy = (data as { policy?: CompanyNotificationPolicy }).policy;
      if (policy) {
        setNotificationPolicy({ ...DEFAULT_POLICY, ...policy });
      }
    } catch {
      setNotificationPolicy(DEFAULT_POLICY);
    } finally {
      setLoadingPrefs(false);
    }
  }, []);

  const loadThemeData = useCallback(async () => {
    setLoadingTheme(true);
    try {
      const payload = (await companyAdminApiRequest("/api/company/theme")) as {
        data?: { current_theme_id?: string; subscription_tier?: string };
      };
      const data = payload.data ?? payload;
      const themeData = data as {
        current_theme_id?: string;
        subscription_tier?: string;
      };
      if (themeData.current_theme_id) setSelectedThemeId(themeData.current_theme_id);
      if (themeData.subscription_tier) setThemeSubscriptionTier(themeData.subscription_tier);
    } catch {
      // Keep company profile defaults
    } finally {
      setLoadingTheme(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (tab === "notifications") void loadNotificationPrefs();
    if (tab === "theme") void loadThemeData();
  }, [isOpen, tab, loadNotificationPrefs, loadThemeData]);

  const validateDetails = (): boolean => {
    const nextErrors: Record<string, string> = {};

    if (email.trim() && !isValidEmail(email)) {
      nextErrors.email = "Enter a valid company email.";
    }
    if (phone.trim() && !isValidPhone(phone)) {
      nextErrors.phone = "Enter a valid phone number.";
    }
    if (logoUrl.trim() && !isValidLogoUrl(logoUrl)) {
      nextErrors.logoUrl = "Logo URL must start with http:// or https://.";
    }
    if (description.length > 2000) {
      nextErrors.description = "Description must not exceed 2000 characters.";
    }
    if (industry.length > 100) {
      nextErrors.industry = "Industry must not exceed 100 characters.";
    }
    if (address.length > 500) {
      nextErrors.address = "Address must not exceed 500 characters.";
    }

    if (
      isPrimaryAdmin &&
      !pendingNameChange &&
      companyName.trim() &&
      companyName.trim() !== (company?.company_name ?? "").trim() &&
      companyName.trim().length > 255
    ) {
      nextErrors.companyName = "Company name must not exceed 255 characters.";
    }

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const saveDetails = async () => {
    if (!canEdit) return;
    if (!validateDetails()) return;

    setSaving(true);
    try {
      const trimmedName = companyName.trim();
      const originalName = (company?.company_name ?? "").trim();
      const nameChanged =
        isPrimaryAdmin &&
        !pendingNameChange &&
        trimmedName &&
        trimmedName !== originalName;

      if (nameChanged) {
        await companyAdminApiRequest("/api/company/name-change/request", {
          method: "POST",
          body: JSON.stringify({
            requested_name: trimmedName,
            reason: null,
          }),
        });
        setPendingNameChange(trimmedName);
        showToast(
          "Name change submitted for approval. Other details will be saved now.",
          "success",
        );
      }

      await companyAdminApiRequest("/api/company/settings", {
        method: "PUT",
        body: JSON.stringify({
          description: description.trim() || null,
          email: email.trim() || null,
          logo_url: logoUrl.trim() || null,
          industry: industry.trim() || null,
          phone: phone.trim() || null,
          address: address.trim() || null,
          approval_required: approvalRequired,
          is_public: isPublic,
        }),
      });

      if (!nameChanged) {
        showToast("Company settings saved.", "success");
      }
      onSaved();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to save settings.", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleLogoFileSelected = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    // Reset the input so selecting the same file again re-triggers change.
    event.target.value = "";
    if (!file || !canEdit) return;

    setLogoUploading(true);
    try {
      const headers = new Headers(buildAuthHeaders());
      const csrfToken = await ensureCsrfToken();
      if (csrfToken) headers.set("X-CSRF-Token", csrfToken);

      const uploadedUrl = await uploadCompanyLogoImage(file, {
        apiBaseUrl: getFrontendApiBaseUrl(),
        headers,
      });

      setLogoUrl(uploadedUrl);
      setLogoPreviewError(false);
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next.logoUrl;
        return next;
      });
      showToast("Logo uploaded. Save to apply the change.", "success");
    } catch (error) {
      showToast(
        error instanceof Error
          ? extractErrorMessage({ error: error.message }, error.message)
          : "Failed to upload company logo.",
        "error",
      );
    } finally {
      setLogoUploading(false);
    }
  };

  const saveNotifications = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      await companyAdminApiRequest("/api/company/notifications/preferences/admin", {
        method: "PUT",
        body: JSON.stringify(notificationPolicy),
      });
      showToast("Notification preferences saved.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to save notifications.", "error");
    } finally {
      setSaving(false);
    }
  };

  const saveTheme = async () => {
    if (!canEdit || !isPrimaryAdmin) {
      showToast("Only the primary company admin can update the company theme.", "error");
      return;
    }

    setSaving(true);
    try {
      await companyAdminApiRequest("/api/company/theme", {
        method: "PUT",
        body: JSON.stringify({ company_theme: selectedThemeId }),
      });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(USER_SYNC_EVENT));
      }
      onSaved();
      setThemeSavedModalOpen(true);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to save theme.", "error");
    } finally {
      setSaving(false);
    }
  };

  const randomizeCode = async () => {
    if (!canEdit) {
      showToast("You do not have permission to change the company join code.", "error");
      return;
    }
    const confirmed = await showConfirmDialog({
      title: "Generate a new join code?",
      message:
        "This will create a new company join code. The current code will stop working, so share the new code with your team after updating.",
      confirmLabel: "Generate new code",
      variant: "warning",
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      const payload = (await companyAdminApiRequest(
        "/api/company/security/randomize-code",
        { method: "POST" },
      )) as { data?: { security_code?: string } };
      const code = payload.data?.security_code;
      if (code) setSecurityCode(code);
      showToast("Security code updated.", "success");
      onSaved();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to update security code.", "error");
    } finally {
      setSaving(false);
    }
  };

  const copySecurityCode = async () => {
    if (!securityCode.trim()) {
      showToast("No join code available to copy.", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(securityCode);
      showToast("Join code copied to clipboard.", "success");
    } catch {
      showToast("Unable to copy join code.", "error");
    }
  };

  const nameFieldDisabled =
    !canEdit || !isPrimaryAdmin || Boolean(pendingNameChange);

  const showLogoPreview =
    logoUrl.trim() && isValidLogoUrl(logoUrl) && !logoPreviewError;

  const handleFooterPrimary = () => {
    if (tab === "details") void saveDetails();
    else if (tab === "theme") void saveTheme();
    else if (tab === "notifications") void saveNotifications();
    else if (tab === "security") void randomizeCode();
  };

  const footerPrimaryLabel =
    tab === "details"
      ? "Save Details"
      : tab === "theme"
        ? "Save Theme"
        : tab === "notifications"
          ? "Save Notifications"
          : tab === "security"
            ? "Randomize Join Code"
            : null;

  const footerPrimaryDisabled =
    !canEdit ||
    saving ||
    tab === "activity" ||
    (tab === "details" && !canEdit) ||
    (tab === "theme" && !isPrimaryAdmin);

  const footerPrimarySecondary = tab === "security";

  return (
    <>
    <ModalPortal isOpen={isOpen} onClose={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="company-settings-title"
        className="flex w-full max-w-6xl max-h-[92vh] flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-4 sm:px-6">
          <div>
            <h2 id="company-settings-title" className="text-lg font-bold text-gray-900">
              Company Settings
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {company?.company_name ?? "Manage your organization"}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close company settings"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body: sidebar + content */}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Mobile nav */}
          <div className="shrink-0 border-b border-gray-100 md:hidden">
            <div className="flex gap-2 overflow-x-auto px-4 py-3 scrollbar-thin">
              {visibleTabs.map((item) => {
                const Icon = item.icon;
                const isActive = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "bg-gray-50 text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Desktop sidebar */}
          <aside className="hidden w-[260px] shrink-0 border-r border-gray-100 bg-gray-50/50 md:block">
            <nav className="space-y-1 p-4">
              {visibleTabs.map((item) => {
                const Icon = item.icon;
                const isActive = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors ${
                      isActive
                        ? "border border-primary/20 bg-primary/5 text-primary shadow-sm"
                        : "border border-transparent text-gray-600 hover:bg-white hover:text-gray-900"
                    }`}
                  >
                    <Icon
                      className={`mt-0.5 h-4 w-4 shrink-0 ${isActive ? "text-primary" : "text-gray-400"}`}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{item.label}</span>
                      <span
                        className={`block text-xs ${isActive ? "text-primary/70" : "text-gray-400"}`}
                      >
                        {item.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Content */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex-1 overflow-y-auto p-5 sm:p-6">
              {!canEdit && tab !== "activity" && (
                <p className="mb-5 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  You do not have permission to edit company settings.
                </p>
              )}

              <AnimatePresence mode="wait">
                <motion.div
                  key={tab}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.15 }}
                >
                  {tab === "details" && (
                    <div className="space-y-5">
                      <TabContentHeader
                        title={activeTabMeta.label}
                        description="Update your company profile, contact details, and membership settings."
                      />

                      {pendingNameChange && (
                        <p className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                          Name change to &quot;{pendingNameChange}&quot; is pending superadmin
                          approval.
                        </p>
                      )}

                      <SectionCard
                        title="Company Identity"
                        description="Basic information about your organization."
                      >
                        <div className="space-y-4">
                          <div>
                            <label className="text-sm font-medium text-gray-700">
                              Company name
                            </label>
                            <input
                              type="text"
                              value={companyName}
                              onChange={(e) => setCompanyName(e.target.value)}
                              disabled={nameFieldDisabled}
                              placeholder="e.g. Acme Corporation"
                              className={inputClass}
                            />
                            {!isPrimaryAdmin && (
                              <p className="mt-1 text-xs text-gray-500">
                                Only the primary administrator can request a company name change.
                              </p>
                            )}
                            {isPrimaryAdmin && !pendingNameChange && (
                              <p className="mt-1 text-xs text-gray-500">
                                Name changes require superadmin approval and are subject to a
                                90-day cooldown.
                              </p>
                            )}
                            {fieldErrors.companyName && (
                              <p className="mt-1 text-xs text-rose-600">
                                {fieldErrors.companyName}
                              </p>
                            )}
                          </div>

                          <div>
                            <label className="text-sm font-medium text-gray-700">Industry</label>
                            <input
                              type="text"
                              value={industry}
                              onChange={(e) => setIndustry(e.target.value)}
                              disabled={!canEdit}
                              placeholder="e.g. Technology"
                              className={inputClass}
                            />
                            {fieldErrors.industry && (
                              <p className="mt-1 text-xs text-rose-600">{fieldErrors.industry}</p>
                            )}
                          </div>

                          <div>
                            <label className="text-sm font-medium text-gray-700">
                              Description
                            </label>
                            <textarea
                              value={description}
                              onChange={(e) => setDescription(e.target.value)}
                              disabled={!canEdit}
                              rows={4}
                              placeholder="Brief overview of your company..."
                              className={inputClass}
                            />
                            {fieldErrors.description && (
                              <p className="mt-1 text-xs text-rose-600">
                                {fieldErrors.description}
                              </p>
                            )}
                          </div>
                        </div>
                      </SectionCard>

                      <SectionCard
                        title="Contact Information"
                        description="How members and clients can reach your company."
                      >
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                          <div>
                            <label className="text-sm font-medium text-gray-700">
                              Company email
                            </label>
                            <input
                              type="email"
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              disabled={!canEdit}
                              placeholder="hello@acme.com"
                              className={inputClass}
                            />
                            {fieldErrors.email && (
                              <p className="mt-1 text-xs text-rose-600">{fieldErrors.email}</p>
                            )}
                          </div>
                          <div>
                            <label className="text-sm font-medium text-gray-700">Phone</label>
                            <input
                              type="tel"
                              value={phone}
                              onChange={(e) => setPhone(e.target.value)}
                              disabled={!canEdit}
                              placeholder="+1 555 123 4567"
                              className={inputClass}
                            />
                            {fieldErrors.phone && (
                              <p className="mt-1 text-xs text-rose-600">{fieldErrors.phone}</p>
                            )}
                          </div>
                          <div className="lg:col-span-2">
                            <label className="text-sm font-medium text-gray-700">Address</label>
                            <input
                              type="text"
                              value={address}
                              onChange={(e) => setAddress(e.target.value)}
                              disabled={!canEdit}
                              placeholder="123 Main St, City, Country"
                              className={inputClass}
                            />
                            {fieldErrors.address && (
                              <p className="mt-1 text-xs text-rose-600">{fieldErrors.address}</p>
                            )}
                          </div>
                        </div>
                      </SectionCard>

                      <SectionCard
                        title="Branding"
                        description="Company profile image shown across your company profile. Upload an image or paste an image URL."
                      >
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                          <div className="flex-1 min-w-0">
                            <label className="text-sm font-medium text-gray-700">Company profile image</label>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => logoInputRef.current?.click()}
                                disabled={!canEdit || logoUploading}
                                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {logoUploading ? (
                                  <>
                                    <InlineLoader />
                                    Uploading…
                                  </>
                                ) : (
                                  <>
                                    <ImagePlus className="h-4 w-4" />
                                    {logoUrl.trim() ? "Replace image" : "Upload image"}
                                  </>
                                )}
                              </button>
                              {logoUrl.trim() && !logoUploading && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setLogoUrl("");
                                    setLogoPreviewError(false);
                                  }}
                                  disabled={!canEdit}
                                  className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  <X className="h-4 w-4" />
                                  Remove
                                </button>
                              )}
                            </div>
                            <input
                              ref={logoInputRef}
                              type="file"
                              accept="image/png,image/jpeg,image/webp,image/svg+xml"
                              className="hidden"
                              onChange={(e) => void handleLogoFileSelected(e)}
                            />
                            <label className="mt-3 block text-xs font-medium text-gray-500">Or paste an image URL</label>
                            <input
                              type="url"
                              value={logoUrl}
                              onChange={(e) => {
                                setLogoUrl(e.target.value);
                                setLogoPreviewError(false);
                              }}
                              disabled={!canEdit || logoUploading}
                              placeholder="https://example.com/logo.png"
                              className={inputClass}
                            />
                            {fieldErrors.logoUrl && (
                              <p className="mt-1 text-xs text-rose-600">{fieldErrors.logoUrl}</p>
                            )}
                          </div>
                          <div className="flex shrink-0 flex-col items-center gap-2">
                            <span className="text-xs font-medium text-gray-500">Preview</span>
                            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                              {showLogoPreview ? (
                                <img
                                  src={toServableMediaSrc(logoUrl.trim())}
                                  alt="Company logo preview"
                                  className="h-full w-full object-contain"
                                  onError={() => setLogoPreviewError(true)}
                                />
                              ) : (
                                <Building2 className="h-8 w-8 text-gray-300" />
                              )}
                            </div>
                          </div>
                        </div>
                      </SectionCard>

                      <SectionCard
                        title="Membership Settings"
                        description="Control how employees join and discover your company."
                      >
                        <div className="space-y-3">
                          <SettingsToggle
                            enabled={approvalRequired}
                            onChange={setApprovalRequired}
                            disabled={!canEdit}
                            label="Require approval for join requests"
                            subLabel="New join requests must be approved by an administrator."
                          />
                          <SettingsToggle
                            enabled={isPublic}
                            onChange={setIsPublic}
                            disabled={!canEdit}
                            label="Public company profile"
                            subLabel="Allow your company to appear in public search results."
                          />
                        </div>
                      </SectionCard>
                    </div>
                  )}

                  {tab === "theme" && (
                    <div className="space-y-5">
                      <TabContentHeader
                        title={activeTabMeta.label}
                        description={`Choose a portfolio theme for all active members. Availability is based on the primary admin subscription tier (${themeSubscriptionTier}).`}
                      />
                      {!isPrimaryAdmin ? (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                          Only the primary company admin can change the company theme.
                        </div>
                      ) : null}
                      {loadingTheme ? (
                        <div className="flex justify-center py-12">
                          <InlineLoader />
                        </div>
                      ) : (
                        <CompanyThemePicker
                          selectedThemeId={selectedThemeId}
                          subscriptionTier={themeSubscriptionTier}
                          onSelect={setSelectedThemeId}
                          disabled={!canEdit || !isPrimaryAdmin}
                          companyName={company?.company_name ?? companyName}
                        />
                      )}
                    </div>
                  )}

                  {tab === "notifications" && (
                    <div className="space-y-5">
                      <TabContentHeader
                        title={activeTabMeta.label}
                        description="Configure alerts for administrators and employees across your organization."
                      />
                      {loadingPrefs ? (
                        <div className="flex justify-center py-12">
                          <InlineLoader />
                        </div>
                      ) : (
                        <>
                          <SectionCard title="Administrators & Co-Admins">
                            <div className="mb-3 flex items-center gap-2 text-xs text-gray-500">
                              <Shield className="h-3.5 w-3.5" />
                              Alerts sent to primary admin and co-admins.
                            </div>
                            <div className="space-y-2">
                              {ADMIN_NOTIFICATION_OPTIONS.map((option) => (
                                <NotificationOptionRow
                                  key={option.key}
                                  label={option.label}
                                  description={option.description}
                                  checked={Boolean(notificationPolicy[option.key])}
                                  disabled={!canEdit}
                                  onChange={(checked) =>
                                    setNotificationPolicy((prev) => ({
                                      ...prev,
                                      [option.key]: checked,
                                    }))
                                  }
                                />
                              ))}
                            </div>
                          </SectionCard>

                          <SectionCard title="Employees & Other Roles">
                            <div className="mb-3 flex items-center gap-2 text-xs text-gray-500">
                              <Users className="h-3.5 w-3.5" />
                              Notifications sent to employees, managers, and viewers.
                            </div>
                            <div className="space-y-2">
                              {EMPLOYEE_NOTIFICATION_OPTIONS.map((option) => (
                                <NotificationOptionRow
                                  key={option.key}
                                  label={option.label}
                                  description={option.description}
                                  checked={Boolean(notificationPolicy[option.key])}
                                  disabled={!canEdit}
                                  onChange={(checked) =>
                                    setNotificationPolicy((prev) => ({
                                      ...prev,
                                      [option.key]: checked,
                                    }))
                                  }
                                />
                              ))}
                            </div>
                          </SectionCard>

                          {(notificationPolicy.top_performer_alert_enabled ||
                            notificationPolicy.daily_summary_enabled) && (
                            <SectionCard
                              title="Schedule"
                              description="Configure when automated summary alerts are sent."
                            >
                              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <div>
                                  <label className="text-sm font-medium text-gray-700">
                                    Top performer alert time
                                  </label>
                                  <input
                                    type="time"
                                    value={notificationPolicy.top_performer_alert_time}
                                    onChange={(e) =>
                                      setNotificationPolicy((prev) => ({
                                        ...prev,
                                        top_performer_alert_time: e.target.value,
                                      }))
                                    }
                                    disabled={!canEdit}
                                    className={inputClass}
                                  />
                                </div>
                                <div>
                                  <label className="text-sm font-medium text-gray-700">
                                    Timezone
                                  </label>
                                  <input
                                    type="text"
                                    value={notificationPolicy.timezone}
                                    onChange={(e) =>
                                      setNotificationPolicy((prev) => ({
                                        ...prev,
                                        timezone: e.target.value,
                                      }))
                                    }
                                    disabled={!canEdit}
                                    placeholder="UTC"
                                    className={inputClass}
                                  />
                                </div>
                              </div>
                            </SectionCard>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {tab === "security" && (
                    <div className="space-y-5">
                      <TabContentHeader
                        title={activeTabMeta.label}
                        description="Manage the join code employees use to connect with your company."
                      />

                      <SectionCard title="Company Join Code">
                        <p className="mb-4 text-xs text-gray-500">
                          Share this code with employees who want to join your organization. Keep it
                          confidential to prevent unauthorized access.
                        </p>
                        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                            <input
                              readOnly
                              type={showCode ? "text" : "password"}
                              value={securityCode}
                              aria-label="Company join code"
                              className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm font-mono tracking-wider"
                            />
                            <div className="flex shrink-0 gap-2">
                              <button
                                type="button"
                                onClick={() => setShowCode((v) => !v)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                              >
                                {showCode ? (
                                  <EyeOff className="h-4 w-4" />
                                ) : (
                                  <Eye className="h-4 w-4" />
                                )}
                                {showCode ? "Hide" : "Show"}
                              </button>
                              <button
                                type="button"
                                onClick={() => void copySecurityCode()}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                              >
                                <Copy className="h-4 w-4" />
                                Copy
                              </button>
                            </div>
                          </div>
                        </div>
                      </SectionCard>

                      <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                        <p className="font-semibold">Before randomizing</p>
                        <p className="mt-1 text-xs text-amber-800">
                          Generating a new join code immediately invalidates the current one. Any
                          pending invitations using the old code will no longer work.
                        </p>
                      </div>
                    </div>
                  )}

                  {tab === "activity" && isPrimaryAdmin && (
                    <div className="space-y-5">
                      <TabContentHeader
                        title={activeTabMeta.label}
                        description="Review audit events and team performance across your organization."
                      />
                      <CompanyActivityLogsPanel />
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Sticky footer */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-100 bg-gray-50/80 px-5 py-4 sm:px-6">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
              >
                Cancel
              </button>
              {footerPrimaryLabel ? (
                <button
                  type="button"
                  onClick={handleFooterPrimary}
                  disabled={footerPrimaryDisabled}
                  className={`inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    footerPrimarySecondary
                      ? "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                      : "bg-primary text-white hover:brightness-110"
                  }`}
                >
                  {saving ? (
                    <InlineLoader />
                  ) : footerPrimarySecondary ? (
                    <RefreshCw className="h-4 w-4" />
                  ) : null}
                  {footerPrimaryLabel}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </ModalPortal>

    <ModalPortal
      isOpen={themeSavedModalOpen}
      onClose={() => setThemeSavedModalOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="theme-saved-title"
        className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h3 id="theme-saved-title" className="text-lg font-bold text-gray-900">
                Theme saved successfully
              </h3>
              <p className="mt-1.5 text-sm text-gray-600">
                The selected theme has been applied to all active company member BizCards.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setThemeSavedModalOpen(false)}
            aria-label="Close theme saved dialog"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={() => setThemeSavedModalOpen(false)}
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:brightness-110"
          >
            Close
          </button>
        </div>
      </div>
    </ModalPortal>
    </>
  );
}
