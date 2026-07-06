import * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * Centered icon + message empty state — the single "nothing here yet" block
 * used across the app (leave/attendance history, approval queues, etc.).
 * `tone` sets the icon colour: 'neutral' for informational "no data yet",
 * 'positive' for good-news states like "no pending approvals — all caught up".
 * Pass a lucide icon component as `icon`.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  tone = 'neutral',
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  tone?: 'neutral' | 'positive';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 py-12 text-center',
        className,
      )}
    >
      {Icon && (
        <Icon
          className={cn(
            'mb-3 size-10',
            tone === 'positive' ? 'text-success' : 'text-muted-foreground',
          )}
        />
      )}
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}
