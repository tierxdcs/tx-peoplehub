'use client';

import * as React from 'react';
import {
  Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport,
} from './toast';

type ToastVariant = 'default' | 'success' | 'destructive';
interface ToastItem {
  id: number;
  title?: string;
  description?: string;
  variant: ToastVariant;
}
interface ToastOptions {
  title?: string;
  description?: string;
  variant?: ToastVariant;
}

interface ToastContextValue {
  toast: (opts: ToastOptions) => void;
  /** Convenience: success + error shortcuts used across pages. */
  success: (description: string, title?: string) => void;
  error: (description: string, title?: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

let counter = 0;

export function ToasterProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);

  const toast = React.useCallback((opts: ToastOptions) => {
    counter += 1;
    const id = counter;
    setItems((cur) => [
      ...cur,
      { id, title: opts.title, description: opts.description, variant: opts.variant ?? 'default' },
    ]);
  }, []);

  const value = React.useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (description, title) => toast({ description, title: title ?? 'Success', variant: 'success' }),
      error: (description, title) => toast({ description, title: title ?? 'Something went wrong', variant: 'destructive' }),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={value}>
      <ToastProvider swipeDirection="right">
        {children}
        {items.map((t) => (
          <Toast
            key={t.id}
            variant={t.variant}
            onOpenChange={(open) => {
              if (!open) setItems((cur) => cur.filter((x) => x.id !== t.id));
            }}
          >
            <div className="grid gap-0.5">
              {t.title && <ToastTitle>{t.title}</ToastTitle>}
              {t.description && <ToastDescription>{t.description}</ToastDescription>}
            </div>
            <ToastClose />
          </Toast>
        ))}
        <ToastViewport />
      </ToastProvider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToasterProvider');
  return ctx;
}
