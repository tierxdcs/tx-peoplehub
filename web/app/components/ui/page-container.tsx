import * as React from 'react';
import { cn } from '../../lib/utils';

/** Shared page content wrapper — consistent max-width + padding everywhere. */
export function PageContainer({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn('mx-auto w-full max-w-6xl', className)}>{children}</div>;
}
