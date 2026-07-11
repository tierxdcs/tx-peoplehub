'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, History, RotateCcw, Upload } from 'lucide-react';
import { apiFetch, ApiError } from '../../../lib/api';
import type {
  VaultDownloadUrlResponse,
  VaultFile,
  VaultFileVersion,
  VaultUploadUrlResponse,
} from '../../../lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Badge } from '../../../components/ui/badge';
import { Progress } from '../../../components/ui/progress';
import { Skeleton } from '../../../components/ui/skeleton';
import { useToast } from '../../../components/ui/toaster';
import { useConfirm } from '../../../components/ui/confirm';
import { uploadToPresignedUrl } from '../../../lib/vault-api';
import { formatBytes, formatDateTime } from '../_lib/vault-format';

/**
 * Version history panel (spec §3, versioning folders only). Lists every version
 * newest-first, lets a writer upload a new version (presign → PUT to R2 →
 * confirm), download any past version, and restore an old one (appends a new
 * version). Only rendered for files in a versioning-enabled folder; the caller
 * gates on file.access.canWrite for the mutating actions.
 */
export function VersionPanel({
  file,
  onClose,
  onChanged,
}: {
  file: VaultFile;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const canWrite = file.access.canWrite;

  const [versions, setVersions] = useState<VaultFileVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [changeNote, setChangeNote] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await apiFetch<VaultFileVersion[]>(
        `/vault/files/${file.id}/versions`,
      );
      setVersions(list);
    } catch {
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, [file.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleUploadVersion(picked: File) {
    setProgress(0);
    try {
      // Presign a new-version PUT, stream the bytes to R2, then confirm.
      const presign = await apiFetch<VaultUploadUrlResponse>(
        `/vault/files/${file.id}/versions`,
        {
          method: 'POST',
          body: JSON.stringify({
            mimeType: picked.type || 'application/octet-stream',
            sizeBytes: picked.size,
            ...(changeNote.trim() ? { changeNote: changeNote.trim() } : {}),
          }),
        },
      );
      await uploadToPresignedUrl(presign.uploadUrl, picked, setProgress);
      await apiFetch(`/vault/files/${file.id}/versions/confirm`, {
        method: 'POST',
      });
      toast.success('New version uploaded.');
      setChangeNote('');
      await load();
      onChanged();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to upload version',
      );
    } finally {
      setProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleDownload(version: VaultFileVersion) {
    try {
      const res = await apiFetch<VaultDownloadUrlResponse>(
        `/vault/files/${file.id}/download-url?versionId=${version.id}`,
      );
      window.open(res.downloadUrl, '_blank', 'noopener');
    } catch {
      toast.error('Failed to get download link');
    }
  }

  async function handleRestore(version: VaultFileVersion) {
    const ok = await confirm({
      title: `Restore version ${version.versionNumber}?`,
      description:
        'This copies the selected version forward as a new version. Nothing is overwritten.',
      confirmLabel: 'Restore',
    });
    if (!ok) return;
    setRestoringId(version.id);
    try {
      await apiFetch(
        `/vault/files/${file.id}/versions/${version.id}/restore`,
        { method: 'POST' },
      );
      toast.success(`Version ${version.versionNumber} restored as the latest.`);
      await load();
      onChanged();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to restore version',
      );
    } finally {
      setRestoringId(null);
    }
  }

  const uploading = progress !== null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4" /> Version history
          </DialogTitle>
          <DialogDescription className="truncate">{file.name}</DialogDescription>
        </DialogHeader>

        {canWrite && (
          <div className="space-y-2 rounded-md border p-3">
            <Input
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              placeholder="Change note (optional)"
              disabled={uploading}
            />
            <input
              ref={fileInputRef}
              type="file"
              hidden
              onChange={(e) => {
                const picked = e.target.files?.[0];
                if (picked) handleUploadVersion(picked);
              }}
            />
            {uploading ? (
              <div className="space-y-1">
                <Progress value={(progress ?? 0) * 100} />
                <p className="text-xs text-muted-foreground">
                  Uploading… {Math.round((progress ?? 0) * 100)}%
                </p>
              </div>
            ) : (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload /> Upload new version
              </Button>
            )}
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : versions.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No versions yet.
          </p>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
            {versions.map((version, idx) => (
              <li key={version.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    Version {version.versionNumber}
                    {idx === 0 && <Badge variant="success">Current</Badge>}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {formatDateTime(version.createdAt)} ·{' '}
                    {formatBytes(version.sizeBytes)}
                    {version.changeNote ? ` · ${version.changeNote}` : ''}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDownload(version)}
                  aria-label={`Download version ${version.versionNumber}`}
                >
                  <Download />
                </Button>
                {canWrite && idx !== 0 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRestore(version)}
                    disabled={restoringId === version.id}
                    aria-label={`Restore version ${version.versionNumber}`}
                  >
                    <RotateCcw />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
