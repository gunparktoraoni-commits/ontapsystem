export interface SocialLink {
  id: number;
  platform: string;
  url: string;
}

export interface ServiceMediaItem {
  id: string; // Unique identifier within the service (timestamp or UUID)
  url: string; // Cloudinary URL or local data URL
  mimeType: string | null; // e.g., 'image/jpeg', 'video/mp4'
  fileName: string | null; // Original filename for uploads
  dataUrl?: string | null; // Local data URL during editing before upload
}

export interface ServiceItem {
  id: number;
  title: string;
  tagline: string;
  description: string;
  featured_image: string | null; // Deprecated: use media array instead
  videoUrl: string; // Deprecated: use media array instead
  videoFile: string | null; // Deprecated
  media?: ServiceMediaItem[]; // New: up to 5 media items (images/videos)
}

export interface BizCardFormData {
  urlAlias: string;
  bizCardName: string;
  companyName?: string;
  description: string;
  occupation: string;
  profileImage: string | null;
  coverImage: string | null;
  coverType: string | null; // e.g. 'image/png' | 'image/gif' | 'video/mp4' | 'application/pdf' | null
  coverFileName: string | null;
  coverImagePosition?: string; // CSS object-position e.g. 'center top'
}

export interface VCardFormData {
  firstName: string;
  middleName: string;
  lastName: string;
  professionalTitle: string;
  postNominalLetters: string;
  suffix: string;
  about: string;
  contactNumber: string;
  secondaryNumber: string;
  /** Landline / telephone (not mobile). */
  telephoneNumber: string;
  altTelephoneNumber: string;
  email: string;
  alternativeEmail: string;
  languages: string;
  // structured address
  addressArea: string;     // street / address line
  addressHouseNo: string;  // house no. / unit
  addressBrgy: string;     // barangay
  addressCity: string;     // city  — locked after first setup
  addressRegion: string;   // region — locked after first setup
  addressZipcode: string;  // zip code
  addressMapLink: string;  // Google Maps URL or Plus Code for map display
  /** Rich-text landmark / office directions shown on the portfolio map pin. */
  addressLandmark: string;
  addressLatitude?: number | null;
  addressLongitude?: number | null;
  socialLinks: SocialLink[];
}

export interface VideoItem {
  id: number;
  title: string;
  description: string;
  fileName: string;
  fileSize: number;
  videoDataUrl?: string | null;
  mimeType?: string | null;
}

export interface GalleryItem {
  id: number;
  url: string;
  title: string;
  description: string;
  altText?: string | null;
  fileName?: string | null;
  imageDataUrl?: string | null;
  mimeType?: string | null;
}

/**
 * Text rendered beside contact/social icons on the public portfolio.
 * `'platform'` shows the network name (Facebook), `'link'` shows the cleaned
 * URL (www.facebook.com/myaccount).
 */
export type ContactLinkLabelMode = 'platform' | 'link';

export const CONTACT_LINK_LABEL_MODES: ContactLinkLabelMode[] = ['platform', 'link'];

export const DEFAULT_CONTACT_LINK_LABEL_MODE: ContactLinkLabelMode = 'link';

export function toContactLinkLabelMode(
  value: unknown,
  fallback: ContactLinkLabelMode = DEFAULT_CONTACT_LINK_LABEL_MODE,
): ContactLinkLabelMode {
  const normalized = String(value ?? '').trim().toLowerCase();
  return (CONTACT_LINK_LABEL_MODES as string[]).includes(normalized)
    ? (normalized as ContactLinkLabelMode)
    : fallback;
}

export interface PortfolioData {
  bizCard: BizCardFormData;
  vcard: VCardFormData;
  services: ServiceItem[];
  selectedTheme: string;
  gallery?: GalleryItem[];
  videos?: VideoItem[];
  /** When false, gallery sections must not render on live alias pages. */
  galleryAvailable?: boolean;
  /** When true, inquiry sections may render on live alias pages. */
  inquiryEnabled?: boolean;
  /** When false, the cover photo hero is hidden on the public portfolio page. */
  showCoverPhoto?: boolean;
  /** When false, the inquiry/contact form card is hidden on the public portfolio page. */
  showInquiryCard?: boolean;
  /** When true, show the owner's associate count on the public portfolio. */
  showAssociateCount?: boolean;
  /** When true, logged-in visitors can see mutual associates. */
  showMutualAssociates?: boolean;
  /** When false, primary and alternative email are hidden on the public portfolio. */
  showEmail?: boolean;
  associateCount?: number | null;
  associateCountLabel?: string | null;
  mutualAssociates?: Array<{
    id: string;
    name: string;
    profileUrl: string | null;
    portfolioUrl: string | null;
    position: string | null;
  }>;
  /** Which text accompanies contact/social icons. Defaults to `'link'`. */
  contactLinkLabel?: ContactLinkLabelMode;
  subscriptionTier?: string | null;
}
