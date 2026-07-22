'use client';

import { ReactNode } from 'react';
import { Card, CardContent } from '../../../../components/ui/card';
import { Input } from '../../../../components/ui/input';
import { Textarea } from '../../../../components/ui/textarea';
import { Field } from '../../../../components/ui/field';
import { Button } from '../../../../components/ui/button';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Badge } from '../../../../components/ui/badge';
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
  children: ReactNode;
}) {
  return (
    <PageContainer className="max-w-3xl">
      <PageHeader title={title} description={description} />
      <Card>
        <CardContent className="space-y-5 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Voucher No.">
              <Input value="Auto" disabled />
            </Field>
            <Field label="Date" required>
              <Input type="date" value={date} onChange={(e) => onDateChange(e.target.value)} />
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

          <div className="flex items-center justify-between border-t pt-4">
            <Badge variant={balanced ? 'success' : 'destructive'} className={cn(!balanced && 'animate-pulse')}>
              {balanceLabel}
            </Badge>
            <div className="flex gap-2">
              <Button variant="outline" disabled={submitting} onClick={onSaveDraft}>
                Save as Draft
              </Button>
              <Button disabled={submitting || !balanced} onClick={onSubmitForApproval}>
                Submit for Approval
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
