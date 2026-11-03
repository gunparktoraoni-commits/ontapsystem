'use client';

import React, { useCallback, useRef, useState } from 'react';
import {
  LuIdCard,
  LuUserRoundPlus,
  LuShare2,
  LuChevronLeft,
  LuChevronRight,
  LuQrCode,
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
   DESIGN TOKENS — Frosted Crystal UI
   Dark Vision Pro glass (ref): midnight navy,
   translucent crystal panels, cyan luminous accent
───────────────────────────────────────────── */
const BG = '#070B18';
const INK = '#FFFFFF';
const TEXT_SECONDARY = 'rgba(255,255,255,0.62)';
const MUTED = 'rgba(255,255,255,0.40)';
const ACCENT = '#00D4FF';
const ACCENT_DEEP = '#3B82F6';
const ACCENT_SOFT = 'rgba(0,212,255,0.12)';
const GLASS = 'rgba(18, 28, 52, 0.52)';
const GLASS_SOFT = 'rgba(14, 22, 42, 0.38)';
const GLASS_BORDER = 'rgba(255,255,255,0.14)';
const DANGER = '#EF4444';
const SHADOW =
  '0 24px 56px rgba(0, 0, 0, 0.45), 0 8px 20px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -1px 0 rgba(0,0,0,0.25)';
const SHADOW_HOVER =
  '0 36px 72px rgba(0, 0, 0, 0.55), 0 14px 32px rgba(0, 212, 255, 0.16), inset 0 1px 0 rgba(255,255,255,0.28)';

type GlassTone = 'main' | 'secondary';

const GlassCard: React.FC<
  React.PropsWithChildren<{
    className?: string;
    hover?: boolean;
    tone?: GlassTone;
    style?: React.CSSProperties;
    tilt?: boolean;
  }>
> = ({
  children,
  className = '',
  hover = false,
  tone = 'main',
  style = {},
  tilt = false,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [tiltStyle, setTiltStyle] = useState<React.CSSProperties>({});

  const handleMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!tilt || !ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      const rotateY = (x - 0.5) * 10;
      const rotateX = (0.5 - y) * 8;
      setTiltStyle({
        transform: `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(6px)`,
        transition: 'transform 80ms ease-out',
      });
    },
    [tilt],
  );

  const handleLeave = useCallback(() => {
    if (!tilt) return;
    setTiltStyle({
      transform: 'perspective(900px) rotateX(0deg) rotateY(0deg) translateZ(0)',
      transition: 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1)',
    });
  }, [tilt]);

  return (
    <div
      ref={ref}
      className={`fc-glass-card rounded-[28px] relative ${hover ? 'fc-glass-hover' : ''} ${className}`}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      style={{
        background: tone === 'main' ? GLASS : GLASS_SOFT,
        backdropFilter: 'blur(28px) saturate(160%)',
        WebkitBackdropFilter: 'blur(28px) saturate(160%)',
        border: `1px solid ${GLASS_BORDER}`,
        boxShadow: SHADOW,
        transformStyle: 'preserve-3d',
        ...style,
        ...tiltStyle,
      }}
    >
      <div className="fc-shine pointer-events-none absolute inset-0 rounded-[28px] overflow-hidden" aria-hidden="true" />
      <div
        className="pointer-events-none absolute inset-0 rounded-[28px]"
        aria-hidden="true"
        style={{
          background:
            'linear-gradient(155deg, rgba(255,255,255,0.10) 0%, transparent 38%, transparent 62%, rgba(0,212,255,0.04) 100%)',
        }}
      />
      <div className="relative" style={{ transform: 'translateZ(12px)' }}>
        {children}
      </div>
    </div>
  );
};

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span
    className="inline-block text-[11px] font-semibold uppercase tracking-[0.22em] mb-2"
    style={{ color: ACCENT }}
  >
    {children}
  </span>
);

const SoftAtmosphere: React.FC = () => (
  <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
    <div
      className="absolute -top-[18%] left-[10%] h-[55vmax] w-[55vmax] rounded-full"
      style={{
        background: 'radial-gradient(circle, rgba(0,212,255,0.16) 0%, transparent 68%)',
        filter: 'blur(42px)',
      }}
    />
    <div
      className="absolute top-[36%] -right-[16%] h-[50vmax] w-[50vmax] rounded-full"
      style={{
        background: 'radial-gradient(circle, rgba(59,130,246,0.22) 0%, transparent 70%)',
        filter: 'blur(48px)',
      }}
    />
    <div
      className="absolute -bottom-[14%] left-[-10%] h-[42vmax] w-[42vmax] rounded-full"
      style={{
        background: 'radial-gradient(circle, rgba(14,165,233,0.12) 0%, transparent 72%)',
        filter: 'blur(44px)',
      }}
    />
  </div>
);

export default function FrostedCrystal({
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
    accent: ACCENT,
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
    'fc-input w-full px-4 py-3.5 rounded-[18px] font-sans text-sm outline-none transition-all duration-300 placeholder:text-white/35';
  const inputStyle: React.CSSProperties = {
    color: INK,
    background: 'rgba(255,255,255,0.06)',
    border: `1px solid ${GLASS_BORDER}`,
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12)',
    backdropFilter: 'blur(12px)',
  };

  return (
    <>
      <CspStyle>{`
        @import url('https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap');

        .frosted-crystal-root {
          font-family: 'Figtree', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          color: ${INK};
          -webkit-font-smoothing: antialiased;
          perspective: 1200px;
        }
        .frosted-crystal-root h1,
        .frosted-crystal-root h2,
        .frosted-crystal-root h3 {
          font-family: inherit;
          letter-spacing: -0.025em;
          font-weight: 600;
        }

        .fc-glass-card {
          transform-style: preserve-3d;
          will-change: transform;
        }

        .fc-shine::before {
          content: '';
          position: absolute;
          inset: -40% -60%;
          background: linear-gradient(
            115deg,
            transparent 35%,
            rgba(255,255,255,0.08) 45%,
            rgba(255,255,255,0.38) 50%,
            rgba(255,255,255,0.08) 55%,
            transparent 65%
          );
          transform: translateX(-40%) rotate(8deg);
          opacity: 0;
          transition: opacity 400ms ease, transform 900ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .fc-glass-card:hover .fc-shine::before {
          opacity: 1;
          transform: translateX(40%) rotate(8deg);
        }

        .fc-glass-hover:hover {
          box-shadow: ${SHADOW_HOVER} !important;
        }

        .fc-btn-primary {
          transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1),
            box-shadow 280ms ease, filter 280ms ease;
        }
        .fc-btn-primary:hover {
          transform: translateY(-2px) scale(1.02);
          box-shadow: 0 14px 30px rgba(0, 212, 255, 0.36);
          filter: brightness(1.05);
        }
        .fc-btn-primary:active {
          transform: scale(0.98);
        }

        .fc-btn-glass {
          transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1),
            background 280ms ease, box-shadow 280ms ease;
        }
        .fc-btn-glass:hover {
          transform: translateY(-2px) scale(1.02);
          background: rgba(255,255,255,0.12) !important;
          box-shadow: 0 12px 24px rgba(0, 0, 0, 0.32), 0 0 16px rgba(0,212,255,0.1);
        }
        .fc-btn-glass:active {
          transform: scale(0.98);
        }

        .fc-icon-tile {
          transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1),
            box-shadow 280ms ease, background 280ms ease;
        }
        .fc-icon-tile:hover {
          transform: translateY(-3px) scale(1.06);
          box-shadow: 0 12px 24px rgba(0, 212, 255, 0.22);
          background: rgba(255,255,255,0.14) !important;
        }

        .fc-input:focus {
          transform: translateY(-1px);
          box-shadow: 0 8px 20px rgba(0,212,255,0.12), inset 0 1px 0 rgba(255,255,255,0.16) !important;
          border-color: rgba(0,212,255,0.35) !important;
          background: rgba(255,255,255,0.1) !important;
        }

        @media (prefers-reduced-motion: reduce) {
          .frosted-crystal-root * {
            animation: none !important;
            transition: none !important;
          }
        }

        @media (hover: none) {
          .fc-glass-card {
            transform: none !important;
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
        className="frosted-crystal-root w-full h-auto flex items-center justify-center relative overflow-hidden"
        style={{
          background: `
            radial-gradient(ellipse 80% 55% at 78% 12%, rgba(0,212,255,0.14) 0%, transparent 55%),
            radial-gradient(ellipse 70% 50% at 12% 78%, rgba(59,130,246,0.18) 0%, transparent 58%),
            linear-gradient(165deg, #050814 0%, #070B18 42%, #0B1530 100%)
          `,
        }}
      >
        <SoftAtmosphere />

        <div className="w-full max-w-xl h-auto z-50 flex flex-col items-center relative px-5 py-12 sm:py-16 gap-8 sm:gap-10 [transform-style:preserve-3d]">
          {/* ══════════════ HERO ══════════════ */}
          <AnimatedSection delay={0} mini={mini} className="w-full">
            <div className="w-full flex flex-col items-center">
              <div className="relative z-20 mb-[-3.75rem] sm:mb-[-4.25rem]">
                <div
                  className="rounded-full p-[3px]"
                  style={{
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.22)',
                    boxShadow:
                      '0 18px 40px rgba(0,0,0,0.45), 0 0 0 8px rgba(0,212,255,0.08), 0 0 40px rgba(0,212,255,0.18)',
                    backdropFilter: 'blur(16px)',
                  }}
                >
                  {profileImage ? (
                    <img
                      src={profileImage}
                      alt={name}
                      className="block rounded-full object-cover object-center w-[7.5rem] h-[7.5rem] sm:w-36 sm:h-36"
                    />
                  ) : (
                    <div
                      className="flex items-center justify-center rounded-full w-[7.5rem] h-[7.5rem] sm:w-36 sm:h-36 text-3xl font-semibold"
                      style={{ background: ACCENT_SOFT, color: ACCENT }}
                    >
                      {initials}
                    </div>
                  )}
                </div>
              </div>

              <GlassCard
                className="w-full pt-[5rem] sm:pt-[5.5rem] pb-8 px-6 sm:px-8 text-center"
                tilt={false}
              >
                <h1
                  className="text-[2rem] sm:text-[2.5rem] leading-[1.12] font-semibold tracking-tight"
                  style={{ color: INK }}
                >
                  {name}
                </h1>
                {title && (
                  <p className="mt-2.5 text-[15px] sm:text-base font-medium" style={{ color: TEXT_SECONDARY }}>
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
                    className="fc-btn-primary inline-flex items-center gap-2.5 px-6 py-3.5 rounded-full border-none cursor-pointer font-semibold text-sm text-white"
                    style={{
                      background: `linear-gradient(120deg, ${ACCENT} 0%, ${ACCENT_DEEP} 100%)`,
                      boxShadow: '0 10px 28px rgba(0,212,255,0.32)',
                    }}
                  >
                    <LuIdCard size={17} />
                    Save Contact
                  </button>
                  <button
                    type="button"
                    onClick={handleShare}
                    className="fc-btn-glass inline-flex items-center gap-2.5 px-6 py-3.5 rounded-full cursor-pointer font-semibold text-sm"
                    style={{
                      color: INK,
                      background: 'rgba(255,255,255,0.06)',
                      border: `1px solid ${GLASS_BORDER}`,
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.16)',
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
                      className="fc-btn-glass inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-full"
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
                    surface: 'rgba(255,255,255,0.06)',
                    border: GLASS_BORDER,
                    text: INK,
                    muted: MUTED,
                    accent: ACCENT,
                    accentSoft: 'rgba(0,212,255,0.14)',
                    divider: 'rgba(255,255,255,0.12)',
                    shadow: 'inset 0 1px 0 rgba(255,255,255,0.16)',
                    radius: '24px',
                    backdropFilter: 'blur(16px)',
                  }}
                />
              </GlassCard>
            </div>
          </AnimatedSection>

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
                        className="fc-btn-glass inline-flex items-center justify-center w-10 h-10 rounded-full disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{
                          color: ACCENT,
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
                        className="fc-btn-glass inline-flex items-center justify-center w-10 h-10 rounded-full disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{
                          color: ACCENT,
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
                            <ServiceMediaCarousel
                              items={mediaItems}
                              accent={ACCENT}
                              glass={GLASS}
                              textMuted={TEXT_SECONDARY}
                              mini={mini}
                              variant="hibiscus-dusk"
                            />
                          ) : service.featured_image ? (
                            <img
                              src={service.featured_image}
                              alt={service.title}
                              className="w-full h-full object-contain object-center transition-transform duration-500 hover:scale-105"
                            />
                          ) : (
                            <div
                              className="w-full h-36 flex items-center justify-center text-2xl font-semibold"
                              style={{ background: ACCENT_SOFT, color: ACCENT }}
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
                            <p className="text-sm mt-1.5 leading-relaxed" style={{ color: TEXT_SECONDARY }}>
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
                  accent={ACCENT}
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
                  accent={ACCENT}
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
                      className="fc-icon-tile inline-flex h-12 w-12 items-center justify-center rounded-full"
                      style={{
                        color: ACCENT,
                        background: GLASS_SOFT,
                        border: `1px solid ${GLASS_BORDER}`,
                        boxShadow: '0 8px 18px rgba(0,0,0,0.28), 0 0 16px rgba(0,212,255,0.1)',
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
                      className="fc-btn-glass inline-flex items-center gap-3 px-4 py-3.5 rounded-[18px] text-sm font-medium"
                      style={{
                        color: INK,
                        background: GLASS_SOFT,
                        border: `1px solid ${GLASS_BORDER}`,
                      }}
                    >
                      <span
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                        style={{ color: ACCENT, background: ACCENT_SOFT }}
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
                    accent: ACCENT,
                  }}
                />
              </GlassCard>
            </AnimatedSection>
          )}

          {qrUrl && (
            <AnimatedSection delay={220} mini={mini} className="w-full">
              <GlassCard
                className="w-full px-6 sm:px-8 py-8 flex flex-col items-center text-center"
               
                style={{
                  boxShadow: `${SHADOW}, 0 0 48px rgba(0,212,255,0.12)`,
                }}
              >
                <SectionLabel>Share</SectionLabel>
                <h2 className="text-xl sm:text-[1.35rem] font-semibold mb-1" style={{ color: INK }}>
                  QR code
                </h2>
                <p className="text-sm mb-6" style={{ color: TEXT_SECONDARY }}>
                  Scan to open this portfolio
                </p>
                <div
                  className="rounded-[24px] p-4"
                  style={{
                    background: GLASS_SOFT,
                    border: `1px solid ${GLASS_BORDER}`,
                    boxShadow: '0 12px 32px rgba(0,0,0,0.35), 0 0 28px rgba(0,212,255,0.14)',
                  }}
                >
                  <img
                    src={qrDataUrl || qrUrl}
                    alt={`${name} portfolio QR code`}
                    className="block w-40 h-40 sm:w-44 sm:h-44 rounded-2xl"
                  />
                </div>
                <div
                  className="mt-5 inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em]"
                  style={{ color: MUTED }}
                >
                  <LuQrCode size={14} />
                  Frosted Crystal
                </div>
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
                    className="fc-btn-primary w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full border-none cursor-pointer font-semibold text-sm text-white disabled:opacity-60 disabled:cursor-not-allowed"
                    style={{
                      background: `linear-gradient(120deg, ${ACCENT} 0%, ${ACCENT_DEEP} 100%)`,
                      boxShadow: '0 10px 28px rgba(0,212,255,0.32)',
                    }}
                  >
                    {inquiryForm.isSubmitting ? 'Sending…' : 'Send Message'}
                  </button>
                </form>
              </GlassCard>
            </AnimatedSection>
          )}

          {/* ══════════════ FOOTER ══════════════ */}
          <div className="w-full flex flex-col items-center gap-2 pb-6 pt-2">
            <div
              className="h-px w-12 rounded-full"
              style={{ background: 'rgba(255,255,255,0.18)' }}
              aria-hidden="true"
            />
            <span
              className="text-[11px] font-medium uppercase tracking-[0.2em]"
              style={{ color: MUTED }}
            >
              Powered by OnTap Creatives
            </span>
          </div>
        </div>
      </div>

      {showFAB && !mini && <FloatingContactWidget data={d} accent={ACCENT} qrUrl={qrUrl} />}
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
