'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { apiFetch } from '@/lib/apiFetch';
import { PortalPageHeader } from '@/app/superadmin/components/ui/PortalPageHeader';
import { PortalPanel } from '@/app/superadmin/components/ui/PortalPanel';
import {
  ChevronDown,
  MapPin,
  MessageCircle,
  Radio,
  Send,
  UserPlus,
  Users,
  Search,
  Eye,
  Check,
  X,
} from 'lucide-react';
import { SectionLoader } from '../components/Loader';
import ConnectionMessengerPanel from './messaging/ConnectionMessengerPanel';
import ConnectionPortfolioModal from './ConnectionPortfolioModal';
import { showToast } from './Toast';
import { toServableMediaSrc } from '../lib/portfolioDisplay';
function resolveProfileImage(raw: string | null | undefined): string | null {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return null;
  return toServableMediaSrc(value) || null;
}
type AssociationStatus = 'connected' | 'pending' | 'sent';
/** Active view driven by the summary cards (and mirrored by the filter select). */
type AssociateViewFilter = 'connected' | 'online' | 'pending' | 'sent';
type Associate = {
  id: string;
  connectionId: string;
  name: string;
  role: string;
  company: string;
  location: string;
  status: AssociationStatus;
  isOnline: boolean;
  profileImage?: string | null;
  email?: string;
  portfolioUrl?: string | null;
  alias?: string | null;

};

const LIST_TITLES: Record<AssociateViewFilter, string> = {
  connected: 'Your Connections',

  online: 'Online Associates',
  
  pending: 'Pending Requests',

  sent: 'Sent Requests',

};

const LIST_EMPTY_COPY: Record<AssociateViewFilter, { title: string; hint: string }> = {
  connected: {
    title: 'No connections yet',
    hint: 'When you accept or send associate requests, they will show up here.',
  },

  online: {

    title: 'No associates online',
    hint: 'None of your connections are active right now. Check back later.',

  },

  pending: {

    title: 'No pending requests',
    hint: 'Incoming associate requests will appear here for you to review.',

  },

  sent: {

    title: 'No sent requests',
    hint: 'Requests you send to other associates will appear here until they respond.',

  },
};
const CONNECTIONS_POLL_MS = 10_000;
function extractAliasFromPortfolioUrl(portfolioUrl: string | null | undefined): string | null {
  if (!portfolioUrl || typeof portfolioUrl !== 'string') return null;
  const raw = portfolioUrl.trim();
  if (!raw) return null;

  try {
    const path = /^https?:\/\//i.test(raw)
      ? new URL(raw).pathname
      : raw.startsWith('/')
        ? raw
        : `/${raw}`;
    const segment = path.replace(/^\/+|\/+$/g, '').split('/')[0] ?? '';
    const alias = decodeURIComponent(segment).trim();
    return alias || null;
  } catch {
    return null;
  }
}
// API response types matching your backend
interface ConnectionSummaryResponse {
  success: boolean;
  data: {
    total_connections: number;
    online_now: number;
    pending_requests_received: number;
    pending_requests_sent: number;
    total_friends: number;
    recently_added: number;
    birthdays_today: number;
    mutual_connections?: number;
  };
  cached?: boolean;
} 

interface ConnectionsListResponse {
  success: boolean;
  connections: Array<{
    id: string;
    connectionId: string;
    name: string;
    email: string;
    profile_image: string | null;
    portfolio_url?: string | null;
    business_name: string | null;
    position: string | null;
    connection_date: string;
    last_active: string | null;
    online_status: boolean;
    mutual_connections: number;
    tags: string[];
    notes: string | null;
    location: string | null;
    time_ago: string | null;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
    has_next: boolean;
    has_previous: boolean;
    next_cursor: string | null;
  };
  sorting: {
    field: string;
    direction: string;
  };
  cached?: boolean;
}

interface ReceivedRequestsResponse {
  success: boolean;
  requests: Array<{
    id: string;
    sender: {
      id: string;
      name: string;
      email: string;
      profile_image: string | null;
      business_name: string | null;
      mutual_connections: number;
    };
    message: string | null;
    sent_at: string;
    time_ago: string;
    expires_at: string | null;
    status: string;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
  summary: {
    total_pending: number;
    oldest_request: string | null;
  };
}
interface SentRequestsResponse {
  success: boolean;
  requests: Array<{
    id: string;
    receiver: {
      id: string;
      name: string;
      email: string;
      profile_image: string | null;
      business_name: string | null;
      mutual_connections: number;
    };
    message: string | null;
    sent_at: string;
    time_ago: string;
    expires_at: string | null;
    status: string;
    reminder_sent: boolean;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
  summary: {
    total_sent: number;
    oldest_sent: string | null;
    average_response_time: number | null;
  };
}


const AssociateUser = () => {
  const [associates, setAssociates] = useState<Associate[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<AssociateViewFilter>('connected');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState({
    totalConnections: 0,
    online: 0,
    pending: 0,
    sent: 0,
  });
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    pages: 1,
  });


  const [messagingOpen, setMessagingOpen] = useState(false);
  const [messagingPeerId, setMessagingPeerId] = useState<string | null>(null);
  const [portfolioModalOpen, setPortfolioModalOpen] = useState(false);
  const [portfolioAlias, setPortfolioAlias] = useState<string | null>(null);
  const [portfolioConnectionId, setPortfolioConnectionId] = useState<string | null>(null);
  const [failedAvatarIds, setFailedAvatarIds] = useState<Record<string, true>>({});
  const listSectionRef = useRef<HTMLDivElement | null>(null);


  // Use refs to track if initial load has been done

  //  use this ref to track 
  const initialLoadDone = useRef(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch connection summary - wrapped in useCallback
  const fetchSummary = useCallback(async () => {
    try {
      const response = await apiFetch('/api/connections/summary?includeDetails=false');
      const data: ConnectionSummaryResponse = await response.json();
      
      if (data.success && data.data) {
        setSummary({
          totalConnections: data.data.total_connections,
          online: data.data.online_now,
          pending: data.data.pending_requests_received,
          sent: data.data.pending_requests_sent,
        });
      }
    } catch (err) {
      console.error('Failed to fetch summary:', err);
    }
  }, []);
  
  // Fetch connections list - wrapped in useCallback
  const fetchConnectionsList = useCallback(async (
    page: number = 1,
    searchTerm: string = '',
    onlineOnly: boolean = false,
  ) => {
    setLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('limit', '20');
      if (onlineOnly) params.set('online_only', 'true');
      
      if (searchTerm.trim()) {
        params.set('search', searchTerm.trim());
      }
      const response = await apiFetch(`/api/connections/list?${params.toString()}`);
      const data: ConnectionsListResponse = await response.json();
      
      if (data.success && data.connections) {
        const transformedAssociates: Associate[] = data.connections.map(conn => {
          const portfolioUrl = conn.portfolio_url ?? null;
          return {
            id: conn.id,
            connectionId: conn.connectionId,
            name: conn.name,
            role: conn.position || 'Professional',
            company: conn.business_name || '',
            location: conn.location || 'Location not specified',
            status: 'connected' as const,
            isOnline: conn.online_status,
            profileImage: resolveProfileImage(conn.profile_image),
            email: conn.email,
            portfolioUrl,
            alias: extractAliasFromPortfolioUrl(portfolioUrl),
          };
          
        });
        
        setAssociates(transformedAssociates);
        setPagination({
          page: data.pagination.page,
          limit: data.pagination.limit,
          total: data.pagination.total,
          pages: data.pagination.pages,
        });
      } else {
        setAssociates([]);
      }
    } catch (err) {
      console.error('Failed to fetch connections:', err);
      setError('Failed to load connections. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch pending requests - wrapped in useCallback
  const fetchPendingRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await apiFetch('/api/connections/requests/received?limit=50');
      const data: ReceivedRequestsResponse = await response.json();
      
      if (data.success && data.requests) {
        const pendingAssociates: Associate[] = data.requests.map(req => ({
          id: req.sender.id,
          connectionId: req.id,
          name: req.sender.name,
          role: 'Professional',
          company: req.sender.business_name || '',
          location: 'Location not specified',
          status: 'pending' as const,
          isOnline: false,
          profileImage: resolveProfileImage(req.sender.profile_image),
          email: req.sender.email,
        }));
        
        setAssociates(pendingAssociates);
        setPagination({
          page: 1,
          limit: 50,
          total: data.pagination.total,
          pages: data.pagination.pages,
        });
      } else {
        setAssociates([]);
      }
    } catch (err) {
      console.error('Failed to fetch pending requests:', err);
      setError('Failed to load pending requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch sent requests - wrapped in useCallback
  const fetchSentRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await apiFetch('/api/connections/requests/sent?limit=50&status=pending');
      const data: SentRequestsResponse = await response.json();
      
      if (data.success && data.requests) {
        const sentAssociates: Associate[] = data.requests.map(req => ({
          id: req.receiver.id,
          connectionId: req.id,
          name: req.receiver.name,
          role: 'Professional',
          company: req.receiver.business_name || '',
          location: 'Location not specified',
          status: 'sent' as const,
          isOnline: false,
          profileImage: resolveProfileImage(req.receiver.profile_image),
          email: req.receiver.email,
        }));
        
        setAssociates(sentAssociates);
        setPagination({
          page: 1,
          limit: 50,
          total: data.pagination.total,
          pages: data.pagination.pages,
        });
      } else {
        setAssociates([]);
      }
    } catch (err) {
      console.error('Failed to fetch sent requests:', err);
      setError('Failed to load sent requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load data based on current filter - wrapped in useCallback
  const loadData = useCallback(async (
    nextFilter: AssociateViewFilter = filter,
    page: number = pagination.page,
    searchTerm: string = search,
  ) => {
    await fetchSummary();
    
    if (nextFilter === 'connected') {
      await fetchConnectionsList(page, searchTerm, false);
    } else if (nextFilter === 'online') {
      await fetchConnectionsList(page, searchTerm, true);
    } else if (nextFilter === 'pending') {
      await fetchPendingRequests();
    } else if (nextFilter === 'sent') {
      await fetchSentRequests();
    }
  }, [filter, search, pagination.page, fetchSummary, fetchConnectionsList, fetchPendingRequests, fetchSentRequests]);

  // Respond to connection request
  const respondToRequest = useCallback(async (requestId: string, action: 'accept' | 'decline' | 'block') => {
    try {
      const response = await apiFetch('/api/connections/request/respond', {
        method: 'POST',
        body: JSON.stringify({
          request_id: requestId,
          action,
        }),
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        return true;
      } else {
        console.error('Failed to respond:', data.error);
        return false;
      }
    } catch (err) {
      console.error('Error responding to request:', err);
      return false;
    }
  }, []);

  // Remove connection
  const removeConnection = useCallback(async (connectionId: string) => {
    try {
      const response = await apiFetch('/api/connections/remove', {
        method: 'DELETE',
        body: JSON.stringify({
          connection_id: connectionId,
        }),
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        return true;
      } else {
        console.error('Failed to remove connection:', data.error);
        return false;
      }
    } catch (err) {
      console.error('Error removing connection:', err);
      return false;
    }
  }, []);

  // Handle accept pending request
  const handleAcceptRequest = useCallback(async (connectionId: string) => {
    const success = await respondToRequest(connectionId, 'accept');
    if (success) {
      showToast('Connection accepted.', 'success');
      window.dispatchEvent(new CustomEvent('ontap:connections-changed'));
      await loadData();
    }
  }, [respondToRequest, loadData]);

  // Handle decline pending request
  const handleDeclineRequest = useCallback(async (connectionId: string) => {
    const success = await respondToRequest(connectionId, 'decline');
    if (success) {
      await loadData();
    }
  }, [respondToRequest, loadData]);

  // Handle cancel sent request
  const handleCancelRequest = useCallback(async (connectionId: string) => {
    const success = await removeConnection(connectionId);
    if (success) {
      await loadData();
    }
  }, [removeConnection, loadData]);

  const closePortfolioModal = useCallback(() => {
    setPortfolioModalOpen(false);
    setPortfolioAlias(null);
    setPortfolioConnectionId(null);
  }, []);

  const handleViewCard = useCallback((item: Associate) => {
    if (!item.alias) {
      showToast('This connection does not have a public portfolio yet.', 'error');
      return;
    }
    setPortfolioAlias(item.alias);
    setPortfolioConnectionId(item.connectionId);
    setPortfolioModalOpen(true);
  }, []);

  const handleUnconnectSuccess = useCallback(
    (connectionId: string) => {
      setAssociates((prev) => prev.filter((row) => row.connectionId !== connectionId));
      closePortfolioModal();
      void loadData();
    },
    [closePortfolioModal, loadData],
  );

  // INITIAL LOAD ONLY - runs once on mount
  useEffect(() => {
    if (!initialLoadDone.current) {
      initialLoadDone.current = true;
      loadData();
    }
  }, [loadData]); // loadData is stable due to useCallback

  useEffect(() => {
    const refresh = () => { void loadData(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    window.addEventListener('ontap:connections-changed', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('ontap:connections-changed', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadData]);

  // Visibility-aware polling so peer unconnects refresh without a hard reload
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const start = () => {
      stop();
      if (document.visibilityState !== 'visible') return;
      intervalId = setInterval(() => {
        if (document.visibilityState === 'visible') {
          void loadData();
        }
      }, CONNECTIONS_POLL_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        start();
      } else {
        stop();
      }
    };

    start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadData]);

  // HANDLE FILTER CHANGE - cards + dropdown share this path
  const handleFilterChange = useCallback((newFilter: AssociateViewFilter) => {
    setFilter(newFilter);
    setPagination((prev) => ({ ...prev, page: 1 }));
    // Pass the new filter explicitly so we don't race the stale closure.
    void loadData(newFilter, 1, search);

    // On mobile, bring the filtered list into view after a card tap.
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches) {
      window.setTimeout(() => {
        listSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    }
  }, [loadData, search]);

  // HANDLE SEARCH - with debounce, but only for connected/online filters
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    
    if ((filter === 'connected' || filter === 'online') && value !== search) {
      searchTimeoutRef.current = setTimeout(() => {
        void fetchConnectionsList(1, value, filter === 'online');
      }, 500);
    }
  }, [filter, search, fetchConnectionsList]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: { y: 0, opacity: 1 },
  };

  const counterCards = useMemo(
    () => [
      {
        key: 'connected' as const,
        title: 'Total Connections',
        value: summary.totalConnections,
        icon: Users,
        hint: 'View all associates',
      },
      {
        key: 'online' as const,
        title: 'Online',
        value: summary.online,
        icon: Radio,
        hint: 'View associates online now',
      },
      {
        key: 'pending' as const,
        title: 'Pending Requests',
        value: summary.pending,
        icon: UserPlus,
        hint: 'Review incoming requests',
      },
      {
        key: 'sent' as const,
        title: 'Sent Requests',
        value: summary.sent,
        icon: Send,
        hint: 'Track requests you sent',
      },
    ],
    [summary],
  );

  const statusPill = (status: AssociationStatus) => {
    if (status === 'connected') return 'border-emerald-200/40 bg-emerald-400/20 text-emerald-50';
    if (status === 'pending') return 'border-white/25 bg-white/15 text-white';
    return 'border-amber-200/40 bg-amber-300/20 text-amber-50';
  };

  const statusLabel = (status: AssociationStatus) => {
    if (status === 'connected') return 'Connected';
    if (status === 'pending') return 'Pending';
    return 'Sent';
  };

  // Server already scopes list by view; only apply local search for pending/sent.
  const filtered = associates.filter((item) => {
    if (filter === 'connected' || filter === 'online') return true;
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) ||
      item.role.toLowerCase().includes(q) ||
      item.company.toLowerCase().includes(q) ||
      item.location.toLowerCase().includes(q)
    );
  });

  const listTitle = LIST_TITLES[filter];
  const emptyCopy = LIST_EMPTY_COPY[filter];
  const listCountLabel = loading && associates.length === 0
    ? 'Loading…'
    : `${filtered.length}${pagination.total > filtered.length ? ` of ${pagination.total}` : ''} shown`;

  if (error && associates.length === 0) {
    return (
      <div className="flex h-full min-h-[50vh] w-full items-center justify-center">
        <div className="text-center text-red-500">
          <p>Failed to load connections: {error}</p>
          <button
            onClick={() => loadData()}
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-white"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col gap-6 relative">
      {loading && associates.length === 0 ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#f8fafc]/95">
          <SectionLoader text="Loading connections..." />
        </div>
      ) : null}
      <PortalPageHeader
        title="Connections"
        titleClassName="bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent"
        subtitle="Manage your network and association requests"
      />
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="flex flex-col gap-5"
      >
        <PortalPanel padding="sm">
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
                    'group relative isolate overflow-hidden rounded-2xl border p-5 text-left text-white shadow-[0_8px_32px_rgba(20,35,78,0.16)] backdrop-blur-[8px] transition-all duration-300',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#4785B8]',
                    'hover:-translate-y-1 hover:shadow-[0_14px_36px_rgba(20,35,78,0.28)] active:scale-[0.99]',
                    isActive
                      ? 'border-white/55 bg-[linear-gradient(135deg,rgba(32,56,125,1)_0%,rgba(71,133,184,0.98)_100%)] ring-2 ring-white/70 ring-offset-2 ring-offset-[#f8fafc]'
                      : 'border-white/20 bg-[linear-gradient(135deg,rgba(32,56,125,0.96)_0%,rgba(74,111,165,0.90)_100%)]',
                  ].join(' ')}
                >
                  <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.22),transparent_42%)]" />
                  {isActive ? (
                    <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full border border-white/40 bg-white/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur-sm">
                      <Check className="h-3 w-3" /> Active
                    </span>
                  ) : null}
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="min-w-0 pr-10">
                      <p className="text-sm font-semibold text-blue-50/85">{card.title}</p>
                      <p className="mt-1 text-[11px] text-blue-100/70">{card.hint}</p>
                    </div>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white shadow-inner backdrop-blur-sm transition-transform duration-300 group-hover:scale-105">
                      <Icon className="h-5 w-5" />
                    </div>
                  </div>
                  <div className="flex items-end justify-between gap-2">
                    <p className="text-3xl font-bold tracking-tight text-white tabular-nums">{card.value}</p>
                    {card.key === 'online' && card.value > 0 ? (
                      <span className="mb-1 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-200">
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-60" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
                        </span>
                        Live
                      </span>
                    ) : null}
                  </div>
                </motion.button>
              );
            })}
          </div>
        </PortalPanel>

        <PortalPanel title="Search & filter" padding="sm">
        <motion.div variants={itemVariants} className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder={
                filter === 'online'
                  ? 'Search online associates...'
                  : filter === 'pending'
                    ? 'Search pending requests...'
                    : filter === 'sent'
                      ? 'Search sent requests...'
                      : 'Search connections...'
              }
              className="h-12 w-full rounded-xl border border-gray-200 bg-white pl-12 pr-4 text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4785B8]/30"
            />
          </div>

          <div className="relative">
            <select
              value={filter}
              onChange={(e) => handleFilterChange(e.target.value as AssociateViewFilter)}
              className="h-12 min-w-44 appearance-none rounded-xl border border-gray-200 bg-white px-4 pr-10 text-sm font-semibold text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#4785B8]/30"
              aria-label="Filter connections list"
            >
              <option value="connected">All connections</option>
              <option value="online">Online only</option>
              <option value="pending">Pending requests</option>
              <option value="sent">Sent requests</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6b7280]" />
          </div>
        </motion.div>
        </PortalPanel>

        <div ref={listSectionRef}>
        <PortalPanel
          title={listTitle}
          padding="sm"
          action={
            <span className="rounded-full border border-[#dbe3f0] bg-[#f3f6fb] px-2.5 py-1 text-xs font-semibold text-[#475569]">
              {listCountLabel}
            </span>
          }
        >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {filtered.map((item, idx) => {
            const initial = item.name.charAt(0).toUpperCase();
            return (
              <motion.div
                key={item.connectionId}
                variants={itemVariants}
                className="group relative isolate overflow-hidden rounded-2xl border border-white/20 bg-[linear-gradient(135deg,rgba(32,56,125,0.97)_0%,rgba(74,111,165,0.91)_58%,rgba(107,143,196,0.88)_100%)] px-4 py-5 text-white shadow-[0_8px_32px_rgba(20,35,78,0.18)] backdrop-blur-[8px] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_16px_40px_rgba(20,35,78,0.30)] sm:px-5"
                style={{ animation: `fadeInUp 0.35s ease ${idx * 60}ms both` }}
              >
                <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.20),transparent_38%)] opacity-90 transition-opacity duration-300 group-hover:opacity-100" />
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="relative shrink-0">
                      {item.profileImage && !failedAvatarIds[item.connectionId] ? (
                        <img
                          src={item.profileImage}
                          alt={item.name}
                          className="h-11 w-11 rounded-full border-2 border-white/45 object-cover shadow-md"
                          onError={() => {
                            setFailedAvatarIds((prev) =>
                              prev[item.connectionId] ? prev : { ...prev, [item.connectionId]: true },
                            );
                          }}
                        />
                      ) : (
                        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-white/15 text-xl font-bold text-white shadow-inner backdrop-blur-sm">
                          {initial}
                        </div>
                      )}
                      {item.status === 'connected' ? (
                        <span
                          className={[
                            'absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#2a4a8c]',
                            item.isOnline ? 'bg-emerald-400' : 'bg-slate-300',
                          ].join(' ')}
                          title={item.isOnline ? 'Online' : 'Offline'}
                          aria-label={item.isOnline ? 'Online' : 'Offline'}
                        />
                      ) : null}
                    </div>

                    <div className="min-w-0">
                      <p className="truncate text-[20px] font-semibold leading-none text-white">{item.name}</p>
                      <p className="mt-1 text-[12px] leading-tight text-blue-50/90">{item.role}</p>
                      <p className="text-[12px] leading-tight text-blue-100/75">{item.company}</p>
                      <p className="mt-3 flex items-center gap-1 text-[12px] text-blue-50/75">
                        <MapPin className="h-3.5 w-3.5" /> {item.location.toLowerCase()}
                      </p>
                    </div>
                  </div>

                  <span className={`shrink-0 rounded-full border px-3 py-1 text-[12px] font-semibold shadow-sm backdrop-blur-sm ${statusPill(item.status)}`}>
                    {filter === 'online' && item.isOnline ? 'Online' : statusLabel(item.status)}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {item.status === 'connected' && (
                    <>
                      <button 
                        onClick={() => {
                          setMessagingPeerId(item.id);
                          setMessagingOpen(true);
                        }}
                        className="inline-flex items-center gap-1 rounded-full border border-white/70 bg-white px-3 py-1.5 text-xs font-semibold text-[#20387D] shadow-sm transition-all duration-200 hover:scale-[1.03] hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 active:scale-95"
                      >
                        <MessageCircle className="h-3.5 w-3.5" /> Message
                      </button>
                      <button 
                        onClick={() => handleViewCard(item)}
                        className="inline-flex items-center gap-1 rounded-full border border-white/35 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white shadow-sm backdrop-blur-sm transition-all duration-200 hover:scale-[1.03] hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 active:scale-95"
                      >
                        <Eye className="h-3.5 w-3.5" /> View card
                      </button>
                    </>
                  )}

                  {item.status === 'pending' && (
                    <>
                      <button
                        onClick={() => handleAcceptRequest(item.connectionId)}
                        className="inline-flex items-center gap-1 rounded-full border border-white/70 bg-white px-3 py-1.5 text-xs font-semibold text-[#20387D] shadow-sm transition-all duration-200 hover:scale-[1.03] hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 active:scale-95"
                      >
                        <Check className="h-3.5 w-3.5" /> Accept
                      </button>
                      <button
                        onClick={() => handleDeclineRequest(item.connectionId)}
                        className="inline-flex items-center gap-1 rounded-full border border-white/35 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white shadow-sm backdrop-blur-sm transition-all duration-200 hover:scale-[1.03] hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 active:scale-95"
                      >
                        <X className="h-3.5 w-3.5" /> Decline
                      </button>
                    </>
                  )}

                  {item.status === 'sent' && (
                    <button
                      onClick={() => handleCancelRequest(item.connectionId)}
                      className="inline-flex items-center gap-1 rounded-full border border-white/35 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white shadow-sm backdrop-blur-sm transition-all duration-200 hover:scale-[1.03] hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 active:scale-95"
                    >
                      <X className="h-3.5 w-3.5" /> Cancel request
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}

          {filtered.length === 0 && !loading && (
            <motion.div
              variants={itemVariants}
              className="col-span-full rounded-2xl border border-dashed border-[#cbd5e1] bg-white p-10 text-center"
            >
              <p className="text-base font-semibold text-[#374151]">{emptyCopy.title}</p>
              <p className="mt-1 text-sm text-[#9ca3af]">{emptyCopy.hint}</p>
              {filter !== 'connected' ? (
                <button
                  type="button"
                  onClick={() => handleFilterChange('connected')}
                  className="mt-4 inline-flex items-center justify-center rounded-full bg-[#20387D] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#2a4a8c]"
                >
                  View all connections
                </button>
              ) : null}
            </motion.div>
          )}
          
          {loading && associates.length > 0 ? (
            <motion.div
              variants={itemVariants}
              className="col-span-full rounded-2xl bg-white p-6"
            >
              <SectionLoader text="Refreshing..." size="md" minHeightClass="min-h-24" />
            </motion.div>
          ) : null}
        </div>
        </PortalPanel>
        </div>
        {pagination.pages > 1 && (filter === 'connected' || filter === 'online') && (
          <div className="mt-4 flex justify-center gap-2">
            <button
              onClick={() => {
                const newPage = pagination.page - 1;
                setPagination(prev => ({ ...prev, page: newPage }));
                void fetchConnectionsList(newPage, search, filter === 'online');
              }}
              disabled={pagination.page === 1}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 disabled:opacity-50"
            >
              Previous
            </button>
            <span className="px-3 py-1.5 text-sm text-gray-600">
              Page {pagination.page} of {pagination.pages}
            </span>
            <button
              onClick={() => {
                const newPage = pagination.page + 1;
                setPagination(prev => ({ ...prev, page: newPage }));
                void fetchConnectionsList(newPage, search, filter === 'online');
              }}
              disabled={pagination.page === pagination.pages}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </motion.div>

      <ConnectionMessengerPanel
        open={messagingOpen}
        initialPeerUserId={messagingPeerId}
        onClose={() => {
          setMessagingOpen(false);
          setMessagingPeerId(null);
        }}
      />

      <ConnectionPortfolioModal
        open={portfolioModalOpen}
        alias={portfolioAlias}
        connectionId={portfolioConnectionId}
        onClose={closePortfolioModal}
        onUnconnectSuccess={handleUnconnectSuccess}
      />
    </div>
  );
};
export default AssociateUser;