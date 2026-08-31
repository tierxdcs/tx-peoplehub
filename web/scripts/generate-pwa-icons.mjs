/**
 * Regenerates the PWA / home-screen icons in web/public/.
 *
 *   cd web && node scripts/generate-pwa-icons.mjs
 *
 * The icons are committed PNGs — a phone's home screen and the web app manifest
 * both need real raster files at fixed sizes, so they cannot be generated at
 * request time. This script exists so a rebrand is a re-run rather than a
 * hand-edit in an image editor, the same intent as the single BRAND object in
 * app/lib/theme.ts.
 *
 * The glyph is redrawn here from its VECTOR definition (copied from the brand
 * mark in public/phaze-logo-dark.svg: a 3x3 grid of 50x50 tiles on a 64-unit
 * pitch, so 178x178 overall) rather than cropped out of
 * phaze-3b-logo-native.png. The raster logo is only 178px of glyph, and a 512px
 * icon would be a 2.9x upscale of it — visibly soft on exactly the surface
 * (a home screen) where the icon is the whole of the brand.
 *
 * sharp is used only here, and only as a dev tool: it ships transitively with
 * Next, so there is nothing to add to dependencies. If a future install drops
 * it, `npm i -D sharp` and re-run.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const PUBLIC_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
);

/**
 * The icon canvas is the app's own dark background (globals.css
 * `--background: 0 0% 10%`), which is also manifest theme_color /
 * background_color. Keeping all three identical is what makes the glyph appear
 * to float on the Android splash screen instead of sitting in a visible square.
 */
const CANVAS = '#1a1a1a';

/** Brand mark, verbatim from public/phaze-logo-dark.svg. */
const GLYPH_SIZE = 178;
const TILES = [
  { x: 0, y: 0, fill: '#F6F5F3' },
  { x: 64, y: 0, fill: '#F6F5F3' },
  { x: 0, y: 128, fill: '#F6F5F3' },
  { x: 128, y: 0, fill: '#3A3833' },
  { x: 64, y: 64, fill: '#3A3833' },
  { x: 128, y: 64, fill: '#3A3833' },
  { x: 64, y: 128, fill: '#3A3833' },
  { x: 128, y: 128, fill: '#3A3833' },
  { x: 0, y: 64, fill: 'url(#amber)' },
];

/**
 * @param size    output edge length in px
 * @param inset   fraction of the canvas the glyph occupies (0-1)
 */
function iconSvg(size, inset) {
  const scale = (size * inset) / GLYPH_SIZE;
  const offset = (size - GLYPH_SIZE * scale) / 2;
  const tiles = TILES.map(
    (t) => `<rect x="${t.x}" y="${t.y}" width="50" height="50" fill="${t.fill}"/>`,
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="amber" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ECCC48"/><stop offset="1" stop-color="#E87F25"/></linearGradient></defs>
  <rect width="${size}" height="${size}" fill="${CANVAS}"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">${tiles}</g>
</svg>`;
}

const OUTPUTS = [
  // Standard "any" purpose icons. The launcher/installer may letterbox or round
  // these, so the glyph keeps a margin of its own.
  { file: 'icon-192.png', size: 192, inset: 0.68 },
  { file: 'icon-512.png', size: 512, inset: 0.68 },
  /**
   * Maskable: Android crops this to a platform-chosen shape (circle, squircle,
   * teardrop). Only the central circle of 80% diameter is guaranteed to survive,
   * and the largest square inside that circle has a side of 0.8/sqrt(2) ~= 57%
   * of the canvas — so 50% keeps every tile inside the safe zone whatever shape
   * the device picks.
   */
  { file: 'icon-maskable-512.png', size: 512, inset: 0.5 },
  /**
   * iOS home screen. iOS applies its own rounded-rect mask and does NOT
   * composite alpha over anything sensible, so this one must be fully opaque
   * (it is — the canvas rect covers it) and needs no corner rounding of its own.
   * 180x180 is the size current iPhones ask for.
   */
  { file: 'apple-touch-icon.png', size: 180, inset: 0.66 },
];

for (const { file, size, inset } of OUTPUTS) {
  const out = path.join(PUBLIC_DIR, file);
  await sharp(Buffer.from(iconSvg(size, inset)))
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`wrote public/${file} (${size}x${size}, glyph ${inset * 100}%)`);
}
