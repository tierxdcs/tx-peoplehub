'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch, ApiError } from '../../../lib/api';
import { useFinanceAccess } from '../../../lib/use-finance-access';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Select } from '../../../components/ui/select';
import { useToast } from '../../../components/ui/toaster';

interface Account { id: string; code: string; name: string; }
interface Journal { id: string; journalNumber: string; entryDate: string; description: string; status: string; createdById: string; lines: Array<{ debit: string; credit: string }>; }
interface Page<T> { items: T[]; total: number; }

export default function JournalsPage() {
  const toast = useToast(); const { isAccountsHead } = useFinanceAccess();
  const [accounts, setAccounts] = useState<Account[]>([]); const [journals, setJournals] = useState<Journal[]>([]);
  const [date, setDate] = useState(new Date().toISOString().slice(0,10)); const [description, setDescription] = useState('');
  const [debitAccount, setDebitAccount] = useState(''); const [creditAccount, setCreditAccount] = useState(''); const [amount, setAmount] = useState('');
  const load = () => Promise.all([apiFetch<Account[]>('/finance/accounts'), apiFetch<Page<Journal>>('/finance/journals?limit=100')]).then(([a,j]) => { setAccounts(a); setJournals(j.items); if (!debitAccount && a[0]) { setDebitAccount(a[0].id); setCreditAccount(a[1]?.id ?? a[0].id); } });
  useEffect(() => { load().catch((e) => toast.error(e instanceof ApiError ? e.message : 'Failed to load journals')); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function create(event: FormEvent) { event.preventDefault(); try { await apiFetch('/finance/journals', { method:'POST', body:JSON.stringify({ entryDate:date, description, lines:[{accountId:debitAccount,debit:Number(amount),credit:0},{accountId:creditAccount,debit:0,credit:Number(amount)}] }) }); setDescription(''); setAmount(''); toast.success('Draft journal created'); await load(); } catch(e) { toast.error(e instanceof ApiError ? e.message : 'Failed to create journal'); } }
  async function action(id:string, action:string) { try { await apiFetch(`/finance/journals/${id}/${action}`, { method:'POST', ...(action === 'reject' ? { body: JSON.stringify({ comment: window.prompt('Rejection reason') || '' }) } : {}) }); toast.success(`Journal ${action}d`); await load(); } catch(e) { toast.error(e instanceof ApiError ? e.message : `Failed to ${action} journal`); } }
  return <PageContainer><div className="mb-1 flex items-center justify-between"><PageHeader title="Journal Vouchers" description="Balanced manual journals; Finance Head approval posts to the ledger" /><Link href="/finance/vouchers/journal/new"><Button variant="outline">New Journal Voucher</Button></Link></div>
    <Card className="mb-6"><CardContent className="p-5"><form onSubmit={create} className="grid gap-3 md:grid-cols-6"><Input type="date" required value={date} onChange={(e)=>setDate(e.target.value)} /><Input className="md:col-span-2" required placeholder="Description" value={description} onChange={(e)=>setDescription(e.target.value)} /><Select required value={debitAccount} onChange={(e)=>setDebitAccount(e.target.value)}>{accounts.map(a=><option key={a.id} value={a.id}>Dr {a.code} · {a.name}</option>)}</Select><Select required value={creditAccount} onChange={(e)=>setCreditAccount(e.target.value)}>{accounts.map(a=><option key={a.id} value={a.id}>Cr {a.code} · {a.name}</option>)}</Select><div className="flex gap-2"><Input required type="number" min="0.01" step="0.01" placeholder="INR" value={amount} onChange={(e)=>setAmount(e.target.value)} /><Button type="submit">Create</Button></div></form></CardContent></Card>
    <Card><CardContent className="overflow-x-auto p-0"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-3">Journal</th><th>Date</th><th>Description</th><th>Status</th><th>Actions</th></tr></thead><tbody>{journals.map(j=><tr className="border-b" key={j.id}><td className="p-3 font-mono">{j.journalNumber}</td><td>{j.entryDate.slice(0,10)}</td><td>{j.description}</td><td>{j.status.replaceAll('_',' ')}</td><td className="space-x-2">{(j.status==='DRAFT'||j.status==='REJECTED')&&<Button size="sm" variant="outline" onClick={()=>action(j.id,'submit')}>Submit</Button>}{isAccountsHead&&j.status==='PENDING_APPROVAL'&&<><Button size="sm" onClick={()=>action(j.id,'approve')}>Approve</Button><Button size="sm" variant="destructive" onClick={()=>action(j.id,'reject')}>Reject</Button></>}{isAccountsHead&&j.status==='POSTED'&&<Button size="sm" variant="outline" onClick={()=>action(j.id,'reverse')}>Reverse</Button>}</td></tr>)}</tbody></table></CardContent></Card>
  </PageContainer>;
}
