"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { HiMail, HiPhone, HiGlobeAlt } from "react-icons/hi";
import {
  FaQrcode,
  FaLinkedin,
  FaFacebookF,
  FaInstagram,
  FaYoutube,
  FaXTwitter,
} from "react-icons/fa6";
import { Globe, Music2 } from "lucide-react";
import type { PortfolioViewProps } from "../../shared";
import {
  getDisplayName,
  isGalleryEnabled,
  resolvePortfolioData,
} from "../../shared";
import type { PortfolioData } from "../../../types";
import {
  cleanAboutText,
  cleanPortfolioValue,
  toPortfolioPhoneDigits,
  toPortfolioTelHref,
} from "../../../lib/portfolioDisplay";
import {
  HITACHI_COMPANY_NAMES,
  isHitachiCompanyName,
} from "@/lib/constants/hitachi-companies";
import {
  generateQrDataUrl,
  toQRCardStyle,
  useQRCardDownload,
} from "../../QRCardDownload";
import { RichText } from '@/app/components/RichText';
// import PortfolioActionButtons from "../components/PortfolioActionButtons";

// Only the font-face rule and dynamic cover gradient are kept as a style block.
// Everything else is now Tailwind utilities.
const HITACHI_BASE_CSS = `
@font-face {
  font-family: "HitachiSans";
  src: url("/fonts/hitachi/HitachiSans-Regular.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

/* Text wrap for headings, paragraphs, and spans */
:is(h1, h2, h3, h4, h5, h6, p, span) {
  overflow-wrap: break-word;
  word-wrap: break-word;
  word-break: normal;
  text-wrap: wrap;
}
`;

const DEFAULT_HITACHI_COMPANY_NAME = HITACHI_COMPANY_NAMES[1];
const HITACHI_OFFICIAL_WEBSITE_URL = "https://global.hitachi-solutions.com/";

const SOCIAL_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  facebook: "Facebook",
  instagram: "Instagram",
  youtube: "YouTube",
  twitter: "Twitter",
  x: "Twitter",
  tiktok: "TikTok",
  github: "GitHub",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  snapchat: "Snapchat",
  pinterest: "Pinterest",
};

function stripHtml(value: string): string {
  return cleanAboutText(value);
}

function toTelHref(raw: string): string {
  return toPortfolioTelHref(raw);
}

function formatPhoneDisplay(raw: string): string {
  return toPortfolioTelHref(raw);
}

function buildAddress(
  vcard: ReturnType<typeof resolvePortfolioData>["vcard"],
): string {
  return [
    vcard.addressArea,
    vcard.addressBrgy,
    vcard.addressCity,
    vcard.addressRegion,
    vcard.addressZipcode,
  ]
    .map((part) => cleanPortfolioValue(part))
    .filter(Boolean)
    .join(", ");
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function getProfessionalTitle(
  d: ReturnType<typeof resolvePortfolioData>,
): string {
  return (
    cleanPortfolioValue(d.vcard.professionalTitle) ||
    cleanPortfolioValue(d.bizCard.occupation)
  );
}

function resolveAboutCompanyName(d: PortfolioData): string {
  const fromCompanyField = cleanPortfolioValue(d.bizCard.companyName);
  if (fromCompanyField) return fromCompanyField;

  const fromCardName = cleanPortfolioValue(d.bizCard.bizCardName);
  if (fromCardName && isHitachiCompanyName(fromCardName)) return fromCardName;

  return DEFAULT_HITACHI_COMPANY_NAME;
}

function resolveAboutBody(d: PortfolioData): string {
  const companyDescription = stripHtml(
    cleanPortfolioValue(d.bizCard.description),
  );
  if (companyDescription) return companyDescription;
  return stripHtml(cleanPortfolioValue(d.vcard.about));
}

function formatSocialLabel(platform: string): string {
  const key = platform.trim().toLowerCase();
  if (SOCIAL_LABELS[key]) return SOCIAL_LABELS[key];
  if (!key) return "";
  return key.charAt(0).toUpperCase() + key.slice(1);
}

// Social platform color mapping using Tailwind arbitrary values or inline styles.
const SOCIAL_PLATFORM_COLORS: Record<string, string> = {
  linkedin: "#364153",
  facebook: "#364153",
  instagram: "#364153",
  youtube: "#364153",
  twitter: "#364153",
  x: "#364153",
  tiktok: "#364153",
};

function HitachiSocialIcon({ platform }: { platform: string }) {
  const p = platform.trim().toLowerCase();
  const color = SOCIAL_PLATFORM_COLORS[p] || "#888888";
  const style = { color };

  if (p === "linkedin") return <FaLinkedin size={20} style={style} aria-hidden />;
  if (p === "facebook") return <FaFacebookF size={20} style={style} aria-hidden />;
  if (p === "instagram") return <FaInstagram size={20} style={style} aria-hidden />;
  if (p === "youtube") return <FaYoutube size={20} style={style} aria-hidden />;
  if (p === "twitter" || p === "x") return <FaXTwitter size={20} style={style} aria-hidden />;
  if (p === "tiktok") return <Music2 size={20} style={style} aria-hidden />;
  if (p == "instagram_page") return null;
  return <Globe size={20} style={style} aria-hidden />;
}

export default function HitachiSolutionsTheme({
  data,
  mini = false,
}: PortfolioViewProps) {
  const d = resolvePortfolioData(data);
  const displayName = getDisplayName(d);
  const occupation = cleanPortfolioValue(d.bizCard.occupation);
  const rawProfessionalTitle = cleanPortfolioValue(d.vcard.professionalTitle);
  const professionalTitle = getProfessionalTitle(d);
  const showProfessionalTitle =
    Boolean(rawProfessionalTitle) && professionalTitle !== occupation;
  const aboutCompanyName = resolveAboutCompanyName(d);
  const aboutBody = resolveAboutBody(d);
  const mapLink = cleanPortfolioValue(d.vcard.addressMapLink);

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined" || !d.bizCard.urlAlias) return "";
    return `${window.location.origin}/${d.bizCard.urlAlias}`;
  }, [d.bizCard.urlAlias]);

  const {
    cardRef,
    qrDataUrl,
    download: downloadQRCard,
    isDownloading,
  } = useQRCardDownload(d, shareUrl);
  const qrCardStyle = toQRCardStyle({
    surface: "#ffffff",
    text: "#2c3e50",
    muted: "#6c757d",
    accent: "#b10e23",
    accentAlt: "#e53e3e",
    border: "#e2e8f0",
  });

  const socialLinks = useMemo(
    () =>
      (d.vcard.socialLinks ?? []).filter(
        (link) =>
          cleanPortfolioValue(link.platform) &&
          cleanPortfolioValue(link.url) &&
          link.platform.toLowerCase() !== "website",
      ),
    [d.vcard.socialLinks],
  );

  const galleryItems = useMemo(() => {
    if (!isGalleryEnabled(d, mini)) return [];
    return (d.gallery ?? []).filter((item) => cleanPortfolioValue(item.url));
  }, [d, mini]);

  const websiteUrl = useMemo(() => {
    const link = (d.vcard.socialLinks ?? []).find(
      (item) =>
        item.platform.toLowerCase() === "website" &&
        cleanPortfolioValue(item.url),
    );
    return link ? cleanPortfolioValue(link.url) : "";
  }, [d.vcard.socialLinks]);

  const headerGlobeHref = mapLink || websiteUrl || HITACHI_OFFICIAL_WEBSITE_URL;
  const coverImage = cleanPortfolioValue(d.bizCard.coverImage);

  const [officialWebsiteQrDataUrl, setOfficialWebsiteQrDataUrl] = useState("");
  const [officialWebsiteQrFailed, setOfficialWebsiteQrFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    generateQrDataUrl(HITACHI_OFFICIAL_WEBSITE_URL)
      .then((dataUrl) => {
        if (!cancelled) setOfficialWebsiteQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setOfficialWebsiteQrFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Dynamic cover image background (inline style for the gradient overlay)
  const coverStyle = coverImage
    ? {
        backgroundImage: `linear-gradient(135deg, rgba(229, 62, 62, 0.85), rgba(156, 34, 34, 0.85)), url("${coverImage.replace(/"/g, '\\"')}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : undefined;

  const handleShare = async () => {
    const url =
      shareUrl || (typeof window !== "undefined" ? window.location.href : "");
    if (!url) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: displayName, url });
        return;
      } catch {
        // fall through
      }
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // ignore
    }
  };

  const headerSubtitle = showProfessionalTitle ? professionalTitle : occupation;
  const aboutFallback = `${aboutCompanyName} is committed to providing excellent service and building lasting relationships with our clients.`;
  const aboutDisplay = aboutBody || aboutFallback;

  const renderContactIconBtn = (
    href: string,
    label: string,
    icon: ReactNode,
    external = false,
  ) => (
    
    <a
      href={href}
      className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white/50 bg-white/30 text-white text-lg transition-colors hover:bg-white/45"
      aria-label={label}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {icon}
    </a>
  );

  const renderSimpleContactItem = (
    icon: ReactNode,
    label: string,
    value: ReactNode,
  ) => (
    <div className="flex w-full flex-col gap-1">
      <span className="flex items-center gap-1">
        <span className="text-lg text-gray-800">{icon}</span>
        <strong className="text-sm font-bold uppercase text-gray-500">
          {label}
        </strong>
      </span>
      {value}
    </div>
  );

  const renderHeader = () => (
    <header className="relative flex aspect-square w-full flex-col items-center justify-between overflow-hidden px-0 py-10">
      {/* Background layers */}
      <div
        className="absolute inset-0 z-10 bg-linear-to-br from-[#b40810] to-40% to-[#f52614]"
        aria-hidden
      />
      <div
        className="absolute top-full left-full z-10 aspect-square w-full scale-y-300 scale-x-335 rounded-full bg-radial from-60% from-[#f52614] to-95% to-[#cd0e05] shadow-inner"
        aria-hidden
      />

      {/* Profile ring */}
      <div className="relative z-50 flex h-36 w-36 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-white bg-white/20 shadow-lg backdrop-blur">
        {d.bizCard.profileImage ? (
          <img
            src={d.bizCard.profileImage}
            alt={displayName}
            className="h-full w-full object-cover"
            loading="eager"
          />
          
        ) : (
          <div className="text-4xl font-bold text-white">
            {getInitials(displayName)}
          </div>
        )}
      </div>
      <div className="relative z-50 mt-3 text-center">
        <h1 className="text-2xl font-bold leading-snug text-white">
          {displayName}
        </h1>
        {headerSubtitle ? (
          <p className="mt-1 text-base font-medium text-white">
            {headerSubtitle}
          </p>
        ) : null}
      </div>

      <div className="relative z-50 mt-auto flex w-max items-center justify-center gap-3">
        {d.vcard.email
          ? renderContactIconBtn(
              `mailto:${cleanPortfolioValue(d.vcard.email)}`,
              "Email",
              <HiMail />,
            )
          : null}
        {toPortfolioPhoneDigits(d.vcard.contactNumber)
          ? renderContactIconBtn(
              `tel:${toTelHref(d.vcard.contactNumber)}`,
              "Phone",
              <HiPhone />,
            )
          : null}
        {headerGlobeHref
          ? renderContactIconBtn(
              headerGlobeHref,
              "Website",
              <HiGlobeAlt />,
              true,
            )
          : null}
      </div>

      <div
        className="absolute bottom-0 left-0 right-0 z-10 h-5 bg-linear-to-r from-[#ea594a] via-[#b40810] to-[#b40810]"
        aria-hidden
      />
    </header>
  );

  if (mini) {
    return (
      <div className="mx-auto w-full max-w-[450px] bg-white font-['HitachiSans',Arial,sans-serif] text-base text-gray-800 shadow-lg min-h-screen relative overflow-x-hidden">
        <style>{HITACHI_BASE_CSS}</style>
        {renderHeader()}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[450px] bg-white font-['HitachiSans',Arial,sans-serif] text-base text-gray-800 shadow-lg min-h-screen relative overflow-x-hidden">
      <style>{HITACHI_BASE_CSS}</style>
      {renderHeader()}
      <main className="flex w-full flex-col bg-white px-5 pb-10 pt-7">
        {aboutDisplay || aboutCompanyName ? (
          <section>
            <h2 className="border-b border-gray-300 pb-1 mb-5 text-xl font-bold leading-tight text-gray-800">
              About {aboutCompanyName}
            </h2>
            <p className="w-full font-medium leading-relaxed text-justify text-gray-700">
              <RichText html={aboutDisplay} />
            </p>
          </section>
        ) : null}
        <section>
          <h2 className="py-5 text-xl font-bold leading-tight text-gray-800">
            Contact Information
          </h2>
          <div className="grid w-full grid-cols-2 gap-5">
            {d.vcard.email
              ? renderSimpleContactItem(
                  <HiMail />,
                  "email",
                  <a
                    href={`mailto:${cleanPortfolioValue(d.vcard.email)}`}
                    className="ml-5 text-sm text-gray-900 break-words hover:underline"
                  >
                    {cleanPortfolioValue(d.vcard.email)}
                  </a>,
                )
              : null}
            {formatPhoneDisplay(d.vcard.contactNumber)
              ? renderSimpleContactItem(
                  <HiPhone />,
                  "mobile number",
                  <a
                    href={`tel:${toTelHref(d.vcard.contactNumber)}`}
                    className="ml-5 text-sm text-gray-900 break-words hover:underline"
                  >
                    {formatPhoneDisplay(d.vcard.contactNumber)}
                  </a>,
                )
              : null}

            {d.vcard.alternativeEmail
              ? renderSimpleContactItem(
                  <HiMail />,
                  "alternative email",
                  <a
                    href={`mailto:${cleanPortfolioValue(d.vcard.alternativeEmail)}`}
                    className="ml-5 text-sm text-gray-900 break-words hover:underline"
                  >
                    {cleanPortfolioValue(d.vcard.alternativeEmail)}
                  </a>,
                )
              : null}

            {formatPhoneDisplay(d.vcard.secondaryNumber)
              ? renderSimpleContactItem(
                  <HiPhone />,
                  "office number",
                  <a
                    href={`tel:${toTelHref(d.vcard.secondaryNumber)}`}
                    className="ml-5 text-sm text-gray-900 break-words hover:underline"
                  >
                    {formatPhoneDisplay(d.vcard.secondaryNumber)}
                  </a>,
                ) 
              : null}
          </div>
        </section>
        {socialLinks.length > 0 ? (
          <section>
            <h2 className="py-5 text-xl font-bold leading-tight text-gray-800">
              Socials
            </h2>
            <div className="grid grid-cols-2 gap-7">
              {socialLinks.map((link) =>
                link.platform !== "instagram_page" ? (
                  <a
                    key={`${link.id}-${link.platform}`}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 text-gray-800 no-underline hover:opacity-85"
                  >
                    <span className="flex items-center justify-center text-lg">
                      <HitachiSocialIcon platform={link.platform} />
                    </span>
                    <span className="text-sm text-gray-800">
                      {formatSocialLabel(link.platform)}
                    </span>
                  </a>
                ) : null,
              )}
            </div>
          </section>
        ) : null}
        <div className="mt-5 flex items-center gap-5 rounded-xl border border-gray-200 px-5 py-7">
          <div className="flex h-28 w-28 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-gray-100 bg-white shadow-lg">
            {officialWebsiteQrDataUrl && !officialWebsiteQrFailed ? (
              <img
                src={officialWebsiteQrDataUrl}
                alt="QR code linking to Hitachi Solutions official website"
                className="h-[80%] w-[80%] object-contain"
                onError={() => setOfficialWebsiteQrFailed(true)}
              />
            ) : (
              <FaQrcode className="text-3xl text-gray-400" aria-hidden />
            )}
          </div>
          <span className="flex flex-col items-start">
            <h4 className="text-xl font-bold text-gray-700">
              Let&apos;s Connect!
            </h4>
            <p className="mt-1 text-sm text-gray-600">
              Scan the QR code to visit our official website
            </p>
          </span>
        </div>

        <div className="mt-10 flex items-center justify-center gap-3 text-xs uppercase tracking-wider text-gray-400">
          <span className="h-px w-12 bg-linear-to-l from-gray-300 to-transparent" />
          Powered by OnTap Creatives
          <span className="h-px w-12 bg-linear-to-r from-gray-300 to-transparent" />
        </div>
      </main>
    </div>
  );
}