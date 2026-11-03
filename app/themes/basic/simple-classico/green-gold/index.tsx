"use client";

/**
 * NOTE: This layout has no dedicated sections for:
 * - Cover image or cover document (bizCard.coverImage, bizCard.coverType, bizCard.coverFileName)
 * - Post-nominal/suffix/languages metadata
 * - Video gallery and map embed/location link modules
 */

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  LuArrowUpRight,
  LuSparkles,
  LuUsers,
} from "react-icons/lu";
import type { PortfolioViewProps } from "../../../shared";
import { mobileClass } from "@/lib/utils";
import {
  getCoverImageOrNull,
  PortfolioCoverMedia,
  getProfileImageOrNull,
  getDisplayName,
  buildGalleryItems,
  buildVideoItems,
  buildServiceMediaItems,
  buildContactLinks,
  FloatingContactWidget,
  isGalleryEnabled,
  isInquiryEnabled,
  usePortfolioInquiryForm,
  PortfolioAddressSection,
  hasPortfolioLocation,
  resolvePortfolioData,
  VideoCarousel,
  GalleryCarousel,
  ServiceMediaCarousel,
  ServicesScrollContainer,
  SocialIcon,
	PORTFOLIO_SOCIAL_ICON_SIZE,
  usePortfolioViewerSession,
  ContactLinkLabel,
  getContactLinkAriaLabel,
} from "../../../shared";
import {
  useQRCardDownload,
  QRCardExportSurface,
  toQRCardStyle,
} from "../../../QRCardDownload";
import PortfolioActionButtons from "../../../components/PortfolioActionButtons";
import PortfolioSocialProof from "../../../components/PortfolioSocialProof";
import CspStyle from "@/app/components/CspStyle";
import { RichText } from '@/app/components/RichText';

type PortfolioData = NonNullable<PortfolioViewProps["data"]>;

function clean(v: string | null | undefined): string {
  const s = String(v ?? "").trim();
  const l = s.toLowerCase();
  // Filter out empty strings, 'n/a', 'na', 'none', and empty HTML tags like <p><br></p>
  if (!s || l === "n/a" || l === "na" || l === "none") return "";
  if (l === "<p><br></p>" || l === "<p><br /></p>") return "";
  return s;
}

function profTitle(d: PortfolioData): string {
  return clean(d.vcard.professionalTitle) || clean(d.bizCard.occupation);
}

function intl(raw: string): string {
  const t = raw.replace(/\s/g, "");
  if (!t) return "";
  if (t.startsWith("+")) return t;
  if (t.startsWith("63")) return `+${t}`;
  return `+63${t}`;
}

function toHttp(raw: string): string {
  const v = clean(raw);
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z0-9.-]+\.[a-z]{2}(\/|$)/i.test(v)) return `https://${v}`;
  return "";
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  const firstTwo = words.slice(0, 2);
  return firstTwo.map((word) => word.charAt(0).toUpperCase()).join("");
}

// CSS for animations (same as reference)
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');

@keyframes kFadeUp  { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
@keyframes kFadeIn  { from{opacity:0} to{opacity:1} }
@keyframes kScaleIn { from{opacity:0;transform:scale(0.88)} to{opacity:1;transform:scale(1)} }
@keyframes kSlideD  { from{opacity:0;transform:translateY(-16px)} to{opacity:1;transform:translateY(0)} }
@keyframes kWordIn  { from{opacity:0;transform:translateY(24px) rotate(-1deg)} to{opacity:1;transform:translateY(0) rotate(0)} }

.ent-greet { opacity:0; animation:kSlideD  .5s ease .10s forwards }
.ent-word  { opacity:0; animation:kWordIn  .65s cubic-bezier(.2,1.1,.3,1) var(--d,.15s) forwards }
.ent-cta   { opacity:0; animation:kFadeUp  .5s ease .62s forwards }
.ent-img   { opacity:0; animation:kScaleIn .70s cubic-bezier(.2,1,.3,1) .10s forwards }

/* Text wrap for headings, paragraphs, and spans */
:is(h1, h2, h3, h4, h5, h6, p, span) {
  overflow-wrap: break-word;
  word-wrap: break-word;
  word-break: normal;
  text-wrap: wrap;
}
`;

// Individual service/product card with expand/collapse (now uses ServiceMediaCarousel)
const ServiceProductCard = ({
  service,
  index,
  compact,
  mini = false,
}: {
  service: any;
  index: number;
  compact: boolean;
  mini?: boolean;
}) => {
  const [expanded, setExpanded] = useState(false);
  const [needsToggle, setNeedsToggle] = useState(false);
  const descRef = useRef<HTMLParagraphElement>(null);
  const mediaItems = buildServiceMediaItems(service, service.media ?? []);
  const description = String(service.description ?? "").trim();

  useLayoutEffect(() => {
    const el = descRef.current;
    if (!el || !description) {
      setNeedsToggle(false);
      return;
    }

    const measure = () => {
      if (expanded) {
        el.classList.add("line-clamp-3");
        const overflow = el.scrollHeight > el.clientHeight + 1;
        el.classList.remove("line-clamp-3");
        setNeedsToggle(overflow);
        return;
      }
      setNeedsToggle(el.scrollHeight > el.clientHeight + 1);
    };

    measure();
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [description, expanded, compact]);

  return (
    <div className="group/card flex h-full w-full flex-col overflow-hidden rounded-[1.7rem] border border-slate-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)] transition-all duration-500 hover:-translate-y-1 hover:border-teal-300">
      <div className="relative overflow-hidden bg-slate-100">
        {mediaItems.length > 0 ? (
          <ServiceMediaCarousel
            items={mediaItems}
            accent="#0d9488"
            glass="rgba(13,148,136,0.08)"
            textMuted="#64748b"
            mini={mini}
            variant="green-gold"
          />
        ) : service.featured_image ? (
          <img
            alt={service.title}
            src={service.featured_image}
            className="aspect-3/2 w-full object-contain object-center opacity-90 transition-transform duration-700 group-hover/card:scale-105 group-hover/card:opacity-100"
            draggable={false}
          />
        ) : (
          <div className="aspect-3/2 w-full bg-gradient-to-br from-slate-200 to-teal-100 flex items-center justify-center text-4xl font-bold text-teal-300">
            {String(index + 1).padStart(2, "0")}
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(255,255,255,0.9),rgba(255,255,255,0.06))]" />
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="mb-3 line-clamp-2 font-[var(--font-display)] text-[1.5rem] leading-none text-slate-900">
          {service.title}
        </h3>
        {description ? (
          <div className="text-sm leading-7 text-slate-600">
            <p
              ref={descRef}
              className={expanded ? "" : "line-clamp-3"}
            >
              <RichText html={service.description} />
            </p>
          </div>
        ) : null}
        {needsToggle ? (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="mt-4 inline-flex self-start items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs uppercase tracking-[0.28em] text-teal-700 transition-all hover:border-teal-300 hover:bg-teal-100 focus:outline-none focus:ring-2 focus:ring-teal-200"
            aria-expanded={expanded}
          >
            {expanded ? "Show less" : "Show more"}
            <LuArrowUpRight className="text-[11px]" />
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default function GreenGold({
  data,
  mini = false,
  showFAB = false,
  isMobile = false,
}: PortfolioViewProps) {
  const d = resolvePortfolioData(data);
  const inquiryForm = usePortfolioInquiryForm({
    urlAlias: d.bizCard.urlAlias,
    mini,
  });
  const { checked: sessionChecked, isAuthenticated } =
    usePortfolioViewerSession();
  const name = getDisplayName(d);
  const title = profTitle(d);
  const nameWords = name.split(" ");
  const coverImage = getCoverImageOrNull(d);

  const services = useMemo(
    () =>
      (d.services ?? []).map((service, i) => ({
        id: Number(service.id ?? i + 1),
        title: clean(service.title) || `Service/Product ${i + 1}`,
        description: clean(service.description) || clean(service.tagline),
        featured_image: clean(service.featured_image ?? ""),
        media: service.media ?? [],
      })),
    [d.services],
  );

  const galleryItems = buildGalleryItems(d);
  const videos = buildVideoItems(d);
  const contactLinks = buildContactLinks(d);

  const shareUrl =
    typeof window !== "undefined" && d.bizCard.urlAlias
      ? `${window.location.origin}/${d.bizCard.urlAlias}`
      : "";
  const qrUrl = shareUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=280x280&ecc=H&data=${encodeURIComponent(shareUrl)}`
    : "";
  const {
    cardRef,
    qrDataUrl,
    download: downloadQRCard,
    isDownloading,
  } = useQRCardDownload(d, shareUrl);
  const qrCardStyle = toQRCardStyle({
    surface: "#ffffff",
    text: "#0f172a",
    muted: "#64748b",
    accent: "#0d9488",
    accentAlt: "#f59e0b",
    border: "#e2e8f0",
  });

  const hasAbout = Boolean(d.vcard.about || d.bizCard.description);
  const hasServices = services.length > 0;
  const hasGallery = galleryItems.length > 0;
  const hasVideos = videos.length > 0;
  const hasContact = contactLinks.length > 0;

  // -------- ADDED: address presence check --------
  const hasAddress = hasPortfolioLocation(d.vcard);
  // ----------------------------------------------

  const connectLink = toHttp(clean(contactLinks[0]?.url ?? ""));

  return (
    <div
      className={mobileClass(
        "min-h-screen w-full overflow-y-auto bg-[#f7f9f9] text-slate-900 selection:bg-teal-100 selection:text-teal-950",
        isMobile,
      )}
    >
      <CspStyle dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(13,148,136,0.12),transparent_26%),radial-gradient(circle_at_top_right,rgba(245,158,11,0.10),transparent_22%),linear-gradient(180deg,#ffffff,#f7f9f9)]" />
        <div className="absolute left-[-10rem] top-20 h-80 w-80 rounded-full bg-teal-200/30 blur-3xl" />
        <div className="absolute right-[-8rem] top-[18rem] h-[26rem] w-[26rem] rounded-full bg-amber-200/20 blur-3xl" />
        <div className="absolute inset-0 opacity-[0.04] [background-image:linear-gradient(rgba(15,23,42,0.35)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.35)_1px,transparent_1px)] [background-size:72px_72px]" />
      </div>

      <div
        className={`relative mx-auto w-full max-w-7xl px-4 py-6 ${!isMobile && "sm:px-6 md:py-8 lg:px-8"}`}
      >
        {/* Main profile card */}
        <div className="overflow-hidden rounded-[2.4rem] border border-slate-200 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.10)]">
          {/* Cover / banner gradient area */}
          <div
            className={`relative h-60 w-full overflow-hidden ${!isMobile && "md:h-44"}`}
          >
            {coverImage ? (
              <>
                <PortfolioCoverMedia
                  src={coverImage}
                  coverType={d.bizCard.coverType}
                  className="absolute inset-0 h-full w-full"
                  objectPosition={d.bizCard.coverImagePosition ?? "center center"}
                />
                <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(240,253,250,0.82),rgba(255,251,235,0.56)_52%,rgba(240,253,250,0.82))]" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(13,148,136,0.2),transparent_22%),radial-gradient(circle_at_80%_0%,rgba(245,158,11,0.12),transparent_28%)]" />
              </>
            ) : (
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(13,148,136,0.25),transparent_22%),radial-gradient(circle_at_80%_0%,rgba(245,158,11,0.18),transparent_28%),linear-gradient(90deg,#f0fdfa,#fffbeb_52%,#f0fdfa)]" />
            )}
            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
            <div
              className={`absolute left-6 top-6 flex items-center gap-2 rounded-full border border-teal-200 bg-white/80 px-3 py-1 text-[10px] uppercase tracking-[0.35em] text-teal-800 backdrop-blur-md ${!isMobile && "md:left-8 md:top-7"}`}
            >
              <LuSparkles className="text-amber-500" />
              Company Name
            </div>
          </div>

          {/* Profile content area */}
          <div
            className={`relative px-4 pb-6 pt-0 ${!isMobile && "sm:px-6 md:px-8 md:pb-8"}`}
          >
            {/* Avatar - overlapping cover */}
            <div
              className={`relative -mt-12 mb-4 ${!isMobile && "md:-mt-16 md:mb-5"}`}
            >
              <div className="relative inline-block ent-img">
                <div className="absolute inset-[-0.35rem] -z-10 rounded-full bg-[linear-gradient(135deg,rgba(13,148,136,0.75),rgba(255,255,255,0.9),rgba(245,158,11,0.7))] blur-md"></div>
                {getProfileImageOrNull(d) ? (
                  <img
                    alt={`Profile picture of ${name}`}
                    src={getProfileImageOrNull(d)!}
                    className={`h-24 w-24 rounded-full border border-white object-cover object-center shadow-[0_18px_50px_rgba(15,23,42,0.18)] transition-transform duration-500 hover:scale-[1.02] ${!isMobile && "md:h-32 md:w-32"}`}
                    draggable={false}
                  />
                ) : (
                  <div
                    className={`h-24 w-24 rounded-full border border-white object-cover object-center shadow-[0_18px_50px_rgba(15,23,42,0.18)] transition-transform duration-500 hover:scale-[1.02] font-bold flex items-center justify-center text-5xl text-white bg-gradient-to-tr from-teal-600 to-teal-300 ${!isMobile && "md:h-32 md:w-32"}`}
                  >
                    {getInitials(name)}
                  </div>
                )}
              </div>
            </div>

            {/* Profile header row */}
            <div
              className={`flex flex-col gap-6 ${!isMobile && "md:flex-row md:items-end md:justify-between md:gap-8"}`}
            >
              <div className="space-y-2">
                {title && (
                  <p className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.38em] text-teal-700">
                    {title}
                  </p>
                )}
                <p className="ent-greet text-sm text-slate-500 font-light italic">
                  Hello, I am
                </p>
                <h1
                  className={`max-w-xl font-[var(--font-display)] text-4xl leading-none tracking-[-0.04em] text-slate-950 ${!isMobile && "md:text-6xl"}`}
                >
                  {nameWords.map((word, i) => (
                    <span
                      key={i}
                      className="ent-word"
                      style={
                        { "--d": `${0.15 + i * 0.1}s` } as React.CSSProperties
                      }
                    >
                      {word}
                      {i < nameWords.length - 1 ? " " : " "}
                    </span>
                  ))}
                </h1>
              </div>

              {/* Action buttons */}
              <div
                className={mobileClass(
                  "flex w-full flex-wrap items-center justify-center gap-3 ent-cta md:flex-1",
                  isMobile,
                )}
              >
                <PortfolioActionButtons
                  data={d}
                  shareUrl={shareUrl}
                  theme={{
                    accent: "#0d9488",
                    text: "#0f766e",
                    surface: "#ffffff",
                    border: "#99f6e4",
                  }}
                  layout="row"
                  compact={false}
                />
              </div>
              <PortfolioSocialProof
                data={d}
                mini={mini}
                className="mt-4 w-full max-w-xl"
                theme={{
                  surface: '#ffffff',
                  border: '#99f6e4',
                  text: '#134e4a',
                  muted: '#0f766e',
                  accent: '#0d9488',
                  accentSoft: '#ccfbf1',
                  divider: '#ccfbf1',
                  shadow: '0 12px 28px rgba(13,148,136,0.12)',
                  radius: '18px',
                }}
              />
            </div>

            {/* Main content area with two columns */}
            <div
              className={`mt-8 grid grid-cols-1 gap-6 ${!isMobile && "lg:grid-cols-3 lg:gap-8"}`}
            >
              {/* Left sidebar - Socials + Contact (separate cards) */}
              {hasContact && (
                <div className="space-y-6">
                  {contactLinks.some((link) => link.kind === "social") && (
                    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-[0_12px_30px_rgba(15,23,42,0.08)] transition-all duration-300 hover:border-teal-200">
                      <h2 className="mb-4 flex items-center gap-2 font-[var(--font-display)] text-xl text-slate-950">
                        <LuUsers className="text-teal-600" />
                        Socials
                      </h2>
                      <div className="flex flex-wrap justify-center gap-2">
                        {contactLinks
                          .filter((link) => link.kind === "social")
                          .map((link, i) => (
                            <a
                              key={`social-${i}`}
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={getContactLinkAriaLabel(link)}
                              aria-label={getContactLinkAriaLabel(link)}
                              className="inline-flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 transition-all hover:border-teal-200 hover:text-teal-700 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-teal-100"
                            >
                              <SocialIcon platform={link.platform} size={PORTFOLIO_SOCIAL_ICON_SIZE} />
                            </a>
                          ))}
                      </div>
                    </div>
                  )}
                  {contactLinks.some((link) => link.kind === "contact") && (
                    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-[0_12px_30px_rgba(15,23,42,0.08)] transition-all duration-300 hover:border-teal-200">
                      <h2 className="mb-4 flex items-center gap-2 font-[var(--font-display)] text-xl text-slate-950">
                        Contact
                      </h2>
                      <div className="grid grid-cols-1 gap-2">
                        {contactLinks
                          .filter((link) => link.kind === "contact")
                          .map((link, i) => (
                            <a
                              key={`contact-${i}`}
                              href={link.url}
                              target="_self"
                              rel="noopener noreferrer"
                              title={getContactLinkAriaLabel(link)}
                              aria-label={getContactLinkAriaLabel(link)}
                              className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-[var(--font-mono)] text-slate-700 transition-colors hover:border-teal-200 hover:text-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-100"
                            >
                              <SocialIcon platform={link.platform} size={PORTFOLIO_SOCIAL_ICON_SIZE} />
                              <ContactLinkLabel link={link} className="truncate" />
                            </a>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className={`space-y-6 ${!isMobile && hasContact ? "lg:col-span-2" : ""}`}>

              {/* About */}
              {hasAbout && (
                <div className="rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
                  <h2 className="mb-4 font-[var(--font-display)] text-2xl text-slate-950">
                  </h2>
                  <p className="leading-8 text-slate-600">
                    <RichText html={clean(d.vcard.about) || clean(d.bizCard.description)} />
                  </p>
                </div>
              )}

              {/* Services */}
              {hasServices && (
                <div>
                  <h2 className="mb-5 font-[var(--font-display)] text-2xl text-slate-950">
                    Services
                  </h2>
                  <ServicesScrollContainer
                    isMobile={isMobile}
                    mini={mini}
                    desktopClassName={`grid grid-cols-1 gap-6 ${!isMobile && "xl:grid-cols-2"}`}
                  >
                    {services.map((service, idx) => (
                      <ServiceProductCard
                        key={service.id}
                        service={service}
                        index={idx}
                        compact={mini || isMobile}
                        mini={mini}
                      />
                    ))}
                  </ServicesScrollContainer>
                </div>
              )}

              {/* Gallery */}
              {isGalleryEnabled(d, mini) && hasGallery && (
                <div className="border-t border-slate-200 pt-6">
                  <h2 className="mb-5 font-[var(--font-display)] text-2xl text-slate-950">
                    Featured Gallery
                  </h2>
                  <GalleryCarousel
                    items={galleryItems}
                    accent="#0d9488"
                    glass="rgba(13,148,136,0.08)"
                    textMuted="#64748b"
                    mini={mini}
                    variant="green-gold"
                  />
                </div>
              )}

              {/* Videos */}
              {isGalleryEnabled(d, mini) && hasVideos && (
                <div className="border-t border-slate-200 pt-6">
                  <h2 className="mb-5 font-[var(--font-display)] text-2xl text-slate-950">
                    Videos
                  </h2>
                  <VideoCarousel
                    items={videos}
                    accent="#0d9488"
                    glass="rgba(13,148,136,0.08)"
                    textMuted="#64748b"
                    mini={mini}
                    variant="green-gold"
                  />
                </div>
              )}

              {/* Map */}
              {hasAddress && (
                <PortfolioAddressSection
                  vcard={d.vcard}
                  mini={mini}
                  theme={{
                    cardBg: "#ffffff",
                    text: "#0f172a",
                    textMuted: "#64748b",
                    accent: "#0d9488",
                  }}
                />
              )}

              {/* Inquiry */}
              {isInquiryEnabled(d, mini) && (
                <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
                  <h2 className="mb-4 font-[var(--font-display)] text-xl text-slate-950">
                    Inquire
                  </h2>
                  <form
                    className="space-y-4"
                    onSubmit={inquiryForm.handleSubmit}
                  >
                    <div>
                      <input
                        type="text"
                        placeholder="Your name"
                        value={inquiryForm.fields.name}
                        onChange={(e) =>
                          inquiryForm.setField("name", e.target.value)
                        }
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 transition-all duration-300 focus:border-teal-300 focus:outline-none focus:ring-2 focus:ring-teal-100"
                        aria-label="Your name"
                        required
                      />
                    </div>
                    <div>
                      <input
                        type="email"
                        placeholder="Your email address"
                        value={inquiryForm.fields.email}
                        onChange={(e) =>
                          inquiryForm.setField("email", e.target.value)
                        }
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 transition-all duration-300 focus:border-teal-300 focus:outline-none focus:ring-2 focus:ring-teal-100"
                        aria-label="Email address"
                        required
                      />
                    </div>
                    <div>
                      <input
                        type="text"
                        placeholder="Your Contact Number *(optional)"
                        value={inquiryForm.fields.phone}
                        onChange={(e) =>
                          inquiryForm.setField("phone", e.target.value)
                        }
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 transition-all duration-300 focus:border-teal-300 focus:outline-none focus:ring-2 focus:ring-teal-100"
                        aria-label="Contact number"
                      />
                    </div>
                    <div>
                      <input
                        type="text"
                        placeholder="Subject"
                        value={inquiryForm.fields.subject}
                        onChange={(e) =>
                          inquiryForm.setField("subject", e.target.value)
                        }
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 transition-all duration-300 focus:border-teal-300 focus:outline-none focus:ring-2 focus:ring-teal-100"
                        aria-label="Subject"
                      />
                    </div>
                    <div>
                      <textarea
                        placeholder="Your message"
                        rows={5}
                        value={inquiryForm.fields.message}
                        onChange={(e) =>
                          inquiryForm.setField("message", e.target.value)
                        }
                        className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 transition-all duration-300 focus:border-teal-300 focus:outline-none focus:ring-2 focus:ring-teal-100"
                        aria-label="Message"
                        required
                      ></textarea>
                    </div>
                    {inquiryForm.fieldError && (
                      <p className="text-sm text-red-600" role="alert">
                        {inquiryForm.fieldError}
                      </p>
                    )}
                    <button
                      type="submit"
                      disabled={inquiryForm.isSubmitting}
                      className="w-full rounded-xl border border-teal-600 bg-teal-600 px-4 py-3 font-[var(--font-mono)] text-xs uppercase tracking-[0.3em] text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-200 active:scale-[0.98] disabled:opacity-60"
                    >
                      {inquiryForm.isSubmitting ? "Sending…" : "Send Message"}
                    </button>
                  </form>
                </div>
              )}
            </div>
            </div>
          </div>
        </div>
      </div>

      {!mini && (
        <div className="w-full flex items-center gap-3 justify-center mt-2 mb-1 text-slate-400 text-xs uppercase tracking-wider">
          <span className="w-16 h-px bg-linear-to-l from-slate-400 to-transparent rounded-l-full" />
          Powered by OnTap Creatives
          <span className="w-16 h-px bg-linear-to-r from-slate-400 to-transparent rounded-r-full" />
        </div>
      )}

      {showFAB && !mini && <FloatingContactWidget data={d} accent="#0d9488" />}
      {!mini && (
        <QRCardExportSurface
          ref={cardRef}
          data={d}
          style={qrCardStyle}
          shareUrl={shareUrl}
          qrDataUrl={qrDataUrl}
        />
      )}
    </div>
  );
}
