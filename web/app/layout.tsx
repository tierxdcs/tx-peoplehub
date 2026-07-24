import type { Metadata } from 'next';
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
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={signatureFontVars} suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <AppThemeProvider>
          <AuthProvider>
            <ToasterProvider>
              <ConfirmProvider>{children}</ConfirmProvider>
            </ToasterProvider>
          </AuthProvider>
        </AppThemeProvider>
      </body>
    </html>
  );
}
