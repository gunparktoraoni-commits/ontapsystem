'use client';

import React from 'react';
import { Download, Share2 } from 'lucide-react';
import type { PortfolioViewProps } from '../../shared';
import PortfolioSocialProof from '../../components/PortfolioSocialProof';
import {
	getDisplayName,
	getInitials,
	downloadVCard,
	SocialIcon,
	PORTFOLIO_SOCIAL_ICON_SIZE,
	PORTFOLIO_SOCIAL_ICON_SIZE_MINI,
	GalleryCarousel,
	VideoCarousel,
	buildGalleryItems,
	buildVideoItems,
	AnimatedSection,
	FloatingContactWidget,
	isGalleryEnabled,
	isInquiryEnabled,
	PortfolioCoverMedia,
	usePortfolioInquiryForm,
	PortfolioAddressSection,
  hasPortfolioLocation,
	resolvePortfolioData,
	usePortfolioViewerSession,
	PortfolioAssociateButton,
	buildContactLinks,
	ServiceMediaCarousel,
	ServicesScrollContainer,
	buildServiceMediaItems,
	ContactLinkLabel,
	getContactLinkAriaLabel
} from '../../shared';
import {
  useQRCardDownload,
  QRCardExportSurface,
  toQRCardStyle
} from '../../QRCardDownload';
import CspStyle from '@/app/components/CspStyle';
import { RichText } from '@/app/components/RichText';
import { LuUserRoundPlus } from 'react-icons/lu';
 // reuse for consistency

/* ── derive PortfolioData type from the prop ── */
type PortfolioData = NonNullable<PortfolioViewProps['data']>;

/* ─────────────────────────────────────────────
   LOCAL HELPERS  (mirrors non-exported fns in shared.tsx)
───────────────────────────────────────────── */
function clean(v: string | null | undefined): string {
  const s = String(v ?? '').trim();
  const l = s.toLowerCase();
  // Filter out empty strings, 'n/a', 'na', 'none', and empty HTML tags like <p><br></p>
  if (!s || l === 'n/a' || l === 'na' || l === 'none') return '';
  if (l === '<p><br></p>' || l === '<p><br /></p>') return '';
  return s;
}
function profTitle(d: PortfolioData): string {
  return clean(d.vcard.professionalTitle) || clean(d.bizCard.occupation);
}

/* ─────────────────────────────────────────────
   THEME PALETTE  —  Deep Teal / Cyan
───────────────────────────────────────────── */
const C = {
  bg:         '#07100f',
  surface:    '#0f1e1c',
  glass:      'rgba(255,255,255,0.02)',
  border:     'rgba(45,210,190,0.15)',
  borderAcct: 'rgba(45,210,190,0.35)',
  text:       '#f0fdfb',
  muted:      'rgba(180,230,225,0.7)',
  accent:     '#34d8c0',
  gold:       '#5eead4',
  accentSoft: 'rgba(52,216,192,0.12)',
  goldSoft:   'rgba(94,234,212,0.08)',
  accentGlow: 'rgba(52,216,192,0.25)',
  goldGlow:   'rgba(94,234,212,0.20)',
  headerGrad: 'linear-gradient(135deg,#003a32 0%,#002200 100%)',
  bgGrad:     'linear-gradient(180deg,#07100f 0%,#0d2420 50%,#07100f 100%)'
};

/* ── Keyframes ── */
const KEYFRAMES = `
@keyframes kPulse {
  0%, 100% { opacity: .30; transform: scale(1); }
  50% { opacity: .65; transform: scale(1.08); }
}
@keyframes kDrift {
  0%, 100% { transform: translate(0, 0); }
  40% { transform: translate(10px, -8px); }
  70% { transform: translate(-6px, 5px); }
}
@keyframes kShimmer {
  0% { background-position: -300% center; }
  100% { background-position: 300% center; }
}
@keyframes kFadeUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Text wrap for headings, paragraphs, and spans */
:is(h1, h2, h3, h4, h5, h6, p, span) {
  overflow-wrap: break-word;
  word-wrap: break-word;
  word-break: normal;
  text-wrap: wrap;
}
`;

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
export default function RoyalPurpleV2({ data, mini = false, showFAB = false, isMobile = false }: PortfolioViewProps) {
  const d = resolvePortfolioData(data);
  const inquiryForm = usePortfolioInquiryForm({ urlAlias: d.bizCard.urlAlias, mini });
  const { checked: sessionChecked, isAuthenticated } = usePortfolioViewerSession();
  const name     = getDisplayName(d);
  const initials = getInitials(d);
  const title    = profTitle(d);
  const bizLabel = clean(d.bizCard.bizCardName);
  const showBiz  = Boolean(bizLabel && bizLabel.toLowerCase() !== name.trim().toLowerCase());
  const gallery  = buildGalleryItems(d);
  const videos   = buildVideoItems(d);
  const shareUrl = typeof window !== 'undefined' && d.bizCard.urlAlias
    ? `${window.location.origin}/${d.bizCard.urlAlias}` : '';
  const qrUrl    = shareUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=280x280&ecc=H&data=${encodeURIComponent(shareUrl)}` : '';
  const { cardRef, qrDataUrl, download: downloadQRCard, isDownloading } = useQRCardDownload(d, shareUrl);
  const qrCardStyle = toQRCardStyle(C);

  /* sanitise services */
  const norm  = (s: string) => s.trim().toLowerCase().split('?')[0];
  const used  = new Set([...gallery.map(g => norm(g.src)), ...videos.map(v => norm(v.src))]);
  const srvcs = (d.services ?? []).map(s => {
    const fi = String(s.featured_image ?? '').trim();
    return fi && used.has(norm(fi)) ? { ...s, featured_image: null } : s;
  });

  // ── Unified contact links ──
  const contactLinks = buildContactLinks(d);

  const heroH   = mini ? '76px'  : 'clamp(195px, 28vw, 255px)';
  const avSz    = mini ? '0px'   : 'clamp(100px, 13.5vw, 145px)';
  const pad     = mini ? 'p-3'   : `p-6 ${!isMobile && 'sm:p-8'}`.trim();
  const section = `rounded-[20px] border ${pad}`;

  return (
    <div
      className="royal-purple-v2 w-full relative"
      style={{
        background: C.bgGrad,
        color: C.text,
        minHeight: mini ? 'auto' : '100vh',
        fontFamily: "var(--font-mono), monospace",
      }}
    >
      <CspStyle dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />

      {/* ── Luxury decorative diamonds & auroras ── */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
        <div style={{
          position: 'absolute', width: '600px', height: '600px', borderRadius: '50%',
          background: `radial-gradient(ellipse, rgba(168,85,247,0.06) 0%, transparent 70%)`,
          top: '-100px', left: '-100px'}} />
        <div style={{
          position: 'absolute', width: '500px', height: '500px', borderRadius: '50%',
          background: `radial-gradient(ellipse, rgba(241,184,45,0.04) 0%, transparent 70%)`,
          bottom: '12%', right: '-100px'}} />

        {!mini && [0, 1, 2].map(i => (
          <div key={i} style={{
            position: 'absolute',
            width: `${120 + i * 80}px`, height: `${120 + i * 80}px`,
            border: `1px solid rgba(241,184,45,${0.04 - i * 0.01})`,
            borderRadius: '8px',
            top: `${15 + i * 25}%`, right: `${10 + i * 5}%`,
            transform: `rotate(45deg)`}} />
        ))}
      </div>

      <div className="relative" style={{ zIndex: 1 }}>
        {/* ══ COVER HERO ══ */}
        <div className="relative">
          {d.bizCard.coverImage
            ? <PortfolioCoverMedia src={d.bizCard.coverImage} coverType={d.bizCard.coverType} className="w-full object-cover"
                style={{ height: heroH, objectPosition: 'center', filter: 'brightness-[0.4] contrast(1.1)' }} />
            : <div style={{ height: heroH, background: C.headerGrad }} />}

          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#07100f]" />

          {!mini && (
            <div className="absolute inset-x-0 bottom-0 h-[1.5px]"
              style={{ background: `linear-gradient(90deg, transparent, ${C.gold}, transparent)` }} />
          )}

          {!mini && (
            <div className="absolute inset-x-0 bottom-0 flex justify-center translate-y-[50%] z-10">
              <div style={{
                padding: '4px',
                borderRadius: '50%',
                background: `conic-gradient(from 45deg, ${C.gold}, ${C.accent}, ${C.gold})`,
                boxShadow: `0 12px 36px ${C.goldGlow}`}}>
                <div className="rounded-full overflow-hidden flex items-center justify-center text-2xl font-bold"
                  style={{ width: avSz, height: avSz, background: C.surface }}>
                  {d.bizCard.profileImage
                    ? <img src={d.bizCard.profileImage} alt="Profile" className="w-full h-full object-cover object-center" />
                    : <span style={{ color: C.gold }}>{initials}</span>}
                </div>
              </div>
            </div>
          )}
        </div>

        {!mini && <div style={{ height: 'clamp(70px, 9.5vw, 110px)' }} />}

        {/* ══ CONTENT STACK ══ */}
        <div className={`${mini ? 'px-3' : `px-4 ${!isMobile && 'sm:px-6'}`.trim()} space-y-6 pb-24`}
          style={{ maxWidth: mini ? undefined : '630px', margin: mini ? undefined : '0 auto' }}>

          {/* ── Asymmetric Magazine Profile Card ── */}
          <AnimatedSection delay={0} mini={mini}>
            <div className={section} style={{ background: C.surface, borderColor: C.border, boxShadow: '0 20px 45px rgba(0,0,0,0.4)' }}>
              {mini ? (
                <div className="flex items-center gap-2.5">
                  <div style={{
                    padding: '2px', borderRadius: '50%',
                    background: `conic-gradient(${C.gold}, ${C.accent}, ${C.gold})`}}>
                    <div className="h-8 w-8 rounded-full overflow-hidden flex items-center justify-center text-xs font-bold"
                      style={{ background: C.surface }}>
                      {d.bizCard.profileImage
                        ? <img src={d.bizCard.profileImage} alt="" className="w-full h-full object-cover object-center" />
                        : <span style={{ color: C.accent }}>{initials}</span>}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold truncate">{name}</p>
                    <p className="text-[8px] truncate mt-0.5" style={{ color: C.muted }}>
                      {[showBiz ? bizLabel : '', title].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="text-left">
                  <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight" style={{ color: C.text }}>{name}</h1>
                  {showBiz && (
                    <p className="text-sm font-semibold tracking-widest uppercase mt-1" style={{ color: C.gold }}>{bizLabel}</p>
                  )}
                  {title && (
                    <p className="text-xs italic tracking-wide mt-1 text-zinc-400">{title}</p>
                  )}
                  
                  <div className="flex items-center gap-2 my-4">
                    <div className="h-[1.5px] w-12" style={{ background: C.gold }} />
                    <div className="h-[1.5px] flex-1" style={{ background: 'rgba(255,255,255,0.06)' }} />
                  </div>

                  <div className="flex justify-center gap-3 mt-6">
                    <button onClick={() => downloadVCard(d)}
                      className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold px-6 py-3 rounded-md text-black transition-all duration-300 hover:opacity-90 ${!isMobile && 'sm:flex-initial'}`}
                      style={{ background: C.gold, boxShadow: `0 4px 16px ${C.goldGlow}` }}>
                      <Download className="h-4 w-4" /> Save Contact
                    </button>
                    <button onClick={async () => {
                      if (typeof window === 'undefined') return;
                      const url = shareUrl || `${window.location.origin}/${d.bizCard.urlAlias}`;
                      if (navigator.share) await navigator.share({ title: name, url }).catch(() => {});
                      else await navigator.clipboard.writeText(url).catch(() => {});
                    }}
                      className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold px-6 py-3 rounded-md border transition-all duration-300 hover:bg-white/5 ${!isMobile && 'sm:flex-initial'}`}
                      style={{ borderColor: C.gold, color: C.gold }}>
                      <Share2 className="h-4 w-4" /> Share
                    </button>
</div>
                  <PortfolioSocialProof
                    data={d}
                    mini={mini}
                    className="mt-4"
                    theme={{
                      surface: C.surface,
                      border: C.borderAcct,
                      text: C.text,
                      muted: C.muted,
                      accent: C.gold,
                      accentSoft: C.goldSoft,
                      divider: C.border,
                      shadow: `0 16px 36px ${C.accentGlow}`,
                      radius: '12px',
                    }}
                  />
                </div>
              )}
            </div>
          </AnimatedSection>

          {/* ── Socials Card ── */}
          {contactLinks.some((link) => link.kind === 'social') && (
            <AnimatedSection delay={80} mini={mini}>
              <div className={section} style={{ background: C.surface, borderColor: C.border }}>
                {!mini && (
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] mb-4 text-left" style={{ color: C.gold }}>
                    Socials
                  </p>
                )}
                <div className="flex w-full flex-col gap-2">
                  {!contactLinks.some((link) => link.kind === 'contact') && sessionChecked && isAuthenticated ? (
                    <PortfolioAssociateButton
                      urlAlias={d.bizCard.urlAlias}
                      className={`inline-flex w-full items-center gap-2 ${mini ? 'px-2 py-1.5 text-[8px]' : 'px-4 py-2.5 text-[11px]'} rounded transition-all duration-300 hover:scale-[1.03] hover:shadow-xl`}
                      style={{
                        background: C.glass,
                        border: `1.5px solid rgba(241,184,45,0.2)`,
                        color: C.text,
                        display: "inline-flex",
                        alignItems: "center",
                      }}
                      icon={<LuUserRoundPlus size={mini ? 12 : 15} />}
                      label={mini ? '' : "Connect"}
                    />
                  ) : null}
                  <div className="flex flex-wrap gap-2 justify-center">
                    {contactLinks.filter((link) => link.kind === 'social').map((link, i) => (
                      <a
                        key={`social-${i}`}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={getContactLinkAriaLabel(link)}
                        aria-label={getContactLinkAriaLabel(link)}
                        className={`inline-flex shrink-0 items-center justify-center ${mini ? 'h-11 w-11' : 'h-12 w-12'} rounded transition-all duration-300 hover:scale-[1.03] hover:shadow-xl`}
                        style={{
                          background: C.glass,
                          border: `1.5px solid rgba(241,184,45,0.2)`,
                        }}
                      >
                        <SocialIcon platform={link.platform} size={mini ? PORTFOLIO_SOCIAL_ICON_SIZE_MINI : PORTFOLIO_SOCIAL_ICON_SIZE} />
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            </AnimatedSection>
          )}

          {/* ── Contact Card ── */}
          {contactLinks.some((link) => link.kind === 'contact') && (
            <AnimatedSection delay={100} mini={mini}>
              <div className={section} style={{ background: C.surface, borderColor: C.border }}>
                {!mini && (
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] mb-4 text-left" style={{ color: C.gold }}>
                    Contact
                  </p>
                )}
                <div className="flex w-full flex-col gap-2">
                  {sessionChecked && isAuthenticated ? (
                    <PortfolioAssociateButton
                      urlAlias={d.bizCard.urlAlias}
                      className={`inline-flex w-full items-center gap-2 ${mini ? 'px-2 py-1.5 text-[8px]' : 'px-4 py-2.5 text-[11px]'} rounded transition-all duration-300 hover:scale-[1.03] hover:shadow-xl`}
                      style={{
                        background: C.glass,
                        border: `1.5px solid rgba(241,184,45,0.2)`,
                        color: C.text,
                        display: "inline-flex",
                        alignItems: "center",
                      }}
                      icon={<LuUserRoundPlus size={mini ? 12 : 15} />}
                      label={mini ? '' : "Connect"}
                    />
                  ) : null}
                  {contactLinks.filter((link) => link.kind === 'contact').map((link, i) => (
                    <a
                      key={`contact-${i}`}
                      href={link.url}
                      target="_self"
                      rel="noopener noreferrer"
                      title={getContactLinkAriaLabel(link)}
                      aria-label={getContactLinkAriaLabel(link)}
                      className={`inline-flex w-full min-w-0 items-center gap-2 ${mini ? 'px-2 py-1.5 text-[8px]' : 'px-4 py-2.5 text-[11px]'} rounded transition-all duration-300 hover:scale-[1.03] hover:shadow-xl`}
                      style={{
                        background: C.glass,
                        border: `1.5px solid rgba(241,184,45,0.2)`,
                      }}
                    >
                      <span className="shrink-0 inline-flex">
                        <SocialIcon platform={link.platform} size={mini ? PORTFOLIO_SOCIAL_ICON_SIZE_MINI : PORTFOLIO_SOCIAL_ICON_SIZE} />
                      </span>
                      <ContactLinkLabel link={link} className="font-bold truncate min-w-0 tracking-wide normal-case" style={{ color: C.text }} />
                    </a>
                  ))}
                </div>
              </div>
            </AnimatedSection>
          )}

          {(d.vcard.about || d.bizCard.description) && (
            <AnimatedSection delay={120} mini={mini}>
              <div className={section} style={{ background: C.surface, borderColor: C.border }}>
                {!mini && (
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] mb-4 text-left" style={{ color: C.gold }}>
                  </p>
                )}
                <p className="text-sm leading-relaxed text-zinc-300">
                  <RichText html={d.vcard.about || d.bizCard.description} />
                </p>
              </div>
            </AnimatedSection>
          )}

          {/* ── Asymmetric Editorial Services Grid ── */}
          {srvcs.some(s => s.title) && (
            <AnimatedSection delay={140} mini={mini}>
              <div className={section} style={{ background: C.surface, borderColor: C.border }}>
                {mini ? (
                  <>
                    <h3 className="text-[10px] font-bold mb-3">Services</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {srvcs.filter(s => s.title).map((s, i) => {
                        const serviceMediaItems = buildServiceMediaItems(s, s.media ?? []);
                        return (
                          <div key={i} className="rounded-xl overflow-hidden border" style={{ background: C.glass, borderColor: C.border }}>
                            <div className="w-full min-h-[72px] overflow-hidden">
                              {serviceMediaItems.length > 0 ? (
                                <ServiceMediaCarousel
                                  items={serviceMediaItems}
                                  accent={C.accent}
                                  glass={C.glass}
                                  textMuted={C.muted}
                                  mini={true}
                                  variant="royal-purple"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center" style={{ background: C.accentSoft }}>
                                  <span className="text-3xl font-bold opacity-20 uppercase" style={{ color: C.accent }}>{s.title?.[0]}</span>
                                </div>
                              )}
                            </div>
                            <div className="p-1.5"><p className="text-[8px] font-bold">{s.title}</p></div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mb-5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: C.gold }}>
                        Services
                      </p>
                    </div>

                    <ServicesScrollContainer
                      isMobile={isMobile}
                      mini={mini}
                      desktopClassName={`grid grid-cols-1 gap-4 ${!isMobile && 'sm:grid-cols-6'}`}
                    >
                      {srvcs.filter(s => s.title).map((s, i) => {
                        const isFeature = i % 3 === 0;
                        const serviceMediaItems = buildServiceMediaItems(s, s.media ?? []);
                        return (
                          <div key={i}
                            className={`group relative rounded-xl overflow-hidden border transition-all duration-300 hover:shadow-2xl ${!isMobile && (isFeature ? 'sm:col-span-6' : 'sm:col-span-3')}`}
                            style={{ background: 'rgba(0,0,0,0.2)', borderColor: 'rgba(241,184,45,0.15)' }}>
                            
                            <div className="w-full overflow-hidden min-h-[120px]">
                              {serviceMediaItems.length > 0 ? (
                                <ServiceMediaCarousel
                                  items={serviceMediaItems}
                                  accent={C.accent}
                                  glass={C.glass}
                                  textMuted={C.muted}
                                  mini={false}
                                  variant="royal-purple"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center"
                                    style={{ background: `linear-gradient(135deg, ${C.surface} 0%, #07020f 100%)` }}>
                                    <span className="text-5xl font-bold opacity-10 uppercase" style={{ color: C.gold }}>{s.title?.[0]}</span>
                                  </div>
                              )}
                            </div>

                            <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/90 via-black/30 to-transparent">
                              {s.tagline && (
                                <p className="text-[9px] uppercase tracking-widest font-bold mb-1" style={{ color: C.gold }}>
                                  {s.tagline}
                                </p>
                              )}
                              <p className={`${isFeature ? 'text-lg' : 'text-sm'} font-extrabold leading-tight text-white`}>
                                {s.title}
                              </p>
                              {isFeature && s.description && (
                                <p className="mt-1.5 text-xs text-zinc-300 line-clamp-2"><RichText html={s.description} /></p>
                              )}
                            </div>

                            <div className="absolute top-0 left-0 w-[2.5px] h-full opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                              style={{ background: `linear-gradient(to bottom, ${C.gold}, transparent)` }} />
                          </div>
                        );
                      })}
                    </ServicesScrollContainer>
                  </>
                )}
              </div>
            </AnimatedSection>
          )}

          {/* ── Gallery Section ── */}
          {isGalleryEnabled(d, mini) && gallery.length > 0 && (
            <AnimatedSection delay={200} mini={mini}>
              <div className={section} style={{ background: C.surface, borderColor: C.border }}>
                <div className="flex items-center gap-2 mb-4">
                  <div className="h-[1.5px] w-4" style={{ background: C.gold }} />
                  <h3 className={`${mini ? 'text-[10px]' : 'text-base'} font-bold uppercase tracking-wider`}>
                    Featured Gallery
                  </h3>
                </div>
                <GalleryCarousel items={gallery} accent={C.gold} glass={C.glass} textMuted={C.muted} mini={mini} variant="royal-purple" />
              </div>
            </AnimatedSection>
          )}

          {/* ── Videos Section ── */}
          {isGalleryEnabled(d, mini) && videos.length > 0 && (
            <AnimatedSection delay={320} mini={mini}>
              <div className={section} style={{ background: C.surface, borderColor: C.border }}>
                <div className="flex items-center gap-2 mb-4">
                  <div className="h-[1.5px] w-4" style={{ background: C.gold }} />
                  <h3 className={`${mini ? 'text-[10px]' : 'text-base'} font-bold uppercase tracking-wider`}>Videos</h3>
                </div>
                <VideoCarousel items={videos} accent={C.gold} glass={C.glass} textMuted={C.muted} mini={mini} variant="royal-purple" />
              </div>
            </AnimatedSection>
          )}

          {/* ── Address Section ── */}
          {hasPortfolioLocation(d.vcard) && (
            <AnimatedSection delay={360} mini={mini}>
              <PortfolioAddressSection
                vcard={d.vcard}
                mini={mini}
                theme={{ cardBg: C.surface, text: C.text, textMuted: C.muted, accent: C.gold, glass: C.glass }}
              />
            </AnimatedSection>
          )}

          {isInquiryEnabled(d, mini) && (
            <AnimatedSection delay={420} mini={mini}>
              <div className={section} style={{ background: C.surface, borderColor: C.border }}>
                {!mini && (
                  <div className="flex items-center gap-3 mb-5">
                    <div className="h-[1.5px] w-3" style={{ background: C.gold }} />
                    <p className="text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: C.gold }}>Inquire</p>
                  </div>
                )}
                <h3 className={`${mini ? 'text-sm' : 'text-lg'} font-bold mb-4`} style={{ color: C.text }}>
                  Send a Message
                </h3>
                <form className="space-y-3" onSubmit={inquiryForm.handleSubmit}>
                  <input
                    type="text"
                    placeholder="Your name"
                    value={inquiryForm.fields.name}
                    onChange={(e) => inquiryForm.setField('name', e.target.value)}
                    aria-label="Your name"
                    required
                    className={`w-full rounded-lg border px-4 py-3 transition-all duration-300 focus:outline-none focus:ring-2 ${mini ? 'text-[10px] py-2' : 'text-sm'}`}
                    style={{ borderColor: 'rgba(192,132,252,0.25)', background: C.accentSoft, color: C.text }}
                  />
                  <input
                    type="email"
                    placeholder="Your email address"
                    value={inquiryForm.fields.email}
                    onChange={(e) => inquiryForm.setField('email', e.target.value)}
                    aria-label="Email address"
                    required
                    className={`w-full rounded-lg border px-4 py-3 transition-all duration-300 focus:outline-none focus:ring-2 ${mini ? 'text-[10px] py-2' : 'text-sm'}`}
                    style={{ borderColor: 'rgba(192,132,252,0.25)', background: C.accentSoft, color: C.text }}
                  />
                  <input
                    type="text"
                    placeholder="Your contact number (optional)"
                    value={inquiryForm.fields.phone}
                    onChange={(e) => inquiryForm.setField('phone', e.target.value)}
                    aria-label="Contact number"
                    className={`w-full rounded-lg border px-4 py-3 transition-all duration-300 focus:outline-none focus:ring-2 ${mini ? 'text-[10px] py-2' : 'text-sm'}`}
                    style={{ borderColor: 'rgba(192,132,252,0.25)', background: C.accentSoft, color: C.text }}
                  />
                  <input
                    type="text"
                    placeholder="Subject"
                    value={inquiryForm.fields.subject}
                    onChange={(e) => inquiryForm.setField('subject', e.target.value)}
                    aria-label="Subject"
                    className={`w-full rounded-lg border px-4 py-3 transition-all duration-300 focus:outline-none focus:ring-2 ${mini ? 'text-[10px] py-2' : 'text-sm'}`}
                    style={{ borderColor: 'rgba(192,132,252,0.25)', background: C.accentSoft, color: C.text }}
                  />
                  <textarea
                    placeholder="Your message"
                    rows={mini ? 4 : 5}
                    value={inquiryForm.fields.message}
                    onChange={(e) => inquiryForm.setField('message', e.target.value)}
                    aria-label="Message"
                    required
                    className={`w-full rounded-lg border px-4 py-3 resize-none transition-all duration-300 focus:outline-none focus:ring-2 ${mini ? 'text-[10px] py-2' : 'text-sm'}`}
                    style={{ borderColor: 'rgba(192,132,252,0.25)', background: C.accentSoft, color: C.text }}
                  />
                  {inquiryForm.fieldError && (
                    <p className="text-sm text-red-400" role="alert">{inquiryForm.fieldError}</p>
                  )}
                  <button
                    type="submit"
                    disabled={inquiryForm.isSubmitting}
                    className={`w-full flex items-center justify-center gap-2 rounded font-semibold transition-all duration-300 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60 ${mini ? 'py-2.5 text-[10px]' : 'py-3 text-sm'}`}
                    style={{ background: C.accentSoft, color: C.accent, border: `1px solid rgba(192,132,252,0.35)` }}
                  >
                    {inquiryForm.isSubmitting ? 'Sending...' : 'Send Message'}
                  </button>
                </form>
              </div>
            </AnimatedSection>
          )}

          {!mini && (
            <div className="py-6 text-center">
              <div className="flex items-center justify-center gap-3 mb-3">
                <div className="h-[1px] flex-1" style={{ background: 'rgba(255,255,255,0.05)' }} />
                <div className="flex gap-1">
                  <div className="h-1.5 w-1.5 rounded-full rotate-45" style={{ background: C.gold }} />
                  <div className="h-1.5 w-1.5 rounded-full" style={{ background: C.accent }} />
                  <div className="h-1.5 w-1.5 rounded-full rotate-45" style={{ background: C.gold }} />
                </div>
                <div className="h-[1px] flex-1" style={{ background: 'rgba(255,255,255,0.05)' }} />
              </div>
              <p className="text-xs" style={{ color: C.muted }}>
                Powered by <span className="font-bold" style={{ color: C.gold }}>OnTap Creatives</span>
              </p>
            </div>
          )}
        </div>
      </div>

      {showFAB && !mini && <FloatingContactWidget data={d} accent={C.accent} qrUrl={qrUrl} />}
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