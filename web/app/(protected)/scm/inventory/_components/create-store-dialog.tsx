'use client';

import { useState } from 'react';
import { ApiError } from '../../../../lib/api';
import {
  createStoreLocation,
  type StoreLocation,
} from '../../../../lib/scm-inventory';
import { Button } from '../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { Field } from '../../../../components/ui/field';
import { Input } from '../../../../components/ui/input';
import { useToast } from '../../../../components/ui/toaster';

export function CreateStoreDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (store: StoreLocation) => void;
}) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!code.trim() || !name.trim()) {
      setError('Store / Bin code and name are required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const store = await createStoreLocation({
        code: code.trim(),
        name: name.trim(),
      });
      toast.success(`${store.code} - ${store.name} created`);
      onSaved(store);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Failed to create Store / Bin location.',
      );
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Store / Bin</DialogTitle>
          <DialogDescription>
            Create a receiving location that can be selected on GRNs and stock
            transactions.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Field label="Location code" required>
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="e.g. MAIN, BIN-A01"
              maxLength={30}
              autoFocus
            />
          </Field>
          <Field label="Location name" required>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Main Store, Electrical Components Bin"
              maxLength={100}
            />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? 'Creating...' : 'Create location'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
