/** Extract `href` values from rendered email HTML. */
export function extractEmailHrefs(html: string): string[] {
  const hrefs: string[] = [];
  const pattern = /href="([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    hrefs.push(match[1].replace(/&amp;/g, "&"));
  }
  return hrefs;
}

/** Return only in-app relative or absolute portal links (exclude mailto, anchors). */
export function filterPortalHrefs(hrefs: string[], appBaseUrl = "https://portal.ontap.ph"): string[] {
  const base = appBaseUrl.replace(/\/$/, "");
  return hrefs.filter((href) => {
    const value = href.trim();
    if (!value || value.startsWith("#") || value.startsWith("mailto:")) return false;
    if (value.startsWith("/")) return true;
    return value.startsWith(base);
  });
}

export function toPortalPathname(href: string, appBaseUrl = "https://portal.ontap.ph"): string {
  const value = href.trim();
  if (value.startsWith("/")) return value;
  const base = appBaseUrl.replace(/\/$/, "");
  if (value.startsWith(base)) {
    return value.slice(base.length) || "/";
  }
  return value;
}
