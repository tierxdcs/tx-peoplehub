'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Download, FileText, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { ApiError } from '../../../../lib/api';
import {
  createRfq,
  listRfqProjectOptions,
  getRfqSourcingLines,
  getRfqQuoteStageSourcingLines,
  getRfqQuoteStageAttachment,
  listRfqQuoteStageOptions,
  getRfqProductBomExplosion,
  type CreateRfqInput,
  type RfqProjectOption,
  type RfqQuoteStageOption,
} from '../../../../lib/rfq';
import { listItems, type Item } from '../../../../lib/scm-item-master';
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
import { Skeleton } from '../../../../components/ui/skeleton';
import { useToast } from '../../../../components/ui/toaster';
import { ItemPicker } from '../../../../components/ui/item-picker';
import { formatINR } from '../../../../lib/sales';
import { useNumberFormat } from '../../../../lib/number-format-context';
import { StatusBadge } from '../../../../components/ui/status-badge';

interface LineDraft {
  key: number;
  itemId: string;
  quantity: string;
  targetPrice: string;
  specificationNotes: string;
}

let lineKeySeq = 1;

export default function NewRfqPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const { style: numberFormatStyle } = useNumberFormat();

  const [items, setItems] = useState<Item[]>([]);
  const [projects, setProjects] = useState<RfqProjectOption[]>([]);
  const [quoteStageOptions, setQuoteStageOptions] = useState<RfqQuoteStageOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState('');
  const [projectKickoffId, setProjectKickoffId] = useState('');
  const [customerBomIntakeId, setCustomerBomIntakeId] = useState('');
  const [description, setDescription] = useState('');
  const [submissionDeadline, setSubmissionDeadline] = useState('');
  const [requiredByDate, setRequiredByDate] = useState('');
  const [deliveryLocation, setDeliveryLocation] = useState('');
  const [paymentTermsRequested, setPaymentTermsRequested] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([
    { key: lineKeySeq++, itemId: '', quantity: '', targetPrice: '', specificationNotes: '' },
  ]);
  // OrderLineItem ids the SCM user chose to exclude from the linked order's
  // context. Empty = every order line is covered (the default). Reset whenever
  // the linked project changes; never touches the Order itself.
  const [excludedOrderLineIds, setExcludedOrderLineIds] = useState<Set<string>>(
    new Set(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [loadingSourcingLines, setLoadingSourcingLines] = useState(false);
  const [noBomRequirements, setNoBomRequirements] = useState(false);
  const sourcingRequest = useRef(0);

  useEffect(() => {
    void (async () => {
      try {
        const [itemRows, projectRows, intakeRows] = await Promise.all([
          listItems({ activeOnly: true }),
          listRfqProjectOptions(),
          listRfqQuoteStageOptions(),
        ]);
        setItems(itemRows);
        setProjects(projectRows);
        setQuoteStageOptions(intakeRows);
        const directProductId = searchParams.get('productId');
        const directQuantity = Number(searchParams.get('quantity') ?? '1');
        if (directProductId && Number.isFinite(directQuantity) && directQuantity > 0) {
          const result = await getRfqProductBomExplosion(directProductId, directQuantity);
          applySourcingLines(result.lines);
          setTitle(`Procurement — ${result.product.name} × ${directQuantity}`);
        }
      } catch {
        toast.error('Failed to load items.');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function updateLine(key: number, patch: Partial<LineDraft>) {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );
  }
  function addLine() {
    setLines((prev) => [
      ...prev,
      { key: lineKeySeq++, itemId: '', quantity: '', targetPrice: '', specificationNotes: '' },
    ]);
  }
  function removeLine(key: number) {
    setLines((prev) =>
      prev.length > 1 ? prev.filter((l) => l.key !== key) : prev,
    );
  }

  const validLines = lines.filter((l) => l.itemId && Number(l.quantity) > 0);
  const canSubmit =
    !!title.trim() &&
    !!submissionDeadline &&
    validLines.length > 0 &&
    !submitting;
  const selectedProject =
    projects.find((project) => project.projectKickoffId === projectKickoffId) ??
    null;
  const selectedQuoteStageIntake =
    quoteStageOptions.find((intake) => intake.id === customerBomIntakeId) ??
    null;
  const includedOrderLineCount = selectedProject
    ? selectedProject.lines.filter(
        (line) => !excludedOrderLineIds.has(line.orderLineId),
      ).length
    : 0;

  function applySourcingLines(
    rows: Awaited<ReturnType<typeof getRfqSourcingLines>>,
  ) {
    setNoBomRequirements(rows.length === 0);
    setLines(
      rows.length > 0
        ? rows.map((row) => ({
            key: lineKeySeq++,
            itemId: row.itemId,
            quantity: row.requiredQuantity,
            targetPrice: '',
            specificationNotes: '',
          }))
        : [
            {
              key: lineKeySeq++,
              itemId: '',
              quantity: '',
              targetPrice: '',
              specificationNotes: '',
            },
          ],
    );
  }

  async function refreshSourcingLines(
    kickoffId: string,
    excluded: Set<string>,
  ) {
    if (!kickoffId) return;
    const requestId = ++sourcingRequest.current;
    setLoadingSourcingLines(true);
    try {
      const rows = await getRfqSourcingLines(kickoffId, [...excluded]);
      if (requestId === sourcingRequest.current) applySourcingLines(rows);
    } catch (err) {
      if (requestId === sourcingRequest.current) {
        toast.error(
          err instanceof ApiError
            ? err.message
            : 'Failed to explode the order BOM',
        );
      }
    } finally {
      if (requestId === sourcingRequest.current) setLoadingSourcingLines(false);
    }
  }

  function selectProject(value: string) {
    setProjectKickoffId(value);
    setCustomerBomIntakeId('');
    // A different order means a different set of lines — start fresh.
    setExcludedOrderLineIds(new Set());
    setNoBomRequirements(false);
    if (value) void refreshSourcingLines(value, new Set());
    else {
      sourcingRequest.current += 1;
      setLoadingSourcingLines(false);
      applySourcingLines([]);
      setNoBomRequirements(false);
    }
  }

  async function selectQuoteStageIntake(value: string) {
    setCustomerBomIntakeId(value);
    setProjectKickoffId('');
    setExcludedOrderLineIds(new Set());
    setNoBomRequirements(false);
    if (!value) return;
    setLoadingSourcingLines(true);
    try {
      applySourcingLines(await getRfqQuoteStageSourcingLines(value));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to load quote-stage BOM');
    } finally {
      setLoadingSourcingLines(false);
    }
  }

  async function openIntakeAttachment(attachmentId: string) {
    if (!customerBomIntakeId) return;
    try {
      const file = await getRfqQuoteStageAttachment(
        customerBomIntakeId,
        attachmentId,
      );
      window.open(file.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : 'Failed to open BOM intake attachment',
      );
    }
  }

  function toggleOrderLineExcluded(orderLineId: string) {
    const next = new Set(excludedOrderLineIds);
    if (next.has(orderLineId)) next.delete(orderLineId);
    else next.add(orderLineId);
    setExcludedOrderLineIds(next);
    if (projectKickoffId) void refreshSourcingLines(projectKickoffId, next);
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    const input: CreateRfqInput = {
      title: title.trim(),
      ...(projectKickoffId ? { projectKickoffId } : {}),
      ...(customerBomIntakeId ? { customerBomIntakeId } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      submissionDeadline: new Date(submissionDeadline).toISOString(),
      ...(requiredByDate ? { requiredByDate } : {}),
      ...(deliveryLocation.trim()
        ? { deliveryLocation: deliveryLocation.trim() }
        : {}),
      ...(paymentTermsRequested.trim()
        ? { paymentTermsRequested: paymentTermsRequested.trim() }
        : {}),
      lines: validLines.map((l, i) => ({
        itemId: l.itemId,
        quantity: Number(l.quantity),
        ...(l.targetPrice ? { targetPrice: Number(l.targetPrice) } : {}),
        ...(l.specificationNotes.trim()
          ? { specificationNotes: l.specificationNotes.trim() }
          : {}),
        sequence: i,
      })),
      ...(projectKickoffId && excludedOrderLineIds.size > 0
        ? { excludedOrderLineIds: Array.from(excludedOrderLineIds) }
        : {}),
    };
    try {
      const rfq = await createRfq(input);
      toast.success(`RFQ ${rfq.rfqNumber} created`);
      router.push(`/scm/rfqs/${rfq.id}`);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to create RFQ',
      );
      setSubmitting(false);
    }
  }

  return (
    <PageContainer>
      <div className="mb-4">
        <Link
          href="/scm/rfqs"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> RFQs
        </Link>
      </div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">New RFQ</h1>

      {loading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Project / Order ID" htmlFor="projectOrder">
                <Select
                  id="projectOrder"
                  value={projectKickoffId}
                  onChange={(event) => selectProject(event.target.value)}
                >
                  <option value="">Not linked to a project</option>
                  {projects.map((project) => (
                    <option
                      key={project.projectKickoffId}
                      value={project.projectKickoffId}
                    >
                      {project.orderNumber} — {project.projectName} —{' '}
                      {project.customerName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Or quote-stage customer BOM" htmlFor="quoteStageBom">
                <Select id="quoteStageBom" value={customerBomIntakeId} onChange={(event) => void selectQuoteStageIntake(event.target.value)}>
                  <option value="">Not linked to a quote-stage BOM</option>
                  {quoteStageOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.productName} — {option.opportunity.name} — Draft BOM Rev {option.bom?.revisionNumber ?? '—'}
                    </option>
                  ))}
                </Select>
              </Field>
              {selectedQuoteStageIntake && (
                <div className="rounded-lg border bg-muted/20 p-4">
                  <div className="flex items-center gap-2">
                    <FileText className="size-4 text-primary" />
                    <p className="font-semibold">Customer BOM attachments</p>
                  </div>
                  {selectedQuoteStageIntake.attachments.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      No customer files were attached to this BOM intake.
                    </p>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedQuoteStageIntake.attachments.map((attachment) => (
                        <Button
                          key={attachment.id}
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void openIntakeAttachment(attachment.id)}
                        >
                          <Download className="size-4" />
                          {attachment.fileName}
                        </Button>
                      ))}
                    </div>
                  )}
                  <p className="mt-3 text-xs text-muted-foreground">
                    Internal drafting evidence only. These files are not sent to
                    vendors unless SCM explicitly adds them as RFQ technical
                    attachments after the draft is created.
                  </p>
                </div>
              )}
              {selectedProject && (
                <div className="rounded-lg border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">
                        {selectedProject.orderNumber} ·{' '}
                        {selectedProject.projectName}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {selectedProject.customerName} · Order value{' '}
                        {formatINR(
                          selectedProject.orderTotal,
                          numberFormatStyle,
                        )}
                      </p>
                    </div>
                    <StatusBadge value={selectedProject.orderStatus} />
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {selectedProject.lines.map((line) => {
                      const excluded = excludedOrderLineIds.has(
                        line.orderLineId,
                      );
                      const lastIncluded =
                        !excluded && includedOrderLineCount <= 1;
                      return (
                        <div
                          key={line.orderLineId}
                          className={`flex items-start justify-between gap-2 rounded-md border bg-background p-3 text-sm ${
                            excluded ? 'opacity-60' : ''
                          }`}
                        >
                          <div className="min-w-0">
                            <p
                              className={`font-medium ${
                                excluded ? 'line-through' : ''
                              }`}
                            >
                              {line.productName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {line.productSku} · {line.quantity}{' '}
                              {line.unitOfMeasure} ·{' '}
                              {formatINR(line.lineTotal, numberFormatStyle)}
                            </p>
                            {excluded && (
                              <p className="mt-1 text-xs font-medium text-muted-foreground">
                                Excluded from this RFQ
                              </p>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="shrink-0"
                            onClick={() =>
                              toggleOrderLineExcluded(line.orderLineId)
                            }
                            disabled={lastIncluded}
                            aria-label={
                              excluded
                                ? 'Include this order line'
                                : 'Exclude this order line'
                            }
                            title={
                              lastIncluded
                                ? 'At least one order line must remain'
                                : excluded
                                  ? 'Include this line'
                                  : 'Exclude this line from the RFQ'
                            }
                          >
                            {excluded ? (
                              <RotateCcw className="size-4" />
                            ) : (
                              <Trash2 className="size-4" />
                            )}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Included order products are exploded through their released
                    BOMs. MAKE assemblies recurse; aggregated BUY components
                    populate the editable RFQ lines below. Excluding a product
                    removes its material contribution without changing the
                    order.
                  </p>
                </div>
              )}
              <Field label="Title" htmlFor="title" required>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Sheet metal fabrication — Q3 batch"
                />
              </Field>
              <Field label="Description" htmlFor="description">
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Submission Deadline" htmlFor="deadline" required>
                  <Input
                    id="deadline"
                    type="datetime-local"
                    value={submissionDeadline}
                    onChange={(e) => setSubmissionDeadline(e.target.value)}
                  />
                </Field>
                <Field label="Required By Date" htmlFor="requiredBy">
                  <Input
                    id="requiredBy"
                    type="date"
                    value={requiredByDate}
                    onChange={(e) => setRequiredByDate(e.target.value)}
                  />
                </Field>
                <Field label="Delivery Location" htmlFor="deliveryLocation">
                  <Input
                    id="deliveryLocation"
                    value={deliveryLocation}
                    onChange={(e) => setDeliveryLocation(e.target.value)}
                  />
                </Field>
                <Field label="Payment Terms Requested" htmlFor="paymentTerms">
                  <Input
                    id="paymentTerms"
                    value={paymentTermsRequested}
                    onChange={(e) => setPaymentTermsRequested(e.target.value)}
                    placeholder="e.g. Net 30"
                  />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">Line Items</CardTitle>
                {(selectedProject || customerBomIntakeId) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={loadingSourcingLines}
                    onClick={() => customerBomIntakeId
                      ? void selectQuoteStageIntake(customerBomIntakeId)
                      : void refreshSourcingLines(projectKickoffId, excludedOrderLineIds)}
                  >
                    <RotateCcw className="size-4" />
                    {loadingSourcingLines
                      ? 'Exploding BOM...'
                      : 'Reset from BOM'}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {noBomRequirements && selectedProject && (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  No released BOM with BUY requirements was found for the
                  included order products. You can add RFQ lines manually.
                </div>
              )}
              {lines.map((line) => {
                const item = items.find((it) => it.id === line.itemId) ?? null;
                return (
                  <div
                    key={line.key}
                    className="grid items-end gap-3 md:grid-cols-[minmax(220px,1.4fr)_120px_170px_minmax(220px,1fr)_40px]"
                  >
                    <Field label="Item">
                      <ItemPicker
                        items={items}
                        value={line.itemId}
                        onValueChange={(itemId) =>
                          updateLine(line.key, { itemId })
                        }
                      />
                    </Field>
                    <Field
                      label={`Qty${item ? ` (${item.baseUnitOfMeasure})` : ''}`}
                    >
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={line.quantity}
                        onChange={(e) =>
                          updateLine(line.key, { quantity: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Target Price (optional)">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Target unit price"
                        value={line.targetPrice}
                        onChange={(e) =>
                          updateLine(line.key, { targetPrice: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Specification Notes">
                      <Input
                        value={line.specificationNotes}
                        onChange={(e) =>
                          updateLine(line.key, {
                            specificationNotes: e.target.value,
                          })
                        }
                      />
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
                );
              })}
              <div className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addLine}
                >
                  <Plus className="size-4" /> Add line
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => router.push('/scm/rfqs')}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit}>
              {submitting ? 'Creating…' : 'Create RFQ'}
            </Button>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
