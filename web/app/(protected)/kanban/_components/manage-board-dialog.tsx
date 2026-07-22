'use client';

import { useState } from 'react';
import { CalendarRange, Pencil, Trash2, X } from 'lucide-react';
import {
  addMember,
  createLabel,
  createSprint,
  deleteList,
  deleteLabel,
  removeMember,
  updateLabel,
  updateList,
  LABEL_COLORS,
  SPRINT_DURATION_LABEL,
  type KanbanBoard,
  type KanbanBoardMember,
  type KanbanLabel,
  type KanbanList,
  type KanbanSprint,
  type SprintDuration,
} from '../../../lib/kanban';
import { ApiError } from '../../../lib/api';
import { useToast } from '../../../components/ui/toaster';
import { useConfirm } from '../../../components/ui/confirm';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Button } from '../../../components/ui/button';
import { Avatar } from '../../../components/ui/avatar';
import { cn } from '../../../lib/utils';
import { EmployeePicker } from '../../vault/_components/employee-picker';

/**
 * Board management (spec §6): manage lists, add/remove members (the creator
 * can't be removed), manage the label set (create/edit/delete), and create
 * sprints. The board view mounts this for canManageLists (Scrum Master/
 * SuperAdmin/board creator) — but members/labels/sprints stay Scrum-Master/
 * SuperAdmin territory with no creator exception, so `canManageBoard` hides
 * those three tabs for a creator-only viewer rather than let them hit a 403.
 */
export function ManageBoardDialog({
  board,
  members,
  labels,
  sprints,
  lists,
  canManageBoard,
  onClose,
  onMembersChanged,
  onLabelsChanged,
  onSprintsChanged,
  onListsChanged,
}: {
  board: KanbanBoard;
  members: KanbanBoardMember[];
  labels: KanbanLabel[];
  sprints: KanbanSprint[];
  lists: KanbanList[];
  canManageBoard: boolean;
  onClose: () => void;
  onMembersChanged: (next: KanbanBoardMember[]) => void;
  onLabelsChanged: (next: KanbanLabel[]) => void;
  onSprintsChanged: (next: KanbanSprint[]) => void;
  onListsChanged: (next: KanbanList[]) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const tabs = (['lists', 'members', 'labels', 'sprints'] as const).filter(
    (t) => t === 'lists' || canManageBoard,
  );
  const [tab, setTab] = useState<(typeof tabs)[number]>('lists');

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage “{board.name}”</DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 rounded-md bg-muted p-1">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                'flex-1 rounded px-3 py-1 text-sm font-medium capitalize transition-colors',
                tab === t
                  ? 'bg-background shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'members' && (
          <MembersPanel
            board={board}
            members={members}
            onMembersChanged={onMembersChanged}
            toast={toast}
            confirm={confirm}
          />
        )}
        {tab === 'lists' && (
          <ListsPanel
            lists={lists}
            onListsChanged={onListsChanged}
            toast={toast}
            confirm={confirm}
          />
        )}
        {tab === 'labels' && (
          <LabelsPanel
            board={board}
            labels={labels}
            onLabelsChanged={onLabelsChanged}
            toast={toast}
            confirm={confirm}
          />
        )}
        {tab === 'sprints' && (
          <SprintsPanel
            board={board}
            sprints={sprints}
            onSprintsChanged={onSprintsChanged}
            toast={toast}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type ToastApi = ReturnType<typeof useToast>;
type ConfirmApi = ReturnType<typeof useConfirm>;

function ListsPanel({
  lists,
  onListsChanged,
  toast,
  confirm,
}: {
  lists: KanbanList[];
  onListsChanged: (next: KanbanList[]) => void;
  toast: ToastApi;
  confirm: ConfirmApi;
}) {
  async function designate(list: KanbanList) {
    if (list.isDoneList) return;
    try {
      const updated = await updateList(list.id, { isDoneList: true });
      onListsChanged(
        lists.map((item) =>
          item.id === updated.id ? updated : { ...item, isDoneList: false },
        ),
      );
      toast.success(`“${updated.name}” now counts as done.`);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to update done list.',
      );
    }
  }

  async function rename(list: KanbanList) {
    const name = window.prompt('List name', list.name)?.trim();
    if (!name || name === list.name) return;
    try {
      const updated = await updateList(list.id, { name });
      onListsChanged(
        lists.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to rename list.',
      );
    }
  }

  async function remove(list: KanbanList) {
    if (
      !(await confirm({
        title: 'Delete list?',
        description: list.isDoneList
          ? 'Designate another list as done before deleting this one.'
          : `“${list.name}” can only be deleted when it has no active cards.`,
        confirmLabel: 'Delete',
        destructive: true,
      }))
    )
      return;
    try {
      await deleteList(list.id);
      onListsChanged(lists.filter((item) => item.id !== list.id));
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to delete list.',
      );
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Exactly one list counts as done. Dashboard completion and overdue
        metrics use this designation.
      </p>
      <ul className="space-y-2">
        {lists.map((list) => (
          <li
            key={list.id}
            className="flex items-center gap-2 rounded-md border p-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{list.name}</p>
              <p className="text-xs text-muted-foreground">
                {list.cardCount} active card(s)
              </p>
            </div>
            <Button
              size="sm"
              variant={list.isDoneList ? 'default' : 'outline'}
              disabled={list.isDoneList}
              onClick={() => void designate(list)}
            >
              {list.isDoneList ? 'Counts as done' : 'Set as done'}
            </Button>
            <button
              type="button"
              aria-label="Rename list"
              onClick={() => void rename(list)}
              className="rounded p-1 text-muted-foreground hover:bg-accent"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Delete list"
              onClick={() => void remove(list)}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MembersPanel({
  board,
  members,
  onMembersChanged,
  toast,
  confirm,
}: {
  board: KanbanBoard;
  members: KanbanBoardMember[];
  onMembersChanged: (next: KanbanBoardMember[]) => void;
  toast: ToastApi;
  confirm: ConfirmApi;
}) {
  const [busy, setBusy] = useState(false);

  async function add(employeeId: string) {
    if (members.some((m) => m.employeeId === employeeId)) return;
    setBusy(true);
    try {
      const added = await addMember(board.id, employeeId);
      onMembersChanged([...members, added]);
      toast.success('Member added.');
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to add member.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(m: KanbanBoardMember) {
    if (
      !(await confirm({
        title: 'Remove member?',
        description: `${m.employeeName ?? m.employeeEmail} will lose access to this board.`,
        confirmLabel: 'Remove',
        destructive: true,
      }))
    )
      return;
    try {
      await removeMember(board.id, m.employeeId);
      onMembersChanged(members.filter((x) => x.employeeId !== m.employeeId));
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to remove member.',
      );
    }
  }

  return (
    <div className="space-y-3">
      <EmployeePicker
        onSelect={(e) => void add(e.id)}
        excludeIds={members.map((m) => m.employeeId)}
      />
      <ul className="max-h-64 space-y-1 overflow-y-auto">
        {members.map((m) => {
          const isCreator = m.employeeId === board.createdById;
          return (
            <li
              key={m.employeeId}
              className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm"
            >
              <Avatar name={m.employeeName ?? m.employeeEmail ?? '?'} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {m.employeeName ?? m.employeeEmail}
                </span>
                {m.employeeEmail && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {m.employeeEmail}
                  </span>
                )}
              </span>
              {isCreator ? (
                <span className="text-xs text-muted-foreground">Creator</span>
              ) : (
                <button
                  type="button"
                  aria-label="Remove member"
                  disabled={busy}
                  onClick={() => remove(m)}
                  className="rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LabelsPanel({
  board,
  labels,
  onLabelsChanged,
  toast,
  confirm,
}: {
  board: KanbanBoard;
  labels: KanbanLabel[];
  onLabelsChanged: (next: KanbanLabel[]) => void;
  toast: ToastApi;
  confirm: ConfirmApi;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(LABEL_COLORS[0].value);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function resetForm() {
    setName('');
    setColor(LABEL_COLORS[0].value);
    setEditingId(null);
  }

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      if (editingId) {
        const updated = await updateLabel(editingId, { name: trimmed, color });
        onLabelsChanged(labels.map((l) => (l.id === updated.id ? updated : l)));
      } else {
        const created = await createLabel(board.id, { name: trimmed, color });
        onLabelsChanged([...labels, created]);
      }
      resetForm();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to save label.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(l: KanbanLabel) {
    if (
      !(await confirm({
        title: 'Delete label?',
        description: `“${l.name}” will be removed from all cards on this board.`,
        confirmLabel: 'Delete',
        destructive: true,
      }))
    )
      return;
    try {
      await deleteLabel(l.id);
      onLabelsChanged(labels.filter((x) => x.id !== l.id));
      if (editingId === l.id) resetForm();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to delete label.',
      );
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-md border p-3">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Label name…"
        />
        <div className="flex flex-wrap gap-1.5">
          {LABEL_COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              aria-label={c.name}
              onClick={() => setColor(c.value)}
              className={cn(
                'h-6 w-6 rounded-full border-2',
                color === c.value ? 'border-foreground' : 'border-transparent',
              )}
              style={{ backgroundColor: c.value }}
            />
          ))}
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={submit} disabled={busy || !name.trim()}>
            {editingId ? 'Save label' : 'Add label'}
          </Button>
          {editingId && (
            <Button size="sm" variant="ghost" onClick={resetForm}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      <ul className="max-h-56 space-y-1 overflow-y-auto">
        {labels.length === 0 && (
          <li className="py-3 text-center text-sm text-muted-foreground">
            No labels yet.
          </li>
        )}
        {labels.map((l) => (
          <li
            key={l.id}
            className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm"
          >
            <span
              className="h-4 w-8 rounded"
              style={{ backgroundColor: l.color }}
            />
            <span className="min-w-0 flex-1 truncate">{l.name}</span>
            <button
              type="button"
              aria-label="Edit label"
              onClick={() => {
                setEditingId(l.id);
                setName(l.name);
                setColor(l.color);
              }}
              className="rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Delete label"
              onClick={() => remove(l)}
              className="rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const DURATION_OPTIONS: SprintDuration[] = [
  'ONE_WEEK',
  'TWO_WEEKS',
  'THREE_WEEKS',
  'FOUR_WEEKS',
];

function formatSprintRange(start: string, end: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  return `${fmt(start)} – ${fmt(end)}`;
}

function SprintsPanel({
  board,
  sprints,
  onSprintsChanged,
  toast,
}: {
  board: KanbanBoard;
  sprints: KanbanSprint[];
  onSprintsChanged: (next: KanbanSprint[]) => void;
  toast: ToastApi;
}) {
  const [name, setName] = useState('');
  const [duration, setDuration] = useState<SprintDuration>('TWO_WEEKS');
  const [startDate, setStartDate] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || !startDate) return;
    setBusy(true);
    try {
      const created = await createSprint(board.id, {
        name: trimmed,
        durationWeeks: duration,
        startDate,
      });
      // Keep the list ordered by start date, like the board's own load.
      onSprintsChanged(
        [...sprints, created].sort((a, b) =>
          a.startDate.localeCompare(b.startDate),
        ),
      );
      toast.success('Sprint created.');
      setName('');
      setStartDate('');
      setDuration('TWO_WEEKS');
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to create sprint.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-md border p-3">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sprint name…"
        />
        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
            Start date
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-8"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
            Duration
            <Select
              value={duration}
              onChange={(e) => setDuration(e.target.value as SprintDuration)}
              className="h-8"
            >
              {DURATION_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {SPRINT_DURATION_LABEL[d]}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <Button
          size="sm"
          onClick={submit}
          disabled={busy || !name.trim() || !startDate}
        >
          {busy ? 'Creating…' : 'Add sprint'}
        </Button>
      </div>

      <ul className="max-h-56 space-y-1 overflow-y-auto">
        {sprints.length === 0 && (
          <li className="py-3 text-center text-sm text-muted-foreground">
            No sprints yet.
          </li>
        )}
        {sprints.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm"
          >
            <CalendarRange className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{s.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {formatSprintRange(s.startDate, s.endDate)}
              </span>
            </span>
            <span className="shrink-0 text-xs capitalize text-muted-foreground">
              {s.status.toLowerCase()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
