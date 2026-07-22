'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../../../../lib/api';
import { Input } from '../../../../../components/ui/input';
import { Field } from '../../../../../components/ui/field';
import { useToast } from '../../../../../components/ui/toaster';
import { VoucherShell } from '../../_components/voucher-shell';
import { PartyPicker } from '../../_components/party-picker';

interface Account {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
}

/** Mirrors the backend's BANK_OR_CASH_GROUP_CODES (contra.service.ts) — a UX
 * pre-filter only. The server is the real enforcement; this just keeps a
 * non-bank/cash ledger from being offered in the first place. */
const BANK_OR_CASH_GROUP_CODES = ['GRP-BANK', 'GRP-CASH'];

/**
 * Contra Voucher entry — the one genuinely new voucher type. Both legs are
 * restricted to bank/cash-eligible ledgers (client-side pre-filter here;
 * enforced authoritatively by the backend regardless). Posts through
 * postJournalTx on approval, same as every other voucher.
 */
export default function NewContraVoucherPage() {
  const router = useRouter();
  const toast = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [narration, setNarration] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch<Account[]>('/finance/accounts')
      .then(setAccounts)
      .catch(() => toast.error('Failed to load ledger accounts'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // parentId holds a group's id, not its code — resolve via the ids of the
  // bank/cash group rows themselves (identified by their GRP-* codes).
  const bankOrCashGroupIds = new Set(
    accounts.filter((a) => BANK_OR_CASH_GROUP_CODES.includes(a.code)).map((g) => g.id),
  );
  const eligibleAccounts = accounts.filter((a) => a.parentId && bankOrCashGroupIds.has(a.parentId));

  const balanced = !!fromId && !!toId && fromId !== toId && Number(amount) > 0;

  async function create(submit: boolean) {
    if (!balanced) {
      toast.error('Choose two different bank/cash ledgers and an amount before saving.');
      return;
    }
    setSubmitting(true);
    try {
      const voucher = await apiFetch<{ id: string }>('/finance/contra', {
        method: 'POST',
        body: JSON.stringify({
          voucherDate: date,
          fromLedgerAccountId: fromId,
          toLedgerAccountId: toId,
          amount: Number(amount),
          narration: narration || undefined,
        }),
      });
      if (submit) {
        await apiFetch(`/finance/contra/${voucher.id}/submit`, { method: 'POST' });
      }
      toast.success(submit ? 'Contra voucher submitted for approval' : 'Contra voucher saved as draft');
      router.push('/finance/contra');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to create contra voucher');
    } finally {
      setSubmitting(false);
    }
  }

  const options = eligibleAccounts.map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }));

  return (
    <VoucherShell
      title="Contra Voucher"
      description="Bank-to-cash, cash-to-bank, or inter-bank transfer — both legs must be bank/cash ledgers"
      date={date}
      onDateChange={setDate}
      narration={narration}
      onNarrationChange={setNarration}
      balanced={balanced}
      balanceLabel={balanced ? `Transfer ₹${Number(amount).toFixed(2)}` : 'Choose two different bank/cash ledgers'}
      submitting={submitting}
      onSaveDraft={() => void create(false)}
      onSubmitForApproval={() => void create(true)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From Ledger" required>
          <PartyPicker options={options} value={fromId} onChange={setFromId} placeholder="Search bank/cash ledgers…" />
        </Field>
        <Field label="To Ledger" required>
          <PartyPicker options={options} value={toId} onChange={setToId} placeholder="Search bank/cash ledgers…" />
        </Field>
        <Field label="Amount" required>
          <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
      {eligibleAccounts.length === 0 && accounts.length > 0 && (
        <p className="text-sm text-muted-foreground">
          No bank/cash ledgers found. Add one under the Bank Accounts or Cash-in-Hand group on the{' '}
          <a className="underline" href="/finance/accounts">
            Ledgers
          </a>{' '}
          page first.
        </p>
      )}
    </VoucherShell>
  );
}
