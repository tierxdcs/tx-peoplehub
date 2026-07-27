'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, IndianRupee } from 'lucide-react';
import { useNumberFormat } from '../../lib/number-format-context';

const choices = [
  { value: 'india', label: 'India (₹14,10,000.00)' },
  { value: 'international', label: 'International (₹1,410,000.00)' },
] as const;

/** Toggles ₹ digit-grouping between India (lakh/crore) and international
 * (thousands) style — cosmetic only, same currency and value either way. */
export function NumberFormatToggle() {
  const { style, setStyle } = useNumberFormat();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    function closeOnOutsideClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:size-9"
        aria-label="Choose number format"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <IndianRupee className="size-4" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Number format"
          className="absolute right-0 z-50 mt-1 w-56 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {choices.map((choice) => {
            const selected = mounted && style === choice.value;
            return (
              <button
                key={choice.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent"
                onClick={() => {
                  setStyle(choice.value);
                  setOpen(false);
                }}
              >
                <span>{choice.label}</span>
                {selected && <Check className="ml-auto size-4 text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
