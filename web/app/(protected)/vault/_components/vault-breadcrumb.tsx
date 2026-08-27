'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { VaultFolderCrumb } from '../../../lib/types';

/**
 * Folder path trail: Vault → … → current folder. Every readable ancestor is a
 * link, so any level can be jumped to directly rather than clicking Back
 * repeatedly through a nested tree.
 *
 * An ancestor with canRead=false is rendered as plain text: access can be
 * granted on a child without its parent, so the path is still shown for
 * orientation but isn't offered as a link that would only 403.
 */
export function VaultBreadcrumb({
  ancestors,
  current,
}: {
  ancestors: VaultFolderCrumb[];
  current: string;
}) {
  const link =
    'max-w-[12rem] truncate hover:text-black/70 hover:underline dark:hover:text-white/70';
  return (
    <nav aria-label="Folder path" className="min-w-0 text-[12px]">
      <ol className="flex flex-wrap items-center gap-1 text-black/45 dark:text-white/45">
        <li>
          <Link href="/vault" className={link}>
            Vault
          </Link>
        </li>
        {ancestors.map((crumb) => (
          <li key={crumb.id} className="flex min-w-0 items-center gap-1">
            <ChevronRight className="size-3 shrink-0" aria-hidden />
            {crumb.canRead ? (
              <Link href={`/vault/folders/${crumb.id}`} className={link}>
                {crumb.name}
              </Link>
            ) : (
              <span
                className="max-w-[12rem] truncate"
                title="You don’t have access to this folder"
              >
                {crumb.name}
              </span>
            )}
          </li>
        ))}
        <li className="flex min-w-0 items-center gap-1">
          <ChevronRight className="size-3 shrink-0" aria-hidden />
          <span
            aria-current="page"
            className="max-w-[16rem] truncate font-medium text-black/70 dark:text-white/70"
          >
            {current}
          </span>
        </li>
      </ol>
    </nav>
  );
}
