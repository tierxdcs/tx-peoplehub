import {
  Box,
  File as FileIcon,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  Presentation,
  type LucideIcon,
} from 'lucide-react';
import type {
  VaultFileOrigin,
  VaultFileTypeCategory,
  VaultFolder,
  VaultFolderType,
  VaultSortOption,
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

// ---- browse layer: type / origin / sort vocabulary ----

const FILE_TYPE_LABELS: Record<VaultFileTypeCategory, string> = {
  PDF: 'PDF',
  IMAGE: 'Image',
  SPREADSHEET: 'Spreadsheet',
  DOCUMENT: 'Document',
  PRESENTATION: 'Presentation',
  CAD: 'CAD / drawing',
  ARCHIVE: 'Archive',
  TEXT: 'Text',
  OTHER: 'Other',
};

/** Filter dropdown order — same order the backend sorts by type. */
export const FILE_TYPE_OPTIONS: VaultFileTypeCategory[] = [
  'PDF',
  'DOCUMENT',
  'SPREADSHEET',
  'PRESENTATION',
  'IMAGE',
  'CAD',
  'TEXT',
  'ARCHIVE',
  'OTHER',
];

export function fileTypeLabel(type: VaultFileTypeCategory): string {
  return FILE_TYPE_LABELS[type] ?? 'Other';
}

const FILE_TYPE_ICONS: Record<VaultFileTypeCategory, LucideIcon> = {
  PDF: FileType,
  IMAGE: FileImage,
  SPREADSHEET: FileSpreadsheet,
  DOCUMENT: FileText,
  PRESENTATION: Presentation,
  CAD: Box,
  ARCHIVE: FileArchive,
  TEXT: FileText,
  OTHER: FileIcon,
};

export function fileTypeIcon(type: VaultFileTypeCategory): LucideIcon {
  return FILE_TYPE_ICONS[type] ?? FileIcon;
}

/**
 * Origin is derived, not stored — MANUAL means "a person uploaded this here",
 * every other value names the module that auto-filed the document.
 */
const ORIGIN_LABELS: Record<VaultFileOrigin, string> = {
  DESIGN: 'Design',
  SALES_LEAD: 'Sales lead',
  VENDOR_QUALIFICATION: 'Vendor qualification',
  RFQ: 'RFQ',
  MANUAL: 'Manual upload',
};

export const ORIGIN_OPTIONS: VaultFileOrigin[] = [
  'MANUAL',
  'DESIGN',
  'SALES_LEAD',
  'VENDOR_QUALIFICATION',
  'RFQ',
];

export function originLabel(origin: VaultFileOrigin): string {
  return ORIGIN_LABELS[origin] ?? 'Manual upload';
}

/**
 * Sort choices. RELEVANCE is listed first but is only offered while a search
 * term is present (it ranks by match quality, which is meaningless otherwise).
 */
export const SORT_OPTIONS: { value: VaultSortOption; label: string }[] = [
  { value: 'RELEVANCE', label: 'Best match' },
  { value: 'NAME_ASC', label: 'Name (A–Z)' },
  { value: 'NAME_DESC', label: 'Name (Z–A)' },
  { value: 'MODIFIED_DESC', label: 'Modified (newest)' },
  { value: 'MODIFIED_ASC', label: 'Modified (oldest)' },
  { value: 'SIZE_DESC', label: 'Size (largest)' },
  { value: 'SIZE_ASC', label: 'Size (smallest)' },
  { value: 'TYPE_ASC', label: 'File type' },
];

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
