'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Copy,
  Inbox,
  Mail,
  MailOpen,
  MessageCircle,
  MessageSquare,
  Phone,
  RefreshCw,
  Reply,
  Search,
  Trash2,
  UserCheck,
  ExternalLink,
  AlertCircle,
  X,
} from 'lucide-react';
import { InlineLoader, SectionLoader } from './Loader';
import { getFrontendApiBaseUrl } from './apiBase';
import { csrfClient } from '@/lib/csrf-client';
import { PortalPageHeader } from '@/app/superadmin/components/ui/PortalPageHeader';
import { PortalPanel } from '@/app/superadmin/components/ui/PortalPanel';
import { ModalPortal } from './ModalPortal';
import { showToast } from './Toast';
import ConnectionMessengerPanel from './messaging/ConnectionMessengerPanel';

type ApiInquiryStatus = 'new' | 'unread' | 'read' | 'replied';
type FilterType = 'all' | 'unread' | 'read' | 'replied';

type ApiInquirySender = {
  user_id: string | null;
  is_registered: boolean;
  name: string | null;
  email: string | null;
  portfolio_alias: string | null;
};

type ApiInquiry = {
  inquiry_id: string;
  sender_user_id: string | null;
  sender?: ApiInquirySender;
  visitor_name: string | null;
  visitor_email: string | null;
  visitor_phone: string | null;
  subject: string | null;
  message: string;
  status: ApiInquiryStatus;
  read_flag: boolean;
  created_at: string;
  updated_at: string | null;
};

type InquiryCounts = {
  all: number;
  unread: number;
  read: number;
  replied: number;
  new: number;
};

type ApiResponse = {
  inquiries: ApiInquiry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  unreadCount: number;
  counts?: InquiryCounts;
};

const PAGE_SIZE = 20;
const PANEL_DURATION = 0.26;
const PANEL_EASE: [number, number, number, number] = [0.25, 0.1, 0.25, 1];
const IS_APPLE =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);

const STATUS_PILL: Record<ApiInquiryStatus, { label: string; className: string }> = {
  new: { label: 'New', className: 'border-blue-200 bg-blue-50 text-blue-700' },
  unread: { label: 'Unread', className: 'border-amber-200 bg-amber-50 text-amber-700' },
  read: { label: 'Read', className: 'border-slate-200 bg-slate-50 text-slate-600' },
  replied: { label: 'Replied', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
};

const LIST_TITLES: Record<FilterType, string> = {
  all: 'All Inquiries',
  unread: 'Needs Attention',
  read: 'Read Inquiries',
  replied: 'Replied Inquiries',
};

const LIST_EMPTY: Record<FilterType, { title: string; hint: string }> = {
  all: {
    title: 'No inquiries yet',
    hint: 'Messages from your BizCard visitors will appear here.',
  },
  unread: {
    title: 'You are all caught up',
    hint: 'There are no new or unread inquiries right now.',
  },
  read: {
    title: 'No read inquiries',
    hint: 'Inquiries you open will move here until you reply.',
  },
  replied: {
    title: 'No replied inquiries',
    hint: 'Mark inquiries as replied after you respond.',
  },
};

const formatTimeAgo = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
};

const formatDisplayDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getInquiryDisplayName = (inq: ApiInquiry): string =>
  inq.sender?.name || inq.visitor_name || 'Anonymous';

const getInquiryDisplayEmail = (inq: ApiInquiry): string | null =>
  inq.sender?.email || inq.visitor_email;

const InquiryUser = () => {
  const API_BASE = getFrontendApiBaseUrl();
  const searchParams = useSearchParams();
  const requestedInquiryId = searchParams.get('id')?.trim() || null;
  const listSectionRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoReadRef = useRef<Set<string>>(new Set());
  const desktopScrollRef = useRef<HTMLDivElement | null>(null);
  const mobileScrollRef = useRef<HTMLDivElement | null>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [isMdUp, setIsMdUp] = useState(true);

  const [inquiries, setInquiries] = useState<ApiInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiInquiry | null>(null);
  const [messagingOpen, setMessagingOpen] = useState(false);
  const [messagingPeerId, setMessagingPeerId] = useState<string | null>(null);
  const [messagingDraft, setMessagingDraft] = useState<string | null>(null);
  const [messagingPeerName, setMessagingPeerName] = useState<string>('Messages');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<InquiryCounts>({
    all: 0,
    unread: 0,
    read: 0,
    replied: 0,
    new: 0,
  });

  const fetchInquiries = useCallback(
    async () => {
      setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (filter !== 'all') params.append('status', filter);
        if (debouncedSearch.trim()) params.append('search', debouncedSearch.trim());
      params.append('page', page.toString());
        params.append('limit', String(PAGE_SIZE));

      const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

      try {
        const response = await fetch(`${API_BASE}/api/inquiries?${params.toString()}`, {
          method: 'GET',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.status === 401) {
          throw new Error('Session expired. Please log in again.');
        }

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Failed to fetch inquiries (${response.status})`);
        }

        const data: ApiResponse = await response.json();
          setInquiries(Array.isArray(data.inquiries) ? data.inquiries : []);
          setTotal(Number(data.total ?? 0));
          setTotalPages(Math.max(1, Number(data.totalPages ?? 1)));
          if (data.counts) {
            setCounts({
              all: Number(data.counts.all ?? 0),
              unread: Number(data.counts.unread ?? data.unreadCount ?? 0),
              read: Number(data.counts.read ?? 0),
              replied: Number(data.counts.replied ?? 0),
              new: Number(data.counts.new ?? 0),
            });
          } else {
            setCounts((prev) => ({
              ...prev,
              unread: Number(data.unreadCount ?? prev.unread),
            }));
          }
      } catch (err) {
        clearTimeout(timeoutId);
        if (err instanceof Error && err.name === 'AbortError') {
          throw new Error('Request timeout. The server took too long to respond.');
        }
        throw err;
      }
    } catch (err) {
      console.error('[InquiryUser] fetchInquiries error:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
    },
    [API_BASE, filter, debouncedSearch, page],
  );

  const updateInquiryStatus = useCallback(
    async (inquiryId: string, status: ApiInquiryStatus, options?: { silent?: boolean }) => {
    setUpdatingId(inquiryId);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      try {
        const csrfToken = await csrfClient.getToken(false, API_BASE);
          const headers: HeadersInit = { 'Content-Type': 'application/json' };
          if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

        const response = await fetch(`${API_BASE}/api/inquiries/${inquiryId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers,
          body: JSON.stringify({ status }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.status === 401) {
          throw new Error('Session expired. Please log in again.');
        }

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Failed to update status (${response.status})`);
        }

          setInquiries((prev) => {
            const previous = prev.find((inq) => inq.inquiry_id === inquiryId);
            if (previous && previous.status !== status) {
              const wasUnread = previous.status === 'new' || previous.status === 'unread';
              const isUnread = status === 'new' || status === 'unread';
              setCounts((c) => ({
                ...c,
                new:
                  previous.status === 'new'
                    ? Math.max(0, c.new - 1)
                    : status === 'new'
                      ? c.new + 1
                      : c.new,
                read:
                  previous.status === 'read'
                    ? Math.max(0, c.read - 1)
                    : status === 'read'
                      ? c.read + 1
                      : c.read,
                replied:
                  previous.status === 'replied'
                    ? Math.max(0, c.replied - 1)
                    : status === 'replied'
                      ? c.replied + 1
                      : c.replied,
                unread: wasUnread
                  ? Math.max(0, c.unread - (isUnread ? 0 : 1))
                  : isUnread
                    ? c.unread + 1
                    : c.unread,
              }));
            }

            return prev.map((inq) =>
              inq.inquiry_id === inquiryId
                ? {
                    ...inq,
                    status,
                    read_flag: status !== 'unread' && status !== 'new',
                  }
                : inq,
            );
          });

          if (!options?.silent) {
            showToast(
              status === 'replied'
                ? 'Marked as replied.'
                : status === 'unread'
                  ? 'Marked as unread.'
                  : 'Marked as read.',
              'success',
            );
          }
      } catch (err) {
        clearTimeout(timeoutId);
        if (err instanceof Error && err.name === 'AbortError') {
          throw new Error('Request timeout.');
        }
        throw err;
      }
    } catch (err) {
      console.error('[InquiryUser] updateInquiryStatus error:', err);
        showToast(err instanceof Error ? err.message : 'Failed to update status', 'error');
    } finally {
      setUpdatingId(null);
    }
    },
    [API_BASE],
  );

  const deleteInquiry = useCallback(
    async (inquiryId: string) => {
    setDeletingId(inquiryId);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      try {
        const csrfToken = await csrfClient.getToken(false, API_BASE);
          const headers: HeadersInit = { 'Content-Type': 'application/json' };
          if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

        const response = await fetch(`${API_BASE}/api/inquiries/${inquiryId}`, {
          method: 'DELETE',
          credentials: 'include',
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.status === 401) {
          throw new Error('Session expired. Please log in again.');
        }

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Failed to delete inquiry (${response.status})`);
        }

          setInquiries((prev) => {
            const removed = prev.find((inq) => inq.inquiry_id === inquiryId);
            if (removed) {
              setCounts((c) => {
                const next = { ...c, all: Math.max(0, c.all - 1) };
                if (removed.status === 'new') next.new = Math.max(0, next.new - 1);
                if (removed.status === 'read') next.read = Math.max(0, next.read - 1);
                if (removed.status === 'replied') next.replied = Math.max(0, next.replied - 1);
                if (removed.status === 'new' || removed.status === 'unread') {
                  next.unread = Math.max(0, next.unread - 1);
                }
                return next;
              });
              setTotal((t) => Math.max(0, t - 1));
            }
            return prev.filter((inq) => inq.inquiry_id !== inquiryId);
          });

          if (selectedId === inquiryId) setSelectedId(null);
          setDeleteTarget(null);
          showToast('Inquiry deleted.', 'success');
      } catch (err) {
        clearTimeout(timeoutId);
        if (err instanceof Error && err.name === 'AbortError') {
          throw new Error('Request timeout.');
        }
        throw err;
      }
    } catch (err) {
      console.error('[InquiryUser] deleteInquiry error:', err);
        showToast(err instanceof Error ? err.message : 'Failed to delete inquiry', 'error');
    } finally {
      setDeletingId(null);
    }
    },
    [API_BASE, selectedId],
  );

  useEffect(() => {
    void fetchInquiries();
  }, [fetchInquiries]);

  useEffect(() => {
    if (!requestedInquiryId) return;
    setSelectedId(requestedInquiryId);

    const exists = inquiries.some((inq) => inq.inquiry_id === requestedInquiryId);
    if (exists || loading) return;

    let cancelled = false;
    void fetch(`${API_BASE}/api/inquiries/${encodeURIComponent(requestedInquiryId)}`, {
      credentials: 'include',
    })
      .then(async (res) => (res.ok ? res.json() : null))
      .then((payload) => {
        const inquiry = (payload?.inquiry ?? payload?.data ?? payload) as ApiInquiry | null;
        if (!cancelled && inquiry?.inquiry_id) {
          setInquiries((prev) =>
            prev.some((item) => item.inquiry_id === inquiry.inquiry_id)
              ? prev
              : [inquiry, ...prev],
          );
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [API_BASE, inquiries, loading, requestedInquiryId]);

  useEffect(() => {
    if (!selectedId) return;
    const inquiry = inquiries.find((inq) => inq.inquiry_id === selectedId);
    if (!inquiry) return;
    if (inquiry.status !== 'new' && inquiry.status !== 'unread') return;
    if (autoReadRef.current.has(selectedId)) return;
    autoReadRef.current.add(selectedId);
    void updateInquiryStatus(selectedId, 'read', { silent: true });
  }, [selectedId, inquiries, updateInquiryStatus]);

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    setPortalReady(true);
    const media = window.matchMedia('(min-width: 768px)');
    const sync = () => setIsMdUp(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync); 
  }, []);

  useEffect(() => {
    desktopScrollRef.current?.scrollTo({ top: 0 });
    mobileScrollRef.current?.scrollTo({ top: 0 });
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId || isMdUp) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMdUp, selectedId]);

  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(value.trim());
    setPage(1);
    }, 400);
  }, []);

  const handleFilterChange = useCallback((next: FilterType) => {
    setFilter(next);
    setPage(1);
    setSelectedId(null);

    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches) {
      window.setTimeout(() => {
        listSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    }
  }, []);
  const handleSelectInquiry = useCallback((inquiryId: string) => {
    setSelectedId(inquiryId);
  }, []);
  const handleCloseDetail = useCallback(() => {
    setSelectedId(null);
  }, []);

  const handleRowKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>, inquiry: ApiInquiry) => {
      if (event.target !== event.currentTarget) return;
      const rows = listSectionRef.current?.querySelectorAll<HTMLElement>('[data-inquiry-row]');
      const rowList = rows ? Array.from(rows) : [];
      const index = rowList.findIndex((row) => row === event.currentTarget);
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        rowList[Math.min(index + 1, rowList.length - 1)]?.focus();
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        rowList[Math.max(index - 1, 0)]?.focus();
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleSelectInquiry(inquiry.inquiry_id);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        setDeleteTarget(inquiry);
      }
    },
    [handleSelectInquiry],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inField =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (event.key === '/' && !inField) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (event.key === 'Escape' && selectedId && !deleteTarget) {
        event.preventDefault();
        setSelectedId(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteTarget, selectedId]);

  const handleCopy = useCallback(async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showToast(`${label} copied.`, 'success');
    } catch {
      showToast(`Could not copy ${label.toLowerCase()}.`, 'error');
    }
  }, []);

  const handleReplyViaMessage = useCallback(
    (inquiry: ApiInquiry) => {
      const peerId =
        inquiry.sender?.user_id?.trim() ||
        (inquiry.sender_user_id ? String(inquiry.sender_user_id) : '');
      if (!peerId || inquiry.sender?.is_registered !== true) {
        showToast('This sender does not have an OnTap account to message.', 'error');
        return;
      }

      const displayName = getInquiryDisplayName(inquiry);
      const subject = (inquiry.subject || '').trim();
      const draft = subject
        ? `Hi ${displayName.split(' ')[0] || displayName}, thanks for your inquiry about "${subject}". `
        : `Hi ${displayName.split(' ')[0] || displayName}, thanks for your inquiry. `;

      setMessagingPeerId(peerId);
      setMessagingPeerName(displayName);
      setMessagingDraft(draft);
      setMessagingOpen(true);

      if (inquiry.status !== 'replied') {
        void updateInquiryStatus(inquiry.inquiry_id, 'replied', { silent: true });
      }
    },
    [updateInquiryStatus],
  );

  const counterCards = useMemo(
    () => [

      {
        key: 'all' as const,
        title: 'All Inquiries',
        value: counts.all,
        icon: Inbox,
        hint: 'View every message',
      },
      {
        key: 'unread' as const,
        title: 'Needs Attention',
        value: counts.unread,
        icon: Mail,
        hint: 'New and unread only',
      },

      {
        key: 'read' as const,
        title: 'Read',
        value: counts.read,
        icon: MailOpen,
        hint: 'Opened but not replied',
      },

      {
        key: 'replied' as const,
        title: 'Replied',
        value: counts.replied,
        icon: Reply,
        hint: 'Messages you marked done',
      },
      
    ],
    [counts],
  );
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
  };

  const itemVariants = {
    hidden: { y: 16, opacity: 0 },
    visible: { y: 0, opacity: 1 },
  };

  const emptyCopy = LIST_EMPTY[filter];
  const listTitle = LIST_TITLES[filter];
  const listCountLabel =
    loading && inquiries.length === 0
      ? 'Loading…'
      : total > inquiries.length
        ? `${inquiries.length} of ${total} inquiries`
        : `${inquiries.length} ${inquiries.length === 1 ? 'inquiry' : 'inquiries'}`;
  const selectedInquiry = inquiries.find((inq) => inq.inquiry_id === selectedId) ?? null;
  if (error && inquiries.length === 0 && !loading) {

    return (
      <div className="flex h-full min-h-[50vh] w-full items-center justify-center">
        <div className="max-w-md rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-rose-500" />
          <h3 className="text-lg font-bold text-gray-900">Failed to load inquiries</h3>
          <p className="mt-2 text-sm text-gray-500">{error}</p>
          <button
            type="button"
            onClick={() => void fetchInquiries()}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:opacity-95"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="relative flex min-h-full w-full min-w-0 flex-col gap-4 overflow-x-hidden sm:gap-5">
      {loading && inquiries.length === 0 ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#f8fafc]/95">
          <SectionLoader text="Loading inquiries..." />
        </div>
      ) : null}

      <PortalPageHeader
        title="Inquiry"
        titleClassName="bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent"
        subtitle="Manage and respond to incoming customer inquiries."
      />

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="flex flex-col gap-5"
      >
        <PortalPanel padding="sm" className="!p-3 sm:!p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-[#20387D]">Quick filters</p>
            <p className="text-xs text-[#6b7280]">Tap a card to switch the list below</p>
      </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {counterCards.map((card) => {
              const Icon = card.icon;
              const isActive = filter === card.key;
              return (
                <motion.button
                  key={card.key}
                  type="button"
                  variants={itemVariants}
                  onClick={() => handleFilterChange(card.key)}
                  aria-pressed={isActive}
                  aria-label={`${card.title}: ${card.value}. ${card.hint}`}
                  title={card.hint}
                  className={[
                    'group relative isolate min-h-[108px] overflow-hidden rounded-2xl border p-3 text-left text-white shadow-[0_8px_32px_rgba(20,35,78,0.16)] backdrop-blur-[8px] transition-all duration-300 sm:min-h-[118px] sm:p-4',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#4785B8]',
                    'hover:-translate-y-0.5 hover:shadow-[0_14px_36px_rgba(20,35,78,0.28)] active:scale-[0.99]',
                    isActive
                      ? 'border-white/55 bg-[linear-gradient(135deg,rgba(32,56,125,1)_0%,rgba(71,133,184,0.98)_100%)] shadow-[0_12px_32px_rgba(32,56,125,0.38)] ring-2 ring-white/70 ring-offset-2 ring-offset-[#f8fafc]'
                      : 'border-white/20 bg-[linear-gradient(135deg,rgba(32,56,125,0.96)_0%,rgba(74,111,165,0.90)_100%)]',
                  ].join(' ')}
                >
                  <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.22),transparent_42%)]" />
                  {isActive ? (
                    <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full border border-white/40 bg-white/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur-sm">
                      <Check className="h-3 w-3" />
                    </span>
                  ) : null}
                  <div className="mb-2 flex items-start justify-between gap-3 sm:mb-3">
                    <div className="min-w-0 pr-10">
                      <p className="text-sm font-semibold text-blue-50/85">{card.title}</p>
                      <p className="mt-0.5 text-[11px] leading-snug text-blue-100/70">{card.hint}</p>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white shadow-inner backdrop-blur-sm transition-transform duration-300 group-hover:scale-105">
                      <Icon className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="flex items-end justify-between gap-2">
                    <p className="text-3xl font-bold tracking-tight text-white tabular-nums">
                      {card.value}
                    </p>
                    {card.key === 'unread' && card.value > 0 ? (
                      <span className="mb-1 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-100">
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-300 opacity-60" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-300" />
                        </span>
                        Action needed
                      </span>
                    ) : null}
                  </div>
                </motion.button>
              );
            })}
          </div>
        </PortalPanel>

        <PortalPanel padding="sm" className="!p-3 sm:!p-4">
        <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <input
              ref={searchInputRef}
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search by name, subject, or email..."
              className="h-12 w-full rounded-xl border border-gray-200 bg-white pl-12 pr-12 text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4785B8]/30 sm:pr-20"
              aria-label="Search inquiries"
            />
            {searchInput ? (
              <button
                type="button"
                onClick={() => handleSearchChange('')}
                className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              <span className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-1 sm:inline-flex">
                <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                  {IS_APPLE ? '⌘K' : 'Ctrl K'}
                </kbd>
                <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                  /
                </kbd>
              </span>
            )}
        </div>
        </PortalPanel>

        <div
          ref={listSectionRef}
          className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm"
        >
          <div className="flex min-h-[min(24rem,55dvh)] flex-col md:min-h-[28rem] md:h-[min(68vh,42rem)] md:flex-row">
            <section className="flex min-h-0 min-w-0 flex-1 flex-col border-gray-100 md:border-r">
              <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
                <h3 className="truncate text-sm font-semibold tracking-tight text-slate-900">
                  {listTitle}
                </h3>
                <span className="shrink-0 rounded-full border border-[#dbe3f0] bg-[#f3f6fb] px-2.5 py-1 text-xs font-semibold text-[#475569]">
                  {listCountLabel}
                </span>
      </div>

              {error && inquiries.length > 0 ? (
                <div className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-sm text-amber-800">
                  {error}
                </div>
              ) : null}

              <div className="min-h-0 flex-1 overflow-y-auto">
                {inquiries.length === 0 && !loading ? (
                  <div className="px-6 py-14 text-center">
                    <MessageSquare className="mx-auto mb-3 h-9 w-9 text-slate-300" />
                    <p className="text-sm font-semibold text-slate-700">{emptyCopy.title}</p>
                    <p className="mt-1 text-sm text-slate-400">
                      {searchInput.trim()
                        ? 'Try a different search keyword or clear the filter.'
                        : emptyCopy.hint}
                    </p>
                    {(searchInput.trim() || filter !== 'all') && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchInput('');
                          setDebouncedSearch('');
                          handleFilterChange('all');
                        }}
                        className="mt-4 inline-flex h-11 items-center rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:h-9"
                      >
                        Clear filters
                      </button>
                    )}
          </div>
        ) : (
                  <div className="divide-y divide-slate-100">
                    {inquiries.map((inq) => {
                      const isSelected = selectedId === inq.inquiry_id;
                      const status = STATUS_PILL[inq.status];
            const displayName = getInquiryDisplayName(inq);
                      const displayEmail = getInquiryDisplayEmail(inq);
            const initial = displayName.charAt(0).toUpperCase() || '?';
            const isRegisteredSender = inq.sender?.is_registered === true;
            const isUpdating = updatingId === inq.inquiry_id;
            const isDeleting = deletingId === inq.inquiry_id;
                      const needsAttention = inq.status === 'new' || inq.status === 'unread';
                      const preview = (inq.message || '').replace(/\s+/g, ' ').trim();

            return (
                        <article
                key={inq.inquiry_id}
                          data-inquiry-row
                          tabIndex={0}
                          aria-current={isSelected ? 'true' : undefined}
                          onKeyDown={(event) => handleRowKeyDown(event, inq)}
                          className={[
                            'group outline-none transition-colors duration-150',
                            'focus-visible:ring-2 focus-visible:ring-[#2A4792] focus-visible:ring-inset',
                            needsAttention ? 'bg-[linear-gradient(90deg,rgba(42,71,146,0.06)_0%,transparent_28%)]' : 'bg-white',
                            isSelected
                              ? 'border-l-[3px] border-l-[#2A4792] bg-[#eef3fb]'
                              : 'border-l-[3px] border-l-transparent hover:bg-slate-50',
                          ].join(' ')}
                        >
                          <div className="flex items-start gap-1">
                  <button
                              type="button"
                              className="min-w-0 flex-1 px-4 py-3 text-left"
                              onClick={() => handleSelectInquiry(inq.inquiry_id)}
                    disabled={isUpdating || isDeleting}
                  >
                              <div className="flex items-start gap-3">
                                <div
                                  className={[
                                    'relative mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                                    needsAttention
                                      ? 'bg-[#2A4792] text-white'
                                      : 'bg-[#e8f0ff] text-[#2A4792]',
                                  ].join(' ')}
                                >
                        {initial}
                                  {needsAttention ? (
                                    <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-amber-400" />
                                  ) : null}
                      </div>

                                <div className="min-w-0 flex-1">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <p
                                      className={[
                                        'min-w-0 truncate text-sm tracking-tight text-slate-900',
                                        needsAttention ? 'font-bold' : 'font-semibold',
                                      ].join(' ')}
                                    >
                            {displayName}
                          </p>
                                    <div className="hidden min-w-0 shrink-0 items-center gap-1.5 sm:flex">
                                      {isRegisteredSender ? (
                                        <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                                          Member
                            </span>
                                      ) : null}
                                      <span
                                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${status.className}`}
                                      >
                            {status.label}
                          </span>
                        </div>
                                    <ChevronRight
                                      className={[
                                        'ml-auto hidden h-4 w-4 shrink-0 sm:block',
                                        isSelected ? 'text-[#2A4792]' : 'text-slate-300 group-hover:text-slate-400',
                                      ].join(' ')}
                                    />
                                  </div>

                                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 sm:hidden">
                                    {isRegisteredSender ? (
                                      <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                                        Member
                                      </span>
                                    ) : null}
                                    <span
                                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${status.className}`}
                                    >
                                      {status.label}
                                    </span>
                                  </div>

                                  <p className="mt-1 truncate text-sm">
                                    <span className="font-medium text-slate-800">
                                      {inq.subject || 'No subject'}
                                    </span>
                                    {preview ? (
                                      <>
                                        <span className="text-slate-400"> — </span>
                                        <span className="font-normal text-slate-500">{preview}</span>
                                      </>
                                    ) : null}
                                  </p>
                                  <p className="mt-1 truncate text-xs text-slate-400">
                                    {displayEmail ? `${displayEmail} · ` : ''}
                                    {formatTimeAgo(inq.created_at)}
                                  </p>
                      </div>
                    </div>
                  </button>

                      <button
                        type="button"
                              onClick={() => setDeleteTarget(inq)}
                              disabled={isDeleting || isUpdating}
                              className="mr-2 mt-2 hidden h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 sm:inline-flex"
                              aria-label={`Delete inquiry from ${displayName}`}
                        title="Delete"
                      >
                              {isDeleting ? <InlineLoader /> : <Trash2 className="h-4 w-4" />}
                      </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>

              {totalPages > 1 ? (
                <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1 || loading}
                    className="inline-flex h-11 items-center rounded-lg px-3 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-40 sm:h-9"
                  >
                    Previous
                  </button>
                  <span className="text-sm font-medium text-slate-500">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages || loading}
                    className="inline-flex h-11 items-center rounded-lg px-3 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-40 sm:h-9"
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </section>

            <aside className="relative hidden min-h-0 w-full shrink-0 overflow-hidden border-t border-gray-100 bg-white md:flex md:w-[38%] md:border-t-0 lg:w-[40%] xl:w-[420px]">
              <AnimatePresence mode="wait" initial={false}>
                {selectedInquiry ? (
                  <motion.div
                    key="desktop-detail"
                    initial={{ x: 48, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: 48, opacity: 0 }}
                    transition={{ duration: PANEL_DURATION, ease: PANEL_EASE }}
                    className="flex h-full min-h-0 w-full flex-col"
                  >
                    <InquiryDetailPanel
                      inquiry={selectedInquiry}
                      scrollRef={desktopScrollRef}
                      showBackButton={false}
                      updatingId={updatingId}
                      deletingId={deletingId}
                      onClose={handleCloseDetail}
                      onCopy={handleCopy}
                      onDelete={(inq) => setDeleteTarget(inq)}
                      onUpdateStatus={updateInquiryStatus}
                      onReplyViaMessage={handleReplyViaMessage}
                    />
                  </motion.div>
                ) : (
                  <motion.div
                    key="desktop-empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="flex h-full w-full flex-col items-center justify-center px-8 text-center"
                  >
                    <p className="text-sm font-semibold text-slate-800">Select an inquiry</p>
                    <p className="mt-1 max-w-[220px] text-sm text-slate-400">
                      Choose an inquiry from the list to view its details.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </aside>
                  </div>
                </div>
      </motion.div>

      {portalReady && !isMdUp
        ? createPortal(
            <AnimatePresence>
              {selectedInquiry ? (
                <motion.div
                  key="mobile-detail"
                  initial={{ x: '100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '100%' }}
                  transition={{ duration: PANEL_DURATION, ease: PANEL_EASE }}
                  className="fixed inset-0 z-[70] flex flex-col bg-white"
                >
                  <InquiryDetailPanel
                    inquiry={selectedInquiry}
                    scrollRef={mobileScrollRef}
                    showBackButton
                    updatingId={updatingId}
                    deletingId={deletingId}
                    onClose={handleCloseDetail}
                    onCopy={handleCopy}
                    onDelete={(inq) => setDeleteTarget(inq)}
                    onUpdateStatus={updateInquiryStatus}
                    onReplyViaMessage={handleReplyViaMessage}
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}

      <ModalPortal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <div className="mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-gray-900">Delete inquiry?</h3>
              <p className="mt-2 text-sm text-gray-500">
                This will permanently remove the message from{' '}
                <span className="font-semibold text-gray-700">
                  {deleteTarget ? getInquiryDisplayName(deleteTarget) : 'this sender'}
                </span>
                . This action cannot be undone.
              </p>
                      </div>
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              className="rounded-full border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (deleteTarget) void deleteInquiry(deleteTarget.inquiry_id);
              }}
              disabled={!!deletingId}
              className="inline-flex items-center gap-2 rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
            >
              {deletingId ? <InlineLoader /> : <Trash2 className="h-4 w-4" />}
              Delete
            </button>
          </div>
        </div>
      </ModalPortal>

      <ConnectionMessengerPanel
        open={messagingOpen}
        initialPeerUserId={messagingPeerId}
        lockedPeer
        title={messagingPeerName}
        subtitle="Reply via OnTap messages"
        initialDraftText={messagingDraft}
        onClose={() => {
          setMessagingOpen(false);
          setMessagingPeerId(null);
          setMessagingDraft(null);
        }}
      />
    </div>
  );
};

const InquiryDetailPanel = ({
  inquiry,
  scrollRef,
  showBackButton,
  updatingId,
  deletingId,
  onClose,
  onCopy,
  onDelete,
  onUpdateStatus,
  onReplyViaMessage,
}: {
  inquiry: ApiInquiry;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  showBackButton: boolean;
  updatingId: string | null;
  deletingId: string | null;
  onClose: () => void;
  onCopy: (value: string, label: string) => void;
  onDelete: (inquiry: ApiInquiry) => void;
  onUpdateStatus: (inquiryId: string, status: ApiInquiryStatus, options?: { silent?: boolean }) => void;
  onReplyViaMessage: (inquiry: ApiInquiry) => void;
}) => {
  const status = STATUS_PILL[inquiry.status];
  const displayName = getInquiryDisplayName(inquiry);
  const displayEmail = getInquiryDisplayEmail(inquiry);
  const isRegisteredSender = inquiry.sender?.is_registered === true;
  const senderUserId =
    inquiry.sender?.user_id?.trim() ||
    (inquiry.sender_user_id ? String(inquiry.sender_user_id) : '');
  const canReplyViaMessage = isRegisteredSender && Boolean(senderUserId);
  const isUpdating = updatingId === inquiry.inquiry_id;
  const isDeleting = deletingId === inquiry.inquiry_id;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {showBackButton ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Back to inquiry list"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          ) : null}
          <h3 className="truncate text-sm font-semibold tracking-tight text-slate-900">
            Inquiry Details
          </h3>
        </div>
        {showBackButton ? null : (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inquiry details"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5">
        <div className="min-w-0">
          <p className="break-words text-lg font-semibold tracking-tight text-slate-900">
            {displayName}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {isRegisteredSender ? (
              <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                Member
              </span>
            ) : null}
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${status.className}`}>
              {status.label}
            </span>
          </div>
        </div>

        <p className="mt-4 break-words text-sm font-medium text-slate-800">
          {inquiry.subject || 'No subject'}
        </p>

        <div className="mt-4 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Full message
          </p>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800">
            {inquiry.message}
          </p>
        </div>

        {isRegisteredSender ? (
          <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50/70 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-violet-700">
                            <UserCheck className="h-4 w-4" />
              <span>Linked OnTap account</span>
                          </div>
            <p className="text-sm font-medium text-slate-700">
              {inquiry.sender?.name || displayName}
            </p>
            {inquiry.sender?.email ? (
              <p className="mt-1 break-all text-sm text-slate-500">{inquiry.sender.email}</p>
            ) : null}
            {inquiry.sender?.portfolio_alias ? (
              <a
                href={`/${inquiry.sender.portfolio_alias}`}
                              target="_blank"
                              rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-violet-700 hover:text-violet-800"
                            >
                              View sender portfolio
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
            ) : null}
            {canReplyViaMessage ? (
              <button
                type="button"
                onClick={() => onReplyViaMessage(inquiry)}
                className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#2A4792] px-3 text-sm font-semibold text-white transition hover:bg-[#3B569F]"
              >
                <MessageCircle className="h-4 w-4" />
                Reply via Message
              </button>
            ) : null}
                        </div>
        ) : null}

        <dl className="mt-5 space-y-4">
          <div>
            <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Mail className="h-3.5 w-3.5" />
              Email
            </dt>
            <dd className="mt-1 flex min-w-0 items-start justify-between gap-2">
              <span className="break-all text-sm font-medium text-slate-700">
                {displayEmail || 'Not provided'}
              </span>
              {displayEmail ? (
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void onCopy(displayEmail, 'Email')}
                    className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-[#2A4792]"
                    title="Copy email"
                    aria-label="Copy email"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <a
                    href={`mailto:${displayEmail}`}
                    className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-[#2A4792]"
                    title="Send email"
                    aria-label="Send email"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </span>
              ) : null}
            </dd>
                      </div>

          <div>
            <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Phone className="h-3.5 w-3.5" />
              Phone
            </dt>
            <dd className="mt-1 flex min-w-0 items-start justify-between gap-2">
              <span className="break-all text-sm font-medium text-slate-700">
                {inquiry.visitor_phone || 'Not provided'}
              </span>
              {inquiry.visitor_phone ? (
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void onCopy(inquiry.visitor_phone!, 'Phone')}
                    className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-[#2A4792]"
                    title="Copy phone"
                    aria-label="Copy phone"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <a
                    href={`tel:${inquiry.visitor_phone}`}
                    className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-[#2A4792]"
                    title="Call"
                    aria-label="Call sender"
                  >
                    <Phone className="h-3.5 w-3.5" />
                  </a>
                </span>
              ) : null}
            </dd>
          </div>

          <div>
            <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Clock3 className="h-3.5 w-3.5" />
              Received
            </dt>
            <dd className="mt-1 text-sm font-medium text-slate-700">
              {formatTimeAgo(inquiry.created_at)}
              <span className="mt-0.5 block text-xs font-normal text-slate-400">
                {formatDisplayDate(inquiry.created_at)}
              </span>
            </dd>
          </div>
        </dl>
      </div>

      <div className="shrink-0 border-t border-gray-100 bg-white px-4 py-3">
                      <div className="flex flex-wrap gap-2">
          {inquiry.status !== 'replied' ? (
                          <button
              type="button"
              onClick={() => void onUpdateStatus(inquiry.inquiry_id, 'replied')}
                            disabled={isUpdating}
              className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50 sm:h-9"
            >
              {isUpdating ? <InlineLoader /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                            Mark as Replied
                          </button>
          ) : null}

          {(inquiry.status === 'read' || inquiry.status === 'replied') && (
                          <button
              type="button"
              onClick={() => void onUpdateStatus(inquiry.inquiry_id, 'unread')}
                            disabled={isUpdating}
              className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-amber-50 px-3 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-50 sm:h-9"
                          >
                            <CalendarClock className="h-3.5 w-3.5" />
                            Mark as Unread
                          </button>
                        )}

          {(inquiry.status === 'new' || inquiry.status === 'unread') && (
                          <button
              type="button"
              onClick={() => void onUpdateStatus(inquiry.inquiry_id, 'read')}
                            disabled={isUpdating}
              className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-blue-50 px-3 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 disabled:opacity-50 sm:h-9"
            >
              {isUpdating ? <InlineLoader /> : <MailOpen className="h-3.5 w-3.5" />}
                            Mark as Read
                          </button>
                        )}

          {canReplyViaMessage ? (
            <button
              type="button"
              onClick={() => onReplyViaMessage(inquiry)}
              className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-[#2A4792] px-3 text-xs font-semibold text-white transition hover:bg-[#3B569F] sm:h-9"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Reply via Message
            </button>
          ) : null}

          {displayEmail ? (
            <a
              href={`mailto:${displayEmail}?subject=${encodeURIComponent(
                `Re: ${inquiry.subject || 'Your inquiry'}`,
              )}`}
              className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 sm:h-9"
            >
              <Reply className="h-3.5 w-3.5" />
              Email Reply
            </a>
          ) : null}

          <button
            type="button"
            onClick={() => onDelete(inquiry)}
            disabled={isDeleting || isUpdating}
            className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 sm:h-9"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
    </div>
    </div>
  );
};

export default InquiryUser;
