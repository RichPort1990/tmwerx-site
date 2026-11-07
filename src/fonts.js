// Fonts served from this site (no Google Fonts requests): Barlow, Barlow Condensed and JetBrains Mono, SIL Open Font Licence
import bR from './fonts/Barlow-Regular.woff2';
import bM from './fonts/Barlow-Medium.woff2';
import bS from './fonts/Barlow-SemiBold.woff2';
import cM from './fonts/BarlowCondensed-Medium.woff2';
import cS from './fonts/BarlowCondensed-SemiBold.woff2';
import cB from './fonts/BarlowCondensed-Bold.woff2';
import jb from './fonts/JetBrainsMono.woff2';
import bX from './fonts/Barlow-ExtraBold.woff2';
import bK from './fonts/Barlow-Black.woff2';
export const FONTS = {
  'Barlow-Regular.woff2': bR,
  'Barlow-Medium.woff2': bM,
  'Barlow-SemiBold.woff2': bS,
  'BarlowCondensed-Medium.woff2': cM,
  'BarlowCondensed-SemiBold.woff2': cS,
  'BarlowCondensed-Bold.woff2': cB,
  'JetBrainsMono.woff2': jb,
  'Barlow-ExtraBold.woff2': bX,
  'Barlow-Black.woff2': bK,
};
const ff = (fam, w, f) =>
  `@font-face{font-family:'${fam}';font-style:normal;font-weight:${w};font-display:swap;src:url(/fonts/${f}) format('woff2')}`;
export const FONT_CSS = [
  ff('Barlow', 400, 'Barlow-Regular.woff2'),
  ff('Barlow', 500, 'Barlow-Medium.woff2'),
  ff('Barlow', 600, 'Barlow-SemiBold.woff2'),
  ff('Barlow', 800, 'Barlow-ExtraBold.woff2'),
  ff('Barlow', 900, 'Barlow-Black.woff2'),
  ff('Barlow Condensed', 500, 'BarlowCondensed-Medium.woff2'),
  ff('Barlow Condensed', 600, 'BarlowCondensed-SemiBold.woff2'),
  ff('Barlow Condensed', 700, 'BarlowCondensed-Bold.woff2'),
  ff('JetBrains Mono', '400 500', 'JetBrainsMono.woff2'),
].join('\n');
