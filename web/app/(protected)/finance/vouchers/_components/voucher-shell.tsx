'use client';

import { ReactNode } from 'react';
import { Input } from '../../../../components/ui/input';
import { Textarea } from '../../../../components/ui/textarea';
import { Field } from '../../../../components/ui/field';
import { Badge } from '../../../../components/ui/badge';
import {
  SCard,
  SCardTitle,
  SIGNAL_BTN_OUTLINE,
  SIGNAL_BTN_PRIMARY,
  SignalHeader,
  SignalPage,
} from '../../../../components/ui/signal';
import { cn } from '../../../../lib/utils';

/**
 * Shared shell for every Tally-style voucher-entry screen: type/date header,
 * a slot for the type-specific party + line fields, narration, a live
 * balance indicator, and Save Draft / Submit actions. Each voucher type
 * (Sales, Purchase, Receipt, Payment, Journal, Contra) supplies its own line
 * fields as `children` and its own balanced-check as `balanced` — the shell
 * only renders the indicator and gates Submit on it (an unbalanced voucher
 * cannot be saved, matching Tally). "Voucher number" shows "Auto" because
 * every backend numbering sequence allocates on create, not before.
 *
 * All voucher types intentionally share the same wide form layout so Finance
 * users do not have to relearn action placement, summaries, or narration.
 */
export function VoucherShell({
  title,
  description,
  date,
  onDateChange,
  narration,
  onNarrationChange,
  balanced,
  balanceLabel,
  submitting,
  onSaveDraft,
  onSubmitForApproval,
  summary,
  sections,
  children,
}: {
  title: string;
  description: string;
  date: string;
  onDateChange: (v: string) => void;
  narration: string;
  onNarrationChange: (v: string) => void;
  balanced: boolean;
  balanceLabel: string;
  submitting: boolean;
  onSaveDraft: () => void;
  onSubmitForApproval: () => void;
  /** Sticky-rail content (running totals). */
  summary?: ReactNode;
  /** Full-bleed cards between details and narration. */
  sections?: ReactNode;
  children: ReactNode;
}) {
  const actions = (
    <>
      <button
        type="button"
        className={cn(
          SIGNAL_BTN_OUTLINE,
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
        disabled={submitting}
        onClick={onSaveDraft}
      >
        Save as Draft
      </button>
      <button
        type="button"
        className={cn(SIGNAL_BTN_PRIMARY)}
        disabled={submitting || !balanced}
        onClick={onSubmitForApproval}
      >
        Submit for Approval
      </button>
    </>
  );

  return (
    <SignalPage>
      <SignalHeader title={title} description={description} actions={actions} />
      <div className="grid items-start gap-4 px-5 pb-7 pt-[18px] lg:px-7 xl:grid-cols-[minmax(0,1fr)_316px]">
        <div className="flex min-w-0 flex-col gap-3.5">
          <SCard className="px-5 py-[18px]">
            <SCardTitle title="Voucher details" />
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Field label="Voucher No.">
                <Input value="Auto" disabled />
              </Field>
              <Field label="Date" required>
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => onDateChange(e.target.value)}
                />
              </Field>
              {children}
            </div>
          </SCard>

          {sections}

          <SCard className="px-5 py-[18px]">
            <SCardTitle title="Narration" />
            <div className="mt-4">
              <Textarea rows={2} value={narration} onChange={(e) => onNarrationChange(e.target.value)} placeholder="Optional note" />
            </div>
          </SCard>
        </div>

        <div className="flex flex-col gap-3.5 xl:sticky xl:top-[4.5rem]">
          {summary ?? (
            <VoucherSummary
              rows={[{ label: 'Entry status', value: balanced ? 'Ready to submit' : 'Incomplete' }]}
              totalLabel="Voucher"
              total={balanced ? 'Balanced' : 'Pending'}
            />
          )}
          <Badge
            variant={balanced ? 'success' : 'destructive'}
            className={cn('w-full justify-center py-1.5', !balanced && 'animate-pulse')}
          >
            {balanceLabel}
          </Badge>
        </div>
      </div>
    </SignalPage>
  );
}

export function VoucherSummary({
  title = 'Voucher summary',
  rows,
  totalLabel = 'Total',
  total,
}: {
  title?: string;
  rows: Array<{ label: string; value: ReactNode }>;
  totalLabel?: string;
  total: ReactNode;
}) {
  return (
    <SCard className="px-5 py-[18px]">
      <SCardTitle title={title} />
      <div className="mt-4 divide-y divide-border">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start justify-between gap-4 py-3 text-sm first:pt-0">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="text-right font-medium tabular-nums">{row.value}</span>
          </div>
        ))}
        <div className="flex items-end justify-between gap-4 pt-4">
          <span className="font-semibold">{totalLabel}</span>
          <span className="text-right text-2xl font-semibold tabular-nums">{total}</span>
        </div>
      </div>
    </SCard>
  );
}
