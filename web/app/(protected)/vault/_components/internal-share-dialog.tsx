'use client';

import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { apiFetch, ApiError } from '../../../lib/api';
import type {
  EmployeeSearchResult,
  VaultInternalShare,
  VaultSharePermission,
  VaultShareResourceType,
} from '../../../lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { Avatar } from '../../../components/ui/avatar';
import { Skeleton } from '../../../components/ui/skeleton';
import { useToast } from '../../../components/ui/toaster';
import { useConfirm } from '../../../components/ui/confirm';
import { EmployeePicker } from './employee-picker';

/**
 * Internal share dialog (spec §5.1): pick an employee + permission (VIEW/EDIT),
 * and manage the existing shares on this resource (with a revoke action each).
 * Works for both files and folders via the resourceType/base path.
 */
export function InternalShareDialog({
  resourceType,
  resourceId,
  resourceName,
  onClose,
}: {
  resourceType: VaultShareResourceType;
  resourceId: string;
  resourceName: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const base = resourceType === 'FILE' ? 'files' : 'folders';

  const [shares, setShares] = useState<VaultInternalShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<EmployeeSearchResult | null>(null);
  const [permission, setPermission] = useState<VaultSharePermission>('VIEW');
  const [submitting, setSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await apiFetch<VaultInternalShare[]>(
        `/vault/${base}/${resourceId}/shares`,
      );
      setShares(list);
    } catch {
      setShares([]);
    } finally {
      setLoading(false);
    }
  }, [base, resourceId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleShare() {
    if (!selected) return;
    setSubmitting(true);
    try {
      await apiFetch(`/vault/${base}/${resourceId}/share`, {
        method: 'POST',
        body: JSON.stringify({
          sharedWithEmployeeId: selected.id,
          permission,
        }),
      });
      toast.success(`Shared with ${selected.fullName}.`);
      setSelected(null);
      setPermission('VIEW');
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to share',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleChangePermission(
    share: VaultInternalShare,
    next: VaultSharePermission,
  ) {
    if (next === share.permission) return;
    setUpdatingId(share.id);
    // Re-sharing the same recipient is an idempotent upsert on the backend, so
    // POST /share with the new level simply updates it (VIEW ⇄ EDIT). Edit
    // grants write access, which is what lets that person upload files.
    try {
      await apiFetch(`/vault/${base}/${resourceId}/share`, {
        method: 'POST',
        body: JSON.stringify({
          sharedWithEmployeeId: share.sharedWithEmployeeId,
          permission: next,
        }),
      });
      toast.success(
        next === 'EDIT'
          ? `${share.sharedWithEmployeeName ?? 'They'} can now edit and upload.`
          : `${share.sharedWithEmployeeName ?? 'They'} now have view-only access.`,
      );
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to update access',
      );
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleRevoke(share: VaultInternalShare) {
    const ok = await confirm({
      title: 'Remove this share?',
      description: `${share.sharedWithEmployeeName ?? 'This person'} will lose access.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`/vault/${base}/${resourceId}/shares/${share.id}`, {
        method: 'DELETE',
      });
      toast.success('Share removed.');
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to remove share',
      );
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share “{resourceName}”</DialogTitle>
          <DialogDescription>
            Give a colleague view or edit access.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {selected ? (
            <div className="flex items-center gap-2 rounded-md border p-2">
              <Avatar name={selected.fullName} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {selected.fullName}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {selected.email}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelected(null)}
              >
                Change
              </Button>
            </div>
          ) : (
            <EmployeePicker
              onSelect={setSelected}
              excludeIds={shares.map((s) => s.sharedWithEmployeeId)}
            />
          )}
          {/* Permission + Share on their own row so nothing is clipped in the
              narrow dialog. */}
          <div className="flex items-center gap-2">
            <Select
              value={permission}
              onChange={(e) =>
                setPermission(e.target.value as VaultSharePermission)
              }
              className="w-32"
            >
              <option value="VIEW">View</option>
              <option value="EDIT">Edit</option>
            </Select>
            <Button
              className="flex-1"
              onClick={handleShare}
              disabled={!selected || submitting}
            >
              {submitting ? 'Sharing…' : 'Share'}
            </Button>
          </div>
        </div>

        <div className="mt-2">
          <p className="mb-2 text-sm font-medium">People with access</p>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : shares.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Not shared with anyone yet.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {shares.map((share) => (
                <li
                  key={share.id}
                  className="flex items-center gap-2 px-3 py-2"
                >
                  <Avatar name={share.sharedWithEmployeeName ?? '?'} />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {share.sharedWithEmployeeName ?? share.sharedWithEmployeeId}
                  </span>
                  <Select
                    value={share.permission}
                    onChange={(e) =>
                      handleChangePermission(
                        share,
                        e.target.value as VaultSharePermission,
                      )
                    }
                    disabled={updatingId === share.id}
                    className="w-28"
                    aria-label={`Access level for ${
                      share.sharedWithEmployeeName ?? 'this person'
                    }`}
                  >
                    <option value="VIEW">View</option>
                    <option value="EDIT">Edit</option>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRevoke(share)}
                    aria-label="Remove share"
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
