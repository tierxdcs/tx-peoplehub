import type {
  VaultFolder,
  VaultFolderType,
  VaultVisibilityScope,
} from '../../../lib/types';

/** Human-readable file size from a byte count (string, since sizes are BigInt). */
export function formatBytes(bytes: string | number | null): string {
  if (bytes === null) return '—';
  const n = typeof bytes === 'string' ? Number(bytes) : bytes;
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const value = n / Math.pow(1024, i);
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/** Short scope/type label shown as a badge on a folder row (spec §2). */
export function folderScopeLabel(folder: {
  type: VaultFolderType;
  visibilityScope: VaultVisibilityScope;
}): string {
  if (folder.type === 'PERSONAL') return 'Personal';
  switch (folder.visibilityScope) {
    case 'COMPANY_WIDE':
      return 'Company-wide';
    case 'VERTICAL':
      return 'Vertical';
    case 'TEAM':
      return 'Team';
    case 'PRIVATE':
      return 'Private';
    default:
      return folder.type;
  }
}

/** Badge variant for a folder scope. */
export function folderScopeVariant(
  folder: Pick<VaultFolder, 'type' | 'visibilityScope'>,
): 'default' | 'secondary' | 'success' | 'info' | 'muted' {
  if (folder.type === 'PERSONAL') return 'info';
  switch (folder.visibilityScope) {
    case 'COMPANY_WIDE':
      return 'success';
    case 'VERTICAL':
      return 'default';
    case 'TEAM':
      return 'secondary';
    default:
      return 'muted';
  }
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
