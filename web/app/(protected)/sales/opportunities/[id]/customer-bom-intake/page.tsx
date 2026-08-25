'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Plus, Search, Trash2, Upload } from 'lucide-react';
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
import { Field } from '../../../../../components/ui/field';
import { useToast } from '../../../../../components/ui/toaster';

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
});

export default function CustomerBomIntakePage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [businessUnits, setBusinessUnits] = useState<BusinessUnit[]>([]);
  const [businessUnitId, setBusinessUnitId] = useState('');
  const [productName, setProductName] = useState('');
  const [unitOfMeasure, setUnitOfMeasure] = useState('each');
  const [targetMarginPercent, setTargetMarginPercent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
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
    lines.length > 0 &&
    lines.every(
      (line) =>
        line.description.trim() &&
        Number(line.quantity) > 0 &&
        line.searchedDescription === line.description.trim() &&
        !!line.existingItemId !== line.confirmCreateNew,
    );

  async function submit() {
    if (!ready) return;
    setSubmitting(true);
    try {
      let uploadedFile: { fileKey: string; fileName: string } | undefined;
      if (file) {
        const signed = await customerBomUploadUrl(id, {
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          fileSize: file.size,
        });
        await uploadToPresignedUrl(signed.uploadUrl, file);
        uploadedFile = { fileKey: signed.fileKey, fileName: file.name };
      }
      await createCustomerBomIntake(id, {
        businessUnitId,
        productName: productName.trim(),
        unitOfMeasure,
        ...(targetMarginPercent !== ''
          ? { targetMarginPercent: Number(targetMarginPercent) }
          : {}),
        ...uploadedFile,
        lines: lines.map((line) => ({
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
        'Customer BOM created as real Product, Items, and Draft BOM',
      );
      setCreatedIntakes(await listCustomerBomIntakes(id));
      setFile(null);
      setProductName('');
      setTargetMarginPercent('');
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
          <SCardTitle title="Customer document and product" />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Customer BOM file (optional)">
              <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm">
                <Upload className="size-4" />{' '}
                {file?.name ?? 'Choose Excel or PDF'}
                <input
                  type="file"
                  className="sr-only"
                  accept=".pdf,.xls,.xlsx,.csv"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
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
          </div>
        </SCard>

        <SCard className="px-5 py-[18px]">
          <SCardTitle
            title="Customer BOM lines"
            subtitle="Search Item Master for every line before choosing an existing match or explicitly creating new."
            right={
              <Button
                type="button"
                variant="outline"
                onClick={() => setLines((current) => [...current, emptyLine()])}
              >
                <Plus className="size-4" /> Add line
              </Button>
            }
          />
          <div className="mt-4 space-y-4">
            {lines.map((line, index) => (
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
                        patchLine(line.key, { quantity: event.target.value })
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
                {line.searchedDescription && (
                  <div className="mt-3 rounded-md bg-black/[.03] p-3 text-sm dark:bg-white/[.03]">
                    <p className="mb-2 font-medium">
                      Candidate Item Master matches
                    </p>
                    {line.candidates.length ? (
                      line.candidates.map((candidate) => (
                        <label
                          key={candidate.id}
                          className="mb-2 flex cursor-pointer items-center gap-2 rounded border p-2"
                        >
                          <input
                            type="radio"
                            name={`resolution-${line.key}`}
                            checked={line.existingItemId === candidate.id}
                            onChange={() =>
                              patchLine(line.key, {
                                existingItemId: candidate.id,
                                confirmCreateNew: false,
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
                    <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed p-2">
                      <input
                        type="radio"
                        name={`resolution-${line.key}`}
                        checked={line.confirmCreateNew}
                        onChange={() =>
                          patchLine(line.key, {
                            existingItemId: '',
                            confirmCreateNew: true,
                          })
                        }
                      />
                      None of these match — create a new Component item
                    </label>
                  </div>
                )}
              </div>
            ))}
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
                      Live BOM estimate:{' '}
                      <strong>
                        {intake.liveBomCostEstimate
                          ? `₹${intake.liveBomCostEstimate}`
                          : 'Awaiting item costs'}
                      </strong>
                    </p>
                    <p className="text-muted-foreground">
                      Suggested unit price:{' '}
                      {intake.suggestedUnitPrice
                        ? `₹${intake.suggestedUnitPrice}`
                        : 'Set margin / award RFQ'}
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
