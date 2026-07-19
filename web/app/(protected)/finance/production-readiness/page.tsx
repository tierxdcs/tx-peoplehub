'use client';
import { FormEvent, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../../lib/api';
import { useFinanceAccess } from '../../../lib/use-finance-access';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { useToast } from '../../../components/ui/toaster';
type Settings = { controlAccountMap: Record<string,string>; gstMaxAttempts: number; gstRetryDelayMinutes: number; emailDeliveryEnabled: boolean };
type Run = { status: string; runAt: string; checks: { key:string; label:string; ok:boolean; deferred?:boolean; detail?:string }[] };
type Batch = { id:string; sourceFileName:string; rowCount:number; journalEntryId?:string; createdAt:string };
const defaults: Settings = { controlAccountMap:{}, gstMaxAttempts:5, gstRetryDelayMinutes:15, emailDeliveryEnabled:false };
export default function ProductionReadinessPage() {
  const { isAccountsHead } = useFinanceAccess(), toast = useToast();
  const [settings,setSettings]=useState<Settings>(defaults), [run,setRun]=useState<Run>(), [imports,setImports]=useState<Batch[]>([]);
  const [mapText,setMapText]=useState('{}');
  const [fileName,setFileName]=useState('opening-balances.csv'), [entryDate,setEntryDate]=useState(''), [csv,setCsv]=useState('account_code,description,debit,credit\n');
  const fail=(e:unknown)=>toast.error(e instanceof ApiError?e.message:'Operation failed');
  async function load(){ try { const [s,i]=await Promise.all([apiFetch<Settings>('/finance/operations/production-settings'),apiFetch<Batch[]>('/finance/operations/imports')]); setSettings(s);setMapText(JSON.stringify(s.controlAccountMap,null,2));setImports(i); } catch(e){fail(e);} }
  useEffect(()=>{load();},[]); // eslint-disable-line react-hooks/exhaustive-deps
  async function check(){try{setRun(await apiFetch<Run>('/finance/operations/production-readiness'));}catch(e){fail(e);}}
  async function save(e:FormEvent){e.preventDefault();try{const controlAccountMap=JSON.parse(mapText);await apiFetch('/finance/operations/production-settings',{method:'PATCH',body:JSON.stringify({...settings,controlAccountMap})});toast.success('Production controls saved');await load();await check();}catch(e){fail(e);}}
  async function importBalances(e:FormEvent){e.preventDefault();try{await apiFetch('/finance/operations/imports/opening-balances',{method:'POST',body:JSON.stringify({sourceFileName:fileName,entryDate,csvText:csv})});toast.success('Balanced draft journal created');await load();}catch(e){fail(e);}}
  return <PageContainer><PageHeader title="Finance Production Readiness" description="Provider-neutral controls, readiness evidence, retry governance and auditable opening-balance imports" />
    <Card className="mb-6"><CardContent className="p-5"><div className="flex items-center justify-between"><h2 className="font-semibold">Readiness assessment</h2><Button onClick={check}>Run assessment</Button></div>{run&&<><p className="my-3 text-lg font-semibold">{run.status.replace('_',' ')}</p>{run.checks.map(c=><div className="flex justify-between border-b py-2 text-sm" key={c.key}><span>{c.label}{c.detail?` · ${c.detail}`:''}</span><b className={c.ok?'text-green-700':c.deferred?'text-amber-700':'text-red-700'}>{c.ok?'READY':c.deferred?'DEFERRED':'ACTION REQUIRED'}</b></div>)}</>}</CardContent></Card>
    {isAccountsHead&&<Card className="mb-6"><CardContent className="p-5"><h2 className="mb-3 font-semibold">Production controls</h2><form className="grid gap-3 md:grid-cols-2" onSubmit={save}><label className="text-sm">GST maximum attempts<Input type="number" value={settings.gstMaxAttempts} onChange={e=>setSettings({...settings,gstMaxAttempts:Number(e.target.value)})}/></label><label className="text-sm">GST retry cooldown (minutes)<Input type="number" value={settings.gstRetryDelayMinutes} onChange={e=>setSettings({...settings,gstRetryDelayMinutes:Number(e.target.value)})}/></label><label className="text-sm md:col-span-2">Control-account map (default code to selected ledger code)<textarea className="mt-1 min-h-28 w-full rounded-md border p-3 font-mono text-sm" value={mapText} onChange={e=>setMapText(e.target.value)}/></label><Button type="submit">Save controls</Button></form></CardContent></Card>}
    <Card><CardContent className="p-5"><h2 className="mb-3 font-semibold">Opening-balance import</h2><form className="grid gap-3" onSubmit={importBalances}><div className="grid gap-3 md:grid-cols-2"><Input required value={fileName} onChange={e=>setFileName(e.target.value)} placeholder="Source file name"/><Input required type="date" value={entryDate} onChange={e=>setEntryDate(e.target.value)}/></div><textarea className="min-h-40 rounded-md border p-3 font-mono text-sm" required value={csv} onChange={e=>setCsv(e.target.value)}/><Button type="submit">Validate and create draft journal</Button></form><h3 className="mt-6 font-semibold">Import register</h3>{imports.map(i=><div className="border-b py-2 text-sm" key={i.id}>{i.sourceFileName} · {i.rowCount} rows · {new Date(i.createdAt).toLocaleString()} · draft journal {i.journalEntryId}</div>)}</CardContent></Card>
  </PageContainer>;
}
