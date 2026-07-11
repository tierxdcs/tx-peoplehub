'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../../lib/api';
import type { Vertical, VaultFolder } from '../../../lib/types';
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
import { Select } from '../../../components/ui/select';
import { Switch } from '../../../components/ui/switch';
import { useToast } from '../../../components/ui/toaster';

/**
 * Create-folder dialog (spec §2). Type is implied by role:
 *  - SUPER_ADMIN → DEFAULT, with an explicit scope picker (Company-wide or a
 *    specific Vertical).
 *  - MANAGER / ADMIN → CUSTOM; scope is server-forced to TEAM, so no picker
 *    is shown (the backend ignores any scope sent).
 * A "parentFolderId" may be passed to create a subfolder. The versioning
 * toggle is exposed at creation time per the spec.
 */
export function NewFolderDialog({
  isSuperAdmin,
  parentFolderId,
  onClose,
  onCreated,
}: {
  isSuperAdmin: boolean;
  parentFolderId?: string;
  onClose: () => void;
  onCreated: (folder: VaultFolder) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [versioningEnabled, setVersioningEnabled] = useState(false);
  const [scope, setScope] = useState<'COMPANY_WIDE' | 'VERTICAL' | 'PRIVATE'>(
    'COMPANY_WIDE',
  );
  const [scopeVerticalId, setScopeVerticalId] = useState('');
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isSuperAdmin) return;
    apiFetch<Vertical[]>('/verticals')
      .then((v) => {
        setVerticals(v);
        if (v.length > 0) setScopeVerticalId(v[0].id);
      })
      .catch(() => undefined);
  }, [isSuperAdmin]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Name is required';
    if (isSuperAdmin && scope === 'VERTICAL' && !scopeVerticalId) {
      next.scopeVerticalId = 'Choose a vertical';
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      // SUPER_ADMIN mints DEFAULT folders with a chosen scope; everyone else
      // mints CUSTOM (the backend forces TEAM scope regardless).
      const body = isSuperAdmin
        ? {
            name: name.trim(),
            type: 'DEFAULT' as const,
            visibilityScope: scope,
            ...(scope === 'VERTICAL' ? { scopeVerticalId } : {}),
            versioningEnabled,
            ...(parentFolderId ? { parentFolderId } : {}),
          }
        : {
            name: name.trim(),
            type: 'CUSTOM' as const,
            versioningEnabled,
            ...(parentFolderId ? { parentFolderId } : {}),
          };
      const folder = await apiFetch<VaultFolder>('/vault/folders', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      toast.success(`Folder "${folder.name}" created.`);
      onCreated(folder);
    } catch (err) {
      setErrors({
        _form: err instanceof ApiError ? err.message : 'Failed to create folder',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Folder</DialogTitle>
          <DialogDescription>
            {isSuperAdmin
              ? 'Create a shared DEFAULT folder and choose who can see it.'
              : 'Create a team folder. Your team gets access automatically.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Folder name" required error={errors.name}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!errors.name}
              placeholder="e.g. Contracts"
            />
          </Field>

          {isSuperAdmin && (
            <>
              <Field label="Visible to">
                <Select
                  value={scope}
                  onChange={(e) =>
                    setScope(
                      e.target.value as 'COMPANY_WIDE' | 'VERTICAL' | 'PRIVATE',
                    )
                  }
                >
                  <option value="COMPANY_WIDE">Everyone (company-wide)</option>
                  <option value="VERTICAL">A specific vertical</option>
                  <option value="PRIVATE">Private (invite or link only)</option>
                </Select>
              </Field>
              {scope === 'VERTICAL' && (
                <Field label="Vertical" required error={errors.scopeVerticalId}>
                  <Select
                    value={scopeVerticalId}
                    onChange={(e) => setScopeVerticalId(e.target.value)}
                    aria-invalid={!!errors.scopeVerticalId}
                  >
                    {verticals.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </>
          )}

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Enable version control</p>
              <p className="text-xs text-muted-foreground">
                Keep a history of file versions in this folder.
              </p>
            </div>
            <Switch
              checked={versioningEnabled}
              onCheckedChange={setVersioningEnabled}
            />
          </div>

          {errors._form && (
            <p className="text-sm text-destructive">{errors._form}</p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create Folder'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
