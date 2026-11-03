"use client";

/*
	NOTE: This layout does not include dedicated sections for map embeds or video galleries.
*/

import { useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import {
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
	getInitials,
	getProfileImageOrNull,
	PortfolioCoverMedia,
	isGalleryEnabled,
	isInquiryEnabled,
	usePortfolioInquiryForm,
	PortfolioAddressSection,
  hasPortfolioLocation,
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

/*
	Color palette used: Carbon & Diamonds (gender-neutral, premium, flawless)
	Palette: Carbon (#0B0C0D), Graphite (#1A1D20), Diamond (#E6F7FF), Silver (#C9D6DD)
*/

interface ServiceProductCardProps {
	title: string;
	description: string;
	imageSrc: string;
	media?: any[];
	videoUrl?: string;
	videoFile?: string | null;
	index?: number;
	isMobile?: boolean;
}

function clean(v: string | null | undefined): string {
	const s = String(v ?? "").trim();
	const l = s.toLowerCase();
	// Filter out empty strings, 'n/a', 'na', 'none', and empty HTML tags like <p><br></p>
	if (!s || l === "n/a" || l === "na" || l === "none") return "";
	if (l === "<p><br></p>" || l === "<p><br /></p>") return "";
	return s;
}

function profTitle(
	d: PortfolioViewProps["data"] extends infer U ? NonNullable<U> : never
): string {
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

function SectionHeading({
	eyebrow,
	title,
	note,
	isMobile = false,
}: {
	eyebrow: string;
	title: string;
	note?: string;
	isMobile?: boolean;
}) {
	return (
		<div className="mb-5 flex items-end justify-between gap-4">
			<div>
				<p className="text-[10px] uppercase tracking-[0.42em] text-[#C9D6DD]/70">
					{eyebrow}
				</p>
				<h2
					className={`mt-2 text-xl font-semibold text-[#EEF6FB] ${!isMobile && "md:text-2xl"
						}`}
				>
					{title}
				</h2>
			</div>
			{note ? (
				<p
					className={`text-xs uppercase tracking-[0.28em] text-[#9AA7B0] ${!isMobile && "hidden md:block"
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
		<div className="rounded-full border border-white/8 bg-white/2 px-4 py-2 backdrop-blur-md">
			<div className="flex items-baseline gap-2">
				<span className="text-sm font-semibold text-[#EEF6FB]">{value}</span>
				<span className="text-[10px] uppercase tracking-[0.32em] text-[#9AA7B0]">
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
	children: React.ReactNode;
	secondary?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
	return (
		<button
			{...props}
			className={[
				"group inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-medium transition-all duration-300 active:scale-[0.98]",
				secondary
					? "border border-white/10 bg-white/3 text-[#EEF6FB] hover:bg-white/6 hover:border-white/15"
					: "bg-[#E6F7FF] text-[#0B0C0D] hover:bg-[#F0FBFF] hover:shadow-[0_0_35px_rgba(230,247,255,0.22)]",
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
	index = 0,
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
		<article
			className={[
				"group relative overflow-hidden rounded-[1.75rem] border border-white/8 bg-[linear-gradient(180deg,rgba(230,247,255,0.02),rgba(230,247,255,0.01))] shadow-[0_18px_60px_rgba(0,0,0,0.35)]",
				"transition-all duration-500 hover:-translate-y-1 hover:border-[#E6F7FF]/35",
			].join(" ")}
			style={{
				transform: index % 2 === 0 ? "rotate(-0.4deg)" : "rotate(0.25deg)",
			}}
		>
			<div className="relative w-full overflow-hidden">
				{mediaItems.length > 0 ? (
          <ServiceMediaCarousel
						items={mediaItems}
						accent="#E6F7FF"
						glass="rgba(255,255,255,0.02)"
						textMuted="#9AA7B0"
						mini={false}
						variant="carbon-diamond"
					/>
        ) : imageSrc ? (
					<Image
						height={1024}
						width={1024}
						alt={title}
						src={imageSrc}
						className="h-full w-full object-contain object-center opacity-65 transition duration-700 group-hover:scale-[1.06] group-hover:opacity-100"
						draggable={false}
					/>
				) : (
					<div className="flex h-full w-full items-center justify-center bg-[#1A1D20] text-4xl font-semibold text-[#9AA7B0]">
						{String(index + 1).padStart(2, "0")}
					</div>
				)}
				<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(230,247,255,0.18),transparent_30%),linear-gradient(180deg,transparent_20%,rgba(11,12,13,0.95))]" />
				<div className="pointer-events-none absolute left-4 top-4 rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[10px] uppercase tracking-[0.28em] text-[#EEF6FB] backdrop-blur-md">
					{String(index + 1).padStart(2, "0")}
				</div>
			</div>

			<div className={`relative p-5 ${!isMobile && "md:p-6"}`}>
				<div className="mb-3 flex items-start justify-between gap-4">
					<h3
						className={`text-lg font-semibold text-[#EEF6FB] ${!isMobile && "md:text-xl"
							}`}
					>
						{title}
					</h3>
					<span className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/8 bg-white/2 text-[#E6F7FF]">
						<LuBadgeCheck className="text-sm" />
					</span>
				</div>

				{descriptionText ? (
					<p
						ref={descRef}
						className={[
							"text-sm leading-7 text-[#CFDDE6] transition-all duration-300",
							expanded ? "" : "line-clamp-3",
						].join(" ")}
					>
						<RichText html={description} />
					</p>
				) : null}

				{needsToggle ? (
					<button
						type="button"
						onClick={() => setExpanded((v) => !v)}
						className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-[#E6F7FF] transition-colors hover:text-[#F0FBFF]"
						aria-expanded={expanded}
					>
						{expanded ? "Collapse details" : "Read full description"}
						<LuArrowUpRight className="text-sm" />
					</button>
				) : null}
			</div>
		</article>
	);
};

export default function CarbonDiamond({
	data,
	mini = false,
	showFAB = false,
	isMobile = false,
}: PortfolioViewProps) {
	const [servicePage, setServicePage] = useState(0);
	const [galleryPage, setGalleryPage] = useState(0);

	const d = resolvePortfolioData(data);
	const inquiryForm = usePortfolioInquiryForm({ urlAlias: d.bizCard.urlAlias, mini });
	const name = getDisplayName(d);
	const title = profTitle(d);
	const aboutCopy = clean(d.vcard.about) || clean(d.bizCard.description) || "";
	const profileImage = getProfileImageOrNull(d);
	const coverImage = clean(d.bizCard.coverImage);
	const initials = getInitials(d);

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
	const GALLERY_PER_PAGE = 4;
	const visibleServices = serviceSource.slice(
		servicePage * SERVICES_PER_PAGE,
		(servicePage + 1) * SERVICES_PER_PAGE
	);

	const visibleGallery = galleryItems.slice(
		galleryPage * GALLERY_PER_PAGE,
		(galleryPage + 1) * GALLERY_PER_PAGE
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
		surface: "#0F1112",
		text: "#EEF6FB",
		muted: "#9AA7B0",
		accent: "#E6F7FF",
		border: "rgba(255,255,255,0.08)",
	});

	// Pagination handlers
	const handlePrevService = () => setServicePage((p) => Math.max(p - 1, 0));
	const handleNextService = () =>
		setServicePage((p) =>
			Math.min(p + 1, Math.ceil(serviceSource.length / SERVICES_PER_PAGE) - 1)
		);
	const handlePrevGallery = () => setGalleryPage((p) => Math.max(p - 1, 0));
	const handleNextGallery = () =>
		setGalleryPage((p) =>
			Math.min(p + 1, Math.ceil(galleryItems.length / GALLERY_PER_PAGE) - 1)
		);

	return (
		<div className="min-h-screen w-full overflow-x-hidden bg-[#0B0C0D] text-[#EEF6FB] selection:bg-[#E6F7FF]/30 selection:text-[#0B0C0D]">
			<div className="pointer-events-none fixed inset-0 overflow-hidden">
				<div className="absolute -top-40 left-1/2 h-152 w-152 -translate-x-1/2 rounded-full bg-[#E6F7FF]/10 blur-[120px]" />
				<div className="absolute left-[10%] top-[18%] h-72 w-72 rounded-full bg-[#C9D6DD]/10 blur-[100px]" />
				<div className="absolute right-[5%] top-[40%] h-104 w-104 rounded-full bg-[#C9D6DD]/8 blur-[120px]" />
				<div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-size-[72px_72px] opacity-[0.12]" />
				<div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_35%,rgba(11,12,13,0.88))]" />
			</div>
			<div
				className={`relative mx-auto max-w-7xl px-4 py-6 ${!isMobile && "sm:px-6 md:py-10 lg:px-8"
					}`}
			>
				<div
					className={`grid grid-cols-1 gap-8 ${!isMobile && "lg:grid-cols-12"
						}`}
				>
					<div className={`space-y-8 ${!isMobile && "lg:col-span-8"}`}>
						<section className="relative overflow-hidden rounded-4xl border border-white/8 bg-[linear-gradient(180deg,rgba(230,247,255,0.02),rgba(230,247,255,0.01))] shadow-[0_30px_100px_rgba(0,0,0,0.42)]">
							<div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(230,247,255,0.14),transparent_30%),radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.05),transparent_26%)]" />
							<div className="absolute right-0 top-0 h-full w-[42%] bg-[linear-gradient(135deg,rgba(255,255,255,0.03),transparent_50%)]" />
							<div
								className={`relative h-60 w-full overflow-hidden ${!isMobile && "sm:h-56"
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
									<div className="h-full w-full bg-[linear-gradient(135deg,#0f1820,#0B0C0D)] opacity-80" />
								)}
								<div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(11,12,13,0.1),rgba(11,12,13,0.96))]" />
							</div>
							<div
								className={`relative -mt-20 px-6 pb-6 ${!isMobile && "sm:px-8 sm:pb-8"
									}`}
							>
								<div className="flex flex-col items-start z-50">
									<div className="absolute -inset-6 rounded-full bg-[#E6F7FF]/20 blur-xl" />
									{profileImage ? (
										<Image
											height={500}
											width={500}
											alt={`Profile picture of ${name}`}
											src={profileImage}
											className={`relative z-10 h-36 w-36 rounded-full border border-white/10 object-cover object-center shadow-[0_18px_60px_rgba(0,0,0,0.45)] ${!isMobile && "sm:h-36 sm:w-36"
												}`}
											draggable={false}
										/>
									) : (
										<div
											className={`relative z-10 flex h-36 w-36 items-center justify-center rounded-full border border-white/10 bg-[#0f1820] text-2xl font-semibold text-[#E6F7FF] shadow-[0_18px_60px_rgba(0,0,0,0.45)] ${!isMobile && "sm:h-36 sm:w-36"
												}`}
										>
											{initials}
										</div>
									)}
									<div
										className={`flex w-full flex-col gap-6 ${!isMobile && "lg:flex-row lg:items-end lg:justify-between"
											}`}
									>
										<div className="flex items-center mt-3">
											<div className="pb-1">
												<h1
													className={`text-3xl font-semibold tracking-[-0.04em] text-[#F8FBFF] ${!isMobile && "sm:text-5xl"
														}`}
												>
													{name}
												</h1>
											</div>
										</div>

										<div className="flex flex-wrap items-center justify-center gap-3 lg:flex-1">
											<PortfolioActionButtons
												data={d}
												shareUrl={shareUrl}
												theme={{
													accent: '#E6F7FF',
													text: '#EEF6FB',
													surface: '#0F1112',
													border: 'rgba(255,255,255,0.08)',
												}}
												layout="row"
												compact={mini}
											/>
										</div>
									</div>
									<PortfolioSocialProof
										data={d}
										mini={mini}
										className="mt-5"
										theme={{
											surface: '#0F1112',
											border: 'rgba(230,247,255,0.16)',
											text: '#F8FBFF',
											muted: '#C9D6DD',
											accent: '#E6F7FF',
											accentSoft: 'rgba(230,247,255,0.08)',
											divider: 'rgba(255,255,255,0.08)',
											shadow: '0 18px 50px rgba(0,0,0,0.4)',
											radius: '18px',
										}}
									/>
								</div>

							</div>
						</section>
						{/* Socials Card */}
						{contactLinks.some((link) => link.kind === "social") && (
							<div className="rounded-4xl border border-white/8 bg-[#0F1112] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
								<SectionHeading
									isMobile={isMobile}
									eyebrow="Socials"
									title=""
								/>
								<div className="space-y-2">
									<div className="flex flex-wrap justify-center gap-2 pt-1">
										{contactLinks.filter((link) => link.kind === "social").map((link, i) => (
											<a
												key={`social-${i}`}
												href={link.url}
												target="_blank"
												rel="noopener noreferrer"
												title={getContactLinkAriaLabel(link)}
												aria-label={getContactLinkAriaLabel(link)}
												className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 transition hover:bg-white/10 hover:scale-105"
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
							<div className="rounded-4xl border border-white/8 bg-[#0F1112] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
								<SectionHeading
									isMobile={isMobile}
									eyebrow="Contact"
									title=""
								/>
								<div className="space-y-2">
									{contactLinks.filter((link) => link.kind === "contact").map((link, i) => (
										<a
											key={i}
											href={link.url}
											target="_self"
											rel="noopener noreferrer"
											title={getContactLinkAriaLabel(link)}
											aria-label={getContactLinkAriaLabel(link)}
											className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 transition hover:bg-white/10"
										>
											<SocialIcon platform={link.platform} size={PORTFOLIO_SOCIAL_ICON_SIZE} />
											<ContactLinkLabel link={link} className="text-sm text-[#CFDDE6]" />
										</a>
									))}
								</div>
							</div>
						)}
						{aboutCopy &&
							<section className={`grid gap-4 ${!isMobile && "md:grid-cols-1"}`}>
								<div className="rounded-[1.75rem] border border-white/8 bg-[linear-gradient(180deg,rgba(230,247,255,0.02),rgba(230,247,255,0.01))] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
									<SectionHeading
										isMobile={isMobile}
										eyebrow=""
										title=""
									/>
									<p
										className={`max-w-3xl text-sm leading-8 text-[#CFDDE6] ${!isMobile && "sm:text-[15px]"
											}`}
									>
										<RichText html={aboutCopy} />
									</p>
								</div>
							</section>
						}
						{d.services.length > 0 &&
							<section
								className={`rounded-4xl border border-white/8 bg-[linear-gradient(180deg,rgba(230,247,255,0.02),rgba(230,247,255,0.01))] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.3)] ${!isMobile && "md:p-8"
									}`}
							>
								<div className="mb-6 flex items-center justify-between gap-4">
									<SectionHeading
										isMobile={isMobile}
										eyebrow="Services"
										title=""
									/>
									{!isMobile && serviceSource.length > SERVICES_PER_PAGE ? (
										<div className="flex items-center gap-2">
											<button
												type="button"
												aria-label="Previous" onClick={handlePrevService}
												disabled={servicePage === 0}
												className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/8 bg-white/3 text-[#CFDDE6] transition hover:border-[#E6F7FF]/35 hover:bg-white/6 disabled:cursor-not-allowed disabled:opacity-30"
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
												className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/8 bg-white/3 text-[#CFDDE6] transition hover:border-[#E6F7FF]/35 hover:bg-white/6 disabled:cursor-not-allowed disabled:opacity-30"
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
									{(isMobile && !mini ? serviceSource : visibleServices).map((service, idx) => (
										<ServiceProductCard
											key={service.title}
											{...service}
											index={idx}
											isMobile={isMobile}
										/>
									))}
								</ServicesScrollContainer>
							</section>
						}


						{/* Gallery */}
						{isGalleryEnabled(d, mini) && galleryItems.length > 0 && (
							<section
								className={`rounded-4xl border border-white/8 bg-[linear-gradient(180deg,rgba(230,247,255,0.02),rgba(230,247,255,0.01))] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.3)] ${!isMobile && "md:p-8"
									}`}
							>
								<div className="mb-6 flex items-center justify-between gap-4">
									<SectionHeading
										isMobile={isMobile}
										eyebrow="Featured Gallery"
										title=""
									/>
									{galleryItems.length > 1 ? (
										<div className="flex items-center gap-2">
											<button
												type="button"
												onClick={handlePrevGallery}
												disabled={galleryPage === 0}
												className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/8 bg-white/3 text-[#CFDDE6] transition hover:border-[#E6F7FF]/35 hover:bg-white/6 disabled:cursor-not-allowed disabled:opacity-30"
											>
												<LuChevronLeft />
											</button>
											<button
												type="button"
												onClick={handleNextGallery}
												disabled={
													(galleryPage + 1) * GALLERY_PER_PAGE >=
													galleryItems.length
												}
												className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/8 bg-white/3 text-[#CFDDE6] transition hover:border-[#E6F7FF]/35 hover:bg-white/6 disabled:cursor-not-allowed disabled:opacity-30"
											>
												<LuChevronRight />
											</button>
										</div>
									) : null}
								</div>
								<GalleryCarousel
									items={visibleGallery}
									accent="#E6F7FF"
									glass="rgba(255,255,255,0.02)"
									textMuted="#9AA7B0"
									mini={mini}
									variant="carbon-diamond"
								/>
							</section>
						)}

						{/* Videos */}
						{isGalleryEnabled(d, mini) && videos.length > 0 && (
							<section
								className={`rounded-4xl border border-white/8 bg-[linear-gradient(180deg,rgba(230,247,255,0.02),rgba(230,247,255,0.01))] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.3)] ${!isMobile && "md:p-8"
									}`}
							>
								<SectionHeading
									isMobile={isMobile}
									eyebrow="Motion"
									title="Video highlights"
									note="Curated clips"
								/>
								<VideoCarousel
									items={videos}
									accent="#E6F7FF"
									glass="rgba(255,255,255,0.02)"
									textMuted="#9AA7B0"
									mini={mini}
									variant="carbon-diamond"
								/>
							</section>
						)}

						{hasPortfolioLocation(d.vcard) && (
							<PortfolioAddressSection
								vcard={d.vcard}
								mini={mini}
								theme={{
									cardBg: "#0F1112",
									text: "#EEF6FB",
									textMuted: "#9AA7B0",
									accent: "#E6F7FF",
								}}
							/>
						)}

					</div>

					<aside
						className={`space-y-6 self-start ${!isMobile && "lg:col-span-4 lg:sticky lg:top-8"
							}`}
					>
						{/* Inquiry */}
						{isInquiryEnabled(d, mini) && (
							<div className="rounded-4xl border border-white/8 bg-[linear-gradient(180deg,rgba(230,247,255,0.02),rgba(230,247,255,0.01))] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
								<SectionHeading
									isMobile={isMobile}
									eyebrow="Inquiry"
									title="Send a message"
								/>
								<form className="space-y-3" onSubmit={inquiryForm.handleSubmit}>
									<input
										type="text"
										placeholder="Name"
										value={inquiryForm.fields.name}
										onChange={(e) =>
											inquiryForm.setField("name", e.target.value)
										}
										className="w-full rounded-2xl border border-white/10 bg-[#0F1112] px-4 py-3 text-sm text-[#EEF6FB] placeholder:text-[#9AA7B0] outline-none transition focus:border-[#E6F7FF]/50 focus:ring-2 focus:ring-[#E6F7FF]/15"
									/>
									<input
										type="email"
										placeholder="Email Address"
										value={inquiryForm.fields.email}
										onChange={(e) =>
											inquiryForm.setField("email", e.target.value)
										}
										className="w-full rounded-2xl border border-white/10 bg-[#0F1112] px-4 py-3 text-sm text-[#EEF6FB] placeholder:text-[#9AA7B0] outline-none transition focus:border-[#E6F7FF]/50 focus:ring-2 focus:ring-[#E6F7FF]/15"
									/>
									<input
										type="text"
										placeholder="Subject"
										value={inquiryForm.fields.subject}
										onChange={(e) =>
											inquiryForm.setField("subject", e.target.value)
										}
										className="w-full rounded-2xl border border-white/10 bg-[#0F1112] px-4 py-3 text-sm text-[#EEF6FB] placeholder:text-[#9AA7B0] outline-none transition focus:border-[#E6F7FF]/50 focus:ring-2 focus:ring-[#E6F7FF]/15"
									/>
									<textarea
										placeholder="How can we help?"
										rows={5}
										value={inquiryForm.fields.message}
										onChange={(e) =>
											inquiryForm.setField("message", e.target.value)
										}
										className="w-full resize-none rounded-2xl border border-white/10 bg-[#0F1112] px-4 py-3 text-sm text-[#EEF6FB] placeholder:text-[#9AA7B0] outline-none transition focus:border-[#E6F7FF]/50 focus:ring-2 focus:ring-[#E6F7FF]/15"
									/>
									{inquiryForm.fieldError && (
										<p className="text-sm text-red-600" role="alert">
											{inquiryForm.fieldError}
										</p>
									)}
									<button
										type="submit"
										disabled={inquiryForm.isSubmitting}
										className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#E6F7FF] px-5 py-3 text-sm font-medium text-[#0B0C0D] transition hover:bg-[#F0FBFF] hover:shadow-[0_0_35px_rgba(230,247,255,0.22)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
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
				<div className="relative z-10 w-full flex items-center gap-3 justify-center mt-8 mb-6 text-[#9AA7B0] text-xs uppercase tracking-wider">
					<span className="w-16 h-px bg-linear-to-l from-[#9AA7B0] to-transparent rounded-l-full" />
					Powered by OnTap Creatives
					<span className="w-16 h-px bg-linear-to-r from-[#9AA7B0] to-transparent rounded-r-full" />
				</div>
			)}
			{showFAB && !mini && (
				<FloatingContactWidget data={d} accent="#1e2933ff" qrUrl={qrUrl} />
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