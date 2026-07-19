'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import { createRfqFromKickoff } from '../../../lib/rfq';
import {
  AVAILABILITY_LABEL,
  cancelReservation,
  createReservation,
  generateStockReport,
  getStockReport,
  listReservations,
  listStores,
  type Reservation,
  type StockAvailabilityReport,
  type StoreLocation,
} from '../../../lib/scm-inventory';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { StatusBadge } from '../../../components/ui/status-badge';
import { Badge } from '../../../components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { useToast } from '../../../components/ui/toaster';
import { useConfirm } from '../../../components/ui/confirm';

/**
 * Stock-availability report + reservations for a kickoff (§8–9). Read-only for
 * everyone with kickoff access; "Generate" snapshots the released BOMs on first
 * run. Reservations require Store access (the backend enforces it; a 403 is
 * surfaced as a toast). Never blocks the kickoff — purely informational.
 */
export function StockAvailabilitySection({ kickoffId }: { kickoffId: string }) {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [report, setReport] = useState<StockAvailabilityReport | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [stores, setStores] = useState<StoreLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const canReserve =
    user?.role === 'SUPER_ADMIN' ||
    user?.role === 'ADMIN' ||
    user?.role === 'MANAGER' ||
    user?.role === 'EMPLOYEE';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rep, res] = await Promise.all([
        getStockReport(kickoffId),
        listReservations(kickoffId).catch(() => [] as Reservation[]),
      ]);
      setReport(rep);
      setReservations(res);
    } catch {
      /* report simply not generated yet */
    } finally {
      setLoading(false);
    }
  }, [kickoffId]);

  useEffect(() => {
    void load();
    listStores()
      .then(setStores)
      .catch(() => setStores([]));
  }, [load]);

  async function generate() {
    setBusy(true);
    try {
      const rep = await generateStockReport(kickoffId);
      setReport(rep);
      await load();
      toast.success('Stock-availability report generated.');
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to generate report.',
      );
    } finally {
      setBusy(false);
    }
  }

  const shortfallCount =
    report?.rows.filter((r) => r.availabilityStatus === 'SHORTAGE').length ?? 0;

  async function createRfq() {
    const ok = await confirm({
      title: 'Create RFQ for shortfalls',
      description: `Generate a DRAFT RFQ pre-filled with the ${shortfallCount} shorted item(s) from this report? SCM then adds invitees and issues it.`,
      confirmLabel: 'Create RFQ',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const rfq = await createRfqFromKickoff(kickoffId);
      toast.success(`RFQ ${rfq.rfqNumber} drafted from shortfalls`);
      router.push(`/scm/rfqs/${rfq.id}`);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to create RFQ',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Material Stock Availability</CardTitle>
        <div className="flex items-center gap-2">
          {shortfallCount > 0 && (
            <Button size="sm" onClick={createRfq} disabled={busy}>
              Create RFQ for shortfalls ({shortfallCount})
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={generate} disabled={busy}>
            {report ? 'Regenerate' : 'Generate report'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !report ? (
          <p className="text-sm text-muted-foreground">
            No report yet. Generating snapshots the released BOM for each ordered
            product and compares requirements against store stock. Shortages are
            reported but never block the kickoff.
          </p>
        ) : (
          <div className="space-y-4">
            <Summary report={report} />

            <div className="text-xs text-muted-foreground">
              BOM revisions used:{' '}
              {report.bomSelections
                .map((s) => `${s.productSku} Rev ${s.bomRevisionNumber}`)
                .join(', ') || '—'}{' '}
              · generated {new Date(report.generatedAt).toLocaleString()}
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>UoM</TableHead>
                    <TableHead className="text-right">Base</TableHead>
                    <TableHead className="text-right">Wastage</TableHead>
                    <TableHead className="text-right">Gross req.</TableHead>
                    <TableHead className="text-right">On hand</TableHead>
                    <TableHead className="text-right">Reserved</TableHead>
                    <TableHead className="text-right">Blocked</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                    <TableHead className="text-right">Short/Surplus</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.rows.map((r) => (
                    <TableRow key={r.itemCode}>
                      <TableCell>
                        <div className="font-medium">{r.itemCode}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.itemName}
                        </div>
                      </TableCell>
                      <TableCell>{r.unitOfMeasure}</TableCell>
                      <TableCell className="text-right">{r.baseRequirement}</TableCell>
                      <TableCell className="text-right">
                        {r.wastageQuantity}
                        <span className="text-xs text-muted-foreground">
                          {' '}
                          ({r.wastagePercent}%)
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {r.grossRequirement}
                      </TableCell>
                      <TableCell className="text-right">{r.onHandQuantity}</TableCell>
                      <TableCell className="text-right">
                        {r.reservedQuantity}
                        {Number(r.reservedForThisKickoff) > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {' '}
                            ({r.reservedForThisKickoff} here)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{r.blockedQuantity}</TableCell>
                      <TableCell className="text-right">{r.availableQuantity}</TableCell>
                      <TableCell className="text-right">
                        {Number(r.shortageQuantity) > 0 ? (
                          <span className="text-destructive">-{r.shortageQuantity}</span>
                        ) : Number(r.surplusQuantity) > 0 ? (
                          <span className="text-muted-foreground">
                            +{r.surplusQuantity}
                          </span>
                        ) : (
                          '0'
                        )}
                        {r.expectedReceiptQuantity &&
                          Number(r.expectedReceiptQuantity) > 0 && (
                            <div className="text-xs text-muted-foreground">
                              exp {r.expectedReceiptQuantity}
                              {r.expectedReceiptDate
                                ? ` by ${new Date(r.expectedReceiptDate).toLocaleDateString()}`
                                : ''}
                            </div>
                          )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge value={r.availabilityStatus} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ReservationsPanel
              kickoffId={kickoffId}
              report={report}
              reservations={reservations}
              stores={stores}
              canReserve={canReserve}
              onChanged={load}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Summary({ report }: { report: StockAvailabilityReport }) {
  const s = report.summary;
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      <Badge variant="success">Available: {s.available}</Badge>
      <Badge variant="info">Expected: {s.expected}</Badge>
      <Badge variant="destructive">Shortage: {s.shortage}</Badge>
      <Badge variant="muted">Unknown: {s.unknown}</Badge>
      <span className="text-muted-foreground">
        {s.totalItems} required item(s)
      </span>
    </div>
  );
}

function ReservationsPanel({
  kickoffId,
  report,
  reservations,
  stores,
  canReserve,
  onChanged,
}: {
  kickoffId: string;
  report: StockAvailabilityReport;
  reservations: Reservation[];
  stores: StoreLocation[];
  canReserve: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [itemId, setItemId] = useState('');
  const [storeLocationId, setStoreLocationId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [busy, setBusy] = useState(false);

  const reservableItems = report.rows.filter((r) => r.itemId);

  async function reserve() {
    if (!itemId || !storeLocationId || !quantity) {
      toast.error('Pick an item, a store and a quantity.');
      return;
    }
    setBusy(true);
    try {
      await createReservation(kickoffId, {
        itemId,
        storeLocationId,
        quantity: Number(quantity),
      });
      toast.success('Material reserved.');
      setItemId('');
      setQuantity('');
      await onChanged();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to reserve material.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancel(r: Reservation) {
    if (
      !(await confirm({
        title: 'Cancel reservation?',
        description: `Release ${r.quantity} ${r.itemName} back to available stock.`,
        confirmLabel: 'Cancel reservation',
        destructive: true,
      }))
    )
      return;
    try {
      await cancelReservation(kickoffId, r.id);
      toast.success('Reservation cancelled.');
      await onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to cancel.');
    }
  }

  const active = reservations.filter((r) => r.isActive);

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 text-sm font-medium">Reservations for this kickoff</div>

      {active.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active reservations.</p>
      ) : (
        <ul className="mb-3 space-y-1 text-sm">
          {active.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2">
              <span>
                {r.itemCode} — {r.quantity} @ {r.storeLocationName}
              </span>
              {canReserve && (
                <Button size="sm" variant="outline" onClick={() => cancel(r)}>
                  Cancel
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canReserve && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Item
            <Select
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
              className="h-8 w-56"
            >
              <option value="">Select item…</option>
              {reservableItems.map((r) => (
                <option key={r.itemCode} value={r.itemId ?? ''}>
                  {r.itemCode} — {r.itemName}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Store
            <Select
              value={storeLocationId}
              onChange={(e) => setStoreLocationId(e.target.value)}
              className="h-8 w-44"
            >
              <option value="">Select store…</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Quantity
            <Input
              type="number"
              min={0}
              step="0.0001"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="h-8 w-28"
            />
          </label>
          <Button size="sm" onClick={reserve} disabled={busy}>
            Reserve
          </Button>
        </div>
      )}
    </div>
  );
}
