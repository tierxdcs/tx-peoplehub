'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, FileUp, Plus, X, XCircle } from 'lucide-react';
import { apiFetch, ApiError } from '../../../lib/api';
import type { VaultUploadUrlResponse } from '../../../lib/types';
import { uploadToPresignedUrl } from '../../../lib/vault-api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { Progress } from '../../../components/ui/progress';
import { formatBytes } from '../_lib/vault-format';

/** One row in the upload queue. */
type QueueStatus = 'pending' | 'uploading' | 'confirming' | 'done' | 'failed';
interface QueueItem {
  id: string;
  file: File;
  status: QueueStatus;
  progress: number; // 0..1, meaningful while uploading
  error?: string;
}

/** How many files upload at once. Keeps a large batch from overwhelming the
 *  browser/network — and pairs with the backend's atomic quota reservation. */
const CONCURRENCY = 3;

const STATUS_LABEL: Record<QueueStatus, string> = {
  pending: 'Pending',
  uploading: 'Uploading',
  confirming: 'Confirming',
  done: 'Done',
  failed: 'Failed',
};

let rowSeq = 0;
const nextRowId = () => `row-${rowSeq++}`;

/**
 * Multi-file upload queue (initial uploads only — NOT versioning). Select many
 * files, see one row each with independent progress + status, remove any row
 * before its upload starts, and let each upload succeed or fail on its own
 * without affecting the rest. Uploads run at most CONCURRENCY at a time.
 */
export function UploadQueueDialog({
  folderId,
  onClose,
  onUploaded,
}: {
  folderId: string;
  onClose: () => void;
  /** Called after the batch finishes if at least one file uploaded, so the
   *  parent can refresh its file list. */
  onUploaded: () => void;
}) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Mirror of items for the async runner to read latest statuses without
  // re-subscribing; state is still the render source of truth.
  const itemsRef = useRef<QueueItem[]>([]);
  itemsRef.current = items;
  const anyUploaded = useRef(false);

  const patch = useCallback((id: string, next: Partial<QueueItem>) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...next } : it)),
    );
  }, []);

  function addFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const added: QueueItem[] = Array.from(fileList).map((file) => ({
      id: nextRowId(),
      file,
      status: 'pending',
      progress: 0,
    }));
    setItems((prev) => [...prev, ...added]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeItem(id: string) {
    // Only removable while still pending (guarded in the UI too).
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  async function uploadOne(item: QueueItem): Promise<void> {
    const { file } = item;
    try {
      patch(item.id, { status: 'uploading', progress: 0, error: undefined });
      // Presign → direct PUT to R2 (with progress) → confirm. A rejection at
      // any step fails ONLY this row.
      const presign = await apiFetch<VaultUploadUrlResponse>(
        '/vault/files/upload-url',
        {
          method: 'POST',
          body: JSON.stringify({
            folderId,
            name: file.name,
            mimeType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
          }),
        },
      );
      await uploadToPresignedUrl(presign.uploadUrl, file, (fraction) =>
        patch(item.id, { progress: fraction }),
      );
      patch(item.id, { status: 'confirming', progress: 1 });
      await apiFetch(`/vault/files/${presign.file.id}/confirm-upload`, {
        method: 'POST',
      });
      patch(item.id, { status: 'done' });
      anyUploaded.current = true;
    } catch (err) {
      patch(item.id, {
        status: 'failed',
        error: err instanceof ApiError ? err.message : 'Upload failed',
      });
    }
  }

  async function startAll() {
    setRunning(true);
    anyUploaded.current = false;
    // Snapshot the pending queue; a simple worker pool bounds concurrency.
    const queue = itemsRef.current.filter((it) => it.status === 'pending');
    let cursor = 0;
    async function worker() {
      while (cursor < queue.length) {
        const item = queue[cursor++];
        await uploadOne(item);
      }
    }
    const workers = Array.from(
      { length: Math.min(CONCURRENCY, queue.length) },
      () => worker(),
    );
    await Promise.all(workers);
    setRunning(false);
    if (anyUploaded.current) onUploaded();
  }

  // Reflect list changes into the ref immediately for the runner.
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const pendingCount = items.filter((it) => it.status === 'pending').length;
  const allSettled =
    items.length > 0 &&
    items.every((it) => it.status === 'done' || it.status === 'failed');

  return (
    <Dialog open onOpenChange={(o) => !o && !running && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload files</DialogTitle>
          <DialogDescription>
            Select one or more files. Each uploads independently — a failure on
            one won’t stop the others.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => addFiles(e.target.files)}
        />

        <div>
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={running}
          >
            <Plus /> Add files
          </Button>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-10 text-center text-muted-foreground">
            <FileUp className="size-8" />
            <p className="text-sm">No files selected yet.</p>
          </div>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
            {items.map((it) => (
              <li key={it.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-medium">
                    {it.status === 'done' && (
                      <CheckCircle2 className="size-4 shrink-0 text-success" />
                    )}
                    {it.status === 'failed' && (
                      <XCircle className="size-4 shrink-0 text-destructive" />
                    )}
                    <span className="truncate">{it.file.name}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatBytes(it.file.size)} · {STATUS_LABEL[it.status]}
                    {it.error ? ` — ${it.error}` : ''}
                  </p>
                  {(it.status === 'uploading' || it.status === 'confirming') && (
                    <Progress
                      className="mt-1"
                      value={
                        it.status === 'confirming' ? 100 : it.progress * 100
                      }
                    />
                  )}
                </div>
                {it.status === 'pending' && !running ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeItem(it.id)}
                    aria-label={`Remove ${it.file.name}`}
                  >
                    <X />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={running}>
            {allSettled ? 'Close' : 'Cancel'}
          </Button>
          <Button onClick={startAll} disabled={running || pendingCount === 0}>
            {running
              ? 'Uploading…'
              : `Upload ${pendingCount} file${pendingCount === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
