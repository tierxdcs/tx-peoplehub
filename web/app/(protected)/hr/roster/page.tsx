'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth-context';
import { apiFetch } from '../../../lib/api';
import {
  AccessStatus,
  EmployeeRoster,
  EmployeeRosterAdmin,
  PaginatedResult,
  Vertical,
} from '../../../lib/types';
import { SCard, SignalHeader, SignalPage } from '../../../components/ui/signal';
import { Select } from '../../../components/ui/select';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { StatusBadge } from '../../../components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { Skeleton } from '../../../components/ui/skeleton';
import { RegisterToolbar } from '../../../components/ui/register-toolbar';
import { RegisterPagination } from '../../../components/ui/register-pagination';
import { SensitiveDetailPanel } from './_components/sensitive-detail-panel';
import { useIsHrStaff } from '../../../lib/use-is-hr-staff';

export default function RosterPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { isHrStaff } = useIsHrStaff();
  // HR Managers get the same roster capabilities as Admins here: the Sensitive
  // Info column, "View sensitive details", and Edit. The backend enforces the
  // identical "Admin or HR Manager" rule on every endpoint these use.
  const isAdmin =
    user?.role === 'ADMIN' ||
    user?.role === 'SUPER_ADMIN' ||
    (isHrStaff && user?.role === 'MANAGER');

  const [items, setItems] = useState<(EmployeeRoster | EmployeeRosterAdmin)[]>(
    [],
  );
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [verticalFilter, setVerticalFilter] = useState('');
  const [accessStatusFilter, setAccessStatusFilter] = useState<
    AccessStatus | ''
  >('ACTIVE');
  const [territoryFilter, setTerritoryFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailTarget, setDetailTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rosterRes, verticalsRes] = await Promise.all([
        apiFetch<PaginatedResult<EmployeeRoster | EmployeeRosterAdmin>>(
          `/employees/roster?page=${page}&limit=${limit}`,
        ),
        apiFetch<Vertical[]>('/verticals'),
      ]);
      setItems(rosterRes.items);
      setTotal(rosterRes.total);
      setVerticals(verticalsRes);
    } catch {
      setError('Failed to load roster');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const verticalName = (id: string | null) =>
    verticals.find((v) => v.id === id)?.name ?? '—';

  // The status shown (and filtered on): an offboarded employee (status
  // INACTIVE) reads INACTIVE regardless of accessStatus, since login requires
  // BOTH to be ACTIVE. Keeps the badge and the filter in lockstep.
  const effectiveStatus = (
    e: EmployeeRoster | EmployeeRosterAdmin,
  ): AccessStatus => (e.status === 'INACTIVE' ? 'INACTIVE' : e.accessStatus);

  const filtered = items.filter((e) => {
    if (verticalFilter && e.verticalId !== verticalFilter) return false;
    if (accessStatusFilter && effectiveStatus(e) !== accessStatusFilter)
      return false;
    if (territoryFilter && e.territory !== territoryFilter) return false;
    if (search) {
      const haystack = `${e.firstName} ${e.lastName}`.toLowerCase();
      if (!haystack.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  const territories = Array.from(
    new Set(items.map((employee) => employee.territory).filter(Boolean)),
  ).sort() as string[];
  const colCount = isAdmin ? 10 : 8;

  return (
    <SignalPage>
      <SignalHeader
        title="Employee Roster"
        description="Company-wide directory of employees and onboarding status."
      />
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">

      <RegisterToolbar
        title="Employee Register"
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search employee name"
        filters={
          <>
          <Select
            value={verticalFilter}
            onChange={(e) => setVerticalFilter(e.target.value)}
            className="max-w-[200px]"
          >
            <option value="">All verticals</option>
            {verticals.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
          <Select
            value={territoryFilter}
            onChange={(e) => setTerritoryFilter(e.target.value)}
            className="max-w-[200px]"
          >
            <option value="">All territories</option>
            {territories.map((territory) => (
              <option key={territory} value={territory}>
                {territory}
              </option>
            ))}
          </Select>
          <Select
            value={accessStatusFilter}
            onChange={(e) =>
              setAccessStatusFilter(e.target.value as AccessStatus | '')
            }
            className="max-w-[200px]"
          >
            <option value="">All access statuses</option>
            <option value="PENDING_ACCESS">Pending Access</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </Select>
          </>
        }
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <SCard className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Vertical</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Employment Type</TableHead>
                <TableHead>Work Location</TableHead>
                <TableHead>Territory</TableHead>
                <TableHead>Access Status</TableHead>
                {isAdmin && <TableHead>Sensitive Info</TableHead>}
                {isAdmin && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: colCount }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={colCount}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No employees match your filters.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((e) => {
                  const admin = e as EmployeeRosterAdmin;
                  const complete =
                    admin.hasCompensationOnFile &&
                    admin.hasStatutoryInfoOnFile &&
                    admin.hasBankDetailsOnFile;
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">
                        {e.employeeId}
                      </TableCell>
                      <TableCell>
                        {e.firstName} {e.lastName}
                      </TableCell>
                      <TableCell>{verticalName(e.verticalId)}</TableCell>
                      <TableCell>{e.designation ?? '—'}</TableCell>
                      <TableCell>{e.employmentType ?? '—'}</TableCell>
                      <TableCell>{e.workLocation ?? '—'}</TableCell>
                      <TableCell>{e.territory ?? '—'}</TableCell>
                      <TableCell>
                        {/* Effective status — see effectiveStatus(): offboarded
                            employees read INACTIVE regardless of accessStatus.
                            Shared with the status filter so they stay aligned. */}
                        <StatusBadge value={effectiveStatus(e)} />
                      </TableCell>
                      {isAdmin && (
                        <TableCell>
                          <Badge variant={complete ? 'success' : 'warning'}>
                            {complete ? 'Complete' : 'Incomplete'}
                          </Badge>
                        </TableCell>
                      )}
                      {isAdmin && (
                        <TableCell>
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setDetailTarget({
                                  id: e.id,
                                  name: `${e.firstName} ${e.lastName}`,
                                })
                              }
                            >
                              View sensitive details
                            </Button>
                            {/* Edit / offboard / delete all live on the employee
                                detail page (Edit + Deactivate + Delete), gated
                                to Admin/SUPER_ADMIN by the backend. */}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                router.push(
                                  `/admin/employees/${e.id}?from=/hr/roster`,
                                )
                              }
                            >
                              Edit
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
      </SCard>

      <RegisterPagination
        page={page}
        pageCount={Math.ceil(total / limit)}
        onPageChange={setPage}
        disabled={loading}
      />
      </div>

      {detailTarget && (
        <SensitiveDetailPanel
          employeeId={detailTarget.id}
          employeeName={detailTarget.name}
          onClose={() => setDetailTarget(null)}
        />
      )}
    </SignalPage>
  );
}
