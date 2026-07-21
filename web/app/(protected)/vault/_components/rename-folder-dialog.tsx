'use client';

import { useState } from 'react';
import { apiFetch, ApiError } from '../../../lib/api';
import type { VaultFolder } from '../../../lib/types';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { useToast } from '../../../components/ui/toaster';

/**
 * Rename a vault folder. Backed by PATCH /vault/folders/:id (name only), which
 * requires write access — the owner/creator always has it. Callers only render
 * this when `folder.access.canWrite` is true.
 */
export function RenameFolderDialog({
  folder,
  onClose,
  onRenamed,
}: {
  folder: VaultFolder;
  onClose: () => void;
  onRenamed: (folder: VaultFolder) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(folder.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required');
      return;
    }
    if (trimmed === folder.name) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await apiFetch<VaultFolder>(
        `/vault/folders/${folder.id}`,
        { method: 'PATCH', body: JSON.stringify({ name: trimmed }) },
      );
      toast.success('Folder renamed.');
      onRenamed(updated);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to rename folder',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename folder</DialogTitle>
          <DialogDescription>Give this folder a new name.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Folder name" required error={error}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              aria-invalid={!!error}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Rename'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
