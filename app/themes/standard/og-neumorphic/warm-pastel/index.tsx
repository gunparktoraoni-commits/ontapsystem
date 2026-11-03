"use client";

// NOTE: Data fields with no explicit display element in this template:
// - videos: this colorway variant does not include a dedicated video player section
// - some service video fields (videoUrl/videoFile) are not surfaced here
// - vcard.languages and postNominalLetters are not displayed

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  LuArrowUpRight,
  LuChevronLeft,
  LuChevronRight,
} from "react-icons/lu";
import type { PortfolioViewProps } from "../../../shared";
import {
	getDisplayName,
	getCoverImageOrNull,
	PortfolioCoverMedia,
	getInitials,
	buildGalleryItems,
	buildVideoItems,
	buildServiceMediaItems,
	FloatingContactWidget,
	isGalleryEnabled,
	isInquiryEnabled,
	usePortfolioInquiryForm,
	PortfolioAddressSection,
  hasPortfolioLocation,
	resolvePortfolioData,
	SocialIcon,
	PORTFOLIO_SOCIAL_ICON_SIZE,
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

const shellBg = `
relative overflow-hidden
bg-[#ECE7E1]
text-[#111318]
before:pointer-events-none before:absolute before:inset-0 before:content-['']
before:bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.96),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(200,193,184,0.42),transparent_28%),linear-gradient(180deg,#F3EEE8,#ECE7E1)]
after:pointer-events-none after:absolute after:inset-0 after:content-['']
after:bg-[url("data:image/svg+xml;base64,PHN2ZyB3aWR0aD0nMTIwJyBoZWlnaHQ9JzEyMCcgdmlld0JveD0nMCAwIDEyMCAxMjAnIHhtbG5zPSdodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Zyc+PGZpbHRlciBpZD0nbic+PGZlVHVyYnVsZW5jZSB0eXBlPSdmcmFjdGFsTm9pc2UnIGJhc2VGcmVxdWVuY3k9JzAuODUnIG51bU9jdGF2ZXM9JzMnIHN0aXRjaFRpbGVzPSdzdGl0Y2gnLz48L2ZpbHRlcj48cmVjdCB3aWR0aD0nMTIwJyBoZWlnaHQ9JzEyMCcgZmlsdGVyPSd1cmwoI24pJyBvcGFjaXR5PScwLjAzNScvPjwvc3ZnPg==")]
after:opacity-60
`;

const neoPanel = `
relative
rounded-3xl
border border-white/80
bg-[linear-gradient(145deg,rgba(255,255,255,0.94),rgba(243,238,232,0.72))]
backdrop-blur-2xl
shadow-[28px_28px_56px_rgba(200,193,184,0.54),-22px_-22px_46px_rgba(255,255,255,0.98),inset_1px_1px_0_rgba(255,255,255,0.96)]
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
      card.style.transform =
        "perspective(1200px) rotateX(0deg) rotateY(0deg) translateY(0px)";
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
      className={`${neoPanel} group transition-all duration-500 overflow-hidden p-4 ${
        !isMobile && "md:p-5"
      } will-change-transform`}
    >
      <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.7),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(200,193,184,0.45),transparent_30%)]" />
      <div className="relative overflow-hidden rounded-[18px]">
        {mediaItems.length > 0 ? (
          <ServiceMediaCarousel
            items={mediaItems}
            accent="#404856"
            glass="rgba(255,255,255,0.5)"
            textMuted="#6d7481"
            mini={false}
            variant="warm-pastel"
          />
        ) : image ? (
          <Image
            src={image}
            alt={title}
            width={1000}
            height={1000}
            className="aspect-16/10 w-full object-contain object-center transition-transform duration-700 group-hover:scale-105"
            draggable={false}
          />
        ) : (
          <div className="aspect-16/10 w-full flex items-center justify-center bg-white/30 text-4xl font-(--font-display) text-[#6d7481]">
            {String(index + 1).padStart(2, "0")}
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(249,246,244,0.98),rgba(255,255,255,0.16))]" />
      </div>
      <div className="pt-6 relative">
        <h3 className="font-(--font-display) text-[1.85rem] leading-none tracking-tight text-[#14171d] mb-3">
          {title}
        </h3>
        <p className="text-[#525866] leading-relaxed text-[13px] font-(--font-mono)">
          <RichText html={desc} />
        </p>
      </div>
    </div>
  );
};

export default function WarmPastel({
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
    .filter((s) => Boolean(String(s.title ?? (s as any).name ?? "").trim()))
    .map((s) => ({
      title: String(s.title ?? (s as any).name ?? "").trim(),
      desc: String(s.description ?? (s as any).tagline ?? "").trim(),
      image: String((s as any).featured_image ?? (s as any).image ?? "").trim(),
      media: (s as any).media || [],
      videoUrl: String((s as any).videoUrl ?? "").trim() || undefined,
      videoFile: (s as any).videoFile ?? null,
    }))
    .filter((s) => s.title);
  const galleryItems = buildGalleryItems(d);
  const videos = buildVideoItems(d);

  const [servicePage, setServicePage] = useState(0);
  const servicesPerPage = 4;

  const visibleServices = serviceList.slice(
    servicePage * servicesPerPage,
    (servicePage + 1) * servicesPerPage
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
    cardBg: "#F3EEE8",
    text: "#111318",
    muted: "#6d7481",
    accent: "#404856",
    border: "rgba(255,255,255,0.8)",
    headerGrad: "linear-gradient(145deg,#fff,#f6f0e8)",
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
      className={`${shellBg} min-h-screen overflow-x-hidden selection:bg-black selection:text-white`}
    >
      <style jsx global>{`
        html {
          scroll-behavior: smooth;
        }
        body {
          background: #ece7e1;
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

      <div className="absolute top-24 -left-30 w-85 h-85 rounded-full bg-white/50 blur-[90px]" />
      <div className="absolute bottom-0 -right-30 w-100 h-100 rounded-full bg-[#ECE7E1]/40 blur-[120px]" />

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
                style={{ opacity: 0.28 }}
              />
              <div className="absolute inset-0 bg-[linear-gradient(145deg,rgba(255,247,241,0.72),rgba(255,231,237,0.58),rgba(255,246,214,0.7))]" />
            </>
          ) : null}
          <div className="absolute top-0 right-0 w-80 h-80 rounded-full bg-white/60 blur-[100px]" />
          <div
            className={`grid ${!isMobile && "lg:grid-cols-[2fr_0.85fr]"} gap-12 items-center relative z-10`}
          >
            <div className="relative">
              <div className="absolute -inset-6 rounded-[28px] bg-white/55 blur-3xl" />
              <div className="relative rounded-[28px] p-3 bg-[linear-gradient(145deg,rgba(255,255,255,0.9),rgba(243,238,232,0.78))] border border-white/80 shadow-[24px_24px_54px_rgba(200,193,184,0.48),-24px_-24px_54px_rgba(255,255,255,0.98)]">
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
                    <div className="flex h-full w-full items-center justify-center bg-white/30 text-4xl font-(--font-display) text-[#404856]">
                      {getInitials(d)}
                    </div>
                  )}
                  <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(243,238,232,0.95),transparent_45%)]" />
                </div>
              </div>
            </div>

            <div className="min-w-0">
              <h1
                className={`font-(--font-display) break-words text-[2rem] ${!isMobile && "md:text-[6rem]"} leading-[0.88] tracking-[-0.04em] text-[#101217]`}
              >
                {firstName + " " + lastName}
              </h1>
              <div className="mt-8 w-full min-w-0">
                <PortfolioActionButtons
                  data={d}
                  shareUrl={shareUrl}
                  theme={{ accent: '#404856', text: '#111318', surface: 'rgba(255,255,255,0.94)', border: 'rgba(255,255,255,0.8)' }}
                  layout="row"
                  compact={mini}
                />
              </div>
              <PortfolioSocialProof
                data={d}
                mini={mini}
                className="mt-6 w-full min-w-0"
                theme={{
                  surface: 'rgba(255,255,255,0.88)',
                  border: 'rgba(255,255,255,0.9)',
                  text: '#111318',
                  muted: '#7a828f',
                  accent: '#404856',
                  accentSoft: 'rgba(64,72,86,0.08)',
                  divider: 'rgba(200,193,184,0.4)',
                  shadow: '18px 18px 36px rgba(200,193,184,0.4), -18px -18px 36px rgba(255,255,255,0.95)',
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
                  <h3 className="text-[1.5rem] leading-none font-(--font-display) text-[#13161c]">
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
                      className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-white/45 border border-white/80 backdrop-blur-xl shadow-[6px_6px_14px_rgba(174,183,196,0.3),-6px_-6px_14px_rgba(255,255,255,0.9)] transition-all hover:-translate-y-0.5 hover:scale-105 text-[#181b22]"
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
                  <h3 className="text-[1.5rem] leading-none font-(--font-display) text-[#13161c]">
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
                      className="inline-flex max-w-full items-center gap-2 rounded-full px-4 py-2 bg-white/45 border border-white/80 backdrop-blur-xl shadow-[6px_6px_14px_rgba(174,183,196,0.3),-6px_-6px_14px_rgba(255,255,255,0.9)] transition-all hover:-translate-y-0.5 text-[#181b22] text-[14px] font-(--font-mono)"
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
                  <h2 className="text-[1.5rem] leading-none font-(--font-display) text-[#12151b]">
                  </h2>
                </div>
                <p className="text-[#4e5563] leading-[1.9] text-[15px] font-(--font-mono)">
                  <RichText html={aboutText} />
                </p>
              </section>
            ) : null}

            {serviceList.length > 0 ? (
            <section className="fade-up delay-2">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-[1.5rem] leading-none font-(--font-display) text-[#101318]">
                    Services
                  </h2>
                </div>
                <div className="flex flex-wrap gap-3">
                  {!isMobile && serviceList.length > 1 ? (
                    <>
                      <button
                        data-cursor-hover
                        onClick={() => setServicePage((p) => Math.max(p - 1, 0))}
                        className="w-14 h-14 rounded-2xl bg-white/50 border border-white/80 flex items-center justify-center shadow-[8px_8px_18px_rgba(174,183,196,0.3),-8px_-8px_18px_rgba(255,255,255,0.92)] transition-all"
                      >
                        <LuChevronLeft />
                      </button>
                      <button
                        data-cursor-hover
                        onClick={() =>
                          setServicePage((p) =>
                            Math.min(
                              p + 1,
                              Math.ceil(serviceList.length / servicesPerPage) - 1
                            )
                          )
                        }
                        className="w-14 h-14 rounded-2xl bg-white/50 border border-white/80 flex items-center justify-center shadow-[8px_8px_18px_rgba(174,183,196,0.3),-8px_-8px_18px_rgba(255,255,255,0.92)] transition-all"
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
                  <h2 className="text-[1.5rem] leading-none font-(--font-display) text-[#111318]">
                    Featured Gallery
                  </h2>
                </div>
                <div
                  className="min-w-0 w-full touch-pan-x"
                  style={{ WebkitOverflowScrolling: "touch" }}
                >
                  <GalleryCarousel
                    items={galleryItems}
                    accent="#404856"
                    glass="rgba(255,255,255,0.5)"
                    textMuted="#6d7481"
                    mini={mini}
                    variant="warm-pastel"
                  />
                </div>
              </section>
            )}

            {isGalleryEnabled(d, mini) && videos.length > 0 && (
              <section className="fade-up delay-4 min-w-0">
                <div className="mb-6">
                  <p className="text-[10px] tracking-[0.3em] uppercase text-[#7a828f] font-(--font-mono) mb-2">
                    Motion
                  </p>
                  <h2 className="text-[1.5rem] leading-none font-(--font-display) text-[#111318]">
                    Videos
                  </h2>
                </div>
                <div
                  className="min-w-0 w-full touch-pan-x"
                  style={{ WebkitOverflowScrolling: "touch" }}
                >
                  <VideoCarousel
                    items={videos}
                    accent="#404856"
                    glass="rgba(255,255,255,0.5)"
                    textMuted="#6d7481"
                    mini={mini}
                    variant="warm-pastel"
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
                  <p className="text-[10px] tracking-[0.3em] uppercase text-[#7b8390] font-(--font-mono) mb-2">
                    Initiate Inquiry
                  </p>
                  <h3 className="text-[1.5rem] leading-none font-(--font-display) text-[#12151c]">
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
                      className="w-full rounded-3xl border border-white/80 bg-white/45 px-4 py-3.5 font-(--font-mono) text-[15px] text-[#111318] placeholder:text-[#6d7481]/85 shadow-[10px_10px_22px_rgba(174,183,196,0.34),-10px_-10px_22px_rgba(255,255,255,0.98)] backdrop-blur-xl outline-none transition-all duration-300 focus:bg-white/55 focus:translate-y-0.5 focus:scale-[0.996] focus:shadow-[inset_5px_5px_12px_rgba(174,183,196,0.26),inset_-5px_-5px_12px_rgba(255,255,255,0.98)]"
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
                      className="w-full rounded-3xl border border-white/80 bg-white/45 px-4 py-3.5 font-(--font-mono) text-[15px] text-[#111318] placeholder:text-[#6d7481]/85 shadow-[10px_10px_22px_rgba(174,183,196,0.34),-10px_-10px_22px_rgba(255,255,255,0.98)] backdrop-blur-xl outline-none transition-all duration-300 focus:bg-white/55 focus:translate-y-0.5 focus:scale-[0.996] focus:shadow-[inset_5px_5px_12px_rgba(174,183,196,0.26),inset_-5px_-5px_12px_rgba(255,255,255,0.98)]"
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
                      className="w-full rounded-3xl border border-white/80 bg-white/45 px-4 py-3.5 font-(--font-mono) text-[15px] text-[#111318] placeholder:text-[#6d7481]/85 shadow-[10px_10px_22px_rgba(174,183,196,0.34),-10px_-10px_22px_rgba(255,255,255,0.98)] backdrop-blur-xl outline-none transition-all duration-300 focus:bg-white/55 focus:translate-y-0.5 focus:scale-[0.996] focus:shadow-[inset_5px_5px_12px_rgba(174,183,196,0.26),inset_-5px_-5px_12px_rgba(255,255,255,0.98)]"
                    />
                  </div>
                  <div>
                    <textarea
                      placeholder="Message Details"
                      aria-label="Message Details"
                      id="message"
                      value={inquiryForm.fields.message}
                      onChange={(e) => inquiryForm.setField("message", e.target.value)}
                      className="w-full rounded-3xl border border-white/80 bg-white/45 px-4 py-3.5 font-(--font-mono) text-[15px] text-[#111318] placeholder:text-[#6d7481]/85 shadow-[10px_10px_22px_rgba(174,183,196,0.34),-10px_-10px_22px_rgba(255,255,255,0.98)] backdrop-blur-xl outline-none transition-all duration-300 resize-none min-h-35"
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
                    className="w-full group flex items-center justify-center gap-3 rounded-full border border-white/80 bg-[linear-gradient(145deg,#fff,#f6f0e8)] px-6 py-3.5 text-[11px] uppercase tracking-[0.25em] font-(--font-mono) text-[#101217] shadow-[14px_14px_28px_rgba(171,181,195,0.5),-14px_-14px_28px_rgba(255,255,255,0.98)] transition-all duration-300 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {inquiryForm.isSubmitting ? "Sending…" : "Transmit Message"}{" "}
                    <LuArrowUpRight className="transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-1" />
                  </button>
                </form>
              </section>
            )}
          </div>
        </div>

        <footer className="py-14 text-center text-[10px] tracking-[0.3em] uppercase text-[#79808d] font-(--font-mono)">
          POWERED BY ONTAP CREATIVES
        </footer>
      </div>

      {showFAB && !mini && (
        <FloatingContactWidget data={d as any} accent="#101217" qrUrl={qrUrl} />
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