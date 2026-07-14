'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { ApiError } from '../../../lib/api';
import { addMember, createBoard } from '../../../lib/kanban';
import { useAuth } from '../../../lib/auth-context';
import { useToast } from '../../../components/ui/toaster';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { Button } from '../../../components/ui/button';
import { Avatar } from '../../../components/ui/avatar';
import { EmployeePicker } from '../../vault/_components/employee-picker';
import type { EmployeeSearchResult } from '../../../lib/types';

/**
 * Create a board and its initial membership in one action (spec §2). The
 * creator is auto-included by the backend and shown here as a non-removable
 * entry. Selected members are added via addMember after the board is created.
 */
export function CreateBoardDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (boardId: string) => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [name, setName] = useState('');
  const [members, setMembers] = useState<EmployeeSearchResult[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();

  async function submit() {
    if (!trimmed) {
      setError('Board name is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const board = await createBoard(trimmed);
      // Add each picked member; the creator is already a member server-side.
      for (const m of members) {
        await addMember(board.id, m.id);
      }
      toast.success('Board created.');
      onCreated(board.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create board.');
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New board</DialogTitle>
          <DialogDescription>
            Name the board and add its initial members. You’re added
            automatically as a member.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Board name" required htmlFor="board-name">
            <Input
              id="board-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Q3 Marketing"
              autoFocus
            />
          </Field>

          <div className="space-y-2">
            <p className="text-sm font-medium">Members</p>
            <EmployeePicker
              onSelect={(e) =>
                setMembers((prev) =>
                  prev.some((m) => m.id === e.id) ? prev : [...prev, e],
                )
              }
              excludeIds={[
                ...(user ? [user.sub] : []),
                ...members.map((m) => m.id),
              ]}
            />
            <ul className="space-y-1">
              {user && (
                <li className="flex items-center gap-2 rounded-md bg-muted px-2 py-1.5 text-sm">
                  <Avatar name={user.email} />
                  <span className="min-w-0 flex-1 truncate">{user.email}</span>
                  <span className="text-xs text-muted-foreground">Creator</span>
                </li>
              )}
              {members.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm"
                >
                  <Avatar name={m.fullName} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {m.fullName}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {m.email}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${m.fullName}`}
                    onClick={() =>
                      setMembers((prev) => prev.filter((x) => x.id !== m.id))
                    }
                    className="rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !trimmed}>
            {submitting ? 'Creating…' : 'Create board'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
