import type { Metadata, Viewport } from 'next';
import {
  Dancing_Script,
  Caveat,
  Pacifico,
  Great_Vibes,
  Fraunces,
} from 'next/font/google';
import './globals.css';
import { AuthProvider } from './lib/auth-context';
import { BRAND } from './lib/theme';
import { ToasterProvider } from './components/ui/toaster';
import { ConfirmProvider } from './components/ui/confirm';
import { AppThemeProvider } from './components/theme/app-theme-provider';
import { NumberFormatProvider } from './lib/number-format-context';
import { ServiceWorkerRegistrar } from './components/pwa/service-worker-registrar';

// Signature-style fonts for the internal e-signature display layer. Exposed as
// CSS variables so a snapshotted signature renders in its chosen font both
// on-screen and in browser print-to-PDF (next/font self-hosts the files, so
// they're embedded — no runtime network fetch that print might miss).
const dancingScript = Dancing_Script({
  subsets: ['latin'],
  variable: '--font-signature-dancing-script',
  display: 'swap',
});
const caveat = Caveat({
  subsets: ['latin'],
  variable: '--font-signature-caveat',
  display: 'swap',
});
const pacifico = Pacifico({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-signature-pacifico',
  display: 'swap',
});
const greatVibes = Great_Vibes({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-signature-great-vibes',
  display: 'swap',
});

// The editorial "voice" serif — used sparingly (the dashboard motivational
// quote). Exposed as --font-voice; referenced via the `font-voice` utility.
const voiceSerif = Fraunces({
  subsets: ['latin'],
  variable: '--font-voice',
  display: 'swap',
});

const signatureFontVars = [
  dancingScript.variable,
  caveat.variable,
  pacifico.variable,
  greatVibes.variable,
  voiceSerif.variable,
].join(' ');

export const metadata: Metadata = {
  title: `${BRAND.appName} - ${BRAND.tagline}`,
  description: 'Phaze ERP management system',
  applicationName: BRAND.appName,
  // app/manifest.ts is linked automatically by Next; the Apple tags below have
  // no manifest equivalent — iOS reads them from the document head instead.
  appleWebApp: {
    capable: true,
    title: BRAND.appName,
    // 'black-translucent' would let content slide under the notch; 'default'
    // keeps the status bar as its own bar, tinted by themeColor below.
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    // What iOS actually uses for the home-screen icon.
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
};

/**
 * themeColor lives on `viewport`, not `metadata` (Next 15 moved it, and warns
 * at build time if it's in the wrong export). It tints the Android status bar
 * and the iOS status bar in standalone mode, so it matches the app background
 * and manifest theme_color — one continuous near-black from icon to chrome.
 */
export const viewport: Viewport = {
  themeColor: '#1a1a1a',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={signatureFontVars} suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {/* Registered on every page, signed in or not: the browser only offers
        to install an app whose service worker is already registered, and the
        login screen is a perfectly good place to install from. */}
        <ServiceWorkerRegistrar />
        <AppThemeProvider>
          <NumberFormatProvider>
            <AuthProvider>
              <ToasterProvider>
                <ConfirmProvider>{children}</ConfirmProvider>
              </ToasterProvider>
            </AuthProvider>
          </NumberFormatProvider>
        </AppThemeProvider>
      </body>
    </html>
  );
}
