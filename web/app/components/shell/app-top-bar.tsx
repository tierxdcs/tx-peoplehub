'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronDown,
  Hexagon,
  KeyRound,
  LogOut,
  Menu,
  User,
} from 'lucide-react';
import { BRAND } from '../../lib/theme';
import type { DecodedAccessToken } from '../../lib/jwt';
import type { ModuleKey } from '../../lib/nav';
import { humanizeEnum } from '../../lib/status';
import { useAuth } from '../../lib/auth-context';
import { Avatar } from '../ui/avatar';
import { cn } from '../../lib/utils';
import { ResetPasswordDialog } from './reset-password-dialog';
import { NotificationBell } from './notification-bell';

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
  onOpenNavigation,
}: {
  user: DecodedAccessToken;
  modules: ModuleKey[];
  activeModule: ModuleKey | undefined;
  onSwitchModule: (m: ModuleKey) => void;
  onOpenNavigation: () => void;
}) {
  const { logout } = useAuth();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the profile menu on any outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const MODULE_LABEL: Record<ModuleKey, string> = { hr: 'HR', sales: 'Sales' };

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-card px-3 md:gap-6 md:px-4">
      <button
        type="button"
        onClick={onOpenNavigation}
        className="flex size-11 items-center justify-center rounded-md hover:bg-accent md:hidden"
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </button>
      <div className="flex items-center gap-2 font-semibold">
        <Hexagon className="h-5 w-5 text-primary" />
        <span className="hidden sm:inline">{BRAND.appName}</span>
      </div>

      {modules.length > 1 && (
        <div
          className="hidden items-center gap-1 rounded-lg bg-muted p-1 sm:flex"
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

      <div className="ml-auto flex items-center gap-1">
        <NotificationBell />

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
          >
            <Avatar name={user.email} />
            <span className="hidden text-left leading-tight lg:inline">
              <span className="block font-medium">{user.email}</span>
              <span className="block text-xs text-muted-foreground">
                {user.role ? humanizeEnum(user.role) : ''}
              </span>
            </span>
            <ChevronDown className="hidden h-4 w-4 text-muted-foreground sm:block" />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-50 mt-1 w-52 overflow-hidden rounded-md border bg-popover shadow-md"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  router.push('/profile');
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <User className="h-4 w-4 text-muted-foreground" /> My Profile
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setResetOpen(true);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <KeyRound className="h-4 w-4 text-muted-foreground" /> Reset
                password
              </button>
              <div className="border-t" />
              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  setMenuOpen(false);
                  await logout();
                  router.replace('/login');
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-destructive hover:bg-accent"
              >
                <LogOut className="h-4 w-4" /> Log out
              </button>
            </div>
          )}
        </div>
      </div>

      {resetOpen && <ResetPasswordDialog onClose={() => setResetOpen(false)} />}
    </header>
  );
}
