'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import {
  LuIdCard,
  LuUserRoundPlus,
  LuShare2,
  LuChevronLeft,
  LuChevronRight,
} from 'react-icons/lu';


import {
	downloadVCard,
	buildGalleryItems,
	buildVideoItems,
	buildContactLinks,
	isGalleryEnabled,
	isInquiryEnabled,
	usePortfolioInquiryForm,
	PortfolioAddressSection,
  hasPortfolioLocation,
	resolvePortfolioData,
	FloatingContactWidget,
	getDisplayName,
	getInitials,
	getProfileImageOrNull,
	SocialIcon,
	PORTFOLIO_SOCIAL_ICON_SIZE,
	GalleryCarousel,
	VideoCarousel,
	ServiceMediaCarousel,
	ServicesScrollContainer,
	buildServiceMediaItems,
	AnimatedSection,
	usePortfolioViewerSession,
	PortfolioAssociateButton,
	ContactLinkLabel,
	getContactLinkAriaLabel
} from '../../../shared';
import type { PortfolioViewProps } from '../../../shared';
import PortfolioSocialProof from '../../../components/PortfolioSocialProof';
import {
  useQRCardDownload,
  QRCardExportSurface,
  toQRCardStyle,
} from '../../../QRCardDownload';

import CspStyle from '@/app/components/CspStyle';
import { RichText } from '@/app/components/RichText';

type PortfolioData = NonNullable<PortfolioViewProps['data']>;

/* ─────────────────────────────────────────────
   GLASS CARD WRAPPER – matches reference exactly
───────────────────────────────────────────── */
const GlassCard: React.FC<
  React.PropsWithChildren<{
    className?: string;
    hover?: boolean;
    style?: React.CSSProperties;
  }>
> = ({ children, className = '', hover = false, style = {} }) => (
  <div
    className={`rounded-2xl ${hover ? 'transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:bg-white/70 hover:border-white/90' : ''} ${className}`}
    style={{
      background: 'rgba(255,255,255,0.55)',
      backdropFilter: 'blur(20px) saturate(180%)',
      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
      border: '1px solid rgba(255,255,255,0.75)',
      boxShadow:
        '0 8px 32px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.7)',
      ...style,
    }}
  >
    {children}
  </div>
);

/* ─────────────────────────────────────────────
   PETAL SHAPES (realistic leaves / petals)
───────────────────────────────────────────── */
const PETAL_PATHS = [
  'M12 2c1.1 0 2 .9 2 2 0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2zm9 7h-6V4h-2v5H4c-1.1 0-1.99.9-1.99 2L2 19c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V11c0-1.1-.9-2-2-2z',
  'M10 4C8.34 4 7 5.34 7 7s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3zm0 14c-1.1 0-2-.9-2-2V9c0-1.1.9-2 2-2s2 .9 2 2v7c0 1.1-.9 2-2 2z',
  'M12 2l-2 6h-4l3 4-1 5 4-3 4 3-1-5 3-4h-4z',
  'M4 16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2H6c-1.1 0-2 .9-2 2v8zm3-3a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
];



export default function JasmineMist({
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
  const { checked: sessionChecked, isAuthenticated } = usePortfolioViewerSession();

  const name = getDisplayName(d);
  const initials = getInitials(d);
  const title = d.vcard.professionalTitle || d.bizCard.occupation;
  const profileImage = getProfileImageOrNull(d);
  const aboutText = d.vcard.about || d.bizCard.description || '';

  const galleryItems = buildGalleryItems(d);
  const videos = buildVideoItems(d);
  const contactLinks = buildContactLinks(d);

  // Services with media
  const servicesWithMedia = (d.services ?? [])
    .map((s) => ({
      title: String(s.title ?? (s as any).name ?? '').trim(),
      description: String(s.description ?? (s as any).tagline ?? '').trim(),
      featured_image: String((s as any).featured_image ?? (s as any).image ?? '').trim(),
      media: (s as any).media || [],
    }))
    .filter((s) => s.title);

  // ── Pagination for services (4 per page) ──
  const SERVICES_PER_PAGE = 4;
  const [servicePage, setServicePage] = useState(0);
  const totalServicePages = Math.ceil(servicesWithMedia.length / SERVICES_PER_PAGE);
  const visibleServices = servicesWithMedia.slice(
    servicePage * SERVICES_PER_PAGE,
    (servicePage + 1) * SERVICES_PER_PAGE
  );

  const handlePrevService = () => setServicePage((p) => Math.max(0, p - 1));
  const handleNextService = () =>
    setServicePage((p) => Math.min(totalServicePages - 1, p + 1));

  // ── Share ──
  const shareUrl =
    typeof window !== 'undefined' && d.bizCard.urlAlias
      ? `${window.location.origin}/${d.bizCard.urlAlias}`
      : '';
  const qrUrl = shareUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=280x280&ecc=H&data=${encodeURIComponent(shareUrl)}`
    : '';
  const { cardRef, qrDataUrl, download: downloadQRCard, isDownloading } =
    useQRCardDownload(d, shareUrl);
  const qrCardStyle = toQRCardStyle({
    bg: '#fff7ed',
    surface: 'rgba(255,255,255,0.9)',
    text: '#0f172a',
    muted: 'rgba(15,23,42,0.6)',
    accent: '#fbc4ab',
    border: 'rgba(15,23,42,0.08)',
  });

  const handleShare = async () => {
    if (typeof window === 'undefined') return;
    const url = shareUrl || `${window.location.origin}/${d.bizCard.urlAlias}`;
    if (navigator.share) {
      await navigator.share({ title: name, url }).catch(() => { });
    } else {
      await navigator.clipboard.writeText(url).catch(() => { });
    }
  };

  const fadeUp = {
    hidden: { opacity: 0, y: 40 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.6, ease: [0.25, 0.1, 0.25, 1] as const },
    },
  };

  return (
    <>
      <CspStyle>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&display=swap');

        .template-root { font-family: 'Playfair Display', serif; }
        .template-root h1, .template-root h2, .template-root h3, .template-root h4 {
          font-family: 'Playfair Display', serif;
        }

        @keyframes floatPetal {
          0%   { transform: translate(0, 0) rotate(0deg); opacity: 0; }
          5%   { opacity: 0.7; }
          95%  { opacity: 0.7; }
          100% { transform: translate(calc(100vw + 60px), calc(-100vh - 60px)) rotate(360deg); opacity: 0; }
        }
        @keyframes ringPulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(251, 196, 171, 0.4); }
          50%     { box-shadow: 0 0 0 10px rgba(255, 215, 248, 1); }
        }
      
/* Text wrap for headings, paragraphs, and spans */
:is(h1, h2, h3, h4, h5, h6, p, span) {
  overflow-wrap: break-word;
  word-wrap: break-word;
  word-break: normal;
  text-wrap: wrap;
}
`}</CspStyle>

      {/* ── Outer wrapper ── */}
      <div className="w-full h-auto flex items-center justify-center bg-white relative overflow-hidden">
        <Image
          height={1200}
          width={1200}
          alt="bubble-glass-bg"
          src="/images/template-res/floral-bg-3.png"
          className="fixed top-0 left-0 w-full h-full object-cover z-1 opacity-50"
          draggable={false}
          priority
          sizes="100vw"
        />

        {/* Floating petals */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={`petal-${i}`}
              className="fixed pointer-events-none will-change-transform"
              style={{
                bottom: `${Math.random() * 100}%`,
                left: `${Math.random() * 80}%`,
                animation: `floatPetal ${10 + i * 2.5}s linear infinite`,
                animationDelay: `${i * 1.7}s`,
                zIndex: 1,
              }}
            >
              <svg
                className="w-[22px] h-[22px] opacity-50 text-pink-300/45 drop-shadow-[0_2px_4px_rgba(244,114,182,0.12)]"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d={PETAL_PATHS[i % PETAL_PATHS.length]} />
              </svg>
            </div>
          ))}
        </div>

        {/* ── Main vertical container ── */}
        <div className="w-full max-w-xl h-auto shadow-lg z-50 flex flex-col items-center justify-center relative">

          {/* ══════════════ HERO SECTION ══════════════ */}
          <AnimatedSection delay={0} mini={mini}>
            <div className="w-full flex flex-col items-center justify-center z-50 relative px-5 pt-14 pb-6">
              <div
                className="inline-block p-1 rounded-full bg-gradient-to-br from-pink-300 to-rose-300 to-emerald-200 animate-[ringPulse_3s_ease-in-out_infinite] transition-all duration-400"
              >
                {profileImage ? (
                  <img
                    src={profileImage}
                    alt={name}
                    className="block rounded-full object-cover object-center w-36 h-36 border-3 border-white bg-white transition-transform duration-400 hover:scale-105"
                  />
                ) : (
                  <div className="block rounded-full object-cover object-center w-36 h-36 border-3 border-white bg-white/20 transition-transform duration-400 hover:scale-105 flex items-center justify-center text-4xl font-bold text-gray-700">
                    {initials}
                  </div>
                )}
              </div>
              
              <h1 className="text-3xl text-gray-800 font-semibold mt-5 font-['Playfair_Display']">{name}</h1>
              {title && <h2 className="font-medium text-gray-600 font-['Playfair_Display']">{title}</h2>}
              {/* Hero actions */}
              <div className="flex flex-wrap items-center justify-center gap-3 mt-6 mb-6">
                <button
                  onClick={() => downloadVCard(d)}
                  className="inline-flex items-center gap-2.5 px-6 py-3 rounded-full border-none cursor-pointer font-['Playfair_Display'] font-semibold text-sm text-white bg-gradient-to-r from-[#ff85e9] via-pink-500 to-rose-400 bg-[length:200%_200%] shadow-[0_4px_18px_rgba(244,114,182,0.35)] transition-all duration-300 hover:-translate-y-0.5 hover:scale-105 hover:shadow-[0_12px_32px_rgba(244,114,182,0.5)] active:scale-95 relative overflow-hidden before:content-[''] before:absolute before:inset-0 before:bg-gradient-to-r before:from-white/30 before:to-transparent before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-300"
                >
                  <LuIdCard size={18} /> Save Contact
                </button>
                <button
                  onClick={handleShare}
                  className="inline-flex items-center gap-2.5 px-6 py-3 rounded-full cursor-pointer font-['Playfair_Display'] font-semibold text-sm text-gray-800 bg-white/45 border border-white/60 backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.5),_0_4px_12px_rgba(0,0,0,0.08)] transition-all duration-300 hover:bg-white/65 hover:-translate-y-0.5 hover:scale-105 hover:shadow-[0_10px_28px_rgba(0,0,0,0.12),_inset_0_1px_0_rgba(255,255,255,0.8)] active:scale-95"
                >
                  <LuShare2 size={18} /> Share
                </button>
              </div>
              <PortfolioSocialProof
                data={d}
                mini={mini}
                className="mb-6 max-w-lg"
                theme={{
                  surface: 'rgba(255,255,255,0.55)',
                  border: 'rgba(255,255,255,0.75)',
                  text: '#374151',
                  muted: '#4b5563',
                  accent: '#be185d',
                  accentSoft: 'rgba(244,114,182,0.16)',
                  divider: 'rgba(255,255,255,0.6)',
                  shadow: '0 8px 32px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.7)',
                  radius: '24px',
                  backdropFilter: 'blur(20px) saturate(180%)',
                  fontFamily: "'Playfair Display', serif",
                }}
              />
              {/* ── Socials + Contact (separate glass panels) ── */}
              {(contactLinks.some((link) => link.kind === 'social') ||
                contactLinks.some((link) => link.kind === 'contact')) && (
                <AnimatedSection delay={50} mini={mini}>
                  <div className="w-full flex flex-col gap-3">
                    {contactLinks.some((link) => link.kind === 'social') && (
                      <div className="w-full rounded-3xl bg-white/45 border border-white/70 backdrop-blur-xs p-4 flex flex-col gap-3">
                        <h3 className="font-['Playfair_Display'] font-semibold text-sm text-gray-800 tracking-wide">
                          Socials
                        </h3>
                        <div className="flex flex-wrap justify-center gap-2">
                          {contactLinks.filter((link) => link.kind === 'social').map((link) => (
                            <a
                              key={`social-${link.platform}-${link.url}`}
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={getContactLinkAriaLabel(link)}
                              aria-label={getContactLinkAriaLabel(link)}
                              className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-white/50 border border-white/70 backdrop-blur-xs text-gray-800 hover:bg-white/60 hover:scale-105 transition-all"
                            >
                              <SocialIcon platform={link.platform} size={PORTFOLIO_SOCIAL_ICON_SIZE} />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                    {contactLinks.some((link) => link.kind === 'contact') && (
                      <div className="w-full rounded-3xl bg-white/45 border border-white/70 backdrop-blur-xs p-4 flex flex-col gap-3">
                        <h3 className="font-['Playfair_Display'] font-semibold text-sm text-gray-800 tracking-wide">
                          Contact
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {sessionChecked && isAuthenticated ? (
                            <PortfolioAssociateButton
                              urlAlias={d.bizCard.urlAlias}
                              className="inline-flex items-center gap-2 px-4 py-2 text-gray-800 text-sm hover:bg-white/60 transition-all rounded-full bg-white/50 backdrop-blur-xs border border-white/70"
                              icon={<LuUserRoundPlus size={16} />}
                              label="Connect"
                            />
                          ) : null}
                          {contactLinks.filter((link) => link.kind === 'contact').map((link) => (
                            <a
                              key={`contact-${link.platform}-${link.url}`}
                              href={link.url}
                              target="_self"
                              rel="noopener noreferrer"
                              title={getContactLinkAriaLabel(link)}
                              aria-label={getContactLinkAriaLabel(link)}
                              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/50 border border-white/70 backdrop-blur-xs text-gray-800 text-sm hover:bg-white/60 transition-all"
                            >
                              <SocialIcon platform={link.platform} size={PORTFOLIO_SOCIAL_ICON_SIZE} />
                              <ContactLinkLabel link={link} />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </AnimatedSection>
              )}
            </div>
          </AnimatedSection>

          {/* ══════════════ CONTENT SECTIONS ══════════════ */}
          <div className="w-full h-auto flex flex-col items-center px-5 pt-2 pb-10 gap-10">

            {aboutText && (
              <AnimatedSection delay={50} mini={mini}>
                <GlassCard hover className="w-full h-auto flex flex-col overflow-hidden shadow-lg">
                  <Image
                    height={1200}
                    width={1200}
                    alt="about-image"
                    src="/images/template-res/floral-bg-3.png"
                    className="w-full aspect-video z-50 object-cover"
                    draggable={false}
                   />
                  <span className="w-full h-auto px-7 py-5 text-gray-800">
                    <p className="text-gray-700 font-['Playfair_Display']"><RichText html={aboutText} /></p>
                  </span>
                </GlassCard>
              </AnimatedSection>
            )}

            {/* ── Services ── */}
            {servicesWithMedia.length > 0 && (
              <AnimatedSection delay={100} mini={mini}>
                <div className="w-full flex flex-col items-center z-50 text-gray-800">
                  <div className="flex items-center justify-between w-full mb-4">
                    <h2 className="text-2xl font-semibold font-['Playfair_Display']">Services</h2>
                    {!isMobile && totalServicePages > 1 && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-black/10 bg-white/85 text-gray-800 backdrop-blur-sm transition-all duration-200 hover:bg-white/95 hover:scale-110 hover:border-yellow-200/35 hover:shadow-md active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                          aria-label="Previous" onClick={handlePrevService}
                          disabled={servicePage === 0}
                        >
                          <LuChevronLeft size={16} />
                        </button>
                        <span className="text-sm font-medium">
                          {servicePage + 1} / {totalServicePages}
                        </span>
                        <button
                          type="button"
                          className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-black/10 bg-white/85 text-gray-800 backdrop-blur-sm transition-all duration-200 hover:bg-white/95 hover:scale-110 hover:border-yellow-200/35 hover:shadow-md active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                          aria-label="Next" onClick={handleNextService}
                          disabled={servicePage === totalServicePages - 1}
                        >
                          <LuChevronRight size={16} />
                        </button>
                      </div>
                    )}
                  </div>

                  <ServicesScrollContainer
                    isMobile={isMobile}
                    mini={mini}
                    desktopClassName="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full"
                  >
                    {(isMobile && !mini ? servicesWithMedia : visibleServices).map((service, idx) => {
                      const mediaItems = buildServiceMediaItems(service, service.media ?? []);
                      return (
                        <GlassCard key={idx} hover className="w-full overflow-hidden flex flex-col">
                          <div className="relative w-full overflow-hidden">
                            {mediaItems.length > 0 ? (
          <ServiceMediaCarousel
                                items={mediaItems}
                                accent="#f472b6"
                                glass="rgba(255,255,255,0.2)"
                                textMuted="#4b5563"
                                mini={mini}
                                variant="hibiscus-dusk"
                              />
        ) : service.featured_image ? (
                              <img
                                src={service.featured_image}
                                alt={service.title}
                                className="w-full h-full object-contain object-center"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-white/20 text-gray-500">
                                {service.title.charAt(0)}
                              </div>
                            )}
                          </div>
                          <div className="p-4">
                            <h3 className="text-xl font-semibold font-['Playfair_Display']">{service.title}</h3>
                            <p className="text-gray-700 text-sm font-['Playfair_Display']"><RichText html={service.description} /></p>
                          </div>
                        </GlassCard>
                      );
                    })}
                  </ServicesScrollContainer>
                </div>
              </AnimatedSection>
            )}

            {/* ── Gallery ── */}
            {isGalleryEnabled(d, mini) && galleryItems.length > 0 && (
              <AnimatedSection delay={150} mini={mini}>
                <GlassCard className="w-full p-6">
                  <h2 className="text-2xl font-semibold mb-4 text-gray-800 font-['Playfair_Display']">Featured Gallery</h2>
                  <GalleryCarousel
                    items={galleryItems}
                    accent="#f472b6"
                    glass="rgba(255,255,255,0.2)"
                    textMuted="#4b5563"
                    mini={mini}
                    variant="hibiscus-dusk"
                  />
                </GlassCard>
              </AnimatedSection>
            )}

            {/* ── Videos ── */}
            {isGalleryEnabled(d, mini) && videos.length > 0 && (
              <AnimatedSection delay={200} mini={mini}>
                <GlassCard className="w-full p-6">
                  <h2 className="text-2xl font-semibold mb-4 text-gray-800 font-['Playfair_Display']">Videos</h2>
                  <VideoCarousel
                    items={videos}
                    accent="#f472b6"
                    glass="rgba(255,255,255,0.2)"
                    textMuted="#4b5563"
                    mini={mini}
                    variant="hibiscus-dusk"
                  />
                </GlassCard>
              </AnimatedSection>
            )}

            {/* ── Office Location ── */}
            {hasPortfolioLocation(d.vcard) && (
              <AnimatedSection delay={250} mini={mini} className="w-full max-sm:-mx-5 max-sm:w-[calc(100%+2.5rem)]">
                <GlassCard className="w-full overflow-hidden p-6 max-sm:rounded-none max-sm:px-0 max-sm:pt-5 max-sm:pb-5">
                  <h2 className="text-2xl font-semibold mb-4 text-gray-800 font-['Playfair_Display'] max-sm:px-5">Office Location</h2>
                  <PortfolioAddressSection
                    vcard={d.vcard}
                    mini={mini}
                    className="!border-0 max-sm:!p-0 max-sm:!rounded-none"
                    theme={{
                      cardBg: 'transparent',
                      text: '#1f2937',
                      textMuted: '#4b5563',
                      accent: '#f472b6',
                    }}
                  />
                </GlassCard>
              </AnimatedSection>
            )}

            {/* ── Inquiry Form ── */}
            {isInquiryEnabled(d, mini) && (
              <AnimatedSection delay={300} mini={mini} className='w-full'>
                <GlassCard className="w-full p-6">
                  <h2 className="text-2xl font-semibold mb-4 text-gray-800 font-['Playfair_Display']">Send Inquiry</h2>
                  <form className="flex flex-col gap-4" onSubmit={inquiryForm.handleSubmit}>
                    <input
                      type="text"
                      placeholder="Name"
                      className="w-full px-4 py-3 rounded-xl font-['Playfair_Display'] text-sm text-gray-800 bg-white/45 border border-white/60 backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.25),_0_2px_8px_rgba(0,0,0,0.06)] outline-none transition-all duration-300 placeholder:text-gray-500 hover:bg-white/55 hover:border-white/80 focus:bg-white/70 focus:border-white/90 focus:shadow-[0_0_0_3px_rgba(236,72,153,0.2),_inset_0_1px_0_rgba(255,255,255,0.4),_0_8px_24px_rgba(0,0,0,0.1)] focus:-translate-y-0.5"
                      value={inquiryForm.fields.name}
                      onChange={(e) => inquiryForm.setField('name', e.target.value)}
                      required
                    />
                    <input
                      type="email"
                      placeholder="Email"
                      className="w-full px-4 py-3 rounded-xl font-['Playfair_Display'] text-sm text-gray-800 bg-white/45 border border-white/60 backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.25),_0_2px_8px_rgba(0,0,0,0.06)] outline-none transition-all duration-300 placeholder:text-gray-500 hover:bg-white/55 hover:border-white/80 focus:bg-white/70 focus:border-white/90 focus:shadow-[0_0_0_3px_rgba(236,72,153,0.2),_inset_0_1px_0_rgba(255,255,255,0.4),_0_8px_24px_rgba(0,0,0,0.1)] focus:-translate-y-0.5"
                      value={inquiryForm.fields.email}
                      onChange={(e) => inquiryForm.setField('email', e.target.value)}
                      required
                    />
                    <input
                      type="text"
                      placeholder="Contact Number (optional)"
                      className="w-full px-4 py-3 rounded-xl font-['Playfair_Display'] text-sm text-gray-800 bg-white/45 border border-white/60 backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.25),_0_2px_8px_rgba(0,0,0,0.06)] outline-none transition-all duration-300 placeholder:text-gray-500 hover:bg-white/55 hover:border-white/80 focus:bg-white/70 focus:border-white/90 focus:shadow-[0_0_0_3px_rgba(236,72,153,0.2),_inset_0_1px_0_rgba(255,255,255,0.4),_0_8px_24px_rgba(0,0,0,0.1)] focus:-translate-y-0.5"
                      value={inquiryForm.fields.phone}
                      onChange={(e) => inquiryForm.setField('phone', e.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="Subject"
                      className="w-full px-4 py-3 rounded-xl font-['Playfair_Display'] text-sm text-gray-800 bg-white/45 border border-white/60 backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.25),_0_2px_8px_rgba(0,0,0,0.06)] outline-none transition-all duration-300 placeholder:text-gray-500 hover:bg-white/55 hover:border-white/80 focus:bg-white/70 focus:border-white/90 focus:shadow-[0_0_0_3px_rgba(236,72,153,0.2),_inset_0_1px_0_rgba(255,255,255,0.4),_0_8px_24px_rgba(0,0,0,0.1)] focus:-translate-y-0.5"
                      value={inquiryForm.fields.subject}
                      onChange={(e) => inquiryForm.setField('subject', e.target.value)}
                    />
                    <textarea
                      placeholder="Message"
                      className="w-full px-4 py-3 rounded-xl font-['Playfair_Display'] text-sm text-gray-800 bg-white/45 border border-white/60 backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.25),_0_2px_8px_rgba(0,0,0,0.06)] outline-none transition-all duration-300 placeholder:text-gray-500 hover:bg-white/55 hover:border-white/80 focus:bg-white/70 focus:border-white/90 focus:shadow-[0_0_0_3px_rgba(236,72,153,0.2),_inset_0_1px_0_rgba(255,255,255,0.4),_0_8px_24px_rgba(0,0,0,0.1)] focus:-translate-y-0.5 resize-y min-h-[140px]"
                      style={{ minHeight: '140px' }}
                      value={inquiryForm.fields.message}
                      onChange={(e) => inquiryForm.setField('message', e.target.value)}
                      required
                    />
                    {inquiryForm.fieldError && (
                      <p className="text-sm text-rose-600" role="alert">
                        {inquiryForm.fieldError}
                      </p>
                    )}
                    <button
                      type="submit"
                      disabled={inquiryForm.isSubmitting}
                      className="w-full inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl border-none cursor-pointer font-['Playfair_Display'] font-bold text-sm text-white bg-gradient-to-r from-pink-500 to-rose-500 shadow-[0_4px_18px_rgba(236,72,153,0.35)] transition-all duration-300 hover:-translate-y-0.5 hover:scale-105 hover:shadow-[0_12px_32px_rgba(236,72,153,0.5)] active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {inquiryForm.isSubmitting ? 'Sending…' : 'Send Message'}
                    </button>
                  </form>
                </GlassCard>
              </AnimatedSection>
            )}
          </div>

          {/* ══════════════ FOOTER ══════════════ */}
          <span className="w-full flex items-center gap-3 justify-center mt-8 mb-5 text-gray-500 text-xs uppercase tracking-wider text-nowrap z-50">
            <span className="w-16 h-px bg-gradient-to-l from-gray-400 to-transparent rounded-l-full" />
            Powered by OnTap Creatives
            <span className="w-16 h-px bg-gradient-to-r from-gray-400 to-transparent rounded-r-full" />
          </span>
        </div>
      </div>

      {showFAB && !mini && <FloatingContactWidget data={d} accent="#ec4899" qrUrl={qrUrl} />}
      {!mini && (
        <QRCardExportSurface
          ref={cardRef}
          data={d}
          style={qrCardStyle}
          shareUrl={shareUrl}
          qrDataUrl={qrDataUrl}
        />
      )}
    </>
  );
}