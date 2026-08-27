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
import type { VaultViewMode } from '../_lib/vault-query';

/** The folder's glyph, from its own scope — same mapping everywhere in Vault. */
export function folderIcon(folder: VaultFolder) {
  if (folder.type === 'PERSONAL') return FolderLock;
  if (folder.visibilityScope === 'COMPANY_WIDE') return Building2;
  if (folder.visibilityScope === 'TEAM') return Users;
  return Folder;
}

/** The scope + versioning chips, identical in both view modes. */
function FolderChips({ folder }: { folder: VaultFolder }) {
  return (
    <>
      <Badge variant={folderScopeVariant(folder)}>
        {folderScopeLabel(folder)}
      </Badge>
      {folder.versioningEnabled && <Badge variant="muted">Versioned</Badge>}
    </>
  );
}

/** Rename affordance, revealed on hover/keyboard focus over its row or tile. */
function RenameButton({
  folder,
  onRename,
  className,
}: {
  folder: VaultFolder;
  onRename: (folder: VaultFolder) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={`Rename ${folder.name}`}
      title="Rename"
      onClick={() => onRename(folder)}
      className={cn(
        'rounded p-1 text-black/40 opacity-0 transition-opacity hover:text-black/70 focus-visible:opacity-100 group-hover:opacity-100 dark:text-white/40 dark:hover:text-white/70',
        className,
      )}
    >
      <Pencil className="size-3.5" />
    </button>
  );
}

/**
 * Vault's folders — the landing page's root folders, a folder's subfolders, and
 * the folders that matched a search all render through here, so the three can't
 * drift apart.
 *
 * Both modes of the grid/list toggle are honoured, the same toggle that switches
 * the file view: `list` is one hairline-divided card of rows, `grid` is tiles.
 * Rows are the denser of the two — roughly twice as many folders in the same
 * height — which is what lets the folder list and the recent-files rail share
 * one screen on the landing page.
 */
export function VaultFolderList({
  folders,
  title,
  subtitle,
  view = 'list',
  onRename,
  className,
}: {
  folders: VaultFolder[];
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  view?: VaultViewMode;
  /** Offered per folder where the caller supports renaming and access allows it. */
  onRename?: (folder: VaultFolder) => void;
  className?: string;
}) {
  const heading = (
    <div className="flex flex-wrap items-baseline gap-2.5">
      <h2 className="text-[14px] font-bold">{title}</h2>
      {subtitle && (
        <span className={cn('text-[11.5px]', SIGNAL_MUTED)}>{subtitle}</span>
      )}
    </div>
  );

  if (view === 'grid') {
    return (
      <section className={className}>
        {heading}
        <div className="mt-2.5 grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {folders.map((folder) => {
            const Icon = folderIcon(folder);
            return (
              <SCard
                key={folder.id}
                className={cn('group relative', SIGNAL_ROW_HOVER)}
              >
                <Link
                  href={`/vault/folders/${folder.id}`}
                  className="flex items-center gap-3 p-4"
                >
                  <Icon className="size-7 shrink-0 text-black/35 dark:text-white/30" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold">
                      {folder.name}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <FolderChips folder={folder} />
                    </div>
                  </div>
                </Link>
                {onRename && folder.access.canWrite && (
                  <RenameButton
                    folder={folder}
                    onRename={onRename}
                    className="absolute right-2 top-2"
                  />
                )}
              </SCard>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <SCard className={cn('overflow-hidden', className)}>
      <div className={cn('border-b px-4 py-3', SIGNAL_HAIRLINE)}>{heading}</div>
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
                  <FolderChips folder={folder} />
                </span>
              </Link>
              {onRename && folder.access.canWrite && (
                <RenameButton folder={folder} onRename={onRename} />
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
