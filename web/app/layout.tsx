import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from './lib/auth-context';
import { BRAND } from './lib/theme';
import { ToasterProvider } from './components/ui/toaster';
import { ConfirmProvider } from './components/ui/confirm';

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
    <html lang="en">
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
