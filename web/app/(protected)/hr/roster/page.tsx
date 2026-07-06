'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../lib/auth-context';
import { apiFetch } from '../../../lib/api';
import {
  AccessStatus,
  EmployeeRoster,
  EmployeeRosterAdmin,
  PaginatedResult,
  Vertical,
} from '../../../lib/types';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
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
import { SensitiveDetailPanel } from './_components/sensitive-detail-panel';

export default function RosterPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  const [items, setItems] = useState<(EmployeeRoster | EmployeeRosterAdmin)[]>(
    [],
  );
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [verticalFilter, setVerticalFilter] = useState('');
  const [accessStatusFilter, setAccessStatusFilter] = useState<
    AccessStatus | ''
  >('');
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

  const filtered = items.filter((e) => {
    if (verticalFilter && e.verticalId !== verticalFilter) return false;
    if (accessStatusFilter && e.accessStatus !== accessStatusFilter)
      return false;
    if (search) {
      const haystack = `${e.firstName} ${e.lastName}`.toLowerCase();
      if (!haystack.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  const colCount = isAdmin ? 9 : 7;

  return (
    <PageContainer>
      <PageHeader
        title="Employee Roster"
        description="Company-wide directory of employees and onboarding status."
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap gap-3 p-4">
          <Input
            placeholder="Search name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
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
        </CardContent>
      </Card>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Vertical</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Employment Type</TableHead>
                <TableHead>Work Location</TableHead>
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
                      <TableCell>
                        <StatusBadge value={e.accessStatus} />
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
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="mt-4 flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Prev
        </Button>
        <span className="text-sm text-muted-foreground">
          Page {page} of {Math.max(1, Math.ceil(total / limit))}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page * limit >= total}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>

      {detailTarget && (
        <SensitiveDetailPanel
          employeeId={detailTarget.id}
          employeeName={detailTarget.name}
          onClose={() => setDetailTarget(null)}
        />
      )}
    </PageContainer>
  );
}
