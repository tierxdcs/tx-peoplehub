'use client';

import { useState } from 'react';
import { ApiError } from '../../../lib/api';
import { createBoard } from '../../../lib/kanban';
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

/**
 * Create a board with the current user as its initial member. Cards can be
 * assigned directly to any employee later, so board creation does not ask the
 * creator to maintain a separate member list.
 */
export function CreateBoardDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (boardId: string) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
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
            Name the board. You’re added automatically as its creator.
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
