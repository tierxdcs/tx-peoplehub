'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Radio, Send } from 'lucide-react';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Textarea } from '../ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';
import { createContextPing, getContextPingRecipients, pingContextForPath, type PingEmployee } from '../../lib/pings';

export function PingWidget() {
  const pathname = usePathname(); const context = useMemo(() => pingContextForPath(pathname), [pathname]);
  const [open, setOpen] = useState(false); const [people, setPeople] = useState<PingEmployee[]>([]); const [selected, setSelected] = useState<string[]>([]); const [message, setMessage] = useState(''); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [sent, setSent] = useState(false);
  useEffect(() => { if (!open) return; setLoading(true); setError(''); getContextPingRecipients(context).then(setPeople).catch((e) => setError(e instanceof Error ? e.message : 'Recipients could not be loaded.')).finally(() => setLoading(false)); }, [open, context]);
  const submit = async () => { setLoading(true); setError(''); try { await createContextPing({ message, recipientIds: selected, linkedRecordType: context.linkedRecordType, linkedRecordId: context.linkedRecordId, verticalCode: context.verticalCode }); setSent(true); setMessage(''); setSelected([]); window.setTimeout(() => { setOpen(false); setSent(false); }, 700); } catch (e) { setError(e instanceof Error ? e.message : 'Ping could not be sent.'); } finally { setLoading(false); } };
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="icon" className="fixed bottom-5 right-5 z-40 size-14 rounded-full shadow-lg" aria-label="Send a ping"><Radio className="size-6" /></Button></DialogTrigger><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Ping someone</DialogTitle><DialogDescription>Linked automatically to {context.label.toLowerCase()}. You can ping anyone in the company.</DialogDescription></DialogHeader>
    <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">{loading && people.length === 0 ? <p className="p-2 text-sm text-muted-foreground">Loading recipients…</p> : people.length === 0 ? <p className="p-2 text-sm text-muted-foreground">No employees found.</p> : people.map((person) => <label key={person.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded px-2 hover:bg-accent"><Checkbox checked={selected.includes(person.id)} onCheckedChange={(checked) => setSelected((old) => checked ? [...old, person.id] : old.filter((id) => id !== person.id))} /><span className="min-w-0"><span className="block truncate text-sm font-medium">{person.fullName}</span><span className="block truncate text-xs text-muted-foreground">{person.email}</span></span></label>)}</div>
    <Textarea value={message} maxLength={500} onChange={(e) => setMessage(e.target.value)} placeholder="What needs attention?" />{error && <p className="text-sm text-destructive">{error}</p>}{sent && <p className="text-sm text-success">Ping sent.</p>}<Button disabled={loading || !message.trim() || selected.length === 0} onClick={submit}><Send className="size-4" />Send ping</Button>
  </DialogContent></Dialog>;
}
