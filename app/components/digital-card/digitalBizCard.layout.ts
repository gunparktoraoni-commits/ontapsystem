/** Shared digital bizcard layout — preview renders at BASE_W × BASE_H,
 *  PNG export scales the same coordinates up to CARD_W × CARD_H (3840 × 2421). */

export const BASE_W = 1200;
export const BASE_H = 756;

export const CARD_W = 3840;
export const CARD_H = 2421;

export const CARD_ASPECT_RATIO = `${BASE_W} / ${BASE_H}`;
export const EXPORT_SCALE = CARD_W / BASE_W;

export const DIGITAL_BIZ_CARD_LAYOUT = {
  leftColRatio: 0.55,
  rightColRatio: 0.45,
  padX: 48,
  padY: 48,
  avatarSize: 190,
  avatarBorder: 6,
  gapAfterAvatar: 32,
  nameFontSize: 56,
  nameLineHeight: 66,
  jobFontSize: 34,
  jobLineHeight: 42,
  jobGapAfter: 28,
  contactFontSize: 28,
  contactLineHeight: 38,
  qrSize: 420,
  qrPadding: 20,
  qrFrameRadius: 26,
  logoHeight: 56,
  logoInset: 40,
  cardRadius: 32,
  textureOpacity: 0.35,
  headerOverlayOpacity: 0.42,
  scrimOpacity: 0.1,
  textShadowBlur: 12,
  textShadowOffsetY: 2,
  qrBoxShadowY: 20,
  qrBoxShadowBlur: 48,
} as const;

export const DIGITAL_BIZ_CARD_DIMENSIONS = {
  width: BASE_W,
  height: BASE_H,
  exportWidth: CARD_W,
  exportHeight: CARD_H,
  aspectRatio: CARD_ASPECT_RATIO,
  previewMaxWidth: BASE_W,
};

export function getDigitalBizCardColumns(width = BASE_W) {
  const leftW = width * DIGITAL_BIZ_CARD_LAYOUT.leftColRatio;
  const rightW = width * DIGITAL_BIZ_CARD_LAYOUT.rightColRatio;
  return { leftW, rightW, leftX: 0, rightX: leftW };
}
