'use client';

import React, { useState } from 'react';
import { Download, Share2, UserRoundPlus } from 'lucide-react';
import type { PortfolioViewProps } from '../shared';
import {
  getDisplayName,
  downloadVCard,
  sendPortfolioAssociateRequest,
  usePortfolioViewerSession,
  usePortfolioConnectStatus,
  isSuppressingConnectStatus,
  showToast,
} from '../shared';
import PortfolioConnectModal, {
  useDelayedPortfolioConnectPrompt,
} from './PortfolioConnectModal';
import PortfolioPromptDockButton from './PortfolioPromptDock';
import { useIsThemePreview } from './PortfolioThemeContext';

type PortfolioData = NonNullable<PortfolioViewProps['data']>;

/** Pick black or white label text for readable contrast on an accent fill. */
function contrastOnAccent(hex: string): '#0a0a0a' | '#ffffff' {
  const raw = hex.trim().replace('#', '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((ch) => `${ch}${ch}`)
          .join('')
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return '#ffffff';
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.55 ? '#0a0a0a' : '#ffffff';
}

interface PortfolioActionButtonsProps {
  /** Portfolio data */
  data: PortfolioData;
  /** Share URL (typically the portfolio page URL) */
  shareUrl?: string;
  /** Theme colors */
  theme: {
    accent: string;
    accentGlow?: string;
    /** Explicit text color on the primary (Connect) fill — overrides auto contrast */
    primaryText?: string;
    text: string;
    surface?: string;
    border?: string;
    buttonClass?: string;
    buttonGhostClass?: string;
  };
  /** Optional: button layout - 'row' (horizontal) or 'column' (vertical) */
  layout?: 'row' | 'column';
  /** Optional: show only connect button */
  connectOnly?: boolean;
  /** Optional: compact size */
  compact?: boolean;
  /** Optional: icon-only mode */
  iconOnly?: boolean;
  /** Optional: custom button styles */
  buttonStyle?: React.CSSProperties;
}

/**
 * Global PortfolioActionButtons component
 * 
 * Displays three action buttons:
 * 1. Connect - Visible to all visitors; authentication is explained in a bottom sheet
 * 2. Save Contact - For all visitors (downloads vCard)
 * 3. Share - For all visitors (shares portfolio URL)
 */
export default function PortfolioActionButtons({
  data,
  shareUrl = '',
  theme,
  layout = 'row',
  connectOnly = false,
  compact = false,
  iconOnly = false,
  buttonStyle = {},
}: PortfolioActionButtonsProps) {
  const { checked: sessionChecked, isAuthenticated, customUri } = usePortfolioViewerSession();
  const isThemePreview = useIsThemePreview();
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectSent, setConnectSent] = useState(false);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [showConnectDock, setShowConnectDock] = useState(false);

  const name = getDisplayName(data);

  // Normalize both URLs for comparison (trim, lowercase, remove leading slashes)
  const normalizeUri = (uri: string | null | undefined): string => {
    if (!uri) return '';
    return String(uri).trim().replace(/^\/+/, '').toLowerCase();
  };

  // Check if user is viewing own portfolio
  const isOwnPortfolio = customUri && data.bizCard.urlAlias 
    ? normalizeUri(customUri) === normalizeUri(data.bizCard.urlAlias)
    : false;

  // Server-authoritative relationship check: suppress the modal on self-view or
  // when a request is already pending/accepted/blocked (persists across visits).
  const { resolved: statusResolved, status: connectStatus } = usePortfolioConnectStatus({
    urlAlias: data.bizCard.urlAlias,
    enabled: sessionChecked && isAuthenticated && !isOwnPortfolio,
  });
  const isSelfView = connectStatus === 'self';
  const hasActiveRequest = isSuppressingConnectStatus(connectStatus);
  const alreadyHandled = connectSent || hasActiveRequest;
  const hideConnect = isOwnPortfolio || isSelfView;

  useDelayedPortfolioConnectPrompt({
    enabled:
      !isThemePreview &&
      sessionChecked &&
      statusResolved &&
      !hideConnect &&
      !alreadyHandled &&
      isAuthenticated &&
      !connectModalOpen &&
      !showConnectDock,
    onOpen: () => setConnectModalOpen(true),
    onMobilePrompt: () => setShowConnectDock(true),
  });

  const handleConnect = async () => {
    if (connectLoading || alreadyHandled || !sessionChecked || !isAuthenticated || !statusResolved) return;

    setConnectLoading(true);
    try {
      const result = await sendPortfolioAssociateRequest(data.bizCard.urlAlias);
      setConnectLoading(false);

      if (result.ok) {
        setConnectSent(true);
        setConnectModalOpen(false);
        setShowConnectDock(false);
        showToast('Associate request sent successfully.', 'success');
        return;
      }

      if (result.code === 'conflict') {
        setConnectSent(true);
        setConnectModalOpen(false);
        setShowConnectDock(false);
        showToast(result.message, 'info');
        return;
      }

      showToast(result.message, 'error');
    } catch (err) {
      setConnectLoading(false);
      showToast('Failed to send associate request.', 'error');
    }
  };

  const handleShare = async () => {
    if (typeof window === 'undefined') return;

    const url = shareUrl || `${window.location.origin}/${data.bizCard.urlAlias}`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: name,
          url,
        }).catch(() => {
          // User cancelled, that's fine
        });
      } else {
        await navigator.clipboard.writeText(url);
        showToast('Portfolio URL copied to clipboard!', 'success');
      }
    } catch (err) {
      showToast('Failed to share portfolio.', 'error');
    }
  };

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: layout === 'column' ? 'column' : 'row',
    gap: compact ? 8 : 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    zIndex: 999
  };

  const baseButtonStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: compact ? '8px 14px' : '11px 20px',
    borderRadius: '9999px',
    border: 'none',
    cursor: 'pointer',
    fontSize: compact ? '12px' : '13px',
    fontWeight: 600,
    fontFamily: "'DM Sans',sans-serif",
    transition: 'all 0.2s ease',
    whiteSpace: 'nowrap',
    ...buttonStyle,
  };

  const primaryLabel = theme.primaryText || contrastOnAccent(theme.accent);

  const primaryButtonStyle: React.CSSProperties = {
    ...baseButtonStyle,
    background: `linear-gradient(135deg,${theme.accent} 0%,${theme.accentGlow || theme.accent} 100%)`,
    color: primaryLabel,
    boxShadow: `0 5px 20px ${theme.accentGlow || theme.accent}33`,
  };

  const secondaryButtonStyle: React.CSSProperties = {
    ...baseButtonStyle,
    background: theme.surface || 'transparent',
    color: theme.text,
    border: `1px solid ${theme.border || 'rgba(0,0,0,0.1)'}`,
  };

  return (
    <>
    <div style={containerStyle}>
      {/* Connect stays discoverable for guests; the modal explains account requirements. */}
      {!hideConnect && (
        <button
          type="button"
          onClick={() => {
            if (isThemePreview) return;
            setConnectModalOpen(true);
          }}
          disabled={!sessionChecked || !statusResolved || connectLoading || alreadyHandled}
          style={primaryButtonStyle}
          aria-label="Connect with portfolio owner"
          title="Send a connection request to this portfolio owner"
        >
          {connectLoading ? (
            <>
              <span
                style={{
                  display: 'inline-block',
                  width: compact ? 12 : 14,
                  height: compact ? 12 : 14,
                  borderRadius: '50%',
                  border: `2px solid ${primaryLabel === '#ffffff' ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)'}`,
                  borderTopColor: primaryLabel,
                  animation: 'spin 0.6s linear infinite',
                }}
              />
              {!iconOnly && <span>Connecting...</span>}
            </>
          ) : (
            <>
              <UserRoundPlus style={{ width: compact ? 14 : 16, height: compact ? 14 : 16 }} />
              {!iconOnly && (
                <span>
                  {connectStatus === 'accepted'
                    ? 'Connected'
                    : alreadyHandled
                      ? 'Request Sent'
                      : 'Connect'}
                </span>
              )}
            </>
          )}
        </button>
      )}

      {/* Save Contact Button - For all visitors */}
      {!connectOnly && (
        <button
          type="button"
          onClick={() => downloadVCard(data)}
          style={secondaryButtonStyle}
          aria-label="Save contact to your device"
          title="Download contact information as vCard"
        >
          <Download style={{ width: compact ? 14 : 16, height: compact ? 14 : 16 }} />
          {!iconOnly && <span>Save Contact</span>}
        </button>
      )}

      {/* Share Button - For all visitors */}
      {!connectOnly && (
        <button
          type="button"
          onClick={handleShare}
          style={secondaryButtonStyle}
          aria-label="Share this portfolio"
          title="Share this portfolio with others"
        >
          <Share2 style={{ width: compact ? 14 : 16, height: compact ? 14 : 16 }} />
          {!iconOnly && <span>Share</span>}
        </button>
      )}

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
    {!isThemePreview && showConnectDock && !connectModalOpen && !hideConnect && !alreadyHandled ? (
      <PortfolioPromptDockButton
        label="Connect?"
        themeId={data.selectedTheme}
        theme={{
          accent: theme.accent,
          text: theme.text,
          surface: theme.surface,
          border: theme.border,
        }}
        onClick={() => {
          setConnectModalOpen(true);
        }}
        onDismiss={() => setShowConnectDock(false)}
      />
    ) : null}
    {!isThemePreview && (
    <PortfolioConnectModal
      open={connectModalOpen}
      isAuthenticated={isAuthenticated}
      ownerName={name}
      themeId={data.selectedTheme}
      theme={{
        accent: theme.accent,
        text: theme.text,
        surface: theme.surface,
        border: theme.border,
      }}
      loading={connectLoading}
      onClose={() => {
        if (!connectLoading) setConnectModalOpen(false);
      }}
      onConfirm={() => { void handleConnect(); }}
    />
    )}
    </>
  );
}
