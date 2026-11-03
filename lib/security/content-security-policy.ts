function resolveBackendOrigin(): string | null {
  try {
    const candidate = process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? null;
    return candidate ? new URL(candidate).origin : null;
  } catch {
    return null;
  }
}

export function generateCspNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

export function buildContentSecurityPolicy(options: {
  nonce: string;
  isDev?: boolean;
}): string {
  const backendOrigin = resolveBackendOrigin();

  const connectSrcParts = [
    "'self'",
    "https://api.resend.com",
    "https://api.upstash.com",
    "https://res.cloudinary.com",
    "https://api.cloudinary.com",
    "https://ontap-media.f86d5ef2527c0628f724488a7c353eb2.r2.cloudflarestorage.com", // R2 bucket endpoint
    "https://*.r2.cloudflarestorage.com", // R2 wildcard for flexibility
  ];
  if (backendOrigin) connectSrcParts.push(backendOrigin);

  const imgSrcParts = ["'self'", "data:", "https:", "https://res.cloudinary.com", "blob:"];
  if (backendOrigin) imgSrcParts.push(backendOrigin);

  const devEval = options.isDev ? " 'unsafe-eval'" : "";

  // CSP Level 3: split style directives so nonce on <style> elements does not
  // disable 'unsafe-inline' for React style={} and the Next.js dev overlay.
  const styleSrcElem = options.isDev
    ? "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com"
    : `style-src-elem 'self' 'nonce-${options.nonce}' https://fonts.googleapis.com`;

  const csp = `
    default-src 'self';
    script-src 'self' 'nonce-${options.nonce}' 'strict-dynamic'${devEval};
    ${styleSrcElem};
    style-src-attr 'unsafe-inline';
    img-src ${imgSrcParts.join(" ")};
    media-src 'self' blob: https://res.cloudinary.com https://api.cloudinary.com https://*.r2.cloudflarestorage.com;
    font-src 'self' https://fonts.gstatic.com;
    connect-src ${connectSrcParts.join(" ")};
    form-action 'self';
    frame-ancestors 'none';
    block-all-mixed-content;
    upgrade-insecure-requests;
  `;

  return csp.replace(/\s{2,}/g, " ").trim();
}



