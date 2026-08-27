'use client';

import Link from 'next/link';
import { Download, Eye, History, Link2, Share2, Trash2 } from 'lucide-react';
import type { VaultFile } from '../../../lib/types';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { SCard } from '../../../components/ui/signal';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import {
  fileTypeIcon,
  fileTypeLabel,
  formatBytes,
  formatDate,
  originLabel,
} from '../_lib/vault-format';
import type { VaultViewMode } from '../_lib/vault-query';

export interface VaultFileActions {
  onPreview: (file: VaultFile) => void;
  onDownload: (file: VaultFile) => void;
  onVersions?: (file: VaultFile) => void;
  onShare?: (file: VaultFile) => void;
  onLink?: (file: VaultFile) => void;
  onDelete?: (file: VaultFile) => void;
}

interface VaultFileViewProps {
  files: VaultFile[];
  view: VaultViewMode;
  /** Show which folder each file lives in — needed when results span folders. */
  showFolder?: boolean;
  /**
   * True inside a versioning-enabled folder, where history is offered even for
   * a single-version file. Elsewhere (search results spanning folders, where the
   * folder's setting isn't known) history shows only when versions actually
   * exist — a real signal off the file itself rather than a guess.
   */
  versioningEnabled?: boolean;
  actions: VaultFileActions;
}

function showVersions(
  file: VaultFile,
  versioningEnabled: boolean,
  actions: VaultFileActions,
): boolean {
  return Boolean(actions.onVersions) && (versioningEnabled || file.versionCount > 1);
}

/**
 * The icon row shared by every view mode, so they can't drift apart — the
 * card grid, the dense list, and the landing page's recent-files rail all get
 * the same actions under the same permission gates. `compact` only shrinks the
 * buttons, for the rail where full-size hit targets don't fit.
 */
export function FileActions({
  file,
  versioningEnabled,
  actions,
  align = 'end',
  compact = false,
}: {
  file: VaultFile;
  versioningEnabled: boolean;
  actions: VaultFileActions;
  align?: 'start' | 'end';
  compact?: boolean;
}) {
  const button = compact ? 'size-7 [&_svg]:size-3.5' : undefined;
  return (
    <div
      className={`flex items-center gap-0.5 ${
        align === 'end' ? 'justify-end' : ''
      }`}
    >
      <Button
        variant="ghost"
        size="icon"
        className={button}
        onClick={() => actions.onPreview(file)}
        aria-label={`Preview ${file.name}`}
      >
        <Eye />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={button}
        onClick={() => actions.onDownload(file)}
        aria-label={`Download ${file.name}`}
      >
        <Download />
      </Button>
      {showVersions(file, versioningEnabled, actions) && (
        <Button
          variant="ghost"
          size="icon"
          className={button}
          onClick={() => actions.onVersions?.(file)}
          aria-label={`Version history for ${file.name}`}
        >
          <History />
        </Button>
      )}
      {actions.onShare && file.access.canWrite && (
        <Button
          variant="ghost"
          size="icon"
          className={button}
          onClick={() => actions.onShare?.(file)}
          aria-label={`Share ${file.name}`}
        >
          <Share2 />
        </Button>
      )}
      {actions.onLink && file.access.canWrite && (
        <Button
          variant="ghost"
          size="icon"
          className={button}
          onClick={() => actions.onLink?.(file)}
          aria-label={`Public link for ${file.name}`}
        >
          <Link2 />
        </Button>
      )}
      {actions.onDelete && file.access.canDelete && (
        <Button
          variant="ghost"
          size="icon"
          className={button}
          onClick={() => actions.onDelete?.(file)}
          aria-label={`Delete ${file.name}`}
        >
          <Trash2 className="text-destructive" />
        </Button>
      )}
    </div>
  );
}

/**
 * Files as cards (default) or as a dense list. The card grid keeps Vault
 * feeling like a file browser rather than a register table; the list is the
 * opt-in mode for comparing many files by size and date at once. Both render
 * the same fields and the same actions.
 */
export function VaultFileView({
  files,
  view,
  showFolder = false,
  versioningEnabled = false,
  actions,
}: VaultFileViewProps) {
  if (view === 'list') {
    return (
      <SCard className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              {showFolder && <TableHead>Folder</TableHead>}
              <TableHead>Size</TableHead>
              <TableHead>Uploaded by</TableHead>
              <TableHead>Modified</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.map((file) => {
              const Icon = fileTypeIcon(file.fileType);
              return (
                <TableRow key={file.id}>
                  <TableCell>
                    <button
                      onClick={() => actions.onPreview(file)}
                      className="flex items-center gap-2 text-left hover:underline"
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 truncate font-medium">
                        {file.name}
                      </span>
                    </button>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {fileTypeLabel(file.fileType)}
                  </TableCell>
                  {showFolder && (
                    <TableCell className="text-muted-foreground">
                      <Link
                        href={`/vault/folders/${file.folderId}`}
                        className="hover:text-foreground hover:underline"
                      >
                        {file.folderName ?? '—'}
                      </Link>
                    </TableCell>
                  )}
                  <TableCell className="text-muted-foreground">
                    {formatBytes(file.sizeBytes)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {file.uploadedByName ?? '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(file.updatedAt)}
                  </TableCell>
                  <TableCell>
                    <FileActions
                      file={file}
                      versioningEnabled={versioningEnabled}
                      actions={actions}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </SCard>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
      {files.map((file) => {
        const Icon = fileTypeIcon(file.fileType);
        return (
          <SCard key={file.id} className="flex flex-col p-4">
            <div className="flex min-w-0 items-start gap-3">
              <Icon className="size-8 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <button
                  onClick={() => actions.onPreview(file)}
                  className="block w-full truncate text-left font-medium hover:underline"
                  title={file.name}
                >
                  {file.name}
                </button>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {formatBytes(file.sizeBytes)} · {formatDate(file.updatedAt)}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {file.uploadedByName ?? 'Unknown uploader'}
                </p>
                {showFolder && file.folderName && (
                  <Link
                    href={`/vault/folders/${file.folderId}`}
                    className="mt-1 block truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
                  >
                    in {file.folderName}
                  </Link>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge variant="muted">{fileTypeLabel(file.fileType)}</Badge>
                  {/* Only auto-filed documents carry a source badge — labelling
                      every manual upload would be noise. */}
                  {file.origin !== 'MANUAL' && (
                    <Badge variant="outline">{originLabel(file.origin)}</Badge>
                  )}
                  {file.versionCount > 1 && (
                    <Badge variant="muted">v{file.versionCount}</Badge>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-3 border-t pt-2">
              <FileActions
                file={file}
                versioningEnabled={versioningEnabled}
                actions={actions}
                align="start"
              />
            </div>
          </SCard>
        );
      })}
    </div>
  );
}
