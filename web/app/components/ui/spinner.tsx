import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

/** Simple spinning loader — used for preview "Preparing…" states etc. */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin', className)} />;
}
