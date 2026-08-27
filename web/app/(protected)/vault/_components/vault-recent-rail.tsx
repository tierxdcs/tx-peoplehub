'use client';

import Link from 'next/link';
import { Clock } from 'lucide-react';
import type { VaultFile } from '../../../lib/types';
import { Skeleton } from '../../../components/ui/skeleton';
import {
  SCard,
  SIGNAL_EYEBROW,
  SIGNAL_FAINT,
  SIGNAL_HAIRLINE,
  SIGNAL_MUTED,
  SIGNAL_ROW_DIVIDER,
  SIGNAL_ROW_HOVER,
} from '../../../components/ui/signal';
import { cn } from '../../../lib/utils';
import { fileTypeIcon, formatBytes, formatDate } from '../_lib/vault-format';
import { FileActions, type VaultFileActions } from './vault-file-view';

/**
 * Recently added or updated files as a narrow, dense rail — the landing page's
 * second column, so the folder list and the latest documents share one screen
 * instead of the files sitting a full scroll below the folders.
 *
 * Rows are deliberately compact (three short lines) rather than the file cards
 * used in the main column: a 3-up card grid or a seven-column table cannot fit
 * a rail. The actions are the same set, under the same permission gates, via
 * the shared FileActions row.
 */
export function VaultRecentRail({
  files,
  loading = false,
  actions,
  className,
}: {
  files: VaultFile[];
  loading?: boolean;
  actions: VaultFileActions;
  className?: string;
}) {
  return (
    <SCard className={cn('overflow-hidden', className)}>
      <div className={cn('border-b px-4 py-3', SIGNAL_HAIRLINE)}>
        <div className="flex items-center gap-1.5">
          <Clock className="size-3.5 text-black/40 dark:text-white/40" />
          <h2 className={SIGNAL_EYEBROW}>Recent files</h2>
        </div>
        {/* Vault keeps no internal view log, so this is honestly
            "added or updated" — never "recently viewed". */}
        <p className={cn('mt-1 text-[11.5px]', SIGNAL_MUTED)}>
          Most recently added or updated across your folders
        </p>
      </div>

      {loading ? (
        <div className="space-y-3 px-4 py-3.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-2 h-3 w-24" />
            </div>
          ))}
        </div>
      ) : files.length === 0 ? (
        <p className={cn('px-4 py-5 text-[12px]', SIGNAL_FAINT)}>
          Nothing has been added or updated in your folders yet.
        </p>
      ) : (
        <ul className="max-h-[calc(100dvh-13rem)] overflow-y-auto">
          {files.map((file) => {
            const Icon = fileTypeIcon(file.fileType);
            return (
              <li
                key={file.id}
                className={cn(
                  'border-b px-3.5 py-2.5 last:border-b-0',
                  SIGNAL_ROW_DIVIDER,
                  SIGNAL_ROW_HOVER,
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Icon className="size-4 shrink-0 text-black/35 dark:text-white/30" />
                  <button
                    onClick={() => actions.onPreview(file)}
                    title={file.name}
                    className="min-w-0 flex-1 truncate text-left text-[12.5px] font-semibold hover:underline"
                  >
                    {file.name}
                  </button>
                </div>
                <p
                  className={cn(
                    'mt-0.5 truncate pl-6 text-[11px] tabular-nums',
                    SIGNAL_MUTED,
                  )}
                >
                  {formatBytes(file.sizeBytes)} · {formatDate(file.updatedAt)} ·{' '}
                  {file.uploadedByName ?? 'Unknown uploader'}
                </p>
                <div className="mt-0.5 flex items-center gap-2 pl-6">
                  {file.folderName ? (
                    <Link
                      href={`/vault/folders/${file.folderId}`}
                      className="min-w-0 flex-1 truncate text-[11px] font-medium text-[#3B6FB5] hover:underline dark:text-[#6FA3E0]"
                    >
                      in {file.folderName}
                    </Link>
                  ) : (
                    <span className="flex-1" />
                  )}
                  <FileActions
                    file={file}
                    // Outside a single folder the folder's versioning setting
                    // doesn't speak for every row, so history shows only where
                    // versions actually exist.
                    versioningEnabled={false}
                    actions={actions}
                    align="end"
                    compact
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SCard>
  );
}
