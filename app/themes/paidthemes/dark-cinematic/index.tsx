'use client';

import React, { useState } from 'react';
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
  getContactLinkAriaLabel,
} from '../../shared';
import type { PortfolioViewProps } from '../../shared';
import PortfolioSocialProof from '../../components/PortfolioSocialProof';
import {
  useQRCardDownload,
  QRCardExportSurface,
  toQRCardStyle,
} from '../../QRCardDownload';

import CspStyle from '@/app/components/CspStyle';
import { RichText } from '@/app/components/RichText';

/* ─────────────────────────────────────────────
   DESIGN TOKENS — Dark Cinematic
   Deep olive-black, electric lime, glass panels
───────────────────────────────────────────── */
const BG = '#080808';
const BG_OLIVE = '#0E1410';
const LIME = '#DFFF4F';
const LIME_DEEP = '#C5E63A';
const LIME_SOFT = 'rgba(223,255,79,0.14)';
const LIME_GLOW = 'rgba(223,255,79,0.22)';
const GLASS = 'rgba(22, 28, 24, 0.55)';
const GLASS_SOFT = 'rgba(18, 22, 20, 0.42)';
const GLASS_BORDER = 'rgba(255,255,255,0.10)';
const INK = '#FFFFFF';
const TEXT_SECONDARY = 'rgba(255,255,255,0.62)';
const MUTED = 'rgba(255,255,255,0.38)';
const DANGER = '#EF4444';

const SHADOW =
  '0 24px 56px rgba(0,0,0,0.5), 0 8px 20px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08)';
const SHADOW_HOVER =
  '0 32px 64px rgba(0,0,0,0.55), 0 12px 28px rgba(223,255,79,0.14), inset 0 1px 0 rgba(255,255,255,0.12)';

const GlassCard: React.FC<
  React.PropsWithChildren<{
    className?: string;
    hover?: boolean;
    style?: React.CSSProperties;
    glow?: boolean;
  }>
> = ({ children, className = '', hover = false, style = {}, glow = false }) => (
  <div
    className={`dc-glass rounded-[28px] relative ${hover ? 'dc-glass-hover' : ''} ${className}`}
    style={{
      background: GLASS,
      backdropFilter: 'blur(24px) saturate(140%)',
      WebkitBackdropFilter: 'blur(24px) saturate(140%)',
      border: `1px solid ${GLASS_BORDER}`,
      boxShadow: glow
        ? `${SHADOW}, 0 0 40px rgba(223,255,79,0.08)`
        : SHADOW,
      ...style,
    }}
  >
    <div
      className="pointer-events-none absolute inset-0 rounded-[28px]"
      aria-hidden="true"
      style={{
        background:
          'linear-gradient(155deg, rgba(255,255,255,0.06) 0%, transparent 40%, transparent 70%, rgba(223,255,79,0.03) 100%)',
      }}
    />
    <div className="relative">{children}</div>
  </div>
);

const LimeRule: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`flex items-center justify-center gap-3 ${className}`} aria-hidden="true">
    <span
      className="h-px w-10 sm:w-14"
      style={{ background: `linear-gradient(90deg, transparent, ${LIME}55)` }}
    />
    <span
      className="h-1.5 w-1.5 rounded-full"
      style={{ background: LIME, boxShadow: `0 0 10px ${LIME}` }}
    />
    <span
      className="h-px w-10 sm:w-14"
      style={{ background: `linear-gradient(90deg, ${LIME}55, transparent)` }}
    />
  </div>
);

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span
    className="inline-block text-[11px] font-semibold uppercase tracking-[0.24em] mb-2"
    style={{ color: LIME }}
  >
    {children}
  </span>
);

/** Moody olive glow + soft lime atmosphere */
const CinematicAtmosphere: React.FC = () => (
  <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
    <div
      className="absolute -top-[12%] left-1/2 -translate-x-1/2 h-[55vmax] w-[70vmax] rounded-full"
      style={{
        background:
          'radial-gradient(ellipse at center, rgba(34,55,38,0.55) 0%, rgba(14,20,16,0.25) 45%, transparent 70%)',
        filter: 'blur(20px)',
      }}
    />
    <div
      className="absolute top-[18%] -right-[20%] h-[42vmax] w-[42vmax] rounded-full"
      style={{
        background: 'radial-gradient(circle, rgba(223,255,79,0.08) 0%, transparent 68%)',
        filter: 'blur(40px)',
      }}
    />
    <div
      className="absolute bottom-[-8%] -left-[15%] h-[38vmax] w-[38vmax] rounded-full"
      style={{
        background: 'radial-gradient(circle, rgba(40,70,45,0.35) 0%, transparent 70%)',
        filter: 'blur(36px)',
      }}
    />
    <div
      className="absolute inset-0"
      style={{
        background:
          'radial-gradient(ellipse 80% 70% at 50% 35%, transparent 35%, rgba(0,0,0,0.55) 100%)',
      }}
    />
  </div>
);

export default function DarkCinematic({
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
  const company = String(d.bizCard.companyName ?? '').trim();
  const profileImage = getProfileImageOrNull(d);
  const aboutText = d.vcard.about || d.bizCard.description || '';
  const galleryItems = buildGalleryItems(d);
  const videos = buildVideoItems(d);
  const contactLinks = buildContactLinks(d);
  const socialLinks = contactLinks.filter((link) => link.kind === 'social');
  const directContacts = contactLinks.filter((link) => link.kind === 'contact');

  const servicesWithMedia = (d.services ?? [])
    .map((s) => ({
      title: String(s.title ?? (s as any).name ?? '').trim(),
      description: String(s.description ?? (s as any).tagline ?? '').trim(),
      featured_image: String((s as any).featured_image ?? (s as any).image ?? '').trim(),
      media: (s as any).media || [],
    }))
    .filter((s) => s.title);

  const SERVICES_PER_PAGE = 4;
  const [servicePage, setServicePage] = useState(0);
  const totalServicePages = Math.ceil(servicesWithMedia.length / SERVICES_PER_PAGE);
  const visibleServices = servicesWithMedia.slice(
    servicePage * SERVICES_PER_PAGE,
    (servicePage + 1) * SERVICES_PER_PAGE,
  );

  const handlePrevService = () => setServicePage((p) => Math.max(0, p - 1));
  const handleNextService = () =>
    setServicePage((p) => Math.min(totalServicePages - 1, p + 1));

  const shareUrl =
    typeof window !== 'undefined' && d.bizCard.urlAlias
      ? `${window.location.origin}/${d.bizCard.urlAlias}`
      : '';
  const qrUrl = shareUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=280x280&ecc=H&data=${encodeURIComponent(shareUrl)}`
    : '';
  const { cardRef, qrDataUrl } = useQRCardDownload(d, shareUrl);
  const qrCardStyle = toQRCardStyle({
    bg: BG,
    surface: GLASS,
    text: INK,
    muted: TEXT_SECONDARY,
    accent: LIME,
    border: GLASS_BORDER,
  });

  const handleShare = async () => {
    if (typeof window === 'undefined') return;
    const url = shareUrl || `${window.location.origin}/${d.bizCard.urlAlias}`;
    if (navigator.share) {
      await navigator.share({ title: name, url }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(url).catch(() => {});
    }
  };

  const inputClass =
    'dc-input w-full px-4 py-3.5 rounded-[18px] font-sans text-sm outline-none transition-all duration-300 placeholder:text-white/35';
  const inputStyle: React.CSSProperties = {
    color: INK,
    background: 'rgba(255,255,255,0.05)',
    border: `1px solid ${GLASS_BORDER}`,
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
    backdropFilter: 'blur(12px)',
  };

  return (
    <>
      <CspStyle>{`
        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap');

        .dark-cinematic-root {
          font-family: 'Manrope', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          color: ${INK};
          -webkit-font-smoothing: antialiased;
        }
        .dark-cinematic-root h1,
        .dark-cinematic-root h2,
        .dark-cinematic-root h3 {
          font-family: inherit;
          letter-spacing: -0.025em;
          font-weight: 600;
        }

        .dc-glass-hover {
          transition: transform 360ms cubic-bezier(0.22, 1, 0.36, 1),
            box-shadow 360ms ease, border-color 360ms ease;
        }
        .dc-glass-hover:hover {
          transform: translateY(-4px);
          box-shadow: ${SHADOW_HOVER} !important;
          border-color: rgba(223,255,79,0.28) !important;
        }

        .dc-btn-primary {
          transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1),
            box-shadow 280ms ease, filter 280ms ease;
        }
        .dc-btn-primary:hover {
          transform: translateY(-2px) scale(1.02);
          box-shadow: 0 14px 32px rgba(223,255,79,0.35);
          filter: brightness(1.05);
        }
        .dc-btn-primary:active {
          transform: scale(0.98);
        }

        .dc-btn-ghost {
          transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1),
            background 280ms ease, box-shadow 280ms ease, border-color 280ms ease;
        }
        .dc-btn-ghost:hover {
          transform: translateY(-2px);
          background: rgba(255,255,255,0.1) !important;
          border-color: rgba(223,255,79,0.3) !important;
          box-shadow: 0 12px 24px rgba(0,0,0,0.35), 0 0 16px rgba(223,255,79,0.1);
        }
        .dc-btn-ghost:active {
          transform: scale(0.98);
        }

        .dc-social {
          transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1),
            box-shadow 280ms ease, background 280ms ease;
        }
        .dc-social:hover {
          transform: translateY(-3px) scale(1.05);
          background: rgba(223,255,79,0.16) !important;
          box-shadow: 0 12px 24px rgba(223,255,79,0.2);
        }

        .dc-contact-row {
          transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1),
            background 280ms ease, border-color 280ms ease, box-shadow 280ms ease;
        }
        .dc-contact-row:hover {
          transform: translateY(-2px);
          background: rgba(255,255,255,0.08) !important;
          border-color: rgba(223,255,79,0.28) !important;
          box-shadow: 0 10px 24px rgba(0,0,0,0.35);
        }

        .dc-media-zoom {
          transition: transform 500ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .dc-glass-hover:hover .dc-media-zoom {
          transform: scale(1.04);
        }

        .dc-input:focus {
          border-color: rgba(223,255,79,0.4) !important;
          box-shadow: 0 0 0 1px rgba(223,255,79,0.18), inset 0 1px 0 rgba(255,255,255,0.08) !important;
          background: rgba(255,255,255,0.08) !important;
        }

        .dc-profile-glow {
          animation: dcPulse 5.5s ease-in-out infinite;
        }
        @keyframes dcPulse {
          0%, 100% { box-shadow: 0 18px 40px rgba(0,0,0,0.5), 0 0 0 6px rgba(223,255,79,0.08), 0 0 36px rgba(223,255,79,0.18); }
          50% { box-shadow: 0 18px 40px rgba(0,0,0,0.5), 0 0 0 8px rgba(223,255,79,0.14), 0 0 52px rgba(223,255,79,0.28); }
        }

        @media (prefers-reduced-motion: reduce) {
          .dark-cinematic-root * {
            animation: none !important;
            transition: none !important;
          }
        }

        :is(h1, h2, h3, h4, h5, h6, p, span) {
          overflow-wrap: break-word;
          word-wrap: break-word;
          word-break: normal;
          text-wrap: wrap;
        }
      `}</CspStyle>

      <div
        className="dark-cinematic-root w-full h-auto flex items-center justify-center relative overflow-hidden"
        style={{
          background: `
            radial-gradient(ellipse 85% 55% at 50% 18%, rgba(40,70,48,0.45) 0%, transparent 58%),
            radial-gradient(ellipse 60% 40% at 85% 75%, rgba(223,255,79,0.05) 0%, transparent 50%),
            linear-gradient(180deg, ${BG} 0%, ${BG_OLIVE} 48%, ${BG} 100%)
          `,
        }}
      >
        <CinematicAtmosphere />

        <div className="w-full max-w-xl h-auto z-50 flex flex-col items-center relative px-5 py-14 sm:py-18 gap-8 sm:gap-10">
          {/* ══════════════ HERO ══════════════ */}
          <AnimatedSection delay={0} mini={mini} className="w-full">
            <div className="w-full flex flex-col items-center">
              {/* Lime blob profile header */}
              <div className="relative w-full mb-[-3.5rem] sm:mb-[-4rem] flex justify-center z-20">
                <div
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[14rem] h-[10rem] sm:w-[16rem] sm:h-[11rem] rounded-[40%] blur-2xl opacity-80"
                  aria-hidden="true"
                  style={{
                    background:
                      'radial-gradient(ellipse at center, rgba(223,255,79,0.35) 0%, rgba(197,230,58,0.12) 50%, transparent 72%)',
                  }}
                />
                <div
                  className="dc-profile-glow relative rounded-full p-[3px]"
                  style={{
                    background: `linear-gradient(145deg, ${LIME} 0%, ${LIME_DEEP} 50%, rgba(223,255,79,0.4) 100%)`,
                  }}
                >
                  <div className="rounded-full p-[3px]" style={{ background: BG }}>
                    {profileImage ? (
                      <img
                        src={profileImage}
                        alt={name}
                        className="block rounded-full object-cover object-center w-[7.5rem] h-[7.5rem] sm:w-36 sm:h-36"
                      />
                    ) : (
                      <div
                        className="flex items-center justify-center rounded-full w-[7.5rem] h-[7.5rem] sm:w-36 sm:h-36 text-3xl font-semibold"
                        style={{ background: LIME_SOFT, color: LIME }}
                      >
                        {initials}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <GlassCard
                className="w-full pt-[4.75rem] sm:pt-[5.25rem] pb-8 px-6 sm:px-8 text-center"
                glow
              >
                <h1
                  className="text-[2rem] sm:text-[2.5rem] leading-[1.1] font-semibold tracking-tight"
                  style={{ color: INK }}
                >
                  {name}
                </h1>
                {title && (
                  <p
                    className="mt-2.5 text-[15px] sm:text-base font-medium"
                    style={{ color: TEXT_SECONDARY }}
                  >
                    {title}
                  </p>
                )}
                {company && (
                  <p className="mt-1 text-sm font-medium" style={{ color: MUTED }}>
                    {company}
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-center gap-3 mt-7">
                  <button
                    type="button"
                    onClick={() => downloadVCard(d)}
                    className="dc-btn-primary inline-flex items-center gap-2.5 px-7 py-3.5 rounded-full border-none cursor-pointer font-semibold text-sm"
                    style={{
                      background: LIME,
                      color: '#0A0A0A',
                      boxShadow: '0 10px 28px rgba(223,255,79,0.32)',
                    }}
                  >
                    <LuIdCard size={17} />
                    Save Contact
                  </button>
                  <button
                    type="button"
                    onClick={handleShare}
                    className="dc-btn-ghost inline-flex items-center gap-2.5 px-7 py-3.5 rounded-full cursor-pointer font-semibold text-sm"
                    style={{
                      color: INK,
                      background: 'rgba(255,255,255,0.06)',
                      border: `1px solid ${GLASS_BORDER}`,
                      backdropFilter: 'blur(12px)',
                    }}
                  >
                    <LuShare2 size={17} /> Share
                  </button>
                </div>

                {sessionChecked && isAuthenticated ? (
                  <div className="mt-4 flex justify-center">
                    <PortfolioAssociateButton
                      urlAlias={d.bizCard.urlAlias}
                      className="dc-btn-ghost inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-full"
                      icon={<LuUserRoundPlus size={16} />}
                      label="Connect"
                    />
                  </div>
                ) : null}
                <PortfolioSocialProof
                  data={d}
                  mini={mini}
                  className="mt-6"
                  theme={{
                    surface: 'rgba(255,255,255,0.05)',
                    border: GLASS_BORDER,
                    text: INK,
                    muted: MUTED,
                    accent: LIME,
                    accentSoft: 'rgba(190,242,100,0.14)',
                    divider: 'rgba(255,255,255,0.1)',
                    shadow: '0 18px 40px rgba(0,0,0,0.35)',
                    radius: '24px',
                    backdropFilter: 'blur(16px)',
                  }}
                />
              </GlassCard>
            </div>
          </AnimatedSection>

          <LimeRule />

          {/* ══════════════ ABOUT ══════════════ */}
          {aboutText && (
            <AnimatedSection delay={50} mini={mini} className="w-full">
              <GlassCard hover className="w-full px-6 sm:px-7 py-7">
                <SectionLabel>About</SectionLabel>
                <h2 className="text-xl sm:text-[1.35rem] font-semibold mb-3" style={{ color: INK }}>
                  About me
                </h2>
                <p className="text-[15px] leading-relaxed" style={{ color: TEXT_SECONDARY }}>
                  <RichText html={aboutText} />
                </p>
              </GlassCard>
            </AnimatedSection>
          )}

          {/* ══════════════ SERVICES ══════════════ */}
          {servicesWithMedia.length > 0 && (
            <AnimatedSection delay={80} mini={mini} className="w-full">
              <div className="w-full flex flex-col gap-4">
                <div className="flex items-end justify-between gap-3 px-1">
                  <div>
                    <SectionLabel>Services</SectionLabel>
                    <h2 className="text-xl sm:text-[1.35rem] font-semibold" style={{ color: INK }}>
                      What I offer
                    </h2>
                  </div>
                  {!isMobile && totalServicePages > 1 && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label="Previous services"
                        className="dc-btn-ghost inline-flex items-center justify-center w-10 h-10 rounded-full disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{
                          color: LIME,
                          background: GLASS,
                          border: `1px solid ${GLASS_BORDER}`,
                        }}
                        onClick={handlePrevService}
                        disabled={servicePage === 0}
                      >
                        <LuChevronLeft size={16} />
                      </button>
                      <span className="text-sm tabular-nums font-medium" style={{ color: MUTED }}>
                        {servicePage + 1} / {totalServicePages}
                      </span>
                      <button
                        type="button"
                        aria-label="Next services"
                        className="dc-btn-ghost inline-flex items-center justify-center w-10 h-10 rounded-full disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{
                          color: LIME,
                          background: GLASS,
                          border: `1px solid ${GLASS_BORDER}`,
                        }}
                        onClick={handleNextService}
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
                  desktopClassName="grid grid-cols-1 sm:grid-cols-2 gap-4"
                >
                  {(isMobile && !mini ? servicesWithMedia : visibleServices).map((service, idx) => {
                    const mediaItems = buildServiceMediaItems(service, service.media ?? []);
                    return (
                      <GlassCard
                        key={idx}
                        hover
                        className="w-full overflow-hidden flex flex-col"
                      >
                        <div className="relative w-full overflow-hidden">
                          {mediaItems.length > 0 ? (
                            <div className="dc-media-zoom">
                              <ServiceMediaCarousel
                                items={mediaItems}
                                accent={LIME}
                                glass={GLASS}
                                textMuted={TEXT_SECONDARY}
                                mini={mini}
                                variant="hibiscus-dusk"
                              />
                            </div>
                          ) : service.featured_image ? (
                            <img
                              src={service.featured_image}
                              alt={service.title}
                              className="dc-media-zoom w-full h-full object-contain object-center"
                            />
                          ) : (
                            <div
                              className="w-full h-36 flex items-center justify-center text-2xl font-semibold"
                              style={{ background: LIME_SOFT, color: LIME }}
                            >
                              {service.title.charAt(0)}
                            </div>
                          )}
                        </div>
                        <div className="p-5">
                          <h3 className="text-base font-semibold" style={{ color: INK }}>
                            {service.title}
                          </h3>
                          {service.description && (
                            <p
                              className="text-sm mt-1.5 leading-relaxed"
                              style={{ color: TEXT_SECONDARY }}
                            >
                              <RichText html={service.description} />
                            </p>
                          )}
                        </div>
                      </GlassCard>
                    );
                  })}
                </ServicesScrollContainer>
              </div>
            </AnimatedSection>
          )}

          {/* ══════════════ GALLERY ══════════════ */}
          {isGalleryEnabled(d, mini) && galleryItems.length > 0 && (
            <AnimatedSection delay={110} mini={mini} className="w-full">
              <GlassCard className="w-full p-6 sm:p-7">
                <SectionLabel>Portfolio</SectionLabel>
                <h2 className="text-xl sm:text-[1.35rem] font-semibold mb-4" style={{ color: INK }}>
                  Gallery
                </h2>
                <GalleryCarousel
                  items={galleryItems}
                  accent={LIME}
                  glass={GLASS}
                  textMuted={TEXT_SECONDARY}
                  mini={mini}
                  variant="hibiscus-dusk"
                />
              </GlassCard>
            </AnimatedSection>
          )}

          {/* ══════════════ VIDEOS ══════════════ */}
          {isGalleryEnabled(d, mini) && videos.length > 0 && (
            <AnimatedSection delay={140} mini={mini} className="w-full">
              <GlassCard className="w-full p-6 sm:p-7">
                <SectionLabel>Projects</SectionLabel>
                <h2 className="text-xl sm:text-[1.35rem] font-semibold mb-4" style={{ color: INK }}>
                  Videos
                </h2>
                <VideoCarousel
                  items={videos}
                  accent={LIME}
                  glass={GLASS}
                  textMuted={TEXT_SECONDARY}
                  mini={mini}
                  variant="hibiscus-dusk"
                />
              </GlassCard>
            </AnimatedSection>
          )}

          {/* ══════════════ SOCIALS ══════════════ */}
          {socialLinks.length > 0 && (
            <AnimatedSection delay={160} mini={mini} className="w-full">
              <GlassCard className="w-full px-6 sm:px-7 py-6">
                <SectionLabel>Connect</SectionLabel>
                <h2 className="text-xl sm:text-[1.35rem] font-semibold mb-4" style={{ color: INK }}>
                  Social links
                </h2>
                <div className="flex flex-wrap justify-center gap-3">
                  {socialLinks.map((link) => (
                    <a
                      key={`social-${link.platform}-${link.url}`}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={getContactLinkAriaLabel(link)}
                      aria-label={getContactLinkAriaLabel(link)}
                      className="dc-social inline-flex h-12 w-12 items-center justify-center rounded-full"
                      style={{
                        color: LIME,
                        background: GLASS_SOFT,
                        border: `1px solid ${GLASS_BORDER}`,
                        boxShadow: `0 8px 18px rgba(0,0,0,0.3), 0 0 14px ${LIME_GLOW}`,
                      }}
                    >
                      <SocialIcon platform={link.platform} size={PORTFOLIO_SOCIAL_ICON_SIZE} />
                    </a>
                  ))}
                </div>
              </GlassCard>
            </AnimatedSection>
          )}

          {/* ══════════════ CONTACT ══════════════ */}
          {directContacts.length > 0 && (
            <AnimatedSection delay={180} mini={mini} className="w-full">
              <GlassCard className="w-full px-6 sm:px-7 py-6">
                <SectionLabel>Contact</SectionLabel>
                <h2 className="text-xl sm:text-[1.35rem] font-semibold mb-4" style={{ color: INK }}>
                  Get in touch
                </h2>
                <div className="flex flex-col gap-2.5">
                  {directContacts.map((link) => (
                    <a
                      key={`contact-${link.platform}-${link.url}`}
                      href={link.url}
                      target="_self"
                      rel="noopener noreferrer"
                      title={getContactLinkAriaLabel(link)}
                      aria-label={getContactLinkAriaLabel(link)}
                      className="dc-contact-row inline-flex items-center gap-3 px-4 py-3.5 rounded-[18px] text-sm font-medium"
                      style={{
                        color: INK,
                        background: GLASS_SOFT,
                        border: `1px solid ${GLASS_BORDER}`,
                      }}
                    >
                      <span
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                        style={{ color: '#0A0A0A', background: LIME }}
                      >
                        <SocialIcon platform={link.platform} size={PORTFOLIO_SOCIAL_ICON_SIZE} />
                      </span>
                      <ContactLinkLabel link={link} />
                    </a>
                  ))}
                </div>
              </GlassCard>
            </AnimatedSection>
          )}

          {/* ══════════════ LOCATION ══════════════ */}
          {hasPortfolioLocation(d.vcard) && (
            <AnimatedSection delay={200} mini={mini} className="w-full">
              <GlassCard className="w-full p-6 sm:p-7">
                <SectionLabel>Location</SectionLabel>
                <h2 className="text-xl sm:text-[1.35rem] font-semibold mb-4" style={{ color: INK }}>
                  Find me
                </h2>
                <PortfolioAddressSection
                  vcard={d.vcard}
                  mini={mini}
                  theme={{
                    cardBg: 'transparent',
                    text: INK,
                    textMuted: TEXT_SECONDARY,
                    accent: LIME,
                  }}
                />
              </GlassCard>
            </AnimatedSection>
          )}

          {/* ══════════════ INQUIRY ══════════════ */}
          {isInquiryEnabled(d, mini) && (
            <AnimatedSection delay={240} mini={mini} className="w-full">
              <GlassCard className="w-full p-6 sm:p-7">
                <SectionLabel>Inquiry</SectionLabel>
                <h2 className="text-xl sm:text-[1.35rem] font-semibold mb-5" style={{ color: INK }}>
                  Send a message
                </h2>
                <form className="flex flex-col gap-3" onSubmit={inquiryForm.handleSubmit}>
                  <input
                    type="text"
                    placeholder="Name"
                    className={inputClass}
                    style={inputStyle}
                    value={inquiryForm.fields.name}
                    onChange={(e) => inquiryForm.setField('name', e.target.value)}
                    required
                  />
                  <input
                    type="email"
                    placeholder="Email"
                    className={inputClass}
                    style={inputStyle}
                    value={inquiryForm.fields.email}
                    onChange={(e) => inquiryForm.setField('email', e.target.value)}
                    required
                  />
                  <input
                    type="text"
                    placeholder="Contact Number (optional)"
                    className={inputClass}
                    style={inputStyle}
                    value={inquiryForm.fields.phone}
                    onChange={(e) => inquiryForm.setField('phone', e.target.value)}
                  />
                  <input
                    type="text"
                    placeholder="Subject"
                    className={inputClass}
                    style={inputStyle}
                    value={inquiryForm.fields.subject}
                    onChange={(e) => inquiryForm.setField('subject', e.target.value)}
                  />
                  <textarea
                    placeholder="Message"
                    className={`${inputClass} resize-y min-h-[132px]`}
                    style={{ ...inputStyle, minHeight: 132, borderRadius: 18 }}
                    value={inquiryForm.fields.message}
                    onChange={(e) => inquiryForm.setField('message', e.target.value)}
                    required
                  />
                  {inquiryForm.fieldError && (
                    <p className="text-sm font-medium" style={{ color: DANGER }} role="alert">
                      {inquiryForm.fieldError}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={inquiryForm.isSubmitting}
                    className="dc-btn-primary w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full border-none cursor-pointer font-semibold text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                    style={{
                      background: LIME,
                      color: '#0A0A0A',
                      boxShadow: '0 10px 28px rgba(223,255,79,0.32)',
                    }}
                  >
                    {inquiryForm.isSubmitting ? 'Sending…' : 'Send Message'}
                  </button>
                </form>
              </GlassCard>
            </AnimatedSection>
          )}

          {/* ══════════════ FOOTER ══════════════ */}
          <div className="w-full flex flex-col items-center gap-3 pb-8 pt-2">
            <LimeRule />
            <span
              className="text-[11px] font-medium uppercase tracking-[0.2em]"
              style={{ color: MUTED }}
            >
              Powered by OnTap Creatives
            </span>
          </div>
        </div>
      </div>

      {showFAB && !mini && <FloatingContactWidget data={d} accent={LIME} qrUrl={qrUrl} />}
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
