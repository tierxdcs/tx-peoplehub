'use client';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';

import { useState } from 'react';
import { apiFetch, ApiError } from '../../../lib/api';
import { formatINR } from '../../../lib/sales';
import { useNumberFormat } from '../../../lib/number-format-context';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { useToast } from '../../../components/ui/toaster';

interface TrialRow { accountId:string; code:string; name:string; accountType:string; debit:string; credit:string; balance:string; }
interface Pnl { revenue:string; costOfGoodsSold:string; grossProfit:string; operatingExpenses:string; otherIncome:string; otherExpenses:string; profitBeforeTax:string; }
export default function FinanceReportsPage(){ const toast=useToast(); const { style: numberFormatStyle } = useNumberFormat(); const now=new Date(); const fyStart=now.getMonth()>=3?now.getFullYear():now.getFullYear()-1; const [from,setFrom]=useState(`${fyStart}-04-01`); const [to,setTo]=useState(now.toISOString().slice(0,10)); const [trial,setTrial]=useState<TrialRow[]>([]); const [pnl,setPnl]=useState<Pnl|null>(null);
  async function run(){try{const q=`?from=${from}&to=${to}`;const [t,p]=await Promise.all([apiFetch<TrialRow[]>(`/finance/reports/trial-balance${q}`),apiFetch<Pnl>(`/finance/reports/profit-and-loss${q}`)]);setTrial(t);setPnl(p);}catch(e){toast.error(e instanceof ApiError?e.message:'Failed to run reports');}}
  return <PageContainer><PageHeader title="Financial reports" description="Posted journals only · INR functional currency"/><div className="mb-5 flex items-end gap-3"><label className="text-sm">From<Input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="text-sm">To<Input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><Button onClick={run}>Run reports</Button></div>{pnl&&<div className="mb-6 grid gap-3 md:grid-cols-4">{Object.entries(pnl).map(([k,v])=><Card key={k}><CardContent className="p-4"><div className="text-xs text-muted-foreground">{k.replace(/([A-Z])/g,' $1')}</div><div className="text-xl font-semibold">{formatINR(v, numberFormatStyle)}</div></CardContent></Card>)}</div>}<Card><CardContent className="overflow-x-auto p-0"><h2 className="p-4 font-semibold">Trial Balance</h2><Table className="w-full text-sm"><TableHeader><TableRow className="border-b text-left"><TableHead className="p-3">Code</TableHead><TableHead>Account</TableHead><TableHead>Type</TableHead><TableHead>Debit</TableHead><TableHead>Credit</TableHead><TableHead>Balance</TableHead></TableRow></TableHeader><TableBody>{trial.map(r=><TableRow className="border-b" key={r.accountId}><TableCell className="p-3 font-mono">{r.code}</TableCell><TableCell>{r.name}</TableCell><TableCell>{r.accountType.replaceAll('_',' ')}</TableCell><TableCell>{formatINR(r.debit, numberFormatStyle)}</TableCell><TableCell>{formatINR(r.credit, numberFormatStyle)}</TableCell><TableCell>{formatINR(r.balance, numberFormatStyle)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card></PageContainer>}
