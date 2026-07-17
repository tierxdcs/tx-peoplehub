'use client';

import { useState } from 'react';
import { ApiError } from '../../../../lib/api';
import {
  createItem,
  ITEM_TYPE_LABEL,
  updateItem,
  type CreateItemInput,
  type Item,
  type ItemType,
} from '../../../../lib/scm-item-master';
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
import { Textarea } from '../../../../components/ui/textarea';
import { Button } from '../../../../components/ui/button';

const TYPES: ItemType[] = [
  'RAW_MATERIAL',
  'COMPONENT',
  'SUBASSEMBLY',
  'FINISHED_GOOD',
  'CONSUMABLE',
];

/** Create or edit an item. itemCode is immutable once created (edit hides it). */
export function ItemDialog({
  item,
  onClose,
  onSaved,
}: {
  item: Item | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const isEdit = !!item;
  const [form, setForm] = useState({
    itemCode: item?.itemCode ?? '',
    name: item?.name ?? '',
    description: item?.description ?? '',
    itemType: item?.itemType ?? ('RAW_MATERIAL' as ItemType),
    baseUnitOfMeasure: item?.baseUnitOfMeasure ?? '',
    defaultWastagePercent: item?.defaultWastagePercent ?? '',
    drawingSpecReference: item?.drawingSpecReference ?? '',
    standardLeadTimeDays:
      item?.standardLeadTimeDays != null ? String(item.standardLeadTimeDays) : '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    if (!form.name.trim() || !form.baseUnitOfMeasure.trim()) {
      setError('Name and base unit of measure are required.');
      return;
    }
    if (!isEdit && !form.itemCode.trim()) {
      setError('Item code is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const wastage =
        form.defaultWastagePercent.trim() === ''
          ? undefined
          : Number(form.defaultWastagePercent);
      const lead =
        form.standardLeadTimeDays.trim() === ''
          ? undefined
          : Number(form.standardLeadTimeDays);
      if (isEdit && item) {
        await updateItem(item.id, {
          name: form.name,
          description: form.description || undefined,
          itemType: form.itemType,
          baseUnitOfMeasure: form.baseUnitOfMeasure,
          defaultWastagePercent: wastage,
          drawingSpecReference: form.drawingSpecReference || undefined,
          standardLeadTimeDays: lead,
        });
        toast.success('Item updated.');
      } else {
        const payload: CreateItemInput = {
          itemCode: form.itemCode.trim(),
          name: form.name,
          description: form.description || undefined,
          itemType: form.itemType,
          baseUnitOfMeasure: form.baseUnitOfMeasure,
          defaultWastagePercent: wastage,
          drawingSpecReference: form.drawingSpecReference || undefined,
          standardLeadTimeDays: lead,
        };
        await createItem(payload);
        toast.success('Item created.');
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save item.');
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${item?.itemCode}` : 'New Item'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update technical item information. Item code is fixed.'
              : 'Create a new Item Master record.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          {!isEdit && (
            <Field label="Item code" required htmlFor="i-code">
              <Input id="i-code" value={form.itemCode} onChange={(e) => set('itemCode', e.target.value)} />
            </Field>
          )}
          <Field label="Name" required htmlFor="i-name">
            <Input id="i-name" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Type" required htmlFor="i-type">
            <Select
              id="i-type"
              value={form.itemType}
              onChange={(e) => set('itemType', e.target.value)}
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {ITEM_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Base unit of measure" required htmlFor="i-uom">
            <Input id="i-uom" value={form.baseUnitOfMeasure} onChange={(e) => set('baseUnitOfMeasure', e.target.value)} placeholder="e.g. kg, pcs, m" />
          </Field>
          <Field label="Default wastage %" htmlFor="i-wastage">
            <Input id="i-wastage" type="number" min={0} max={100} step="0.01" value={form.defaultWastagePercent} onChange={(e) => set('defaultWastagePercent', e.target.value)} />
          </Field>
          <Field label="Standard lead time (days)" htmlFor="i-lead">
            <Input id="i-lead" type="number" min={0} value={form.standardLeadTimeDays} onChange={(e) => set('standardLeadTimeDays', e.target.value)} />
          </Field>
          <Field label="Drawing / spec reference" htmlFor="i-drawing" className="sm:col-span-2">
            <Input id="i-drawing" value={form.drawingSpecReference} onChange={(e) => set('drawingSpecReference', e.target.value)} />
          </Field>
          <Field label="Description" htmlFor="i-desc" className="sm:col-span-2">
            <Textarea id="i-desc" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
        </div>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? 'Saving…' : isEdit ? 'Save' : 'Create item'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
