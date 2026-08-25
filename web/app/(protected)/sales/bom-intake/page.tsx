'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PackageSearch } from 'lucide-react';
import { apiFetch } from '../../../lib/api';
import type { Customer, Opportunity, PaginatedResult } from '../../../lib/types';
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
  SIGNAL_BTN_GHOST,
  SIGNAL_BTN_PRIMARY,
  SIGNAL_DIALOG,
  SIGNAL_DIALOG_TITLE,
  SignalHeader,
  SignalPage,
  ToneChip,
} from '../../../components/ui/signal';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Field } from '../../../components/ui/field';
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
  const [showNew, setShowNew] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [allOpportunities, setAllOpportunities] = useState<Opportunity[]>([]);
  const [newCustomerId, setNewCustomerId] = useState('');
  const [newOpportunityId, setNewOpportunityId] = useState('');

  useEffect(() => {
    listBomIntakeRegister()
      .then(setRows)
      .catch(() => setError('Failed to load BOM intake requests'))
      .finally(() => setLoading(false));
    // For the customer-first "New BOM Intake" flow. Same list endpoints the
    // rest of Sales uses; failures leave the dialog empty but the register up.
    apiFetch<PaginatedResult<Customer>>('/customers?page=1&limit=100')
      .then((res) => setCustomers(res.items))
      .catch(() => undefined);
    apiFetch<PaginatedResult<Opportunity>>('/opportunities?page=1&limit=100')
      .then((res) => setAllOpportunities(res.items))
      .catch(() => undefined);
  }, []);

  const customerOpportunities = useMemo(
    () =>
      newCustomerId
        ? allOpportunities.filter((opp) => opp.customerId === newCustomerId)
        : [],
    [allOpportunities, newCustomerId],
  );

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
        actions={
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className={SIGNAL_BTN_PRIMARY}
          >
            New BOM Intake
          </button>
        }
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

      {/* Customer-first entry: pick the customer, then one of their
          opportunities — the intake itself stays opportunity-scoped. */}
      <Dialog open={showNew} onOpenChange={(open) => !open && setShowNew(false)}>
        <DialogContent className={SIGNAL_DIALOG}>
          <DialogHeader>
            <DialogTitle className={SIGNAL_DIALOG_TITLE}>
              New BOM Intake
            </DialogTitle>
            <DialogDescription>
              Turn a customer file into traceable Items, a Product, and a
              quote-stage BOM for SCM sourcing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Customer" required>
              <Select
                value={newCustomerId}
                onChange={(event) => {
                  setNewCustomerId(event.target.value);
                  setNewOpportunityId('');
                }}
              >
                <option value="">Select a customer…</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Opportunity"
              required
              hint="The intake is raised against one of this customer's opportunities."
            >
              <Select
                value={newOpportunityId}
                onChange={(event) => setNewOpportunityId(event.target.value)}
                disabled={!newCustomerId}
              >
                <option value="">
                  {newCustomerId
                    ? customerOpportunities.length
                      ? 'Select an opportunity…'
                      : 'No opportunities for this customer'
                    : 'Pick a customer first'}
                </option>
                {customerOpportunities.map((opp) => (
                  <option key={opp.id} value={opp.id}>
                    {opp.name} · {opp.stage.replaceAll('_', ' ')}
                  </option>
                ))}
              </Select>
            </Field>
            {newCustomerId && customerOpportunities.length === 0 && (
              <p className="text-[12px] text-black/45 dark:text-white/45">
                This customer has no opportunities yet — create one under
                Sales → Opportunities first.
              </p>
            )}
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setShowNew(false)}
              className={SIGNAL_BTN_GHOST}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!newOpportunityId}
              onClick={() =>
                router.push(
                  `/sales/opportunities/${newOpportunityId}/customer-bom-intake`,
                )
              }
              className={SIGNAL_BTN_PRIMARY}
            >
              Continue
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SignalPage>
  );
}
