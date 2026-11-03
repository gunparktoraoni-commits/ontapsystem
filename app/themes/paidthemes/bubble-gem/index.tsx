'use client';

import React, { useState } from 'react';
import {
  LuIdCard,
  LuUserRoundPlus,
  LuShare2,
  LuChevronLeft,
  LuChevronRight,
  LuArrowUpRight,
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
   DESIGN TOKENS — "Bubble Gem Aura"
   Deep navy → indigo mesh, electric cyan accent,
   frosted glass bubbles, dual-type presence.
───────────────────────────────────────────── */
const VOID = '#060912';
const INK = '#FFFFFF';
const INK_MUTED = 'rgba(255,255,255,0.62)';
const CYAN = '#3B82F6';
const INDIGO = '#4F46E5';
const VIOLET = '#7C6AF2';
const PERI = '#A5B4FC';

const GlassCard: React.FC<
  React.PropsWithChildren<{
    className?: string;
    hover?: boolean;
    style?: React.CSSProperties;
  }>
> = ({ children, className = '', hover = false, style = {} }) => (
  <div
    className={`rounded-[28px] ${hover ? 'transition-all duration-500 ease-out hover:-translate-y-1.5 hover:shadow-[0_28px_70px_rgba(59,130,246,0.22)]' : ''} ${className}`}
    style={{
      background: 'rgba(255,255,255,0.07)',
      backdropFilter: 'blur(28px) saturate(160%)',
      WebkitBackdropFilter: 'blur(28px) saturate(160%)',
      border: '1px solid rgba(255,255,255,0.14)',
      boxShadow:
        '0 18px 50px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.18)',
      ...style,
    }}
  >
    {children}
  </div>
);

const BubbleDivider: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`flex items-center justify-center gap-3 ${className}`} aria-hidden="true">
    <span
      className="h-px w-10"
      style={{ background: `linear-gradient(90deg, transparent, ${PERI}66)` }}
    />
    <span
      className="h-2.5 w-2.5 rounded-full"
      style={{
        background: `radial-gradient(circle at 30% 30%, #fff, ${CYAN} 45%, ${INDIGO})`,
        boxShadow: `0 0 16px ${CYAN}88`,
      }}
    />
    <span
      className="h-px w-10"
      style={{ background: `linear-gradient(90deg, ${PERI}66, transparent)` }}
    />
  </div>
);

const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span
    className="font-sans text-[11px] font-semibold uppercase tracking-[0.32em]"
    style={{ color: PERI }}
  >
    {children}
  </span>
);

/** Soft luminous orbs — the BubbleGem signature atmosphere */
const MeshAtmosphere: React.FC = () => (
  <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
    <div
      className="absolute -top-[18%] -right-[12%] h-[58vmax] w-[58vmax] rounded-full opacity-90"
      style={{
        background:
          'radial-gradient(circle at 40% 40%, rgba(79,70,229,0.55) 0%, rgba(59,130,246,0.18) 42%, transparent 70%)',
        filter: 'blur(8px)',
        animation: 'orbDriftA 18s ease-in-out infinite',
      }}
    />
    <div
      className="absolute top-[28%] -left-[22%] h-[48vmax] w-[48vmax] rounded-full"
      style={{
        background:
          'radial-gradient(circle at 55% 45%, rgba(165,180,252,0.42) 0%, rgba(99,102,241,0.16) 48%, transparent 72%)',
        filter: 'blur(10px)',
        animation: 'orbDriftB 22s ease-in-out infinite',
      }}
    />
    <div
      className="absolute bottom-[-10%] right-[8%] h-[36vmax] w-[36vmax] rounded-full"
      style={{
        background:
          'radial-gradient(circle at 50% 40%, rgba(59,130,246,0.38) 0%, rgba(124,106,242,0.12) 50%, transparent 75%)',
        filter: 'blur(12px)',
        animation: 'orbDriftC 16s ease-in-out infinite',
      }}
    />
    {/* Specular bubble highlights */}
    {[
      { top: '12%', left: '18%', size: 88, delay: '0s' },
      { top: '42%', left: '72%', size: 54, delay: '1.4s' },
      { top: '68%', left: '28%', size: 72, delay: '2.6s' },
      { top: '22%', left: '58%', size: 36, delay: '0.8s' },
      { top: '78%', left: '64%', size: 44, delay: '3.2s' },
    ].map((bubble, i) => (
      <div
        key={`bubble-${i}`}
        className="absolute rounded-full"
        style={{
          top: bubble.top,
          left: bubble.left,
          width: bubble.size,
          height: bubble.size,
          background:
            'radial-gradient(circle at 32% 28%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.12) 28%, rgba(59,130,246,0.08) 55%, transparent 72%)',
          border: '1px solid rgba(255,255,255,0.16)',
          boxShadow: 'inset 0 0 24px rgba(255,255,255,0.08), 0 8px 28px rgba(0,0,0,0.18)',
          animation: `bubbleFloat ${9 + i * 1.6}s ease-in-out infinite`,
          animationDelay: bubble.delay,
        }}
      />
    ))}
  </div>
);

export default function BubbleGem({
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
    bg: VOID,
    surface: 'rgba(255,255,255,0.1)',
    text: '#ffffff',
    muted: 'rgba(255,255,255,0.6)',
    accent: CYAN,
    border: 'rgba(255,255,255,0.18)',
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
    'w-full px-4 py-3.5 rounded-full font-sans text-sm outline-none transition-all duration-300 placeholder:text-white/35 hover:bg-white/[0.1] focus:bg-white/[0.12] focus:-translate-y-0.5';
  const inputStyle: React.CSSProperties = {
    color: INK,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.16)',
  };

  return (
    <>
      <CspStyle>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Syne:wght@500;600;700;800&display=swap');

        .bubblegem-root {
          font-family: 'Syne', system-ui, sans-serif;
          color: ${INK};
        }
        .bubblegem-root h1,
        .bubblegem-root h2,
        .bubblegem-root h3 {
          font-family: 'Syne', system-ui, sans-serif;
          letter-spacing: -0.03em;
        }
        .bubblegem-serif {
          font-family: 'Instrument Serif', Georgia, serif;
          font-style: italic;
          font-weight: 400;
          letter-spacing: -0.01em;
        }

        @keyframes orbDriftA {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-4%, 5%) scale(1.06); }
        }
        @keyframes orbDriftB {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(5%, -4%) scale(1.05); }
        }
        @keyframes orbDriftC {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(-3%, -6%); }
        }
        @keyframes bubbleFloat {
          0%, 100% { transform: translateY(0) scale(1); opacity: 0.7; }
          50% { transform: translateY(-18px) scale(1.04); opacity: 1; }
        }
        @keyframes auraPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(59,130,246,0.45), 0 0 0 0 rgba(165,180,252,0.25); }
          50% { box-shadow: 0 0 0 14px rgba(59,130,246,0), 0 0 0 26px rgba(165,180,252,0); }
        }
        @keyframes heroReveal {
          from { opacity: 0; transform: translateY(18px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @media (prefers-reduced-motion: reduce) {
          .bubblegem-root * {
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
        className="bubblegem-root w-full h-auto flex items-center justify-center relative overflow-hidden"
        style={{
          background: `
            radial-gradient(ellipse 90% 70% at 85% 8%, rgba(79,70,229,0.55) 0%, transparent 55%),
            radial-gradient(ellipse 70% 60% at 10% 70%, rgba(59,130,246,0.35) 0%, transparent 58%),
            radial-gradient(ellipse 50% 40% at 50% 100%, rgba(165,180,252,0.22) 0%, transparent 60%),
            linear-gradient(165deg, #05070f 0%, #0b1224 38%, #151a3a 72%, #1e1b4b 100%)
          `,
        }}
      >
        <MeshAtmosphere />

        <div className="w-full max-w-xl h-auto z-50 flex flex-col items-center justify-center relative">
          {/* ══════════════ HERO ══════════════ */}
          <AnimatedSection delay={0} mini={mini}>
            <div className="w-full min-h-screen flex flex-col items-center justify-center z-50 relative px-5 py-16">
              <div
                className="w-full flex flex-col items-center text-center"
                style={{ animation: mini ? undefined : 'heroReveal 0.9s ease-out both' }}
              >
                {title && (
                  <span
                    className="mb-5 font-sans text-[11px] font-semibold uppercase tracking-[0.36em]"
                    style={{ color: PERI }}
                  >
                    Digital Profile
                  </span>
                )}

                <div className="relative">
                  <div
                    className="inline-block p-[2px] rounded-full"
                    style={{
                      background: `conic-gradient(from 200deg, ${CYAN}, ${INDIGO}, ${VIOLET}, ${PERI}, ${CYAN})`,
                      animation: 'auraPulse 3.6s ease-in-out infinite',
                    }}
                  >
                    <div
                      className="p-[3px] rounded-full"
                      style={{ background: 'rgba(6,9,18,0.92)' }}
                    >
                      {profileImage ? (
                        <img
                          src={profileImage}
                          alt={name}
                          className="block rounded-full object-cover object-center w-32 h-32 sm:w-36 sm:h-36 transition-transform duration-500 hover:scale-105"
                        />
                      ) : (
                        <div
                          className="flex items-center justify-center rounded-full w-32 h-32 sm:w-36 sm:h-36 text-3xl font-bold"
                          style={{
                            background: `linear-gradient(145deg, rgba(59,130,246,0.35), rgba(79,70,229,0.2))`,
                            color: INK,
                          }}
                        >
                          {initials}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <h1
                  className="text-[2.55rem] sm:text-[3.15rem] leading-[1.05] font-extrabold mt-7 text-center"
                  style={{ color: INK }}
                >
                  {name.split(' ').length > 1 ? (
                    <>
                      {name.split(' ').slice(0, -1).join(' ')}{' '}
                      <span className="bubblegem-serif text-[1.08em]" style={{ color: PERI }}>
                        {name.split(' ').slice(-1)}
                      </span>
                    </>
                  ) : (
                    name
                  )}
                </h1>
                {title && (
                  <p className="mt-3 max-w-sm text-[15px] leading-relaxed font-medium" style={{ color: INK_MUTED }}>
                    {title}
                  </p>
                )}
                
                <BubbleDivider className="mt-6" />
                <div className="flex flex-wrap items-center justify-center gap-3 mt-8 mb-10">
                  <button
                    type="button"
                    onClick={() => downloadVCard(d)}
                    className="group inline-flex items-center gap-2.5 px-7 py-3.5 rounded-full border-none cursor-pointer font-sans font-semibold text-sm text-white transition-all duration-300 hover:-translate-y-0.5 active:scale-95"
                    style={{
                      background: `linear-gradient(120deg, ${CYAN} 0%, ${INDIGO} 55%, ${VIOLET} 100%)`,
                      boxShadow: `0 14px 36px rgba(59,130,246,0.38)`,
                    }}
                  >
                    <LuIdCard size={17} className="transition-transform duration-300 group-hover:scale-110" />
                    Save Contact
                  </button>
                  <button
                    type="button"
                    onClick={handleShare}
                    className="inline-flex items-center gap-2.5 px-7 py-3.5 rounded-full cursor-pointer font-sans font-semibold text-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/10 active:scale-95"
                    style={{
                      color: INK,
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.35)',
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12)',
                    }}
                  >
                    <LuShare2 size={17} /> Share
                    <LuArrowUpRight size={15} className="opacity-70" />
                  </button>
                </div>
                <PortfolioSocialProof
                  data={d}
                  mini={mini}
                  className="mt-6"
                  theme={{
                    surface: 'rgba(255,255,255,0.07)',
                    border: 'rgba(255,255,255,0.14)',
                    text: INK,
                    muted: INK_MUTED,
                    accent: PERI,
                    accentSoft: 'rgba(59,130,246,0.18)',
                    divider: 'rgba(255,255,255,0.12)',
                    shadow: '0 18px 50px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.18)',
                    radius: '28px',
                    backdropFilter: 'blur(28px) saturate(160%)',
                  }}
                />

                {(contactLinks.some((link) => link.kind === 'social') ||
                  contactLinks.some((link) => link.kind === 'contact')) && (
                  <AnimatedSection delay={50} mini={mini}>
                    <div className="w-full flex flex-col gap-3.5">
                      {contactLinks.some((link) => link.kind === 'social') && (
                        <GlassCard className="w-full p-5 flex flex-col gap-3.5">
                          <Eyebrow>Socials</Eyebrow>
                          <div className="flex flex-wrap justify-center gap-2.5">
                            {contactLinks
                              .filter((link) => link.kind === 'social')
                              .map((link) => (
                                <a
                                  key={`social-${link.platform}-${link.url}`}
                                  href={link.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={getContactLinkAriaLabel(link)}
                                  aria-label={getContactLinkAriaLabel(link)}
                                  className="inline-flex h-12 w-12 items-center justify-center rounded-full transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(59,130,246,0.35)]"
                                  style={{
                                    color: INK,
                                    background: 'rgba(255,255,255,0.06)',
                                    border: '1px solid rgba(255,255,255,0.2)',
                                  }}
                                >
                                  <SocialIcon platform={link.platform} size={PORTFOLIO_SOCIAL_ICON_SIZE} />
                                </a>
                              ))}
                          </div>
                        </GlassCard>
                      )}

                      {contactLinks.some((link) => link.kind === 'contact') && (
                        <GlassCard className="w-full p-5 flex flex-col gap-3.5">
                          <Eyebrow>Contact</Eyebrow>
                          <div className="flex flex-wrap gap-2.5 justify-center">
                            {sessionChecked && isAuthenticated ? (
                              <PortfolioAssociateButton
                                urlAlias={d.bizCard.urlAlias}
                                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-sans transition-all duration-300 rounded-full hover:-translate-y-0.5"
                                icon={<LuUserRoundPlus size={16} />}
                                label="Connect"
                              />
                            ) : null}
                            {contactLinks
                              .filter((link) => link.kind === 'contact')
                              .map((link) => (
                                <a
                                  key={`contact-${link.platform}-${link.url}`}
                                  href={link.url}
                                  target="_self"
                                  rel="noopener noreferrer"
                                  title={getContactLinkAriaLabel(link)}
                                  aria-label={getContactLinkAriaLabel(link)}
                                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full font-sans text-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/10"
                                  style={{
                                    color: INK,
                                    background: 'rgba(255,255,255,0.06)',
                                    border: '1px solid rgba(255,255,255,0.18)',
                                  }}
                                >
                                  <SocialIcon platform={link.platform} size={PORTFOLIO_SOCIAL_ICON_SIZE} />
                                  <ContactLinkLabel link={link} />
                                </a>
                              ))}
                          </div>
                        </GlassCard>
                      )}
                    </div>
                  </AnimatedSection>
                )}
              </div>
            </div>
          </AnimatedSection>
          {/* ══════════════ CONTENT ══════════════ */}
          <div className="w-full h-auto flex flex-col items-center px-5 py-14 gap-12">
            {aboutText && (
              <AnimatedSection delay={50} mini={mini}>
                <GlassCard hover className="w-full overflow-hidden">
                  <div className="px-7 py-7">
                    <Eyebrow>About</Eyebrow>
                    <h2 className="text-2xl sm:text-[1.75rem] font-bold mt-2 mb-3" style={{ color: INK }}>
                      A little{' '}
                      <span className="bubblegem-serif" style={{ color: PERI }}>
                        about me
                      </span>
                    </h2>
                    <p className="font-sans text-[15px] leading-relaxed" style={{ color: INK_MUTED }}>
                      <RichText html={aboutText} />
                    </p>
                  </div>
                </GlassCard>
              </AnimatedSection>
            )}
            {servicesWithMedia.length > 0 && (
              <AnimatedSection delay={100} mini={mini}>
                <div className="w-full flex flex-col items-center z-50">
                  <div className="flex items-end justify-between w-full mb-5 gap-3">
                    <div>
                      <Eyebrow>What I offer</Eyebrow>
                      <h2 className="text-2xl sm:text-[1.75rem] font-bold mt-2" style={{ color: INK }}>
                        Services &amp;{' '}
                        <span className="bubblegem-serif" style={{ color: PERI }}>
                          Products
                        </span>
                      </h2>
                    </div>
                    {!isMobile && totalServicePages > 1 && (
                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          aria-label="Previous services"
                          className="inline-flex items-center justify-center w-9 h-9 rounded-full transition-all duration-300 hover:-translate-y-0.5 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{
                            color: INK,
                            background: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.2)',
                          }}
                          onClick={handlePrevService}
                          disabled={servicePage === 0}
                        >
                          <LuChevronLeft size={16} />
                        </button>
                        <span className="font-sans text-sm font-medium tabular-nums" style={{ color: INK_MUTED }}>
                          {servicePage + 1} / {totalServicePages}
                        </span>
                        <button
                          type="button"
                          aria-label="Next services"
                          className="inline-flex items-center justify-center w-9 h-9 rounded-full transition-all duration-300 hover:-translate-y-0.5 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{
                            color: INK,
                            background: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.2)',
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
                    desktopClassName="grid grid-cols-1 sm:grid-cols-2 gap-5 w-full"
                  >
                    {(isMobile && !mini ? servicesWithMedia : visibleServices).map((service, idx) => {
                      const mediaItems = buildServiceMediaItems(service, service.media ?? []);
                      return (
                        <GlassCard key={idx} hover className="w-full overflow-hidden flex flex-col">
                          <div className="relative w-full overflow-hidden">
                            {mediaItems.length > 0 ? (
                              <ServiceMediaCarousel
                                items={mediaItems}
                                accent={CYAN}
                                glass="rgba(255,255,255,0.12)"
                                textMuted={INK_MUTED}
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
                              <div
                                className="w-full h-40 flex items-center justify-center text-3xl font-bold"
                                style={{
                                  background: `linear-gradient(145deg, rgba(59,130,246,0.25), rgba(79,70,229,0.15))`,
                                  color: PERI,
                                }}
                              >
                                {service.title.charAt(0)}
                              </div>
                            )}
                          </div>
                          <div className="p-5">
                            <h3 className="text-lg font-bold" style={{ color: INK }}>
                              {service.title}
                            </h3>
                            <p className="text-sm mt-1.5 font-sans leading-relaxed" style={{ color: INK_MUTED }}>
                              <RichText html={service.description} />
                            </p>
                          </div>
                        </GlassCard>
                      );
                    })}
                  </ServicesScrollContainer>
                </div>
              </AnimatedSection>
            )}

            {isGalleryEnabled(d, mini) && galleryItems.length > 0 && (
              <AnimatedSection delay={150} mini={mini}>
                <GlassCard className="w-full p-6">
                  <Eyebrow>Portfolio</Eyebrow>
                  <h2 className="text-2xl font-bold mb-4 mt-2" style={{ color: INK }}>
                    <span className="bubblegem-serif" style={{ color: PERI }}>
                      Gallery
                    </span>
                  </h2>
                  <GalleryCarousel
                    items={galleryItems}
                    accent={CYAN}
                    glass="rgba(255,255,255,0.12)"
                    textMuted={INK_MUTED}
                    mini={mini}
                    variant="hibiscus-dusk"
                  />
                </GlassCard>
              </AnimatedSection>
            )}

            {isGalleryEnabled(d, mini) && videos.length > 0 && (
              <AnimatedSection delay={200} mini={mini}>
                <GlassCard className="w-full p-6">
                  <Eyebrow>Watch</Eyebrow>
                  <h2 className="text-2xl font-bold mb-4 mt-2" style={{ color: INK }}>
                    <span className="bubblegem-serif" style={{ color: PERI }}>
                      Videos
                    </span>
                  </h2>
                  <VideoCarousel
                    items={videos}
                    accent={CYAN}
                    glass="rgba(255,255,255,0.12)"
                    textMuted={INK_MUTED}
                    mini={mini}
                    variant="hibiscus-dusk"
                  />
                </GlassCard>
              </AnimatedSection>
            )}

            {hasPortfolioLocation(d.vcard) && (
              <AnimatedSection delay={250} mini={mini}>
                <GlassCard className="w-full p-6">
                  <Eyebrow>Find me</Eyebrow>
                  <h2 className="text-2xl font-bold mb-4 mt-2" style={{ color: INK }}>
                    Office{' '}
                    <span className="bubblegem-serif" style={{ color: PERI }}>
                      Location
                    </span>
                  </h2>
                  <PortfolioAddressSection
                    vcard={d.vcard}
                    mini={mini}
                    theme={{
                      cardBg: 'transparent',
                      text: INK,
                      textMuted: INK_MUTED,
                      accent: CYAN,
                    }}
                  />
                </GlassCard>
              </AnimatedSection>
            )}

            {isInquiryEnabled(d, mini) && (
              <AnimatedSection delay={300} mini={mini} className="w-full">
                <GlassCard className="w-full p-6 sm:p-7">
                  <Eyebrow>Let&apos;s talk</Eyebrow>
                  <h2 className="text-2xl font-bold mb-5 mt-2" style={{ color: INK }}>
                    Send an{' '}
                    <span className="bubblegem-serif" style={{ color: PERI }}>
                      Inquiry
                    </span>
                  </h2>
                  <form className="flex flex-col gap-3.5" onSubmit={inquiryForm.handleSubmit}>
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
                      className="w-full px-4 py-3.5 rounded-[22px] font-sans text-sm outline-none transition-all duration-300 placeholder:text-white/35 hover:bg-white/[0.1] focus:bg-white/[0.12] resize-y min-h-[140px]"
                      style={{ ...inputStyle, minHeight: '140px', borderRadius: 22 }}
                      value={inquiryForm.fields.message}
                      onChange={(e) => inquiryForm.setField('message', e.target.value)}
                      required
                    />
                    {inquiryForm.fieldError && (
                      <p className="text-sm font-sans" style={{ color: '#F9A8D4' }} role="alert">
                        {inquiryForm.fieldError}
                      </p>
                    )}
                    <button
                      type="submit"
                      disabled={inquiryForm.isSubmitting}
                      className="w-full inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-full border-none cursor-pointer font-sans font-semibold text-sm text-white transition-all duration-300 hover:-translate-y-0.5 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
                      style={{
                        background: `linear-gradient(120deg, ${CYAN}, ${INDIGO})`,
                        boxShadow: '0 14px 36px rgba(59,130,246,0.35)',
                      }}
                    >
                      {inquiryForm.isSubmitting ? 'Sending…' : 'Send Message'}
                    </button>
                  </form>
                </GlassCard>
              </AnimatedSection>
            )}
          </div>

          <div className="w-full flex flex-col items-center gap-3 mt-2 mb-10 z-50">
            <BubbleDivider />
            <span
              className="font-sans text-[11px] font-medium uppercase tracking-[0.28em]"
              style={{ color: 'rgba(255,255,255,0.38)' }}
            >
              Powered by OnTap Creatives
            </span>
          </div>
        </div>
      </div>

      {showFAB && !mini && <FloatingContactWidget data={d} accent={CYAN} qrUrl={qrUrl} />}
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
