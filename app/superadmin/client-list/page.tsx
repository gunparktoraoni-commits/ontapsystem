"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowUpDown,
  Ban,
  Building2,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  CreditCard,
  Download,
  Eye,
  Mail,
  Pencil,
  Search,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { InlineLoader, SectionLoader } from '../../components/Loader';
import { motion } from 'framer-motion';
import {
  PortalModal,
  PortalPageHeader,
} from '../components/ui';
import { csrfClient } from '@/lib/csrf-client';
import { persistImpersonationHandoff } from '@/app/lib/superadminImpersonationHandoff';
import { getFrontendApiBaseUrl } from '@/app/components/apiBase';
import {
  showAlertDialog,
  showConfirmDialog,
} from '@/app/components/ConfirmDialog';
import {
  ClientActivitySummaryCards,
  type ClientActivitySummary,
} from './ClientActivitySummaryCards';
import { toServableMediaSrc } from '@/app/lib/portfolioDisplay';

type ClientStatus = 'Online' | 'Offline' | 'Suspended';
type ClientType = 'Individual' | 'Business' | 'Enterprise';
type PlanType = 'Basic' | 'Standard' | 'Premium' | 'Enterprise';

type ExportScope = 'all' | 'specific';
type DatePreset = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom';
type SortField = 'name' | 'bizcardCount' | 'joinedAt' | 'lastActivity' | 'status';
type SortDirection = 'asc' | 'desc';

interface ClientRecord {
  id: string;
  initials: string;
  name: string;
  email: string;
  profileImage: string | null;
  bizcardCount: number;
  joinedAt: string;
  planType: PlanType;
  clientType: ClientType;
  lastActivity: string;
  status: ClientStatus;
  isOnline: boolean;
  createdAt: string;
}

// ── Client detail (View modal) ──────────────────────────────
interface ClientDetail extends ClientRecord {
  phone: string;
  altEmail: string;
  subscriptionTier: string;
  lastActive: string;
}

// ── Staff-for-assignment types ───────────────────────────────
interface StaffForAssignment {
  staff_id: number;
  user_id: number;
  name: string;
  email: string;
  role: string;
  department: string;
  assigned_client_count: number;
}

type AssignmentStep = 'select' | 'confirm_reassign' | 'submitting' | 'success' | 'error';

const BACKEND_URL = ''; // resolved at call-time via getBackendUrl() for local same-origin

function getBackendUrl(): string {
  return getFrontendApiBaseUrl() || BACKEND_URL;
}

const EMPTY_ACTIVITY_SUMMARY: ClientActivitySummary = {
  total_clients: 0,
  total_online: 0,
  total_subscribers: 0,
  subscription_breakdown: { basic: 0, standard: 0, premium: 0 },
  top_locations: [],
  new_users: {
    today: { count: 0, previous: 0, percentage_change: 0 },
    week: { count: 0, previous: 0, percentage_change: 0 },
    month: { count: 0, previous: 0, percentage_change: 0 },
  },
};

function todayDateKey(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function isCreatedToday(value: string): boolean {
  if (!value) return false;
  return value.slice(0, 10) === todayDateKey();
}

function formatPrice(value: number): string {
  return `P${value}`;
}

function statusBadgeClass(status: ClientStatus): string {
  if (status === 'Online') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'Suspended') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
}

function avatarTheme(index: number): string {
  const themes = [
    'bg-[#e9f2ff] text-[#3d5d9f]',
    'bg-[#e9f8ff] text-[#2e7f9f]',
    'bg-[#eef7f0] text-[#2f7a52]',
    'bg-[#f3efff] text-[#6950a8]',
  ];
  return themes[index % themes.length] ?? themes[0];
}

function resolveClientProfileImage(...sources: unknown[]): string | null {
  for (const raw of sources) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) continue;
    const lower = value.toLowerCase();
    if (lower === 'n/a' || lower === 'na' || lower === 'none' || value === '/images/no-image.png') {
      continue;
    }
    return toServableMediaSrc(value) || null;
  }
  return null;
}

function ClientAvatar({
  name,
  initials,
  imageUrl,
  themeClass,
}: {
  name: string;
  initials: string;
  imageUrl?: string | null;
  themeClass: string;
}) {
  const [failed, setFailed] = useState(false);

  if (imageUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={name}
        className="h-10 w-10 shrink-0 rounded-full object-cover ring-2 ring-[#d7e3f3]"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${themeClass}`}
    >
      {initials}
    </span>
  );
}
function activityRank(value: string): number {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'just now') return 0;
  if (normalized === 'yesterday') return 24 * 60;
  const relativeMatch = normalized.match(/^([0-9]+)\s+(minute|minutes|hour|hours|day|days)\s+ago$/);
  if (!relativeMatch) return Number.MAX_SAFE_INTEGER;
  const amount = Number(relativeMatch[1]);
  const unit = relativeMatch[2];
  if (unit.startsWith('minute')) return amount;
  if (unit.startsWith('hour')) return amount * 60;
  return amount * 24 * 60;
}
function toDayDate(value: string): Date {
  return new Date(`${value}T00:00:00`);
}
function getDatePresetRange(preset: DatePreset): { start: Date; end: Date } | null {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (preset === 'today') {
    const start = new Date(today);
    const end = new Date(today);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  
  if (preset === 'yesterday') {
    const start = new Date(today);
    start.setDate(start.getDate() - 1);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  if (preset === 'this_week') {
    const start = new Date(today);
    const day = start.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + mondayOffset);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  if (preset === 'this_month') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  return null;
}

function csvEscape(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function parseDateOnly(value: unknown): string {
  if (typeof value !== 'string' || !value) return new Date().toISOString().slice(0, 10);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

function toTitleCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function mapPlanType(raw: unknown): PlanType {
  if (typeof raw !== 'string') return 'Basic';
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'enterprise') return 'Enterprise';
  if (normalized === 'premium') return 'Premium';
  if (normalized === 'standard') return 'Standard';
  if (normalized === 'basic') return 'Basic';
  if (normalized === 'free') return 'Basic';
  return 'Basic';
}
function mapClientType(raw: unknown): ClientType {
  if (typeof raw !== 'string') return 'Individual';
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'enterprise') return 'Enterprise';
  if (normalized === 'business') return 'Business';
  return 'Individual';
}
function mapClientSessionStatus(
  rawStatus: unknown,
  isActive: unknown,
  isRestricted: unknown,
  isOnline: unknown,
  lastActive?: unknown,
): ClientStatus {
  if (typeof rawStatus === 'string' && rawStatus.trim().toLowerCase() === 'restricted') {
    return 'Suspended';
  }
  if (typeof isRestricted === 'boolean' && isRestricted) return 'Suspended';
  if (typeof rawStatus === 'string' && rawStatus.trim().toLowerCase() === 'suspended') {
    return 'Suspended';
  }

  const lastActiveDate =
    typeof lastActive === 'string' || lastActive instanceof Date
      ? new Date(lastActive)
      : null;
  if (lastActiveDate && !Number.isNaN(lastActiveDate.getTime())) {
    const cutoffMs = Date.now() - 5 * 60 * 1000;
    if (lastActiveDate.getTime() >= cutoffMs) return 'Online';
    return 'Offline';
  }

  if (isOnline === true) return 'Online';
  return 'Offline';
}
function toRelativeActivity(value: unknown): string {
  if (typeof value !== 'string' || !value) return 'N/A';
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return 'N/A';
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffHours < 48) return 'Yesterday';
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}
function initialsFromName(name: string): string {
  const parts = name
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return 'NA';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase() || 'NA';
}

function mapApiClientToRecord(item: Record<string, unknown>): ClientRecord {
  const firstName = typeof item.first_name === 'string' ? item.first_name.trim() : '';
  const lastName = typeof item.last_name === 'string' ? item.last_name.trim() : '';
  const fallbackName = typeof item.name === 'string' ? item.name.trim() : '';
  const fullName = `${firstName} ${lastName}`.trim() || fallbackName || 'Unknown Client';

  const email =
    (typeof item.email === 'string' && item.email.trim()) ||
    (typeof item.alt_email === 'string' && item.alt_email.trim()) ||
    'N/A';
  const rawBizcardCount =
    typeof item.bizcard_count === 'number'
      ? item.bizcard_count
      : typeof item.bizcardCount === 'number'
        ? item.bizcardCount
        : 0;

  const profileImage = resolveClientProfileImage(
    item.profile_image,
    item.profile_url,
    item.profile_img,
  );

  return {
    id: String(item.id ?? item.user_id ?? item.client_id ?? crypto.randomUUID()),
    initials: initialsFromName(fullName),
    name: fullName,
    email,
    profileImage,
    bizcardCount: Number.isFinite(rawBizcardCount) ? rawBizcardCount : 0,
    joinedAt: parseDateOnly(item.joined_at ?? item.joinedAt ?? item.created_at),
    planType: mapPlanType(item.subscription_type ?? item.subscription_tier ?? item.plan_type),
    clientType: mapClientType(item.client_type ?? item.account_type),
    lastActivity: toRelativeActivity(item.last_active),
    status: mapClientSessionStatus(
      item.status,
      item.is_active,
      item.is_restricted,
      item.is_online,
      item.last_active,
    ),
    isOnline:
      mapClientSessionStatus(
        item.status,
        item.is_active,
        item.is_restricted,
        item.is_online,
        item.last_active,
      ) === 'Online',
    createdAt: parseDateOnly(item.created_at),
  };
}

function extractListPayload(raw: unknown): Record<string, unknown>[] {
  if (!raw || typeof raw !== 'object') return [];
  const root = raw as Record<string, unknown>;
  const data = root.data;
  if (Array.isArray(data)) return data.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object');
  if (data && typeof data === 'object') {
    const boxed = data as Record<string, unknown>;
    const candidates = [boxed.clients, boxed.items, boxed.rows];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object');
      }
    }
  }
  return [];
}



function mapApiDetailToClientDetail(item: Record<string, unknown>): ClientDetail {
  const base = mapApiClientToRecord(item);
  return {
    ...base,
    phone: typeof item.phone === 'string' ? item.phone.trim() : typeof item.contact === 'string' ? item.contact.trim() : 'N/A',
    altEmail: typeof item.alt_email === 'string' ? item.alt_email.trim() : 'N/A',
    subscriptionTier: typeof item.subscription_tier === 'string' ? item.subscription_tier : typeof item.subscription_type === 'string' ? item.subscription_type : base.planType,
    lastActive: typeof item.last_active === 'string' ? item.last_active : 'N/A',
  };
}

function mapActivitySummary(raw: unknown): ClientActivitySummary {
  if (!raw || typeof raw !== 'object') return EMPTY_ACTIVITY_SUMMARY;
  const root = raw as Record<string, unknown>;
  const source = (root.data && typeof root.data === 'object' ? root.data : root) as Record<string, unknown>;

  const toNumber = (value: unknown, fallback = 0): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

  const period = (value: unknown): ClientActivitySummary['new_users']['today'] => {
    if (!value || typeof value !== 'object') {
      return { count: 0, previous: 0, percentage_change: 0 };
    }
    const row = value as Record<string, unknown>;
    return {
      count: toNumber(row.count),
      previous: toNumber(row.previous),
      percentage_change: toNumber(row.percentage_change),
    };
  };

  const subsRaw =
    source.subscription_breakdown && typeof source.subscription_breakdown === 'object'
      ? (source.subscription_breakdown as Record<string, unknown>)
      : source.total_subscriptions && typeof source.total_subscriptions === 'object'
        ? (source.total_subscriptions as Record<string, unknown>)
        : {};

  const locationsRaw = Array.isArray(source.top_locations) ? source.top_locations : [];
  const newUsersRaw =
    source.new_users && typeof source.new_users === 'object'
      ? (source.new_users as Record<string, unknown>)
      : {};

  return {
    total_clients: toNumber(source.total_clients),
    total_online: toNumber(source.total_online ?? source.total_active ?? source.active_clients),
    total_subscribers: toNumber(source.total_subscribers ?? source.subscribed_clients),
    subscription_breakdown: {
      basic: toNumber(subsRaw.basic),
      standard: toNumber(subsRaw.standard ?? subsRaw.free),
      premium: toNumber(subsRaw.premium) + toNumber(subsRaw.enterprise),
    },
    top_locations: locationsRaw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const row = item as Record<string, unknown>;
        const label = String(row.label ?? row.city ?? row.country ?? '').trim();
        if (!label) return null;
        return { label, count: toNumber(row.count ?? row.user_count) };
      })
      .filter((item): item is { label: string; count: number } => Boolean(item))
      .slice(0, 5),
    new_users: {
      today: period(newUsersRaw.today),
      week: period(newUsersRaw.week),
      month: period(newUsersRaw.month),
    },
  };
}

export default function ClientListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [activitySummary, setActivitySummary] = useState<ClientActivitySummary>(EMPTY_ACTIVITY_SUMMARY);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [pendingRequestClientIds, setPendingRequestClientIds] = useState<Set<string>>(new Set());
  const [creatingPendingClientId, setCreatingPendingClientId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | ClientType>('all');
  const [planFilter, setPlanFilter] = useState<'all' | PlanType>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | ClientStatus>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 6;

  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportScope, setExportScope] = useState<ExportScope>('all');
  const [exportClientSearch, setExportClientSearch] = useState('');
  const [selectedExportClientIds, setSelectedExportClientIds] = useState<string[]>([]);
  const [exportPlanType, setExportPlanType] = useState<'all' | PlanType>('all');
  const [datePreset, setDatePreset] = useState<DatePreset>('today');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  // ── Client assignment modal state ──────────────────────────
  const [assignTarget, setAssignTarget] = useState<ClientRecord | null>(null);
  const [staffList, setStaffList] = useState<StaffForAssignment[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffSearchQuery, setStaffSearchQuery] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null);
  const [assignStep, setAssignStep] = useState<AssignmentStep>('select');
  const [assignError, setAssignError] = useState<string | null>(null);
  const [conflictInfo, setConflictInfo] = useState<{
    current_staff_id: number;
    current_staff_name: string;
  } | null>(null);

  // ── Bulk assignment state ─────────────────────────────────
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkAssignStaffList, setBulkAssignStaffList] = useState<StaffForAssignment[]>([]);
  const [bulkStaffLoading, setBulkStaffLoading] = useState(false);
  const [bulkSelectedStaffId, setBulkSelectedStaffId] = useState<number | null>(null);
  const [bulkAssignProgress, setBulkAssignProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkAssignErrors, setBulkAssignErrors] = useState<string[]>([]);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkModalClientIds, setBulkModalClientIds] = useState<Set<string>>(new Set());

  // ── View modal state ────────────────────────────────────────
  const [viewTarget, setViewTarget] = useState<ClientDetail | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);
  const [copiedEmail, setCopiedEmail] = useState(false);

  // ── Impersonation state ─────────────────────────────────────
  const [impersonatingClientId, setImpersonatingClientId] = useState<string | null>(null);

  // ── Suspend / Delete confirmation state ─────────────────────
  const [suspendConfirmTarget, setSuspendConfirmTarget] = useState<ClientRecord | null>(null);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<ClientRecord | null>(null);
  const [suspendLoading, setSuspendLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [actionBusyClientId, setActionBusyClientId] = useState<string | null>(null);

  // ── Search suggestions state ────────────────────────────────
  // (suggestions dropdown removed — table filters in real time)


  function readStoredToken(): string | null {
    if (typeof window === 'undefined') return null;
    return (
      window.localStorage.getItem('auth_token') ||
      window.localStorage.getItem('superadmin_token') ||
      window.sessionStorage.getItem('auth_token') ||
      window.sessionStorage.getItem('superadmin_token') ||
      null
    );
  }
  function extractErrorMessage(payload: unknown, fallback: string): string {
    if (!payload || typeof payload !== 'object') return fallback;
    const objectPayload = payload as { error?: { message?: string } | string; message?: string };
    if (typeof objectPayload.error === 'string') return objectPayload.error;
    if (objectPayload.error?.message) return objectPayload.error.message;
    if (objectPayload.message) return objectPayload.message;
    return fallback;
  }

  // ── Assignment helpers ─────────────────────────────────────

  

  const buildAuthHeaders = useCallback((token: string | null): HeadersInit => {
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, []);
  
  const openAssignModal = useCallback(async (client: ClientRecord) => {
    setAssignTarget(client);
    setSelectedStaffId(null);
    setAssignStep('select');
    setAssignError(null);
    setConflictInfo(null);
    setStaffSearchQuery('');
    setStaffList([]);
    setStaffLoading(true);

    try {
      const token = readStoredToken();
      const response = await fetch(
        `${getBackendUrl()}/api/superadmin/staff/for-assignment`,
        {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          (payload as { error?: { message?: string }; message?: string }).error?.message ??
          (payload as { message?: string }).message ??
          'Failed to load staff members.'
        );
      }
      const payload = (await response.json()) as {
        data?: { staff?: StaffForAssignment[] };
      };
      setStaffList(payload.data?.staff ?? []);
    } catch (error) {
      setAssignError(error instanceof Error ? error.message : 'Failed to load staff members.');
    } finally {
      setStaffLoading(false);
    }
  }, []);

  const closeAssignModal = useCallback(() => {
    setAssignTarget(null);
    setSelectedStaffId(null);
    setAssignStep('select');
    setAssignError(null);
    setConflictInfo(null);
    setStaffSearchQuery('');
  }, []);

  // ── View modal handlers ─────────────────────────────────────
  const openViewModal = useCallback(async (client: ClientRecord) => {
    setViewLoading(true);
    setViewError(null);
    setViewTarget(null);
    setViewTarget({ ...client, phone: 'N/A', altEmail: 'N/A', subscriptionTier: client.planType, lastActive: 'N/A' });

    try {
      const token = readStoredToken();
      const response = await fetch(
        `${getBackendUrl()}/api/superadmin/clients/${client.id}`,
        {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, 'Failed to load client details.'));
      }
      const raw = (payload as { data?: Record<string, unknown> }).data ?? {};
      setViewTarget(mapApiDetailToClientDetail(raw));
    } catch (error) {
      setViewError(error instanceof Error ? error.message : 'Failed to load client details.');
    } finally {
      setViewLoading(false);
    }
  }, []);

  const closeViewModal = useCallback(() => {
    setViewTarget(null);
    setViewLoading(false);
    setViewError(null);
    setCopiedEmail(false);
  }, []);

  const openViewModalByUserId = useCallback((userId: string) => {
    const placeholder: ClientRecord = {
      id: userId,
      initials: '…',
      name: 'Loading…',
      email: 'N/A',
      profileImage: null,
      bizcardCount: 0,
      joinedAt: new Date().toISOString().slice(0, 10),
      planType: 'Basic',
      clientType: 'Individual',
      lastActivity: 'N/A',
      status: 'Offline',
      isOnline: false,
      createdAt: new Date().toISOString().slice(0, 10),
    };
    void openViewModal(placeholder);
  }, [openViewModal]);

  // Deep-link from Super Admin registration notifications:
  // /superadmin/client-list?viewUserId=<id> opens the same Profile View modal
  // used by the Eye ("View profile") action.
  // - useSearchParams: works for soft navigations / App Router cache (no remount)
  // - custom event: opens immediately when already on this page
  const viewUserIdParam = searchParams.get('viewUserId');
  const handledProfileDeepLinkRef = useRef<string | null>(null);

  useEffect(() => {
    const viewUserId = viewUserIdParam?.trim() ?? '';
    if (!viewUserId || !/^\d+$/.test(viewUserId)) {
      // Allow the same user to be opened again on a later notification click.
      if (!viewUserId) handledProfileDeepLinkRef.current = null;
      return;
    }
    if (handledProfileDeepLinkRef.current === viewUserId) return;
    handledProfileDeepLinkRef.current = viewUserId;
    openViewModalByUserId(viewUserId);
    router.replace('/superadmin/client-list', { scroll: false });
  }, [viewUserIdParam, openViewModalByUserId, router]);

  useEffect(() => {
    const onOpenClientProfile = (event: Event) => {
      const userId =
        (event as CustomEvent<{ userId?: string }>).detail?.userId?.trim() ?? '';
      if (!userId || !/^\d+$/.test(userId)) return;
      handledProfileDeepLinkRef.current = userId;
      openViewModalByUserId(userId);
      router.replace('/superadmin/client-list', { scroll: false });
    };
    window.addEventListener('sa-open-client-profile', onOpenClientProfile);
    return () => window.removeEventListener('sa-open-client-profile', onOpenClientProfile);
  }, [openViewModalByUserId, router]);

  const handleCopyEmail = useCallback((email: string) => {
    if (!email || email === 'N/A') return;
    void navigator.clipboard.writeText(email).then(() => {
      setCopiedEmail(true);
      window.setTimeout(() => setCopiedEmail(false), 2000);
    });
  }, []);

  // ── Edit modal handlers ─────────────────────────────────────
  // ── Impersonation helpers ──────────────────────────────────
  function extractImpersonationToken(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const root = payload as Record<string, unknown>;
    const data = root.data;
    if (!data || typeof data !== 'object') return null;
    const record = data as Record<string, unknown>;
    for (const key of ['impersonation_token', 'impersonationToken', 'token']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return null;
  }

  function buildImpersonationEnterUrl(handoffToken: string | null): string {
    const base = '/superadmin/impersonate/enter?userMode=true';
    return handoffToken
      ? `${base}#handoff=${encodeURIComponent(handoffToken)}`
      : base;
  }

  const handleImpersonateClient = useCallback(async (client: ClientRecord) => {
    setImpersonatingClientId(client.id);
    setNotice(null);

    try {
      const token = readStoredToken();
      const csrfToken = await csrfClient.getToken(false, getBackendUrl() || undefined);

      // Uses the client-specific impersonation endpoint which does NOT require
      // the target to be a company primary admin — works for any active user.
      const response = await fetch(
        `${getBackendUrl()}/api/superadmin/clients/${client.id}/impersonate`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
          },
        },
      );

      const payload = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        data?: { impersonation_token?: string; token?: string };
        error?: { message?: string };
        message?: string;
      };

      if (!response.ok || !payload.success) {
        throw new Error(extractErrorMessage(payload, 'Failed to start impersonation session.'));
      }

      const impersonationToken = extractImpersonationToken(payload);
      persistImpersonationHandoff(impersonationToken ?? '', undefined, client.id);

      window.location.assign(buildImpersonationEnterUrl(impersonationToken));
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error
          ? error.message
          : 'Failed to start impersonation session.',
      });
    } finally {
      setImpersonatingClientId(null);
    }
  }, []);

  // ── Bulk assignment functions ─────────────────────────────
  const openBulkAssignModal = useCallback(async () => {
    if (selectedClientIds.size === 0) return;
    
    setBulkAssignOpen(true);
    setBulkSelectedStaffId(null);
    setBulkAssignProgress(null);
    setBulkAssignErrors([]);
    setBulkSubmitting(false);
    
    // Copy selected client IDs to modal state
    setBulkModalClientIds(new Set(selectedClientIds));
    
    // Fetch staff list for assignment
    setBulkStaffLoading(true);
    try {
      const token = readStoredToken();
      const response = await fetch(
        `${getBackendUrl()}/api/superadmin/staff/for-assignment`,
        {
          method: 'GET',
          credentials: 'include',
          headers: buildAuthHeaders(token),
        }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          (payload as { error?: { message?: string }; message?: string }).error?.message ??
          (payload as { message?: string }).message ??
          'Failed to load staff members.'
        );
      }
      const payload = (await response.json()) as {
        data?: { staff?: StaffForAssignment[] };
      };
      setBulkAssignStaffList(payload.data?.staff ?? []);
    } catch (error) {
      setBulkAssignErrors([error instanceof Error ? error.message : 'Failed to load staff members.']);
    } finally {
      setBulkStaffLoading(false);
    }
  }, [selectedClientIds]);

  const closeBulkAssignModal = useCallback(() => {
    setBulkAssignOpen(false);
    setBulkSelectedStaffId(null);
    setBulkAssignProgress(null);
    setBulkAssignErrors([]);
    setBulkSubmitting(false);
    setBulkModalClientIds(new Set());
  }, []);

  const handleBulkAssign = useCallback(async () => {
    if (selectedClientIds.size === 0 || bulkSelectedStaffId === null) return;
    
    setBulkSubmitting(true);
    setBulkAssignProgress({ done: 0, total: selectedClientIds.size });
    setBulkAssignErrors([]);

    const errors: string[] = [];
    const successCount = { count: 0 };

    // Process assignments sequentially
    for (const clientId of selectedClientIds) {
      try {
        const token = readStoredToken();
        const csrfToken = await csrfClient.getToken(false, getBackendUrl() || undefined);

        const response = await fetch(`${getBackendUrl()}/api/superadmin/assign-client`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
          },
          body: JSON.stringify({
            client_id: Number(clientId),
            staff_id: bulkSelectedStaffId,
            force_reassign: false,
          }),
        });

        const payload = (await response.json()) as {
          success?: boolean;
          data?: {
            already_assigned?: boolean;
            message?: string;
          };
          error?: {
            code?: string;
            message?: string;
          };
        };

        if (!response.ok) {
          if (payload.error?.code === 'CLIENT_ALREADY_ASSIGNED') {
            // Treat as soft success for bulk assignment
            successCount.count++;
          } else {
            errors.push(`Client ${clientId}: ${payload.error?.message ?? 'Assignment failed'}`);
          }
        } else {
          successCount.count++;
        }

        setBulkAssignProgress({ 
          done: successCount.count + errors.length, 
          total: selectedClientIds.size 
        });
      } catch (error) {
        errors.push(`Client ${clientId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        setBulkAssignProgress({ 
          done: successCount.count + errors.length, 
          total: selectedClientIds.size 
        });
      }
    }

    if (errors.length > 0) {
      setBulkAssignErrors(errors);
    }

    // Show success message
    const total = selectedClientIds.size;
    if (successCount.count > 0) {
      if (errors.length === 0) {
        setNotice({ type: 'success', message: `Successfully assigned ${successCount.count} client${successCount.count !== 1 ? 's' : ''} to staff.` });
      } else {
        setNotice({ type: 'success', message: `Assigned ${successCount.count} client${successCount.count !== 1 ? 's' : ''}, but ${errors.length} failed.` });
      }
    }

    // Close modal and clear selections after short delay
    window.setTimeout(() => {
      closeBulkAssignModal();
      setSelectedClientIds(new Set());
      setNotice(null);
    }, 1500);
  }, [selectedClientIds, bulkSelectedStaffId, closeBulkAssignModal]);

  const handleToggleBulkClient = useCallback((clientId: string) => {
    setBulkModalClientIds(prev => {
      const next = new Set(prev);
      if (next.has(clientId)) {
        next.delete(clientId);
      } else {
        next.add(clientId);
      }
      return next;
    });
  }, []);
  const filteredClients = useMemo(() => {
  const query = search.trim().toLowerCase();
    return clients.filter((client) => {
      const matchesSearch =
        !query ||
        client.name.toLowerCase().includes(query) ||
        client.email.toLowerCase().includes(query);
      const matchesType = typeFilter === 'all' || client.clientType === typeFilter;
      const matchesPlan = planFilter === 'all' || client.planType === planFilter;
      const matchesStatus = statusFilter === 'all' || client.status === statusFilter;

      return matchesSearch && matchesType && matchesPlan && matchesStatus;
    });
  }, [clients, planFilter, search, statusFilter, typeFilter]);
  
  const sortedClients = useMemo(() => {
    const direction = sortDirection === 'asc' ? 1 : -1;

    return [...filteredClients].sort((first, second) => {
      // Always surface users registered today at the top for superadmin review.
      const firstToday = isCreatedToday(first.createdAt || first.joinedAt);
      const secondToday = isCreatedToday(second.createdAt || second.joinedAt);
      if (firstToday !== secondToday) {
        return firstToday ? -1 : 1;
      }
      if (firstToday && secondToday) {
        return second.joinedAt.localeCompare(first.joinedAt) || second.name.localeCompare(first.name);
      }

      if (sortField === 'name') {
        return first.name.localeCompare(second.name) * direction;
      }
      if (sortField === 'bizcardCount') {
        return (first.bizcardCount - second.bizcardCount) * direction;
      }
      if (sortField === 'joinedAt') {
        return first.joinedAt.localeCompare(second.joinedAt) * direction;
      }
      if (sortField === 'lastActivity') {
        return (activityRank(first.lastActivity) - activityRank(second.lastActivity)) * direction;
      }
      return first.status.localeCompare(second.status) * direction;
    });
  }, [filteredClients, sortDirection, sortField]);

  const paginatedClients = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedClients.slice(start, start + pageSize);
  }, [currentPage, pageSize, sortedClients]);

  const handleToggleAllOnPage = useCallback(() => {
    if (paginatedClients.length === 0) return;
    
    const pageClientIds = new Set(paginatedClients.map(c => c.id));
    const allSelected = pageClientIds.size === selectedClientIds.size && 
                        [...pageClientIds].every(id => selectedClientIds.has(id));
    
    if (allSelected) {
      // Deselect all on page
      setSelectedClientIds(prev => {
        const next = new Set(prev);
        pageClientIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      // Select all on page
      setSelectedClientIds(prev => {
        const next = new Set(prev);
        pageClientIds.forEach(id => next.add(id));
        return next;
      });
    }
  }, [paginatedClients, selectedClientIds]);

  const toggleSelectClient = useCallback((clientId: string) => {
    setSelectedClientIds(prev => {
      const next = new Set(prev);
      if (next.has(clientId)) {
        next.delete(clientId);
      } else {
        next.add(clientId);
      }
      return next;
    });
  }, []);

  const handleConfirmAssign = useCallback(
    async (forceReassign = false) => {
      if (!assignTarget || selectedStaffId === null) return;
      setAssignStep('submitting');
      setAssignError(null);

      try {
        const token = readStoredToken();
        const csrfToken = await csrfClient.getToken(false, getBackendUrl() || undefined);

        const response = await fetch(`${getBackendUrl()}/api/superadmin/assign-client`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
          },
          body: JSON.stringify({
            client_id: Number(assignTarget.id),
            staff_id: selectedStaffId,
            force_reassign: forceReassign,
          }),
        });

        const payload = (await response.json()) as {
          success?: boolean;
          data?: {
            already_assigned?: boolean;
            message?: string;
            staff_name?: string;
          };
          error?: {
            code?: string;
            message?: string;
            details?: {
              current_staff_id?: number;
              current_staff_name?: string;
            };
          };
        };

        if (response.status === 409 && payload.error?.code === 'CLIENT_ALREADY_ASSIGNED') {
          // Show reassign confirmation step
          setConflictInfo({
            current_staff_id: payload.error.details?.current_staff_id ?? 0,
            current_staff_name: payload.error.details?.current_staff_name ?? 'another staff member',
          });
          setAssignStep('confirm_reassign');
          return;
        }

        if (!response.ok) {
          throw new Error(
            payload.error?.message ?? 'Assignment failed. Please try again.'
          );
        }

        if (payload.data?.already_assigned) {
          setAssignStep('success');
          setNotice({
            type: 'success',
            message: payload.data.message ?? `Client is already assigned to ${payload.data.staff_name ?? 'this staff member'}.`,
          });
          return;
        }

        setAssignStep('success');
        setNotice({
          type: 'success',
          message: payload.data?.message ?? 'Client assigned successfully.',
        });

        // Close modal after a short success delay
        window.setTimeout(() => {
          closeAssignModal();
        }, 1200);
      } catch (error) {
        setAssignStep('error');
        setAssignError(error instanceof Error ? error.message : 'Assignment failed.');
      }
    },
    [assignTarget, selectedStaffId, closeAssignModal]
  );

  // Filtered staff list inside the modal (client-side search)
  const filteredStaffList = useMemo(() => {
    const q = staffSearchQuery.trim().toLowerCase();
    if (!q) return staffList;
    return staffList.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q) ||
        s.role.toLowerCase().includes(q) ||
        s.department.toLowerCase().includes(q)
    );
  }, [staffList, staffSearchQuery]);
  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(sortedClients.length / pageSize));
  }, [pageSize, sortedClients.length]);
  const firstVisibleItem =
    sortedClients.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastVisibleItem = Math.min(currentPage * pageSize, sortedClients.length);
  const filteredExportClientOptions = useMemo(() => {
    const query = exportClientSearch.trim().toLowerCase();
    if (!query) return clients;
    return clients.filter((client) => {
      return (
        client.name.toLowerCase().includes(query) ||
        client.email.toLowerCase().includes(query)
      );
    });
  }, [clients, exportClientSearch]);
  function toggleSort(field: SortField): void {
    if (sortField === field) {
      setSortDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortField(field);
    setSortDirection('asc');
  }
  function openExportModal(): void {
    setIsExportModalOpen(true);
  }
  function closeExportModal(): void {
    setIsExportModalOpen(false);
  }
  function toggleSelectedExportClient(id: string): void {
    setSelectedExportClientIds((prev) =>
      prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]
    );
  }
  const openSuspendConfirm = useCallback((client: ClientRecord) => {
    setSuspendConfirmTarget(client);
  }, []);

  const openDeleteConfirm = useCallback((client: ClientRecord) => {
    setDeleteConfirmTarget(client);
  }, []);

  const confirmSuspend = useCallback(async () => {
    if (!suspendConfirmTarget) return;
    const client = suspendConfirmTarget;
    const shouldSuspend = client.status !== 'Suspended';
    setSuspendLoading(true);
    setActionBusyClientId(client.id);
    setNotice(null);

    try {
      const token = readStoredToken();
      const csrfToken = await csrfClient.getToken(false, getBackendUrl() || undefined);
      const endpoint = shouldSuspend
        ? `${getBackendUrl()}/api/superadmin/clients/${client.id}/restrict`
        : `${getBackendUrl()}/api/superadmin/clients/${client.id}/unrestrict`;

      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        ...(shouldSuspend
          ? {
              body: JSON.stringify({
                duration_days: 365,
                reason: 'Suspended by super admin from Client Management',
              }),
            }
          : {}),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || (payload as { success?: boolean }).success === false) {
        throw new Error(
          extractErrorMessage(
            payload,
            shouldSuspend ? 'Failed to suspend user. Please try again.' : 'Failed to reactivate user. Please try again.',
          ),
        );
      }

      setClients((prev) =>
        prev.map((item) =>
          item.id === client.id
            ? {
                ...item,
                status: shouldSuspend ? 'Suspended' : 'Offline',
                isOnline: false,
              }
            : item,
        ),
      );
      setSuspendConfirmTarget(null);
      setNotice({
        type: 'success',
        message: shouldSuspend
          ? 'User suspended successfully.'
          : 'User reactivated successfully.',
      });
    } catch (error) {
      setNotice({
        type: 'error',
        message:
          error instanceof Error
            ? error.message
            : shouldSuspend
              ? 'Failed to suspend user. Please try again.'
              : 'Failed to reactivate user. Please try again.',
      });
    } finally {
      setSuspendLoading(false);
      setActionBusyClientId(null);
    }
  }, [suspendConfirmTarget]);

  const confirmDelete = useCallback(async () => {
    if (!deleteConfirmTarget) return;
    const client = deleteConfirmTarget;
    setDeleteLoading(true);
    setActionBusyClientId(client.id);
    setNotice(null);

    try {
      const token = readStoredToken();
      const csrfToken = await csrfClient.getToken(false, getBackendUrl() || undefined);

      // Resolve a claimed bizcard_id — list API does not return it.
      const detailResponse = await fetch(
        `${getBackendUrl()}/api/superadmin/clients/${client.id}`,
        {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
      );
      const detailPayload = await detailResponse.json().catch(() => ({}));
      if (!detailResponse.ok) {
        throw new Error(extractErrorMessage(detailPayload, 'Failed to load client details for deletion.'));
      }

      const detailData =
        (detailPayload as { data?: { bizcards?: Array<{ bizcard_id?: number | string }> } }).data ?? {};
      const bizcards = Array.isArray(detailData.bizcards) ? detailData.bizcards : [];
      const bizcardId = bizcards[0]?.bizcard_id;
      if (bizcardId == null || String(bizcardId).trim() === '') {
        throw new Error(
          'This user has no claimed BizCard. Delete is only available for users with an associated BizCard.',
        );
      }

      const deleteResponse = await fetch(
        `${getBackendUrl()}/api/superadmin/bizcards/${encodeURIComponent(String(bizcardId))}`,
        {
          method: 'DELETE',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
          },
        },
      );
      const deletePayload = await deleteResponse.json().catch(() => ({}));
      if (!deleteResponse.ok || (deletePayload as { success?: boolean }).success === false) {
        throw new Error(
          extractErrorMessage(deletePayload, 'Failed to move user to Recycle Bin. Please try again.'),
        );
      }

      setClients((prev) => prev.filter((item) => item.id !== client.id));
      setActivitySummary((prev) => ({
        ...prev,
        total_clients: Math.max(0, prev.total_clients - 1),
      }));
      setDeleteConfirmTarget(null);
      setNotice({ type: 'success', message: 'User moved to Recycle Bin successfully.' });
    } catch (error) {
      setNotice({
        type: 'error',
        message:
          error instanceof Error ? error.message : 'Failed to move user to Recycle Bin. Please try again.',
      });
    } finally {
      setDeleteLoading(false);
      setActionBusyClientId(null);
    }
  }, [deleteConfirmTarget]);
  async function fetchPendingRequestClientIds(): Promise<void> {
    try {
      const token = readStoredToken();
      const response = await fetch(`${getBackendUrl()}/api/superadmin/companies/pending-requests?page=1&limit=100`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (!response.ok) return;
      const payload = (await response.json()) as {
        data?: {
          requests?: Array<{
            client_id?: string | number;
            user_id?: string | number;
            created_by?: { user_id?: string | number } | null;
            status?: string;
          }>;
        };
      };
      const ids = new Set<string>();
      for (const request of payload.data?.requests ?? []) {
        if (String(request.status ?? '').toLowerCase() !== 'pending') continue;
        const candidate = request.client_id ?? request.user_id ?? request.created_by?.user_id;
        if (candidate !== undefined && candidate !== null) {
          ids.add(String(candidate));
        }
      }
      setPendingRequestClientIds(ids);
    } catch {
    }
  }
  async function handleCreatePendingRequest(client: ClientRecord): Promise<void> {
    const confirmed = await showConfirmDialog({
      title: "Send for admin approval?",
      message: `${client.name} will be submitted to a Super Admin for review as a company admin.`,
      confirmLabel: "Send for approval",
      variant: "primary",
    });
    if (!confirmed) return;
    setCreatingPendingClientId(client.id);
    setNotice(null);
    try {
      const token = readStoredToken();
      const response = await fetch(`${getBackendUrl()}/api/superadmin/companies/pending-requests`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          client_id: client.id,
          user_id: client.id,
          role: 'company_admin',
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, 'Failed to create pending approval request.'));
      }
      setPendingRequestClientIds((prev) => new Set(prev).add(client.id));
      setNotice({ type: 'success', message: 'Approval request sent to Pending Requests.' });
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('superadmin_pending_requests_refresh', String(Date.now()));
      }
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to create pending approval request.',
      });
    } finally {
      setCreatingPendingClientId(null);
    }
  }

  function runExport(): void {
    let rows = [...clients];

    if (exportScope === 'specific') {
      if (selectedExportClientIds.length === 0) {
        void showAlertDialog({
          title: "Select clients to export",
          message:
            "You chose to export specific records. Please select at least one client before exporting.",
          confirmLabel: "Got it",
        });
        return;
      }

      rows = rows.filter((row) => selectedExportClientIds.includes(row.id));

      if (exportPlanType !== 'all') {
        rows = rows.filter((row) => row.planType === exportPlanType);
      }

      if (datePreset === 'custom' && customStartDate && customEndDate) {
        const customStart = toDayDate(customStartDate);
        const customEnd = toDayDate(customEndDate);
        customEnd.setHours(23, 59, 59, 999);

        rows = rows.filter((row) => {
          const rowDate = toDayDate(row.createdAt);
          return rowDate >= customStart && rowDate <= customEnd;
        });
      }

      if (datePreset !== 'custom') {
        const range = getDatePresetRange(datePreset);
        if (range) {
          rows = rows.filter((row) => {
            const rowDate = toDayDate(row.createdAt);
            return rowDate >= range.start && rowDate <= range.end;
          });
        }
      }
    }

    const header = ['Name', 'Email', 'Bizcards', 'Joined', 'Type', 'Last Activity', 'Session'];
    const body = rows.map((row) => [
      row.name,
      row.email,
      String(row.bizcardCount),
      row.joinedAt,
      row.clientType,
      row.lastActivity,
      row.status,
    ]);

    const csv = [header, ...body]
      .map((line) => line.map((value) => csvEscape(value)).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'client-records-export.csv';
    anchor.click();
    window.URL.revokeObjectURL(url);

    console.log('Client export finished', {
      scope: exportScope,
      subscriptionType: exportPlanType,
      datePreset,
      selectedClients: selectedExportClientIds,
      exportedRows: rows.length,
    });

    closeExportModal();
  }

  useEffect(() => {
    let isMounted = true;

    async function fetchSummaryOnly(): Promise<void> {
      try {
        const token = readStoredToken();
        const summaryResponse = await fetch(`${getBackendUrl()}/api/superadmin/clients/summary`, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!summaryResponse.ok) return;
        const summaryPayload = await summaryResponse.json();
        if (isMounted) {
          setActivitySummary(mapActivitySummary(summaryPayload));
          setSummaryLoading(false);
        }
      } catch {
        // Keep previous summary on poll failure
      }
    }

    async function fetchClientsFromBackend(): Promise<void> {
      try {
        const token = readStoredToken();
        // Fetch all client records so search works across the entire dataset,
        // not just the first page. The UI paginates client-side (6 per page).
        const listResponse = await fetch(`${getBackendUrl()}/api/superadmin/clients?page=1&limit=10000`, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });

        if (!listResponse.ok) {
          throw new Error(`Failed to load clients: ${listResponse.status}`);
        }

        const listPayload = await listResponse.json();
        const listRows = extractListPayload(listPayload);
        const mappedClients = listRows.map(mapApiClientToRecord);

        if (isMounted) {
          setClients(mappedClients);
        }

        const summaryResponse = await fetch(`${getBackendUrl()}/api/superadmin/clients/summary`, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });

        if (!summaryResponse.ok) {
          throw new Error(`Failed to load client summary: ${summaryResponse.status}`);
        }

        const summaryPayload = await summaryResponse.json();
        if (isMounted) {
          setActivitySummary(mapActivitySummary(summaryPayload));
          setSummaryLoading(false);
        }
      } catch (error) {
        console.error('Superadmin client list fetch error:', error);
        if (isMounted) {
          setClients([]);
          setActivitySummary(EMPTY_ACTIVITY_SUMMARY);
          setSummaryLoading(false);
        }
      }
    }

    void fetchClientsFromBackend();
    void fetchPendingRequestClientIds();
    const pollId = window.setInterval(() => {
      void fetchSummaryOnly();
    }, 30000);

    return () => {
      isMounted = false;
      window.clearInterval(pollId);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    setCurrentPage(1);
  }, [planFilter, search, sortDirection, sortField, statusFilter, typeFilter]);

  useEffect(() => {
    if (currentPage <= totalPages) return;
    setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  return (
    <section className="space-y-5 sm:space-y-6">
      <PortalPageHeader
        title="Client Management"
        subtitle="Search, filter, and export user accounts across the platform."
        actions={
          <>
            <button
              type="button"
              onClick={openExportModal}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-gray-50"
            >
              <Download className="h-4 w-4" />
              Export
            </button>
            <button
              type="button"
              onClick={openBulkAssignModal}
              disabled={selectedClientIds.size === 0}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#3a6fcf] bg-[#4f93c8] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#3f84b8] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <UserCheck className="h-4 w-4" />
              Assign
              {selectedClientIds.size > 0 && (
                <span className="ml-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold text-white">
                  {selectedClientIds.size}
                </span>
              )}
            </button>
          </>
        }
      />
      {notice && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            notice.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-rose-200 bg-rose-50 text-rose-700'
          }`}
        >
          {notice.message}
        </div>
      )}
      <ClientActivitySummaryCards summary={activitySummary} loading={summaryLoading} />

      <div className="flex flex-col gap-3 rounded-2xl border border-[#d7e3f3] bg-white p-3 shadow-sm">
        <div className="relative w-full">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8496bb]" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, email, plan, type..."
            className="h-11 w-full rounded-xl border border-[#d4e0f1] bg-[#f9fbff] pl-10 pr-8 text-sm text-[#2b467c] outline-none transition-colors focus:border-[#89addd]"
          />
          {search.trim().length > 0 && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-[#8496bb] hover:text-[#4f6897] focus:outline-none"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-center">
          <div className="relative min-w-0 sm:min-w-42">
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as 'all' | ClientType)}
              className="h-11 w-full min-w-0 appearance-none rounded-xl border border-[#d4e0f1] bg-[#f9fbff] px-3 pr-8 text-sm font-semibold text-[#4e6697] outline-none transition-colors focus:border-[#89addd] sm:w-auto sm:min-w-42"
            >
              <option value="all">All types</option>
              <option value="Individual">Individual</option>
              <option value="Business">Business</option>
              <option value="Enterprise">Enterprise</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6f84ad]" />
          </div>
          <div className="relative min-w-0 sm:min-w-42">
            <select
              value={planFilter}
              onChange={(event) => setPlanFilter(event.target.value as 'all' | PlanType)}
              className="h-11 w-full min-w-0 appearance-none rounded-xl border border-[#d4e0f1] bg-[#f9fbff] px-3 pr-8 text-sm font-semibold text-[#4e6697] outline-none transition-colors focus:border-[#89addd] sm:w-auto sm:min-w-42"
            >
              <option value="all">All Plans</option>
              <option value="Basic">Basic</option>
              <option value="Standard">Standard</option>
              <option value="Premium">Premium</option>
              <option value="Enterprise">Enterprise</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6f84ad]" />
          </div>
          <div className="relative min-w-0 sm:min-w-42">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as 'all' | ClientStatus)}
              className="h-11 w-full min-w-0 appearance-none rounded-xl border border-[#d4e0f1] bg-[#f9fbff] px-3 pr-8 text-sm font-semibold text-[#4e6697] outline-none transition-colors focus:border-[#89addd] sm:w-auto sm:min-w-42"
            >
              <option value="all">All Sessions</option>
              <option value="Online">Online</option>
              <option value="Offline">Offline</option>
              <option value="Suspended">Suspended</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6f84ad]" />
          </div>
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setTypeFilter('all');
              setPlanFilter('all');
              setStatusFilter('all');
              setSortField('name');
              setSortDirection('asc');
            }}
            className="h-11 w-full rounded-xl border border-[#d4e0f1] px-3 text-sm font-semibold text-[#536c99] transition-colors hover:bg-[#f7fbff] sm:w-auto"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#d7e3f3] bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-210 w-full border-collapse">
            <thead className="bg-[#f7fbff]">
              <tr className="border-b border-[#deebf8] text-left text-sm font-semibold text-[#4f638e]">
                <th className="px-5 py-4 w-10">
                  <input
                    type="checkbox"
                    checked={paginatedClients.length > 0 && paginatedClients.every(c => selectedClientIds.has(c.id)) && paginatedClients.length > 0}
                    onChange={handleToggleAllOnPage}
                    className="h-4 w-4 accent-[#4f93c8]"
                    aria-label="Select all clients on page"
                  />
                </th>
                <th className="px-5 py-4">
                  <button
                    type="button"
                    onClick={() => toggleSort('name')}
                    className="inline-flex items-center gap-1.5 transition-colors hover:text-[#2f558f]"
                  >
                    Client
                    <ArrowUpDown className="h-3.5 w-3.5" />
                    <span className="text-[10px] uppercase text-[#8ea3c8]">
                      {sortField === 'name' ? sortDirection : ''}
                    </span>
                  </button>
                </th>
                <th className="px-5 py-4">
                  <button
                    type="button"
                    onClick={() => toggleSort('bizcardCount')}
                    className="inline-flex items-center gap-1.5 transition-colors hover:text-[#2f558f]"
                  >
                    Bizcards
                    <ArrowUpDown className="h-3.5 w-3.5" />
                    <span className="text-[10px] uppercase text-[#8ea3c8]">
                      {sortField === 'bizcardCount' ? sortDirection : ''}
                    </span>
                  </button>
                </th>
                <th className="px-5 py-4">
                  <button
                    type="button"
                    onClick={() => toggleSort('joinedAt')}
                    className="inline-flex items-center gap-1.5 transition-colors hover:text-[#2f558f]"
                  >
                    Joined
                    <ArrowUpDown className="h-3.5 w-3.5" />
                    <span className="text-[10px] uppercase text-[#8ea3c8]">
                      {sortField === 'joinedAt' ? sortDirection : ''}
                    </span>
                  </button>
                </th>
                <th className="px-5 py-4">
                  <button
                    type="button"
                    onClick={() => toggleSort('lastActivity')}
                    className="inline-flex items-center gap-1.5 transition-colors hover:text-[#2f558f]"
                  >
                    Last Activity
                    <ArrowUpDown className="h-3.5 w-3.5" />
                    <span className="text-[10px] uppercase text-[#8ea3c8]">
                      {sortField === 'lastActivity' ? sortDirection : ''}
                    </span>
                  </button>
                </th>
                <th className="px-5 py-4">
                  <button
                    type="button"
                    onClick={() => toggleSort('status')}
                    className="inline-flex items-center gap-1.5 transition-colors hover:text-[#2f558f]"
                  >
                    Session
                    <ArrowUpDown className="h-3.5 w-3.5" />
                    <span className="text-[10px] uppercase text-[#8ea3c8]">
                      {sortField === 'status' ? sortDirection : ''}
                    </span>
                  </button>
                </th>
                <th className="px-5 py-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {paginatedClients.length > 0 ? (
                paginatedClients.map((client, index) => (
                  <motion.tr
                    key={client.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.24, delay: index * 0.04 }}
                    className="border-b border-[#edf3fb] text-sm text-[#556a95] last:border-b-0 hover:bg-[#f0f6ff]"
                  >
                    <td className="px-5 py-4 w-10">
                      <input
                        type="checkbox"
                        checked={selectedClientIds.has(client.id)}
                        onChange={() => toggleSelectClient(client.id)}
                        className="h-4 w-4 accent-[#4f93c8]"
                        aria-label={`Select ${client.name}`}
                      />
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <ClientAvatar
                          name={client.name}
                          initials={client.initials}
                          imageUrl={client.profileImage}
                          themeClass={avatarTheme(index + (currentPage - 1) * pageSize)}
                        />
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void handleImpersonateClient(client)}
                              disabled={impersonatingClientId === client.id}
                              className="truncate text-sm font-semibold text-[#31496f] hover:text-[#2a5cbf] hover:underline focus:outline-none focus-visible:underline disabled:cursor-not-allowed disabled:opacity-60 text-left"
                              title={`Impersonate ${client.name}`}
                            >
                              {client.name}
                            </button>
                            {isCreatedToday(client.createdAt || client.joinedAt) ? (
                              <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-200">
                                New today
                              </span>
                            ) : null}
                          </div>
                          <p className="truncate text-xs text-[#7387ad]">{client.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-sm font-semibold text-[#2d4f91]">
                        {client.bizcardCount}{' '}
                        <span className="text-[#6f86b0]">
                          bizcard{client.bizcardCount === 1 ? '' : 's'}
                        </span>
                      </p>
                      <span className="mt-1 inline-flex rounded-full bg-[#e9f2ff] px-2 py-0.5 text-[11px] font-semibold capitalize text-[#4c6ea5]">
                        {client.clientType.toLowerCase()}
                      </span>
                    </td>
                    <td className="px-5 py-4 font-medium text-[#5f739d]">{client.joinedAt}</td>
                    <td className="px-5 py-4 font-medium text-[#5f739d]">{client.lastActivity}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(client.status)}`}>
                        {client.status}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void openAssignModal(client); }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#c8ddf6] bg-[#eef6ff] text-[#3a6fcf] transition-colors hover:bg-[#d8ecff] hover:text-[#2a5cbf]"
                          aria-label={`Assign ${client.name} to staff`}
                          title="Assign to Staff"
                        >
                          <UserCheck className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void openViewModal(client); }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#c8e0f6] bg-[#eef6ff] text-[#3a6fcf] transition-colors hover:bg-[#d8ecff] hover:text-[#2a5cbf]"
                          aria-label={`View ${client.name}`}
                          title="View profile"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void handleImpersonateClient(client); }}
                          disabled={impersonatingClientId === client.id}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#c5daf5] bg-[#f0f7ff] text-[#4f83c8] transition-colors hover:bg-[#daeeff] hover:text-[#3a6fcf] disabled:cursor-not-allowed disabled:opacity-60"
                          aria-label={`Impersonate ${client.name}`}
                          title="Impersonate user"
                        >
                          {impersonatingClientId === client.id ? (
                            <InlineLoader />
                          ) : (
                            <Pencil className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); openSuspendConfirm(client); }}
                          disabled={actionBusyClientId === client.id}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-700 transition-colors hover:bg-amber-100 hover:text-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
                          aria-label={client.status === 'Suspended' ? `Reactivate ${client.name}` : `Suspend ${client.name}`}
                          title={client.status === 'Suspended' ? 'Reactivate account' : 'Suspend account'}
                        >
                          {actionBusyClientId === client.id && suspendLoading ? (
                            <InlineLoader />
                          ) : client.status === 'Suspended' ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Ban className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); openDeleteConfirm(client); }}
                          disabled={actionBusyClientId === client.id}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-600 transition-colors hover:bg-rose-100 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                          aria-label={`Delete ${client.name}`}
                          title="Delete user"
                        >
                          {actionBusyClientId === client.id && deleteLoading ? (
                            <InlineLoader />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-5 py-14 text-center text-sm font-semibold text-[#6b7ea5]">
                    No clients match the current search and filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>


        {sortedClients.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-[#e7eef9] px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((previous) => Math.max(1, previous - 1))}
                disabled={currentPage === 1}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#d6e3f6] text-[#5d759f] transition-colors hover:bg-[#f3f8ff] disabled:cursor-not-allowed disabled:opacity-45"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="rounded-lg border border-[#d6e3f6] px-3 py-1 text-xs font-semibold text-[#5d759f]">
                Page {currentPage} of {totalPages}
              </span>

              <button
                type="button"
                onClick={() => setCurrentPage((previous) => Math.min(totalPages, previous + 1))}
                disabled={currentPage >= totalPages}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#d6e3f6] text-[#5d759f] transition-colors hover:bg-[#f3f8ff] disabled:cursor-not-allowed disabled:opacity-45"
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <PortalModal
        open={isExportModalOpen}
        onClose={closeExportModal}
        title="Export Records"
        description="Select export scope and filters for client records."
        size="xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={closeExportModal}
              className="rounded-xl border border-[#d4e0f1] bg-white px-4 py-2 text-sm font-semibold text-[#5a7098] transition-colors hover:bg-[#f5f9ff]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={runExport}
              className="rounded-xl border border-[#3f86be] bg-[#4f93c8] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#3f84b8]"
            >
              Export
            </button>
          </div>
        }
      >
        <div className="space-y-5">
                      <div className="space-y-3">
                        <p className="text-sm font-semibold text-[#41587f]">Export Scope</p>

                        <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-[#d8e4f5] px-3 py-2 text-sm font-medium text-[#4f658f] transition-colors hover:bg-[#f7fbff]">
                          <input
                            type="radio"
                            name="exportScope"
                            checked={exportScope === 'all'}
                            onChange={() => setExportScope('all')}
                            className="h-4 w-4 accent-[#4f93c8]"
                          />
                          <span>All (Default)</span>
                        </label>

                        <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-[#d8e4f5] px-3 py-2 text-sm font-medium text-[#4f658f] transition-colors hover:bg-[#f7fbff]">
                          <input
                            type="radio"
                            name="exportScope"
                            checked={exportScope === 'specific'}
                            onChange={() => setExportScope('specific')}
                            className="h-4 w-4 accent-[#4f93c8]"
                          />
                          <span>Specific Record</span>
                        </label>
                      </div>

                      <div className={exportScope === 'specific' ? '' : 'opacity-55'}>
                        <div className="space-y-3">
                          <div>
                            <p className="mb-1 text-sm font-semibold text-[#41587f]">Client Name/s</p>
                            <div className="relative">
                              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8496bb]" />
                              <input
                                type="text"
                                value={exportClientSearch}
                                onChange={(event) => setExportClientSearch(event.target.value)}
                                disabled={exportScope !== 'specific'}
                                placeholder="Search client name or email"
                                className="h-11 w-full rounded-xl border border-[#d4e0f1] bg-[#f9fbff] pl-10 pr-3 text-sm text-[#2b467c] outline-none transition-colors focus:border-[#89addd] disabled:cursor-not-allowed"
                              />
                            </div>
                          </div>

                          <div className="max-h-40 overflow-y-auto rounded-xl border border-[#d8e4f5]">
                            {filteredExportClientOptions.map((client) => (
                              <button
                                key={client.id}
                                type="button"
                                disabled={exportScope !== 'specific'}
                                onClick={() => toggleSelectedExportClient(client.id)}
                                className="flex w-full items-center justify-between gap-3 border-b border-[#edf3fb] px-3 py-2 text-left text-sm text-[#52678f] transition-colors last:border-b-0 hover:bg-[#f8fbff] disabled:cursor-not-allowed"
                              >
                                <span className="truncate">{client.name} ({client.email})</span>
                                <span className={`inline-flex h-5 w-5 items-center justify-center rounded border ${selectedExportClientIds.includes(client.id) ? 'border-[#4f93c8] bg-[#4f93c8] text-white' : 'border-[#c6d7ee] bg-white text-transparent'}`}>
                                  <Check className="h-3.5 w-3.5" />
                                </span>
                              </button>
                            ))}
                          </div>

                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="relative">
                              <p className="mb-1 text-sm font-semibold text-[#41587f]">Subscription Type</p>
                              <select
                                value={exportPlanType}
                                onChange={(event) => setExportPlanType(event.target.value as 'all' | PlanType)}
                                disabled={exportScope !== 'specific'}
                                className="h-11 w-full appearance-none rounded-xl border border-[#d4e0f1] bg-[#f9fbff] px-3 pr-8 text-sm text-[#2b467c] outline-none transition-colors focus:border-[#89addd] disabled:cursor-not-allowed"
                              >
                                <option value="all">All</option>
                                <option value="Basic">Basic</option>
                                <option value="Standard">Standard</option>
                                <option value="Premium">Premium</option>
                                <option value="Enterprise">Enterprise</option>
                              </select>
                              <ChevronDown className="pointer-events-none absolute right-3 top-9.5 h-4 w-4 text-[#6f84ad]" />
                            </div>

                            <div className="relative">
                              <p className="mb-1 text-sm font-semibold text-[#41587f]">Date Range</p>
                              <select
                                value={datePreset}
                                onChange={(event) => setDatePreset(event.target.value as DatePreset)}
                                disabled={exportScope !== 'specific'}
                                className="h-11 w-full appearance-none rounded-xl border border-[#d4e0f1] bg-[#f9fbff] px-3 pr-8 text-sm text-[#2b467c] outline-none transition-colors focus:border-[#89addd] disabled:cursor-not-allowed"
                              >
                                <option value="today">Today</option>
                                <option value="yesterday">Yesterday</option>
                                <option value="this_week">This Week</option>
                                <option value="this_month">This Month</option>
                                <option value="custom">Custom Date Range</option>
                              </select>
                              <ChevronDown className="pointer-events-none absolute right-3 top-9.5 h-4 w-4 text-[#6f84ad]" />
                            </div>
                          </div>

                          {datePreset === 'custom' && (
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <input
                                type="date"
                                value={customStartDate}
                                onChange={(event) => setCustomStartDate(event.target.value)}
                                disabled={exportScope !== 'specific'}
                                className="h-11 w-full rounded-xl border border-[#d4e0f1] bg-[#f9fbff] px-3 text-sm text-[#2b467c] outline-none transition-colors focus:border-[#89addd] disabled:cursor-not-allowed"
                              />
                              <input
                                type="date"
                                value={customEndDate}
                                onChange={(event) => setCustomEndDate(event.target.value)}
                                disabled={exportScope !== 'specific'}
                                className="h-11 w-full rounded-xl border border-[#d4e0f1] bg-[#f9fbff] px-3 text-sm text-[#2b467c] outline-none transition-colors focus:border-[#89addd] disabled:cursor-not-allowed"
                              />
                            </div>
                          )}
                        </div>
                      </div>
        </div>
      </PortalModal>

      {/* ── Client Assignment Modal ──────────────────────────────── */}
      <PortalModal
        open={Boolean(assignTarget)}
        onClose={closeAssignModal}
        title="Assign Client to Staff"
        description={
          assignTarget
            ? `Select a staff member to assign to ${assignTarget.name} (${assignTarget.email}).`
            : undefined
        }
        size="md"
        preventClose={assignStep === 'submitting'}
        footer={
          assignStep === 'select' ? (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeAssignModal}
                className="rounded-xl border border-[#d3dff0] bg-white px-4 py-2 text-sm font-semibold text-[#5f739b] hover:bg-[#f5faff]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={selectedStaffId === null}
                onClick={() => void handleConfirmAssign(false)}
                className="inline-flex items-center gap-2 rounded-xl bg-[#3a6fcf] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#2d5db8] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <UserCheck className="h-4 w-4" />
                Assign
              </button>
            </div>
          ) : assignStep === 'confirm_reassign' ? (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAssignStep('select')}
                className="rounded-xl border border-[#d3dff0] bg-white px-4 py-2 text-sm font-semibold text-[#5f739b] hover:bg-[#f5faff]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmAssign(true)}
                className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
              >
                Reassign Anyway
              </button>
            </div>
          ) : assignStep === 'error' ? (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setAssignStep('select'); setAssignError(null); }}
                className="rounded-xl border border-[#d3dff0] bg-white px-4 py-2 text-sm font-semibold text-[#5f739b] hover:bg-[#f5faff]"
              >
                Try Again
              </button>
              <button
                type="button"
                onClick={closeAssignModal}
                className="rounded-xl border border-[#d3dff0] bg-white px-4 py-2 text-sm font-semibold text-[#5f739b] hover:bg-[#f5faff]"
              >
                Close
              </button>
            </div>
          ) : null
        }
      >
        {/* ── Loading state ───────────────────────────────── */}
        {staffLoading && (
          <SectionLoader text="Loading staff members…" />
        )}

        {/* ── Error loading staff ──────────────────────────── */}
        {!staffLoading && assignError && assignStep !== 'error' && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            {assignError}
          </div>
        )}

        {/* ── Staff selection list ─────────────────────────── */}
        {!staffLoading && !assignError && assignStep === 'select' && (
          <div className="space-y-3">
            {/* Search box */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8496bb]" />
              <input
                type="text"
                value={staffSearchQuery}
                onChange={(e) => setStaffSearchQuery(e.target.value)}
                placeholder="Search by name, email, role…"
                className="h-10 w-full rounded-xl border border-[#d4e0f1] bg-[#f9fbff] pl-10 pr-3 text-sm text-[#2b467c] outline-none transition-colors focus:border-[#89addd]"
              />
            </div>

            {filteredStaffList.length === 0 ? (
              <p className="py-6 text-center text-sm font-semibold text-[#7387ad]">
                {staffList.length === 0
                  ? 'No active staff members found. Please add staff first.'
                  : 'No staff members match your search.'}
              </p>
            ) : (
              <ul className="max-h-72 divide-y divide-[#edf3fb] overflow-y-auto rounded-xl border border-[#d4e0f1]">
                {filteredStaffList.map((staffMember) => {
                  const isSelected = selectedStaffId === staffMember.user_id;
                  return (
                    <li key={staffMember.staff_id}>
                      <button
                        type="button"
                        onClick={() => setSelectedStaffId(staffMember.user_id)}
                        className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
                          isSelected
                            ? 'bg-[#eef6ff] ring-1 ring-inset ring-[#3a6fcf]'
                            : 'hover:bg-[#f7fbff]'
                        }`}
                      >
                        {/* Avatar */}
                        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#d8ecff] text-xs font-bold text-[#3a6fcf]">
                          {staffMember.name
                            .split(' ')
                            .map((n) => n[0])
                            .join('')
                            .toUpperCase()
                            .slice(0, 2)}
                        </span>
                        {/* Info */}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-[#2b467c]">
                            {staffMember.name}
                          </p>
                          <p className="truncate text-xs text-[#7387ad]">{staffMember.email}</p>
                          <p className="text-xs text-[#9aaac4]">
                            {staffMember.role} · {staffMember.department}
                          </p>
                        </div>
                        {/* Client count badge */}
                        <span className="shrink-0 rounded-full border border-[#d4e0f1] bg-[#f3f7ff] px-2 py-0.5 text-xs font-semibold text-[#5a7098]">
                          {staffMember.assigned_client_count} client
                          {staffMember.assigned_client_count !== 1 ? 's' : ''}
                        </span>
                        {/* Selected checkmark */}
                        {isSelected && (
                          <Check className="h-4 w-4 shrink-0 text-[#3a6fcf]" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* ── Reassign confirmation step ──────────────────── */}
        {assignStep === 'confirm_reassign' && conflictInfo && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm">
            <p className="font-semibold text-amber-800">Client already assigned</p>
            <p className="mt-1 text-amber-700">
              <strong>{assignTarget?.name}</strong> is currently assigned to{' '}
              <strong>{conflictInfo.current_staff_name}</strong>. Do you want to reassign them to
              the newly selected staff member?
            </p>
            <p className="mt-2 text-xs text-amber-600">
              The previous assignment will be deactivated and a new one will be created.
            </p>
          </div>
        )}

        {/* ── Submitting spinner ───────────────────────────── */}
        {assignStep === 'submitting' && (
          <SectionLoader text="Assigning client…" />
        )}

        {/* ── Success state ────────────────────────────────── */}
        {assignStep === 'success' && (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
              <Check className="h-6 w-6 text-emerald-600" />
            </span>
            <p className="text-sm font-semibold text-emerald-700">
              Client assigned successfully!
            </p>
            <p className="text-xs text-[#7387ad]">
              The staff member has been notified in real time.
            </p>
          </div>
        )}

        {/* ── Error state ──────────────────────────────────── */}
        {assignStep === 'error' && assignError && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            {assignError}
          </div>
        )}
      </PortalModal>

      {/* ── Bulk Assign Modal ──────────────────────────────────── */}
      <PortalModal
        open={bulkAssignOpen}
        onClose={closeBulkAssignModal}
        title="Assign Clients to Staff"
        description="Select a staff member to assign the selected clients to. Review and confirm the selection below."
        size="lg"
        preventClose={bulkSubmitting}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={closeBulkAssignModal}
              disabled={bulkSubmitting}
              className="rounded-xl border border-[#d3dff0] bg-white px-4 py-2 text-sm font-semibold text-[#5f739b] hover:bg-[#f5faff] disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleBulkAssign()}
              disabled={bulkSelectedStaffId === null || bulkModalClientIds.size === 0 || bulkSubmitting}
              className="inline-flex items-center gap-2 rounded-xl bg-[#3a6fcf] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#2d5db8] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <UserCheck className="h-4 w-4" />
              {bulkSubmitting ? 'Assigning...' : `Assign Clients (${bulkModalClientIds.size})`}
            </button>
          </div>
        }
      >
        {/* ── Loading staff list ────────────────────────────── */}
        {bulkStaffLoading && (
          <SectionLoader text="Loading staff members…" />
        )}

        {/* ── Error loading staff ──────────────────────────── */}
        {!bulkStaffLoading && bulkAssignErrors.length > 0 && (
          <div className="space-y-2">
            {bulkAssignErrors.map((error, index) => (
              <div key={index} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                {error}
              </div>
            ))}
          </div>
        )}

        {/* ── Staff selection ──────────────────────────────── */}
        {!bulkStaffLoading && bulkAssignErrors.length === 0 && (
          <div className="space-y-5">
            {/* Staff dropdown */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-[#41587f]">Assign to Staff</label>
              <select
                value={bulkSelectedStaffId ?? ''}
                onChange={(e) => setBulkSelectedStaffId(e.target.value ? Number(e.target.value) : null)}
                disabled={bulkSubmitting}
                className="h-11 w-full rounded-xl border border-[#d3dff0] bg-[#f9fbff] px-3 text-sm text-[#2b467c] outline-none focus:border-[#8fb2df] disabled:opacity-60"
              >
                <option value="" disabled>— Select a staff member —</option>
                {bulkAssignStaffList.map((staff) => (
                  <option key={staff.staff_id} value={staff.user_id}>
                    {staff.name} ({staff.email}) - {staff.role} · {staff.department}
                  </option>
                ))}
              </select>
            </div>

            {/* Selected users list */}
            {bulkSelectedStaffId !== null && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-[#41587f]">
                    Selected Clients ({bulkModalClientIds.size})
                  </label>
                  <span className="text-xs text-[#6f82a8]">
                    Check/uncheck to include/exclude users
                  </span>
                </div>
                <div className="max-h-64 overflow-y-auto rounded-xl border border-[#d4e0f1] bg-[#f9fbff]">
                  {paginatedClients.filter(c => bulkModalClientIds.has(c.id)).length === 0 ? (
                    <div className="py-8 text-center text-sm text-[#7387ad]">
                      No selected clients to display
                    </div>
                  ) : (
                    paginatedClients
                      .filter(c => bulkModalClientIds.has(c.id))
                      .map((client) => (
                        <div
                          key={client.id}
                          className="flex items-center justify-between px-4 py-3 border-b border-[#edf3fb] last:border-b-0"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-[#2b467c]">
                              {client.name}
                            </p>
                            <p className="truncate text-xs text-[#7387ad]">{client.email}</p>
                          </div>
                          <input
                            type="checkbox"
                            checked={bulkModalClientIds.has(client.id)}
                            onChange={() => handleToggleBulkClient(client.id)}
                            disabled={bulkSubmitting}
                            className="h-4 w-4 accent-[#4f93c8] disabled:opacity-60"
                            aria-label={`Select ${client.name}`}
                          />
                        </div>
                      ))
                  )}
                </div>
              </div>
            )}

            {/* Notice text */}
            {bulkSelectedStaffId !== null && (
              <div className="rounded-xl border border-[#d3dff0] bg-[#f9fbff] px-4 py-3 text-sm">
                <p className="text-[#41587f]">
                  <span className="font-semibold">Are you sure you will assign the selected users to staff</span> "
                  <span className="font-bold text-[#2b467c]">
                    {bulkAssignStaffList.find(s => s.user_id === bulkSelectedStaffId)?.name ?? 'Selected Staff'}
                  </span>"
                  ?
                </p>
              </div>
            )}

            {/* Progress indicator */}
            {bulkAssignProgress && (
              <div className="rounded-xl border border-[#d3dff0] bg-[#f9fbff] px-4 py-3 text-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[#41587f]">Assigning clients...</span>
                  <span className="text-[#6f82a8]">
                    {bulkAssignProgress.done} / {bulkAssignProgress.total}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-[#e4edf9] overflow-hidden">
                  <div
                    className="h-full bg-[#3a6fcf] transition-all duration-300"
                    style={{
                      width: `${Math.min(100, (bulkAssignProgress.done / bulkAssignProgress.total) * 100)}%`
                    }}
                  />
                </div>
              </div>
            )}

            {/* Errors display */}
            {bulkAssignErrors.length > 0 && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm">
                <p className="font-semibold text-rose-800 mb-2">Assignment issues:</p>
                <ul className="list-disc list-inside text-rose-700 space-y-1">
                  {bulkAssignErrors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </PortalModal>

      {/* ── View Client Modal ──────────────────────────────────── */}
      <PortalModal
        open={Boolean(viewTarget)}
        onClose={closeViewModal}
        title="Client Profile"
        description={viewTarget ? `Viewing full profile for ${viewTarget.name}` : undefined}
        size="lg"
        footer={
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={closeViewModal}
              className="rounded-xl border border-[#d3dff0] bg-white px-5 py-2 text-sm font-semibold text-[#5a7098] transition-colors hover:bg-[#f5faff]"
            >
              Close
            </button>
          </div>
        }
      >
        {viewLoading && (
          <SectionLoader text="Loading profile…" />
        )}

        {!viewLoading && viewError && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            {viewError}
          </div>
        )}

        {!viewLoading && viewTarget && (
          <div className="space-y-5">
            {/* ── Header card ── */}
            <div className="flex flex-col items-center gap-4 rounded-2xl border border-[#deeaf8] bg-gradient-to-br from-[#f7fbff] to-[#edf4fd] p-6 sm:flex-row sm:items-start">
              <span className={`inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-xl font-bold shadow-sm ${avatarTheme(0)}`}>
                {viewTarget.initials}
              </span>
              <div className="min-w-0 flex-1 text-center sm:text-left">
                <h3 className="text-xl font-bold text-[#1e3a6e]">{viewTarget.name}</h3>
                <div className="mt-1 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                  <button
                    type="button"
                    onClick={() => handleCopyEmail(viewTarget.email)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#d4e0f1] bg-white px-2.5 py-1 text-xs font-medium text-[#4f6897] transition-colors hover:bg-[#f3f9ff]"
                    title="Copy email"
                  >
                    <Mail className="h-3.5 w-3.5 text-[#7896c4]" />
                    <span className="max-w-48 truncate">{viewTarget.email}</span>
                    {copiedEmail ? (
                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-[#9eb6d4]" />
                    )}
                  </button>
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(viewTarget.status)}`}>
                    {viewTarget.status}
                  </span>
                  <span className="inline-flex rounded-full bg-[#e9f2ff] px-2.5 py-1 text-xs font-semibold text-[#4c6ea5]">
                    {viewTarget.clientType}
                  </span>
                </div>
              </div>
            </div>

            {/* ── Details grid ── */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Plan */}
              <div className="flex items-start gap-3 rounded-xl border border-[#e4edf9] bg-[#f9fbff] px-4 py-3">
                <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-[#7896c4]" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#8da3c8]">Subscription Plan</p>
                  <p className="mt-0.5 truncate text-sm font-semibold text-[#31496f]">{viewTarget.planType}</p>
                  {viewTarget.subscriptionTier && viewTarget.subscriptionTier !== viewTarget.planType && (
                    <p className="text-xs text-[#8496bb]">{viewTarget.subscriptionTier}</p>
                  )}
                </div>
              </div>

              {/* Bizcard count */}
              <div className="flex items-start gap-3 rounded-xl border border-[#e4edf9] bg-[#f9fbff] px-4 py-3">
                <Users className="mt-0.5 h-4 w-4 shrink-0 text-[#7896c4]" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#8da3c8]">Bizcards</p>
                  <p className="mt-0.5 text-sm font-semibold text-[#31496f]">
                    {viewTarget.bizcardCount} bizcard{viewTarget.bizcardCount === 1 ? '' : 's'}
                  </p>
                </div>
              </div>

              {/* Alt email */}
              <div className="flex items-start gap-3 rounded-xl border border-[#e4edf9] bg-[#f9fbff] px-4 py-3">
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-[#7896c4]" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#8da3c8]">Alternate Email</p>
                  <p className="mt-0.5 truncate text-sm font-semibold text-[#31496f]">
                    {viewTarget.altEmail !== 'N/A' ? viewTarget.altEmail : <span className="text-[#a0b4d0]">Not provided</span>}
                  </p>
                </div>
              </div>

              {/* Phone */}
              <div className="flex items-start gap-3 rounded-xl border border-[#e4edf9] bg-[#f9fbff] px-4 py-3">
                <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-[#7896c4]" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#8da3c8]">Phone</p>
                  <p className="mt-0.5 text-sm font-semibold text-[#31496f]">
                    {viewTarget.phone !== 'N/A' ? viewTarget.phone : <span className="text-[#a0b4d0]">Not provided</span>}
                  </p>
                </div>
              </div>

              {/* Member since */}
              <div className="flex items-start gap-3 rounded-xl border border-[#e4edf9] bg-[#f9fbff] px-4 py-3">
                <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-[#7896c4]" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#8da3c8]">Member Since</p>
                  <p className="mt-0.5 text-sm font-semibold text-[#31496f]">{viewTarget.joinedAt}</p>
                </div>
              </div>

              {/* Last activity */}
              <div className="flex items-start gap-3 rounded-xl border border-[#e4edf9] bg-[#f9fbff] px-4 py-3">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[#7896c4]" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#8da3c8]">Last Activity</p>
                  <p className="mt-0.5 text-sm font-semibold text-[#31496f]">{viewTarget.lastActivity}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </PortalModal>

      <PortalModal
        open={Boolean(suspendConfirmTarget)}
        onClose={() => {
          if (!suspendLoading) setSuspendConfirmTarget(null);
        }}
        title={
          suspendConfirmTarget?.status === 'Suspended'
            ? 'Reactivate Account'
            : 'Suspend Account'
        }
        description={
          suspendConfirmTarget
            ? suspendConfirmTarget.status === 'Suspended'
              ? `Reactivate access for ${suspendConfirmTarget.name}.`
              : `Suspend access for ${suspendConfirmTarget.name}.`
            : undefined
        }
        preventClose={suspendLoading}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setSuspendConfirmTarget(null)}
              disabled={suspendLoading}
              className="rounded-xl border border-[#d4e0f1] bg-white px-4 py-2 text-sm font-semibold text-[#5a7098] transition-colors hover:bg-[#f5f9ff] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void confirmSuspend()}
              disabled={suspendLoading}
              className={`rounded-xl px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50 ${
                suspendConfirmTarget?.status === 'Suspended'
                  ? 'border border-emerald-600 bg-emerald-600 hover:bg-emerald-700'
                  : 'border border-amber-600 bg-amber-600 hover:bg-amber-700'
              }`}
            >
              {suspendLoading ? (
                <span className="inline-flex items-center gap-2">
                  <InlineLoader />
                  {suspendConfirmTarget?.status === 'Suspended' ? 'Reactivating...' : 'Suspending...'}
                </span>
              ) : suspendConfirmTarget?.status === 'Suspended' ? (
                'Reactivate'
              ) : (
                'Confirm'
              )}
            </button>
          </div>
        }
      >
        <p className="text-sm text-[#4f658f]">
          {suspendConfirmTarget?.status === 'Suspended'
            ? 'Do you want to reactivate this account?'
            : 'Do you want to suspend this account?'}
        </p>
        {suspendConfirmTarget ? (
          <div className="mt-3 rounded-xl border border-[#e4edf9] bg-[#f9fbff] px-4 py-3 text-sm text-[#31496f] space-y-1">
            <p>
              <span className="font-semibold">Name:</span> {suspendConfirmTarget.name}
            </p>
            <p>
              <span className="font-semibold">Email:</span> {suspendConfirmTarget.email}
            </p>
          </div>
        ) : null}
      </PortalModal>

      <PortalModal
        open={Boolean(deleteConfirmTarget)}
        onClose={() => {
          if (!deleteLoading) setDeleteConfirmTarget(null);
        }}
        title="Move to Recycle Bin"
        description={
          deleteConfirmTarget
            ? `Move ${deleteConfirmTarget.name} to the Recycle Bin?`
            : undefined
        }
        preventClose={deleteLoading}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteConfirmTarget(null)}
              disabled={deleteLoading}
              className="rounded-xl border border-[#d4e0f1] bg-white px-4 py-2 text-sm font-semibold text-[#5a7098] transition-colors hover:bg-[#f5f9ff] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void confirmDelete()}
              disabled={deleteLoading}
              className="inline-flex items-center gap-2 rounded-xl border border-rose-600 bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
            >
              {deleteLoading ? (
                <>
                  <InlineLoader />
                  Moving...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Move to Recycle Bin
                </>
              )}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-[#4f658f]">
            Are you sure you want to move this user to the Recycle Bin?{' '}
            <span className="font-semibold text-rose-600">You can restore them later from Recycle Bin.</span>
          </p>
          {deleteConfirmTarget ? (
            <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-800 space-y-1">
              <p>
                <span className="font-semibold">Name:</span> {deleteConfirmTarget.name}
              </p>
              <p>
                <span className="font-semibold">Email:</span> {deleteConfirmTarget.email}
              </p>
            </div>
          ) : null}
          <p className="text-xs text-[#8da3c8]">
            The user account and BizCard will be deactivated and hidden. Associated data is preserved
            and can be restored from the Recycle Bin. Permanent deletion is only available from Recycle Bin.
          </p>
        </div>
      </PortalModal>

    </section>
  );
}
