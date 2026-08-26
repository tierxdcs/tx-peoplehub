'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { apiFetch, ApiError } from '../../../lib/api';
import {
  DELIVERY_TYPE_LABEL,
  type DeliveryType,
} from '../../../lib/project-kickoff';
import { useToast } from '../../../components/ui/toaster';
import {
  SCard,
  SCardTitle,
  SIGNAL_FAINT,
  SIGNAL_HAIRLINE,
  SignalHeader,
  SignalPage,
} from '../../../components/ui/signal';
import { cn } from '../../../lib/utils';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Switch } from '../../../components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';

interface MilestoneTemplate {
  id: string;
  flowType: DeliveryType;
  name: string;
  displayOrder: number;
  isActive: boolean;
}

const FLOW_TYPES: DeliveryType[] = ['NPD', 'IN_HOUSE', 'VENDOR'];

export default function MilestoneTemplatesSettingsPage() {
  const [templates, setTemplates] = useState<MilestoneTemplate[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [flowType, setFlowType] = useState<DeliveryType>('NPD');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setTemplates(await apiFetch<MilestoneTemplate[]>('/milestone-templates'));
    } catch {
      toast.error('Failed to load milestone templates');
    }
  }, [toast]);
  useEffect(() => {
    void load();
  }, [load]);

  // Grouped by flow type, each sorted by displayOrder for the reorder controls.
  const byFlow = useMemo(() => {
    return FLOW_TYPES.map((ft) => ({
      flowType: ft,
      rows: templates
        .filter((t) => t.flowType === ft)
        .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)),
    }));
  }, [templates]);

  function resetForm() {
    setEditingId(null);
    setFlowType('NPD');
    setName('');
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await apiFetch(
        editingId ? `/milestone-templates/${editingId}` : '/milestone-templates',
        {
          method: editingId ? 'PATCH' : 'POST',
          // flowType is immutable once created (part of the unique key); only
          // sent on create. Edit changes the name in place.
          body: JSON.stringify(
            editingId ? { name: name.trim() } : { flowType, name: name.trim() },
          ),
        },
      );
      toast.success(editingId ? 'Template updated' : 'Template added');
      resetForm();
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function edit(t: MilestoneTemplate) {
    setEditingId(t.id);
    setFlowType(t.flowType);
    setName(t.name);
  }

  async function toggle(t: MilestoneTemplate) {
    try {
      await apiFetch(`/milestone-templates/${t.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !t.isActive }),
      });
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  /** Swap a row's displayOrder with its adjacent sibling in the same flow. */
  async function move(rows: MilestoneTemplate[], index: number, dir: -1 | 1) {
    const a = rows[index];
    const b = rows[index + dir];
    if (!a || !b) return;
    try {
      await Promise.all([
        apiFetch(`/milestone-templates/${a.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ displayOrder: b.displayOrder }),
        }),
        apiFetch(`/milestone-templates/${b.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ displayOrder: a.displayOrder }),
        }),
      ]);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Reorder failed');
    }
  }

  return (
    <SignalPage>
      <SignalHeader
        title="Milestone Templates"
        description="Standard project milestones offered in the kickoff dropdown, per delivery flow type (NPD / In-House / Vendor). A kickoff sees the union of templates matching its order lines' delivery types. Deactivating a template hides it from new kickoffs without affecting milestones already created."
      />
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">

      {byFlow.map(({ flowType: ft, rows }) => (
        <SCard key={ft} className="overflow-hidden">
          <div className={cn('border-b px-5 py-3.5', SIGNAL_HAIRLINE)}>
            <SCardTitle title={DELIVERY_TYPE_LABEL[ft]} />
          </div>
          <div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Order</TableHead>
                  <TableHead>Milestone</TableHead>
                  <TableHead className="w-24">Active</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className={cn('py-8 text-center', SIGNAL_FAINT)}>
                      No templates for this flow type yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((t, i) => (
                    <TableRow key={t.id} className={t.isActive ? '' : 'opacity-60'}>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7"
                            aria-label="Move up"
                            disabled={i === 0}
                            onClick={() => move(rows, i, -1)}
                          >
                            <ArrowUp className="size-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7"
                            aria-label="Move down"
                            disabled={i === rows.length - 1}
                            onClick={() => move(rows, i, 1)}
                          >
                            <ArrowDown className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell>
                        <Switch
                          checked={t.isActive}
                          onCheckedChange={() => toggle(t)}
                          aria-label={`Toggle ${t.name}`}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => edit(t)}>
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </SCard>
      ))}

      <SCard className="px-5 py-[18px]">
        <SCardTitle title={editingId ? 'Edit template' : 'Add template'} />
        <div className="mt-3.5">
          <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium">
              Flow type
              <Select
                className="mt-1"
                value={flowType}
                disabled={!!editingId}
                onChange={(e) => setFlowType(e.target.value as DeliveryType)}
              >
                {FLOW_TYPES.map((ft) => (
                  <option key={ft} value={ft}>
                    {DELIVERY_TYPE_LABEL[ft]}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-sm font-medium">
              Milestone name
              <Input
                className="mt-1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <div className="flex gap-2 md:col-span-2">
              <Button type="submit" disabled={saving}>
                {editingId ? 'Save changes' : 'Add template'}
              </Button>
              {editingId && (
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </div>
      </SCard>
      </div>
    </SignalPage>
  );
}
