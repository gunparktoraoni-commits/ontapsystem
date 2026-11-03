'use client';

import { Download, Share2, User
} from 'lucide-react';
import type { PortfolioViewProps } from '../../shared';
import {
  getDisplayName,
  getInitials,
  downloadVCard,
  GalleryCarousel,
  VideoCarousel,
  ServiceMediaCarousel,
  ServicesScrollContainer,
  buildGalleryItems,
  buildVideoItems,
  buildServiceMediaItems,
  buildContactLinks,
  getContactLinkAriaLabel,
  ContactLinkLabel,
  AnimatedSection,
  FloatingContactWidget,
  isGalleryEnabled,
  isInquiryEnabled,
  usePortfolioInquiryForm,
  PortfolioAddressSection,
  hasPortfolioLocation, resolvePortfolioData,
  toServableMediaSrc,
  getProfileImageOrNull,
  PortfolioCoverMedia,
  usePortfolioViewerSession,
  SocialIcon,
	PORTFOLIO_SOCIAL_ICON_SIZE,
} from '../../shared';
import {
  useQRCardDownload,
  QRCardExportSurface,
  toQRCardStyle
} from '../../QRCardDownload';
import PortfolioSocialProof from '../../components/PortfolioSocialProof';

import CspStyle from '@/app/components/CspStyle';
import { RichText } from '@/app/components/RichText';
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
   THEME PALETTE — Elegant Dark v2: Cool Slate Blue
───────────────────────────────────────────── */
const C = {
  bg: '#0a0c14',
  surface: '#111827',
  surfaceAlt: '#1a2035',
  glass: 'rgba(200,220,255,0.02)',
  border: 'rgba(100,160,255,0.09)',
  borderHov: 'rgba(100,160,255,0.20)',
  text: '#e8edf8',
  textSoft: '#d0d8f0',
  muted: '#7a8aaa',
  accent: '#4f8ef7',
  accentWarm: '#7eb0ff',
  accentSoft: 'rgba(79,142,247,0.10)',
  accentGlow: 'rgba(126,176,255,0.06)',
  gold: '#a8c8ff',
  cream: '#eef4ff',
  headerGrad: 'linear-gradient(165deg, #1a2035 0%, #0a0c14 100%)',
  bgGrad: 'linear-gradient(180deg, #0a0c14 0%, #0e1220 50%, #0a0c14 100%)',
  verified: '#10b981'
};

/* ─────────────────────────────────────────────
   GLOBAL STYLES (merged from reference)
───────────────────────────────────────────── */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=DM+Sans:wght@300;400;500;600;700&display=swap');

@keyframes kFadeUp  { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
@keyframes kFadeIn  { from{opacity:0} to{opacity:1} }
@keyframes kScaleIn { from{opacity:0;transform:scale(0.88)} to{opacity:1;transform:scale(1)} }
@keyframes kSlideD  { from{opacity:0;transform:translateY(-16px)} to{opacity:1;transform:translateY(0)} }
@keyframes kPulse   { 0%,100%{opacity:.30;transform:scale(1)} 50%{opacity:.65;transform:scale(1.08)} }
@keyframes kDrift   { 0%,100%{transform:translate(0,0)} 40%{transform:translate(10px,-8px)} 70%{transform:translate(-6px,5px)} }
@keyframes kSpin    { to{transform:rotate(360deg)} }
@keyframes kShimmer { 0%{background-position:-300% center} 100%{background-position:300% center} }
@keyframes kPing    { 75%,100%{transform:scale(2.4);opacity:0} }
@keyframes kRing    { 0%,100%{box-shadow:0 0 0 0 rgba(34,197,94,0)} 50%{box-shadow:0 0 0 5px rgba(34,197,94,0.18)} }
@keyframes kBorderPulse { 0%,100%{border-color:rgba(195,145,65,0.08)} 50%{border-color:rgba(195,145,65,0.22)} }
@keyframes kWordIn  { from{opacity:0;transform:translateY(24px) rotate(-1deg)} to{opacity:1;transform:translateY(0) rotate(0)} }

.ent-brand { opacity:0; animation:kFadeIn  .5s ease .04s forwards }
.ent-greet { opacity:0; animation:kSlideD  .5s ease .10s forwards }
.ent-word  { opacity:0; animation:kWordIn  .65s cubic-bezier(.2,1.1,.3,1) var(--d,.15s) forwards }
.ent-sub   { opacity:0; animation:kFadeUp  .5s ease .50s forwards }
.ent-cta   { opacity:0; animation:kFadeUp  .5s ease .62s forwards }
.ent-img   { opacity:0; animation:kScaleIn .70s cubic-bezier(.2,1,.3,1) .10s forwards }

.el-card {
  border-radius: 16px;
  border: 1px solid ${C.border};
  background: ${C.surface};
  box-shadow: 0 2px 24px rgba(0,0,0,.30), inset 0 1px 0 rgba(200,220,255,.022);
  transition: box-shadow .30s ease, border-color .28s ease, transform .30s cubic-bezier(.2,1,.3,1);
}
.el-card:hover {
  box-shadow:0 14px 44px rgba(0,0,0,.44), 0 0 0 1px ${C.borderHov};
  border-color:${C.borderHov};
}

.srv {
  border-radius: 14px;
  border: 1px solid ${C.border};
  background: ${C.surfaceAlt};
  overflow: visible;
  transition: transform .30s cubic-bezier(.2,1,.3,1), box-shadow .30s ease, border-color .26s ease;
}
.srv:hover { transform:translateY(-5px); box-shadow:0 18px 48px rgba(0,0,0,.5); border-color:${C.borderHov} }
.srv:hover .srv-img { transform:scale(1.07) }
.srv:hover .srv-bar { opacity:1 !important }
.srv-img { transition:transform .45s cubic-bezier(.2,1,.3,1) }
.srv-media {
  width: 100%;
  position: relative;
  overflow: visible;
  padding: 8px 8px 0;
}

.btn-fill {
  display:inline-flex; align-items:center; justify-content:center; gap:8px;
  padding:11px 22px; border-radius:40px; border:none; cursor:pointer;
  font-family:'DM Sans',sans-serif; font-size:13px; font-weight:600; letter-spacing:.022em;
  color:#fff;
  background: linear-gradient(135deg,${C.accent} 0%,${C.accentWarm} 50%,#7eb0ff 100%);
  box-shadow: 0 5px 20px rgba(79,142,247,.32), inset 0 1px 0 rgba(255,255,255,.10);
  transition: transform .20s ease, box-shadow .20s ease;
  position:relative; overflow:hidden;
}
.btn-fill::after {
  content:''; position:absolute; inset:0;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.07),transparent);
  background-size:300% 100%; animation:kShimmer 3s infinite; opacity:0; transition:opacity .3s;
}
.btn-fill:hover { transform:translateY(-2px) scale(1.015); box-shadow:0 10px 32px rgba(79,142,247,.40) }
.btn-fill:hover::after { opacity:1 }

.btn-ghost {
  display:inline-flex; align-items:center; justify-content:center; gap:8px;
  padding:11px 20px; border-radius:40px; cursor:pointer;
  font-family:'DM Sans',sans-serif; font-size:13px; font-weight:600; letter-spacing:.022em;
  color:${C.muted};
  background:transparent; border:1px solid ${C.border};
  transition: transform .20s ease, background .20s ease, border-color .20s ease;
}
.btn-ghost:hover { transform:translateY(-2px); background:rgba(200,220,255,.04); border-color:${C.borderHov} }

.soc {
  display:flex; align-items:center; justify-content:center;
  border-radius:12px; text-decoration:none;
  background:${C.surfaceAlt}; border:1px solid ${C.border};
  transition: transform .20s cubic-bezier(.3,1.4,.5,1), background .20s ease, border-color .20s ease;
}
.soc:hover { transform:translateY(-4px) scale(1.12); background:${C.accentSoft}; border-color:${C.borderHov} }

.sl { display:flex; align-items:center; gap:9px; margin-bottom:18px }

.map-ink { filter:grayscale(90%) contrast(110%) brightness(.43) sepia(20%) hue-rotate(5deg) }

.grain {
  position:fixed; inset:0; pointer-events:none; z-index:0;
  background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.78' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)' opacity='.028'/%3E%3C/svg%3E");
  opacity:.42;
}

.nbadge {
  font-family:'Playfair Display',serif;
  background:linear-gradient(135deg,${C.accent},${C.accentWarm});
  -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text;
}

.prof-ring { animation:kBorderPulse 3.5s ease-in-out infinite }

@media (max-width:639px) {
  .grid-2 { grid-template-columns:1fr !important }
  .grid-3 { grid-template-columns:1fr !important }
}
@media (min-width:640px) and (max-width:1023px) {
  .grid-2 { grid-template-columns:1fr 1fr !important }
  .grid-3 { grid-template-columns:1fr 1fr !important }
}
@media (min-width:1024px) {
  .grid-2 { grid-template-columns:1fr 1fr !important }
  .grid-3 { grid-template-columns:1fr 1fr 1fr !important }
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
   LOCAL COMPONENTS
───────────────────────────────────────────── */
function SL({ label }: { label: string }) {
  return (
    <div className="sl">
      <span style={{
        fontSize: 13, fontWeight: 700, letterSpacing: '0.18em',
        textTransform: 'uppercase', color: C.accentWarm,
        fontFamily: "'DM Sans',sans-serif"
      }}>{label}</span>
    </div>
  );
}

function Card({ children, delay = 0, mini = false, style = {}, noPad = false }: {
  children: React.ReactNode; delay?: number; mini?: boolean;
  style?: React.CSSProperties; noPad?: boolean;
}) {
  return (
    <AnimatedSection delay={delay} mini={mini}>
      <div
        className="el-card"
        style={{
          padding: noPad ? 0 : mini ? '14px' : '22px 26px',
          overflow: noPad ? 'hidden' : undefined,
          ...style
        }}
      >
        {children}
      </div>
    </AnimatedSection>
  );
}

/* ─────────────────────────────────────────────
   MAIN EXPORT
───────────────────────────────────────────── */
export default function ElegantDarkV2({ data, mini = false, showFAB = false, isMobile = false }: PortfolioViewProps) {
  const d = resolvePortfolioData(data);
  const inquiryForm = usePortfolioInquiryForm({ urlAlias: d.bizCard.urlAlias, mini });
  const { checked: sessionChecked, isAuthenticated } = usePortfolioViewerSession();
  const name = getDisplayName(d);
  const initials = getInitials(d);
  const title = profTitle(d);
  const bizLabel = clean(d.bizCard.bizCardName);
  const showBiz = Boolean(bizLabel && bizLabel.toLowerCase() !== name.trim().toLowerCase());
  const gallery = buildGalleryItems(d);
  const videos = buildVideoItems(d);
  const shareUrl = typeof window !== 'undefined' && d.bizCard.urlAlias
    ? `${window.location.origin}/${d.bizCard.urlAlias}` : '';
  const qrUrl = shareUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=280x280&ecc=H&data=${encodeURIComponent(shareUrl)}` : '';
  const { cardRef, qrDataUrl, download: downloadQRCard, isDownloading } = useQRCardDownload(d, shareUrl);
  const qrCardStyle = toQRCardStyle(C);

  const srvcs = d.services ?? [];
  const nameWords = name.split(' ');
  const hasAbout = Boolean(d.vcard.about || d.bizCard.description);
  const hasSrvcs = srvcs.some(s => s.title);
  const contactLinks = buildContactLinks(d);
  const bgImg = clean((d.bizCard as any).coverImage || (d.bizCard as any).backgroundImage || '');
  const profileImg = getProfileImageOrNull(d);
  const coverBg = bgImg ? toServableMediaSrc(bgImg) : '';

  const pad = mini ? 'p-4' : `p-5 ${!isMobile && 'sm:p-6 lg:p-8'}`.trim();
  const section = `rounded-[16px] ${!isMobile && 'sm:rounded-[20px]'} border backdrop-blur-sm ${pad}`;

  return (
    <div className="w-full relative"
      style={{ background: C.bgGrad, color: C.text, minHeight: mini ? 'auto' : '100vh', fontFamily: "'DM Sans', sans-serif" }}>
      <CspStyle dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="grain" />

      {/* ── Atmospheric Background Layer ── */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.015'/%3E%3C/svg%3E")`,
          opacity: 0.4
        }} />
        <div style={{
          position: 'absolute', width: '500px', height: '500px', borderRadius: '50%',
          background: `radial-gradient(circle, rgba(79,142,247,0.04) 0%, transparent 70%)`,
          top: '-100px', right: '-100px',
          animation: 'elegantPulse 8s ease-in-out infinite'
        }} />
        <div style={{
          position: 'absolute', width: '400px', height: '400px', borderRadius: '50%',
          background: `radial-gradient(circle, rgba(168,200,255,0.03) 0%, transparent 70%)`,
          bottom: '20%', left: '-150px',
          animation: 'elegantPulse 10s ease-in-out infinite 2s'
        }} />
      </div>

      <div className="relative" style={{ zIndex: 1 }}>

        {/* ══ HERO SECTION — Responsive Split Layout ══ */}
        {!mini && (
          <div className="relative overflow-hidden" style={{ minHeight: isMobile ? 'auto' : 'clamp(320px, 55vw, 520px)' }}>
            {/* Background image */}
            {coverBg && (
              <>
                <PortfolioCoverMedia
                  src={coverBg}
                  coverType={d.bizCard.coverType}
                  className="absolute inset-0 h-full w-full"
                  style={{ zIndex: 0 }}
                />
                <div style={{
                  position: 'absolute', inset: 0, zIndex: 0,
                  backgroundImage: 'linear-gradient(to bottom,rgba(10,12,20,.50) 0%,rgba(10,12,20,.75) 55%,rgba(10,12,20,.97) 100%)',
                  pointerEvents: 'none',
                }} />
              </>
            )}
            <div className="absolute inset-0 pointer-events-none">
              <div style={{
                position: 'absolute', top: '8%', right: '5%',
                width: 'clamp(160px, 40vw, 320px)', height: 'clamp(200px, 50vw, 400px)',
                borderRadius: '24px', background: `linear-gradient(145deg, ${C.accentWarm}15, ${C.accent}08)`,
                border: `1px solid ${C.border}`,
                transform: 'rotate(-2deg)'
              }} />
              <div className={`${!isMobile && 'hidden md:block'}`} style={{
                position: 'absolute', top: '15%', right: '42%',
                width: '12px', height: '12px', borderRadius: '50%',
                background: C.accent, opacity: 0.7,
                animation: 'orbFloat 6s ease-in-out infinite'
              }} />
              <div style={{
                position: 'absolute', top: '60%', right: '12%',
                width: '16px', height: '16px', borderRadius: '50%',
                background: C.accentWarm, opacity: 0.5,
                animation: 'orbFloat 8s ease-in-out infinite 1s'
              }} />
              <div style={{
                position: 'absolute', top: '25%', right: '8%',
                width: '8px', height: '8px', borderRadius: '50%',
                background: C.gold, opacity: 0.6,
                animation: 'orbFloat 5s ease-in-out infinite 0.5s'
              }} />
              <div className={`${!isMobile && 'hidden sm:block'}`} style={{
                position: 'absolute', top: '20%', right: '15%',
                width: '80px', height: '80px', borderRadius: '50%',
                border: `1px solid ${C.border}`,
                animation: 'elegantFloat 7s ease-in-out infinite'
              }} />
              <svg className={`absolute ${!isMobile && 'hidden md:block'}`} style={{ top: '30%', right: '10%', width: '200px', height: '200px', opacity: 0.15 }}>
                <path d="M10,100 Q100,10 190,100" fill="none" stroke={C.accentWarm} strokeWidth="1.5" />
                <path d="M30,140 Q120,50 190,130" fill="none" stroke={C.accent} strokeWidth="1" />
              </svg>
            </div>

            <div className={`relative flex flex-col px-6 pt-10 pb-12 ${!isMobile && 'md:flex-row md:items-center sm:px-8 md:px-10 md:py-0 md:h-full'}`}
              style={{ minHeight: isMobile ? 'auto' : 'clamp(320px, 55vw, 520px)' }}>

              <div className={`w-full z-10 text-center ${!isMobile && 'md:flex-1 md:pr-4 md:text-left'}`}>
                {d.bizCard.occupation && 
                  <p className="ent-greet mb-3" style={{ color: C.muted, fontSize: '14px', fontStyle: 'italic', fontFamily: "'Playfair Display', serif" }}>
                    {d.bizCard.occupation}
                  </p>
                }

                <h1 style={{
                  fontFamily: "'Playfair Display', serif",
                  fontSize: 'clamp(28px, 6vw, 48px)',
                  fontWeight: 900,
                  lineHeight: 1.1,
                  color: C.text,
                  letterSpacing: '-0.02em'
                }}>
                  {nameWords.map((word, i) => (
                    <span
                      key={i}
                      className="ent-word"
                      style={{ '--d': `${0.15 + i * 0.10}s` } as React.CSSProperties}
                    >
                      {word}{i < nameWords.length - 1 ? ',' : ''}
                    </span>
                  ))}
                </h1>

                <div className="ent-cta mt-6 flex flex-wrap justify-center gap-3">
                  <button onClick={() => downloadVCard(d)} className="btn-fill">
                    <Download className="h-4 w-4" /> Save Contact
                  </button>
                  <button
                    onClick={async () => {
                      if (typeof window === 'undefined') return;
                      const url = shareUrl || `${window.location.origin}/${d.bizCard.urlAlias}`;
                      if (navigator.share) await navigator.share({ title: name, url }).catch(() => { });
                      else await navigator.clipboard.writeText(url).catch(() => { });
                    }}
                    className="btn-ghost"
                  >
                    <Share2 className="h-4 w-4" /> Share
                  </button>
                </div>
                <PortfolioSocialProof
                  data={d}
                  mini={mini}
                  className="mt-4 w-full max-w-md"
                  theme={{
                    surface: C.surfaceAlt,
                    border: C.borderHov,
                    text: C.text,
                    muted: C.muted,
                    accent: C.accent,
                    accentSoft: C.accentSoft,
                    divider: C.border,
                    shadow: `0 16px 36px ${C.accentGlow}`,
                    radius: '16px',
                  }}
                />
              </div>

              <div className={`w-full flex justify-center items-center relative mt-8 ${!isMobile && 'md:flex-1 md:items-end md:mt-0'}`}>
                <div className="relative ent-img">
                  <div className="absolute inset-0 rounded-[20px]" style={{
                    background: `linear-gradient(160deg, ${C.accentWarm}20, ${C.accent}10)`,
                    transform: 'rotate(3deg) scale(1.05)',
                    border: `1px solid ${C.border}`
                  }} />
                  <div className="relative rounded-[20px] overflow-hidden" style={{
                    width: 'clamp(200px, 52vw, 280px)',
                    height: 'clamp(240px, 65vw, 360px)'
                  }}>
                    {profileImg ? (
                      <img
                        src={profileImg}
                        alt="Profile"
                        className="object-cover"
                        style={{
                          position: 'absolute',
                          inset: 0,
                          width: '100%',
                          height: '100%',
                          maxWidth: 'none',
                          objectFit: 'cover',
                          objectPosition: 'center center',
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${C.surfaceAlt}, ${C.bg})` }}>
                        <User className="h-16 w-16" style={{ color: C.muted }} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ CONTENT STACK ══ */}
        <div className={`${mini ? 'px-3' : `px-4 ${!isMobile ? 'sm:px-6 md:px-8' : ''}`.trim()} space-y-5 ${!isMobile && 'sm:space-y-7'} ${mini ? 'pb-8' : `pb-24 ${!isMobile ? 'md:pb-28' : ''}`.trim()}`}
          style={{ maxWidth: mini ? undefined : '640px', margin: mini ? undefined : '0 auto' }}>

          {mini && (
            <Card delay={0} mini>
              <div className="flex items-center gap-2.5">
                <div className="relative h-9 w-9 rounded-full border overflow-hidden flex items-center justify-center text-xs font-bold shrink-0"
                  style={{ borderColor: C.border, background: C.surfaceAlt }}>
                  {profileImg
                    ? <img
                        src={profileImg}
                        alt=""
                        className="object-cover"
                        style={{
                          position: 'absolute',
                          inset: 0,
                          width: '100%',
                          height: '100%',
                          maxWidth: 'none',
                          objectFit: 'cover',
                          objectPosition: 'center center',
                        }}
                      />
                    : <span style={{ color: C.accent }}>{initials}</span>}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold truncate">{name}</p>
                  <p className="text-[8px] truncate mt-0.5" style={{ color: C.muted }}>
                    {[showBiz ? bizLabel : '', title].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </div>
            </Card>
          )}

          {/* ── Socials Card ── */}
          {contactLinks.some((link) => link.kind === 'social') && (
            <Card delay={150} mini={mini}>
              {!mini && <SL label="Socials" />}
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: mini ? 8 : 10,
                justifyContent: 'center',
                width: '100%',
                paddingTop: mini ? 0 : 4,
              }}>
                {contactLinks.filter((link) => link.kind === 'social').map((link, i) => (
                  <a
                    key={`social-${i}`}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={getContactLinkAriaLabel(link)}
                    aria-label={getContactLinkAriaLabel(link)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: mini ? 44 : 48,
                      height: mini ? 44 : 48,
                      padding: 0,
                      borderRadius: '9999px',
                      background: C.surfaceAlt,
                      border: `1px solid ${C.border}`,
                      color: C.text,
                      textDecoration: 'none',
                      transition: 'all 0.2s ease',
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = C.accentSoft;
                      e.currentTarget.style.borderColor = C.borderHov;
                      e.currentTarget.style.transform = 'translateY(-2px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = C.surfaceAlt;
                      e.currentTarget.style.borderColor = C.border;
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    <SocialIcon platform={link.platform} size={PORTFOLIO_SOCIAL_ICON_SIZE} />
                  </a>
                ))}
              </div>
            </Card>
          )}

          {/* ── Contact Card ── */}
          {contactLinks.some((link) => link.kind === 'contact') && (
            <Card delay={160} mini={mini}>
              {!mini && <SL label="Contact" />}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: mini ? 8 : 10,
                paddingTop: mini ? 0 : 4,
                width: '100%',
              }}>
                {contactLinks.filter((link) => link.kind === 'contact').map((link, i) => (
                  <a
                    key={`contact-${i}`}
                    href={link.url}
                    target="_self"
                    rel="noopener noreferrer"
                    title={getContactLinkAriaLabel(link)}
                    aria-label={getContactLinkAriaLabel(link)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: mini ? '8px 14px' : '10px 16px',
                      borderRadius: '9999px',
                      background: C.surfaceAlt,
                      border: `1px solid ${C.border}`,
                      color: C.text,
                      textDecoration: 'none',
                      transition: 'all 0.2s ease',
                      fontSize: mini ? '12px' : '13px',
                      fontWeight: 500,
                      width: '100%',
                      minWidth: 0,
                      boxSizing: 'border-box',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = C.accentSoft;
                      e.currentTarget.style.borderColor = C.borderHov;
                      e.currentTarget.style.transform = 'translateY(-2px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = C.surfaceAlt;
                      e.currentTarget.style.borderColor = C.border;
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    <span style={{ flexShrink: 0, display: 'inline-flex' }}>
                      <SocialIcon platform={link.platform} size={PORTFOLIO_SOCIAL_ICON_SIZE} />
                    </span>
                    <ContactLinkLabel link={link} className="truncate min-w-0" />
                  </a>
                ))}
              </div>
            </Card>
          )}

          {/* ── About ── */}
          {hasAbout && (
            <div style={{ marginBottom: 14 }}>
              <Card delay={50} mini={mini}>
                <div style={{ position: 'relative' }}>
                  <div style={{
                    fontFamily: "'Playfair Display', serif", fontSize: 96, lineHeight: 0.65,
                    color: `${C.accent}15`, position: 'absolute', top: -6, left: -4,
                    userSelect: 'none', pointerEvents: 'none'
                  }}>&ldquo;</div>
                  <h2 style={{
                    fontFamily: "'Playfair Display', serif",
                    fontSize: mini ? 13 : 'clamp(14px,2.4vw,22px)',
                    fontWeight: 500, lineHeight: 1.35, color: C.text,
                    marginBottom: 10, letterSpacing: '-0.01em'
                  }}>
                    <RichText html={d.vcard.about || d.bizCard.description || ''} />.
                  </h2>
                </div>
              </Card>
            </div>
          )}
          {/* ── Services ── */}
          {hasSrvcs && (
            <div style={{ marginBottom: 14 }}>
              <Card delay={80} mini={mini}> 
                <SL label="Services" />
                <ServicesScrollContainer isMobile={!mini} mini={mini} desktopClassName="w-full">
                  {srvcs.filter(s => s.title).map((s, i) => {
                    const serviceMediaItems = buildServiceMediaItems(s, s.media ?? []);
                    return (
                      <div key={s.id ?? i} className="srv group">
                        <div className="srv-media">
                          {serviceMediaItems.length > 0 ? (
                            <ServiceMediaCarousel
                              items={serviceMediaItems}
                              accent={C.accent}
                              glass={C.glass}
                              textMuted={C.muted}
                              mini={false}
                              variant="elegant-dark"
                            />
                          ) : (
                            <div style={{
                              width: '100%',
                              aspectRatio: '16 / 10',
                              minHeight: mini ? 72 : 120,
                              borderRadius: 12,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              background: `linear-gradient(135deg,${C.accentSoft},rgba(192,136,40,.05))`
                            }}>
                              <span className="nbadge" style={{ fontSize: 28, fontWeight: 600, opacity: .70 }}>
                                {String(i + 1).padStart(2, '0')}
                              </span>
                            </div>
                          )}
                        </div>
                        <div style={{ padding: mini ? '7px 9px 10px' : '9px 12px 13px' }}>
                          <p style={{
                            fontSize: mini ? 9 : 13, fontWeight: 600,
                            color: C.text, margin: '0 0 3px', lineHeight: 1.3
                          }}>{s.title}</p>
                          {s.description && !mini && (
                            <p style={{
                              fontSize: 11, color: C.muted, margin: 0, lineHeight: 1.55,
                              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
                            }}><RichText html={s.description} /></p>
                          )}
                        </div>
                        <div className="srv-bar" style={{ height: 2, background: `linear-gradient(90deg,${C.accent},${C.accentWarm})`, opacity: 0, transition: 'opacity .25s' }} />
                      </div>
                    );
                  })}
                </ServicesScrollContainer>
              </Card>
            </div>
          )}

          {/* ── Gallery ── */}
          {isGalleryEnabled(d, mini) && gallery.length > 0 && (
            <Card delay={200} mini={mini}>
              <SL label="Featured Gallery" />
              <GalleryCarousel
                items={gallery}
                accent={C.accent}
                glass={C.glass}
                textMuted={C.muted}
                mini={mini}
                variant="elegant-dark"
              />
            </Card>
          )}

          {/* ── Videos ── */}
          {isGalleryEnabled(d, mini) && videos.length > 0 && (
            <Card delay={230} mini={mini}>
              <SL label="Videos" />
              <VideoCarousel
                items={videos}
                accent={C.accent}
                glass={C.glass}
                textMuted={C.muted}
                mini={mini}
                variant="elegant-dark"
              />
            </Card>
          )}

          {/* ── Address ── */}
          {hasPortfolioLocation(d.vcard) && (
            <Card delay={260} mini={mini}>
              <PortfolioAddressSection
                vcard={d.vcard}
                mini={mini}
                theme={{ cardBg: C.surface, text: C.text, textMuted: C.muted, accent: C.accent, glass: C.glass }}
              />
            </Card>
          )}

          {/* ── Inquiry ── */}
          {isInquiryEnabled(d, mini) && (
            <Card delay={300} mini={mini}>
              <SL label="Inquire" />
              <h3 style={{
                fontFamily: "'Playfair Display', serif",
                fontSize: mini ? 14 : 'clamp(16px,2vw,20px)',
                fontWeight: 500, color: C.text, margin: '0 0 16px', letterSpacing: '-0.01em'
              }}>
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
                  className={`w-full rounded-xl border px-4 py-3 transition-all duration-300 focus:outline-none focus:ring-2 ${mini ? 'text-[10px] py-2' : 'text-sm'}`}
                  style={{ borderColor: C.border, background: C.surfaceAlt, color: C.text }}
                />
                <input
                  type="email"
                  placeholder="Your email address"
                  value={inquiryForm.fields.email}
                  onChange={(e) => inquiryForm.setField('email', e.target.value)}
                  aria-label="Email address"
                  required
                  className={`w-full rounded-xl border px-4 py-3 transition-all duration-300 focus:outline-none focus:ring-2 ${mini ? 'text-[10px] py-2' : 'text-sm'}`}
                  style={{ borderColor: C.border, background: C.surfaceAlt, color: C.text }}
                />
                <input
                  type="text"
                  placeholder="Your contact number (optional)"
                  value={inquiryForm.fields.phone}
                  onChange={(e) => inquiryForm.setField('phone', e.target.value)}
                  aria-label="Contact number"
                  className={`w-full rounded-xl border px-4 py-3 transition-all duration-300 focus:outline-none focus:ring-2 ${mini ? 'text-[10px] py-2' : 'text-sm'}`}
                  style={{ borderColor: C.border, background: C.surfaceAlt, color: C.text }}
                />
                <input
                  type="text"
                  placeholder="Subject"
                  value={inquiryForm.fields.subject}
                  onChange={(e) => inquiryForm.setField('subject', e.target.value)}
                  aria-label="Subject"
                  className={`w-full rounded-xl border px-4 py-3 transition-all duration-300 focus:outline-none focus:ring-2 ${mini ? 'text-[10px] py-2' : 'text-sm'}`}
                  style={{ borderColor: C.border, background: C.surfaceAlt, color: C.text }}
                />
                <textarea
                  placeholder="Your message"
                  rows={mini ? 4 : 5}
                  value={inquiryForm.fields.message}
                  onChange={(e) => inquiryForm.setField('message', e.target.value)}
                  aria-label="Message"
                  required
                  className={`w-full rounded-xl border px-4 py-3 resize-none transition-all duration-300 focus:outline-none focus:ring-2 ${mini ? 'text-[10px] py-2' : 'text-sm'}`}
                  style={{ borderColor: C.border, background: C.surfaceAlt, color: C.text }}
                />
                {inquiryForm.fieldError && (
                  <p className="text-sm text-red-400" role="alert">{inquiryForm.fieldError}</p>
                )}
                <button
                  type="submit"
                  disabled={inquiryForm.isSubmitting}
                  className={`w-full flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-300 hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-60 ${mini ? 'py-2.5 text-[10px]' : 'py-3.5 text-sm'}`}
                  style={{ background: C.accent, color: '#fff' }}
                >
                  {inquiryForm.isSubmitting ? 'Sending...' : 'Send Message'}
                </button>
              </form>
            </Card>
          )}

          {!mini && (
            <div className="py-8 text-center">
              <div className="flex items-center justify-center gap-4 mb-3">
                <div className="h-[1px] flex-1" style={{ background: `linear-gradient(90deg, transparent, ${C.border})` }} />
                <div className="h-1.5 w-1.5 rounded-full" style={{ background: C.accent, opacity: 0.6 }} />
                <div className="h-[1px] flex-1" style={{ background: `linear-gradient(90deg, ${C.border}, transparent)` }} />
              </div>
              <p style={{ color: C.muted, fontSize: '12px' }}>
                Powered by{' '}
                <span style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, color: C.accent }}>OnTap Creatives</span>
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