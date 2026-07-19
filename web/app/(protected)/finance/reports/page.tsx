'use client';

import { useState } from 'react';
import { apiFetch, ApiError } from '../../../lib/api';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { useToast } from '../../../components/ui/toaster';

interface TrialRow { accountId:string; code:string; name:string; accountType:string; debit:string; credit:string; balance:string; }
interface Pnl { revenue:string; costOfGoodsSold:string; grossProfit:string; operatingExpenses:string; otherIncome:string; otherExpenses:string; profitBeforeTax:string; }
export default function FinanceReportsPage(){ const toast=useToast(); const now=new Date(); const fyStart=now.getMonth()>=3?now.getFullYear():now.getFullYear()-1; const [from,setFrom]=useState(`${fyStart}-04-01`); const [to,setTo]=useState(now.toISOString().slice(0,10)); const [trial,setTrial]=useState<TrialRow[]>([]); const [pnl,setPnl]=useState<Pnl|null>(null);
  async function run(){try{const q=`?from=${from}&to=${to}`;const [t,p]=await Promise.all([apiFetch<TrialRow[]>(`/finance/reports/trial-balance${q}`),apiFetch<Pnl>(`/finance/reports/profit-and-loss${q}`)]);setTrial(t);setPnl(p);}catch(e){toast.error(e instanceof ApiError?e.message:'Failed to run reports');}}
  return <PageContainer><PageHeader title="Financial reports" description="Posted journals only · INR functional currency"/><div className="mb-5 flex items-end gap-3"><label className="text-sm">From<Input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="text-sm">To<Input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><Button onClick={run}>Run reports</Button></div>{pnl&&<div className="mb-6 grid gap-3 md:grid-cols-4">{Object.entries(pnl).map(([k,v])=><Card key={k}><CardContent className="p-4"><div className="text-xs text-muted-foreground">{k.replace(/([A-Z])/g,' $1')}</div><div className="text-xl font-semibold">₹{Number(v).toLocaleString('en-IN',{minimumFractionDigits:2})}</div></CardContent></Card>)}</div>}<Card><CardContent className="overflow-x-auto p-0"><h2 className="p-4 font-semibold">Trial Balance</h2><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-3">Code</th><th>Account</th><th>Type</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead><tbody>{trial.map(r=><tr className="border-b" key={r.accountId}><td className="p-3 font-mono">{r.code}</td><td>{r.name}</td><td>{r.accountType.replaceAll('_',' ')}</td><td>{r.debit}</td><td>{r.credit}</td><td>{r.balance}</td></tr>)}</tbody></table></CardContent></Card></PageContainer>}
