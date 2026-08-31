import type { MetadataRoute } from 'next';
import { BRAND } from './lib/theme';

/**
 * The web app manifest — what makes the app installable on a phone's home
 * screen. Served by Next at /manifest.webmanifest and linked automatically from
 * the document head (no manual <link> needed).
 *
 * A TypeScript metadata route rather than a static public/manifest.json so the
 * app name comes from the same BRAND object as the top bar and the browser
 * title. A rebrand stays a one-file change (app/lib/theme.ts), which is the
 * whole point of that object.
 */

/**
 * The app's own dark background (globals.css `--background: 0 0% 10%`), which
 * the icon canvas also uses. theme_color paints the Android status bar and
 * background_color paints the splash screen while the app boots — matching both
 * to the real UI background is what removes the white flash on launch.
 */
const DARK = '#1a1a1a';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND.appName} — ${BRAND.tagline}`,
    short_name: BRAND.appName,
    description: 'Phaze ERP management system',
    // Installed users are signed-in staff, so the dashboard is the useful
    // entry point; '/' would land them on the marketing/redirect shell.
    // The query string is a free install-attribution signal in any analytics
    // added later, and is ignored by the router.
    start_url: '/dashboard?source=pwa',
    scope: '/',
    /**
     * Load-bearing, not cosmetic. Standalone removes the browser chrome, and on
     * iOS it is also the *precondition for push notifications at all*: Safari
     * only grants the Push API to a web app launched from the home screen in
     * standalone display mode. A 'browser' or 'minimal-ui' value would silently
     * cost us the entire iOS push channel.
     */
    display: 'standalone',
    orientation: 'portrait-primary',
    theme_color: DARK,
    background_color: DARK,
    lang: 'en',
    dir: 'ltr',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Android crops a maskable icon to its own shape; this one keeps the
      // glyph inside the safe zone so no tile is clipped. Declared separately
      // from 'any' on purpose — a single icon marked both gets over-cropped on
      // some launchers and letterboxed on others.
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
