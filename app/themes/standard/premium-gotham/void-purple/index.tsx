"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import {
	LuUserRoundPlus,
	LuChevronLeft,
	LuChevronRight,
	LuArrowUpRight,
	LuBadgeCheck,
} from "react-icons/lu";
import {
	type PortfolioViewProps,
	buildGalleryItems,
	buildVideoItems,
	buildContactLinks,
	getDisplayName,
	getCoverImageOrNull,
	PortfolioCoverMedia,
	getInitials,
	getProfileImageOrNull,
	isGalleryEnabled,
	isInquiryEnabled,
	usePortfolioInquiryForm,
	usePortfolioViewerSession,
	PortfolioAddressSection,
  hasPortfolioLocation,
	PortfolioAssociateButton,
	resolvePortfolioData,
	FloatingContactWidget,
	SocialIcon,
	PORTFOLIO_SOCIAL_ICON_SIZE,
	GalleryCarousel,
	VideoCarousel,
	ServiceMediaCarousel,
	ServicesScrollContainer,
	buildServiceMediaItems,
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

interface ServiceProductCardProps {
	title: string;
	description: string;
	imageSrc: string;
	media?: any[];
	videoUrl?: string;
	videoFile?: string | null;
	index: number;
	isMobile?: boolean;
}

function clean(value: string | null | undefined): string {
	const normalized = String(value ?? "").trim();
	const lower = normalized.toLowerCase();
	// Filter out empty strings, 'n/a', 'na', 'none', and empty HTML tags like <p><br></p>
	if (!normalized || lower === "n/a" || lower === "na" || lower === "none") return "";
	if (lower === "<p><br></p>" || lower === "<p><br /></p>") return "";
	return normalized;
}

function profTitle(
	data: PortfolioViewProps["data"] extends infer U ? NonNullable<U> : never
): string {
	return clean(data.vcard.professionalTitle) || clean(data.bizCard.occupation);
}

function toHttp(raw: string): string {
	const value = clean(raw);
	if (!value) return "";
	if (/^https?:\/\//i.test(value)) return value;
	if (/^[a-z0-9.-]+\.[a-z]{2}(\/|$)/i.test(value)) return `https://${value}`;
	return "";
}

function SectionHeading({
	eyebrow,
	title,
	note,
	isMobile = false,
	className = "",
}: {
	eyebrow: string;
	title: string;
	note?: string;
	isMobile?: boolean;
	className?: string;
}) {
	const hasTitle = Boolean(title?.trim());
	const hasMarginOverride = /\bmb-/.test(className);
	return (
		<div
			className={[
				"flex flex-wrap items-end justify-between gap-4",
				!hasMarginOverride && (hasTitle ? "mb-6" : "mb-4"),
				className,
			]
				.filter(Boolean)
				.join(" ")}
		>
			<div className="min-w-0">
				<p className="text-[10px] uppercase tracking-[0.42em] text-[#C9C9D1]/70">
					{eyebrow}
				</p>
				{hasTitle ? (
					<h2
						className={`mt-2 font-semibold text-[#F5F0FF] ${
							isMobile ? "text-xl" : "text-2xl"
						}`}
					>
						{title}
					</h2>
				) : null}
			</div>
			{note ? (
				<p
					className={`text-xs uppercase tracking-[0.28em] text-[#8f8980] ${!isMobile && "hidden md:block"
						}`}
				>
					{note}
				</p>
			) : null}
		</div>
	);
}

function StatChip({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 backdrop-blur-md">
			<div className="flex items-baseline gap-2 text-sm text-[#F5F0FF]">
				<span className="font-semibold">{value}</span>
				<span className="uppercase tracking-[0.32em] text-[#8f8980]">
					{label}
				</span>
			</div>
		</div>
	);
}

function ActionButton({
	children,
	secondary = false,
	...props
}: {
	children: ReactNode;
	secondary?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
	return (
		<button
			{...props}
			className={[
				"group inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-medium transition duration-300 active:scale-[0.98]",
				secondary
					? "border border-white/10 bg-white/5 text-[#F5F0FF] hover:bg-white/10 hover:border-white/15"
					: "bg-[#6D28D9] text-[#F5F0FF] hover:bg-[#7C3AED] shadow-[0_0_16px_rgba(109,40,217,0.22)]",
			].join(" ")}
		>
			{children}
			<LuArrowUpRight className="text-base transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
		</button>
	);
}

const ServiceProductCard = ({
	title,
	description,
	imageSrc,
	media = [],
	videoUrl,
	videoFile,
	index,
	isMobile = false,
}: ServiceProductCardProps) => {
	const [expanded, setExpanded] = useState(false);
	const [needsToggle, setNeedsToggle] = useState(false);
	const descRef = useRef<HTMLParagraphElement>(null);
	const mediaItems = buildServiceMediaItems({ featured_image: imageSrc, videoUrl, videoFile }, media);
	const descriptionText = String(description ?? "").trim();

	useLayoutEffect(() => {
		const el = descRef.current;
		if (!el || !descriptionText) {
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
	}, [descriptionText, expanded, isMobile]);

	return (
		<article className="group overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#111215] shadow-[0_20px_60px_rgba(0,0,0,0.35)] transition-all duration-500 hover:-translate-y-1">
			<div className="relative w-full overflow-hidden">
				{mediaItems.length > 0 ? (
          <ServiceMediaCarousel
						items={mediaItems}
						accent="#6D28D9"
						glass="rgba(255,255,255,0.02)"
						textMuted="#8f8980"
						mini={false}
						variant="void-purple"
					/>
        ) : imageSrc ? (
					<Image
						height={1024}
						width={1024}
						alt={title}
						src={imageSrc}
						className="h-full w-full object-contain object-center opacity-70 transition duration-700 group-hover:scale-[1.05]"
						draggable={false}
					/>
				) : (
					<div className="flex h-full w-full items-center justify-center bg-[#1a1035] text-4xl font-semibold text-[#6D28D9]">
						{String(index + 1).padStart(2, "0")}
					</div>
				)}
				<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(109,40,217,0.18),transparent_30%),linear-gradient(180deg,rgba(0,0,0,0.15),rgba(0,0,0,0.7))]" />
				<div className="pointer-events-none absolute left-4 top-4 rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[10px] uppercase tracking-[0.28em] text-[#F5F0FF] backdrop-blur-md">
					{String(index + 1).padStart(2, "0")}
				</div>
			</div>
			<div className={`p-5 ${!isMobile && "md:p-6"}`}>
				<div className="mb-4 flex items-center justify-between gap-4">
					<h3 className="text-xl font-semibold text-[#F5F0FF]">{title}</h3>
					<div className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[#6D28D9]">
						<LuBadgeCheck className="text-sm" />
					</div>
				</div>
				{descriptionText ? (
					<p
						ref={descRef}
						className={
							expanded
								? "text-sm leading-7 text-[#D4C6F7]"
								: "text-sm leading-7 text-[#D4C6F7] line-clamp-3"
						}
					>
						<RichText html={description} />
					</p>
				) : null}
				{needsToggle ? (
					<button
						type="button"
						onClick={() => setExpanded((value) => !value)}
						className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-[#6D28D9] hover:text-[#7C3AED]"
						aria-expanded={expanded}
					>
						{expanded ? "Collapse" : "Read more"}
						<LuArrowUpRight className="text-sm" />
					</button>
				) : null}
			</div>
		</article>
	);
};

export default function VoidPurple({
	data,
	mini = false,
	showFAB = false,
	isMobile = false,
}: PortfolioViewProps) {
	const [servicePage, setServicePage] = useState(0);

	const d = resolvePortfolioData(data);
	const inquiryForm = usePortfolioInquiryForm({ urlAlias: d.bizCard.urlAlias, mini });
	const name = getDisplayName(d);
	const title = profTitle(d);
	const aboutCopy = clean(d.vcard.about) || clean(d.bizCard.description) || "";
	const coverImage = getCoverImageOrNull(d);
	const profileImage = getProfileImageOrNull(d);
	const initials = getInitials(d);

	// Authentication gating
	const session = usePortfolioViewerSession();

	// Build data from shared helpers
	const galleryItems = buildGalleryItems(d);
	const videos = buildVideoItems(d);
	const contactLinks = buildContactLinks(d);

	// Services data with media
	const serviceSource = (d.services ?? [])
		.map((s) => ({
			title: clean(s.title) || clean((s as any).name),
			description: clean(s.description) || clean((s as any).tagline),
			imageSrc: clean((s as any).featured_image) || clean((s as any).image),
			media: (s as any).media || [],
			videoUrl: clean((s as any).videoUrl) || undefined,
			videoFile: (s as any).videoFile ?? null,
		}))
		.filter((s) => s.title);

	const SERVICES_PER_PAGE = 4;
	const currentServices = serviceSource.slice(
		servicePage * SERVICES_PER_PAGE,
		(servicePage + 1) * SERVICES_PER_PAGE
	);

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
		bg: "#0B0C0D",
		surface: "#111215",
		text: "#F5F0FF",
		muted: "#8f8980",
		accent: "#6D28D9",
		border: "rgba(255,255,255,0.1)",
	});

	// Pagination handlers
	const handlePrevService = () => setServicePage((p) => Math.max(p - 1, 0));
	const handleNextService = () =>
		setServicePage((p) =>
			Math.min(p + 1, Math.ceil(serviceSource.length / SERVICES_PER_PAGE) - 1)
		);

	return (
		<div
			className={`min-h-screen w-full overflow-x-hidden bg-[#0B0C0D] text-[#F5F0FF] selection:bg-[#6D28D9]/30 selection:text-[#F5F0FF] ${
				showFAB && !mini ? "pb-28" : ""
			}`}
		>
			<div className="pointer-events-none fixed inset-0 overflow-hidden">
				<div className="absolute -top-40 left-1/2 h-152 w-152 -translate-x-1/2 rounded-full bg-[#6D28D9]/10 blur-[120px]" />
				<div className="absolute left-[10%] top-[18%] h-72 w-72 rounded-full bg-[#C9C9D1]/10 blur-[100px]" />
				<div className="absolute right-[5%] top-[40%] h-104 w-104 rounded-full bg-[#C9C9D1]/8 blur-[120px]" />
			</div>

			<div
				className={`relative mx-auto max-w-7xl px-4 py-6 ${!isMobile && "sm:px-6 md:py-10 lg:px-8"
					}`}
			>
				<div className={`grid grid-cols-1 gap-6 ${!isMobile && "gap-8 lg:grid-cols-12"}`}>
					<div className={`min-w-0 space-y-6 ${!isMobile && "space-y-8 lg:col-span-8"}`}>
						{/* Hero Card - Cover only */}
						<section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(11,12,13,0.9))] shadow-[0_30px_100px_rgba(0,0,0,0.35)]">
							<div
								className={`relative h-48 w-full overflow-hidden ${!isMobile && "sm:h-56"
									}`}
							>
								{coverImage ? (
									<PortfolioCoverMedia
										src={coverImage}
										coverType={d.bizCard.coverType}
										alt="Cover art"
										className="h-full w-full object-cover object-center opacity-45"
									/>
								) : (
									<div className="h-full w-full bg-[linear-gradient(135deg,#1a1035,#0B0C0D)] opacity-80" />
								)}
								<div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(11,12,13,0.1),rgba(11,12,13,0.96))]" />
							</div>

							{/* Profile positioned below cover */}
							<div
								className={`relative -mt-16 px-5 pb-5 ${!isMobile && "sm:-mt-20 sm:px-8 sm:pb-8"
									}`}
							>
								<div className="relative z-10 flex w-full min-w-0 flex-col items-start">
									{profileImage ? (
										<Image
											height={500}
											width={500}
											alt={`Profile picture of ${name}`}
											src={profileImage}
											className={`relative z-10 h-28 w-28 shrink-0 rounded-full border border-white/10 object-cover object-center shadow-[0_18px_60px_rgba(0,0,0,0.45)] ${!isMobile && "sm:h-36 sm:w-36"
												}`}
											draggable={false}
										/>
									) : (
										<div
											className={`relative z-10 flex h-28 w-28 shrink-0 items-center justify-center rounded-full border-2 border-white/10 bg-[#1a1035] text-2xl font-semibold text-[#D4C6F7] shadow-[0_18px_60px_rgba(0,0,0,0.45)] ${!isMobile && "sm:h-36 sm:w-36"
												}`}
										>
											{initials}
										</div>
									)}
									<div
										className={`mt-3 flex w-full min-w-0 flex-col gap-5 ${!isMobile && "lg:flex-row lg:items-end lg:justify-between lg:gap-6"
											}`}
									>
										<div className="min-w-0 pb-1">
											<p className="mb-2 text-[10px] uppercase tracking-[0.42em] text-[#C9C9D1]">
												{title || "Portfolio Identity"}
											</p>
											<h1
												className={`break-words text-3xl font-semibold tracking-[-0.04em] text-[#F5F0FF] ${!isMobile && "sm:text-5xl"
													}`}
											>
												{name}
											</h1>
										</div>

										<div className="flex w-full min-w-0 flex-wrap items-center justify-center gap-3 lg:w-auto lg:flex-1">
											<PortfolioActionButtons
												data={d}
												shareUrl={shareUrl}
												theme={{
													accent: '#6D28D9',
													text: '#F5F0FF',
													surface: '#111215',
													border: 'rgba(255,255,255,0.1)',
												}}
												layout="row"
												compact={mini}
											/>
										</div>
									</div>
									<PortfolioSocialProof
										data={d}
										mini={mini}
										className="mt-5 w-full min-w-0"
										theme={{
											surface: '#111215',
											border: 'rgba(109,40,217,0.28)',
											text: '#F5F0FF',
											muted: '#C4B5FD',
											accent: '#C4B5FD',
											accentSoft: 'rgba(109,40,217,0.18)',
											divider: 'rgba(255,255,255,0.1)',
											shadow: '0 18px 50px rgba(0,0,0,0.4)',
											radius: '18px',
										}}
									/>
								</div>
							</div>
						</section>

						{/* Socials Card */}
						{contactLinks.some((link) => link.kind === "social") && (
							<div className={`rounded-[2rem] border border-white/10 bg-[#0F1112] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.35)] ${!isMobile && "sm:p-6"}`}>
								<SectionHeading
									isMobile={isMobile}
									eyebrow="Socials"
									title=""
								/>
								<div className="space-y-3">
									{!contactLinks.some((link) => link.kind === "contact") && session.checked && session.isAuthenticated ? (
										<PortfolioAssociateButton
											urlAlias={d.bizCard.urlAlias}
											icon={<LuUserRoundPlus className="h-4 w-4" />}
											label="Connect"
											className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-[#6D28D9] px-4 py-3 text-sm font-medium text-[#F5F0FF] transition hover:bg-[#7C3AED] disabled:cursor-not-allowed disabled:opacity-60"
										/>
									) : null}
									<div className="flex flex-wrap justify-start gap-2">
										{contactLinks.filter((link) => link.kind === "social").map((link, i) => (
											<a
												key={`social-${i}`}
												href={link.url}
												target="_blank"
												rel="noopener noreferrer"
												title={getContactLinkAriaLabel(link)}
												aria-label={getContactLinkAriaLabel(link)}
												className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/10 transition hover:bg-white/15 hover:scale-105"
											>
												<SocialIcon platform={link.platform} size={PORTFOLIO_SOCIAL_ICON_SIZE} />
											</a>
										))}
									</div>
								</div>
							</div>
						)}

						{/* Contact Card */}
						{contactLinks.some((link) => link.kind === "contact") && (
							<div className={`rounded-[2rem] border border-white/10 bg-[#0F1112] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.35)] ${!isMobile && "sm:p-6"}`}>
								<SectionHeading
									isMobile={isMobile}
									eyebrow="Contact"
									title=""
								/>
								<div className="space-y-2.5">
									{contactLinks.filter((link) => link.kind === "contact").map((link, i) => (
										<a
											key={i}
											href={link.url}
											target="_self"
											rel="noopener noreferrer"
											title={getContactLinkAriaLabel(link)}
											aria-label={getContactLinkAriaLabel(link)}
											className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 transition hover:bg-white/10"
										>
											<span className="shrink-0">
												<SocialIcon platform={link.platform} size={PORTFOLIO_SOCIAL_ICON_SIZE} />
											</span>
											<ContactLinkLabel link={link} className="min-w-0 truncate text-sm text-[#D4C6F7]" />
										</a>
									))}
									{session.checked && session.isAuthenticated && (
										<PortfolioAssociateButton
											urlAlias={d.bizCard.urlAlias}
											icon={<LuUserRoundPlus className="h-4 w-4" />}
											label="Connect"
											className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-[#6D28D9] px-4 py-3 text-sm font-medium text-[#F5F0FF] transition hover:bg-[#7C3AED] disabled:cursor-not-allowed disabled:opacity-60"
										/>
									)}
								</div>
							</div>
						)}


						{/* About Section - Separate */}
						{aboutCopy &&
							<section className={`grid gap-4 ${!isMobile && "md:grid-cols-1"}`}>
								<div className={`rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.28)] ${!isMobile && "sm:p-6"}`}>
									<SectionHeading
										isMobile={isMobile}
										eyebrow=""
										title=""
									/>
									<p
										className={`max-w-3xl text-sm leading-7 text-[#D4C6F7] ${!isMobile && "sm:text-[15px] sm:leading-8"
											}`}
									>
										<RichText html={aboutCopy} />
									</p>
								</div>
							</section>
						}

						{/* Services Section */}
						{d.services.length > 0 &&
							<section className={`rounded-[2rem] border border-white/10 bg-[#111215] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.3)] ${!isMobile && "sm:p-6"}`}>
								<div className="mb-5 flex items-center justify-between gap-4">
									<SectionHeading
										isMobile={isMobile}
										eyebrow="Services"
										title=""
										className="mb-0"
									/>
									{!isMobile && serviceSource.length > 1 ? (
										<div className="flex items-center gap-2">
											<button
												type="button"
												aria-label="Previous" onClick={handlePrevService}
												disabled={servicePage === 0}
												className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[#D4C6F7] transition hover:border-[#6D28D9]/35 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
											>
												<LuChevronLeft />
											</button>
											<button
												type="button"
												aria-label="Next" onClick={handleNextService}
												disabled={
													(servicePage + 1) * SERVICES_PER_PAGE >=
													serviceSource.length
												}
												className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[#D4C6F7] transition hover:border-[#6D28D9]/35 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
											>
												<LuChevronRight />
											</button>
										</div>
									) : null}
								</div>

								<ServicesScrollContainer
									isMobile={isMobile}
									mini={mini}
									desktopClassName={`grid gap-5 ${!isMobile && "md:grid-cols-2"}`}
								>
									{(isMobile && !mini ? serviceSource : currentServices).map((service, index) => (
										<ServiceProductCard
											key={service.title}
											index={index}
											title={service.title}
											description={service.description}
											imageSrc={service.imageSrc}
											media={service.media} videoUrl={service.videoUrl} videoFile={service.videoFile}
											isMobile={isMobile}
										/>
									))}
								</ServicesScrollContainer>
							</section>
						}


						{/* Gallery */}
						{isGalleryEnabled(d, mini) && galleryItems.length > 0 && (
							<section className={`min-w-0 rounded-[2rem] border border-white/10 bg-[#111215] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.3)] ${!isMobile && "sm:p-6"}`}>
								<SectionHeading
									isMobile={isMobile}
									eyebrow="Featured Gallery"
									title=""
								/>
								<div className="min-w-0 w-full">
									<GalleryCarousel
										items={galleryItems}
										accent="#6D28D9"
										glass="rgba(255,255,255,0.02)"
										textMuted="#8f8980"
										mini={mini}
										variant="void-purple"
									/>
								</div>
							</section>
						)}

						{/* Videos */}
						{isGalleryEnabled(d, mini) && videos.length > 0 && (
							<section className={`min-w-0 rounded-[2rem] border border-white/10 bg-[#111215] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.3)] ${!isMobile && "sm:p-6"}`}>
								<SectionHeading
									isMobile={isMobile}
									eyebrow="Motion"
									title="Video highlights"
									note="Curated clips"
								/>
								<div
									className="min-w-0 w-full touch-pan-x"
									style={{ WebkitOverflowScrolling: "touch" }}
								>
									<VideoCarousel
										items={videos}
										accent="#6D28D9"
										glass="rgba(255,255,255,0.02)"
										textMuted="#8f8980"
										mini={mini}
										variant="void-purple"
									/>
								</div>
							</section>
						)}

						{hasPortfolioLocation(d.vcard) && (
							<PortfolioAddressSection
								vcard={d.vcard}
								mini={mini}
								theme={{
									cardBg: "#0F1112",
									text: "#F5F5F5",
									textMuted: "#8f8980",
									accent: "#E6F7FF",
								}}
							/>
						)}

					</div>

					<aside
						className={`min-w-0 space-y-6 self-start ${!isMobile && "lg:col-span-4 lg:sticky lg:top-8"
							}`}
					>
						{/* Inquiry */}
						{isInquiryEnabled(d, mini) && (
							<div className={`rounded-[2rem] border border-white/10 bg-[#0F1112] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.35)] ${!isMobile && "sm:p-6"}`}>
								<SectionHeading
									isMobile={isMobile}
									eyebrow="Inquiry"
									title="Send a message"
								/>
								<form className="space-y-4" onSubmit={inquiryForm.handleSubmit}>
									<input
										type="text"
										placeholder="Name"
										value={inquiryForm.fields.name}
										onChange={(e) =>
											inquiryForm.setField("name", e.target.value)
										}
										className="w-full rounded-2xl border border-white/10 bg-[#111215] px-4 py-3 text-sm text-[#F5F0FF] placeholder:text-[#8f8980] outline-none focus:border-[#6D28D9]/50 focus:ring-2 focus:ring-[#6D28D9]/15"
									/>
									<input
										type="email"
										placeholder="Email Address"
										value={inquiryForm.fields.email}
										onChange={(e) =>
											inquiryForm.setField("email", e.target.value)
										}
										className="w-full rounded-2xl border border-white/10 bg-[#111215] px-4 py-3 text-sm text-[#F5F0FF] placeholder:text-[#8f8980] outline-none focus:border-[#6D28D9]/50 focus:ring-2 focus:ring-[#6D28D9]/15"
									/>
									<input
										type="text"
										placeholder="Subject"
										value={inquiryForm.fields.subject}
										onChange={(e) =>
											inquiryForm.setField("subject", e.target.value)
										}
										className="w-full rounded-2xl border border-white/10 bg-[#111215] px-4 py-3 text-sm text-[#F5F0FF] placeholder:text-[#8f8980] outline-none focus:border-[#6D28D9]/50 focus:ring-2 focus:ring-[#6D28D9]/15"
									/>
									<textarea
										rows={5}
										placeholder="How can we help?"
										value={inquiryForm.fields.message}
										onChange={(e) =>
											inquiryForm.setField("message", e.target.value)
										}
										className="w-full resize-none rounded-2xl border border-white/10 bg-[#111215] px-4 py-3 text-sm text-[#F5F0FF] placeholder:text-[#8f8980] outline-none focus:border-[#6D28D9]/50 focus:ring-2 focus:ring-[#6D28D9]/15"
									/>
									{inquiryForm.fieldError && (
										<p className="text-sm text-red-600" role="alert">
											{inquiryForm.fieldError}
										</p>
									)}
									<button
										type="submit"
										disabled={inquiryForm.isSubmitting}
										className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#6D28D9] px-5 py-3 text-sm font-medium text-[#F5F0FF] transition hover:bg-[#7C3AED] disabled:cursor-not-allowed disabled:opacity-60"
									>
										{inquiryForm.isSubmitting ? "Sending…" : "Submit Inquiry"}
										<LuArrowUpRight className="text-base" />
									</button>
								</form>
							</div>
						)}
					</aside>
				</div>
			</div>
			{!mini && (
				<div className="relative z-10 w-full flex items-center gap-3 justify-center mt-8 mb-6 text-[#D4C6F7] text-xs uppercase tracking-wider">
					<span className="w-16 h-px bg-linear-to-l from-[#D4C6F7] to-transparent rounded-l-full" />
					Powered by OnTap Creatives
					<span className="w-16 h-px bg-linear-to-r from-[#D4C6F7] to-transparent rounded-r-full" />
				</div>
			)}
			{showFAB && !mini && (
				<FloatingContactWidget data={d} accent="#C084FC" qrUrl={qrUrl} />
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