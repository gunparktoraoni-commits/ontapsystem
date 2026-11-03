"use client";

import { useMemo, useState } from "react";
import Image from "next/image";


import type { PortfolioViewProps } from "../../../shared";
import {
	buildGalleryItems,
	buildVideoItems,
	buildServiceMediaItems,
	buildContactLinks,
	getCoverImageOrNull,
	PortfolioCoverMedia,
	getProfileImageOrNull,
	getDisplayName,
	isGalleryEnabled,
	isInquiryEnabled,
	usePortfolioInquiryForm,
	PortfolioAddressSection,
  hasPortfolioLocation,
	resolvePortfolioData,
	FloatingContactWidget,
	GalleryCarousel,
	VideoCarousel,
	ServiceMediaCarousel,
	ServicesScrollContainer,
	SocialIcon,
	PORTFOLIO_SOCIAL_ICON_SIZE,
	usePortfolioViewerSession,
	ContactLinkLabel,
	getContactLinkAriaLabel
} from "../../../shared";
import PortfolioActionButtons from "../../../components/PortfolioActionButtons";
import PortfolioSocialProof from "../../../components/PortfolioSocialProof";
import {
  useQRCardDownload,
  QRCardExportSurface,
  toQRCardStyle
} from "../../../QRCardDownload";
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

// ── Helper to check if any address field is filled (ignores objects) ──
function isAddressFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  return false; // objects, arrays, etc.
}

/* ── CSS for animations + fonts ── */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,600;0,9..144,700;1,9..144,300;1,9..144,400&family=DM+Sans:wght@300;400;500;600&display=swap');

@keyframes kFadeUp  { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
@keyframes kFadeIn  { from{opacity:0} to{opacity:1} }
@keyframes kScaleIn { from{opacity:0;transform:scale(0.88)} to{opacity:1;transform:scale(1)} }
@keyframes kSlideD  { from{opacity:0;transform:translateY(-16px)} to{opacity:1;transform:translateY(0)} }
@keyframes kWordIn  { from{opacity:0;transform:translateY(24px) rotate(-1deg)} to{opacity:1;transform:translateY(0) rotate(0)} }

.ent-greet { opacity:0; animation:kSlideD  .5s ease .10s forwards }
.ent-word  { opacity:0; animation:kWordIn  .65s cubic-bezier(.2,1.1,.3,1) var(--d,.15s) forwards }
.ent-cta   { opacity:0; animation:kFadeUp  .5s ease .62s forwards }
.ent-img   { opacity:0; animation:kScaleIn .70s cubic-bezier(.2,1,.3,1) .10s forwards }

/* ── Apply Fraunces for headings ── */
h1, h2, h3, h4, .heading {
  font-family: 'Fraunces', serif;
}

/* Text wrap for headings, paragraphs, and spans */
:is(h1, h2, h3, h4, h5, h6, p, span) {
  overflow-wrap: break-word;
  word-wrap: break-word;
  word-break: normal;
  text-wrap: wrap;
}
`;

const CharcoalYellow = ({ data, mini = false, showFAB = false, isMobile = false }: PortfolioViewProps) => {
  const d = resolvePortfolioData(data);
  const inquiryForm = usePortfolioInquiryForm({ urlAlias: d.bizCard.urlAlias, mini });
  const { checked: sessionChecked, isAuthenticated } = usePortfolioViewerSession();
  const name = getDisplayName(d);
  const title = profTitle(d);
  const coverImage = getCoverImageOrNull(d);
  const nameWords = name.split(' ');

  const profileImage = getProfileImageOrNull(d) ?? "";
  const [imageError, setImageError] = useState(false);
  const showFallback = !profileImage || imageError;

  // Compute initials (max two letters)
  const initials = useMemo(() => {
    const words = name.trim().split(/\s+/);
    if (words.length === 0) return "";
    if (words.length === 1) return words[0].charAt(0).toUpperCase();
    return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
  }, [name]);

  const galleryItems = buildGalleryItems(d);
  const videos = buildVideoItems(d);

  const services = useMemo(
    () =>
      (d.services ?? []).map((service, index) => ({
        id: Number(service.id ?? index + 1),
        title: clean(service.title) || `Service ${index + 1}`,
        tagline: clean(service.tagline),
        featured_image: clean(service.featured_image ?? ""),
        media: service.media ?? [],
        description: service.description ?? "",
      })),
    [d.services]
  );

  const contactLinks = buildContactLinks(d);

  const shareUrl = typeof window !== 'undefined' && d.bizCard.urlAlias
    ? `${window.location.origin}/${d.bizCard.urlAlias}` : '';
  const qrUrl = shareUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=280x280&ecc=H&data=${encodeURIComponent(shareUrl)}` : '';
  const { cardRef, qrDataUrl, download: downloadQRCard, isDownloading } = useQRCardDownload(d, shareUrl);
  const qrCardStyle = toQRCardStyle({
    cardBg: '#1C1C1E',
    text: '#fafafa',
    muted: '#a1a1aa',
    accent: '#facc15',
    border: 'rgba(255,255,255,0.05)'
  });

  const hasAbout = Boolean(d.vcard.about || d.bizCard.description);
  const hasServices = services.some(s => s.title);
  const hasGallery = galleryItems.length > 0;
  const hasVideos = videos.length > 0;
  const hasContact = contactLinks.length > 0;

  // Address check using all relevant fields
  const hasAddress = hasPortfolioLocation(d.vcard);

  const cardStyle =
    `bg-[#1C1C1E] rounded-3xl border border-white/5 p-6 ${!isMobile && "md:p-8"} shadow-sm`;

  const connectHref = toHttp(contactLinks[0]?.url ?? "");

  return (
    <div className={`min-h-screen h-max w-full flex items-center justify-center bg-[#09090B] text-zinc-100 font-sans py-12 ${!isMobile && "md:py-20"} selection:bg-yellow-400 selection:text-black`}>
      <CspStyle dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className={`w-[90%] max-w-6xl h-full flex flex-col gap-6 ${!isMobile && "md:gap-8"}`}>
        {/* Hero Card */}
        <div className={`${cardStyle} relative overflow-hidden flex flex-col ${!isMobile && "md:flex-row md:flex-wrap"} items-center justify-between gap-8 transition-all duration-300 hover:border-white/10`}>
          {coverImage ? (
            <PortfolioCoverMedia
              src={coverImage}
              coverType={d.bizCard.coverType}
              className="absolute inset-0 h-full w-full"
              objectPosition={d.bizCard.coverImagePosition ?? 'center center'}
              style={{ opacity: 0.3 }}
            />
          ) : null}
          <div className={`flex flex-col items-center gap-6 w-full ${!isMobile && 'md:flex-row md:w-auto md:text-left'} text-center`}>
            <div className="relative p-1 rounded-full border border-zinc-700 bg-black/40 ent-img">
              {showFallback ? (
                <div
                  className={`h-28 w-28 ${!isMobile && "md:h-32 md:w-32"} rounded-full bg-black/30 flex items-center justify-center text-2xl font-bold text-zinc-400 transition-transform duration-300 hover:scale-105`}
                >
                  {initials}
                </div>
              ) : (
                <Image
                  height={500}
                  width={500}
                  alt={`Profile picture of ${name}`}
                  src={profileImage}
                  className={`h-28 w-28 ${!isMobile && "md:h-32 md:w-32"} rounded-full object-cover object-center bg-zinc-800 transition-transform duration-300 hover:scale-105`}
                  draggable={false}
                  priority
                  onError={() => setImageError(true)}
                />
              )}
            </div>
            <div className="flex flex-col gap-1">
              <h1 className={`text-3xl ${!isMobile && "md:text-4xl"} font-bold tracking-tight text-white`}>
                {nameWords.map((word, i) => (
                  <span
                    key={i}
                    className="ent-word"
                    style={{ '--d': `${0.15 + i * 0.10}s` } as React.CSSProperties}
                  >
                    {word}{i < nameWords.length - 1 ? ' ' : ''}
                  </span>
                ))}
              </h1>
              {title && 
                <p className="ent-greet text-sm text-zinc-400 font-light" style={{ fontStyle: 'italic' }}>
                  {title}
                </p>
              }
            </div>
          </div>

          <div className={`flex flex-col w-full mt-auto ${!isMobile && 'sm:flex-row md:w-auto'} gap-4 shrink-0 ent-cta`}>
            <PortfolioActionButtons
              data={d}
              shareUrl={shareUrl}
              theme={{
                accent: '#facc15',
                accentGlow: '#eab308',
                primaryText: '#0a0a0a',
                text: '#fafafa',
                surface: '#27272a',
                border: 'rgba(255,255,255,0.12)'
              }}
              layout="row"
              compact={false}
            />
          </div>
          <PortfolioSocialProof
            data={d}
            mini={mini}
            className="mt-0 w-full basis-full"
            theme={{
              surface: '#27272a',
              border: 'rgba(250,204,21,0.22)',
              text: '#fafafa',
              muted: '#a1a1aa',
              accent: '#facc15',
              accentSoft: 'rgba(250,204,21,0.12)',
              divider: 'rgba(255,255,255,0.08)',
              shadow: '0 16px 36px rgba(0,0,0,0.35)',
              radius: '16px',
            }}
          />
        </div>

        {/* Content Grid — Connect/Address before About on mobile; desktop keeps About left / Connect right */}
        <div className={`w-full grid grid-cols-1 gap-6 ${!isMobile && "lg:grid-cols-3 md:gap-8"}`}>
          {/* Socials card + Contact/Email card (separate containers) */}
          {(contactLinks.some((l) => l.kind === 'social') || contactLinks.some((l) => l.kind === 'contact')) && (
            <div className={`order-1 flex flex-col gap-6 ${!isMobile && "lg:order-2 md:gap-8"}`}>
              {contactLinks.some((l) => l.kind === 'social') && (
                <div className={`${cardStyle} flex flex-col gap-5`}>
                  <h3 className="text-xl font-bold text-white">Socials</h3>
                  <div className="flex flex-wrap justify-center gap-2">
                    {contactLinks.filter((link) => link.kind === 'social').map((link, i) => (
                      <a
                        key={`social-${i}`}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={getContactLinkAriaLabel(link)}
                        aria-label={getContactLinkAriaLabel(link)}
                        className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 transition-all hover:bg-yellow-400 hover:text-black hover:border-yellow-400"
                      >
                        <SocialIcon platform={link.platform} size={PORTFOLIO_SOCIAL_ICON_SIZE} />
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {contactLinks.some((l) => l.kind === 'contact') && (
                <div className={`${cardStyle} flex flex-col gap-5`}>
                  <h3 className="text-xl font-bold text-white">Contact</h3>
                  <div className="grid grid-cols-1 gap-2">
                    {contactLinks.filter((link) => link.kind === 'contact').map((link, i) => (
                      <a
                        key={`contact-${i}`}
                        href={link.url}
                        target="_self"
                        rel="noopener noreferrer"
                        title={getContactLinkAriaLabel(link)}
                        aria-label={getContactLinkAriaLabel(link)}
                        className="flex items-center gap-2 p-3 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 text-sm font-medium transition-all hover:bg-yellow-400 hover:text-black hover:border-yellow-400"
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

          <div className={`order-2 flex flex-col gap-6 ${!isMobile && "lg:order-1 lg:col-span-2 md:gap-8"}`}>
        {/* About */}
        {hasAbout && (
          <div className={`${cardStyle} flex flex-col gap-3`}>
            <p className="text-zinc-400 leading-relaxed font-light">
              <RichText html={clean(d.vcard.about) || clean(d.bizCard.description)} />
            </p>
          </div>
        )}

        {/* Services */}
        {hasServices && (
          <div className={`${cardStyle} flex flex-col gap-5`}>
            <div
              className="rounded-xl px-3 py-2"
              style={{
                background:
                  'linear-gradient(90deg, rgba(250,204,21,0.18) 0%, rgba(250,204,21,0.04) 55%, transparent 100%)',
              }}
            >
              <h2 className="text-xl font-bold text-white">Services</h2>
            </div>
            <ServicesScrollContainer
              isMobile={isMobile}
              mini={mini}
              desktopClassName={`grid grid-cols-1 ${!isMobile && "sm:grid-cols-2"} gap-4`}
            >
              {services.map((service) => {
                const mediaItems = buildServiceMediaItems(service, service.media ?? []);
                return (
                  <div key={service.id} className="group p-3 rounded-2xl bg-zinc-900 border border-zinc-800 hover:border-yellow-400/50 transition-all duration-300 flex flex-col gap-0 overflow-hidden hover:-translate-y-1">
                    <div className="relative w-full aspect-4/3 rounded-t-xl bg-zinc-800 overflow-hidden">
                      {mediaItems.length > 0 ? (
                        <ServiceMediaCarousel
                          items={mediaItems}
                          accent="#facc15"
                          glass="rgba(255,255,255,0.02)"
                          textMuted="#a1a1aa"
                          mini={false}
                          variant="charcoal-yellow"
                        />
                      ) : service.featured_image ? (
                        <img
                          src={service.featured_image}
                          alt={service.title}
                          className="h-full w-full object-contain object-center opacity-80 group-hover:opacity-100 transition-opacity"
                          draggable={false}
                        />
                      ) : (
                        <div className="absolute inset-0 bg-zinc-700 flex items-center justify-center text-zinc-500 text-2xl font-bold">
                          {String(service.id).padStart(2, '0')}
                        </div>
                      )}
                    </div>
                    <div
                      className="relative px-3 py-3 flex flex-col gap-1"
                      style={{
                        background:
                          'linear-gradient(180deg, rgba(9,9,11,0.92) 0%, rgba(24,24,27,0.98) 100%)',
                      }}
                    >
                      <div
                        className="pointer-events-none absolute inset-x-0 -top-8 h-8"
                        style={{
                          background:
                            'linear-gradient(180deg, transparent 0%, rgba(9,9,11,0.92) 100%)',
                        }}
                      />
                      <h3 className="relative font-semibold text-sm text-white group-hover:text-yellow-400 transition-colors">
                        {service.title}
                      </h3>
                      {service.tagline ? (
                        <p className="relative text-xs text-yellow-300/90 font-medium">{service.tagline}</p>
                      ) : null}
                      {service.description && !mini ? (
                        <p className="relative text-xs text-zinc-300 leading-relaxed line-clamp-3 mt-0.5">
                          <RichText html={service.description} />
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </ServicesScrollContainer>
          </div>
        )}

        {/* Gallery Section */}
        {isGalleryEnabled(d, mini) && hasGallery && (
          <div className={`${cardStyle} flex flex-col gap-5`}>
            <div
              className="rounded-xl px-3 py-2"
              style={{
                background:
                  'linear-gradient(90deg, rgba(250,204,21,0.18) 0%, rgba(250,204,21,0.04) 55%, transparent 100%)',
              }}
            >
              <h3 className="text-xl font-bold text-white">Featured Gallery</h3>
            </div>
            <GalleryCarousel
              items={galleryItems}
              accent="#facc15"
              glass="rgba(255,255,255,0.02)"
              textMuted="#a1a1aa"
              mini={false}
              variant="ocean-gradient"
            />
          </div>
        )}

        {/* Videos Section */}
        {isGalleryEnabled(d, mini) && hasVideos && (
          <div className={`${cardStyle} flex flex-col gap-5`}>
            <div
              className="rounded-xl px-3 py-2"
              style={{
                background:
                  'linear-gradient(90deg, rgba(250,204,21,0.18) 0%, rgba(250,204,21,0.04) 55%, transparent 100%)',
              }}
            >
              <h3 className="text-xl font-bold text-white">Videos</h3>
            </div>
            <VideoCarousel
              items={videos}
              accent="#facc15"
              glass="rgba(255,255,255,0.02)"
              textMuted="#a1a1aa"
              mini={false}
              variant="charcoal-yellow"
            />
          </div>
        )}

        {/* Address / Map */}
        {hasAddress && (
          <PortfolioAddressSection
            vcard={d.vcard}
            mini={mini}
            theme={{ cardBg: '#18181b', text: '#ffffff', textMuted: '#a1a1aa', accent: '#facc15' }}
          />
        )}

        {/* Inquiry Form */}
        {isInquiryEnabled(d, mini) && (
          <div className={`${cardStyle} flex flex-col gap-6`}>
            <h3 className="text-xl font-bold text-white">Send an Inquiry</h3>
            <form className={`grid grid-cols-1 ${!isMobile && "lg:grid-cols-3"} gap-6`} onSubmit={inquiryForm.handleSubmit}>
              <div className={`${!isMobile && "lg:col-span-1"} flex flex-col gap-4`}>
                <input
                  type="text"
                  placeholder="Name"
                  value={inquiryForm.fields.name}
                  onChange={(e) => inquiryForm.setField('name', e.target.value)}
                  className="w-full p-4 rounded-xl bg-zinc-900 border border-zinc-800 text-white placeholder:text-zinc-600 focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400 transition-all duration-300"
                />
                <input
                  type="email"
                  placeholder="Email Address"
                  value={inquiryForm.fields.email}
                  onChange={(e) => inquiryForm.setField('email', e.target.value)}
                  className="w-full p-4 rounded-xl bg-zinc-900 border border-zinc-800 text-white placeholder:text-zinc-600 focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400 transition-all duration-300"
                />
                <input
                  type="text"
                  placeholder="Contact Number"
                  value={inquiryForm.fields.phone}
                  onChange={(e) => inquiryForm.setField('phone', e.target.value)}
                  className="w-full p-4 rounded-xl bg-zinc-900 border border-zinc-800 text-white placeholder:text-zinc-600 focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400 transition-all duration-300"
                />
                <input
                  type="text"
                  placeholder="Subject"
                  value={inquiryForm.fields.subject}
                  onChange={(e) => inquiryForm.setField('subject', e.target.value)}
                  className="w-full p-4 rounded-xl bg-zinc-900 border border-zinc-800 text-white placeholder:text-zinc-600 focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400 transition-all duration-300"
                />
              </div>
              <div className={`${!isMobile && "lg:col-span-2"} flex flex-col gap-4`}>
                <textarea
                  placeholder="Message"
                  value={inquiryForm.fields.message}
                  onChange={(e) => inquiryForm.setField('message', e.target.value)}
                  className="w-full h-full min-h-50 p-4 rounded-xl bg-zinc-900 border border-zinc-800 text-white placeholder:text-zinc-600 focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400 transition-all duration-300 resize-none"
                />
                {inquiryForm.fieldError && (
                  <p className="text-sm text-red-600" role="alert">{inquiryForm.fieldError}</p>
                )}
                <button
                  type="submit"
                  disabled={inquiryForm.isSubmitting}
                  className="w-full py-4 rounded-xl bg-yellow-400 text-black font-bold text-lg hover:bg-yellow-300 hover:-translate-y-1 transition-all duration-300 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {inquiryForm.isSubmitting ? 'Sending…' : 'Submit Inquiry'}
                </button>
              </div>
            </form>
          </div>
        )}
          </div>
        </div>

        {!mini && (
          <div className="w-full flex items-center gap-3 justify-center mt-2 mb-1 text-zinc-500 text-xs uppercase tracking-wider">
            <span className="w-16 h-px bg-linear-to-l from-zinc-500 to-transparent rounded-l-full" />
            Powered by OnTap Creatives
            <span className="w-16 h-px bg-linear-to-r from-zinc-500 to-transparent rounded-r-full" />
          </div>
        )}
      </div>

      {showFAB && !mini && <FloatingContactWidget data={d} accent="#facc15" qrUrl={qrUrl} />}
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
};

export default CharcoalYellow;