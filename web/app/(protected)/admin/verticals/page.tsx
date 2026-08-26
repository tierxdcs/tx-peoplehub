'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { useAuth } from '../../../lib/auth-context';
import { useConfirm } from '../../../components/ui/confirm';
import { ApiError, apiFetch } from '../../../lib/api';
import { Employee, PaginatedResult, Vertical } from '../../../lib/types';
import {
  SCard,
  SCardTitle,
  SIGNAL_FAINT,
  SignalHeader,
  SignalPage,
} from '../../../components/ui/signal';
import { cn } from '../../../lib/utils';
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
  const { user } = useAuth();
  const confirm = useConfirm();
  const canManage = user?.role === 'SUPER_ADMIN';
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingOwnerId, setSavingOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editActive, setEditActive] = useState(true);

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

  function startEdit(vertical: Vertical) {
    setEditingId(vertical.id);
    setEditName(vertical.name);
    setEditCode(vertical.code);
    setEditActive(vertical.isActive);
  }

  async function saveEdit(verticalId: string) {
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/verticals/${verticalId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editName.trim(),
          code: editCode.trim().toUpperCase(),
          isActive: editActive,
        }),
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to edit vertical',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function removeVertical(vertical: Vertical) {
    const approved = await confirm({
      title: `Delete ${vertical.name}?`,
      description:
        'This permanently deletes the vertical. Deletion is blocked while employees or business records still use it.',
      confirmLabel: 'Delete vertical',
      destructive: true,
    });
    if (!approved) return;
    setError(null);
    try {
      await apiFetch(`/verticals/${vertical.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to delete vertical',
      );
    }
  }

  const employeeOptions = [...employees].sort((a, b) =>
    `${a.firstName} ${a.lastName}`.localeCompare(
      `${b.firstName} ${b.lastName}`,
    ),
  );

  return (
    <SignalPage>
      <SignalHeader
        title="Verticals"
        description="Manage company departments and assign an accountable owner to each vertical."
      />
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">

      {error && <p className="text-sm text-destructive">{error}</p>}

      <SCard className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Status</TableHead>
                {canManage && (
                  <TableHead className="text-right">Actions</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, row) => (
                  <TableRow key={row}>
                    {Array.from({ length: canManage ? 5 : 4 }).map(
                      (__, column) => (
                        <TableCell key={column}>
                          <Skeleton className="h-4 w-28" />
                        </TableCell>
                      ),
                    )}
                  </TableRow>
                ))
              ) : verticals.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={canManage ? 5 : 4}
                    className={cn('py-12 text-center', SIGNAL_FAINT)}
                  >
                    No verticals have been created.
                  </TableCell>
                </TableRow>
              ) : (
                verticals.map((vertical) => (
                  <TableRow key={vertical.id}>
                    <TableCell className="font-medium">
                      {editingId === vertical.id ? (
                        <Input
                          value={editName}
                          onChange={(event) => setEditName(event.target.value)}
                        />
                      ) : (
                        vertical.name
                      )}
                    </TableCell>
                    <TableCell>
                      {editingId === vertical.id ? (
                        <Input
                          value={editCode}
                          onChange={(event) =>
                            setEditCode(event.target.value.toUpperCase())
                          }
                        />
                      ) : (
                        <Badge variant="secondary">{vertical.code}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="min-w-[260px]">
                      <Select
                        aria-label={`Owner for ${vertical.name}`}
                        value={vertical.ownerId ?? ''}
                        disabled={!canManage || savingOwnerId === vertical.id}
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
                      {editingId === vertical.id ? (
                        <Select
                          value={editActive ? 'ACTIVE' : 'INACTIVE'}
                          onChange={(event) =>
                            setEditActive(event.target.value === 'ACTIVE')
                          }
                        >
                          <option value="ACTIVE">Active</option>
                          <option value="INACTIVE">Inactive</option>
                        </Select>
                      ) : (
                        <Badge
                          variant={vertical.isActive ? 'success' : 'secondary'}
                        >
                          {vertical.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      )}
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        {editingId === vertical.id ? (
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              onClick={() => void saveEdit(vertical.id)}
                              disabled={
                                submitting ||
                                !editName.trim() ||
                                !editCode.trim()
                              }
                            >
                              Save
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label="Cancel edit"
                              onClick={() => setEditingId(null)}
                            >
                              <X className="size-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Edit ${vertical.name}`}
                              onClick={() => startEdit(vertical)}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Delete ${vertical.name}`}
                              className="text-destructive"
                              onClick={() => void removeVertical(vertical)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
      </SCard>

      {canManage && (
        <SCard className="px-5 py-[18px]">
          <SCardTitle title="Create vertical" />
          <div className="mt-3.5">
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
                  onChange={(event) =>
                    setCode(event.target.value.toUpperCase())
                  }
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
          </div>
        </SCard>
      )}
      </div>
    </SignalPage>
  );
}
