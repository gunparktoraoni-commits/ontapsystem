import { buildVCardContentForQR } from "@/lib/bizcard/vcard-content";
import type { DigitalBizCardData, DigitalBizCardProfileInput } from "./digitalBizCard.types";

export const DIGITAL_BIZ_CARD_BG = "/images/png-bg.png";
export const DIGITAL_BIZ_CARD_LOGO = "/ontaplogo.png";

export function cleanCardField(value: string | null | undefined): string {
  const text = String(value ?? "").trim();
  const lower = text.toLowerCase();
  if (!text || lower === "n/a" || lower === "na" || lower === "none") return "";
  return text;
}

export function buildDisplayName(input: DigitalBizCardProfileInput): string {
  const fromParts = [input.firstName, input.lastName]
    .map((part) => cleanCardField(part))
    .filter(Boolean)
    .join(" ");
  return (
    cleanCardField(input.displayName) ||
    fromParts ||
    cleanCardField(input.bizcardName) ||
    "Your Name"
  );
}

export function buildInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

export function formatPortfolioLabel(portfolioUrl: string, alias?: string | null): string {
  const trimmed = portfolioUrl.trim();
  if (trimmed) {
    try {
      const parsed = new URL(trimmed);
      const host = parsed.host.replace(/^www\./i, "");
      const path = parsed.pathname.replace(/^\/+|\/+$/g, "");
      return path ? `${host}/${path}` : host;
    } catch {
      return trimmed.replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
    }
  }

  const cleanAlias = cleanCardField(alias).replace(/^\/+/, "");
  if (!cleanAlias) return "";
  return `portal.ontap.ph/${cleanAlias}`;
}

export function resolvePortfolioUrl(
  portfolioUrl?: string | null,
  alias?: string | null,
): string {
  const trimmed = cleanCardField(portfolioUrl);
  if (trimmed && /^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed) {
    const normalized = trimmed.replace(/^\/+/, "");
    if (typeof window !== "undefined" && window.location?.origin) {
      return `${window.location.origin}/${normalized}`;
    }
    return `https://portal.ontap.ph/${normalized}`;
  }

  const cleanAlias = cleanCardField(alias).replace(/^\/+/, "");
  if (!cleanAlias) return "";
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/${cleanAlias}`;
  }
  return `https://portal.ontap.ph/${cleanAlias}`;
}

export function buildDigitalBizCardData(
  input: DigitalBizCardProfileInput,
): DigitalBizCardData | null {
  const portfolioUrl = resolvePortfolioUrl(input.portfolioUrl, input.alias);
  if (!portfolioUrl) return null;

  const displayName = buildDisplayName(input);
  const alias = cleanCardField(input.alias).replace(/^\/+/, "") || "bizcard";
  const vcardQrPayload = buildVCardContentForQR(
    {
      first_name: input.firstName,
      last_name: input.lastName,
      bizcard_name: input.bizcardName ?? displayName,
      email: input.email,
      contact_number: input.phone,
      occupation: input.jobTitle,
      socials: input.socials ?? [],
    },
    portfolioUrl,
  );

  return {
    displayName,
    jobTitle: cleanCardField(input.jobTitle) || "Digital Professional",
    phone: cleanCardField(input.phone),
    email: cleanCardField(input.email),
    portfolioLabel: formatPortfolioLabel(portfolioUrl, input.alias),
    portfolioUrl,
    profileImageUrl: cleanCardField(input.profileImageUrl),
    initials: buildInitials(displayName),
    fileName: `${alias}-digital-card.png`,
    vcardQrPayload,
  };
}

export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName.endsWith(".png") ? fileName : `${fileName}.png`;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}
