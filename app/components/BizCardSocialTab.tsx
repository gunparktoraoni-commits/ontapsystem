'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Link2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { InlineLoader } from './Loader';
import type { SocialLink, VCardFormData } from '../types';
import { SectionCard } from './BizCardShared';
import {
  detectSocialPlatformFromUrl,
  resolveSocialPlatformDef,
  resolveSocialPlatformDefFromLink,
  type SocialPlatformDef,
} from '@/app/lib/socialPlatforms';
import { showToast } from './Toast';
import { showConfirmDialog } from './ConfirmDialog';
import {
  dedupeSocialLinksByUrl,
  hasDuplicateSocialUrl,
} from '@/lib/social-links';

export interface SocialTabProps {
  vcard: VCardFormData;
  setVcard: React.Dispatch<React.SetStateAction<VCardFormData>>;
  onPersistSocialLinks?: (links: SocialLink[]) => Promise<void>;
  setupCompleted?: boolean;
}

function isValidHttpUrl(value: string): boolean {
  return /^https?:\/\/.+/i.test(value.trim());
}

function PlatformBadge({
  platform,
  size = 40,
}: {
  platform: SocialPlatformDef;
  size?: number;
}) {
  const Icon = platform.Icon;
  return (
    <div
      className="rounded-xl flex items-center justify-center shrink-0"
      style={{
        width: size,
        height: size,
        backgroundColor: `${platform.color}18`,
      }}
    >
      <Icon size={Math.round(size * 0.45)} style={{ color: platform.color }} />
    </div>
  );
}

export function SavedSocialLinksList({
  links,
  onUpdateUrl,
  onRemove,
}: {
  links: SocialLink[];
  onUpdateUrl: (id: number, url: string) => void;
  onRemove: (id: number) => void;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);

  if (links.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-5 py-10 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
          <Link2 className="h-5 w-5 text-slate-400" />
        </div>
        <p className="text-sm font-semibold text-slate-800">No social links yet</p>
        <p className="mt-1 text-xs text-slate-500">
          Add LinkedIn, GitHub, or other profiles below. They appear on your public portfolio.
        </p>
      </div>
    );
  }

  const requestRemove = async (link: SocialLink) => {
    const platform = resolveSocialPlatformDefFromLink(link.platform, link.url);
    const confirmed = await showConfirmDialog({
      title: 'Delete social link',
      message: link.url.trim()
        ? `Remove ${platform.key} (${link.url.trim()}) from your bizcard?`
        : `Remove ${platform.key} from your bizcard?`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) return;
    onRemove(link.id);
  };

  return (
    <ul className="space-y-3">
      {links.map((link) => {
        const platform = resolveSocialPlatformDefFromLink(link.platform, link.url);
        const editing = editingId === link.id;
        const invalid = link.url.trim().length > 0 && !isValidHttpUrl(link.url);

        return (
          <li
            key={link.id}
            className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm transition-colors hover:border-slate-300"
          >
            <div className="flex items-start gap-3">
              <PlatformBadge platform={platform} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {platform.key}
                    </p>
                    {!editing ? (
                      <a
                        href={isValidHttpUrl(link.url) ? link.url : undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-0.5 block truncate text-xs text-slate-500 hover:text-primary"
                      >
                        {link.url || 'No URL set'}
                      </a>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setEditingId(editing ? null : link.id)}
                      className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                      aria-label={editing ? 'Done editing' : 'Edit link'}
                    >
                      {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => void requestRemove(link)}
                      className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                      aria-label={`Remove ${platform.key}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {editing ? (
                  <div className="mt-2.5">
                    <input
                      type="url"
                      value={link.url}
                      onChange={(event) => onUpdateUrl(link.id, event.target.value)}
                      placeholder={platform.placeholder}
                      className={`w-full rounded-xl border px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
                        invalid ? 'border-red-300' : 'border-slate-200'
                      }`}
                      autoFocus
                    />
                    {invalid ? (
                      <p className="mt-1 text-[11px] text-red-500">
                        Use a valid http:// or https:// URL
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function AddSocialLinkForm({
  onAdd,
}: {
  onAdd: (platformKey: string, url: string) => boolean;
}) {
  const [url, setUrl] = useState('');

  const detected = useMemo(() => detectSocialPlatformFromUrl(url), [url]);
  const invalid = url.trim().length > 0 && !isValidHttpUrl(url);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      showToast('Enter a profile URL to add.', 'error');
      return;
    }
    if (!isValidHttpUrl(trimmed)) {
      showToast('Use a valid http:// or https:// URL.', 'error');
      return;
    }
    const platform = detectSocialPlatformFromUrl(trimmed);
    const ok = onAdd(platform.key, trimmed);
    if (ok) {
      setUrl('');
      showToast(`${platform.key} link added.`, 'success');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className="block text-xs font-semibold text-slate-600">
        Profile URL
      </label>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <div
          className={`flex min-w-0 flex-1 items-center gap-0 overflow-hidden rounded-xl border bg-white transition-colors focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary ${
            invalid ? 'border-red-300' : 'border-slate-200'
          }`}
        >
          <div
            className="flex h-full shrink-0 items-center justify-center border-r border-slate-100 px-3.5 py-2.5"
            style={{ backgroundColor: `${detected.color}12` }}
            title={detected.key}
            aria-label={`Detected platform: ${detected.key}`}
          >
            <detected.Icon size={18} style={{ color: detected.color }} />
          </div>
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="Paste a link — e.g. https://linkedin.com/in/you"
            className="min-w-0 flex-1 border-0 bg-transparent px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0"
            aria-describedby="social-link-detect-hint"
          />
        </div>
        <button
          type="submit"
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-hover"
        >
          <Plus className="h-4 w-4" />
          Add link
        </button>
      </div>

      {invalid ? (
        <p className="text-[11px] text-red-500">Use a valid http:// or https:// URL</p>
      ) : url.trim() ? (
        <p id="social-link-detect-hint" className="text-[11px] text-slate-500">
          Detected as{' '}
          <span className="font-semibold" style={{ color: detected.color }}>
            {detected.key}
          </span>
          . You can add more than one link for the same platform.
        </p>
      ) : (
        <p id="social-link-detect-hint" className="text-[11px] text-slate-400">
          The icon updates automatically from the domain (facebook.com, linkedin.com, github.com, …).
          Multiple links for the same platform are allowed.
        </p>
      )}
    </form>
  );
}

export default function SocialTab({
  vcard,
  setVcard,
  onPersistSocialLinks,
  setupCompleted = false,
}: SocialTabProps) {
  const skipPersistRef = useRef(true);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [persisting, setPersisting] = useState(false);
  const [persisted, setPersisted] = useState(false);

  const savedLinks = useMemo(
    () =>
      dedupeSocialLinksByUrl(
        vcard.socialLinks.filter(
          (link) => link.platform.trim() && link.url.trim(),
        ),
        (link) => link.url,
      ),
    [vcard.socialLinks],
  );

  const updateLinkUrl = useCallback(
    (id: number, url: string) => {
      if (
        url.trim() &&
        hasDuplicateSocialUrl(vcard.socialLinks, url, { ignoreId: id })
      ) {
        showToast('That URL is already on your list.', 'error');
        return;
      }
      setVcard((previous) => ({
        ...previous,
        socialLinks: previous.socialLinks.map((link) => {
          if (link.id !== id) return link;
          const detected = detectSocialPlatformFromUrl(url);
          return {
            ...link,
            url,
            // Keep platform in sync when the edited URL points to a known network
            platform:
              detected.slug === 'other' && !url.trim()
                ? link.platform
                : detected.key,
          };
        }),
      }));
    },
    [setVcard, vcard.socialLinks],
  );

  const removeLink = useCallback(
    (id: number) => {
      setVcard((previous) => ({
        ...previous,
        socialLinks: previous.socialLinks.filter((link) => link.id !== id),
      }));
      showToast('Social link removed.', 'info');
    },
    [setVcard],
  );

  const addLink = useCallback(
    (platformKey: string, url: string) => {
      const def = resolveSocialPlatformDef(platformKey);
      if (hasDuplicateSocialUrl(vcard.socialLinks, url)) {
        showToast('That URL is already on your list.', 'error');
        return false;
      }

      setVcard((previous) => ({
        ...previous,
        socialLinks: [
          ...previous.socialLinks,
          { id: Date.now(), platform: def.key, url },
        ],
      }));
      return true;
    },
    [setVcard, vcard.socialLinks],
  );

  useEffect(() => {
    if (!setupCompleted || !onPersistSocialLinks) return;

    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }

    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
    }

    persistTimerRef.current = setTimeout(() => {
      setPersisting(true);
      setPersisted(false);
      void onPersistSocialLinks(vcard.socialLinks)
        .then(() => {
          setPersisted(true);
          window.setTimeout(() => setPersisted(false), 2000);
        })
        .finally(() => {
          setPersisting(false);
        });
    }, 700);

    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }
    };
  }, [vcard.socialLinks, onPersistSocialLinks, setupCompleted]);

  return (
    <div className="space-y-4">
      <SectionCard title="Your social links">
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            {savedLinks.length} saved link{savedLinks.length === 1 ? '' : 's'} · changes save
            automatically
          </p>
          {setupCompleted && (persisting || persisted) ? (
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold ${
                persisted ? 'text-emerald-600' : 'text-slate-400'
              }`}
            >
              {persisting ? (
                <>
                  <InlineLoader /> Saving…
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5" /> Saved
                </>
              )}
            </span>
          ) : null}
        </div>
        <SavedSocialLinksList
          links={savedLinks}
          onUpdateUrl={updateLinkUrl}
          onRemove={removeLink}
        />
      </SectionCard>

      <SectionCard title="Add a social link">
        <p className="mb-4 text-xs text-slate-500">
          Paste a profile URL. The platform icon is detected automatically from the link.
        </p>
        <AddSocialLinkForm onAdd={addLink} />
      </SectionCard>
    </div>
  );
}
