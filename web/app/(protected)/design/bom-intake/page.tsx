'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PencilRuler } from 'lucide-react';
import {
  DESIGN_REQUEST_STATUS_LABEL,
  intakeProgress,
  listDesignBomIntakes,
  type DesignBomIntakeRow,
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

/**
 * Whether the BOM is still owed. `status` is the intake's own lifecycle: it flips
 * from DESIGN_PENDING to CREATED at the moment the design team hands the parts
 * list over, which is also the moment SCM can float an RFQ from it.
 */
const isOwed = (row: DesignBomIntakeRow) => row.status === 'DESIGN_PENDING';

export default function DesignBomIntakeQueuePage() {
  const router = useRouter();
  const [rows, setRows] = useState<DesignBomIntakeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState('OWED');

  useEffect(() => {
    listDesignBomIntakes()
      .then(setRows)
      .catch(() => setError('Failed to load quote BOM requests'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () =>
      rows.filter((row) =>
        stateFilter === 'OWED'
          ? isOwed(row)
          : stateFilter === 'DONE'
            ? !isOwed(row)
            : true,
      ),
    [rows, stateFilter],
  );

  const register = useRegisterList(
    filtered,
    (row) =>
      `${row.productName} ${row.opportunity.name} ${row.opportunity.customer?.name ?? ''} ${row.designRequest?.requestNumber ?? ''} ${row.businessUnit.name}`,
  );

  return (
    <SignalPage>
      <SignalHeader
        title="Quote BOM Requests"
        description="Quote-stage work Sales has raised for design: the customer stated a requirement, so the product has to be designed and its BOM authored before SCM has anything to source."
      />
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
        <RegisterToolbar
          title="Design Queue"
          search={register.search}
          onSearchChange={register.setSearch}
          searchPlaceholder="Search product, customer or request number"
        >
          <Select
            aria-label="State"
            className="w-full sm:w-56"
            value={stateFilter}
            onChange={(event) => setStateFilter(event.target.value)}
          >
            <option value="OWED">BOM still owed</option>
            <option value="DONE">Handed over</option>
            <option value="">All</option>
          </Select>
        </RegisterToolbar>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <SCard className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product to design</TableHead>
                <TableHead>Opportunity</TableHead>
                <TableHead>Request</TableHead>
                <TableHead>Design status</TableHead>
                <TableHead>Needed by</TableHead>
                <TableHead>BOM</TableHead>
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
                      icon={PencilRuler}
                      title="Nothing waiting on design"
                      description="Sales raises these from a BOM intake when the customer described a requirement instead of handing over a parts list."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                register.visibleItems.map((row) => {
                  // The promised-price date is the real deadline the design work
                  // sits inside, so overdue is worth shouting about here too.
                  const progress = intakeProgress(
                    row.createdAt,
                    row.expectedBy,
                  );
                  return (
                    <TableRow
                      key={row.id}
                      className="cursor-pointer"
                      onClick={() =>
                        router.push(`/design/bom-intake/${row.id}`)
                      }
                    >
                      <TableCell className="font-medium">
                        {row.productName}
                      </TableCell>
                      <TableCell>
                        {row.opportunity.name}
                        {row.opportunity.customer
                          ? ` · ${row.opportunity.customer.name}`
                          : ''}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {row.designRequest?.requestNumber ?? '—'}
                      </TableCell>
                      <TableCell>
                        {row.designRequest ? (
                          <ToneChip
                            tone={
                              row.designRequest.status === 'REJECTED'
                                ? 'danger'
                                : row.designRequest.status === 'OPEN'
                                  ? 'warning'
                                  : 'info'
                            }
                          >
                            {
                              DESIGN_REQUEST_STATUS_LABEL[
                                row.designRequest.status
                              ]
                            }
                          </ToneChip>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {row.designRequest
                          ? new Date(
                              row.designRequest.targetDate,
                            ).toLocaleDateString('en-IN')
                          : '—'}
                        {progress?.overdue && isOwed(row) && (
                          <span className="ml-2 text-[11px] font-semibold text-destructive">
                            {progress.label}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.bom ? (
                          <ToneChip tone="success">
                            Rev {row.bom.revisionNumber} handed over
                          </ToneChip>
                        ) : (
                          <ToneChip tone="warning">Owed</ToneChip>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
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
