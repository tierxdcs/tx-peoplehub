'use client';

import { useEffect, useState } from 'react';
import { ApiError } from '../../../../lib/api';
import {
  adjustStock,
  listStores,
  type StockBucket,
  type StoreLocation,
} from '../../../../lib/scm-inventory';
import { listItems, type Item } from '../../../../lib/scm-item-master';
import { useToast } from '../../../../components/ui/toaster';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { Field } from '../../../../components/ui/field';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { Button } from '../../../../components/ui/button';

const BUCKETS: StockBucket[] = ['ON_HAND', 'BLOCKED'];
const BUCKET_LABEL: Record<StockBucket, string> = {
  ON_HAND: 'On hand',
  BLOCKED: 'Blocked',
};

/**
 * Manual stock adjustment (§6). Item + store + bucket + signed quantity change
 * + reason; optional expected-receipt info. Backend enforces Store-role write.
 */
export function AdjustStockDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [stores, setStores] = useState<StoreLocation[]>([]);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    itemId: '',
    storeLocationId: '',
    bucket: 'ON_HAND' as StockBucket,
    quantityChange: '',
    reason: '',
    expectedReceiptQuantity: '',
    expectedReceiptDate: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listItems({ activeOnly: true }), listStores()])
      .then(([itemsRes, storesRes]) => {
        setItems(itemsRes);
        setStores(storesRes);
      })
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : 'Failed to load form data.',
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    if (!form.itemId || !form.storeLocationId) {
      setError('Select an item and a store location.');
      return;
    }
    if (form.quantityChange.trim() === '' || Number.isNaN(Number(form.quantityChange))) {
      setError('Enter a numeric quantity change.');
      return;
    }
    if (!form.reason.trim()) {
      setError('A reason is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await adjustStock({
        itemId: form.itemId,
        storeLocationId: form.storeLocationId,
        bucket: form.bucket,
        quantityChange: Number(form.quantityChange),
        reason: form.reason.trim(),
        expectedReceiptQuantity:
          form.expectedReceiptQuantity.trim() === ''
            ? undefined
            : Number(form.expectedReceiptQuantity),
        expectedReceiptDate: form.expectedReceiptDate || undefined,
      });
      toast.success('Stock adjusted.');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to adjust stock.');
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Adjust Stock</DialogTitle>
          <DialogDescription>
            Record a manual stock change. Use a negative quantity to decrease.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Item" required htmlFor="a-item">
            <Select
              id="a-item"
              value={form.itemId}
              onChange={(e) => set('itemId', e.target.value)}
              disabled={loading}
            >
              <option value="">Select item…</option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.itemCode} — {it.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Store location" required htmlFor="a-store">
            <Select
              id="a-store"
              value={form.storeLocationId}
              onChange={(e) => set('storeLocationId', e.target.value)}
              disabled={loading}
            >
              <option value="">Select store…</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Bucket" required htmlFor="a-bucket">
            <Select
              id="a-bucket"
              value={form.bucket}
              onChange={(e) => set('bucket', e.target.value)}
            >
              {BUCKETS.map((b) => (
                <option key={b} value={b}>
                  {BUCKET_LABEL[b]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Quantity change" required htmlFor="a-qty">
            <Input
              id="a-qty"
              type="number"
              step="0.0001"
              value={form.quantityChange}
              onChange={(e) => set('quantityChange', e.target.value)}
              placeholder="e.g. 100 or -25"
            />
          </Field>
          <Field label="Reason" required htmlFor="a-reason" className="sm:col-span-2">
            <Input
              id="a-reason"
              value={form.reason}
              onChange={(e) => set('reason', e.target.value)}
              placeholder="e.g. Goods receipt, cycle count correction"
            />
          </Field>
          <Field label="Expected receipt qty" htmlFor="a-erq">
            <Input
              id="a-erq"
              type="number"
              step="0.0001"
              min={0}
              value={form.expectedReceiptQuantity}
              onChange={(e) => set('expectedReceiptQuantity', e.target.value)}
            />
          </Field>
          <Field label="Expected receipt date" htmlFor="a-erd">
            <Input
              id="a-erd"
              type="date"
              value={form.expectedReceiptDate}
              onChange={(e) => set('expectedReceiptDate', e.target.value)}
            />
          </Field>
        </div>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || loading}>
            {submitting ? 'Saving…' : 'Adjust stock'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
