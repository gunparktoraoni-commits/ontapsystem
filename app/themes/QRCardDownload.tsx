'use client';

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Download, QrCode } from 'lucide-react';
import QRCode from 'qrcode';
import type { PortfolioData } from '../types';
import { fetchImageAsDataUrl } from '../lib/exportImage';
import { getDisplayName, getInitials, toPortfolioPhoneDigits, toPortfolioTelHref } from './shared';
import { InlineLoader } from '@/app/components/Loader';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

export interface QRCardStyle {
  cardBg: string;
  text: string;
  textMuted: string;
  accent: string;
  accentAlt?: string;
  border?: string;
  avatarBg?: string;
  fontFamily?: string;
  /** Header / banner gradient — drives the top strip colour */
  frameGradient?: string;
  /** Full background gradient for the card body */
  bgGradient?: string;
}

export interface ThemePaletteInput {
  bg?: string;
  surface?: string;
  text?: string;
  textSoft?: string;
  muted?: string;
  accent?: string;
  accentAlt?: string;
  border?: string;
  cardBg?: string;
  textMuted?: string;
  headerGrad?: string;
  bgGrad?: string;
  gradient?: string;
}

export function toQRCardStyle(palette: ThemePaletteInput): QRCardStyle {
  const frameGradient =
    palette.headerGrad ?? palette.gradient ?? palette.bgGrad ?? undefined;
  return {
    cardBg:   palette.surface ?? palette.cardBg ?? palette.bg ?? '#ffffff',
    text:     palette.text ?? palette.textSoft ?? '#111827',
    textMuted: palette.muted ?? palette.textMuted ?? '#6b7280',
    accent:   palette.accent ?? '#2563eb',
    accentAlt: palette.accentAlt ?? palette.accent ?? '#1d4ed8',
    border:   palette.border ?? 'rgba(0,0,0,0.08)',
    avatarBg: palette.accent ?? '#2563eb',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    frameGradient,
    bgGradient: palette.bgGrad ?? palette.gradient ?? undefined,
  };
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

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

function formatPhone(raw: string): string {
  return toPortfolioTelHref(raw);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src.slice(0, 60)}`));
    img.src = src;
  });
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  w: number, h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y,     x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x,     y + h, radius);
  ctx.arcTo(x,     y + h, x,     y,     radius);
  ctx.arcTo(x,     y,     x + w, y,     radius);
  ctx.closePath();
}

function ellipsizeText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) {
    t = t.slice(0, -1);
  }
  return `${t}…`;
}

/**
 * Parse a CSS colour string into [r,g,b,a] (0-255).
 * Falls back to [255,255,255,255] on failure.
 */
function parseCssColor(css: string): [number, number, number, number] {
  const c = css.trim();
  // hex6 / hex8
  const hex = c.match(/^#([0-9a-f]{6,8})$/i);
  if (hex) {
    const h = hex[1];
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
      h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255,
    ];
  }
  // rgba / rgb
  const rgba = c.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (rgba) {
    return [
      Math.round(Number(rgba[1])),
      Math.round(Number(rgba[2])),
      Math.round(Number(rgba[3])),
      rgba[4] !== undefined ? Math.round(Number(rgba[4]) * 255) : 255,
    ];
  }
  return [255, 255, 255, 255];
}

/**
 * Build a CanvasGradient from a CSS gradient string, or fall back to
 * a solid colour fill. Supports linear-gradient with up to 6 stops.
 * Returns null if the gradient cannot be parsed (caller uses solid fallback).
 */
function buildCanvasGradient(
  ctx: CanvasRenderingContext2D,
  css: string,
  x0: number, y0: number,
  x1: number, y1: number,
): CanvasGradient | null {
  const s = css.trim();

  // linear-gradient(angle, stop1, stop2, ...)
  const linear = s.match(/^linear-gradient\((.+)\)$/i);
  if (linear) {
    const inner = linear[1];
    // Split on commas but NOT commas inside rgba(...)
    const parts: string[] = [];
    let depth = 0, cur = '';
    for (const ch of inner) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());

    // First part may be angle / direction — skip it
    let stopParts = parts;
    const firstIsAngle = /^(\d+deg|to\s)/i.test(parts[0] ?? '');
    if (firstIsAngle) stopParts = parts.slice(1);
    if (stopParts.length < 2) return null;

    // Evenly distribute stops
    const grad = ctx.createLinearGradient(x0, y0, x1, y1);
    stopParts.forEach((stop, i) => {
      // strip trailing percentage
      const clean2 = stop.replace(/\s+[\d.]+%\s*$/, '').trim();
      const [r, g, b, a] = parseCssColor(clean2);
      const pos = stopParts.length === 1 ? 0 : i / (stopParts.length - 1);
      grad.addColorStop(pos, `rgba(${r},${g},${b},${a / 255})`);
    });
    return grad;
  }

  // radial-gradient — approximate as solid accent
  return null;
}

// ─────────────────────────────────────────────
// EXPORT HANDLE
// ─────────────────────────────────────────────

export interface QRCardExportHandle {
  element: HTMLDivElement | null;
  exportCard: (qrDataUrl: string, fileName: string) => Promise<void>;
}

// ─────────────────────────────────────────────
// CORE PNG EXPORT
// ─────────────────────────────────────────────

async function exportQRCardAsPng(input: {
  data: PortfolioData;
  style: QRCardStyle;
  shareUrl: string;
  qrDataUrl: string;
  profileDataUrl: string;
  fileName: string;
}): Promise<void> {
  const { data, style, shareUrl, qrDataUrl, profileDataUrl, fileName } = input;

  // ── Canvas dimensions (rendered at 2× for retina) ──────────────────
  const W = 360;
  const H = 500;
  const SCALE = 2;
  const canvas = document.createElement('canvas');
  canvas.width  = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('[QRCardDownload] Canvas 2D not supported');
  ctx.scale(SCALE, SCALE);

  const ff     = style.fontFamily ?? 'system-ui, -apple-system, sans-serif';
  const name   = getDisplayName(data);
  const inits  = getInitials(data);
  const title  = profTitle(data);
  const email  = clean(data.vcard.email);
  const phone  = toPortfolioPhoneDigits(data.vcard.contactNumber);
  const alias  = clean(data.bizCard.urlAlias);
  const urlLabel = shareUrl || (alias ? `ontap.ph/${alias}` : '');

  // ── Layout constants ───────────────────────────────────────────────
  const BANNER_H   = 170;          // gradient header strip height
  const AVATAR_R   = 44;           // avatar circle radius
  const AVATAR_CX  = W / 2;
  const AVATAR_CY  = BANNER_H;     // avatar sits on the banner / body boundary
  const RING_W     = 4;            // accent ring width
  const QR_SIZE    = 168;
  const QR_PAD     = 12;
  const QR_FRAME   = QR_SIZE + QR_PAD * 2;
  const QR_X       = (W - QR_FRAME) / 2;
  const QR_Y       = AVATAR_CY + AVATAR_R + 12 + (title ? 56 : 42);

  // ── 1. Card background ─────────────────────────────────────────────
  roundRectPath(ctx, 0, 0, W, H, 22);
  const bgCss = style.bgGradient ?? style.cardBg;
  let bgFill: string | CanvasGradient = style.cardBg;
  if (bgCss && bgCss !== style.cardBg) {
    const grad = buildCanvasGradient(ctx, bgCss, 0, 0, 0, H);
    if (grad) bgFill = grad;
  }
  ctx.fillStyle = bgFill;
  ctx.fill();

  // Card border
  roundRectPath(ctx, 0, 0, W, H, 22);
  ctx.strokeStyle = style.border ?? 'rgba(0,0,0,0.10)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // ── 2. Banner / header strip ───────────────────────────────────────
  ctx.save();
  roundRectPath(ctx, 0, 0, W, BANNER_H, 22);
  // extend clip to square bottom so radius only applies to top corners
  ctx.rect(0, BANNER_H - 22, W, 22);
  ctx.clip();

  const bannerCss = style.frameGradient ?? style.accent;
  let bannerFill: string | CanvasGradient = style.accent;
  if (bannerCss) {
    // Try gradient first
    const grad = buildCanvasGradient(ctx, bannerCss, 0, 0, W, BANNER_H);
    bannerFill = grad ?? bannerCss;
  }
  ctx.fillStyle = bannerFill;
  ctx.fillRect(0, 0, W, BANNER_H);

  // Subtle diagonal shimmer overlay on banner
  const shimmer = ctx.createLinearGradient(0, 0, W, BANNER_H);
  shimmer.addColorStop(0,   'rgba(255,255,255,0.12)');
  shimmer.addColorStop(0.5, 'rgba(255,255,255,0.04)');
  shimmer.addColorStop(1,   'rgba(255,255,255,0.10)');
  ctx.fillStyle = shimmer;
  ctx.fillRect(0, 0, W, BANNER_H);

  // Fine dot-grid pattern overlay
  for (let gx = 16; gx < W; gx += 24) {
    for (let gy = 16; gy < BANNER_H; gy += 24) {
      ctx.beginPath();
      ctx.arc(gx, gy, 1, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fill();
    }
  }

  ctx.restore();

  // ── 3. Avatar ring ────────────────────────────────────────────────
  // Outer glow ring
  ctx.save();
  ctx.beginPath();
  ctx.arc(AVATAR_CX, AVATAR_CY, AVATAR_R + RING_W + 3, 0, Math.PI * 2);
  ctx.fillStyle = style.cardBg;
  ctx.fill();
  ctx.restore();

  // Accent ring
  ctx.save();
  ctx.beginPath();
  ctx.arc(AVATAR_CX, AVATAR_CY, AVATAR_R + RING_W, 0, Math.PI * 2);
  const ringCss = style.accentAlt ?? style.accent;
  const ringGrad = buildCanvasGradient(
    ctx, `linear-gradient(135deg, ${style.accent}, ${ringCss})`,
    AVATAR_CX - AVATAR_R, AVATAR_CY - AVATAR_R,
    AVATAR_CX + AVATAR_R, AVATAR_CY + AVATAR_R,
  );
  ctx.fillStyle = ringGrad ?? style.accent;
  ctx.fill();
  ctx.restore();

  // ── 4. Avatar circle ───────────────────────────────────────────────
  ctx.save();
  ctx.beginPath();
  ctx.arc(AVATAR_CX, AVATAR_CY, AVATAR_R, 0, Math.PI * 2);
  ctx.clip();

  if (profileDataUrl) {
    try {
      const avatar = await loadImage(profileDataUrl);
      ctx.drawImage(avatar, AVATAR_CX - AVATAR_R, AVATAR_CY - AVATAR_R, AVATAR_R * 2, AVATAR_R * 2);
    } catch {
      // Avatar failed — draw initials fallback below
      ctx.fillStyle = style.avatarBg ?? style.accent;
      ctx.fillRect(AVATAR_CX - AVATAR_R, AVATAR_CY - AVATAR_R, AVATAR_R * 2, AVATAR_R * 2);
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${Math.round(AVATAR_R * 0.65)}px ${ff}`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(inits, AVATAR_CX, AVATAR_CY);
    }
  } else {
    ctx.fillStyle = style.avatarBg ?? style.accent;
    ctx.fillRect(AVATAR_CX - AVATAR_R, AVATAR_CY - AVATAR_R, AVATAR_R * 2, AVATAR_R * 2);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.round(AVATAR_R * 0.65)}px ${ff}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(inits, AVATAR_CX, AVATAR_CY);
  }
  ctx.restore();

  // ── 5. Name & title ────────────────────────────────────────────────
  const nameY = AVATAR_CY + AVATAR_R + RING_W + 14;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle    = style.text;
  ctx.font         = `700 18px ${ff}`;
  ctx.fillText(ellipsizeText(ctx, name, W - 48), W / 2, nameY);

  if (title) {
    ctx.fillStyle = style.textMuted;
    ctx.font      = `400 12px ${ff}`;
    ctx.fillText(ellipsizeText(ctx, title, W - 56), W / 2, nameY + 26);
  }

  // ── 6. Divider line ────────────────────────────────────────────────
  const divY = QR_Y - 14;
  ctx.save();
  const divGrad = ctx.createLinearGradient(40, divY, W - 40, divY);
  divGrad.addColorStop(0,   'rgba(0,0,0,0)');
  divGrad.addColorStop(0.5, style.border ?? 'rgba(0,0,0,0.12)');
  divGrad.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.strokeStyle = divGrad;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(40, divY);
  ctx.lineTo(W - 40, divY);
  ctx.stroke();
  ctx.restore();

  // ── 7. QR frame ───────────────────────────────────────────────────
  // Outer accent border
  roundRectPath(ctx, QR_X - 2, QR_Y - 2, QR_FRAME + 4, QR_FRAME + 4, 18);
  const frameBorderCss = style.frameGradient ?? style.accent;
  const frameBorderFill =
    buildCanvasGradient(ctx, frameBorderCss ?? style.accent,
      QR_X, QR_Y, QR_X + QR_FRAME, QR_Y + QR_FRAME) ?? style.accent;
  ctx.fillStyle = frameBorderFill;
  ctx.fill();

  // White inner frame
  roundRectPath(ctx, QR_X, QR_Y, QR_FRAME, QR_FRAME, 16);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // QR code image
  const qrX = QR_X + QR_PAD;
  const qrY = QR_Y + QR_PAD;
  try {
    const qrImg = await loadImage(qrDataUrl);
    ctx.drawImage(qrImg, qrX, qrY, QR_SIZE, QR_SIZE);
  } catch {
    // Fallback: draw a placeholder box
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(qrX, qrY, QR_SIZE, QR_SIZE);
    ctx.fillStyle = style.textMuted;
    ctx.font = `400 11px ${ff}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('QR Code', QR_X + QR_FRAME / 2, QR_Y + QR_FRAME / 2);
  }

  // Corner accent marks on QR frame
  const corners: Array<[number, number, number, number]> = [
    [QR_X,            QR_Y,            12,  12],
    [QR_X + QR_FRAME - 12, QR_Y,      -12, 12],
    [QR_X,            QR_Y + QR_FRAME - 12,  12, -12],
    [QR_X + QR_FRAME - 12, QR_Y + QR_FRAME - 12, -12, -12],
  ];
  const accentColor = style.accent;
  ctx.lineWidth   = 3;
  ctx.strokeStyle = accentColor;
  ctx.lineCap     = 'round';
  for (const [cx, cy, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx + dx, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy);
    ctx.stroke();
  }

  // ── 8. URL / contact footer ────────────────────────────────────────
  const footerTop = QR_Y + QR_FRAME + 16;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';

  if (urlLabel) {
    ctx.fillStyle = style.accent;
    ctx.font      = `600 11px ${ff}`;
    ctx.fillText(ellipsizeText(ctx, urlLabel, W - 40), W / 2, footerTop);
  }

  const contactY = footerTop + (urlLabel ? 18 : 0);
  if (email || phone) {
    ctx.fillStyle = style.textMuted;
    ctx.font      = `400 10px ${ff}`;
    if (email) {
      ctx.fillText(ellipsizeText(ctx, email, W - 48), W / 2, contactY);
    }
    if (phone) {
      ctx.fillText(
        ellipsizeText(ctx, formatPhone(phone), W - 48),
        W / 2,
        contactY + (email ? 14 : 0),
      );
    }
  }

  // ── 9. OnTap branding ─────────────────────────────────────────────
  const brandY = H - 20;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle    = style.textMuted;
  ctx.font         = `400 9px ${ff}`;
  ctx.fillText('Powered by', W / 2 - 18, brandY);
  ctx.fillStyle    = style.accent;
  ctx.font         = `700 10px ${ff}`;
  ctx.fillText('OnTap', W / 2 + 18, brandY);

  // ── 10. Trigger PNG download ───────────────────────────────────────
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('[QRCardDownload] toBlob returned null'));
    }, 'image/png');
  });

  const objectUrl = URL.createObjectURL(blob);
  const anchor    = document.createElement('a');
  anchor.href     = objectUrl;
  anchor.download = fileName.endsWith('.png') ? fileName : `${fileName}.png`;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

// ─────────────────────────────────────────────
// CSS VARS HELPER (used by DOM preview)
// ─────────────────────────────────────────────

function buildQRCardExportVarsCss(style: QRCardStyle): string {
  const border      = style.border      ?? 'rgba(0,0,0,0.08)';
  const fontFamily  = style.fontFamily  ?? 'system-ui, -apple-system, sans-serif';
  const frameGrad   = style.frameGradient ?? style.accent;
  const avatarBg    = style.avatarBg    ?? style.accent;
  const bgGrad      = style.bgGradient  ?? style.cardBg;

  return `
.qr-export-theme-vars {
  --qrc-card-bg:       ${style.cardBg};
  --qrc-bg-gradient:   ${bgGrad};
  --qrc-text:          ${style.text};
  --qrc-text-muted:    ${style.textMuted};
  --qrc-accent:        ${style.accent};
  --qrc-avatar-bg:     ${avatarBg};
  --qrc-border:        ${border};
  --qrc-font-family:   ${fontFamily};
  --qrc-frame-gradient:${frameGrad};
}
`;
}

// ─────────────────────────────────────────────
// DOM PREVIEW SURFACE (hidden, for future use)
// ─────────────────────────────────────────────

interface QRCardExportSurfaceProps {
  data: PortfolioData;
  style: QRCardStyle;
  shareUrl: string;
  qrDataUrl: string;
}

export const QRCardExportSurface = forwardRef<QRCardExportHandle, QRCardExportSurfaceProps>(
  function QRCardExportSurface({ data, style, shareUrl, qrDataUrl }, ref) {
    const innerRef       = useRef<HTMLDivElement>(null);
    const [profileDataUrl, setProfileDataUrl] = useState('');
    const profileImage   = clean(data.bizCard.profileImage ?? '');

    useEffect(() => {
      let cancelled = false;
      if (!profileImage) { setProfileDataUrl(''); return; }
      void fetchImageAsDataUrl(profileImage).then((url) => {
        if (!cancelled) setProfileDataUrl(url ?? '');
      });
      return () => { cancelled = true; };
    }, [profileImage]);

    useImperativeHandle(ref, () => ({
      element: innerRef.current,
      exportCard: async (nextQrDataUrl: string, fileName: string) => {
        let inlineProfile = profileDataUrl;
        if (profileImage && !inlineProfile) {
          inlineProfile = (await fetchImageAsDataUrl(profileImage)) ?? '';
        }
        await exportQRCardAsPng({
          data,
          style,
          shareUrl,
          qrDataUrl:      nextQrDataUrl,
          profileDataUrl: inlineProfile,
          fileName,
        });
      },
    }), [data, profileDataUrl, profileImage, shareUrl, style]);

    const name    = getDisplayName(data);
    const inits   = getInitials(data);
    const title   = profTitle(data);
    const email   = clean(data.vcard.email);
    const phone   = toPortfolioPhoneDigits(data.vcard.contactNumber);
    const alias   = clean(data.bizCard.urlAlias);
    const urlLabel = shareUrl || (alias ? `ontap.ph/${alias}` : '');
    const themeCss = useMemo(() => buildQRCardExportVarsCss(style), [style]);
    const frameGrad = style.frameGradient ?? style.accent;

    return (
      <>
        {/* Off-screen mirror — kept in sync with canvas output for accessibility */}
        <div aria-hidden className="fixed left-[-9999px] top-0 pointer-events-none z-[-1]">
          <div
            ref={innerRef}
            className="qr-export-theme-vars"
            style={{
              width: 360, height: 500,
              borderRadius: 22,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              background: style.bgGradient ?? style.cardBg,
              border: `1px solid ${style.border ?? 'rgba(0,0,0,0.08)'}`,
              fontFamily: style.fontFamily ?? 'system-ui, -apple-system, sans-serif',
              position: 'relative',
            }}
          >
            {/* Banner */}
            <div style={{
              height: 170,
              background: frameGrad ?? style.accent,
              flexShrink: 0,
              position: 'relative',
            }} />

            {/* Avatar */}
            <div style={{
              position: 'absolute',
              top: 170 - 44,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 88 + 8,
              height: 88 + 8,
              borderRadius: '50%',
              background: style.accent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <div style={{
                width: 88, height: 88, borderRadius: '50%',
                overflow: 'hidden', background: style.avatarBg ?? style.accent,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {profileDataUrl
                  ? <img src={profileDataUrl} alt="" crossOrigin="anonymous" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ color: '#fff', fontWeight: 700, fontSize: 28 }}>{inits}</span>
                }
              </div>
            </div>

            {/* Body */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 58, paddingBottom: 16, paddingLeft: 20, paddingRight: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: style.text, textAlign: 'center', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</h3>
              {title && <p style={{ margin: '4px 0 0', fontSize: 12, color: style.textMuted, textAlign: 'center' }}>{title}</p>}

              {/* QR frame */}
              <div style={{
                marginTop: 16,
                padding: 3,
                borderRadius: 18,
                background: frameGrad ?? style.accent,
              }}>
                <div style={{ background: '#fff', borderRadius: 15, padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {qrDataUrl
                    ? <img src={qrDataUrl} alt="QR Code" width={168} height={168} style={{ display: 'block' }} />
                    : <QrCode style={{ width: 168, height: 168, color: '#374151' }} />
                  }
                </div>
              </div>

              {/* Footer */}
              <div style={{ marginTop: 14, textAlign: 'center', width: '100%' }}>
                {urlLabel && <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: style.accent, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{urlLabel}</p>}
                {email  && <p style={{ margin: '4px 0 0', fontSize: 10, color: style.textMuted }}>{email}</p>}
                {phone  && <p style={{ margin: '2px 0 0', fontSize: 10, color: style.textMuted }}>{formatPhone(phone)}</p>}
              </div>

              <p style={{ marginTop: 'auto', paddingTop: 10, fontSize: 9, color: style.textMuted, letterSpacing: '0.04em' }}>
                Powered by <strong style={{ color: style.accent }}>OnTap</strong>
              </p>
            </div>
          </div>
        </div>
        <style>{themeCss}</style>
      </>
    );
  },
);

// ─────────────────────────────────────────────
// HOOK
// ─────────────────────────────────────────────

export function useQRCardDownload(data: PortfolioData, shareUrl: string) {
  const cardRef        = useRef<QRCardExportHandle>(null);
  const [qrDataUrl, setQrDataUrl]       = useState('');
  const [isDownloading, setIsDownloading] = useState(false);

  const download = useCallback(async () => {
    if (typeof window === 'undefined' || isDownloading) return;
    const url =
      shareUrl.trim() ||
      (data.bizCard.urlAlias
        ? `${window.location.origin}/${data.bizCard.urlAlias}`
        : '');
    if (!url) return;

    setIsDownloading(true);
    try {
      const dataUrl = await QRCode.toDataURL(url, {
        width: 280,
        margin: 1,
        errorCorrectionLevel: 'H',
      });
      setQrDataUrl(dataUrl);

      const alias = data.bizCard.urlAlias?.trim() || 'portfolio';

      // Wait up to 5 animation frames for the ref to be ready
      let exporter = cardRef.current?.exportCard;
      for (let attempt = 0; attempt < 5 && !exporter; attempt += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        exporter = cardRef.current?.exportCard;
      }
      if (!exporter) throw new Error('[QRCardDownload] QR card ref not ready');

      await exporter(dataUrl, `${alias}-qr-card.png`);
    } catch (err) {
      console.error('[QRCardDownload] export failed', err);
    } finally {
      setIsDownloading(false);
    }
  }, [data.bizCard.urlAlias, isDownloading, shareUrl]);

  return { cardRef, qrDataUrl, download, isDownloading };
}

// ─────────────────────────────────────────────
// DOWNLOAD BUTTON
// ─────────────────────────────────────────────

interface QRCardDownloadButtonProps {
  onClick: () => void;
  isDownloading?: boolean;
  className?: string;
  style?: React.CSSProperties;
  label?: string;
}

export function QRCardDownloadButton({
  onClick,
  isDownloading = false,
  className = '',
  style,
  label = 'Download QR Card',
}: QRCardDownloadButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDownloading}
      className={className}
      style={style}
    >
      {isDownloading ? (
        <InlineLoader />
      ) : (
        <Download className="h-3.5 w-3.5" />
      )}
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────
// DUAL QR UTILITIES  (used by bizcard share panel)
// ─────────────────────────────────────────────

export async function generateQrDataUrl(payload: string): Promise<string> {
  const trimmed = payload.trim();
  if (!trimmed) throw new Error('QR payload is empty');
  return QRCode.toDataURL(trimmed, {
    width: 280,
    margin: 1,
    errorCorrectionLevel: 'H',
  });
}

export type BizcardDualQRFields = {
  bizcard_id?: string | number;
  qr_code_url?: string | null;
  portfolio_qr_code_url?: string | null;
  vcf_file_url?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  bizcard_name?: string | null;
  email?: string | null;
  alt_email?: string | null;
  contact_number?: string | null;
  occupation?: string | null;
  professional_title?: string | null;
  city?: string | null;
  region?: string | null;
  area?: string | null;
  company?: { name?: string | null } | null;
  socials?: Array<{ platform?: string | null; url?: string | null }> | null;
  social_links?: Array<{ platform?: string | null; url?: string | null }> | null;
};

export function formatBizcardLocation(bizcard: BizcardDualQRFields): string {
  const parts = [bizcard.area, bizcard.city, bizcard.region]
    .map((v) => clean(String(v ?? '')))
    .filter(Boolean);
  return parts.join(', ');
}

function resolveStoredQrSrc(url: string | null | undefined): string | null {
  const stored = typeof url === 'string' ? url.trim() : '';
  if (stored && (stored.startsWith('data:') || /^https?:\/\//i.test(stored))) {
    return stored;
  }
  return null;
}

export function useBizcardDualQR(
  bizcard: BizcardDualQRFields | null,
  portfolioUrl: string,
) {
  const [portfolioQrSrc, setPortfolioQrSrc] = useState('');
  const [vcardQrSrc,     setVcardQrSrc]     = useState('');
  const [loading,        setLoading]         = useState(false);

  useEffect(() => {
    if (!bizcard || !portfolioUrl.trim()) {
      setPortfolioQrSrc('');
      setVcardQrSrc('');
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const storedPortfolio = resolveStoredQrSrc(bizcard.portfolio_qr_code_url);
        if (storedPortfolio) {
          if (!cancelled) setPortfolioQrSrc(storedPortfolio);
        } else {
          const portfolioDataUrl = await generateQrDataUrl(portfolioUrl);
          if (cancelled) return;
          setPortfolioQrSrc(portfolioDataUrl);
        }

        // Always build VCard QR from live fields so social updates appear immediately
        // (stored qr_code_url may lag until async regeneration finishes).
        const socials = Array.isArray(bizcard.socials)
          ? bizcard.socials
          : Array.isArray(bizcard.social_links)
            ? bizcard.social_links
            : [];

        const { buildVCardContentForQR } = await import('@/lib/bizcard/vcard-content');
        const vcardPayload = buildVCardContentForQR(
          {
            first_name:   bizcard.first_name,
            last_name:    bizcard.last_name,
            bizcard_name: bizcard.bizcard_name,
            email:        bizcard.email,
            alt_email:    bizcard.alt_email,
            contact_number: bizcard.contact_number,
            occupation:   bizcard.occupation ?? bizcard.professional_title,
            company:      bizcard.company,
            socials,
          },
          portfolioUrl,
        );
        const vcardDataUrl = await generateQrDataUrl(vcardPayload);
        if (!cancelled) setVcardQrSrc(vcardDataUrl);
      } catch (err) {
        console.error('[useBizcardDualQR] failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [
    portfolioUrl,
    bizcard?.portfolio_qr_code_url,
    bizcard?.qr_code_url,
    bizcard?.first_name,
    bizcard?.last_name,
    bizcard?.bizcard_name,
    bizcard?.email,
    bizcard?.alt_email,
    bizcard?.contact_number,
    bizcard?.occupation,
    bizcard?.professional_title,
    bizcard?.company,
    bizcard?.socials,
    bizcard?.social_links,
  ]);

  return { portfolioQrSrc, vcardQrSrc, loading, vcfFileUrl: bizcard?.vcf_file_url ?? null };
}

function downloadDataUrl(dataUrl: string, fileName: string) {
  const link = document.createElement('a');
  link.href     = dataUrl;
  link.download = fileName;
  link.click();
}

export function DualQRDisplay({
  portfolioQrSrc,
  vcardQrSrc,
  loading = false,
  bizcardId,
  portfolioUrl,
  email,
  phone,
  location,
  onDownloadVcard,
  downloadingVcard = false,
}: {
  portfolioQrSrc: string;
  vcardQrSrc: string;
  loading?: boolean;
  bizcardId?: string;
  portfolioUrl?: string;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  onDownloadVcard?: () => void;
  downloadingVcard?: boolean;
}) {
  const cleanEmail    = clean(email    ?? '');
  const cleanPhone    = toPortfolioPhoneDigits(phone ?? '');
  const cleanLocation = clean(location ?? '');

  const handlePortfolioDownload = () => {
    if (!portfolioQrSrc) return;
    const alias = portfolioUrl?.split('/').filter(Boolean).pop() || 'portfolio';
    downloadDataUrl(portfolioQrSrc, `${alias}-portfolio-qr.png`);
  };

  const handleVcardDownload = () => {
    if (onDownloadVcard) { onDownloadVcard(); return; }
    if (vcardQrSrc) downloadDataUrl(vcardQrSrc, `bizcard-${bizcardId ?? 'vcard'}-qr.png`);
  };

  if (loading && !portfolioQrSrc && !vcardQrSrc) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-slate-500">
        <InlineLoader />
        Generating QR codes…
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {/* Portfolio QR */}
        <div className="flex flex-col items-center">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2 text-center">
            Portfolio Link
          </p>
          <button
            type="button"
            onClick={handlePortfolioDownload}
            disabled={!portfolioQrSrc}
            className="group relative rounded-xl border border-slate-200 bg-white p-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2A4792] disabled:opacity-50"
            title="Download portfolio QR"
            aria-label="Download portfolio link QR code"
          >
            {portfolioQrSrc ? (
              <img src={portfolioQrSrc} alt="Portfolio link QR code" className="h-28 w-28 sm:h-32 sm:w-32" />
            ) : (
              <div className="h-28 w-28 sm:h-32 sm:w-32 flex items-center justify-center bg-slate-50 rounded-lg">
                <QrCode className="h-8 w-8 text-slate-300" />
              </div>
            )}
            {portfolioQrSrc && (
              <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/0 group-hover:bg-black/5 transition-colors">
                <Download className="h-6 w-6 text-[#2A4792] opacity-0 group-hover:opacity-80 transition-opacity" />
              </span>
            )}
          </button>
        </div>

        {/* vCard QR */}
        <div className="flex flex-col items-center">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2 text-center">
            VCard Details
          </p>
          <button
            type="button"
            onClick={handleVcardDownload}
            disabled={!vcardQrSrc && !onDownloadVcard}
            className="group relative rounded-xl border border-slate-200 bg-white p-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2A4792] disabled:opacity-50"
            title="Download vCard QR"
            aria-label="Download vCard details QR code"
          >
            {downloadingVcard ? (
              <div className="h-28 w-28 sm:h-32 sm:w-32 flex items-center justify-center">
                <InlineLoader />
              </div>
            ) : vcardQrSrc ? (
              <img src={vcardQrSrc} alt="VCard details QR code" className="h-28 w-28 sm:h-32 sm:w-32" />
            ) : (
              <div className="h-28 w-28 sm:h-32 sm:w-32 flex items-center justify-center bg-slate-50 rounded-lg">
                <QrCode className="h-8 w-8 text-slate-300" />
              </div>
            )}
            {vcardQrSrc && !downloadingVcard && (
              <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/0 group-hover:bg-black/5 transition-colors">
                <Download className="h-6 w-6 text-[#2A4792] opacity-0 group-hover:opacity-80 transition-opacity" />
              </span>
            )}
          </button>
        </div>
      </div>

      {(cleanPhone || cleanEmail || cleanLocation) && (
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-center space-y-1">
          {cleanPhone && (
            <p className="text-xs text-slate-600">
              <span className="font-semibold text-slate-500">Phone: </span>
              {formatPhone(cleanPhone)}
            </p>
          )}
          {cleanEmail && (
            <p className="text-xs text-slate-600 truncate">
              <span className="font-semibold text-slate-500">Email: </span>
              {cleanEmail}
            </p>
          )}
          {cleanLocation && (
            <p className="text-xs text-slate-600">
              <span className="font-semibold text-slate-500">Location: </span>
              {cleanLocation}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
