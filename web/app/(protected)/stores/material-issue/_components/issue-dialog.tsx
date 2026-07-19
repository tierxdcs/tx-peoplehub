'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Scissors } from 'lucide-react';
import { ApiError } from '../../../../lib/api';
import {
  createIssue,
  type MaterialIndent,
} from '../../../../lib/stores';
import { type StoreLocation } from '../../../../lib/scm-inventory';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { Field } from '../../../../components/ui/field';
import { Badge } from '../../../../components/ui/badge';
import { useToast } from '../../../../components/ui/toaster';

/**
 * Issue-against-indent dialog. Short issue (issuing less than outstanding) is
 * explicitly supported and visually flagged — a short issue is a materially
 * different outcome from a full one, so the UI keeps that distinction visible.
 */
export function IssueDialog({
  indent,
  stores,
  onClose,
  onIssued,
}: {
  indent: MaterialIndent;
  stores: StoreLocation[];
  onClose: () => void;
  onIssued: () => void;
}) {
  const toast = useToast();
  const outstanding = Number(indent.outstandingQuantity);
  const [qty, setQty] = useState(String(outstanding));
  const [storeLocationId, setStoreLocationId] = useState(stores[0]?.id ?? '');
  const [binLocation, setBinLocation] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const n = Number(qty);
  const invalid = !Number.isFinite(n) || n <= 0 || n > outstanding;
  const isShort = Number.isFinite(n) && n > 0 && n < outstanding;

  const kind = useMemo(() => {
    if (invalid) return null;
    return isShort ? 'short' : 'full';
  }, [invalid, isShort]);

  async function handleSubmit() {
    if (invalid || !storeLocationId) return;
    setSubmitting(true);
    try {
      const note = await createIssue({
        materialIndentId: indent.id,
        storeLocationId,
        issuedQuantity: n,
        ...(binLocation ? { binLocation } : {}),
      });
      toast.success(
        `${note.minNumber} issued (${note.issuedQuantity})${isShort ? ' — short issue' : ''}`,
      );
      onIssued();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to issue material');
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Issue material · {indent.indentNumber}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md bg-muted/40 p-3 text-sm">
            <div className="font-medium">{indent.itemName}</div>
            <div className="text-xs text-muted-foreground">{indent.itemCode}</div>
            <div className="mt-2 flex gap-4 text-xs">
              <span>Requested: <span className="font-medium">{indent.requestedQuantity}</span></span>
              <span>Already issued: <span className="font-medium">{indent.issuedQuantity}</span></span>
              <span>Outstanding: <span className="font-medium">{indent.outstandingQuantity}</span></span>
            </div>
          </div>

          <Field
            label="Issue Quantity"
            htmlFor="qty"
            required
            error={
              invalid
                ? n > outstanding
                  ? `Cannot exceed outstanding (${outstanding}).`
                  : 'Enter a positive quantity.'
                : null
            }
          >
            <Input
              id="qty"
              type="number"
              min="0"
              step="any"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </Field>

          {kind === 'short' && (
            <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              <Scissors className="size-4 shrink-0 text-warning" />
              <span>
                <Badge variant="warning" className="mr-1">Short Issue</Badge>
                Issuing {n} of {outstanding} outstanding — the indent stays{' '}
                <span className="font-medium">Partially Issued</span>.
              </span>
            </div>
          )}
          {kind === 'full' && (
            <div className="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm">
              <span>
                <Badge variant="success" className="mr-1">Full Issue</Badge>
                Completes the indent — it becomes <span className="font-medium">Fully Issued</span>.
              </span>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Store Location" htmlFor="store" required>
              <Select id="store" value={storeLocationId} onChange={(e) => setStoreLocationId(e.target.value)}>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Bin Location" htmlFor="bin">
              <Input id="bin" value={binLocation} onChange={(e) => setBinLocation(e.target.value)} placeholder="e.g. A-12" />
            </Field>
          </div>

          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Issuing generates a stock-out. Stock reserved for another project cannot be
              issued here — the server enforces reservation-aware availability.
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={invalid || !storeLocationId || submitting}>
            {submitting ? 'Issuing…' : isShort ? 'Short Issue' : 'Issue'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
