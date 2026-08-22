'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { Card, CardContent } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';

type Month = { month:string; inspections:number; failures:number; ncrs:number; complaints:number; closedCapas:number; calibrations:number; calibrationFailures:number };
type Breakdown = { key:string; label:string; systemCalculated:number; manual:number; total:number };
type Data = { monthly:Month[]; totals:{inspections:number;ncrs:number;openNcrs:number;complaints:number;openComplaints:number;closedCapas:number;calibrationFailures:number}; copq:{total:number;systemCalculated:number;manual:number;unvaluedCount:number;byDisposition:Breakdown[];byProduct:Breakdown[];byOrder:Breakdown[];byParty:Breakdown[]} };
const money = (n:number) => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(n);

function CopqTable({title,rows}:{title:string;rows:Breakdown[]}) {
  return <Card><CardContent className="p-5"><h2 className="mb-3 font-semibold">{title}</h2><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead className="text-right">System-calculated</TableHead><TableHead className="text-right">Manual</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader><TableBody>{rows.length ? rows.map(x=><TableRow key={x.key}><TableCell className="font-medium">{x.label}</TableCell><TableCell className="text-right">{money(x.systemCalculated)}</TableCell><TableCell className="text-right">{money(x.manual)}</TableCell><TableCell className="text-right font-semibold">{money(x.total)}</TableCell></TableRow>) : <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">No valued failure costs in this period</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>;
}

export default function Analytics(){
  const [d,setD]=useState<Data>();
  const now=new Date(), prior=new Date(now.getFullYear(),now.getMonth()-11,1);
  const [from,setFrom]=useState(prior.toISOString().slice(0,10)),[to,setTo]=useState(now.toISOString().slice(0,10));
  useEffect(()=>{apiFetch<Data>(`/qms/analytics?from=${from}&to=${to}`).then(setD)},[from,to]);
  return <PageContainer><PageHeader title="Quality Analytics" description="Quality trends and failure-cost (COPQ) analysis" action={<div className="flex gap-2"><Input aria-label="From date" type="date" value={from} onChange={e=>setFrom(e.target.value)}/><Input aria-label="To date" type="date" value={to} onChange={e=>setTo(e.target.value)}/></div>}/>{d&&<>
    <div className="grid gap-4 md:grid-cols-4">{Object.entries({'Inspections':d.totals.inspections,'NCRs':d.totals.ncrs,'Open NCRs':d.totals.openNcrs,'Complaints':d.totals.complaints,'Open complaints':d.totals.openComplaints,'Closed CAPAs':d.totals.closedCapas,'Calibration failures':d.totals.calibrationFailures}).map(([k,v])=><Card key={k}><CardContent className="p-5"><div className="text-sm text-muted-foreground">{k}</div><div className="text-2xl font-semibold">{v}</div></CardContent></Card>)}</div>
    <div className="mt-5 grid gap-4 md:grid-cols-4"><Card><CardContent className="p-5"><div className="text-sm text-muted-foreground">Total failure cost</div><div className="text-2xl font-semibold">{money(d.copq.total)}</div></CardContent></Card><Card><CardContent className="p-5"><div className="text-sm text-muted-foreground">System-calculated scrap</div><div className="text-2xl font-semibold">{money(d.copq.systemCalculated)}</div></CardContent></Card><Card><CardContent className="p-5"><div className="text-sm text-muted-foreground">Manually entered</div><div className="text-2xl font-semibold">{money(d.copq.manual)}</div></CardContent></Card><Card><CardContent className="p-5"><div className="text-sm text-muted-foreground">NCRs without cost</div><div className="text-2xl font-semibold">{d.copq.unvaluedCount}</div></CardContent></Card></div>
    <div className="mt-5 grid gap-5 xl:grid-cols-2"><CopqTable title="Failure cost by disposition" rows={d.copq.byDisposition}/><CopqTable title="Failure cost by product / item" rows={d.copq.byProduct}/><CopqTable title="Failure cost by order" rows={d.copq.byOrder}/><CopqTable title="Failure cost by vendor / supplier" rows={d.copq.byParty}/></div>
    <Card className="mt-5"><CardContent className="overflow-x-auto p-5"><h2 className="mb-3 font-semibold">Monthly quality trend</h2><Table><TableHeader><TableRow>{['Month','Inspections','Failures','NCRs','Complaints','Closed CAPAs','Calibrations','Cal. failures'].map(x=><TableHead key={x}>{x}</TableHead>)}</TableRow></TableHeader><TableBody>{d.monthly.map(x=><TableRow key={x.month}><TableCell className="font-medium">{x.month}</TableCell><TableCell>{x.inspections}</TableCell><TableCell>{x.failures}</TableCell><TableCell>{x.ncrs}</TableCell><TableCell>{x.complaints}</TableCell><TableCell>{x.closedCapas}</TableCell><TableCell>{x.calibrations}</TableCell><TableCell>{x.calibrationFailures}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
  </>}</PageContainer>;
}
