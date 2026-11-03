import QRCode from "qrcode";
import { fetchImageAsDataUrl } from "@/app/lib/exportImage";
import {
  DIGITAL_BIZ_CARD_BG,
  DIGITAL_BIZ_CARD_LOGO,
  triggerBlobDownload,
} from "./digitalBizCard.utils";
import type { DigitalBizCardData } from "./digitalBizCard.types";
import type { DigitalBizCardTheme } from "./digitalBizCard.theme";
import {
  BASE_H,
  BASE_W,
  CARD_H,
  CARD_W,
  DIGITAL_BIZ_CARD_DIMENSIONS,
  DIGITAL_BIZ_CARD_LAYOUT,
  EXPORT_SCALE,
  getDigitalBizCardColumns,
} from "./digitalBizCard.layout";

const FONT = '"Segoe UI", system-ui, -apple-system, sans-serif';
const L = DIGITAL_BIZ_CARD_LAYOUT;

function resolveAssetUrl(path: string): string {
  if (typeof window === "undefined") return path;
  if (/^https?:\/\//i.test(path)) return path;
  return `${window.location.origin}${path.startsWith("/") ? path : `/${path}`}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function ellipsizeText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let value = text;
  while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth) {
    value = value.slice(0, -1);
  }
  return `${value}…`;
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = words[0] ?? "";
  for (let i = 1; i < words.length; i += 1) {
    const next = `${current} ${words[i]}`;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
    } else {
      lines.push(current);
      current = words[i] ?? "";
    }
  }
  lines.push(current);
  return lines;
}

function parseCssColor(css: string): [number, number, number, number] {
  const c = css.trim();
  const hex = c.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) {
      h = h
        .split("")
        .map((ch) => ch + ch)
        .join("");
    }
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
      h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255,
    ];
  }
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

function buildCanvasGradient(
  ctx: CanvasRenderingContext2D,
  css: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): CanvasGradient | null {
  const linear = css.trim().match(/^linear-gradient\((.+)\)$/i);
  if (!linear) return null;

  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of linear[1]) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());

  let stopParts = parts;
  if (/^(\d+deg|to\s)/i.test(parts[0] ?? "")) {
    stopParts = parts.slice(1);
  }
  if (stopParts.length < 2) return null;

  const grad = ctx.createLinearGradient(x0, y0, x1, y1);
  stopParts.forEach((stop, i) => {
    const cleanStop = stop.replace(/\s+[\d.]+%\s*$/, "").trim();
    const [r, g, b, a] = parseCssColor(cleanStop);
    const pos = stopParts.length === 1 ? 0 : i / (stopParts.length - 1);
    grad.addColorStop(pos, `rgba(${r},${g},${b},${a / 255})`);
  });
  return grad;
}

function setTextShadow(ctx: CanvasRenderingContext2D, scale: number): void {
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = L.textShadowBlur * scale;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = L.textShadowOffsetY * scale;
}

function clearShadow(ctx: CanvasRenderingContext2D): void {
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

async function resolveInlineImage(src: string): Promise<string> {
  if (!src) return "";
  if (src.startsWith("data:")) return src;
  return (await fetchImageAsDataUrl(src)) ?? "";
}

export async function generateVcardQrDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, {
    width: Math.round(L.qrSize * EXPORT_SCALE),
    margin: 1,
    errorCorrectionLevel: "H",
    color: { dark: "#111111", light: "#ffffff" },
  });
}

export async function exportDigitalBizCardPng(
  data: DigitalBizCardData,
  qrDataUrl: string,
  theme: DigitalBizCardTheme,
): Promise<void> {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is not supported");

  // Draw in base coords (BASE_W × BASE_H), scaled to export coords.
  ctx.scale(EXPORT_SCALE, EXPORT_SCALE);

  const [textureSrc, logoSrc, profileSrc] = await Promise.all([
    resolveInlineImage(resolveAssetUrl(DIGITAL_BIZ_CARD_BG)),
    resolveInlineImage(resolveAssetUrl(DIGITAL_BIZ_CARD_LOGO)),
    data.profileImageUrl ? resolveInlineImage(data.profileImageUrl) : Promise.resolve(""),
  ]);

  // Base themed background inside rounded card
  roundRectPath(ctx, 0, 0, BASE_W, BASE_H, L.cardRadius);
  ctx.save();
  ctx.clip();

  const gradientFill =
    buildCanvasGradient(ctx, theme.gradient, 0, 0, BASE_W, BASE_H) ?? theme.accent;
  ctx.fillStyle = gradientFill;
  ctx.fillRect(0, 0, BASE_W, BASE_H);

  // Rotated texture overlay
  if (textureSrc) {
    try {
      const texture = await loadImage(textureSrc);
      ctx.save();
      ctx.translate(BASE_W * 0.17, BASE_H * 0.5);
      ctx.rotate(Math.PI / 4);
      ctx.globalAlpha = L.textureOpacity;
      ctx.drawImage(texture, -BASE_W * 0.75, -BASE_H * 0.75, BASE_W * 1.5, BASE_H * 1.5);
      ctx.restore();
      ctx.globalAlpha = 1;
    } catch {
      // texture is optional
    }
  }

  const headerFill =
    buildCanvasGradient(ctx, theme.headerGradient, 0, 0, BASE_W, BASE_H) ?? theme.accent;
  ctx.globalAlpha = L.headerOverlayOpacity;
  ctx.fillStyle = headerFill;
  ctx.fillRect(0, 0, BASE_W, BASE_H);
  ctx.globalAlpha = 1;

  ctx.fillStyle = `rgba(0,0,0,${L.scrimOpacity})`;
  ctx.fillRect(0, 0, BASE_W, BASE_H);
  ctx.restore();

  // Left column content
  const { leftW, rightX } = getDigitalBizCardColumns(BASE_W);
  const avatarR = L.avatarSize / 2;
  const avatarCx = L.padX + avatarR;
  const avatarCy = L.padY + avatarR;
  const textX = L.padX;
  const textMaxW = leftW - L.padX * 2;

  // Avatar ring + clip
  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarCx, avatarCy, avatarR + L.avatarBorder, 0, Math.PI * 2);
  ctx.fillStyle = theme.accent;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(avatarCx, avatarCy, avatarR, 0, Math.PI * 2);
  ctx.clip();

  if (profileSrc) {
    try {
      const avatar = await loadImage(profileSrc);
      ctx.drawImage(
        avatar,
        avatarCx - avatarR,
        avatarCy - avatarR,
        L.avatarSize,
        L.avatarSize,
      );
    } catch {
      ctx.fillStyle = theme.accent;
      ctx.fillRect(avatarCx - avatarR, avatarCy - avatarR, L.avatarSize, L.avatarSize);
      ctx.fillStyle = theme.text;
      ctx.font = `700 ${Math.round(L.avatarSize * 0.28)}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(data.initials, avatarCx, avatarCy);
    }
  } else {
    ctx.fillStyle = theme.accent;
    ctx.fillRect(avatarCx - avatarR, avatarCy - avatarR, L.avatarSize, L.avatarSize);
    ctx.fillStyle = theme.text;
    ctx.font = `700 ${Math.round(L.avatarSize * 0.28)}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(data.initials, avatarCx, avatarCy);
  }
  ctx.restore();

  // Text block
  let cursorY = L.padY + L.avatarSize + L.gapAfterAvatar;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  setTextShadow(ctx, 1);

  ctx.fillStyle = theme.text;
  ctx.font = `700 ${L.nameFontSize}px ${FONT}`;
  ctx.fillText(ellipsizeText(ctx, data.displayName, textMaxW), textX, cursorY);
  cursorY += L.nameLineHeight;

  ctx.fillStyle = theme.accent;
  ctx.font = `600 ${L.jobFontSize}px ${FONT}`;
  ctx.fillText(ellipsizeText(ctx, data.jobTitle, textMaxW), textX, cursorY);
  cursorY += L.jobLineHeight + L.jobGapAfter;

  ctx.font = `500 ${L.contactFontSize}px ${FONT}`;
  const contactLines = [
    data.phone
      ? data.phone.startsWith("+")
        ? data.phone
        : data.phone
      : "",
    data.email,
    data.portfolioLabel,
  ].filter(Boolean);

  for (const line of contactLines) {
    for (const wrappedLine of wrapTextLines(ctx, line, textMaxW)) {
      ctx.fillText(wrappedLine, textX, cursorY);
      cursorY += L.contactLineHeight;
    }
  }
  clearShadow(ctx);

  // QR frame (right column)
  const qrFrameSize = L.qrSize + L.qrPadding * 2;
  const rightColCenterX = rightX + (BASE_W - rightX) / 2;
  const qrFrameX = rightColCenterX - qrFrameSize / 2;
  const qrFrameY = BASE_H / 2 - qrFrameSize / 2;

  ctx.save();
  ctx.shadowColor = theme.accentSoft;
  ctx.shadowBlur = L.qrBoxShadowBlur;
  ctx.shadowOffsetY = L.qrBoxShadowY;
  roundRectPath(ctx, qrFrameX, qrFrameY, qrFrameSize, qrFrameSize, L.qrFrameRadius);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();

  const qrX = qrFrameX + L.qrPadding;
  const qrY = qrFrameY + L.qrPadding;
  try {
    const qrImg = await loadImage(qrDataUrl);
    ctx.drawImage(qrImg, qrX, qrY, L.qrSize, L.qrSize);
  } catch {
    ctx.fillStyle = "#e5e7eb";
    ctx.fillRect(qrX, qrY, L.qrSize, L.qrSize);
  }

  // Bottom-right logo
  if (logoSrc) {
    try {
      const logo = await loadImage(logoSrc);
      const logoH = L.logoHeight;
      const logoW = (logo.width / logo.height) * logoH;
      const logoX = BASE_W - L.logoInset - logoW;
      const logoY = BASE_H - L.logoInset - logoH;
      ctx.drawImage(logo, logoX, logoY, logoW, logoH);
    } catch {
      // logo is optional
    }
  }

  // Card border
  roundRectPath(ctx, 0, 0, BASE_W, BASE_H, L.cardRadius);
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  ctx.stroke();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error("Failed to export PNG"));
    }, "image/png");
  });

  triggerBlobDownload(blob, data.fileName);
}

export { DIGITAL_BIZ_CARD_DIMENSIONS };
