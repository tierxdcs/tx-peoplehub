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
  SIGNAL_ROW_DIVIDER,
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
 * Two layouts, same behaviour:
 * - **Compact** (default) — one centred card. Fits vouchers whose whole entry
 *   is a handful of fields (Receipt, Payment, Contra, Journal, Purchase).
 * - **Wide** — passing `summary` switches to the Signal form exemplar: a
 *   `[1fr_316px]` grid whose sticky rail carries the running totals, actions
 *   promoted into the page header, and `sections` rendered as full-bleed cards
 *   between the details card and narration (for aligned line-item tables).
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
  /** Sticky-rail content (running totals). Presence enables the wide layout. */
  summary?: ReactNode;
  /** Wide layout only: full-bleed cards between details and narration. */
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

  if (summary) {
    return (
      <SignalPage>
        <SignalHeader
          title={title}
          description={description}
          actions={actions}
        />
        <div className="grid items-start gap-4 px-5 pb-7 pt-[18px] lg:px-7 xl:grid-cols-[1fr_316px]">
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
                <Textarea
                  rows={2}
                  value={narration}
                  onChange={(e) => onNarrationChange(e.target.value)}
                  placeholder="Optional note"
                />
              </div>
            </SCard>
          </div>

          <div className="flex flex-col gap-3.5 xl:sticky xl:top-[4.5rem]">
            {summary}
            <Badge
              variant={balanced ? 'success' : 'destructive'}
              className={cn(
                'w-full justify-center py-1.5',
                !balanced && 'animate-pulse',
              )}
            >
              {balanceLabel}
            </Badge>
          </div>
        </div>
      </SignalPage>
    );
  }

  return (
    <SignalPage>
      <SignalHeader title={title} description={description} />
      <div className="mx-auto w-full max-w-3xl space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
        <SCard className="space-y-5 px-5 py-[18px]">
          <div className="grid gap-4 sm:grid-cols-2">
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
          </div>

          {children}

          <Field label="Narration">
            <Textarea
              rows={2}
              value={narration}
              onChange={(e) => onNarrationChange(e.target.value)}
              placeholder="Optional note"
            />
          </Field>

          <div
            className={cn(
              'flex flex-wrap items-center justify-between gap-3 border-t pt-4',
              SIGNAL_ROW_DIVIDER,
            )}
          >
            <Badge
              variant={balanced ? 'success' : 'destructive'}
              className={cn(!balanced && 'animate-pulse')}
            >
              {balanceLabel}
            </Badge>
            <div className="flex gap-2">{actions}</div>
          </div>
        </SCard>
      </div>
    </SignalPage>
  );
}
