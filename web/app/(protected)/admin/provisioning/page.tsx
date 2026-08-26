'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../../lib/api';
import type { Vertical } from '../../../lib/types';
import { useToast } from '../../../components/ui/toaster';
import {
  SCard,
  SCardTitle,
  SignalHeader,
  SignalPage,
} from '../../../components/ui/signal';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Switch } from '../../../components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';

type ItemType = { id: string; name: string; requiresScmFulfillment: boolean; approverType: 'SUPER_ADMIN' | 'VERTICAL_OWNER'; approverVerticalId: string | null; isActive: boolean; approverVertical: Vertical | null };

export default function ProvisioningSettingsPage() {
  const [items, setItems] = useState<ItemType[]>([]); const [verticals, setVerticals] = useState<Vertical[]>([]); const [editingId, setEditingId] = useState<string | null>(null); const [name, setName] = useState(''); const [physical, setPhysical] = useState(true); const [approverType, setApproverType] = useState<'SUPER_ADMIN' | 'VERTICAL_OWNER'>('SUPER_ADMIN'); const [verticalId, setVerticalId] = useState(''); const toast = useToast();
  const load = useCallback(async () => { try { const [i, v] = await Promise.all([apiFetch<ItemType[]>('/provisioning/item-types'), apiFetch<Vertical[]>('/verticals')]); setItems(i); setVerticals(v.filter((x) => x.isActive)); } catch { toast.error('Failed to load provisioning settings'); } }, [toast]);
  useEffect(() => { void load(); }, [load]);
  function resetForm() { setEditingId(null); setName(''); setPhysical(true); setApproverType('SUPER_ADMIN'); setVerticalId(''); }
  async function save(e: FormEvent) { e.preventDefault(); try { await apiFetch(editingId ? `/provisioning/item-types/${editingId}` : '/provisioning/item-types', { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify({ name, requiresScmFulfillment: physical, approverType, approverVerticalId: approverType === 'VERTICAL_OWNER' ? verticalId : null }) }); toast.success(editingId ? 'Item type updated' : 'Item type created'); resetForm(); load(); } catch (err) { toast.error(err instanceof ApiError ? err.message : 'Save failed'); } }
  function edit(item: ItemType) { setEditingId(item.id); setName(item.name); setPhysical(item.requiresScmFulfillment); setApproverType(item.approverType); setVerticalId(item.approverVerticalId ?? ''); }
  async function toggle(item: ItemType) { try { await apiFetch(`/provisioning/item-types/${item.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !item.isActive }) }); load(); } catch (err) { toast.error(err instanceof ApiError ? err.message : 'Update failed'); } }
  return <SignalPage><SignalHeader title="Onboarding Provisioning" description="Configure which requests are created when a new hire receives ERP access, who approves them, and whether SCM fulfills them." />
    <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
    <SCard className="overflow-hidden"><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Fulfillment</TableHead><TableHead>Approver</TableHead><TableHead>Active</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{items.map((i) => <TableRow key={i.id}><TableCell className="font-medium">{i.name}</TableCell><TableCell>{i.requiresScmFulfillment ? 'SCM (physical)' : 'Direct action'}</TableCell><TableCell>{i.approverType === 'SUPER_ADMIN' ? 'CEO' : `${i.approverVertical?.name ?? 'Unknown'} owner${i.approverVertical?.ownerId ? '' : ' (falls back to CEO)'}`}</TableCell><TableCell><Switch checked={i.isActive} onCheckedChange={() => toggle(i)} aria-label={`Toggle ${i.name}`} /></TableCell><TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => edit(i)}>Edit</Button></TableCell></TableRow>)}</TableBody></Table></SCard>
    <SCard className="px-5 py-[18px]"><SCardTitle title={editingId ? 'Edit item type' : 'Add item type'} /><div className="mt-3.5"><form onSubmit={save} className="grid gap-4 md:grid-cols-2"><label className="text-sm font-medium">Name<Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} required /></label><label className="text-sm font-medium">Approval route<Select className="mt-1" value={approverType} onChange={(e) => setApproverType(e.target.value as typeof approverType)}><option value="SUPER_ADMIN">CEO</option><option value="VERTICAL_OWNER">Vertical owner</option></Select></label>{approverType === 'VERTICAL_OWNER' && <label className="text-sm font-medium">Approver vertical<Select className="mt-1" value={verticalId} onChange={(e) => setVerticalId(e.target.value)} required><option value="">Select vertical</option>{verticals.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select></label>}<label className="flex items-center gap-3 text-sm font-medium"><Switch checked={physical} onCheckedChange={setPhysical} /> Requires SCM fulfillment</label><div className="flex gap-2 md:col-span-2"><Button type="submit">{editingId ? 'Save changes' : 'Add item type'}</Button>{editingId && <Button type="button" variant="outline" onClick={resetForm}>Cancel</Button>}</div></form></div></SCard>
    </div>
  </SignalPage>;
}
