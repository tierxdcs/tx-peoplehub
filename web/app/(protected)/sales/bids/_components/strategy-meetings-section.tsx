'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2, Users } from 'lucide-react';
import { ApiError } from '../../../../lib/api';
import {
  createBidStrategyMeeting,
  listStrategyEmployeeOptions,
  listBidStrategyMeetings,
  updateStrategyActionStatus,
  type BidStrategyMeeting,
  type StrategyMeetingMode,
} from '../../../../lib/bid-strategy-meetings';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../../components/ui/dialog';
import { Field } from '../../../../components/ui/field';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { Textarea } from '../../../../components/ui/textarea';
import { Badge } from '../../../../components/ui/badge';
import { EmptyState } from '../../../../components/ui/empty-state';
import { useToast } from '../../../../components/ui/toaster';

interface AttendeeDraft { kind: 'INTERNAL' | 'EXTERNAL'; value: string }
interface ActionDraft { description: string; ownerId: string; dueDate: string }

export function StrategyMeetingsSection({ bidId }: { bidId: string }) {
  const toast = useToast();
  const [meetings, setMeetings] = useState<BidStrategyMeeting[]>([]);
  const [employees, setEmployees] = useState<Array<{ id: string; firstName: string; lastName: string; employeeId: string }>>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [meetingDate, setMeetingDate] = useState('');
  const [meetingMode, setMeetingMode] = useState<StrategyMeetingMode>('VIRTUAL');
  const [meetingLink, setMeetingLink] = useState('');
  const [notes, setNotes] = useState('');
  const [attendees, setAttendees] = useState<AttendeeDraft[]>([{ kind: 'INTERNAL', value: '' }]);
  const [actions, setActions] = useState<ActionDraft[]>([]);

  async function load() {
    try {
      setMeetings(await listBidStrategyMeetings(bidId));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to load strategy meetings');
    }
  }

  useEffect(() => {
    void load();
    void listStrategyEmployeeOptions(bidId)
      .then(setEmployees)
      .catch(() => setEmployees([]));
    // The bid id is stable for this mounted detail page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bidId]);

  function reset() {
    setMeetingDate('');
    setMeetingMode('VIRTUAL');
    setMeetingLink('');
    setNotes('');
    setAttendees([{ kind: 'INTERNAL', value: '' }]);
    setActions([]);
  }

  async function save() {
    const validAttendees = attendees.filter((attendee) => attendee.value.trim());
    if (!meetingDate || !notes.trim() || !validAttendees.length || (meetingMode === 'VIRTUAL' && !meetingLink.trim())) {
      toast.error('Complete the meeting details and add at least one attendee');
      return;
    }
    if (actions.some((action) => !action.description.trim() || !action.ownerId)) {
      toast.error('Every action item needs a description and owner');
      return;
    }
    setSaving(true);
    try {
      await createBidStrategyMeeting(bidId, {
        meetingDate: new Date(meetingDate).toISOString(),
        meetingMode,
        ...(meetingLink.trim() ? { meetingLink: meetingLink.trim() } : {}),
        notes: notes.trim(),
        attendees: validAttendees.map((attendee) =>
          attendee.kind === 'INTERNAL'
            ? { employeeId: attendee.value }
            : { externalName: attendee.value.trim() },
        ),
        actionItems: actions.map((action) => ({
          description: action.description.trim(),
          ownerId: action.ownerId,
          ...(action.dueDate ? { dueDate: action.dueDate } : {}),
        })),
      });
      toast.success('Strategy meeting recorded');
      setOpen(false);
      reset();
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to create meeting');
    } finally {
      setSaving(false);
    }
  }

  async function toggleAction(meeting: BidStrategyMeeting, actionId: string, done: boolean) {
    try {
      await updateStrategyActionStatus(bidId, actionId, done ? 'DONE' : 'OPEN');
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to update action item');
    }
  }

  return (
    <>
      <Card id="strategy-meetings" className="mt-6 scroll-mt-20">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Strategy Meetings</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Pre-bid decisions, participants, and lightweight follow-ups.</p>
          </div>
          <Button onClick={() => setOpen(true)}><Plus /> New Meeting</Button>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          {!meetings.length ? (
            <EmptyState icon={Users} title="No strategy meetings" description="Record a discussion whenever the bid needs alignment." />
          ) : meetings.map((meeting) => {
            const isExpanded = expanded.has(meeting.id);
            return (
              <div key={meeting.id} className="rounded-md border">
                <button type="button" className="flex min-h-12 w-full items-center justify-between gap-3 p-4 text-left" onClick={() => setExpanded((current) => { const next = new Set(current); isExpanded ? next.delete(meeting.id) : next.add(meeting.id); return next; })}>
                  <span className="flex items-center gap-3">
                    {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    <span><strong>{new Date(meeting.meetingDate).toLocaleString()}</strong><span className="ml-2 text-sm text-muted-foreground">{meeting.meetingMode.replace('_', ' ')}</span></span>
                  </span>
                  <Badge variant="muted">{meeting.actionItems.filter((item) => item.status === 'OPEN').length} open actions</Badge>
                </button>
                {isExpanded && (
                  <div className="space-y-4 border-t p-4 text-sm">
                    {meeting.meetingLink && <a className="text-primary hover:underline" href={meeting.meetingLink} target="_blank" rel="noreferrer">Open meeting link</a>}
                    <div><p className="font-medium">Notes and decisions</p><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{meeting.notes}</p></div>
                    <div><p className="font-medium">Attendees</p><div className="mt-2 flex flex-wrap gap-2">{meeting.attendees.map((attendee) => <Badge key={attendee.id} variant="outline">{attendee.displayName}{attendee.isInternal ? ' · Internal' : ' · External'}</Badge>)}</div></div>
                    <div><p className="font-medium">Action items</p>{meeting.actionItems.length ? <div className="mt-2 space-y-2">{meeting.actionItems.map((action) => <label key={action.id} className="flex cursor-pointer items-start gap-3 rounded border p-3"><input className="mt-1" type="checkbox" checked={action.status === 'DONE'} onChange={(event) => void toggleAction(meeting, action.id, event.target.checked)} /><span><span className={action.status === 'DONE' ? 'line-through text-muted-foreground' : ''}>{action.description}</span><span className="block text-xs text-muted-foreground">{action.ownerName}{action.dueDate ? ` · Due ${new Date(action.dueDate).toLocaleDateString()}` : ''}</span></span></label>)}</div> : <p className="mt-1 text-muted-foreground">No action items.</p>}</div>
                    <p className="text-xs text-muted-foreground">Recorded by {meeting.createdByName}</p>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>New Bid Strategy Meeting</DialogTitle></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Meeting date and time" required><Input type="datetime-local" value={meetingDate} onChange={(event) => setMeetingDate(event.target.value)} /></Field>
            <Field label="Mode" required><Select value={meetingMode} onChange={(event) => setMeetingMode(event.target.value as StrategyMeetingMode)}><option value="VIRTUAL">Virtual</option><option value="IN_PERSON">In-person</option><option value="HYBRID">Hybrid</option></Select></Field>
            {(meetingMode === 'VIRTUAL' || meetingMode === 'HYBRID') && <Field label="Meeting link" required={meetingMode === 'VIRTUAL'}><Input value={meetingLink} onChange={(event) => setMeetingLink(event.target.value)} placeholder="https://…" /></Field>}
            <div className="sm:col-span-2"><Field label="Discussion summary, approach and decisions" required><Textarea className="min-h-28" value={notes} onChange={(event) => setNotes(event.target.value)} /></Field></div>
          </div>
          <section className="space-y-2"><div className="flex items-center justify-between"><h3 className="font-medium">Attendees</h3><Button variant="outline" size="sm" onClick={() => setAttendees((current) => [...current, { kind: 'INTERNAL', value: '' }])}><Plus /> Add</Button></div>{attendees.map((attendee, index) => <div key={index} className="flex gap-2"><Select className="w-36" value={attendee.kind} onChange={(event) => setAttendees((current) => current.map((item, i) => i === index ? { kind: event.target.value as AttendeeDraft['kind'], value: '' } : item))}><option value="INTERNAL">Internal</option><option value="EXTERNAL">External</option></Select>{attendee.kind === 'INTERNAL' ? <Select className="flex-1" value={attendee.value} onChange={(event) => setAttendees((current) => current.map((item, i) => i === index ? { ...item, value: event.target.value } : item))}><option value="">Select employee…</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</Select> : <Input className="flex-1" placeholder="External attendee name" value={attendee.value} onChange={(event) => setAttendees((current) => current.map((item, i) => i === index ? { ...item, value: event.target.value } : item))} />}<Button variant="ghost" size="icon" onClick={() => setAttendees((current) => current.filter((_, i) => i !== index))}><Trash2 /></Button></div>)}</section>
          <section className="space-y-2"><div className="flex items-center justify-between"><h3 className="font-medium">Action items</h3><Button variant="outline" size="sm" onClick={() => setActions((current) => [...current, { description: '', ownerId: '', dueDate: '' }])}><Plus /> Add</Button></div>{actions.map((action, index) => <div key={index} className="grid gap-2 rounded border p-3 sm:grid-cols-[2fr_1fr_1fr_auto]"><Input placeholder="Follow-up" value={action.description} onChange={(event) => setActions((current) => current.map((item, i) => i === index ? { ...item, description: event.target.value } : item))} /><Select value={action.ownerId} onChange={(event) => setActions((current) => current.map((item, i) => i === index ? { ...item, ownerId: event.target.value } : item))}><option value="">Owner…</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</Select><Input type="date" value={action.dueDate} onChange={(event) => setActions((current) => current.map((item, i) => i === index ? { ...item, dueDate: event.target.value } : item))} /><Button variant="ghost" size="icon" onClick={() => setActions((current) => current.filter((_, i) => i !== index))}><Trash2 /></Button></div>)}</section>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save meeting'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
