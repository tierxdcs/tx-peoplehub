'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import {
  useNotifications,
  type AppNotification,
} from '../../lib/use-notifications';
import { cn } from '../../lib/utils';

/** Compact relative timestamp, e.g. "just now", "5m", "3h", "2d". */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Top-bar notification bell (personal activity — shown to everyone, unlike the
 * approval-count badges). Badge polls unread-count; opening loads the list;
 * clicking an item marks it read and navigates to the related card.
 */
export function NotificationBell() {
  const router = useRouter();
  const { unreadCount, items, loadList, markRead, markAllRead } =
    useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Load the list when the dropdown opens.
  useEffect(() => {
    if (open) void loadList();
  }, [open, loadList]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function onClickItem(n: AppNotification) {
    setOpen(false);
    if (!n.isRead) void markRead(n.id);
    // Route by type — three distinct notification "shapes" deep-link to three
    // different surfaces, each keyed off its own related-id (the others are
    // null). Kanban → relatedCardId, Vendor → relatedVendorId, Supplier →
    // relatedSupplierId. Each is its own explicit branch; the Supplier case
    // does NOT piggyback on Vendor's handling.
    if (n.type === 'VENDOR_QUESTIONNAIRE_SUBMITTED' && n.relatedVendorId) {
      router.push(`/scm/vendors/${n.relatedVendorId}`);
    } else if (
      n.type === 'SUPPLIER_QUESTIONNAIRE_SUBMITTED' &&
      n.relatedSupplierId
    ) {
      router.push(`/scm/suppliers/${n.relatedSupplierId}`);
    } else if (n.relatedCardId) {
      // Deep-link to the card; the board UI resolves it (frontend board pass).
      router.push(`/kanban/cards/${n.relatedCardId}`);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Notifications"
        className="relative rounded-md p-2 text-foreground/70 hover:bg-accent hover:text-foreground"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="fixed inset-x-3 top-14 z-50 max-h-[calc(100dvh-4.5rem)] overflow-hidden rounded-lg border bg-popover shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-1 sm:w-80 sm:max-h-none sm:rounded-md sm:shadow-md"
        >
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            {items.some((n) => !n.isRead) && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="min-h-11 px-2 text-xs text-primary hover:underline sm:min-h-0 sm:px-0"
              >
                Mark all as read
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No notifications yet.
            </p>
          ) : (
            <ul className="max-h-[calc(100dvh-8rem)] divide-y overflow-y-auto sm:max-h-80">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onClickItem(n)}
                    className={cn(
                      'flex min-h-14 w-full items-start gap-2 px-3 py-3 text-left hover:bg-accent sm:min-h-0 sm:py-2',
                      !n.isRead && 'bg-primary/5',
                    )}
                  >
                    {!n.isRead && (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    )}
                    <span className={cn('min-w-0 flex-1', n.isRead && 'pl-4')}>
                      <span className="block text-sm">{n.message}</span>
                      <span className="block text-xs text-muted-foreground">
                        {relativeTime(n.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
