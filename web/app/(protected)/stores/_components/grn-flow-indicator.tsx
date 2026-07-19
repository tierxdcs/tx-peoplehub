import { Check, PackageCheck, ClipboardCheck, Boxes, Ban } from 'lucide-react';
import { cn } from '../../../lib/utils';
import {
  grnFlowStage,
  type GoodsReceiptNoteStatus,
  type GrnFlowStage,
} from '../../../lib/stores';

/**
 * "GRN to Inspection Flow" panel (mirrors the reference tool's flow strip):
 * Received → QC Inspection → Stock Updated. Shows where THIS GRN currently
 * sits, which steps are done, and what happens next — genuinely useful because
 * the receive→QC→stock pipeline is multi-step and "what's next" isn't obvious.
 */
const STEPS: { key: GrnFlowStage; label: string; icon: typeof Check; next: string }[] = [
  {
    key: 'RECEIVED',
    label: 'Goods Received',
    icon: PackageCheck,
    next: 'Enter received quantities, then send to QC.',
  },
  {
    key: 'QC',
    label: 'QC Inspection',
    icon: ClipboardCheck,
    next: 'A QC inspector records accepted/rejected quantities.',
  },
  {
    key: 'STOCK',
    label: 'Stock Updated',
    icon: Boxes,
    next: 'Only accepted quantity has entered stock.',
  },
];

export function GrnFlowIndicator({
  status,
  className,
}: {
  status: GoodsReceiptNoteStatus;
  className?: string;
}) {
  const { stage, completed } = grnFlowStage(status);

  if (stage === 'CANCELLED') {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive',
          className,
        )}
      >
        <Ban className="size-4 shrink-0" />
        <span>This GRN was cancelled — it never moved stock.</span>
      </div>
    );
  }

  const activeIdx = STEPS.findIndex((s) => s.key === stage);

  return (
    <div className={cn('rounded-lg border bg-muted/30 p-4', className)}>
      <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        GRN to Inspection Flow
      </div>
      <ol className="flex items-center">
        {STEPS.map((step, idx) => {
          const isDone = completed.includes(step.key) && idx < activeIdx;
          const isActive = idx === activeIdx;
          const Icon = step.icon;
          return (
            <li key={step.key} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-1 text-center">
                <div
                  className={cn(
                    'flex size-9 items-center justify-center rounded-full border-2 transition-colors',
                    isDone && 'border-success bg-success text-success-foreground',
                    isActive && 'border-primary bg-primary/10 text-primary',
                    !isDone && !isActive && 'border-muted-foreground/30 text-muted-foreground',
                  )}
                >
                  {isDone ? <Check className="size-4" /> : <Icon className="size-4" />}
                </div>
                <span
                  className={cn(
                    'max-w-[7rem] text-xs font-medium',
                    isActive ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {step.label}
                </span>
              </div>
              {idx < STEPS.length - 1 && (
                <div
                  className={cn(
                    'mx-2 h-0.5 flex-1 rounded',
                    idx < activeIdx ? 'bg-success' : 'bg-muted-foreground/20',
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
      {activeIdx >= 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Next: </span>
          {STEPS[activeIdx].next}
        </p>
      )}
    </div>
  );
}
