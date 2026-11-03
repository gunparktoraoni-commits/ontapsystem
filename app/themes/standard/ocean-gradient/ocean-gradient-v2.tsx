'use client';

import React from 'react';
import PortfolioActionButtons from '../../components/PortfolioActionButtons';
import type { PortfolioViewProps } from '../../shared';
import PortfolioSocialProof from '../../components/PortfolioSocialProof';
import { RichText } from '@/app/components/RichText';
import {
	getDisplayName,
	getInitials,
	SocialIcon,
	PORTFOLIO_SOCIAL_ICON_SIZE,
	PORTFOLIO_SOCIAL_ICON_SIZE_MINI,
	GalleryCarousel,
	VideoCarousel,
	buildGalleryItems,
	buildVideoItems,
	buildServiceMediaItems,
	buildContactLinks,
	AnimatedSection,
	FloatingContactWidget,
	isGalleryEnabled,
	isInquiryEnabled,
	PortfolioCoverMedia,
	usePortfolioInquiryForm,
	PortfolioAddressSection,
	hasPortfolioLocation,
	resolvePortfolioData,
	ServiceMediaCarousel,
	ServicesScrollContainer,
	ContactLinkLabel,
	getContactLinkAriaLabel
} from '../../shared';
import {
  useQRCardDownload,
  QRCardExportSurface,
  toQRCardStyle
} from '../../QRCardDownload';

/* ── derive PortfolioData type from the prop ── */
import CspStyle from '@/app/components/CspStyle';
type PortfolioData = NonNullable<PortfolioViewProps['data']>;
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
function intl(raw: string): string {
  const t = raw.replace(/\s/g, '');
  if (!t) return '';
  if (t.startsWith('+')) return t;
  if (t.startsWith('63')) return `+${t}`;
  return `+63${t}`;
}
function toHttp(raw: string): string {
  const v = clean(raw);
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z0-9.-]+\.[a-z]{2}(\/|$)/i.test(v)) return `https://${v}`;
  return '';
}
function isGMaps(raw: string): boolean {
  const url = toHttp(raw);
  if (!url) return false;
  try {
    const p = new URL(url);
    const h = p.hostname.toLowerCase();
    return h === 'maps.app.goo.gl' || h.startsWith('maps.google.')
      || (h.endsWith('google.com') && p.pathname.toLowerCase().includes('/maps'));
  } catch { return false; }
}
function mapsQuery(raw: string): string {
  const v = clean(raw);
  if (!v) return '';
  const url = toHttp(v);
  if (!url) return v;
  try {
    const p = new URL(url);
    const q = p.searchParams.get('q')?.trim() || p.searchParams.get('query')?.trim() || '';
    if (q) return q;
    const segs = p.pathname.split('/').filter(Boolean);
    const pi = segs.findIndex(s => s.toLowerCase() === 'place');
    if (pi >= 0 && segs[pi + 1]) return decodeURIComponent(segs[pi + 1]).replace(/\+/g, ' ');
    return url;
  } catch { return v; }
}
function embedSrc(raw: string): string {
  const q = mapsQuery(raw);
  return q ? `https://maps.google.com/maps?q=${encodeURIComponent(q)}&output=embed` : '';
}
function mapsHref(raw: string, fallback: string): string {
  const v = clean(raw);
  if (v) {
    const url = toHttp(v);
    if (url) return url;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v)}`;
  }
  return fallback ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fallback)}` : '#';
}

/* ─────────────────────────────────────────────
   THEME PALETTE — Forest Bioluminescence
   Deep forest greens with glowing neon accents
───────────────────────────────────────────── */
const C = {
  bg:         '#0a1209',
  surface:    'rgba(12,22,10,0.88)',
  glass:      'rgba(100,220,120,0.04)',
  border:     'rgba(80,200,100,0.10)',
  borderAcct: 'rgba(80,200,100,0.28)',
  text:       '#e8f4ea',
  textSoft:   '#c4d8c8',
  muted:      'rgba(140,200,150,0.65)',
  accent:     '#4ade80',
  accentAlt:  '#166534',
  accentSoft: 'rgba(74,222,128,0.08)',
  accentGlow: 'rgba(74,222,128,0.22)',
  warm:       '#fde68a',
  headerGrad: 'linear-gradient(160deg, #166534 0%, #4ade80 60%, #bbf7d0 100%)',
  bgGrad:     'linear-gradient(180deg, #0a1209 0%, #0f1e0d 40%, #0a1209 100%)'
};

/* ── Keyframe styles (merged with reference) ── */
const KEYFRAMES = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500;0,9..144,700;0,9..144,900;1,9..144,400&family=Manrope:wght@300;400;500;600;700;800&display=swap');

@keyframes abyssFloat {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-6px) scale(1.02); }
}
@keyframes biolumPulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 0.7; }
}
@keyframes driftLeft {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
@keyframes gentleRotate {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

/* --- Reference keyframes --- */
@keyframes kFadeUp  { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
@keyframes kFadeIn  { from{opacity:0} to{opacity:1} }
@keyframes kScaleIn { from{opacity:0;transform:scale(0.88)} to{opacity:1;transform:scale(1)} }
@keyframes kSlideD  { from{opacity:0;transform:translateY(-16px)} to{opacity:1;transform:translateY(0)} }
@keyframes kWordIn  { from{opacity:0;transform:translateY(24px) rotate(-1deg)} to{opacity:1;transform:translateY(0) rotate(0)} }

.ent-greet { opacity:0; animation:kSlideD  .5s ease .10s forwards }
.ent-word  { opacity:0; animation:kWordIn  .65s cubic-bezier(.2,1.1,.3,1) var(--d,.15s) forwards }
.ent-cta   { opacity:0; animation:kFadeUp  .5s ease .62s forwards }
.ent-img   { opacity:0; animation:kScaleIn .70s cubic-bezier(.2,1,.3,1) .10s forwards }

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
export default function OceanGradientV2({ data, mini = false, showFAB = false, isMobile = false }: PortfolioViewProps) {
  const d = resolvePortfolioData(data);
  const inquiryForm = usePortfolioInquiryForm({ urlAlias: d.bizCard.urlAlias, mini });
  const name     = getDisplayName(d);
  const initials = getInitials(d);
  const title    = profTitle(d);
  const bizLabel = clean(d.bizCard.bizCardName);
  const showBiz  = Boolean(bizLabel && bizLabel.toLowerCase() !== name.trim().toLowerCase());
  const gallery  = buildGalleryItems(d);
  const videos   = buildVideoItems(d);
  const contactLinks = buildContactLinks(d);
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

  const pad     = mini ? 'p-3' : `p-6 ${!isMobile && 'sm:p-8'}`.trim();
  const section = `rounded-[28px] border backdrop-blur-md ${pad}`;
  const nameWords = name.split(' ');
  const hasAbout = Boolean(d.vcard.about || d.bizCard.description);
  const hasServices = srvcs.some(s => s.title);
  const hasGallery = gallery.length > 0;
  const hasVideos = videos.length > 0;
  const hasSocials = contactLinks.some((link) => link.kind === 'social');
  // Show location when map link or coordinates exist
  const hasAddressCity = hasPortfolioLocation(d.vcard);

  return (
    <div className="w-full relative"
      style={{ background: C.bgGrad, color: C.text, minHeight: mini ? 'auto' : '100vh', fontFamily: "'Manrope', sans-serif" }}>

      {/* Inject keyframes */}
      <CspStyle dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />

      {/* ── Deep Abyss Atmospheric Layer ── */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
        {/* Bioluminescent orbs scattered */}
        <div style={{
          position: 'absolute', width: '600px', height: '600px', borderRadius: '50%',
          background: `radial-gradient(circle, rgba(45,212,184,0.04) 0%, transparent 65%)`,
          top: '-200px', right: '-150px',
          animation: 'biolumPulse 7s ease-in-out infinite'}} />
        <div style={{
          position: 'absolute', width: '400px', height: '400px', borderRadius: '50%',
          background: `radial-gradient(circle, rgba(14,116,144,0.05) 0%, transparent 65%)`,
          bottom: '15%', left: '-100px',
          animation: 'biolumPulse 9s ease-in-out infinite 2s'}} />
        <div style={{
          position: 'absolute', width: '200px', height: '200px', borderRadius: '50%',
          background: `radial-gradient(circle, rgba(240,171,252,0.03) 0%, transparent 70%)`,
          top: '40%', right: '10%',
          animation: 'biolumPulse 11s ease-in-out infinite 4s'}} />
        {/* Subtle grain texture */}
        <div style={{
          position: 'absolute', inset: 0, opacity: 0.25,
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.02'/%3E%3C/svg%3E")`}} />
      </div>

      <div className="relative" style={{ zIndex: 1 }}>

        {/* ══ HERO — Organic Asymmetric Composition ══ */}
        {!mini && (
          <div className="relative overflow-hidden" style={{ minHeight: 'clamp(340px, 50vw, 460px)' }}>
            {/* Organic background shape */}
            <div className="absolute inset-0">
              {d.bizCard.coverImage ? (
                <PortfolioCoverMedia
                  src={d.bizCard.coverImage}
                  coverType={d.bizCard.coverType}
                  className="w-full h-full object-cover"
                  style={{ filter: 'brightness(0.3) saturate(0.6)' }}
                />
              ) : (
                <div className="w-full h-full" style={{
                  background: `radial-gradient(ellipse at 30% 20%, rgba(14,116,144,0.3) 0%, transparent 50%),
                               radial-gradient(ellipse at 70% 80%, rgba(45,212,184,0.15) 0%, transparent 50%),
                               ${C.bg}`}} />
              )}
              {/* Organic blob decoration */}
              <svg className="absolute top-0 right-0 w-[60%] h-full opacity-[0.06]" viewBox="0 0 400 400" preserveAspectRatio="none">
                <path d="M300,50 C380,80 400,200 350,300 C300,400 150,380 100,300 C50,220 80,100 150,60 C220,20 260,30 300,50Z" fill={C.accent} />
              </svg>
            </div>

            {/* Content overlay */}
            <div className="relative flex flex-col items-center justify-end h-full px-6 pb-8" style={{ minHeight: 'clamp(340px, 50vw, 460px)' }}>

              {/* Profile image — organic shape */}
              <div className="relative mb-5 ent-img">
                <div style={{
                  width: 'clamp(110px, 18vw, 150px)', height: 'clamp(110px, 18vw, 150px)',
                  borderRadius: '42% 58% 62% 38% / 45% 55% 45% 55%',
                  padding: '3px',
                  background: `linear-gradient(160deg, ${C.accent}, ${C.accentAlt}, ${C.warm})`,
                  boxShadow: `0 20px 60px ${C.accentGlow}, 0 0 80px ${C.accentGlow}`}}>
                  <div className="w-full h-full overflow-hidden flex items-center justify-center"
                    style={{ borderRadius: '42% 58% 62% 38% / 45% 55% 45% 55%', background: C.bg }}>
                    {d.bizCard.profileImage
                      ? <img src={d.bizCard.profileImage} alt="Profile" className="w-full h-full object-cover object-center" />
                      : <span className="text-3xl font-black"></span>}
                  </div>
                </div>
              </div>
              {/* Name & Title */}
              <h1 className="text-center" style={{
                fontFamily: "'Fraunces', serif",
                fontSize: 'clamp(26px, 5.5vw, 42px)',
                fontWeight: 700,
                lineHeight: 1.1,
                color: C.text}}>
                {nameWords.map((word, i) => (
                  <span
                    key={i}
                    className="ent-word"
                    style={{ '--d': `${0.15 + i * 0.10}s` } as React.CSSProperties}
                  >
                    {word}{i < nameWords.length - 1 ? ' ' : ''}
                  </span>
                ))}
              </h1>
            
              {title && (
                <p className="mt-3 text-[20px] font-medium tracking-widest uppercase px-4 py-1.5 rounded-full"
                style={{ color: C.accent }}
                 >
                  {title}
                </p>
              )}
            </div>

            {/* Bottom fade */}
            <div className="absolute bottom-0 left-0 right-0 h-24" style={{ background: `linear-gradient(to top, ${C.bg}, transparent)` }} />
          </div>
        )}

        {/* ══ CONTENT STACK ══ */}
        <div className={`${mini ? 'px-3' : `px-5 ${!isMobile && 'sm:px-7'}`.trim()} space-y-6 ${mini ? 'pb-8' : 'pb-28'}`}
          style={{ maxWidth: mini ? undefined : '620px', margin: mini ? undefined : '0 auto' }}>

          {/* ── Mini mode header ── */}
          {mini && (
            <AnimatedSection delay={0} mini={mini}>
              <div className={section} style={{ background: C.surface, borderColor: C.border }}>
                <div className="flex items-center gap-2.5">
                  <div style={{
                    padding: '2px', borderRadius: '38% 62% 60% 40% / 50% 45% 55% 50%',
                    background: `linear-gradient(135deg, ${C.accent}, ${C.accentAlt})`}}>
                    <div className="h-8 w-8 overflow-hidden flex items-center justify-center text-xs font-bold"
                      style={{ borderRadius: '38% 62% 60% 40% / 50% 45% 55% 50%', background: C.bg }}>
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
              </div>
            </AnimatedSection>
          )}

          {!mini && (
            <div className="flex justify-center ent-cta">
              <PortfolioActionButtons
                data={d}
                shareUrl={shareUrl}
                theme={{
                  accent: C.accent,
                  accentGlow: C.accentGlow,
                  primaryText: '#0a1209',
                  text: C.text,
                  surface: C.glass,
                  border: C.borderAcct,
                }}
                layout="row"
                compact={false}
              />
            </div>
          )}

          {/* ── Socials Card ── */}
          {(!mini || hasSocials) && (
            <AnimatedSection delay={200} mini={mini}>
              <div className={section} style={{ background: C.surface, borderColor: C.border }}>
                {!mini && (
                  <div className="flex items-center gap-2 mb-5">
                    <div className="h-1 w-6 rounded-full" style={{ background: C.accent }} />
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: C.accent }}>
                      Socials
                    </p>
                  </div>
                )}
                {hasSocials && (
                  <div className="flex flex-wrap justify-center gap-2">
                    {contactLinks.filter((link) => link.kind === 'social').map((link, i) => (
                      <a
                        key={`social-${i}`}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={getContactLinkAriaLabel(link)}
                        aria-label={getContactLinkAriaLabel(link)}
                        className={`inline-flex items-center justify-center rounded-full transition-all duration-300 hover:scale-105 hover:-translate-y-0.5 ${mini ? 'h-11 w-11' : 'h-12 w-12'}`}
                        style={{ background: C.glass, border: `1px solid ${C.border}`, color: C.textSoft }}
                      >
                        <SocialIcon platform={link.platform} size={mini ? PORTFOLIO_SOCIAL_ICON_SIZE_MINI : PORTFOLIO_SOCIAL_ICON_SIZE} />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </AnimatedSection>
          )}

          {/* ── Contact Card ── */}
          {contactLinks.some((link) => link.kind === 'contact') && (
            <AnimatedSection delay={220} mini={mini}>
              <div className={section} style={{ background: C.surface, borderColor: C.border }}>
                {!mini && (
                  <div className="flex items-center gap-2 mb-5">
                    <div className="h-1 w-6 rounded-full" style={{ background: C.accent }} />
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: C.accent }}>Contact</p>
                  </div>
                )}
                <div className="grid grid-cols-1 gap-2">
                  {contactLinks.filter((link) => link.kind === 'contact').map((link, i) => (
                    <a
                      key={`contact-${i}`}
                      href={link.url}
                      target="_self"
                      rel="noopener noreferrer"
                      title={getContactLinkAriaLabel(link)}
                      aria-label={getContactLinkAriaLabel(link)}
                      className={`flex items-center justify-center gap-2 rounded-full transition-all duration-300 hover:scale-105 hover:-translate-y-0.5 ${mini ? 'h-8 text-[8px]' : 'h-11 text-xs'} px-3 font-medium`}
                      style={{ background: C.glass, border: `1px solid ${C.border}`, color: C.textSoft }}
                    >
                      <SocialIcon platform={link.platform} size={mini ? PORTFOLIO_SOCIAL_ICON_SIZE_MINI : PORTFOLIO_SOCIAL_ICON_SIZE} />
                      <ContactLinkLabel link={link} className="truncate" />
                    </a>
                  ))}
                </div>
              </div>
            </AnimatedSection>
          )}

          {/* ── About Card ── */}
          {!mini && hasAbout && (
            <AnimatedSection delay={80} mini={mini}>
              <div className={section} style={{ background: C.surface, borderColor: C.border }}>
                <div className="flex items-center gap-2 mb-4">
                  <div className="h-1 w-6 rounded-full" style={{ background: C.accent }} />
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: C.accent, fontFamily: "'Manrope', sans-serif" }}>
                  </p>
                </div>
                <p className="text-sm leading-[1.8]" style={{ color: C.textSoft }}>
                  <RichText html={d.vcard.about || d.bizCard.description} />
                </p>
                <PortfolioSocialProof
                  data={d}
                  mini={mini}
                  className="mt-4"
                  theme={{
                    surface: C.glass,
                    border: C.borderAcct,
                    text: C.text,
                    muted: C.muted,
                    accent: C.accent,
                    accentSoft: C.accentSoft,
                    divider: C.border,
                    shadow: `0 16px 36px ${C.accentGlow}`,
                    radius: '20px',
                    backdropFilter: 'blur(16px)',
                  }}
                />
              </div>
            </AnimatedSection>
          )}

          {/* ── Services — Stacked organic cards ── */}
          {hasServices && (
            <AnimatedSection delay={140} mini={mini}>
              <div className={section} style={{ background: C.surface, borderColor: C.border }}>
                {mini ? (
                  <>
                    <h3 className="text-[10px] font-bold mb-3">Services</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {srvcs.filter(s => s.title).map((s, i) => {
                        const mediaItems = buildServiceMediaItems(s, s.media ?? []);
                        return (
                          <div key={i} className="rounded-xl overflow-hidden border" style={{ background: C.glass, borderColor: C.border }}>
                            <div className="w-full min-h-[72px] overflow-hidden relative">
                              {mediaItems.length > 0 ? (
                                <ServiceMediaCarousel
                                  items={mediaItems}
                                  accent={C.accent}
                                  glass={C.glass}
                                  textMuted={C.muted}
                                  mini={true}
                                  variant="ocean-gradient-v2"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center" style={{ background: C.accentSoft }}>
                                  <span className="text-3xl font-bold opacity-20" style={{ color: C.accent }}>{s.title?.[0]}</span>
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
                    <div className="flex items-center gap-2 mb-6">
                      <div className="h-1 w-6 rounded-full" style={{ background: C.accent }} />
                      <h3 className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: C.accent }}>
                        What I Do
                      </h3>
                    </div>
                    <ServicesScrollContainer
                      isMobile={isMobile}
                      mini={mini}
                      desktopClassName="space-y-4"
                    >
                      {srvcs.filter(s => s.title).map((s, i) => {
                        const mediaItems = buildServiceMediaItems(s, s.media ?? []);
                        return (
                          <div
                            key={i}
                            className="group overflow-hidden rounded-[20px] border transition-all duration-400 hover:border-opacity-100 hover:-translate-y-0.5"
                            style={{ background: C.glass, borderColor: C.border }}
                          >
                            <div
                              className="relative w-full aspect-4/3 overflow-hidden"
                              style={{ background: C.accentSoft }}
                            >
                              {mediaItems.length > 0 ? (
                                <ServiceMediaCarousel
                                  items={mediaItems}
                                  accent={C.accent}
                                  glass={C.glass}
                                  textMuted={C.muted}
                                  mini={false}
                                  variant="ocean-gradient-v2"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${C.accentSoft}, ${C.glass})` }}>
                                  <span className="text-3xl font-black opacity-30" style={{ color: C.accent }}>
                                    {String(i + 1).padStart(2, '0')}
                                  </span>
                                </div>
                              )}
                            </div>
                            <div className="p-4">
                              <h4 className="text-sm font-bold mb-1" style={{ color: C.text }}>{s.title}</h4>
                              {s.tagline && <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: C.accent }}>{s.tagline}</p>}
                              {s.description && (
                                <p className="text-xs leading-relaxed line-clamp-3" style={{ color: C.muted }}><RichText html={s.description} /></p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </ServicesScrollContainer>
                  </>
                )}
              </div>
            </AnimatedSection>
          )}

          {/* ── Gallery ── */}
          {isGalleryEnabled(d, mini) && hasGallery && (
            <AnimatedSection delay={260} mini={mini}>
              <div className={section} style={{ background: C.surface, borderColor: C.border }}>
                <div className="flex items-center gap-2 mb-5">
                  <div className="h-1 w-6 rounded-full" style={{ background: C.accent }} />
                  <h3 className={`${mini ? 'text-[10px]' : 'text-[10px]'} font-bold uppercase tracking-[0.2em]`} style={{ color: C.accent }}>
                    Featured Gallery
                  </h3>
                </div>
                <GalleryCarousel items={gallery} accent={C.accent} glass={C.glass} textMuted={C.muted} mini={mini} variant="ocean-gradient" />
              </div>
            </AnimatedSection>
          )}

          {/* ── Videos ── */}
          {isGalleryEnabled(d, mini) && hasVideos && (
            <AnimatedSection delay={320} mini={mini}>
              <div className={section} style={{ background: C.surface, borderColor: C.border }}>
                <div className="flex items-center gap-2 mb-5">
                  <div className="h-1 w-6 rounded-full" style={{ background: C.accent }} />
                  <h3 className={`${mini ? 'text-[10px]' : 'text-[10px]'} font-bold uppercase tracking-[0.2em]`} style={{ color: C.accent }}>
                    Videos
                  </h3>
                </div>
                <VideoCarousel items={videos} accent={C.accent} glass={C.glass} textMuted={C.muted} mini={mini} variant="ocean-gradient" />
              </div>
            </AnimatedSection>
          )}

          {/* ── Address Section — show when map link or coordinates exist ── */}
          {hasAddressCity && (
            <AnimatedSection delay={360} mini={mini}>
              <PortfolioAddressSection
                vcard={d.vcard}
                mini={mini}
                theme={{ cardBg: C.surface, text: C.text, textMuted: C.muted, accent: C.accent, glass: C.glass }}
              />
            </AnimatedSection>
          )}

          {/* ── Inquire ── */}
          {isInquiryEnabled(d, mini) && (
            <AnimatedSection delay={420} mini={mini}>
              <div className={section} style={{ background: C.surface, borderColor: C.border }}>
                {!mini && (
                  <div className="flex items-center gap-2 mb-5">
                    <div className="h-1 w-6 rounded-full" style={{ background: C.accent }} />
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: C.accent }}>Inquire</p>
                  </div>
                )}
                <h3 className={`${mini ? 'text-sm' : 'text-lg'} font-bold mb-4`} style={{ fontFamily: "'Fraunces', serif", color: C.text }}>
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
                    className={`w-full rounded-2xl border px-4 py-3 transition-all duration-300 focus:outline-none focus:ring-2 ${mini ? 'text-[10px] py-2' : 'text-sm'}`}
                    style={{ borderColor: C.border, background: C.accentSoft, color: C.text }}
                  />
                  <input
                    type="email"
                    placeholder="Your email address"
                    value={inquiryForm.fields.email}
                    onChange={(e) => inquiryForm.setField('email', e.target.value)}
                    aria-label="Email address"
                    required
                    className={`w-full rounded-2xl border px-4 py-3 transition-all duration-300 focus:outline-none focus:ring-2 ${mini ? 'text-[10px] py-2' : 'text-sm'}`}
                    style={{ borderColor: C.border, background: C.accentSoft, color: C.text }}
                  />
                  <input
                    type="text"
                    placeholder="Your contact number (optional)"
                    value={inquiryForm.fields.phone}
                    onChange={(e) => inquiryForm.setField('phone', e.target.value)}
                    aria-label="Contact number"
                    className={`w-full rounded-2xl border px-4 py-3 transition-all duration-300 focus:outline-none focus:ring-2 ${mini ? 'text-[10px] py-2' : 'text-sm'}`}
                    style={{ borderColor: C.border, background: C.accentSoft, color: C.text }}
                  />
                  <input
                    type="text"
                    placeholder="Subject"
                    value={inquiryForm.fields.subject}
                    onChange={(e) => inquiryForm.setField('subject', e.target.value)}
                    aria-label="Subject"
                    className={`w-full rounded-2xl border px-4 py-3 transition-all duration-300 focus:outline-none focus:ring-2 ${mini ? 'text-[10px] py-2' : 'text-sm'}`}
                    style={{ borderColor: C.border, background: C.accentSoft, color: C.text }}
                  />
                  <textarea
                    placeholder="Your message"
                    rows={mini ? 4 : 5}
                    value={inquiryForm.fields.message}
                    onChange={(e) => inquiryForm.setField('message', e.target.value)}
                    aria-label="Message"
                    required
                    className={`w-full rounded-2xl border px-4 py-3 resize-none transition-all duration-300 focus:outline-none focus:ring-2 ${mini ? 'text-[10px] py-2' : 'text-sm'}`}
                    style={{ borderColor: C.border, background: C.accentSoft, color: C.text }}
                  />
                  {inquiryForm.fieldError && (
                    <p className="text-sm text-red-400" role="alert">{inquiryForm.fieldError}</p>
                  )}
                  <button
                    type="submit"
                    disabled={inquiryForm.isSubmitting}
                    className={`w-full flex items-center justify-center gap-2 rounded-2xl font-bold transition-all duration-300 hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-60 ${mini ? 'py-2.5 text-[10px]' : 'py-3.5 text-xs'}`}
                    style={{ background: `linear-gradient(135deg, ${C.accentAlt}, ${C.accent})`, color: '#0a1209' }}
                  >
                    {inquiryForm.isSubmitting ? 'Sending...' : 'Send Message'}
                  </button>
                </form>
              </div>
            </AnimatedSection>
          )}

          {/* ── Footer ── */}
          {!mini && (
            <div className="py-8 text-center">
              <div className="flex items-center justify-center gap-3 mb-3">
                <div className="h-[1px] flex-1" style={{ background: `linear-gradient(90deg, transparent, ${C.border})` }} />
                <div className="h-1 w-1 rounded-full" style={{ background: C.accent, opacity: 0.5 }} />
                <div className="h-[1px] flex-1" style={{ background: `linear-gradient(90deg, ${C.border}, transparent)` }} />
              </div>
              <p className="text-[11px]" style={{ color: C.muted }}>
                Powered by <span className="font-bold" style={{ color: C.accent, fontFamily: "'Fraunces', serif" }}>OnTap Creatives</span>
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