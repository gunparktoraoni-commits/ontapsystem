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
	Color palette used: Timeless Gold (carbon, graphite, gold, silver)
	Palette: Carbon (#09090B), Graphite (#111827), Gold (#D6B06D), Silver (#B4AEA4)
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
				<p className="text-[10px] uppercase tracking-[0.42em] text-[#b59d67]/70">
					{eyebrow}
				</p>
				<h2
					className={`mt-2 text-xl font-semibold text-[#f4efe6] ${!isMobile && "md:text-2xl"
						}`}
				>
					{title}
				</h2>
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
		<div className="rounded-full border border-white/8 bg-white/3 px-4 py-2 backdrop-blur-md">
			<div className="flex items-baseline gap-2">
				<span className="text-sm font-semibold text-[#f3e6cf]">{value}</span>
				<span className="text-[10px] uppercase tracking-[0.32em] text-[#8f8980]">
					{label}
				</span>
			</div>
		</div>
	);
}

function ActionButton({
	children,
	secondary = false,
	onClick,
	...props
}: {
	children: React.ReactNode;
	secondary?: boolean;
	onClick?: React.MouseEventHandler<HTMLButtonElement>;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={[
				"group inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-medium transition-all duration-300 active:scale-[0.98]",
				secondary
					? "border border-white/10 bg-white/3 text-[#e6dfd3] hover:bg-white/6 hover:border-white/15"
					: "bg-[#d6b06d] text-[#11110f] hover:bg-[#e1be7c] hover:shadow-[0_0_35px_rgba(214,176,109,0.22)]",
			].join(" ")}
			{...props}
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
				"group relative overflow-hidden rounded-[1.75rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.015))] shadow-[0_18px_60px_rgba(0,0,0,0.35)]",
				"transition-all duration-500 hover:-translate-y-1 hover:border-[#d6b06d]/35",
			].join(" ")}
			style={{
				transform: index % 2 === 0 ? "rotate(-0.4deg)" : "rotate(0.25deg)",
			}}
		>
			<div className="relative w-full overflow-hidden">
				{mediaItems.length > 0 ? (
          <ServiceMediaCarousel
						items={mediaItems}
						accent="#d6b06d"
						glass="rgba(255,255,255,0.02)"
						textMuted="#8f8980"
						mini={false}
						variant="timeless-gold"
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
					<div className="flex h-full w-full items-center justify-center bg-[#1a1510] text-4xl font-semibold text-[#b59d67]">
						{String(index + 1).padStart(2, "0")}
					</div>
				)}
				<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(214,176,109,0.18),transparent_30%),linear-gradient(180deg,transparent_20%,rgba(10,10,12,0.95))]" />
				<div className="pointer-events-none absolute left-4 top-4 rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[10px] uppercase tracking-[0.28em] text-[#f4e6c8] backdrop-blur-md">
					{String(index + 1).padStart(2, "0")}
				</div>
			</div>

			<div className={`relative p-5 ${!isMobile && "md:p-6"}`}>
				<div className="mb-3 flex items-start justify-between gap-4">
					<h3
						className={`text-lg font-semibold text-[#f5f1ea] ${!isMobile && "md:text-xl"
							}`}
					>
						{title}
					</h3>
					<span className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/8 bg-white/4 text-[#d6b06d]">
						<LuBadgeCheck className="text-sm" />
					</span>
				</div>

				{descriptionText ? (
					<p
						ref={descRef}
						className={[
							"text-sm leading-7 text-[#b4aea4] transition-all duration-300",
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
						className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-[#d6b06d] transition-colors hover:text-[#f0d59f]"
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

export default function TimelessGold({
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
		bg: "#09090b",
		surface: "#0F1112",
		text: "#f4efe6",
		muted: "#8f8980",
		accent: "#d6b06d",
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
		<div className="min-h-screen w-full overflow-x-hidden bg-[#09090b] text-[#f4efe6] selection:bg-[#d6b06d]/30 selection:text-[#fff7ea]">
			<div className="pointer-events-none fixed inset-0 overflow-hidden">
				<div className="absolute -top-40 left-1/2 h-152 w-152 -translate-x-1/2 rounded-full bg-[#d6b06d]/10 blur-[120px]" />
				<div className="absolute left-[10%] top-[18%] h-72 w-72 rounded-full bg-[#6a5c44]/10 blur-[100px]" />
				<div className="absolute right-[5%] top-[40%] h-104 w-104 rounded-full bg-[#b59d67]/8 blur-[120px]" />
				<div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-size-[72px_72px] opacity-[0.18]" />
				<div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_35%,rgba(9,9,11,0.88))]" />
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
						<section className="relative overflow-hidden rounded-[2rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.015))] shadow-[0_30px_100px_rgba(0,0,0,0.42)]">
							<div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(214,176,109,0.14),transparent_30%),radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.05),transparent_26%)]" />
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
									<div className="h-full w-full bg-[linear-gradient(135deg,#1a1510,#09090b)] opacity-80" />
								)}
								<div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(9,9,11,0.1),rgba(9,9,11,0.96))]" />
							</div>

							<div
								className={`relative -mt-20 px-6 pb-6 ${!isMobile && "sm:px-8 sm:pb-8"
									}`}
							>
								<div className="flex flex-col items-start z-50">
									<div className="rounded-full bg-[#d6b06d]/20 blur-xl" />
									{profileImage ? (
										<Image
											height={500}
											width={500}
											alt={`Profile picture of ${name}`}
											src={profileImage}
											className={`relative z-10 h-28 w-28 rounded-full border border-white/10 object-cover object-center shadow-[0_18px_60px_rgba(0,0,0,0.45)] ${!isMobile && "sm:h-36 sm:w-36"
												}`}
											draggable={false}
										/>
									) : (
										<div
											className={`relative z-10 flex h-36 w-36 items-center justify-center rounded-full border-2 border-white/10 bg-[#1a1510] text-2xl font-semibold text-[#d6b06d] shadow-[0_18px_60px_rgba(0,0,0,0.45)] ${!isMobile && "sm:h-36 sm:w-36"
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
												<p className="mb-2 text-[10px] uppercase tracking-[0.42em] text-[#b59d67]">
													{title}
												</p>
												<h1
													className={`text-3xl font-semibold tracking-[-0.04em] text-[#f8f3ea] ${!isMobile && "sm:text-5xl"
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
													accent: '#d6b06d',
													text: '#f4efe6',
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
											border: 'rgba(214,176,109,0.28)',
											text: '#f4efe6',
											muted: '#d6b06d',
											accent: '#d6b06d',
											accentSoft: 'rgba(214,176,109,0.12)',
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
							<div className="rounded-[2rem] border border-white/8 bg-[#0F1112] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
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
							<div className="rounded-[2rem] border border-white/8 bg-[#0F1112] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
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
											<ContactLinkLabel link={link} className="text-sm text-[#b4aea4]" />
										</a>
									))}
								</div>
							</div>
						)}


						{aboutCopy &&
							<section className={`grid gap-4 ${!isMobile && "md:grid-cols-1"}`}>
								<div className="rounded-[1.75rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.015))] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
									<SectionHeading
										isMobile={isMobile}
										eyebrow=""
										title=""
									/>
									<p
										className={`max-w-3xl text-sm leading-8 text-[#b4aea4] ${!isMobile && "sm:text-[15px]"
											}`}
									>
										<RichText html={aboutCopy} />
									</p>
								</div>
							</section>
						}

						{d.services.length > 0 &&
							<section
								className={`rounded-[2rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.015))] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.3)] ${!isMobile && "md:p-8"
									}`}
							>
								<div className="mb-6 flex items-center justify-between gap-4">
									<SectionHeading
										isMobile={isMobile}
										eyebrow="Services"
										title=""
									/>
									{!isMobile && serviceSource.length > 1 ? (
										<div className="flex items-center gap-2">
											<button
												type="button"
												aria-label="Previous" onClick={handlePrevService}
												disabled={servicePage === 0}
												className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/8 bg-white/3 text-[#b4aea4] transition hover:border-[#d6b06d]/35 hover:bg-white/6 disabled:cursor-not-allowed disabled:opacity-30"
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
												className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/8 bg-white/3 text-[#b4aea4] transition hover:border-[#d6b06d]/35 hover:bg-white/6 disabled:cursor-not-allowed disabled:opacity-30"
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
								className={`rounded-[2rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.015))] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.3)] ${!isMobile && "md:p-8"
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
												className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/8 bg-white/3 text-[#b4aea4] transition hover:border-[#d6b06d]/35 hover:bg-white/6 disabled:cursor-not-allowed disabled:opacity-30"
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
												className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/8 bg-white/3 text-[#b4aea4] transition hover:border-[#d6b06d]/35 hover:bg-white/6 disabled:cursor-not-allowed disabled:opacity-30"
											>
												<LuChevronRight />
											</button>
										</div>
									) : null}
								</div>
								<GalleryCarousel
									items={visibleGallery}
									accent="#d6b06d"
									glass="rgba(255,255,255,0.02)"
									textMuted="#8f8980"
									mini={mini}
									variant="timeless-gold"
								/>
							</section>
						)}

						{/* Videos */}
						{isGalleryEnabled(d, mini) && videos.length > 0 && (
							<section
								className={`rounded-[2rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.015))] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.3)] ${!isMobile && "md:p-8"
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
									accent="#d6b06d"
									glass="rgba(255,255,255,0.02)"
									textMuted="#8f8980"
									mini={mini}
									variant="timeless-gold"
								/>
							</section>
						)}

						{hasPortfolioLocation(d.vcard) && (
							<PortfolioAddressSection
								vcard={d.vcard}
								mini={mini}
								theme={{
									cardBg: "#0F1112",
									text: "#e6dfd3",
									textMuted: "#b4aea4",
									accent: "#d4af37",
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
							<div className="rounded-[2rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.015))] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
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
										className="w-full rounded-2xl border border-white/10 bg-[#0F1112] px-4 py-3 text-sm text-[#f4efe6] placeholder:text-[#8f8980] outline-none transition focus:border-[#d6b06d]/50 focus:ring-2 focus:ring-[#d6b06d]/15"
									/>
									<input
										type="email"
										placeholder="Email Address"
										value={inquiryForm.fields.email}
										onChange={(e) =>
											inquiryForm.setField("email", e.target.value)
										}
										className="w-full rounded-2xl border border-white/10 bg-[#0F1112] px-4 py-3 text-sm text-[#f4efe6] placeholder:text-[#8f8980] outline-none transition focus:border-[#d6b06d]/50 focus:ring-2 focus:ring-[#d6b06d]/15"
									/>
									<input
										type="text"
										placeholder="Subject"
										value={inquiryForm.fields.subject}
										onChange={(e) =>
											inquiryForm.setField("subject", e.target.value)
										}
										className="w-full rounded-2xl border border-white/10 bg-[#0F1112] px-4 py-3 text-sm text-[#f4efe6] placeholder:text-[#8f8980] outline-none transition focus:border-[#d6b06d]/50 focus:ring-2 focus:ring-[#d6b06d]/15"
									/>
									<textarea
										placeholder="How can we help?"
										rows={5}
										value={inquiryForm.fields.message}
										onChange={(e) =>
											inquiryForm.setField("message", e.target.value)
										}
										className="w-full resize-none rounded-2xl border border-white/10 bg-[#0F1112] px-4 py-3 text-sm text-[#f4efe6] placeholder:text-[#8f8980] outline-none transition focus:border-[#d6b06d]/50 focus:ring-2 focus:ring-[#d6b06d]/15"
									/>
									{inquiryForm.fieldError && (
										<p className="text-sm text-red-600" role="alert">
											{inquiryForm.fieldError}
										</p>
									)}
									<button
										type="submit"
										disabled={inquiryForm.isSubmitting}
										className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#d6b06d] px-5 py-3 text-sm font-medium text-[#11110f] transition hover:bg-[#e1be7c] hover:shadow-[0_0_35px_rgba(214,176,109,0.22)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
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
				<div className="relative z-10 w-full flex items-center gap-3 justify-center mt-8 mb-6 text-[#8f8980] text-xs uppercase tracking-wider">
					<span className="w-16 h-px bg-linear-to-l from-[#8f8980] to-transparent rounded-l-full" />
					Powered by OnTap Creatives
					<span className="w-16 h-px bg-linear-to-r from-[#8f8980] to-transparent rounded-r-full" />
				</div>
			)}
			{showFAB && !mini && (
				<FloatingContactWidget data={d} accent="#e7c865ff" qrUrl={qrUrl} />
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