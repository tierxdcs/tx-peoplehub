'use client';

import { useState } from 'react';
import { Pencil, Trash2, X } from 'lucide-react';
import {
  addMember,
  createLabel,
  deleteLabel,
  removeMember,
  updateLabel,
  LABEL_COLORS,
  type KanbanBoard,
  type KanbanBoardMember,
  type KanbanLabel,
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
import { Button } from '../../../components/ui/button';
import { Avatar } from '../../../components/ui/avatar';
import { cn } from '../../../lib/utils';
import { EmployeePicker } from '../../vault/_components/employee-picker';

/**
 * Board management (spec §6): add/remove members (the creator can't be
 * removed) and manage the label set (create/edit/delete). Scrum
 * Master/SuperAdmin only — the board view only mounts this for canManage.
 */
export function ManageBoardDialog({
  board,
  members,
  labels,
  onClose,
  onMembersChanged,
  onLabelsChanged,
}: {
  board: KanbanBoard;
  members: KanbanBoardMember[];
  labels: KanbanLabel[];
  onClose: () => void;
  onMembersChanged: (next: KanbanBoardMember[]) => void;
  onLabelsChanged: (next: KanbanLabel[]) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<'members' | 'labels'>('members');

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage “{board.name}”</DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 rounded-md bg-muted p-1">
          {(['members', 'labels'] as const).map((t) => (
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

        {tab === 'members' ? (
          <MembersPanel
            board={board}
            members={members}
            onMembersChanged={onMembersChanged}
            toast={toast}
            confirm={confirm}
          />
        ) : (
          <LabelsPanel
            board={board}
            labels={labels}
            onLabelsChanged={onLabelsChanged}
            toast={toast}
            confirm={confirm}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type ToastApi = ReturnType<typeof useToast>;
type ConfirmApi = ReturnType<typeof useConfirm>;

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
      toast.error(err instanceof ApiError ? err.message : 'Failed to add member.');
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
      toast.error(err instanceof ApiError ? err.message : 'Failed to remove member.');
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
      toast.error(err instanceof ApiError ? err.message : 'Failed to save label.');
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
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete label.');
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
