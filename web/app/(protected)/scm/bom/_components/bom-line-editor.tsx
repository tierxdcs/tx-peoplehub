'use client';

import type { BomLineSource } from '../../../../lib/scm-bom';
import type { Item } from '../../../../lib/scm-item-master';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';

/** Editable BOM line, all values held as strings (converted on submit). */
export interface BomLineDraft {
  itemId: string;
  quantityPerUnit: string;
  unitOfMeasure: string;
  wastagePercent: string;
  makeBuy: BomLineSource;
  notes: string;
}

export function emptyBomLine(): BomLineDraft {
  return {
    itemId: '',
    quantityPerUnit: '',
    unitOfMeasure: '',
    wastagePercent: '',
    makeBuy: 'MAKE',
    notes: '',
  };
}

/**
 * Dynamic BOM-lines editor shared by the create and edit pages. Fully
 * controlled: the parent owns the `lines` array and the active `items` list.
 * Choosing an item auto-fills unitOfMeasure / wastagePercent from the item's
 * defaults (only when those fields are still blank, so manual edits stick).
 */
export function BomLineEditor({
  items,
  lines,
  onChange,
}: {
  items: Item[];
  lines: BomLineDraft[];
  onChange: (lines: BomLineDraft[]) => void;
}) {
  function updateLine(i: number, patch: Partial<BomLineDraft>) {
    onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  function onItemChange(i: number, itemId: string) {
    const item = items.find((it) => it.id === itemId);
    const line = lines[i];
    const patch: Partial<BomLineDraft> = { itemId };
    if (item) {
      if (!line.unitOfMeasure.trim()) patch.unitOfMeasure = item.baseUnitOfMeasure;
      if (!line.wastagePercent.trim())
        patch.wastagePercent = item.defaultWastagePercent ?? '0';
    }
    updateLine(i, patch);
  }

  function addLine() {
    onChange([...lines, emptyBomLine()]);
  }

  function removeLine(i: number) {
    onChange(lines.filter((_, j) => j !== i));
  }

  return (
    <div className="space-y-3">
      {lines.map((line, i) => (
        <div
          key={i}
          className="grid gap-2 rounded-md border p-3 sm:grid-cols-12 sm:items-end"
        >
          <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-4">
            Item
            <Select
              value={line.itemId}
              onChange={(e) => onItemChange(i, e.target.value)}
            >
              <option value="">Select item…</option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.itemCode} — {it.name}
                </option>
              ))}
            </Select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-2">
            Qty / unit
            <Input
              type="number"
              step="0.0001"
              min={0}
              value={line.quantityPerUnit}
              onChange={(e) => updateLine(i, { quantityPerUnit: e.target.value })}
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-1">
            UoM
            <Input
              value={line.unitOfMeasure}
              onChange={(e) => updateLine(i, { unitOfMeasure: e.target.value })}
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-1">
            Wastage %
            <Input
              type="number"
              step="0.01"
              min={0}
              max={100}
              value={line.wastagePercent}
              onChange={(e) => updateLine(i, { wastagePercent: e.target.value })}
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-2">
            Make / Buy
            <Select
              value={line.makeBuy}
              onChange={(e) =>
                updateLine(i, { makeBuy: e.target.value as BomLineSource })
              }
            >
              <option value="MAKE">Make</option>
              <option value="BUY">Buy</option>
            </Select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-2">
            Notes
            <Input
              value={line.notes}
              onChange={(e) => updateLine(i, { notes: e.target.value })}
            />
          </label>

          <div className="sm:col-span-12 sm:flex sm:justify-end">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => removeLine(i)}
            >
              × Remove line
            </Button>
          </div>
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" onClick={addLine}>
        + Add line
      </Button>
    </div>
  );
}
