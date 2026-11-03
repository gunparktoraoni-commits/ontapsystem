'use client';

import { ChevronDown } from 'lucide-react';
import React, { useState } from 'react';

import AddressLocationFields, { type AddressFieldKey } from './AddressLocationFields';
import StepIndicator from './StepIndicator';
import type { VCardFormData, SocialLink } from '../types';
import {
  AddSocialLinkForm,
  SavedSocialLinksList,
} from './BizCardSocialTab';
import {
  detectSocialPlatformFromUrl,
  resolveSocialPlatformDef,
} from '@/app/lib/socialPlatforms';
import { hasDuplicateSocialUrl } from '@/lib/social-links';
import { showToast } from './Toast';
import RichTextEditor from './RichTextEditor';
import ContactDetailsEditor, {
  validateContactFieldValues,
} from './ContactDetailsEditor';
import { stripPhoneCountryPrefix } from '@/app/lib/contactDetails';

interface VCardDetailsProps {
  onContinue: (data: VCardFormData) => void;
  onBack: () => void;
  currentStep: number;
  totalSteps: number;
  initialData?: VCardFormData;
}

function isValidUrl(value: string): boolean {
  if (!value.trim()) return true;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const VCardDetails: React.FC<VCardDetailsProps> = ({
  onContinue,
  onBack,
  currentStep,
  totalSteps,
  initialData,
}) => {
  const [formData, setFormData] = useState({
    firstName: initialData?.firstName ?? '',
    middleName: initialData?.middleName ?? '',
    lastName: initialData?.lastName ?? '',
    professionalTitle: initialData?.professionalTitle ?? '',
    postNominalLetters: initialData?.postNominalLetters ?? '',
    suffix: initialData?.suffix ?? '',
    about: initialData?.about ?? '',
    contactNumber: stripPhoneCountryPrefix(initialData?.contactNumber ?? ''),
    secondaryNumber: stripPhoneCountryPrefix(initialData?.secondaryNumber ?? ''),
    telephoneNumber: initialData?.telephoneNumber ?? '',
    altTelephoneNumber: initialData?.altTelephoneNumber ?? '',
    email: initialData?.email ?? '',
    alternativeEmail: initialData?.alternativeEmail ?? '',
    addressArea: initialData?.addressArea ?? '',
    addressHouseNo: initialData?.addressHouseNo ?? '',
    addressBrgy: initialData?.addressBrgy ?? '',
    addressCity: initialData?.addressCity ?? '',
    addressRegion: initialData?.addressRegion ?? '',
    addressZipcode: initialData?.addressZipcode ?? '',
    addressMapLink: initialData?.addressMapLink ?? '',
    addressLandmark: initialData?.addressLandmark ?? '',
    addressLatitude: initialData?.addressLatitude ?? null,
    addressLongitude: initialData?.addressLongitude ?? null,
    languages: initialData?.languages ?? '',
  });

  const [socialLinks, setSocialLinks] = useState<SocialLink[]>(
    initialData?.socialLinks && initialData.socialLinks.length > 0
      ? initialData.socialLinks
      : []
  );
  const [mapLinkError, setMapLinkError] = useState<string | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);

  const removeSocialLink = (id: number) => {
    setSocialLinks((previous) => previous.filter((link) => link.id !== id));
    showToast('Social link removed.', 'info');
  };

  const updateSocialLinkUrl = (id: number, url: string) => {
    if (url.trim() && hasDuplicateSocialUrl(socialLinks, url, { ignoreId: id })) {
      showToast('That URL is already on your list.', 'error');
      return;
    }
    setSocialLinks((previous) =>
      previous.map((link) => {
        if (link.id !== id) return link;
        const detected = detectSocialPlatformFromUrl(url);
        return {
          ...link,
          url,
          platform:
            detected.slug === 'other' && !url.trim()
              ? link.platform
              : detected.key,
        };
      }),
    );
  };

  const addSocialLink = (platformKey: string, url: string): boolean => {
    const platform = resolveSocialPlatformDef(platformKey);
    if (hasDuplicateSocialUrl(socialLinks, url)) {
      showToast('That URL is already on your list.', 'error');
      return false;
    }

    setSocialLinks((previous) => [
      ...previous,
      { id: Date.now(), platform: platform.key, url },
    ]);
    return true;
  };

  const handleAddressChange = (field: AddressFieldKey, value: string | number | null) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (field === 'addressMapLink' && typeof value === 'string' && value.trim()) {
      setMapLinkError(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const hasAddressInput =
      formData.addressMapLink.trim() ||
      formData.addressLandmark.trim() ||
      formData.addressLatitude != null ||
      formData.addressLongitude != null;

    if (hasAddressInput && !formData.addressMapLink.trim()) {
      setMapLinkError('Google Maps link is required when adding location details.');
      return;
    }

    const invalidSocial = socialLinks.find((link) => link.url.trim() && !isValidUrl(link.url));
    if (invalidSocial) return;

    const contactError = validateContactFieldValues(
      {
        email: formData.email,
        alternativeEmail: formData.alternativeEmail,
        contactNumber: formData.contactNumber,
        secondaryNumber: formData.secondaryNumber,
        telephoneNumber: formData.telephoneNumber,
        altTelephoneNumber: formData.altTelephoneNumber,
      },
      { requireEmail: true },
    );
    if (contactError) {
      setContactError(contactError);
      showToast(contactError, 'error');
      return;
    }
    setContactError(null);

    onContinue({
      ...formData,
      socialLinks: socialLinks.filter((link) => link.platform.trim() || link.url.trim()),
    });
  };

  return (
    <div className="w-full max-w-md bg-white rounded-2xl p-8">
      <StepIndicator currentStep={currentStep} totalSteps={totalSteps} />

      <h1 className="text-2xl font-bold text-gray-900 mb-1">VCard Details</h1>
      <p className="text-gray-400 text-sm mb-6">Complete your digital contact and card details</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">First Name</label>
          <input
            type="text"
            placeholder="Enter your first name"
            value={formData.firstName}
            onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
          />
        </div>

        <div>
          <div className="flex justify-between mb-1">
            <label className="block text-sm font-semibold text-gray-700">Middle Name</label>
            <span className="text-xs text-blue-500">optional</span>
          </div>
          <input
            type="text"
            placeholder="Enter your middle name"
            value={formData.middleName}
            onChange={(e) => setFormData({ ...formData, middleName: e.target.value })}
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Last Name</label>
          <input
            type="text"
            placeholder="Enter your last name"
            value={formData.lastName}
            onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Suffix</label>
          <div className="relative">
            <select
              value={formData.suffix}
              onChange={(e) => setFormData({ ...formData, suffix: e.target.value })}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors appearance-none"
            >
              <option value="">N/A</option>
              <option value="Jr">Jr</option>
              <option value="Sr">Sr</option>
              <option value="III">III</option>
              <option value="IV">IV</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">About</label>
          <RichTextEditor
            placeholder="Tell us about yourself"
            value={formData.about}
            onChange={(html) => setFormData({ ...formData, about: html })}
            rows={3}
            ariaLabel="About"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Contact Details</label>
          <ContactDetailsEditor
            variant="setup"
            requireEmail
            error={contactError}
            values={{
              email: formData.email,
              alternativeEmail: formData.alternativeEmail,
              contactNumber: formData.contactNumber,
              secondaryNumber: formData.secondaryNumber,
              telephoneNumber: formData.telephoneNumber,
              altTelephoneNumber: formData.altTelephoneNumber,
            }}
            onChange={(next) => {
              setContactError(null);
              setFormData((prev) => ({ ...prev, ...next }));
            }}
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Address</label>
          <AddressLocationFields
            values={formData}
            onChange={handleAddressChange}
            mapLinkError={mapLinkError}
          />
        </div>

        <div className="space-y-5">
          <div>
            <div className="mb-3">
              <label className="block text-sm font-semibold text-gray-700">
                Your social links
              </label>
              <p className="mt-1 text-xs text-gray-500">
                Added links will appear on your public BizCard.
              </p>
            </div>
            <SavedSocialLinksList
              links={socialLinks.filter((link) => link.url.trim())}
              onUpdateUrl={updateSocialLinkUrl}
              onRemove={removeSocialLink}
            />
          </div>

          <div className="rounded-2xl border border-gray-200 bg-gray-50/60 p-4">
            <p className="mb-3 text-sm font-semibold text-gray-700">
              Add a social link
            </p>
            <AddSocialLinkForm onAdd={addSocialLink} />
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onBack}
            className="flex-1 border border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold py-3 rounded-xl transition-colors text-sm cursor-pointer"
          >
            Back
          </button>
          <button
            type="submit"
            className="flex-1 bg-[#2D3A8C] hover:bg-[#243080] text-white font-semibold py-3 rounded-xl transition-colors text-sm cursor-pointer"
          >
            Continue
          </button>
        </div>
      </form>
    </div>
  );
};

export default VCardDetails;
