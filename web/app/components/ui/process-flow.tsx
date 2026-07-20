import { Check, Ban, Circle } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Reusable horizontal process-flow strip (generalized from the GRN flow
 * indicator). Renders numbered step nodes — done (green check), current
 * (primary ring), upcoming (muted) — with connectors, an optional title, and an
 * optional "Next:" hint. Colour is always paired with the step label + a check/
 * dot glyph, so state is never conveyed by colour alone (accessibility).
 *
 * Callers derive `currentStage` from the record's ACTUAL status — there is no
 * stored "current step". Pass a terminal `cancelled` banner for dead records.
 */
export interface ProcessFlowStep {
  key: string;
  label: string;
  /** Optional one-line "what happens next" shown when this step is active. */
  next?: string;
  /** Marks a gate (approval / QC / sign-off) — badged so blockers are obvious. */
  gate?: boolean;
}

export function ProcessFlow({
  title,
  steps,
  currentStage,
  cancelled,
  cancelledLabel = 'This record was cancelled.',
  className,
}: {
  title?: string;
  steps: ProcessFlowStep[];
  /** The active step key. If it matches no step, all render as upcoming. */
  currentStage: string | null;
  cancelled?: boolean;
  cancelledLabel?: string;
  className?: string;
}) {
  if (cancelled) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive',
          className,
        )}
      >
        <Ban className="size-4 shrink-0" />
        <span>{cancelledLabel}</span>
      </div>
    );
  }

  const activeIdx = steps.findIndex((s) => s.key === currentStage);

  return (
    <div className={cn('rounded-lg border bg-muted/30 p-4', className)}>
      {title && (
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </div>
      )}
      <ol className="flex items-start">
        {steps.map((step, idx) => {
          const isDone = activeIdx >= 0 && idx < activeIdx;
          const isActive = idx === activeIdx;
          return (
            <li key={step.key} className="flex flex-1 items-start last:flex-none">
              <div className="flex flex-col items-center gap-1 text-center">
                <div
                  className={cn(
                    'flex size-9 items-center justify-center rounded-full border-2 transition-colors',
                    isDone && 'border-success bg-success text-success-foreground',
                    isActive && 'border-primary bg-primary/10 text-primary',
                    !isDone && !isActive && 'border-muted-foreground/30 text-muted-foreground',
                  )}
                >
                  {isDone ? (
                    <Check className="size-4" />
                  ) : (
                    <span className="text-xs font-semibold">{idx + 1}</span>
                  )}
                </div>
                <span
                  className={cn(
                    'max-w-[8rem] text-xs font-medium',
                    isActive ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {step.label}
                </span>
                {step.gate && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                    <Circle className="size-2 fill-current" /> Gate
                  </span>
                )}
              </div>
              {idx < steps.length - 1 && (
                <div
                  className={cn(
                    'mx-2 mt-4 h-0.5 flex-1 rounded',
                    idx < activeIdx ? 'bg-success' : 'bg-muted-foreground/20',
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
      {activeIdx >= 0 && steps[activeIdx].next && (
        <p className="mt-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Next: </span>
          {steps[activeIdx].next}
        </p>
      )}
    </div>
  );
}
