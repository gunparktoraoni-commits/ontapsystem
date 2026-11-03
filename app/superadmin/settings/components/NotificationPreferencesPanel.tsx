"use client";

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';
import { getFrontendApiBaseUrl } from '@/app/components/apiBase';

type NotificationTabId =
  | 'userActivity'
  | 'security'
  | 'staffActivityAlerts'
  | 'systemHealthPerformance'
  | 'affiliateProgram';

type StandardFrequency = 'Daily' | 'Weekly' | 'Bi-Weekly' | 'Monthly';
type AffiliateFrequency = 'Daily' | 'Bi-Weekly' | 'Monthly';

interface UserActivityPreferences {
  newUserRegistration: boolean;
  userReportSummaryEnabled: boolean;
  userReportSummaryFrequency: StandardFrequency;
  inactiveUsers: boolean;
  companyCreationRequests: boolean;
}

interface SecurityPreferences {
  multipleUserSignupsDifferentDevices: boolean;
  securityReportSummaryEnabled: boolean;
  securityReportSummaryFrequency: StandardFrequency;
  staffLoginsDifferentDevices: boolean;
  accountLockout: boolean;
}

interface StaffActivityAlertsPreferences {
  companyChangesViaImpersonate: boolean;
  userRecordModificationDeletion: boolean;
  staffActivityReportSummaryEnabled: boolean;
  staffActivityReportSummaryFrequency: StandardFrequency;
  forgotPasswordSessions: boolean;
}

interface SystemHealthPerformancePreferences {
  serverDowntime: boolean;
  pageLoad: boolean;
  highErrorRates: boolean;
  failedCronJobs: boolean;
  systemHealthPerformanceReportSummaryEnabled: boolean;
  systemHealthPerformanceReportSummaryFrequency: StandardFrequency;
}

interface AffiliateProgramPreferences {
  payoutAlerts: boolean;
  mostUsedReferralCodes: boolean;
  affiliateReportSummaryEnabled: boolean;
  affiliateReportSummaryFrequency: AffiliateFrequency;
}

interface NotificationPreferencesState {
  userActivity: UserActivityPreferences;
  security: SecurityPreferences;
  staffActivityAlerts: StaffActivityAlertsPreferences;
  systemHealthPerformance: SystemHealthPerformancePreferences;
  affiliateProgram: AffiliateProgramPreferences;
}

interface NotificationTabDefinition {
  id: NotificationTabId;
  label: string;
  subtitle: string;
}

function getSettingsApiBase(): string {
  return getFrontendApiBaseUrl();
}

const STANDARD_FREQUENCIES = ['Daily', 'Weekly', 'Bi-Weekly', 'Monthly'] as const;
const AFFILIATE_FREQUENCIES = ['Daily', 'Bi-Weekly', 'Monthly'] as const;

const NOTIFICATION_TABS: NotificationTabDefinition[] = [
  {
    id: 'userActivity',
    label: 'User Activity',
    subtitle: 'Monitor onboarding and engagement notifications for users and companies.',
  },
  {
    id: 'security',
    label: 'Security',
    subtitle: 'Track suspicious behavior, lockouts, and security summary reports.',
  },
  {
    id: 'staffActivityAlerts',
    label: 'Staff Activity Alerts',
    subtitle: 'Follow high-impact staff actions and impersonation-based activity.',
  },
  {
    id: 'systemHealthPerformance',
    label: 'System Health and Performance',
    subtitle: 'Receive platform reliability and performance incident notifications.',
  },
  {
    id: 'affiliateProgram',
    label: 'Affiliate Program',
    subtitle: 'Manage payout and referral reporting notifications for affiliates.',
  },
];

const DEFAULT_PREFERENCES: NotificationPreferencesState = {
  userActivity: {
    newUserRegistration: false,
    userReportSummaryEnabled: false,
    userReportSummaryFrequency: 'Weekly',
    inactiveUsers: false,
    companyCreationRequests: false,
  },
  security: {
    multipleUserSignupsDifferentDevices: false,
    securityReportSummaryEnabled: false,
    securityReportSummaryFrequency: 'Weekly',
    staffLoginsDifferentDevices: false,
    accountLockout: false,
  },
  staffActivityAlerts: {
    companyChangesViaImpersonate: false,
    userRecordModificationDeletion: false,
    staffActivityReportSummaryEnabled: false,
    staffActivityReportSummaryFrequency: 'Weekly',
    forgotPasswordSessions: false,
  },
  systemHealthPerformance: {
    serverDowntime: false,
    pageLoad: false,
    highErrorRates: false,
    failedCronJobs: false,
    systemHealthPerformanceReportSummaryEnabled: false,
    systemHealthPerformanceReportSummaryFrequency: 'Weekly',
  },
  affiliateProgram: {
    payoutAlerts: false,
    mostUsedReferralCodes: false,
    affiliateReportSummaryEnabled: false,
    affiliateReportSummaryFrequency: 'Bi-Weekly',
  },
};

function isStandardFrequency(value: unknown): value is StandardFrequency {
  return value === 'Daily' || value === 'Weekly' || value === 'Bi-Weekly' || value === 'Monthly';
}

function isAffiliateFrequency(value: unknown): value is AffiliateFrequency {
  return value === 'Daily' || value === 'Bi-Weekly' || value === 'Monthly';
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function toUiFrequency(value: unknown): StandardFrequency {
  if (value === 'daily') return 'Daily';
  if (value === 'weekly') return 'Weekly';
  if (value === 'semi_monthly') return 'Bi-Weekly';
  if (value === 'monthly') return 'Monthly';
  return 'Weekly';
}

function toUiAffiliateFrequency(value: unknown): AffiliateFrequency {
  if (value === 'daily') return 'Daily';
  if (value === 'semi_monthly') return 'Bi-Weekly';
  if (value === 'monthly') return 'Monthly';
  return 'Bi-Weekly';
}

function toApiFrequency(value: StandardFrequency | AffiliateFrequency): 'daily' | 'weekly' | 'semi_monthly' | 'monthly' {
  if (value === 'Daily') return 'daily';
  if (value === 'Weekly') return 'weekly';
  if (value === 'Bi-Weekly') return 'semi_monthly';
  return 'monthly';
}

function ToggleSwitch({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4b74bf] focus-visible:ring-offset-2 ${
        checked ? 'border-primary bg-primary' : 'border-gray-100 bg-[#eef3ff]'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function PreferenceRow({
  title,
  description,
  enabled,
  onToggle,
  frequency,
  frequencyOptions,
  onFrequencyChange,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (next: boolean) => void;
  frequency?: string;
  frequencyOptions?: readonly string[];
  onFrequencyChange?: (next: string) => void;
}) {
  const hasFrequencyControl = Boolean(frequency && frequencyOptions && onFrequencyChange);

  return (
    <div className="grid grid-cols-1 gap-4 px-4 py-4 md:grid-cols-[minmax(0,1fr)_260px] md:items-center">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <p className="mt-1 text-sm text-gray-500">{description}</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[#e1e8f5] bg-[#f9fbff] px-3 py-2 sm:min-w-28 sm:justify-center">
          <span className={`text-xs font-semibold ${enabled ? 'text-primary' : 'text-[#7d8dad]'}`}>
            {enabled ? 'ON' : 'OFF'}
          </span>
          <ToggleSwitch checked={enabled} onChange={onToggle} ariaLabel={title} />
        </div>

        {hasFrequencyControl && (
          <label className="flex w-full flex-col gap-1 text-xs font-semibold text-gray-500 sm:w-40">
            Frequency
            <select
              value={frequency}
              disabled={!enabled}
              onChange={(event) => onFrequencyChange?.(event.target.value)}
              className="h-10 rounded-lg border border-gray-100 bg-white px-3 text-sm font-semibold text-gray-900 outline-none transition-colors focus:border-[#4b74bf] disabled:cursor-not-allowed disabled:bg-[#f2f5fb] disabled:text-[#9aa8c4]"
              aria-label={`${title} frequency`}
            >
              {frequencyOptions?.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}

export default function NotificationPreferencesPanel() {
  const [activeTab, setActiveTab] = useState<NotificationTabId>('userActivity');
  const [preferences, setPreferences] = useState<NotificationPreferencesState>(DEFAULT_PREFERENCES);
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [hasFetchedPreferences, setHasFetchedPreferences] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function fetchPreferences(): Promise<void> {
      try {
        const response = await fetch(`${getSettingsApiBase()}/api/superadmin/settings/notifications`, {
          method: 'GET',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!response.ok) throw new Error(`Preferences fetch failed: ${response.status}`);

        const payload = await response.json();
        const data = payload?.data ?? {};
        if (!isMounted) return;

        setPreferences({
          userActivity: {
            newUserRegistration: pickBoolean(data?.user_activity?.new_registration, false),
            userReportSummaryEnabled: Boolean(data?.user_activity?.user_report_frequency),
            userReportSummaryFrequency: toUiFrequency(data?.user_activity?.user_report_frequency),
            inactiveUsers: pickBoolean(data?.user_activity?.inactive_users, false),
            companyCreationRequests: pickBoolean(data?.user_activity?.company_requests, false),
          },
          security: {
            multipleUserSignupsDifferentDevices: pickBoolean(data?.security?.multiple_devices, false),
            securityReportSummaryEnabled: Boolean(data?.security?.security_report_frequency),
            securityReportSummaryFrequency: toUiFrequency(data?.security?.security_report_frequency),
            staffLoginsDifferentDevices: pickBoolean(data?.security?.staff_device_login, false),
            accountLockout: pickBoolean(data?.security?.account_lockouts, false),
          },
          staffActivityAlerts: {
            companyChangesViaImpersonate: pickBoolean(data?.staff_activity?.company_changes, false),
            userRecordModificationDeletion: pickBoolean(data?.staff_activity?.user_record_modifications, false),
            staffActivityReportSummaryEnabled: Boolean(data?.staff_activity?.staff_activity_report_frequency),
            staffActivityReportSummaryFrequency: toUiFrequency(data?.staff_activity?.staff_activity_report_frequency),
            forgotPasswordSessions: pickBoolean(data?.staff_activity?.staff_password_changes, false),
          },
          systemHealthPerformance: {
            serverDowntime: pickBoolean(data?.system_health?.server_downtime, false),
            pageLoad: pickBoolean(data?.system_health?.page_load_speed, false),
            highErrorRates: pickBoolean(data?.system_health?.high_error_rates, false),
            failedCronJobs: pickBoolean(data?.system_health?.failed_cron_jobs, false),
            systemHealthPerformanceReportSummaryEnabled: Boolean(data?.system_health?.system_health_report_frequency),
            systemHealthPerformanceReportSummaryFrequency: toUiFrequency(data?.system_health?.system_health_report_frequency),
          },
          affiliateProgram: {
            payoutAlerts: pickBoolean(data?.affiliate?.payout_alerts, false),
            mostUsedReferralCodes: pickBoolean(data?.affiliate?.most_used_codes, false),
            affiliateReportSummaryEnabled: Boolean(data?.affiliate?.affiliate_report_frequency),
            affiliateReportSummaryFrequency: toUiAffiliateFrequency(data?.affiliate?.affiliate_report_frequency),
          },
        });
      } catch (error) {
        console.error('Failed to fetch notification preferences:', error);
      } finally {
        if (isMounted) setHasFetchedPreferences(true);
      }
    }

    void fetchPreferences();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!showSuccessToast) return;

    const timeout = window.setTimeout(() => setShowSuccessToast(false), 2600);
    return () => window.clearTimeout(timeout);
  }, [showSuccessToast]);

  const activeTabMeta =
    NOTIFICATION_TABS.find((tabItem) => tabItem.id === activeTab) ?? NOTIFICATION_TABS[0];

  const updateSection = <Section extends keyof NotificationPreferencesState>(
    section: Section,
    changes: Partial<NotificationPreferencesState[Section]>,
  ) => {
    setPreferences((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        ...changes,
      },
    }));
  };

  const handleSaveAllPreferences = async () => {
    try {
      const response = await fetch(`${getSettingsApiBase()}/api/superadmin/settings/notifications`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_activity: {
            new_registration: preferences.userActivity.newUserRegistration,
            user_report_frequency: preferences.userActivity.userReportSummaryEnabled
              ? toApiFrequency(preferences.userActivity.userReportSummaryFrequency)
              : undefined,
            inactive_users: preferences.userActivity.inactiveUsers,
            company_requests: preferences.userActivity.companyCreationRequests,
          },
          security: {
            multiple_devices: preferences.security.multipleUserSignupsDifferentDevices,
            security_report_frequency: preferences.security.securityReportSummaryEnabled
              ? toApiFrequency(preferences.security.securityReportSummaryFrequency)
              : undefined,
            staff_device_login: preferences.security.staffLoginsDifferentDevices,
            account_lockouts: preferences.security.accountLockout,
          },
          staff_activity: {
            company_changes: preferences.staffActivityAlerts.companyChangesViaImpersonate,
            user_record_modifications: preferences.staffActivityAlerts.userRecordModificationDeletion,
            staff_activity_report_frequency: preferences.staffActivityAlerts.staffActivityReportSummaryEnabled
              ? toApiFrequency(preferences.staffActivityAlerts.staffActivityReportSummaryFrequency)
              : undefined,
            staff_password_changes: preferences.staffActivityAlerts.forgotPasswordSessions,
          },
          system_health: {
            server_downtime: preferences.systemHealthPerformance.serverDowntime,
            page_load_speed: preferences.systemHealthPerformance.pageLoad,
            high_error_rates: preferences.systemHealthPerformance.highErrorRates,
            failed_cron_jobs: preferences.systemHealthPerformance.failedCronJobs,
            system_health_report_frequency: preferences.systemHealthPerformance.systemHealthPerformanceReportSummaryEnabled
              ? toApiFrequency(preferences.systemHealthPerformance.systemHealthPerformanceReportSummaryFrequency)
              : undefined,
          },
          affiliate: {
            payout_alerts: preferences.affiliateProgram.payoutAlerts,
            most_used_codes: preferences.affiliateProgram.mostUsedReferralCodes,
            affiliate_report_frequency: preferences.affiliateProgram.affiliateReportSummaryEnabled
              ? toApiFrequency(preferences.affiliateProgram.affiliateReportSummaryFrequency)
              : undefined,
          },
        }),
      });
      if (!response.ok) throw new Error(`Preferences update failed: ${response.status}`);
      setShowSuccessToast(true);
    } catch (error) {
      console.error('Failed to save notification preferences:', error);
    }
  };

  return (
    <section className="space-y-4">
      <AnimatePresence>
        {showSuccessToast && (
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
                <p className="text-sm font-semibold text-gray-900">Saved</p>
                <p className="mt-1 text-sm text-gray-500">Notification preferences saved successfully.</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
        <div className="space-y-1">
          <h3 className="text-lg font-bold text-gray-900">Notification Preferences</h3>
          <p className="text-sm text-gray-500">
            Configure admin alerts across user activity, security, staff actions, system health, and affiliate operations.
          </p>
        </div>

        <div className="mt-4 border-b border-[#e8eef8] pb-2">
          <div
            className="flex gap-2 overflow-x-auto pb-1 [scrollbar-color:#c8d4eb_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#c8d4eb] [&::-webkit-scrollbar]:h-1.5"
            role="tablist"
            aria-label="Notification preference categories"
          >
            {NOTIFICATION_TABS.map((tabItem) => {
              const isActive = tabItem.id === activeTab;

              return (
                <button
                  key={tabItem.id}
                  type="button"
                  role="tab"
                  id={`notification-tab-${tabItem.id}`}
                  aria-controls={`notification-panel-${tabItem.id}`}
                  aria-selected={isActive}
                  onClick={() => setActiveTab(tabItem.id)}
                  className={`shrink-0 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4b74bf] focus-visible:ring-offset-2 ${
                    isActive
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-gray-100 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  {tabItem.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 max-h-[65vh] overflow-y-auto pr-1 [scrollbar-color:#c8d4eb_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#c8d4eb] [&::-webkit-scrollbar]:w-1.5">
          <motion.div
            key={activeTab}
            id={`notification-panel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`notification-tab-${activeTab}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="space-y-3"
          >
            <div className="rounded-2xl border border-[#e8eef8] bg-[#fbfdff] px-4 py-3">
              <h4 className="text-base font-bold text-gray-900">{activeTabMeta.label}</h4>
              <p className="mt-1 text-sm text-gray-500">{activeTabMeta.subtitle}</p>
            </div>

            <div className="divide-y divide-[#e8eef8] overflow-hidden rounded-2xl border border-[#e8eef8] bg-white">
              {activeTab === 'userActivity' && (
                <>
                  <PreferenceRow
                    title="New User Registration"
                    description="Get notified when a new user creates an account."
                    enabled={preferences.userActivity.newUserRegistration}
                    onToggle={(next) => updateSection('userActivity', { newUserRegistration: next })}
                  />

                  <PreferenceRow
                    title="User Report Summary"
                    description="Receive periodic summaries of user activity and trends."
                    enabled={preferences.userActivity.userReportSummaryEnabled}
                    onToggle={(next) => updateSection('userActivity', { userReportSummaryEnabled: next })}
                    frequency={preferences.userActivity.userReportSummaryFrequency}
                    frequencyOptions={STANDARD_FREQUENCIES}
                    onFrequencyChange={(next) => {
                      if (!isStandardFrequency(next)) return;
                      updateSection('userActivity', { userReportSummaryFrequency: next });
                    }}
                  />

                  <PreferenceRow
                    title="Inactive Users"
                    description="Get notified about inactive users for newsletter campaigns."
                    enabled={preferences.userActivity.inactiveUsers}
                    onToggle={(next) => updateSection('userActivity', { inactiveUsers: next })}
                  />

                  <PreferenceRow
                    title="Company Creation Requests"
                    description="Get notified when a new company creation request is pending approval."
                    enabled={preferences.userActivity.companyCreationRequests}
                    onToggle={(next) => updateSection('userActivity', { companyCreationRequests: next })}
                  />
                </>
              )}

              {activeTab === 'security' && (
                <>
                  <PreferenceRow
                    title="Multiple User Sign-ups on Different Devices"
                    description="Get alerted when a user signs in from multiple devices at the same time."
                    enabled={preferences.security.multipleUserSignupsDifferentDevices}
                    onToggle={(next) =>
                      updateSection('security', { multipleUserSignupsDifferentDevices: next })
                    }
                  />

                  <PreferenceRow
                    title="Security Report Summary"
                    description="Receive periodic summaries of security events and threats."
                    enabled={preferences.security.securityReportSummaryEnabled}
                    onToggle={(next) => updateSection('security', { securityReportSummaryEnabled: next })}
                    frequency={preferences.security.securityReportSummaryFrequency}
                    frequencyOptions={STANDARD_FREQUENCIES}
                    onFrequencyChange={(next) => {
                      if (!isStandardFrequency(next)) return;
                      updateSection('security', { securityReportSummaryFrequency: next });
                    }}
                  />

                  <PreferenceRow
                    title="Staff Log-ins on Different Devices"
                    description="Get alerted when staff members access the system from unrecognized devices."
                    enabled={preferences.security.staffLoginsDifferentDevices}
                    onToggle={(next) => updateSection('security', { staffLoginsDifferentDevices: next })}
                  />

                  <PreferenceRow
                    title="Account Lockout"
                    description="Get notified when a user account is locked out."
                    enabled={preferences.security.accountLockout}
                    onToggle={(next) => updateSection('security', { accountLockout: next })}
                  />
                </>
              )}

              {activeTab === 'staffActivityAlerts' && (
                <>
                  <PreferenceRow
                    title="Company Changes (via Impersonate)"
                    description="Get alerted when company details are modified during impersonation."
                    enabled={preferences.staffActivityAlerts.companyChangesViaImpersonate}
                    onToggle={(next) =>
                      updateSection('staffActivityAlerts', { companyChangesViaImpersonate: next })
                    }
                  />

                  <PreferenceRow
                    title="User Record Modification/Deletion"
                    description="Get notified when user records are edited or removed."
                    enabled={preferences.staffActivityAlerts.userRecordModificationDeletion}
                    onToggle={(next) =>
                      updateSection('staffActivityAlerts', { userRecordModificationDeletion: next })
                    }
                  />

                  <PreferenceRow
                    title="Staff Activity Report Summary"
                    description="Receive periodic summaries of staff actions and activities."
                    enabled={preferences.staffActivityAlerts.staffActivityReportSummaryEnabled}
                    onToggle={(next) =>
                      updateSection('staffActivityAlerts', { staffActivityReportSummaryEnabled: next })
                    }
                    frequency={preferences.staffActivityAlerts.staffActivityReportSummaryFrequency}
                    frequencyOptions={STANDARD_FREQUENCIES}
                    onFrequencyChange={(next) => {
                      if (!isStandardFrequency(next)) return;
                      updateSection('staffActivityAlerts', { staffActivityReportSummaryFrequency: next });
                    }}
                  />

                  <PreferenceRow
                    title="Forgot Password Sessions"
                    description="Get alerted when password reset requests are submitted."
                    enabled={preferences.staffActivityAlerts.forgotPasswordSessions}
                    onToggle={(next) => updateSection('staffActivityAlerts', { forgotPasswordSessions: next })}
                  />
                </>
              )}

              {activeTab === 'systemHealthPerformance' && (
                <>
                  <PreferenceRow
                    title="Server Downtime"
                    description="Get alerted immediately when the server is unavailable."
                    enabled={preferences.systemHealthPerformance.serverDowntime}
                    onToggle={(next) => updateSection('systemHealthPerformance', { serverDowntime: next })}
                  />

                  <PreferenceRow
                    title="Page Load"
                    description="Get notified when page load times degrade."
                    enabled={preferences.systemHealthPerformance.pageLoad}
                    onToggle={(next) => updateSection('systemHealthPerformance', { pageLoad: next })}
                  />

                  <PreferenceRow
                    title="High Error Rates"
                    description="Get alerted when error rates spike."
                    enabled={preferences.systemHealthPerformance.highErrorRates}
                    onToggle={(next) => updateSection('systemHealthPerformance', { highErrorRates: next })}
                  />

                  <PreferenceRow
                    title="Failed Cron Jobs"
                    description="Get notified when automated tasks fail."
                    enabled={preferences.systemHealthPerformance.failedCronJobs}
                    onToggle={(next) => updateSection('systemHealthPerformance', { failedCronJobs: next })}
                  />

                  <PreferenceRow
                    title="System Health and Performance Report Summary"
                    description="Receive periodic summaries of system health metrics."
                    enabled={preferences.systemHealthPerformance.systemHealthPerformanceReportSummaryEnabled}
                    onToggle={(next) =>
                      updateSection('systemHealthPerformance', {
                        systemHealthPerformanceReportSummaryEnabled: next,
                      })
                    }
                    frequency={preferences.systemHealthPerformance.systemHealthPerformanceReportSummaryFrequency}
                    frequencyOptions={STANDARD_FREQUENCIES}
                    onFrequencyChange={(next) => {
                      if (!isStandardFrequency(next)) return;
                      updateSection('systemHealthPerformance', {
                        systemHealthPerformanceReportSummaryFrequency: next,
                      });
                    }}
                  />
                </>
              )}

              {activeTab === 'affiliateProgram' && (
                <>
                  <PreferenceRow
                    title="Payout Alerts"
                    description="Get notified when affiliate payouts occur."
                    enabled={preferences.affiliateProgram.payoutAlerts}
                    onToggle={(next) => updateSection('affiliateProgram', { payoutAlerts: next })}
                  />

                  <PreferenceRow
                    title="Most Used Referral Codes"
                    description="Receive reports on top-performing referral codes."
                    enabled={preferences.affiliateProgram.mostUsedReferralCodes}
                    onToggle={(next) => updateSection('affiliateProgram', { mostUsedReferralCodes: next })}
                  />

                  <PreferenceRow
                    title="Affiliate Report Summary"
                    description="Receive periodic summaries of affiliate program performance."
                    enabled={preferences.affiliateProgram.affiliateReportSummaryEnabled}
                    onToggle={(next) =>
                      updateSection('affiliateProgram', { affiliateReportSummaryEnabled: next })
                    }
                    frequency={preferences.affiliateProgram.affiliateReportSummaryFrequency}
                    frequencyOptions={AFFILIATE_FREQUENCIES}
                    onFrequencyChange={(next) => {
                      if (!isAffiliateFrequency(next)) return;
                      updateSection('affiliateProgram', { affiliateReportSummaryFrequency: next });
                    }}
                  />
                </>
              )}
            </div>
          </motion.div>
        </div>

        <div className="mt-4 flex flex-col gap-3 border-t border-[#e8eef8] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-semibold text-gray-500">
            {hasFetchedPreferences
              ? 'Preferences loaded from backend. Click Save All Preferences to persist changes.'
              : 'Loading notification preferences from backend...'}
          </p>

          <button
            type="button"
            onClick={handleSaveAllPreferences}
            className="inline-flex items-center justify-center rounded-xl border border-primary bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#233f7d] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4b74bf] focus-visible:ring-offset-2"
          >
            Save All Preferences
          </button>
        </div>
      </section>
    </section>
  );
}
