'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * A small "ⓘ" button that reveals a short explanation on click. Self-contained
 * (no popover dependency): a transparent click-away backdrop closes it, and the
 * panel is rendered with FIXED positioning computed from the trigger's rect so
 * it is never clipped by a scrollable container (e.g. a modal with
 * overflow-y-auto). Opens below the trigger, flipping above when there isn't
 * room, and is clamped to stay within the viewport horizontally.
 */
export function InfoHint({
  label,
  text,
  className,
}: {
  /** What the hint describes — used for the accessible button label. */
  label: string;
  text: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [coords, setCoords] = useState<{
    left: number;
    top: number;
    placement: 'below' | 'above';
  } | null>(null);

  const PANEL_WIDTH = 256; // w-64
  const GAP = 8;

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;

    function position() {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const margin = 8;
      // Horizontally: align to the trigger, then clamp into the viewport.
      let left = rect.left;
      const maxLeft = window.innerWidth - PANEL_WIDTH - margin;
      if (left > maxLeft) left = Math.max(margin, maxLeft);
      if (left < margin) left = margin;

      // Vertically: below by default; flip above if it would overflow.
      const spaceBelow = window.innerHeight - rect.bottom;
      const placement: 'below' | 'above' =
        spaceBelow < 160 && rect.top > spaceBelow ? 'above' : 'below';
      const top =
        placement === 'below' ? rect.bottom + GAP : rect.top - GAP;
      setCoords({ left, top, placement });
    }

    position();
    window.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
    return () => {
      window.removeEventListener('scroll', position, true);
      window.removeEventListener('resize', position);
    };
  }, [open]);

  return (
    <span className={cn('inline-flex', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`What does "${label}" mean?`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info className="size-3.5" />
      </button>

      {open && coords && (
        <>
          {/* Transparent click-away backdrop. */}
          <span
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-label={`${label} — explanation`}
            style={{
              left: coords.left,
              top: coords.top,
              width: PANEL_WIDTH,
              transform:
                coords.placement === 'above'
                  ? 'translateY(-100%)'
                  : undefined,
            }}
            className="fixed z-50 max-w-[calc(100vw-1rem)] rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg"
          >
            <p className="mb-1 text-sm font-medium">{label}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {text}
            </p>
          </div>
        </>
      )}
    </span>
  );
}
