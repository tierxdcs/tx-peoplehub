'use client';

import { useEffect, useState } from 'react';
import { BusinessUnit } from '../../../lib/types';
import {
  listBusinessUnits,
  createBusinessUnit,
  updateBusinessUnit,
} from '../../../lib/business-units';
import {
  SCard,
  SCardTitle,
  SIGNAL_FAINT,
  SIGNAL_MUTED,
  SignalHeader,
  SignalPage,
} from '../../../components/ui/signal';
import { cn } from '../../../lib/utils';
import { RegisterToolbar } from '../../../components/ui/register-toolbar';
import { RegisterPagination } from '../../../components/ui/register-pagination';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { StatusBadge } from '../../../components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { useRegisterList } from '../../../lib/use-register-list';

/**
 * SUPER_ADMIN business-unit management. Create, edit, and activate/deactivate.
 * Deactivating soft-disables (hidden from the product dropdown) without breaking
 * products already tagged. Backend @Roles(SUPER_ADMIN) is the real enforcement;
 * a plain Admin reaching this page gets a 403 on write.
 */
export default function BusinessUnitsPage() {
  const [units, setUnits] = useState<BusinessUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form.
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [displayOrder, setDisplayOrder] = useState('');
  const [colorHex, setColorHex] = useState('#2563EB');
  const [submitting, setSubmitting] = useState(false);

  // Inline edit.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editOrder, setEditOrder] = useState('');
  const [editColorHex, setEditColorHex] = useState('#2563EB');
  const register = useRegisterList(units, (unit) => `${unit.name} ${unit.code} ${unit.description ?? ''} ${unit.isActive ? 'active' : 'inactive'}`);

  async function load() {
    setLoading(true);
    try {
      setUnits(await listBusinessUnits());
    } catch {
      setError('Failed to load business units');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createBusinessUnit({
        name,
        code,
        description: description || undefined,
        displayOrder: displayOrder ? Number(displayOrder) : undefined,
        colorHex,
      });
      setName('');
      setCode('');
      setDescription('');
      setDisplayOrder('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(u: BusinessUnit) {
    setEditingId(u.id);
    setEditName(u.name);
    setEditDescription(u.description ?? '');
    setEditOrder(String(u.displayOrder));
    setEditColorHex(u.colorHex);
    setError(null);
  }

  async function saveEdit(id: string) {
    setError(null);
    try {
      await updateBusinessUnit(id, {
        name: editName,
        description: editDescription || null,
        displayOrder: editOrder ? Number(editOrder) : undefined,
        colorHex: editColorHex,
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    }
  }

  async function toggleActive(u: BusinessUnit) {
    setError(null);
    try {
      await updateBusinessUnit(u.id, { isActive: !u.isActive });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    }
  }

  return (
    <SignalPage>
      <SignalHeader title="Business Units" description="Classify products for reporting and maintain their display labels." />
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
      <RegisterToolbar title="Business Unit Register" search={register.search} onSearchChange={register.setSearch} searchPlaceholder="Search name, code or status" />

      {error && <p className="text-destructive">{error}</p>}

      {loading ? (
        <p className={cn('text-[13px]', SIGNAL_MUTED)}>Loading…</p>
      ) : (
        <SCard className="overflow-hidden"><Table>
          <TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Name</TableHead><TableHead>Code</TableHead><TableHead>Description</TableHead><TableHead>Colour</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {register.visibleItems.map((u) => (
              <TableRow key={u.id}>
                {editingId === u.id ? (
                  <>
                    <TableCell><Input
                        value={editOrder}
                        onChange={(e) => setEditOrder(e.target.value)}
                        className="w-20"
                      /></TableCell>
                    <TableCell><Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                      /></TableCell>
                    <TableCell>{u.code}</TableCell>
                    <TableCell><Input
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                      /></TableCell>
                    <TableCell>
                      <input
                        type="color"
                        value={editColorHex}
                        onChange={(e) => setEditColorHex(e.target.value)}
                      />
                    </TableCell>
                    <TableCell><StatusBadge value={u.isActive ? 'ACTIVE' : 'INACTIVE'} /></TableCell>
                    <TableCell className="space-x-2 text-right"><Button size="sm" onClick={() => saveEdit(u.id)}>Save</Button><Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Cancel</Button></TableCell>
                  </>
                ) : (
                  <>
                    <TableCell className="tabular-nums">{u.displayOrder}</TableCell><TableCell>{u.name}</TableCell><TableCell>{u.code}</TableCell><TableCell className={SIGNAL_MUTED}>{u.description ?? '—'}</TableCell><TableCell>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 14,
                          height: 14,
                          borderRadius: 999,
                          background: u.colorHex,
                        }}
                      />{' '}
                      {u.colorHex}
                    </TableCell><TableCell><StatusBadge value={u.isActive ? 'ACTIVE' : 'INACTIVE'} /></TableCell><TableCell className="space-x-2 text-right"><Button size="sm" variant="outline" onClick={() => startEdit(u)}>Edit</Button><Button size="sm" variant="outline" onClick={() => toggleActive(u)}>{u.isActive ? 'Deactivate' : 'Activate'}</Button></TableCell>
                  </>
                )}
              </TableRow>
            ))}
            {!register.visibleItems.length && <TableRow><TableCell colSpan={7} className={cn('py-12 text-center', SIGNAL_FAINT)}>No business units match your search</TableCell></TableRow>}
          </TableBody></Table></SCard>
      )}
      <RegisterPagination page={register.page} pageCount={register.pageCount} onPageChange={register.setPage} disabled={loading} />

      <SCard className="px-5 py-[18px]"><SCardTitle title="Create business unit" /><div className="mt-3.5"><form onSubmit={handleCreate} className="max-w-md space-y-3.5">
        <label className="block text-[12px] font-semibold">
          Label colour
          <Input
            type="color"
            className="mt-1"
            value={colorHex}
            onChange={(e) => setColorHex(e.target.value)}
          />
        </label>
        <label className="block text-[12px] font-semibold">
          Name
          <Input
            className="mt-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="block text-[12px] font-semibold">
          Code
          <Input
            className="mt-1"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </label>
        <label className="block text-[12px] font-semibold">
          Description (optional)
          <Input
            className="mt-1"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="block text-[12px] font-semibold">
          Display order
          <Input
            type="number"
            className="mt-1"
            value={displayOrder}
            onChange={(e) => setDisplayOrder(e.target.value)}
          />
        </label>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create'}
        </Button>
      </form></div></SCard>
      </div>
    </SignalPage>
  );
}
