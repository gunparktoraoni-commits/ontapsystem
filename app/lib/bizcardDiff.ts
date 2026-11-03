/**
 * bizcardDiff.ts
 * ──────────────
 * Utility for comparing original and current bizcard data to detect changed fields.
 * Used to build delta payloads that only send changed data to the backend.
 */

import type { BizCardFormData, ContactLinkLabelMode, VCardFormData, ServiceItem, GalleryItem, VideoItem } from '../types';

export interface BizcardSnapshot extends Record<string, unknown> {
  bizCard: BizCardFormData;
  vcard: VCardFormData;
  services: ServiceItem[];
  selectedTheme: string;
  gallery: GalleryItem[];
  videos: VideoItem[];
  showCoverPhoto: boolean;
  showInquiryCard: boolean;
  showAssociateCount: boolean;
  showMutualAssociates: boolean;
  showEmail: boolean;
  contactLinkLabel: ContactLinkLabelMode;
}

export interface BizcardDelta extends Record<string, unknown> {
  // Bizcard fields
  customUri?: string;
  vcardName?: string;
  vcardDescription?: string;
  profileUrl?: string;
  coverUrl?: string;
  coverImagePosition?: string;

  // Vcard fields
  firstName?: string;
  lastName?: string;
  middleName?: string;
  postNominal?: string;
  suffix?: string;
  jobPosition?: string;
  about?: string;
  email?: string;
  contact?: string;
  altContact?: string;
  telephone?: string;
  altTelephone?: string;
  altEmail?: string;
  languages?: string;
  address?: Record<string, unknown>;

  // Display preferences
  showCoverPhoto?: boolean;
  showInquiryCard?: boolean;
  showAssociateCount?: boolean;
  showMutualAssociates?: boolean;
  showEmail?: boolean;
  contactLinkLabel?: ContactLinkLabelMode;

  // Services and social links
  socials?: Array<Record<string, unknown>>;
  services?: Array<Record<string, unknown>>;

  // Meta fields
  publishNow?: boolean;
}

/**
 * Deep equality check for objects and arrays
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (typeof a !== typeof b) return false;

  if (a === null || b === null) return a === b;
  if (typeof a !== 'object' || typeof b !== 'object') return a === b;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, idx) => deepEqual(item, b[idx]));
  }

  if (Array.isArray(a) || Array.isArray(b)) return false;

  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);

  if (aKeys.length !== bKeys.length) return false;

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;

  return aKeys.every((key) => deepEqual(aObj[key], bObj[key]));
}

/**
 * Compute the delta between original and current bizcard state
 * Returns only the fields that have changed
 */
export function computeProfileDelta(
  original: BizcardSnapshot,
  current: BizcardSnapshot,
  urlAliasChanged: boolean,
  urlAliasEditable: boolean | null
): BizcardDelta {
  const delta: BizcardDelta = {};

  // Check URL alias
  if (urlAliasChanged && urlAliasEditable !== false) {
    const trimmedAlias = current.bizCard.urlAlias.trim();
    if (trimmedAlias) {
      delta.customUri = trimmedAlias;
    }
  }

  // Check bizcard fields
  if (current.bizCard.bizCardName.trim() !== original.bizCard.bizCardName.trim()) {
    delta.vcardName = current.bizCard.bizCardName.trim() || undefined;
  }

  if (current.bizCard.description.trim() !== original.bizCard.description.trim()) {
    delta.vcardDescription = current.bizCard.description.trim() || undefined;
  }

  if (current.bizCard.profileImage !== original.bizCard.profileImage) {
    const newUrl = current.bizCard.profileImage?.trim();
    if (newUrl && (newUrl.startsWith('http') || newUrl.startsWith('data:'))) {
      delta.profileUrl = newUrl;
    }
  }

  if (current.bizCard.coverImage !== original.bizCard.coverImage) {
    const newUrl = current.bizCard.coverImage?.trim();
    if (newUrl && (newUrl.startsWith('http') || newUrl.startsWith('data:'))) {
      delta.coverUrl = newUrl;
    }
  }

  if (current.bizCard.coverImagePosition !== original.bizCard.coverImagePosition) {
    delta.coverImagePosition = current.bizCard.coverImagePosition;
  }

  // Check vcard fields
  if (current.vcard.firstName.trim() !== original.vcard.firstName.trim()) {
    delta.firstName = current.vcard.firstName.trim() || undefined;
  }

  if (current.vcard.lastName.trim() !== original.vcard.lastName.trim()) {
    delta.lastName = current.vcard.lastName.trim() || undefined;
  }

  if (current.vcard.middleName.trim() !== original.vcard.middleName.trim()) {
    delta.middleName = current.vcard.middleName.trim() || undefined;
  }

  if (current.vcard.postNominalLetters.trim() !== original.vcard.postNominalLetters.trim()) {
    delta.postNominal = current.vcard.postNominalLetters.trim() || undefined;
  }

  if (current.vcard.suffix !== original.vcard.suffix) {
    delta.suffix = current.vcard.suffix !== 'N/A' ? current.vcard.suffix : undefined;
  }

  if (current.vcard.about.trim() !== original.vcard.about.trim()) {
    delta.about = current.vcard.about.trim() || undefined;
  }

  if (current.vcard.contactNumber.trim() !== original.vcard.contactNumber.trim()) {
    delta.contact = current.vcard.contactNumber.trim();
  }

  if (current.vcard.secondaryNumber.trim() !== original.vcard.secondaryNumber.trim()) {
    delta.altContact = current.vcard.secondaryNumber.trim();
  }

  if (current.vcard.telephoneNumber.trim() !== original.vcard.telephoneNumber.trim()) {
    delta.telephone = current.vcard.telephoneNumber.trim();
  }

  if (current.vcard.altTelephoneNumber.trim() !== original.vcard.altTelephoneNumber.trim()) {
    delta.altTelephone = current.vcard.altTelephoneNumber.trim();
  }

  if (current.vcard.alternativeEmail.trim() !== original.vcard.alternativeEmail.trim()) {
    delta.altEmail = current.vcard.alternativeEmail.trim();
  }

  if (current.vcard.email.trim() !== original.vcard.email.trim()) {
    delta.email = current.vcard.email.trim();
  }

  if (current.vcard.languages.trim() !== original.vcard.languages.trim()) {
    delta.languages = current.vcard.languages.trim() || undefined;
  }

  if (current.bizCard.occupation.trim() !== original.bizCard.occupation.trim()) {
    delta.jobPosition = current.bizCard.occupation.trim() || undefined;
  }

  // Check address fields (simplified comparison)
  const addressChanged =
    current.vcard.addressArea !== original.vcard.addressArea ||
    current.vcard.addressBrgy !== original.vcard.addressBrgy ||
    current.vcard.addressCity !== original.vcard.addressCity ||
    current.vcard.addressRegion !== original.vcard.addressRegion ||
    current.vcard.addressZipcode !== original.vcard.addressZipcode ||
    current.vcard.addressMapLink !== original.vcard.addressMapLink ||
    current.vcard.addressLandmark !== original.vcard.addressLandmark ||
    current.vcard.addressLatitude !== original.vcard.addressLatitude ||
    current.vcard.addressLongitude !== original.vcard.addressLongitude;

  if (addressChanged) {
    // Include address if any field changed
    delta.address = {
      area: current.vcard.addressArea || undefined,
      brgy: current.vcard.addressBrgy || undefined,
      city: current.vcard.addressCity || undefined,
      region: current.vcard.addressRegion || undefined,
      zipcode: current.vcard.addressZipcode || undefined,
      mapLink: current.vcard.addressMapLink || undefined,
      landmark: current.vcard.addressLandmark || undefined,
      latitude: current.vcard.addressLatitude,
      longitude: current.vcard.addressLongitude,
    };
    // Clean up undefined values
    delta.address = Object.fromEntries(
      Object.entries(delta.address).filter(([, v]) => v !== undefined)
    );
    if (Object.keys(delta.address).length === 0) {
      delete delta.address;
    }
  }

  // Check display preferences
  if (current.showCoverPhoto !== original.showCoverPhoto) {
    delta.showCoverPhoto = current.showCoverPhoto;
  }

  if (current.showInquiryCard !== original.showInquiryCard) {
    delta.showInquiryCard = current.showInquiryCard;
  }

  if (current.showAssociateCount !== original.showAssociateCount) {
    delta.showAssociateCount = current.showAssociateCount;
  }

  if (current.showMutualAssociates !== original.showMutualAssociates) {
    delta.showMutualAssociates = current.showMutualAssociates;
  }

  if (current.showEmail !== original.showEmail) {
    delta.showEmail = current.showEmail;
  }

  if (current.contactLinkLabel !== original.contactLinkLabel) {
    delta.contactLinkLabel = current.contactLinkLabel;
  }

  // Check social links (use deep equality for complex objects)
  if (!deepEqual(current.vcard.socialLinks, original.vcard.socialLinks)) {
    delta.socials = current.vcard.socialLinks.map((link) => ({
      platform: link.platform,
      url: link.url,
    }));
  }

  // Check services (use deep equality for complex objects)
  if (!deepEqual(current.services, original.services)) {
    delta.services = current.services
      .filter((s) => s.title.trim())
      .map((s, i) => ({
        name: s.title.trim(),
        tagline: s.tagline.trim() || undefined,
        description: (s.description || s.title).trim(),
        serviceUrl: s.videoUrl.trim() ? s.videoUrl.trim() : undefined,
        featured_image: s.featured_image?.startsWith('http') ? s.featured_image : undefined,
        displayOrder: i,
        isVisible: true,
      }));
  }

  // Always include publishNow and other meta fields
  delta.publishNow = true;

  return delta;
}

/**
 * Check if a delta contains any meaningful changes
 */
export function hasMeaningfulChanges(delta: BizcardDelta): boolean {
  // Remove publishNow and check if anything else is left
  const { publishNow, ...rest } = delta;
  return Object.keys(rest).length > 0;
}

/**
 * Merge delta into full payload (for backward compatibility with API endpoints that expect full data)
 */
export function mergeWithDefaults(
  delta: BizcardDelta,
  current: BizcardSnapshot
): Record<string, unknown> {
  // Start with delta
  const payload = { ...delta };

  // For fields not in delta, include defaults from current state
  // This ensures the backend receives complete data for validation.
  // Do NOT re-inject customUri unless the alias actually changed — an unchanged
  // (possibly legacy/invalid) alias would fail format validation on every save.
  if (!delta.vcardName) {
    payload.vcardName = current.bizCard.bizCardName.trim() || undefined;
  }

  if (!delta.vcardDescription) {
    payload.vcardDescription = current.bizCard.description.trim() || undefined;
  }

  if (!delta.profileUrl && current.bizCard.profileImage?.startsWith('http')) {
    payload.profileUrl = current.bizCard.profileImage;
  }

  if (!delta.coverUrl && current.bizCard.coverImage?.startsWith('http')) {
    payload.coverUrl = current.bizCard.coverImage;
  }

  if (!delta.coverImagePosition) {
    payload.coverImagePosition = current.bizCard.coverImagePosition;
  }

  if (!delta.firstName) {
    payload.firstName = current.vcard.firstName.trim() || undefined;
  }

  if (!delta.lastName) {
    payload.lastName = current.vcard.lastName.trim() || undefined;
  }

  if (!delta.middleName) {
    payload.middleName = current.vcard.middleName.trim() || undefined;
  }

  if (!delta.postNominal) {
    payload.postNominal = current.vcard.postNominalLetters.trim() || undefined;
  }

  if (!delta.suffix) {
    payload.suffix = current.vcard.suffix !== 'N/A' ? current.vcard.suffix : undefined;
  }

  if (!delta.about) {
    payload.about = current.vcard.about.trim() || undefined;
  }

  if (!delta.email) {
    payload.email = current.vcard.email.trim();
  }

  if (!delta.contact && delta.contact !== '') {
    payload.contact = current.vcard.contactNumber.trim();
  }

  if (!delta.altContact && delta.altContact !== '') {
    payload.altContact = current.vcard.secondaryNumber.trim();
  }

  if (!delta.telephone && delta.telephone !== '') {
    payload.telephone = current.vcard.telephoneNumber.trim();
  }

  if (!delta.altTelephone && delta.altTelephone !== '') {
    payload.altTelephone = current.vcard.altTelephoneNumber.trim();
  }

  if (!delta.altEmail && delta.altEmail !== '') {
    payload.altEmail = current.vcard.alternativeEmail.trim();
  }

  if (!delta.languages) {
    payload.languages = current.vcard.languages.trim() || undefined;
  }

  if (!delta.jobPosition) {
    payload.jobPosition = current.bizCard.occupation.trim() || undefined;
  }

  if (!delta.socials) {
    payload.socials = current.vcard.socialLinks.map((link) => ({
      platform: link.platform,
      url: link.url,
    }));
  }

  if (!delta.services) {
    payload.services = current.services
      .filter((s) => s.title.trim())
      .map((s, i) => ({
        name: s.title.trim(),
        tagline: s.tagline.trim() || undefined,
        description: (s.description || s.title).trim(),
        serviceUrl: s.videoUrl.trim() ? s.videoUrl.trim() : undefined,
        featured_image: s.featured_image?.startsWith('http') ? s.featured_image : undefined,
        displayOrder: i,
        isVisible: true,
      }));
  }

  if (payload.showCoverPhoto === undefined) {
    payload.showCoverPhoto = current.showCoverPhoto;
  }

  if (payload.showInquiryCard === undefined) {
    payload.showInquiryCard = current.showInquiryCard;
  }

  if (payload.showAssociateCount === undefined) {
    payload.showAssociateCount = current.showAssociateCount;
  }

  if (payload.showMutualAssociates === undefined) {
    payload.showMutualAssociates = current.showMutualAssociates;
  }

  if (payload.showEmail === undefined) {
    payload.showEmail = current.showEmail;
  }

  if (payload.contactLinkLabel === undefined) {
    payload.contactLinkLabel = current.contactLinkLabel;
  }

  // Clean up undefined values
  return Object.fromEntries(
    Object.entries(payload).filter(([, v]) => v !== undefined)
  );
}
