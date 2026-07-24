'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../../../lib/api';
import {
  createItem,
  ITEM_TYPE_LABEL,
  previewNextItemCode,
  updateItem,
  type CreateItemInput,
  type Item,
  type ItemType,
} from '../../../../lib/scm-item-master';
import {
  linkItemSupplier,
  listItemSuppliers,
  unlinkItemSupplier,
  type ItemSupplierLink,
} from '../../../../lib/scm-bom';
import { listSuppliers, type Supplier } from '../../../../lib/scm-supplier';
import { StatusBadge } from '../../../../components/ui/status-badge';
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
  // Read-only preview of the itemCode the create will receive, re-fetched
  // whenever the selected type changes. Not shown in edit mode — itemCode is
  // immutable once created and the real item.itemCode is displayed instead.
  const [nextCode, setNextCode] = useState<string | null>(null);

  useEffect(() => {
    if (isEdit) return;
    let cancelled = false;
    setNextCode(null);
    previewNextItemCode(form.itemType)
      .then((code) => {
        if (!cancelled) setNextCode(code);
      })
      .catch(() => {
        if (!cancelled) setNextCode(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isEdit, form.itemType]);

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    if (!form.name.trim() || !form.baseUnitOfMeasure.trim()) {
      setError('Name and base unit of measure are required.');
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
          {!isEdit && (
            <Field label="Item code" htmlFor="i-code" hint="Generated automatically from the selected type">
              <Input id="i-code" value={nextCode ?? 'Generating…'} disabled />
            </Field>
          )}
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

        {isEdit && item && <ItemSuppliers itemId={item.id} />}

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

/**
 * Manage the qualified suppliers linked to an item. Purely informational —
 * releasing a BOM does not require a raw material to have a qualified
 * supplier. Visible to everyone here; the backend enforces R&D-Head-only for
 * link/unlink.
 */
function ItemSuppliers({ itemId }: { itemId: string }) {
  const toast = useToast();
  const [links, setLinks] = useState<ItemSupplierLink[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [partNumber, setPartNumber] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [linkRes, supRes] = await Promise.all([
        listItemSuppliers(itemId),
        listSuppliers(),
      ]);
      setLinks(linkRes);
      setSuppliers(supRes);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to load suppliers.',
      );
    } finally {
      setLoading(false);
    }
  }, [itemId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onAdd() {
    if (!selectedSupplier) return;
    setBusy(true);
    try {
      await linkItemSupplier(itemId, {
        supplierId: selectedSupplier,
        supplierPartNumber: partNumber.trim() || undefined,
      });
      toast.success('Supplier linked.');
      setSelectedSupplier('');
      setPartNumber('');
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to link supplier.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function onUnlink(link: ItemSupplierLink) {
    setBusy(true);
    try {
      await unlinkItemSupplier(itemId, link.id);
      toast.success('Supplier unlinked.');
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to unlink supplier.',
      );
    } finally {
      setBusy(false);
    }
  }

  const linkedIds = new Set(links.map((l) => l.supplierId));
  const available = suppliers.filter((s) => !linkedIds.has(s.id));

  return (
    <div className="mt-6 border-t pt-4">
      <h3 className="mb-1 text-sm font-semibold">Suppliers</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Link qualified suppliers for reference. Optional — not required to
        release a BOM.
      </p>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : links.length === 0 ? (
        <p className="mb-3 text-sm text-muted-foreground">
          No suppliers linked yet.
        </p>
      ) : (
        <ul className="mb-3 space-y-2">
          {links.map((link) => (
            <li
              key={link.id}
              className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"
            >
              <span className="font-medium">{link.supplierName}</span>
              <StatusBadge value={link.supplierStatus} />
              <span
                className={
                  link.isQualified
                    ? 'text-xs text-success'
                    : 'text-xs text-muted-foreground'
                }
              >
                {link.isQualified ? 'Qualified' : 'Not qualified'}
              </span>
              {link.supplierPartNumber && (
                <span className="text-xs text-muted-foreground">
                  Part #{link.supplierPartNumber}
                </span>
              )}
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                onClick={() => onUnlink(link)}
                disabled={busy}
              >
                Unlink
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <Field label="Add supplier" htmlFor="i-supplier" className="flex-1">
          <Select
            id="i-supplier"
            value={selectedSupplier}
            onChange={(e) => setSelectedSupplier(e.target.value)}
          >
            <option value="">Select supplier…</option>
            {available.map((s) => (
              <option key={s.id} value={s.id}>
                {s.companyName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Part number" htmlFor="i-partno" className="flex-1">
          <Input
            id="i-partno"
            value={partNumber}
            onChange={(e) => setPartNumber(e.target.value)}
          />
        </Field>
        <Button onClick={onAdd} disabled={busy || !selectedSupplier}>
          Add
        </Button>
      </div>
    </div>
  );
}
