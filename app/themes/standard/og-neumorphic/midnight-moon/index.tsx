"use client";

// NOTE: Data fields with no explicit display element in this template:
// - videos: original template does not include a video player/list
// - some service fields like `videoUrl` / `videoFile` are not displayed here
// - vcard.languages, postNominalLetters are not surfaced by this layout

import React, { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Image from "next/image";
import type { PortfolioViewProps } from "../../../shared";
import {
	getCoverImageOrNull,
	PortfolioCoverMedia,
	getDisplayName,
	getInitials,
	FloatingContactWidget,
	isGalleryEnabled,
	isInquiryEnabled,
	usePortfolioInquiryForm,
	PortfolioAddressSection,
  hasPortfolioLocation,
	resolvePortfolioData,
	SocialIcon,
	PORTFOLIO_SOCIAL_ICON_SIZE,
	buildGalleryItems,
	buildVideoItems,
	buildServiceMediaItems,
	GalleryCarousel,
	VideoCarousel,
	ServiceMediaCarousel,
	ServicesScrollContainer,
	buildContactLinks,
	ContactLinkLabel,
	getContactLinkAriaLabel
} from "../../../shared";
import PortfolioActionButtons from "../../../components/PortfolioActionButtons";
import PortfolioSocialProof from "../../../components/PortfolioSocialProof";
import { RichText } from '@/app/components/RichText';
import {
  useQRCardDownload,
  QRCardExportSurface,
  toQRCardStyle,
} from "../../../QRCardDownload";
import {
  LuArrowUpRight,
  LuChevronLeft,
  LuChevronRight,
} from "react-icons/lu";

const fontVariables = {
  ["--font-display" as const]: '"Cormorant Garamond", serif',
  ["--font-mono" as const]: '"IBM Plex Mono", monospace',
} as CSSProperties;

/* Visual tokens (kept identical to preserve look) */
const shellBg = `
relative overflow-hidden
bg-[#1E2028]
text-[#E6EEF9]
before:pointer-events-none before:absolute before:inset-0 before:content-['']
before:bg-[radial-gradient(circle_at_top_left,rgba(47,51,69,0.88),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(47,51,69,0.42),transparent_28%),linear-gradient(180deg,#252836,#1E2028)]
after:pointer-events-none after:absolute after:inset-0 after:content-['']
after:bg-[url("data:image/svg+xml;base64,PHN2ZyB3aWR0aD0nMTIwJyBoZWlnaHQ9JzEyMCcgdmlld0JveD0nMCAwIDEyMCAxMjAnIHhtbG5zPSdodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Zyc+PGZpbHRlciBpZD0nbic+PGZlVHVyYnVsZW5jZSB0eXBlPSdmcmFjdGFsTm9pc2UnIGJhc2VGcmVxdWVuY3k9JzAuODUnIG51bU9jdGF2ZXM9JzMnIHN0aXRjaFRpbGVzPSdzdGl0Y2gnLz48L2ZpbHRlcj48cmVjdCB3aWR0aD0nMTIwJyBoZWlnaHQ9JzEyMCcgZmlsdGVyPSd1cmwoI24pJyBvcGFjaXR5PScwLjAzNScvPjwvc3ZnPg==")]
after:opacity-36
`;

const neoPanel = `
relative
rounded-3xl
border border-[#2F3345]/60
bg-[linear-gradient(145deg,rgba(47,51,69,0.95),rgba(37,40,54,0.85))]
backdrop-blur-2xl
shadow-[28px_28px_56px_rgba(20,21,27,0.7),-22px_-22px_46px_rgba(47,51,69,0.6),inset_1px_1px_0_rgba(47,51,69,0.25)]
`;

interface ServiceCardProps {
  title: string;
  desc: string;
  image: string;
  media?: any[];
  videoUrl?: string;
  videoFile?: string | null;
  index: number;
  isMobile?: boolean;
}

const ServiceCard = ({ title, desc, image, media = [], videoUrl, videoFile, index, isMobile = false }: ServiceCardProps) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const mediaItems = buildServiceMediaItems({ featured_image: image, videoUrl, videoFile }, media);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const handleMove = (e: MouseEvent) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const rotateY = ((x - rect.width / 2) / rect.width) * 10;
      const rotateX = -((y - rect.height / 2) / rect.height) * 10;
      card.style.transform = `perspective(1200px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px)`;
    };

    const leave = () => {
      card.style.transform = `perspective(1200px) rotateX(0deg) rotateY(0deg) translateY(0px)`;
    };

    card.addEventListener("mousemove", handleMove);
    card.addEventListener("mouseleave", leave);

    return () => {
      card.removeEventListener("mousemove", handleMove);
      card.removeEventListener("mouseleave", leave);
    };
  }, []);

  return (
    <div
      ref={cardRef}
      data-cursor-hover
      className={` ${neoPanel} group transition-all duration-500 overflow-hidden p-4 ${
        !isMobile && "md:p-5"
      } will-change-transform `}
    >
      <div
        className={`pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.03),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(47,51,69,0.45),transparent_30%)]`}
      />

      <div className="relative overflow-hidden rounded-[18px]">
        {mediaItems.length > 0 ? (
          <ServiceMediaCarousel
            items={mediaItems}
            accent="#7AA2FF"
            glass="rgba(47,51,69,0.3)"
            textMuted="#98A6C8"
            mini={false}
            variant="midnight-moon"
          />
        ) : image ? (
          <Image
            src={image}
            alt={title}
            width={1000}
            height={1000}
            className="aspect-16/10 w-full object-contain object-center grayscale-[0.05] brightness-[0.86] transition-transform duration-700 group-hover:scale-105"
            draggable={false}
          />
        ) : (
          <div className="aspect-16/10 w-full flex items-center justify-center bg-[#2F3345]/40 text-4xl font-(--font-display) text-[#98A6C8]">
            {String(index + 1).padStart(2, "0")}
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(20,21,27,0.9),rgba(47,51,69,0.16))]" />
      </div>

      <div className="pt-6 relative">
        <h3
          className={`font-(--font-display) text-[1.85rem] leading-none tracking-tight text-[#E6EEF9] mb-3`}
        >
          {title}
        </h3>
        <p className={`text-[#98A6C8] leading-relaxed text-[13px] font-(--font-mono)`}><RichText html={desc} /></p>
      </div>
    </div>
  );
};

export default function MidnightMoon({
  data,
  mini = false,
  showFAB = false,
  isMobile = false,
}: PortfolioViewProps) {
  const d = resolvePortfolioData(data);
  const inquiryForm = usePortfolioInquiryForm({ urlAlias: d.bizCard.urlAlias, mini });
  const fullName = getDisplayName(d);
  const firstName = d.vcard.firstName || fullName.split(" ")[0] || fullName;
  const lastName = d.vcard.lastName || fullName.split(" ").slice(1).join(" ") || "";
  const aboutText = d.vcard.about || d.bizCard.description || "";
  const coverImage = getCoverImageOrNull(d);
  const profileImage = d.bizCard.profileImage;

  const serviceList = (d.services ?? [])
    .map((s: any, idx: number) => ({
      title: String(s.title || s.name || "").trim(),
      desc: String(s.description || s.tagline || "").trim(),
      image: String(s.featured_image || s.image || "").trim(),
      media: s.media || [],
      videoUrl: String((s as any).videoUrl ?? "").trim() || undefined,
      videoFile: (s as any).videoFile ?? null,
    }))
    .filter((s) => s.title);

  const SERVICES_PER_PAGE = 4;
  const [servicePage, setServicePage] = useState(0);

  const galleryItems = buildGalleryItems(d);
  const videos = buildVideoItems(d);

  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const visibleServices = serviceList.slice(
    servicePage * SERVICES_PER_PAGE,
    (servicePage + 1) * SERVICES_PER_PAGE
  );

  // Unified contact links
  const contactLinks = buildContactLinks(d);

  const shareUrl =
    typeof window !== "undefined" && d.bizCard.urlAlias
      ? `${window.location.origin}/${d.bizCard.urlAlias}`
      : "";
  const qrUrl = shareUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=280x280&ecc=H&data=${encodeURIComponent(
        shareUrl
      )}`
    : "";
  const { cardRef, qrDataUrl, download: downloadQRCard, isDownloading } = useQRCardDownload(
    d,
    shareUrl
  );
  const qrCardStyle = toQRCardStyle({
    cardBg: "#1a1d27",
    text: "#E6EEF9",
    muted: "#98A6C8",
    accent: "#7AA2FF",
    border: "rgba(47,51,69,0.4)",
    headerGrad: "linear-gradient(145deg,#2F3345,#1a1d27)",
  });

  // Share handler
  const handleShare = async () => {
    if (typeof window === "undefined") return;
    const url = shareUrl || `${window.location.origin}/${d.bizCard.urlAlias}`;
    if (navigator.share) {
      await navigator.share({ title: fullName, url }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(url).catch(() => {});
    }
  };

  return (
    <div
      className={`${shellBg} min-h-screen overflow-x-hidden selection:bg-[#7AA2FF] selection:text-black`}
      style={fontVariables}
    >
      <style jsx global>{`
        html {
          scroll-behavior: smooth;
        }
        body {
          background: #1e2028;
        }
        .fade-up {
          opacity: 0;
          transform: translateY(20px);
          animation: fadeUp 0.9s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        .delay-1 {
          animation-delay: 0.12s;
        }
        .delay-2 {
          animation-delay: 0.22s;
        }
        .delay-3 {
          animation-delay: 0.32s;
        }
        .delay-4 {
          animation-delay: 0.42s;
        }
        @keyframes fadeUp {
          to {
            opacity: 1;
            transform: translateY(0px);
          }
        }
      `}</style>

      <div className="absolute top-24 -left-30 w-85 h-85 rounded-full bg-[#2F3345]/30 blur-[90px]" />
      <div className="absolute bottom-0 -right-30 w-100 h-100 rounded-full bg-[#1E2028]/40 blur-[120px]" />

      <div
        className={`max-w-6xl mx-auto px-5 ${!isMobile && "md:px-8"} py-10 relative z-10`}
      >
        <section
          className={`${neoPanel} fade-up overflow-hidden p-7 ${!isMobile && "md:p-10"}`}
        >
          {coverImage ? (
            <>
              <PortfolioCoverMedia
                src={coverImage}
                coverType={d.bizCard.coverType}
                className="absolute inset-0 h-full w-full"
                objectPosition={d.bizCard.coverImagePosition ?? "center center"}
                style={{ opacity: 0.32 }}
              />
              <div className="absolute inset-0 bg-[linear-gradient(145deg,rgba(16,18,28,0.78),rgba(37,40,54,0.66))]" />
            </>
          ) : null}
          <div
            className={`absolute top-0 right-0 w-80 h-80 rounded-full bg-[#2F3345]/30 blur-[100px]`}
          />

          <div
            className={`grid ${!isMobile && "lg:grid-cols-[2fr_0.85fr]"} gap-12 items-center relative z-10`}
          >
            <div className="relative">
              <div className={`absolute -inset-6 rounded-[28px] bg-[#252836]/40 blur-3xl`} />
              <div
                className={`relative rounded-[28px] p-3 bg-[linear-gradient(145deg,rgba(47,51,69,0.9),rgba(37,40,54,0.78))] border border-[#2F3345]/40 shadow-[24px_24px_54px_rgba(20,21,27,0.56),-24px_-24px_54px_rgba(47,51,69,0.38)]`}
              >
                <div className="overflow-hidden rounded-[22px] relative aspect-square">
                  {profileImage ? (
                    <Image
                      src={profileImage}
                      alt="Profile"
                      fill
                      sizes="(max-width: 1024px) 100vw, 40vw"
                      className="object-cover object-center"
                      draggable={false}
                      priority
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-[#2F3345] text-4xl font-(--font-display) text-[#E6EEF9]">
                      {getInitials(d)}
                    </div>
                  )}
                  <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(20,21,27,0.9),transparent_45%)]" />
                </div>
              </div>
            </div>

            <div className="min-w-0">
              <h1
                className={`font-(--font-display) break-words text-[2rem] ${!isMobile && "md:text-[6rem]"} leading-[0.88] tracking-[-0.04em] text-[#E6EEF9]`}
              >
                {firstName + " " + lastName}
              </h1>
              <div className="mt-8 w-full min-w-0">
                <PortfolioActionButtons
                  data={d}
                  shareUrl={shareUrl}
                  theme={{ accent: '#7AA2FF', text: '#E6EEF9', surface: 'rgba(47,51,69,0.95)', border: 'rgba(47,51,69,0.6)' }}
                  layout="row"
                  compact={mini}
                />
              </div>
              <PortfolioSocialProof
                data={d}
                mini={mini}
                className="mt-6 w-full min-w-0"
                theme={{
                  surface: 'rgba(47,51,69,0.92)',
                  border: 'rgba(122,162,255,0.22)',
                  text: '#E6EEF9',
                  muted: '#98A6C8',
                  accent: '#7AA2FF',
                  accentSoft: 'rgba(122,162,255,0.14)',
                  divider: 'rgba(47,51,69,0.8)',
                  shadow: '18px 18px 36px rgba(20,21,27,0.5), -12px -12px 28px rgba(47,51,69,0.28)',
                  radius: '24px',
                }}
              />
            </div>
          </div>
        </section>

        <div className={`grid ${!isMobile && "lg:grid-cols-12"} gap-8 mt-10`}>
          <div className={`min-w-0 ${!isMobile && "lg:col-span-8"} space-y-8`}>
            {/* ── Socials ── */}
            {contactLinks.some((link) => link.kind === "social") && (
              <section className={`${neoPanel} fade-up delay-3 p-6`}>
                <div className="mb-6">
                  <h3
                    className={`text-[1.5rem] leading-none font-(--font-display) text-[#E6EEF9]`}
                  >
                    Socials
                  </h3>
                </div>

                <div className="flex flex-wrap justify-start gap-2">
                  {contactLinks.filter((link) => link.kind === "social").map((link, i) => (
                    <a
                      key={`social-${i}`}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={getContactLinkAriaLabel(link)}
                      aria-label={getContactLinkAriaLabel(link)}
                      data-cursor-hover
                      className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#252836]/50 border border-[#2F3345]/40 backdrop-blur-xl shadow-[6px_6px_14px_rgba(20,21,27,0.34),-6px_-6px_14px_rgba(47,51,69,0.12)] transition-all hover:-translate-y-0.5 hover:scale-105 text-[#E6EEF9]"
                    >
                      <SocialIcon platform={link.platform} size={PORTFOLIO_SOCIAL_ICON_SIZE} />
                    </a>
                  ))}
                </div>
              </section>
            )}

            {/* ── Contact ── */}
            {contactLinks.some((link) => link.kind === "contact") && (
              <section className={`${neoPanel} fade-up delay-3 p-6`}>
                <div className="mb-6">
                  <h3
                    className={`text-[1.5rem] leading-none font-(--font-display) text-[#E6EEF9]`}
                  >
                    Contact
                  </h3>
                </div>

                <div className="flex flex-wrap justify-start gap-2">
                  {contactLinks.filter((link) => link.kind === "contact").map((link, i) => (
                    <a
                      key={`contact-${i}`}
                      href={link.url}
                      target="_self"
                      rel="noopener noreferrer"
                      title={getContactLinkAriaLabel(link)}
                      aria-label={getContactLinkAriaLabel(link)}
                      data-cursor-hover
                      className="inline-flex max-w-full items-center gap-2 rounded-full px-4 py-2 bg-[#252836]/50 border border-[#2F3345]/40 backdrop-blur-xl shadow-[6px_6px_14px_rgba(20,21,27,0.34),-6px_-6px_14px_rgba(47,51,69,0.12)] transition-all hover:-translate-y-0.5 text-[#E6EEF9] text-[14px] font-(--font-mono)"
                    >
                      <SocialIcon platform={link.platform} size={PORTFOLIO_SOCIAL_ICON_SIZE} />
                      <ContactLinkLabel link={link} className="truncate min-w-0" />
                    </a>
                  ))}
                </div>
              </section>
            )}

            {aboutText ? (
            <section
              className={`${neoPanel} fade-up delay-1 p-6 ${!isMobile && "md:p-8"}`}
            >
              <div className="mb-6">
                <h2
                  className={`text-[1.5rem] leading-none font-(--font-display) text-[#E6EEF9]`}
                >
                </h2>
              </div>

              <p className={`text-[#98A6C8] leading-[1.9] text-[15px] font-(--font-mono)`}>
                <RichText html={aboutText} />
              </p>
            </section>
            ) : null}

            {serviceList.length > 0 ? (
            <section className="fade-up delay-2">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2
                    className={`text-[1.5rem] leading-none font-(--font-display) text-[#E6EEF9]`}
                  >
                    Services
                  </h2>
                </div>

                <div className="flex flex-wrap gap-3">
                  {!isMobile && serviceList.length > 1 ? (
                    <>
                      <button
                        data-cursor-hover
                        onClick={() => setServicePage((p) => Math.max(p - 1, 0))}
                        className={`w-14 h-14 rounded-2xl bg-[#252836]/50 border border-[#2F3345]/40 flex items-center justify-center shadow-[8px_8px_18px_rgba(20,21,27,0.3),-8px_-8px_18px_rgba(47,51,69,0.12)] hover:shadow-[inset_5px_5px_10px_rgba(20,21,27,0.3),inset_-5px_-5px_10px_rgba(47,51,69,0.08)] transition-all`}
                      >
                        <LuChevronLeft />
                      </button>

                      <button
                        data-cursor-hover
                        onClick={() =>
                          setServicePage((p) =>
                            Math.min(
                              p + 1,
                              Math.ceil(serviceList.length / SERVICES_PER_PAGE) - 1
                            )
                          )
                        }
                        className={`w-14 h-14 rounded-2xl bg-[#252836]/50 border border-[#2F3345]/40 flex items-center justify-center shadow-[8px_8px_18px_rgba(20,21,27,0.3),-8px_-8px_18px_rgba(47,51,69,0.08)] transition-all`}
                      >
                        <LuChevronRight />
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              <ServicesScrollContainer
                  isMobile={isMobile}
                  mini={mini}
                  desktopClassName={`grid ${!isMobile && "md:grid-cols-2"} gap-6`}
                >
                {(isMobile && !mini ? serviceList : visibleServices).map((service, index) => (
                  <ServiceCard
                    key={index}
                    title={service.title}
                    desc={service.desc}
                    image={service.image}
                    media={service.media} videoUrl={service.videoUrl} videoFile={service.videoFile}
                    index={index}
                    isMobile={isMobile}
                  />
                ))}
              </ServicesScrollContainer>
            </section>
            ) : null}
          </div>

          <div className={`min-w-0 ${!isMobile && "lg:col-span-4"} space-y-8`}>
            {isGalleryEnabled(d, mini) && galleryItems.length > 0 && (
              <section className="fade-up delay-4 min-w-0">
                <div className="mb-6">
                  <h2
                    className={`text-[1.5rem] leading-none font-(--font-display) text-[#E6EEF9]`}
                  >
                    Featured Gallery
                  </h2>
                </div>
                <div
                  className="min-w-0 w-full touch-pan-x"
                  style={{ WebkitOverflowScrolling: "touch" }}
                >
                  <GalleryCarousel
                    items={galleryItems}
                    accent="#7AA2FF"
                    glass="rgba(47,51,69,0.3)"
                    textMuted="#98A6C8"
                    mini={mini}
                    variant="midnight-moon"
                  />
                </div>
              </section>
            )}

            {isGalleryEnabled(d, mini) && videos.length > 0 && (
              <section className="fade-up delay-4 min-w-0">
                <div className="mb-6">
                  <p
                    className={`text-[10px] tracking-[0.3em] uppercase text-[#98A6C8] font-(--font-mono) mb-2`}
                  >
                    Motion
                  </p>
                  <h2
                    className={`text-[1.5rem] leading-none font-(--font-display) text-[#E6EEF9]`}
                  >
                    Videos
                  </h2>
                </div>
                <div
                  className="min-w-0 w-full touch-pan-x"
                  style={{ WebkitOverflowScrolling: "touch" }}
                >
                  <VideoCarousel
                    items={videos}
                    accent="#7AA2FF"
                    glass="rgba(47,51,69,0.3)"
                    textMuted="#98A6C8"
                    mini={mini}
                    variant="midnight-moon"
                  />
                </div>
              </section>
            )}

            {hasPortfolioLocation(d.vcard) && (
              <PortfolioAddressSection vcard={d.vcard} mini={mini} />
            )}

            {isInquiryEnabled(d, mini) && (
              <section className={`${neoPanel} fade-up delay-4 p-6`}>
                <div className="mb-6">
                  <p
                    className={`text-[10px] tracking-[0.3em] uppercase text-[#98A6C8] font-(--font-mono) mb-2`}
                  >
                    Initiate Inquiry
                  </p>
                  <h3
                    className={`text-[1.5rem] leading-none font-(--font-display) text-[#E6EEF9]`}
                  >
                    Send a Message
                  </h3>
                </div>

                <form className="space-y-4" onSubmit={inquiryForm.handleSubmit}>
                  <div>
                    <input
                      type="text"
                      placeholder="Name"
                      aria-label="Name"
                      id="Name"
                      value={inquiryForm.fields.name}
                      onChange={(e) => inquiryForm.setField("name", e.target.value)}
                      className="w-full rounded-3xl border border-[#2F3345]/40 bg-[#252836]/50 px-4 py-3.5 font-(--font-mono) text-[15px] text-[#E6EEF9] placeholder:text-[#98A6C8]/85 shadow-[10px_10px_22px_rgba(20,21,27,0.34),-10px_-10px_22px_rgba(47,51,69,0.12)] backdrop-blur-xl outline-none transition-all duration-300 focus:bg-[#2F3345]/55 focus:translate-y-0.5 focus:scale-[0.996] focus:shadow-[inset_5px_5px_12px_rgba(20,21,27,0.36),inset_-5px_-5px_12px_rgba(47,51,69,0.12)]"
                    />
                  </div>
                  <div>
                    <input
                      type="email"
                      placeholder="Email Address"
                      aria-label="Email Address"
                      id="Email Address"
                      value={inquiryForm.fields.email}
                      onChange={(e) => inquiryForm.setField("email", e.target.value)}
                      className="w-full rounded-3xl border border-[#2F3345]/40 bg-[#252836]/50 px-4 py-3.5 font-(--font-mono) text-[15px] text-[#E6EEF9] placeholder:text-[#98A6C8]/85 shadow-[10px_10px_22px_rgba(20,21,27,0.34),-10px_-10px_22px_rgba(47,51,69,0.12)] backdrop-blur-xl outline-none transition-all duration-300 focus:bg-[#2F3345]/55 focus:translate-y-0.5 focus:scale-[0.996] focus:shadow-[inset_5px_5px_12px_rgba(20,21,27,0.36),inset_-5px_-5px_12px_rgba(47,51,69,0.12)]"
                    />
                  </div>
                  <div>
                    <input
                      type="text"
                      placeholder="Subject"
                      aria-label="Subject"
                      id="Subject"
                      value={inquiryForm.fields.subject}
                      onChange={(e) => inquiryForm.setField("subject", e.target.value)}
                      className="w-full rounded-3xl border border-[#2F3345]/40 bg-[#252836]/50 px-4 py-3.5 font-(--font-mono) text-[15px] text-[#E6EEF9] placeholder:text-[#98A6C8]/85 shadow-[10px_10px_22px_rgba(20,21,27,0.34),-10px_-10px_22px_rgba(47,51,69,0.12)] backdrop-blur-xl outline-none transition-all duration-300 focus:bg-[#2F3345]/55 focus:translate-y-0.5 focus:scale-[0.996] focus:shadow-[inset_5px_5px_12px_rgba(20,21,27,0.36),inset_-5px_-5px_12px_rgba(47,51,69,0.12)]"
                    />
                  </div>
                  <div>
                    <textarea
                      placeholder="Message Details"
                      aria-label="Message Details"
                      id="message"
                      value={inquiryForm.fields.message}
                      onChange={(e) => inquiryForm.setField("message", e.target.value)}
                      className="w-full rounded-3xl border border-[#2F3345]/40 bg-[#252836]/50 px-4 py-3.5 font-(--font-mono) text-[15px] text-[#E6EEF9] placeholder:text-[#98A6C8]/85 shadow-[10px_10px_22px_rgba(20,21,27,0.34),-10px_-10px_22px_rgba(47,51,69,0.12)] backdrop-blur-xl outline-none transition-all duration-300 focus:bg-[#2F3345]/55 focus:translate-y-0.5 focus:scale-[0.996] focus:shadow-[inset_5px_5px_12px_rgba(20,21,27,0.36),inset_-5px_-5px_12px_rgba(47,51,69,0.12)] resize-none min-h-35"
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
                    className="w-full group flex items-center justify-center gap-3 rounded-full border border-[#2F3345]/40 bg-[linear-gradient(145deg,#7AA2FF,#252836)] px-6 py-3.5 text-[11px] uppercase tracking-[0.25em] font-(--font-mono) text-[#07102a] shadow-[14px_14px_28px_rgba(20,21,27,0.6),-14px_-14px_28px_rgba(47,51,69,0.3)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[inset_7px_7px_14px_rgba(20,21,27,0.5),inset_-7px_-7px_14px_rgba(47,51,69,0.25)] active:translate-y-0.5 active:shadow-[inset_10px_10px_18px_rgba(20,21,27,0.6),inset_-10px_-10px_18px_rgba(47,51,69,0.3)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {inquiryForm.isSubmitting ? "Sending…" : "Transmit Message"}{" "}
                    <LuArrowUpRight className="transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-1" />
                  </button>
                </form>
              </section>
            )}
          </div>
        </div>

        <footer
          className={`py-14 text-center text-[10px] tracking-[0.3em] uppercase text-[#98A6C8] font-(--font-mono)`}
        >
          POWERED BY ONTAP CREATIVES
        </footer>
      </div>

      {showFAB && !mini && (
        <FloatingContactWidget data={d as any} accent="#7AA2FF" qrUrl={qrUrl} />
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
    </div>
  );
}