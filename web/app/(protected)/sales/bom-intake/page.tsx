'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PackageSearch } from 'lucide-react';
import {
  INTAKE_STATUS_LABEL,
  INTAKE_STATUS_TONE,
  listBomIntakeRegister,
  type BomIntakeRegisterRow,
  type IntakeDerivedStatus,
} from '../../../lib/customer-bom-intake';
import { useRegisterList } from '../../../lib/use-register-list';
import {
  SCard,
  SignalHeader,
  SignalPage,
  ToneChip,
} from '../../../components/ui/signal';
import { RegisterToolbar } from '../../../components/ui/register-toolbar';
import { RegisterPagination } from '../../../components/ui/register-pagination';
import { Select } from '../../../components/ui/select';
import { Skeleton } from '../../../components/ui/skeleton';
import { EmptyState } from '../../../components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';

export default function BomIntakeRegisterPage() {
  const router = useRouter();
  const [rows, setRows] = useState<BomIntakeRegisterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [opportunityFilter, setOpportunityFilter] = useState('');

  useEffect(() => {
    listBomIntakeRegister()
      .then(setRows)
      .catch(() => setError('Failed to load BOM intake requests'))
      .finally(() => setLoading(false));
  }, []);

  const opportunities = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows)
      if (!seen.has(row.opportunity.id))
        seen.set(row.opportunity.id, row.opportunity.name);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filtered = useMemo(
    () =>
      rows.filter(
        (row) =>
          (!statusFilter || row.derivedStatus === statusFilter) &&
          (!opportunityFilter || row.opportunity.id === opportunityFilter),
      ),
    [rows, statusFilter, opportunityFilter],
  );

  const register = useRegisterList(
    filtered,
    (row) =>
      `${row.productName} ${row.product?.sku ?? ''} ${row.opportunity.name} ${row.opportunity.customer?.name ?? ''} ${INTAKE_STATUS_LABEL[row.derivedStatus]} ${row.businessUnit.name}`,
  );

  return (
    <SignalPage>
      <SignalHeader
        title="Open BOM Intake"
        description="Every quote-stage customer BOM Sales has raised — follow each from draft transcription through RFQ pricing to R&D release."
      />
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
        <RegisterToolbar
          title="Intake Register"
          search={register.search}
          onSearchChange={register.setSearch}
          searchPlaceholder="Search product, opportunity or customer"
        >
          <Select
            aria-label="Status"
            className="w-full sm:w-52"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">All statuses</option>
            {(
              Object.keys(INTAKE_STATUS_LABEL) as IntakeDerivedStatus[]
            ).map((status) => (
              <option key={status} value={status}>
                {INTAKE_STATUS_LABEL[status]}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Opportunity"
            className="w-full sm:w-60"
            value={opportunityFilter}
            onChange={(event) => setOpportunityFilter(event.target.value)}
          >
            <option value="">All opportunities</option>
            {opportunities.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </RegisterToolbar>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <SCard className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Opportunity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Rev</TableHead>
                <TableHead>Raised by</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, row) => (
                  <TableRow key={row}>
                    {Array.from({ length: 6 }).map((__, column) => (
                      <TableCell key={column}>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : register.visibleItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="p-0">
                    <EmptyState
                      icon={PackageSearch}
                      title="No BOM intake requests match your filters"
                      description="Sales raises quote-stage customer BOMs from an opportunity's Customer BOM Intake page."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                register.visibleItems.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/sales/bom-intake/${row.id}`)}
                  >
                    <TableCell className="font-medium">
                      {row.product?.sku ? `${row.product.sku} · ` : ''}
                      {row.productName}
                    </TableCell>
                    <TableCell>
                      {row.opportunity.name}
                      {row.opportunity.customer
                        ? ` · ${row.opportunity.customer.name}`
                        : ''}
                    </TableCell>
                    <TableCell>
                      <ToneChip tone={INTAKE_STATUS_TONE[row.derivedStatus]}>
                        {INTAKE_STATUS_LABEL[row.derivedStatus]}
                      </ToneChip>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {row.bom ? `Rev ${row.bom.revisionNumber}` : '—'}
                    </TableCell>
                    <TableCell>
                      {row.createdBy.firstName} {row.createdBy.lastName}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {new Date(row.createdAt).toLocaleDateString('en-IN')}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </SCard>

        <RegisterPagination
          page={register.page}
          pageCount={register.pageCount}
          onPageChange={register.setPage}
          disabled={loading}
        />
      </div>
    </SignalPage>
  );
}
