'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { ApiError } from '../../../../lib/api';
import {
  createPurchaseOrder,
  isQualifiedStatus,
  type CreatePurchaseOrderInput,
} from '../../../../lib/stores';
import { listSuppliers, type Supplier } from '../../../../lib/scm-supplier';
import { listVendors, type Vendor } from '../../../../lib/scm';
import { listItems, type Item } from '../../../../lib/scm-item-master';
import { formatINR } from '../../../../lib/sales';
import { useNumberFormat } from '../../../../lib/number-format-context';
import { humanizeEnum } from '../../../../lib/status';
import { PageContainer } from '../../../../components/ui/page-container';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { Field } from '../../../../components/ui/field';
import { Textarea } from '../../../../components/ui/textarea';
import { Badge } from '../../../../components/ui/badge';
import { OverrideTag } from '../../../../components/ui/override-tag';
import { Skeleton } from '../../../../components/ui/skeleton';
import { useToast } from '../../../../components/ui/toaster';
import { ItemPicker } from '../../../../components/ui/item-picker';

type PartnerType = 'SUPPLIER' | 'VENDOR' | 'AD_HOC';
interface LineDraft {
  key: number;
  source: 'CATALOG' | 'FREE_TEXT';
  itemId: string;
  adHocItemName: string;
  adHocDescription: string;
  unitOfMeasure: string;
  orderedQuantity: string;
  unitPrice: string;
}

function emptyLine(): LineDraft {
  return {
    key: lineKeySeq++,
    source: 'CATALOG',
    itemId: '',
    adHocItemName: '',
    adHocDescription: '',
    unitOfMeasure: '',
    orderedQuantity: '',
    unitPrice: '',
  };
}

let lineKeySeq = 1;

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const toast = useToast();
  const { style: numberFormatStyle } = useNumberFormat();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const [partnerType, setPartnerType] = useState<PartnerType>('SUPPLIER');
  const [partnerId, setPartnerId] = useState('');
  const [adHocPartyName, setAdHocPartyName] = useState('');
  const [adHocContactInfo, setAdHocContactInfo] = useState('');
  const [adHocPartyAddress, setAdHocPartyAddress] = useState('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [s, v, i] = await Promise.all([
          listSuppliers(),
          listVendors(),
          listItems({ activeOnly: true }),
        ]);
        setSuppliers(s);
        setVendors(v);
        setItems(i);
      } catch {
        toast.error('Failed to load form data.');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const partners = useMemo(
    () =>
      partnerType === 'SUPPLIER'
        ? suppliers
        : partnerType === 'VENDOR'
          ? vendors
          : [],
    [partnerType, suppliers, vendors],
  );

  // The selected partner's qualification status, resolved inline so the warning
  // is visible BEFORE submitting (not only in the server response afterward).
  const selectedPartner = useMemo(
    () => partners.find((p) => p.id === partnerId) ?? null,
    [partners, partnerId],
  );
  const unqualified =
    selectedPartner != null && !isQualifiedStatus(selectedPartner.status);

  const itemById = useCallback(
    (id: string) => items.find((it) => it.id === id) ?? null,
    [items],
  );

  const total = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const q = Number(l.orderedQuantity);
        const p = Number(l.unitPrice);
        return sum + (Number.isFinite(q) && Number.isFinite(p) ? q * p : 0);
      }, 0),
    [lines],
  );

  function updateLine(key: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }
  function removeLine(key: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  const validLines = lines.filter(
    (l) =>
      (l.source === 'CATALOG'
        ? !!l.itemId
        : !!l.adHocItemName.trim() && !!l.unitOfMeasure.trim()) &&
      Number(l.orderedQuantity) > 0 &&
      Number(l.unitPrice) >= 0,
  );
  const hasParty = partnerType === 'AD_HOC' ? !!adHocPartyName.trim() : !!partnerId;
  const canSubmit = hasParty && validLines.length > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    const input: CreatePurchaseOrderInput = {
      ...(partnerType === 'SUPPLIER'
        ? { supplierId: partnerId }
        : partnerType === 'VENDOR'
          ? { vendorId: partnerId }
          : {
              adHocPartyName: adHocPartyName.trim(),
              ...(adHocContactInfo.trim()
                ? { adHocContactInfo: adHocContactInfo.trim() }
                : {}),
              ...(adHocPartyAddress.trim()
                ? { adHocPartyAddress: adHocPartyAddress.trim() }
                : {}),
            }),
      ...(expectedDeliveryDate ? { expectedDeliveryDate: new Date(expectedDeliveryDate).toISOString() } : {}),
      ...(notes ? { notes } : {}),
      lines: validLines.map((l) => ({
        ...(l.source === 'CATALOG'
          ? { itemId: l.itemId }
          : {
              adHocItemName: l.adHocItemName.trim(),
              ...(l.adHocDescription.trim()
                ? { adHocDescription: l.adHocDescription.trim() }
                : {}),
              unitOfMeasure: l.unitOfMeasure.trim(),
            }),
        orderedQuantity: Number(l.orderedQuantity),
        unitPrice: Number(l.unitPrice),
      })),
    };
    try {
      const po = await createPurchaseOrder(input);
      if (po.status === 'PENDING_CEO_APPROVAL') {
        toast.success(
          `PO ${po.poNumber} created and sent for CEO/SuperAdmin approval`,
        );
      } else if (po.qualificationWarning) {
        toast.success(
          `PO ${po.poNumber} created — note: ${po.qualificationWarning.message}`,
          'Created with warning',
        );
      } else {
        toast.success(`Purchase order ${po.poNumber} created`);
      }
      router.push(`/stores/purchase-orders/${po.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to create PO');
      setSubmitting(false);
    }
  }

  return (
    <PageContainer>
      <div className="mb-4">
        <Link
          href="/stores/purchase-orders"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Purchase Orders
        </Link>
      </div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">New Purchase Order</h1>

      {loading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Trading Party</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Partner Type" htmlFor="partnerType">
                  <Select
                    id="partnerType"
                    value={partnerType}
                    onChange={(e) => {
                      const nextType = e.target.value as PartnerType;
                      setPartnerType(nextType);
                      setPartnerId('');
                      if (nextType !== 'AD_HOC') {
                        setLines((current) =>
                          current.map((line) =>
                            line.source === 'FREE_TEXT' ? emptyLine() : line,
                          ),
                        );
                      }
                    }}
                  >
                    <option value="SUPPLIER">Supplier (raw materials)</option>
                    <option value="VENDOR">Vendor (finished goods)</option>
                    <option value="AD_HOC">Ad-hoc / Unlisted Party</option>
                  </Select>
                </Field>
                {partnerType !== 'AD_HOC' ? (
                  <Field
                    label={partnerType === 'SUPPLIER' ? 'Supplier' : 'Vendor'}
                    htmlFor="partner"
                    required
                    hint="Qualification status is shown beside each name."
                  >
                    <Select
                      id="partner"
                      value={partnerId}
                      onChange={(e) => setPartnerId(e.target.value)}
                    >
                      <option value="">Select…</option>
                      {partners.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.companyName} — {humanizeEnum(p.status)}
                          {p.statusOverridden ? ' (manually overridden)' : ''}
                          {isQualifiedStatus(p.status) ? '' : ' ⚠'}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : (
                  <Field label="Party Name" htmlFor="adHocPartyName" required>
                    <Input
                      id="adHocPartyName"
                      value={adHocPartyName}
                      onChange={(e) => setAdHocPartyName(e.target.value)}
                      placeholder="Legal or trading name"
                    />
                  </Field>
                )}
              </div>

              {partnerType === 'AD_HOC' && (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Contact Information" htmlFor="adHocContactInfo">
                      <Textarea
                        id="adHocContactInfo"
                        value={adHocContactInfo}
                        onChange={(e) => setAdHocContactInfo(e.target.value)}
                        placeholder="Contact name, phone and email"
                      />
                    </Field>
                    <Field label="Address" htmlFor="adHocPartyAddress">
                      <Textarea
                        id="adHocPartyAddress"
                        value={adHocPartyAddress}
                        onChange={(e) => setAdHocPartyAddress(e.target.value)}
                        placeholder="Billing / delivery party address"
                      />
                    </Field>
                  </div>
                  <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                    <p>
                      This exception PO will remain blocked until the CEO/SuperAdmin
                      approves the unlisted party. It cannot be issued or used for a GRN
                      before approval.
                    </p>
                  </div>
                </>
              )}

              {selectedPartner && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Qualification:</span>
                  <Badge variant={isQualifiedStatus(selectedPartner.status) ? 'success' : 'warning'}>
                    {humanizeEnum(selectedPartner.status)}
                  </Badge>
                  {selectedPartner.statusOverridden && <OverrideTag />}
                </div>
              )}

              {unqualified && (
                <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                  <div>
                    <p className="font-medium">This {partnerType.toLowerCase()} is not qualified.</p>
                    <p className="text-muted-foreground">
                      {selectedPartner?.companyName} is currently{' '}
                      {humanizeEnum(selectedPartner!.status)}. The purchase order is still
                      allowed (emergency purchases are legitimate), but review before issuing.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Line Items</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {lines.map((line) => {
                const item = itemById(line.itemId);
                const lineTotal =
                  Number(line.orderedQuantity) * Number(line.unitPrice) || 0;
                return (
                  <div key={line.key} className="rounded-lg border border-border p-3">
                    {partnerType === 'AD_HOC' && (
                      <div className="mb-3 max-w-xs">
                        <Field label="Line type">
                          <Select
                            value={line.source}
                            onChange={(e) =>
                              updateLine(line.key, {
                                source: e.target.value as LineDraft['source'],
                                itemId: '',
                                adHocItemName: '',
                                adHocDescription: '',
                                unitOfMeasure: '',
                              })
                            }
                          >
                            <option value="CATALOG">Item Master item</option>
                            <option value="FREE_TEXT">Free-text product / service</option>
                          </Select>
                        </Field>
                      </div>
                    )}
                    <div className="grid items-end gap-3 md:grid-cols-[1fr_120px_140px_120px_40px]">
                    {line.source === 'CATALOG' || partnerType !== 'AD_HOC' ? (
                      <Field label="Item">
                        <ItemPicker
                          items={items}
                          value={line.itemId}
                          onValueChange={(itemId) => updateLine(line.key, { itemId })}
                        />
                      </Field>
                    ) : (
                      <div className="space-y-3">
                        <Field label="Product / service name" required>
                          <Input
                            value={line.adHocItemName}
                            onChange={(e) => updateLine(line.key, { adHocItemName: e.target.value })}
                            placeholder="Enter a free-text line item"
                          />
                        </Field>
                        <Field label="Description">
                          <Input
                            value={line.adHocDescription}
                            onChange={(e) => updateLine(line.key, { adHocDescription: e.target.value })}
                            placeholder="Specification or scope (optional)"
                          />
                        </Field>
                      </div>
                    )}
                    <div className="space-y-3">
                    <Field label={`Qty${item ? ` (${item.baseUnitOfMeasure})` : ''}`}>
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={line.orderedQuantity}
                        onChange={(e) => updateLine(line.key, { orderedQuantity: e.target.value })}
                      />
                    </Field>
                    {line.source === 'FREE_TEXT' && partnerType === 'AD_HOC' && (
                      <Field label="Unit" required>
                        <Input
                          value={line.unitOfMeasure}
                          onChange={(e) => updateLine(line.key, { unitOfMeasure: e.target.value })}
                          placeholder="NOS, job, lot..."
                        />
                      </Field>
                    )}
                    </div>
                    <Field label="Unit Price (₹)">
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={line.unitPrice}
                        onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
                      />
                    </Field>
                    <Field label="Line Total">
                      <div className="flex h-9 items-center text-sm font-medium">
                        {formatINR(lineTotal, numberFormatStyle)}
                      </div>
                    </Field>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeLine(line.key)}
                      disabled={lines.length === 1}
                      aria-label="Remove line"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                    </div>
                    {line.source === 'FREE_TEXT' && partnerType === 'AD_HOC' && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        This line stays on this PO only. It will not create an Item Master or stock record and cannot be received through GRN.
                      </p>
                    )}
                  </div>
                );
              })}
              <div className="flex items-center justify-between pt-2">
                <Button type="button" variant="outline" size="sm" onClick={addLine}>
                  <Plus className="size-4" /> Add line
                </Button>
                <div className="text-sm">
                  <span className="text-muted-foreground">Total: </span>
                  <span className="font-semibold">{formatINR(total, numberFormatStyle)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="Expected Delivery Date" htmlFor="edd">
                <Input
                  id="edd"
                  type="date"
                  value={expectedDeliveryDate}
                  onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                />
              </Field>
              <Field label="Notes" htmlFor="notes" className="md:col-span-2">
                <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => router.push('/stores/purchase-orders')}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit}>
              {submitting ? 'Creating…' : 'Create Purchase Order'}
            </Button>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
