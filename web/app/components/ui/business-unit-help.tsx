'use client';

import { useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { BusinessUnit } from '../../lib/types';
import { cn } from '../../lib/utils';

/**
 * A small "?" toggle that reveals a reference panel explaining what each
 * business unit covers — so sales can pick the right one without guessing.
 * Self-contained (no popover dependency): clicking toggles an inline panel that
 * lists every active BU with its colour dot, name, and seeded description.
 */
export function BusinessUnitHelp({
  businessUnits,
  className,
}: {
  businessUnits: BusinessUnit[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <span className={cn('relative inline-flex', className)}>
      <button
        type="button"
        aria-label="What do the business units mean?"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        <HelpCircle className="size-3.5" />
        Which one?
      </button>

      {open && (
        <>
          {/* Click-away backdrop (transparent) so the panel closes on outside click. */}
          <span
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          {/* Anchored to the trigger's RIGHT edge and opening UPWARD: the field
              sits low and near the right edge of a scrollable modal, so opening
              down/right gets clipped. Width is capped to the viewport. */}
          <div
            role="dialog"
            aria-label="Business unit guide"
            className="absolute bottom-7 right-0 z-50 max-h-[60vh] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border bg-background p-3 shadow-lg"
          >
            <p className="mb-2 text-xs text-muted-foreground">
              Pick the business unit this enquiry belongs to:
            </p>
            <ul className="space-y-2">
              {businessUnits.map((unit) => (
                <li key={unit.id} className="flex gap-2">
                  <span
                    className="mt-1 size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: unit.colorHex || '#64748B' }}
                  />
                  <div>
                    <div className="text-sm font-medium">{unit.name}</div>
                    {unit.description && (
                      <div className="text-xs text-muted-foreground">
                        {unit.description}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </span>
  );
}
