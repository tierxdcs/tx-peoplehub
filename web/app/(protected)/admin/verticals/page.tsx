'use client';

import { useCallback, useEffect, useState } from 'react';
import { Building2, Plus } from 'lucide-react';
import { ApiError, apiFetch } from '../../../lib/api';
import { Employee, PaginatedResult, Vertical } from '../../../lib/types';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { Skeleton } from '../../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';

const EMPLOYEE_PAGE_SIZE = 100;

export default function VerticalsPage() {
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingOwnerId, setSavingOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [verticalRows, firstEmployees] = await Promise.all([
        apiFetch<Vertical[]>('/verticals'),
        apiFetch<PaginatedResult<Employee>>(
          `/employees?page=1&limit=${EMPLOYEE_PAGE_SIZE}`,
        ),
      ]);
      const pageCount = Math.ceil(firstEmployees.total / EMPLOYEE_PAGE_SIZE);
      const remaining = await Promise.all(
        Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
          apiFetch<PaginatedResult<Employee>>(
            `/employees?page=${index + 2}&limit=${EMPLOYEE_PAGE_SIZE}`,
          ),
        ),
      );
      setVerticals(verticalRows);
      setEmployees([
        ...firstEmployees.items,
        ...remaining.flatMap((page) => page.items),
      ]);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to load verticals',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch('/verticals', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          code: code.trim().toUpperCase(),
          ...(ownerId ? { ownerId } : {}),
        }),
      });
      setName('');
      setCode('');
      setOwnerId('');
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to create vertical',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function assignOwner(verticalId: string, employeeId: string) {
    setSavingOwnerId(verticalId);
    setError(null);
    try {
      const updated = await apiFetch<Vertical>(
        `/verticals/${verticalId}/owner`,
        {
          method: 'PATCH',
          body: JSON.stringify({ ownerId: employeeId }),
        },
      );
      setVerticals((current) =>
        current.map((vertical) =>
          vertical.id === verticalId ? updated : vertical,
        ),
      );
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to assign owner',
      );
    } finally {
      setSavingOwnerId(null);
    }
  }

  const employeeOptions = [...employees].sort((a, b) =>
    `${a.firstName} ${a.lastName}`.localeCompare(
      `${b.firstName} ${b.lastName}`,
    ),
  );

  return (
    <PageContainer>
      <PageHeader
        title="Verticals"
        description="Manage company departments and assign an accountable owner to each vertical."
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <Card className="mb-6">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, row) => (
                  <TableRow key={row}>
                    {Array.from({ length: 4 }).map((__, column) => (
                      <TableCell key={column}>
                        <Skeleton className="h-4 w-28" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : verticals.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-12 text-center text-muted-foreground"
                  >
                    <Building2 className="mx-auto mb-3 size-8 opacity-50" />
                    No verticals have been created.
                  </TableCell>
                </TableRow>
              ) : (
                verticals.map((vertical) => (
                  <TableRow key={vertical.id}>
                    <TableCell className="font-medium">
                      {vertical.name}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{vertical.code}</Badge>
                    </TableCell>
                    <TableCell className="min-w-[260px]">
                      <Select
                        aria-label={`Owner for ${vertical.name}`}
                        value={vertical.ownerId ?? ''}
                        disabled={savingOwnerId === vertical.id}
                        onChange={(event) =>
                          void assignOwner(vertical.id, event.target.value)
                        }
                      >
                        <option value="" disabled>
                          Select an owner…
                        </option>
                        {employeeOptions.map((employee) => (
                          <option key={employee.id} value={employee.id}>
                            {employee.firstName} {employee.lastName} ·{' '}
                            {employee.employeeId}
                          </option>
                        ))}
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={vertical.isActive ? 'success' : 'secondary'}
                      >
                        {vertical.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Create vertical</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit}
            className="grid gap-4 md:grid-cols-[1fr_1fr_1.4fr_auto] md:items-end"
          >
            <Field label="Name" required>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Customer Success"
                required
              />
            </Field>
            <Field label="Code" required>
              <Input
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="e.g. CS"
                required
              />
            </Field>
            <Field label="Owner">
              <Select
                value={ownerId}
                onChange={(event) => setOwnerId(event.target.value)}
              >
                <option value="">Assign later</option>
                {employeeOptions.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.firstName} {employee.lastName} ·{' '}
                    {employee.employeeId}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" disabled={submitting}>
              <Plus /> {submitting ? 'Creating…' : 'Create vertical'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
