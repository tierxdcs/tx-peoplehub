'use client';

import * as React from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from './alert-dialog';
import { buttonVariants } from './button';
import { cn } from '../../lib/utils';

interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (deactivate/reject/lock/cancel). */
  destructive?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = React.createContext<ConfirmFn | null>(null);

/**
 * Promise-based confirmation to replace window.confirm() everywhere. Call
 * `const confirm = useConfirm()` then `if (await confirm({...})) { ... }`.
 * Renders a styled AlertDialog, so destructive/serious actions read as
 * intentional — and `destructive` turns the confirm button red.
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = React.useState<ConfirmOptions | null>(null);
  const resolver = React.useRef<((v: boolean) => void) | null>(null);

  const confirm = React.useCallback<ConfirmFn>((options) => {
    setOpts(options);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = (result: boolean) => {
    resolver.current?.(result);
    resolver.current = null;
    setOpts(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog
        open={opts !== null}
        onOpenChange={(open) => {
          if (!open) settle(false);
        }}
      >
        {opts && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{opts.title}</AlertDialogTitle>
              {opts.description && (
                <AlertDialogDescription>{opts.description}</AlertDialogDescription>
              )}
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => settle(false)}>
                {opts.cancelLabel ?? 'Cancel'}
              </AlertDialogCancel>
              <AlertDialogAction
                className={
                  opts.destructive
                    ? cn(buttonVariants({ variant: 'destructive' }))
                    : undefined
                }
                onClick={() => settle(true)}
              >
                {opts.confirmLabel ?? 'Confirm'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}
