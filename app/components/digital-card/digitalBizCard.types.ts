export type DigitalBizCardData = {
  displayName: string;
  jobTitle: string;
  phone: string;
  email: string;
  portfolioLabel: string;
  portfolioUrl: string;
  profileImageUrl: string;
  initials: string;
  fileName: string;
  vcardQrPayload: string;
};

export type DigitalBizCardProfileInput = {
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  bizcardName?: string | null;
  jobTitle?: string | null;
  phone?: string | null;
  email?: string | null;
  profileImageUrl?: string | null;
  alias?: string | null;
  portfolioUrl?: string | null;
  socials?: Array<{ platform?: string | null; url?: string | null }> | null;
};
