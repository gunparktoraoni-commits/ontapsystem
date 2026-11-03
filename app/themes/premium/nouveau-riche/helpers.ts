/** Shared helpers for Nouveau Riche theme variants. */

/** Sequential 01, 02, … counter for sections that actually render. */
export function createSectionCounter(): () => string {
  let n = 0;
  return () => String(++n).padStart(2, "0");
}

/**
 * CSS for a typographic drop-cap on the About body.
 * Applied via className "nr-dropcap" on the about text wrapper.
 */
export const NR_DROPCAP_CSS = `
  .nr-dropcap::first-letter {
    float: left;
    font-family: 'Cormorant Garamond', serif;
    font-size: 3.2em;
    font-weight: 600;
    line-height: 0.75;
    margin-right: 0.12em;
    margin-top: 0.12em;
  }
`;

/**
 * Live Preview / phone layout: Tailwind sm:/vw use the desktop viewport, so
 * scope mobile-safe sizes under .nr-mobile when isMobile is true.
 */
export const NR_MOBILE_CSS = `
  .nr-mobile .nr-section-num {
    font-size: 4.5rem !important;
  }
  .nr-mobile .nr-dropcap::first-letter {
    font-size: 2.35em;
    line-height: 0.8;
    margin-top: 0.06em;
  }
  .nr-mobile .nr-hero-name {
    font-size: 2.15rem !important;
    line-height: 1.08 !important;
    overflow-wrap: break-word;
    word-break: normal;
  }
  .nr-mobile .nr-section-heading {
    font-size: 1.55rem !important;
  }
  .nr-mobile .nr-intro-body {
    font-size: 0.95rem !important;
  }
  .nr-mobile .nr-contact-list > * {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }
`;
