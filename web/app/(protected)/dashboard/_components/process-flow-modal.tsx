'use client';

import { Workflow, ShieldCheck } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '../../../components/ui/dialog';
import { Card, CardContent } from '../../../components/ui/card';
import type { VerticalFlow } from '../../../lib/process-flows';

/**
 * "How your work flows" card → opens a non-blocking modal (spec §6) with the
 * end-to-end process for the user's vertical. A static overview, not tied to any
 * one record; gate steps (approvals / QC / sign-offs) are called out with a
 * shield badge so people can see where work waits on someone else.
 */
export function ProcessFlowModal({ flow }: { flow: VerticalFlow }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Card className="cursor-pointer transition-colors hover:bg-accent/40">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Workflow className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="font-medium">How your work flows</p>
              <p className="truncate text-sm text-muted-foreground">
                See the end-to-end process for {flow.title}
              </p>
            </div>
          </CardContent>
        </Card>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{flow.title}</DialogTitle>
          <DialogDescription>
            How a piece of work moves through your vertical, end to end. Steps
            marked as a gate wait on an approval, quality check, or sign-off.
          </DialogDescription>
        </DialogHeader>
        <ol className="mt-2 space-y-0">
          {flow.steps.map((step, idx) => (
            <li key={step.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-primary/30 text-xs font-semibold text-primary">
                  {idx + 1}
                </div>
                {idx < flow.steps.length - 1 && (
                  <div className="my-1 w-0.5 flex-1 bg-border" />
                )}
              </div>
              <div className="pb-5">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{step.label}</span>
                  {step.gate && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">
                      <ShieldCheck className="size-3" /> Gate
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}
