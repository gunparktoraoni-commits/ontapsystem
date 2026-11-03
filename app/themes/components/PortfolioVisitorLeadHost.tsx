'use client';

import { useEffect, useState } from 'react';
import type { PortfolioData } from '@/app/types';
import {
  getDisplayName,
  isViewingOwnPortfolioUrl,
  usePortfolioViewerSession,
} from '../shared';
import { useIsThemePreview } from './PortfolioThemeContext';
import PortfolioPromptDockButton from './PortfolioPromptDock';
import PortfolioVisitorLeadModal, {
  canPromptVisitorLead,
  useDelayedPortfolioVisitorLeadPrompt,
} from './PortfolioVisitorLeadModal';

/**
 * Global guest lead-capture host mounted by ThemeLoader for every portfolio theme.
 * Only prompts visitors with no active session.
 * On mobile, shows a bottom dock button (aligned with the FAB) before opening the modal.
 */
export default function PortfolioVisitorLeadHost({
  data,
  themeId,
  mini = false,
}: {
  data?: PortfolioData | null;
  themeId?: string | null;
  mini?: boolean;
}) {
  const alias = data?.bizCard.urlAlias?.trim() ?? '';
  const { checked, isAuthenticated, customUri } = usePortfolioViewerSession();
  const isThemePreview = useIsThemePreview();
  const [open, setOpen] = useState(false);
  const [showDock, setShowDock] = useState(false);

  const isOwn =
    Boolean(alias) && isViewingOwnPortfolioUrl(alias, customUri);
  const canPrompt =
    !mini &&
    !isThemePreview &&
    checked &&
    !isAuthenticated &&
    !isOwn &&
    Boolean(alias) &&
    canPromptVisitorLead(alias);

  useDelayedPortfolioVisitorLeadPrompt({
    enabled: canPrompt && !open && !showDock,
    onOpen: () => setOpen(true),
    onMobilePrompt: () => setShowDock(true),
  });

  useEffect(() => {
    if (checked && isAuthenticated && open) setOpen(false);
    if (checked && isAuthenticated && showDock) setShowDock(false);
  }, [checked, isAuthenticated, open, showDock]);

  if (!alias || mini) return null;

  const ownerName = data ? getDisplayName(data) : undefined;

  return (
    <>
      {showDock && !open && canPrompt ? (
        <PortfolioPromptDockButton
          label="Leave details?"
          themeId={themeId}
          onClick={() => {
            setOpen(true);
          }}
          onDismiss={() => setShowDock(false)}
        />
      ) : null}
      <PortfolioVisitorLeadModal
        open={open}
        urlAlias={alias}
        ownerName={ownerName}
        ownerTitle={
          data?.vcard.professionalTitle?.trim() ||
          data?.bizCard.occupation?.trim() ||
          undefined
        }
        ownerImage={data?.bizCard.profileImage ?? null}
        themeId={themeId}
        onClose={() => setOpen(false)}
        onSubmitted={() => {
          setShowDock(false);
          setOpen(false);
        }}
      />
    </>
  );
}
