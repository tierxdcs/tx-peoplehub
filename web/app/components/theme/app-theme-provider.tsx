'use client';

import { ThemeProvider } from 'next-themes';
import { usePathname } from 'next/navigation';

/**
 * The authenticated application follows the user's light/dark/system choice.
 * Public external links are deliberately forced to light because they are
 * customer/vendor-facing documents and forms.
 */
export function AppThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const forcedTheme = pathname.startsWith('/public/') ? 'light' : undefined;

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      enableColorScheme
      storageKey="phaze-erp-theme"
      forcedTheme={forcedTheme}
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}
