'use client';

import { useRouter } from 'next/navigation';
import { Hexagon, LogOut } from 'lucide-react';
import { BRAND } from '../../lib/theme';
import type { DecodedAccessToken } from '../../lib/jwt';
import type { ModuleKey } from '../../lib/nav';
import { humanizeEnum } from '../../lib/status';
import { useAuth } from '../../lib/auth-context';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

/**
 * Top bar: brand (left) · module switcher (center, only if the user has both
 * modules) · user identity + logout (right). The switcher is a clear tabbed
 * control so it's never ambiguous which section you're in.
 */
export function AppTopBar({
  user,
  modules,
  activeModule,
  onSwitchModule,
}: {
  user: DecodedAccessToken;
  modules: ModuleKey[];
  activeModule: ModuleKey | undefined;
  onSwitchModule: (m: ModuleKey) => void;
}) {
  const { logout } = useAuth();
  const router = useRouter();

  const MODULE_LABEL: Record<ModuleKey, string> = { hr: 'HR', sales: 'Sales' };

  return (
    <header className="flex h-14 items-center gap-6 border-b bg-card px-4">
      <div className="flex items-center gap-2 font-semibold">
        <Hexagon className="h-5 w-5 text-primary" />
        <span>{BRAND.appName}</span>
      </div>

      {modules.length > 1 && (
        <div
          className="flex items-center gap-1 rounded-lg bg-muted p-1"
          role="tablist"
          aria-label="Module switcher"
        >
          {modules.map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={m === activeModule}
              onClick={() => onSwitchModule(m)}
              className={cn(
                'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                m === activeModule
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {MODULE_LABEL[m]}
            </button>
          ))}
        </div>
      )}

      <div className="ml-auto flex items-center gap-4">
        <div className="text-right text-sm leading-tight">
          <div className="font-medium">{user.email}</div>
          <div className="text-xs text-muted-foreground">
            {user.role ? humanizeEnum(user.role) : ''}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await logout();
            router.replace('/login');
          }}
        >
          <LogOut className="h-4 w-4" />
          Log out
        </Button>
      </div>
    </header>
  );
}
