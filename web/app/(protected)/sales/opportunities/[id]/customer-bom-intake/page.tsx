'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Check, PencilRuler, Plus, Search, Trash2, Upload } from 'lucide-react';
import { ApiError } from '../../../../../lib/api';
import {
  createCustomerBomIntake,
  customerBomUploadUrl,
  findCustomerBomMatches,
  listCustomerBomIntakes,
  type CustomerBomCandidate,
  type CustomerBomIntake,
} from '../../../../../lib/customer-bom-intake';
import { uploadToPresignedUrl } from '../../../../../lib/vault-api';
import { businessUnitOptions } from '../../../../../lib/business-units';
import type { BusinessUnit } from '../../../../../lib/types';
import {
  SCard,
  SCardTitle,
  SignalHeader,
  SignalPage,
} from '../../../../../components/ui/signal';
import { Button } from '../../../../../components/ui/button';
import { Input } from '../../../../../components/ui/input';
import { Select } from '../../../../../components/ui/select';
import { Textarea } from '../../../../../components/ui/textarea';
import { Field } from '../../../../../components/ui/field';
import { useToast } from '../../../../../components/ui/toaster';
import { cn } from '../../../../../lib/utils';

interface DraftLine {
  key: number;
  description: string;
  customerPartReference: string;
  quantity: string;
  unitOfMeasure: string;
  searchedDescription: string | null;
  candidates: CustomerBomCandidate[];
  existingItemId: string;
  confirmCreateNew: boolean;
  searching: boolean;
  /**
   * Keeps the candidate list open on a line that is already resolved, so
   * "Change" can reopen it. Resolving closes it again — the collapsed summary
   * is what tells the user their pick registered.
   */
  changing: boolean;
}

let lineKey = 1;
const emptyLine = (): DraftLine => ({
  key: lineKey++,
  description: '',
  customerPartReference: '',
  quantity: '1',
  unitOfMeasure: 'each',
  searchedDescription: null,
  candidates: [],
  existingItemId: '',
  confirmCreateNew: false,
  searching: false,
  changing: false,
});

export default function CustomerBomIntakePage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [businessUnits, setBusinessUnits] = useState<BusinessUnit[]>([]);
  const [businessUnitId, setBusinessUnitId] = useState('');
  const [productName, setProductName] = useState('');
  const [unitOfMeasure, setUnitOfMeasure] = useState('each');
  const [targetMarginPercent, setTargetMarginPercent] = useState('');
  const [expectedBy, setExpectedBy] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  /**
   * The customer stated a requirement rather than handing over a parts list, so
   * there is nothing to transcribe: the design team designs the product and
   * authors the BOM, and only then does SCM have anything to source.
   */
  const [requiresDesign, setRequiresDesign] = useState(false);
  /**
   * The brief, raised with the intake. Asked for here rather than one screen
   * later because it is the whole content of the design request — an intake with
   * no brief is invisible to the design team and nothing announces it.
   */
  const [designBrief, setDesignBrief] = useState('');
  const [designPriority, setDesignPriority] = useState('MEDIUM');
  const [designTargetDate, setDesignTargetDate] = useState('');
  // Lazy: the initialiser runs on every render otherwise, burning line keys.
  const [lines, setLines] = useState<DraftLine[]>(() => [emptyLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [createdIntakes, setCreatedIntakes] = useState<CustomerBomIntake[]>([]);

  useEffect(() => {
    void businessUnitOptions()
      .then(setBusinessUnits)
      .catch(() => toast.error('Failed to load business units'));
  }, [toast]);

  useEffect(() => {
    void listCustomerBomIntakes(id)
      .then(setCreatedIntakes)
      .catch(() => undefined);
  }, [id]);

  const patchLine = (key: number, patch: Partial<DraftLine>) =>
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );

  async function searchLine(line: DraftLine) {
    if (line.description.trim().length < 2) {
      toast.error('Enter at least two characters before searching');
      return;
    }
    patchLine(line.key, {
      searching: true,
      existingItemId: '',
      confirmCreateNew: false,
      changing: false,
    });
    try {
      const candidates = await findCustomerBomMatches(
        id,
        line.description.trim(),
      );
      patchLine(line.key, {
        searching: false,
        candidates,
        searchedDescription: line.description.trim(),
      });
    } catch (error) {
      patchLine(line.key, { searching: false });
      toast.error(error instanceof ApiError ? error.message : 'Search failed');
    }
  }

  const ready =
    !!productName.trim() &&
    !!businessUnitId &&
    // In design mode the lines are the design team's to author (the server
    // refuses any sent with the flag), but the brief and a deadline are not
    // optional: they are what the design request is made of.
    (requiresDesign
      ? designBrief.trim().length >= 20 && !!(designTargetDate || expectedBy)
      : (lines.length > 0 &&
        lines.every(
          (line) =>
            line.description.trim() &&
            Number(line.quantity) > 0 &&
            line.searchedDescription === line.description.trim() &&
            !!line.existingItemId !== line.confirmCreateNew,
        )));

  async function submit() {
    if (!ready) return;
    setSubmitting(true);
    try {
      const uploadedFiles = await Promise.all(
        files.map(async (file) => {
          const signed = await customerBomUploadUrl(id, {
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            fileSize: file.size,
          });
          await uploadToPresignedUrl(signed.uploadUrl, file);
          return { fileKey: signed.fileKey, fileName: file.name };
        }),
      );
      await createCustomerBomIntake(id, {
        businessUnitId,
        productName: productName.trim(),
        unitOfMeasure,
        ...(targetMarginPercent !== ''
          ? { targetMarginPercent: Number(targetMarginPercent) }
          : {}),
        // Date-only promise, stored at UTC midnight so it reads back as the same
        // calendar day everywhere (the repo's dateOnlyStr convention).
        ...(expectedBy !== ''
          ? { expectedBy: `${expectedBy}T00:00:00.000Z` }
          : {}),
        ...(uploadedFiles.length > 0 ? { attachments: uploadedFiles } : {}),
        ...(requiresDesign
          ? {
              requiresDesign: true,
              design: {
                description: designBrief.trim(),
                priority: designPriority,
                // Omitted falls back to expectedBy server-side; `ready` has
                // already established that one of the two exists.
                ...(designTargetDate
                  ? { targetDate: `${designTargetDate}T00:00:00.000Z` }
                  : {}),
              },
            }
          : {}),
        lines: requiresDesign
          ? []
          : lines.map((line) => ({
              description: line.description.trim(),
              ...(line.customerPartReference.trim()
                ? { customerPartReference: line.customerPartReference.trim() }
                : {}),
              quantity: Number(line.quantity),
              unitOfMeasure: line.unitOfMeasure,
              ...(line.existingItemId
                ? { existingItemId: line.existingItemId }
                : {}),
              confirmCreateNew: line.confirmCreateNew,
            })),
      });
      toast.success(
        requiresDesign
          ? 'Raised with the design team — they will hand the BOM back for SCM to source'
          : 'Customer BOM created as real Product, Items, and Draft BOM',
      );
      setCreatedIntakes(await listCustomerBomIntakes(id));
      setFiles([]);
      setProductName('');
      setTargetMarginPercent('');
      setExpectedBy('');
      setDesignBrief('');
      setDesignTargetDate('');
      setLines([emptyLine()]);
      setSubmitting(false);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'BOM intake failed',
      );
      setSubmitting(false);
    }
  }

  return (
    <SignalPage>
      <SignalHeader
        backHref={`/sales/opportunities/${id}`}
        backLabel="Opportunity"
        title="Customer BOM Intake"
        description="Transcribe the customer's parts list without entering engineering classifications or internal costs."
      />
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
        <SCard className="px-5 py-[18px]">
          <SCardTitle
            title="What did the customer give you?"
            subtitle="A parts list is transcribed here and goes straight to SCM. A requirement has to be designed first — the design team authors the BOM and hands it back."
          />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {(
              [
                {
                  value: false,
                  title: 'A parts list',
                  detail:
                    'Transcribe the customer\u2019s lines against Item Master. Creates a Draft BOM SCM can float an RFQ from immediately.',
                },
                {
                  value: true,
                  title: 'A requirement to design',
                  detail:
                    'Raises the work for the design team. The product is created now so the quote has something to hang off; SCM sees it only once the designed BOM is handed over.',
                },
              ] as const
            ).map((mode) => (
              <label
                key={String(mode.value)}
                className={cn(
                  'flex cursor-pointer gap-2.5 rounded-lg border p-3.5 text-sm',
                  requiresDesign === mode.value &&
                    'border-primary bg-primary/[.06]',
                )}
              >
                <input
                  type="radio"
                  name="intake-mode"
                  className="mt-1"
                  checked={requiresDesign === mode.value}
                  onChange={() => setRequiresDesign(mode.value)}
                />
                <span>
                  <strong>{mode.title}</strong>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {mode.detail}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </SCard>

        <SCard className="px-5 py-[18px]">
          <SCardTitle title="Customer document and product" />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Customer BOM attachments (optional)" hint="Up to 10 PDF, Excel or CSV files">
              <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm">
                <Upload className="size-4" />{' '}
                {files.length > 0
                  ? `${files.length} file${files.length === 1 ? '' : 's'} selected`
                  : 'Choose PDF or spreadsheet files'}
                <input
                  type="file"
                  className="sr-only"
                  accept=".pdf,.xls,.xlsx,.csv"
                  multiple
                  onChange={(event) =>
                    setFiles(Array.from(event.target.files ?? []).slice(0, 10))
                  }
                />
              </label>
            </Field>
            <Field label="Business Unit" required>
              <Select
                value={businessUnitId}
                onChange={(event) => setBusinessUnitId(event.target.value)}
              >
                <option value="">Select business unit</option>
                {businessUnits.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Product name" required>
              <Input
                value={productName}
                onChange={(event) => setProductName(event.target.value)}
              />
            </Field>
            <Field label="Product unit" required>
              <Input
                value={unitOfMeasure}
                onChange={(event) => setUnitOfMeasure(event.target.value)}
              />
            </Field>
            <Field label="Target margin % (optional)">
              <Input
                type="number"
                min="0"
                max="99.99"
                step="0.01"
                value={targetMarginPercent}
                onChange={(event) => setTargetMarginPercent(event.target.value)}
              />
            </Field>
            <Field
              label="Price promised to customer by (optional)"
              hint="Drives the turnaround progress bar on the Open BOM Intake register. Editable later."
            >
              <Input
                type="date"
                value={expectedBy}
                onChange={(event) => setExpectedBy(event.target.value)}
              />
            </Field>
          </div>
        </SCard>

        {requiresDesign ? (
          <SCard className="px-5 py-[18px]">
            <SCardTitle
              title="Design brief"
              subtitle="There is nothing to transcribe yet, so no BOM is created here. This brief is what the design team works from — it goes to them the moment you save."
            />
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field
                label="What the customer asked for"
                required
                hint={`At least 20 characters — the design team has nothing else to go on. ${designBrief.trim().length}/20`}
                className="md:col-span-2"
              >
                <Textarea
                  rows={4}
                  value={designBrief}
                  onChange={(event) => setDesignBrief(event.target.value)}
                  placeholder="Duty, dimensions, standards to meet, interfaces, anything the customer specified or ruled out."
                />
              </Field>
              <Field label="Priority" required>
                <Select
                  value={designPriority}
                  onChange={(event) => setDesignPriority(event.target.value)}
                >
                  {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Design needed by"
                required={!expectedBy}
                hint={
                  expectedBy
                    ? 'Leave blank to use the promised price date above.'
                    : 'Set this, or the promised price date above.'
                }
              >
                <Input
                  type="date"
                  value={designTargetDate}
                  onChange={(event) => setDesignTargetDate(event.target.value)}
                />
              </Field>
            </div>
            <div className="mt-4 flex gap-2.5 rounded-lg border border-primary/40 bg-primary/[.06] p-3.5 text-sm">
              <PencilRuler className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="space-y-1.5">
                <p>
                  Saving registers the finished good and the catalog product, and
                  raises the design request — the design heads are notified and
                  the work appears in their{' '}
                  <strong>Quote BOM Requests</strong> queue.
                </p>
                <p className="text-muted-foreground">
                  When the design team hands the BOM back, the intake becomes
                  available to SCM for RFQ exactly like a transcribed one.
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button
                disabled={!ready || submitting}
                onClick={() => void submit()}
              >
                {submitting
                  ? 'Raising with design\u2026'
                  : 'Create Product & send to design team'}
              </Button>
            </div>
          </SCard>
        ) : (
          <SCard className="px-5 py-[18px]">
            <SCardTitle
              title="Customer BOM lines"
              subtitle="Search Item Master for every line before choosing an existing match or explicitly creating new."
              right={
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setLines((current) => [...current, emptyLine()])
                  }
                >
                  <Plus className="size-4" /> Add line
                </Button>
              }
            />
            <div className="mt-4 space-y-4">
              {lines.map((line, index) => {
                const pickedCandidate =
                  line.candidates.find(
                    (candidate) => candidate.id === line.existingItemId,
                  ) ?? null;
                const resolved = !!pickedCandidate || line.confirmCreateNew;
                // Searched but unresolved, or explicitly reopened via "Change".
                const showCandidates =
                  !!line.searchedDescription && (!resolved || line.changing);
                return (
                  <div key={line.key} className="rounded-lg border p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <strong className="text-sm">Line {index + 1}</strong>
                      {lines.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setLines((current) =>
                              current.filter((item) => item.key !== line.key),
                            )
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                    <div className="grid gap-3 md:grid-cols-[2fr_1fr_0.7fr_0.8fr_auto]">
                      <Field label="Description" required>
                        <Input
                          value={line.description}
                          onChange={(event) =>
                            patchLine(line.key, {
                              description: event.target.value,
                              searchedDescription: null,
                              candidates: [],
                              existingItemId: '',
                              confirmCreateNew: false,
                              changing: false,
                            })
                          }
                        />
                      </Field>
                      <Field label="Customer part ref">
                        <Input
                          value={line.customerPartReference}
                          onChange={(event) =>
                            patchLine(line.key, {
                              customerPartReference: event.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field label="Quantity" required>
                        <Input
                          type="number"
                          min="0.0001"
                          step="any"
                          value={line.quantity}
                          onChange={(event) =>
                            patchLine(line.key, {
                              quantity: event.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field label="Unit" required>
                        <Input
                          value={line.unitOfMeasure}
                          onChange={(event) =>
                            patchLine(line.key, {
                              unitOfMeasure: event.target.value,
                            })
                          }
                        />
                      </Field>
                      <div className="pt-6">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={line.searching}
                          onClick={() => void searchLine(line)}
                        >
                          <Search className="size-4" />{' '}
                          {line.searching ? 'Searching' : 'Search'}
                        </Button>
                      </div>
                    </div>
                    {showCandidates && (
                      <div className="mt-3 rounded-md bg-black/[.03] p-3 text-sm dark:bg-white/[.03]">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="font-medium">
                            Candidate Item Master matches
                          </p>
                          {line.changing && (
                            // Re-clicking the already-selected radio fires no change
                            // event, so reopening needs its own way back out.
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                patchLine(line.key, { changing: false })
                              }
                            >
                              Cancel
                            </Button>
                          )}
                        </div>
                        {line.candidates.length ? (
                          line.candidates.map((candidate) => (
                            <label
                              key={candidate.id}
                              className={cn(
                                'mb-2 flex cursor-pointer items-center gap-2 rounded border p-2',
                                line.existingItemId === candidate.id &&
                                  'border-primary bg-primary/[.08]',
                              )}
                            >
                              <input
                                type="radio"
                                name={`resolution-${line.key}`}
                                checked={line.existingItemId === candidate.id}
                                onChange={() =>
                                  patchLine(line.key, {
                                    existingItemId: candidate.id,
                                    confirmCreateNew: false,
                                    changing: false,
                                  })
                                }
                              />
                              <span>
                                <strong>{candidate.itemCode}</strong> —{' '}
                                {candidate.name}{' '}
                                <span className="text-xs text-muted-foreground">
                                  ({Math.round(candidate.score * 100)}% match)
                                </span>
                              </span>
                            </label>
                          ))
                        ) : (
                          <p className="mb-2 text-muted-foreground">
                            No likely matches found.
                          </p>
                        )}
                        <label
                          className={cn(
                            'flex cursor-pointer items-center gap-2 rounded border border-dashed p-2',
                            line.confirmCreateNew &&
                              'border-primary bg-primary/[.08]',
                          )}
                        >
                          <input
                            type="radio"
                            name={`resolution-${line.key}`}
                            checked={line.confirmCreateNew}
                            onChange={() =>
                              patchLine(line.key, {
                                existingItemId: '',
                                confirmCreateNew: true,
                                changing: false,
                              })
                            }
                          />
                          None of these match — create a new Component item
                        </label>
                      </div>
                    )}
                    {resolved && !line.changing && (
                      // Collapsed confirmation: the candidate list closing, and this
                      // line naming what the pick resolved to, is the only signal
                      // that the choice registered — a radio dot in a list of eight
                      // near-identical fuzzy matches reads as nothing happening.
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/[.06] p-3 text-sm">
                        <span className="flex items-center gap-2">
                          <Check className="size-4 shrink-0 text-primary" />
                          {pickedCandidate ? (
                            <span>
                              Matched to{' '}
                              <strong>{pickedCandidate.itemCode}</strong> —{' '}
                              {pickedCandidate.name}
                            </span>
                          ) : (
                            <span>
                              New Component item will be created for{' '}
                              <strong>{line.searchedDescription}</strong>
                            </span>
                          )}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            patchLine(line.key, { changing: true })
                          }
                        >
                          Change
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="flex justify-end">
                <Button
                  disabled={!ready || submitting}
                  onClick={() => void submit()}
                >
                  {submitting
                    ? 'Creating records…'
                    : 'Create Product & Draft BOM'}
                </Button>
              </div>
            </div>
          </SCard>
        )}

        {createdIntakes.length > 0 && (
          <SCard className="px-5 py-[18px]">
            <SCardTitle title="Quote-stage BOMs" />
            <div className="mt-4 space-y-3">
              {createdIntakes.map((intake) => (
                <div
                  key={intake.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm"
                >
                  <div>
                    <strong>{intake.productName}</strong>
                    <p className="text-muted-foreground">
                      BOM {intake.bom?.status ?? '—'} ·{' '}
                      {intake.rawFileName ?? 'Manual entry — no file attached'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p>
                      Suggested unit price:{' '}
                      <strong>
                        {intake.suggestedUnitPrice
                          ? `₹${intake.suggestedUnitPrice}`
                          : 'Set margin / award RFQ'}
                      </strong>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </SCard>
        )}
      </div>
    </SignalPage>
  );
}
