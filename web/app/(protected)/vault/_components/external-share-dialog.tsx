'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, Trash2, Check } from 'lucide-react';
import { apiFetch, ApiError } from '../../../lib/api';
import type {
  VaultExternalShareLink,
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
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Badge } from '../../../components/ui/badge';
import { Skeleton } from '../../../components/ui/skeleton';
import { useToast } from '../../../components/ui/toaster';
import { useConfirm } from '../../../components/ui/confirm';
import { formatDateTime } from '../_lib/vault-format';

/** Build the public share URL the recipient opens (frontend route). */
function publicUrl(token: string): string {
  if (typeof window === 'undefined') return `/public/vault/shared/${token}`;
  return `${window.location.origin}/public/vault/shared/${token}`;
}

const EXPIRY_OPTIONS = [
  { label: '1 hour', hours: 1 },
  { label: '24 hours', hours: 24 },
  { label: '7 days', hours: 168 },
  { label: '30 days', hours: 720 },
];

/**
 * External share link dialog (spec §5.2): create a VIEW-only, expiring,
 * optionally password-protected link; list active links with a copy button,
 * access count, expiry, and a revoke action. States the version-pinning
 * behavior explicitly. Works for both files and folders (the backend forbids
 * link-sharing a PERSONAL folder — the caller hides the action there).
 */
export function ExternalShareDialog({
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
  const [links, setLinks] = useState<VaultExternalShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [expiresInHours, setExpiresInHours] = useState(24);
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await apiFetch<VaultExternalShareLink[]>(
        `/vault/${base}/${resourceId}/share-links`,
      );
      setLinks(list);
    } catch {
      setLinks([]);
    } finally {
      setLoading(false);
    }
  }, [base, resourceId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate() {
    setCreating(true);
    try {
      await apiFetch(`/vault/${base}/${resourceId}/share-link`, {
        method: 'POST',
        body: JSON.stringify({
          expiresInHours,
          ...(password.trim() ? { password: password.trim() } : {}),
        }),
      });
      toast.success('Share link created.');
      setPassword('');
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to create link',
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy(link: VaultExternalShareLink) {
    try {
      await navigator.clipboard.writeText(publicUrl(link.token));
      setCopiedId(link.id);
      setTimeout(() => setCopiedId((c) => (c === link.id ? null : c)), 1500);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  }

  async function handleRevoke(link: VaultExternalShareLink) {
    const ok = await confirm({
      title: 'Revoke this link?',
      description: 'Anyone holding it will immediately lose access.',
      confirmLabel: 'Revoke',
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`/vault/share-links/${link.id}`, { method: 'DELETE' });
      toast.success('Link revoked.');
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to revoke link',
      );
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Share “{resourceName}” externally</DialogTitle>
          <DialogDescription>
            Create a public link — anyone with it can view{' '}
            {resourceType === 'FILE' ? 'the file' : 'the folder’s contents'}, no
            login required.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-end gap-2">
          <Field label="Expires in" className="w-36">
            <Select
              value={String(expiresInHours)}
              onChange={(e) => setExpiresInHours(Number(e.target.value))}
            >
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.hours} value={o.hours}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Password (optional)" className="flex-1">
            <Input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank for no password"
            />
          </Field>
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? 'Creating…' : 'Create link'}
          </Button>
        </div>

        {resourceType === 'FILE' && (
          <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
            This link always shows the file as it exists right now — later edits
            or new versions won’t change what the link serves.
          </p>
        )}

        <div>
          <p className="mb-2 text-sm font-medium">Active links</p>
          {loading ? (
            <Skeleton className="h-12 w-full" />
          ) : links.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No active links.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {links.map((link) => (
                <li key={link.id} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{publicUrl(link.token)}</p>
                    <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Expires {formatDateTime(link.expiresAt)}</span>
                      <span>·</span>
                      <span>{link.accessCount ?? 0} views</span>
                      {link.hasPassword && (
                        <Badge variant="muted">Password</Badge>
                      )}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleCopy(link)}
                    aria-label="Copy link"
                  >
                    {copiedId === link.id ? (
                      <Check className="text-success" />
                    ) : (
                      <Copy />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRevoke(link)}
                    aria-label="Revoke link"
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
