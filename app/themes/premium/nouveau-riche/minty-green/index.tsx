"use client";

import React, { useState } from "react";
import Image from "next/image";
import type { PortfolioViewProps } from "../../../shared";
import {
	getCoverImageOrNull,
	PortfolioCoverMedia,
	getDisplayName,
	getInitials,
	getProfileImageOrNull,
	downloadVCard,
	isGalleryEnabled,
	isInquiryEnabled,
	usePortfolioInquiryForm,
	PortfolioAddressSection,
  hasPortfolioLocation,
	resolvePortfolioData,
	FloatingContactWidget,
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
	AnimatedSection,
	usePortfolioViewerSession,
	PortfolioAssociateButton,
	ContactLinkLabel,
	getContactLinkAriaLabel
} from "../../../shared";
import PortfolioSocialProof from "../../../components/PortfolioSocialProof";
import { RichText } from '@/app/components/RichText';
import {
  useQRCardDownload,
  QRCardExportSurface,
  toQRCardStyle,
} from "../../../QRCardDownload";
import {
  LuIdCard,
  LuUserRoundPlus,
  LuChevronLeft,
  LuChevronRight,
  LuSend,
  LuShare2,
} from "react-icons/lu";
import { createSectionCounter, NR_DROPCAP_CSS, NR_MOBILE_CSS } from "../helpers";

/* ── Design tokens (kept from original MintyGreen) ── */
const C = {
  bg: "#F7F8F4",
  surf: "#FFFFFF",
  surfUp: "#EEF3E7",
  border: "rgba(38,53,31,0.08)",
  borderGold: "rgba(94,126,63,0.24)",
  gold: "#5E7E3F",
  goldLight: "#7D9D59",
  goldGlow: "rgba(94,126,63,0.10)",
  goldGlowMd: "rgba(94,126,63,0.20)",
  ink: "#1E2718",
  sub: "#66715A",
  dim: "#AAB39E",
  dimBorder: "rgba(38,53,31,0.06)",
};

const SVC_PER_PAGE = 3;

const Rule = () => (
  <div className="w-full h-px bg-gradient-to-r from-transparent via-[rgba(38,53,31,0.08)] to-transparent" />
);

/* ── Main component ────────────────────────────────────── */
export default function MintyGreen({
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
  const aboutText = d.vcard.about || d.bizCard.description || "";
  const coverImage = getCoverImageOrNull(d);
  const profileImage = getProfileImageOrNull(d);

  const galleryItems = buildGalleryItems(d);
  const videos = buildVideoItems(d);
  const contactLinks = buildContactLinks(d);

  // Services with media
  const servicesWithMedia = (d.services ?? [])
    .map((s) => ({
      title: String(s.title ?? (s as any).name ?? "").trim(),
      description: String(s.description ?? (s as any).tagline ?? "").trim(),
      featured_image: String(
        (s as any).featured_image ?? (s as any).image ?? ""
      ).trim(),
      media: (s as any).media || [],
    }))
    .filter((s) => s.title);

  // Pagination for services
  const [servicePage, setServicePage] = useState(0);
  const totalServicePages = Math.ceil(servicesWithMedia.length / SVC_PER_PAGE);
  const visibleServices = servicesWithMedia.slice(
    servicePage * SVC_PER_PAGE,
    (servicePage + 1) * SVC_PER_PAGE
  );

  const handlePrevService = () => setServicePage((p) => Math.max(0, p - 1));
  const handleNextService = () =>
    setServicePage((p) => Math.min(totalServicePages - 1, p + 1));

  const shareUrl =
    typeof window !== "undefined" && d.bizCard.urlAlias
      ? `${window.location.origin}/${d.bizCard.urlAlias}`
      : "";
  const qrUrl = shareUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=280x280&ecc=H&data=${encodeURIComponent(
        shareUrl
      )}`
    : "";
  const { cardRef, qrDataUrl, download: downloadQRCard, isDownloading } =
    useQRCardDownload(d, shareUrl);
  const qrCardStyle = toQRCardStyle({
    cardBg: C.bg,
    text: C.ink,
    muted: C.sub,
    accent: C.gold,
    accentAlt: C.goldLight,
    border: C.borderGold,
    headerGrad: `linear-gradient(135deg, ${C.gold}, ${C.goldLight}, ${C.gold})`,
  });

  const scrollToConnect = () => {
    const el = document.getElementById("mintygreen-connect");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // ── Share handler ──
  const handleShare = async () => {
    if (typeof window === "undefined") return;
    const url = shareUrl || `${window.location.origin}/${d.bizCard.urlAlias}`;
    if (navigator.share) {
      await navigator.share({ title: name, url }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(url).catch(() => {});
    }
  };

  const sectionNum = createSectionCounter();
  const hasSocials = contactLinks.some((link) => link.kind === "social");
  const hasContacts = contactLinks.some((link) => link.kind === "contact");
  const hasGallery = isGalleryEnabled(d, mini) && galleryItems.length > 0;
  const hasVideos = isGalleryEnabled(d, mini) && videos.length > 0;
  const hasAddress = hasPortfolioLocation(d.vcard);
  const hasInquiry = isInquiryEnabled(d, mini);

  return (
    <>
      {/* ── Global styles ── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,400;1,500&family=Barlow:wght@300;400;500;600&family=Barlow+Condensed:wght@300;400;500;600;700&display=swap');
        .t5-spin { animation: t5Spin 18s linear infinite; }
        @keyframes t5Spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .t5-pulse { animation: t5Pulse 2.5s ease-in-out infinite; }
        @keyframes t5Pulse { 0%,100%{box-shadow:0 0 0 0 rgba(74,222,128,0.4)} 50%{box-shadow:0 0 0 5px rgba(74,222,128,0)} }
        ${NR_DROPCAP_CSS}
        ${NR_MOBILE_CSS}
        .nr-dropcap::first-letter { color: ${C.gold}; }
      `}</style>

      <div
        className={`relative min-h-screen overflow-x-hidden${isMobile ? " nr-mobile" : ""}`}
        style={{
          background: C.bg,
          color: C.ink,
          fontFamily: "'Barlow', sans-serif",
        }}
      >
        {/* Grain overlay */}
        <div
          className="fixed inset-0 pointer-events-none z-[999] opacity-20 mix-blend-multiply"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23g)' opacity='0.06'/%3E%3C/svg%3E")`,
          }}
        />

        {/* Decorative glows */}
        <div
          className="fixed pointer-events-none z-0"
          style={{
            top: "-200px",
            left: "-200px",
            width: "600px",
            height: "600px",
            background: `radial-gradient(circle, ${C.goldGlow}, transparent 65%)`,
          }}
        />
        <div
          className="fixed pointer-events-none z-0"
          style={{
            bottom: "-200px",
            right: "-200px",
            width: "700px",
            height: "700px",
            background: `radial-gradient(circle, ${C.goldGlow}, transparent 65%)`,
          }}
        />

        {/* Left spine */}
        <div
          className="fixed left-0 top-0 bottom-0 w-[2px] z-10 opacity-30"
          style={{
            background: `linear-gradient(to bottom, transparent 0%, ${C.gold} 30%, ${C.goldLight} 50%, ${C.gold} 70%, transparent 100%)`,
          }}
        />

        <div
          className={`relative z-10 nr-content max-w-[1280px] mx-auto flex flex-col gap-5 ${
            isMobile
              ? "px-4 py-6"
              : "px-[clamp(20px,4vw,56px)] py-[clamp(32px,6vw,80px)]"
          }`}
        >
          {/* ════ HERO ════ */}
          <AnimatedSection delay={0} mini={mini}>
            <section
              className={`relative overflow-hidden rounded-xl mb-[clamp(40px,6vw,80px)] min-h-[240px] ${
                !isMobile ? "sm:min-h-[300px]" : ""
              }`}
            >
              {coverImage ? (
                <>
                  <PortfolioCoverMedia
                    src={coverImage}
                    coverType={d.bizCard.coverType}
                    alt="Cover"
                    className="absolute inset-0 h-full w-full"
                    objectPosition={d.bizCard.coverImagePosition ?? "center center"}
                  />
                  <div
                    className="absolute inset-0"
                    style={{
                      background:
                        "linear-gradient(105deg, rgba(247,248,244,0.94) 0%, rgba(247,248,244,0.78) 45%, rgba(247,248,244,0.40) 100%), linear-gradient(to top, rgba(247,248,244,0.85) 0%, transparent 55%)",
                    }}
                  />
                </>
              ) : (
                <div
                  className="absolute inset-0"
                  style={{
                    background: `radial-gradient(ellipse at 20% 40%, ${C.goldGlowMd}, transparent 55%), ${C.surf}`,
                  }}
                />
              )}
              <div
                className={`relative z-10 flex flex-col items-center gap-5 py-8 px-4 ${
                  !isMobile
                    ? "sm:flex-row sm:items-center sm:gap-[clamp(20px,4vw,48px)] sm:px-6"
                    : ""
                }`}
              >
                {/* avatar */}
                <div
                  className={`relative shrink-0 aspect-square ${
                    isMobile
                      ? "w-[120px] h-[120px]"
                      : "w-[clamp(120px,9vw,135px)] h-[clamp(120px,9vw,135px)]"
                  }`}
                >
                  <div
                    className="absolute inset-[-5px] rounded-full border border-dashed t5-spin"
                    style={{ borderColor: C.borderGold }}
                  >
                    <div
                      className="absolute -top-[3px] left-1/2 w-1.5 h-1.5 rounded-full -translate-x-1/2"
                      style={{ background: C.gold }}
                    />
                  </div>
                  {profileImage ? (
                    <Image
                      height={400}
                      width={400}
                      alt={name}
                      src={profileImage}
                      className="relative z-10 w-full h-full rounded-full object-cover object-center border-2 border-[#EEF3E7] transition-transform duration-500 hover:scale-105"
                      draggable={false}
                      priority
                    />
                  ) : (
                    <div
                      className="relative z-10 w-full h-full rounded-full flex items-center justify-center text-2xl font-semibold transition-transform duration-500 hover:scale-105"
                      style={{ background: C.surfUp, color: C.gold }}
                    >
                      {initials}
                    </div>
                  )}
                </div>

                <div
                  className={`flex-1 min-w-0 text-center z-10 ${
                    !isMobile ? "sm:min-w-[200px] sm:text-left" : ""
                  }`}
                >
                  <div
                    className={`flex items-center justify-center gap-2.5 mb-3.5 font-bold tracking-[0.18em] uppercase text-xs ${
                      !isMobile ? "sm:justify-start" : ""
                    }`}
                    style={{ color: C.gold }}
                  >
                    {!isMobile ? (
                      <span
                        className="w-6 h-px shrink-0 hidden sm:inline-block"
                        style={{ background: C.gold }}
                      />
                    ) : null}
                    <span className="inline-block break-words">{title}</span>
                  </div>
                  <h1
                    className={`nr-hero-name font-['Cormorant_Garamond',serif] font-bold tracking-[-0.03em] mb-5 ${
                      isMobile
                        ? "text-[2.15rem] leading-[1.08]"
                        : "leading-[1.05] sm:leading-[0.95] text-[clamp(2.5rem,8vw,5.5rem)] sm:text-[clamp(3.2rem,6.5vw,5.5rem)]"
                    }`}
                    style={{ color: C.ink }}
                  >
                    {name.split(" ")[0] || name}
                    {name.split(" ").slice(1).length > 0 && (
                      <>
                        <br className={isMobile ? undefined : "sm:hidden"} />
                        <span style={{ color: C.gold }}>
                          {" "}
                          {name.split(" ").slice(1).join(" ")}
                        </span>
                      </>
                    )}
                  </h1>
                  <div
                    className="z-10 flex flex-wrap items-center justify-center gap-2.5"
                  >
                    <button
                      type="button"
                      className="relative inline-flex items-center gap-2 px-6 py-2.5 border-none rounded cursor-pointer font-['Barlow_Condensed',sans-serif] font-semibold text-[0.82rem] tracking-[0.1em] uppercase overflow-hidden transition-transform duration-200 hover:-translate-y-px active:scale-95"
                      style={{
                        color: C.bg,
                        background: C.gold,
                        boxShadow: `0 6px 24px ${C.goldGlowMd}`,
                      }}
                      onClick={scrollToConnect}
                    >
                      <span className="relative z-10 flex items-center gap-2">
                        <LuUserRoundPlus strokeWidth={2.5} size={14} /> Connect
                      </span>
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded border cursor-pointer font-['Barlow_Condensed',sans-serif] font-semibold text-[0.82rem] tracking-[0.1em] uppercase transition-all hover:bg-[#5E7E3F]/10 hover:border-[#5E7E3F]/45 hover:text-[#1E2718] active:scale-95"
                      style={{
                        color: C.sub,
                        background: "transparent",
                        borderColor: C.borderGold,
                      }}
                      onClick={() => downloadVCard(d)}
                    >
                      <LuIdCard size={15} /> Save Contact
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded border cursor-pointer font-['Barlow_Condensed',sans-serif] font-semibold text-[0.82rem] tracking-[0.1em] uppercase transition-all hover:bg-[#5E7E3F]/10 hover:border-[#5E7E3F]/45 hover:text-[#1E2718] active:scale-95"
                      style={{
                        color: C.sub,
                        background: "transparent",
                        borderColor: C.borderGold,
                      }}
                      onClick={handleShare}
                    >
                      <LuShare2 size={15} /> Share
                    </button>
                  </div>
                  <PortfolioSocialProof
                    data={d}
                    mini={mini}
                    className="mt-5"
                    theme={{
                      surface: C.surf,
                      border: C.borderGold,
                      text: C.ink,
                      muted: C.sub,
                      accent: C.gold,
                      accentSoft: C.goldGlow,
                      divider: C.border,
                      shadow: `0 16px 32px ${C.goldGlowMd}`,
                      radius: '4px',
                      fontFamily: "'Cormorant Garamond', serif",
                    }}
                  />
                </div>
              </div>
            </section>
          </AnimatedSection>

          {/* ════ SOCIALS ════ */}
          {hasSocials && (
            <>
              <Rule />
              <AnimatedSection delay={75} mini={mini}>
                <section
                  id="mintygreen-connect"
                  className={`relative min-w-0 ${
                    isMobile ? "py-8" : "py-[clamp(32px,5vw,64px)]"
                  }`}
                >
                  <span
                    className={`nr-section-num absolute -top-[0.15em] right-[-0.05em] pointer-events-none select-none font-['Cormorant_Garamond',serif] font-bold leading-[1] tracking-[-0.04em] opacity-[0.028] ${
                      isMobile ? "text-[4.5rem]" : "text-[clamp(72px,14vw,180px)]"
                    }`}
                    style={{ color: C.ink }}
                  >
                    {sectionNum()}
                  </span>
                  <div
                    className="mb-5 font-bold tracking-[0.18em] uppercase text-xs"
                    style={{ color: C.gold }}
                  >
                    Socials
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    {contactLinks.filter((link) => link.kind === "social").map((link) => (
                      <a
                        key={`${link.platform}-${link.url}`}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={getContactLinkAriaLabel(link)}
                        aria-label={getContactLinkAriaLabel(link)}
                        className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border transition-all hover:border-[#5E7E3F] hover:bg-[#5E7E3F]/5"
                        style={{ borderColor: C.borderGold, background: C.surf, color: C.ink }}
                      >
                        <SocialIcon platform={link.platform} size={PORTFOLIO_SOCIAL_ICON_SIZE} />
                      </a>
                    ))}
                  </div>
                </section>
              </AnimatedSection>
            </>
          )}

          {/* ════ CONTACT ════ */}
          {hasContacts && (
            <>
              <Rule />
              <AnimatedSection delay={80} mini={mini}>
                <section
                  id={!hasSocials ? "mintygreen-connect" : undefined}
                  className={`relative min-w-0 ${
                    isMobile ? "py-8" : "py-[clamp(32px,5vw,64px)]"
                  }`}
                >
                  <span
                    className={`nr-section-num absolute -top-[0.15em] right-[-0.05em] pointer-events-none select-none font-['Cormorant_Garamond',serif] font-bold leading-[1] tracking-[-0.04em] opacity-[0.028] ${
                      isMobile ? "text-[4.5rem]" : "text-[clamp(72px,14vw,180px)]"
                    }`}
                    style={{ color: C.ink }}
                  >
                    {sectionNum()}
                  </span>
                  <div
                    className="mb-5 font-bold tracking-[0.18em] uppercase text-xs"
                    style={{ color: C.gold }}
                  >
                    Contact
                  </div>
                  <div className="nr-contact-list flex w-full min-w-0 flex-col gap-2">
                    {sessionChecked && isAuthenticated ? (
                      <PortfolioAssociateButton
                        urlAlias={d.bizCard.urlAlias}
                        className="flex w-full min-w-0 items-center gap-3 rounded-full border px-4 py-3 transition-all hover:border-[#5E7E3F] hover:bg-[#5E7E3F]/5"
                        style={{ borderColor: C.borderGold, background: C.surf, color: C.ink, display: "flex", alignItems: "center" }}
                        icon={<LuUserRoundPlus size={18} />}
                        label="Connect"
                      />
                    ) : null}
                    {contactLinks.filter((link) => link.kind === "contact").map((link) => (
                      <a
                        key={`${link.platform}-${link.url}`}
                        href={link.url}
                        target="_self"
                        rel="noopener noreferrer"
                        title={getContactLinkAriaLabel(link)}
                        aria-label={getContactLinkAriaLabel(link)}
                        className="flex w-full min-w-0 items-center gap-3 rounded-full border px-4 py-3 transition-all hover:border-[#5E7E3F] hover:bg-[#5E7E3F]/5"
                        style={{ borderColor: C.borderGold, background: C.surf, color: C.ink }}
                      >
                        <span className="shrink-0">
                          <SocialIcon platform={link.platform} size={PORTFOLIO_SOCIAL_ICON_SIZE} />
                        </span>
                        <ContactLinkLabel
                          link={link}
                          className="min-w-0 flex-1 truncate font-['Barlow',sans-serif] text-sm"
                        />
                      </a>
                    ))}
                  </div>
                </section>
              </AnimatedSection>
            </>
          )}

          {/* ════ ABOUT ════ */}
          {aboutText && (
            <>
              <Rule />
              <AnimatedSection delay={50} mini={mini}>
                <section
                  className={`relative min-w-0 ${
                    isMobile ? "py-8" : "py-[clamp(32px,5vw,64px)]"
                  }`}
                >
                  <span
                    className={`nr-section-num absolute -top-[0.15em] right-[-0.05em] pointer-events-none select-none font-['Cormorant_Garamond',serif] font-bold leading-[1] tracking-[-0.04em] opacity-[0.028] ${
                      isMobile ? "text-[4.5rem]" : "text-[clamp(72px,14vw,180px)]"
                    }`}
                    style={{ color: C.ink }}
                  >
                    {sectionNum()}
                  </span>
                  <div
                    className="mb-5 font-bold tracking-[0.18em] uppercase text-xs"
                    style={{ color: C.gold }}
                  >
                  </div>
                  <div className="grid grid-cols-1 gap-4 items-start min-w-0">
                    <div
                      className={`nr-dropcap nr-intro-body min-w-0 break-words font-light leading-[1.85] ${
                        isMobile
                          ? "text-[0.95rem]"
                          : "text-[clamp(0.9rem,1.5vw,1.05rem)]"
                      }`}
                      style={{ color: C.sub }}
                    >
                      <RichText html={aboutText} />
                    </div>
                  </div>
                </section>
              </AnimatedSection>
            </>
          )}

          {/* ════ SERVICES ════ */}
          {servicesWithMedia.length > 0 && (
            <>
              <Rule />
              <AnimatedSection delay={100} mini={mini}>
                <section
                  className={`relative min-w-0 ${
                    isMobile ? "py-8" : "py-[clamp(32px,5vw,64px)]"
                  }`}
                >
                  <span
                    className={`nr-section-num absolute -top-[0.15em] right-[-0.05em] pointer-events-none select-none font-['Cormorant_Garamond',serif] font-bold leading-[1] tracking-[-0.04em] opacity-[0.028] ${
                      isMobile ? "text-[4.5rem]" : "text-[clamp(72px,14vw,180px)]"
                    }`}
                    style={{ color: C.ink }}
                  >
                    {sectionNum()}
                  </span>
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-7">
                    <div className="min-w-0">
                      <div
                        className="mb-2 font-bold tracking-[0.18em] uppercase text-xs"
                        style={{ color: C.gold }}
                      >
                        Services
                      </div>
                      <h2
                        className={`nr-section-heading font-['Cormorant_Garamond',serif] font-semibold tracking-[-0.02em] leading-[1.05] break-words ${
                          isMobile
                            ? "text-[1.55rem]"
                            : "text-[clamp(1.6rem,3vw,2.2rem)]"
                        }`}
                        style={{ color: C.ink }}
                      >
                        What I Offer
                      </h2>
                    </div>
                    {!isMobile && totalServicePages > 1 && (
                      <div className="flex items-center gap-2.5">
                        <button
                          className="inline-flex items-center justify-center w-[30px] h-[30px] rounded border transition-all disabled:opacity-20 disabled:cursor-not-allowed active:scale-95"
                          style={{
                            color: C.sub,
                            background: C.surfUp,
                            borderColor: C.border,
                          }}
                          aria-label="Previous" onClick={handlePrevService}
                          disabled={servicePage === 0}
                        >
                          <LuChevronLeft size={14} />
                        </button>
                        <span
                          className="min-w-[36px] text-center font-['Barlow_Condensed',sans-serif] font-semibold text-[0.65rem] tracking-[0.1em]"
                          style={{ color: C.sub }}
                        >
                          {servicePage + 1} / {totalServicePages}
                        </span>
                        <button
                          className="inline-flex items-center justify-center w-[30px] h-[30px] rounded border transition-all disabled:opacity-20 disabled:cursor-not-allowed active:scale-95"
                          style={{
                            color: C.sub,
                            background: C.surfUp,
                            borderColor: C.border,
                          }}
                          aria-label="Next" onClick={handleNextService}
                          disabled={servicePage === totalServicePages - 1}
                        >
                          <LuChevronRight size={14} />
                        </button>
                      </div>
                    )}
                  </div>

                  <ServicesScrollContainer
                    isMobile={isMobile}
                    mini={mini}
                    desktopClassName={`grid grid-cols-1 gap-3 ${
                      !isMobile ? "sm:grid-cols-2 lg:grid-cols-3" : ""
                    }`}
                    itemClassName="!w-[min(100%,260px)]"
                  >
                    {(isMobile && !mini ? servicesWithMedia : visibleServices).map((service, idx) => {
                      const mediaItems = buildServiceMediaItems(service, service.media ?? []);
                      return (
                        <div
                          key={idx}
                          className="relative p-5 border rounded cursor-pointer flex flex-col gap-3.5 min-w-0 transition-all hover:-translate-y-1 hover:border-[#5E7E3F]/25"
                          style={{
                            background: C.surf,
                            borderColor: C.border,
                          }}
                        >
                          <div className="flex items-start justify-between">
                            <span
                              className="font-['Cormorant_Garamond',serif] text-[3.5rem] font-bold leading-[1] tracking-[-0.03em] select-none transition-opacity"
                              style={{ color: C.ink, opacity: 0.04 }}
                            >
                              {String(
                                idx + 1 + servicePage * SVC_PER_PAGE
                              ).padStart(2, "0")}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <div className="relative w-full overflow-hidden rounded bg-[#d4dfc9] mb-3">
                              {mediaItems.length > 0 ? (
          <ServiceMediaCarousel
                                  items={mediaItems}
                                  accent={C.gold}
                                  glass="rgba(255,255,255,0.02)"
                                  textMuted={C.sub}
                                  mini={mini}
                                  variant="minty-green"
                                />
        ) : service.featured_image ? (
                                <img
                                  src={service.featured_image}
                                  alt={service.title}
                                  className="w-full h-full object-contain object-center transition-transform duration-500 group-hover:scale-105"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-4xl font-bold opacity-20">
                                  <span style={{ color: C.gold }}>
                                    {service.title.charAt(0)}
                                  </span>
                                </div>
                              )}
                            </div>
                            <h3
                              className="font-['Cormorant_Garamond',serif] text-[1.15rem] font-semibold leading-[1.2] mb-2 break-words"
                              style={{ color: C.ink }}
                            >
                              {service.title}
                            </h3>
                            <p
                              className="text-[0.78rem] leading-[1.65] break-words"
                              style={{ color: C.sub }}
                            >
                              <RichText html={service.description} />
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </ServicesScrollContainer>
                </section>
              </AnimatedSection>
            </>
          )}

          {/* ════ GALLERY ════ */}
          {hasGallery && (
            <>
              <Rule />
              <AnimatedSection delay={125} mini={mini}>
                <section className="relative py-[clamp(32px,5vw,64px)]">
                  <span
                    className="absolute -top-[0.15em] right-[-0.05em] pointer-events-none select-none font-['Cormorant_Garamond',serif] font-bold leading-[1] tracking-[-0.04em] text-[clamp(100px,14vw,180px)] opacity-[0.028]"
                    style={{ color: C.ink }}
                  >
                    {sectionNum()}
                  </span>
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                    <div>
                      <div
                        className="flex items-center gap-2.5 mb-2 font-bold tracking-[0.18em] uppercase text-xs"
                        style={{ color: C.gold }}
                      >
                        <span
                          className="w-6 h-px shrink-0"
                          style={{ background: C.gold }}
                        />
                        Featured Gallery
                      </div>
                      <h2
                        className="font-['Cormorant_Garamond',serif] font-semibold tracking-[-0.02em] leading-[1.05] text-[clamp(1.6rem,3vw,2.2rem)]"
                        style={{ color: C.ink }}
                      >
                        Selected Work
                      </h2>
                    </div>
                  </div>
                  <GalleryCarousel
                    items={galleryItems}
                    accent={C.gold}
                    glass="rgba(255,255,255,0.02)"
                    textMuted={C.sub}
                    mini={mini}
                    variant="minty-green"
                  />
                </section>
              </AnimatedSection>
            </>
          )}

          {/* ════ VIDEOS ════ */}
          {hasVideos && (
            <>
              <Rule />
              <AnimatedSection delay={150} mini={mini} className="max-sm:w-screen max-sm:relative max-sm:left-1/2 max-sm:-translate-x-1/2">
                <section className="relative py-[clamp(32px,5vw,64px)]">
                  <div className="px-[clamp(20px,4vw,56px)] sm:px-0 max-w-[1280px] mx-auto">
                    <span
                      className="absolute -top-[0.15em] right-[clamp(20px,4vw,56px)] sm:right-[-0.05em] pointer-events-none select-none font-['Cormorant_Garamond',serif] font-bold leading-[1] tracking-[-0.04em] text-[clamp(100px,14vw,180px)] opacity-[0.028]"
                      style={{ color: C.ink }}
                    >
                      {sectionNum()}
                    </span>
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                      <div>
                        <div
                          className="flex items-center gap-2.5 mb-2 font-bold tracking-[0.18em] uppercase text-xs"
                          style={{ color: C.gold }}
                        >
                          <span
                            className="w-6 h-px shrink-0"
                            style={{ background: C.gold }}
                          />
                          Videos
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="w-full overflow-hidden max-sm:rounded-none">
                    <VideoCarousel
                      items={videos}
                      accent={C.gold}
                      glass="rgba(255,255,255,0.02)"
                      textMuted={C.sub}
                      mini={mini}
                      variant="minty-green"
                    />
                  </div>
                </section>
              </AnimatedSection>
            </>
          )}

          {/* ════ ADDRESS ════ */}
          {hasAddress && (
            <>
              <Rule />
              <AnimatedSection delay={175} mini={mini}>
                <section className="relative py-[clamp(32px,5vw,64px)]">
                  <span
                    className="absolute -top-[0.15em] right-[-0.05em] pointer-events-none select-none font-['Cormorant_Garamond',serif] font-bold leading-[1] tracking-[-0.04em] text-[clamp(100px,14vw,180px)] opacity-[0.028]"
                    style={{ color: C.ink }}
                  >
                    {sectionNum()}
                  </span>
                  <PortfolioAddressSection
                    vcard={d.vcard}
                    mini={mini}
                    theme={{
                      cardBg: C.surf,
                      text: C.ink,
                      textMuted: C.sub,
                      accent: C.gold,
                      glass: "rgba(255,255,255,0.02)",
                    }}
                  />
                </section>
              </AnimatedSection>
            </>
          )}

          {/* ════ INQUIRY ════ */}
          {hasInquiry && (
            <>
              <Rule />
              <AnimatedSection delay={200} mini={mini}>
                <section className="relative py-[clamp(32px,5vw,64px)]">
                  <span
                    className="absolute -top-[0.15em] right-[-0.05em] pointer-events-none select-none font-['Cormorant_Garamond',serif] font-bold leading-[1] tracking-[-0.04em] text-[clamp(100px,14vw,180px)] opacity-[0.028]"
                    style={{ color: C.ink }}
                  >
                    {sectionNum()}
                  </span>
                  <div
                    className="p-6 rounded border"
                    style={{ background: C.surf, borderColor: C.border }}
                  >
                    <div
                      className="flex items-center gap-2.5 mb-4 font-bold tracking-[0.18em] uppercase text-xs"
                      style={{ color: C.gold }}
                    >
                      <span
                        className="w-6 h-px shrink-0"
                        style={{ background: C.gold }}
                      />
                      Send an Inquiry
                    </div>
                    <form
                      onSubmit={inquiryForm.handleSubmit}
                      className="flex flex-col gap-5"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div className="flex flex-col gap-1.5">
                          <label
                            className="font-['Barlow_Condensed',sans-serif] text-[0.58rem] font-bold tracking-[0.14em] uppercase"
                            style={{ color: C.sub }}
                          >
                            Full Name
                          </label>
                          <input
                            type="text"
                            placeholder="Juan dela Cruz"
                            className="w-full border-b border-[#AAB39E] bg-transparent py-2.5 px-0.5 text-[0.85rem] outline-none transition-colors placeholder:text-[#AAB39E] focus:border-[#5E7E3F]"
                            style={{ color: C.ink, caretColor: C.gold }}
                            value={inquiryForm.fields.name}
                            onChange={(e) =>
                              inquiryForm.setField("name", e.target.value)
                            }
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label
                            className="font-['Barlow_Condensed',sans-serif] text-[0.58rem] font-bold tracking-[0.14em] uppercase"
                            style={{ color: C.sub }}
                          >
                            Contact No.
                          </label>
                          <input
                            type="tel"
                            placeholder="+63 9XX XXX XXXX"
                            className="w-full border-b border-[#AAB39E] bg-transparent py-2.5 px-0.5 text-[0.85rem] outline-none transition-colors placeholder:text-[#AAB39E] focus:border-[#5E7E3F]"
                            style={{ color: C.ink, caretColor: C.gold }}
                            value={inquiryForm.fields.phone}
                            onChange={(e) =>
                              inquiryForm.setField("phone", e.target.value)
                            }
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label
                          className="font-['Barlow_Condensed',sans-serif] text-[0.58rem] font-bold tracking-[0.14em] uppercase"
                          style={{ color: C.sub }}
                        >
                          Email Address
                        </label>
                        <input
                          type="email"
                          placeholder="you@example.com"
                          className="w-full border-b border-[#AAB39E] bg-transparent py-2.5 px-0.5 text-[0.85rem] outline-none transition-colors placeholder:text-[#AAB39E] focus:border-[#5E7E3F]"
                          style={{ color: C.ink, caretColor: C.gold }}
                          value={inquiryForm.fields.email}
                          onChange={(e) =>
                            inquiryForm.setField("email", e.target.value)
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label
                          className="font-['Barlow_Condensed',sans-serif] text-[0.58rem] font-bold tracking-[0.14em] uppercase"
                          style={{ color: C.sub }}
                        >
                          Subject
                        </label>
                        <input
                          type="text"
                          placeholder="What's this about?"
                          className="w-full border-b border-[#AAB39E] bg-transparent py-2.5 px-0.5 text-[0.85rem] outline-none transition-colors placeholder:text-[#AAB39E] focus:border-[#5E7E3F]"
                          style={{ color: C.ink, caretColor: C.gold }}
                          value={inquiryForm.fields.subject}
                          onChange={(e) =>
                            inquiryForm.setField("subject", e.target.value)
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label
                          className="font-['Barlow_Condensed',sans-serif] text-[0.58rem] font-bold tracking-[0.14em] uppercase"
                          style={{ color: C.sub }}
                        >
                          Message
                        </label>
                        <textarea
                          rows={4}
                          placeholder="Tell me more…"
                          className="w-full border-b border-[#AAB39E] bg-transparent py-2.5 px-0.5 text-[0.85rem] outline-none transition-colors placeholder:text-[#AAB39E] focus:border-[#5E7E3F] resize-none min-h-[100px]"
                          style={{ color: C.ink, caretColor: C.gold }}
                          value={inquiryForm.fields.message}
                          onChange={(e) =>
                            inquiryForm.setField("message", e.target.value)
                          }
                        />
                      </div>
                      {inquiryForm.fieldError && (
                        <p className="text-sm text-red-600" role="alert">
                          {inquiryForm.fieldError}
                        </p>
                      )}
                      <button
                        type="submit"
                        disabled={inquiryForm.isSubmitting}
                        className="relative w-full flex items-center justify-center gap-2 px-6 py-3 border-none rounded cursor-pointer font-['Barlow_Condensed',sans-serif] font-bold text-[0.82rem] tracking-[0.12em] uppercase overflow-hidden transition-transform hover:-translate-y-px active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
                        style={{
                          color: C.bg,
                          background: C.gold,
                          boxShadow: `0 8px 28px ${C.goldGlowMd}`,
                        }}
                      >
                        <span className="relative z-10 flex items-center gap-2">
                          <LuSend size={13} strokeWidth={2.5} />{" "}
                          {inquiryForm.isSubmitting ? "Sending…" : "Send Message"}
                        </span>
                      </button>
                    </form>
                  </div>
                </section>
              </AnimatedSection>
            </>
          )}

          {/* ════ FOOTER ════ */}
          <Rule />
          <div className="flex flex-wrap items-center justify-center gap-2 pt-7">
            <span
              className="font-['Barlow_Condensed',sans-serif] text-[0.6rem] tracking-[0.14em] uppercase"
              style={{ color: C.dim }}
            >
              Powered By OnTap Creatives
            </span>
          </div>
        </div>
      </div>

      {showFAB && !mini && (
        <FloatingContactWidget data={d} accent={C.gold} qrUrl={qrUrl} />
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