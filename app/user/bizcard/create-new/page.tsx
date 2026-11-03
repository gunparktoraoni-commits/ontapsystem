"use client";

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, Save } from 'lucide-react';
import type { BizCardFormData, GalleryItem, ServiceItem, VCardFormData, VideoItem } from '../../../types';
import VcardTab from '../../../components/BizCardVcardTab';
import DesignTab from '../../../components/BizCardDesignTab';
import ServicesTab from '../../../components/BizCardServicesTab';
import SocialTab from '../../../components/BizCardSocialTab';
import { getFrontendApiBaseUrl } from '../../../components/apiBase';
import { normalizePortfolioThemeId } from '../../../themes/ThemeLoader';
import { csrfClient } from '@/lib/csrf-client';
import { InlineLoader } from '@/app/components/Loader';
import { showToast } from '../../../components/Toast';
import { extractClaimSerial, persistClaimSerial } from '@/lib/bizcard/claim-urls';

const API = getFrontendApiBaseUrl();
const TABS = [
  { id: 'vcard', label: 'Vcard details' },
  { id: 'design', label: 'Card Design' },
  { id: 'services', label: 'Services' },
  { id: 'social', label: 'Social Links' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const EMPTY_BIZCARD: BizCardFormData = {
  urlAlias: '',
  bizCardName: '',
  description: '',
  occupation: '',
  profileImage: null,
  coverImage: null,
  coverType: null,
  coverFileName: null,
};

const EMPTY_VCARD: VCardFormData = {
  firstName: '',
  middleName: '',
  lastName: '',
  professionalTitle: '',
  postNominalLetters: '',
  suffix: 'N/A',
  about: '',
  contactNumber: '',
  secondaryNumber: '',
  telephoneNumber: '',
  altTelephoneNumber: '',
  email: '',
  alternativeEmail: '',
  languages: '',
  addressArea: '',
  addressHouseNo: '',
  addressBrgy: '',
  addressCity: '',
  addressRegion: '',
  addressZipcode: '',
  addressMapLink: '',
  addressLandmark: '',
  socialLinks: [],
};

export default function CreateBizcardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const claimSerial = extractClaimSerial(searchParams.get('serial') ?? '') ?? '';
  const [tab, setTab] = useState<TabId>('vcard');
  const [bizCard, setBizCard] = useState<BizCardFormData>(EMPTY_BIZCARD);
  const [vcard, setVcard] = useState<VCardFormData>(EMPTY_VCARD);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [selectedTheme, setSelectedTheme] = useState('elegant-dark');
  const [subscriptionTier, setSubscriptionTier] = useState('basic');
  const [isDevUser, setIsDevUser] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (claimSerial) persistClaimSerial(claimSerial);
  }, [claimSerial]);

  useEffect(() => {
    let alive = true;

    const loadAccessContext = async () => {
      try {
        const [sessionResult, subscriptionResult] = await Promise.allSettled([
          fetch(`${API}/api/auth/session`, { credentials: 'include', cache: 'no-store' }),
          fetch(`${API}/api/user/subscription`, { credentials: 'include', cache: 'no-store' }),
        ]);

        let nextIsDevUser = false;
        let nextSubscriptionTier = 'basic';

        if (sessionResult.status === 'fulfilled' && sessionResult.value.ok) {
          const sessionPayload = await sessionResult.value.json().catch(() => null) as Record<string, unknown> | null;
          const user = sessionPayload?.user as Record<string, unknown> | undefined;
          nextIsDevUser =
            String(user?.role ?? '').toLowerCase() === 'dev' ||
            String(user?.role ?? '').toLowerCase() === 'super_admin';
        }

        if (subscriptionResult.status === 'fulfilled' && subscriptionResult.value.ok) {
          const subscriptionPayload = await subscriptionResult.value.json().catch(() => null) as Record<string, unknown> | null;
          const subscriptionData = (subscriptionPayload?.data ?? subscriptionPayload) as Record<string, unknown> | null;
          nextSubscriptionTier = String(subscriptionData?.tier ?? 'basic').toLowerCase();
        }

        if (alive) {
          setIsDevUser(nextIsDevUser);
          setSubscriptionTier(nextSubscriptionTier);
        }
      } catch {
        if (alive) {
          setIsDevUser(false);
          setSubscriptionTier('basic');
        }
      }
    };

    void loadAccessContext();
    return () => {
      alive = false;
    };
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaved(false);  
    try {
      const createBody = {
        bizcard_name: bizCard.bizCardName,
        url_alias: bizCard.urlAlias || null,
        description: bizCard.description || null,
        first_name: vcard.firstName,
        middle_name: vcard.middleName || null,
        last_name: vcard.lastName,
        professional_title: vcard.professionalTitle || null,
        email: vcard.email,
        contact_number: vcard.contactNumber,
        alt_contact_number: vcard.secondaryNumber || null,
        telephone_number: vcard.telephoneNumber || null,
        alt_telephone_number: vcard.altTelephoneNumber || null,
        alt_email: vcard.alternativeEmail || null,
        city: vcard.addressCity,
        bizcard_type: 'virtual',
        copy_from: null,
      };
      const createOpts = await csrfClient.getFetchOptions('POST', createBody, false, API);
      const response = await fetch(`${API}/api/user/bizcards`, createOpts);

      const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
      const success = payload?.success === true;

      if (!response.ok || !success) {
        const errorMessage = typeof payload?.error === 'string'
          ? payload.error
          : typeof payload?.message === 'string'
            ? payload.message
            : 'Unable to create BizCard. Please check your entries and try again.';
        showToast(errorMessage, 'error');
        return;
      }

      const createdData = (payload?.data ?? null) as Record<string, unknown> | null;
      const createdBizcardId = String(createdData?.bizcard_id ?? '').trim();
      const createdAlias = String(createdData?.url_alias ?? bizCard.urlAlias ?? '').trim();
      const normalizedTheme = normalizePortfolioThemeId(selectedTheme);

      if (claimSerial && createdBizcardId) {
        try {
          const mergeOpts = await csrfClient.getFetchOptions(
            'POST',
            { serialId: claimSerial, virtualCardId: createdBizcardId },
            false,
            API,
          );
          const mergeResponse = await fetch(`${API}/api/bizcard/merge`, mergeOpts);
          const mergePayload = await mergeResponse.json().catch(() => null);
          if (!mergeResponse.ok || !mergePayload?.success) {
            showToast(
              typeof mergePayload?.error?.message === 'string'
                ? mergePayload.error.message
                : 'BizCard created, but linking the physical card failed. Try merging from your BizCard list.',
              'error',
            );
          }
        } catch {
          showToast('BizCard created, but linking the physical card failed. Try merging from your BizCard list.', 'error');
        }
      }

      if (createdBizcardId && normalizedTheme) {
        try {
          const updateOpts = await csrfClient.getFetchOptions(
            'PUT',
            { bizcard_id: createdBizcardId, bizcard_theme: normalizedTheme },
            false,
            API,
          );
          await fetch(`${API}/api/bizcard/update`, updateOpts);
        } catch {
          // Non-blocking: BizCard record was created successfully.
        }
      }

      if (typeof window !== 'undefined') {
        try {
          if (createdAlias) {
            window.localStorage.setItem('latestPortfolioAlias', createdAlias);
            window.localStorage.setItem('portfolio_refresh_ts', String(Date.now()));
          }
          window.localStorage.setItem('frontend_new_bizcard_refresh', String(Date.now()));
          window.localStorage.setItem('frontend_new_bizcard_toast', 'BizCard created successfully.');
          window.dispatchEvent(new CustomEvent('ontap:user-sync'));
        } catch {
          // ignore localStorage failures
        }
      }
      setSaved(true);
      router.push('/user/bizcard-list');
    } catch {
      showToast('Network error. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  }, [bizCard, vcard, router, selectedTheme, claimSerial]);

  // Location UI is Google Maps link–based (AddressLocationFields); city is no longer collected
  // on this form and must not block create. Contact allows mobile OR telephone.
  const getMissingRequiredFields = useCallback((): string[] => {
    const missing: string[] = [];
    if (!String(bizCard.bizCardName ?? '').trim()) missing.push('BizCard Name');
    if (!String(vcard.firstName ?? '').trim()) missing.push('First Name');
    if (!String(vcard.lastName ?? '').trim()) missing.push('Last Name');
    if (!String(vcard.email ?? '').trim()) missing.push('Email');
    if (!(String(vcard.contactNumber ?? '').trim() || String(vcard.telephoneNumber ?? '').trim())) {
      missing.push('Mobile or Telephone');
    }
    return missing;
  }, [bizCard.bizCardName, vcard.firstName, vcard.lastName, vcard.email, vcard.contactNumber, vcard.telephoneNumber]);

  const handleCreateClick = useCallback(() => {
    if (saving || saved) return;
    const missing = getMissingRequiredFields();
    if (missing.length > 0) {
      showToast(`Please complete: ${missing.join(', ')}.`, 'error');
      return;
    }
    void handleSave();
  }, [saving, saved, getMissingRequiredFields, handleSave]);

  const missingRequiredFields = getMissingRequiredFields();

  const buttonLabel = saving
    ? 'Creating…'
    : saved
      ? 'Created' 
      : 'Create BizCard';
  return (
    <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Create New BizCard</h1>
          <p className="text-sm text-slate-500 mt-1">
            {claimSerial
              ? `Register and link physical card ${claimSerial} to a new virtual BizCard.`
              : 'Start a new BizCard with the same tabbed form used in your existing BizCard editor.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/user/bizcard-list"
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Back to BizCard list
          </Link>
          <button
            type="button"
            onClick={handleCreateClick}
            disabled={saving || saved}
            title={
              missingRequiredFields.length > 0
                ? `Please complete: ${missingRequiredFields.join(', ')}`
                : undefined
            }
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-all disabled:opacity-60 ${saving || saved ? 'bg-emerald-500' : 'bg-primary hover:bg-primary-hover'}`}
          >
            {saving ? <InlineLoader /> : saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            {buttonLabel}
          </button>
        </div>
      </div>
      <div className="shrink-0 bg-white border border-slate-200 rounded-3xl p-3 sm:p-4">
        <div className="flex overflow-x-auto gap-2 rounded-3xl px-2 pb-2" style={{ scrollbarWidth: 'none' }}>
          {TABS.map((tabItem) => (
            <button
              key={tabItem.id}
              type="button"
              onClick={() => setTab(tabItem.id)}
              className={`rounded-2xl px-4 py-3 text-sm font-semibold transition ${tab === tabItem.id ? 'bg-primary text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            >
              {tabItem.label}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="space-y-6 p-6">
          {tab === 'vcard' && (
            <VcardTab
              bizCard={bizCard}
              setBizCard={setBizCard}
              vcard={vcard}
              setVcard={setVcard}
              setupCompleted={false}
            />
          )}

          {tab === 'design' && (
            <DesignTab
              bizCard={bizCard}
              setBizCard={setBizCard}
              vcard={vcard}
              services={services}
              gallery={gallery}
              videos={videos}
              selectedTheme={selectedTheme}
              setSelectedTheme={setSelectedTheme}
              subscriptionTier={subscriptionTier}
              isDevUser={isDevUser}
            />
          )}

          {tab === 'services' && (
            <ServicesTab
              services={services}
              setServices={setServices}
              gallery={gallery}
              setGallery={setGallery}
              videos={videos}
              setVideos={setVideos}
              canUploadGallery={false}
              isDevUser={false}
              syncWithServer={false}
            />
          )}

          {tab === 'social' && (
            <SocialTab vcard={vcard} setVcard={setVcard} />
          )}
        </div>
      </div>
    </div>
  );
}




