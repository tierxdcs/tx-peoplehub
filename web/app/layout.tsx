import type { Metadata } from 'next';
import { AuthProvider } from './lib/auth-context';

export const metadata: Metadata = {
  title: 'tx-peoplehub',
  description: 'Employee & Access Management — thin UI',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0 }}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
