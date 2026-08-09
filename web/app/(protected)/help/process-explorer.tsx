'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, BookOpen, ShieldCheck, Users } from 'lucide-react';
import { VERTICAL_FLOWS } from '../../lib/process-flows';
import { ProcessFlow } from '../../components/ui/process-flow';
import { Card, CardContent } from '../../components/ui/card';
import { cn } from '../../lib/utils';

export function HelpProcessExplorer() {
  const [selected, setSelected] = useState(VERTICAL_FLOWS[0].codes[0]);
  useEffect(() => {
    const code = window.location.hash.replace('#', '').toUpperCase();
    if (VERTICAL_FLOWS.some((flow) => flow.codes.includes(code)))
      setSelected(code);
  }, []);
  const flow = useMemo(
    () =>
      VERTICAL_FLOWS.find((item) => item.codes.includes(selected)) ??
      VERTICAL_FLOWS[0],
    [selected],
  );

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-card p-5 sm:p-7">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-primary p-3 text-primary-foreground">
            <BookOpen className="size-6" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">
              Choose a process to explore
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Start with your own vertical, then explore connected teams to
              understand every handoff.
            </p>
          </div>
        </div>
        <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
          {VERTICAL_FLOWS.map((item) => (
            <button
              key={item.codes[0]}
              id={item.codes[0]}
              onClick={() => setSelected(item.codes[0])}
              className={cn(
                'whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition',
                item.codes.includes(selected)
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'bg-card hover:border-primary/50 hover:bg-accent',
              )}
            >
              {item.title.split(' — ')[0]}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="space-y-6 p-5 sm:p-7">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              End-to-end process
            </p>
            <h2 className="mt-1 text-2xl font-semibold">{flow.title}</h2>
            <p className="mt-2 max-w-3xl text-muted-foreground">
              {flow.summary}
            </p>
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="size-4" /> {flow.participants}
            </p>
          </div>
          <div className="overflow-x-auto pb-2">
            <div className="min-w-[720px]">
              <ProcessFlow
                steps={flow.steps.map(({ key, label, gate }) => ({
                  key,
                  label,
                  gate,
                }))}
                currentStage={null}
              />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {flow.steps.map((step, index) => (
              <details
                key={step.key}
                className="group rounded-xl border bg-card open:border-primary/30 open:bg-primary/[0.03]"
              >
                <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                    {index + 1}
                  </span>
                  <span className="flex-1 font-medium">{step.label}</span>
                  {step.gate && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-1 text-xs text-warning">
                      <ShieldCheck className="size-3" /> Gate
                    </span>
                  )}
                  <span className="text-muted-foreground transition group-open:rotate-45">
                    +
                  </span>
                </summary>
                <div className="border-t px-4 py-4 text-sm text-muted-foreground">
                  <p>{step.detail}</p>
                  {step.href && (
                    <Link
                      className="mt-3 inline-flex h-8 items-center gap-2 rounded-md border bg-background px-3 text-xs font-medium text-foreground hover:bg-accent"
                      href={step.href}
                    >
                      Open this area <ArrowUpRight className="size-3.5" />
                    </Link>
                  )}
                </div>
              </details>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
