'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Paperclip, Download, Trash2, Upload } from 'lucide-react';
import {
  listAttachments,
  createAttachmentUploadUrl,
  confirmAttachment,
  attachmentDownloadUrl,
  deleteAttachment,
  type KanbanAttachment,
} from '../../../lib/kanban';
import { uploadToPresignedUrl } from '../../../lib/vault-api';
import { ApiError } from '../../../lib/api';
import { Button } from '../../../components/ui/button';
import { useToast } from '../../../components/ui/toaster';
import { useConfirm } from '../../../components/ui/confirm';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Card attachments: lists ACTIVE files, uploads new ones browser→R2 via a
 * presigned PUT (create-url → PUT → confirm), downloads via a presigned GET,
 * and deletes using comment-level card access. Mirrors the Vault upload flow.
 */
export function CardAttachments({
  cardId,
  canWrite,
  canDeleteAny,
  currentUserId,
  onChanged,
}: {
  cardId: string;
  canWrite: boolean;
  /** Board members may delete any attachment; card-only assignees only their own. */
  canDeleteAny: boolean;
  currentUserId: string | undefined;
  onChanged?: () => void | Promise<void>;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);

  const [attachments, setAttachments] = useState<KanbanAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setAttachments(await listAttachments(cardId));
    } catch {
      /* non-critical: leave the list as-is */
    } finally {
      setLoading(false);
    }
  }, [cardId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    // Allow re-picking the same file next time.
    e.target.value = '';
    if (files.length === 0) return;
    setUploading(true);
    setProgress(0);
    let attached = 0;
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      try {
        const ticket = await createAttachmentUploadUrl(cardId, {
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        });
        await uploadToPresignedUrl(ticket.uploadUrl, file, (fileProgress) =>
          setProgress((index + fileProgress) / files.length),
        );
        await confirmAttachment(cardId, ticket.attachmentId);
        attached += 1;
      } catch (err) {
        toast.error(
          err instanceof ApiError ? err.message : 'Failed to attach file.',
        );
      }
    }
    try {
      if (attached > 0) {
        toast.success(
          attached === 1 ? 'File attached.' : `${attached} files attached.`,
        );
        await refresh();
        await onChanged?.();
      }
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  async function onDownload(att: KanbanAttachment) {
    try {
      const { url } = await attachmentDownloadUrl(cardId, att.id);
      // Open the presigned URL — the browser downloads directly from R2.
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to get download link.',
      );
    }
  }

  async function onDelete(att: KanbanAttachment) {
    const ok = await confirm({
      title: 'Delete attachment?',
      description: `“${att.filename}” will be permanently removed.`,
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteAttachment(cardId, att.id);
      await refresh();
      await onChanged?.();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to delete attachment.',
      );
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">Attachments</p>
        {canWrite && <Button
          size="sm"
          variant="outline"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="size-3.5" />
          {uploading
            ? `Uploading… ${Math.round(progress * 100)}%`
            : 'Attach file'}
        </Button>}
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={onFilePicked}
        />
      </div>

      {loading ? null : attachments.length === 0 ? (
        <p className="text-xs text-muted-foreground">No files attached.</p>
      ) : (
        <ul className="space-y-1">
          {attachments.map((att) => {
            const canRemove =
              canDeleteAny || att.uploadedById === currentUserId;
            return (
              <li
                key={att.id}
                className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm"
              >
                <Paperclip className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate" title={att.filename}>
                    {att.filename}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatSize(att.sizeBytes)}
                    {att.uploadedByName ? ` · ${att.uploadedByName}` : ''}
                    {` · ${new Date(att.createdAt).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void onDownload(att)}
                  className="rounded p-1 text-muted-foreground hover:text-foreground"
                  aria-label={`Download ${att.filename}`}
                >
                  <Download className="size-4" />
                </button>
                {canRemove && (
                  <button
                    type="button"
                    onClick={() => void onDelete(att)}
                    className="rounded p-1 text-muted-foreground hover:text-destructive"
                    aria-label={`Delete ${att.filename}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
