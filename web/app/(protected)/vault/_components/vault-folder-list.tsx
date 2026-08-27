'use client';

import Link from 'next/link';
import {
  Building2,
  ChevronRight,
  Folder,
  FolderLock,
  Pencil,
  Users,
} from 'lucide-react';
import type { VaultFolder } from '../../../lib/types';
import { Badge } from '../../../components/ui/badge';
import {
  SCard,
  SIGNAL_HAIRLINE,
  SIGNAL_MUTED,
  SIGNAL_ROW_DIVIDER,
  SIGNAL_ROW_HOVER,
} from '../../../components/ui/signal';
import { cn } from '../../../lib/utils';
import { folderScopeLabel, folderScopeVariant } from '../_lib/vault-format';

/** The folder's glyph, from its own scope — same mapping everywhere in Vault. */
export function folderIcon(folder: VaultFolder) {
  if (folder.type === 'PERSONAL') return FolderLock;
  if (folder.visibilityScope === 'COMPANY_WIDE') return Building2;
  if (folder.visibilityScope === 'TEAM') return Users;
  return Folder;
}

/**
 * Folders as one hairline-divided card of rows — the landing page's root
 * folders, a folder's subfolders, and the folders that matched a search all use
 * it, so the three can't drift apart.
 *
 * Rows rather than tiles: a row list fits roughly twice as many folders in the
 * same height, which is what lets the folder list and the recent-files rail
 * share one screen without scrolling.
 */
export function VaultFolderList({
  folders,
  title,
  subtitle,
  onRename,
  className,
}: {
  folders: VaultFolder[];
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Offered per row where the caller supports renaming and access allows it. */
  onRename?: (folder: VaultFolder) => void;
  className?: string;
}) {
  return (
    <SCard className={cn('overflow-hidden', className)}>
      <div
        className={cn(
          'flex flex-wrap items-baseline gap-2.5 border-b px-4 py-3',
          SIGNAL_HAIRLINE,
        )}
      >
        <h2 className="text-[14px] font-bold">{title}</h2>
        {subtitle && (
          <span className={cn('text-[11.5px]', SIGNAL_MUTED)}>{subtitle}</span>
        )}
      </div>
      <ul>
        {folders.map((folder) => {
          const Icon = folderIcon(folder);
          return (
            <li
              key={folder.id}
              className={cn(
                'group relative flex items-center gap-2 border-b px-4 last:border-b-0',
                SIGNAL_ROW_DIVIDER,
                SIGNAL_ROW_HOVER,
              )}
            >
              <Link
                href={`/vault/folders/${folder.id}`}
                className="flex min-w-0 flex-1 items-center gap-2.5 py-2.5"
              >
                <Icon className="size-[18px] shrink-0 text-black/35 dark:text-white/30" />
                <span className="min-w-0 truncate text-[13px] font-semibold">
                  {folder.name}
                </span>
                <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
                  <Badge variant={folderScopeVariant(folder)}>
                    {folderScopeLabel(folder)}
                  </Badge>
                  {folder.versioningEnabled && (
                    <Badge variant="muted">Versioned</Badge>
                  )}
                </span>
              </Link>
              {onRename && folder.access.canWrite && (
                <button
                  type="button"
                  aria-label={`Rename ${folder.name}`}
                  title="Rename"
                  onClick={() => onRename(folder)}
                  className="rounded p-1 text-black/40 opacity-0 transition-opacity hover:text-black/70 focus-visible:opacity-100 group-hover:opacity-100 dark:text-white/40 dark:hover:text-white/70"
                >
                  <Pencil className="size-3.5" />
                </button>
              )}
              <ChevronRight
                className="size-4 shrink-0 text-black/25 dark:text-white/20"
                aria-hidden
              />
            </li>
          );
        })}
      </ul>
    </SCard>
  );
}
