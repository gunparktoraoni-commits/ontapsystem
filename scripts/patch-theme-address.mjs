import fs from 'fs';

const contactCond =
  '(d.vcard.email || d.vcard.contactNumber || d.vcard.secondaryNumber || d.vcard.alternativeEmail || hasAddr)';
const contactCondFixed =
  '(d.vcard.email || d.vcard.contactNumber || d.vcard.secondaryNumber || d.vcard.alternativeEmail)';

const varsStart = '  const addr     = fullAddress(d.vcard);';
const varsEnd = "  const mapLink  = mapsHref(mapRaw, '');\n";

const addressBlockStart = '                  {/* Address block */}';
const addressBlockEnd = '                  )}\n';

function removeBetween(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  if (start === -1) return src;
  const end = src.indexOf(endMarker, start + startMarker.length);
  if (end === -1) return src;
  return src.slice(0, start) + src.slice(end + endMarker.length);
}

function removeMapBlock(src) {
  const markers = ['          {/* ── Location Map ── */}', '          {/* ── Map / Location ── */}'];
  for (const marker of markers) {
    const start = src.indexOf(marker);
    if (start === -1) continue;
    const condStart = src.indexOf('{hasMap && mapEmbed && (', start);
    if (condStart === -1) continue;
    let depth = 0;
    let i = condStart;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) {
          i++;
          while (src[i] === ' ' || src[i] === '\n') i++;
          if (src[i] === '}') i++;
          break;
        }
      }
    }
    return src.slice(0, start) + src.slice(i + 1);
  }
  return src;
}

function patchFile(rel, theme) {
  let src = fs.readFileSync(rel, 'utf8');
  const orig = src;

  if (!src.includes('PortfolioAddressSection')) {
    src = src.replace(
      "  isGalleryEnabled,\n} from '../../shared';",
      "  isGalleryEnabled,\n  PortfolioAddressSection,\n} from '../../shared';",
    );
  }

  if (src.includes(varsStart)) {
    src = removeBetween(src, varsStart, varsEnd);
  }

  src = removeMapBlock(src);

  if (!src.includes('PortfolioAddressSection\n              vcard={d.vcard}')) {
    const insert = `          <AnimatedSection delay={360} mini={mini}>
            <PortfolioAddressSection
              vcard={d.vcard}
              mini={mini}
              theme={{ cardBg: ${theme.cardBg}, text: ${theme.text}, textMuted: ${theme.textMuted}, accent: ${theme.accent}, glass: ${theme.glass} }}
            />
          </AnimatedSection>

`;
    const contactMarkers = [
      '          {/* ── Contact Info Cards ── */}',
      '          {/* ── Contact Info ── */}',
      '          {/* ── Contact ── */}',
    ];
    for (const marker of contactMarkers) {
      const idx = src.indexOf(marker);
      if (idx !== -1) {
        src = src.slice(0, idx) + insert + src.slice(idx);
        break;
      }
    }
  }

  src = src.replaceAll(contactCond, contactCondFixed);

  let addrIdx = src.indexOf(addressBlockStart);
  while (addrIdx !== -1) {
    const endIdx = src.indexOf(addressBlockEnd, addrIdx);
    if (endIdx === -1) break;
    src = src.slice(0, addrIdx) + src.slice(endIdx + addressBlockEnd.length);
    addrIdx = src.indexOf(addressBlockStart);
  }

  // elegant-dark index uses different address comment
  const addrRowsStart = '              {hasAddr && (';
  if (src.includes(addrRowsStart) && !src.includes(addressBlockStart)) {
    src = removeBetween(src, addrRowsStart, '              )}\n');
  }

  if (src !== orig) {
    fs.writeFileSync(rel, src);
    console.log('updated', rel);
  } else {
    console.log('no change', rel);
  }
}

const oceanTheme = {
  cardBg: 'C.surface',
  text: 'C.text',
  textMuted: 'C.muted',
  accent: 'C.accent',
  glass: 'C.glass',
};

const royalTheme = {
  cardBg: 'C.surface',
  text: 'C.text',
  textMuted: 'C.muted',
  accent: 'C.gold',
  glass: 'C.glass',
};

for (const f of [
  'app/themes/standard/ocean-gradient/ocean-gradient-v2.tsx',
  'app/themes/standard/ocean-gradient/ocean-gradient-v3.tsx',
  'app/themes/basic/elegant-dark/elegant-dark-v2.tsx',
  'app/themes/basic/elegant-dark/elegant-dark-v3.tsx',
]) {
  patchFile(f, oceanTheme);
}

for (const f of [
  'app/themes/standard/royal-purple/index.tsx',
  'app/themes/standard/royal-purple/royal-purple-v2.tsx',
  'app/themes/standard/royal-purple/royal-purple-v3.tsx',
]) {
  patchFile(f, royalTheme);
}
