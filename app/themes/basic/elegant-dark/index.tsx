'use client';

import { User
} from 'lucide-react';
import type { PortfolioViewProps } from '../../shared';
import {
  getDisplayName,
  getInitials,
  GalleryCarousel,
  VideoCarousel,
  PDFCarousel,
  ServiceMediaCarousel,
  ServicesScrollContainer,
  buildGalleryItems,
  buildVideoItems,
  buildPdfItems,
  buildServiceMediaItems,
  AnimatedSection,
  FloatingContactWidget,
  buildContactLinks,
  getContactLinkAriaLabel,
  ContactLinkLabel,
  isGalleryEnabled,
  isInquiryEnabled,
  usePortfolioInquiryForm,
  PortfolioAddressSection,
  hasPortfolioLocation, resolvePortfolioData,
  getProfileImageOrNull,
  toServableMediaSrc,
  PortfolioCoverMedia,
  usePortfolioViewerSession,
  SocialIcon,
	PORTFOLIO_SOCIAL_ICON_SIZE,
} from '../../shared';
import PortfolioActionButtons from '../../components/PortfolioActionButtons';
import PortfolioSocialProof from '../../components/PortfolioSocialProof';
import {
  useQRCardDownload,
  QRCardExportSurface,
  toQRCardStyle
} from '../../QRCardDownload';


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


const C = {
  /* Base */
  bg: '#080912',
  bgAlt: '#0b0c18',
  surface: '#0f1020',
  surfaceUp: '#131425',
  surfaceHigh: '#181930',
  glass: 'rgba(255,236,196,0.02)',
  /* Borders */
  border: 'rgba(195,145,65,0.08)',
  borderMed: 'rgba(195,145,65,0.15)',
  borderBright: 'rgba(195,145,65,0.28)',
  /* Text */
  text: '#f5ede0',
  textSoft: '#d8ccb8',
  textFaded: '#a89880',
  muted: '#6a5e50',
  /* Accent – warm ember */
  accent: '#cc6a30',
  accentMid: '#dd7c44',
  accentWarm: '#eaa05c',
  accentSoft: 'rgba(204,106,48,0.10)',
  accentGlow: 'rgba(204,106,48,0.20)',
  /* Gold */
  gold: '#c08828',
  goldSoft: 'rgba(192,136,40,0.12)',
  /* Status */
  online: '#22c55e',
  onlineGlow: 'rgba(34,197,94,0.25)',
  /* Gradients */
  grad: 'linear-gradient(135deg,#cc6a30 0%,#dd7c44 50%,#eaa05c 100%)',
  gradMesh: 'radial-gradient(ellipse at 70% 0%,rgba(204,106,48,0.07) 0%,transparent 60%), radial-gradient(ellipse at 10% 80%,rgba(192,136,40,0.05) 0%,transparent 55%)'
};

/* ─────────────────────────────────────────
   GLOBAL STYLES
───────────────────────────────────────── */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,600;0,9..144,700;1,9..144,300;1,9..144,400&family=DM+Sans:wght@300;400;500;600&display=swap');

/* ── Keyframes ── */
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

/* ── Entrance classes ── */
.ent-brand { opacity:0; animation:kFadeIn  .5s ease .04s forwards }
.ent-greet { opacity:0; animation:kSlideD  .5s ease .10s forwards }
.ent-word  { opacity:0; animation:kWordIn  .65s cubic-bezier(.2,1.1,.3,1) var(--d,.15s) forwards }
.ent-sub   { opacity:0; animation:kFadeUp  .5s ease .50s forwards }
.ent-cta   { opacity:0; animation:kFadeUp  .5s ease .62s forwards }
.ent-img   { opacity:0; animation:kScaleIn .70s cubic-bezier(.2,1,.3,1) .10s forwards }

/* ── Card ── */
.el-card {
  border-radius: 18px;
  border: 1px solid rgba(195,145,65,0.08);
  background: linear-gradient(150deg,#0f1020 0%,#131425 100%);
  box-shadow: 0 2px 24px rgba(0,0,0,.30), inset 0 1px 0 rgba(255,236,196,.022);
  transition: box-shadow .30s ease, border-color .28s ease, transform .30s cubic-bezier(.2,1,.3,1);
}
.el-card:hover { box-shadow:0 14px 44px rgba(0,0,0,.44), 0 0 0 1px rgba(195,145,65,.14); border-color:rgba(195,145,65,.14); }

/* ── Service card ── */
.srv {
  border-radius: 14px;
  border: 1px solid rgba(195,145,65,0.08);
  background: linear-gradient(150deg,#131425 0%,#0f1020 100%);
  overflow: visible;
  transition: transform .30s cubic-bezier(.2,1,.3,1), box-shadow .30s ease, border-color .26s ease;
}
.srv:hover { transform:translateY(-5px); box-shadow:0 18px 48px rgba(0,0,0,.5); border-color:rgba(195,145,65,.22) }
.srv:hover .srv-img { transform:scale(1.07) }
.srv:hover .srv-bar { opacity:1 !important }
.srv-img { transition:transform .45s cubic-bezier(.2,1,.3,1) }
.srv-media {
  width: 100%;
  position: relative;
  overflow: visible;
  padding: 8px 8px 0;
}

/* ── Contact row ── */
.c-row {
  display:flex; align-items:center; gap:12px; padding:9px 11px;
  border-radius:12px; border:1px solid transparent;
  text-decoration:none; color:inherit;
  transition: background .20s ease, transform .20s ease, border-color .20s ease;
}
.c-row:hover { background:rgba(204,106,48,.055); transform:translateX(4px); border-color:rgba(195,145,65,.10) }

/* ── Buttons ── */
.btn-fill {
  display:inline-flex; align-items:center; justify-content:center; gap:8px;
  padding:11px 22px; border-radius:40px; border:none; cursor:pointer;
  font-family:'DM Sans',sans-serif; font-size:13px; font-weight:600; letter-spacing:.022em;
  color:#fff;
  background: linear-gradient(135deg,#cc6a30 0%,#dd7c44 50%,#eaa05c 100%);
  box-shadow: 0 5px 20px rgba(204,106,48,.32), inset 0 1px 0 rgba(255,255,255,.10);
  transition: transform .20s ease, box-shadow .20s ease;
  position:relative; overflow:hidden;
}
.btn-fill::after {
  content:''; position:absolute; inset:0;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.07),transparent);
  background-size:300% 100%; animation:kShimmer 3s infinite; opacity:0; transition:opacity .3s;
}
.btn-fill:hover { transform:translateY(-2px) scale(1.015); box-shadow:0 10px 32px rgba(204,106,48,.40) }
.btn-fill:hover::after { opacity:1 }

.btn-ghost {
  display:inline-flex; align-items:center; justify-content:center; gap:8px;
  padding:11px 20px; border-radius:40px; cursor:pointer;
  font-family:'DM Sans',sans-serif; font-size:13px; font-weight:600; letter-spacing:.022em;
  color:rgba(168,152,128,.85);
  background:transparent; border:1px solid rgba(195,145,65,.16);
  transition: transform .20s ease, background .20s ease, border-color .20s ease;
}
.btn-ghost:hover { transform:translateY(-2px); background:rgba(255,236,196,.04); border-color:rgba(195,145,65,.30) }

/* ── Social ── */
.soc {
  display:flex; align-items:center; justify-content:center;
  border-radius:50%; text-decoration:none;
  background:rgba(19,20,37,1); border:1px solid rgba(195,145,65,.09);
  transition: transform .20s cubic-bezier(.3,1.4,.5,1), background .20s ease, border-color .20s ease;
}
.soc:hover { transform:translateY(-4px) scale(1.12); background:rgba(204,106,48,.12); border-color:rgba(195,145,65,.28) }

/* ── Section label ── */
.sl { display:flex; align-items:center; gap:9px; margin-bottom:18px }

/* ── Map filter ── */
.map-ink { filter:grayscale(90%) contrast(110%) brightness(.43) sepia(20%) hue-rotate(5deg) }

/* ── Grain overlay ── */
.grain {
  position:fixed; inset:0; pointer-events:none; z-index:0;
  background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.78' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)' opacity='.028'/%3E%3C/svg%3E");
  opacity:.42;
}

/* ── Num badge ── */
.nbadge {
  font-family:'Fraunces',serif;
  background:linear-gradient(135deg,#cc6a30,#eaa05c);
  -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text;
}

/* ── Hero profile ring animation ── */
.prof-ring { animation:kBorderPulse 3.5s ease-in-out infinite }

/* ── Online dot ping ── */
.online-ping { position:absolute;inset:0;border-radius:50%;background:rgba(34,197,94,.22);animation:kPing 2.2s cubic-bezier(0,0,.2,1) infinite }

/* Hero name: stay within container and wrap long names */
.h-name-sz {
  max-width:100%;
  width:100%;
  overflow-wrap:anywhere;
  word-wrap:break-word;
  word-break:break-word;
}

/* Base profile circle size (overridden by breakpoints / hero-mobile) */
.p-circ { width:clamp(140px,48vw,190px); height:clamp(140px,48vw,190px); position:relative }
.p-circ > img {
  position:absolute !important;
  inset:0 !important;
  width:100% !important;
  height:100% !important;
  max-width:none !important;
  object-fit:cover !important;
  object-position:center center !important;
  display:block !important;
}

/* Live Preview / isMobile: force phone hero sizing even when parent viewport is desktop */
.hero-mobile.hero-wrap {
  min-height:auto !important;
  /* Top padding clears decorative rings (inset -12) so the circle is never clipped */
  padding:56px 18px 48px !important;
  overflow:visible !important;
}
.hero-mobile .hero-content { flex-direction:column !important; align-items:center !important; text-align:center !important; gap:28px !important; padding:0 !important }
.hero-mobile .hero-left { width:100% !important; max-width:none !important; align-items:center !important; display:flex !important; flex-direction:column !important }
.hero-mobile .hero-right { width:100% !important; display:flex !important; justify-content:center !important }
.hero-mobile .h-name-sz { font-size:clamp(22px,7vw,40px) !important }
.hero-mobile .hero-btns { justify-content:center !important }
.hero-mobile .p-circ { width:clamp(140px,48vw,190px) !important; height:clamp(140px,48vw,190px) !important }

/* ────────────────────────────────────────
   RESPONSIVE
──────────────────────────────────────── */

/* Mobile – everything stacks, hero fully centered */
@media (max-width:639px) {
  .hero-wrap    { min-height:auto !important; padding:56px 18px 40px !important; overflow:visible !important }
  .hero-content { flex-direction:column !important; align-items:center !important; text-align:center !important; gap:28px !important; padding:0 !important; min-height:auto !important }
  .hero-left    { width:100% !important; align-items:center !important; display:flex !important; flex-direction:column !important }
  .hero-right   { width:100% !important; display:flex !important; justify-content:center !important }
  .h-name-sz    { font-size:clamp(22px,7vw,40px) !important }
  .ent-word     { display:inline !important }
  .ent-greet    { text-align:center !important }
  .ent-brand    { justify-content:center !important }
  .hero-btns    { justify-content:center !important }
  .hero-biz     { margin:0 auto !important }
  .p-circ       { width:clamp(140px,48vw,190px) !important; height:clamp(140px,48vw,190px) !important }
  .grid-2       { grid-template-columns:1fr !important }
  .grid-3       { grid-template-columns:1fr !important }
  .content-wrap { padding:20px 14px 80px !important }
}

/* Tablet — skipped when Live Preview forces .hero-mobile */
@media (min-width:640px) and (max-width:1023px) {
  .hero-wrap:not(.hero-mobile)    { min-height:auto !important; padding:56px 28px 48px !important; overflow:visible !important }
  .hero-wrap:not(.hero-mobile) .hero-content { flex-direction:column !important; align-items:center !important; text-align:center !important; gap:28px !important; padding:0 !important; min-height:auto !important }
  .hero-wrap:not(.hero-mobile) .hero-left    { width:100% !important; max-width:480px !important; align-items:center !important; display:flex !important; flex-direction:column !important }
  .hero-wrap:not(.hero-mobile) .hero-right   { width:100% !important; display:flex !important; justify-content:center !important }
  .hero-wrap:not(.hero-mobile) .h-name-sz    { font-size:clamp(34px,6vw,48px) !important }
  .ent-word     { display:inline !important }
  .ent-brand    { justify-content:center !important }
  .hero-wrap:not(.hero-mobile) .hero-btns    { justify-content:center !important }
  .hero-biz     { margin:0 auto !important }
  .hero-wrap:not(.hero-mobile) .p-circ       { width:clamp(160px,28vw,220px) !important; height:clamp(160px,28vw,220px) !important }
  .grid-2       { grid-template-columns:1fr 1fr !important }
  .grid-3       { grid-template-columns:1fr 1fr !important }
  .content-wrap { padding:24px 20px 80px !important }
}

/* Desktop — skipped when Live Preview forces .hero-mobile */
@media (min-width:1024px) {
  .hero-wrap:not(.hero-mobile)    { min-height:auto !important; padding:64px 40px 56px !important; overflow:visible !important }
  .hero-wrap:not(.hero-mobile) .hero-content { flex-direction:column !important; align-items:center !important; text-align:center !important; gap:24px !important; padding:0 !important; min-height:auto !important }
  .hero-wrap:not(.hero-mobile) .hero-left    { width:100% !important; max-width:560px !important; align-items:center !important; display:flex !important; flex-direction:column !important }
  .hero-wrap:not(.hero-mobile) .hero-right   { width:100% !important; display:flex !important; justify-content:center !important }
  .hero-wrap:not(.hero-mobile) .h-name-sz    { font-size:clamp(38px,4.5vw,56px) !important }
  .ent-word     { display:inline !important }
  .ent-brand    { justify-content:center !important }
  .hero-wrap:not(.hero-mobile) .hero-btns    { justify-content:center !important }
  .hero-biz     { margin:0 auto !important }
  .hero-wrap:not(.hero-mobile) .p-circ       { width:clamp(180px,18vw,230px) !important; height:clamp(180px,18vw,230px) !important }
  .grid-2       { grid-template-columns:1fr 1fr !important }
  .grid-3       { grid-template-columns:1fr 1fr 1fr !important }
  .content-wrap { padding:28px 24px 100px !important; max-width:980px !important; margin:0 auto !important; display: flex; flex-direction: column; gap: 5px; }
}

/* Text wrap for headings, paragraphs, and spans */
:is(h1, h2, h3, h4, h5, h6, p, span) {
  max-width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
  word-wrap: break-word;
  word-break: break-word;
  text-wrap: wrap;
}
`;

/* ─────────────────────────────────────────
   SECTION LABEL
───────────────────────────────────────── */
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

/* ─────────────────────────────────────────
   CARD WRAPPER
───────────────────────────────────────── */
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

/* ═══════════════════════════════════════════
   MAIN EXPORT
═══════════════════════════════════════════ */
export default function ElegantDark({ data, mini = false, showFAB = false, isMobile = false }: PortfolioViewProps) {
  const compact = mini || isMobile;
  /* ── Data (UNTOUCHED logic) ── */
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
  const pdfs = buildPdfItems(d);

  const shareUrl = typeof window !== 'undefined' && d.bizCard.urlAlias
    ? `${window.location.origin}/${d.bizCard.urlAlias}` : '';
  const qrUrl = shareUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=300x300&ecc=H&data=${encodeURIComponent(shareUrl)}` : '';
  const { cardRef, qrDataUrl, download: downloadQRCard, isDownloading } = useQRCardDownload(d, shareUrl);
  const qrCardStyle = toQRCardStyle(C);

  const srvcs = d.services ?? [];

  /* derived */
  const nameWords = name.split(' ');
  const hasAbout = Boolean(d.vcard.about || d.bizCard.description);
  const hasSrvcs = srvcs.some(s => s.title);
  const contactLinks = buildContactLinks(d);
  const hasSocial = contactLinks.length > 0;
  const bgImg = clean((d.bizCard as any).coverImage || (d.bizCard as any).backgroundImage || '');
  const profileImg = getProfileImageOrNull(d);
  const coverBg = bgImg ? toServableMediaSrc(bgImg) : '';

  return (
    <div style={{
      background: C.bg, color: C.text, minHeight: compact ? 'auto' : '100vh',
      fontFamily: "'DM Sans',sans-serif", position: 'relative', width: '100%'
    }}>
      <CspStyle dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="grain" />
      {/* ── Ambient background mesh ── */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        background: C.gradMesh
      }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        {!mini && (
          <div
            className={`hero-wrap${compact ? ' hero-mobile' : ''}`}
            style={{
              position: 'relative', overflow: 'visible',
              borderBottom: `1px solid ${C.border}`
            }}
          >
            {/* Background layer — clipped so cover fill stays inside the hero bounds */}
            <div style={{
              position: 'absolute', inset: 0, zIndex: 0, overflow: 'hidden',
              borderRadius: 0, pointerEvents: 'none'
            }}>
              <div style={{
                position: 'absolute', inset: 0,
                background: coverBg
                  ? undefined
                  : `linear-gradient(160deg,#0f1020 0%,${C.bg} 60%,#0a0b16 100%)`
              }}>
                {coverBg ? (
                  <>
                    <PortfolioCoverMedia
                      src={coverBg}
                      coverType={d.bizCard.coverType}
                      className="absolute inset-0 h-full w-full"
                    />
                    <div style={{
                      position: 'absolute', inset: 0,
                      background: 'linear-gradient(to bottom,rgba(8,9,18,.50) 0%,rgba(8,9,18,.75) 55%,rgba(8,9,18,.97) 100%)',
                    }} />
                  </>
                ) : null}
              </div>
              {/* Subtle crosshatch grid */}
              <div style={{
                position: 'absolute', inset: 0, pointerEvents: 'none',
                backgroundImage: 'linear-gradient(rgba(195,145,65,.018) 1px,transparent 1px),linear-gradient(90deg,rgba(195,145,65,.018) 1px,transparent 1px)',
                backgroundSize: '68px 68px',
                maskImage: 'radial-gradient(ellipse 70% 80% at 50% 40%,black 15%,transparent 100%)'
              }} />
              {/* Decorative ambient orbs */}
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                <div style={{ position: 'absolute', width: 480, height: 480, borderRadius: '50%', top: -160, right: -120, background: 'radial-gradient(circle,rgba(204,106,48,.06) 0%,transparent 70%)', animation: 'kPulse 10s ease-in-out infinite' }} />
                <div style={{ position: 'absolute', width: 360, height: 360, borderRadius: '50%', bottom: -80, left: -80, background: 'radial-gradient(circle,rgba(192,136,40,.045) 0%,transparent 70%)', animation: 'kPulse 13s ease-in-out infinite 2s' }} />
              </div>
            </div>

            {/* Hero content — always centered column (no nested hero-wrap) */}
            <div
              className="hero-content"
              style={{
                position: 'relative', zIndex: 1,
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                textAlign: 'center', width: '100%', boxSizing: 'border-box'
              }}
            >
              {/* ── Brand bar ── */}
              
              {/* ── Circular profile image ── */}
              <div className="ent-img hero-right" style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                <div style={{ position: 'relative', display: 'inline-block', padding: 14 }}>
                  {/* Outer glow ring */}
                  <div
                    className="prof-ring"
                    style={{
                      position: 'absolute', inset: 8,
                      borderRadius: '50%',
                      border: `1px solid rgba(195,145,65,.14)`
                    }}
                  />
                  {/* Accent arc decoration */}
                  <div style={{
                    position: 'absolute', inset: 2, borderRadius: '50%',
                    border: `1px dashed rgba(195,145,65,.07)`
                  }} />

                  {/* Profile circle */}

                  <div
                    className="p-circ"
                    style={{
                      position: 'relative', borderRadius: '50%', overflow: 'hidden',
                      boxShadow: `0 0 0 3px rgba(195,145,65,.18), 0 20px 60px rgba(0,0,0,.60)`
                    }}
                  >
                    {profileImg ? (
                      <img
                        src={profileImg}
                        alt={name}
                        style={{
                          position: 'absolute',
                          inset: 0,
                          width: '100%',
                          height: '100%',
                          maxWidth: 'none',
                          objectFit: 'cover',
                          objectPosition: 'center center',
                          display: 'block',
                        }}
                      />
                    ) : (
                      <div style={{
                        width: '100%', height: '100%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: `linear-gradient(145deg,${C.surfaceUp},${C.bg})`
                      }}>
                        <User style={{ width: 52, height: 52, color: C.muted }} />
                      </div>
                    )}
                    {/* Inner vignette */}
                    <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at center,transparent 55%,rgba(8,9,18,.22) 100%)', pointerEvents: 'none' }} />
                  </div>

                  {/* Online status dot */}
                  
                </div>
              </div>

              {/* ── Text block ── */}
              <div className="hero-left" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
                {/* Greeting */}
            
               
                <h1
                  className="h-name-sz"
                  style={{
                    fontFamily: "'Fraunces',serif", fontWeight: 600,
                    lineHeight: 1.06, letterSpacing: '-0.022em',
                    margin: '0 0 4px', color: C.text
                  }}
                >
                  {nameWords.map((w, i) => (
                    <span
                      key={i}
                      className="ent-word"
                      style={{ '--d': `${0.15 + i * 0.10}s` } as React.CSSProperties}
                    >
                      {w}{i < nameWords.length - 1 ? ' ' : ''}
                    </span>
                  ))}
                </h1>
                {/* Title / role */}
                {title && (
                  <p className="ent-sub" style={{
                    fontFamily: "'Fraunces',serif", fontStyle: 'italic', fontWeight: 300,
                    fontSize: 'clamp(14px,1.8vw,18px)', color: C.accentMid,
                    margin: '4px 0 0', letterSpacing: '.01em',
                    textDecoration: 'underline', textDecorationColor: `${C.accent}38`,
                    textDecorationThickness: 1.5, textUnderlineOffset: 5}}>
                    {title}
                  </p>
                )}
                {/* Biz label pill */}
                
                {/* CTA buttons */}
                <div className="ent-cta hero-btns" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
                  <PortfolioActionButtons
                    data={d}
                    shareUrl={shareUrl}
                    theme={{
                      accent: C.accent,
                      accentGlow: C.accentGlow,
                      text: '#fff',
                      surface: C.surface,
                      border: C.border,
                    }}
                    layout="row"
                    compact={mini}
                  />
                </div>
                <PortfolioSocialProof
                  data={d}
                  mini={mini}
                  className="mt-4 w-full max-w-md"
                  theme={{
                    surface: C.surfaceUp,
                    border: C.borderMed,
                    text: C.text,
                    muted: C.muted,
                    accent: C.accent,
                    accentSoft: C.accentSoft,
                    divider: C.border,
                    shadow: `0 16px 36px ${C.accentGlow}`,
                    radius: '16px',
                    fontFamily: "'Fraunces', serif",
                  }}
                />
              </div>
            </div>
          </div>
        )}

        <div
          className="content-wrap"
          style={{ padding: compact ? '12px' : '24px 0px 80px', boxSizing: 'border-box' }}
        >
          {/* ── Mini header ── */}
          {mini && (
            <AnimatedSection delay={0} mini>
              <div className="el-card" style={{ padding: '12px 0px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    border: `1px solid ${C.border}`, overflow: 'hidden', flexShrink: 0,
                    background: C.surfaceUp, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    position: 'relative',
                  }}>
                    {d.bizCard.profileImage
                      ? <img src={toServableMediaSrc(d.bizCard.profileImage)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', maxWidth: 'none', objectFit: 'cover', objectPosition: 'center center' }} />
                      : <span style={{ color: C.accent, fontSize: 10, fontWeight: 700 }}>{initials}</span>}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 10, fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</p>
                    <p style={{ fontSize: 8, margin: '2px 0 0', color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {[showBiz ? bizLabel : '', title].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </div>
              </div>
            </AnimatedSection>
          )}

          {/* ══════════════════════════════
              SOCIALS CARD
          ══════════════════════════════ */}
          {contactLinks.some((link) => link.kind === 'social') && (
            <Card delay={150} mini={mini} style={{
              marginBottom: '16px'
            }}>
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
                      background: C.surface,
                      border: `1px solid ${C.border}`,
                      color: C.text,
                      textDecoration: 'none',
                      transition: 'all 0.2s ease',
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = C.accentSoft;
                      e.currentTarget.style.borderColor = C.borderBright;
                      e.currentTarget.style.transform = 'translateY(-2px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = C.surface;
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

          {/* ══════════════════════════════
              CONTACT CARD
          ══════════════════════════════ */}
          {contactLinks.some((link) => link.kind === 'contact') && (
            <Card delay={160} mini={mini} style={{
              marginBottom: '16px'
            }}>
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
                      background: C.surface,
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
                      e.currentTarget.style.borderColor = C.borderBright;
                      e.currentTarget.style.transform = 'translateY(-2px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = C.surface;
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

          {hasAbout && (
            <div style={{ marginBottom: 14 }}>
              <Card delay={50} mini={compact}>
                <div style={{ position: 'relative' }}>
                  <div style={{
                    fontFamily: "'Fraunces',serif", fontSize: 96, lineHeight: 0.65,
                    color: 'rgba(204,106,48,.065)', position: 'absolute', top: -6, left: -4,
                    userSelect: 'none', pointerEvents: 'none'
                  }}>&ldquo;</div>
                  <h2 style={{
                    fontFamily: "'Fraunces',serif",
                    fontSize: compact ? 13 : 'clamp(14px,2.4vw,22px)',
                    fontWeight: 500, lineHeight: 1.35, color: C.text,
                    marginBottom: 10, letterSpacing: '-0.01em'
                  }}>
                    <RichText html={d.vcard.about || d.bizCard.description || ''} />.

                  </h2>
                </div>
              </Card>
            </div>
          )}

          {hasSrvcs && (
            <div style={{ marginBottom: 14 }}>
              <Card delay={80} mini={compact}>
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
                              minHeight: compact ? 72 : 120,
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
                        <div style={{ padding: compact ? '7px 9px 10px' : '9px 12px 13px' }}>
                          <p style={{
                            fontSize: compact ? 9 : 13, fontWeight: 600,
                            color: C.text, margin: '0 0 3px', lineHeight: 1.3
                          }}>{s.title}</p>
                          {s.description && !mini && (
                            <p style={{
                              fontSize: 11, color: C.muted, margin: 0, lineHeight: 1.55,
                              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
                            }}><RichText html={s.description} /></p>
                          )}
                        </div>
                        {/* Hover accent bar */}
                        <div className="srv-bar" style={{ height: 2, background: C.grad, opacity: 0, transition: 'opacity .25s' }} />
                      </div>
                    );
                  })}
                </ServicesScrollContainer>
              </Card>
            </div>
          )}

          {isGalleryEnabled(d, mini) && gallery.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <Card delay={110} mini={compact}>
                <SL label="Featured Gallery" />
                <GalleryCarousel
                  items={gallery} accent={C.accent}
                  glass={C.glass} textMuted={C.muted}
                  mini={compact} variant="ocean-gradient"
                />
              </Card>
            </div>
          )}

          {isGalleryEnabled(d, mini) && pdfs.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <Card delay={115} mini={compact}>
                <SL label="Documents" />
                <PDFCarousel
                  items={pdfs}
                  accent={C.accent}
                  glass={C.glass}
                  textMuted={C.muted}
                  mini={compact}
                  variant="elegant-dark"
                />
              </Card>
            </div>
          )}

          {/* ══════════════════════════════
              VIDEOS — full width
          ══════════════════════════════ */}
          {isGalleryEnabled(d, mini) && videos.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <Card delay={130} mini={compact}>
                <SL label="Videos" />
                <VideoCarousel
                  items={videos} accent={C.accent}
                  glass={C.glass} textMuted={C.muted}
                  mini={compact} variant="elegant-dark"
                />
              </Card>
            </div>
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
          {isInquiryEnabled(d, mini) && (
            <div style={{ marginBottom: 14 }}>
              <Card delay={210} mini={compact}>
                <SL label="Inquire" />
                <h3 style={{
                  fontFamily: "'Fraunces',serif", fontSize: compact ? 14 : 'clamp(16px,2vw,20px)',
                  fontWeight: 500, color: C.text, margin: '0 0 16px', letterSpacing: '-0.01em'
                }}>
                  Send a Message
                </h3>
                <form
                  onSubmit={inquiryForm.handleSubmit}
                  style={{ display: 'flex', flexDirection: 'column', gap: compact ? 10 : 12 }}
                >
                  <input
                    type="text"
                    placeholder="Your name"
                    value={inquiryForm.fields.name}
                    onChange={(e) => inquiryForm.setField('name', e.target.value)}
                    aria-label="Your name"
                    required
                    style={{
                      width: '100%', padding: compact ? '10px 12px' : '12px 14px', borderRadius: 10,
                      border: `1px solid ${C.border}`, background: C.surfaceUp, color: C.text,
                      fontSize: compact ? 11 : 13, fontFamily: "'DM Sans',sans-serif", outline: 'none', boxSizing: 'border-box'
                    }}
                  />
                  <input
                    type="email"
                    placeholder="Your email address"
                    value={inquiryForm.fields.email}
                    onChange={(e) => inquiryForm.setField('email', e.target.value)}
                    aria-label="Email address"
                    required
                    style={{
                      width: '100%', padding: compact ? '10px 12px' : '12px 14px', borderRadius: 10,
                      border: `1px solid ${C.border}`, background: C.surfaceUp, color: C.text,
                      fontSize: compact ? 11 : 13, fontFamily: "'DM Sans',sans-serif", outline: 'none', boxSizing: 'border-box'
                    }}
                  />
                  <input
                    type="text"
                    placeholder="Your contact number (optional)"
                    value={inquiryForm.fields.phone}
                    onChange={(e) => inquiryForm.setField('phone', e.target.value)}
                    aria-label="Contact number"
                    style={{
                      width: '100%', padding: compact ? '10px 12px' : '12px 14px', borderRadius: 10,
                      border: `1px solid ${C.border}`, background: C.surfaceUp, color: C.text,
                      fontSize: compact ? 11 : 13, fontFamily: "'DM Sans',sans-serif", outline: 'none', boxSizing: 'border-box'
                    }}
                  />
                  <input
                    type="text"
                    placeholder="Subject"
                    value={inquiryForm.fields.subject}
                    onChange={(e) => inquiryForm.setField('subject', e.target.value)}
                    aria-label="Subject"
                    style={{
                      width: '100%', padding: compact ? '10px 12px' : '12px 14px', borderRadius: 10,
                      border: `1px solid ${C.border}`, background: C.surfaceUp, color: C.text,
                      fontSize: compact ? 11 : 13, fontFamily: "'DM Sans',sans-serif", outline: 'none', boxSizing: 'border-box'
                    }}
                  />
                  <textarea
                    placeholder="Your message"
                    rows={compact ? 4 : 5}
                    value={inquiryForm.fields.message}
                    onChange={(e) => inquiryForm.setField('message', e.target.value)}
                    aria-label="Message"
                    required
                    style={{
                      width: '100%', padding: compact ? '10px 12px' : '12px 14px', borderRadius: 10,
                      border: `1px solid ${C.border}`, background: C.surfaceUp, color: C.text,
                      fontSize: compact ? 11 : 13, fontFamily: "'DM Sans',sans-serif", outline: 'none',
                      boxSizing: 'border-box', resize: 'none'
                    }}
                  />
                  {inquiryForm.fieldError && (
                    <p style={{ fontSize: 12, color: '#f87171', margin: 0 }} role="alert">{inquiryForm.fieldError}</p>
                  )}
                  <button
                    type="submit"
                    disabled={inquiryForm.isSubmitting}
                    className="btn-fill"
                    style={{ width: '100%', padding: compact ? '10px 16px' : '12px 20px', opacity: inquiryForm.isSubmitting ? 0.6 : 1, cursor: inquiryForm.isSubmitting ? 'not-allowed' : 'pointer' }}
                  >
                    {inquiryForm.isSubmitting ? 'Sending...' : 'Send Message'}
                  </button>
                </form>
              </Card>
            </div>
          )}

         
       

          {/* ── Footer ── */}
          {!mini && (
            <div style={{ padding: '28px 0 8px', textAlign: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 12 }}>
                <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg,transparent,${C.border})` }} />
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {[3, 5, 3].map((s, i) => (
                    <div key={i} style={{ width: s, height: s, borderRadius: '50%', background: C.accent, opacity: i === 1 ? .75 : .35 }} />
                  ))}
                </div>
                <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg,${C.border},transparent)` }} />
              </div>
              <p style={{ color: C.muted, fontSize: 11, margin: 0, letterSpacing: '.03em' }}>
                Powered by{' '}
                <span style={{
                  fontFamily: "'Fraunces',serif", fontWeight: 500, fontSize: 13,
                  background: C.grad, WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent', backgroundClip: 'text'
                }}>OnTap Creatives</span>
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