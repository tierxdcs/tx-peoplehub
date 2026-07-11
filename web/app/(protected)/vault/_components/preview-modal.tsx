'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileWarning } from 'lucide-react';
import { apiFetch, ApiError } from '../../../lib/api';
import type {
  VaultDownloadUrlResponse,
  VaultViewUrlResponse,
} from '../../../lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { Spinner } from '../../../components/ui/spinner';

/**
 * File preview modal (spec §4). Polls GET /vault/files/:id/view-url and renders
 * per previewStatus:
 *  - READY → embed the (PDF) preview in an iframe.
 *  - PENDING → "Preparing preview…" spinner; poll every 2s until it resolves.
 *  - FAILED / NOT_APPLICABLE → "Preview unavailable — download to view."
 */
export function PreviewModal({
  fileId,
  fileName,
  onClose,
}: {
  fileId: string;
  fileName: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<VaultViewUrlResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchView = useCallback(async () => {
    try {
      const res = await apiFetch<VaultViewUrlResponse>(
        `/vault/files/${fileId}/view-url`,
      );
      setState(res);
      // Keep polling only while the preview is still being prepared.
      if (res.previewStatus === 'PENDING') {
        pollRef.current = setTimeout(fetchView, 2000);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load preview');
    }
  }, [fileId]);

  useEffect(() => {
    fetchView();
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [fetchView]);

  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await apiFetch<VaultDownloadUrlResponse>(
        `/vault/files/${fileId}/download-url`,
      );
      window.open(res.downloadUrl, '_blank', 'noopener');
    } catch {
      setError('Failed to get download link');
    } finally {
      setDownloading(false);
    }
  }

  const status = state?.previewStatus;
  const unavailable = status === 'FAILED' || status === 'NOT_APPLICABLE';

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[85vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{fileName}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
          {error ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <FileWarning className="size-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button onClick={handleDownload} disabled={downloading}>
                <Download /> Download
              </Button>
            </div>
          ) : !state || status === 'PENDING' ? (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <Spinner className="size-6" />
              <p className="text-sm">Preparing preview…</p>
            </div>
          ) : status === 'READY' && state.viewUrl ? (
            <iframe
              src={state.viewUrl}
              title={fileName}
              className="h-full w-full"
            />
          ) : unavailable ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <FileWarning className="size-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Preview unavailable — download to view.
              </p>
              <Button onClick={handleDownload} disabled={downloading}>
                <Download /> {downloading ? 'Preparing…' : 'Download'}
              </Button>
            </div>
          ) : null}
        </div>

        {status === 'READY' && (
          <div className="flex justify-end">
            <Button variant="outline" onClick={handleDownload} disabled={downloading}>
              <Download /> Download
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
