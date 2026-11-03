"use client";

/*
 * Luxurious Editorial — shared presentation shell.
 *
 * All three registered variants (classic-gold, ocean-blue-gold, violet-pink)
 * render through this single shell so layout, animation and accessibility
 * behaviour stay identical while each variant supplies its own palette.
 *
 * Depth is created with framer-motion scroll parallax (cover drift, floating
 * light orbs, hero rise) plus in-view staggered reveals. All motion is
 * transform/opacity only (GPU friendly) and is fully disabled for reduced-motion
 * users and for the compact editor preview (`mini`).
 */

import React, { useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import {
  motion,
  useScroll,
  useTransform,
  useReducedMotion,
  type MotionValue,
} from "framer-motion";
import {
  type PortfolioViewProps,
  getCoverImageOrNull,
  PortfolioCoverMedia,
  getDisplayName,
  getProfileImageOrNull,
  isGalleryEnabled,
  isInquiryEnabled,
  usePortfolioInquiryForm,
  PortfolioAddressSection,
  hasPortfolioLocation,
  PortfolioAssociateButton,
  resolvePortfolioData,
  FloatingContactWidget,
  downloadVCard,
  buildContactLinks,
  SocialIcon,
  PORTFOLIO_SOCIAL_ICON_SIZE,
  GalleryCarousel,
  VideoCarousel,
  ServiceMediaCarousel,
  ServicesScrollContainer,
  buildServiceMediaItems,
  buildVideoItems,
  buildGalleryItems,
  usePortfolioViewerSession,
  ContactLinkLabel,
  getContactLinkAriaLabel,
} from "../../shared";
import PortfolioSocialProof from "../../components/PortfolioSocialProof";
import {
  useQRCardDownload,
  QRCardExportSurface,
  toQRCardStyle,
} from "../../QRCardDownload";
import CspStyle from "@/app/components/CspStyle";
import { RichText } from "@/app/components/RichText";
import {
  PiArrowRightThin,
  PiArrowLeftThin,
  PiBriefcaseThin,
  PiChatTextThin,
  PiDownloadSimpleThin,
  PiInfoThin,
  PiMailboxThin,
  PiMapTrifoldThin,
  PiPanoramaThin,
  PiPlugsConnectedThin,
  PiShareNetworkThin,
} from "react-icons/pi";

/* ─────────────────────────────────────────
   PALETTE CONTRACT
───────────────────────────────────────── */
export interface LuxePalette {
  /** Carousel/style variant key, kept identical to the theme id. */
  variant: string;
  /** Page canvas colour (behind everything). */
  pageBg: string;
  /** Translucent editorial backdrop the content sits on. */
  sectionBg: string;
  /** Primary text colour used on the dark content backdrop. */
  ink: string;
  /** Muted/secondary text colour. */
  inkMuted: string;
  /** Hairline / divider colour (usually a translucent light tone). */
  line: string;
  /** Primary accent. */
  accent: string;
  /** Secondary accent. */
  accentAlt: string;
  /** Metallic highlight. */
  gold: string;
  /** Two rgba() colours for the floating parallax light orbs. */
  glowA: string;
  glowB: string;
  /** CSS gradient used when the user has no cover media. */
  heroFallback: string;
  /** CSS gradient scrim layered over the cover for legibility. */
  heroOverlay: string;
  /** Text colour used on solid accent surfaces (e.g. submit button). */
  onAccent: string;
  /** Scrollbar tones. */
  scrollbarTrack: string;
  scrollbarThumb: string;
  scrollbarThumbHover: string;
  /** Selection tones. */
  selectionBg: string;
  selectionText: string;
}

const GALLERY_PER_BATCH = 5;
const SERVICES_PER_PAGE = 3;

/* ─────────────────────────────────────────
   MOTION PRIMITIVES
───────────────────────────────────────── */
const EASE = [0.22, 1, 0.3, 1] as const;

function Reveal({
  children,
  className,
  delay = 0,
  y = 30,
  disabled,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  disabled: boolean;
}) {
  if (disabled) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.7, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

function SectionHeading({
  index,
  title,
  icon,
  palette,
  right,
}: {
  index: string;
  title: string;
  icon: ReactNode;
  palette: LuxePalette;
  right?: ReactNode;
}) {
  return (
    <div className="flex w-full items-center gap-3 md:gap-4" style={{ color: palette.ink }}>
      <span
        className="flex h-11 w-11 shrink-0 items-center justify-center text-2xl md:h-12 md:w-12"
        style={{ border: `1px solid ${palette.line}`, color: palette.gold }}
      >
        {icon}
      </span>
      <span
        className="shrink-0 font-mono text-[11px] tracking-[0.3em] tabular-nums"
        style={{ color: palette.gold }}
      >
        {index}
      </span>
      <h2 className="shrink-0 whitespace-nowrap text-xl font-light tracking-wide md:text-2xl">
        {title}
      </h2>
      <span className="h-px min-w-0 flex-1" style={{ background: palette.line }} />
      {right}
    </div>
  );
}

/* ─────────────────────────────────────────
   SHELL
───────────────────────────────────────── */
export default function LuxuriousEditorialShell({
  palette,
  data,
  mini = false,
  showFAB = false,
  isMobile = false,
}: { palette: LuxePalette } & PortfolioViewProps) {
  const d = resolvePortfolioData(data);
  const inquiryForm = usePortfolioInquiryForm({
    urlAlias: d.bizCard.urlAlias,
    mini,
  });
  const { isAuthenticated } = usePortfolioViewerSession();

  const name = getDisplayName(d);
  const title = d.vcard.professionalTitle || d.bizCard.occupation;
  const aboutText = String(
    (d.vcard as any).aboutText ??
      (d.vcard as any).about ??
      (d.vcard as any).aboutMe ??
      (d.vcard as any).bio ??
      "",
  ).trim();
  const coverImage = getCoverImageOrNull(d);
  const profileImage = getProfileImageOrNull(d);

  const galleryItems = buildGalleryItems(d);
  const videos = buildVideoItems(d);
  const contactLinks = buildContactLinks(d);

  const servicesWithMedia = (d.services ?? [])
    .map((s) => ({
      title: String(s.title ?? (s as any).name ?? "").trim(),
      description: String(s.description ?? (s as any).tagline ?? "").trim(),
      featured_image: String((s as any).featured_image ?? (s as any).image ?? "").trim(),
      media: (s as any).media || [],
    }))
    .filter((s) => s.title);

  const [servicePage, setServicePage] = useState(0);
  const totalServicePages = Math.ceil(servicesWithMedia.length / SERVICES_PER_PAGE);
  const visibleServices = servicesWithMedia.slice(
    servicePage * SERVICES_PER_PAGE,
    (servicePage + 1) * SERVICES_PER_PAGE,
  );
  const handlePrevService = () => setServicePage((p) => Math.max(0, p - 1));
  const handleNextService = () =>
    setServicePage((p) => Math.min(totalServicePages - 1, p + 1));

  const [galleryPage, setGalleryPage] = useState(0);
  const totalGalleryPages = Math.ceil(galleryItems.length / GALLERY_PER_BATCH);
  const visibleGalleryItems = galleryItems.slice(
    galleryPage * GALLERY_PER_BATCH,
    (galleryPage + 1) * GALLERY_PER_BATCH,
  );
  const handlePrevGallery = () => setGalleryPage((p) => Math.max(0, p - 1));
  const handleNextGallery = () =>
    setGalleryPage((p) => Math.min(totalGalleryPages - 1, p + 1));

  const shareUrl =
    typeof window !== "undefined" && d.bizCard.urlAlias
      ? `${window.location.origin}/${d.bizCard.urlAlias}`
      : "";
  const qrUrl = shareUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=280x280&ecc=H&data=${encodeURIComponent(shareUrl)}`
    : "";

  const [copied, setCopied] = useState(false);
  const handleShare = async () => {
    if (typeof window === "undefined") return;
    const url = shareUrl || `${window.location.origin}/${d.bizCard.urlAlias}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: name, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* user cancelled share or clipboard blocked — no-op */
    }
  };

  const { cardRef, qrDataUrl } = useQRCardDownload(d, shareUrl);
  const qrCardStyle = toQRCardStyle({
    cardBg: palette.pageBg,
    text: palette.sectionBg,
    muted: palette.inkMuted,
    accent: palette.accent,
    accentAlt: palette.gold,
    border: palette.gold,
    headerGrad: `linear-gradient(135deg, ${palette.accent}, ${palette.gold}, ${palette.accent})`,
  });

  /* ── Parallax wiring ── */
  const reduced = useReducedMotion();
  const parallax = !mini && !reduced;
  const rootRef = useRef<HTMLDivElement>(null);
  const { scrollY, scrollYProgress } = useScroll();

  const coverY = useTransform(scrollY, [0, 1200], [0, 240]);
  const coverScale = useTransform(scrollY, [0, 600], [1, 1.12]);
  const orbAY = useTransform(scrollY, [0, 1000], [0, -260]);
  const orbBY = useTransform(scrollY, [0, 1000], [0, 200]);
  const heroTextY = useTransform(scrollY, [0, 500], [0, -60]);
  const heroTextOpacity = useTransform(scrollY, [0, 360], [1, 0]);
  const profileY = useTransform(scrollY, [0, 500], [0, 48]);

  const bind = (mv: MotionValue<number>) => (parallax ? mv : undefined);

  const sectionWrap =
    "w-full flex flex-col items-center justify-center z-10 relative gap-5 md:gap-7 p-5 sm:p-7 md:p-10 lg:px-12 lg:py-14";
  const pagerBtn =
    "flex h-10 w-10 items-center justify-center rounded-full text-2xl transition-all duration-300 hover:scale-110 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed";

  return (
    <>
      <CspStyle
        dangerouslySetInnerHTML={{
          __html: `
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,400;1,500&family=Outfit:wght@200;300;400;500&display=swap');

        .lux-cormorant { font-family: 'Cormorant Garamond', serif; }
        .lux-outfit { font-family: 'Outfit', sans-serif; }
        .lux-noise { background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.035'/%3E%3C/svg%3E"); }

        .lux-root ::-webkit-scrollbar { width: 6px; }
        .lux-root ::-webkit-scrollbar-track { background: ${palette.scrollbarTrack}; }
        .lux-root ::-webkit-scrollbar-thumb { background: ${palette.scrollbarThumb}; }
        .lux-root ::-webkit-scrollbar-thumb:hover { background: ${palette.scrollbarThumbHover}; }

        .lux-root ::selection { background: ${palette.selectionBg}; color: ${palette.selectionText}; }

        .lux-input { transition: border-color .3s ease, box-shadow .3s ease, background-color .3s ease; }
        .lux-input:focus { border-color: ${palette.accent}; box-shadow: 0 0 0 1px ${palette.accent}55, 0 0 18px ${palette.accent}22; }

        :is(h1,h2,h3,h4,h5,h6,p,span) { overflow-wrap: break-word; word-wrap: break-word; word-break: normal; text-wrap: wrap; }
      `,
        }}
      />

      {/* Scroll progress bar */}
      {parallax && (
        <motion.div
          aria-hidden
          className="fixed left-0 top-0 z-[60] h-[3px] w-full origin-left"
          style={{
            scaleX: scrollYProgress,
            background: `linear-gradient(90deg, ${palette.accent}, ${palette.gold}, ${palette.accentAlt})`,
          }}
        />
      )}

      <div
        ref={rootRef}
        className="lux-root lux-outfit lux-noise relative flex min-h-screen w-full flex-col items-center overflow-x-clip font-light"
        style={{ background: palette.pageBg, color: palette.ink }}
      >
        {/* Fixed parallax cover */}
        <motion.div
          aria-hidden
          className="fixed inset-0 z-0 h-full w-full"
          style={bind(coverY) ? { y: coverY, scale: coverScale } : undefined}
        >
          {coverImage ? (
            <PortfolioCoverMedia
              src={coverImage}
              coverType={d.bizCard.coverType}
              alt="cover photo"
              className="h-full w-full object-cover object-center"
            />
          ) : (
            <div className="h-full w-full" style={{ background: palette.heroFallback }} />
          )}
          <div className="absolute inset-0" style={{ background: palette.heroOverlay }} />
        </motion.div>

        {/* Floating parallax light orbs */}
        <motion.div
          aria-hidden
          className="pointer-events-none fixed -left-24 top-[10%] z-0 h-72 w-72 rounded-full blur-3xl md:h-96 md:w-96"
          style={{ background: palette.glowA, ...(bind(orbAY) ? { y: orbAY } : {}) }}
        />
        <motion.div
          aria-hidden
          className="pointer-events-none fixed -right-24 top-[45%] z-0 h-72 w-72 rounded-full blur-3xl md:h-[28rem] md:w-[28rem]"
          style={{ background: palette.glowB, ...(bind(orbBY) ? { y: orbBY } : {}) }}
        />

        {/* ══════════ HERO ══════════ */}
        <div className="relative z-10 flex min-h-[100svh] w-full flex-col items-center justify-end overflow-x-hidden">
          <motion.span
            className="absolute left-1/2 top-0 z-20 mt-16 flex w-full max-w-full -translate-x-1/2 flex-col items-center justify-center px-4 text-center text-white sm:mt-20 md:mt-24 lg:mt-28"
            style={bind(heroTextY) ? { y: heroTextY, opacity: heroTextOpacity } : undefined}
          >
            <motion.span
              className="mb-3 h-px w-16"
              style={{ background: palette.gold }}
              initial={parallax ? { scaleX: 0 } : false}
              animate={parallax ? { scaleX: 1 } : undefined}
              transition={{ duration: 0.9, ease: EASE, delay: 0.15 }}
            />
            <h1 className="lux-cormorant break-words text-4xl font-light tracking-wide sm:text-5xl md:text-6xl lg:text-7xl">
              {name}
            </h1>
            {title && (
              <p className="mt-2 break-words text-xs font-medium uppercase tracking-[0.35em] text-white/80 md:text-sm">
                {title}
              </p>
            )}
          </motion.span>

          <motion.div
            className="relative z-10 mt-auto flex w-full max-w-full flex-1 items-end justify-center px-3 pb-2 pt-24 sm:px-6 sm:pt-28"
            style={bind(profileY) ? { y: profileY } : undefined}
            initial={parallax ? { opacity: 0, scale: 0.94 } : false}
            animate={parallax ? { opacity: 1, scale: 1 } : undefined}
            transition={{ duration: 0.9, ease: EASE }}
          >
            <Image
              height={960}
              width={960}
              alt="profile image"
              src={profileImage || "/man1.png"}
              className={`h-auto max-h-[min(58svh,560px)] w-auto max-w-[min(92vw,420px)] object-contain object-bottom drop-shadow-2xl ${
                profileImage ? "" : "brightness-0"
              }`}
              draggable={false}
              sizes="(max-width: 768px) 92vw, 420px"
              priority
            />
          </motion.div>

          {/* Hero actions */}
          <div className="relative z-20 mb-5 mt-2 flex h-auto min-h-[8vh] w-full max-w-full items-center justify-center px-3 md:mb-8 lg:mb-10">
            <span
              className="flex w-full max-w-md flex-wrap items-stretch justify-center sm:w-max sm:flex-nowrap"
              style={{ border: "1px solid rgba(255,255,255,0.85)" }}
            >
              {isAuthenticated && (
                <PortfolioAssociateButton
                  urlAlias={d.bizCard.urlAlias}
                  className="flex flex-1 items-center justify-center gap-2 p-3 text-sm text-white transition-all duration-300 hover:bg-white/10 sm:flex-none sm:gap-3 sm:pr-5 md:px-5 md:py-3.5 md:text-base"
                  icon={<PiPlugsConnectedThin className="shrink-0 text-xl" />}
                  label="Connect"
                />
              )}
              <button
                type="button"
                onClick={() => downloadVCard(d)}
                className="flex flex-1 items-center justify-center gap-2 border-l border-white/85 p-3 text-sm text-white transition-all duration-300 hover:bg-white/10 sm:flex-none sm:gap-3 sm:pr-5 md:px-5 md:py-3.5 md:text-base"
              >
                <PiDownloadSimpleThin className="shrink-0 text-xl" /> Save Contact
              </button>
              <button
                type="button"
                onClick={handleShare}
                className="flex flex-1 items-center justify-center gap-2 border-l border-white/85 p-3 text-sm text-white transition-all duration-300 hover:bg-white/10 sm:flex-none sm:gap-3 sm:pr-5 md:px-5 md:py-3.5 md:text-base"
              >
                <PiShareNetworkThin className="shrink-0 text-xl" />
                {copied ? "Link Copied" : "Share"}
              </button>
            </span>
          </div>

          <PortfolioSocialProof
            data={d}
            mini={mini}
            className="relative z-20 mb-10 w-full max-w-md px-3"
            theme={{
              surface: "rgba(0,0,0,0.42)",
              border: "rgba(255,255,255,0.85)",
              text: "#ffffff",
              muted: "rgba(255,255,255,0.72)",
              accent: palette.gold,
              accentSoft: `${palette.gold}29`,
              divider: "rgba(255,255,255,0.35)",
              radius: "0px",
              backdropFilter: "blur(10px)",
            }}
          />
        </div>

        {/* ══════════ CONTENT ══════════ */}
        <div
          className="z-10 flex h-max w-full flex-col items-center justify-center backdrop-blur-sm"
          style={{ background: palette.sectionBg }}
        >
          <div className="mx-auto w-full md:max-w-3xl lg:max-w-5xl xl:max-w-6xl">
            {contactLinks.some((link) => link.kind === "social") && (
              <Reveal className={sectionWrap} disabled={!parallax}>
                <SectionHeading index="01" title="Socials" icon={<PiShareNetworkThin />} palette={palette} />
                <div className="flex w-full flex-wrap justify-center gap-2">
                  {contactLinks
                    .filter((link) => link.kind === "social")
                    .map((link, idx) => (
                      <a
                        key={`social-${idx}`}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={getContactLinkAriaLabel(link)}
                        aria-label={getContactLinkAriaLabel(link)}
                        className="flex h-12 w-12 items-center justify-center text-white outline-none transition-all duration-300 hover:-translate-y-1 active:scale-95"
                        style={{ border: `1px solid ${palette.line}`, background: "rgba(255,255,255,0.04)" }}
                      >
                        <SocialIcon platform={link.platform} size={PORTFOLIO_SOCIAL_ICON_SIZE} />
                      </a>
                    ))}
                </div>
              </Reveal>
            )}

            {contactLinks.some((link) => link.kind === "contact") && (
              <Reveal className={sectionWrap} disabled={!parallax}>
                <SectionHeading index="02" title="Contact" icon={<PiMailboxThin />} palette={palette} />
                <div className="flex w-full flex-col gap-2">
                  {contactLinks
                    .filter((link) => link.kind === "contact")
                    .map((link, idx) => (
                      <a
                        key={`contact-${idx}`}
                        href={link.url}
                        target="_self"
                        rel="noopener noreferrer"
                        title={getContactLinkAriaLabel(link)}
                        aria-label={getContactLinkAriaLabel(link)}
                        className="flex h-14 w-full items-center gap-3 text-white outline-none transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.99]"
                        style={{ border: `1px solid ${palette.line}`, background: "rgba(255,255,255,0.04)" }}
                      >
                        <span
                          className="flex aspect-square h-full w-14 items-center justify-center text-2xl"
                          style={{ borderRight: `1px solid ${palette.line}`, color: palette.gold }}
                        >
                          <SocialIcon platform={link.platform} size={PORTFOLIO_SOCIAL_ICON_SIZE} />
                        </span>
                        <ContactLinkLabel link={link} className="min-w-0 truncate pr-3" />
                      </a>
                    ))}
                </div>
              </Reveal>
            )}

            {aboutText && (
              <Reveal className={sectionWrap} disabled={!parallax}>
                <SectionHeading index="03" title="" icon={<PiInfoThin />} palette={palette} />
                <div
                  className="lux-cormorant w-full text-xl font-light leading-relaxed md:max-w-3xl md:text-2xl lg:text-3xl"
                  style={{ color: palette.ink }}
                >
                  <RichText html={aboutText} />
                </div>
              </Reveal>
            )}

            {servicesWithMedia.length > 0 && (
              <Reveal className={sectionWrap} disabled={!parallax}>
                <SectionHeading
                  index="04"
                  title="Services"
                  icon={<PiBriefcaseThin />}
                  palette={palette}
                  right={
                    !isMobile && totalServicePages > 1 ? (
                      <div className="flex shrink-0 items-center gap-2" style={{ color: palette.ink }}>
                        <button type="button" onClick={handlePrevService} disabled={servicePage === 0} className={pagerBtn} aria-label="Previous services">
                          <PiArrowLeftThin />
                        </button>
                        <span className="whitespace-nowrap text-xs tabular-nums tracking-widest">
                          {servicePage + 1} / {totalServicePages}
                        </span>
                        <button type="button" onClick={handleNextService} disabled={servicePage === totalServicePages - 1} className={pagerBtn} aria-label="Next services">
                          <PiArrowRightThin />
                        </button>
                      </div>
                    ) : undefined
                  }
                />
                <ServicesScrollContainer
                  isMobile={isMobile}
                  mini={mini}
                  desktopClassName="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6 lg:grid-cols-3"
                >
                  {(isMobile && !mini ? servicesWithMedia : visibleServices).map((service, idx) => {
                    const mediaItems = buildServiceMediaItems(service, service.media ?? []);
                    return (
                      <motion.div
                        key={`${servicePage}-${idx}`}
                        className="group flex h-max w-full flex-col items-center overflow-hidden transition-colors duration-300"
                        style={{ border: `1px solid ${palette.line}`, background: "rgba(255,255,255,0.03)" }}
                        initial={parallax ? { opacity: 0, y: 24 } : false}
                        whileInView={parallax ? { opacity: 1, y: 0 } : undefined}
                        viewport={{ once: true, amount: 0.2 }}
                        transition={{ duration: 0.55, ease: EASE, delay: idx * 0.08 }}
                      >
                        <div className="relative w-full overflow-hidden">
                          {mediaItems.length > 0 ? (
                            <ServiceMediaCarousel
                              items={mediaItems}
                              accent={palette.accent}
                              glass="rgba(255,255,255,0.06)"
                              textMuted={palette.inkMuted}
                              mini={false}
                              variant={palette.variant}
                            />
                          ) : service.featured_image ? (
                            <img
                              src={service.featured_image}
                              alt={service.title}
                              className="h-full w-full object-contain object-center transition-transform duration-500 group-hover:scale-105"
                            />
                          ) : (
                            <div
                              className="flex aspect-4/3 w-full items-center justify-center"
                              style={{ background: `linear-gradient(135deg, ${palette.accent}30, ${palette.sectionBg})` }}
                            >
                              <span className="lux-cormorant text-5xl" style={{ color: `${palette.gold}55` }}>
                                {service.title.charAt(0)}
                              </span>
                            </div>
                          )}
                          <span
                            className="pointer-events-none absolute inset-x-0 bottom-0 h-px scale-x-0 transition-transform duration-500 group-hover:scale-x-100"
                            style={{ background: palette.gold, transformOrigin: "left" }}
                          />
                        </div>
                        <div className="flex w-full flex-col gap-1 p-4" style={{ color: palette.ink }}>
                          <h3 className="lux-cormorant text-xl font-medium">{service.title}</h3>
                          <div className="text-sm font-light leading-relaxed" style={{ color: palette.inkMuted }}>
                            <RichText html={service.description} />
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </ServicesScrollContainer>
              </Reveal>
            )}

            {isGalleryEnabled(d, mini) && visibleGalleryItems.length > 0 && (
              <Reveal className={sectionWrap} disabled={!parallax}>
                <SectionHeading
                  index="05"
                  title="Featured Gallery"
                  icon={<PiPanoramaThin />}
                  palette={palette}
                  right={
                    totalGalleryPages > 1 ? (
                      <div className="flex shrink-0 items-center gap-2" style={{ color: palette.ink }}>
                        <button type="button" onClick={handlePrevGallery} disabled={galleryPage === 0} className={pagerBtn} aria-label="Previous gallery page">
                          <PiArrowLeftThin />
                        </button>
                        <span className="whitespace-nowrap text-xs tabular-nums tracking-widest">
                          {galleryPage + 1} / {totalGalleryPages}
                        </span>
                        <button type="button" onClick={handleNextGallery} disabled={galleryPage === totalGalleryPages - 1} className={pagerBtn} aria-label="Next gallery page">
                          <PiArrowRightThin />
                        </button>
                      </div>
                    ) : undefined
                  }
                />
                <GalleryCarousel
                  items={visibleGalleryItems}
                  accent={palette.accent}
                  glass="rgba(255,255,255,0.06)"
                  textMuted={palette.inkMuted}
                  mini={mini}
                  variant={palette.variant}
                />
              </Reveal>
            )}

            {isGalleryEnabled(d, mini) && videos.length > 0 && (
              <Reveal className={sectionWrap} disabled={!parallax}>
                <SectionHeading index="06" title="Videos" icon={<PiPanoramaThin />} palette={palette} />
                <VideoCarousel
                  items={videos}
                  accent={palette.accent}
                  glass="rgba(255,255,255,0.06)"
                  textMuted={palette.inkMuted}
                  mini={mini}
                  variant={palette.variant}
                />
              </Reveal>
            )}

            {hasPortfolioLocation(d.vcard) && (
              <Reveal className={sectionWrap} disabled={!parallax}>
                <SectionHeading index="07" title="Office Location" icon={<PiMapTrifoldThin />} palette={palette} />
                <div className="w-full overflow-hidden" style={{ border: `1px solid ${palette.line}`, background: "rgba(255,255,255,0.04)" }}>
                  <PortfolioAddressSection
                    vcard={d.vcard}
                    mini={mini}
                    theme={{
                      cardBg: "transparent",
                      text: "#ffffff",
                      textMuted: "rgba(255,255,255,0.75)",
                      accent: palette.gold,
                      glass: "rgba(255,255,255,0.02)",
                    }}
                  />
                </div>
              </Reveal>
            )}

            {isInquiryEnabled(d, mini) && (
              <Reveal className={sectionWrap} disabled={!parallax}>
                <SectionHeading index="08" title="Leave me a Message" icon={<PiChatTextThin />} palette={palette} />
                <form onSubmit={inquiryForm.handleSubmit} className="flex w-full flex-col gap-px" style={{ border: `1px solid ${palette.line}` }}>
                  {([
                    { type: "text", name: "senderName", placeholder: "Your Name", field: "name" as const, value: inquiryForm.fields.name },
                    { type: "email", name: "senderEmail", placeholder: "Email Address", field: "email" as const, value: inquiryForm.fields.email },
                    { type: "text", name: "senderContact", placeholder: "Contact Number", field: "phone" as const, value: inquiryForm.fields.phone },
                    { type: "text", name: "inquirySubject", placeholder: "Subject", field: "subject" as const, value: inquiryForm.fields.subject },
                  ]).map((f) => (
                    <input
                      key={f.name}
                      type={f.type}
                      name={f.name}
                      id={f.name}
                      placeholder={f.placeholder}
                      value={f.value}
                      onChange={(e) => inquiryForm.setField(f.field, e.target.value)}
                      className="lux-input px-5 py-4 font-light tracking-wide text-white outline-none"
                      style={{ background: "rgba(0,0,0,0.35)" }}
                    />
                  ))}
                  <textarea
                    name="inquiryMessage"
                    id="inquiryMessage"
                    placeholder="Enter your message...."
                    value={inquiryForm.fields.message}
                    onChange={(e) => inquiryForm.setField("message", e.target.value)}
                    className="lux-input h-64 resize-none px-5 py-4 font-light tracking-wide text-white outline-none"
                    style={{ background: "rgba(0,0,0,0.35)" }}
                  />
                  {inquiryForm.fieldError && (
                    <p className="px-5 py-2 text-sm text-red-300">{inquiryForm.fieldError}</p>
                  )}
                  <button
                    type="submit"
                    disabled={inquiryForm.isSubmitting}
                    className="w-full py-4 font-medium transition-all duration-300 hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ background: palette.gold, color: palette.onAccent }}
                  >
                    {inquiryForm.isSubmitting ? "Sending..." : "Send Inquiry"}
                  </button>
                </form>
              </Reveal>
            )}

            <div className="z-10 my-8 flex w-full items-center justify-center gap-3 px-5 text-xs font-light uppercase tracking-[0.3em] md:my-12 md:text-sm" style={{ color: palette.inkMuted }}>
              <span className="h-px w-10" style={{ background: palette.line }} />
              <p>powered by ontap creatives</p>
              <span className="h-px w-10" style={{ background: palette.line }} />
            </div>
          </div>
        </div>
      </div>

      {showFAB && !mini && (
        <FloatingContactWidget data={d} accent={palette.accent} qrUrl={qrUrl} />
      )}
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
