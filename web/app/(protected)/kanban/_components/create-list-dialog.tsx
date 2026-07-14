'use client';

import { useState } from 'react';
import { ApiError } from '../../../lib/api';
import { createList, type KanbanList } from '../../../lib/kanban';
import { useToast } from '../../../components/ui/toaster';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';

/** Create a list on the board (Scrum Master/SuperAdmin). */
export function CreateListDialog({
  boardId,
  nextPosition,
  onClose,
  onCreated,
}: {
  boardId: string;
  nextPosition: number;
  onClose: () => void;
  onCreated: (list: KanbanList) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [isDoneList, setIsDoneList] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('List name is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const list = await createList(boardId, {
        name: trimmed,
        position: nextPosition,
        isDoneList,
      });
      toast.success('List created.');
      onCreated(list);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create list.');
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New list</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="List name" required htmlFor="list-name">
            <Input
              id="list-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. To Do"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={isDoneList}
              onCheckedChange={(v) => setIsDoneList(v === true)}
            />
            Mark as a “done” list (cards here are never flagged overdue)
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !name.trim()}>
            {submitting ? 'Creating…' : 'Create list'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
