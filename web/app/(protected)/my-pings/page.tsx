'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, CheckCheck, Send } from 'lucide-react';
import { PageContainer } from '../../components/ui/page-container';
import { PageHeader } from '../../components/ui/page-header';
import { RegisterToolbar } from '../../components/ui/register-toolbar';
import { RegisterPagination } from '../../components/ui/register-pagination';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import { EmptyState } from '../../components/ui/empty-state';
import { EmployeePicker } from '../vault/_components/employee-picker';
import type { EmployeeSearchResult } from '../../lib/types';
import { cn } from '../../lib/utils';
import { createPing, getReceivedPings, getSentPings, linkedPingHref, pingAgeHours, respondToPing, type ReceivedPing, type SentPing } from '../../lib/pings';

const PAGE_SIZE = 15;

export default function MyPingsPage() {
  const [received, setReceived] = useState<ReceivedPing[]>([]); const [sent, setSent] = useState<SentPing[]>([]);
  const [view, setView] = useState<'received' | 'sent'>('received'); const [status, setStatus] = useState('all'); const [search, setSearch] = useState(''); const [page, setPage] = useState(1);
  const [recipients, setRecipients] = useState<EmployeeSearchResult[]>([]); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const load = () => Promise.all([getReceivedPings(), getSentPings()]).then(([r, s]) => { setReceived(r); setSent(s); });
  useEffect(() => { load().catch((e) => setError(e instanceof Error ? e.message : 'Pings could not be loaded.')); }, []);
  useEffect(() => setPage(1), [view, status, search]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (view === 'received') return received.filter((r) => (status === 'all' || r.status.toLowerCase() === status) && (!q || `${r.ping.message} ${r.ping.fromEmployee.fullName}`.toLowerCase().includes(q)));
    return sent.filter((r) => (status === 'all' || r.recipients.some((x) => x.status.toLowerCase() === status)) && (!q || `${r.message} ${r.recipients.map((x) => x.employee.fullName).join(' ')}`.toLowerCase().includes(q)));
  }, [received, sent, view, status, search]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)); const visible = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const submit = async () => { setError(''); try { await createPing({ message, recipientIds: recipients.map((r) => r.id) }); setMessage(''); setRecipients([]); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not send ping.'); } };
  const respond = async (id: string, next: 'ACKNOWLEDGED' | 'RESOLVED') => { await respondToPing(id, next); await load(); };
  return <PageContainer className="space-y-6"><PageHeader title="My Pings" description="Short reminders that stay visible until you acknowledge or resolve them." />
    <Card><CardContent className="space-y-4 p-5"><h2 className="font-semibold">Send a ping</h2><div><EmployeePicker excludeIds={recipients.map((r) => r.id)} onSelect={(r) => setRecipients((old) => [...old, r])} /><div className="mt-2 flex flex-wrap gap-2">{recipients.map((r) => <button type="button" key={r.id} onClick={() => setRecipients((old) => old.filter((x) => x.id !== r.id))} className="rounded-full bg-muted px-3 py-1 text-xs">{r.fullName} ×</button>)}</div></div><Textarea value={message} maxLength={500} onChange={(e) => setMessage(e.target.value)} placeholder="What needs attention?" />
      {error && <p className="text-sm text-destructive">{error}</p>}<Button disabled={!message.trim() || recipients.length === 0} onClick={submit}><Send className="mr-2 size-4" />Send ping</Button></CardContent></Card>
    <RegisterToolbar title="Ping register" search={search} onSearchChange={setSearch} searchPlaceholder="Search message or employee" filters={<><select value={view} onChange={(e) => setView(e.target.value as 'received' | 'sent')} className="h-10 rounded-md border bg-background px-3 text-sm"><option value="received">Received</option><option value="sent">Sent</option></select><select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm"><option value="all">All statuses</option><option value="pending">Pending</option><option value="acknowledged">Acknowledged</option><option value="resolved">Resolved</option></select></>} />
    <Card><CardContent className="p-0">{visible.length === 0 ? <EmptyState title="No pings found" description="Pings matching this view will appear here." /> : <Table><TableHeader><TableRow><TableHead>{view === 'received' ? 'From' : 'Recipients'}</TableHead><TableHead>Message</TableHead><TableHead>Status</TableHead><TableHead>Age</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{visible.map((item) => view === 'received' ? <ReceivedRow key={(item as ReceivedPing).id} row={item as ReceivedPing} onRespond={respond} /> : <SentRow key={(item as SentPing).id} row={item as SentPing} />)}</TableBody></Table>}</CardContent></Card><RegisterPagination page={page} pageCount={pageCount} onPageChange={setPage} />
  </PageContainer>;
}

function ReceivedRow({ row, onRespond }: { row: ReceivedPing; onRespond: (id: string, s: 'ACKNOWLEDGED' | 'RESOLVED') => void }) { const age = pingAgeHours(row.ping.createdAt); const overdue = row.status === 'PENDING' && age >= 24; const href = linkedPingHref(row.ping.linkedRecordType, row.ping.linkedRecordId); return <TableRow className={cn(row.status === 'PENDING' && (overdue ? 'ping-overdue bg-destructive/10' : 'ping-new bg-destructive/5'))}><TableCell>{row.ping.fromEmployee.fullName}</TableCell><TableCell className="max-w-md"><p>{row.ping.message}</p>{href && <Link href={href} className="text-xs text-primary hover:underline">Open linked record</Link>}</TableCell><TableCell><span className={row.status === 'PENDING' ? 'text-destructive' : 'text-success'}>{row.status === 'PENDING' ? 'Pending' : row.status === 'RESOLVED' ? 'Resolved' : 'Acknowledged'}</span></TableCell><TableCell>{age}h{overdue ? ` (${age - 24}h overdue)` : ''}</TableCell><TableCell><div className="flex justify-end gap-2">{row.status === 'PENDING' && <><Button size="sm" variant="outline" onClick={() => onRespond(row.id, 'ACKNOWLEDGED')}><Check className="size-4" /></Button><Button size="sm" onClick={() => onRespond(row.id, 'RESOLVED')}><CheckCheck className="size-4" /></Button></>}{row.status === 'ACKNOWLEDGED' && <Button size="sm" onClick={() => onRespond(row.id, 'RESOLVED')}>Resolve</Button>}</div></TableCell></TableRow>; }
function SentRow({ row }: { row: SentPing }) { return <TableRow><TableCell>{row.recipients.map((r) => r.employee.fullName).join(', ')}</TableCell><TableCell>{row.message}</TableCell><TableCell><div className="flex flex-wrap gap-1">{row.recipients.map((r) => <span key={r.id} className={r.status === 'PENDING' ? 'text-destructive' : 'text-success'}>{r.employee.fullName}: {r.status.toLowerCase()}</span>)}</div></TableCell><TableCell>{pingAgeHours(row.createdAt)}h</TableCell><TableCell /></TableRow>; }
