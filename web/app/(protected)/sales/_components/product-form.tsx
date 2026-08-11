'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, ApiError } from '../../../lib/api';
import { Product } from '../../../lib/types';
import { listItems, type Item } from '../../../lib/scm-item-master';
import { useBusinessUnitOptions } from '../../../lib/business-units';
import { inferBusinessUnitCode } from '../../../lib/business-unit-rules';
import { Button } from '../../../components/ui/button';
import { BusinessUnitHelp } from '../../../components/ui/business-unit-help';
import { ItemPicker } from '../../../components/ui/item-picker';
import { useAuth } from '../../../lib/auth-context';
import { formatINR } from '../../../lib/sales';
import { useNumberFormat } from '../../../lib/number-format-context';

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: 7,
  boxSizing: 'border-box',
};

/**
 * Create/edit a Product in a modal. Extracted from the products page so the
 * bid→order "Create Product Now" formalization flow can reuse the exact same
 * form — including the mandatory Business Unit field and its keyword auto-select
 * — without duplicating it. `initialName`/`initialDescription` pre-fill a new
 * product (used when formalizing an ad-hoc bid line). `onSaved` receives the
 * saved Product so the caller can immediately act on it (e.g. resolve a line).
 */
export function ProductForm({
  product,
  initialName,
  initialDescription,
  onClose,
  onSaved,
}: {
  product: Product | null;
  initialName?: string;
  initialDescription?: string;
  onClose: () => void;
  onSaved: (product: Product) => void;
}) {
  const isEdit = product !== null;
  const { user } = useAuth();
  const { style: numberFormatStyle } = useNumberFormat();
  const [sku, setSku] = useState(product?.sku ?? '');
  const [name, setName] = useState(product?.name ?? initialName ?? '');
  const [description, setDescription] = useState(
    product?.description ?? initialDescription ?? '',
  );
  const [unitPrice, setUnitPrice] = useState(product?.unitPrice ?? '');
  const [unitOfMeasure, setUnitOfMeasure] = useState(
    product?.unitOfMeasure ?? 'each',
  );
  const [hsnCode, setHsnCode] = useState(product?.hsnCode ?? '');
  const [isActive, setIsActive] = useState(product?.isActive ?? true);
  const [itemId, setItemId] = useState(product?.itemId ?? '');
  const [targetMarginPercent, setTargetMarginPercent] = useState(
    product?.targetMarginPercent ?? '',
  );
  const priceManuallyEdited = useRef(isEdit);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { businessUnits } = useBusinessUnitOptions();
  const [businessUnitId, setBusinessUnitId] = useState(
    product?.businessUnitId ?? '',
  );
  // Whether the CURRENT businessUnitId value came from auto-inference and hasn't
  // been confirmed. Seeded from the record on edit; set true when inference
  // fills it; cleared the moment the user changes the field or saves. Once the
  // user has manually touched the field, inference must never overwrite it.
  const [autoAssigned, setAutoAssigned] = useState(
    product?.autoAssignedBusinessUnit ?? false,
  );
  const [buManuallyTouched, setBuManuallyTouched] = useState(
    // On edit, an existing non-auto value is already a settled (manual) choice.
    isEdit && !!product?.businessUnitId && !product?.autoAssignedBusinessUnit,
  );

  const selectedItem = items.find((item) => item.id === itemId);
  const canSeeCost =
    user?.role === 'SUPER_ADMIN' ||
    product?.rolledUpCostSnapshot !== undefined ||
    selectedItem?.releasedBomCostSnapshot !== undefined;
  const releasedCost = useMemo(() => {
    const raw =
      isEdit && product?.itemId === itemId
        ? product.rolledUpCostSnapshot
        : selectedItem?.releasedBomCostSnapshot;
    if (raw == null || raw === '') return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }, [isEdit, itemId, product, selectedItem]);
  const targetMargin = Number(targetMarginPercent);
  const suggestedPrice =
    releasedCost != null &&
    targetMarginPercent !== '' &&
    Number.isFinite(targetMargin) &&
    targetMargin >= 0 &&
    targetMargin < 100
      ? releasedCost / (1 - targetMargin / 100)
      : null;
  const numericPrice = Number(unitPrice);
  const actualMargin =
    releasedCost != null && Number.isFinite(numericPrice) && numericPrice > 0
      ? ((numericPrice - releasedCost) / numericPrice) * 100
      : null;

  useEffect(() => {
    if (suggestedPrice == null || priceManuallyEdited.current) return;
    setUnitPrice(suggestedPrice.toFixed(2));
  }, [suggestedPrice]);

  // Item Master items for the "manufactured item" link (active only). Best-
  // effort — a fetch failure just leaves the picker empty (link stays optional).
  useEffect(() => {
    listItems({ activeOnly: true })
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  // Auto-select the BU from name/description — but only while the user hasn't
  // manually set it (manual always wins, spec §4). Runs when name/description
  // change; a genuine no-match/tie leaves the field unset rather than guessing.
  useEffect(() => {
    if (buManuallyTouched) return;
    if (businessUnits.length === 0) return;
    const code = inferBusinessUnitCode(name, description);
    if (!code) return;
    const match = businessUnits.find((b) => b.code === code);
    if (!match) return;
    setBusinessUnitId((current) => {
      if (current === match.id) return current;
      setAutoAssigned(true);
      return match.id;
    });
  }, [name, description, businessUnits, buManuallyTouched]);

  function onBusinessUnitChange(value: string) {
    // Any manual change is a deliberate choice: lock inference out + clear flag.
    setBusinessUnitId(value);
    setBuManuallyTouched(true);
    setAutoAssigned(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name || !unitOfMeasure || unitPrice === '') {
      setError('Name, unit price and unit of measure are required');
      return;
    }
    if (!businessUnitId) {
      setError('Business unit is required');
      return;
    }
    setSubmitting(true);
    try {
      let saved: Product;
      if (isEdit) {
        saved = await apiFetch<Product>(`/products/${product!.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name,
            description: description || undefined,
            unitPrice: Number(unitPrice),
            unitOfMeasure,
            hsnCode: hsnCode || undefined,
            isActive,
            // '' → null (unlink); an id → link. Always sent so edits can clear it.
            itemId: itemId || null,
            ...(canSeeCost
              ? {
                  targetMarginPercent:
                    targetMarginPercent === ''
                      ? null
                      : Number(targetMarginPercent),
                }
              : {}),
            // Only send the BU when it changed to a manual value; sending it
            // clears the auto flag server-side. If it's still an unconfirmed
            // auto value, leave it (and its flag) as-is.
            ...(buManuallyTouched ? { businessUnitId } : {}),
          }),
        });
      } else {
        saved = await apiFetch<Product>('/products', {
          method: 'POST',
          body: JSON.stringify({
            sku,
            name,
            description: description || undefined,
            unitPrice: Number(unitPrice),
            unitOfMeasure,
            hsnCode: hsnCode || undefined,
            isActive,
            itemId: itemId || undefined,
            ...(canSeeCost && targetMarginPercent !== ''
              ? { targetMarginPercent: Number(targetMarginPercent) }
              : {}),
            businessUnitId,
            // Persist whether this was still an unconfirmed auto-pick at save.
            autoAssignedBusinessUnit: autoAssigned && !buManuallyTouched,
          }),
        });
      }
      onSaved(saved);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to save product',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        overflowY: 'auto',
        padding: 16,
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? 'Edit Product' : 'New Product'}
        style={{
          background: 'hsl(var(--card))',
          borderRadius: 8,
          width: 'min(440px, 100%)',
          maxHeight: 'calc(100dvh - 32px)',
          margin: 'auto',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.35)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card px-5 py-4">
          <h2 className="text-lg font-semibold">
            {isEdit ? 'Edit Product' : 'New Product'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-md text-xl text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close product form"
          >
            ×
          </button>
        </div>
        <div className="px-5 pt-4">
        {!isEdit && (
          <div style={{ marginBottom: 10 }}>
            <label style={{ display: 'block', marginBottom: 4 }}>SKU</label>
            <input
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              required
              style={fieldStyle}
            />
          </div>
        )}
        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            style={fieldStyle}
          />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Description
          </label>
          <textarea
            value={description ?? ''}
            onChange={(e) => setDescription(e.target.value)}
            style={{ ...fieldStyle, minHeight: 50 }}
          />
        </div>
        <div style={{ marginBottom: 10 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 4,
            }}
          >
            <label>Business unit</label>
            <BusinessUnitHelp businessUnits={businessUnits} />
          </div>
          <select
            value={businessUnitId}
            onChange={(e) => onBusinessUnitChange(e.target.value)}
            required
            style={fieldStyle}
          >
            <option value="">— Select business unit —</option>
            {businessUnits.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {autoAssigned && businessUnitId && (
            <p className="mt-1 text-xs text-warning">
              ✨ Auto-selected from product name — change it or save to confirm.
            </p>
          )}
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Unit price
          </label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={unitPrice}
            onChange={(e) => {
              priceManuallyEdited.current = true;
              setUnitPrice(e.target.value);
            }}
            required
            style={fieldStyle}
          />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Unit of measure
          </label>
          <input
            value={unitOfMeasure}
            onChange={(e) => setUnitOfMeasure(e.target.value)}
            required
            style={fieldStyle}
          />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            HSN code (optional)
          </label>
          <input
            value={hsnCode ?? ''}
            onChange={(e) => setHsnCode(e.target.value)}
            style={fieldStyle}
          />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Manufactured item (optional)
          </label>
          <ItemPicker
            items={items}
            value={itemId}
            onValueChange={(value) => {
              priceManuallyEdited.current = false;
              setItemId(value);
            }}
            placeholder="— Not linked —"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Link to the Item Master item this product is built as. Required for
            its BOM and the project-kickoff stock-availability report.
          </p>
        </div>
        {canSeeCost && (
          <div className="mb-3 rounded-md border border-border bg-muted/30 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">
                  Released BOM cost
                </p>
                <p className="font-medium">
                  {releasedCost == null
                    ? 'Not available'
                    : formatINR(releasedCost, numberFormatStyle)}
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Target margin %
                </label>
                <input
                  type="number"
                  min={0}
                  max={99.99}
                  step="0.01"
                  value={targetMarginPercent}
                  onChange={(e) => {
                    priceManuallyEdited.current = false;
                    setTargetMarginPercent(e.target.value);
                  }}
                  style={fieldStyle}
                />
              </div>
            </div>
            <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">
                  Suggested selling price
                </p>
                <p className="font-medium">
                  {suggestedPrice == null
                    ? '—'
                    : formatINR(suggestedPrice, numberFormatStyle)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Actual margin</p>
                <p className="font-medium">
                  {actualMargin == null ? '—' : `${actualMargin.toFixed(2)}%`}
                </p>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Suggested price is informational. The unit price remains editable.
            </p>
          </div>
        )}
        <div style={{ marginBottom: 10 }}>
          <label>
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />{' '}
            Active
          </label>
        </div>

        {error && <p className="text-destructive">{error}</p>}

        </div>
        <div className="sticky bottom-0 z-10 flex gap-2 border-t bg-card px-5 py-4">
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
