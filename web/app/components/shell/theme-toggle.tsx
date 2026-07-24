'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Laptop, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

const choices = [
  { value: 'system', label: 'System', icon: Laptop },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const;

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
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

  const CurrentIcon = mounted && resolvedTheme === 'dark' ? Moon : Sun;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:size-9"
        aria-label="Choose color theme"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <CurrentIcon className="size-4" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Color theme"
          className="absolute right-0 z-50 mt-1 w-36 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {choices.map((choice) => {
            const Icon = choice.icon;
            const selected = mounted && theme === choice.value;
            return (
              <button
                key={choice.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent"
                onClick={() => {
                  setTheme(choice.value);
                  setOpen(false);
                }}
              >
                <Icon className="size-4 text-muted-foreground" />
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
