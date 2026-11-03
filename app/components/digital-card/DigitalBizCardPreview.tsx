"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { DigitalBizCardData } from "./digitalBizCard.types";
import type { DigitalBizCardTheme } from "./digitalBizCard.theme";
import { DIGITAL_BIZ_CARD_BG, DIGITAL_BIZ_CARD_LOGO } from "./digitalBizCard.utils";
import {
  BASE_H,
  BASE_W,
  DIGITAL_BIZ_CARD_DIMENSIONS,
  DIGITAL_BIZ_CARD_LAYOUT,
  getDigitalBizCardColumns,
} from "./digitalBizCard.layout";

type DigitalBizCardPreviewProps = {
  data: DigitalBizCardData;
  qrDataUrl: string;
  profileDataUrl?: string;
  theme: DigitalBizCardTheme;
  className?: string;
};

/** Preview renders the card at its native 1200×756 layout and scales
 *  the whole thing to fit the surrounding modal, so the on-screen result
 *  is pixel-proportional to the exported 3840×2421 PNG. */
export function DigitalBizCardPreview({
  data,
  qrDataUrl,
  profileDataUrl = "",
  theme,
  className = "",
}: DigitalBizCardPreviewProps) {
  const contactLines = [data.phone, data.email, data.portfolioLabel].filter(Boolean);
  const L = DIGITAL_BIZ_CARD_LAYOUT;
  const textShadow = `0 ${L.textShadowOffsetY}px ${L.textShadowBlur}px rgba(0,0,0,0.55)`;
  const { leftW, rightW } = getDigitalBizCardColumns(BASE_W);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const compute = () => {
      const w = wrapper.clientWidth;
      if (w > 0) setScale(w / BASE_W);
    };

    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={wrapperRef}
      className={`relative ${className}`}
      style={{
        width: "100%",
        maxWidth: DIGITAL_BIZ_CARD_DIMENSIONS.previewMaxWidth,
        aspectRatio: DIGITAL_BIZ_CARD_DIMENSIONS.aspectRatio,
      }}
    >
      <div
        className="absolute top-0 left-0 overflow-hidden shadow-2xl"
        style={{
          width: BASE_W,
          height: BASE_H,
          borderRadius: L.cardRadius,
          background: theme.gradient,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
        }}
      >
        <Image
          src={DIGITAL_BIZ_CARD_BG}
          alt=""
          fill
          priority
          className="object-cover mix-blend-soft-light"
          style={{
            opacity: L.textureOpacity,
            transform: "translateX(-33%) rotate(45deg) scale(1.35)",
            transformOrigin: "center center",
            pointerEvents: "none",
          }}
          sizes="1200px"
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: theme.headerGradient, opacity: L.headerOverlayOpacity }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ backgroundColor: `rgba(0,0,0,${L.scrimOpacity})` }}
        />

        <div className="relative z-10 flex h-full w-full">
          <div
            className="flex min-w-0 flex-col"
            style={{
              width: leftW,
              paddingLeft: L.padX,
              paddingTop: L.padY,
              paddingBottom: L.padY,
            }}
          >
            <div
              className="relative z-20 overflow-hidden rounded-full shadow-lg"
              style={{
                width: L.avatarSize,
                height: L.avatarSize,
                border: `${L.avatarBorder}px solid ${theme.accent}`,
                backgroundColor: theme.accentSoft,
                flexShrink: 0,
              }}
            >
              {profileDataUrl ? (
                <img
                  src={profileDataUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  crossOrigin="anonymous"
                />
              ) : (
                <div
                  className="flex h-full w-full items-center justify-center font-bold"
                  style={{
                    color: theme.text,
                    backgroundColor: theme.accent,
                    fontSize: Math.round(L.avatarSize * 0.28),
                  }}
                >
                  {data.initials}
                </div>
              )}
            </div>

            <div
              className="flex min-h-0 flex-1 flex-col text-left"
              style={{ marginTop: L.gapAfterAvatar }}
            >
              <p
                className="font-bold break-words"
                style={{
                  color: theme.text,
                  textShadow,
                  fontSize: L.nameFontSize,
                  lineHeight: `${L.nameLineHeight}px`,
                  margin: 0,
                }}
              >
                {data.displayName}
              </p>
              <p
                className="font-semibold break-words"
                style={{
                  color: theme.accent,
                  textShadow,
                  fontSize: L.jobFontSize,
                  lineHeight: `${L.jobLineHeight}px`,
                  marginTop: 2,
                  marginBottom: L.jobGapAfter,
                }}
              >
                {data.jobTitle}
              </p>
              <div style={{ fontSize: L.contactFontSize, lineHeight: `${L.contactLineHeight}px` }}>
                {contactLines.map((line) => (
                  <p
                    key={line}
                    className="break-all font-medium"
                    style={{ color: theme.accent, textShadow, margin: 0 }}
                  >
                    {line}
                  </p>
                ))}
              </div>
            </div>
          </div>

          <div
            className="relative flex items-center justify-center"
            style={{ width: rightW }}
          >
            <div
              className="bg-white"
              style={{
                padding: L.qrPadding,
                borderRadius: L.qrFrameRadius,
                boxShadow: `0 ${L.qrBoxShadowY}px ${L.qrBoxShadowBlur}px ${theme.accentSoft}`,
              }}
            >
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="VCard QR code"
                  width={L.qrSize}
                  height={L.qrSize}
                  style={{ width: L.qrSize, height: L.qrSize, display: "block" }}
                />
              ) : (
                <div
                  className="flex items-center justify-center bg-slate-100 text-slate-500"
                  style={{ width: L.qrSize, height: L.qrSize, fontSize: L.contactFontSize }}
                >
                  Generating QR…
                </div>
              )}
            </div>

            <div
              className="absolute"
              style={{ right: L.logoInset, bottom: L.logoInset }}
            >
              <Image
                src={DIGITAL_BIZ_CARD_LOGO}
                alt="OnTap"
                width={240}
                height={80}
                style={{ height: L.logoHeight, width: "auto" }}
                className="object-contain drop-shadow-lg"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
