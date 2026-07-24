'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, ClipboardCopy, ExternalLink, FileImage, RefreshCw } from 'lucide-react';
import { apiFetch, ApiError } from '../../../../../lib/api';
import { Employee } from '../../../../../lib/types';
import {
  createPlmInvite,
  getOrderPlm,
  getPlmInvites,
  PlmStage,
  PlmTracker,
  PlmVendorInvite,
  plmAction,
} from '../../../../../lib/plm';
import { uploadToPresignedUrl } from '../../../../../lib/vault-api';
import { useAuth } from '../../../../../lib/auth-context';
import { prettyEnum } from '../../../../../lib/sales';
import { Button } from '../../../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../../components/ui/card';
import { Input } from '../../../../../components/ui/input';
import { StatusBadge } from '../../../../../components/ui/status-badge';
import { useToast } from '../../../../../components/ui/toaster';

const NPD_STAGES: PlmStage[] = ['DESIGN', 'DESIGN_REVIEW', 'DRAWING_RELEASE', 'RELEASE_TO_SCM', 'MATERIAL_PLANNING', 'PRODUCTION', 'QC', 'DISPATCH', 'COMPLETED'];
const STANDARD_STAGES: PlmStage[] = ['RELEASE_TO_SCM', 'MATERIAL_PLANNING', 'PRODUCTION', 'QC', 'DISPATCH', 'COMPLETED'];

function StageStrip({ tracker }: { tracker: PlmTracker }) {
  const stages = tracker.flowType === 'NPD' ? NPD_STAGES : STANDARD_STAGES;
  const active = stages.indexOf(tracker.currentStage);
  return (
    <ol className="flex min-w-max items-start py-2">
      {stages.map((stage, index) => (
        <li key={stage} className="flex items-start last:flex-none">
          <div className="flex w-20 flex-col items-center text-center">
            <span className={`flex size-8 items-center justify-center rounded-full border-2 text-xs font-semibold ${index < active ? 'border-success bg-success text-success-foreground' : index === active ? 'border-primary bg-primary/10 text-primary' : 'border-muted-foreground/25 text-muted-foreground'}`}>
              {index < active ? <Check className="size-4" /> : index + 1}
            </span>
            <span className="mt-1 text-[11px] leading-tight text-muted-foreground">{prettyEnum(stage)}</span>
          </div>
          {index < stages.length - 1 && <span className={`mt-4 h-0.5 w-5 ${index < active ? 'bg-success' : 'bg-border'}`} />}
        </li>
      ))}
    </ol>
  );
}

export function PlmSection({ orderId }: { orderId: string }) {
  const { user } = useAuth();
  const toast = useToast();
  const [trackers, setTrackers] = useState<PlmTracker[]>([]);
  const [me, setMe] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [invites, setInvites] = useState<Record<string, PlmVendorInvite[]>>({});

  const load = useCallback(async () => {
    try {
      const [rows, employee] = await Promise.all([
        getOrderPlm(orderId),
        user ? apiFetch<Employee>(`/employees/${user.sub}`) : Promise.resolve(null),
      ]);
      setTrackers(rows);
      setMe(employee);
    } catch (error) {
      if (error instanceof ApiError && error.statusCode !== 403) toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, [orderId, toast, user]);

  useEffect(() => { void load(); }, [load]);

  async function act(tracker: PlmTracker, action: string, body?: unknown) {
    setActing(tracker.id);
    try {
      await plmAction(tracker.id, action, body);
      toast.success('PLM tracker updated');
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Unable to update PLM tracker');
    } finally { setActing(null); }
  }

  async function loadInvites(trackerId: string) {
    try {
      const rows = await getPlmInvites(trackerId);
      setInvites((current) => ({ ...current, [trackerId]: rows }));
    }
    catch (error) { toast.error(error instanceof ApiError ? error.message : 'Unable to load links'); }
  }

  if (loading) return <Card className="mt-4"><CardContent className="p-6 text-sm text-muted-foreground">Loading product lifecycle…</CardContent></Card>;
  if (trackers.length === 0) return null;

  return (
    <Card id="plm" className="mt-4 scroll-mt-20">
      <CardHeader className="flex-row items-center justify-between">
        <div><CardTitle>Product lifecycle</CardTitle><p className="mt-1 text-sm text-muted-foreground">Per-line progress from kickoff through dispatch</p></div>
        <Button size="sm" variant="ghost" onClick={() => void load()}><RefreshCw className="mr-1 size-4" />Refresh</Button>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {trackers.map((tracker) => {
          const canOperate = user?.role === 'SUPER_ADMIN' || me?.isProductionHead || user?.sub === tracker.ownerId;
          const canAudit = user?.role === 'SUPER_ADMIN' || me?.isInternalAuditor;
          return (
            <details key={tracker.id} className="group rounded-lg border bg-background" open={trackers.length === 1}>
              <summary className="cursor-pointer list-none p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><div className="font-medium">{tracker.orderLine.product.name}</div><div className="text-xs text-muted-foreground">{tracker.orderLine.product.sku} · {prettyEnum(tracker.flowType)} · Owner: {tracker.owner.firstName} {tracker.owner.lastName}</div></div>
                  <StatusBadge value={tracker.currentStage} />
                </div>
                <div className="mt-3 overflow-x-auto"><StageStrip tracker={tracker} /></div>
              </summary>
              <div className="space-y-5 border-t p-4">
                {tracker.currentStage === 'PRODUCTION' && (
                  <div className="rounded-md bg-muted/40 p-3 text-sm">
                    Production cards: <strong>{tracker.derived.production.done}/{tracker.derived.production.total}</strong> complete
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {tracker.currentStage === 'DESIGN' && (
                    <Button size="sm" disabled={acting === tracker.id} onClick={() => void act(tracker, 'design-review/submit')}>Submit Design Review</Button>
                  )}
                  {tracker.currentStage === 'DESIGN_REVIEW' && tracker.designReviewStatus === 'PENDING' && (user?.role === 'SUPER_ADMIN' || me?.isProductionHead) && (
                    <><Button size="sm" disabled={acting === tracker.id || tracker.designSubmittedById === user?.sub} onClick={() => void act(tracker, 'design-review/approve')}>Approve</Button><Button size="sm" variant="destructive" disabled={acting === tracker.id || tracker.designSubmittedById === user?.sub} onClick={() => { const comment = window.prompt('Rejection reason'); if (comment?.trim()) void act(tracker, 'design-review/reject', { comment }); }}>Reject</Button></>
                  )}
                  {!['DESIGN', 'DESIGN_REVIEW', 'COMPLETED'].includes(tracker.currentStage) && canOperate && (
                    <Button size="sm" disabled={acting === tracker.id} onClick={() => void act(tracker, 'confirm-stage')}>Confirm {prettyEnum(tracker.currentStage)}</Button>
                  )}
                </div>

                {tracker.flowType === 'VENDOR' && canOperate && (
                  <VendorInvites tracker={tracker} rows={invites[tracker.id]} onLoad={loadInvites} onCreated={loadInvites} />
                )}

                {tracker.flowType === 'VENDOR' && tracker.currentStage === 'PRODUCTION' && canAudit && (
                  <AuditorUpdate tracker={tracker} onSaved={load} />
                )}

                {tracker.productionUpdates.length > 0 && (
                  <section><h4 className="mb-2 text-sm font-semibold">Production update history</h4><div className="space-y-2">{tracker.productionUpdates.map((update) => <div key={update.id} className="rounded-md border p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>Updated by: {update.reporterDisplayName}{update.reporterType === 'INTERNAL_AUDITOR_VISIT' ? ' (site visit)' : ''}</strong><span className="text-muted-foreground">{new Date(update.createdAt).toLocaleString()}</span></div><div className="mt-2 flex flex-wrap gap-3 text-xs"><span>Fabrication {update.fabricationPercent}%</span><span>Surface finish {update.surfaceFinishPercent}%</span><span>Assembly {update.assemblyPercent}%</span></div>{update.notes && <p className="mt-2 text-muted-foreground">{update.notes}</p>}<div className="mt-2 flex flex-wrap gap-2">{update.photos.map((photo) => <button key={photo.id} className="inline-flex items-center gap-1 text-xs text-primary hover:underline" onClick={async () => { const result = await apiFetch<{downloadUrl:string}>(`/plm/update-photos/${photo.id}/download-url`); window.open(result.downloadUrl, '_blank', 'noopener,noreferrer'); }}><FileImage className="size-3" />{photo.fileName}</button>)}</div></div>)}</div></section>
                )}

                <section><h4 className="mb-2 text-sm font-semibold">Timeline</h4><div className="space-y-2">{tracker.events.map((event) => <div key={event.id} className="flex gap-3 text-sm"><span className="mt-1 size-2 shrink-0 rounded-full bg-primary" /><div><span className="font-medium">{prettyEnum(event.type)}</span>{event.actor && <span> · {event.actor.firstName} {event.actor.lastName}</span>}<span className="text-muted-foreground"> · {new Date(event.createdAt).toLocaleString()}</span>{event.comment && <p className="text-muted-foreground">{event.comment}</p>}</div></div>)}</div></section>
              </div>
            </details>
          );
        })}
      </CardContent>
    </Card>
  );
}

function VendorInvites({ tracker, rows, onLoad, onCreated }: { tracker: PlmTracker; rows?: PlmVendorInvite[]; onLoad:(id:string)=>Promise<void>; onCreated:(id:string)=>Promise<void> }) {
  const toast = useToast();
  return <section className="rounded-md border p-3"><div className="flex items-center justify-between"><h4 className="text-sm font-semibold">Vendor update links</h4><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void onLoad(tracker.id)}>View links</Button><Button size="sm" onClick={async () => { try { const invite = await createPlmInvite(tracker.id); await navigator.clipboard.writeText(`${window.location.origin}/public/plm-vendor-update/${invite.token}`); toast.success('Link created and copied'); await onCreated(tracker.id); } catch(error) { toast.error(error instanceof ApiError ? error.message : 'Unable to create link'); } }}>Create link</Button></div></div>{rows && <div className="mt-3 space-y-2">{rows.map((invite) => { const url = `${window.location.origin}/public/plm-vendor-update/${invite.token}`; return <div key={invite.id} className="flex flex-wrap items-center justify-between gap-2 text-xs"><span>{invite.revokedAt ? 'Revoked' : new Date(invite.expiresAt) < new Date() ? 'Expired' : `Expires ${new Date(invite.expiresAt).toLocaleDateString()}`}</span><div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(url)}><ClipboardCopy className="size-3" /></Button><a href={url} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost"><ExternalLink className="size-3" /></Button></a>{!invite.revokedAt && <Button size="sm" variant="destructive" onClick={async()=>{await apiFetch(`/plm/vendor-invites/${invite.id}/revoke`,{method:'POST'});await onLoad(tracker.id)}}>Revoke</Button>}</div></div>; })}</div>}</section>;
}

function AuditorUpdate({ tracker, onSaved }: { tracker: PlmTracker; onSaved:()=>Promise<void> }) {
  const toast = useToast();
  const [values,setValues]=useState({fabricationPercent:0,surfaceFinishPercent:0,assemblyPercent:0,notes:''});
  const [files,setFiles]=useState<File[]>([]);
  const set=(key:string,value:string|number)=>setValues(current=>({...current,[key]:value}));
  return <section className="rounded-md border p-3"><h4 className="mb-1 text-sm font-semibold">Record internal auditor site visit</h4><p className="mb-3 text-xs text-muted-foreground">The update will be attributed to you and marked “site visit”.</p><div className="grid gap-2 sm:grid-cols-3">{(['fabricationPercent','surfaceFinishPercent','assemblyPercent'] as const).map((key)=><label key={key} className="text-xs">{prettyEnum(key.replace('Percent',''))}<Input type="number" min={0} max={100} value={values[key]} onChange={event=>set(key,Number(event.target.value))}/></label>)}</div><textarea className="mt-2 w-full rounded-md border p-2 text-sm" placeholder="Visit notes" value={values.notes} onChange={event=>set('notes',event.target.value)} /><Input className="mt-2" type="file" accept="image/*" multiple onChange={event=>setFiles(Array.from(event.target.files??[]).slice(0,5))}/><Button className="mt-2" size="sm" onClick={async()=>{try{const photos=[];for(const file of files){const signed=await apiFetch<{storageKey:string;uploadUrl:string}>(`/plm/trackers/${tracker.id}/auditor-photo-upload-url`,{method:'POST',body:JSON.stringify({name:file.name,mimeType:file.type,sizeBytes:file.size})});await uploadToPresignedUrl(signed.uploadUrl,file);photos.push({storageKey:signed.storageKey,fileName:file.name})}await apiFetch(`/plm/trackers/${tracker.id}/auditor-update`,{method:'POST',body:JSON.stringify({...values,photos})});toast.success('Site-visit update recorded');await onSaved()}catch(error){toast.error(error instanceof ApiError?error.message:'Unable to record update')}}}>Save site-visit update</Button></section>;
}
