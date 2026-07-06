import * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * Native <select> styled to match Input. A native control (rather than Radix
 * Select) is deliberate for this desktop-first internal tool: no popper/portal
 * complexity, keyboard + form behavior for free. Use <option> children.
 */
const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive',
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = 'Select';
export { Select };
