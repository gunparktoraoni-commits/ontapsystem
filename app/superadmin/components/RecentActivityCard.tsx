'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  Building2,
  Clock3,
  FilePenLine,
  ShoppingCart,
  UserRoundPlus,
  type LucideIcon,
} from 'lucide-react';
import { asRecord, fetchRecentActivities, pickArray, pickNumber, pickString } from './dashboardApi';
import { PortalPanel } from './ui/PortalPanel';
import {
  DASHBOARD_CARD_MIN_H,
  DASHBOARD_DARK_PANEL_STYLE,
  DASHBOARD_SCROLLBAR_CLASS,
} from './ui/portalTokens';
import { SkeletonLoader } from '../../components/Loader';

type ActivityStatus = 'Pending' | 'Completed' | 'Approved';
type ActivityTone = 'blue' | 'cyan' | 'violet';

interface ActivityItem {
  id: string;
  title: string;
  time: string;
  description: string;
  status: ActivityStatus;
  tone: ActivityTone;
  icon: LucideIcon;
}

interface ActivitySection {
  id: string;
  label: string;
  items: ActivityItem[];
}

const ICON_TONE_CLASS: Record<ActivityTone, string> = {
  blue: 'border-[rgba(42,71,146,0.45)] bg-[rgba(42,71,146,0.2)] text-[#93c5fd]',
  cyan: 'border-[rgba(42,71,146,0.45)] bg-[rgba(42,71,146,0.2)] text-[#93c5fd]',
  violet: 'border-[rgba(42,71,146,0.45)] bg-[rgba(42,71,146,0.2)] text-[#93c5fd]',
};

const STATUS_CLASS: Record<ActivityStatus, string> = {
  Pending: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  Completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  Approved: 'border-[rgba(59,87,163,0.4)] bg-[rgba(59,87,163,0.15)] text-[#93c5fd]',
};

const SYSTEM_ALERT_TYPES = new Set([
  'order',
  'orders',
  'inventory',
  'company',
  'companies',
  'company_verification',
  'company_request',
  'system',
  'alert',
  'system_alert',
  'inquiry',
  'security',
]);

const USER_ONBOARDING_TYPES = new Set([
  'user',
  'users',
  'user_registration',
  'user_signup',
  'admin_registered',
  'address_change',
  'license',
  'license_upgrade',
  'subscription',
  'subscriptions',
  'staff',
  'onboarding',
]);

function pickIcon(type: string | null, action: string | null): LucideIcon {
  const key = `${type ?? ''} ${action ?? ''}`.toLowerCase();
  if (key.includes('order') || key.includes('inventory') || key.includes('license')) return ShoppingCart;
  if (key.includes('company') || key.includes('business')) return Building2;
  if (key.includes('user') || key.includes('admin') || key.includes('staff') || key.includes('register')) return UserRoundPlus;
  if (key.includes('address') || key.includes('change') || key.includes('update') || key.includes('edit')) return FilePenLine;
  return Activity;
}

function pickTone(type: string | null, action: string | null): ActivityTone {
  const key = `${type ?? ''} ${action ?? ''}`.toLowerCase();
  if (key.includes('user') || key.includes('admin') || key.includes('staff')) return 'violet';
  if (key.includes('company') || key.includes('verification') || key.includes('change')) return 'cyan';
  return 'blue';
}

function pickStatus(value: string | null): ActivityStatus {
  const v = (value ?? '').toLowerCase();
  if (v.includes('pending') || v.includes('open') || v.includes('await')) return 'Pending';
  if (v.includes('approved') || v.includes('accepted') || v.includes('granted')) return 'Approved';
  return 'Completed';
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Just now';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const diff = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  return (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  );
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString() : String(value);
  if (typeof value === 'string') {
    if (looksLikeJson(value)) {
      try {
        return formatDetailsValue(JSON.parse(value));
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => formatScalar(entry)).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    return formatDetailsObject(value);
  }
  return String(value);
}

function formatDetailsObject(obj: unknown): string {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return formatScalar(obj);
  }
  const entries = Object.entries(obj as Record<string, unknown>).filter(
    ([, v]) => v !== null && v !== undefined && v !== ''
  );
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `${humanizeKey(k)}: ${formatScalar(v)}`).join(' · ');
}

function formatDetailsValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (looksLikeJson(trimmed)) {
      try {
        return formatDetailsObject(JSON.parse(trimmed));
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  if (typeof value === 'object') return formatDetailsObject(value);
  return formatScalar(value);
}

function buildActivityDescription(rec: Record<string, unknown>): string {
  const actor = asRecord(rec.actor);
  const target = asRecord(rec.target);
  const details = rec.details;

  let description =
    pickString(rec.description, rec.message, rec.detail, rec.summary) ?? '';

  if (description && looksLikeJson(description)) {
    description = formatDetailsValue(description);
  } else if (!description && details) {
    description = formatDetailsValue(details);
  } else if (details && typeof details === 'object') {
    const detailText = formatDetailsObject(details);
    if (detailText) {
      description = description ? `${description} — ${detailText}` : detailText;
    }
  }

  if (!description) {
    const actorName = pickString(actor?.name, actor?.email);
    const targetLabel = pickString(target?.label, target?.id);
    if (actorName && targetLabel) {
      description = `${actorName} → ${targetLabel}`;
    } else if (actorName) {
      description = actorName;
    } else if (targetLabel) {
      description = targetLabel;
    }
  }

  return description;
}

function mapActivityItem(raw: unknown, fallbackId: number): ActivityItem | null {
  const rec = asRecord(raw);
  if (!rec) return null;

  const type = pickString(rec.activity_type, rec.type, rec.category, rec.event_type);
  const action = pickString(rec.action, rec.event, rec.event_name);
  const title = pickString(rec.title, rec.action, rec.event_name, rec.activity_type, rec.type) ?? 'Activity';
  const description = buildActivityDescription(rec);
  const timestamp = pickString(rec.created_at, rec.timestamp, rec.occurred_at, rec.time);
  const status = pickStatus(pickString(rec.status, rec.state, rec.result));
  const id = pickString(rec.id, rec.uuid, rec.activity_id) ?? `activity-${fallbackId}`;

  return {
    id,
    title,
    time: timeAgo(timestamp),
    description,
    status,
    tone: pickTone(type, action),
    icon: pickIcon(type, action),
  };
}

function classifySection(item: ActivityItem, raw: unknown): 'system-alerts' | 'user-onboarding' {
  const rec = asRecord(raw) ?? {};
  const type = (pickString(rec.activity_type, rec.type, rec.category) ?? '').toLowerCase();
  if (USER_ONBOARDING_TYPES.has(type)) return 'user-onboarding';
  if (SYSTEM_ALERT_TYPES.has(type)) return 'system-alerts';
  if (item.tone === 'violet') return 'user-onboarding';
  return 'system-alerts';
}

function buildSections(payload: unknown): ActivitySection[] {
  const root = asRecord(payload);
  const data = asRecord(root?.data) ?? root ?? {};

  const list =
    pickArray(
      data.activities,
      data.items,
      data.recent_activities,
      data.results,
      asRecord(data.feed)?.items,
      asRecord(data.recent)?.items
    ) ?? [];

  const systemItems: ActivityItem[] = [];
  const onboardingItems: ActivityItem[] = [];

  list.forEach((raw, index) => {
    const item = mapActivityItem(raw, index);
    if (!item) return;
    const section = classifySection(item, raw);
    if (section === 'system-alerts') systemItems.push(item);
    else onboardingItems.push(item);
  });

  const sections: ActivitySection[] = [];
  if (systemItems.length) {
    sections.push({ id: 'system-alerts', label: 'System Alerts', items: systemItems.slice(0, 5) });
  }
  if (onboardingItems.length) {
    sections.push({ id: 'user-onboarding', label: 'User Onboarding', items: onboardingItems.slice(0, 5) });
  }
  return sections;
}

export default function RecentActivityCard() {
  const [sections, setSections] = useState<ActivitySection[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    async function loadActivities() {
      setIsLoading(true);
      setError(null);
      try {
        const payload = await fetchRecentActivities(
          { page: 1, limit: 20, filter: 'this_week' },
          controller.signal
        );
        
        if (cancelled) return;
        const built = buildSections(payload);
        const root = asRecord(payload);
        const data = asRecord(root?.data) ?? root ?? {};
        pickNumber(asRecord(data.summary)?.total_activities);
        setSections(built);
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        const message = err instanceof Error ? err.message : 'Failed to load recent activities.';
        setError(message);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }   

    void loadActivities();
    const pollInterval = window.setInterval(loadActivities, 60_000);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(pollInterval);
    };
  }, []);

  const renderedSections = sections;
  const activityCount = renderedSections.reduce((sum, section) => sum + section.items.length, 0);

  return (
    <PortalPanel
      title="Recent Activities"
      variant="glass"
      className={`flex flex-col ${DASHBOARD_CARD_MIN_H}`}
      action={
        <div className="flex items-center gap-2">
          {!isLoading && activityCount > 0 ? (
            <span
              className="rounded-full px-2.5 py-0.5 text-[10px] font-bold"
              style={{
                background: 'rgba(42,71,146,0.25)',
                border: '1px solid rgba(42,71,146,0.45)',
                color: '#93c5fd',
              }}
            >
              {activityCount} new
            </span>
          ) : null}
          <button
            type="button"
            className="inline-flex items-center rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200"
            style={{
              background: 'rgba(42,71,146,0.25)',
              border: '1px solid rgba(42,71,146,0.5)',
              color: '#93c5fd',
            }}
          >
            View All
          </button>
        </div>
      }
    >
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl"
        style={{ ...DASHBOARD_DARK_PANEL_STYLE, marginTop: 4 }}
      >
        <div
          className={`min-h-0 max-h-[340px] flex-1 space-y-5 px-3 py-4 sm:px-4 ${DASHBOARD_SCROLLBAR_CLASS}`}
        >
        {isLoading && renderedSections.length === 0 ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div
                key={`activity-skeleton-${i}`}
                className="flex items-start gap-4 rounded-xl p-4"
                style={{ background: 'rgba(59,87,163,0.08)' }}
              >
                <SkeletonLoader width="w-10" height="h-10" className="shrink-0 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <SkeletonLoader width="w-2/3" height="h-4" className="rounded-lg" />
                  <SkeletonLoader width="w-1/2" height="h-3" className="rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        ) : renderedSections.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <Activity className="mb-3 h-8 w-8" style={{ color: 'rgba(59,87,163,0.5)' }} />
            <p className="text-sm font-semibold" style={{ color: '#94a3b8' }}>
              {error ?? 'No recent activities to display.'}
            </p>
          </div>
        ) : (
          renderedSections.map((section) => (
            <section key={section.id}>
              <p
                className="text-[10px] font-bold uppercase tracking-[0.14em]"
                style={{ color: 'rgba(59,87,163,0.55)' }}
              >
                {section.label}
              </p>

              <div className="mt-3 space-y-2">
                {section.items.map((item) => {
                  const ItemIcon = item.icon;

                  return (
                    <article
                      key={item.id}
                      className="group flex items-start gap-3.5 rounded-xl border p-3.5 transition-all duration-200 hover:border-[rgba(59,87,163,0.45)]"
                      style={{
                        borderColor: 'rgba(59,87,163,0.2)',
                        background: 'rgba(59,87,163,0.06)',
                      }}
                    >
                      <span
                        className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-transform duration-200 group-hover:scale-105 ${ICON_TONE_CLASS[item.tone]}`}
                      >
                        <ItemIcon className="h-4 w-4" />
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <h4
                            className="text-sm font-bold leading-snug transition-colors group-hover:text-[#93c5fd]"
                            style={{ color: '#e2e8f0' }}
                          >
                            {item.title}
                          </h4>
                          <span
                            className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold"
                            style={{
                              background: 'rgba(59,87,163,0.12)',
                              border: '1px solid rgba(59,87,163,0.2)',
                              color: '#64748b',
                            }}
                          >
                            <Clock3 className="h-3 w-3" style={{ color: '#475569' }} />
                            {item.time}
                          </span>
                        </div>

                        {item.description ? (
                          <p
                            className="mt-1.5 line-clamp-2 text-xs leading-relaxed"
                            style={{ color: '#94a3b8' }}
                          >
                            {item.description}
                          </p>
                        ) : null}

                        <span
                          className={`mt-2.5 inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_CLASS[item.status]}`}
                        >
                          {item.status}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))
        )}
        </div>
      </div>
    </PortalPanel>
  );
}
