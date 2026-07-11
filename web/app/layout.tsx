import type { Metadata } from 'next';
import {
  Dancing_Script,
  Caveat,
  Pacifico,
  Great_Vibes,
} from 'next/font/google';
import './globals.css';
import { AuthProvider } from './lib/auth-context';
import { BRAND } from './lib/theme';
import { ToasterProvider } from './components/ui/toaster';
import { ConfirmProvider } from './components/ui/confirm';

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

const signatureFontVars = [
  dancingScript.variable,
  caveat.variable,
  pacifico.variable,
  greatVibes.variable,
].join(' ');

export const metadata: Metadata = {
  title: `${BRAND.appName} — ${BRAND.tagline}`,
  description: 'HR & Sales management',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={signatureFontVars}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <AuthProvider>
          <ToasterProvider>
            <ConfirmProvider>{children}</ConfirmProvider>
          </ToasterProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
