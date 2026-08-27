'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../../../../lib/api';
import { formatINR } from '../../../../../lib/sales';
import { useNumberFormat } from '../../../../../lib/number-format-context';
import { Input } from '../../../../../components/ui/input';
import { Field } from '../../../../../components/ui/field';
import { Button } from '../../../../../components/ui/button';
import { useToast } from '../../../../../components/ui/toaster';
import { VoucherShell, VoucherSummary } from '../../_components/voucher-shell';
import { PartyPicker } from '../../_components/party-picker';

interface Account {
  id: string;
  code: string;
  name: string;
}
interface Line {
  accountId: string;
  debit: string;
  credit: string;
}

const emptyLine = (): Line => ({ accountId: '', debit: '', credit: '' });

/**
 * Journal Voucher entry — a general N-line Dr/Cr grid over the SAME manual
 * journal create path (POST /finance/journals). Unlike the terse two-line
 * inline form on the register page, this supports any number of lines with a
 * live running-total balance indicator; the backend's own validateLines still
 * enforces balance server-side regardless.
 */
export default function NewJournalVoucherPage() {
  const router = useRouter();
  const toast = useToast();
  const { style: numberFormatStyle } = useNumberFormat();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine()]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch<Account[]>('/finance/accounts')
      .then(setAccounts)
      .catch(() => toast.error('Failed to load ledger accounts'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const hasContent = lines.every((l) => l.accountId) && lines.length >= 2;
  const balanced = hasContent && totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.005;

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }
  function removeLine(index: number) {
    setLines((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== index) : prev));
  }

  async function create(submit: boolean) {
    if (!balanced) {
      toast.error('Debits and credits must balance before saving.');
      return;
    }
    setSubmitting(true);
    try {
      const journal = await apiFetch<{ id: string }>('/finance/journals', {
        method: 'POST',
        body: JSON.stringify({
          entryDate: date,
          description: narration || 'Journal voucher',
          lines: lines.map((l) => ({
            accountId: l.accountId,
            debit: Number(l.debit) || 0,
            credit: Number(l.credit) || 0,
          })),
        }),
      });
      if (submit) {
        await apiFetch(`/finance/journals/${journal.id}/submit`, { method: 'POST' });
      }
      toast.success(submit ? 'Journal voucher submitted for approval' : 'Journal voucher saved as draft');
      router.push('/finance/journals');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to create journal voucher');
    } finally {
      setSubmitting(false);
    }
  }

  const accountOptions = accounts.map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }));

  return (
    <VoucherShell
      title="Journal Voucher"
      description="Creates a manual journal entry — any number of balanced Dr/Cr lines"
      date={date}
      onDateChange={setDate}
      narration={narration}
      onNarrationChange={setNarration}
      balanced={balanced}
      balanceLabel={
        balanced
          ? `Balanced — Dr ${formatINR(totalDebit, numberFormatStyle)} = Cr ${formatINR(totalCredit, numberFormatStyle)}`
          : `Unbalanced — Dr ${formatINR(totalDebit, numberFormatStyle)} vs Cr ${formatINR(totalCredit, numberFormatStyle)}`
      }
      submitting={submitting}
      onSaveDraft={() => void create(false)}
      onSubmitForApproval={() => void create(true)}
      summary={
        <VoucherSummary
          title="Journal summary"
          rows={[
            { label: 'Debit total', value: formatINR(totalDebit, numberFormatStyle) },
            { label: 'Credit total', value: formatINR(totalCredit, numberFormatStyle) },
          ]}
          totalLabel="Difference"
          total={formatINR(Math.abs(totalDebit - totalCredit), numberFormatStyle)}
        />
      }
    >
      <div className="space-y-3 md:col-span-2">
        {lines.map((line, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px_120px_auto] sm:items-end">
            <Field label={i === 0 ? 'Ledger Account' : ''}>
              <PartyPicker
                options={accountOptions}
                value={line.accountId}
                onChange={(id) => updateLine(i, { accountId: id })}
                placeholder="Search accounts…"
              />
            </Field>
            <Field label={i === 0 ? 'Debit' : ''}>
              <Input
                type="number"
                step="0.01"
                value={line.debit}
                onChange={(e) => updateLine(i, { debit: e.target.value, credit: e.target.value ? '' : line.credit })}
              />
            </Field>
            <Field label={i === 0 ? 'Credit' : ''}>
              <Input
                type="number"
                step="0.01"
                value={line.credit}
                onChange={(e) => updateLine(i, { credit: e.target.value, debit: e.target.value ? '' : line.debit })}
              />
            </Field>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={lines.length <= 2}
              onClick={() => removeLine(i)}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={addLine}>
          + Add line
        </Button>
      </div>
    </VoucherShell>
  );
}
